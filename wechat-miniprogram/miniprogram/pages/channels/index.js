// 获客渠道：统一入口、渠道码，以及每个渠道带来了多少客户。
const make = require('../../utils/page.js');

make({
  data: { items: [], archived: false, archived_count: 0, entry: '', can_edit: false },
  refresh: function () {
    return this.load('channels.list', { archived: this.data.archived });
  },
  toggleArchived: function () {
    this.setData({ archived: !this.data.archived });
    this.refresh();
  },
  edit: function (e) {
    if (this.data.can_edit) { wx.navigateTo({ url: '/pages/channel-edit/index?id=' + e.currentTarget.dataset.id }); }
  },
});
