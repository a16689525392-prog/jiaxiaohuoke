'use strict';
const { test, beforeEach } = require('node:test');
const h = require('./helper');
const assert = h.assert;
const T = h.TODAY;
const day = (n) => h.core.addDays(T, n);

beforeEach(h.fresh);

test('还在跟进的客户必须有下次跟进时间，而且不能是过去', async () => {
  const t = await h.team();
  const base = { name: '林同学', channel_id: t.ch, grade: 'B', status: '已问需求' };
  await h.fail(t.amy, 'customers.save', base, 'INVALID', '必须写下次跟进时间');
  await h.fail(t.amy, 'customers.save', Object.assign({}, base, { next_follow_on: day(-1) }), 'INVALID', '不能早于今天');
  await h.fail(t.amy, 'customers.save', Object.assign({}, base, { next_follow_on: '下周' }), 'INVALID', '日期格式不对');
  assert.equal(h.mock.rows('jx_customers').length, 0);
  // D 类和“暂不跟进”不需要
  await h.ok(t.amy, 'customers.save', Object.assign({}, base, { grade: 'D' }));
  await h.ok(t.amy, 'customers.save', Object.assign({}, base, { status: '暂不跟进' }));
  await h.ok(t.amy, 'customers.save', Object.assign({}, base, { next_follow_on: '2026/10/9' }));
  const rows = h.mock.rows('jx_customers');
  assert.deepEqual(rows.map((c) => c.active), [false, false, true]);
  assert.equal(rows[2].next_follow_on, '2026-10-09');
});

test('登记要有称呼和来源渠道；登记日期不能是将来；只收业务必要的信息', async () => {
  const t = await h.team();
  const res = await h.fail(t.amy, 'customers.save', { next_follow_on: T }, 'INVALID');
  assert.ok(res.errors.some((e) => e.indexOf('请填称呼') >= 0));
  assert.ok(res.errors.some((e) => e.indexOf('请选来源渠道') >= 0));
  const base = { name: '林同学', channel_id: t.ch, next_follow_on: T };
  await h.fail(t.amy, 'customers.save', Object.assign({}, base, { channel_id: 'constructor' }), 'INVALID', '请选来源渠道');
  await h.fail(t.amy, 'customers.save', Object.assign({}, base, { channel_id: { $ne: '' } }), 'INVALID', '请选来源渠道');
  await h.fail(t.amy, 'customers.save', Object.assign({}, base, { registered_on: day(1) }), 'INVALID', '不能晚于今天');
  await h.fail(t.amy, 'customers.save', Object.assign({}, base, { name: '一'.repeat(41) }), 'INVALID', '太长');
  await h.fail(t.amy, 'customers.save', Object.assign({}, base, { contact: '11010119900307451X' }), 'INVALID', '身份证号');
  await h.fail(t.amy, 'customers.save', Object.assign({}, base, { notes: '身份证110101199003074514，想学C1' }), 'INVALID', '身份证号');
  await h.ok(t.amy, 'customers.save', Object.assign({}, base, { contact: '微信 lin_2026 / 13800138000' }));
  const c = h.mock.rows('jx_customers')[0];
  assert.equal(c.status, '新加微信');
  assert.equal(c.grade, '');
  assert.equal(c.registered_on, T);
  assert.ok(!('id_number' in c));
});

test('登记时写的状态和分级会记下漏斗日期，并留下一条登记日志', async () => {
  const t = await h.team();
  const id = await h.customer(t, t.amy, { grade: 'A', status: '已匹配报价', notes: '想报周末班', registered_on: day(-2) });
  const c = h.mock.raw('jx_customers', id);
  assert.equal(c.consulted_on, day(-2));
  assert.equal(c.grade_a_on, day(-2));
  assert.equal(c.last_contact_on, day(-2));
  assert.equal(c.owner_id, t.uid.amy);
  const page = await h.ok(t.amy, 'customers.get', { id: id });
  assert.equal(page.log.length, 1);
  assert.equal(page.log[0].kind_label, '登记');
  assert.equal(page.log[0].summary, '想报周末班');
  assert.equal(page.log[0].who, '小艾');
});

