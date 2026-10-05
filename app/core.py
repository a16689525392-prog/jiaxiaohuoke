# -*- coding: utf-8 -*-
"""Configuration, time, settings, rendering and visibility helpers shared by all views."""
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
import re

from . import db, tpl, web
from .tpl import Markup

APP_NAME = "驾校招生业务系统"
VERSION = "1.0.0"
PENDING = "按当前合作协议核验"

CONFIG = {
    "data_dir": "",
    "tz_offset": 8.0,      # hours east of UTC; China has a single zone and no daylight saving
    "fake_today": None,    # tests only
    "debug": False,
}


# ------------------------------------------------------------------ time
def now():
    if CONFIG["fake_today"]:
        return dt.datetime.combine(dt.date.fromisoformat(CONFIG["fake_today"]), dt.time(10, 0, 0))
    utc = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    return utc + dt.timedelta(hours=CONFIG["tz_offset"])


def today():
    return now().date()


def today_s():
    return today().isoformat()


def now_s():
    return now().strftime("%Y-%m-%d %H:%M:%S")


_DATE = re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$")


def parse_date(text):
    """'2026-10-6', '2026/10/06' ... -> 'YYYY-MM-DD'; '' -> None; garbage -> ValueError."""
    text = (text or "").strip()
    if not text:
        return None
    m = _DATE.match(text)
    if not m:
        raise ValueError(text)
    return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()


def to_date(s):
    return dt.date.fromisoformat(s[:10]) if s else None


def add_days(s, n):
    return (to_date(s) + dt.timedelta(days=n)).isoformat()


def week_start(d=None):
    d = d or today()
    return d - dt.timedelta(days=d.weekday())


WEEKDAYS = "一二三四五六日"


def fmt_md(s):
    if not s:
        return ""
    d = to_date(s)
    return "%d月%d日" % (d.month, d.day)


def fmt_mdw(s):
    if not s:
        return ""
    d = to_date(s)
    return "%d月%d日 周%s" % (d.month, d.day, WEEKDAYS[d.weekday()])


def fmt_date(s):
    """Short date, with the year only when it is not the current one."""
    if not s:
        return ""
    d = to_date(s)
    if d.year == today().year:
        return "%d月%d日" % (d.month, d.day)
    return "%d年%d月%d日" % (d.year, d.month, d.day)


def fmt_dt(s):
    if not s:
        return ""
    return fmt_date(s[:10]) + " " + s[11:16]


def due_info(s):
    """(label, css class) describing a due date relative to today."""
    if not s:
        return ("未排期", "due-none")
    delta = (to_date(s) - today()).days
    if delta < 0:
        return ("逾期 %d 天" % -delta, "due-over")
    if delta == 0:
        return ("今天", "due-today")
    if delta == 1:
        return ("明天", "due-soon")
    if delta <= 6:
        return ("%d 天后 · 周%s" % (delta, WEEKDAYS[to_date(s).weekday()]), "due-future")
    return (fmt_date(s), "due-future")


def to_number(v):
    """A finite number from text such as '3,680', or None ('nan' and 'inf' do not count as numbers)."""
    try:
        f = float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and abs(f) < 1e12 else None


def money(v):
    """'3680' -> '3,680'; non-numeric text is returned unchanged."""
    if v is None or v == "":
        return ""
    f = to_number(v)
    if f is None:
        return str(v)
    return "{:,.0f}".format(f) if f == int(f) else "{:,.2f}".format(f)


def is_number(v):
    return to_number(v) is not None


def count_or_none(text):
    """'' -> None; a whole number from 0 to 999,999,999 -> int; anything else -> ValueError."""
    text = (text or "").replace(",", "").strip()
    if not text:
        return None
    n = int(text)
    if not 0 <= n <= 999999999:
        raise ValueError(text)
    return n


def pct(a, b):
    if not b:
        return ""
    return "%.1f%%" % (100.0 * a / b)


# ------------------------------------------------------------------ settings
DEFAULT_SETTINGS = {
    "team_name": "",
    "unified_entry": "",
    "members_only_own": "0",
    "reward_desc": "", "reward_amount": "", "reward_when": "", "reward_valid": "", "reward_invalid": "",
    "reward_public": "",
    "targets": "{}",
    "start_date": "",
}


