'use strict';
const { test, beforeEach } = require('node:test');
const h = require('./helper');
const assert = h.assert;
const T = h.TODAY;                       // 2026-10-07 周三；本周 10-05 至 10-11
const day = (n) => h.core.addDays(T, n);

beforeEach(h.fresh);

function setRaw(coll, id, patch) { Object.assign(h.mock.state.collections.get(coll).get(id), patch); }

test('今日：跟进统计、到期名单按 A/B/C 排、没排期的单列', async () => {
  const t = await h.team();
  const a = await h.customer(t, t.amy, { name: 'B今天', grade: 'B', next_follow_on: T });
  const b = await h.customer(t, t.amy, { name: 'A逾期', grade: 'A', next_follow_on: T });
  const c = await h.customer(t, t.bob, { name: 'C本周', grade: 'C', next_follow_on: day(3) });
  const d = await h.customer(t, t.bob, { name: '下周', grade: 'B', next_follow_on: day(6) });
  const e = await h.customer(t, t.bob, { name: '没排期', grade: 'A', next_follow_on: T });
  await h.customer(t, t.bob, { name: 'D类', grade: 'D', next_follow_on: '' });
  setRaw('jx_customers', b, { next_follow_on: day(-3) });
  setRaw('jx_customers', e, { next_follow_on: '' });
  const home = await h.ok(t.boss, 'home.get', {});
  assert.deepEqual(home.fc, { active: 5, today: 1, overdue: 1, unscheduled: 1, week: 2, grade_a: 2 });
  assert.deepEqual(home.due.map((x) => x.name), ['A逾期', 'B今天']);
  assert.deepEqual(home.unscheduled.map((x) => x.name), ['没排期']);
  assert.equal(home.date_label, '10月7日 周三');
  const mine = await h.ok(t.amy, 'home.get', { mine: true });
  assert.deepEqual([mine.fc.active, mine.mine], [2, true]);
  void a; void c; void d;
});

test('今日：管理员能看到还缺什么，做完一项少一项；成员看不到', async () => {
  const t = await h.team();
  let home = await h.ok(t.boss, 'home.get', {});
  assert.deepEqual(home.hints.map((x) => x.action), ['去填产品卡', '去填', '登记第一个客户', '去写规则']);
  assert.deepEqual((await h.ok(t.amy, 'home.get', {})).hints, []);
  const pid = await h.product(t);
  await h.customer(t, t.amy);
  await h.ok(t.boss, 'team.update', { unified_entry: '企业微信', reward_desc: '每推荐 1 位奖励 100 元' });
  home = await h.ok(t.boss, 'home.get', {});
  assert.equal(home.hints.length, 1);
  assert.match(home.hints[0].text, /产品卡“C1 周末班”还有 \d+ 项没核实/);
  assert.equal(home.hints[0].url, '/pages/product-edit/index?id=' + pid);
});

test('跟进日历：每天的人数、待办和考试', async () => {
  const t = await h.team();
  await h.product(t);
  await h.customer(t, t.amy, { grade: 'A', next_follow_on: day(2) });
  await h.customer(t, t.amy, { grade: 'B', next_follow_on: day(2) });
  await h.customer(t, t.bob, { grade: '', next_follow_on: day(2) });
  await h.customer(t, t.bob, { grade: 'D', next_follow_on: day(2) });               // D 类不算
  const cid = await h.customer(t, t.amy, { name: '学员甲' });
  await h.ok(t.amy, 'customers.enroll', { id: cid, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: day(2) });
  setRaw('jx_students', 'stu_' + cid, { k1_exam_on: day(2), k2_exam_on: day(9) });
  const cal = await h.ok(t.boss, 'calendar.get', { d: day(2) });
  assert.equal(cal.weeks.length, 6);
  assert.equal(cal.weeks[0][0].day, '2026-10-05');
  assert.equal(cal.weeks[5][6].day, '2026-11-15');
  const cell = cal.weeks[0][4];
  assert.deepEqual([cell.day, cell.total, cell.A, cell.B, cell.C, cell.todo, cell.exam, cell.picked], [day(2), 3, 1, 1, 0, 1, 1, true]);
  assert.equal(cal.weeks[0][2].is_today, true);
  assert.equal(cal.weeks[0][0].past, true);
  assert.equal(cal.weeks[1][4].exam, 1);
  assert.equal(cal.weeks[3][6].num, '11月');
  assert.equal(cal.picked_label, '10月9日 周五');
  assert.equal(cal.customers.length, 3);
  assert.equal(cal.customers[0].grade, 'A');
  assert.deepEqual(cal.students.map((s) => [s.name, s.what]), [['学员甲', '待办、考科目一']]);
  const next = await h.ok(t.boss, 'calendar.get', { w: 1, d: 'bad' });
  assert.equal(next.weeks[0][0].day, '2026-10-12');
  assert.equal(next.picked, T);
  assert.equal((await h.ok(t.boss, 'calendar.get', { w: 99999 })).offset, 520);
  const mine = await h.ok(t.bob, 'calendar.get', { mine: true, d: day(2) });
  assert.equal(mine.weeks[0][4].total, 1);
  assert.equal(mine.students.length, 0);
});

