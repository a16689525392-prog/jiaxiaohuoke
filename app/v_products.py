# -*- coding: utf-8 -*-
"""Product cards: the internal form, the customer-facing card and the comparison sheet."""
import json

from . import consts, core, db, web
from .core import render
from .v_home import product_pending_count
from .web import Redirect, flash


def get_product(pid):
    p = db.row("SELECT * FROM products WHERE id = ?", pid)
    if not p:
        raise web.HTTPError(404)
    return p


def fee_text(p):
    fee = (p["fee"] or "").strip()
    if core.is_number(fee):
        return core.money(fee) + " 元"
    return fee or core.PENDING


def card_value(p, keys, fallback):
    parts = []
    for k in keys:
        v = fee_text(p) if k == "fee" else (p[k] or "").strip()
        if v:
            parts.append(v)
    return "；".join(parts) if parts else fallback


def card_text(p):
    """Plain-text version of the customer-facing card, for pasting into a chat."""
    lines = ["【%s】%s｜%s" % (p["name"] or "班型", p["vehicle"] or "车型待补充", p["school"] or core.PENDING)]
    lines.append("适合谁：%s" % (p["who"] or "待补充"))
    for section, rows in consts.CARD_LAYOUT:
        lines.append("")
        lines.append("— %s —" % section)
        for label, keys, fallback in rows:
            lines.append("%s：%s" % (label, card_value(p, keys, fallback)))
    lines.append("")
    lines.append("我们不承诺：%s。" % consts.NO_PROMISE)
    lines.append("报名方式：%s" % consts.HOW_TO_ENROLL)
    lines.append("信息核验日期：%s｜以正式合同和当前合作协议为准。" % (p["verified_on"] or "待核验"))
    return "\n".join(lines)


@web.get("/products")
def product_list(request):
    show_archived = request.query.get("archived") == "1"
    items = db.rows("SELECT * FROM products WHERE archived = ? ORDER BY sort, id", 1 if show_archived else 0)
    counts = dict((r["product_id"], r["n"]) for r in db.rows(
        "SELECT product_id, COUNT(*) AS n FROM customers WHERE product_id IS NOT NULL GROUP BY 1"))
    return render("products.tpl", title="产品卡", active="products", items=items, counts=counts,
                  pending=dict((p["id"], product_pending_count(p)) for p in items), fee_text=fee_text,
                  show_archived=show_archived, archived_count=db.val("SELECT COUNT(*) FROM products WHERE archived = 1"))


def _form(request, p):
    f = request.form
    errors = []
    if request.method == "POST":
        v = {}
        for key, label, default, example, hint, kind in consts.PRODUCT_FIELDS:
            if kind == "date":
                try:
                    v[key] = core.parse_date(f.get(key)) or ""
                except ValueError:
                    errors.append("%s的日期格式不对。" % label)
                    v[key] = ""
            elif kind == "long":
                v[key] = f.text(key)
            else:
                v[key] = f.get(key)
        if not v["name"]:
            errors.append("请填班型名称。")
        fee = v["fee"].replace(",", "").replace("，", "").replace("元", "").strip()
        if core.is_number(fee):
            v["fee"] = fee
        if not errors:
            now = core.now_s()
            v["updated_at"] = now
            if p:
                db.update("products", p["id"], **v)
                pid = p["id"]
            else:
                v["created_at"] = now
                v["sort"] = (db.val("SELECT COALESCE(MAX(sort), 0) FROM products") or 0) + 1
                pid = db.insert("products", **v)
            left = product_pending_count(db.row("SELECT * FROM products WHERE id = ?", pid))
            flash("产品卡已保存。" + ("还有 %d 项没核实。" % left if left else "所有项目都已填写。"), "warn" if left else "ok")
            raise Redirect("/products/%d" % pid)
    return render("product_form.tpl", title=("编辑 " + (p["name"] or "班型")) if p else "新增班型", active="products",
                  p=p, f=f, errors=errors, sections=consts.PRODUCT_SECTIONS, posted=request.method == "POST",
                  vehicles=consts.VEHICLE_OPTIONS)


