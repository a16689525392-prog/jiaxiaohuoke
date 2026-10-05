# -*- coding: utf-8 -*-
"""驾校招生业务系统 — application package (Python standard library only)."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def create_app(data_dir):
    """Prepare paths and the database, register every route and return the WSGI application."""
    from . import core, db, web

    os.makedirs(data_dir, exist_ok=True)
    core.setup_paths(ROOT, data_dir)
    db.init(os.path.join(data_dir, "jiaxiao.db"))
    from . import auth  # noqa: F401  (registers hooks and routes)
    from . import (v_admin, v_channels, v_customers, v_data, v_home, v_products,  # noqa: F401
                   v_referrals, v_scripts, v_students)

    if not any(r.pattern == "/healthz" for r in web.ROUTES):
        @web.get("/healthz", public=True)
        def healthz(request):
            return web.Response("ok", 200, "text/plain; charset=utf-8")

    return web.application
