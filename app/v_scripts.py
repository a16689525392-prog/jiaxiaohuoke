# -*- coding: utf-8 -*-
"""The shared script library (统一话术)."""
from . import consts, core, db, web
from .core import render
from .web import Redirect, flash


def fill_script(body, product):
    """Replace 【占位符】 with what the product card says, where the card has a verified value."""
    if not product:
        return body
    for token, field in consts.SCRIPT_TOKENS.items():
        value = (product[field] or "").strip()
        if not value or core.PENDING in value:
            continue
        if field == "fee" and core.is_number(value):
            value = core.money(value)
        body = body.replace("【%s】" % token, value.rstrip("。；;"))
    return body


def quote_for(product):
    s = db.row("SELECT body FROM scripts WHERE scene = '报价' ORDER BY sort, id LIMIT 1")
    return fill_script(s["body"], product) if s else ""


@web.get("/scripts")
def script_list(request):
    products = db.rows("SELECT * FROM products WHERE archived = 0 ORDER BY sort, id")
    pid = request.query.int("product")
    product = None
    for p in products:
        if p["id"] == pid:
            product = p
    groups = []
    all_scripts = db.rows("SELECT * FROM scripts ORDER BY sort, id")
    names = list(consts.SCRIPT_GROUPS) + sorted(set(s["grp"] for s in all_scripts) - set(consts.SCRIPT_GROUPS))
    for name in names:
        items = [(s, fill_script(s["body"], product)) for s in all_scripts if s["grp"] == name]
        if items:
            groups.append((name, items))
    return render("scripts.tpl", title="统一话术", active="scripts", groups=groups, products=products,
                  product=product, order=consts.SALES_ORDER, forbidden=consts.FORBIDDEN)


def _form(request, s):
    f = request.form
    errors = []
    if request.method == "POST":
        v = {"grp": f.get("grp"), "scene": f.get("scene"), "when_use": f.get("when_use"),
             "body": f.text("body"), "tips": f.text("tips"), "updated_at": core.now_s(),
             "updated_by": request.user["id"]}
        if not v["grp"]:
            errors.append("请选分组。")
        if not v["scene"]:
            errors.append("请写场景名称。")
        if not v["body"]:
            errors.append("请写话术内容。")
        if not errors:
            if s:
                db.update("scripts", s["id"], **v)
            else:
                v["sort"] = (db.val("SELECT COALESCE(MAX(sort), 0) FROM scripts") or 0) + 1
                db.insert("scripts", **v)
            flash("话术已保存。全团队看到的是同一份。")
            raise Redirect("/scripts")
    return render("script_form.tpl", title="编辑话术" if s else "新增话术", active="scripts", s=s, f=f,
                  errors=errors, groups=consts.SCRIPT_GROUPS, posted=request.method == "POST")


@web.both("/scripts/new", admin=True)
def script_new(request):
    return _form(request, None)


@web.both("/scripts/<sid:int>/edit", admin=True)
def script_edit(request, sid):
    s = db.row("SELECT * FROM scripts WHERE id = ?", sid)
    if not s:
        raise web.HTTPError(404)
    return _form(request, s)


@web.post("/scripts/<sid:int>/delete", admin=True)
def script_delete(request, sid):
    db.run("DELETE FROM scripts WHERE id = ?", sid)
    flash("已删除这条话术。")
    raise Redirect("/scripts")
