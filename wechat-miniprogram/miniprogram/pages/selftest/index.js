// 自检（只有管理员能进）：在真实的云环境里把关键流程跑一遍，一步一步显示结果。
const api = require('../../utils/api.js');

Page({
  data: { running: false, steps: [], verdict: '', all_ok: true },

  start: function () {
    if (this.data.running) { return; }
    this.setData({ running: true, steps: [], verdict: '', all_ok: true });
    this.run(0, '');
  },

  run: function (step, runId) {
    const page = this;
    api.call('selftest.run', { step: step, run: runId }).then(function (res) {
      const steps = page.data.steps.concat([res]);
      page.setData({ steps: steps });
      if (res.next >= 0) { page.run(res.next, res.run); return; }
      const ok = steps.every(function (s) { return s.ok; }) && steps.length === res.total;
      const ms = steps.reduce(function (n, s) { return n + s.ms; }, 0);
      page.setData({
        running: false, all_ok: ok,
        verdict: ok ? '全部通过，共 ' + steps.length + ' 步，用时 ' + (ms / 1000).toFixed(1) + ' 秒。可以开始用了。' : '有没通过的项目（红色的）。把这一页截图发给做部署的人。',
      });
    }, function (err) {
      page.setData({
        running: false, all_ok: false,
        verdict: '第 ' + (step + 1) + ' 步没有跑完：' + err.message + (err.detail ? '（' + err.detail + '）' : '') + (step > 0 ? ' 临时数据可能没清干净，再跑一遍会自动清掉。' : ''),
      });
    });
  },
});
