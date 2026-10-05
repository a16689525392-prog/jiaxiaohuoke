# -*- coding: utf-8 -*-
"""A very small WSGI framework built only on the Python standard library.

Routing, request/response objects, cookies, flash messages, static files and a
threaded development-grade server that is perfectly adequate for a small team
on a local network.  No third-party packages are needed.
"""
import ipaddress
import logging
import mimetypes
import os
import re
import socket
import socketserver
import threading
import time
import traceback
from urllib.parse import parse_qs, quote, unquote
from wsgiref.simple_server import ServerHandler, WSGIRequestHandler, WSGIServer

log = logging.getLogger("jiaxiao")

MAX_BODY = 1024 * 1024  # 1 MB is far more than any form here needs
MAX_LINE = 1000         # longest one-line form value kept
MAX_TEXT = 20000        # longest multi-line form value kept
MAX_INT = 10 ** 12      # whole numbers beyond this are treated as "not a number"
local = threading.local()

STATUS_TEXT = {
    200: "OK", 302: "Found", 303: "See Other", 304: "Not Modified", 400: "Bad Request", 403: "Forbidden",
    404: "Not Found", 405: "Method Not Allowed", 413: "Payload Too Large", 429: "Too Many Requests",
    500: "Internal Server Error",
}


class MultiDict(object):
    """Read-only view over parse_qs output."""

    def __init__(self, data):
        self._d = data

    def get(self, key, default=""):
        """One-line value: trimmed, line breaks removed, capped (forms set their own, smaller, maxlength)."""
        v = self._d.get(key)
        if not v:
            return default
        return " ".join(v[0].split("\n")).replace("\r", "").strip()[:MAX_LINE]

    def raw(self, key, default=""):
        v = self._d.get(key)
        return v[0].replace("\r\n", "\n") if v else default

    def text(self, key, default=""):
        """Multi-line text: normalised newlines, trimmed at both ends, capped."""
        return self.raw(key, default).strip()[:MAX_TEXT]

    def getlist(self, key):
        return [x.strip()[:MAX_LINE] for x in self._d.get(key, [])]

    def int(self, key, default=None):
        """Whole number, or `default` when missing, not a number or absurdly large."""
        try:
            n = int(self.get(key, ""))
        except ValueError:
            return default
        return n if -MAX_INT <= n <= MAX_INT else default

    def __contains__(self, key):
        return key in self._d

    def keys(self):
        return self._d.keys()


class HTTPError(Exception):
    def __init__(self, status, message=""):
        Exception.__init__(self, message)
        self.status = status
        self.message = message


class Redirect(Exception):
    def __init__(self, location):
        Exception.__init__(self, location)
        self.location = location


class Response(object):
    def __init__(self, body="", status=200, content_type="text/html; charset=utf-8", headers=None):
        self.status = status
        self.body = body.encode("utf-8") if isinstance(body, str) else body
        self.headers = [("Content-Type", content_type)] + list(headers or [])


class Request(object):
    def __init__(self, environ):
        self.environ = environ
        self.method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "/") or "/"
        try:  # WSGI hands the path over as latin-1
            path = path.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        self.path = path
        self.query_string = environ.get("QUERY_STRING", "")
        self.query = MultiDict(parse_qs(self.query_string, keep_blank_values=True))
        self.remote_addr = environ.get("REMOTE_ADDR", "")
        self._form = None
        self._cookies = None
        self.out_cookies = []
        self.flashes = []
        self.user = None
        self.session = None
        self.route = None
        self.db = None

    @property
    def cookies(self):
        if self._cookies is None:
            jar = {}
            for part in self.environ.get("HTTP_COOKIE", "").split(";"):
                name, sep, value = part.strip().partition("=")
                if sep and name and name not in jar:
                    jar[name] = unquote(value.strip('"'))
            self._cookies = jar
        return self._cookies

    @property
    def form(self):
        if self._form is None:
            data = {}
            if self.method == "POST":
                try:
                    length = int(self.environ.get("CONTENT_LENGTH") or 0)
                except ValueError:
                    length = 0
                if length > MAX_BODY:
                    raise HTTPError(413, "提交的内容太大了。")
                ctype = self.environ.get("CONTENT_TYPE", "")
                if length and ctype.split(";")[0].strip() == "application/x-www-form-urlencoded":
                    body = self.environ["wsgi.input"].read(length)
                    data = parse_qs(body.decode("utf-8", "replace"), keep_blank_values=True)
            self._form = MultiDict(data)
        return self._form

    def set_cookie(self, name, value, max_age=None, httponly=True):
        parts = ["%s=%s" % (name, quote(value, safe="")), "Path=/", "SameSite=Lax"]
        if max_age is not None:
            parts.append("Max-Age=%d" % max_age)
        if httponly:
            parts.append("HttpOnly")
        self.out_cookies.append("; ".join(parts))

    def delete_cookie(self, name):
        self.out_cookies.append("%s=; Path=/; Max-Age=0; SameSite=Lax" % name)

    def url(self, **changes):
        """Current URL with some query parameters replaced (None removes one)."""
        params = dict((k, self.query.get(k)) for k in self.query.keys())
        for k, v in changes.items():
            if v is None or v == "":
                params.pop(k, None)
            else:
                params[k] = str(v)
        qs = "&".join("%s=%s" % (quote(k), quote(v, safe="")) for k, v in sorted(params.items()) if v != "")
        return self.path + ("?" + qs if qs else "")