test('同一次登记点了两下，只存一条', async () => {
  const t = await h.team();
  const d = { name: '林同学', channel_id: t.ch, next_follow_on: T, client_id: 'abcdef0123456789' };
  const a = await h.ok(t.amy, 'customers.save', d);
  const b = await h.ok(t.amy, 'customers.save', d);
  assert.equal(a.id, b.id);
  assert.equal(h.mock.rows('jx_customers').length, 1);
  assert.equal(h.mock.rows('jx_followups').length, 1);
  // 别人拿同一个号来登记，不会被当成成功，也看不到那条记录
  await h.fail(t.bob, 'customers.save', d, 'INVALID', '重新登记');
});

test('记录跟进：更新客户、留日志、算漏斗日期', async () => {
  const t = await h.team();
  const id = await h.customer(t, t.amy, { grade: '', status: '新加微信', next_action: '', next_follow_on: T });
  await h.fail(t.amy, 'customers.follow', { id: id, grade: '', status: '新加微信', next_follow_on: T, next_action: '' }, 'INVALID', '没有任何改动');
  await h.fail(t.amy, 'customers.follow', { id: id, grade: 'B', status: '已问需求', summary: '想学 C1', next_follow_on: '' }, 'INVALID', '必须写下次跟进时间');
  await h.fail(t.amy, 'customers.follow', { id: id, summary: '聊了', next_follow_on: T, contact_on: day(1) }, 'INVALID', '沟通日期不能晚于今天');
  const res = await h.ok(t.amy, 'customers.follow', { id: id, grade: 'B', status: '已问需求', summary: '想学 C1，周末有空', next_action: '发对比清单', next_follow_on: day(2), contact_on: day(-1) });
  assert.match(res.message, /下次跟进：10月9日 周五/);
  let c = h.mock.raw('jx_customers', id);
  assert.equal(c.grade, 'B');
  assert.equal(c.status, '已问需求');
  assert.equal(c.notes, '想学 C1，周末有空');
  assert.equal(c.last_contact_on, day(-1));
  assert.equal(c.consulted_on, day(-1));
  assert.equal(c.grade_a_on, '');
  // 只调分级，不写要点：日志里记“调整”
  await h.ok(t.amy, 'customers.follow', { id: id, grade: 'A', status: '已问需求', next_action: '发对比清单', next_follow_on: day(2) });
  c = h.mock.raw('jx_customers', id);
  assert.equal(c.grade_a_on, T);
  assert.equal(c.notes, '想学 C1，周末有空', '没写要点时不覆盖上次的要点');
  const page = await h.ok(t.amy, 'customers.get', { id: id });
  assert.equal(page.log.length, 3);
  assert.equal(page.log[0].summary, '调整：分级 B → A');
  assert.match(page.log[1].summary, /（分级 未分级 → B；状态 新加微信 → 已问需求）/);
  // 改成 D 类：不再需要日期，从跟进里消失
  await h.ok(t.amy, 'customers.follow', { id: id, grade: 'D', status: '已问需求', summary: '在外地，不合适', next_follow_on: '' });
  assert.equal(h.mock.raw('jx_customers', id).active, false);
  assert.equal((await h.ok(t.amy, 'home.get', {})).fc.active, 0);
});

test('“已交定金”“已正式报名”只能通过四项核对来设', async () => {
  const t = await h.team();
  const id = await h.customer(t, t.amy);
  for (const status of ['已交定金', '已正式报名']) {
    await h.ok(t.amy, 'customers.follow', { id: id, status: status, summary: '试图直接改状态', next_follow_on: T });
    assert.equal(h.mock.raw('jx_customers', id).status, '已问需求');
  }
  await h.fail(t.amy, 'customers.save', { name: '直接登记成报名', channel_id: t.ch, status: '已正式报名' }, 'INVALID', '必须写下次跟进时间');
});

