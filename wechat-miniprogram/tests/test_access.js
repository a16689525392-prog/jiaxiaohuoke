'use strict';
const { test, beforeEach } = require('node:test');
const h = require('./helper');
const assert = h.assert;
const T = h.TODAY;
const day = (n) => h.core.addDays(T, n);
const api = require('../cloudfunctions/api/index');
const router = require('../cloudfunctions/api/lib/router');
const store = require('../cloudfunctions/api/lib/store');

beforeEach(h.fresh);

const ALL = ['e1', 'e2', 'e3', 'e4'];
async function enrol(t, who, id, extra) {
  await h.ok(who, 'customers.enroll', Object.assign({ id: id, action: 'enroll', checks: ALL, contract: true, receipt: true, next_on: T }, extra || {}));
  return 'stu_' + id;
}

test('两个团队的数据完全隔开：看不到、改不了、统计里也没有', async () => {
  const a = await h.team('甲');
  const b = await h.team('乙');
  const pa = await h.product(a);
  const ca = await h.customer(a, a.amy, { name: '甲队客户', product_id: pa });
  const cb = await h.customer(b, b.amy, { name: '乙队客户' });
  const sa = await enrol(a, a.amy, ca);
  await h.ok(a.amy, 'issues.save', { student_id: sa, occurred_on: T, description: '甲队的异常', contacted: '教练', eta_on: day(1) });
  const issue = h.mock.rows('jx_issues')[0]._id;
  await h.ok(a.amy, 'data.daily_save', { rows: [{ day: T, exposure: '500' }] });
  const script = h.mock.rows('jx_scripts').find((s) => s.team_id === h.mock.rows('jx_teams')[0]._id)._id;

  // 乙队的人（包括乙队管理员）拿甲队的 id 来试
  for (const who of [b.boss, b.amy]) {
    await h.fail(who, 'customers.get', { id: ca }, 'NOT_FOUND');
    await h.fail(who, 'customers.form', { id: ca }, 'NOT_FOUND');
    await h.fail(who, 'customers.save', { id: ca, name: '改名', channel_id: b.ch }, 'NOT_FOUND');
    await h.fail(who, 'customers.follow', { id: ca, summary: '越权' }, 'NOT_FOUND');
    await h.fail(who, 'customers.remove', { id: ca }, 'NOT_FOUND');
    await h.fail(who, 'customers.enroll_info', { id: ca }, 'NOT_FOUND');
    await h.fail(who, 'customers.enroll', { id: ca, action: 'deposit', checks: ALL, next_on: T }, 'NOT_FOUND');
    await h.fail(who, 'students.get', { id: sa }, 'NOT_FOUND');
    await h.fail(who, 'students.save', { id: sa, next_action_on: T }, 'NOT_FOUND');
    await h.fail(who, 'issues.form', { id: issue }, 'NOT_FOUND');
    await h.fail(who, 'issues.save', { id: issue, occurred_on: T, description: 'x', contacted: 'x', eta_on: T }, 'NOT_FOUND');
    await h.fail(who, 'issues.save', { student_id: sa, occurred_on: T, description: 'x', contacted: 'x', eta_on: T }, 'NOT_FOUND');
    await h.fail(who, 'products.get', { id: pa }, 'NOT_FOUND');
  }
  await h.fail(b.boss, 'issues.remove', { id: issue }, 'NOT_FOUND');
  await h.fail(b.boss, 'products.form', { id: pa }, 'NOT_FOUND');
  await h.fail(b.boss, 'products.save', { id: pa, values: { name: '被改' } }, 'NOT_FOUND');
  await h.fail(b.boss, 'products.archive', { id: pa }, 'NOT_FOUND');
  await h.fail(b.boss, 'scripts.save', { id: script, grp: 'x', scene: 'x', body: 'x' }, 'NOT_FOUND');
  await h.fail(b.boss, 'scripts.remove', { id: script }, 'NOT_FOUND');
  await h.fail(b.boss, 'channels.save', { id: a.ch, name: '被改' }, 'NOT_FOUND');
  await h.fail(b.boss, 'channels.archive', { id: a.ch }, 'NOT_FOUND');
  await h.fail(b.boss, 'members.update', { uid: a.uid.amy, status: 'disabled' }, 'NOT_FOUND');
  await h.fail(b.boss, 'members.approve', { uid: a.uid.amy }, 'NOT_FOUND');

  // 用甲队的渠道、班型、推荐人、负责人来登记：一律不认
  await h.fail(b.amy, 'customers.save', { name: '串', channel_id: a.ch, next_follow_on: T }, 'INVALID', '请选来源渠道');
  const mixed = await h.customer(b, b.amy, { product_id: pa, referrer_id: ca, owner_id: a.uid.amy });
  const row = h.mock.raw('jx_customers', mixed);
  assert.deepEqual([row.product_id, row.referrer_id, row.owner_id], ['', '', b.uid.amy]);

  // 乙队各个页面里没有甲队的任何东西
  const home = await h.ok(b.boss, 'home.get', {});
  assert.deepEqual([home.fc.active, home.dc.active, home.issues], [2, 0, 0]);
  assert.deepEqual((await h.ok(b.boss, 'customers.list', { follow: 'all' })).items.map((c) => c.name).sort(), ['乙队客户', h.mock.raw('jx_customers', mixed).name].sort());
  assert.equal((await h.ok(b.boss, 'students.list', { stage: 'all' })).items.length, 0);
  assert.equal((await h.ok(b.boss, 'issues.list', { all: true })).items.length, 0);
  assert.equal((await h.ok(b.boss, 'products.list', {})).items.length, 0);
  assert.equal((await h.ok(b.boss, 'data.board', {})).rows[0].total, 0);
  assert.equal((await h.ok(b.boss, 'members.list', {})).items.length, 3);
  assert.equal((await h.ok(b.boss, 'calendar.get', {})).weeks[0][2].total, 2);
  assert.equal((await h.ok(b.boss, 'referrals.list', {})).people.length, 0);
  assert.equal((await h.ok(b.boss, 'channels.list', {})).items.reduce((n, c) => n + c.total, 0), 2);
  // 甲队的数据原样还在
  assert.equal(h.mock.raw('jx_customers', ca).name, '甲队客户');
  assert.equal(h.mock.raw('jx_products', pa).name, 'C1 周末班');
  void cb;
});

