# -*- coding: utf-8 -*-
"""Administration: member accounts, system settings, exports and backups."""
import logging
import os
import re

from . import auth, backup, consts, core, db, stats, web
from .core import render
from .web import Redirect, flash

log = logging.getLogger("jiaxiao")


# ------------------------------------------------------------------ members
@web.get("/admin/users", admin=True)
def user_list(request):
    users = db.rows(
        "SELECT u.*, (SELECT COUNT(*) FROM customers c WHERE c.owner_id = u.id) AS customers, "
        "(SELECT COUNT(*) FROM students s WHERE s.owner_id = u.id) AS students FROM users u ORDER BY u.active DESC, u.id")
    return render("admin_users.tpl", title="成员账号", active="admin-users", users=users)


def _active_admins(exclude=None):
    return db.val("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?", exclude or 0)


def _user_form(request, u):
    f = request.form
    errors = []
    if request.method == "POST":
        display = f.get("display_name")
        role = f.get("role") if f.get("role") in ("admin", "member") else "member"
        active = 1 if f.get("active") == "1" else 0
        pw = f.raw("password")
        if not display or len(display) > 20:
            errors.append("显示名称 1–20 个字。")
        if u is None:
            username = f.get("username")
            if not auth.valid_username(username):
                errors.append("用户名 2–32 位，可以用字母、数字、中文、下划线、点和短横线。")
            elif db.val("SELECT 1 FROM users WHERE username = ?", username):
                errors.append("这个用户名已经有人用了。")
            if auth.password_problem(pw):
                errors.append(auth.password_problem(pw))
            if not errors:
                auth.create_user(username, display, pw, role)
                log.info("account created: %s (%s) by %s", username, role, request.user["username"])
                flash("已创建账号 %s。把用户名和初始密码告诉本人，让他登录后在“我的账号”里改密码。" % username)
                raise Redirect("/admin/users")
        else:
            is_self = u["id"] == request.user["id"]
            if is_self and (not active or role != "admin"):
                errors.append("不能停用自己，也不能取消自己的管理员身份。")
            if u["role"] == "admin" and u["active"] and (role != "admin" or not active) and _active_admins(u["id"]) == 0:
                errors.append("至少要保留一个可用的管理员。")
            if pw and auth.password_problem(pw):
                errors.append(auth.password_problem(pw))
            if not errors:
                db.run("UPDATE users SET display_name = ?, role = ?, active = ? WHERE id = ?", display, role, active, u["id"])
                if pw:
                    db.run("UPDATE users SET password_hash = ? WHERE id = ?", auth.hash_password(pw), u["id"])
                if pw or not active:
                    keep = request.session["token_hash"] if is_self else ""
                    db.run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", u["id"], keep)
                log.info("account updated: %s by %s", u["username"], request.user["username"])
                flash("已保存。" + ("新密码已生效，他在其他设备上的登录已退出。" if pw else ""))
                raise Redirect("/admin/users")
    return render("admin_user_form.tpl", title="成员账号", active="admin-users", u=u, f=f, errors=errors,
                  posted=request.method == "POST", owned=_owned(u["id"]) if u else None,
                  others=[x for x in core.active_users() if u and x["id"] != u["id"]])


@web.both("/admin/users/new", admin=True)
def user_new(request):
    return _user_form(request, None)


@web.both("/admin/users/<uid:int>/edit", admin=True)
def user_edit(request, uid):
    u = db.row("SELECT * FROM users WHERE id = ?", uid)
    if not u:
        raise web.HTTPError(404)
    return _user_form(request, u)


# ------------------------------------------------------------------ handing records over
CUST_OPEN = consts.ACTIVE_SQL.format(a="customers")
STU_OPEN = consts.STU_ACTIVE_SQL.format(s="students")


def _owned(uid):
    """How many records a member is responsible for: (still in progress, all)."""
    return {
        "customers": (db.val("SELECT COUNT(*) FROM customers WHERE owner_id = ? AND " + CUST_OPEN, uid),
                      db.val("SELECT COUNT(*) FROM customers WHERE owner_id = ?", uid)),
        "students": (db.val("SELECT COUNT(*) FROM students WHERE owner_id = ? AND " + STU_OPEN, uid),
                     db.val("SELECT COUNT(*) FROM students WHERE owner_id = ?", uid)),
        "issues": (db.val("SELECT COUNT(*) FROM issues WHERE owner_id = ? AND status != '已关闭'", uid),
                   db.val("SELECT COUNT(*) FROM issues WHERE owner_id = ?", uid)),
    }


