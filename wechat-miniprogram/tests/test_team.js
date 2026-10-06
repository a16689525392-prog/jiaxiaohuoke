'use strict';
const { test, beforeEach } = require('node:test');
const h = require('./helper');
const assert = h.assert;

beforeEach(h.fresh);

test('第一次使用：集合自动建好，没加入团队的人只能看到自己的状态', async () => {
  const s = await h.ok('o-new', 'session.get', {});
  assert.equal(s.state, 'none');
  assert.equal(s.need_code, true);
  assert.equal(h.mock.state.collections.size, 10);
  await h.fail('o-new', 'home.get', {}, 'NEED_JOIN');
  await h.fail('o-new', 'customers.list', {}, 'NEED_JOIN');
  await h.fail('o-new', 'members.list', {}, 'NEED_JOIN');
});

test('创建团队要口令；创建人是管理员，自带默认渠道和话术', async () => {
  await h.fail('o-a', 'team.create', { team_name: '东区', my_name: '老板', code: 'nope' }, 'INVALID', '创建口令不对');
  await h.fail('o-a', 'team.create', { team_name: '', my_name: '', code: h.config.TEAM_CREATE_CODE }, 'INVALID', '请填团队名称');
  assert.equal(h.mock.rows('jx_teams').length, 0);
  const s = await h.ok('o-a', 'team.create', { team_name: '东区招生组', my_name: '老板', code: ' ' + h.config.TEAM_CREATE_CODE.toLowerCase() + ' ' });
  assert.equal(s.state, 'active');
  assert.equal(s.me.is_admin, true);
  assert.match(s.team.invite_code, /^[A-Z2-9]{8}$/);
  assert.equal(h.mock.rows('jx_channels').length, 10);
  assert.equal(h.mock.rows('jx_scripts').length, 17);
  assert.equal(h.mock.rows('jx_teams')[0].seeded, true);
  await h.fail('o-a', 'team.create', { team_name: '再建一个', my_name: '老板', code: h.config.TEAM_CREATE_CODE }, 'INVALID', '已经在团队');
});

test('默认内容建到一半断了，管理员下次进来会补齐，而且不会多出一份', async () => {
  await h.ok('o-a', 'team.create', { team_name: '东区', my_name: '老板', code: h.config.TEAM_CREATE_CODE });
  const team = h.mock.rows('jx_teams')[0];
  const coll = h.mock.state.collections;
  coll.get('jx_teams').get(team._id).seeded = false;
  coll.get('jx_scripts').delete(team._id + '_sc3');
  coll.get('jx_channels').delete(team._id + '_ch0');
  await h.ok('o-a', 'session.get', {});
  assert.equal(h.mock.rows('jx_channels').length, 10);
  assert.equal(h.mock.rows('jx_scripts').length, 17);
  assert.equal(h.mock.rows('jx_teams')[0].seeded, true);
});

test('凭邀请码加入要等管理员通过；通过之前什么都看不到', async () => {
  const boss = await h.ok('o-a', 'team.create', { team_name: '东区', my_name: '老板', code: h.config.TEAM_CREATE_CODE });
  await h.fail('o-b', 'team.join', { code: 'ZZZZZZZZ', my_name: '小艾' }, 'INVALID', '邀请码不对');
  await h.fail('o-b', 'team.join', { code: boss.team.invite_code, my_name: '' }, 'INVALID', '称呼');
  const s = await h.ok('o-b', 'team.join', { code: boss.team.invite_code.toLowerCase(), my_name: '小艾' });
  assert.equal(s.state, 'pending');
  assert.equal(s.team.name, '东区');
  assert.equal(s.team.invite_code, undefined);
  await h.fail('o-b', 'home.get', {}, 'NEED_JOIN');
  await h.fail('o-b', 'customers.save', { name: 'x' }, 'NEED_JOIN');
  assert.equal((await h.ok('o-a', 'session.get', {})).pending_count, 1);
  const list = await h.ok('o-a', 'members.list', {});
  assert.equal(list.items[0].status, 'pending');
  const res = await h.ok('o-a', 'members.approve', { uid: list.items[0].uid });
  assert.match(res.message, /小艾/);
  const after = await h.ok('o-b', 'session.get', {});
  assert.equal(after.state, 'active');
  assert.equal(after.me.is_admin, false);
  assert.equal(after.team.invite_code, undefined, '普通成员看不到邀请码');
  await h.ok('o-b', 'home.get', {});
});

