# -*- coding: utf-8 -*-
"""Customers: registration, grading, follow-up log, and the pre-payment check that leads to enrolment."""
import sqlite3

from . import consts, core, db, stats, web
from .core import render
from .web import Redirect, flash

ACTIVE = stats.ACTIVE
NEED_DATE = "还在跟进的客户必须写下次跟进时间。没有时间点的跟进，最后会变成谁都以为别人会跟。"


def is_active(grade, status):
    return status not in consts.CLOSED_STATUSES and grade != "D"


def get_customer(cid):
    """Load a customer the current user is allowed to see, or 404."""
    scope, params = core.cust_scope("c")
    c = db.row("SELECT %s FROM %s WHERE c.id = ? AND %s" % (stats.CUST_COLS, stats.CUST_FROM, scope), cid, *params)
    if not c:
        raise web.HTTPError(404)
    return c


def channels(keep=None, retired=False):
    """Channels offered in forms: the ones in use, plus the one a record already has (even if retired)."""
    if retired:
        return db.rows("SELECT id, name, archived FROM channels ORDER BY archived, sort, id")
    return db.rows("SELECT id, name, archived FROM channels WHERE archived = 0 OR id = ? ORDER BY sort, id", keep or 0)


def products(keep=None):
    return db.rows("SELECT id, name, vehicle, archived FROM products WHERE archived = 0 OR id = ? ORDER BY sort, id",
                   keep or 0)


def referrer_options(current=None, exclude=None):
    scope, params = core.cust_scope("c")
    return db.rows(
        "SELECT c.id, c.name, c.status FROM customers c WHERE %s AND c.id != ? AND (c.status = '已正式报名' "
        "OR c.id = ? OR c.id IN (SELECT referrer_id FROM customers WHERE referrer_id IS NOT NULL)) "
        "ORDER BY c.name, c.id" % scope, *(params + [exclude or 0, current or 0]))


def milestone_updates(current, grade, status, on):
    """Dates on which a customer first reached each funnel stage."""
    upd = {}
    if status in consts.CONSULTED and not current.get("consulted_on"):
        upd["consulted_on"] = on
    if grade == "A" and not current.get("grade_a_on"):
        upd["grade_a_on"] = on
    return upd


def _date(f, key, errors, label, required=False):
    try:
        value = core.parse_date(f.get(key))
    except ValueError:
        errors.append("%s的日期格式不对。" % label)
        return None
    if required and not value:
        errors.append("请填%s。" % label)
    return value


def _choice(f, key, options, default=""):
    v = f.get(key)
    return v if v in options else default


def _owner(f, default):
    """Who is responsible: the person picked in the form, or `default` (the current owner).

    Members restricted to their own records get no choice, so they can neither hand a record to someone
    else nor take one over just by saving a page.
    """
    if not core.sees_all():
        return default
    uid = f.int("owner_id")
    if uid and any(u["id"] == uid for u in core.active_users()):
        return uid
    return default