@web.post("/admin/users/<uid:int>/transfer", admin=True)
def user_transfer(request, uid):
    """Hand everything a member is responsible for to someone else (for example when they leave)."""
    u = db.row("SELECT * FROM users WHERE id = ?", uid)
    if not u:
        raise web.HTTPError(404)
    f = request.form
    target = db.row("SELECT * FROM users WHERE id = ? AND active = 1", f.int("to_user") or 0)
    if not target or target["id"] == uid:
        flash("请选一位在用的成员来接手。", "err")
        raise Redirect("/admin/users/%d/edit" % uid)
    everything = f.get("scope") == "all"
    now = core.now_s()
    cust_cond = "owner_id = ?" + ("" if everything else " AND " + CUST_OPEN)
    # leave a line in each customer's history, so the new owner can see how the record reached them
    db.run("INSERT INTO followups (customer_id, at, user_id, kind, summary, next_action, next_follow_on, grade, status) "
           "SELECT id, ?, ?, 'update', ?, next_action, next_follow_on, grade, status FROM customers WHERE " + cust_cond,
           now, request.user["id"], "负责人由 %s 转给 %s。" % (u["display_name"], target["display_name"]), uid)
    n_cust = db.run("UPDATE customers SET owner_id = ?, updated_at = ? WHERE " + cust_cond, target["id"], now, uid).rowcount
    n_stu = db.run("UPDATE students SET owner_id = ?, updated_at = ? WHERE owner_id = ?"
                   + ("" if everything else " AND " + STU_OPEN), target["id"], now, uid).rowcount
    n_iss = db.run("UPDATE issues SET owner_id = ?, updated_at = ? WHERE owner_id = ?"
                   + ("" if everything else " AND status != '已关闭'"), target["id"], now, uid).rowcount
    log.info("records handed over from %s to %s by %s: %d customers, %d students, %d issues", u["username"],
             target["username"], request.user["username"], n_cust, n_stu, n_iss)
    flash("已转给 %s：客户 %d 个、学员 %d 个、异常记录 %d 条。" % (target["display_name"], n_cust, n_stu, n_iss))
    raise Redirect("/admin/users/%d/edit" % uid)


# ------------------------------------------------------------------ settings
@web.both("/admin/settings", admin=True)
def settings(request):
    f = request.form
    errors = []
    if request.method == "POST":
        try:
            start = core.parse_date(f.get("start_date")) or ""
        except ValueError:
            start = ""
            errors.append("开始日期的格式不对。")
        if not errors:
            core.set_setting("team_name", f.get("team_name")[:20])
            core.set_setting("members_only_own", "1" if f.get("members_only_own") == "1" else "0")
            core.set_setting("start_date", start)
            flash("设置已保存。")
            raise Redirect("/admin/settings")
    unassigned = db.val("SELECT COUNT(*) FROM customers WHERE owner_id IS NULL")
    return render("admin_settings.tpl", title="系统设置", active="admin-settings", errors=errors,
                  setting=core.setting, data_dir=core.CONFIG["data_dir"], tz=core.CONFIG["tz_offset"],
                  now=core.now_s(), unassigned=unassigned, allow_public=web.ALLOW_PUBLIC[0])


# ------------------------------------------------------------------ export and backup
EXPORTS = {
    "customers": ("客户", ["编号", "称呼", "联系方式", "来源渠道", "学校/区域", "想学车型", "计划报名时间", "可练车时间", "预算范围",
                          "最关心的问题", "分级", "当前状态", "匹配班型", "最近沟通日期", "最近沟通要点", "下一步动作",
                          "下次跟进时间", "负责人", "推荐人", "登记日期", "首次咨询日期", "进入A类日期", "定金日期",
                          "正式报名日期", "备注"]),
    "followups": ("跟进记录", ["客户编号", "称呼", "时间", "记录人", "类型", "内容", "下一步动作", "下次跟进时间", "分级", "状态"]),
    "students": ("学员交付", ["学员编号", "称呼", "班型", "报名日期", "交付负责人", "当前阶段", "下次动作", "下次动作日期",
                             "资料", "还缺什么", "科一考试", "科一结果", "约车情况", "科二考试", "科二结果", "科三考试",
                             "科三结果", "科四考试", "科四结果", "拿证日期", "愿意转介绍", "回访-最顺", "回访-最麻烦",
                             "回访-最担心", "已完成清单项", "备注"]),
    "issues": ("异常台账", ["发生日期", "学员", "阶段", "类型", "问题描述", "联系了谁", "预计解决", "实际解决", "已回访确认",
                           "状态", "负责人", "备注"]),
}