def req():
    return local.req


def flash(message, kind="ok"):
    local.req.flashes.append((kind, message))


# ---------------------------------------------------------------- routing
ROUTES = []
before_request = []      # callables(req) run after the route is matched
error_renderer = [None]  # callable(status, message) -> html
_PARAM = re.compile(r"<(\w+)(?::(int|path))?>")


def _compile(pattern):
    out, pos = [], 0
    for m in _PARAM.finditer(pattern):
        out.append(re.escape(pattern[pos:m.start()]))
        kind = m.group(2)
        if kind == "int":
            out.append(r"(?P<%s>\d{1,12})" % m.group(1))
        elif kind == "path":
            out.append(r"(?P<%s>.+)" % m.group(1))
        else:
            out.append(r"(?P<%s>[^/]+)" % m.group(1))
        pos = m.end()
    out.append(re.escape(pattern[pos:]))
    return re.compile("^" + "".join(out) + "$")


class Route(object):
    def __init__(self, pattern, methods, func, public, admin):
        self.pattern = pattern
        self.regex = _compile(pattern)
        self.methods = methods
        self.func = func
        self.public = public
        self.admin = admin
        self.int_params = set(m.group(1) for m in _PARAM.finditer(pattern) if m.group(2) == "int")


def route(pattern, methods=("GET",), public=False, admin=False):
    def deco(func):
        ROUTES.append(Route(pattern, tuple(methods), func, public, admin))
        return func

    return deco


def get(pattern, **kw):
    return route(pattern, ("GET",), **kw)


def post(pattern, **kw):
    return route(pattern, ("POST",), **kw)


def both(pattern, **kw):
    return route(pattern, ("GET", "POST"), **kw)


# ---------------------------------------------------------------- static files
STATIC_DIR = [None]
_SAFE_STATIC = re.compile(r"^[A-Za-z0-9_\-./]+$")


def _static(path):
    rel = path[len("/static/"):]
    if not _SAFE_STATIC.match(rel) or ".." in rel or rel.startswith("/"):
        raise HTTPError(404)
    full = os.path.join(STATIC_DIR[0], rel)
    if not os.path.isfile(full):
        raise HTTPError(404)
    ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
        ctype += "; charset=utf-8"
    with open(full, "rb") as fh:
        data = fh.read()
    return Response(data, 200, ctype, [("Cache-Control", "public, max-age=86400")])


# ---------------------------------------------------------------- the WSGI app
SECURITY_HEADERS = [
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "same-origin"),
    ("Content-Security-Policy",
     "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
     "frame-ancestors 'none'; form-action 'self'; base-uri 'self'"),
]


def header_safe_url(url):
    """Percent-encode everything that may not appear raw in a Location header.

    Header values must be latin-1, so Chinese text in a query string has to be encoded; encoding control
    characters also keeps a crafted "next" link from being read by the browser as another site.
    """
    return quote(url, safe="/?&=#%:;,@!$'()*+~-._")


def _pack_flashes(flashes):
    """Flash messages travel in a short-lived cookie across the redirect; keep it well under 4 KB."""
    lines, size = [], 0
    for kind, message in flashes:
        line = "%s|%s" % (kind, message.replace("\n", " "))
        cost = len(quote(line, safe="")) + 3
        if size + cost > 3000:
            break
        lines.append(line)
        size += cost
    return "\n".join(lines)


def _error_page(status, message):
    if error_renderer[0]:
        try:
            return error_renderer[0](status, message)
        except Exception:  # never let the error page itself take the request down
            log.exception("error page failed")
    return "<h1>%d</h1><p>%s</p>" % (status, STATUS_TEXT.get(status, ""))


