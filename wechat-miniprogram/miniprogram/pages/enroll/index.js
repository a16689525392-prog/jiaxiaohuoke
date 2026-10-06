// 付款前四项核对，然后记录定金或办正式报名。
const make = require('../../utils/page.js');

make({
  data: { c: {}, products: [], product: null, checks: [], ticked: {}, idx: {}, idx_product: 0, pending_text: '按当前合作协议核验' },

  refresh: function () {
    if (this._loaded) { return null; }
    return this.fetch('');
  },

  fetch: function (productId) {
    const page = this;
    return this.load('customers.enroll_info', { id: this.q.id, product_id: productId }, function (res) {
      if (res.student_id) {                      // 已经报过名了，直接去学员页
        wx.redirectTo({ url: '/pages/student/index?id=' + res.student_id });
        return { loading: true };
      }
      const first = !page._loaded;
      page._loaded = true;
      res.ticked = {};                           // 换了班型就要重新核对
      res.idx_product = 0;
      res.products.forEach(function (p, i) { if (res.product && p.id === res.product.id) { res.idx_product = i; } });
      if (first) {
        const st = page.pickState(res.members, res.me, '');
        res.idx = { owner_id: st.index };
        res.label = { owner_id: st.label };
        res.f = { action: res.is_deposit ? 'enroll' : 'deposit', on: res.today, next_on: '', next_action: '', contract: false, receipt: false, doclist: false, told_owner: false, owner_id: res.me };
      }
      return res;
    });
  },

  setProduct: function (e) {
    const p = this.data.products[Number(e.detail.value)];
    if (p && (!this.data.product || p.id !== this.data.product.id)) { this.fetch(p.id); }
  },

  tick: function (e) {
    const k = e.currentTarget.dataset.k;
    const patch = {};
    patch['ticked.' + k] = !this.data.ticked[k];
    this.setData(patch);
  },

  save: function () {
    const page = this;
    const v = this.values();
    const ticked = this.data.ticked;
    const d = {
      id: this.q.id, product_id: this.data.product ? this.data.product.id : '', action: v.action,
      checks: Object.keys(ticked).filter(function (k) { return ticked[k]; }),
      on: v.on, next_on: v.next_on, next_action: v.next_action,
    };
    if (v.action === 'enroll') {
      Object.assign(d, { contract: !!v.contract, receipt: !!v.receipt, doclist: !!v.doclist, told_owner: !!v.told_owner, owner_id: v.owner_id });
    }
    this.submit('customers.enroll', d).then(function (res) {
      if (!res) { return; }
      page.toast(res.message);
      if (res.student_id) { wx.redirectTo({ url: '/pages/student/index?id=' + res.student_id }); } else { page.back(); }
    });
  },
});
