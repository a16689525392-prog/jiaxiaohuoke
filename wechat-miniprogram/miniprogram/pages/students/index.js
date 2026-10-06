// 学员交付列表：正式报名后的学员，按节点往下做。
const make = require('../../utils/page.js');

make({
  data: {
    q: '', flag: '', items: [], total: 0, empty_text: '',
    filters: { flags: [], stages: [{ label: '交付中' }], owners: [] },
    idx: { stage: 0, owner: 0 }, pick: { stage: '', owner: '' },
  },

  refresh: function () {
    const p = this.data.pick;
    return this.load('students.list', { mine: this.mine(), q: this.data.q, flag: this.data.flag, stage: p.stage, owner: p.owner }, function (res) {
      const at = function (list, value) {
        for (let i = 0; i < list.length; i++) { if (list[i].value === value) { return i; } }
        return 0;
      };
      res.idx = { stage: at(res.filters.stages, p.stage), owner: at(res.filters.owners, p.owner) };
      const filtered = this.data.q || this.data.flag || p.stage || p.owner;
      res.empty_text = filtered ? '没有符合条件的学员。' : '还没有交付中的学员。客户办完“四项核对与报名”后会出现在这里。';
      return res;
    });
  },

  onQuery: function (e) { this.data.q = e.detail.value; },
  search: function () { this.setData({ q: this.data.q }); this.refresh(); },
  setFlag: function (e) { this.setData({ flag: e.currentTarget.dataset.v }); this.refresh(); },
  setFilter: function (e) {
    const k = e.currentTarget.dataset.k;
    const list = this.data.filters[k === 'stage' ? 'stages' : 'owners'];
    const i = Number(e.detail.value);
    if (!list[i]) { return; }
    const patch = {};
    patch['idx.' + k] = i;
    patch['pick.' + k] = list[i].value;
    this.setData(patch);
    this.refresh();
  },
});