test('数据看板：漏斗按“第一次走到那一步的日期”算，转化率逐级算', async () => {
  const t = await h.team();
  await h.product(t);
  const mk = (extra) => h.customer(t, t.amy, extra);
  await mk({ grade: '', status: '新加微信' });
  await mk({ grade: 'B', status: '已问需求' });
  const a = await mk({ grade: 'A', status: '已匹配报价' });
  const old = await mk({ grade: 'A', status: '已匹配报价', registered_on: day(-7) });       // 上周登记
  await h.ok(t.amy, 'customers.enroll', { id: a, action: 'deposit', checks: ['e1', 'e2', 'e3', 'e4'], next_on: day(1) });
  await h.ok(t.amy, 'customers.enroll', { id: old, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: T });
  await h.ok(t.amy, 'data.daily_save', { rows: [{ day: T, exposure: '300', wechat: '6', summary: '摆点' }, { day: day(-7), exposure: '100', wechat: '' }] });
  await h.ok(t.bob, 'data.daily_save', { rows: [{ day: day(-1), exposure: '100' }] });
  const board = await h.ok(t.boss, 'data.board', {});
  const row = {};
  board.rows.forEach((r) => { row[r.key] = r; });
  assert.deepEqual(board.rows.map((r) => r.this_week), [400, 3, 2, 1, 2, 1]);
  assert.deepEqual(board.rows.map((r) => r.last_week), [100, 1, 1, 1, 0, 0]);
  assert.deepEqual(board.rows.map((r) => r.total), [500, 4, 3, 2, 2, 1]);
  assert.equal(row.registered.r_this, '0.8%');
  assert.equal(row.consulted.r_this, '66.7%');
  assert.equal(row.grade_a.r_this, '50.0%');
  assert.equal(row.deposit.r_this, '200.0%', '上周的 A 类这周才交定金，按日期算就会超过 100%');
  assert.equal(row.enrolled.r_this, '50.0%');
  assert.equal(row.exposure.r_this, '');
  assert.equal(row.deposit.r_last, '0.0%');
  assert.equal(board.week_label, '10月5日 – 10月11日');
  assert.equal(board.today_filled, false, '管理员自己今天还没填');
  const mine = await h.ok(t.amy, 'data.board', { mine: true });
  assert.equal(mine.rows[0].this_week, 300);
  assert.equal(mine.today_filled, true);
  assert.deepEqual([mine.fc.active, mine.dc.active], [3, 1]);
});

