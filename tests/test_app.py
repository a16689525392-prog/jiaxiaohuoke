# -*- coding: utf-8 -*-
"""End-to-end tests through the WSGI interface.

Run from the project folder:   python3 -m unittest discover -s tests -v
"""
import logging
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["JX_PBKDF2_ITER"] = "1000"   # keep the suite fast; production uses the default

from app import auth, backup, consts, core, create_app, stats, web  # noqa: E402
from client import Client  # noqa: E402

auth.PBKDF2_ITERATIONS[0] = 1000
logging.getLogger("jiaxiao").setLevel(logging.CRITICAL)   # the application's own log lines are not part of the test output
PW = "test-pass-123"


class Base(unittest.TestCase):
    today = "2026-10-05"   # a Monday

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="jx-test-")
        core.CONFIG["fake_today"] = self.today
        self.app = create_app(self.tmp)
        auth._fails.clear()
        self.c = Client(self.app)

    def tearDown(self):
        core.CONFIG["fake_today"] = None
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ---- helpers
    def on(self, day):
        core.CONFIG["fake_today"] = day

    def sql(self, query, *args):
        conn = sqlite3.connect(os.path.join(self.tmp, "jiaxiao.db"))
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(query, args).fetchall()
            conn.commit()
            return rows
        finally:
            conn.close()

    def one(self, query, *args):
        rows = self.sql(query, *args)
        return rows[0] if rows else None

    def setup_admin(self, client=None, username="boss"):
        client = client or self.c
        client.get("/setup")
        r = client.post("/setup", {"code": auth.ensure_setup_code(), "team_name": "东校区招生组", "username": username,
                                   "display_name": "小周", "password": PW, "password2": PW})
        self.assertEqual(r.status, 200, r.text[:300])
        self.assertEqual(r.path, "/guide")
        return r

    def login(self, username, password=PW):
        client = Client(self.app)
        client.get("/login")
        r = client.post("/login", {"username": username, "password": password})
        self.assertEqual(r.path, "/", r.text[:300])
        return client

    def add_member(self, username="amy", display="小艾", role="member"):
        self.c.get("/admin/users/new")
        r = self.c.post("/admin/users/new", {"username": username, "display_name": display, "role": role,
                                              "password": PW, "active": "1"})
        self.assertIn("已创建账号", r.text)
        return self.one("SELECT id FROM users WHERE username = ?", username)["id"]

    def channel(self, name):
        return self.one("SELECT id FROM channels WHERE name = ?", name)["id"]

    def add_customer(self, name, client=None, channel="摆点", grade="", status="新加微信", due=None, **extra):
        client = client or self.c
        client.get("/customers/new")
        data = {"name": name, "channel_id": self.channel(channel), "registered_on": core.today_s(), "grade": grade,
                "status": status, "next_follow_on": due or ""}
        data.update(extra)
        r = client.post("/customers/new", data)
        row = self.one("SELECT id FROM customers WHERE name = ? ORDER BY id DESC", name)
        return (row["id"] if row else None), r

    def add_product(self, name="C1 周末班", **extra):
        self.c.get("/products/new")
        data = {"name": name, "vehicle": "C1 手动挡", "fee": "3680", "incl": "报名建档、训练、教材",
                "excl": "体检费、考试费", "payee": "驾校对公账户", "school": "××驾培有限公司",
                "receipt": "收据，付款当场开具", "refund": "未建档可全额退", "contract": "与××驾校签订培训合同"}
        data.update(extra)
        r = self.c.post("/products/new", data)
        self.assertIn("产品卡已保存", r.text)
        return self.one("SELECT id FROM products WHERE name = ?", name)["id"]

    def enroll(self, cid, pid, action="enroll", client=None, **extra):
        client = client or self.c
        client.get("/customers/%d/enroll" % cid)
        data = {"product_id": pid, "chk_e1": "1", "chk_e2": "1", "chk_e3": "1", "chk_e4": "1", "action": action,
                "on": core.today_s(), "contract": "1", "receipt": "1", "stu_next_on": core.today_s(),
                "stu_next_action": "发资料清单", "dep_next_on": core.add_days(core.today_s(), 2),
                "dep_next_action": "跟进签合同"}
        data.update(extra)
        return client.post("/customers/%d/enroll" % cid, data)


# ---------------------------------------------------------------------------------------------
class SetupAndLogin(Base):
    def test_first_run_redirects_to_setup_and_needs_the_code(self):
        r = self.c.get("/")
        self.assertEqual(r.path, "/setup")
        auth.ensure_setup_code()
        r = self.c.post("/setup", {"code": "WRONG-CODE", "username": "boss", "password": PW, "password2": PW})
        self.assertIn("初始化口令不对", r.text)
        self.assertIsNone(self.one("SELECT 1 FROM users"))
        self.setup_admin()
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "setup-code.txt")))
        # the setup page is closed once an account exists
        r = Client(self.app).get("/setup")
        self.assertEqual(r.path, "/login")

    def test_setup_validates_password(self):
        self.c.get("/setup")
        code = auth.ensure_setup_code()
        r = self.c.post("/setup", {"code": code, "username": "boss", "password": "short", "password2": "short"})
        self.assertIn("密码至少 8 位", r.text)
        r = self.c.post("/setup", {"code": code, "username": "boss", "password": PW, "password2": PW + "x"})
        self.assertIn("两次输入的密码不一样", r.text)
        self.assertIsNone(self.one("SELECT 1 FROM users"))

    def test_login_logout_and_protection(self):
        self.setup_admin()
        self.assertIn("开始与红线", self.c.get("/guide").text)
        r = self.c.post("/logout")
        self.assertEqual(r.path, "/login")
        anon = Client(self.app)
        r = anon.get("/customers")
        self.assertTrue(r.path.startswith("/login"), r.path)
        r = anon.post("/login", {"username": "boss", "password": "wrong-password"})
        self.assertIn("用户名或密码不对", r.text)
        r = anon.post("/login", {"username": "nobody", "password": PW})
        self.assertIn("用户名或密码不对", r.text)
        r = anon.post("/login", {"username": "BOSS", "password": PW})   # user names are case-insensitive
        self.assertEqual(r.path, "/")

    def test_login_returns_to_requested_page_but_never_off_site(self):
        self.setup_admin()
        self.c.post("/logout")
        anon = Client(self.app)
        r = anon.get("/calendar?w=1")
        self.assertIn("next=", r.path)
        r = anon.post("/login", {"username": "boss", "password": PW, "next": "/calendar?w=1"})
        self.assertEqual(r.path, "/calendar?w=1")
        other = Client(self.app)
        other.get("/login")
        for bad in ("//evil.example/x", "https://evil.example", "javascript:alert(1)", "/\\evil"):
            o = Client(self.app)
            o.get("/login")
            r = o.post("/login", {"username": "boss", "password": PW, "next": bad}, follow=False)
            self.assertEqual(r.header("Location"), "/", bad)

    def test_login_throttling(self):
        self.setup_admin()
        self.c.post("/logout")
        anon = Client(self.app)
        anon.get("/login")
        for _ in range(auth.LIMIT):
            anon.post("/login", {"username": "boss", "password": "nope-nope"})
        r = anon.post("/login", {"username": "boss", "password": PW})
        self.assertEqual(r.status, 429)

    def test_post_without_csrf_token_is_rejected(self):
        self.setup_admin()
        r = self.c.post("/customers/new", {"name": "x", "_csrf": "bogus"})
        self.assertEqual(r.status, 403)
        r = self.c.request("POST", "/logout", {})
        self.assertEqual(r.status, 403)
        self.assertIsNone(self.one("SELECT 1 FROM customers"))

    def test_account_password_change_signs_out_other_devices(self):
        self.setup_admin()
        other = self.login("boss")
        self.c.get("/account")
        r = self.c.post("/account", {"action": "password", "old_password": "bad", "new_password": PW + "9",
                                     "new_password2": PW + "9"})
        self.assertIn("当前密码不对", r.text)
        r = self.c.post("/account", {"action": "password", "old_password": PW, "new_password": PW + "9",
                                     "new_password2": PW + "9"})
        self.assertIn("密码已修改", r.text)
        self.assertTrue(other.get("/").path.startswith("/login"))
        self.assertEqual(self.c.get("/").path, "/")
        self.login("boss", PW + "9")


class Sessions(Base):
    def setUp(self):
        Base.setUp(self)
        self.setup_admin()

    def test_session_expires_after_two_weeks_without_use(self):
        self.assertEqual(self.c.get("/").path, "/")
        self.on("2026-10-18")                                  # day 13: still good, and using it renews it
        self.assertEqual(self.c.get("/").path, "/")
        self.on("2026-10-30")                                  # 12 days after the last use
        self.assertEqual(self.c.get("/").path, "/")
        self.on("2026-11-20")                                  # three weeks of silence
        self.assertTrue(self.c.get("/customers").path.startswith("/login"))
        self.assertEqual(self.c.post("/customers/new", {"name": "x"}, follow=False).header("Location"), "/login")

    def test_a_switched_off_account_is_out_at_once_even_with_a_live_session(self):
        uid = self.add_member("amy", "小艾")
        amy = self.login("amy")
        self.assertEqual(amy.get("/").path, "/")
        self.sql("UPDATE users SET active = 0 WHERE id = ?", uid)      # session row is still there
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", uid)["n"], 1)
        self.assertTrue(amy.get("/").path.startswith("/login"))

    def test_forged_or_stale_cookies_do_not_sign_anyone_in(self):
        other = Client(self.app)
        for value in ("", "x", "A" * 43, "../../etc/passwd", "' OR 1=1 --"):
            other.cookies["jx_sid"] = value
            self.assertTrue(other.get("/").path.startswith("/login"), value)
        token = self.c.cookies["jx_sid"]
        self.c.post("/logout")
        other.cookies["jx_sid"] = token                         # the old token is dead after signing out
        self.assertTrue(other.get("/").path.startswith("/login"))
        stored = self.sql("SELECT token_hash FROM sessions")
        self.assertEqual(stored, [])

    def test_login_form_itself_needs_its_token(self):
        self.c.post("/logout")
        anon = Client(self.app)
        anon.get("/login")
        r = anon.post("/login", {"username": "boss", "password": PW, "_csrf": "x" * 32})
        self.assertEqual(r.status, 403)
        fresh = Client(self.app)                                # never loaded the form: no cookie to match
        r = fresh.post("/login", {"username": "boss", "password": PW, "_csrf": "y" * 32})
        self.assertEqual(r.status, 403)
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM sessions")["n"], 0)

    def test_passwords_are_stored_hashed_and_tokens_are_not_stored(self):
        u = self.one("SELECT password_hash FROM users")
        self.assertTrue(u["password_hash"].startswith("pbkdf2_sha256$"))
        self.assertNotIn(PW, u["password_hash"])
        token = self.c.cookies["jx_sid"]
        dump = b""
        for name in os.listdir(self.tmp):
            path = os.path.join(self.tmp, name)
            if os.path.isfile(path):
                with open(path, "rb") as fh:
                    dump += fh.read()
        self.assertNotIn(token.encode(), dump)
        self.assertNotIn(PW.encode(), dump)
        self.assertTrue(auth.check_password(PW, u["password_hash"]))
        self.assertFalse(auth.check_password(PW + " ", u["password_hash"]))
        self.assertFalse(auth.check_password(PW, "garbage"))
        self.assertFalse(auth.check_password(PW, "md5$1$abc$def"))