test('定金和正式报名都要先做完四项核对', async () => {
  const t = await h.team();
  const pid = await h.product(t);
  const id = await h.customer(t, t.amy, { grade: 'B' });
  const info = await h.ok(t.amy, 'customers.enroll_info', { id: id });
  assert.deepEqual(info.checks.map((c) => c.key), ['e1', 'e2', 'e3', 'e4']);
  assert.equal(info.checks[1].rows[0].value, '4,280 元');
  assert.equal(info.checks[2].rows[0].pending, true);
  assert.equal(info.product.id, pid);

  const all = ['e1', 'e2', 'e3', 'e4'];
  await h.fail(t.amy, 'customers.enroll', { id: id, checks: all, next_on: T }, 'INVALID', '收定金，还是正式报名');
  const res = await h.fail(t.amy, 'customers.enroll', { id: id, action: 'deposit', checks: ['e1', 'e4'], next_on: T }, 'INVALID', '四项核对还没做完');
  assert.match(res.errors.join(''), /包含和不包含什么是否对、退款、转校和投诉路径是否对/);
  await h.fail(t.amy, 'customers.enroll', { id: id, action: 'deposit', checks: all }, 'INVALID', '必须写下次跟进时间');
  await h.fail(t.amy, 'customers.enroll', { id: id, action: 'deposit', checks: all, next_on: T, on: day(1) }, 'INVALID', '日期不能晚于今天');
  assert.equal(h.mock.raw('jx_customers', id).status, '已问需求');

  const dep = await h.ok(t.amy, 'customers.enroll', { id: id, action: 'deposit', checks: all, next_on: day(1), next_action: '带资料来签合同' });
  assert.equal(dep.student_id, '');
  let c = h.mock.raw('jx_customers', id);
  assert.equal(c.status, '已交定金');
  assert.equal(c.grade, 'A', '肯付款的人自动算 A 类');
  assert.equal(c.active, true);
  assert.deepEqual([c.chk4_on, c.deposit_on, c.grade_a_on, c.consulted_on], [T, T, T, T]);
  assert.equal(c.next_follow_on, day(1));
  assert.equal(h.mock.rows('jx_students').length, 0);

  // 交了定金的客户：跟进时状态只能留在“已交定金”或改成“暂不跟进”
  await h.ok(t.amy, 'customers.follow', { id: id, status: '新加微信', summary: '约好周五来', next_follow_on: day(2), next_action: '签合同' });
  assert.equal(h.mock.raw('jx_customers', id).status, '已交定金');

  await h.fail(t.amy, 'customers.enroll', { id: id, action: 'enroll', checks: all, next_on: T, contract: true }, 'INVALID', '签合同、开具付款凭证');
  await h.fail(t.amy, 'customers.enroll', { id: id, action: 'enroll', checks: all, contract: true, receipt: true }, 'INVALID', '下次动作日期');
  await h.fail(t.amy, 'customers.enroll', { id: id, action: 'enroll', checks: all, contract: true, receipt: true, next_on: day(-1) }, 'INVALID', '不能早于今天');
  const done = await h.ok(t.amy, 'customers.enroll', { id: id, action: 'enroll', checks: all, contract: true, receipt: true, doclist: true, told_owner: true, next_on: T, owner_id: t.uid.bob });
  assert.equal(done.student_id, 'stu_' + id);
  c = h.mock.raw('jx_customers', id);
  assert.equal(c.status, '已正式报名');
  assert.equal(c.active, false);
  assert.equal(c.enrolled_on, T);
  assert.equal(c.next_follow_on, '');
  const s = h.mock.raw('jx_students', 'stu_' + id);
  assert.equal(s.stage, '资料准备');
  assert.equal(s.owner_id, t.uid.bob);
  assert.equal(s.sales_owner_id, t.uid.amy);
  assert.deepEqual(s.checks, ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'h1']);
  assert.equal(s.next_action, '发资料清单，确认身份证明、照片和体检');
  const page = await h.ok(t.amy, 'customers.get', { id: id });
  assert.equal(page.student_id, 'stu_' + id);
  assert.equal(page.c.locked, true);
  assert.equal(page.follow.show_grade, false);
  assert.deepEqual(page.log.map((f) => f.kind), ['enroll', 'note', 'deposit', 'create']);
  // 报名以后还能补记沟通，但状态不动
  await h.ok(t.amy, 'customers.follow', { id: id, status: '暂不跟进', grade: 'C', summary: '补记：家长来电确认' });
  c = h.mock.raw('jx_customers', id);
  assert.equal(c.status, '已正式报名');
  assert.equal(c.grade, 'A');
});

