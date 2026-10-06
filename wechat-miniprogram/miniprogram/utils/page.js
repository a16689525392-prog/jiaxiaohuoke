// 所有页面共用的做法：加载、提交、表单输入、跳转、复制。
// 页面这样写：
//   const make = require('../../utils/page.js');
//   make({ data: {...}, refresh() { return this.load('home.get', {...}); }, ... });
// 进入页面和每次回到页面都会调用 refresh()，所以从编辑页返回后看到的总是最新的。
const api = require('./api.js');

const TABS = ['/pages/home/index', '/pages/customers/index', '/pages/students/index', '/pages/library/index', '/pages/me/index'];

function randomId() {
  let out = '';
  for (let i = 0; i < 24; i++) { out += '0123456789abcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(Math.random() * 36)); }
  return out;
}

const common = {
  onLoad: function (query) {
    this.q = query || {};
    this._form = {};
    if (this.init) { this.init(this.q); }
  },

  onShow: function () {
    if (this.refresh) { this.refresh(); }
  },

  onPullDownRefresh: function () {
    const done = function () { wx.stopPullDownRefresh(); };
    const p = this.refresh ? this.refresh() : null;
    if (p && p.then) { p.then(done, done); } else { done(); }
  },

  // 读数据。成功后把结果放进页面（apply 可以先加工一下），失败时页面上显示原因和“重试”。
  load: function (action, data, apply) {
    const page = this;
    return api.call(action, data).then(function (res) {
      try {
        const patch = apply ? apply.call(page, res) : res;
        page.setData(Object.assign({ loading: false, error: '' }, patch || {}));
      } catch (e) {
        // 页面自己的代码出错了：说出来，不要一直停在“加载中”
        console.error(e);
        page.setData({ loading: false, error: '这个页面出错了：' + ((e && e.message) || e) });
        return null;
      }
      return res;
    }, function (err) {
      if (err.code !== 'NEED_JOIN') { page.setData({ loading: false, error: err.message }); }
      return null;
    });
  },

  // 提交。同一时间只发一次；填得不对时把原因列在页面顶部。成功返回结果，失败返回 null。
  submit: function (action, data) {
    const page = this;
    if (page._busy) { return Promise.resolve(null); }
    page._busy = true;
    page.setData({ busy: true, errors: [] });
    wx.showLoading({ title: '请稍候', mask: true });
    return api.call(action, data).then(function (res) {
      page._busy = false;
      wx.hideLoading();
      page.setData({ busy: false });
      return res || {};
    }, function (err) {
      page._busy = false;
      wx.hideLoading();
      page.setData({ busy: false, errors: err.errors });
      if (err.code !== 'NEED_JOIN') { wx.pageScrollTo({ scrollTop: 0, duration: 200 }); }
      return null;
    });
  },

  retry: function () {
    this.setData({ loading: true, error: '' });
    if (this.refresh) { this.refresh(); }
  },

  // ---- 表单。输入框打字时只记在 this._form 里，不重画页面；选择类的控件才重画。
  setForm: function (f) {
    this._form = {};
    this.setData({ f: f });
  },
  values: function () {
    return Object.assign({}, this.data.f || {}, this._form || {});
  },
  onField: function (e) {
    this._form[e.currentTarget.dataset.k] = e.detail.value;
  },
  // 选择类控件改了值：连同已经打的字一起放进页面数据。
  // 这样因为这次选择而新出现的输入框，显示的也是最新内容。
  put: function (k, v) {
    this._form[k] = v;
    this.setData({ f: this.values() });
  },
  onDate: function (e) { this.put(e.currentTarget.dataset.k, e.detail.value); },
  onClear: function (e) { this.put(e.currentTarget.dataset.k, ''); },
  onChoose: function (e) { this.put(e.currentTarget.dataset.k, e.currentTarget.dataset.v); },
  onSwitch: function (e) { this.put(e.currentTarget.dataset.k, !!e.detail.value); },
  onToggle: function (e) {
    const k = e.currentTarget.dataset.k;
    this.put(k, !this.values()[k]);
  },
  // 下拉选择：data-k 是字段名，data-list 是选项所在的数据名，选项是 { id | value, name | label }
  onPick: function (e) {
    const ds = e.currentTarget.dataset;
    const list = this.data[ds.list] || [];
    const item = list[Number(e.detail.value)];
    if (!item) { return; }
    const value = typeof item === 'string' ? item : (item.id !== undefined ? item.id : item.value);
    const label = typeof item === 'string' ? item : (item.name !== undefined ? item.name : item.label);
    const patch = {};
    patch['label.' + ds.k] = label;
    patch['idx.' + ds.k] = Number(e.detail.value);
    this._form[ds.k] = value;
    patch.f = this.values();
    this.setData(patch);
  },
  // 给下拉框准备“当前选中的是哪一项”和显示的文字
  pickState: function (list, value, empty) {
    let index = -1;
    (list || []).forEach(function (item, i) {
      const v = typeof item === 'string' ? item : (item.id !== undefined ? item.id : item.value);
      if (v === value) { index = i; }
    });
    const item = index >= 0 ? list[index] : null;
    return { index: index < 0 ? 0 : index, label: item ? (typeof item === 'string' ? item : (item.name !== undefined ? item.name : item.label)) : (empty || '') };
  },

  // ---- “全部 / 只看我的”
  mine: function () {
    try { return wx.getStorageSync('mine') === '1'; } catch (e) { return false; }
  },
  setMine: function (e) {
    try { wx.setStorageSync('mine', e.currentTarget.dataset.v === '1' ? '1' : '0'); } catch (err) { /* 存不下就算了 */ }
    this.retry();
  },

  // ---- 跳转和小动作
  go: function (e) {
    const url = e.currentTarget.dataset.url;
    if (!url) { return; }
    if (TABS.indexOf(url.split('?')[0]) >= 0) { wx.switchTab({ url: url.split('?')[0] }); } else { wx.navigateTo({ url: url }); }
  },
  back: function () {
    if (getCurrentPages().length > 1) { wx.navigateBack(); } else { wx.switchTab({ url: TABS[0] }); }
  },
  toast: function (text) {
    if (text) { wx.showToast({ title: text, icon: 'none', duration: text.length > 14 ? 3000 : 1800 }); }
  },
  // 提示较长、或者需要用户确认看到的，用弹窗
  notice: function (text, title) {
    return new Promise(function (resolve) {
      wx.showModal({ title: title || '提示', content: text, showCancel: false, confirmText: '知道了', complete: resolve });
    });
  },
  confirm: function (text, confirmText) {
    return new Promise(function (resolve) {
      wx.showModal({
        title: '请确认', content: text, confirmText: confirmText || '确定', confirmColor: '#b3261e',
        success: function (r) { resolve(!!r.confirm); }, fail: function () { resolve(false); },
      });
    });
  },
  copy: function (e) {
    this.copyText(e.currentTarget.dataset.text, e.currentTarget.dataset.done);
  },
  copyText: function (text, done) {
    const page = this;
    if (!text) { return; }
    wx.setClipboardData({
      data: String(text),
      success: function () { wx.showToast({ title: done || '已复制', icon: 'none' }); },
      fail: function () {
        page.notice('没有复制成功。小程序上线前，需要在小程序后台“设置 → 服务内容声明 → 用户隐私保护指引”里声明使用“剪切板”。现在可以长按文字手动复制。', '复制没成功');
      },
    });
  },
  noop: function () {},
};

function make(def) {
  const page = Object.assign({}, common, def);
  page.data = Object.assign({ loading: true, error: '', errors: [], busy: false, f: {}, label: {}, idx: {} }, def.data || {});
  Page(page);
}

make.randomId = randomId;
make.TABS = TABS;
module.exports = make;