class Pages(Base):
    PAGES = ["/", "/customers", "/customers/new", "/calendar", "/calendar?w=2&d=2026-10-20", "/students", "/issues",
             "/issues?show=all", "/issues/new", "/products", "/products?archived=1", "/products/new", "/scripts",
             "/scripts/new", "/channels", "/channels?archived=1", "/channels/new", "/topics/new", "/referrals", "/data",
             "/data/daily", "/data/daily?end=2026-09-01", "/data/weekly", "/data/weekly?week=2026-09-14",
             "/data/channels", "/data/channels?month=2026-09", "/guide", "/account", "/admin/users", "/admin/users/new",
             "/admin/settings", "/admin/export", "/healthz"]

    def test_every_page_renders_on_an_empty_system(self):
        self.setup_admin()
        for path in self.PAGES:
            r = self.c.get(path)
            self.assertEqual(r.status, 200, "%s -> %s\n%s" % (path, r.status, r.text[:400]))
            self.assertNotIn("Traceback", r.text)

    def test_every_page_renders_with_data_for_admin_and_member(self):
        self.setup_admin()
        self.add_member()
        pid = self.add_product()
        cid, _ = self.add_customer("张三", grade="A", status="已匹配报价", due=self.today, product_id=pid,
                                   notes="想学 C1，担心训练场太远", next_action="发训练场位置")
        cid2, _ = self.add_customer("孙八", grade="A", status="已问需求", due=self.today)
        self.enroll(cid2, pid)
        sid = self.one("SELECT id FROM students")["id"]
        self.c.get("/issues/new")
        self.c.post("/issues/new", {"student_id": sid, "occurred_on": self.today, "kind": "约不到车",
                                    "description": "周末约不上", "contacted": "张教练", "eta_on": self.today})
        iid = self.one("SELECT id FROM issues")["id"]
        self.c.get("/products/%d/compare/new" % pid)
        self.c.post("/products/%d/compare/new" % pid, {"a_name": "别家", "a_fee": "2980", "same_fee": "不一致"})
        cmp_id = self.one("SELECT id FROM comparisons")["id"]
        sc = self.one("SELECT id FROM scripts")["id"]
        ch = self.channel("摆点")
        tp = self.one("SELECT id FROM topics")["id"]
        more = ["/customers/%d" % cid, "/customers/%d/edit" % cid, "/customers/%d/enroll" % cid, "/students/%d" % sid,
                "/issues/%d/edit" % iid, "/products/%d" % pid, "/products/%d/edit" % pid,
                "/products/%d/compare/new" % pid, "/compare/%d" % cmp_id, "/compare/%d/edit" % cmp_id,
                "/scripts?product=%d" % pid, "/scripts/%d/edit" % sc, "/channels/%d/edit" % ch,
                "/topics/%d/edit" % tp, "/admin/users/1/edit", "/customers?follow=today&grade=A&q=张",
                "/students?flag=due&stage=all"]
        for path in self.PAGES + more:
            r = self.c.get(path)
            self.assertEqual(r.status, 200, "%s -> %s\n%s" % (path, r.status, r.text[:400]))
        member = self.login("amy")
        admin_only = ("/admin/", "/products/new", "/scripts/new", "/channels/new", "/edit")
        for path in self.PAGES + more:
            r = member.get(path)
            expect = 200
            if path.startswith("/admin/") or path in ("/products/new", "/scripts/new", "/channels/new") \
                    or re.match(r"^/(products|scripts|channels)/\d+/edit$", path):
                expect = 403
            self.assertEqual(r.status, expect, "member %s -> %s" % (path, r.status))
        self.assertTrue(admin_only)

    def test_unknown_page_and_bad_method(self):
        self.setup_admin()
        self.assertEqual(self.c.get("/nope").status, 404)
        self.assertEqual(self.c.get("/customers/999").status, 404)
        self.assertEqual(self.c.get("/logout").status, 405)

    def test_security_headers_and_static_files(self):
        self.setup_admin()
        r = self.c.get("/")
        self.assertEqual(r.header("X-Frame-Options"), "DENY")
        self.assertEqual(r.header("X-Content-Type-Options"), "nosniff")
        self.assertIn("default-src 'self'", r.header("Content-Security-Policy"))
        self.assertEqual(r.header("Cache-Control"), "no-store")
        self.assertNotIn("<script>", r.text.replace('<script src="/static/app.js', ""))
        link = re.search(r'href="(/static/app\.css\?v=[0-9a-f]{10})"', r.text)    # the address changes with the content
        self.assertIsNotNone(link)
        css = Client(self.app).get(link.group(1))
        self.assertEqual(css.status, 200)
        self.assertIn("text/css", css.header("Content-Type"))
        for bad in ("/static/../run.py", "/static/..%2Frun.py", "/static/%2e%2e/app/db.py", "/static//etc/passwd"):
            self.assertEqual(Client(self.app).get(bad).status, 404, bad)
        cookie = [v for k, v in self.login("boss").get("/").headers if k == "Set-Cookie"]
        sid = [v for k, v in Client(self.app)._call("GET", "/login").headers if k == "Set-Cookie"]
        self.assertTrue(all("HttpOnly" in v and "SameSite=Lax" in v for v in sid + cookie), sid)


class Customers(Base):
    def setUp(self):
        Base.setUp(self)
        self.setup_admin()

    def test_active_customer_needs_a_follow_up_date(self):
        cid, r = self.add_customer("张三", grade="A", status="已问需求")
        self.assertIsNone(cid)
        self.assertIn("必须写下次跟进时间", r.text)
        cid, r = self.add_customer("张三", grade="A", status="已问需求", due="2026-10-04")
        self.assertIsNone(cid)
        self.assertIn("不能早于今天", r.text)
        cid, r = self.add_customer("张三", grade="A", status="已问需求", due=self.today)
        self.assertIsNotNone(cid)
        # D grade and "暂不跟进" are left alone
        cid, r = self.add_customer("钱七", grade="D", status="新加微信")
        self.assertIsNotNone(cid)
        cid, r = self.add_customer("钱八", grade="B", status="暂不跟进")
        self.assertIsNotNone(cid)
        cid, r = self.add_customer("钱九", grade="D", status="犹豫中", due="2026-10-05")   # a date does no harm
        home = self.c.get("/?mine=0").text
        self.assertIn("张三", home)
        for name in ("钱七", "钱八", "钱九"):
            self.assertNotIn(name, home)       # neither "due today" nor "没排时间"
        self.assertIn('<span class="tile-label">在跟但没排时间</span><span class="tile-value">0</span>', home)
        self.assertIn('<span class="tile-label">今日待跟进</span><span class="tile-value">1</span>', home)
        self.assertNotIn("钱九", self.c.get("/calendar?mine=0&d=2026-10-05").text)
        active = self.c.get("/customers?follow=active&owner=").text
        self.assertIn("张三", active)
        self.assertNotIn("钱七", active)
        closed = self.c.get("/customers?follow=closed&owner=").text
        for name in ("钱七", "钱八", "钱九"):
            self.assertIn(name, closed)
        self.assertNotIn("张三", closed)

    def test_customer_needs_name_and_channel(self):
        self.c.get("/customers/new")
        r = self.c.post("/customers/new", {"name": "", "next_follow_on": self.today})
        self.assertIn("请填称呼", r.text)
        self.assertIn("请选来源渠道", r.text)
        r = self.c.post("/customers/new", {"name": "张三", "channel_id": 999, "next_follow_on": self.today})
        self.assertIn("请选来源渠道", r.text)
        r = self.c.post("/customers/new", {"name": "张三", "channel_id": self.channel("摆点"),
                                           "registered_on": "2026-10-09", "next_follow_on": "2026-10-09"})
        self.assertIn("登记日期不能晚于今天", r.text)
        self.assertIsNone(self.one("SELECT 1 FROM customers"))

    def test_follow_up_updates_the_customer_and_keeps_a_log(self):
        cid, _ = self.add_customer("李四", grade="B", status="犹豫中", due=self.today, notes="比较价格")
        c = self.one("SELECT * FROM customers WHERE id = ?", cid)
        self.assertEqual(c["consulted_on"], self.today)   # 犹豫中 counts as having consulted
        self.assertIsNone(c["grade_a_on"])
        url = "/customers/%d/follow" % cid
        self.c.get("/customers/%d" % cid)
        r = self.c.post(url, {"summary": "", "grade": "B", "status": "犹豫中", "next_follow_on": self.today,
                              "next_action": ""})
        self.assertIn("没有任何改动", r.text)
        r = self.c.post(url, {"summary": "家里同意了，问签约流程", "grade": "A", "status": "已匹配报价",
                              "next_follow_on": ""})
        self.assertIn("必须写下次跟进时间", r.text)
        self.assertIn("家里同意了", r.text)   # what was typed is not lost
        self.on("2026-10-06")
        self.c.get("/customers/%d" % cid)
        r = self.c.post(url, {"summary": "家里同意了，问签约流程", "grade": "A", "status": "已匹配报价",
                              "next_follow_on": "2026-10-08", "next_action": "发合同条款"})
        self.assertIn("已记录", r.text)
        c = self.one("SELECT * FROM customers WHERE id = ?", cid)
        self.assertEqual((c["grade"], c["status"], c["next_follow_on"], c["next_action"]),
                         ("A", "已匹配报价", "2026-10-08", "发合同条款"))
        self.assertEqual(c["grade_a_on"], "2026-10-06")
        self.assertEqual(c["consulted_on"], self.today)   # first time is kept
        self.assertEqual(c["last_contact_on"], "2026-10-06")
        log = self.sql("SELECT * FROM followups WHERE customer_id = ? ORDER BY id", cid)
        self.assertEqual(len(log), 2)
        self.assertIn("分级 B → A", log[1]["summary"])
        # giving up needs no date and takes the customer off the follow-up list
        r = self.c.post(url, {"summary": "去外地实习，暂时不学", "grade": "A", "status": "暂不跟进", "next_follow_on": ""})
        self.assertIn("已记录", r.text)

    def test_deposit_and_enrolment_require_the_four_checks(self):
        pid = self.add_product()
        cid, _ = self.add_customer("郑十一", grade="B", status="已匹配报价", due=self.today)
        # the ordinary follow-up form cannot mark a deposit or an enrolment
        self.c.get("/customers/%d" % cid)
        self.c.post("/customers/%d/follow" % cid, {"summary": "想交定金", "grade": "A", "status": "已正式报名",
                                                   "next_follow_on": self.today})
        self.assertEqual(self.one("SELECT status FROM customers WHERE id = ?", cid)["status"], "已匹配报价")
        r = self.enroll(cid, pid, action="deposit", chk_e3="")
        self.assertIn("四项核对还没做完", r.text)
        self.assertIn("退款、转校和投诉路径是否对", r.text)
        r = self.enroll(cid, pid, action="deposit", dep_next_on="")
        self.assertIn("必须写下次跟进时间", r.text)
        r = self.enroll(cid, pid, action="deposit")
        self.assertIn("已记录定金", r.text)
        c = self.one("SELECT * FROM customers WHERE id = ?", cid)
        self.assertEqual((c["status"], c["grade"], c["deposit_on"], c["chk4_on"], c["grade_a_on"]),
                         ("已交定金", "A", self.today, self.today, self.today))
        self.assertIsNone(self.one("SELECT 1 FROM students"))
        r = self.enroll(cid, pid, contract="")
        self.assertIn("正式报名要先签合同", r.text)
        r = self.enroll(cid, pid, doclist="1")
        self.assertIn("已正式报名，转入交付", r.text)
        c = self.one("SELECT * FROM customers WHERE id = ?", cid)
        self.assertEqual((c["status"], c["enrolled_on"], c["next_follow_on"]), ("已正式报名", self.today, None))
        s = self.one("SELECT * FROM students WHERE customer_id = ?", cid)
        self.assertEqual((s["stage"], s["next_action_on"], s["product_id"]), ("资料准备", self.today, pid))
        keys = sorted(r_["key"] for r_ in self.sql("SELECT key FROM student_checks WHERE student_id = ?", s["id"]))
        self.assertEqual(keys, ["e1", "e2", "e3", "e4", "e5", "e6"])
        # a second visit goes straight to the student page, and the customer can no longer be deleted
        self.assertEqual(self.c.get("/customers/%d/enroll" % cid).path, "/students/%d" % s["id"])
        self.assertEqual(self.c.post("/customers/%d/delete" % cid).status, 403)

    def test_edit_and_delete(self):
        cid, _ = self.add_customer("周九", grade="B", status="已匹配报价", due=self.today)
        self.c.get("/customers/%d/edit" % cid)
        r = self.c.post("/customers/%d/edit" % cid, {"name": "周九九", "channel_id": self.channel("校园社群"),
                                                     "registered_on": self.today, "school": "东校区",
                                                     "vehicle": "C2", "concern": "价格"})
        self.assertIn("资料已保存", r.text)
        c = self.one("SELECT * FROM customers WHERE id = ?", cid)
        self.assertEqual((c["name"], c["school"], c["vehicle"], c["grade"], c["next_follow_on"]),
                         ("周九九", "东校区", "C2", "B", self.today))
        r = self.c.post("/customers/%d/delete" % cid)
        self.assertIn("已删除", r.text)
        self.assertIsNone(self.one("SELECT 1 FROM customers"))
        self.assertIsNone(self.one("SELECT 1 FROM followups"))

    def test_text_is_escaped(self):
        evil = '<script>alert(1)</script>"><img src=x onerror=alert(2)>'
        cid, _ = self.add_customer(evil[:40], grade="A", status="已问需求", due=self.today, notes=evil,
                                   next_action=evil, school=evil[:40])
        for path in ("/", "/customers", "/customers/%d" % cid, "/calendar", "/customers/%d/edit" % cid):
            text = self.c.get(path).text
            self.assertNotIn("<script>alert", text, path)
            self.assertNotIn("<img src=x", text, path)
        self.assertIn("&lt;script&gt;alert(1)", self.c.get("/customers/%d" % cid).text)


