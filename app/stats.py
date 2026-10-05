# -*- coding: utf-8 -*-
"""Counting and listing logic behind the home page, the calendar and the data pages.

Definitions (same as in the source material):
  * a customer is "in follow-up" unless status is 已正式报名 / 暂不跟进 or the grade is D;
  * a student is "in delivery" unless the stage is 已完结 / 退费或转校;
  * funnel stages are counted by the date each customer first reached them.
"""
import datetime as dt

from . import consts, core, db

ACTIVE = consts.ACTIVE_SQL.format(a="c")
STU_ACTIVE = consts.STU_ACTIVE_SQL.format(s="s")
GRADE_ORDER = "CASE c.grade WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END"
CUST_COLS = ("c.*, ch.name AS channel_name, p.name AS product_name")
CUST_FROM = ("customers c LEFT JOIN channels ch ON ch.id = c.channel_id LEFT JOIN products p ON p.id = c.product_id")
STU_COLS = "s.*, c.name AS name, c.owner_id AS sales_owner_id, c.contact AS contact, p.name AS product_name"
STU_FROM = ("students s JOIN customers c ON c.id = s.customer_id LEFT JOIN products p ON p.id = s.product_id")
EXAM_COLS = ["k1_exam_on", "k2_exam_on", "k3_exam_on", "k4_exam_on"]
EXAM_NAMES = {"k1_exam_on": "科目一", "k2_exam_on": "科目二", "k3_exam_on": "科目三", "k4_exam_on": "科目四"}


# ------------------------------------------------------------------ sales follow-up
def follow_counts(mine=None):
    scope, params = core.cust_scope("c", mine)
    today = core.today_s()
    week0 = core.week_start().isoformat()
    week1 = core.add_days(week0, 6)
    r = db.row(
        "SELECT COUNT(*) AS active,"
        " SUM(c.next_follow_on = ?) AS today,"
        " SUM(c.next_follow_on < ?) AS overdue,"
        " SUM(c.next_follow_on IS NULL) AS unscheduled,"
        " SUM(c.next_follow_on BETWEEN ? AND ?) AS week,"
        " SUM(c.grade = 'A') AS grade_a"
        " FROM customers c WHERE %s AND %s" % (ACTIVE, scope),
        today, today, week0, week1, *params)
    return dict((k, r[k] or 0) for k in r.keys())


def due_customers(mine=None, limit=200):
    """Follow-ups due today or overdue: A first, then by date."""
    scope, params = core.cust_scope("c", mine)
    return db.rows(
        "SELECT %s FROM %s WHERE %s AND %s AND c.next_follow_on <= ? ORDER BY %s, c.next_follow_on, c.id LIMIT ?"
        % (CUST_COLS, CUST_FROM, ACTIVE, scope, GRADE_ORDER), *(params + [core.today_s(), limit]))


def unscheduled_customers(mine=None, limit=50):
    scope, params = core.cust_scope("c", mine)
    return db.rows(
        "SELECT %s FROM %s WHERE %s AND %s AND c.next_follow_on IS NULL ORDER BY %s, c.registered_on, c.id LIMIT ?"
        % (CUST_COLS, CUST_FROM, ACTIVE, scope, GRADE_ORDER), *(params + [limit]))


def customers_on(day, mine=None):
    scope, params = core.cust_scope("c", mine)
    return db.rows(
        "SELECT %s FROM %s WHERE %s AND %s AND c.next_follow_on = ? ORDER BY %s, c.id"
        % (CUST_COLS, CUST_FROM, ACTIVE, scope, GRADE_ORDER), *(params + [day]))


# ------------------------------------------------------------------ delivery
def active_students(mine=None):
    scope, params = core.stu_scope("s", "c", mine)
    return db.rows("SELECT %s FROM %s WHERE %s AND %s ORDER BY s.id" % (STU_COLS, STU_FROM, STU_ACTIVE, scope), *params)


def next_exam(student, today=None):
    """(date, subject) of the nearest exam that has not passed yet, or (None, None)."""
    today = today or core.today_s()
    best = (None, None)
    for col in EXAM_COLS:
        d = student[col]
        if d and d >= today and (best[0] is None or d < best[0]):
            best = (d, EXAM_NAMES[col])
    return best


def delivery_counts(mine=None):
    today = core.today_s()
    in7 = core.add_days(today, 7)
    out = {"active": 0, "due": 0, "exams7": 0, "unscheduled": 0, "docs_missing": 0, "booking": 0}
    for s in active_students(mine):
        out["active"] += 1
        if not s["next_action_on"]:
            out["unscheduled"] += 1
        elif s["next_action_on"] <= today:
            out["due"] += 1
        exam, _ = next_exam(s, today)
        if exam and exam <= in7:
            out["exams7"] += 1
        if s["docs_status"] == "缺资料":
            out["docs_missing"] += 1
        if s["k2_booking"] == "约不到":
            out["booking"] += 1
    return out


