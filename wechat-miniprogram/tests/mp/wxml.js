// 开发用：一个很小的 WXML 解析器和渲染器，用来在本地检查页面。
// 只支持这个项目用到的写法：{{表达式}}、wx:if / wx:elif / wx:else、wx:for、<block>、<include>。
// 故意比真的更严格：表达式里出现函数调用、wx:for 没有 wx:key、<include> 找不到文件，都直接报错。
'use strict';

const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------------ 解析
function parse(source, file) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const n = source.length;
  function fail(msg) {
    const line = source.slice(0, i).split('\n').length;
    throw new Error(file + ':' + line + ' ' + msg);
  }
  while (i < n) {
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i);
      if (end < 0) { fail('注释没有结束'); }
      i = end + 3;
      continue;
    }
    if (source[i] === '<' && source[i + 1] === '/') {
      const end = source.indexOf('>', i);
      const tag = source.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top.tag !== tag) { fail('标签没有配对：</' + tag + '>，这里应该结束的是 <' + (top && top.tag) + '>'); }
      i = end + 1;
      continue;
    }
    if (source[i] === '<') {
      let j = i + 1;
      while (j < n && /[\w-]/.test(source[j])) { j++; }
      const tag = source.slice(i + 1, j);
      if (!tag) { fail('看不懂的 <'); }
      const attrs = {};
      let selfClose = false;
      for (;;) {
        while (j < n && /\s/.test(source[j])) { j++; }
        if (source[j] === '/' && source[j + 1] === '>') { selfClose = true; j += 2; break; }
        if (source[j] === '>') { j++; break; }
        let k = j;
        while (k < n && /[\w:.-]/.test(source[k])) { k++; }
        const name = source.slice(j, k);
        if (!name) { i = j; fail('看不懂的属性'); }
        if (name in attrs) { i = j; fail('属性写了两次：' + name); }
        if (source[k] !== '=') { attrs[name] = true; j = k; continue; }
        if (source[k + 1] !== '"') { i = k; fail('属性值要用双引号'); }
        const close = source.indexOf('"', k + 2);
        if (close < 0) { i = k; fail('属性值的引号没有结束'); }
        attrs[name] = source.slice(k + 2, close);
        j = close + 1;
      }
      const node = { tag: tag, attrs: attrs, children: [], file: file, line: source.slice(0, i).split('\n').length };
      stack[stack.length - 1].children.push(node);
      if (!selfClose) { stack.push(node); }
      i = j;
      continue;
    }
    let j = source.indexOf('<', i);
    if (j < 0) { j = n; }
    const text = source.slice(i, j);
    if (text.trim()) { stack[stack.length - 1].children.push({ text: text.replace(/\s*\n\s*/g, '') }); }
    i = j;
  }
  if (stack.length !== 1) { fail('标签没有结束：<' + stack[stack.length - 1].tag + '>'); }
  return root;
}

const cache = new Map();
function load(file) {
  if (!cache.has(file)) { cache.set(file, parse(fs.readFileSync(file, 'utf8'), file)); }
  return cache.get(file);
}