class DemoNumbers(Base):
    """The worked example from the spreadsheet version; the counts were checked by hand there."""

    def setUp(self):
        Base.setUp(self)
        self.on("2026-10-01")
        self.setup_admin()
        self.pid = self.add_product()
        ids = {}
        ids["钱七"], _ = self.add_customer("钱七", channel="地推", grade="D", status="暂不跟进")
        ids["孙八"], _ = self.add_customer("孙八", channel="摆点", grade="A", status="已问需求", due="2026-10-02")
        self.on("2026-10-02")
        ids["李四"], _ = self.add_customer("李四", channel="短视频", grade="B", status="犹豫中", due="2026-10-03")
        self.on("2026-10-03")
        ids["冯十二"], _ = self.add_customer("冯十二", channel="转介绍", grade="B", status="已匹配报价", due="2026-10-05",
                                          referrer_id=ids["孙八"])
        self.on("2026-10-04")
        ids["王五"], _ = self.add_customer("王五", channel="摆点", grade="A", status="已问需求", due="2026-10-04")
        self.on("2026-10-05")
        ids["张三"], _ = self.add_customer("张三", channel="摆点", grade="A", status="已匹配报价", due="2026-10-05")
        ids["赵六"], _ = self.add_customer("赵六", channel="朋友圈", grade="C", status="新加微信", due="2026-10-12")
        ids["吴十"], _ = self.add_customer("吴十", channel="短视频", grade="", status="新加微信", due="2026-10-05")
        ids["郑十一"], _ = self.add_customer("郑十一", channel="转介绍", grade="A", status="已匹配报价",
                                          due="2026-10-05", referrer_id=ids["孙八"])
        ids["周九"], _ = self.add_customer("周九", channel="校园社群", grade="B", status="已匹配报价", due="2026-10-06")
        self.assertTrue(all(ids.values()), ids)
        self.sql("UPDATE customers SET next_follow_on = NULL WHERE id = ?", ids["周九"])  # an unscheduled leftover
        self.enroll(ids["郑十一"], self.pid, action="deposit", dep_next_on="2026-10-07")
        self.enroll(ids["孙八"], self.pid)
        self.enroll(ids["冯十二"], self.pid)
        self.ids = ids

    def call(self, fn, *args, **kw):
        """Run a stats function inside a request context as the admin."""
        out = {}

        @web.get("/_probe")
        def probe(request):   # pragma: no cover - registered once per test
            out["value"] = fn(*args, **kw)
            return "ok"

        try:
            self.assertEqual(self.c.get("/_probe").status, 200)
        finally:
            web.ROUTES.pop()
        return out["value"]

    def test_follow_up_counts(self):
        fc = self.call(stats.follow_counts, False)
        self.assertEqual((fc["today"], fc["overdue"], fc["unscheduled"], fc["week"]), (2, 2, 1, 3))
        self.assertEqual(fc["active"], 7)
        due = self.call(stats.due_customers, False)
        self.assertEqual([c["name"] for c in due], ["王五", "张三", "李四", "吴十"])
        home = self.c.get("/?mine=0").text
        self.assertIn("今天要跟进的客户", home)
        for name in ("王五", "张三", "李四", "吴十", "周九"):
            self.assertIn(name, home)
        self.assertNotIn("钱七", home)       # D grade is left alone
        self.assertLess(home.index("王五"), home.index("张三"))
        self.assertLess(home.index("张三"), home.index("李四"))
        self.assertIn("逾期 2 天", home)
        self.assertIn("逾期 1 天", home)

    def test_calendar_counts(self):
        import datetime as dt
        cal = self.call(stats.calendar, dt.date(2026, 10, 5), 42, False)
        self.assertEqual((cal["2026-10-05"]["total"], cal["2026-10-05"]["A"]), (2, 1))
        self.assertEqual((cal["2026-10-07"]["total"], cal["2026-10-07"]["A"]), (1, 1))
        self.assertEqual((cal["2026-10-12"]["total"], cal["2026-10-12"]["C"]), (1, 1))
        self.assertEqual(cal["2026-10-06"]["total"], 0)
        self.assertEqual(cal["2026-10-05"]["todo"], 2)    # the two students enrolled today
        back = self.call(stats.calendar, dt.date(2026, 9, 28), 42, False)
        self.assertEqual((back["2026-10-03"]["total"], back["2026-10-03"]["B"]), (1, 1))
        self.assertEqual((back["2026-10-04"]["total"], back["2026-10-04"]["A"]), (1, 1))
        self.assertEqual(back["2026-10-01"]["total"], 0)   # 钱七 is D, 孙八 is enrolled
        page = self.c.get("/calendar?mine=0").text
        self.assertIn("跟进 2（A 1）", page)

    def test_funnel_and_channels(self):
        f = self.call(stats.funnel, None, None, False)
        self.assertEqual((f["registered"], f["consulted"], f["grade_a"], f["deposit"], f["enrolled"]), (10, 7, 5, 3, 2))
        week = self.call(stats.funnel, "2026-10-05", "2026-10-11", False)
        self.assertEqual(week["registered"], 5)
        self.assertEqual(week["enrolled"], 2)
        last = self.call(stats.funnel, "2026-09-28", "2026-10-04", False)
        self.assertEqual((last["registered"], last["enrolled"]), (5, 0))
        totals = self.call(stats.channel_totals)
        by_name = dict((r["name"], totals.get(r["id"], (0, 0))) for r in self.sql("SELECT id, name FROM channels"))
        self.assertEqual(by_name["摆点"], (3, 1))
        self.assertEqual(by_name["短视频"], (2, 0))
        self.assertEqual(by_name["转介绍"], (2, 1))
        self.assertEqual(by_name["朋友圈"], (1, 0))
        self.assertEqual(by_name["扫楼"], (0, 0))
        month = self.call(stats.channel_month, "2026-10-01", "2026-10-31", False)
        bd = month[self.channel("摆点")]
        self.assertEqual((bd["new"], bd["leads"], bd["enrolled"], bd["referrals"]), (3, 3, 1, 2))
        zj = month[self.channel("转介绍")]
        self.assertEqual((zj["new"], zj["leads"], zj["enrolled"], zj["referrals"]), (2, 2, 1, 0))
        dsp = month[self.channel("短视频")]
        self.assertEqual((dsp["new"], dsp["leads"]), (2, 1))
        self.assertEqual(self.call(stats.channel_month, "2026-11-01", "2026-11-30", False)[self.channel("摆点")]["new"], 0)

    def test_referrers_and_payouts(self):
        people = self.call(stats.referrers)
        self.assertEqual([(r["name"], r["total"], r["enrolled"]) for r in people], [("孙八", 2, 1)])
        self.c.get("/referrals")
        self.c.post("/referrals/rules", {"reward_desc": "每成功推荐 1 人奖励 100 元", "reward_amount": "100",
                                         "reward_when": "报名后 7 天内"})
        page = self.c.get("/referrals").text
        self.assertIn("孙八", page)
        r = self.c.post("/referrals/payout", {"referrer_id": self.ids["孙八"], "amount": "100",
                                              "paid_on": self.today, "note": "推荐冯十二"})
        self.assertIn("已记录发放", r.text)
        people = self.call(stats.referrers)
        self.assertEqual(people[0]["paid"], 100)
        # a referrer with payouts cannot be deleted even by an admin
        self.assertEqual(self.c.post("/customers/%d/delete" % self.ids["孙八"]).status, 403)

    def test_daily_numbers_and_registration_check(self):
        self.c.get("/data/daily")
        r = self.c.post("/data/daily", {"day": [self.today, "2026-10-04"], "exposure_" + self.today: "1000",
                                        "wechat_" + self.today: "6", "summary_" + self.today: "摆点加了 6 个",
                                        "exposure_2026-10-04": "", "wechat_2026-10-04": ""})
        self.assertIn("每日数据已保存", r.text)
        self.assertIn("少登记 1 人", r.text)      # 6 added by hand, 5 registered that day
        d = self.call(stats.daily, [self.today, "2026-10-04"], False)
        t = d[self.today]
        self.assertEqual((t["exposure"], t["wechat_manual"], t["registered"], t["enrolled"]), (1000, 6, 5, 2))
        self.assertEqual(d["2026-10-04"]["registered"], 1)
        board = self.c.get("/data?mine=0").text
        self.assertIn("已填", board)
        rates = self.call(lambda: stats.rates(stats.funnel("2026-10-05", "2026-10-11", False)))
        self.assertAlmostEqual(rates["registered"], 5 / 1000.0)

    def test_weekly_review_and_costs(self):
        self.c.get("/data/weekly")
        r = self.c.post("/data/weekly?week=2026-10-07", {
            "customer_1": "孙八", "worry_1": "担心练车远", "said_1": "发了班车时间", "stopped_at_1": "没有",
            "change_next_1": "先发训练场位置", "drop_step": "咨询→A类", "script_change": "首接多问一句课表",
            "channel_change": "摆点改到周三", "synced": "1"})
        self.assertIn("本周复盘已保存", r.text)
        self.assertEqual(r.path, "/data/weekly?week=2026-10-05")   # normalised to the Monday
        self.assertIn("首接多问一句课表", r.text)
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM review_cases")["n"], 3)
        self.c.get("/data/channels")
        r = self.c.post("/data/costs", {"spent_on": "2026-10-06", "channel_id": self.channel("摆点"), "amount": "80",
                                        "purpose": "打印"})
        self.assertIn("已记一笔成本", r.text)
        month = self.call(stats.channel_month, "2026-10-01", "2026-10-31", False)
        self.assertEqual(month[self.channel("摆点")]["cost"], 80)
        r = self.c.post("/data/costs", {"spent_on": "2026-10-06", "channel_id": "", "amount": "abc"})
        self.assertIn("请选渠道", r.text)
        self.assertIn("金额要填大于 0 的数字", r.text)
        r = self.c.post("/data/targets", {"t_registered": "1", "t_consulted": "50%"})
        self.assertIn("目标已保存", r.text)
        self.assertIn("低于目标", r.text)     # 5 of 0 exposure this week has no rate; consulted 4/5 = 80% >= 50%


