# -*- coding: utf-8 -*-
"""Data and review: funnel dashboard, daily numbers, weekly review, monthly channel comparison."""
import datetime as dt
import json
import re

from . import consts, core, db, stats, web
from .core import render
from .v_customers import _choice, _date
from .web import Redirect, flash

TABS = [("看板", "/data"), ("每日数据", "/data/daily"), ("周复盘", "/data/weekly"), ("渠道对比", "/data/channels")]
RATE_KEYS = ["registered", "consulted", "grade_a", "deposit", "enrolled"]


def targets():
    out = {}
    for k, v in core.json_setting("targets").items():
        try:
            out[k] = float(v)
        except (TypeError, ValueError):
            pass
    return out


# ------------------------------------------------------------------ dashboard
@web.get("/data")
def dashboard(request):
    mine = core.want_mine()
    week0 = core.week_start()
    this_week = stats.funnel(week0.isoformat(), (week0 + dt.timedelta(days=6)).isoformat(), mine)
    last_week = stats.funnel((week0 - dt.timedelta(days=7)).isoformat(), (week0 - dt.timedelta(days=1)).isoformat(), mine)
    total = stats.funnel(None, None, mine)
    today_row = db.row("SELECT exposure FROM daily_stats WHERE day = ? AND user_id = ?", core.today_s(), request.user["id"])
    return render(
        "data.tpl", title="数据看板", active="data", tabs=TABS, tab="/data", mine=mine, can_all=core.sees_all(),
        funnel=consts.FUNNEL, this_week=this_week, last_week=last_week, total=total,
        r_this=stats.rates(this_week), r_last=stats.rates(last_week), r_total=stats.rates(total),
        targets=targets(), fc=stats.follow_counts(mine), dc=stats.delivery_counts(mine),
        issues=stats.open_issues(mine), today_filled=bool(today_row and today_row["exposure"] is not None),
        week_label="%s – %s" % (core.fmt_md(week0.isoformat()), core.fmt_md((week0 + dt.timedelta(days=6)).isoformat())))


@web.post("/data/targets", admin=True)
def save_targets(request):
    f = request.form
    out = {}
    for key in RATE_KEYS:
        raw = f.get("t_" + key).replace("%", "").replace("％", "").strip()
        if not raw:
            continue
        value = core.to_number(raw)
        if value is None or not (0 <= value <= 100):
            flash("目标填 0 到 100 之间的百分比，例如 5 或 62.5。", "err")
            raise Redirect("/data")
        out[key] = value / 100.0
    core.set_setting("targets", json.dumps(out))
    flash("目标已保存。低于目标的环节会标红。")
    raise Redirect("/data")


# ------------------------------------------------------------------ daily
@web.both("/data/daily")
def daily(request):
    uid = request.user["id"]
    today = core.today()
    try:
        end = core.to_date(core.parse_date(request.query.get("end")) or today.isoformat())
    except ValueError:
        end = today
    if end > today:
        end = today
    days = [(end - dt.timedelta(days=i)).isoformat() for i in range(14)]
    if request.method == "POST":
        f = request.form
        errors = 0
        for day in f.getlist("day"):
            try:
                day = core.parse_date(day)
            except ValueError:
                continue
            if not day or day > today.isoformat():
                continue
            old = db.row("SELECT exposure, wechat_adds FROM daily_stats WHERE day = ? AND user_id = ?", day, uid)
            vals = {}
            for key, col in (("exposure", "exposure"), ("wechat", "wechat_adds")):
                try:
                    vals[key] = core.count_or_none(f.get("%s_%s" % (key, day)))
                except ValueError:      # not a whole number: leave what was there and say so
                    errors += 1
                    vals[key] = old[col] if old else None
            summary = f.get("summary_" + day)[:500]
            if old or vals["exposure"] is not None or vals["wechat"] is not None or summary:
                db.run("INSERT INTO daily_stats (day, user_id, exposure, wechat_adds, summary, updated_at) "
                       "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(day, user_id) DO UPDATE SET exposure = excluded.exposure, "
                       "wechat_adds = excluded.wechat_adds, summary = excluded.summary, updated_at = excluded.updated_at",
                       day, uid, vals["exposure"], vals["wechat"], summary, core.now_s())
        if errors:
            flash("有 %d 个数字没看懂，没有改动它们。曝光和加微数只填整数。" % errors, "warn")
        else:
            flash("每日数据已保存。")
        raise Redirect(request.url())
    mine = core.want_mine()
    auto = stats.daily(days, mine)
    own = stats.daily(days, True)
    my_rows = dict((r["day"], r) for r in db.rows(
        "SELECT * FROM daily_stats WHERE user_id = ? AND day BETWEEN ? AND ?", uid, days[-1], days[0]))
    return render("data_daily.tpl", title="每日数据", active="data", tabs=TABS, tab="/data/daily", mine=mine,
                  can_all=core.sees_all(), days=days, auto=auto, own=own, my_rows=my_rows,
                  prev_end=(end - dt.timedelta(days=14)).isoformat(),
                  next_end=None if end >= today else min(today, end + dt.timedelta(days=14)).isoformat(),
                  weekdays=core.WEEKDAYS, to_date=core.to_date)


