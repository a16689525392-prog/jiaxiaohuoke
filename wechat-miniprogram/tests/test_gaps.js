// 变异测试找出来的空当：这些地方的代码改坏了，原来的测试发现不了，所以各补一条。
'use strict';
const { test, beforeEach } = require('node:test');
const h = require('./helper');
const assert = h.assert;
const T = h.TODAY;
const day = (n) => h.core.addDays(T, n);

beforeEach(h.fresh);

const ALL = ['e1', 'e2', 'e3', 'e4'];
async function student(t, who, extra) {
  const id = await h.customer(t, who, extra);
  await h.ok(who, 'customers.enroll', { id: id, action: 'enroll', checks: ALL, contract: true, receipt: true, next_on: T });
  return 'stu_' + id;
}
async function save(who, sid, changes) {
  const page = await h.ok(who, 'students.get', { id: sid });
  return h.ok(who, 'students.save', Object.assign({}, page.f, { id: sid, checks: page.checks }, changes));
}

test('编辑资料时没换负责人，就不记“负责人变更”', async () => {
  const t = await h.team();
  const id = await h.customer(t, t.amy);
  await h.ok(t.amy, 'customers.save', { id: id, name: '只改了名字', channel_id: t.ch, owner_id: t.uid.amy });
  await h.ok(t.boss, 'customers.save', { id: id, name: '管理员也只改了名字', channel_id: t.ch });
  assert.equal(h.mock.rows('jx_followups').length, 1);
  assert.equal(h.mock.raw('jx_customers', id).owner_id, t.uid.amy);
});

test('只看自己的成员：自己学员的异常看得到，别人学员的看不到', async () => {
  const t = await h.team();
  await h.product(t);
  const mine = await student(t, t.amy, { name: '我的学员' });
  const theirs = await student(t, t.bob, { name: '别人的学员' });
  for (const [who, sid] of [[t.amy, mine], [t.bob, theirs]]) {
    await h.ok(who, 'issues.save', { student_id: sid, occurred_on: T, description: '约不到车', contacted: '教练', eta_on: day(1) });
  }
  await h.ok(t.boss, 'team.update', { members_only_own: true });
  const list = await h.ok(t.amy, 'issues.list', {});
  assert.deepEqual(list.items.map((i) => i.student_name), ['我的学员']);
  assert.equal(list.open_count, 1);
  assert.equal((await h.ok(t.amy, 'home.get', {})).issues, 1);
  assert.equal((await h.ok(t.boss, 'issues.list', {})).items.length, 2);
  assert.equal((await h.ok(t.boss, 'home.get', { mine: true })).issues, 0);
  await h.ok(t.amy, 'issues.form', { id: h.mock.rows('jx_issues').find((i) => i.student_id === mine)._id });
});

test('记异常时的学员选项：交付中的，加上这条记录原来挂的那位（即使已经完结）', async () => {
  const t = await h.team();
  await h.product(t);
  const a = await student(t, t.amy, { name: '还在交付' });
  const b = await student(t, t.amy, { name: '已经完结' });
  const c = await student(t, t.amy, { name: '另一位完结的' });
  await h.ok(t.amy, 'issues.save', { student_id: b, occurred_on: T, description: '拿证前的问题', contacted: '教务', eta_on: day(1) });
  for (const sid of [b, c]) { await save(t.amy, sid, { stage: '已完结', next_action_on: '' }); }
  const issue = h.mock.rows('jx_issues')[0]._id;
  const names = (f) => f.students.map((s) => s.name).sort();
  assert.deepEqual(names(await h.ok(t.amy, 'issues.form', {})), ['还在交付 · 资料准备']);
  const edit = await h.ok(t.amy, 'issues.form', { id: issue });
  assert.deepEqual(names(edit), ['已经完结 · 已完结', '还在交付 · 资料准备'].sort());
  assert.equal(edit.preset, b);
  const preset = await h.ok(t.amy, 'issues.form', { student: c });
  assert.deepEqual(names(preset), ['另一位完结的 · 已完结', '还在交付 · 资料准备'].sort());
  assert.equal((await h.ok(t.amy, 'issues.form', { student: 'nope' })).preset, '');
  void a;
});

test('成员管理的边角：已加入的不能再“通过”；称呼不能改成空的；管理员可以给自己改称呼', async () => {
  const t = await h.team();
  await h.fail(t.boss, 'members.approve', { uid: t.uid.amy }, 'INVALID', '不在等待审核');
  await h.fail(t.boss, 'members.reject', { uid: t.uid.amy }, 'INVALID', '已经加入了');
  await h.fail(t.boss, 'members.update', { uid: t.uid.amy, name: '  ' }, 'INVALID', '请填你的称呼');
  await h.fail(t.boss, 'members.update', { uid: t.uid.amy, name: '一'.repeat(21) }, 'INVALID', '最多 20 个字');
  assert.equal(h.mock.rows('jx_members').find((m) => m.uid === t.uid.amy).name, '小艾');
  await h.ok(t.boss, 'members.update', { uid: t.uid.boss, name: '大老板' });        // 唯一的管理员改自己的称呼
  await h.ok(t.boss, 'members.update', { uid: t.uid.boss, role: 'admin', status: 'active' });
  const boss = h.mock.rows('jx_members').find((m) => m.uid === t.uid.boss);
  assert.deepEqual([boss.name, boss.role, boss.status], ['大老板', 'admin', 'active']);
  await h.ok('o-wait', 'team.join', { code: t.code, my_name: '等待中' });
  const waiting = h.mock.rows('jx_members').find((m) => m.name === '等待中').uid;
  await h.fail(t.boss, 'members.update', { uid: waiting, role: 'admin' }, 'INVALID', '先通过或拒绝');
  // 两位管理员时，可以停用其中一位；停用的管理员不算数
  await h.ok(t.boss, 'members.update', { uid: t.uid.amy, role: 'admin' });
  await h.ok(t.boss, 'members.update', { uid: t.uid.amy, status: 'disabled' });
  await h.fail(t.boss, 'members.update', { uid: t.uid.boss, role: 'member' }, 'INVALID', '至少要有一位');
  await h.ok(t.boss, 'members.update', { uid: t.uid.amy, status: 'active' });
  await h.ok(t.boss, 'team.leave', {});
  assert.equal((await h.ok(t.amy, 'session.get', {})).me.is_admin, true);
});
