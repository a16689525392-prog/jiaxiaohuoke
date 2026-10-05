# -*- coding: utf-8 -*-
"""Home (today's work), the follow-up calendar and the guide page."""
import datetime as dt

from . import consts, core, db, stats, web
from .core import render


def product_pending_count(p):
    return sum(1 for key in consts.PRODUCT_KEYS if key not in consts.PRODUCT_OPTIONAL and core.is_pending(p[key]))


def setup_hints():
    """Things still missing before the system is really usable; shown on the home page."""
    hints = []
    products = db.rows("SELECT * FROM products WHERE archived = 0")
    if not products:
        hints.append(("还没有产品卡。先填第 1 个班型：费用包含什么、不包含什么、钱交给谁、退费转校怎么办。", "/products/new", "去填产品卡"))
    else:
        worst = max(products, key=product_pending_count)
        n = product_pending_count(worst)
        if n:
            hints.append(("产品卡“%s”还有 %d 项没核实。对着合作协议和合同核实后再报价。" % (worst["name"] or "未命名", n),
                          "/products/%d/edit" % worst["id"], "去核实"))
    if not core.setting("unified_entry"):
        hints.append(("还没填统一入口。每个渠道都用同一个企业微信或工作微信。", "/channels", "去填"))
    if db.val("SELECT COUNT(*) FROM customers") == 0:
        hints.append(("还没有客户。把手上已有的意向客户登记进来，每个人都写上下次跟进时间。", "/customers/new", "登记第一个客户"))
    if not core.setting("reward_desc"):
        hints.append(("转介绍的公开规则还没写：奖励是什么、什么时候发、什么情况不算。", "/referrals", "去写规则"))
    return hints


@web.get("/")
def home(request):
    mine = core.want_mine()
    return render(
        "home.tpl", title="今日", active="today", mine=mine, can_all=core.sees_all(),
        fc=stats.follow_counts(mine), dc=stats.delivery_counts(mine), issues=stats.open_issues(mine),
        due=stats.due_customers(mine, 100), unscheduled=stats.unscheduled_customers(mine, 20),
        reminders=stats.delivery_reminders(mine, 50), hints=setup_hints() if core.is_admin() else [],
        weekday=core.WEEKDAYS[core.today().weekday()])


@web.get("/calendar")
def calendar(request):
    mine = core.want_mine()
    offset = request.query.int("w", 0) or 0
    offset = max(-520, min(520, offset))
    start = core.week_start() + dt.timedelta(days=7 * offset)
    cal = stats.calendar(start, 42, mine)
    try:
        picked = core.parse_date(request.query.get("d")) or core.today_s()
    except ValueError:
        picked = core.today_s()
    weeks = []
    for w in range(6):
        row = []
        for d in range(7):
            day = (start + dt.timedelta(days=7 * w + d)).isoformat()
            row.append((day, cal[day]))
        weeks.append(row)
    return render(
        "calendar.tpl", title="跟进日历", active="calendar", mine=mine, can_all=core.sees_all(), weeks=weeks,
        offset=offset, picked=picked, customers=stats.customers_on(picked, mine),
        students=stats.students_on(picked, mine), fc=stats.follow_counts(mine), dc=stats.delivery_counts(mine),
        first=start.isoformat(), last=(start + dt.timedelta(days=41)).isoformat())


@web.get("/guide")
def guide(request):
    start = core.setting("start_date") or core.today_s()
    try:
        s = core.to_date(start)
    except ValueError:
        s = core.today()
    base = max(s, core.today())            # the routines repeat, so show when each one comes round next
    next_sunday = base + dt.timedelta(days=(6 - base.weekday()) % 7)
    next_month = base if base.day == 1 else (base.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
    plan = [
        ("第 1 天", s, "产品卡填第 1 个班型；已有的意向客户登记进系统，分级并排好下次跟进时间。", [("产品卡", "/products"), ("客户", "/customers")]),
        ("第 1 周内", s + dt.timedelta(days=6), "对着合作协议和合同核验产品卡：报名主体、收款主体、合同盖什么章、退费转校、售后联系人。", [("产品卡", "/products")]),
        ("第 1 周内", s + dt.timedelta(days=6), "把统一话术里的【】换成自己的信息，全团队用同一套说法。", [("统一话术", "/scripts")]),
        ("第 2 周内", s + dt.timedelta(days=13), "定统一入口和渠道码；备好首批内容和摆点物料；写好转介绍的公开规则。", [("获客渠道", "/channels"), ("转介绍", "/referrals")]),
        ("第 3 周内", s + dt.timedelta(days=20), "把登记和接待流程跑一遍：找两三个熟人，完整走一次“登记 → 分级 → 跟进 → 四项核对”。", [("客户", "/customers"), ("跟进日历", "/calendar")]),
        ("第 4 周起", s + dt.timedelta(days=21), "正式招生：有人加微信就登记，每次沟通后写下次跟进时间，每天收工前看一眼数据。", [("今日", "/"), ("数据复盘", "/data")]),
        ("每周日", next_sunday, "周复盘：三类案例各一个，只改一句话术、调一个渠道。", [("周复盘", "/data/weekly")]),
        ("每月初", next_month, "比较各渠道的有效线索、报名人数、实际成本和后续转介绍。", [("渠道对比", "/data/channels")]),
    ]
    return render("guide.tpl", title="开始与红线", active="guide", plan=plan, start=s.isoformat(), repeating=("每周日", "每月初"),
                  red_lines=consts.RED_LINES, hints=setup_hints() if core.is_admin() else [])
