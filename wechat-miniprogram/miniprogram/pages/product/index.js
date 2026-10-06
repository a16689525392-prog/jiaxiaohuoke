// 给客户看的产品卡：费用、训练与考试、退费与售后，以及我们不承诺什么。
const make = require('../../utils/page.js');

make({
  data: { p: {}, card: [], text: '', pending: 0, pending_text: '按当前合作协议核验' },
  refresh: function () {
    return this.load('products.get', { id: this.q.id }, function (res) {
      wx.setNavigationBarTitle({ title: res.p.name });
      return res;
    });
  },
  archive: function () {
    const page = this;
    const p = this.data.p;
    const ask = p.archived ? Promise.resolve(true) : this.confirm('停用“' + p.name + '”？已经匹配它的客户和学员不受影响，新登记时不再出现。', '停用');
    ask.then(function (yes) {
      if (!yes) { return; }
      page.submit('products.archive', { id: p.id }).then(function (res) { if (res) { page.toast(res.message); page.refresh(); } });
    });
  },
});
