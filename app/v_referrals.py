# -*- coding: utf-8 -*-
"""Referrals: the public rules, who referred whom, and reward payouts."""
from . import consts, core, db, stats, web
from .core import render
from .v_customers import _date
from .web import Redirect, flash


def reward_amount():
    return core.to_number(core.setting("reward_amount")) or 0.0


@web.get("/referrals")
def referral_page(request):
    amount = reward_amount()
    people = []
    for r in stats.referrers():
        enrolled = r["enrolled"] or 0
        due = enrolled * amount if amount else None
        people.append({"r": r, "enrolled": enrolled, "due": due,
                       "left": (due - (r["paid"] or 0)) if due is not None else None})
    payouts = db.rows(
        "SELECT p.*, c.name AS referrer_name FROM payouts p JOIN customers c ON c.id = p.referrer_id "
        "ORDER BY p.paid_on DESC, p.id DESC LIMIT 100") if core.sees_all() else []
    willing = db.rows(
        "SELECT s.id, c.name FROM students s JOIN customers c ON c.id = s.customer_id "
        "WHERE s.refer_willing = '愿意' AND %s ORDER BY s.id DESC LIMIT 30" % core.stu_scope("s", "c")[0],
        *core.stu_scope("s", "c")[1])
    return render("referrals.tpl", title="转介绍", active="referrals", rules=consts.REFERRAL_RULES,
                  red_lines=consts.REFERRAL_RED_LINES, people=people, payouts=payouts, amount=amount,
                  setting=core.setting, willing=willing)


@web.post("/referrals/rules", admin=True)
def referral_rules(request):
    f = request.form
    amount = f.get("reward_amount").replace(",", "").replace("元", "").strip()
    if amount and core.to_number(amount) is None:
        flash("每笔奖励金额只填数字，奖励不是现金可以留空。", "err")
        raise Redirect("/referrals")
    if amount and core.to_number(amount) < 0:
        flash("每笔奖励金额不能是负数。", "err")
        raise Redirect("/referrals")
    if amount:
        n = core.to_number(amount)
        amount = ("%d" % n) if n == int(n) else ("%.2f" % n)
    for key, label, example in consts.REFERRAL_RULES:
        core.set_setting(key, amount if key == "reward_amount" else f.text(key)[:300])
    flash("规则已保存。记得把它写在公开的地方。")
    raise Redirect("/referrals")


@web.post("/referrals/payout", admin=True)
def referral_payout(request):
    f = request.form
    errors = []
    rid = f.int("referrer_id")
    if not rid or not db.val("SELECT 1 FROM customers WHERE id = ?", rid):
        errors.append("请选推荐人。")
    amount = core.to_number(f.get("amount").replace("元", ""))
    if amount is None or amount <= 0:
        errors.append("发放金额要填大于 0 的数字。")
    paid_on = _date(f, "paid_on", errors, "发放日期") or core.today_s()
    if paid_on > core.today_s():
        errors.append("发放日期不能晚于今天。")
    if errors:
        for e in errors:
            flash(e, "err")
    else:
        db.insert("payouts", referrer_id=rid, amount=amount, paid_on=paid_on, note=f.get("note")[:120],
                  created_by=request.user["id"], created_at=core.now_s())
        flash("已记录发放。")
    raise Redirect("/referrals")


@web.post("/referrals/payout/<pid:int>/delete", admin=True)
def referral_payout_delete(request, pid):
    db.run("DELETE FROM payouts WHERE id = ?", pid)
    flash("已删除这条发放记录。")
    raise Redirect("/referrals")