# ------------------------------------------------------------------ weekly review
@web.both("/data/weekly")
def weekly(request):
    try:
        picked = core.to_date(core.parse_date(request.query.get("week")) or core.today_s())
    except ValueError:
        picked = core.today()
    week0 = core.week_start(picked)
    wk = week0.isoformat()
    if request.method == "POST":
        f = request.form
        db.run("INSERT INTO weekly_reviews (week_start, drop_step, script_change, channel_change, synced, updated_at, updated_by) "
               "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(week_start) DO UPDATE SET drop_step = excluded.drop_step, "
               "script_change = excluded.script_change, channel_change = excluded.channel_change, synced = excluded.synced, "
               "updated_at = excluded.updated_at, updated_by = excluded.updated_by",
               wk, _choice(f, "drop_step", consts.DROP_STEPS), f.text("script_change")[:600],
               f.text("channel_change")[:600], 1 if f.get("synced") == "1" else 0, core.now_s(), request.user["id"])
        for kind, label in consts.CASE_KINDS:
            vals = [f.get("customer_%d" % kind)[:40]] + [f.text("%s_%d" % (k, kind))[:800]
                                                         for k in ("worry", "said", "stopped_at", "change_next")]
            db.run("INSERT INTO review_cases (week_start, kind, customer, worry, said, stopped_at, change_next) "
                   "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(week_start, kind) DO UPDATE SET customer = excluded.customer, "
                   "worry = excluded.worry, said = excluded.said, stopped_at = excluded.stopped_at, "
                   "change_next = excluded.change_next", wk, kind, *vals)
        flash("本周复盘已保存。" + ("" if f.get("synced") == "1" else "改好的那句话，记得同步到统一话术。"))
        raise Redirect("/data/weekly?week=" + wk)
    review = db.row("SELECT * FROM weekly_reviews WHERE week_start = ?", wk)
    cases = dict((r["kind"], r) for r in db.rows("SELECT * FROM review_cases WHERE week_start = ?", wk))
    mine = None if core.sees_all() else True
    f7 = stats.funnel(wk, (week0 + dt.timedelta(days=6)).isoformat(), mine)
    visits = db.rows(
        "SELECT s.id, c.name, s.visit_hard, s.visit_worry FROM students s JOIN customers c ON c.id = s.customer_id "
        "WHERE (s.visit_hard != '' OR s.visit_worry != '') AND s.updated_at >= ? AND s.updated_at < ? AND %s "
        "ORDER BY s.updated_at DESC LIMIT 10" % core.stu_scope("s", "c")[0],
        wk + " 00:00:00", (week0 + dt.timedelta(days=7)).isoformat() + " 00:00:00", *core.stu_scope("s", "c")[1])
    this_week = core.week_start()
    return render("data_weekly.tpl", title="周复盘", active="data", tabs=TABS, tab="/data/weekly", week0=wk,
                  week1=(week0 + dt.timedelta(days=6)).isoformat(), review=review, cases=cases, f7=f7,
                  r7=stats.rates(f7), funnel=consts.FUNNEL, kinds=consts.CASE_KINDS, steps=consts.DROP_STEPS,
                  prev_week=(week0 - dt.timedelta(days=7)).isoformat(),
                  next_week=None if week0 >= this_week else (week0 + dt.timedelta(days=7)).isoformat(),
                  is_current=week0 == this_week, visits=visits)


