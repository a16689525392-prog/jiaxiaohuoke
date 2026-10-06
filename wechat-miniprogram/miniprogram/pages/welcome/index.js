// 还没加入团队的人看到的页面：凭邀请码加入，或者凭口令创建一个新团队。
const make = require('../../utils/page.js');
const api = require('../../utils/api.js');

const HOME = '/pages/home/index';

make({
  data: { state: '', tab: 'join', need_code: false, team_name: '', my_name: '' },

  refresh: function () {
    const page = this;
    return api.session(true).then(function (s) { page.apply(s); }, function (err) {
      page.setData({ loading: false, error: err.message });
    });
  },

  apply: function (s) {
    api.setSession(s);
    if (s.state === 'active') { wx.switchTab({ url: HOME }); return; }
    this.setData({
      loading: false, error: '', state: s.state, need_code: !!s.need_code,
      team_name: s.team ? s.team.name : '', my_name: s.me ? s.me.name : '',
    });
  },

  setTab: function (e) {
    this.setData({ tab: e.currentTarget.dataset.v, errors: [], f: this.values() });
  },

  join: function () {
    const page = this;
    const v = this.values();
    this.submit('team.join', { code: v.invite, my_name: v.my_name }).then(function (s) { if (s) { page.apply(s); } });
  },

  create: function () {
    const page = this;
    const v = this.values();
    this.submit('team.create', { team_name: v.team_name, my_name: v.my_name, code: v.code }).then(function (s) { if (s) { page.apply(s); } });
  },

  leave: function (e) {
    const page = this;
    this.confirm(e.currentTarget.dataset.text, '确定').then(function (yes) {
      if (!yes) { return; }
      page.submit('team.leave', {}).then(function (s) { if (s) { page.setForm({}); page.apply(s); } });
    });
  },
});
