// 新增或修改一条话术（只有管理员能改）。全团队看到的是同一份。
const make = require('../../utils/page.js');

make({
  data: { groups: [], tokens: [] },
  refresh: function () {
    if (this._loaded) { return null; }
    const page = this;
    return this.load('scripts.get', { id: this.q.id || '' }, function (res) {
      page._loaded = true;
      res.f = res.s || { id: '', grp: res.groups[0], scene: '', when_use: '', body: '', tips: '' };
      return res;
    });
  },
  save: function () {
    const page = this;
    const d = this.values();
    d.id = this.q.id || '';
    this.submit('scripts.save', d).then(function (res) { if (res) { page.toast(res.message); page.back(); } });
  },
  remove: function () {
    const page = this;
    this.confirm('删除这条话术？全团队都会看不到它。', '删除').then(function (yes) {
      if (!yes) { return; }
      page.submit('scripts.remove', { id: page.q.id }).then(function (res) { if (res) { page.toast(res.message); page.back(); } });
    });
  },
});