test('默认团队内互相看得到；打开“成员只看自己的”后，别人的记录到处都看不到', async () => {
  const t = await h.team();
  await h.product(t);
  const mine = await h.customer(t, t.amy, { name: '小艾的客户' });
  const theirs = await h.customer(t, t.bob, { name: '小博的客户' });
  const stu = await enrol(t, t.bob, await h.customer(t, t.bob, { name: '小博的学员' }));
  await h.ok(t.bob, 'issues.save', { student_id: stu, occurred_on: T, description: '小博学员的异常', contacted: '教练', eta_on: day(1) });
  const issue = h.mock.rows('jx_issues')[0]._id;
  assert.equal((await h.ok(t.amy, 'customers.list', { follow: 'all' })).items.length, 3);
  await h.ok(t.amy, 'customers.get', { id: theirs });
  assert.equal((await h.ok(t.amy, 'session.get', {})).me.sees_all, true);

  await h.ok(t.boss, 'team.update', { members_only_own: true });
  assert.equal((await h.ok(t.amy, 'session.get', {})).me.sees_all, false);
  const list = await h.ok(t.amy, 'customers.list', { follow: 'all', owner: t.uid.bob, mine: false });
  assert.deepEqual(list.items.map((c) => c.name), ['小艾的客户']);
  assert.deepEqual([list.can_all, list.mine, list.filters.owners.length], [false, true, 0]);
  await h.fail(t.amy, 'customers.get', { id: theirs }, 'NOT_FOUND');
  await h.fail(t.amy, 'customers.follow', { id: theirs, summary: '越权' }, 'NOT_FOUND');
  await h.fail(t.amy, 'customers.remove', { id: theirs }, 'NOT_FOUND');
  await h.fail(t.amy, 'students.get', { id: stu }, 'NOT_FOUND');
  await h.fail(t.amy, 'issues.form', { id: issue }, 'NOT_FOUND');
  await h.fail(t.amy, 'issues.save', { student_id: stu, occurred_on: T, description: 'x', contacted: 'x', eta_on: T }, 'NOT_FOUND');
  assert.equal((await h.ok(t.amy, 'students.list', { stage: 'all' })).items.length, 0);
  assert.equal((await h.ok(t.amy, 'issues.list', { all: true })).items.length, 0);
  assert.equal((await h.ok(t.amy, 'issues.form', {})).students.length, 0);
  const home = await h.ok(t.amy, 'home.get', { mine: false });
  assert.deepEqual([home.fc.active, home.dc.active, home.issues, home.mine], [1, 0, 0, true]);
  assert.equal((await h.ok(t.amy, 'calendar.get', {})).weeks[0][2].total, 1);
  assert.equal((await h.ok(t.amy, 'data.board', {})).rows[1].total, 1);
  assert.equal((await h.ok(t.amy, 'channels.list', {})).items[0].total, 1);
  assert.equal((await h.ok(t.amy, 'products.list', {})).items[0].customers, 0);
  // 登记时不能把客户挂到别人名下，也不能拿别人的客户当推荐人
  const id = await h.customer(t, t.amy, { owner_id: t.uid.bob, referrer_id: theirs });
  const row = h.mock.raw('jx_customers', id);
  assert.deepEqual([row.owner_id, row.referrer_id], [t.uid.amy, '']);
  assert.equal((await h.ok(t.amy, 'customers.form', {})).members.length, 0);
  // 管理员不受影响
  assert.equal((await h.ok(t.boss, 'customers.list', { follow: 'all' })).items.length, 4);
  await h.ok(t.boss, 'students.get', { id: stu });
  void mine;
});

