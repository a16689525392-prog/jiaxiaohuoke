// 异常台账：交付过程里出的问题，解决并回访确认后才算关闭。
const make = require('../../utils/page.js');

make({
  data: { items: [], all: false, open_count: 0 },
  refresh: function () {
    return this.load('issues.list', { all: this.data.all });
  },
  setAll: function (e) {
    this.setData({ all: e.currentTarget.dataset.v === '1' });
    this.refresh();
  },
});