test('同一次报名提交两遍，只有一位学员、一条报名日志', async () => {
  const t = await h.team();
  await h.product(t);
  const id = await h.customer(t, t.amy);
  const d = { id: id, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: T };
  const both = await Promise.all([h.core, 0].map(() => h.ok(t.amy, 'customers.enroll', d)));
  assert.equal(both[0].student_id, both[1].student_id);
  await h.ok(t.amy, 'customers.enroll', d);
  assert.equal(h.mock.rows('jx_students').length, 1);
  assert.equal(h.mock.rows('jx_followups').filter((f) => f.kind === 'enroll').length, 1);
  assert.equal((await h.ok(t.amy, 'customers.enroll_info', { id: id })).student_id, 'stu_' + id);
});

test('学员建好了但客户状态没改成（写到一半断了）：再提交一次就补齐', async () => {
  const t = await h.team();
  await h.product(t);
  const id = await h.customer(t, t.amy);
  const d = { id: id, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: T };
  await h.ok(t.amy, 'customers.enroll', d);
  const c = h.mock.state.collections.get('jx_customers').get(id);
  Object.assign(c, { status: '已问需求', active: true, enrolled_on: '' });       // 模拟第二步没写成
  await h.ok(t.amy, 'customers.enroll', d);
  assert.equal(h.mock.raw('jx_customers', id).status, '已正式报名');
  assert.equal(h.mock.rows('jx_students').length, 1);
});

test('没有产品卡时不能报名', async () => {
  const t = await h.team();
  const id = await h.customer(t, t.amy);
  const info = await h.ok(t.amy, 'customers.enroll_info', { id: id });
  assert.equal(info.product, null);
  await h.fail(t.amy, 'customers.enroll', { id: id, action: 'deposit', checks: ['e1', 'e2', 'e3', 'e4'], next_on: T }, 'INVALID', '还没有产品卡');
});

test('编辑资料；负责人变更会记日志；删除只有管理员或负责人可以', async () => {
  const t = await h.team();
  const id = await h.customer(t, t.amy);
  await h.ok(t.bob, 'customers.save', { id: id, name: '林同学（改）', channel_id: t.ch, school: '东区大学', vehicle: 'C2', plan: '本月内', concern: '价格', owner_id: t.uid.bob });
  let c = h.mock.raw('jx_customers', id);
  assert.equal(c.name, '林同学（改）');
  assert.equal(c.owner_id, t.uid.bob);
  assert.equal(c.status, '已问需求', '编辑资料不动状态');
  assert.equal(c.next_follow_on, T);
  const page = await h.ok(t.bob, 'customers.get', { id: id });
  assert.equal(page.log[0].summary, '负责人由 小艾 改为 小博。');
  await h.fail(t.amy, 'customers.remove', { id: id }, 'FORBIDDEN');
  const other = await h.customer(t, t.amy, { referrer_id: id });
  assert.equal(h.mock.raw('jx_customers', other).referrer_id, id);
  await h.ok(t.bob, 'customers.remove', { id: id });
  assert.equal(h.mock.raw('jx_customers', id), undefined);
  assert.equal(h.mock.raw('jx_customers', other).referrer_id, '', '被删的人不再是别人的推荐人');
  assert.equal(h.mock.rows('jx_followups').filter((f) => f.customer_id === id).length, 0);
  await h.fail(t.bob, 'customers.get', { id: id }, 'NOT_FOUND');
  await h.ok(t.boss, 'customers.remove', { id: other });
});

