// 填写或修改一张产品卡（只有管理员能改）。
const make = require('../../utils/page.js');

make({
  data: { sections: [], vehicles: [], pending_text: '' },

  refresh: function () {
    if (this._loaded) { return null; }
    const page = this;
    return this.load('products.form', { id: this.q.id || '' }, function (res) {
      page._loaded = true;
      wx.setNavigationBarTitle({ title: res.title });
      res.f = {};
      res.sections.forEach(function (sec) { sec.fields.forEach(function (fd) { res.f[fd.key] = fd.value; }); });
      return res;
    });
  },

  save: function () {
    const page = this;
    this.submit('products.save', { id: this.q.id || '', values: this.values() }).then(function (res) {
      if (!res) { return; }
      page.toast(res.message);
      if (page.q.id) { page.back(); } else { wx.redirectTo({ url: '/pages/product/index?id=' + res.id }); }
    });
  },
});
