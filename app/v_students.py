# -*- coding: utf-8 -*-
"""Delivery: the per-student checklist, exam tracking, and the issue log (异常台账)."""
from . import consts, core, db, stats, web
from .core import render
from .v_customers import _choice, _date, _owner
from .web import Redirect, flash

STAGE_BLOCK = {"资料准备": "handover", "科目一": "k1", "科目二": "k2", "科目三": "k3", "科目四": "k4",
               "已拿证待回访": "k4", "已完结": "ref", "退费或转校": ""}
NEED_DATE = "交付中的学员必须写下次动作日期，别让学员卡在你以为已经结束的环节里。"


def get_student(sid):
    scope, params = core.stu_scope("s", "c")
    s = db.row("SELECT %s FROM %s WHERE s.id = ? AND %s" % (stats.STU_COLS, stats.STU_FROM, scope), sid, *params)
    if not s:
        raise web.HTTPError(404)
    return s


def advance(stage, v, checks):
    """Move to the next stage automatically when the current one is finished."""
    while True:
        nxt = None
        if stage == "资料准备" and v["docs_status"] == "齐全":
            nxt = "科目一"
        elif stage == "科目一" and v["k1_result"] == "通过":
            nxt = "科目二"
        elif stage == "科目二" and v["k2_result"] == "通过":
            nxt = "科目三"
        elif stage == "科目三" and v["k3_result"] == "通过":
            nxt = "科目四"
        elif stage == "科目四" and v["k4_result"] == "通过":
            nxt = "已拿证待回访"
        elif stage == "已拿证待回访" and v["license_on"] and "k4c" in checks:
            nxt = "已完结"
        if not nxt:
            return stage
        stage = nxt


# ------------------------------------------------------------------ list
@web.get("/students")
def student_list(request):
    q = request.query
    where, params = [], []
    scope, sparams = core.stu_scope("s", "c")
    where.append(scope)
    params += sparams
    owner = ""
    if core.sees_all():
        owner_id = q.int("owner")
        if owner_id is None and "owner" not in q and core.want_mine():
            owner_id = request.user["id"]
        if owner_id is not None:
            owner = str(owner_id)
            where.append("(s.owner_id = ? OR c.owner_id = ?)")
            params += [owner_id, owner_id]
    text = q.get("q")
    if text:
        like = "%" + text.replace("%", "").replace("_", "") + "%"
        where.append("(c.name LIKE ? OR c.contact LIKE ?)")
        params += [like, like]
    stage = q.get("stage")
    if stage in consts.STAGES:
        where.append("s.stage = ?")
        params.append(stage)
    elif stage != "all":
        where.append(stats.STU_ACTIVE)
    rows_ = db.rows(
        "SELECT %s, (SELECT COUNT(*) FROM issues i WHERE i.student_id = s.id AND i.status != '已关闭') AS open_issues "
        "FROM %s WHERE %s ORDER BY (s.next_action_on IS NULL) DESC, s.next_action_on, s.id DESC"
        % (stats.STU_COLS, stats.STU_FROM, " AND ".join(where)), *params)
    today = core.today_s()
    in7 = core.add_days(today, 7)
    flag = q.get("flag")
    items = []
    for s in rows_:
        exam, subject = stats.next_exam(s, today)
        is_active = s["stage"] not in consts.DONE_STAGES
        info = {"s": s, "exam": exam, "subject": subject, "active": is_active,
                "exam_soon": bool(exam and exam <= in7)}
        if flag == "due" and not (is_active and s["next_action_on"] and s["next_action_on"] <= today):
            continue
        if flag == "exam" and not (is_active and info["exam_soon"]):
            continue
        if flag == "none" and not (is_active and not s["next_action_on"]):
            continue
        if flag == "docs" and s["docs_status"] != "缺资料":
            continue
        if flag == "booking" and s["k2_booking"] != "约不到":
            continue
        items.append(info)
    return render("students.tpl", title="学员交付", active="students", items=items, q=q, owner=owner,
                  users=core.active_users(), can_all=core.sees_all(), stages=consts.STAGES)


