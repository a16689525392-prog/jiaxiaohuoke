'use strict';
const { test, beforeEach } = require('node:test');
const h = require('./helper');
const assert = h.assert;
const T = h.TODAY;
const day = (n) => h.core.addDays(T, n);

beforeEach(h.fresh);

async function student(t, who, extra) {
  const id = await h.customer(t, who || t.amy, extra);
  await h.ok(who || t.amy, 'customers.enroll', { id: id, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: T });
  return 'stu_' + id;
}

// 像页面那样：先读出来，改几项，再整个提交
async function save(who, sid, changes, expectFail) {
  const page = await h.ok(who, 'students.get', { id: sid });
  const d = Object.assign({}, page.f, { id: sid, checks: page.checks }, changes);
  return expectFail ? h.fail(who, 'students.save', d, 'INVALID', expectFail) : h.ok(who, 'students.save', d);
}

test('交付中的学员必须有下次动作日期', async () => {
  const t = await h.team();
  await h.product(t);
  const sid = await student(t);
  await save(t.amy, sid, { next_action_on: '' }, '必须写下次动作日期');
  await save(t.amy, sid, { next_action_on: day(-1) }, '已经过了');
  await save(t.amy, sid, { license_on: day(1) }, '拿证日期不能晚于今天');
  await save(t.amy, sid, { remark: '证件号 11010119900307451X' }, '身份证号');
  await save(t.amy, sid, { next_action_on: day(2), next_action: '催体检表' });
  assert.equal(h.mock.raw('jx_students', sid).next_action, '催体检表');
});

test('做完的阶段自动往下走，直到完结', async () => {
  const t = await h.team();
  await h.product(t);
  const sid = await student(t);
  let r = await save(t.amy, sid, { docs_status: '缺资料', docs_missing: '体检表' });
  assert.equal(r.stage, '资料准备');
  assert.equal(h.mock.raw('jx_students', sid).docs_missing, '体检表');
  r = await save(t.amy, sid, { docs_status: '齐全' });
  assert.equal(r.stage, '科目一');
  assert.match(r.message, /资料准备 → 科目一/);
  assert.equal(h.mock.raw('jx_students', sid).docs_missing, '', '资料齐全后清掉“还缺什么”');
  r = await save(t.amy, sid, { k1_result: '未通过', k1_exam_on: day(-1) });
  assert.equal(r.stage, '科目一');
  assert.match(r.warnings[0], /科目一没通过/);
  r = await save(t.amy, sid, { k1_result: '未通过' });
  assert.equal(r.warnings.length, 0, '同一次没通过只提醒一次');
  r = await save(t.amy, sid, { k1_result: '通过', k2_result: '通过', k3_result: '通过' });
  assert.equal(r.stage, '科目四', '一次补录多科，连着往下走');
  r = await save(t.amy, sid, { k4_result: '通过' });
  assert.equal(r.stage, '已拿证待回访');
  r = await save(t.amy, sid, { license_on: T });
  assert.equal(r.stage, '已拿证待回访', '拿了证但还没回访，不算完结');
  const page = await h.ok(t.amy, 'students.get', { id: sid });
  r = await save(t.amy, sid, { checks: page.checks.concat(['k4c']), visit_smooth: '教练有耐心', refer_willing: '愿意' });
  assert.equal(r.stage, '已完结');
  const s = h.mock.raw('jx_students', sid);
  assert.equal(s.active, false);
  // 完结以后不再要求日期，也不再出现在交付统计里
  await save(t.amy, sid, { next_action_on: '', remark: '已寄感谢卡' });
  assert.equal((await h.ok(t.amy, 'home.get', {})).dc.active, 0);
  assert.deepEqual((await h.ok(t.amy, 'students.list', {})).items, []);
  assert.equal((await h.ok(t.amy, 'students.list', { stage: 'all' })).items.length, 1);
  assert.deepEqual((await h.ok(t.amy, 'referrals.list', {})).willing.map((w) => w.id), [sid]);
});

test('手动改阶段以手动的为准；退费或转校算结束', async () => {
  const t = await h.team();
  await h.product(t);
  const sid = await student(t);
  let r = await save(t.amy, sid, { stage: '科目三', docs_status: '齐全' });
  assert.equal(r.stage, '科目三');
  r = await save(t.amy, sid, { stage: '乱写的阶段' });
  assert.equal(r.stage, '科目三');
  r = await save(t.amy, sid, { stage: '退费或转校', next_action_on: '' });
  assert.equal(r.stage, '退费或转校');
  assert.equal(h.mock.raw('jx_students', sid).active, false);
});

