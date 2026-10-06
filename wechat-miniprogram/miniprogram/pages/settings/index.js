// 团队设置（只有管理员能进）：名称、统一入口、成员能看到的范围、转介绍的公开规则。
const make = require('../../utils/page.js');
const api = require('../../utils/api.js');

make({
  data: { rules: [], red_lines: [], team_name: '' },
  refresh: function () {
    if (this._loaded) { return null; }
    const page = this;
    return this.load('team.get', {}, function (res) {
      page._loaded = true;
      const f = { name: res.name, unified_entry: res.unified_entry, start_date: res.start_date, members_only_own: res.members_only_own };
      res.rules.forEach(function (r) { f[r.key] = r.value; });
      return { f: f, rules: res.rules, red_lines: res.red_lines, team_name: res.name };
    });
  },
  save: function () {
    const page = this;
    this.submit('team.update', this.values()).then(function (s) {
      if (!s) { return; }
      api.setSession(s);
      page.toast('已保存');
      page.back();
    });
  },

  // 解散团队：要把团队名称原样输入一遍才行
  dissolve: function () {
    const page = this;
    const name = this.data.team_name;
    wx.showModal({
      title: '解散团队', editable: true, placeholderText: '输入团队名称“' + name + '”确认', content: '',
      confirmText: '解散', confirmColor: '#b3261e',
      success: function (r) {
        if (!r.confirm) { return; }
        page.submit('team.dissolve', { name: r.content }).then(function (s) {
          if (!s) { return; }
          api.setSession(s);
          page.toast('团队已解散');
          api.toWelcome();
        });
      },
    });
  },
});