@web.both("/products/new", admin=True)
def product_new(request):
    return _form(request, None)


@web.both("/products/<pid:int>/edit", admin=True)
def product_edit(request, pid):
    return _form(request, get_product(pid))


@web.get("/products/<pid:int>")
def product_card(request, pid):
    p = get_product(pid)
    comparisons = db.rows("SELECT id, title, updated_at FROM comparisons WHERE product_id = ? ORDER BY id DESC", pid)
    return render("product_card.tpl", title=p["name"] or "产品卡", active="products", p=p,
                  layout=consts.CARD_LAYOUT, card_value=card_value, fee_text=fee_text, text=card_text(p),
                  pending=product_pending_count(p), consts=consts, comparisons=comparisons)


@web.post("/products/<pid:int>/archive", admin=True)
def product_archive(request, pid):
    p = get_product(pid)
    db.run("UPDATE products SET archived = ? WHERE id = ?", 0 if p["archived"] else 1, pid)
    flash("已恢复这个班型。" if p["archived"] else "已停用这个班型。已经匹配它的客户和学员不受影响。")
    raise Redirect("/products")


# ------------------------------------------------------------------ comparison sheets
def _ours(p):
    return dict((key, card_value(p, fields, core.PENDING)) for key, label, fields in consts.COMPARE_ROWS)


def _compare_form(request, p, cmp_row):
    f = request.form
    data = json.loads(cmp_row["payload"]) if cmp_row else {"a_name": "", "b_name": "", "rows": {}}
    if request.method == "POST":
        data = {"a_name": f.get("a_name"), "b_name": f.get("b_name"), "rows": {}}
        for key, label, fields in consts.COMPARE_ROWS:
            same = f.get("same_" + key)
            data["rows"][key] = {"a": f.text("a_" + key), "b": f.text("b_" + key),
                                 "same": same if same in consts.CONSISTENCY else ""}
        title = f.get("title") or ("对比 " + (data["a_name"] or "对方 A"))
        payload = json.dumps(data, ensure_ascii=False)
        if cmp_row:
            db.update("comparisons", cmp_row["id"], title=title, payload=payload, updated_at=core.now_s())
            cid = cmp_row["id"]
        else:
            cid = db.insert("comparisons", product_id=p["id"], title=title, payload=payload,
                            created_by=request.user["id"], updated_at=core.now_s())
        flash("对比清单已保存。")
        raise Redirect("/compare/%d" % cid)
    return render("compare_form.tpl", title="对比清单", active="products", p=p, cmp=cmp_row, data=data,
                  rows=consts.COMPARE_ROWS, ours=_ours(p), options=consts.CONSISTENCY)


@web.both("/products/<pid:int>/compare/new")
def compare_new(request, pid):
    return _compare_form(request, get_product(pid), None)


def _get_compare(cid):
    row = db.row("SELECT * FROM comparisons WHERE id = ?", cid)
    if not row:
        raise web.HTTPError(404)
    return row


@web.both("/compare/<cid:int>/edit")
def compare_edit(request, cid):
    row = _get_compare(cid)
    return _compare_form(request, get_product(row["product_id"]), row)


@web.get("/compare/<cid:int>")
def compare_view(request, cid):
    row = _get_compare(cid)
    p = get_product(row["product_id"])
    return render("compare.tpl", title=row["title"] or "对比清单", active="products", p=p, cmp=row,
                  data=json.loads(row["payload"]), rows=consts.COMPARE_ROWS, ours=_ours(p))


@web.post("/compare/<cid:int>/delete")
def compare_delete(request, cid):
    row = _get_compare(cid)
    db.run("DELETE FROM comparisons WHERE id = ?", cid)
    flash("已删除这份对比清单。")
    raise Redirect("/products/%d" % row["product_id"])
