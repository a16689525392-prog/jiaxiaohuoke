// 客户详情：记录跟进、看匹配的班型和报价话术、看跟进记录。
const make = require('../../utils/page.js');
const dates = require('../../utils/dates.js');

const PROFILE = [['school', '学校 / 单位'], ['vehicle', '想学车型'], ['plan', '打算何时报名'], ['slots', '可练车时间'], ['budget', '预算'], ['concern', '最在意'], ['last_contact', '上次沟通'], ['remark', '备注']];

make({
  data: { c: {}, follow: {}, log: [], referred: [], profile: [], quick: [], help: false },

  refresh: function () {
    return this.load('customers.get', { id: this.q.id }, function (res) {
      const c = res.c;
      wx.setNavigationBarTitle({ title: c.name });
      res.profile = PROFILE.filter(function (p) { return c[p[0]]; }).map(function (p) { return { k: p[1], v: c[p[0]] }; });
      res.quick = [['明天', 1], ['3 天后', 3], ['一周后', 7]].map(function (x) { return { label: x[0], day: dates.add(res.today, x[1]) }; });
      // 表单从客户现在的情况开始填；已经打了字的不覆盖
      const typed = this._form || {};
      res.f = Object.assign({
        summary: '', grade: c.grade, status: c.status, next_action: c.next_action, next_follow_on: c.next_follow_on,
        contact_on: res.today,
      }, typed);
      return res;
    });
  },

  toggleHelp: function () { this.setData({ help: !this.data.help }); },

  save: function () {
    const page = this;
    const v = this.values();
    const d = { id: this.q.id, summary: v.summary, contact_on: v.contact_on };
    if (this.data.follow.show_grade) { d.grade = v.grade; }
    if (!this.data.c.enrolled) {
      d.status = v.status;
      d.next_action = v.next_action;
      d.next_follow_on = v.next_follow_on;
    }
    this.submit('customers.follow', d).then(function (res) {
      if (!res) { return; }
      page._form = {};
      page.toast(res.message);
      page.retry();                 // 整页重画一遍：输入框清空，顶部显示新的下次跟进时间
    });
  },

  remove: function () {
    const page = this;
    this.confirm('删除“' + this.data.c.name + '”和他的全部跟进记录？删除后找不回来。', '删除').then(function (yes) {
      if (!yes) { return; }
      page.submit('customers.remove', { id: page.q.id }).then(function (res) {
        if (res) { page.toast(res.message); page.back(); }
      });
    });
  },
});
