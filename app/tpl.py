# -*- coding: utf-8 -*-
"""A small template engine with HTML auto-escaping (standard library only).

Syntax
    {{ expr }}      value, HTML-escaped
    {{! expr }}     value, inserted as-is (only for markup built by trusted code)
    % statement     one line of Python; blocks are closed with "% end"
    % rebase('base.tpl', title=...)   wrap this template in a layout; the layout
                                      receives the rendered page as `body`
    {{! include('part.tpl', x=1) }}   render another template in place
"""
import html
import os
import re
import threading

TEMPLATE_DIR = [None]
RELOAD = [False]
GLOBALS = {}

_cache = {}
_lock = threading.Lock()
_OPEN = re.compile(r"^(if|for|while|with|try|def)\b")
_MID = re.compile(r"^(elif|else|except|finally)\b")
_EXPR = re.compile(r"\{\{(.*?)\}\}")


class Markup(str):
    """A string that is already safe HTML."""
    __slots__ = ()


def esc(value):
    if value is None:
        return ""
    if isinstance(value, Markup):
        return value
    return html.escape(str(value), quote=True)


def raw(value):
    return "" if value is None else str(value)


class TemplateError(Exception):
    pass


def _compile(source, name):
    lines = []
    depth = 0

    def emit(code):
        lines.append("    " * depth + code)

    for number, line in enumerate(source.split("\n"), 1):
        stripped = line.lstrip()
        if stripped.startswith("%") and not stripped.startswith("%%"):
            code = stripped[1:].strip()
            if not code or code.startswith("#"):
                continue
            if code == "end":
                depth -= 1
                if depth < 0:
                    raise TemplateError("%s:%d: unexpected '% end'" % (name, number))
            elif _MID.match(code):
                depth -= 1
                emit(code)
                depth += 1
                emit("pass")
            else:
                emit(code)
                if code.endswith(":") and _OPEN.match(code):
                    depth += 1
                    emit("pass")
            continue
        if stripped.startswith("%%"):
            line = line.replace("%%", "%", 1)
        parts = _EXPR.split(line + "\n")
        for i, part in enumerate(parts):
            if i % 2 == 0:
                if part:
                    emit("_a(%r)" % part)
            else:
                expr = part.strip()
                if expr.startswith("!"):
                    emit("_a(_raw(%s))" % expr[1:].strip())
                else:
                    emit("_a(_esc(%s))" % expr)
    if depth != 0:
        raise TemplateError("%s: %d block(s) not closed with '%% end'" % (name, depth))
    try:
        return compile("\n".join(lines), name, "exec")
    except SyntaxError as e:
        raise TemplateError("%s: %s (generated line %s)" % (name, e.msg, e.lineno))


def _load(name):
    path = os.path.join(TEMPLATE_DIR[0], name)
    with _lock:
        cached = _cache.get(name)
        if cached and not RELOAD[0]:
            return cached[1]
        mtime = os.path.getmtime(path)
        if cached and cached[0] == mtime:
            return cached[1]
        with open(path, encoding="utf-8") as fh:
            code = _compile(fh.read(), name)
        _cache[name] = (mtime, code)
        return code


def render(name, **context):
    code = _load(name)
    out = []
    state = {}
    ns = dict(GLOBALS)
    ns.update(context)

    def rebase(layout, **kw):
        state["layout"] = (layout, kw)

    def include(part, **kw):
        merged = dict(context)
        merged.update(kw)
        return Markup(render(part, **merged))

    ns.update(_a=out.append, _esc=esc, _raw=raw, rebase=rebase, include=include, Markup=Markup,
              get=lambda key, default=None: ns.get(key, default))
    exec(code, ns)
    text = "".join(out)
    if "layout" in state:
        layout, kw = state["layout"]
        merged = dict(context)
        merged.update(kw)
        merged["body"] = Markup(text)
        return render(layout, **merged)
    return text
