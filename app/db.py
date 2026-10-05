# -*- coding: utf-8 -*-
"""SQLite access: one connection per request, schema and migrations."""
import os
import sqlite3

from . import web

DB_PATH = [None]

SCHEMA_V1 = """
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '', who TEXT NOT NULL DEFAULT '',
  school TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT '', shuttle TEXT NOT NULL DEFAULT '',
  fee TEXT NOT NULL DEFAULT '', incl TEXT NOT NULL DEFAULT '', excl TEXT NOT NULL DEFAULT '',
  payee_items TEXT NOT NULL DEFAULT '', deposit TEXT NOT NULL DEFAULT '', retake TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT '', booking TEXT NOT NULL DEFAULT '', slots TEXT NOT NULL DEFAULT '',
  exam TEXT NOT NULL DEFAULT '', cycle TEXT NOT NULL DEFAULT '',
  refund TEXT NOT NULL DEFAULT '', transfer TEXT NOT NULL DEFAULT '', complaint TEXT NOT NULL DEFAULT '',
  payee TEXT NOT NULL DEFAULT '', contract TEXT NOT NULL DEFAULT '', receipt TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '', owner_text TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL DEFAULT '', verified_on TEXT NOT NULL DEFAULT '', verifier TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE comparisons (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL
);
CREATE TABLE scripts (
  id INTEGER PRIMARY KEY,
  grp TEXT NOT NULL, scene TEXT NOT NULL, when_use TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '', tips TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE channels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE, code TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '',
  how TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '', start_on TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '筹备中', note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE topics (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, worry TEXT NOT NULL DEFAULT '', form TEXT NOT NULL DEFAULT '',
  plan_on TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '待拍',
  exposure INTEGER, wechat_adds INTEGER, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  channel_id INTEGER REFERENCES channels(id),
  school TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '', plan TEXT NOT NULL DEFAULT '',
  slots TEXT NOT NULL DEFAULT '', budget TEXT NOT NULL DEFAULT '', concern TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '' CHECK (grade IN ('','A','B','C','D')),
  status TEXT NOT NULL DEFAULT '新加微信',
  product_id INTEGER REFERENCES products(id),
  last_contact_on TEXT, notes TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '', next_follow_on TEXT,
  owner_id INTEGER REFERENCES users(id),
  referrer_id INTEGER REFERENCES customers(id),
  registered_on TEXT NOT NULL,
  consulted_on TEXT, grade_a_on TEXT, chk4_on TEXT, deposit_on TEXT, enrolled_on TEXT,
  remark TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_customers_follow ON customers(next_follow_on);
CREATE INDEX idx_customers_owner ON customers(owner_id);
CREATE INDEX idx_customers_registered ON customers(registered_on);
CREATE INDEX idx_customers_referrer ON customers(referrer_id);

CREATE TABLE followups (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'note',
  summary TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '', next_follow_on TEXT,
  grade TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_followups_customer ON followups(customer_id, at);

CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL UNIQUE REFERENCES customers(id),
  product_id INTEGER REFERENCES products(id),
  owner_id INTEGER REFERENCES users(id),
  enrolled_on TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT '资料准备',
  next_action TEXT NOT NULL DEFAULT '', next_action_on TEXT,
  docs_status TEXT NOT NULL DEFAULT '', docs_missing TEXT NOT NULL DEFAULT '',
  k1_exam_on TEXT, k1_result TEXT NOT NULL DEFAULT '',
  k2_booking TEXT NOT NULL DEFAULT '', k2_exam_on TEXT, k2_result TEXT NOT NULL DEFAULT '',
  k3_exam_on TEXT, k3_result TEXT NOT NULL DEFAULT '',
  k4_exam_on TEXT, k4_result TEXT NOT NULL DEFAULT '',
  license_on TEXT,
  visit_smooth TEXT NOT NULL DEFAULT '', visit_hard TEXT NOT NULL DEFAULT '', visit_worry TEXT NOT NULL DEFAULT '',
  refer_willing TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_students_next ON students(next_action_on);
CREATE TABLE student_checks (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  done_at TEXT NOT NULL,
  done_by INTEGER REFERENCES users(id),
  PRIMARY KEY (student_id, key)
);
CREATE TABLE issues (
  id INTEGER PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  occurred_on TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', contacted TEXT NOT NULL DEFAULT '',
  eta_on TEXT, solved_on TEXT, revisit_ok INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '处理中',
  owner_id INTEGER REFERENCES users(id),
  remark TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE payouts (
  id INTEGER PRIMARY KEY,
  referrer_id INTEGER NOT NULL REFERENCES customers(id),
  amount REAL NOT NULL, paid_on TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE daily_stats (
  day TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  exposure INTEGER, wechat_adds INTEGER, summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, user_id)
);
CREATE TABLE weekly_reviews (
  week_start TEXT PRIMARY KEY,
  drop_step TEXT NOT NULL DEFAULT '', script_change TEXT NOT NULL DEFAULT '',
  channel_change TEXT NOT NULL DEFAULT '', synced INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, updated_by INTEGER REFERENCES users(id)
);
CREATE TABLE review_cases (
  week_start TEXT NOT NULL, kind INTEGER NOT NULL,
  customer TEXT NOT NULL DEFAULT '', worry TEXT NOT NULL DEFAULT '', said TEXT NOT NULL DEFAULT '',
  stopped_at TEXT NOT NULL DEFAULT '', change_next TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (week_start, kind)
);
CREATE TABLE costs (
  id INTEGER PRIMARY KEY,
  spent_on TEXT NOT NULL, channel_id INTEGER REFERENCES channels(id),
  amount REAL NOT NULL, purpose TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);
"""

MIGRATIONS = [SCHEMA_V1]  # append new SQL scripts here; they run once, in order


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH[0], timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 8000")
    return conn


def init(path):
    """Create or upgrade the database file."""
    DB_PATH[0] = path
    new = not os.path.exists(path)
    conn = connect(path)
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        for number, script in enumerate(MIGRATIONS, 1):
            if number > version:
                conn.executescript("BEGIN;\n" + script + "\nPRAGMA user_version = %d;\nCOMMIT;" % number)
        conn.commit()
    finally:
        conn.close()
    if new:
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    return new


def _open():
    return connect()


def _close(conn, ok):
    try:
        if ok:
            conn.commit()
        else:
            conn.rollback()
    finally:
        conn.close()


web.db_open[0] = _open
web.db_close[0] = _close


# ---- helpers bound to the current request's connection
def conn():
    return web.local.req.db


def rows(sql, *args):
    return conn().execute(sql, args).fetchall()


def row(sql, *args):
    return conn().execute(sql, args).fetchone()


def val(sql, *args):
    r = conn().execute(sql, args).fetchone()
    return r[0] if r else None


def run(sql, *args):
    return conn().execute(sql, args)


def insert(table, **values):
    cols = list(values.keys())
    sql = "INSERT INTO %s (%s) VALUES (%s)" % (table, ",".join(cols), ",".join("?" for _ in cols))
    return conn().execute(sql, [values[c] for c in cols]).lastrowid


def update(table, where_id, **values):
    cols = list(values.keys())
    sql = "UPDATE %s SET %s WHERE id = ?" % (table, ",".join("%s = ?" % c for c in cols))
    conn().execute(sql, [values[c] for c in cols] + [where_id])