class Delivery(Base):
    def setUp(self):
        Base.setUp(self)
        self.setup_admin()
        self.pid = self.add_product()
        cid, _ = self.add_customer("孙八", grade="A", status="已问需求", due=self.today)
        self.enroll(cid, self.pid)
        self.sid = self.one("SELECT id FROM students")["id"]
        self.url = "/students/%d" % self.sid

    def save(self, **data):
        self.c.get(self.url)
        base = {"stage": self.one("SELECT stage FROM students WHERE id = ?", self.sid)["stage"],
                "next_action": "提醒", "next_action_on": core.today_s(),
                "checks": [r["key"] for r in self.sql("SELECT key FROM student_checks WHERE student_id = ?", self.sid)]}
        base.update(data)
        return self.c.post(self.url, base)

    def stage(self):
        return self.one("SELECT stage FROM students WHERE id = ?", self.sid)["stage"]

    def test_next_action_date_is_required_while_in_delivery(self):
        r = self.save(next_action_on="")
        self.assertIn("必须写下次动作日期", r.text)
        r = self.save(next_action_on="2026-10-01")
        self.assertIn("下次动作日期已经过了", r.text)
        r = self.save(next_action_on="2026-10-08")
        self.assertIn("已保存", r.text)

    def test_stages_roll_forward_and_finish(self):
        self.assertEqual(self.stage(), "资料准备")
        self.save(docs_status="缺资料", docs_missing="体检表")
        self.assertEqual(self.stage(), "资料准备")
        r = self.save(docs_status="齐全", docs_missing="体检表")
        self.assertIn("资料准备 → 科目一", r.text)
        self.assertEqual(self.one("SELECT docs_missing FROM students")["docs_missing"], "")
        r = self.save(docs_status="齐全", k1_exam_on="2026-10-09", k1_result="未通过")
        self.assertIn("科目一没通过", r.text)
        self.assertEqual(self.stage(), "科目一")
        self.save(docs_status="齐全", k1_result="通过", k2_result="通过", k3_result="通过")
        self.assertEqual(self.stage(), "科目四")
        self.save(docs_status="齐全", k1_result="通过", k2_result="通过", k3_result="通过", k4_result="通过")
        self.assertEqual(self.stage(), "已拿证待回访")
        keys = [r["key"] for r in self.sql("SELECT key FROM student_checks")] + ["k4c"]
        r = self.save(docs_status="齐全", k1_result="通过", k2_result="通过", k3_result="通过", k4_result="通过",
                      license_on=self.today, checks=keys, visit_hard="约车", refer_willing="愿意", next_action_on="")
        self.assertEqual(self.stage(), "已完结")     # no further date needed once finished
        self.assertIn("孙八", self.c.get("/referrals").text)   # listed as willing to refer
        # a manual stage change is respected
        self.save(stage="科目二", docs_status="齐全", k1_result="通过", k2_result="通过")
        self.assertEqual(self.stage(), "科目二")

    def test_checklist_items_can_be_ticked_and_unticked(self):
        before = set(r["key"] for r in self.sql("SELECT key FROM student_checks"))
        self.assertEqual(before, {"e1", "e2", "e3", "e4", "e5"})
        self.save(checks=sorted(before | {"e6", "h1", "bogus"}))
        self.assertEqual(set(r["key"] for r in self.sql("SELECT key FROM student_checks")), before | {"e6", "h1"})
        self.save(checks=sorted(before))
        self.assertEqual(set(r["key"] for r in self.sql("SELECT key FROM student_checks")), before)

    def test_issue_is_only_closed_after_the_revisit(self):
        self.c.get("/issues/new")
        r = self.c.post("/issues/new", {"student_id": self.sid, "occurred_on": self.today, "description": "周末约不上车"})
        self.assertIn("请写联系了谁", r.text)
        self.assertIn("请写预计什么时候解决", r.text)
        r = self.c.post("/issues/new", {"student_id": self.sid, "occurred_on": self.today, "description": "周末约不上车",
                                        "kind": "约不到车", "contacted": "张教练", "eta_on": "2026-10-06"})
        self.assertIn("状态：处理中", r.text)
        iid = self.one("SELECT id FROM issues")["id"]
        self.assertIn("没关闭的异常", self.c.get("/").text)
        self.c.get("/issues/%d/edit" % iid)
        data = {"student_id": self.sid, "occurred_on": self.today, "description": "周末约不上车", "contacted": "张教练",
                "eta_on": "2026-10-06"}
        r = self.c.post("/issues/%d/edit" % iid, dict(data, revisit_ok="1"))
        self.assertIn("不能先勾", r.text)
        r = self.c.post("/issues/%d/edit" % iid, dict(data, solved_on=self.today))
        self.assertIn("还要回访一次", r.text)
        self.assertEqual(self.one("SELECT status FROM issues")["status"], "已解决待回访")
        r = self.c.post("/issues/%d/edit" % iid, dict(data, solved_on=self.today, revisit_ok="1"))
        self.assertEqual(self.one("SELECT status FROM issues")["status"], "已关闭")
        self.assertIn("没有未关闭的异常", self.c.get("/issues").text)

    def test_delivery_reminders(self):
        self.save(docs_status="齐全", k1_exam_on="2026-10-09", next_action_on="2026-10-06")
        out = {}

        @web.get("/_probe")
        def probe(request):
            out["counts"] = stats.delivery_counts(False)
            out["rem"] = stats.delivery_reminders(False)
            return "ok"

        try:
            self.c.get("/_probe")
            self.assertEqual((out["counts"]["active"], out["counts"]["due"], out["counts"]["exams7"]), (1, 0, 1))
            self.assertEqual([h[0] for h in out["rem"][0]["hints"]], ["4 天后考科目一"])
            self.on("2026-10-08")
            self.c.get("/_probe")
            self.assertEqual((out["counts"]["due"], out["counts"]["exams7"]), (1, 1))
            self.assertEqual([h[0] for h in out["rem"][0]["hints"]], ["待办逾期 2 天", "1 天后考科目一"])
            self.on("2026-10-09")
            self.c.get("/_probe")
            self.assertEqual([h[0] for h in out["rem"][0]["hints"]], ["待办逾期 3 天", "今天考科目一"])
            self.on("2026-10-20")
            self.c.get("/_probe")
            self.assertEqual(out["counts"]["exams7"], 0)    # the exam date has passed
        finally:
            web.ROUTES.pop()
        self.assertIn("待办逾期", self.c.get("/").text)