def delivery_reminders(mine=None, limit=100):
    """Students with a to-do due (or overdue) or an exam within 7 days, earliest first."""
    today = core.today_s()
    in7 = core.add_days(today, 7)
    out = []
    for s in active_students(mine):
        exam, subject = next_exam(s, today)
        todo = s["next_action_on"]
        keys = [d for d in (todo, exam) if d]
        if not keys or min(keys) > in7:
            continue
        if not ((todo and todo <= today) or (exam and exam <= in7)):
            continue
        hints = []
        if todo:
            delta = (core.to_date(todo) - core.to_date(today)).days
            if delta < 0:
                hints.append(("待办逾期 %d 天" % -delta, "over"))
            elif delta == 0:
                hints.append(("今天有待办", "today"))
        if exam and exam <= in7:
            delta = (core.to_date(exam) - core.to_date(today)).days
            hints.append(("今天考%s" % subject if delta == 0 else "%d 天后考%s" % (delta, subject),
                          "today" if delta == 0 else "soon"))
        out.append({"s": s, "key": min(keys), "exam": exam, "subject": subject, "hints": hints})
    out.sort(key=lambda x: (x["key"], x["s"]["id"]))
    return out[:limit]


def students_on(day, mine=None):
    out = []
    for s in active_students(mine):
        what = []
        if s["next_action_on"] == day:
            what.append("待办")
        for col in EXAM_COLS:
            if s[col] == day:
                what.append("考" + EXAM_NAMES[col])
        if what:
            out.append({"s": s, "what": what})
    return out


def open_issues(mine=None):
    scope, params = core.stu_scope("s", "c", mine)
    return db.val(
        "SELECT COUNT(*) FROM issues i LEFT JOIN students s ON s.id = i.student_id "
        "LEFT JOIN customers c ON c.id = s.customer_id WHERE i.status != '已关闭' AND "
        "(i.student_id IS NULL OR %s)" % scope, *params) or 0


# ------------------------------------------------------------------ calendar
def calendar(start, days, mine=None):
    """{date: {total, A, B, C, todo, exam}} for `days` days from `start` (a date)."""
    end = start + dt.timedelta(days=days - 1)
    cal = {}
    for i in range(days):
        cal[(start + dt.timedelta(days=i)).isoformat()] = {"total": 0, "A": 0, "B": 0, "C": 0, "todo": 0, "exam": 0}
    scope, params = core.cust_scope("c", mine)
    for r in db.rows(
            "SELECT c.next_follow_on AS d, c.grade AS g, COUNT(*) AS n FROM customers c "
            "WHERE %s AND %s AND c.next_follow_on BETWEEN ? AND ? GROUP BY 1, 2" % (ACTIVE, scope),
            *(params + [start.isoformat(), end.isoformat()])):
        day = cal.get(r["d"])
        if day is not None:
            day["total"] += r["n"]
            if r["g"] in ("A", "B", "C"):
                day[r["g"]] += r["n"]
    for s in active_students(mine):
        day = cal.get(s["next_action_on"] or "")
        if day is not None:
            day["todo"] += 1
        for col in EXAM_COLS:
            day = cal.get(s[col] or "")
            if day is not None:
                day["exam"] += 1
    return cal


# ------------------------------------------------------------------ funnel
MILESTONES = [("registered", "registered_on"), ("consulted", "consulted_on"), ("grade_a", "grade_a_on"),
              ("deposit", "deposit_on"), ("enrolled", "enrolled_on")]


def _range_sql(col, d0, d1):
    if d0 and d1:
        return ("%s BETWEEN ? AND ?" % col, [d0, d1])
    if d0:
        return ("%s >= ?" % col, [d0])
    if d1:
        return ("%s <= ?" % col, [d1])
    return ("%s IS NOT NULL" % col, [])


def funnel(d0=None, d1=None, mine=None):
    """Counts per funnel stage between two ISO dates (inclusive); None means unbounded."""
    scope, params = core.cust_scope("c", mine)
    out = {}
    for key, col in MILESTONES:
        cond, args = _range_sql("c." + col, d0, d1)
        out[key] = db.val("SELECT COUNT(*) FROM customers c WHERE %s AND %s" % (scope, cond), *(params + args)) or 0
    cond, args = _range_sql("day", d0, d1)
    user_cond, user_args = _stats_user(mine)
    r = db.row("SELECT SUM(exposure) AS e, SUM(wechat_adds) AS w FROM daily_stats WHERE %s AND %s" % (cond, user_cond),
               *(args + user_args))
    out["exposure"] = r["e"] or 0
    out["wechat_manual"] = r["w"] or 0
    return out


