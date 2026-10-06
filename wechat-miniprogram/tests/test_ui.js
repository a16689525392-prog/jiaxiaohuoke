// 小程序端 + 云函数一起跑：像用户那样按界面上的文字去点、去输入，然后检查界面和数据库。
'use strict';
const { test, beforeEach } = require('node:test');
const h = require('./helper');
const assert = h.assert;
const { Runtime } = require('./mp/runtime');
const T = h.TODAY;
const day = (n) => h.core.addDays(T, n);

beforeEach(h.fresh);

function clean(rt) { assert.deepEqual(rt.problems, [], '页面上有可疑的地方'); }
function route(rt) { return rt.top().route; }
function has(rt, text) { assert.ok(rt.text().indexOf(text) >= 0, '页面上应该有“' + text + '”，实际：' + rt.text().slice(0, 400)); }
function hasNot(rt, text) { assert.ok(rt.text().indexOf(text) < 0, '页面上不应该有“' + text + '”'); }

test('第一次打开：创建团队，进到“今日”，管理员看到还差哪几件事', async () => {
  const rt = new Runtime('o-boss');
  await rt.open('/pages/home/index');
  assert.equal(route(rt), 'pages/welcome/index', '没加入团队的人被带到欢迎页');
  has(rt, '加入团队');
  await rt.tap('创建团队');
  await rt.tap('创建团队', 1);                       // 什么都没填就提交
  has(rt, '请填团队名称');
  has(rt, '创建口令不对');
  await rt.type('team_name', '东校区招生组');
  await rt.type('my_name', '老板');
  await rt.type('code', 'wrong');
  await rt.tap('创建团队', 1);
  has(rt, '创建口令不对');
  hasNot(rt, '请填团队名称');
  assert.equal(rt.shown('team_name'), '东校区招生组', '报错以后填过的内容还在');
  await rt.type('code', h.config.TEAM_CREATE_CODE);
  await rt.tap('创建团队', 1);
  assert.equal(route(rt), 'pages/home/index');
  has(rt, '东校区招生组 · 老板');
  has(rt, '开始之前还差这几件事');
  has(rt, '今天没有到期的跟进');
  await rt.tap('去填产品卡');
  assert.equal(route(rt), 'pages/product-edit/index');
  clean(rt);
});

test('凭邀请码加入：等待审核 → 管理员通过 → 进入；换页签时填过的称呼不丢', async () => {
  const t = await h.team();
  const rt = new Runtime('o-new');
  await rt.open('/pages/welcome/index');
  await rt.type('my_name', '小新');
  await rt.tap('创建团队');
  assert.equal(rt.shown('my_name'), '小新');
  await rt.tap('加入团队');
  assert.equal(rt.shown('my_name'), '小新');
  await rt.type('invite', 'BADCODE1');
  await rt.tap('申请加入');
  has(rt, '邀请码不对');
  await rt.type('invite', t.code.toLowerCase());
  await rt.tap('申请加入');
  has(rt, '等待管理员通过');
  has(rt, '称呼是“小新”');
  await rt.tap('刷新看看');
  has(rt, '等待管理员通过');

  const admin = new Runtime(t.boss);
  await admin.open('/pages/me/index');
  has(admin, '1 人等待通过');
  await admin.tap('成员');
  has(admin, '等待你通过（1）');
  await admin.tap('通过');
  hasNot(admin, '等待你通过');
  has(admin, '成员（4）');
  clean(admin);

  const rt2 = new Runtime('o-new');
  await rt2.open('/pages/welcome/index');
  assert.equal(route(rt2), 'pages/home/index');
  has(rt2, '小新');
  hasNot(rt2, '开始之前还差这几件事');
  clean(rt2);
  clean(rt);
});

test('撤回申请要先确认；取消就什么都不变', async () => {
  const t = await h.team();
  const rt = new Runtime('o-new');
  await rt.open('/pages/welcome/index');
  await rt.type('invite', t.code);
  await rt.type('my_name', '小新');
  await rt.tap('申请加入');
  rt.answers.push(false);
  await rt.tap('撤回申请');
  has(rt, '等待管理员通过');
  rt.answers.push(true);
  await rt.tap('撤回申请');
  has(rt, '申请加入');
  assert.equal(h.mock.rows('jx_members').length, 3);
  clean(rt);
});

