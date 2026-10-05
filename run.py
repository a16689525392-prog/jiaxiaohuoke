#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""驾校招生业务系统 — entry point.

    python3 run.py                         start the web server
    python3 run.py setup-code              show the one-time code for the first-run setup page
    python3 run.py reset-password NAME     set a new password for an account
    python3 run.py create-admin NAME       add another administrator
    python3 run.py backup                  write a database backup now
    python3 run.py restore FILE            replace all data with a backup (the current data is backed up first)
    python3 run.py version

Settings come from environment variables:
    JX_DATA_DIR   where the database and backups live   (default: ./data next to this file)
    JX_HOST       address to listen on                  (default: 0.0.0.0, i.e. the whole local network)
    JX_PORT       port                                  (default: 8000)
    JX_TZ_OFFSET  hours east of UTC used for "today"    (default: 8)
    JX_ALLOW_PUBLIC  set to 1 to accept connections from public internet addresses (default: refused;
                     the system is meant for a local network and speaks plain http)
"""
import getpass
import logging
import os
import signal
import sys
import types

if sys.version_info < (3, 8):
    sys.exit("需要 Python 3.8 或更高版本，当前是 %s。" % sys.version.split()[0])
try:
    import sqlite3
except ImportError:
    sys.exit("这个 Python 没有带 sqlite3 模块。Ubuntu 上运行：sudo apt install python3 libsqlite3-0")
if sqlite3.sqlite_version_info < (3, 24):
    sys.exit("需要 SQLite 3.24 或更高版本，当前是 %s。Ubuntu 20.04 及以后的系统都满足。" % sqlite3.sqlite_version)

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)


def _env(name, default):
    value = os.environ.get(name, "").strip()
    return value if value else default


def _configure():
    from app import core

    data_dir = os.path.abspath(_env("JX_DATA_DIR", os.path.join(ROOT, "data")))
    try:
        core.CONFIG["tz_offset"] = float(_env("JX_TZ_OFFSET", "8"))
    except ValueError:
        sys.exit("JX_TZ_OFFSET 必须是数字，例如 8。")
    core.CONFIG["debug"] = _env("JX_DEBUG", "") == "1"
    from app import web
    web.ALLOW_PUBLIC[0] = _env("JX_ALLOW_PUBLIC", "") == "1"
    core.CONFIG["fake_today"] = _env("JX_FAKE_TODAY", "") or None
    return data_dir


def _cli_context():
    """Give command-line tasks the same database helpers the web handlers use."""
    from app import db, web

    conn = db.connect()
    web.local.req = types.SimpleNamespace(db=conn, user=None, session=None, flashes=[], cookies={}, query=None)
    return conn


def _ask_password():
    from app import auth

    while True:
        pw = getpass.getpass("新密码（至少 8 位）：")
        problem = auth.password_problem(pw)
        if problem:
            print(problem)
            continue
        if pw != getpass.getpass("再输一次："):
            print("两次输入的不一样。")
            continue
        return pw


def main(argv):
    os.umask(0o077)   # everything this program creates (database, backups, the setup code) is private to its account
    command = argv[1] if len(argv) > 1 else "serve"
    if command in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    data_dir = _configure()
    from app import auth, backup, core, create_app, db, web

    if command == "version":
        print(core.VERSION)
        return 0

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    log = logging.getLogger("jiaxiao")
    try:
        create_app(data_dir)
    except PermissionError as e:
        sys.exit("没有权限读写数据目录 %s：%s" % (data_dir, e))

    if command == "serve":
        host = _env("JX_HOST", "0.0.0.0")
        try:
            port = int(_env("JX_PORT", "8000"))
        except ValueError:
            sys.exit("JX_PORT 必须是数字。")
        conn = _cli_context()
        try:
            first_run = not auth.has_users()
        finally:
            conn.close()
            web.local.req = None
        if first_run:
            log.info("还没有任何账号。打开网页完成初始化，初始化口令：%s", auth.ensure_setup_code())
        try:
            httpd = web.serve(host, port)
        except OSError as e:
            sys.exit("端口 %s 无法监听：%s。可以用 JX_PORT 换一个端口。" % (port, e))
        backup.start_scheduler()
        log.info("%s %s 已启动：http://%s:%d  数据目录：%s", core.APP_NAME, core.VERSION,
                 "127.0.0.1" if host in ("0.0.0.0", "", "::") else host, port, data_dir)
        if web.ALLOW_PUBLIC[0]:
            log.warning("已允许公网地址访问（JX_ALLOW_PUBLIC=1）。本系统使用明文 http，请确认前面有 HTTPS 和访问控制。")
        else:
            log.info("只接受内网和本机的访问，来自公网地址的请求会被拒绝。")
        def _stop(signum, frame):
            raise KeyboardInterrupt

        # "systemctl stop" and "docker stop" send SIGTERM.  Handle it explicitly: a process that is number 1
        # in a container ignores signals it has no handler for, and would be killed the hard way after a wait.
        signal.signal(signal.SIGTERM, _stop)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            log.info("正在退出")
        finally:
            httpd.server_close()
        return 0

    if command == "setup-code":
        conn = _cli_context()
        try:
            if auth.has_users():
                print("系统已经初始化过了，不再需要初始化口令。")
            else:
                print(auth.ensure_setup_code())
        finally:
            conn.close()
        return 0

    if command in ("reset-password", "create-admin"):
        if len(argv) < 3:
            sys.exit("用法：python3 run.py %s 用户名" % command)
        name = argv[2]
        conn = _cli_context()
        try:
            user = db.row("SELECT * FROM users WHERE username = ?", name)
            if command == "reset-password":
                if not user:
                    sys.exit("没有这个用户名：%s" % name)
                pw = _ask_password()
                db.run("UPDATE users SET password_hash = ?, active = 1 WHERE id = ?", auth.hash_password(pw), user["id"])
                db.run("DELETE FROM sessions WHERE user_id = ?", user["id"])
                print("密码已重置，账号已启用。")
            else:
                if user:
                    sys.exit("用户名已存在：%s" % name)
                if not auth.valid_username(name):
                    sys.exit("用户名 2–32 位，可以用字母、数字、中文、下划线、点和短横线。")
                pw = _ask_password()
                auth.create_user(name, name, pw, "admin")
                from app import seed
                seed.seed_defaults()
                try:
                    os.remove(auth.setup_code_path())
                except OSError:
                    pass
                print("管理员账号已创建：%s" % name)
            conn.commit()
        finally:
            conn.close()
        return 0

    if command == "backup":
        path = backup.backup_now()
        print("已备份到 %s" % path)
        return 0

    if command == "restore":
        if len(argv) < 3:
            sys.exit("用法：python3 run.py restore 备份文件")
        source = argv[2]
        if not os.path.exists(source) and os.sep not in source:   # a bare file name means one of our own backups
            source = os.path.join(backup.backup_dir(), source)
        problem = backup.check_backup(source)
        if problem:
            sys.exit(problem)
        if os.path.abspath(source) == os.path.abspath(db.DB_PATH[0]):
            sys.exit("这就是正在使用的数据库，不需要恢复。")
        if "--yes" not in argv[3:]:
            try:
                answer = input("现在的全部数据会被 %s 里的内容替换（替换前会自动再备份一次）。输入 yes 继续：" % os.path.basename(source))
            except EOFError:      # not at a terminal, so nobody can answer
                answer = ""
                print("\n没有收到确认。在脚本里使用时，在命令最后加上 --yes。")
            if answer.strip().lower() != "yes":
                print("已取消，什么都没改。")
                return 1
        saved = backup.backup_now(prefix="before-restore")
        backup.restore_from(source)
        print("已恢复。恢复前的数据另存在 %s" % saved)
        print("所有人需要重新登录。")
        return 0

    sys.exit("不认识的命令：%s\n\n%s" % (command, __doc__))


if __name__ == "__main__":
    sys.exit(main(sys.argv))