test('已报名的学员不能删除；改客户称呼会同步到学员和异常记录', async () => {
  const t = await h.team();
  await h.product(t);
  const id = await h.customer(t, t.amy, { name: '林同学' });
  await h.ok(t.amy, 'customers.enroll', { id: id, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: T });
  await h.fail(t.boss, 'customers.remove', { id: id }, 'FORBIDDEN', '已报名的学员不能删除');
  await h.ok(t.amy, 'issues.save', { student_id: 'stu_' + id, occurred_on: T, description: '约不到车', contacted: '教练', eta_on: day(2) });
  await h.ok(t.amy, 'customers.save', { id: id, name: '林晓', channel_id: t.ch, contact: 'wx: lin', owner_id: t.uid.bob });
  const s = h.mock.raw('jx_students', 'stu_' + id);
  assert.deepEqual([s.name, s.contact, s.sales_owner_id], ['林晓', 'wx: lin', t.uid.bob]);
  assert.equal(h.mock.rows('jx_issues')[0].student_name, '林晓');
});

test('列表：筛选、搜索、排序、翻页', async () => {
  const t = await h.team();
  const mk = (name, extra) => h.customer(t, t.amy, Object.assign({ name: name }, extra));
  await mk('甲', { grade: 'A', next_follow_on: day(3) });
  await mk('乙', { grade: 'B', next_follow_on: T });
  await mk('丙', { grade: 'C', next_follow_on: day(1), school: '东区大学' });
  await mk('丁', { grade: 'D', next_follow_on: '' });
  await mk('戊', { status: '暂不跟进', next_follow_on: '' });
  const bobs = await h.customer(t, t.bob, { name: '己', next_follow_on: day(2), channel_id: t.channels[1].id });
  h.mock.state.collections.get('jx_customers').get(bobs).next_follow_on = day(-2);          // 逾期两天
  const names = async (d) => (await h.ok(t.boss, 'customers.list', d)).items.map((c) => c.name);
  assert.deepEqual(await names({}), ['己', '乙', '丙', '甲']);
  assert.deepEqual(await names({ follow: 'all' }), ['己', '乙', '丙', '甲', '戊', '丁']);
  assert.deepEqual(await names({ follow: 'today' }), ['乙']);
  assert.deepEqual(await names({ follow: 'overdue' }), ['己']);
  assert.deepEqual(await names({ follow: 'closed' }), ['戊', '丁']);
  assert.deepEqual(await names({ grade: 'A' }), ['甲']);
  assert.deepEqual(await names({ status: '暂不跟进', follow: 'all' }), ['戊']);
  assert.deepEqual(await names({ channel: t.channels[1].id }), ['己']);
  assert.deepEqual(await names({ owner: t.uid.bob }), ['己']);
  assert.deepEqual(await names({ q: '东区' }), ['丙']);
  assert.deepEqual(await names({ q: '%' }), []);
  assert.deepEqual((await h.ok(t.bob, 'customers.list', { mine: true })).items.map((c) => c.name), ['己']);
  const first = (await h.ok(t.boss, 'customers.list', {})).items[0];
  assert.equal(first.due_label, '逾期 2 天');
  assert.equal(first.due_cls, 'due-over');
  assert.equal(first.owner, '小博');
  for (let i = 0; i < 40; i++) { await mk('批量' + i, { next_follow_on: day(10) }); }
  const p1 = await h.ok(t.boss, 'customers.list', {});
  assert.deepEqual([p1.total, p1.pages, p1.items.length, p1.has_more], [44, 2, 30, true]);
  const p2 = await h.ok(t.boss, 'customers.list', { page: 2 });
  assert.deepEqual([p2.items.length, p2.has_more], [14, false]);
  assert.equal((await h.ok(t.boss, 'customers.list', { page: 99 })).page, 2);
  assert.equal((await h.ok(t.boss, 'customers.list', { page: 'abc' })).page, 1);
});

