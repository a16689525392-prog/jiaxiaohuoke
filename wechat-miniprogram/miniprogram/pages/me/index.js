// 我的：我是谁、在哪个团队，以及日历、数据、台账和管理功能的入口。
const make = require('../../utils/page.js');
const api = require('../../utils/api.js');

make({
  data: { me: {}, team: {}, pending_count: 0, version: '', initial: '' },

  refresh: function () {
    const page = this;
    return api.session(true).then(function (s) {
      if (s.state !== 'active') { api.toWelcome(); return; }
      page.show(s);
    }, function (err) {
      page.setData({ loading: false, error: err.message });
    });
  },

  show: function (s) {
    api.setSession(s);
    this.setData({
      loading: false, error: '', me: s.me, team: s.team, pending_count: s.pending_count || 0, version: s.version,
      initial: String(s.me.name || '我').slice(0, 1),
    });
  },

  rename: function () {
    const page = this;
    wx.showModal({
      title: '改称呼', editable: true, placeholderText: '团队里的人怎么叫你', content: this.data.me.name,
      success: function (r) {
        if (!r.confirm) { return; }
        page.submit('me.rename', { name: r.content }).then(function (s) {
          if (s) { page.show(s); page.toast('已改好'); } else { page.toast(page.data.errors[0]); }
        });
      },
    });
  },

  leave: function () {
    const page = this;
    this.confirm('退出“' + this.data.team.name + '”？退出后看不到团队的数据；你负责的客户和学员会留在团队里，由管理员改给别人。', '退出').then(function (yes) {
      if (!yes) { return; }
      page.submit('team.leave', {}).then(function (s) {
        if (s) { api.setSession(s); api.toWelcome(); } else { page.notice(page.data.errors[0], '退出不了'); }
      });
    });
  },
});