class Visibility(Base):
    def setUp(self):
        Base.setUp(self)
        self.setup_admin()
        self.amy_id = self.add_member("amy", "小艾")
        self.bob_id = self.add_member("bob", "小波")
        self.pid = self.add_product()
        self.amy = self.login("amy")
        self.bob = self.login("bob")
        self.c1, _ = self.add_customer("艾的客户", client=self.amy, grade="A", status="已问需求", due=self.today)
        self.c2, _ = self.add_customer("波的客户", client=self.bob, grade="A", status="已问需求", due=self.today)
        self.c3, _ = self.add_customer("波的学员", client=self.bob, grade="A", status="已问需求", due=self.today)
        self.enroll(self.c3, self.pid, client=self.bob)
        self.s3 = self.one("SELECT id FROM students")["id"]

    def only_own(self, on):
        self.c.get("/admin/settings")
        self.c.post("/admin/settings", {"team_name": "组", "members_only_own": "1" if on else "", "start_date": self.today})

    def test_shared_by_default(self):
        self.assertEqual(self.amy.get("/customers/%d" % self.c2).status, 200)
        page = self.amy.get("/customers?owner=").text
        self.assertIn("波的客户", page)
        mine = self.amy.get("/customers").text      # members start on their own list
        self.assertIn("艾的客户", mine)
        self.assertNotIn("波的客户", mine)
        self.assertEqual(self.amy.get("/students/%d" % self.s3).status, 200)

    def test_only_own_hides_other_members_records_everywhere(self):
        self.only_own(True)
        for path in ("/customers/%d" % self.c2, "/customers/%d/edit" % self.c2, "/customers/%d/enroll" % self.c2,
                     "/students/%d" % self.s3):
            self.assertEqual(self.amy.get(path).status, 404, path)
        self.assertEqual(self.amy.post("/customers/%d/follow" % self.c2, {"summary": "x"}).status, 404)
        self.assertEqual(self.amy.post("/customers/%d/delete" % self.c2).status, 404)
        self.assertEqual(self.amy.post("/students/%d" % self.s3, {"stage": "已完结"}).status, 404)
        for path in ("/", "/customers?owner=&mine=0", "/customers?owner=%d" % self.bob_id, "/calendar?mine=0",
                     "/students?owner=", "/data?mine=0", "/data/channels?mine=0", "/referrals"):
            text = self.amy.get(path).text
            self.assertNotIn("波的", text, path)
        self.assertIn("艾的客户", self.amy.get("/customers").text)
        # their own numbers only
        self.assertIn('<span class="tile-label">今日待跟进</span><span class="tile-value">1</span>', self.amy.get("/").text)
        # the admin still sees everything
        admin_page = self.c.get("/customers?owner=").text
        self.assertIn("艾的客户", admin_page)
        self.assertIn("波的客户", admin_page)
        # a restricted member cannot reassign or attach issues to someone else's student
        self.amy.get("/customers/%d/edit" % self.c1)
        self.amy.post("/customers/%d/edit" % self.c1, {"name": "艾的客户", "channel_id": self.channel("摆点"),
                                                       "registered_on": self.today, "owner_id": self.bob_id})
        self.assertEqual(self.one("SELECT owner_id FROM customers WHERE id = ?", self.c1)["owner_id"], self.amy_id)
        self.amy.get("/issues/new")
        r = self.amy.post("/issues/new", {"student_id": self.s3, "occurred_on": self.today, "description": "x",
                                          "contacted": "y", "eta_on": self.today})
        self.assertEqual(r.status, 404)
        self.assertEqual(self.amy.post("/data/costs", {"amount": "1"}).status, 403)
        # switching it back off restores sharing
        self.only_own(False)
        self.assertEqual(self.amy.get("/customers/%d" % self.c2).status, 200)

    def test_only_the_owner_or_an_admin_deletes_a_customer(self):
        r = self.amy.post("/customers/%d/delete" % self.c2)          # shared, so visible, but not hers to delete
        self.assertEqual(r.status, 403)
        self.assertIsNotNone(self.one("SELECT 1 FROM customers WHERE id = ?", self.c2))
        self.assertNotIn("删除这个客户", self.amy.get("/customers/%d" % self.c2).text)
        self.assertIn("删除这个客户", self.bob.get("/customers/%d" % self.c2).text)
        self.assertIn("已删除", self.bob.post("/customers/%d/delete" % self.c2).text)
        self.assertIn("已删除", self.c.post("/customers/%d/delete" % self.c1).text)     # the admin may
        self.assertEqual([r_["name"] for r_ in self.sql("SELECT name FROM customers")], ["波的学员"])

    def test_restricted_member_cannot_name_someone_elses_customer_as_referrer(self):
        self.only_own(True)
        self.assertNotIn("波的学员", self.amy.get("/customers/new").text)
        cid, _ = self.add_customer("艾的新客户", client=self.amy, channel="转介绍", grade="B", status="已问需求",
                                   due=self.today, referrer_id=self.c3)
        self.assertIsNotNone(cid)
        self.assertIsNone(self.one("SELECT referrer_id FROM customers WHERE id = ?", cid)["referrer_id"])
        self.only_own(False)
        self.assertIn("波的学员", self.amy.get("/customers/new").text)
        self.amy.get("/customers/%d/edit" % cid)
        self.amy.post("/customers/%d/edit" % cid, {"name": "艾的新客户", "channel_id": self.channel("转介绍"),
                                                   "registered_on": self.today, "referrer_id": self.c3})
        self.assertEqual(self.one("SELECT referrer_id FROM customers WHERE id = ?", cid)["referrer_id"], self.c3)
        self.amy.post("/customers/%d/edit" % cid, {"name": "艾的新客户", "channel_id": self.channel("转介绍"),
                                                   "registered_on": self.today, "referrer_id": cid})   # not oneself
        self.assertIsNone(self.one("SELECT referrer_id FROM customers WHERE id = ?", cid)["referrer_id"])

    def test_sales_owner_keeps_seeing_their_student_under_another_delivery_owner(self):
        self.only_own(True)
        self.sql("UPDATE students SET owner_id = ? WHERE id = ?", self.amy_id, self.s3)
        self.assertEqual(self.bob.get("/students/%d" % self.s3).status, 200)   # bob sold it
        self.assertEqual(self.amy.get("/students/%d" % self.s3).status, 200)   # amy delivers it
        self.assertEqual(self.amy.get("/customers/%d" % self.c3).status, 404)  # but the sales record stays bob's

    def test_members_cannot_use_admin_functions(self):
        for path, data in (("/admin/users/new", {"username": "eve", "display_name": "e", "password": PW}),
                           ("/admin/settings", {"members_only_own": ""}),
                           ("/products/new", {"name": "x"}), ("/products/%d/archive" % self.pid, {}),
                           ("/scripts/new", {"grp": "a", "scene": "b", "body": "c"}),
                           ("/channels/new", {"name": "新渠道"}), ("/channels/entry", {"unified_entry": "x"}),
                           ("/referrals/rules", {"reward_desc": "x"}), ("/data/targets", {}),
                           ("/admin/backup", {})):
            self.amy.get("/")
            self.assertEqual(self.amy.post(path, data).status, 403, path)
        for path in ("/admin/export/customers.csv", "/admin/users", "/admin/export"):
            self.assertEqual(self.amy.get(path).status, 403, path)
        self.assertIsNone(self.one("SELECT 1 FROM users WHERE username = 'eve'"))


class Admin(Base):
    def setUp(self):
        Base.setUp(self)
        self.setup_admin()

    def test_member_accounts(self):
        uid = self.add_member("amy", "小艾")
        self.c.get("/admin/users/new")
        r = self.c.post("/admin/users/new", {"username": "AMY", "display_name": "x", "password": PW})
        self.assertIn("已经有人用了", r.text)
        r = self.c.post("/admin/users/new", {"username": "a b", "display_name": "x", "password": PW})
        self.assertIn("用户名 2–32 位", r.text)
        r = self.c.post("/admin/users/new", {"username": "carl", "display_name": "x", "password": "short"})
        self.assertIn("密码至少 8 位", r.text)
        amy = self.login("amy")
        # reset the password: the old session ends, the new password works
        self.c.get("/admin/users/%d/edit" % uid)
        r = self.c.post("/admin/users/%d/edit" % uid, {"display_name": "小艾", "role": "member", "active": "1",
                                                       "password": "new-pass-456"})
        self.assertIn("新密码已生效", r.text)
        self.assertTrue(amy.get("/").path.startswith("/login"))
        amy = self.login("amy", "new-pass-456")
        # deactivate: cannot log in any more, records stay
        self.c.post("/admin/users/%d/edit" % uid, {"display_name": "小艾", "role": "member"})
        self.assertTrue(amy.get("/").path.startswith("/login"))
        anon = Client(self.app)
        anon.get("/login")
        self.assertIn("已被停用", anon.post("/login", {"username": "amy", "password": "new-pass-456"}).text)

    def test_cannot_lock_everyone_out(self):
        me = self.one("SELECT id FROM users")["id"]
        self.c.get("/admin/users/%d/edit" % me)
        r = self.c.post("/admin/users/%d/edit" % me, {"display_name": "小周", "role": "member", "active": "1"})
        self.assertIn("不能停用自己", r.text)
        r = self.c.post("/admin/users/%d/edit" % me, {"display_name": "小周", "role": "admin"})
        self.assertIn("不能停用自己", r.text)
        self.assertEqual(self.one("SELECT role, active FROM users WHERE id = ?", me)["role"], "admin")

    def test_export_and_backup(self):
        pid = self.add_product()
        cid, _ = self.add_customer("张三", grade="A", status="已问需求", due=self.today,
                                   notes="=HYPERLINK(\"http://x\",\"点我\")", contact="+8613800000000")
        self.enroll(cid, pid)
        r = self.c.get("/admin/export/customers.csv")
        self.assertEqual(r.status, 200)
        self.assertTrue(r.body.startswith(b"\xef\xbb\xbf"))
        text = r.body.decode("utf-8-sig")
        self.assertIn("称呼", text.splitlines()[0])
        self.assertIn("张三", text)
        self.assertIn("'=HYPERLINK", text)        # formulas are neutralised
        self.assertIn("'+8613800000000", text)
        for kind in ("followups", "students", "issues"):
            self.assertEqual(self.c.get("/admin/export/%s.csv" % kind).status, 200)
        self.assertEqual(self.c.get("/admin/export/users.csv").status, 404)
        self.c.get("/admin/export")
        r = self.c.post("/admin/backup")
        self.assertIn("已备份", r.text)
        name = backup.list_backups()[0][0]
        r = self.c.get("/admin/backup/" + name)
        self.assertEqual(r.status, 200)
        self.assertTrue(r.body.startswith(b"SQLite format 3"))
        copy = sqlite3.connect(os.path.join(self.tmp, "backups", name))
        self.assertEqual(copy.execute("SELECT name FROM customers").fetchone()[0], "张三")
        copy.close()
        # only files this system wrote as backups can be fetched, nothing else that happens to sit there
        for other in ("before-restore-20260101-000000.db", "notes.txt", "jiaxiao-x.db"):
            with open(os.path.join(self.tmp, "backups", other), "w") as fh:
                fh.write("private")
        for bad in ("/admin/backup/..%2Fjiaxiao.db", "/admin/backup/jiaxiao.db", "/admin/backup/x.db", "/admin/backup/..",
                    "/admin/backup/before-restore-20260101-000000.db", "/admin/backup/notes.txt",
                    "/admin/backup/jiaxiao-x.db"):
            self.assertEqual(self.c.get(bad).status, 404, bad)

    def test_settings(self):
        self.c.get("/admin/settings")
        r = self.c.post("/admin/settings", {"team_name": "西校区", "members_only_own": "1", "start_date": "2026-10-12"})
        self.assertIn("设置已保存", r.text)
        self.assertIn("西校区", self.c.get("/").text)
        self.assertIn("10月18日", self.c.get("/guide").text)   # first week ends six days after the start date


