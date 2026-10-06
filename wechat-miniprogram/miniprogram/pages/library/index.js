// 资料：产品卡，以及话术、渠道、转介绍、红线的入口。
const make = require('../../utils/page.js');

make({
  data: { items: [], archived: false, archived_count: 0, can_edit: false },
  refresh: function () {
    return this.load('products.list', { archived: this.data.archived });
  },
  toggleArchived: function () {
    this.setData({ archived: !this.data.archived });
    this.refresh();
  },
});