# ------------------------------------------------------------------ detail
def _page(sid, f, errors):
    s = get_student(sid)
    done = dict((r["key"], r) for r in db.rows("SELECT * FROM student_checks WHERE student_id = ?", sid))
    issues = db.rows("SELECT * FROM issues WHERE student_id = ? ORDER BY (status = '已关闭'), occurred_on DESC, id DESC", sid)
    product = db.row("SELECT * FROM products WHERE id = ?", s["product_id"]) if s["product_id"] else None
    exam, subject = stats.next_exam(s)
    return render("student.tpl", title=s["name"], active="students", s=s, f=f, errors=errors, done=done,
                  issues=issues, product=product, checklist=consts.CHECKLIST, consts=consts,
                  users=core.owner_choices(s["owner_id"]), can_all=core.sees_all(),
                  current=STAGE_BLOCK.get(s["stage"], ""),
                  exam=exam, subject=subject, posted=bool(errors),
                  open_issue=any(i["status"] != "已关闭" for i in issues))


@web.get("/students/<sid:int>")
def student_detail(request, sid):
    return _page(sid, request.form, [])


@web.post("/students/<sid:int>")
def student_save(request, sid):
    s = get_student(sid)
    f = request.form
    errors = []
    v = {
        "next_action": f.get("next_action"),
        "next_action_on": _date(f, "next_action_on", errors, "下次动作日期"),
        "docs_status": _choice(f, "docs_status", ["齐全", "缺资料"]),
        "docs_missing": f.get("docs_missing"),
        "k1_exam_on": _date(f, "k1_exam_on", errors, "科目一考试日期"),
        "k1_result": _choice(f, "k1_result", consts.RESULTS),
        "k2_booking": _choice(f, "k2_booking", ["正常", "约不到"]),
        "k2_exam_on": _date(f, "k2_exam_on", errors, "科目二考试日期"),
        "k2_result": _choice(f, "k2_result", consts.RESULTS),
        "k3_exam_on": _date(f, "k3_exam_on", errors, "科目三考试日期"),
        "k3_result": _choice(f, "k3_result", consts.RESULTS),
        "k4_exam_on": _date(f, "k4_exam_on", errors, "科目四考试日期"),
        "k4_result": _choice(f, "k4_result", consts.RESULTS),
        "license_on": _date(f, "license_on", errors, "拿证日期"),
        "visit_smooth": f.text("visit_smooth"), "visit_hard": f.text("visit_hard"),
        "visit_worry": f.text("visit_worry"),
        "refer_willing": _choice(f, "refer_willing", ["愿意", "待定", "不愿意"]),
        "remark": f.text("remark"),
        "owner_id": _owner(f, s["owner_id"]),
        "updated_at": core.now_s(),
    }
    if v["docs_status"] == "齐全":
        v["docs_missing"] = ""
    checks = set(f.getlist("checks")) & set(consts.CHECK_KEYS)
    stage_in = _choice(f, "stage", consts.STAGES, s["stage"])
    stage = stage_in
    if stage_in == s["stage"]:           # not changed by hand: let finished stages roll forward
        stage = advance(stage_in, v, checks)
    v["stage"] = stage
    if stage not in consts.DONE_STAGES:
        if not v["next_action_on"]:
            errors.append(NEED_DATE)
        elif v["next_action_on"] < core.today_s():
            errors.append("下次动作日期已经过了。做完了就写下一步，改成今天或之后的日期。")
    if v["license_on"] and v["license_on"] > core.today_s():
        errors.append("拿证日期不能晚于今天。")
    if errors:
        return _page(sid, f, errors)
    db.update("students", sid, **v)
    have = set(r["key"] for r in db.rows("SELECT key FROM student_checks WHERE student_id = ?", sid))
    now = core.now_s()
    for key in checks - have:
        db.insert("student_checks", student_id=sid, key=key, done_at=now, done_by=request.user["id"])
    for key in have - checks:
        db.run("DELETE FROM student_checks WHERE student_id = ? AND key = ?", sid, key)
    msg = "已保存。"
    if stage != s["stage"]:
        msg += "阶段：%s → %s。" % (s["stage"], stage)
    flash(msg)
    failed = [n for n, k in (("科目一", "k1_result"), ("科目二", "k2_result"), ("科目三", "k3_result"), ("科目四", "k4_result"))
              if v[k] == "未通过" and s[k] != "未通过"]
    if failed:
        flash("%s没通过：和学员约好补考安排，更新考试日期和下次动作。" % "、".join(failed), "warn")
    if v["k2_booking"] == "约不到" and not db.val(
            "SELECT 1 FROM issues WHERE student_id = ? AND status != '已关闭'", sid):
        flash("约不到车要记进异常台账：发生时间、联系了谁、预计什么时候解决。", "warn")
    raise Redirect("/students/%d" % sid)


# ------------------------------------------------------------------ issues
def issue_status(solved_on, revisit_ok):
    if solved_on and revisit_ok:
        return "已关闭"
    if solved_on:
        return "已解决待回访"
    return "处理中"