def _dispatch(request):
    path = request.path
    if path.startswith("/static/"):
        if request.method not in ("GET", "HEAD"):
            raise HTTPError(405)
        return _static(path)
    allowed = False
    for r in ROUTES:
        m = r.regex.match(path)
        if not m:
            continue
        if request.method not in r.methods and not (request.method == "HEAD" and "GET" in r.methods):
            allowed = True
            continue
        request.route = r
        for hook in before_request:
            hook(request)
        params = m.groupdict()
        for k in r.int_params:
            params[k] = int(params[k])
        return r.func(request, **params)
    raise HTTPError(405 if allowed else 404)


db_open = [None]   # callable() -> connection, set by the db module
db_close = [None]  # callable(conn, ok)
ALLOW_PUBLIC = [False]   # False: only the local network and this machine may connect


def is_public_address(addr):
    """True for an address on the public internet; private, loopback, link-local and CGNAT ranges are not."""
    try:
        ip = ipaddress.ip_address((addr or "").split("%")[0])
    except ValueError:
        return False
    mapped = getattr(ip, "ipv4_mapped", None)   # ::ffff:a.b.c.d when listening on a dual-stack socket
    if mapped is not None:
        ip = mapped
    return ip.is_global


def application(environ, start_response):
    started = time.time()
    request = Request(environ)
    local.req = request
    ok = False
    response = None
    try:
        try:
            if not ALLOW_PUBLIC[0] and is_public_address(request.remote_addr):
                log.warning("refused a connection from the public address %s", request.remote_addr)
                raise HTTPError(403, "这套系统设置为只在内网和本机使用，来自公网的访问已被拒绝。")
            if db_open[0] and not request.path.startswith("/static/"):
                request.db = db_open[0]()
            result = _dispatch(request)
            if isinstance(result, Response):
                response = result
            else:
                response = Response(result or "")
            ok = True
        except Redirect as r:
            ok = True
            response = Response("", 303, headers=[("Location", header_safe_url(r.location))])
            if request.flashes:
                request.set_cookie("jx_flash", _pack_flashes(request.flashes), max_age=60)
        except HTTPError as e:
            response = Response(_error_page(e.status, e.message), e.status)
        except Exception:
            log.error("unhandled error on %s %s\n%s", request.method, request.path, traceback.format_exc())
            response = Response(_error_page(500, ""), 500)
    finally:
        if request.db is not None and db_close[0]:
            try:
                db_close[0](request.db, ok)
            except Exception:
                log.exception("closing the database failed")
                response = Response(_error_page(500, ""), 500)
        local.req = None
    headers = list(response.headers)
    if not request.path.startswith("/static/"):
        headers.append(("Cache-Control", "no-store"))
    headers.extend(SECURITY_HEADERS)
    for c in request.out_cookies:
        headers.append(("Set-Cookie", c))
    body = b"" if request.method == "HEAD" else response.body
    headers.append(("Content-Length", str(len(body))))
    if not request.path.startswith("/static/") and request.path != "/healthz":
        log.info("%s %s %s %dms", request.method, request.path, response.status, (time.time() - started) * 1000)
    start_response("%d %s" % (response.status, STATUS_TEXT.get(response.status, "")), headers)
    return [body]


# ---------------------------------------------------------------- server
class _Server(socketserver.ThreadingMixIn, WSGIServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64

    def server_bind(self):
        # The stock implementation looks the host name up in DNS, which can hang for a long time on a
        # machine whose own name does not resolve.  Nothing here needs the name.
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port
        self.setup_environ()


class _Server6(_Server):
    address_family = socket.AF_INET6


class _ServerHandler(ServerHandler):
    server_software = "jiaxiao"   # the stock value advertises the exact Python version


class _Handler(WSGIRequestHandler):
    timeout = 60  # drop idle connections instead of holding a thread forever
    server_version = "jiaxiao"
    sys_version = ""

    def log_message(self, fmt, *args):  # the application logs requests itself
        pass

    def handle(self):
        """Same as the standard handler, except for the Server header and for swallowing dropped connections."""
        try:
            self.raw_requestline = self.rfile.readline(65537)
            if len(self.raw_requestline) > 65536:
                self.requestline = self.request_version = self.command = ""
                self.send_error(414)
                return
            if not self.parse_request():
                return
            handler = _ServerHandler(self.rfile, self.wfile, self.get_stderr(), self.get_environ(), multithread=True)
            handler.request_handler = self
            handler.run(self.server.get_app())
        except (ConnectionError, OSError):  # client went away or timed out
            pass


def serve(host, port):
    httpd = (_Server6 if ":" in host else _Server)((host, port), _Handler)
    httpd.set_app(application)
    return httpd
