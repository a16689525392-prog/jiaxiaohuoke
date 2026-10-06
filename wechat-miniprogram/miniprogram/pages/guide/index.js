// 开始与红线：头四周的安排，和无论如何不能做的五件事。
const make = require('../../utils/page.js');

make({
  data: { plan: [], red_lines: [], hints: [], start_label: '' },
  refresh: function () { return this.load('guide.get', {}); },
});