def _stats_user(mine):
    """Daily exposure figures are entered per member; pick whose to add up."""
    uid = core.web.req().user["id"]
    if mine is None:
        mine = not core.sees_all()
    if mine or not core.sees_all():
        return ("user_id = ?", [uid])
    return ("1=1", [])


def daily(days, mine=None):
    """Per-day funnel counts for a list of ISO dates (newest first or any order)."""
    if not days:
        return {}
    d0, d1 = min(days), max(days)
    table = dict((d, {"exposure": None, "wechat_manual": None, "registered": 0, "consulted": 0, "grade_a": 0,
                      "deposit": 0, "enrolled": 0}) for d in days)
    scope, params = core.cust_scope("c", mine)
    for key, col in MILESTONES:
        for r in db.rows("SELECT c.%s AS d, COUNT(*) AS n FROM customers c WHERE %s AND c.%s BETWEEN ? AND ? GROUP BY 1"
                         % (col, scope, col), *(params + [d0, d1])):
            if r["d"] in table:
                table[r["d"]][key] = r["n"]
    user_cond, user_args = _stats_user(mine)
    for r in db.rows("SELECT day, SUM(exposure) AS e, SUM(wechat_adds) AS w FROM daily_stats "
                     "WHERE day BETWEEN ? AND ? AND %s GROUP BY day" % user_cond, *([d0, d1] + user_args)):
        if r["day"] in table:
            table[r["day"]]["exposure"] = r["e"]
            table[r["day"]]["wechat_manual"] = r["w"]
    return table


def rates(f):
    """Step-to-step conversion for a funnel dict, as fractions or None."""
    order = ["exposure", "registered", "consulted", "grade_a", "deposit", "enrolled"]
    out = {}
    for prev, cur in zip(order, order[1:]):
        out[cur] = (float(f[cur]) / f[prev]) if f.get(prev) else None
    return out


# ------------------------------------------------------------------ channels
def channel_totals():
    """{channel_id: (customers registered, formally enrolled)} over all time, within the viewer's scope."""
    scope, params = core.cust_scope("c")
    out = {}
    for r in db.rows("SELECT c.channel_id AS ch, COUNT(*) AS n, SUM(c.status = '已正式报名') AS e FROM customers c "
                     "WHERE %s GROUP BY 1" % scope, *params):
        out[r["ch"]] = (r["n"], r["e"] or 0)
    return out


def channel_month(month_start, month_end, mine=None):
    """Per-channel numbers for one month: new, leads (A+B), enrolled, referrals brought (all time)."""
    scope, params = core.cust_scope("c", mine)
    out = {}

    def slot(ch):
        return out.setdefault(ch, {"new": 0, "leads": 0, "enrolled": 0, "referrals": 0, "cost": 0.0})

    for r in db.rows("SELECT c.channel_id AS ch, COUNT(*) AS n, SUM(c.grade IN ('A','B')) AS leads FROM customers c "
                     "WHERE %s AND c.registered_on BETWEEN ? AND ? GROUP BY 1" % scope,
                     *(params + [month_start, month_end])):
        s = slot(r["ch"])
        s["new"], s["leads"] = r["n"], r["leads"] or 0
    for r in db.rows("SELECT c.channel_id AS ch, COUNT(*) AS n FROM customers c "
                     "WHERE %s AND c.enrolled_on BETWEEN ? AND ? GROUP BY 1" % scope,
                     *(params + [month_start, month_end])):
        slot(r["ch"])["enrolled"] = r["n"]
    for r in db.rows("SELECT rc.channel_id AS ch, COUNT(*) AS n FROM customers c JOIN customers rc ON rc.id = c.referrer_id "
                     "WHERE %s GROUP BY 1" % scope, *params):
        slot(r["ch"])["referrals"] = r["n"]
    for r in db.rows("SELECT channel_id AS ch, SUM(amount) AS a FROM costs WHERE spent_on BETWEEN ? AND ? GROUP BY 1",
                     month_start, month_end):
        slot(r["ch"])["cost"] = r["a"] or 0.0
    return out


# ------------------------------------------------------------------ referrals
def referrers():
    scope, params = core.cust_scope("c")
    rows_ = db.rows(
        "SELECT rc.id AS id, rc.name AS name, COUNT(c.id) AS total, SUM(c.status = '已正式报名') AS enrolled,"
        " (SELECT COALESCE(SUM(amount), 0) FROM payouts p WHERE p.referrer_id = rc.id) AS paid,"
        " (SELECT MAX(paid_on) FROM payouts p WHERE p.referrer_id = rc.id) AS last_paid"
        " FROM customers c JOIN customers rc ON rc.id = c.referrer_id WHERE %s GROUP BY rc.id ORDER BY enrolled DESC, total DESC"
        % scope, *params)
    return rows_
