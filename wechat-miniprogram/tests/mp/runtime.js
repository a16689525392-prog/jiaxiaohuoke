// 开发用：在 Node 里把小程序“跑起来”——假的 wx、App()、Page()，页面栈，以及按界面上的文字去点、去输入。
// 云函数调用接到本地的假数据库上（tests/mock-cloud.js），所以这是小程序端 + 云函数一起跑的测试。
'use strict';

const fs = require('fs');
const path = require('path');
const mock = require('../mock-cloud');
const cloudApi = require('../../cloudfunctions/api/index');
const wxml = require('./wxml');

const ROOT = path.resolve(__dirname, '../../miniprogram');
const APP_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const TAB_PAGES = APP_JSON.tabBar.list.map(function (t) { return t.pagePath; });

const registry = {};          // 页面路径 -> Page() 收到的定义
let registering = '';
let appDef = null;
let rt = null;                // 当前这一个运行环境

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

global.App = function (def) { appDef = def; };
global.Page = function (def) { registry[registering] = def; };
global.getApp = function () { return rt.app; };
global.getCurrentPages = function () { return rt.stack.slice(); };

function loadPage(route) {
  if (!registry[route]) {
    if (APP_JSON.pages.indexOf(route) < 0) { throw new Error('app.json 里没有登记这个页面：' + route); }
    registering = route;
    require(path.join(ROOT, route + '.js'));
    if (!registry[route]) { throw new Error(route + '.js 没有调用 Page()'); }
  }
  return registry[route];
}