// ------------------------------------------------------------------ 表达式
const compiled = new Map();
function compile(expr, where) {
  if (!compiled.has(expr)) {
    const bare = expr.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
    if (/[\w\]\)]\s*\(/.test(bare)) { throw new Error(where + ' 表达式里不能调用函数：{{' + expr + '}}'); }
    if (/=>|`|\?\.|\bnew\b|\bfunction\b|[^=!<>]=[^=]/.test(bare)) { throw new Error(where + ' 表达式里有 WXML 不支持的写法：{{' + expr + '}}'); }
    let fn;
    try { fn = new Function('__s', 'with (__s) { return (' + expr + '); }'); } catch (e) { throw new Error(where + ' 表达式写错了：{{' + expr + '}} ' + e.message); }
    compiled.set(expr, fn);
  }
  return compiled.get(expr);
}

function scopeOf(data, locals) {
  return new Proxy({}, {
    has: function (t, k) { return typeof k === 'string'; },
    get: function (t, k) {
      if (typeof k !== 'string') { return undefined; }
      if (locals && Object.prototype.hasOwnProperty.call(locals, k)) { return locals[k]; }
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : undefined;
    },
  });
}

function evaluate(expr, ctx, where) {
  try {
    return compile(expr.trim(), where)(ctx.scope);
  } catch (e) {
    if (e instanceof TypeError) { return undefined; }     // 读 undefined 的属性：WXML 里得到 undefined，不报错
    throw e;
  }
}

function show(v) { return v === undefined || v === null ? '' : String(v); }

// 属性值或文字：整个是一个 {{}} 时保留原来的类型，否则拼成字符串
function interpolate(raw, ctx, where, kind) {
  if (raw === true) { return true; }
  const parts = String(raw).split(/(\{\{[\s\S]*?\}\})/).filter(function (p) { return p !== ''; });
  if (parts.length === 1 && parts[0].startsWith('{{')) {
    const v = evaluate(parts[0].slice(2, -2), ctx, where);
    if (kind === 'text') { note(ctx, v, parts[0], where); return show(v); }
    return v;
  }
  return parts.map(function (p) {
    if (!p.startsWith('{{')) { return p; }
    const v = evaluate(p.slice(2, -2), ctx, where);
    if (kind === 'text' || kind === 'strict') { note(ctx, v, p, where); }
    return show(v);
  }).join('');
}

// 页面上要显示的地方算出了 undefined、null、NaN 或对象：多半是字段名写错了
function note(ctx, v, expr, where) {
  if (v === undefined || v === null || (typeof v === 'number' && isNaN(v)) || (typeof v === 'object')) {
    ctx.problems.push(where + ' ' + expr + ' 的结果是 ' + (typeof v === 'object' && v !== null ? '对象' : String(v)));
  }
}

// ------------------------------------------------------------------ 渲染成一棵“显示出来的”树
const EVENTS = /^(bind|catch)(:?)(\w+)$/;

function renderChildren(children, ctx) {
  const out = [];
  let chain = null;        // 当前这一串 wx:if / elif / else 里，前面是否已经有成立的
  children.forEach(function (node) {
    if (node.text !== undefined) {
      chain = null;
      out.push({ text: interpolate(node.text, ctx, ctx.file + ' 文字', 'text') });
      return;
    }
    const a = node.attrs;
    const where = node.file + ':' + node.line + ' <' + node.tag + '>';
    const hasIf = 'wx:if' in a;
    const hasElif = 'wx:elif' in a;
    const hasElse = 'wx:else' in a;
    if ('wx:for' in a) {
      chain = null;
      if (!('wx:key' in a)) { throw new Error(where + ' wx:for 没有写 wx:key'); }
      const list = interpolate(a['wx:for'], ctx, where);
      if (list === undefined || list === null) { ctx.problems.push(where + ' wx:for 的数据是 ' + String(list)); return; }
      if (!Array.isArray(list)) { throw new Error(where + ' wx:for 的数据不是数组'); }
      const itemName = a['wx:for-item'] || 'item';
      const indexName = a['wx:for-index'] || 'index';
      const keys = new Set();
      list.forEach(function (item, index) {
        const locals = Object.assign({}, ctx.locals);
        locals[itemName] = item;
        locals[indexName] = index;
        const sub = Object.assign({}, ctx, { locals: locals, scope: scopeOf(ctx.data, locals) });
        const key = a['wx:key'] === '*this' ? item : (item === null || item === undefined ? undefined : item[a['wx:key']]);
        if (key === undefined || key === null || typeof key === 'object') { ctx.problems.push(where + ' wx:key="' + a['wx:key'] + '" 取不到值'); }
        else if (keys.has(String(key))) { ctx.problems.push(where + ' wx:key 有重复：' + key); }
        keys.add(String(key));
        if (hasIf && !interpolate(a['wx:if'], sub, where)) { return; }
        renderNode(node, sub, where).forEach(function (x) { out.push(x); });
      });
      return;
    }
    if (hasIf) {
      chain = { done: !!interpolate(a['wx:if'], ctx, where) };
      if (chain.done) { renderNode(node, ctx, where).forEach(function (x) { out.push(x); }); }
      return;
    }
    if (hasElif || hasElse) {
      if (!chain) { throw new Error(where + ' wx:elif / wx:else 前面没有紧挨着的 wx:if'); }
      if (!chain.done && (hasElse || interpolate(a['wx:elif'], ctx, where))) {
        chain.done = true;
        renderNode(node, ctx, where).forEach(function (x) { out.push(x); });
      }
      if (hasElse) { chain = null; }
      return;
    }
    chain = null;
    renderNode(node, ctx, where).forEach(function (x) { out.push(x); });
  });
  return out;
}

function renderNode(node, ctx, where) {
  const a = node.attrs;
  if (node.tag === 'include') {
    const target = path.resolve(path.dirname(node.file), a.src);
    if (!fs.existsSync(target)) { throw new Error(where + ' include 的文件不存在：' + a.src); }
    return renderChildren(load(target).children, Object.assign({}, ctx, { file: target }));
  }
  if (node.tag === 'block') { return renderChildren(node.children, ctx); }
  const out = { tag: node.tag, attrs: {}, dataset: {}, events: {}, children: [], where: where };
  Object.keys(a).forEach(function (name) {
    if (name.startsWith('wx:')) { return; }
    const ev = EVENTS.exec(name);
    if (ev) { out.events[ev[3]] = a[name]; return; }
    const strict = name === 'class' || name === 'data-url' ? 'strict' : undefined;
    const value = interpolate(a[name], ctx, where + ' ' + name, strict);
    if (name.startsWith('data-')) {
      out.dataset[name.slice(5).replace(/-(\w)/g, function (m, c) { return c.toUpperCase(); })] = value;
    } else {
      out.attrs[name] = value;
    }
  });
  if (out.attrs.hidden) { out.hidden = true; }
  out.children = renderChildren(node.children, ctx);
  return [out];
}

function render(file, data) {
  const ctx = { data: data, locals: {}, scope: scopeOf(data, {}), problems: [], file: file };
  const children = renderChildren(load(file).children, ctx);
  return { tag: '#root', attrs: {}, dataset: {}, events: {}, children: children, problems: ctx.problems };
}

// ------------------------------------------------------------------ 在树里找东西
function textOf(node) {
  if (node.text !== undefined) { return node.text; }
  if (node.hidden) { return ''; }
  return node.children.map(textOf).join('');
}

function walk(node, fn, parents) {
  const chain = parents || [];
  if (node.tag) { fn(node, chain); }
  (node.children || []).forEach(function (c) { if (c.tag) { walk(c, fn, chain.concat([node])); } });
}

// 源文件里用到的所有事件处理函数名（不管当前显示不显示）
function handlersIn(file, seen) {
  const names = new Set();
  const done = seen || new Set();
  if (done.has(file)) { return names; }
  done.add(file);
  (function visit(node) {
    if (!node.tag) { return; }
    Object.keys(node.attrs).forEach(function (name) { if (EVENTS.test(name)) { names.add(node.attrs[name]); } });
    if (node.tag === 'include') {
      handlersIn(path.resolve(path.dirname(file), node.attrs.src), done).forEach(function (x) { names.add(x); });
    }
    node.children.forEach(visit);
  })(load(file));
  return names;
}

function tagsIn(file) {
  const tags = new Set();
  (function visit(node) { if (node.tag) { tags.add(node.tag); node.children.forEach(visit); } })(load(file));
  return tags;
}

// ------------------------------------------------------------------ 输出成 HTML（给本地截图用）
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function toHtml(node, shown) {
  if (node.text !== undefined) { return esc(node.text); }
  if (node.tag === '#root') { return node.children.map(function (c) { return toHtml(c, shown); }).join(''); }
  const cls = node.attrs.class ? ' class="' + esc(node.attrs.class) + '"' : '';
  const style = node.attrs.style ? ' style="' + esc(node.attrs.style) + '"' : '';
  const hidden = node.hidden ? ' hidden' : '';
  if (node.tag === 'input' || node.tag === 'textarea') {
    const value = shown ? shown(node) : show(node.attrs.value);
    const ph = show(node.attrs.placeholder);
    return '<div' + cls.replace('class="', 'class="mp-' + node.tag + ' ') + style + hidden + '>' + (value ? esc(value) : '<span class="placeholder">' + esc(ph) + '</span>') + '</div>';
  }
  const tag = 'mp-' + node.tag;
  return '<' + tag + cls + style + hidden + '>' + node.children.map(function (c) { return toHtml(c, shown); }).join('') + '</' + tag + '>';
}

// WXSS -> CSS：rpx 换成 px（按 375 宽），标签选择器换成 mp- 前缀
function toCss(wxss) {
  return wxss
    .replace(/(-?\d*\.?\d+)rpx/g, function (m, num) { return (Number(num) / 2) + 'px'; })
    .replace(/(^|[\s,}>+])(page|view|text|input|textarea|picker|scroll-view)(?=[\s,{.:>+])/g, function (m, pre, tag) {
      return pre + (tag === 'page' ? 'body' : (tag === 'input' || tag === 'textarea' ? '.mp-' + tag : 'mp-' + tag));
    });
}

module.exports = { parse: parse, load: load, render: render, textOf: textOf, walk: walk, handlersIn: handlersIn, tagsIn: tagsIn, toHtml: toHtml, toCss: toCss };