test('超过 100 位在跟进的客户也能全部统计到', async () => {
  const t = await h.team();
  for (let i = 0; i < 230; i++) { await h.customer(t, t.amy, { next_follow_on: i % 2 ? T : day(1) }); }
  const home = await h.ok(t.amy, 'home.get', {});
  assert.equal(home.fc.active, 230);
  assert.equal(home.fc.today, 115);
  assert.equal(home.due_total, 115);
  assert.equal(home.due.length, 100);
  assert.equal((await h.ok(t.amy, 'customers.list', {})).total, 230);
});

test('推荐人：只能选已报名或推荐过别人的；不能选自己', async () => {
  const t = await h.team();
  await h.product(t);
  const a = await h.customer(t, t.amy, { name: '老学员' });
  const b = await h.customer(t, t.amy, { name: '路人' });
  await h.ok(t.amy, 'customers.enroll', { id: a, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: T });
  let form = await h.ok(t.amy, 'customers.form', {});
  assert.deepEqual(form.referrers.map((r) => r.name), ['老学员']);
  const c = await h.customer(t, t.amy, { name: '新客户', referrer_id: a });
  await h.ok(t.amy, 'customers.save', { id: c, name: '新客户', channel_id: t.ch, referrer_id: c });
  assert.equal(h.mock.raw('jx_customers', c).referrer_id, '', '自己不能是自己的推荐人');
  await h.ok(t.amy, 'customers.save', { id: c, name: '新客户', channel_id: t.ch, referrer_id: b });
  form = await h.ok(t.amy, 'customers.form', { id: c });
  assert.deepEqual(form.referrers.map((r) => r.name).sort(), ['老学员', '路人（已问需求）'].sort());
  const page = await h.ok(t.amy, 'customers.get', { id: b });
  assert.deepEqual(page.referred.map((x) => x.name), ['新客户']);
  assert.equal((await h.ok(t.amy, 'customers.get', { id: c })).referrer.name, '路人');
});

test('停用的渠道和班型：已有的客户上还在，新登记时不再出现', async () => {
  const t = await h.team();
  const pid = await h.product(t);
  const id = await h.customer(t, t.amy, { product_id: pid });
  await h.ok(t.boss, 'channels.archive', { id: t.ch });
  await h.ok(t.boss, 'products.archive', { id: pid });
  const fresh = await h.ok(t.amy, 'customers.form', {});
  assert.ok(!fresh.channels.some((c) => c.id === t.ch));
  assert.equal(fresh.products.length, 0);
  const edit = await h.ok(t.amy, 'customers.form', { id: id });
  assert.ok(edit.channels.some((c) => c.id === t.ch));
  assert.equal(edit.products.length, 1);
  await h.ok(t.amy, 'customers.save', { id: id, name: '照常保存', channel_id: t.ch, product_id: pid });
  assert.equal((await h.ok(t.amy, 'customers.get', { id: id })).c.channel, '短视频');
});

test('报价话术会带上客户匹配的班型里已核实的内容', async () => {
  const t = await h.team();
  const pid = await h.product(t, { incl: '报名费、教材费、科目一至科目四首次考试费。' });
  const id = await h.customer(t, t.amy, { product_id: pid });
  const page = await h.ok(t.amy, 'customers.get', { id: id });
  assert.equal(page.product.fee_text, '4,280 元');
  assert.match(page.quote, /4,280/);
  assert.match(page.quote, /报名费、教材费、科目一至科目四首次考试费/);
  assert.match(page.quote, /【不包含】/, '没核实的项目保持占位符，不编内容');
});
