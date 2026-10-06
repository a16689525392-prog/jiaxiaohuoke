// 跟进日历：六周一屏，点某一天看当天要跟进的客户和学员。
const make = require('../../utils/page.js');

make({
  data: { weeks: [], weekdays: [], customers: [], students: [], offset: 0, picked: '' },

  refresh: function () {
    return this.load('calendar.get', { mine: this.mine(), w: this.data.offset, d: this.data.picked }, function (res) {
      res.weeks = res.weeks.map(function (days) { return { key: days[0].day, days: days }; });
      return res;
    });
  },
  shift: function (e) {
    const n = Number(e.currentTarget.dataset.n);
    this.setData({ offset: n === 0 ? 0 : this.data.offset + n, picked: n === 0 ? '' : this.data.picked });
    this.refresh();
  },
  pick: function (e) {
    this.setData({ picked: e.currentTarget.dataset.day });
    this.refresh();
  },
});
