'use strict';
const { test, beforeEach } = require('node:test');
const h = require('./helper');
const assert = h.assert;
const C = require('../cloudfunctions/api/lib/consts');
const view = require('../cloudfunctions/api/lib/view');

beforeEach(h.fresh);

test('新产品卡一开始全是“没核实”；填一项少一项', async () => {
  const t = await h.team();
  const form = await h.ok(t.boss, 'products.form', {});
  assert.equal(form.sections.length, 5);
  assert.equal(form.sections.reduce((n, s) => n + s.fields.length, 0), 28);
  const refund = form.sections[3].fields[0];
  assert.deepEqual([refund.key, refund.value], ['refund', C.PENDING]);
  await h.fail(t.boss, 'products.save', { values: {} }, 'INVALID', '请填班型名称');
  await h.fail(t.boss, 'products.save', { values: { name: 'C1', verified_on: '2099-01-01' } }, 'INVALID', '核验日期不能晚于今天');
  await h.fail(t.boss, 'products.save', { values: { name: 'C1', verified_on: '上周' } }, 'INVALID', '日期格式不对');
  const id = await h.product(t);
  const list = await h.ok(t.amy, 'products.list', {});
  assert.equal(list.items.length, 1);
  const before = list.items[0].pending;
  assert.ok(before > 10);
  assert.equal(list.can_edit, false);
  const edit = await h.ok(t.boss, 'products.form', { id: id });
  const values = {};
  edit.sections.forEach((s) => s.fields.forEach((f) => { values[f.key] = f.value; }));
  values.refund = '开课前全额退；开课后按合同第 5 条扣除已发生费用。';
  values.verified_on = h.TODAY;
  const res = await h.ok(t.boss, 'products.save', { id: id, values: values });
  assert.equal(res.pending, before - 2);
  assert.match(res.message, /还有 \d+ 项没核实/);
});

test('费用去掉“元”和逗号后存成数字，显示时带千分位', async () => {
  const t = await h.team();
  const id = await h.product(t, { fee: '４２８０' });
  assert.equal(h.mock.raw('jx_products', id).fee, '４２８０', '全角数字不认，原样保留，不乱猜');
  const id2 = await h.product(t, { name: 'C2 班', fee: ' 5,680 元 ' });
  assert.equal(h.mock.raw('jx_products', id2).fee, '5680');
  const card = await h.ok(t.amy, 'products.get', { id: id2 });
  assert.equal(card.card[0].rows[0].value, '5,680 元');
  assert.equal(card.card[0].rows[0].pending, false);
  const id3 = await h.product(t, { name: '待定班', fee: '面议' });
  assert.equal((await h.ok(t.amy, 'products.get', { id: id3 })).card[0].rows[0].value, '面议');
});

test('给客户看的产品卡：没核实的写明“按当前合作协议核验”，不承诺的事写在卡上', async () => {
  const t = await h.team();
  const id = await h.product(t, { who: '周末有空的在校生', payee: '示例驾校有限公司对公账户', verified_on: h.TODAY });
  const card = await h.ok(t.amy, 'products.get', { id: id });
  assert.equal(card.card.length, 3);
  assert.match(card.text, /^【C1 周末班】C1 手动挡｜示例驾校有限公司\n适合谁：周末有空的在校生/);
  assert.match(card.text, /退款：按当前合作协议核验/);
  assert.match(card.text, /收款主体：示例驾校有限公司对公账户/);
  assert.match(card.text, /我们不承诺：包过、免考、最低价、固定拿证天数。/);
  assert.match(card.text, /不向任何个人转账/);
  assert.match(card.text, /信息核验日期：2026-10-07｜以正式合同和当前合作协议为准。$/);
  assert.equal(card.card[2].rows[0].pending, true);
  assert.equal(card.p.verified, '10月7日');
  await h.fail(t.amy, 'products.get', { id: 'nope' }, 'NOT_FOUND');
});

test('停用和恢复班型', async () => {
  const t = await h.team();
  const id = await h.product(t);
  let res = await h.ok(t.boss, 'products.archive', { id: id });
  assert.equal(res.archived, true);
  assert.equal((await h.ok(t.amy, 'products.list', {})).items.length, 0);
  const arch = await h.ok(t.amy, 'products.list', { archived: true });
  assert.deepEqual([arch.items.length, arch.archived_count], [1, 1]);
  res = await h.ok(t.boss, 'products.archive', { id: id });
  assert.equal(res.archived, false);
});

