# -*- coding: utf-8 -*-
"""Acquisition channels (with their marker codes) and the content topic plan."""
from . import consts, core, db, stats, web
from .core import render
from .v_customers import _choice, _date
from .web import Redirect, flash


@web.get("/channels")
def channel_list(request):
    show_archived = request.query.get("archived") == "1"
    items = db.rows("SELECT * FROM channels WHERE archived = ? ORDER BY sort, id", 1 if show_archived else 0)
    topics = db.rows("SELECT * FROM topics ORDER BY (status = '待拍') DESC, plan_on, id")
    return render("channels.tpl", title="获客渠道", active="channels", items=items, totals=stats.channel_totals(),
                  topics=topics, entry=core.setting("unified_entry"), show_archived=show_archived,
                  archived_count=db.val("SELECT COUNT(*) FROM channels WHERE archived = 1"))


@web.post("/channels/entry", admin=True)
def channel_entry(request):
    core.set_setting("unified_entry", request.form.get("unified_entry")[:80])
    flash("统一入口已保存。")
    raise Redirect("/channels")


def _form(request, ch):
    f = request.form
    errors = []
    if request.method == "POST":
        v = {"name": f.get("name"), "code": f.get("code").upper()[:8], "kind": _choice(f, "kind", consts.CHANNEL_KINDS),
             "how": f.text("how"), "owner": f.get("owner"), "start_on": _date(f, "start_on", errors, "启用日期") or "",
             "status": _choice(f, "status", consts.CHANNEL_STATUS, "筹备中"), "note": f.text("note")}
        if not v["name"]:
            errors.append("请填渠道名称。")
        elif len(v["name"]) > 20:
            errors.append("渠道名称最多 20 个字。")
        elif db.val("SELECT 1 FROM channels WHERE name = ? AND id != ?", v["name"], ch["id"] if ch else 0):
            errors.append("已经有同名的渠道了。")
        if not errors:
            if ch:
                db.update("channels", ch["id"], **v)
            else:
                v["sort"] = (db.val("SELECT COALESCE(MAX(sort), 0) FROM channels") or 0) + 1
                db.insert("channels", **v)
            flash("渠道已保存。")
            raise Redirect("/channels")
    return render("channel_form.tpl", title="渠道", active="channels", ch=ch, f=f, errors=errors, consts=consts,
                  posted=request.method == "POST")


@web.both("/channels/new", admin=True)
def channel_new(request):
    return _form(request, None)


def _get_channel(cid):
    ch = db.row("SELECT * FROM channels WHERE id = ?", cid)
    if not ch:
        raise web.HTTPError(404)
    return ch


@web.both("/channels/<cid:int>/edit", admin=True)
def channel_edit(request, cid):
    return _form(request, _get_channel(cid))


@web.post("/channels/<cid:int>/archive", admin=True)
def channel_archive(request, cid):
    ch = _get_channel(cid)
    db.run("UPDATE channels SET archived = ? WHERE id = ?", 0 if ch["archived"] else 1, cid)
    flash("已恢复渠道“%s”。" % ch["name"] if ch["archived"] else "已停用渠道“%s”。已登记的客户不受影响，新登记时不再出现。" % ch["name"])
    raise Redirect("/channels")


# ------------------------------------------------------------------ content topics
def _topic_form(request, t):
    f = request.form
    errors = []
    if request.method == "POST":
        v = {"title": f.get("title"), "worry": f.get("worry"), "form": f.get("form")[:20],
             "plan_on": _date(f, "plan_on", errors, "计划发布日") or "",
             "status": _choice(f, "status", consts.TOPIC_STATUS, "待拍"),
             "exposure": f.int("exposure"), "wechat_adds": f.int("wechat_adds"), "note": f.text("note")}
        if not v["title"]:
            errors.append("请写选题。")
        for key in ("exposure", "wechat_adds"):
            if v[key] is not None and v[key] < 0:
                errors.append("曝光和加微数不能是负数。")
        if not errors:
            if t:
                db.update("topics", t["id"], **v)
            else:
                v["created_at"] = core.now_s()
                db.insert("topics", **v)
            flash("选题已保存。")
            raise Redirect("/channels#topics")
    return render("topic_form.tpl", title="内容选题", active="channels", t=t, f=f, errors=errors, consts=consts,
                  posted=request.method == "POST")


@web.both("/topics/new")
def topic_new(request):
    return _topic_form(request, None)


def _get_topic(tid):
    t = db.row("SELECT * FROM topics WHERE id = ?", tid)
    if not t:
        raise web.HTTPError(404)
    return t


@web.both("/topics/<tid:int>/edit")
def topic_edit(request, tid):
    return _topic_form(request, _get_topic(tid))


@web.post("/topics/<tid:int>/delete")
def topic_delete(request, tid):
    _get_topic(tid)
    db.run("DELETE FROM topics WHERE id = ?", tid)
    flash("已删除这个选题。")
    raise Redirect("/channels#topics")