test('销售负责人在学员交给别人交付后，仍然看得到这位学员', async () => {
  const t = await h.team();
  await h.product(t);
  const cid = await h.customer(t, t.amy);
  const stu = await enrol(t, t.amy, cid, { owner_id: t.uid.bob });
  await h.ok(t.boss, 'team.update', { members_only_own: true });
  for (const who of [t.amy, t.bob]) {
    await h.ok(who, 'students.get', { id: stu });
    assert.equal((await h.ok(who, 'students.list', {})).items.length, 1);
    assert.equal((await h.ok(who, 'home.get', {})).dc.active, 1);
  }
  await h.fail(t.bob, 'customers.get', { id: cid }, 'NOT_FOUND');     // 交付的人看不到销售阶段的客户记录
});

test('管理员把成员的记录改给别人', async () => {
  const t = await h.team();
  const id = await h.customer(t, t.amy);
  await h.ok(t.boss, 'members.update', { uid: t.uid.amy, status: 'disabled' });
  await h.ok(t.boss, 'customers.save', { id: id, name: '交接的客户', channel_id: t.ch, owner_id: t.uid.amy });
  assert.equal(h.mock.raw('jx_customers', id).owner_id, t.uid.amy, '不改负责人时，保持在已停用的人名下');
  await h.ok(t.boss, 'customers.save', { id: id, name: '交接的客户', channel_id: t.ch, owner_id: t.uid.bob });
  assert.equal(h.mock.raw('jx_customers', id).owner_id, t.uid.bob);
  const other = await h.customer(t, t.bob);
  await h.ok(t.boss, 'customers.save', { id: other, name: '不能给已停用的人', channel_id: t.ch, owner_id: t.uid.amy });
  assert.equal(h.mock.raw('jx_customers', other).owner_id, t.uid.bob);
});

