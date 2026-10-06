// 今日：今天该跟进谁、哪些学员有事要做。
const make = require('../../utils/page.js');

make({
  data: { fc: {}, dc: {}, due: [], unscheduled: [], reminders: [], hints: [] },
  refresh: function () {
    return this.load('home.get', { mine: this.mine() });
  },
});