# ------------------------------------------------------------------ list
@web.get("/customers")
def customer_list(request):
    q = request.query
    where, params = [], []
    scope, sparams = core.cust_scope("c")
    where.append(scope)
    params += sparams
    owner = ""
    if core.sees_all():
        owner_id = q.int("owner")
        if owner_id is None and "owner" not in q and core.want_mine():
            owner_id = request.user["id"]
        if owner_id is not None:
            owner = str(owner_id)
            where.append("c.owner_id = ?")
            params.append(owner_id)
    text = q.get("q")
    if text:
        like = "%" + text.replace("%", "").replace("_", "") + "%"
        where.append("(c.name LIKE ? OR c.contact LIKE ? OR c.school LIKE ? OR c.notes LIKE ?)")
        params += [like, like, like, like]
    grade = q.get("grade")
    if grade in consts.GRADES:
        where.append("c.grade = ?")
        params.append(grade)
    elif grade == "none":
        where.append("c.grade = ''")
    status = q.get("status")
    if status in consts.STATUSES:
        where.append("c.status = ?")
        params.append(status)
    channel = q.int("channel")
    if channel:
        where.append("c.channel_id = ?")
        params.append(channel)
    follow = q.get("follow")
    today = core.today_s()
    if follow == "today":
        where.append(ACTIVE + " AND c.next_follow_on = ?")
        params.append(today)
    elif follow == "overdue":
        where.append(ACTIVE + " AND c.next_follow_on < ?")
        params.append(today)
    elif follow == "none":
        where.append(ACTIVE + " AND c.next_follow_on IS NULL")
    elif follow == "active":
        where.append(ACTIVE)
    elif follow == "closed":
        where.append("NOT " + ACTIVE)
    cond = " AND ".join(where)
    total = db.val("SELECT COUNT(*) FROM customers c WHERE " + cond, *params)
    pg = core.paginate(total)
    items = db.rows(
        "SELECT %s, %s AS is_active FROM %s WHERE %s ORDER BY is_active DESC, (c.next_follow_on IS NULL) DESC, "
        "c.next_follow_on, c.id DESC LIMIT ? OFFSET ?" % (stats.CUST_COLS, ACTIVE, stats.CUST_FROM, cond),
        *(params + [pg["per_page"], pg["offset"]]))
    return render("customers.tpl", title="客户", active="customers", items=items, pg=pg, q=q, owner=owner,
                  channels=channels(retired=True), users=core.active_users(), can_all=core.sees_all(),
                  grades=consts.GRADES, statuses=consts.STATUSES)


# ------------------------------------------------------------------ create / edit
def _read_profile(f, errors):
    v = {
        "name": f.get("name"), "contact": f.get("contact"), "school": f.get("school"),
        "vehicle": _choice(f, "vehicle", consts.VEHICLES), "plan": _choice(f, "plan", consts.PLANS),
        "slots": f.get("slots"), "budget": f.get("budget"), "concern": f.get("concern")[:20],
        "remark": f.text("remark"),
    }
    if not v["name"]:
        errors.append("请填称呼。")
    elif len(v["name"]) > 40:
        errors.append("称呼太长了（最多 40 个字）。")
    ch = f.int("channel_id")
    if ch and db.val("SELECT 1 FROM channels WHERE id = ?", ch):
        v["channel_id"] = ch
    else:
        v["channel_id"] = None
        errors.append("请选来源渠道。记录客户从哪里来，后面才知道哪个渠道有效。")
    pid = f.int("product_id")
    v["product_id"] = pid if pid and db.val("SELECT 1 FROM products WHERE id = ?", pid) else None
    v["registered_on"] = _date(f, "registered_on", errors, "登记日期") or core.today_s()
    if v["registered_on"] > core.today_s():
        errors.append("登记日期不能晚于今天。")
    return v


def _read_referrer(f, self_id=None):
    rid = f.int("referrer_id")
    if not rid or rid == self_id:
        return None
    scope, params = core.cust_scope("c")
    return rid if db.val("SELECT 1 FROM customers c WHERE c.id = ? AND %s" % scope, rid, *params) else None


@web.both("/customers/new")
def customer_new(request):
    f = request.form
    errors = []
    if request.method == "POST":
        v = _read_profile(f, errors)
        grade = _choice(f, "grade", consts.GRADES)
        status = _choice(f, "status", consts.OPEN_STATUSES + ["暂不跟进"], "新加微信")
        next_on = _date(f, "next_follow_on", errors, "下次跟进时间")
        if is_active(grade, status):
            if not next_on:
                errors.append(NEED_DATE)
            elif next_on < core.today_s():
                errors.append("下次跟进时间不能早于今天。")
        if not errors:
            now = core.now_s()
            v.update(grade=grade, status=status, next_follow_on=next_on, next_action=f.get("next_action"),
                     notes=f.text("notes"), owner_id=_owner(f, request.user["id"]), referrer_id=_read_referrer(f),
                     created_by=request.user["id"], created_at=now, updated_at=now)
            if v["notes"]:
                v["last_contact_on"] = v["registered_on"]
            v.update(milestone_updates({}, grade, status, v["registered_on"]))
            cid = db.insert("customers", **v)
            db.insert("followups", customer_id=cid, at=now, user_id=request.user["id"], kind="create",
                      summary=v["notes"] or "登记客户。", next_action=v["next_action"], next_follow_on=next_on,
                      grade=grade, status=status)
            flash("已登记 %s。" % v["name"])
            raise Redirect("/customers/new" if f.get("again") else "/customers/%d" % cid)
    return render("customer_form.tpl", title="登记客户", active="customers", f=f, c=None, errors=errors,
                  channels=channels(), products=products(), users=core.active_users(), can_all=core.sees_all(),
                  referrers=referrer_options(), consts=consts, posted=request.method == "POST")


