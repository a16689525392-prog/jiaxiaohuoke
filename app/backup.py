# -*- coding: utf-8 -*-
"""Database backups: a consistent copy on demand, plus one automatic copy per day."""
import glob
import logging
import os
import sqlite3
import threading
import time
from urllib.parse import quote

from . import core, db

log = logging.getLogger("jiaxiao")
KEEP = 30               # automatic backups to keep
DAILY_AFTER_HOUR = 3    # make the daily copy at the first check after 03:00 local time


def backup_dir():
    path = os.path.join(core.CONFIG["data_dir"], "backups")
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


def _read_only(path):
    """Open a backup file strictly for reading; `immutable` keeps SQLite from creating -wal/-shm files next to it."""
    return sqlite3.connect("file:%s?mode=ro&immutable=1" % quote(os.path.abspath(path)), uri=True)


def backup_to(path):
    """Write a consistent snapshot of the live database to `path` (safe while the server runs)."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)   # private from the first byte, never overwrites
    os.close(fd)
    try:
        src = sqlite3.connect(db.DB_PATH[0], timeout=30)
        try:
            dst = sqlite3.connect(path)
            try:
                src.backup(dst)
                # a backup is a single ordinary file: no write-ahead log to carry along when it is copied elsewhere
                dst.execute("PRAGMA journal_mode = DELETE")
            finally:
                dst.close()
        finally:
            src.close()
    except BaseException:      # e.g. the disk is full: do not leave half a file behind that looks like a backup
        for leftover in (path, path + "-journal", path + "-wal", path + "-shm"):
            try:
                os.remove(leftover)
            except OSError:
                pass
        raise
    return path


def check_backup(path):
    """Return '' when `path` is a usable backup of this system, otherwise what is wrong with it."""
    if not os.path.isfile(path):
        return "找不到这个文件：%s" % path
    try:
        conn = _read_only(path)
        try:
            if conn.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                return "这个文件已经损坏，不能用来恢复。"
            tables = set(r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'"))
            if not {"users", "customers", "students", "settings"} <= tables:
                return "这不是本系统的备份文件。"
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version > len(db.MIGRATIONS):
                return "这个备份来自更新的版本，请先把程序升级到同样的版本再恢复。"
        finally:
            conn.close()
    except sqlite3.Error:
        return "这不是一个数据库备份文件。"
    return ""


def restore_from(path):
    """Replace the live database with the backup at `path`.

    Goes through SQLite's own copy mechanism rather than swapping files, so it is safe with the
    write-ahead log and works even while the server is running.
    """
    src = _read_only(path)
    try:
        dst = sqlite3.connect(db.DB_PATH[0], timeout=30)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    db.init(db.DB_PATH[0])   # a backup from an older version gets upgraded right away
    conn = sqlite3.connect(db.DB_PATH[0], timeout=30)
    try:
        conn.execute("DELETE FROM sessions")   # logins recorded in the backup are stale: everyone signs in again
        conn.commit()
    finally:
        conn.close()


def backup_now(prefix="jiaxiao"):
    stamp = core.now().strftime("%Y%m%d-%H%M%S")
    for attempt in range(60):       # two backups within the same second get different names
        name = "%s-%s.db" % (prefix, stamp if attempt == 0 else
                             (core.now() + core.dt.timedelta(seconds=attempt)).strftime("%Y%m%d-%H%M%S"))
        try:
            path = backup_to(os.path.join(backup_dir(), name))
            break
        except FileExistsError:
            continue
    else:
        raise RuntimeError("could not find a free backup file name")
    prune()
    return path


def list_backups():
    files = sorted(glob.glob(os.path.join(backup_dir(), "jiaxiao-*.db")), reverse=True)
    return [(os.path.basename(f), os.path.getsize(f)) for f in files]


def prune():
    files = sorted(glob.glob(os.path.join(backup_dir(), "jiaxiao-*.db")), reverse=True)
    for old in files[KEEP:]:
        try:
            os.remove(old)
        except OSError:
            pass


def _has_backup_for(day):
    return bool(glob.glob(os.path.join(backup_dir(), "jiaxiao-%s-*.db" % day.strftime("%Y%m%d"))))


def _loop():
    while True:
        try:
            now = core.now()
            if now.hour >= DAILY_AFTER_HOUR and not _has_backup_for(now.date()):
                path = backup_now()
                log.info("每日备份完成：%s", path)
                conn = db.connect()
                try:
                    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (core.now_s(),))
                    conn.commit()
                finally:
                    conn.close()
        except Exception:
            log.exception("每日备份失败")
        time.sleep(1800)


def start_scheduler():
    t = threading.Thread(target=_loop, name="backup", daemon=True)
    t.start()
    return t