test('管理员填产品卡 → 看卡 → 复制文字版；成员能看不能改', async () => {
  const t = await h.team();
  const rt = new Runtime(t.boss);
  await rt.open('/pages/library/index');
  has(rt, '还没有产品卡。先填第 1 个班型');
  await rt.tap('＋ 新增班型');
  await rt.tap('保存');
  has(rt, '请填班型名称');
  await rt.type('name', 'C1 周末班');
  await rt.tap('C1 手动挡');
  await rt.type('fee', '4,280 元');
  await rt.type('incl', '报名费、教材费、科目一至科目四首次考试费');
  await rt.pick('verified_on', T);
  await rt.tap('保存');
  assert.equal(route(rt), 'pages/product/index');
  has(rt, 'C1 周末班');
  has(rt, '4,280 元');
  has(rt, '项没核实');
  has(rt, '包过、免考、最低价、固定拿证天数');
  await rt.tap('复制文字版发给客户');
  assert.match(rt.clipboard, /^【C1 周末班】C1 手动挡/);
  assert.match(rt.clipboard, /已包含：报名费、教材费、科目一至科目四首次考试费/);
  assert.equal(rt.toasts.pop(), '已复制，去微信里粘贴');
  rt.clipboardFails = true;
  await rt.tap('复制文字版发给客户');
  assert.match(rt.modals.pop().content, /用户隐私保护指引/);
  await rt.tap('编辑');
  assert.equal(rt.shown('fee'), '4280');
  await rt.type('refund', '开课前全额退');
  await rt.tap('保存');
  assert.equal(route(rt), 'pages/product/index');
  has(rt, '开课前全额退');
  rt.answers.push(true);
  await rt.tap('停用这个班型');
  has(rt, '这个班型已停用');
  await rt.tap('恢复这个班型');
  hasNot(rt, '这个班型已停用');
  clean(rt);

  const amy = new Runtime(t.amy);
  await amy.open('/pages/library/index');
  hasNot(amy, '新增班型');
  await amy.tap('C1 周末班');
  hasNot(amy, '编辑');
  hasNot(amy, '停用这个班型');
  clean(amy);
});