@web.both("/customers/<cid:int>/edit")
def customer_edit(request, cid):
    c = get_customer(cid)
    f = request.form
    errors = []
    if request.method == "POST":
        v = _read_profile(f, errors)
        if not errors:
            v.update(owner_id=_owner(f, c["owner_id"]), referrer_id=_read_referrer(f, cid), updated_at=core.now_s())
            db.update("customers", cid, **v)
            if v["owner_id"] != c["owner_id"]:
                db.insert("followups", customer_id=cid, at=core.now_s(), user_id=request.user["id"], kind="update",
                          summary="负责人由 %s 改为 %s。" % (core.user_name(c["owner_id"]) or "未指定",
                                                       core.user_name(v["owner_id"]) or "未指定"),
                          next_action=c["next_action"], next_follow_on=c["next_follow_on"], grade=c["grade"],
                          status=c["status"])
            flash("资料已保存。")
            raise Redirect("/customers/%d" % cid)
    return render("customer_form.tpl", title="编辑 " + c["name"], active="customers", f=f, c=c, errors=errors,
                  channels=channels(c["channel_id"]), products=products(c["product_id"]),
                  users=core.owner_choices(c["owner_id"]), can_all=core.sees_all(),
                  referrers=referrer_options(c["referrer_id"], cid), consts=consts, posted=request.method == "POST")


# ------------------------------------------------------------------ detail and follow-up
@web.get("/customers/<cid:int>")
def customer_detail(request, cid):
    return _detail(cid, request.form, [])


def _detail(cid, f, errors):
    c = get_customer(cid)
    log = db.rows("SELECT * FROM followups WHERE customer_id = ? ORDER BY at DESC, id DESC", cid)
    student = db.row("SELECT * FROM students WHERE customer_id = ?", cid)
    referrer = db.row("SELECT id, name FROM customers WHERE id = ?", c["referrer_id"]) if c["referrer_id"] else None
    referred = db.rows("SELECT id, name, status FROM customers WHERE referrer_id = ? ORDER BY id", cid)
    product = db.row("SELECT * FROM products WHERE id = ?", c["product_id"]) if c["product_id"] else None
    quote = ""
    if product:
        from . import v_scripts
        quote = v_scripts.quote_for(product)
    return render("customer.tpl", title=c["name"], active="customers", c=c, log=log, student=student, f=f,
                  errors=errors, referrer=referrer, referred=referred, product=product, quote=quote, consts=consts,
                  active_now=is_active(c["grade"], c["status"]), can_delete=_can_delete(c, student))


def _can_delete(c, student):
    if student:
        return False
    return core.is_admin() or c["owner_id"] == web.req().user["id"]


