# -*- coding: utf-8 -*-
"""Built-in starting content, inserted once when the system is initialised."""
from . import consts, core, db


def seed_defaults():
    now = core.now_s()
    if db.val("SELECT COUNT(*) FROM channels") == 0:
        for i, (name, code, kind, how) in enumerate(consts.DEFAULT_CHANNELS):
            db.insert("channels", name=name, code=code, kind=kind, how=how, sort=i)
    if db.val("SELECT COUNT(*) FROM topics") == 0:
        for title, worry in consts.DEFAULT_TOPICS:
            db.insert("topics", title=title, worry=worry, created_at=now)
    if db.val("SELECT COUNT(*) FROM scripts") == 0:
        for i, (grp, scene, when_use, body, tips) in enumerate(consts.DEFAULT_SCRIPTS):
            db.insert("scripts", grp=grp, scene=scene, when_use=when_use, body=body, tips=tips, sort=i, updated_at=now)