def _settings():
    r = web.req()
    cache = getattr(r, "_settings", None)
    if cache is None:
        cache = dict(DEFAULT_SETTINGS)
        for k, v in db.rows("SELECT key, value FROM settings"):
            cache[k] = v
        r._settings = cache
    return cache


def setting(key, default=""):
    return _settings().get(key, default)


def set_setting(key, value):
    db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
           key, str(value))
    _settings()[key] = str(value)


def json_setting(key):
    try:
        return json.loads(setting(key, "{}") or "{}")
    except ValueError:
        return {}


# ------------------------------------------------------------------ users and visibility
def users_map():
    r = web.req()
    cache = getattr(r, "_users", None)
    if cache is None:
        cache = {}
        for u in db.rows("SELECT id, username, display_name, role, active FROM users ORDER BY id"):
            cache[u["id"]] = u
        r._users = cache
    return cache


def user_name(uid):
    u = users_map().get(uid)
    return u["display_name"] if u else ""


def active_users():
    return [u for u in users_map().values() if u["active"]]


def owner_choices(keep=None):
    """People who can be picked as the one responsible: active accounts, plus whoever holds the record now.

    Keeping the current owner in the list (even when that account has been switched off) means that saving
    a form never hands the record to somebody else by accident.
    """
    return [u for u in users_map().values() if u["active"] or u["id"] == keep]


def is_admin(user=None):
    user = user or web.req().user
    return bool(user) and user["role"] == "admin"


def sees_all(user=None):
    """Admins always see everything; members do unless 'only own' is switched on."""
    user = user or web.req().user
    return is_admin(user) or setting("members_only_own", "0") != "1"


def want_mine():
    """Whether lists should be narrowed to the current user's own records."""
    r = web.req()
    if not sees_all():
        return True
    choice = r.query.get("mine", "")
    if choice in ("0", "1"):
        if r.cookies.get("jx_mine") != choice:
            r.set_cookie("jx_mine", choice, max_age=365 * 86400)
        return choice == "1"
    saved = r.cookies.get("jx_mine", "")
    if saved in ("0", "1"):
        return saved == "1"
    return not is_admin()


def cust_scope(alias="c", mine=None):
    """SQL condition limiting customers to what the current user may see (and optionally to their own)."""
    uid = web.req().user["id"]
    if mine is None:
        mine = not sees_all()
    if mine or not sees_all():
        return ("%s.owner_id = ?" % alias, [uid])
    return ("1=1", [])


def stu_scope(s="s", c="c", mine=None):
    uid = web.req().user["id"]
    if mine is None:
        mine = not sees_all()
    if mine or not sees_all():
        return ("(%s.owner_id = ? OR %s.owner_id = ?)" % (s, c), [uid, uid])
    return ("1=1", [])


def require_admin():
    if not is_admin():
        raise web.HTTPError(403, "这个操作需要管理员权限。")


# ------------------------------------------------------------------ rendering
NAV = [
    ("今日", "/", "today"),
    ("客户", "/customers", "customers"),
    ("跟进日历", "/calendar", "calendar"),
    ("学员交付", "/students", "students"),
    ("异常台账", "/issues", "issues"),
    ("产品卡", "/products", "products"),
    ("统一话术", "/scripts", "scripts"),
    ("获客渠道", "/channels", "channels"),
    ("转介绍", "/referrals", "referrals"),
    ("数据复盘", "/data", "data"),
    ("开始与红线", "/guide", "guide"),
]


def take_flashes():
    r = web.req()
    out = list(r.flashes)
    r.flashes = []
    packed = r.cookies.get("jx_flash")
    if packed:
        for line in packed.split("\n"):
            kind, sep, msg = line.partition("|")
            if sep and msg:
                out.append((kind if kind in ("ok", "warn", "err") else "ok", msg))
        r.delete_cookie("jx_flash")
    return out