@web.post("/customers/<cid:int>/follow")
def customer_follow(request, cid):
    c = get_customer(cid)
    f = request.form
    errors = []
    locked = c["status"] in ("已正式报名", "已交定金")   # these two are only set by the enrolment page
    grade = _choice(f, "grade", consts.GRADES, c["grade"] if "grade" not in f else "")
    if locked:
        status = c["status"]
        if f.get("status") == "暂不跟进" and c["status"] == "已交定金":
            status = "暂不跟进"
    else:
        status = _choice(f, "status", consts.OPEN_STATUSES + ["暂不跟进"], c["status"])
    summary = f.text("summary")
    next_action = f.get("next_action")
    next_on = _date(f, "next_follow_on", errors, "下次跟进时间")
    contact_on = _date(f, "contact_on", errors, "沟通日期") or core.today_s()
    if contact_on > core.today_s():
        errors.append("沟通日期不能晚于今天。")
    if is_active(grade, status):
        if not next_on:
            errors.append(NEED_DATE)
        elif next_on < core.today_s():
            errors.append("下次跟进时间不能早于今天。")
    if not summary and grade == c["grade"] and status == c["status"] and next_on == c["next_follow_on"] \
            and next_action == c["next_action"]:
        errors.append("没有任何改动。写一下这次沟通的要点，或者调整分级、状态、下次跟进时间。")
    if errors:
        return _detail(cid, f, errors)
    changes = []
    if grade != c["grade"]:
        changes.append("分级 %s → %s" % (c["grade"] or "未分级", grade or "未分级"))
    if status != c["status"]:
        changes.append("状态 %s → %s" % (c["status"], status))
    upd = {"grade": grade, "status": status, "next_action": next_action, "next_follow_on": next_on,
           "updated_at": core.now_s()}
    if summary:
        upd["notes"] = summary
        upd["last_contact_on"] = contact_on
    upd.update(milestone_updates(dict(c), grade, status, contact_on))
    db.update("customers", cid, **upd)
    text = summary or ("调整：" + "；".join(changes) if changes else "调整了下一步动作或跟进时间。")
    if summary and changes:
        text += "\n（" + "；".join(changes) + "）"
    db.insert("followups", customer_id=cid, at=core.now_s(), user_id=request.user["id"],
              kind="note" if summary else "update", summary=text, next_action=next_action, next_follow_on=next_on,
              grade=grade, status=status)
    flash("已记录。" + ("下次跟进：%s。" % core.fmt_mdw(next_on) if next_on and is_active(grade, status) else ""))
    raise Redirect(core.back("/customers/%d" % cid))


@web.post("/customers/<cid:int>/delete")
def customer_delete(request, cid):
    c = get_customer(cid)
    student = db.row("SELECT id FROM students WHERE customer_id = ?", cid)
    if not _can_delete(c, student):
        raise web.HTTPError(403, "已报名的学员不能删除；其他客户只有管理员或负责人可以删除。")
    if db.val("SELECT 1 FROM payouts WHERE referrer_id = ?", cid):
        raise web.HTTPError(403, "这位客户有转介绍奖励发放记录，不能删除。")
    db.run("UPDATE customers SET referrer_id = NULL WHERE referrer_id = ?", cid)
    db.run("DELETE FROM customers WHERE id = ?", cid)
    flash("已删除 %s。" % c["name"])
    raise Redirect("/customers")