def _visible_students(include_id=None):
    scope, params = core.stu_scope("s", "c")
    return db.rows(
        "SELECT s.id, c.name, s.stage FROM students s JOIN customers c ON c.id = s.customer_id "
        "WHERE %s AND (%s OR s.id = ?) ORDER BY c.name" % (scope, stats.STU_ACTIVE), *(params + [include_id or 0]))


def _get_issue(iid):
    scope, params = core.stu_scope("s", "c")
    i = db.row(
        "SELECT i.*, c.name AS student_name FROM issues i LEFT JOIN students s ON s.id = i.student_id "
        "LEFT JOIN customers c ON c.id = s.customer_id WHERE i.id = ? AND (i.student_id IS NULL OR %s)" % scope,
        iid, *params)
    if not i:
        raise web.HTTPError(404)
    return i


@web.get("/issues")
def issue_list(request):
    show = request.query.get("show")
    scope, params = core.stu_scope("s", "c")
    cond = "(i.student_id IS NULL OR %s)" % scope
    if show != "all":
        cond += " AND i.status != '已关闭'"
    items = db.rows(
        "SELECT i.*, c.name AS student_name FROM issues i LEFT JOIN students s ON s.id = i.student_id "
        "LEFT JOIN customers c ON c.id = s.customer_id WHERE %s ORDER BY (i.status = '已关闭'), i.occurred_on DESC, i.id DESC"
        % cond, *params)
    return render("issues.tpl", title="异常台账", active="issues", items=items, show=show,
                  open_count=stats.open_issues())


def _issue_form(request, issue):
    f = request.form
    errors = []
    preset = request.query.int("student")
    if request.method == "POST":
        sid = f.int("student_id")
        if sid:
            get_student(sid)   # 404 if the student is not visible to this user
        v = {
            "student_id": sid or None,
            "occurred_on": _date(f, "occurred_on", errors, "发生日期", required=True),
            "stage": _choice(f, "stage", consts.ISSUE_STAGES),
            "kind": f.get("kind")[:20],
            "description": f.text("description"),
            "contacted": f.get("contacted"),
            "eta_on": _date(f, "eta_on", errors, "预计解决时间"),
            "solved_on": _date(f, "solved_on", errors, "实际解决日期"),
            "revisit_ok": 1 if f.get("revisit_ok") == "1" else 0,
            "owner_id": _owner(f, issue["owner_id"] if issue else request.user["id"]),
            "remark": f.text("remark"),
            "updated_at": core.now_s(),
        }
        today = core.today_s()
        if not v["description"]:
            errors.append("请写问题描述。")
        if v["occurred_on"] and v["occurred_on"] > today:
            errors.append("发生日期不能晚于今天。")
        if v["solved_on"] and v["solved_on"] > today:
            errors.append("实际解决日期不能晚于今天。")
        if not v["solved_on"]:
            if not v["contacted"]:
                errors.append("请写联系了谁。不能只回一句“我帮你问问”。")
            if not v["eta_on"]:
                errors.append("请写预计什么时候解决，学员需要一个明确的答复时间。")
            if v["revisit_ok"]:
                errors.append("还没填实际解决日期，不能先勾“已回访确认”。")
        v["status"] = issue_status(v["solved_on"], v["revisit_ok"])
        if not errors:
            if issue:
                db.update("issues", issue["id"], **v)
            else:
                v.update(created_by=request.user["id"], created_at=core.now_s())
                db.insert("issues", **v)
            if v["status"] == "已解决待回访":
                flash("已保存。问题解决以后还要回访一次，确认学员那边真的没问题了，才算关闭。", "warn")
            else:
                flash("已保存，状态：%s。" % v["status"])
            raise Redirect(core.back("/issues"))
    return render("issue_form.tpl", title="异常记录", active="issues", issue=issue, f=f, errors=errors,
                  students=_visible_students(issue["student_id"] if issue else preset), preset=preset,
                  consts=consts, users=core.owner_choices(issue["owner_id"] if issue else None),
                  can_all=core.sees_all(), posted=request.method == "POST",
                  next=core.safe_path(request.query.get("next") or f.get("next")))


@web.both("/issues/new")
def issue_new(request):
    return _issue_form(request, None)


@web.both("/issues/<iid:int>/edit")
def issue_edit(request, iid):
    return _issue_form(request, _get_issue(iid))


@web.post("/issues/<iid:int>/delete", admin=True)
def issue_delete(request, iid):
    db.run("DELETE FROM issues WHERE id = ?", iid)
    flash("已删除这条异常记录。")
    raise Redirect("/issues")