test('登记客户 → 记录跟进 → 定金 → 正式报名 → 交付 → 异常，全程只用界面操作', async () => {
  const t = await h.team();
  await h.product(t);
  const rt = new Runtime(t.amy);
  await rt.open('/pages/home/index');
  await rt.tap('＋ 登记客户');
  assert.equal(route(rt), 'pages/customer-edit/index');
  await rt.tap('保存');
  has(rt, '请填称呼');
  has(rt, '请选来源渠道');
  has(rt, '必须写下次跟进时间');
  await rt.type('name', '林同学');
  await rt.type('contact', '微信 lin_2026');
  await rt.pick('channel_id', '摆点');
  await rt.tap('C1');
  await rt.tap('本周内');
  await rt.tap('价格');
  await rt.pick('product_id', 'C1 周末班');
  await rt.tap('B');
  await rt.tap('已问需求');
  await rt.type('notes', '比较了两家，担心后面加价');
  await rt.type('next_action', '发产品卡');
  await rt.tap('明天');
  assert.equal(rt.shown('name'), '林同学', '点选项以后，打过的字还在');
  await rt.tap('保存');
  assert.equal(route(rt), 'pages/customer/index');
  has(rt, '林同学');
  has(rt, 'B 类');
  has(rt, '摆点 · 负责人 小艾');
  has(rt, '下次跟进：明天 · 发产品卡');
  has(rt, '跟进记录（1）');
  has(rt, '4,280');
  const c = h.mock.rows('jx_customers')[0];
  assert.deepEqual([c.vehicle, c.plan, c.concern, c.grade, c.status, c.next_follow_on], ['C1', '本周内', '价格', 'B', '已问需求', day(1)]);

  // 记录跟进
  await rt.tap('保存这次跟进');
  has(rt, '没有任何改动');
  await rt.type('summary', '问了补考费，已按产品卡回答');
  await rt.tap('A');
  await rt.tap('已匹配报价');
  await rt.tap('3 天后');
  await rt.tap('保存这次跟进');
  has(rt, 'A 类');
  has(rt, '跟进记录（2）');
  has(rt, '分级 B → A；状态 已问需求 → 已匹配报价');
  assert.equal(rt.shown('summary'), '', '保存后输入框清空');
  assert.match(rt.toasts.pop(), /下次跟进：10月10日/);
  await rt.tap('复制话术');
  assert.match(rt.clipboard, /4,280/);

  // 定金
  await rt.tap('四项核对与报名');
  assert.equal(route(rt), 'pages/enroll/index');
  has(rt, '1. 车型和班型是否对');
  await rt.tap('记录定金');
  has(rt, '付款前四项核对还没做完');
  for (let i = 0; i < 4; i++) { await rt.tap('已和客户当面（或文字）核对过这一项', i); }
  await rt.tap('记录定金');
  hasNot(rt, '四项核对还没做完');
  has(rt, '必须写下次跟进时间');
  await rt.pick('next_on', day(2));
  await rt.type('next_action', '带资料来签合同');
  await rt.tap('记录定金');
  assert.equal(route(rt), 'pages/customer/index');
  has(rt, '已交定金');
  has(rt, '办理正式报名');
  has(rt, '跟进记录（3）');

  // 正式报名
  await rt.tap('办理正式报名');
  has(rt, '确认正式报名');                           // 交过定金的，默认就是办正式报名
  for (let i = 0; i < 4; i++) { await rt.tap('已和客户当面（或文字）核对过这一项', i); }
  await rt.tap('确认正式报名');
  has(rt, '正式报名要先签合同、开具付款凭证');
  await rt.tap('已签正式合同');
  await rt.tap('钱付到了合同上的收款主体');
  await rt.tap('合同和资料清单已发给学员');
  await rt.pick('owner_id', '小博');
  await rt.pick('next_on', T);
  await rt.tap('确认正式报名');
  assert.equal(route(rt), 'pages/student/index');
  has(rt, '资料准备');
  has(rt, '销售 小艾');
  const s = h.mock.rows('jx_students')[0];
  assert.equal(s.owner_id, t.uid.bob);
  assert.deepEqual(s.checks, ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  assert.deepEqual(rt.stack.map((p) => p.route), ['pages/home/index', 'pages/customer/index', 'pages/student/index'], '报名页用完就关掉，返回时不会再回到它');

  // 交付：打勾、资料齐全、科目一通过、科目二约不到车
  has(rt, '报名后交接');
  await rt.tap('指定交付负责人，告诉学员之后有事找谁');
  await rt.tap('资料齐全');
  await rt.tap('科目一');
  await rt.tap('通过');
  await rt.tap('科目二');
  await rt.tap('约不到车');
  await rt.pick('k2_exam_on', day(5));
  await rt.type('next_action', '跟进约车');
  await rt.tap('明天');
  await rt.tap('保存');
  const modal = rt.modals.pop();
  assert.match(modal.content, /阶段：资料准备 → 科目二/);
  assert.match(modal.content, /约不到车要记进异常台账/);
  has(rt, '科目二');
  has(rt, '5 天后考科目二');
  const s2 = h.mock.rows('jx_students')[0];
  assert.deepEqual([s2.stage, s2.docs_status, s2.k1_result, s2.k2_booking, s2.k2_exam_on, s2.next_action, s2.next_action_on], ['科目二', '齐全', '通过', '约不到', day(5), '跟进约车', day(1)]);
  assert.ok(s2.checks.indexOf('h1') >= 0);
  assert.equal(s2.owner_id, t.uid.bob, '保存学员页不会改掉交付负责人');

  // 异常
  await rt.tap('＋ 记一条异常');
  assert.equal(route(rt), 'pages/issue-edit/index');
  has(rt, '林同学 · 科目二');
  await rt.tap('保存');
  has(rt, '请写问题描述');
  has(rt, '请写联系了谁');
  await rt.tap('约不到车');
  await rt.tap('科目二');
  await rt.type('description', '连续两周约不到周末的车');
  await rt.type('contacted', '训练场排班老师');
  await rt.pick('eta_on', day(2));
  await rt.tap('保存');
  assert.equal(route(rt), 'pages/student/index');
  has(rt, '连续两周约不到周末的车');
  has(rt, '处理中');
  assert.equal(rt.shown('next_action'), '跟进约车');
  await rt.tap('连续两周约不到周末的车');
  await rt.pick('solved_on', T);
  await rt.tap('保存');
  assert.match(rt.modals.pop().content, /还要回访一次/);
  assert.equal(route(rt), 'pages/student/index');
  has(rt, '已解决待回访');
  await rt.tap('连续两周约不到周末的车');
  await rt.tap('已回访确认');
  await rt.tap('保存');
  has(rt, '已关闭');
  assert.equal(h.mock.rows('jx_issues').length, 1);
  assert.equal(h.mock.rows('jx_issues')[0].status, '已关闭');

  // 回到今日：数字对得上
  await rt.open('/pages/home/index');
  has(rt, '交付提醒');
  has(rt, '异常台账 0 条');
  const home = rt.top().data;
  assert.deepEqual([home.fc.active, home.dc.active, home.dc.booking], [0, 1, 1]);
  clean(rt);
});

test('保存并再登记一位：得到一张空白的新表', async () => {
  const t = await h.team();
  const rt = new Runtime(t.amy);
  await rt.open('/pages/customer-edit/index');
  await rt.type('name', '第一位');
  await rt.pick('channel_id', '朋友圈');
  await rt.tap('今天');
  await rt.tap('保存并再登记一位');
  assert.equal(route(rt), 'pages/customer-edit/index');
  assert.equal(rt.shown('name'), '');
  assert.equal(rt.top().data.f.next_follow_on, '');
  await rt.type('name', '第二位');
  await rt.pick('channel_id', '朋友圈');
  await rt.tap('今天');
  await rt.tap('保存');
  assert.deepEqual(h.mock.rows('jx_customers').map((c) => c.name), ['第一位', '第二位']);
  clean(rt);
});

test('连点两下保存，只登记一位', async () => {
  const t = await h.team();
  const rt = new Runtime(t.amy);
  await rt.open('/pages/customer-edit/index');
  await rt.type('name', '手快的');
  await rt.pick('channel_id', '朋友圈');
  await rt.tap('今天');
  const page = rt.top();
  page.save();
  page.save();
  await rt.settle();
  assert.equal(h.mock.rows('jx_customers').length, 1);
  assert.equal(rt.calls.filter((a) => a === 'customers.save').length, 1);
});

test('编辑资料后返回，客户页显示新的内容；删除要先确认', async () => {
  const t = await h.team();
  const id = await h.customer(t, t.amy, { name: '旧名字' });
  const rt = new Runtime(t.amy);
  await rt.open('/pages/customer/index?id=' + id);
  await rt.type('summary', '写到一半');
  await rt.tap('编辑资料');
  assert.equal(rt.shown('name'), '旧名字');
  hasNot(rt, '分级和下一步');
  await rt.type('name', '新名字');
  await rt.type('school', '东区大学');
  await rt.pick('owner_id', '小博');
  await rt.tap('保存');
  assert.equal(route(rt), 'pages/customer/index');
  has(rt, '新名字');
  has(rt, '负责人 小博');
  has(rt, '东区大学');
  has(rt, '负责人由 小艾 改为 小博');
  assert.equal(rt.shown('summary'), '写到一半', '去编辑资料再回来，写了一半的跟进还在');
  hasNot(rt, '删除这位客户');                         // 负责人改成别人以后，自己不能删了
  const boss = new Runtime(t.boss);
  await boss.open('/pages/customers/index');
  await boss.tap('新名字');
  boss.answers.push(false);
  await boss.tap('删除这位客户');
  assert.equal(h.mock.rows('jx_customers').length, 1);
  boss.answers.push(true);
  await boss.tap('删除这位客户');
  assert.equal(h.mock.rows('jx_customers').length, 0);
  assert.equal(route(boss), 'pages/customers/index');
  has(boss, '没有符合条件的客户');
  clean(rt);
  clean(boss);
});

test('客户列表：筛选、搜索、只看我的、加载更多', async () => {
  const t = await h.team();
  await h.customer(t, t.amy, { name: '甲', grade: 'A', next_follow_on: T });
  await h.customer(t, t.bob, { name: '乙', grade: 'B', next_follow_on: day(2), channel_id: t.channels[1].id, school: '西区学院' });
  await h.customer(t, t.bob, { name: '丙', grade: 'C', status: '暂不跟进', next_follow_on: '' });
  const rt = new Runtime(t.amy);
  await rt.open('/pages/customers/index');
  const names = () => rt.top().data.items.map((c) => c.name);
  assert.deepEqual(names(), ['甲', '乙']);
  await rt.tap('今天要跟');
  assert.deepEqual(names(), ['甲']);
  await rt.tap('全部');
  assert.deepEqual(names(), ['甲', '乙', '丙']);
  await rt.pick(rt.pickerBy('setFilter'), 'B 类');
  assert.deepEqual(names(), ['乙']);
  has(rt, 'B 类');
  await rt.pick(rt.pickerBy('setFilter'), '全部分级');
  await rt.pick(rt.field('channel'), '朋友圈');
  assert.deepEqual(names(), ['乙']);
  await rt.pick(rt.field('channel'), '全部渠道');
  await rt.pick(rt.field('owner'), '小博');
  assert.deepEqual(names(), ['乙', '丙']);
  await rt.pick(rt.field('owner'), '全部负责人');
  await rt.tap('只看我的');
  assert.deepEqual(names(), ['甲']);
  assert.throws(() => rt.field('owner'), /没有/, '只看我的时候，不再显示负责人筛选');
  await rt.tap('全团队');
  const search = rt.pickerBy.call({ tree: () => rt.tree() }, 'setFilter');     // 只是确认页面还在
  assert.ok(search);
  rt.top().onQuery({ detail: { value: '西区' } });
  await rt.tap('搜索');
  assert.deepEqual(names(), ['乙']);
  rt.top().onQuery({ detail: { value: '' } });
  await rt.tap('搜索');
  for (let i = 0; i < 35; i++) { await h.customer(t, t.amy, { name: '批量' + i, next_follow_on: day(20) }); }
  await rt.tap('跟进中');
  assert.equal(names().length, 30);
  has(rt, '共 37 位');
  await rt.tap('加载更多');
  assert.equal(names().length, 37);
  hasNot(rt, '加载更多');
  assert.equal(new Set(rt.top().data.items.map((c) => c.id)).size, 37);
  clean(rt);
});

test('学员列表筛选、日历点某一天、异常台账切换', async () => {
  const t = await h.team();
  await h.product(t);
  const a = await h.customer(t, t.amy, { name: '学员甲' });
  const b = await h.customer(t, t.bob, { name: '学员乙' });
  for (const [who, id] of [[t.amy, a], [t.bob, b]]) {
    await h.ok(who, 'customers.enroll', { id: id, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, next_on: who === t.amy ? T : day(3) });
  }
  await h.customer(t, t.amy, { name: '客户丙', next_follow_on: day(3) });
  await h.ok(t.amy, 'issues.save', { occurred_on: T, description: '训练场检修', contacted: '教务', eta_on: day(1), solved_on: T, revisit_ok: true });
  const rt = new Runtime(t.boss);
  await rt.open('/pages/students/index');
  const names = () => rt.top().data.items.map((s) => s.name);
  assert.deepEqual(names(), ['学员甲', '学员乙']);
  await rt.tap('待办到期');
  assert.deepEqual(names(), ['学员甲']);
  await rt.tap('7 天内考试');
  has(rt, '没有符合条件的学员');
  await rt.tap('全部');
  await rt.pick(rt.field('stage'), '科目一');
  assert.deepEqual(names(), []);
  await rt.pick(rt.field('stage'), '全部学员');
  await rt.pick(rt.field('owner'), '小博');
  assert.deepEqual(names(), ['学员乙']);
  await rt.tap('异常台账 ›');
  assert.equal(route(rt), 'pages/issues/index');
  has(rt, '没有未关闭的异常');
  await rt.tap('全部');
  has(rt, '训练场检修');
  has(rt, '不关联学员');
  has(rt, '已回访');

  await rt.open('/pages/me/index');
  await rt.tap('跟进日历');
  assert.equal(route(rt), 'pages/calendar/index');
  has(rt, '10月7日 周三（今天） 要跟进的客户（0）');
  await rt.tap('10');
  has(rt, '10月10日 周六 要跟进的客户（1）');
  has(rt, '客户丙');
  has(rt, '学员乙');
  has(rt, '这一天：待办');
  await rt.tap('后 4 周 ›');
  assert.equal(rt.top().data.weeks[0].days[0].day, '2026-11-02');
  has(rt, '回到本周');
  await rt.tap('回到本周');
  assert.equal(rt.top().data.weeks[0].days[0].day, '2026-10-05');
  assert.equal(rt.top().data.picked, T);
  await rt.tap('10');
  await rt.tap('客户丙');
  assert.equal(route(rt), 'pages/customer/index');
  clean(rt);
});

test('每日数据：只提交改过的那几天；看板反映出来', async () => {
  const t = await h.team();
  await h.customer(t, t.amy);
  const rt = new Runtime(t.amy);
  await rt.open('/pages/data/index');
  has(rt, '今天的曝光数还没填');
  await rt.tap('去填 ›');
  has(rt, '10月7日 周三');
  await rt.tap('保存这 14 天');
  assert.equal(rt.toasts.pop(), '没有改动。');
  await rt.type('exposure_' + T, '300');
  await rt.type('wechat_' + T, '6');
  await rt.type('summary_' + day(-1), '发了 2 条短视频');
  await rt.tap('保存这 14 天');
  assert.equal(rt.toasts.pop(), '每日数据已保存。');
  assert.equal(rt.shown('exposure_' + T), '300');
  const rows = h.mock.rows('jx_daily');
  assert.deepEqual(rows.map((r) => [r.day, r.exposure, r.wechat_adds, r.summary]).sort(), [[day(-1), null, null, '发了 2 条短视频'], [T, 300, 6, '']]);
  await rt.type('exposure_' + T, '三百');
  await rt.tap('保存这 14 天');
  assert.match(rt.modals.pop().content, /1 个数字没看懂/);
  assert.equal(rt.shown('exposure_' + T), '300', '没看懂的不改，重新显示原来的数');
  await rt.tap('‹ 更早');
  has(rt, '9月23日');
  await rt.tap('更晚 ›');
  has(rt, '10月7日 周三');
  await rt.tap('看板');
  hasNot(rt, '今天的曝光数还没填');
  const row = rt.top().data.rows;
  assert.deepEqual([row[0].this_week, row[1].this_week, row[1].r_this], [300, 1, '0.3%']);
  await rt.tap('新增微信');
  assert.match(rt.modals.pop().content, /曝光很多，但加微信很少/);
  clean(rt);
});

test('话术：选班型后自动填空、复制；管理员新增和删除', async () => {
  const t = await h.team();
  await h.product(t);
  const rt = new Runtime(t.boss);
  await rt.open('/pages/scripts/index');
  has(rt, '破冰 → 问需求 → 匹配产品');
  has(rt, '【总费用】');
  has(rt, '不能说的话');
  await rt.pick(rt.pickerBy('setProduct'), 'C1 周末班');
  hasNot(rt, '【总费用】');
  has(rt, '4,280');
  await rt.tap('复制', 3);
  assert.match(rt.clipboard, /4,280/);
  await rt.tap('＋ 新增话术');
  await rt.tap('保存');
  has(rt, '请写场景名称');
  await rt.tap('报名与交付');
  await rt.type('scene', '学员问能不能换教练');
  await rt.type('body', '可以，先说说哪里不合适，我来协调。');
  await rt.tap('保存');
  assert.equal(route(rt), 'pages/scripts/index');
  has(rt, '学员问能不能换教练');
  assert.equal(rt.top().data.product_id, h.mock.rows('jx_products')[0]._id, '回到列表时还是刚才选的班型');
  const made = h.mock.rows('jx_scripts').find((s) => s.scene === '学员问能不能换教练');
  assert.equal(made.grp, '报名与交付');
  await rt.open('/pages/script-edit/index?id=' + made._id);
  rt.answers.push(true);
  await rt.tap('删除这条话术');
  assert.equal(route(rt), 'pages/scripts/index');
  hasNot(rt, '学员问能不能换教练');
  clean(rt);
  const amy = new Runtime(t.amy);
  await amy.open('/pages/scripts/index');
  hasNot(amy, '新增话术');
  hasNot(amy, '编辑');
  clean(amy);
});

test('渠道、团队设置、转介绍规则、开始与红线', async () => {
  const t = await h.team();
  const rt = new Runtime(t.boss);
  await rt.open('/pages/channels/index');
  has(rt, '还没填。每个渠道都用同一个企业微信');
  await rt.tap('去设置 ›');
  assert.equal(route(rt), 'pages/settings/index');
  await rt.type('unified_entry', '企业微信“东校区学车咨询”');
  await rt.type('reward_desc', '每成功推荐 1 位奖励 100 元');
  await rt.tap('成员只能看到自己负责的客户和学员');
  await rt.pick('start_date', '2026-10-01');
  await rt.tap('保存');
  assert.equal(route(rt), 'pages/channels/index');
  has(rt, '企业微信“东校区学车咨询”');
  const team = h.mock.rows('jx_teams')[0];
  assert.deepEqual([team.members_only_own, team.start_date, team.reward_desc], [true, '2026-10-01', '每成功推荐 1 位奖励 100 元']);
  await rt.tap('＋ 新增渠道');
  await rt.type('name', '宿舍楼海报');
  await rt.type('code', 'hb');
  await rt.tap('线下');
  await rt.tap('进行中');
  await rt.tap('保存');
  has(rt, '宿舍楼海报');
  has(rt, 'HB');
  await rt.tap('宿舍楼海报');
  assert.equal(route(rt), 'pages/channel-edit/index');
  await rt.tap('停用这个渠道');
  assert.equal(route(rt), 'pages/channels/index');
  hasNot(rt, '宿舍楼海报');
  await rt.tap('已停用的（1）');
  has(rt, '宿舍楼海报');
  await rt.tap('回到在用的渠道');
  await rt.open('/pages/referrals/index');
  has(rt, '每成功推荐 1 位奖励 100 元');
  has(rt, '还没写。例：');
  has(rt, '还没有转介绍来的客户');
  await rt.open('/pages/guide/index');
  has(rt, '不承诺包过、免考、最低价、固定拿证天数');
  has(rt, '从 10月1日 算起');
  has(rt, '下一次 10月11日 周日');
  clean(rt);
  // 成员：看不到“全团队 / 只看我的”，渠道也点不进去
  const amy = new Runtime(t.amy);
  await amy.open('/pages/home/index');
  hasNot(amy, '只看我的');
  await amy.open('/pages/channels/index');
  await amy.tap('短视频');
  assert.equal(route(amy), 'pages/channels/index');
  hasNot(amy, '去设置');
  await amy.open('/pages/me/index');
  has(amy, '你看到的是自己负责的客户和学员');
  hasNot(amy, '邀请码');
  clean(amy);
});

test('成员管理：设管理员、改称呼、停用后对方马上回到欢迎页', async () => {
  const t = await h.team();
  const rt = new Runtime(t.boss);
  await rt.open('/pages/team/index');
  has(rt, t.code);
  await rt.tap('复制邀请码');
  assert.equal(rt.clipboard, t.code);
  rt.answers.push('改称呼', { content: '艾米' });
  await rt.tap('小艾');
  has(rt, '艾米');
  rt.answers.push('设为管理员', true);
  await rt.tap('小博');
  assert.equal(h.mock.rows('jx_members').find((m) => m.name === '小博').role, 'admin');
  rt.answers.push('改为普通成员');
  await rt.tap('小博');
  rt.answers.push('改为普通成员');
  await rt.tap('老板');
  has(rt, '团队里至少要有一位在用的管理员');

  const amy = new Runtime(t.amy);
  await amy.open('/pages/home/index');
  assert.equal(route(amy), 'pages/home/index');
  rt.answers.push('停用', true);
  await rt.tap('艾米');
  has(rt, '已停用');
  await amy.open('/pages/customers/index');
  assert.equal(route(amy), 'pages/welcome/index', '被停用的人下一次操作就被带回欢迎页');
  has(amy, '账号已停用');
  rt.answers.push(true);
  await rt.tap('换一个邀请码');
  assert.notEqual(rt.top().data.invite_code, t.code);
  clean(rt);
  clean(amy);
});

test('我的：改称呼、退出团队', async () => {
  const t = await h.team();
  const rt = new Runtime(t.bob);
  await rt.open('/pages/me/index');
  has(rt, '小博');
  hasNot(rt, '管理');
  rt.answers.push({ content: '博哥' });
  await rt.tap('改称呼');
  has(rt, '博哥');
  rt.answers.push({ content: '' });
  await rt.tap('改称呼');
  assert.match(rt.toasts.pop(), /请填你的称呼/);
  rt.answers.push(true);
  await rt.tap('退出团队');
  assert.equal(route(rt), 'pages/welcome/index');
  has(rt, '申请加入');
  const boss = new Runtime(t.boss);
  await boss.open('/pages/me/index');
  boss.answers.push(true);
  await boss.tap('退出团队');
  assert.match(boss.modals.pop().content, /唯一的管理员/);
  assert.equal(route(boss), 'pages/me/index');
  clean(rt);
  clean(boss);
});

test('解散团队：名称输错不解散；输对了全部清空，回到欢迎页', async () => {
  const t = await h.team();
  await h.customer(t, t.amy);
  const rt = new Runtime(t.boss);
  await rt.open('/pages/settings/index');
  rt.answers.push({ content: '不对的名字' });
  await rt.tap('解散团队…');
  has(rt, '团队名称没有对上');
  assert.equal(h.mock.rows('jx_customers').length, 1);
  rt.answers.push({ confirm: false, cancel: true });
  await rt.tap('解散团队…');
  assert.equal(h.mock.rows('jx_teams').length, 1);
  rt.answers.push({ content: '东区招生组' });
  await rt.tap('解散团队…');
  assert.equal(route(rt), 'pages/welcome/index');
  has(rt, '申请加入');
  assert.equal(h.mock.rows('jx_teams').length, 0);
  assert.equal(h.mock.rows('jx_customers').length, 0);
  assert.equal(h.mock.rows('jx_members').length, 0);
  clean(rt);
  const amy = new Runtime(t.amy);
  await amy.open('/pages/home/index');
  assert.equal(route(amy), 'pages/welcome/index');
  clean(amy);
});

test('自检页：一步一步跑完，全部通过', async () => {
  const t = await h.team();
  const rt = new Runtime(t.boss);
  await rt.open('/pages/me/index');
  await rt.tap('自检');
  await rt.tap('开始自检');
  has(rt, '全部通过，共 9 步');
  has(rt, '9. 清理临时数据');
  hasNot(rt, '✗');
  assert.equal(rt.top().data.running, false);
  assert.equal(h.mock.rows('jx_teams').length, 1);
  clean(rt);
});

test('网络断了：页面显示原因和“重试”，恢复后点重试就好；提交失败不丢已填的内容', async () => {
  const t = await h.team();
  const rt = new Runtime(t.amy);
  rt.offline = true;
  await rt.open('/pages/home/index');
  has(rt, '云函数超时了');
  has(rt, '重试');
  rt.offline = false;
  await rt.tap('重试');
  has(rt, '销售跟进');
  await rt.open('/pages/customer-edit/index');
  await rt.type('name', '断网时填的');
  await rt.pick('channel_id', '朋友圈');
  await rt.tap('今天');
  rt.offline = true;
  await rt.tap('保存');
  has(rt, '云函数超时了');
  assert.equal(rt.shown('name'), '断网时填的');
  rt.offline = false;
  await rt.tap('保存');
  assert.equal(route(rt), 'pages/customer/index');
  assert.equal(h.mock.rows('jx_customers').length, 1);
  clean(rt);
});

test('每个页面在“有数据”和“空的”两种情况下都能正常显示（管理员和成员各看一遍）', async () => {
  const demo = require('./mp/demo');
  const { APP_JSON } = require('./mp/runtime');
  for (const mode of ['empty', 'full']) {
    let t;
    let q = {};
    if (mode === 'full') {
      const d = await demo.seed();
      t = d.t;
      q = {
        'pages/customer/index': '?id=' + d.ids.lin, 'pages/customer-edit/index': '?id=' + d.ids.lin, 'pages/enroll/index': '?id=' + d.ids.lin,
        'pages/student/index': '?id=' + d.stu('s1'), 'pages/issue-edit/index': '?id=' + d.issue, 'pages/product/index': '?id=' + d.pid,
        'pages/product-edit/index': '?id=' + d.pid, 'pages/script-edit/index': '?id=' + d.script, 'pages/channel-edit/index': '?id=' + t.ch,
      };
    } else {
      h.fresh();
      t = await h.team();
    }
    for (const who of [t.boss, t.amy]) {
      for (const page of APP_JSON.pages) {
        const adminOnly = ['pages/team/index', 'pages/settings/index', 'pages/product-edit/index', 'pages/script-edit/index', 'pages/channel-edit/index', 'pages/selftest/index'].indexOf(page) >= 0;
        const needsId = ['pages/customer/index', 'pages/enroll/index', 'pages/student/index', 'pages/product/index'].indexOf(page) >= 0;
        const rt = new Runtime(who);
        await rt.open('/' + page + (q[page] || ''));
        const data = rt.top().data;
        const label = mode + ' ' + (who === t.boss ? '管理员' : '成员') + ' ' + page;
        assert.deepEqual(rt.problems, [], label);
        if (page === 'pages/welcome/index') { assert.equal(route(rt), 'pages/home/index', label); continue; }
        assert.equal(data.loading, page === 'pages/selftest/index' ? undefined : false, label);
        if ((adminOnly && who !== t.boss && page !== 'pages/selftest/index') || (needsId && !q[page])) {
          assert.ok(data.error, label + ' 应该显示出错原因');
        } else {
          assert.equal(data.error || '', '', label);
          assert.ok(rt.text().length > 20, label);
        }
      }
    }
  }
});