function parseUrl(url) {
  const parts = String(url).split('?');
  const query = {};
  (parts[1] || '').split('&').filter(Boolean).forEach(function (kv) {
    const i = kv.indexOf('=');
    query[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
  });
  return { route: parts[0].replace(/^\//, ''), query: query };
}

function setPath(obj, pathText, value) {
  const keys = [];
  pathText.replace(/[^.[\]]+/g, function (k) { keys.push(/^\d+$/.test(k) ? Number(k) : k); });
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] === undefined || cur[keys[i]] === null) { cur[keys[i]] = typeof keys[i + 1] === 'number' ? [] : {}; }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

function Runtime(openid) {
  rt = this;
  this.openid = openid;
  this.stack = [];
  this.tabs = {};
  this.storage = {};
  this.pending = 0;
  this.problems = [];           // 渲染时发现的可疑之处、setData 的不规范用法
  this.toasts = [];
  this.modals = [];
  this.answers = [];            // 预先排好的弹窗回答：true / false / { content } / { tapIndex }
  this.clipboard = null;
  this.clipboardFails = false;
  this.calls = [];
  const self = this;

  const wx = {
    cloud: {
      init: function () {},
      callFunction: function (opts) {
        self.pending++;
        self.calls.push(opts.data.action);
        const done = function () { self.pending--; };
        return new Promise(function (resolve, reject) {
          setImmediate(function () {
            if (self.offline) { done(); reject({ errMsg: 'cloud.callFunction:fail timeout' }); return; }
            mock.as(self.openid);
            if (opts.name !== 'api') { done(); reject({ errMsg: 'FUNCTION_NOT_FOUND' }); return; }
            cloudApi.main(clone(opts.data)).then(function (result) { done(); resolve({ result: clone(result) }); }, function (e) { done(); reject(e); });
          });
        });
      },
    },
    showToast: function (o) { self.toasts.push(o.title); },
    showLoading: function () { self.loading = true; },
    hideLoading: function () { self.loading = false; },
    stopPullDownRefresh: function () {},
    pageScrollTo: function () {},
    setNavigationBarTitle: function (o) { if (self.top()) { self.top().__title = o.title; } },
    getStorageSync: function (k) { return self.storage[k] === undefined ? '' : self.storage[k]; },
    setStorageSync: function (k, v) { self.storage[k] = v; },
    setClipboardData: function (o) {
      if (self.clipboardFails) { if (o.fail) { o.fail({ errMsg: 'setClipboardData:fail api scope is not declared in the privacy agreement' }); } return; }
      self.clipboard = o.data;
      if (o.success) { o.success(); }
    },
    showModal: function (o) {
      self.modals.push({ title: o.title, content: o.content });
      const ans = self.answers.length ? self.answers.shift() : (o.showCancel === false ? true : null);
      if (ans === null) { throw new Error('弹出了一个没有预先回答的确认框：' + o.content); }
      const res = typeof ans === 'object' ? Object.assign({ confirm: true, cancel: false }, ans) : { confirm: !!ans, cancel: !ans };
      if (o.editable && res.content === undefined) { res.content = o.content; }
      setImmediate(function () { if (o.success) { o.success(res); } if (o.complete) { o.complete(res); } });
    },
    showActionSheet: function (o) {
      self.modals.push({ title: '菜单', content: o.itemList.join(' / ') });
      const ans = self.answers.shift();
      if (ans === undefined) { throw new Error('弹出了一个没有预先回答的菜单：' + o.itemList.join(' / ')); }
      const index = typeof ans === 'string' ? o.itemList.indexOf(ans) : ans.tapIndex;
      if (index < 0) { throw new Error('菜单里没有“' + ans + '”：' + o.itemList.join(' / ')); }
      setImmediate(function () { o.success({ tapIndex: index }); });
    },
    navigateTo: function (o) {
      if (TAB_PAGES.indexOf(parseUrl(o.url).route) >= 0) { throw new Error('navigateTo 不能去 tab 页：' + o.url); }
      if (self.stack.length >= 10) { throw new Error('页面栈超过 10 层'); }
      self.push(o.url);
    },
    redirectTo: function (o) {
      if (TAB_PAGES.indexOf(parseUrl(o.url).route) >= 0) { throw new Error('redirectTo 不能去 tab 页：' + o.url); }
      self.unload(self.stack.pop());
      self.push(o.url);
    },
    navigateBack: function () {
      if (self.stack.length < 2) { throw new Error('已经是第一页了，不能再返回'); }
      self.unload(self.stack.pop());
      self.showTop();
    },
    switchTab: function (o) {
      const u = parseUrl(o.url);
      if (o.url.indexOf('?') >= 0) { throw new Error('switchTab 的地址不能带参数：' + o.url); }
      if (TAB_PAGES.indexOf(u.route) < 0) { throw new Error('switchTab 只能去 tab 页：' + o.url); }
      while (self.stack.length) { const p = self.stack.pop(); if (TAB_PAGES.indexOf(p.route) < 0) { self.unload(p); } }
      if (self.tabs[u.route]) { self.stack.push(self.tabs[u.route]); self.showTop(); } else { self.push(o.url); self.tabs[u.route] = self.top(); }
    },
    reLaunch: function (o) {
      while (self.stack.length) { self.unload(self.stack.pop()); }
      Object.keys(self.tabs).forEach(function (k) { self.unload(self.tabs[k]); });
      self.tabs = {};
      self.push(o.url);
      if (TAB_PAGES.indexOf(self.top().route) >= 0) { self.tabs[self.top().route] = self.top(); }
    },
  };
  this.wx = wx;
  global.wx = wx;

  if (!appDef) { require(path.join(ROOT, 'app.js')); }
  this.app = Object.assign({}, appDef, { globalData: clone(appDef.globalData) });
  this.app.onLaunch();
}

Runtime.prototype.top = function () { return this.stack[this.stack.length - 1]; };

// 测试里可以同时有几个“用户”，轮到谁操作，就把全局的 wx 换成谁的
Runtime.prototype.activate = function () { rt = this; global.wx = this.wx; };

Runtime.prototype.unload = function (page) {
  if (page && !page.__gone) { page.__gone = true; if (page.onUnload) { page.onUnload(); } }
};

Runtime.prototype.push = function (url) {
  const self = this;
  const u = parseUrl(url);
  const def = loadPage(u.route);
  const page = Object.assign({}, def);
  page.route = u.route;
  page.data = clone(def.data || {});
  page.__typed = {};
  page.setData = function (patch, cb) {
    if (page.__gone) { return; }                  // 页面已经关了，迟到的结果不再画
    Object.keys(patch).forEach(function (k) {
      if (patch[k] === undefined) { self.problems.push(u.route + ' setData 把 ' + k + ' 设成了 undefined'); return; }
      setPath(page.data, k, clone(patch[k]));
    });
    self.afterRender(page);
    if (cb) { cb(); }
  };
  this.stack.push(page);
  if (page.onLoad) { page.onLoad(u.query); }
  if (page.onShow) { page.onShow(); }
  this.afterRender(page);
};

Runtime.prototype.showTop = function () {
  const page = this.top();
  if (page && page.onShow) { page.onShow(); }
};

Runtime.prototype.tree = function (page) {
  const p = page || this.top();
  const t = wxml.render(path.join(ROOT, p.route + '.wxml'), p.data);
  const self = this;
  t.problems.forEach(function (x) { if (self.problems.indexOf(x) < 0) { self.problems.push(x); } });
  return t;
};

function inputId(node) { return node.tag + '|' + (node.dataset.k !== undefined ? node.dataset.k : (node.events.input || '') + '|' + (node.attrs.placeholder || '')); }

// 每次重画以后：输入框如果还在、而且它绑定的值没变，用户打的字就还在；否则以数据为准
Runtime.prototype.afterRender = function (page) {
  const seen = {};
  wxml.walk(this.tree(page), function (node) {
    if (node.tag !== 'input' && node.tag !== 'textarea') { return; }
    const id = inputId(node);
    const base = node.attrs.value === undefined || node.attrs.value === null ? '' : String(node.attrs.value);
    const typed = page.__typed[id];
    seen[id] = typed && typed.base === base ? typed : null;
  });
  Object.keys(page.__typed).forEach(function (id) { if (!seen[id]) { delete page.__typed[id]; } });
};

Runtime.prototype.shownIn = function (page) {
  return function (node) {
    const typed = page.__typed[inputId(node)];
    return typed ? typed.text : (node.attrs.value === undefined || node.attrs.value === null ? '' : String(node.attrs.value));
  };
};

// 等所有云函数调用和它们引出的后续动作都结束
Runtime.prototype.settle = async function () {
  let quiet = 0;
  for (let i = 0; i < 5000 && quiet < 3; i++) {
    await new Promise(function (r) { setImmediate(r); });
    quiet = this.pending === 0 ? quiet + 1 : 0;
  }
  if (this.pending) { throw new Error('云函数调用一直没有结束'); }
};

Runtime.prototype.open = async function (url) {
  this.activate();
  const u = parseUrl(url);
  if (TAB_PAGES.indexOf(u.route) >= 0) { global.wx.switchTab({ url: url.split('?')[0] }); } else if (this.stack.length) { global.wx.navigateTo({ url: url }); } else { this.push(url); }
  await this.settle();
  return this.top();
};

Runtime.prototype.text = function () { return wxml.textOf(this.tree()); };

Runtime.prototype.fire = async function (node, type, detail) {
  this.activate();
  const page = this.top();
  const name = node.events[type];
  if (!name) { throw new Error(node.where + ' 没有绑定 ' + type + ' 事件'); }
  if (typeof page[name] !== 'function') { throw new Error(node.where + ' 绑定的 ' + name + ' 在页面里不存在'); }
  page[name]({ type: type, currentTarget: { dataset: clone(node.dataset) }, target: { dataset: clone(node.dataset) }, detail: detail || {} });
  await this.settle();
};

// 点一下显示着这段文字的地方（文字完全相同的优先，其次是包含）。nth 指第几个，从 0 开始。
Runtime.prototype.tap = async function (label, nth) {
  const exact = [];
  const partial = [];
  wxml.walk(this.tree(), function (node, parents) {
    if (node.hidden || parents.some(function (p) { return p.hidden; })) { return; }
    const text = wxml.textOf(node).trim();
    if (!text || text.indexOf(label) < 0) { return; }
    const chain = parents.concat([node]);
    let target = null;
    for (let i = chain.length - 1; i >= 0; i--) { if (chain[i].events && chain[i].events.tap) { target = chain[i]; break; } }
    if (!target) { return; }
    // 只认“最里面”的那个：子节点里还有同样包含这段文字的，就不算这一层
    const inner = node.children.some(function (c) { return c.tag && !c.hidden && wxml.textOf(c).indexOf(label) >= 0; });
    if (inner) { return; }
    (text === label ? exact : partial).push(target);
  });
  const found = exact.length ? exact : partial;
  if (!found.length) { throw new Error('页面上没有可以点的“' + label + '”。页面内容：' + this.text().slice(0, 300)); }
  const i = nth || 0;
  if (!found[i]) { throw new Error('“' + label + '”只有 ' + found.length + ' 处'); }
  await this.fire(found[i], 'tap');
};

Runtime.prototype.field = function (k) {
  let hit = null;
  wxml.walk(this.tree(), function (node) { if (!hit && (node.tag === 'input' || node.tag === 'textarea' || node.tag === 'picker') && node.dataset.k === k) { hit = node; } });
  if (!hit) { throw new Error('页面上没有 data-k="' + k + '" 的输入项。页面内容：' + this.text().slice(0, 200)); }
  return hit;
};

Runtime.prototype.type = async function (k, value) {
  const node = this.field(k);
  if (node.tag === 'picker') { throw new Error(k + ' 是选择框，用 pick'); }
  const max = Number(node.attrs.maxlength || 140);
  const text = max > 0 ? String(value).slice(0, max) : String(value);
  const base = node.attrs.value === undefined || node.attrs.value === null ? '' : String(node.attrs.value);
  this.top().__typed[inputId(node)] = { text: text, base: base };
  await this.fire(node, 'input', { value: text });
};

Runtime.prototype.shown = function (k) { return this.shownIn(this.top())(this.field(k)); };

// 选择框：日期直接给 'YYYY-MM-DD'；下拉给选项上显示的文字
Runtime.prototype.pick = async function (k, value) {
  const node = typeof k === 'string' ? this.field(k) : k;
  if (node.tag !== 'picker') { throw new Error('不是选择框'); }
  if (node.attrs.mode === 'date') {
    if (node.attrs.start && value < node.attrs.start) { throw new Error('日期选择框不让选 ' + node.attrs.start + ' 之前的日子'); }
    if (node.attrs.end && value > node.attrs.end) { throw new Error('日期选择框不让选 ' + node.attrs.end + ' 之后的日子'); }
    await this.fire(node, 'change', { value: value });
    return;
  }
  const range = node.attrs.range;
  if (!Array.isArray(range)) { throw new Error(node.where + ' 的 range 不是数组'); }
  const key = node.attrs['range-key'];
  const labels = range.map(function (r) { return key ? r[key] : r; });
  const index = labels.indexOf(value);
  if (index < 0) { throw new Error('选项里没有“' + value + '”：' + labels.join(' / ')); }
  await this.fire(node, 'change', { value: String(index) });
};

// 按处理函数名找选择框（给没有 data-k 的用）
Runtime.prototype.pickerBy = function (handler) {
  let hit = null;
  wxml.walk(this.tree(), function (node) { if (!hit && node.tag === 'picker' && node.events.change === handler) { hit = node; } });
  if (!hit) { throw new Error('页面上没有绑定 ' + handler + ' 的选择框'); }
  return hit;
};

Runtime.prototype.html = function () {
  const page = this.top();
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, page.route + '.json'), 'utf8'));
  const css = [path.join(ROOT, 'app.wxss'), path.join(ROOT, page.route + '.wxss')].filter(fs.existsSync).map(function (f) { return wxml.toCss(fs.readFileSync(f, 'utf8')); }).join('\n');
  const tab = TAB_PAGES.indexOf(page.route);
  const tabbar = tab < 0 ? '' : '<div class="sim-tab">' + APP_JSON.tabBar.list.map(function (t, i) { return '<div class="' + (i === tab ? 'on' : '') + '"><i></i>' + t.text + '</div>'; }).join('') + '</div>';
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=375"><style>' +
    'body{margin:0;padding:44px 0 ' + (tab < 0 ? 0 : 56) + 'px;min-height:100vh;box-sizing:border-box}' +
    'mp-view,mp-picker,mp-scroll-view{display:block}mp-text{display:inline}mp-view,mp-text,mp-picker,mp-scroll-view,.mp-input,.mp-textarea{box-sizing:border-box}' +
    '.mp-input{white-space:nowrap;overflow:hidden}.mp-textarea{white-space:pre-wrap}mp-scroll-view{overflow-x:auto}[hidden]{display:none!important}' +
    '.sim-nav{position:fixed;top:0;left:0;right:0;height:44px;line-height:44px;text-align:center;background:' + APP_JSON.window.navigationBarBackgroundColor + ';color:#fff;font-size:17px;font-weight:600;z-index:99}' +
    '.sim-tab{position:fixed;bottom:0;left:0;right:0;height:56px;display:flex;background:#fff;border-top:1px solid #ddd;z-index:99;font-size:10px;color:' + APP_JSON.tabBar.color + '}' +
    '.sim-tab div{flex:1;text-align:center;padding-top:6px}.sim-tab i{display:block;width:24px;height:24px;margin:0 auto 2px;border-radius:6px;background:currentColor;opacity:.5}.sim-tab .on{color:' + APP_JSON.tabBar.selectedColor + '}' +
    '.fab{bottom:' + (tab < 0 ? 24 : 80) + 'px!important}' +
    css + '</style><div class="sim-nav">' + (page.__title || json.navigationBarTitleText || APP_JSON.window.navigationBarTitleText) + '</div>' +
    wxml.toHtml(this.tree(), this.shownIn(page)) + tabbar;
};

module.exports = { Runtime: Runtime, ROOT: ROOT, APP_JSON: APP_JSON, TAB_PAGES: TAB_PAGES, loadPage: loadPage, registry: registry, wxml: wxml };
