// 客户列表：默认只看还在跟进的，可以按跟进情况、分级、状态、渠道、负责人筛选。
const make = require('../../utils/page.js');
const api = require('../../utils/api.js');

make({
  data: {
    q: '', follow: 'active', items: [], total: 0, page: 1, has_more: false,
    filters: { follow: [], grades: [{ label: '全部分级' }], statuses: [{ label: '全部状态' }], channels: [{ label: '全部渠道' }], owners: [] },
    idx: { grade: 0, status: 0, channel: 0, owner: 0 }, pick: { grade: '', status: '', channel: '', owner: '' },
  },

  query: function (page) {
    const p = this.data.pick;
    return { mine: this.mine(), q: this.data.q, follow: this.data.follow, grade: p.grade, status: p.status, channel: p.channel, owner: p.owner, page: page || 1 };
  },

  refresh: function () {
    return this.load('customers.list', this.query(1), function (res) {
      // 选项可能变了（比如新增了渠道），按当前选中的值重新对一下位置
      const pick = this.data.pick;
      const at = function (list, value) {
        for (let i = 0; i < list.length; i++) { if (list[i].value === value) { return i; } }
        return 0;
      };
      res.idx = {
        grade: at(res.filters.grades, pick.grade), status: at(res.filters.statuses, pick.status),
        channel: at(res.filters.channels, pick.channel), owner: at(res.filters.owners, pick.owner),
      };
      return res;
    });
  },

  onQuery: function (e) { this.data.q = e.detail.value; },
  search: function () { this.setData({ q: this.data.q }); this.refresh(); },
  setFollow: function (e) { this.setData({ follow: e.currentTarget.dataset.v }); this.refresh(); },
  setFilter: function (e) {
    const k = e.currentTarget.dataset.k;
    const list = this.data.filters[k === 'grade' ? 'grades' : (k === 'status' ? 'statuses' : (k === 'channel' ? 'channels' : 'owners'))];
    const i = Number(e.detail.value);
    if (!list[i]) { return; }
    const patch = {};
    patch['idx.' + k] = i;
    patch['pick.' + k] = list[i].value;
    this.setData(patch);
    this.refresh();
  },

  more: function () {
    const page = this;
    if (!this.data.has_more || this._more) { return; }
    this._more = true;
    api.call('customers.list', this.query(this.data.page + 1)).then(function (res) {
      page._more = false;
      page.setData({ items: page.data.items.concat(res.items), page: res.page, has_more: res.has_more, total: res.total });
    }, function (err) {
      page._more = false;
      page.toast(err.message);
    });
  },
  onReachBottom: function () { this.more(); },
});