test('每日数据：只存自己的；不是整数的不改动原值；将来的日期不收', async () => {
  const t = await h.team();
  await h.customer(t, t.amy, { registered_on: day(-1) });
  let res = await h.ok(t.amy, 'data.daily_save', { rows: [{ day: T, exposure: '1,200', wechat: '8', summary: '短视频 2 条' }, { day: day(1), exposure: '5' }, { day: 'x', exposure: '5' }, null, { day: day(-2) }] });
  assert.deepEqual([res.saved, res.bad], [1, 0]);
  res = await h.ok(t.amy, 'data.daily_save', { rows: [{ day: T, exposure: '十二', wechat: '-3', summary: '短视频 2 条' }] });
  assert.equal(res.bad, 2);
  assert.match(res.message, /2 个数字没看懂/);
  let rows = h.mock.rows('jx_daily');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].exposure, rows[0].wechat_adds], [1200, 8]);
  await h.ok(t.amy, 'data.daily_save', { rows: [{ day: T, exposure: '', wechat: '8', summary: '' }] });
  rows = h.mock.rows('jx_daily');
  assert.deepEqual([rows[0].exposure, rows[0].wechat_adds, rows[0].summary], [null, 8, '']);
  const page = await h.ok(t.amy, 'data.daily_get', {});
  assert.equal(page.days.length, 14);
  assert.deepEqual([page.days[0].day, page.days[0].exposure, page.days[0].wechat, page.days[0].weekday, page.days[0].is_today], [T, '', '8', '周三', true]);
  assert.equal(page.days[1].registered, 1);
  assert.equal(page.next_end, '');
  const prev = await h.ok(t.amy, 'data.daily_get', { end: page.prev_end });
  assert.equal(prev.days[0].day, day(-14));
  assert.equal(prev.next_end, T);
  assert.equal((await h.ok(t.amy, 'data.daily_get', { end: day(30) })).end, T);
  // 别人看不到、也改不了我填的数
  const bob = await h.ok(t.bob, 'data.daily_get', {});
  assert.equal(bob.days[0].wechat, '');
  await h.ok(t.bob, 'data.daily_save', { rows: [{ day: T, exposure: '50' }] });
  assert.equal(h.mock.rows('jx_daily').length, 2);
  assert.equal((await h.ok(t.boss, 'data.board', {})).rows[0].this_week, 50);
});

test('转介绍：谁推荐了谁；规则来自团队设置', async () => {
  const t = await h.team();
  await h.product(t);
  const a = await h.customer(t, t.amy, { name: '老学员' });
  await h.ok(t.amy, 'customers.enroll', { id: a, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: T });
  const b = await h.customer(t, t.bob, { name: '被推荐一', referrer_id: a });
  await h.customer(t, t.bob, { name: '被推荐二', referrer_id: a });
  await h.ok(t.bob, 'customers.enroll', { id: b, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: T });
  let page = await h.ok(t.boss, 'referrals.list', {});
  assert.equal(page.rules_ready, false);
  assert.deepEqual(page.people.map((p) => [p.name, p.total, p.enrolled]), [['老学员', 2, 1]]);
  assert.match(page.people[0].who, /被推荐一（已正式报名）、被推荐二（已问需求）/);
  assert.ok(page.red_lines.join('').indexOf('层级返利') >= 0 || page.red_lines.join('').indexOf('下线') >= 0);
  await h.ok(t.boss, 'team.update', { reward_desc: '每成功推荐 1 位奖励 100 元', members_only_own: true });
  page = await h.ok(t.amy, 'referrals.list', {});
  assert.equal(page.rules[0].value, '每成功推荐 1 位奖励 100 元');
  assert.equal(page.rules_ready, true);
  assert.deepEqual(page.people, [], '只看自己的成员：别人名下被推荐来的客户不显示');
});

test('开始与红线：四周计划按开始日期排，重复的事显示下一次', async () => {
  const t = await h.team();
  await h.ok(t.boss, 'team.update', { start_date: '2026-10-01' });
  const g = await h.ok(t.amy, 'guide.get', {});
  assert.equal(g.plan.length, 8);
  assert.deepEqual([g.plan[0].when, g.plan[0].date, g.plan[0].past], ['第 1 天', '10月1日 周四', true]);
  assert.deepEqual([g.plan[5].date, g.plan[5].past], ['10月22日 周四', false]);
  assert.deepEqual([g.plan[6].when, g.plan[6].date, g.plan[6].repeating], ['每周日', '10月11日 周日', true]);
  assert.equal(g.plan[7].date, '11月1日 周日');
  assert.equal(g.red_lines.length, 5);
  assert.ok(g.red_lines[0].indexOf('不承诺包过') === 0);
  assert.deepEqual(g.hints, []);
  assert.ok((await h.ok(t.boss, 'guide.get', {})).hints.length > 0);
  h.core.setFakeToday('2026-12-01');
  assert.equal((await h.ok(t.amy, 'guide.get', {})).plan[7].date, '12月1日 周二');
  h.core.setFakeToday('2026-12-15');
  const dec = await h.ok(t.amy, 'guide.get', {});
  assert.equal(dec.plan[7].date, '1月1日 周五');
  assert.equal(dec.plan[6].date, '12月20日 周日');
});
