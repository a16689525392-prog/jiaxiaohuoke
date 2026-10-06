// 成员管理（只有管理员能进）：邀请码、审核加入申请、设管理员、停用。
const make = require('../../utils/page.js');

make({
  data: { invite_code: '', team_name: '', pending: [], members: [], gone: [], members_only_own: false },

  refresh: function () {
    return this.load('members.list', {}, function (res) {
      return {
        invite_code: res.invite_code, team_name: res.team_name, members_only_own: res.members_only_own,
        pending: res.items.filter(function (m) { return m.status === 'pending'; }),
        members: res.items.filter(function (m) { return m.status === 'active' || m.status === 'disabled'; }),
        gone: res.items.filter(function (m) { return m.status === 'left'; }),
      };
    });
  },

  act: function (action, data) {
    const page = this;
    return this.submit(action, data).then(function (res) {
      if (res) { page.toast(res.message); page.refresh(); }
      return res;
    });
  },

  reset: function () {
    const page = this;
    this.confirm('换一个邀请码？旧的邀请码马上作废，已经加入的人不受影响。', '换一个').then(function (yes) {
      if (!yes) { return; }
      page.submit('team.reset_invite', {}).then(function (res) { if (res) { page.setData({ invite_code: res.invite_code }); page.toast('已换成新的邀请码'); } });
    });
  },

  approve: function (e) { this.act('members.approve', { uid: e.currentTarget.dataset.uid }); },
  reject: function (e) {
    const page = this;
    const ds = e.currentTarget.dataset;
    this.confirm('拒绝“' + ds.name + '”的加入申请？', '拒绝').then(function (yes) { if (yes) { page.act('members.reject', { uid: ds.uid }); } });
  },

  manage: function (e) {
    const page = this;
    const m = this.data.members[Number(e.currentTarget.dataset.i)];
    if (!m) { return; }
    const items = ['改称呼', m.role === 'admin' ? '改为普通成员' : '设为管理员'];
    if (!m.is_me) { items.push(m.status === 'active' ? '停用' : '恢复使用'); }
    wx.showActionSheet({
      itemList: items,
      success: function (r) {
        const picked = items[r.tapIndex];
        if (picked === '改称呼') {
          wx.showModal({
            title: '改称呼', editable: true, placeholderText: m.name, content: m.name,
            success: function (x) { if (x.confirm) { page.act('members.update', { uid: m.uid, name: x.content }); } },
          });
        } else if (picked === '设为管理员') {
          page.confirm('把“' + m.name + '”设为管理员？管理员能看到全部数据，能改产品卡、话术和成员。', '设为管理员').then(function (yes) { if (yes) { page.act('members.update', { uid: m.uid, role: 'admin' }); } });
        } else if (picked === '改为普通成员') {
          page.act('members.update', { uid: m.uid, role: 'member' });
        } else if (picked === '停用') {
          page.confirm('停用“' + m.name + '”？他马上就进不来了。他负责的客户和学员还在他名下，记得改给别人。', '停用').then(function (yes) { if (yes) { page.act('members.update', { uid: m.uid, status: 'disabled' }); } });
        } else if (picked === '恢复使用') {
          page.act('members.update', { uid: m.uid, status: 'active' });
        }
      },
    });
  },
});
