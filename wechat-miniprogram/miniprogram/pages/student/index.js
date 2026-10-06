// 学员交付：按节点打勾、记考试、排下一步；异常记进台账。
const make = require('../../utils/page.js');
const api = require('../../utils/api.js');
const dates = require('../../utils/dates.js');

make({
  data: { s: {}, blocks: [], issues: [], subjects: [], results: [], stages: [], members: [], quick: [], willing: ['愿意', '待定', '不愿意'], need_date: true },

  // 第一次进来读全部；从别的页面回来时只更新异常记录，不动填了一半的内容
  refresh: function () {
    const page = this;
    if (this._loaded) {
      return api.call('students.get', { id: this.q.id }).then(function (res) {
        page.setData({ issues: res.issues, 's.open_issues': res.s.open_issues });
      }, function () { /* 回来时刷新失败不打扰，保存时还会再检查 */ });
    }
    return this.reload();
  },

  reload: function () {
    const page = this;
    return this.load('students.get', { id: this.q.id }, function (res) {
      page._loaded = true;
      page._form = {};
      wx.setNavigationBarTitle({ title: res.s.name });
      res.blocks.forEach(function (b) { b.open = b.current; });
      if (!res.blocks.some(function (b) { return b.open; })) { res.blocks[0].open = true; }
      const owner = page.pickState(res.members, res.f.owner_id, '');
      res.idx = { owner_id: owner.index, stage: Math.max(0, res.stages.indexOf(res.f.stage)) };
      res.label = { owner_id: res.f.owner_id ? owner.label : '' };
      res.quick = [['今天', 0], ['明天', 1], ['3 天后', 3], ['一周后', 7]].map(function (x) { return { label: x[0], day: dates.add(res.today, x[1]) }; });
      res.need_date = res.s.active;
      return res;
    });
  },

  pickOne: function (e) {
    const ds = e.currentTarget.dataset;
    this.put(ds.k, this.values()[ds.k] === ds.v ? '' : ds.v);
  },

  fold: function (e) {
    const i = Number(e.currentTarget.dataset.i);
    const patch = {};
    patch['blocks[' + i + '].open'] = !this.data.blocks[i].open;
    this.setData(patch);
  },

  tick: function (e) {
    const b = Number(e.currentTarget.dataset.b);
    const i = Number(e.currentTarget.dataset.i);
    const block = this.data.blocks[b];
    const done = !block.items[i].done;
    const patch = {};
    patch['blocks[' + b + '].items[' + i + '].done'] = done;
    patch['blocks[' + b + '].done'] = block.done + (done ? 1 : -1);
    this.setData(patch);
  },

  save: function () {
    const page = this;
    const d = this.values();
    d.id = this.q.id;
    d.checks = [];
    this.data.blocks.forEach(function (b) { b.items.forEach(function (it) { if (it.done) { d.checks.push(it.key); } }); });
    this.submit('students.save', d).then(function (res) {
      if (!res) { return; }
      const after = function () { page.setData({ loading: true }); page.reload(); };
      if (res.warnings && res.warnings.length) {
        page.notice(res.message + '\n\n' + res.warnings.join('\n'), '已保存，还有一件事').then(after);
      } else {
        page.toast(res.message);
        after();
      }
    });
  },
});
