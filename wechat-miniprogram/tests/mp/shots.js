// 开发用：把每个页面在本地画出来截图（近似小程序的样子，用来在进开发者工具之前先看一遍排版）。
//   node tests/mp/shots.js 输出目录 [页面名 ...]
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { Runtime } = require('./runtime');
const demo = require('./demo');

(async function () {
  const out = process.argv[2];
  const only = process.argv.slice(3);
  fs.mkdirSync(out, { recursive: true });
  const d = await demo.seed();
  const t = d.t;
  const pages = [
    ['home', t.boss, '/pages/home/index'], ['customers', t.boss, '/pages/customers/index'], ['customer', t.amy, '/pages/customer/index?id=' + d.ids.lin],
    ['customer-new', t.amy, '/pages/customer-edit/index'], ['enroll', t.amy, '/pages/enroll/index?id=' + d.ids.lin], ['calendar', t.boss, '/pages/calendar/index'],
    ['students', t.boss, '/pages/students/index'], ['student', t.amy, '/pages/student/index?id=' + d.stu('s1')], ['issues', t.boss, '/pages/issues/index'],
    ['issue-edit', t.amy, '/pages/issue-edit/index?id=' + d.issue], ['library', t.boss, '/pages/library/index'], ['product', t.boss, '/pages/product/index?id=' + d.pid],
    ['product-edit', t.boss, '/pages/product-edit/index?id=' + d.pid], ['scripts', t.boss, '/pages/scripts/index'], ['script-edit', t.boss, '/pages/script-edit/index?id=' + d.script],
    ['channels', t.boss, '/pages/channels/index'], ['channel-edit', t.boss, '/pages/channel-edit/index?id=' + t.ch], ['data', t.amy, '/pages/data/index'],
    ['data-daily', t.amy, '/pages/data/index?tab=daily'], ['team', t.boss, '/pages/team/index'], ['settings', t.boss, '/pages/settings/index'],
    ['referrals', t.boss, '/pages/referrals/index'], ['guide', t.boss, '/pages/guide/index'], ['me', t.boss, '/pages/me/index'],
    ['welcome', 'o-nobody', '/pages/welcome/index'], ['welcome-pending', 'o-new1', '/pages/welcome/index'], ['selftest', t.boss, '/pages/selftest/index'],
  ];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 720 }, deviceScaleFactor: 2 });
  const tab = await ctx.newPage();
  for (const [name, who, url] of pages) {
    if (only.length && only.indexOf(name) < 0) { continue; }
    const rt = new Runtime(who);
    await rt.open(url);
    if (name === 'selftest') { await rt.tap('开始自检'); }
    if (name === 'welcome') { await rt.tap('创建团队'); }
    const html = rt.html();
    fs.writeFileSync(path.join(out, name + '.html'), html);
    await tab.setContent(html);
    await tab.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
    console.log(name, rt.problems.length ? 'PROBLEMS: ' + rt.problems.join(' | ') : 'ok');
  }
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