test('拒绝、撤回申请、换邀请码', async () => {
  const boss = await h.ok('o-a', 'team.create', { team_name: '东区', my_name: '老板', code: h.config.TEAM_CREATE_CODE });
  const code = boss.team.invite_code;
  await h.ok('o-b', 'team.join', { code: code, my_name: '小艾' });
  await h.ok('o-c', 'team.join', { code: code, my_name: '小博' });
  assert.equal((await h.ok('o-b', 'team.leave', {})).state, 'none');           // 自己撤回
  const list = await h.ok('o-a', 'members.list', {});
  assert.deepEqual(list.items.map((m) => m.name), ['小博', '老板']);
  await h.ok('o-a', 'members.reject', { uid: list.items[0].uid });
  assert.equal((await h.ok('o-c', 'session.get', {})).state, 'none');
  const fresh = (await h.ok('o-a', 'team.reset_invite', {})).invite_code;
  assert.notEqual(fresh, code);
  await h.fail('o-c', 'team.join', { code: code, my_name: '小博' }, 'INVALID', '邀请码不对');
  await h.ok('o-c', 'team.join', { code: fresh, my_name: '小博' });
});

test('普通成员用不了管理功能', async () => {
  const t = await h.team();
  const admin = ['members.list', 'members.approve', 'members.reject', 'members.update', 'team.get', 'team.update', 'team.reset_invite',
    'channels.get', 'channels.save', 'channels.archive', 'products.form', 'products.save', 'products.archive',
    'scripts.get', 'scripts.save', 'scripts.remove', 'issues.remove', 'selftest.run'];
  for (const action of admin) { await h.fail(t.amy, action, { uid: t.uid.bob, id: 'x' }, 'FORBIDDEN'); }
  assert.equal(h.mock.rows('jx_teams')[0].invite_code, t.code);
});

test('停用的成员马上进不来；记录还在他名下；恢复后照常', async () => {
  const t = await h.team();
  const cid = await h.customer(t, t.amy);
  const res = await h.ok(t.boss, 'members.update', { uid: t.uid.amy, status: 'disabled' });
  assert.match(res.message, /记得改给别人/);
  assert.equal((await h.ok(t.amy, 'session.get', {})).state, 'disabled');
  await h.fail(t.amy, 'customers.get', { id: cid }, 'NEED_JOIN');
  const c = await h.ok(t.boss, 'customers.get', { id: cid });
  assert.equal(c.c.owner, '小艾');
  const form = await h.ok(t.boss, 'customers.form', { id: cid });
  assert.ok(form.members.some((m) => m.name === '小艾（已停用）'), '编辑时原负责人还在选项里');
  const fresh = await h.ok(t.boss, 'customers.form', {});
  assert.ok(!fresh.members.some((m) => /小艾/.test(m.name)), '新登记时不能选已停用的人');
  await h.ok(t.boss, 'members.update', { uid: t.uid.amy, status: 'active' });
  await h.ok(t.amy, 'customers.get', { id: cid });
});

test('团队里至少要留一位在用的管理员', async () => {
  const t = await h.team();
  await h.fail(t.boss, 'members.update', { uid: t.uid.boss, role: 'member' }, 'INVALID', '至少要有一位');
  await h.fail(t.boss, 'members.update', { uid: t.uid.boss, status: 'disabled' }, 'INVALID', '不能停用自己');
  await h.fail(t.boss, 'team.leave', {}, 'INVALID', '唯一的管理员');
  await h.ok(t.boss, 'members.update', { uid: t.uid.amy, role: 'admin' });
  await h.ok(t.amy, 'members.update', { uid: t.uid.boss, role: 'member' });
  await h.fail(t.boss, 'members.list', {}, 'FORBIDDEN');
  await h.fail(t.amy, 'members.update', { uid: t.uid.amy, role: 'member' }, 'INVALID', '至少要有一位');
});

test('退出团队后，原来由他负责的记录仍然显示得出是谁；可以再申请加入', async () => {
  const t = await h.team();
  const cid = await h.customer(t, t.amy);
  assert.equal((await h.ok(t.amy, 'team.leave', {})).state, 'none');
  assert.equal((await h.ok(t.boss, 'customers.get', { id: cid })).c.owner, '小艾');
  const list = await h.ok(t.boss, 'members.list', {});
  assert.equal(list.items.filter((m) => m.status === 'left').length, 1);
  await h.fail(t.boss, 'members.update', { uid: t.uid.amy, status: 'active' }, 'NOT_FOUND');
  const again = await h.ok(t.amy, 'team.join', { code: t.code, my_name: '小艾' });
  assert.equal(again.state, 'pending');
});