# ------------------------------------------------------------------ pre-payment check, deposit, enrolment
@web.both("/customers/<cid:int>/enroll")
def customer_enroll(request, cid):
    c = get_customer(cid)
    student = db.row("SELECT id FROM students WHERE customer_id = ?", cid)
    if student:
        raise Redirect("/students/%d" % student["id"])
    f = request.form
    errors = []
    plist = db.rows("SELECT * FROM products WHERE archived = 0 ORDER BY sort, id")
    pid = (f.int("product_id") if request.method == "POST" else request.query.int("product")) or c["product_id"]
    product = None
    for p in plist:
        if p["id"] == pid:
            product = p
    if product is None and plist:
        product = plist[0]
    if request.method == "POST":
        action = _choice(f, "action", ["deposit", "enroll"])
        if not action:
            errors.append("请选这次是收定金，还是正式报名。")
        if not product:
            errors.append("还没有产品卡，先去填一个班型。")
        missing = [label for key, label, _ in consts.FOUR_CHECKS if f.get("chk_" + key) != "1"]
        if missing:
            errors.append("付款前四项核对还没做完：" + "、".join(missing) + "。四项都和客户对上了再收款。")
        on = _date(f, "on", errors, "日期") or core.today_s()
        if on > core.today_s():
            errors.append("日期不能晚于今天。")
        prefix = "stu_" if action == "enroll" else "dep_"
        next_on = _date(f, prefix + "next_on", errors, "下次日期")
        next_action = f.get(prefix + "next_action")
        if action == "deposit":
            if not next_on:
                errors.append("收了定金还没正式报名，必须写下次跟进时间。")
            elif next_on < core.today_s():
                errors.append("下次跟进时间不能早于今天。")
        elif action == "enroll":
            if f.get("contract") != "1" or f.get("receipt") != "1":
                errors.append("正式报名要先签合同、开具付款凭证。钱、合同、资料、负责人要能一一对应。")
            if not next_on:
                errors.append("请写交付的下次动作日期，比如今天发资料清单。")
            elif next_on < core.today_s():
                errors.append("交付的下次动作日期不能早于今天。")
        if not errors:
            now = core.now_s()
            uid = request.user["id"]
            cur = dict(c)
            upd = {"product_id": product["id"], "updated_at": now, "last_contact_on": on,
                   "chk4_on": cur["chk4_on"] or on, "deposit_on": cur["deposit_on"] or on,
                   "consulted_on": cur["consulted_on"] or on, "grade_a_on": cur["grade_a_on"] or on}
            if c["grade"] != "A":
                upd["grade"] = "A"   # someone who pays has, by definition, confirmed the details
            if action == "deposit":
                upd.update(status="已交定金", next_action=next_action, next_follow_on=next_on)
                db.update("customers", cid, **upd)
                db.insert("followups", customer_id=cid, at=now, user_id=uid, kind="deposit",
                          summary="已和客户完成付款前四项核对，按正规流程收定金并开具凭证。班型：%s。" % (product["name"] or "未命名"),
                          next_action=next_action, next_follow_on=next_on, grade="A", status="已交定金")
                flash("已记录定金。下次跟进：%s。" % core.fmt_mdw(next_on))
                raise Redirect("/customers/%d" % cid)
            upd.update(status="已正式报名", enrolled_on=on, next_action="", next_follow_on=None)
            db.update("customers", cid, **upd)
            try:
                sid = db.insert("students", customer_id=cid, product_id=product["id"], owner_id=_owner(f, uid),
                                enrolled_on=on, stage="资料准备",
                                next_action=next_action or "发资料清单，确认身份证明、照片和体检",
                                next_action_on=next_on, created_at=now, updated_at=now)
            except sqlite3.IntegrityError:
                # the same enrolment arrived twice at the same moment (a double click): the other one has it
                db.conn().rollback()
                other = db.row("SELECT id FROM students WHERE customer_id = ?", cid)
                raise Redirect("/students/%d" % other["id"] if other else "/customers/%d" % cid)
            done = ["e1", "e2", "e3", "e4", "e5"]
            if f.get("doclist") == "1":
                done.append("e6")
            if f.get("told_owner") == "1":
                done.append("h1")
            for key in done:
                db.insert("student_checks", student_id=sid, key=key, done_at=now, done_by=uid)
            db.insert("followups", customer_id=cid, at=now, user_id=uid, kind="enroll",
                      summary="已和客户完成付款前四项核对，签合同并开具凭证，正式报名。班型：%s。" % (product["name"] or "未命名"),
                      grade="A", status="已正式报名")
            flash("%s 已正式报名，转入交付。按节点往下做。" % c["name"])
            raise Redirect("/students/%d" % sid)
    from .v_home import product_pending_count
    return render("enroll.tpl", title="报名确认 · " + c["name"], active="customers", c=c, f=f, errors=errors,
                  products=plist, product=product, consts=consts, users=core.active_users(), can_all=core.sees_all(),
                  pending=product_pending_count(product) if product else 0, posted=request.method == "POST")
