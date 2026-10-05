# -*- coding: utf-8 -*-
"""A tiny in-process WSGI client for the tests (no sockets, no third-party packages)."""
import io
import re
from urllib.parse import quote, unquote, urlencode, urlsplit

_CSRF = re.compile(r'name="_csrf" value="([^"]*)"')


class Result(object):
    def __init__(self, status, headers, body):
        self.status = status
        self.headers = headers
        self.body = body
        ctype = dict((k.lower(), v) for k, v in headers).get("content-type", "")
        self.text = body.decode("utf-8", "replace") if ("text" in ctype or "json" in ctype) else ""
        self.history = []

    def header(self, name):
        for k, v in self.headers:
            if k.lower() == name.lower():
                return v
        return None


class Client(object):
    def __init__(self, app):
        self.app = app
        self.cookies = {}
        self.csrf = ""
        self.path = "/"

    def _call(self, method, path, data=None):
        parts = urlsplit(path)
        body = b""
        environ = {
            "REQUEST_METHOD": method, "SCRIPT_NAME": "", "SERVER_NAME": "test", "SERVER_PORT": "80",
            "PATH_INFO": unquote(parts.path).encode("utf-8").decode("latin-1"), "QUERY_STRING": parts.query,
            "REMOTE_ADDR": "10.0.0.9", "wsgi.url_scheme": "http", "wsgi.errors": io.StringIO(),
            "wsgi.version": (1, 0), "wsgi.multithread": True, "wsgi.multiprocess": False, "wsgi.run_once": False,
        }
        if data is not None:
            pairs = []
            for k, v in (data.items() if isinstance(data, dict) else data):
                if isinstance(v, (list, tuple)):
                    pairs.extend((k, x) for x in v)
                else:
                    pairs.append((k, v))
            body = urlencode(pairs).encode("utf-8")
            environ["CONTENT_TYPE"] = "application/x-www-form-urlencoded"
        environ["CONTENT_LENGTH"] = str(len(body))
        environ["wsgi.input"] = io.BytesIO(body)
        if self.cookies:
            environ["HTTP_COOKIE"] = "; ".join("%s=%s" % (k, quote(v, safe="")) for k, v in self.cookies.items())
        captured = {}

        def start_response(status, headers, exc_info=None):
            captured["status"] = int(status.split()[0])
            captured["headers"] = headers

        chunks = self.app(environ, start_response)
        result = Result(captured["status"], captured["headers"], b"".join(chunks))
        for k, v in result.headers:
            if k.lower() == "set-cookie":
                first = v.split(";")[0]
                name, _, value = first.partition("=")
                if "Max-Age=0" in v:
                    self.cookies.pop(name, None)
                else:
                    self.cookies[name] = unquote(value)
        return result

    def request(self, method, path, data=None, follow=True):
        result = self._call(method, path, data)
        history = []
        hops = 0
        while follow and result.status in (302, 303) and hops < 6:
            history.append(result)
            path = result.header("Location")
            result = self._call("GET", path)
            hops += 1
        result.history = history
        result.path = path
        m = _CSRF.search(result.text)
        if m:
            self.csrf = m.group(1)
        return result

    def get(self, path, follow=True):
        return self.request("GET", path, None, follow)

    def post(self, path, data=None, follow=True, csrf=True):
        data = dict(data or {})
        if csrf and "_csrf" not in data:
            data["_csrf"] = self.csrf
        return self.request("POST", path, data, follow)
