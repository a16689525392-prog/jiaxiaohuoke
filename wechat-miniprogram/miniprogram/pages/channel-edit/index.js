// 新增或修改一个渠道（只有管理员能改）。
const make = require('../../utils/page.js');

make({
  data: { kinds: [], statuses: [] },
  refresh: function () {
    if (this._loaded) { return null; }
    const page = this;
    return this.load('channels.get', { id: this.q.id || '' }, function (res) {
      page._loaded = true;
      res.f = res.ch || { id: '', name: '', code: '', kind: '', how: '', status: '筹备中', note: '', archived: false };
      return res;
    });
  },
  save: function () {
    const page = this;
    const d = this.values();
    d.id = this.q.id || '';
    this.submit('channels.save', d).then(function (res) { if (res) { page.toast(res.message); page.back(); } });
  },
  archive: function () {
    const page = this;
    this.submit('channels.archive', { id: this.q.id }).then(function (res) { if (res) { page.toast(res.message); page.back(); } });
  },
});