test('清单可以勾也可以取消；不认识的项目不会被存下来', async () => {
  const t = await h.team();
  await h.product(t);
  const sid = await student(t);
  await save(t.amy, sid, { checks: ['e1', 'h2', 'k1a', 'k1a', 'bogus', '__proto__'] });
  assert.deepEqual(h.mock.raw('jx_students', sid).checks, ['e1', 'h2', 'k1a']);
  await save(t.amy, sid, { checks: 'e1' });
  assert.deepEqual(h.mock.raw('jx_students', sid).checks, []);
  const page = await h.ok(t.amy, 'students.get', { id: sid });
  assert.equal(page.blocks.length, 7);
  assert.equal(page.blocks.filter((b) => b.current).map((b) => b.key).join(), 'handover');
  assert.equal(page.blocks[0].total, 6);
});

test('保存学员页不会把学员“接管”过来；交付负责人只有能看全部的人能改', async () => {
  const t = await h.team();
  await h.product(t);
  const sid = await student(t, t.amy);
  await h.ok(t.boss, 'students.get', { id: sid });
  await save(t.boss, sid, { remark: '管理员补了一句' });
  assert.equal(h.mock.raw('jx_students', sid).owner_id, t.uid.amy);
  await save(t.boss, sid, { owner_id: t.uid.bob });
  assert.equal(h.mock.raw('jx_students', sid).owner_id, t.uid.bob);
  await save(t.boss, sid, { owner_id: 'nobody' });
  assert.equal(h.mock.raw('jx_students', sid).owner_id, t.uid.bob);
  await h.ok(t.boss, 'team.update', { members_only_own: true });
  // 小艾是销售负责人，仍然看得到；但她改不了交付负责人
  await save(t.amy, sid, { owner_id: t.uid.amy, remark: '销售补充' });
  const s = h.mock.raw('jx_students', sid);
  assert.equal(s.owner_id, t.uid.bob);
  assert.equal(s.remark, '销售补充');
});

test('异常只有解决并回访确认后才关闭', async () => {
  const t = await h.team();
  await h.product(t);
  const sid = await student(t);
  const base = { student_id: sid, occurred_on: T, stage: '科目二', kind: '约不到车', description: '连续两周约不到车' };
  let res = await h.fail(t.amy, 'issues.save', base, 'INVALID');
  assert.ok(res.errors.some((e) => e.indexOf('联系了谁') >= 0));
  assert.ok(res.errors.some((e) => e.indexOf('预计什么时候解决') >= 0));
  await h.fail(t.amy, 'issues.save', Object.assign({}, base, { occurred_on: '' }), 'INVALID', '请填发生日期');
  await h.fail(t.amy, 'issues.save', Object.assign({}, base, { occurred_on: day(1), contacted: '教练', eta_on: day(2) }), 'INVALID', '发生日期不能晚于今天');
  await h.fail(t.amy, 'issues.save', Object.assign({}, base, { description: '', contacted: '教练', eta_on: day(2) }), 'INVALID', '请写问题描述');
  await h.fail(t.amy, 'issues.save', Object.assign({}, base, { contacted: '教练', eta_on: day(2), revisit_ok: true }), 'INVALID', '不能先勾');
  await h.fail(t.amy, 'issues.save', Object.assign({}, base, { solved_on: day(1) }), 'INVALID', '实际解决日期不能晚于今天');
  const full = Object.assign({}, base, { contacted: '训练场排班老师', eta_on: day(2) });
  res = await h.ok(t.amy, 'issues.save', full);
  assert.equal(res.status, '处理中');
  const id = h.mock.rows('jx_issues')[0]._id;
  assert.equal((await h.ok(t.amy, 'students.list', {})).items[0].open_issues, 1);
  assert.equal((await h.ok(t.amy, 'home.get', {})).issues, 1);
  res = await h.ok(t.amy, 'issues.save', Object.assign({}, full, { id: id, solved_on: T }));
  assert.equal(res.status, '已解决待回访');
  assert.equal(res.warn, true);
  assert.equal((await h.ok(t.amy, 'issues.list', {})).open_count, 1, '没回访的还算没关闭');
  res = await h.ok(t.amy, 'issues.save', Object.assign({}, full, { id: id, solved_on: T, revisit_ok: true }));
  assert.equal(res.status, '已关闭');
  assert.equal((await h.ok(t.amy, 'issues.list', {})).items.length, 0);
  const all = await h.ok(t.amy, 'issues.list', { all: true });
  assert.equal(all.items.length, 1);
  assert.equal(all.items[0].student_name, h.mock.raw('jx_students', sid).name);
  assert.equal((await h.ok(t.amy, 'home.get', {})).issues, 0);
  await h.fail(t.amy, 'issues.remove', { id: id }, 'FORBIDDEN');
  await h.ok(t.boss, 'issues.remove', { id: id });
  assert.equal(h.mock.rows('jx_issues').length, 0);
});