class ProductsAndScripts(Base):
    def setUp(self):
        Base.setUp(self)
        self.setup_admin()

    def test_new_card_starts_with_unverified_items(self):
        page = self.c.get("/products/new").text
        self.assertIn(core.PENDING, page)
        self.c.post("/products/new", {"name": "C2 普通班"})
        p = self.one("SELECT * FROM products")
        self.assertEqual(p["fee"], "")
        card = self.c.get("/products/%d" % p["id"]).text
        self.assertIn("没核实", card)
        self.assertIn(core.PENDING, card)
        self.assertIn("包过、免考、最低价、固定拿证天数", card)
        self.assertIn("产品卡“C2 普通班”还有", self.c.get("/").text)

    def test_fee_is_normalised_and_shown_with_separator(self):
        pid = self.add_product(fee="3,680 元")
        self.assertEqual(self.one("SELECT fee FROM products")["fee"], "3680")
        card = self.c.get("/products/%d" % pid).text
        self.assertIn("3,680 元", card)
        self.assertIn("总费用：3,680 元", card)      # the plain-text version

    def test_scripts_take_values_from_the_product_card(self):
        pid = self.add_product()
        plain = self.c.get("/scripts").text
        self.assertIn("【总费用】", plain)
        filled = self.c.get("/scripts?product=%d" % pid).text
        self.assertIn("总费用：3,680元", filled.replace(" ", ""))
        self.assertIn("付到驾校对公账户", filled)
        self.assertNotIn("【收款主体】", filled)
        self.assertIn("【交付负责人】", filled)       # empty on the card, so the placeholder stays
        cid, _ = self.add_customer("张三", grade="A", status="已匹配报价", due=self.today, product_id=pid)
        self.assertIn("付到驾校对公账户", self.c.get("/customers/%d" % cid).text)

    def test_script_editing(self):
        self.c.get("/scripts/new")
        r = self.c.post("/scripts/new", {"grp": "报价与异议", "scene": "异议：太远了", "body": "我帮你看下班车时间"})
        self.assertIn("话术已保存", r.text)
        self.assertIn("异议：太远了", r.text)
        sid = self.one("SELECT id FROM scripts WHERE scene = '异议：太远了'")["id"]
        self.c.get("/scripts/%d/edit" % sid)
        r = self.c.post("/scripts/%d/edit" % sid, {"grp": "报价与异议", "scene": "异议：太远了", "body": ""})
        self.assertIn("请写话术内容", r.text)
        r = self.c.post("/scripts/%d/delete" % sid)
        self.assertNotIn("异议：太远了", r.text)

    def test_channels_and_topics(self):
        self.c.get("/channels")
        r = self.c.post("/channels/entry", {"unified_entry": "企业微信：东校区学车咨询"})
        self.assertIn("企业微信：东校区学车咨询", r.text)
        self.c.get("/channels/new")
        r = self.c.post("/channels/new", {"name": "摆点", "code": "x"})
        self.assertIn("已经有同名的渠道", r.text)
        r = self.c.post("/channels/new", {"name": "老乡会", "code": "lx", "kind": "线下", "status": "进行中"})
        self.assertIn("老乡会", r.text)
        self.assertEqual(self.one("SELECT code FROM channels WHERE name = '老乡会'")["code"], "LX")
        ch = self.channel("老乡会")
        self.c.post("/channels/%d/archive" % ch)
        self.assertNotIn("老乡会", self.c.get("/customers/new").text)
        self.assertIn("老乡会", self.c.get("/channels?archived=1").text)
        self.c.get("/topics/new")
        r = self.c.post("/topics/new", {"title": "科三路考注意什么", "worry": "怕路况", "status": "已发布",
                                        "exposure": "1200", "wechat_adds": "7"})
        self.assertIn("科三路考注意什么", r.text)
        self.assertIn("1,200", r.text)

    def test_comparison_sheet(self):
        pid = self.add_product()
        self.c.get("/products/%d/compare/new" % pid)
        r = self.c.post("/products/%d/compare/new" % pid, {"title": "小李对比", "a_name": "别家驾校 普通班",
                                                         "a_fee": "2980（只是首付）", "same_fee": "不一致"})
        self.assertIn("学车报价对比清单", r.text)
        self.assertIn("3,680 元", r.text)
        self.assertIn("2980（只是首付）", r.text)
        self.assertIn("不一致", r.text)
        self.assertNotIn("对方 B", r.text)     # the empty second column is left out


class Hardening(Base):
    """Awkward input that must never produce an error page or damage records."""

    def setUp(self):
        Base.setUp(self)
        self.setup_admin()

    def test_odd_numbers_in_links_are_ignored(self):
        for path in ("/customers?owner=%C2%B2", "/customers?channel=99999999999999999999999999",
                     "/customers?page=-5", "/customers?page=99999999999999999999", "/students?owner=%C2%B2",
                     "/data/channels?month=%C2%B2%C2%B2%C2%B2%C2%B2-%C2%B2%C2%B2", "/data/channels?month=2026-13",
                     "/data/daily?end=2026-02-31", "/data/weekly?week=nonsense", "/calendar?w=abc&d=2026-99-99",
                     "/calendar?w=99999999", "/scripts?product=abc", "/issues/new?student=999999",
                     "/customers?q=%25_%27%22%3B--"):
            r = self.c.get(path)
            self.assertEqual(r.status, 200, "%s -> %s" % (path, r.status))

    def test_amounts_must_be_real_numbers(self):
        pid = self.add_product(name="奇怪的价格", fee="nan")
        self.assertEqual(self.c.get("/products/%d" % pid).status, 200)
        self.assertEqual(self.c.get("/products").status, 200)
        self.c.get("/data/channels")
        for bad in ("nan", "inf", "-5", "1e400", "abc", ""):
            r = self.c.post("/data/costs", {"spent_on": self.today, "channel_id": self.channel("摆点"), "amount": bad})
            self.assertIn("金额要填大于 0 的数字", r.text, bad)
        self.assertIsNone(self.one("SELECT 1 FROM costs"))
        r = self.c.post("/data/costs", {"spent_on": self.today, "channel_id": self.channel("摆点"), "amount": "1,280.5 元"})
        self.assertIn("已记一笔成本", r.text)
        self.assertEqual(self.one("SELECT amount FROM costs")["amount"], 1280.5)
        self.c.get("/referrals")
        for bad in ("nan", "inf", "-1"):
            r = self.c.post("/referrals/rules", {"reward_amount": bad})
            self.assertNotIn("规则已保存", r.text, bad)
        r = self.c.post("/referrals/rules", {"reward_amount": "100.0", "reward_desc": "每人 100 元"})
        self.assertIn("规则已保存", r.text)
        self.assertEqual(self.one("SELECT value FROM settings WHERE key = 'reward_amount'")["value"], "100")
        r = self.c.post("/data/targets", {"t_registered": "nan"})
        self.assertIn("目标填 0 到 100 之间的百分比", r.text)

    def test_daily_numbers_that_are_not_whole_numbers_change_nothing(self):
        self.c.get("/data/daily")
        self.c.post("/data/daily", {"day": self.today, "exposure_" + self.today: "800", "wechat_" + self.today: "5"})
        r = self.c.post("/data/daily", {"day": self.today, "exposure_" + self.today: "很多", "wechat_" + self.today: "7"})
        self.assertIn("有 1 个数字没看懂", r.text)
        row = self.one("SELECT exposure, wechat_adds FROM daily_stats")
        self.assertEqual((row["exposure"], row["wechat_adds"]), (800, 7))
        for bad in ("-3", "1.5", "99999999999999999999", "²"):
            r = self.c.post("/data/daily", {"day": self.today, "exposure_" + self.today: bad, "wechat_" + self.today: "7"})
            self.assertIn("有 1 个数字没看懂", r.text, bad)
        self.assertEqual(self.one("SELECT exposure FROM daily_stats")["exposure"], 800)
        # a day in the future is not accepted at all
        self.c.post("/data/daily", {"day": "2026-10-09", "exposure_2026-10-09": "5"})
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM daily_stats")["n"], 1)
        r = self.c.post("/topics/new", {"title": "选题", "exposure": "99999999999999999999999", "wechat_adds": "-2"})
        self.assertIn("不能是负数", r.text)

    def test_retired_channel_and_product_stay_on_existing_customers(self):
        pid = self.add_product()
        cid, _ = self.add_customer("张三", grade="B", status="已匹配报价", due=self.today, product_id=pid)
        ch = self.channel("摆点")
        self.c.post("/channels/%d/archive" % ch)
        self.c.post("/products/%d/archive" % pid)
        form = self.c.get("/customers/%d/edit" % cid).text
        self.assertIn("摆点（已停用）", form)
        self.assertIn("C1 周末班（已停用）", form)
        self.assertNotIn("摆点", self.c.get("/customers/new").text)
        r = self.c.post("/customers/%d/edit" % cid, {"name": "张三", "channel_id": ch, "product_id": pid,
                                                     "registered_on": self.today, "school": "东校区"})
        self.assertIn("资料已保存", r.text)
        c = self.one("SELECT channel_id, product_id, school FROM customers WHERE id = ?", cid)
        self.assertEqual((c["channel_id"], c["product_id"], c["school"]), (ch, pid, "东校区"))
        self.assertIn("张三", self.c.get("/customers?channel=%d&owner=" % ch).text)

    def test_long_and_multiline_input_is_trimmed_not_fatal(self):
        cid, r = self.add_customer("张三", grade="A", status="已问需求", due=self.today, school="东\n校区" + "x" * 5000,
                                   notes="y" * 50000, next_action="z" * 3000)
        self.assertIsNotNone(cid)
        c = self.one("SELECT school, notes, next_action FROM customers WHERE id = ?", cid)
        self.assertTrue(c["school"].startswith("东 校区x"))
        self.assertEqual((len(c["school"]), len(c["notes"]), len(c["next_action"])), (1000, 20000, 1000))
        self.assertEqual(self.c.get("/customers/%d" % cid).status, 200)
        big = self.c.request("POST", "/customers/new", {"_csrf": self.c.csrf, "name": "a" * (1024 * 1024 + 10)})
        self.assertEqual(big.status, 413)

    def test_enrolment_needs_a_delivery_date_that_is_not_in_the_past(self):
        pid = self.add_product()
        cid, _ = self.add_customer("孙八", grade="A", status="已问需求", due=self.today)
        r = self.enroll(cid, pid, stu_next_on="2026-10-01")
        self.assertIn("交付的下次动作日期不能早于今天", r.text)
        r = self.enroll(cid, pid, on="2026-10-09")
        self.assertIn("日期不能晚于今天", r.text)
        self.assertIsNone(self.one("SELECT 1 FROM students"))

    def test_number_helpers(self):
        for value, shown in (("3680", "3,680"), (3680, "3,680"), ("1234.5", "1,234.50"), (0, "0"), ("", ""), (None, ""),
                             ("nan", "nan"), ("inf", "inf"), ("1e400", "1e400"), ("按合同", "按合同"), ("3,680", "3,680")):
            self.assertEqual(core.money(value), shown, repr(value))
        for bad in ("nan", "inf", "-inf", "1e400", "abc", "", None, "1e13"):
            self.assertIsNone(core.to_number(bad), repr(bad))
        self.assertEqual(core.to_number(" 1,280.50 "), 1280.5)
        self.assertEqual(core.count_or_none("1,200"), 1200)
        self.assertIsNone(core.count_or_none("  "))
        for bad in ("-1", "1.5", "abc", "1000000000"):
            self.assertRaises(ValueError, core.count_or_none, bad)
        self.assertEqual(core.parse_date("2026/10/6"), "2026-10-06")
        self.assertIsNone(core.parse_date(""))
        for bad in ("2026-02-30", "10-06", "tomorrow", "2026-13-01"):
            self.assertRaises(ValueError, core.parse_date, bad)

    def test_links_back_stay_on_this_site(self):
        for bad in ("/\t/evil.example", "/ /evil.example", "/\\evil.example", "//evil.example", "http://evil.example",
                    "javascript:alert(1)", "/" + "a" * 600, ""):
            self.assertEqual(core.safe_path(bad, "/fallback"), "/fallback", repr(bad))
        self.assertEqual(core.safe_path("/students/3?x=1#top"), "/students/3?x=1#top")
        self.assertEqual(web.header_safe_url("/customers?q=张三&x=a b"), "/customers?q=%E5%BC%A0%E4%B8%89&x=a%20b")
        self.assertEqual(web.header_safe_url("/a\t/b\r\nSet-Cookie: x=1"), "/a%09/b%0D%0ASet-Cookie:%20x%3D1"
                         .replace("%3D", "="))
        page = self.c.get("/issues/new?next=/%09/evil.example").text
        self.assertNotIn("evil.example", page)
        r = self.c.post("/issues/new", {"occurred_on": self.today, "description": "x", "contacted": "y",
                                        "eta_on": self.today, "next": "//evil.example"}, follow=False)
        self.assertEqual(r.header("Location"), "/issues")


