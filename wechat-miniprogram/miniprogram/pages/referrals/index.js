// 转介绍：公开规则、红线，以及谁推荐了谁。
const make = require('../../utils/page.js');

make({
  data: { rules: [], red_lines: [], people: [], willing: [], rules_ready: true, can_edit: false },
  refresh: function () { return this.load('referrals.list', {}); },
});