test('约不到车而台账里没有记录时会提醒；记了就不再提醒', async () => {
  const t = await h.team();
  await h.product(t);
  const sid = await student(t);
  let r = await save(t.amy, sid, { k2_booking: '约不到' });
  assert.match(r.warnings[0], /记进异常台账/);
  await h.ok(t.amy, 'issues.save', { student_id: sid, occurred_on: T, description: '约不到车', contacted: '教练', eta_on: day(1) });
  r = await save(t.amy, sid, { k2_booking: '约不到' });
  assert.deepEqual(r.warnings, []);
  const form = await h.ok(t.amy, 'issues.form', { student: sid });
  assert.equal(form.preset, sid);
  assert.equal(form.students.length, 1);
});

test('不挂学员的异常大家都能看到；预计解决时间过了会标出来', async () => {
  const t = await h.team();
  await h.ok(t.amy, 'issues.save', { occurred_on: day(-3), description: '训练场临时关闭', contacted: '驾校教务', eta_on: day(-1), kind: '排期变化' });
  await h.ok(t.boss, 'team.update', { members_only_own: true });
  const list = await h.ok(t.bob, 'issues.list', {});
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].eta_overdue, true);
  assert.equal(list.items[0].student_name, '');
});

test('学员列表：筛选和交付提醒', async () => {
  const t = await h.team();
  await h.product(t);
  const a = await student(t, t.amy, { name: '待办今天' });
  const b = await student(t, t.amy, { name: '三天后考试' });
  const c = await student(t, t.bob, { name: '缺资料' });
  const d = await student(t, t.bob, { name: '八天后考试' });
  const e = await student(t, t.bob, { name: '逾期' });
  await save(t.amy, b, { next_action_on: day(10), k2_exam_on: day(3), k2_booking: '约不到' });
  await save(t.bob, c, { next_action_on: day(5), docs_status: '缺资料', docs_missing: '照片' });
  await save(t.bob, d, { next_action_on: day(9), k3_exam_on: day(8), k1_exam_on: day(-20) });
  h.mock.state.collections.get('jx_students').get(e).next_action_on = day(-2);
  h.mock.state.collections.get('jx_students').get(d).next_action_on = '';
  const names = async (q) => (await h.ok(t.boss, 'students.list', q)).items.map((s) => s.name);
  assert.deepEqual(await names({}), ['八天后考试', '逾期', '待办今天', '缺资料', '三天后考试']);
  assert.deepEqual(await names({ flag: 'due' }), ['逾期', '待办今天']);
  assert.deepEqual(await names({ flag: 'exam' }), ['三天后考试']);
  assert.deepEqual(await names({ flag: 'none' }), ['八天后考试']);
  assert.deepEqual(await names({ flag: 'docs' }), ['缺资料']);
  assert.deepEqual(await names({ flag: 'booking' }), ['三天后考试']);
  assert.deepEqual(await names({ owner: t.uid.amy }), ['待办今天', '三天后考试']);
  assert.deepEqual(await names({ q: '考试' }), ['八天后考试', '三天后考试']);
  assert.deepEqual(await names({ stage: '科目一' }), []);
  const one = (await h.ok(t.boss, 'students.list', { flag: 'exam' })).items[0];
  assert.equal(one.exam_label, '3 天后考科目二');
  assert.equal(one.exam_soon, true);
  const home = await h.ok(t.boss, 'home.get', {});
  assert.deepEqual(home.dc, { active: 5, due: 2, exams7: 1, unscheduled: 1, docs_missing: 1, booking: 1 });
  assert.deepEqual(home.reminders.map((r) => r.name), ['逾期', '待办今天', '三天后考试']);
  assert.deepEqual(home.reminders[0].hints, [{ text: '待办逾期 2 天', cls: 'due-over' }]);
  assert.deepEqual(home.reminders[2].hints, [{ text: '3 天后考科目二', cls: 'due-soon' }]);
  assert.deepEqual((await h.ok(t.amy, 'home.get', { mine: true })).reminders.map((r) => r.name), ['待办今天', '三天后考试']);
  void a;
});