class LocalNetworkOnly(Base):
    def from_addr(self, addr, path="/login"):
        """GET `path` as if the connection came from `addr` (the test client itself always says 10.0.0.9)."""
        inner = self.app

        def app(environ, start_response):
            environ["REMOTE_ADDR"] = addr
            return inner(environ, start_response)

        return Client(app).get(path, follow=False)

    def test_public_addresses_are_refused_and_private_ones_are_not(self):
        self.setup_admin()
        self.assertFalse(web.ALLOW_PUBLIC[0])
        for addr in ("8.8.8.8", "1.2.3.4", "203.0.114.7", "2001:4860:4860::8888", "::ffff:8.8.8.8"):
            for path in ("/login", "/", "/static/app.css", "/healthz", "/setup"):
                r = self.from_addr(addr, path)
                self.assertEqual(r.status, 403, "%s %s" % (addr, path))
            self.assertIn("只在内网和本机使用", self.from_addr(addr).text)
        for addr in ("127.0.0.1", "10.1.2.3", "172.16.5.4", "172.31.255.1", "192.168.1.20", "169.254.3.4",
                     "100.64.0.5", "100.100.100.100", "::1", "fe80::1", "fe80::1%eth0", "fd12:3456::1",
                     "::ffff:192.168.1.20", "", "unix"):
            self.assertEqual(self.from_addr(addr).status, 200, addr)

    def test_the_restriction_can_be_lifted_on_purpose(self):
        self.setup_admin()
        web.ALLOW_PUBLIC[0] = True
        try:
            self.assertEqual(self.from_addr("8.8.8.8").status, 200)
            self.assertIn("已放开", self.c.get("/admin/settings").text)
        finally:
            web.ALLOW_PUBLIC[0] = False
        self.assertIn("只接受内网和本机", self.c.get("/admin/settings").text)


class Handover(Base):
    def setUp(self):
        Base.setUp(self)
        self.setup_admin()
        self.amy_id = self.add_member("amy", "小艾")
        self.bob_id = self.add_member("bob", "小波")
        self.pid = self.add_product()
        self.amy = self.login("amy")
        self.bob = self.login("bob")

    def test_owner_change_in_the_form_is_logged(self):
        cid, _ = self.add_customer("张三", client=self.amy, grade="A", status="已问需求", due=self.today)
        self.c.get("/customers/%d/edit" % cid)
        self.c.post("/customers/%d/edit" % cid, {"name": "张三", "channel_id": self.channel("摆点"),
                                                 "registered_on": self.today, "owner_id": self.bob_id})
        self.assertEqual(self.one("SELECT owner_id FROM customers WHERE id = ?", cid)["owner_id"], self.bob_id)
        self.assertIn("负责人由 小艾 改为 小波", self.c.get("/customers/%d" % cid).text)
        # an account that has been switched off cannot be given new records
        self.c.get("/admin/users/%d/edit" % self.amy_id)
        self.c.post("/admin/users/%d/edit" % self.amy_id, {"display_name": "小艾", "role": "member"})
        self.c.post("/customers/%d/edit" % cid, {"name": "张三", "channel_id": self.channel("摆点"),
                                                 "registered_on": self.today, "owner_id": self.amy_id})
        self.assertEqual(self.one("SELECT owner_id FROM customers WHERE id = ?", cid)["owner_id"], self.bob_id)

    def test_records_of_a_switched_off_member_stay_theirs_until_someone_chooses_otherwise(self):
        cid, _ = self.add_customer("张三", client=self.amy, grade="A", status="已问需求", due=self.today)
        self.c.get("/admin/users/%d/edit" % self.amy_id)
        self.c.post("/admin/users/%d/edit" % self.amy_id, {"display_name": "小艾", "role": "member"})   # switched off
        form = self.c.get("/customers/%d/edit" % cid).text
        self.assertRegex(form, r'<option value="%d" selected>小艾（已停用）</option>' % self.amy_id)
        self.assertNotIn("小艾", self.c.get("/customers/new").text)        # but she is not offered for new records
        # saving the form as it stands changes nothing about who is responsible
        self.c.post("/customers/%d/edit" % cid, {"name": "张三", "channel_id": self.channel("摆点"),
                                                 "registered_on": self.today, "owner_id": self.amy_id,
                                                 "school": "东校区"})
        row = self.one("SELECT owner_id, school FROM customers WHERE id = ?", cid)
        self.assertEqual((row["owner_id"], row["school"]), (self.amy_id, "东校区"))
        self.assertNotIn("负责人由", self.c.get("/customers/%d" % cid).text)
        # picking someone else does
        self.c.post("/customers/%d/edit" % cid, {"name": "张三", "channel_id": self.channel("摆点"),
                                                 "registered_on": self.today, "owner_id": self.bob_id})
        self.assertEqual(self.one("SELECT owner_id FROM customers WHERE id = ?", cid)["owner_id"], self.bob_id)

    def test_saving_a_student_page_does_not_take_the_student_over(self):
        cid, _ = self.add_customer("孙八", client=self.bob, grade="A", status="已问需求", due=self.today)
        self.enroll(cid, self.pid, client=self.bob, owner_id=self.amy_id)      # bob sells, amy delivers
        s = self.one("SELECT id, owner_id FROM students")
        self.assertEqual(s["owner_id"], self.amy_id)
        self.c.get("/admin/settings")
        self.c.post("/admin/settings", {"team_name": "组", "members_only_own": "1", "start_date": self.today})
        self.bob.get("/students/%d" % s["id"])
        r = self.bob.post("/students/%d" % s["id"], {"stage": "资料准备", "next_action": "催体检表",
                                                     "next_action_on": self.today, "owner_id": self.bob_id,
                                                     "checks": ["e1", "e2", "e3", "e4", "e5"]})
        self.assertIn("已保存", r.text)
        row = self.one("SELECT owner_id, next_action FROM students")
        self.assertEqual((row["owner_id"], row["next_action"]), (self.amy_id, "催体检表"))
        self.assertEqual(self.amy.get("/students/%d" % s["id"]).status, 200)

    def test_admin_hands_a_members_records_to_someone_else(self):
        c1, _ = self.add_customer("在跟的", client=self.amy, grade="A", status="已问需求", due=self.today)
        c2, _ = self.add_customer("不跟了", client=self.amy, grade="B", status="暂不跟进")
        c3, _ = self.add_customer("已报名", client=self.amy, grade="A", status="已问需求", due=self.today)
        self.enroll(c3, self.pid, client=self.amy)
        sid = self.one("SELECT id FROM students")["id"]
        self.amy.get("/issues/new")
        self.amy.post("/issues/new", {"student_id": sid, "occurred_on": self.today, "description": "约不上车",
                                      "contacted": "张教练", "eta_on": self.today})
        c4, _ = self.add_customer("波自己的", client=self.bob, grade="A", status="已问需求", due=self.today)
        page = self.c.get("/admin/users/%d/edit" % self.amy_id).text
        self.assertIn("在跟的客户 1 个（全部 3 个）", page)
        self.assertIn("交付中的学员 1 个（全部 1 个）", page)
        url = "/admin/users/%d/transfer" % self.amy_id
        self.assertEqual(self.amy.post(url, {"to_user": self.bob_id}).status, 403)
        for bad in ("", str(self.amy_id), "999"):
            r = self.c.post(url, {"to_user": bad})
            self.assertIn("请选一位在用的成员来接手", r.text, bad)
        r = self.c.post(url, {"to_user": self.bob_id, "scope": "open"})
        self.assertIn("已转给 小波：客户 1 个、学员 1 个、异常记录 1 条", r.text)
        owners = dict((r_["name"], r_["owner_id"]) for r_ in self.sql("SELECT name, owner_id FROM customers"))
        self.assertEqual(owners, {"在跟的": self.bob_id, "不跟了": self.amy_id, "已报名": self.amy_id,
                                  "波自己的": self.bob_id})
        self.assertEqual(self.one("SELECT owner_id FROM students")["owner_id"], self.bob_id)
        self.assertEqual(self.one("SELECT owner_id FROM issues")["owner_id"], self.bob_id)
        self.assertIn("负责人由 小艾 转给 小波", self.c.get("/customers/%d" % c1).text)
        self.assertNotIn("转给", self.c.get("/customers/%d" % c2).text)
        r = self.c.post(url, {"to_user": self.bob_id, "scope": "all"})
        self.assertIn("已转给 小波：客户 2 个、学员 0 个、异常记录 0 条", r.text)
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM customers WHERE owner_id = ?", self.amy_id)["n"], 0)
        self.assertIn("他名下没有记录", self.c.get("/admin/users/%d/edit" % self.amy_id).text)


class BackupAndRestore(Base):
    def test_restore_brings_back_the_data_and_keeps_a_copy_of_what_was_replaced(self):
        self.setup_admin()
        self.add_customer("备份时就在", grade="A", status="已问需求", due=self.today)
        saved = backup.backup_now()
        self.assertEqual(backup.check_backup(saved), "")
        self.add_customer("备份之后才来", grade="A", status="已问需求", due=self.today)
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM customers")["n"], 2)
        before = backup.backup_now(prefix="before-restore")
        backup.restore_from(saved)
        self.assertEqual([r["name"] for r in self.sql("SELECT name FROM customers")], ["备份时就在"])
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM sessions")["n"], 0)     # everyone signs in again
        self.assertTrue(self.c.get("/").path.startswith("/login"))
        self.login("boss")
        copy = sqlite3.connect(before)
        self.assertEqual(copy.execute("SELECT COUNT(*) FROM customers").fetchone()[0], 2)
        copy.close()
        self.assertEqual([n for n, _ in backup.list_backups()], [os.path.basename(saved)])   # the safety copy is not listed
        # backups are plain single files (nothing extra appears beside them), the live database keeps its write-ahead log
        self.assertEqual(sorted(os.listdir(os.path.join(self.tmp, "backups"))),
                         sorted([os.path.basename(saved), os.path.basename(before)]))
        for path, mode in ((saved, "delete"), (os.path.join(self.tmp, "jiaxiao.db"), "wal")):
            conn = sqlite3.connect(path)
            self.assertEqual(conn.execute("PRAGMA journal_mode").fetchone()[0], mode, path)
            self.assertEqual(conn.execute("PRAGMA quick_check").fetchone()[0], "ok")
            conn.close()
        self.assertEqual(os.stat(saved).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(os.path.join(self.tmp, "backups")).st_mode & 0o077, 0)

    def test_files_that_are_not_backups_are_refused(self):
        self.setup_admin()
        junk = os.path.join(self.tmp, "junk.db")
        with open(junk, "wb") as fh:
            fh.write(b"this is not a database at all" * 100)
        self.assertIn("不是", backup.check_backup(junk))
        other = os.path.join(self.tmp, "other.db")
        conn = sqlite3.connect(other)
        conn.execute("CREATE TABLE something (x)")
        conn.commit()
        conn.close()
        self.assertEqual(backup.check_backup(other), "这不是本系统的备份文件。")
        self.assertIn("找不到", backup.check_backup(os.path.join(self.tmp, "missing.db")))
        newer = backup.backup_now()
        conn = sqlite3.connect(newer)
        conn.execute("PRAGMA user_version = 99")
        conn.commit()
        conn.close()
        self.assertIn("更新的版本", backup.check_backup(newer))

    def test_a_failed_backup_leaves_nothing_behind(self):
        self.setup_admin()
        good = backup.backup_now()
        real, db_path = backup.db.DB_PATH[0], os.path.join(self.tmp, "missing-dir", "nothing.db")
        backup.db.DB_PATH[0] = db_path              # the source cannot be opened, so the copy fails
        try:
            self.assertRaises(sqlite3.Error, backup.backup_now)
        finally:
            backup.db.DB_PATH[0] = real
        self.assertEqual(os.listdir(os.path.join(self.tmp, "backups")), [os.path.basename(good)])
        again = backup.backup_now()                 # and the next one works as usual
        self.assertEqual(backup.check_backup(again), "")

    def test_old_backups_are_pruned_but_only_our_own_files(self):
        self.setup_admin()
        d = backup.backup_dir()
        for i in range(backup.KEEP + 5):
            open(os.path.join(d, "jiaxiao-202601%02d-030000.db" % (i + 1)), "w").close()
        open(os.path.join(d, "before-restore-20260101-000000.db"), "w").close()
        open(os.path.join(d, "notes.txt"), "w").close()
        backup.backup_now()
        names = sorted(os.listdir(d))
        self.assertEqual(len([n for n in names if n.startswith("jiaxiao-")]), backup.KEEP)
        self.assertIn("before-restore-20260101-000000.db", names)
        self.assertIn("notes.txt", names)
        self.assertNotIn("jiaxiao-20260101-030000.db", names)     # the oldest went first