test('话术里的【占位符】换成产品卡上已核实的内容；没核实的保持原样', async () => {
  const t = await h.team();
  const id = await h.product(t, { site: '东郊训练场，距东校区约 6 公里。', payee: C.PENDING });
  const plain = await h.ok(t.amy, 'scripts.list', {});
  assert.deepEqual(plain.groups.map((g) => g.name), C.SCRIPT_GROUPS);
  assert.equal(plain.groups.reduce((n, g) => n + g.items.length, 0), 17);
  assert.equal(plain.forbidden.length, 5);
  assert.equal(plain.order.length, 6);
  const quote = plain.groups[1].items.find((s) => s.scene === '报价');
  assert.match(quote.body, /【总费用】/);
  const filled = await h.ok(t.amy, 'scripts.list', { product_id: id });
  const q2 = filled.groups[1].items.find((s) => s.scene === '报价');
  assert.match(q2.body, /4,280/);
  assert.doesNotMatch(q2.body, /【总费用】/);
  const all = filled.groups.map((g) => g.items.map((s) => s.body).join('\n')).join('\n');
  assert.match(all, /【收款主体】/, '写着“按当前合作协议核验”的项目不会被填进话术');
  assert.doesNotMatch(all, /【训练场位置】/);
  assert.match(all, /东郊训练场，距东校区约 6 公里(?!。。)/);
  assert.equal(view.fillScript('学费【总费用】，训练场在【训练场位置】', { fee: '面议；', site: '' }), '学费面议，训练场在【训练场位置】');
  assert.equal((await h.ok(t.amy, 'scripts.list', { product_id: 'x' })).product_id, '');
});

test('默认话术里没有承诺包过、最低价这些说法', async () => {
  const bodies = C.DEFAULT_SCRIPTS.map((s) => s.body).join('\n');
  assert.doesNotMatch(bodies, /保证(通过|拿证)|一定(能)?过|全(市|城)最低/);
  const say = C.FORBIDDEN.map((f) => f.say).join('');
  assert.match(say, /包过/);
  assert.match(C.RED_LINES.join(''), /不私下收款/);
  assert.match(C.RED_LINES.join(''), /不发展下线、不做层级返利/);
});

test('编辑、新增、删除话术；全团队看到的是同一份', async () => {
  const t = await h.team();
  await h.fail(t.boss, 'scripts.save', { grp: '', scene: '', body: '' }, 'INVALID', '请选分组');
  await h.ok(t.boss, 'scripts.save', { grp: '报价与异议', scene: '异议：太远了', when_use: '客户嫌训练场远', body: '训练场在【训练场位置】，我们有【接送安排】。', tips: '先问他平时在哪个校区' });
  let list = await h.ok(t.amy, 'scripts.list', {});
  const mine = list.groups[1].items[list.groups[1].items.length - 1];
  assert.equal(mine.scene, '异议：太远了');
  const got = await h.ok(t.boss, 'scripts.get', { id: mine.id });
  assert.equal(got.s.tips, '先问他平时在哪个校区');
  await h.ok(t.boss, 'scripts.save', { id: mine.id, grp: '自定义分组', scene: '异议：太远了', body: '改过的内容' });
  list = await h.ok(t.amy, 'scripts.list', {});
  assert.equal(list.groups[list.groups.length - 1].name, '自定义分组');
  await h.ok(t.boss, 'scripts.remove', { id: mine.id });
  assert.equal(h.mock.rows('jx_scripts').length, 17);
  await h.fail(t.boss, 'scripts.remove', { id: mine.id }, 'NOT_FOUND');
});

test('渠道：重名不行；停用后登记时不再出现；统计每个渠道来了多少、报名多少', async () => {
  const t = await h.team();
  await h.product(t);
  await h.fail(t.boss, 'channels.save', { name: '短视频' }, 'INVALID', '同名');
  await h.fail(t.boss, 'channels.save', { name: '' }, 'INVALID', '请填渠道名称');
  await h.fail(t.boss, 'channels.save', { name: '一'.repeat(21) }, 'INVALID', '最多 20 个字');
  await h.ok(t.boss, 'channels.save', { name: '宿舍楼海报', code: 'hb', kind: '线下', how: '贴在宿舍一楼', status: '进行中' });
  let list = await h.ok(t.amy, 'channels.list', {});
  assert.equal(list.items.length, 11);
  const added = list.items[10];
  assert.deepEqual([added.name, added.code, added.status], ['宿舍楼海报', 'HB', '进行中']);
  await h.ok(t.boss, 'channels.save', { id: added.id, name: '宿舍楼海报', code: 'HB', kind: '乱填', status: '乱填' });
  const ch = (await h.ok(t.boss, 'channels.get', { id: added.id })).ch;
  assert.deepEqual([ch.kind, ch.status], ['', '筹备中']);
  const a = await h.customer(t, t.amy, { channel_id: added.id });
  await h.customer(t, t.bob, { channel_id: added.id });
  await h.ok(t.amy, 'customers.enroll', { id: a, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: h.TODAY });
  list = await h.ok(t.boss, 'channels.list', {});
  assert.deepEqual([list.items[10].total, list.items[10].enrolled], [2, 1]);
  const res = await h.ok(t.boss, 'channels.archive', { id: added.id });
  assert.match(res.message, /已登记的客户不受影响/);
  assert.equal((await h.ok(t.amy, 'channels.list', {})).items.length, 10);
  assert.equal((await h.ok(t.amy, 'channels.list', { archived: true })).items.length, 1);
  await h.fail(t.amy, 'customers.save', { name: '用已停用渠道', channel_id: added.id, next_follow_on: h.TODAY }, 'INVALID');
});
