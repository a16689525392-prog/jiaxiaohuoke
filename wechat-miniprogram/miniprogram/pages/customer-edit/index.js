// 登记新客户（带 id 时是编辑资料）。
const make = require('../../utils/page.js');
const dates = require('../../utils/dates.js');

const NONE = { id: '', name: '不选' };

make({
  data: { is_new: true, idx: {}, quick: [], help: false, channels: [], products: [], members: [], referrers: [] },

  init: function (q) {
    this.clientId = make.randomId();
    wx.setNavigationBarTitle({ title: q.id ? '编辑资料' : '登记客户' });
  },

  // 只在第一次进来时读；回到这个页面不重读，免得冲掉填了一半的内容
  refresh: function () {
    if (this._loaded) { return null; }
    const page = this;
    return this.load('customers.form', { id: this.q.id || '' }, function (res) {
      page._loaded = true;
      const c = res.c;
      res.is_new = !c;
      res.products = [NONE].concat(res.products);
      res.referrers = [NONE].concat(res.referrers);
      res.f = c || {
        name: '', contact: '', channel_id: '', school: '', vehicle: '', plan: '', slots: '', budget: '', concern: '',
        remark: '', product_id: '', owner_id: res.me, referrer_id: '', registered_on: res.today,
        grade: '', status: '新加微信', notes: '', next_action: '', next_follow_on: '',
      };
      res.idx = {};
      res.label = {};
      [['channel_id', res.channels], ['product_id', res.products], ['owner_id', res.members], ['referrer_id', res.referrers]].forEach(function (pair) {
        const st = page.pickState(pair[1], res.f[pair[0]], '');
        res.idx[pair[0]] = st.index;
        res.label[pair[0]] = res.f[pair[0]] ? st.label : '';
      });
      res.quick = [['今天', 0], ['明天', 1], ['3 天后', 3], ['一周后', 7]].map(function (x) { return { label: x[0], day: dates.add(res.today, x[1]) }; });
      return res;
    });
  },

  toggleHelp: function () { this.setData({ help: !this.data.help }); },
  // 单选，再点一次取消
  pickOne: function (e) {
    const ds = e.currentTarget.dataset;
    this.put(ds.k, this.values()[ds.k] === ds.v ? '' : ds.v);
  },

  send: function (again) {
    const page = this;
    const d = this.values();
    if (this.q.id) { d.id = this.q.id; } else { d.client_id = this.clientId; }
    this.submit('customers.save', d).then(function (res) {
      if (!res) { return; }
      page.toast(res.message);
      if (page.q.id) { page.back(); return; }
      wx.redirectTo({ url: again ? '/pages/customer-edit/index' : '/pages/customer/index?id=' + res.id });
    });
  },
  save: function () { this.send(false); },
  saveAgain: function () { this.send(true); },
});