class RealServer(Base):
    """The same application behind the real HTTP server, to catch what an in-process client cannot."""

    def setUp(self):
        Base.setUp(self)
        import threading
        self.httpd = web.serve("127.0.0.1", 0)
        self.base = "http://127.0.0.1:%d" % self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.thread.start()
        import http.cookiejar
        import urllib.request

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **kw):
                return None

        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPCookieProcessor(self.jar))

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(5)
        Base.tearDown(self)

    def http(self, method, path, data=None, raw_body=None, headers=None):
        """-> (status, headers, text).  `path` and form values may contain Chinese text."""
        import urllib.error
        import urllib.parse
        import urllib.request
        body = raw_body
        if data is not None:
            body = urllib.parse.urlencode(data).encode("utf-8")
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers or {})
        if data is not None:
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            resp = self.opener.open(req, timeout=20)
        except urllib.error.HTTPError as e:
            resp = e
        raw = resp.read()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = ""
        return resp.status if hasattr(resp, "status") else resp.code, resp.headers, text

    def csrf(self, text):
        return re.search(r'name="_csrf" value="([^"]*)"', text).group(1)

    def test_whole_flow_over_http(self):
        status, headers, _ = self.http("GET", "/")
        self.assertEqual((status, headers["Location"]), (303, "/setup"))
        status, headers, text = self.http("GET", "/setup")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers["Content-Type"])
        self.assertIn("初始化系统", text)
        status, headers, _ = self.http("POST", "/setup", {
            "_csrf": self.csrf(text), "code": auth.ensure_setup_code(), "team_name": "东校区招生组",
            "username": "周老板", "display_name": "小周", "password": PW, "password2": PW})
        self.assertEqual((status, headers["Location"]), (303, "/guide"))
        status, _, text = self.http("GET", "/guide")
        self.assertEqual(status, 200)
        self.assertIn("系统已经初始化", text)          # the flash message survived the redirect in a cookie
        self.assertIn("东校区招生组", text)
        token = self.csrf(text)

        # a customer with Chinese text everywhere, then a search for it
        status, headers, _ = self.http("POST", "/customers/new", {
            "_csrf": token, "name": "张三", "channel_id": "6", "registered_on": self.today, "grade": "A",
            "status": "已问需求", "next_follow_on": self.today, "notes": "担心训练场太远\n想周末练车"})
        self.assertEqual(status, 303, headers)
        self.assertRegex(headers["Location"], r"^/customers/\d+$")
        status, _, text = self.http("GET", headers["Location"])
        self.assertIn("已登记 张三", text)
        self.assertIn("担心训练场太远<br>想周末练车", text)
        status, _, text = self.http("GET", "/customers?q=" + "%E5%BC%A0")
        self.assertEqual(status, 200)
        self.assertIn("张三", text)
        self.assertNotIn("已登记 张三", text)           # shown once only

        # downloads with a Chinese file name
        status, headers, text = self.http("GET", "/admin/export/customers.csv")
        self.assertEqual(status, 200)
        self.assertIn("filename*=UTF-8''%E5%AE%A2%E6%88%B7-2026-10-05.csv", headers["Content-Disposition"])
        self.assertIn("张三", text)
        status, headers, _ = self.http("POST", "/admin/backup", {"_csrf": token})
        self.assertEqual((status, headers["Location"]), (303, "/admin/export"))
        name = backup.list_backups()[0][0]
        status, headers, _ = self.http("GET", "/admin/backup/" + name)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Length"], str(os.path.getsize(os.path.join(self.tmp, "backups", name))))

        # static files, HEAD, 404
        status, headers, text = self.http("GET", "/static/app.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", headers["Content-Type"])
        self.assertIn("max-age", headers["Cache-Control"])
        status, headers, text = self.http("HEAD", "/guide")
        self.assertEqual((status, text), (200, ""))
        self.assertEqual(self.http("GET", "/nope")[0], 404)
        self.assertEqual(self.http("GET", "/static/../run.py")[0], 404)
        status, headers, text = self.http("GET", "/healthz")
        self.assertEqual(text, "ok")
        self.assertEqual(headers["Server"], "jiaxiao")          # no Python or library versions given away
        self.assertNotIn("Python", str(headers))

        # sign out, get sent to the login page, and come back to where we were going
        status, headers, _ = self.http("POST", "/logout", {"_csrf": token})
        self.assertEqual((status, headers["Location"]), (303, "/login"))
        status, headers, _ = self.http("GET", "/customers?q=%E5%BC%A0%E4%B8%89")
        self.assertEqual(status, 303)
        self.assertEqual(headers["Location"], "/login?next=%2Fcustomers%3Fq%3D%25E5%25BC%25A0%25E4%25B8%2589")
        status, _, text = self.http("GET", headers["Location"])
        self.assertIn('name="next" value="/customers?q=%E5%BC%A0%E4%B8%89"', text)
        status, headers, _ = self.http("POST", "/login", {"_csrf": self.csrf(text), "username": "周老板",
                                                          "password": PW, "next": "/customers?q=张三"})
        self.assertEqual(status, 303)
        self.assertEqual(headers["Location"], "/customers?q=%E5%BC%A0%E4%B8%89")     # plain ASCII in the header
        status, _, text = self.http("GET", headers["Location"])
        self.assertEqual(status, 200)
        self.assertIn("张三", text)

    def test_oversized_and_malformed_requests(self):
        self.setup_admin()
        status, _, text = self.http("GET", "/login")
        token = self.csrf(text)
        status, _, _ = self.http("POST", "/login", raw_body=b"x" * (web.MAX_BODY + 1),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(status, 413)
        status, _, _ = self.http("POST", "/login", raw_body=b'{"username": "boss"}',
                                 headers={"Content-Type": "application/json"})
        self.assertEqual(status, 403)                      # no form, so no CSRF token
        status, _, text = self.http("POST", "/login", {"_csrf": token, "username": "boss\x00\r\n", "password": "\xff"})
        self.assertEqual(status, 200)
        self.assertIn("用户名或密码不对", text)
        import socket
        for junk in (b"GARBAGE\r\n\r\n", b"GET /%ff%fe HTTP/1.0\r\n\r\n", b"GET /login HTTP/1.0\r\nCookie: \xff\xfe=\xff\r\n\r\n",
                     b"GET /login?next=%ff%00 HTTP/1.0\r\n\r\n"):
            sock = socket.create_connection(("127.0.0.1", self.httpd.server_address[1]), timeout=10)
            sock.sendall(junk)
            reply = b""
            while True:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                reply += chunk
            sock.close()
            self.assertNotIn(b" 500 ", reply.split(b"\r\n")[0], junk)
        self.assertEqual(self.http("GET", "/healthz")[0], 200)    # still alive afterwards

    def test_the_same_enrolment_sent_twice_at_once_creates_one_student(self):
        self.setup_admin()
        pid = self.add_product()
        cid, _ = self.add_customer("孙八", grade="A", status="已问需求", due=self.today)
        import threading
        status, _, text = self.http("GET", "/login")
        self.http("POST", "/login", {"_csrf": self.csrf(text), "username": "boss", "password": PW})
        status, _, text = self.http("GET", "/customers/%d/enroll" % cid)
        data = {"_csrf": self.csrf(text), "product_id": pid, "chk_e1": "1", "chk_e2": "1", "chk_e3": "1", "chk_e4": "1",
                "action": "enroll", "on": self.today, "contract": "1", "receipt": "1", "stu_next_on": self.today}
        results = []

        def worker():
            st, hd, _ = self.http("POST", "/customers/%d/enroll" % cid, data)
            results.append((st, hd["Location"] if st == 303 else None))

        threads = [threading.Thread(target=worker) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(60)
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM students")["n"], 1)
        sid = self.one("SELECT id FROM students")["id"]
        self.assertEqual(set(results), {(303, "/students/%d" % sid)}, results)       # nobody saw an error page
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM followups WHERE kind = 'enroll'")["n"], 1)
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM student_checks")["n"], 5)

    def test_many_requests_at_once(self):
        self.setup_admin()
        import threading
        status, _, text = self.http("GET", "/login")
        status, headers, _ = self.http("POST", "/login", {"_csrf": self.csrf(text), "username": "boss", "password": PW})
        self.assertEqual(status, 303)
        status, _, text = self.http("GET", "/customers/new")
        token = self.csrf(text)
        results = []

        def worker(i):
            try:
                st, hd, _ = self.http("POST", "/customers/new", {
                    "_csrf": token, "name": "并发客户%02d" % i, "channel_id": "6", "registered_on": self.today,
                    "grade": "B", "status": "已问需求", "next_follow_on": self.today})
                results.append(st)
                results.append(self.http("GET", "/")[0])
            except Exception as e:      # pragma: no cover - reported through the assertion below
                results.append(repr(e))

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(24)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(60)
        self.assertEqual(sorted(set(map(str, results))), ["200", "303"], results)
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM customers")["n"], 24)
        self.assertEqual(self.one("SELECT COUNT(*) AS n FROM followups")["n"], 24)


if __name__ == "__main__":
    unittest.main()
