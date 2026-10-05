# -*- coding: utf-8 -*-
"""Accounts, passwords, sessions, CSRF protection and the first-run setup."""
import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
import threading
import time
from urllib.parse import quote

from . import core, db, web
from .core import render
from .web import Redirect, flash

log = logging.getLogger("jiaxiao")

PBKDF2_ITERATIONS = [int(os.environ.get("JX_PBKDF2_ITER", "600000"))]
SESSION_DAYS = 14
USERNAME_RE = re.compile(r"^[\w.\-一-鿿]{2,32}$")
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


# ------------------------------------------------------------------ passwords
def hash_password(password, iterations=None):
    iterations = iterations or PBKDF2_ITERATIONS[0]
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256$%d$%s$%s" % (iterations, base64.b64encode(salt).decode(), base64.b64encode(dk).decode())


def check_password(password, stored):
    try:
        algo, iterations, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), base64.b64decode(salt), int(iterations))
        return hmac.compare_digest(dk, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


_dummy = []


def _dummy_hash():
    if not _dummy:
        _dummy.append(hash_password(secrets.token_urlsafe(16)))
    return _dummy[0]


def password_problem(password):
    if len(password) < 8:
        return "密码至少 8 位。"
    if len(password) > 128:
        return "密码太长了。"
    return ""


# ------------------------------------------------------------------ login throttling (in memory)
_fails = {}
_fails_lock = threading.Lock()
WINDOW, LIMIT = 600, 8


def _blocked(key):
    with _fails_lock:
        recent = [t for t in _fails.get(key, []) if time.time() - t < WINDOW]
        if recent:
            _fails[key] = recent
        else:
            _fails.pop(key, None)
        return len(recent) >= LIMIT


def _note_fail(key):
    with _fails_lock:
        _fails.setdefault(key, []).append(time.time())


def _clear_fails(key):
    with _fails_lock:
        _fails.pop(key, None)


# ------------------------------------------------------------------ sessions
def _hash_token(token):
    return hashlib.sha256(token.encode("ascii", "ignore")).hexdigest()


def start_session(request, user_id):
    token = secrets.token_urlsafe(32)
    now = core.now()
    expires = now + core.dt.timedelta(days=SESSION_DAYS)
    db.insert("sessions", token_hash=_hash_token(token), user_id=user_id, csrf=secrets.token_urlsafe(24),
              created_at=now.strftime("%Y-%m-%d %H:%M:%S"), expires_at=expires.strftime("%Y-%m-%d %H:%M:%S"))
    db.run("UPDATE users SET last_login_at = ? WHERE id = ?", core.now_s(), user_id)
    request.set_cookie("jx_sid", token, max_age=SESSION_DAYS * 86400)


def _load_session(request):
    token = request.cookies.get("jx_sid")
    if not token:
        return
    s = db.row("SELECT s.*, u.username, u.display_name, u.role, u.active FROM sessions s "
               "JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?", _hash_token(token))
    if not s or not s["active"] or s["expires_at"] < core.now_s():
        return
    request.session = s
    request.user = {"id": s["user_id"], "username": s["username"], "display_name": s["display_name"],
                    "role": s["role"]}
    # sliding expiry: renew once the session is more than a day old
    remaining = core.dt.datetime.strptime(s["expires_at"], "%Y-%m-%d %H:%M:%S") - core.now()
    if remaining < core.dt.timedelta(days=SESSION_DAYS - 1):
        new_exp = (core.now() + core.dt.timedelta(days=SESSION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
        db.run("UPDATE sessions SET expires_at = ? WHERE token_hash = ?", new_exp, s["token_hash"])
        request.set_cookie("jx_sid", token, max_age=SESSION_DAYS * 86400)


def has_users():
    return db.val("SELECT 1 FROM users LIMIT 1") is not None


def _pre_csrf(request):
    token = request.cookies.get("jx_pre", "")
    if not re.match(r"^[A-Za-z0-9_\-]{20,}$", token):
        token = secrets.token_urlsafe(24)
        request.set_cookie("jx_pre", token, max_age=86400)
    request.pre_csrf = token
    return token


def _before(request):
    route = request.route
    _load_session(request)
    if route.public:
        token = _pre_csrf(request)
        if request.method == "POST":
            sent = request.form.get("_csrf")
            if not sent or not hmac.compare_digest(sent, token):
                raise web.HTTPError(403, "页面停留太久了，请返回刷新后再提交一次。")
        return
    if not request.user:
        if not has_users():
            raise Redirect("/setup")
        target = request.path + ("?" + request.query_string if request.query_string else "")
        raise Redirect("/login" + ("?next=" + quote(target, safe="") if request.method == "GET" and target != "/" else ""))
    if request.method == "POST":
        sent = request.form.get("_csrf")
        if not sent or not hmac.compare_digest(sent, request.session["csrf"]):
            raise web.HTTPError(403, "页面停留太久了，请返回刷新后再提交一次。")
    if route.admin and request.user["role"] != "admin":
        raise web.HTTPError(403, "这个页面只有管理员能进。")


web.before_request.append(_before)


# ------------------------------------------------------------------ first-run setup code
def setup_code_path():
    return os.path.join(core.CONFIG["data_dir"], "setup-code.txt")


def ensure_setup_code():
    """Create (or read) the one-time code that protects the first-run setup page."""
    path = setup_code_path()
    if os.path.exists(path):
        with open(path) as fh:
            return fh.read().strip()
    code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
    code = code[:4] + "-" + code[4:]
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(code + "\n")
    return code


def _norm_code(text):
    return re.sub(r"[\s\-]", "", text or "").upper()


def valid_username(name):
    return bool(USERNAME_RE.match(name or ""))


def create_user(username, display_name, password, role="member"):
    return db.insert("users", username=username, display_name=display_name or username,
                     password_hash=hash_password(password), role=role, active=1, created_at=core.now_s())


# ------------------------------------------------------------------ routes
@web.both("/setup", public=True)
def setup(request):
    if has_users():
        raise Redirect("/login")
    f = request.form
    errors = []
    if request.method == "POST":
        key = "setup:" + request.remote_addr
        if _blocked(key):
            raise web.HTTPError(429, "尝试次数太多，请 10 分钟后再试。")
        expected = _norm_code(ensure_setup_code())
        if not hmac.compare_digest(_norm_code(f.get("code")).encode(), expected.encode()):
            _note_fail(key)
            errors.append("初始化口令不对。口令在安装脚本的输出里，也可以在服务器上查看数据目录下的 setup-code.txt。")
        username, display = f.get("username"), f.get("display_name")
        pw, pw2 = f.raw("password"), f.raw("password2")
        if not valid_username(username):
            errors.append("用户名 2–32 位，可以用字母、数字、中文、下划线、点和短横线。")
        problem = password_problem(pw)
        if problem:
            errors.append(problem)
        elif pw != pw2:
            errors.append("两次输入的密码不一样。")
        if not errors:
            uid = create_user(username, display or username, pw, "admin")
            core.set_setting("team_name", f.get("team_name"))
            core.set_setting("start_date", core.today_s())
            from . import seed
            seed.seed_defaults()
            try:
                os.remove(setup_code_path())
            except OSError:
                pass
            start_session(request, uid)
            log.info("first admin account created: %s", username)
            flash("系统已经初始化。先去填第 1 个班型的产品卡。")
            raise Redirect("/guide")
    return render("setup.tpl", title="初始化", errors=errors, f=f)


@web.both("/login", public=True)
def login(request):
    if not has_users():
        raise Redirect("/setup")
    if request.user:
        raise Redirect("/")
    f = request.form
    error = ""
    if request.method == "POST":
        username = f.get("username")
        keys = ["u:" + username.lower(), "ip:" + request.remote_addr]
        if any(_blocked(k) for k in keys):
            raise web.HTTPError(429, "登录失败次数太多，请 10 分钟后再试。")
        u = db.row("SELECT * FROM users WHERE username = ?", username)
        # always run one full-cost hash so that unknown usernames take the same time
        ok = check_password(f.raw("password"), u["password_hash"] if u else _dummy_hash())
        if u and ok and u["active"]:
            for k in keys:
                _clear_fails(k)
            start_session(request, u["id"])
            raise Redirect(core.back("/"))
        for k in keys:
            _note_fail(k)
        error = "用户名或密码不对。" if not (u and ok and not u["active"]) else "这个账号已被停用，请联系管理员。"
    return render("login.tpl", title="登录", error=error, f=f,
                  next=core.safe_path(request.query.get("next") or f.get("next")))


@web.post("/logout")
def logout(request):
    db.run("DELETE FROM sessions WHERE token_hash = ?", request.session["token_hash"])
    request.delete_cookie("jx_sid")
    raise Redirect("/login")


@web.both("/account")
def account(request):
    f = request.form
    errors = []
    if request.method == "POST":
        action = f.get("action")
        uid = request.user["id"]
        if action == "profile":
            name = f.get("display_name")
            if not name or len(name) > 20:
                errors.append("显示名称 1–20 个字。")
            else:
                db.run("UPDATE users SET display_name = ? WHERE id = ?", name, uid)
                flash("显示名称已更新。")
                raise Redirect("/account")
        elif action == "password":
            u = db.row("SELECT * FROM users WHERE id = ?", uid)
            new, new2 = f.raw("new_password"), f.raw("new_password2")
            if not check_password(f.raw("old_password"), u["password_hash"]):
                errors.append("当前密码不对。")
            elif password_problem(new):
                errors.append(password_problem(new))
            elif new != new2:
                errors.append("两次输入的新密码不一样。")
            else:
                db.run("UPDATE users SET password_hash = ? WHERE id = ?", hash_password(new), uid)
                # sign out every other device
                db.run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", uid, request.session["token_hash"])
                flash("密码已修改，其他设备上的登录已退出。")
                raise Redirect("/account")
    return render("account.tpl", title="我的账号", errors=errors)


def purge_sessions(conn, now_text):
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now_text,))