test('云函数的信封：没有身份、动作不存在、内部出错', async () => {
  h.mock.as('');
  let res = await api.main({ action: 'home.get' });
  assert.deepEqual([res.ok, res.code], [false, 'NO_OPENID']);
  const t = await h.team();
  for (const action of ['', 'nope', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    await h.fail(t.boss, action, {}, 'NO_ACTION');
  }
  h.mock.as(t.boss);
  for (const event of [undefined, null, 'x', 5, [], { action: 5 }, { action: ['home.get'] }]) {
    res = await api.main(event);
    assert.equal(res.code, 'NO_ACTION');
  }
  res = await api.main({ action: 'home.get', data: 'not an object' });
  assert.equal(res.ok, true);
  res = await api.main({ action: 'home.get', data: [1, 2] });
  assert.equal(res.ok, true);
  h.mock.state.failNext = new Error('simulated outage');
  const err = console.error;
  console.error = () => {};
  res = await api.main({ action: 'home.get', data: {} });
  console.error = err;
  assert.deepEqual([res.ok, res.code, res.message, res.detail], [false, 'SERVER', '服务器出错了，请稍后再试。', 'simulated outage']);
  assert.equal((await api.main({ action: 'home.get', data: {} })).ok, true);
});

test('缺了某个集合：自动补建，并请用户再试一次', async () => {
  const t = await h.team();
  h.mock.state.collections.delete('jx_issues');
  const res = await h.raw(t.boss, 'issues.list', {});
  assert.deepEqual([res.ok, res.code], [false, 'RETRY']);
  assert.equal((await h.raw(t.boss, 'issues.list', {})).ok, true);
  assert.ok(store.isMissingCollection({ errMsg: 'collection.get:fail -502005 database collection not exists' }));
  assert.ok(!store.isMissingCollection(new Error('timeout')));
  assert.ok(store.isDuplicate({ errMsg: 'E11000 duplicate key error collection' }));
  assert.ok(!store.isDuplicate(new Error('timeout')));
});

test('每个动作都登记了权限级别', async () => {
  const actions = router.actions();
  assert.ok(actions.length >= 45, String(actions.length));
  const open = ['session.get', 'team.create', 'team.join', 'team.leave'];
  h.fresh();
  for (const action of actions) {
    const res = await h.raw('o-stranger', action, {});
    if (open.indexOf(action) >= 0) { assert.notEqual(res.code, 'NEED_JOIN', action); } else { assert.equal(res.code, 'NEED_JOIN', action); }
  }
});

test('乱七八糟的输入：只会得到“填得不对”或“没找到”，不会让云函数出错，也不会串数据', async () => {
  const t = await h.team();
  await h.product(t);
  const cid = await h.customer(t, t.amy);
  const stu = await enrol(t, t.amy, await h.customer(t, t.amy));
  const junk = [undefined, null, '', ' ', 0, -1, 1e21, NaN, true, false, [], [1], {}, { $ne: '' }, { a: { b: 1 } }, '__proto__', 'constructor', "' OR 1=1 --", '<script>alert(1)</script>', '9999-99-99', '2026-02-30', 'x'.repeat(5000), '🚗'.repeat(50), '\n\n\n', '%'];
  const fields = ['id', 'uid', 'name', 'my_name', 'team_name', 'code', 'channel_id', 'product_id', 'owner_id', 'referrer_id', 'grade', 'status', 'next_follow_on', 'next_action', 'summary', 'contact_on', 'registered_on', 'notes', 'action', 'checks', 'on', 'next_on', 'stage', 'docs_status', 'k1_result', 'k1_exam_on', 'next_action_on', 'license_on', 'student_id', 'student', 'occurred_on', 'eta_on', 'solved_on', 'revisit_ok', 'description', 'contacted', 'values', 'rows', 'q', 'page', 'follow', 'owner', 'mine', 'w', 'd', 'end', 'archived', 'all', 'flag', 'grp', 'scene', 'body', 'client_id', 'role', 'members_only_own', 'start_date', 'unified_entry', 'kind', 'how', 'step', 'run', 'channel'];
  const actions = router.actions().filter((a) => ['team.leave', 'team.reset_invite', 'selftest.run'].indexOf(a) < 0);
  const before = JSON.stringify([h.mock.raw('jx_customers', cid), h.mock.rows('jx_teams').map((x) => x._id)]);
  const quiet = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  let calls = 0;
  for (const action of actions) {
    for (let j = 0; j < junk.length; j++) {
      // 一次把所有字段都塞成同一种垃圾；再来一轮只有 id 是真的、其余是垃圾
      const all = {};
      fields.forEach((f) => { all[f] = junk[j]; });
      for (const d of [all, Object.assign({}, all, { id: action.indexOf('students') === 0 ? stu : cid })]) {
        const res = await h.raw(t.boss, action, d);
        calls++;
        assert.ok(res.ok || ['INVALID', 'NOT_FOUND', 'FORBIDDEN'].indexOf(res.code) >= 0, action + ' ← ' + String(JSON.stringify(junk[j])).slice(0, 40) + ' → ' + JSON.stringify(res).slice(0, 300));
      }
    }
  }
  console.error = quiet;
  assert.deepEqual(logged, []);
  assert.ok(calls > 2000, String(calls));
  // 还活着，而且数据结构没被写坏
  assert.equal((await h.ok(t.boss, 'session.get', {})).state, 'active');
  await h.ok(t.boss, 'home.get', {});
  await h.ok(t.boss, 'customers.list', { follow: 'all' });
  await h.ok(t.boss, 'students.list', { stage: 'all' });
  for (const c of h.mock.rows('jx_customers')) {
    assert.equal(typeof c.name, 'string');
    assert.ok(c.name.length > 0 && c.name.length <= 40);
    assert.equal(typeof c.active, 'boolean');
    assert.ok(c.next_follow_on === '' || /^\d{4}-\d\d-\d\d$/.test(c.next_follow_on), c.next_follow_on);
    assert.ok(['', 'A', 'B', 'C', 'D'].indexOf(c.grade) >= 0);
  }
  for (const s of h.mock.rows('jx_students')) { assert.ok(Array.isArray(s.checks)); }
  void before;
});