def render(name, **ctx):
    r = web.req()
    base = {
        "req": r, "user": r.user, "csrf": r.session["csrf"] if r.session else getattr(r, "pre_csrf", ""),
        "flashes": take_flashes(), "today": today_s(), "nav": NAV, "active": "",
        "admin": is_admin() if r.user else False, "team_name": setting("team_name") if r.db is not None else "",
        "app_name": APP_NAME, "version": VERSION, "title": "",
    }
    base.update(ctx)
    return tpl.render(name, **base)


def _error(status, message):
    r = web.req()
    titles = {403: "没有权限", 404: "没找到这个页面", 405: "不支持的操作", 413: "内容太大", 429: "操作太频繁",
              500: "系统出错了"}
    hints = {404: "链接可能已经失效，或者这条记录不在你能看到的范围里。",
             500: "已经记到日志里。可以返回上一页重试，反复出现请联系管理员。"}
    try:
        user = r.user
    except AttributeError:
        user = None
    return tpl.render("error.tpl", status=status, heading=titles.get(status, "出错了"),
                      message=message or hints.get(status, ""), user=user, app_name=APP_NAME)


web.error_renderer[0] = _error


_UNSAFE_IN_PATH = re.compile(r"[\x00-\x20\x7f\\]")


def safe_path(target, default=""):
    """Only allow links that stay inside this site (blocks //host, javascript: and the like).

    Whitespace and control characters are refused as well: browsers drop tabs and line breaks from a
    URL, which would turn "/<tab>/host" into "//host".
    """
    target = (target or "").strip()
    if not target.startswith("/") or target.startswith("//") or _UNSAFE_IN_PATH.search(target) or len(target) > 500:
        return default
    return target


def back(default="/"):
    """Redirect target from a 'next' field, restricted to local paths."""
    r = web.req()
    return safe_path(r.form.get("next") or r.query.get("next"), default)


def paginate(total, per_page=50):
    r = web.req()
    page = max(1, r.query.int("page", 1) or 1)
    pages = max(1, (total + per_page - 1) // per_page)
    page = min(page, pages)
    return {"page": page, "pages": pages, "total": total, "per_page": per_page, "offset": (page - 1) * per_page}


def csv_response(filename, header, data_rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for line in data_rows:
        w.writerow(["" if v is None else v for v in line])
    body = ("﻿" + buf.getvalue()).encode("utf-8")  # BOM so that Excel opens it as UTF-8
    from urllib.parse import quote
    return web.Response(body, 200, "text/csv; charset=utf-8",
                        [("Content-Disposition", "attachment; filename*=UTF-8''%s" % quote(filename))])


def clip(text, n=60):
    text = (text or "").replace("\n", " ")
    return text if len(text) <= n else text[: n - 1] + "…"


def nl2br(text):
    return Markup(tpl.esc(text or "").replace("\n", "<br>"))


def is_pending(value):
    return (not str(value or "").strip()) or PENDING in str(value)


tpl.GLOBALS.update(
    fmt_md=fmt_md, fmt_mdw=fmt_mdw, fmt_date=fmt_date, fmt_dt=fmt_dt, due_info=due_info, money=money, pct=pct,
    user_name=user_name, clip=clip, nl2br=nl2br, is_pending=is_pending, PENDING=PENDING, len=len, str=str, int=int,
    enumerate=enumerate, sorted=sorted, range=range, zip=zip, min=min, max=max, sum=sum, any=any, all=all,
    list=list, dict=dict, round=round, is_number=is_number,
)


def setup_paths(root, data_dir):
    CONFIG["data_dir"] = data_dir
    tpl.TEMPLATE_DIR[0] = os.path.join(root, "templates")
    web.STATIC_DIR[0] = os.path.join(root, "static")
    # Browsers keep the stylesheet and script for a day; a name that changes with the content makes
    # an upgraded installation pick up the new files at once.
    digest = hashlib.sha1()
    for name in ("app.css", "app.js"):
        try:
            with open(os.path.join(web.STATIC_DIR[0], name), "rb") as fh:
                digest.update(fh.read())
        except OSError:
            pass
    tpl.GLOBALS["asset_v"] = digest.hexdigest()[:10]