test('改称呼、团队设置', async () => {
  const t = await h.team();
  assert.equal((await h.ok(t.amy, 'me.rename', { name: '艾米' })).me.name, '艾米');
  await h.fail(t.amy, 'me.rename', { name: '   ' }, 'INVALID');
  await h.fail(t.boss, 'team.update', { name: '' }, 'INVALID');
  await h.fail(t.boss, 'team.update', { start_date: '明天' }, 'INVALID', '格式不对');
  const s = await h.ok(t.boss, 'team.update', { name: '西区', unified_entry: '企业微信：西区招生', reward_desc: '每成功推荐 1 位奖励 100 元', members_only_own: true });
  assert.equal(s.team.name, '西区');
  const g = await h.ok(t.boss, 'team.get', {});
  assert.equal(g.unified_entry, '企业微信：西区招生');
  assert.equal(g.members_only_own, true);
  assert.equal(g.rules[0].value, '每成功推荐 1 位奖励 100 元');
  assert.equal(g.rules.length, 5);
});

test('解散团队：要原样输入团队名称；只删这个团队的数据，别的团队不受影响；成员下次进来回到欢迎页', async () => {
  const a = await h.team('甲');
  const b = await h.team('乙');
  await h.product(a);
  const cid = await h.customer(a, a.amy);
  await h.ok(a.amy, 'customers.enroll', { id: cid, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: h.TODAY });
  await h.ok(a.amy, 'issues.save', { student_id: 'stu_' + cid, occurred_on: h.TODAY, description: '约不到车', contacted: '教练', eta_on: h.TODAY });
  await h.ok(a.amy, 'data.daily_save', { rows: [{ day: h.TODAY, exposure: '10' }] });
  await h.customer(b, b.amy);
  const count = (teamName) => {
    const team = h.mock.rows('jx_teams').find((t) => t.name === teamName);
    if (!team) { return -1; }
    return ['jx_members', 'jx_products', 'jx_scripts', 'jx_channels', 'jx_customers', 'jx_followups', 'jx_students', 'jx_issues', 'jx_daily']
      .reduce((n, c) => n + h.mock.rows(c).filter((r) => r.team_id === team._id).length, 0);
  };
  const before = count('乙东区招生组');
  assert.ok(count('甲东区招生组') > 35);
  await h.fail(a.amy, 'team.dissolve', { name: '甲东区招生组' }, 'FORBIDDEN');
  await h.fail(a.boss, 'team.dissolve', { name: '东区招生组' }, 'INVALID', '没有对上');
  await h.fail(a.boss, 'team.dissolve', {}, 'INVALID', '没有对上');
  await h.fail(b.boss, 'team.dissolve', { name: '甲东区招生组' }, 'INVALID', '没有对上');     // 不能解散别人的团队
  assert.ok(count('甲东区招生组') > 35);
  const s = await h.ok(a.boss, 'team.dissolve', { name: ' 甲东区招生组 ' });
  assert.equal(s.state, 'none');
  assert.equal(count('甲东区招生组'), -1);
  for (const coll of h.mock.state.collections.keys()) {
    assert.ok(h.mock.rows(coll).every((r) => r.team_id !== undefined ? /^t/.test(r.team_id) : true));
  }
  assert.equal(h.mock.rows('jx_teams').length, 1);
  assert.equal(count('乙东区招生组'), before, '另一个团队一条都没少');
  assert.equal((await h.ok(a.amy, 'session.get', {})).state, 'none');
  await h.fail(a.bob, 'home.get', {}, 'NEED_JOIN');
  await h.ok(b.amy, 'home.get', {});
  // 解散以后可以重新开始
  const again = await h.ok(a.boss, 'team.create', { team_name: '重新来过', my_name: '老板', code: h.config.TEAM_CREATE_CODE });
  assert.equal(again.state, 'active');
  assert.equal((await h.ok(a.boss, 'customers.list', { follow: 'all' })).total, 0);
});

test('解散到一半断了（团队没了，成员记录还在）：这些成员下次进来被当作还没加入', async () => {
  const t = await h.team();
  const team = h.mock.rows('jx_teams')[0];
  h.mock.state.collections.get('jx_teams').delete(team._id);
  assert.equal((await h.ok(t.amy, 'session.get', {})).state, 'none');
  await h.fail(t.bob, 'customers.list', {}, 'NEED_JOIN');
  assert.equal(h.mock.rows('jx_members').length, 1);
  await h.ok(t.amy, 'team.create', { team_name: '新团队', my_name: '小艾', code: h.config.TEAM_CREATE_CODE });
});