def _export_rows(kind):
    name = core.user_name
    if kind == "customers":
        for c in db.rows(
                "SELECT c.*, ch.name AS channel_name, p.name AS product_name, r.name AS referrer_name FROM customers c "
                "LEFT JOIN channels ch ON ch.id = c.channel_id LEFT JOIN products p ON p.id = c.product_id "
                "LEFT JOIN customers r ON r.id = c.referrer_id ORDER BY c.id"):
            yield [c["id"], c["name"], c["contact"], c["channel_name"], c["school"], c["vehicle"], c["plan"], c["slots"],
                   c["budget"], c["concern"], c["grade"], c["status"], c["product_name"], c["last_contact_on"], c["notes"],
                   c["next_action"], c["next_follow_on"], name(c["owner_id"]), c["referrer_name"], c["registered_on"],
                   c["consulted_on"], c["grade_a_on"], c["deposit_on"], c["enrolled_on"], c["remark"]]
    elif kind == "followups":
        for e in db.rows("SELECT e.*, c.name AS cname FROM followups e JOIN customers c ON c.id = e.customer_id "
                         "ORDER BY e.customer_id, e.at, e.id"):
            yield [e["customer_id"], e["cname"], e["at"], name(e["user_id"]), e["kind"], e["summary"], e["next_action"],
                   e["next_follow_on"], e["grade"], e["status"]]
    elif kind == "students":
        checks = {}
        for r in db.rows("SELECT student_id, COUNT(*) AS n FROM student_checks GROUP BY 1"):
            checks[r["student_id"]] = r["n"]
        for s in db.rows("SELECT %s FROM %s ORDER BY s.id" % (stats.STU_COLS, stats.STU_FROM)):
            yield [s["id"], s["name"], s["product_name"], s["enrolled_on"], name(s["owner_id"]), s["stage"],
                   s["next_action"], s["next_action_on"], s["docs_status"], s["docs_missing"], s["k1_exam_on"],
                   s["k1_result"], s["k2_booking"], s["k2_exam_on"], s["k2_result"], s["k3_exam_on"], s["k3_result"],
                   s["k4_exam_on"], s["k4_result"], s["license_on"], s["refer_willing"], s["visit_smooth"],
                   s["visit_hard"], s["visit_worry"], "%d/%d" % (checks.get(s["id"], 0), len(consts.CHECK_KEYS)),
                   s["remark"]]
    elif kind == "issues":
        for i in db.rows("SELECT i.*, c.name AS sname FROM issues i LEFT JOIN students s ON s.id = i.student_id "
                         "LEFT JOIN customers c ON c.id = s.customer_id ORDER BY i.occurred_on, i.id"):
            yield [i["occurred_on"], i["sname"], i["stage"], i["kind"], i["description"], i["contacted"], i["eta_on"],
                   i["solved_on"], "是" if i["revisit_ok"] else "否", i["status"], name(i["owner_id"]), i["remark"]]


def _csv_safe(value):
    """Stop spreadsheet programs from treating exported text as a formula."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


@web.get("/admin/export", admin=True)
def export_page(request):
    counts = {
        "customers": db.val("SELECT COUNT(*) FROM customers"), "followups": db.val("SELECT COUNT(*) FROM followups"),
        "students": db.val("SELECT COUNT(*) FROM students"), "issues": db.val("SELECT COUNT(*) FROM issues"),
    }
    return render("admin_export.tpl", title="导出与备份", active="admin-export", exports=EXPORTS, counts=counts,
                  backups=backup.list_backups(), keep=backup.KEEP, backup_dir=backup.backup_dir())


@web.get("/admin/export/<kind>.csv", admin=True)
def export_csv(request, kind):
    if kind not in EXPORTS:
        raise web.HTTPError(404)
    label, header = EXPORTS[kind]
    log.info("export %s by %s", kind, request.user["username"])
    rows_ = [[_csv_safe(v) for v in line] for line in _export_rows(kind)]
    return core.csv_response("%s-%s.csv" % (label, core.today_s()), header, rows_)


@web.post("/admin/backup", admin=True)
def backup_now(request):
    path = backup.backup_now()
    log.info("manual backup by %s: %s", request.user["username"], path)
    flash("已备份：%s" % os.path.basename(path))
    raise Redirect("/admin/export")


@web.get("/admin/backup/<name>", admin=True)
def backup_download(request, name):
    if not re.match(r"^jiaxiao-\d{8}-\d{6}\.db$", name):
        raise web.HTTPError(404)
    path = os.path.join(backup.backup_dir(), name)
    if not os.path.isfile(path):
        raise web.HTTPError(404)
    log.info("backup downloaded by %s: %s", request.user["username"], name)
    with open(path, "rb") as fh:
        data = fh.read()
    return web.Response(data, 200, "application/octet-stream",
                        [("Content-Disposition", 'attachment; filename="%s"' % name)])
