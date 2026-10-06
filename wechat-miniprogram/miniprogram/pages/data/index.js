// 数据：招生漏斗看板，和每天自己记的曝光、加微数。
const make = require('../../utils/page.js');

make({
  data: { tab: 'board', rows: [], fc: {}, dc: {}, issues: 0, days: [], end: '', today_filled: true },

  init: function (q) { if (q.tab === 'daily') { this.setData({ tab: 'daily' }); } },

  refresh: function () {
    const page = this;
    if (this.data.tab === 'board') { return this.load('data.board', { mine: this.mine() }); }
    return this.load('data.daily_get', { mine: this.mine(), end: this.data.end }, function (res) {
      page._form = {};
      return res;
    });
  },

  setTab: function (e) {
    this.setData({ tab: e.currentTarget.dataset.v, loading: true, errors: [] });
    this.refresh();
  },

  hint: function (e) {
    const row = this.data.rows[Number(e.currentTarget.dataset.i)];
    if (row) { this.notice(row.hint, row.label); }
  },

  turn: function (e) {
    const end = e.currentTarget.dataset.end;
    if (!end) { return; }
    this.setData({ end: end, loading: true });
    this.refresh();
  },

  save: function () {
    const page = this;
    const typed = this._form || {};
    // 只提交动过的那几天
    const rows = this.data.days.filter(function (d) {
      return ('exposure_' + d.day) in typed || ('wechat_' + d.day) in typed || ('summary_' + d.day) in typed;
    }).map(function (d) {
      const pick = function (k, old) { const v = typed[k + '_' + d.day]; return v === undefined ? old : v; };
      return { day: d.day, exposure: pick('exposure', d.exposure), wechat: pick('wechat', d.wechat), summary: pick('summary', d.summary) };
    });
    if (!rows.length) { this.toast('没有改动。'); return; }
    this.submit('data.daily_save', { rows: rows }).then(function (res) {
      if (!res) { return; }
      if (res.warn) { page.notice(res.message); } else { page.toast(res.message); }
      page.setData({ loading: true });
      page.refresh();
    });
  },
});
