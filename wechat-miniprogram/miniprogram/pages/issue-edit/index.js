// 记一条异常，或者更新它的处理进展。
const make = require('../../utils/page.js');

const NONE = { id: '', name: '不关联学员' };

make({
  data: { students: [], stages: [], kinds: [], members: [] },

  init: function () { this.clientId = make.randomId(); },

  refresh: function () {
    if (this._loaded) { return null; }
    const page = this;
    return this.load('issues.form', { id: this.q.id || '', student: this.q.student || '' }, function (res) {
      page._loaded = true;
      res.students = [NONE].concat(res.students);
      res.f = res.issue || {
        id: '', student_id: res.preset, occurred_on: res.today, stage: '', kind: '', description: '', contacted: '',
        eta_on: '', solved_on: '', revisit_ok: false, owner_id: res.me, remark: '', status: '',
      };
      const st = page.pickState(res.students, res.f.student_id, '');
      const ow = page.pickState(res.members, res.f.owner_id, '');
      res.idx = { student_id: st.index, owner_id: ow.index };
      res.label = { student_id: res.f.student_id ? st.label : '', owner_id: res.f.owner_id ? ow.label : '' };
      return res;
    });
  },

  pickOne: function (e) {
    const ds = e.currentTarget.dataset;
    this.put(ds.k, this.values()[ds.k] === ds.v ? '' : ds.v);
  },

  save: function () {
    const page = this;
    const d = this.values();
    if (this.q.id) { d.id = this.q.id; } else { delete d.id; d.client_id = this.clientId; }
    this.submit('issues.save', d).then(function (res) {
      if (!res) { return; }
      if (res.warn) { page.notice(res.message, '已保存').then(function () { page.back(); }); } else { page.toast(res.message); page.back(); }
    });
  },

  remove: function () {
    const page = this;
    this.confirm('删除这条异常记录？删除后找不回来。', '删除').then(function (yes) {
      if (!yes) { return; }
      page.submit('issues.remove', { id: page.q.id }).then(function (res) { if (res) { page.toast(res.message); page.back(); } });
    });
  },
});
