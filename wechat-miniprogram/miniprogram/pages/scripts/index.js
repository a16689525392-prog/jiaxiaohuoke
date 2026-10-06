// 统一话术：按沟通阶段分组，可以带上某个班型产品卡里核实过的内容。
const make = require('../../utils/page.js');

make({
  data: { groups: [], order: [], forbidden: [], choices: [{ id: '', name: '不填，保持【】原样' }], idx_product: 0, product_id: '' },
  refresh: function () {
    return this.load('scripts.list', { product_id: this.data.product_id }, function (res) {
      res.choices = [{ id: '', name: '不填，保持【】原样' }].concat(res.products);
      res.idx_product = 0;
      res.choices.forEach(function (c, i) { if (c.id === res.product_id) { res.idx_product = i; } });
      return res;
    });
  },
  setProduct: function (e) {
    const c = this.data.choices[Number(e.detail.value)];
    if (!c) { return; }
    this.setData({ product_id: c.id });
    this.refresh();
  },
});