# ------------------------------------------------------------------ monthly channel comparison
_MONTH = re.compile(r"^([0-9]{4})-([0-9]{1,2})$")


def _month_bounds(text):
    today = core.today()
    year, month = today.year, today.month
    m = _MONTH.match(text or "")
    if m and 2000 <= int(m.group(1)) <= 2100 and 1 <= int(m.group(2)) <= 12:
        year, month = int(m.group(1)), int(m.group(2))
    first = dt.date(year, month, 1)
    nxt = (first + dt.timedelta(days=32)).replace(day=1)
    return first, nxt - dt.timedelta(days=1)


@web.get("/data/channels")
def channel_compare(request):
    first, last = _month_bounds(request.query.get("month"))
    mine = core.want_mine()
    data = stats.channel_month(first.isoformat(), last.isoformat(), mine)
    channels = db.rows("SELECT * FROM channels ORDER BY archived, sort, id")
    rows_ = []
    total = {"new": 0, "leads": 0, "enrolled": 0, "referrals": 0, "cost": 0.0}
    for ch in channels:
        d = data.get(ch["id"])
        if not d and ch["archived"]:
            continue
        d = d or {"new": 0, "leads": 0, "enrolled": 0, "referrals": 0, "cost": 0.0}
        rows_.append((ch, d))
        for k in total:
            total[k] += d[k]
    unknown = data.get(None)
    if unknown:
        rows_.append(({"id": 0, "name": "未填渠道", "archived": 0}, unknown))
        for k in total:
            total[k] += unknown[k]
    can_costs = core.sees_all()
    costs = db.rows(
        "SELECT k.*, ch.name AS channel_name FROM costs k LEFT JOIN channels ch ON ch.id = k.channel_id "
        "WHERE k.spent_on BETWEEN ? AND ? ORDER BY k.spent_on DESC, k.id DESC", first.isoformat(), last.isoformat()) \
        if can_costs else []
    prev_month = (first - dt.timedelta(days=1)).strftime("%Y-%m")
    next_first = last + dt.timedelta(days=1)
    return render("data_channels.tpl", title="渠道对比", active="data", tabs=TABS, tab="/data/channels", mine=mine,
                  can_all=core.sees_all(), rows=rows_, total=total, month=first.strftime("%Y-%m"),
                  month_label="%d 年 %d 月" % (first.year, first.month), prev_month=prev_month,
                  next_month=None if next_first > core.today() else next_first.strftime("%Y-%m"),
                  can_costs=can_costs, costs=costs, first=first.isoformat(), last=last.isoformat(),
                  channels=[c for c in channels if not c["archived"]])


@web.post("/data/costs")
def cost_add(request):
    if not core.sees_all():
        raise web.HTTPError(403, "成本记录只有管理员能填。")
    f = request.form
    errors = []
    spent_on = _date(f, "spent_on", errors, "日期", required=True)
    ch = f.int("channel_id")
    if not ch or not db.val("SELECT 1 FROM channels WHERE id = ?", ch):
        errors.append("请选渠道。")
    amount = core.to_number(f.get("amount").replace("元", ""))
    if amount is None or amount <= 0:
        errors.append("金额要填大于 0 的数字。")
    if errors:
        for e in errors:
            flash(e, "err")
    else:
        db.insert("costs", spent_on=spent_on, channel_id=ch, amount=amount, purpose=f.get("purpose")[:120],
                  created_by=request.user["id"], created_at=core.now_s())
        flash("已记一笔成本。")
    raise Redirect("/data/channels?month=" + (spent_on or core.today_s())[:7])


@web.post("/data/costs/<kid:int>/delete", admin=True)
def cost_delete(request, kid):
    k = db.row("SELECT spent_on FROM costs WHERE id = ?", kid)
    db.run("DELETE FROM costs WHERE id = ?", kid)
    flash("已删除这笔成本。")
    raise Redirect("/data/channels" + ("?month=" + k["spent_on"][:7] if k else ""))
