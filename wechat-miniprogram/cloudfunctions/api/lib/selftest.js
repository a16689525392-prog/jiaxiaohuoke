// 自检：在真实的云环境里把关键流程跑一遍（管理员在“我的 → 自检”里点一下）。
// 本地测试用的是假数据库；这里验证的是真数据库的行为和它是否一致。
// 自检只读写带“自检”标记的临时团队，不碰你的业务数据，结束时全部删掉。
'use strict';

const C = require('./consts');
const config = require('../config');
const core = require('./core');
const store = require('./store');
const team = require('../handlers/team');

// 每一步是一次单独的云函数调用，都控制在一两秒内，这样云函数用默认的超时时间也跑得完
const STEPS = ['数据库基础行为', '一次读取超过 100 条', '登记和跟进', '定金和正式报名', '学员交付', '异常台账', '今日、日历和数据', '团队之间互相看不到', '清理临时数据'];

function Report() { this.lines = []; this.ok = true; }
Report.prototype.check = function (cond, text, detail) {
  if (!cond) { this.ok = false; }
  this.lines.push({ ok: !!cond, text: text + (cond || !detail ? '' : '（' + detail + '）') });
  return !!cond;
};
Report.prototype.note = function (text) { this.lines.push({ ok: true, note: true, text: text }); };

function errText(e) { return String((e && (e.errMsg || e.message)) || e).slice(0, 160); }

async function expectFail(report, promise, code, text) {
  try {
    await promise;
    report.check(false, text, '应该被拒绝，却成功了');
  } catch (e) {
    report.check(e instanceof core.AppError && e.code === code, text, '错误码 ' + (e && e.code) + '：' + errText(e));
  }
}

function ids(run) {
  return {
    t1: 'st' + run + 'a', t2: 'st' + run + 'b',
    boss: 'st' + run + '_boss', amy: 'st' + run + '_amy', eve: 'st' + run + '_eve',
    cust: 'cst' + run + 'customer001', cust2: 'cst' + run + 'customer002',
  };
}

async function makeTeam(id, name) {
  const doc = await team.newTeamDoc(name, { selftest: true });
  doc._id = id;
  doc.seeded = true;
  await store.insert('jx_teams', doc);
}

async function makeMember(openid, teamId, name, role) {
  const m = team.memberDoc(openid, teamId, name, role, 'active');
  await store.insert('jx_members', m);
  return m.uid;
}

function wipeTeam(teamId) { return team.wipe(teamId); }

// ------------------------------------------------------------------ 0 数据库基础行为
async function stepBasics(report, run) {
  const t = ids(run).t1;
  await store.ensureCollections();
  const counts = await Promise.all(store.COLLECTIONS.map(function (c) { return store.count(c, { team_id: t }).then(function () { return true; }, function () { return false; }); }));
  report.check(counts.every(Boolean), '10 个数据集合都已建好');

  try {
    await store.find('jx_none_' + run, { team_id: t });
    report.check(false, '读不存在的集合应该报错');
  } catch (e) {
    report.check(store.isMissingCollection(e), '能认出“集合不存在”这种报错', errText(e));
  }

  const id = 'd_' + t + '_probe';
  await store.insert('jx_daily', { _id: id, team_id: t, user_id: 'u', day: '2026-01-05', exposure: 3, wechat_adds: null, summary: '', tags: ['a', 'b'] });
  try {
    await store.insert('jx_daily', { _id: id, team_id: t, user_id: 'u', day: '2026-01-05' });
    report.check(false, '相同 _id 第二次写入应该被拒绝');
  } catch (e) {
    report.check(store.isDuplicate(e), '能认出“_id 重复”这种报错（防重复报名靠它）', errText(e));
  }
  const n1 = await store.updateById('jx_daily', id, { exposure: 5, tags: store.cmd().set(['c']) });
  const got = await store.getById('jx_daily', id);
  report.check(n1 === 1 && got && got.exposure === 5, '按 _id 更新成功，并返回更新了 1 条');
  report.check(got && Array.isArray(got.tags) && got.tags.length === 1 && got.tags[0] === 'c', '数组字段是整体替换，不是合并', got && JSON.stringify(got.tags));
  report.check(got && got.wechat_adds === null && got.summary === '', '空值（null 和空字符串）原样存取');
  report.check((await store.updateById('jx_daily', 'no_such_id_' + run, { exposure: 1 })) === 0, '更新不存在的记录返回 0 条');

  await Promise.all(['2026-01-06', '2026-01-07', '2026-01-08'].map(function (day, i) {
    return store.insert('jx_daily', { team_id: t, user_id: i === 2 ? 'v' : 'u', day: day, exposure: i, wechat_adds: 1, summary: 'x' });
  }));
  const _ = store.cmd();
  const ranged = await store.findAll('jx_daily', { team_id: t, day: _.gte('2026-01-06').and(_.lte('2026-01-07')) }, { orderBy: [['day', 'desc']] });
  report.check(ranged.length === 2 && ranged[0].day === '2026-01-07', '日期范围查询和倒序排序正确', JSON.stringify(ranged.map(function (x) { return x.day; })));
  const others = await store.findAll('jx_daily', { team_id: t, user_id: _.neq('u') });
  report.check(others.length === 1 && others[0].user_id === 'v', '“不等于”查询正确');
  const slim = await store.find('jx_daily', { team_id: t, day: '2026-01-06' }, { fields: ['day'] });
  report.check(slim.length === 1 && slim[0].day === '2026-01-06' && slim[0].summary === undefined && !!slim[0]._id, '只取指定字段时，其他字段不返回');
  report.check((await store.count('jx_daily', { team_id: t })) === 4, '计数正确');
  report.check((await store.removeWhere('jx_daily', { team_id: t })) === 4, '按条件删除多条，并返回删除条数');
}

// ------------------------------------------------------------------ 1 一次读取超过 100 条
async function stepPaging(report, run) {
  const t = ids(run).t1;
  const total = 120;
  for (let base = 0; base < total; base += 30) {
    const jobs = [];
    for (let i = base; i < base + 30; i++) {
      jobs.push(store.insert('jx_daily', { team_id: t, user_id: 'u', day: '2025-01-01', exposure: i, wechat_adds: null, summary: '' }));
    }
    await Promise.all(jobs);
  }
  const all = await store.findAll('jx_daily', { team_id: t }, { fields: ['exposure'], orderBy: [['exposure', 'asc']] });
  report.check(all.length === total, total + ' 条记录一次全部读回（没有被默认的 100 条上限截断）', '读回 ' + all.length + ' 条');
  report.check(all.length > 1 && all[0].exposure === 0 && all[all.length - 1].exposure === total - 1, '数字排序正确');
  const page = await store.find('jx_daily', { team_id: t }, { orderBy: [['exposure', 'asc']], skip: 100, limit: 10 });
  report.check(page.length === 10 && page[0].exposure === 100, '翻页（skip / limit）正确');
  report.check((await store.removeWhere('jx_daily', { team_id: t })) === total, '清掉这 ' + total + ' 条');
}

// ------------------------------------------------------------------ 2 登记和跟进
async function stepSalesA(report, run, call) {
  const x = ids(run);
  const today = core.today();
  await makeTeam(x.t1, '自检临时团队 A');
  await makeMember(x.boss, x.t1, '自检管理员', 'admin');
  await makeMember(x.amy, x.t1, '自检成员', 'member');
  await store.insert('jx_channels', { _id: x.t1 + '_ch0', team_id: x.t1, name: '摆点', code: 'BD', kind: '线下', how: '', status: '进行中', note: '', sort: 0, archived: false });

  await expectFail(report, call(x.amy, 'products.save', { values: { name: '越权' } }), 'FORBIDDEN', '普通成员不能改产品卡');
  const values = {};
  C.PRODUCT_FIELDS.forEach(function (f) { values[f.key] = f.def || ''; });
  Object.assign(values, { name: '自检班型', vehicle: 'C1 手动挡', fee: '4,280' });
  const p = await call(x.boss, 'products.save', { values: values });
  report.check(!!p.id && p.pending > 0, '管理员保存产品卡，并提示还有几项没核实');

  const base = { name: '自检客户', channel_id: x.t1 + '_ch0', grade: 'B', status: '已问需求', next_action: '发对比清单', client_id: x.cust.slice(1) };
  await expectFail(report, call(x.amy, 'customers.save', base), 'INVALID', '在跟进的客户不写下次跟进时间，登记不了');
  await expectFail(report, call(x.amy, 'customers.save', Object.assign({}, base, { next_follow_on: today, remark: '证件 11010119900307451X' })), 'INVALID', '备注里写身份证号会被拦下');
  const made = await call(x.amy, 'customers.save', Object.assign({}, base, { next_follow_on: today, product_id: p.id }));
  report.check(made.id === x.cust, '登记客户成功');
  const again = await call(x.amy, 'customers.save', Object.assign({}, base, { next_follow_on: today, product_id: p.id }));
  report.check(again.id === x.cust && (await store.count('jx_customers', { team_id: x.t1 })) === 1, '同一次登记提交两遍，只存下一条');

  await expectFail(report, call(x.amy, 'customers.follow', { id: x.cust, status: '已正式报名', grade: 'B', next_follow_on: today, next_action: '发对比清单' }), 'INVALID', '不能跳过四项核对，直接把状态改成“已正式报名”');
  await call(x.amy, 'customers.follow', { id: x.cust, grade: 'A', status: '已匹配报价', summary: '担心约不到车，已讲清约车规则', next_action: '约到店', next_follow_on: core.addDays(today, 2) });
  let c = await store.getById('jx_customers', x.cust);
  report.check(c.grade === 'A' && c.grade_a_on === today && c.consulted_on === today && c.next_follow_on === core.addDays(today, 2), '记录跟进：分级、漏斗日期、下次跟进时间都更新了');
}

// ------------------------------------------------------------------ 3 定金和正式报名
async function stepSalesB(report, run, call) {
  const x = ids(run);
  const today = core.today();
  const products = await store.findAll('jx_products', { team_id: x.t1 });
  const p = { id: products.length ? products[0]._id : '' };
  let c;
  const info = await call(x.amy, 'customers.enroll_info', { id: x.cust });
  report.check(info.checks.length === 4 && info.product && info.product.id === p.id, '报名页给出四项核对和对应的产品卡内容');
  await expectFail(report, call(x.amy, 'customers.enroll', { id: x.cust, action: 'deposit', checks: ['e1', 'e2'], next_on: today }), 'INVALID', '四项核对没做完，收不了定金');
  await call(x.amy, 'customers.enroll', { id: x.cust, action: 'deposit', checks: ['e1', 'e2', 'e3', 'e4'], next_on: core.addDays(today, 1), next_action: '带资料来签合同' });
  c = await store.getById('jx_customers', x.cust);
  report.check(c.status === '已交定金' && c.active === true && c.deposit_on === today, '记录定金：状态变为“已交定金”，仍在跟进');
  await expectFail(report, call(x.amy, 'customers.enroll', { id: x.cust, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], next_on: today }), 'INVALID', '没签合同、没开凭证，办不了正式报名');
  const enrol = { id: x.cust, action: 'enroll', checks: ['e1', 'e2', 'e3', 'e4'], contract: true, receipt: true, doclist: true, next_on: today };
  const both = await Promise.all([call(x.amy, 'customers.enroll', enrol), call(x.amy, 'customers.enroll', enrol)]);
  const students = await store.findAll('jx_students', { team_id: x.t1 });
  report.check(students.length === 1 && both[0].student_id === both[1].student_id, '同时提交两次正式报名，只生成一条学员记录');
  c = await store.getById('jx_customers', x.cust);
  report.check(c.status === '已正式报名' && c.active === false && c.enrolled_on === today && c.next_follow_on === '', '客户转为“已正式报名”，不再出现在跟进里');
  const logs = await store.findAll('jx_followups', { team_id: x.t1, customer_id: x.cust });
  report.check(logs.filter(function (f) { return f.kind === 'enroll'; }).length === 1, '报名只记了一条日志', '共 ' + logs.length + ' 条日志');
  await expectFail(report, call(x.boss, 'customers.remove', { id: x.cust }), 'FORBIDDEN', '已报名的学员不能删除');
}

// ------------------------------------------------------------------ 4 学员交付
async function stepStudent(report, run, call) {
  const x = ids(run);
  const today = core.today();
  const sid = 'stu_' + x.cust;
  let page = await call(x.amy, 'students.get', { id: sid });
  report.check(page.s.stage === '资料准备' && page.checks.indexOf('e6') >= 0 && page.checks.indexOf('h1') < 0, '学员进入“资料准备”，报名时勾过的清单项带过来了');
  const form = Object.assign({}, page.f, { id: sid, checks: page.checks });
  await expectFail(report, call(x.amy, 'students.save', Object.assign({}, form, { next_action_on: '' })), 'INVALID', '交付中的学员不写下次动作日期，保存不了');
  const saved = await call(x.amy, 'students.save', Object.assign({}, form, {
    docs_status: '齐全', k1_result: '通过', k2_booking: '约不到', k2_exam_on: core.addDays(today, 3), next_action_on: core.addDays(today, 1),
    checks: page.checks.concat(['h1', 'h2', 'k1a']),
  }));
  report.check(saved.stage === '科目二', '资料齐全、科目一通过后，阶段自动走到“科目二”', saved.stage);
  report.check(saved.warnings.length === 1, '约不到车时提醒记进异常台账');
  const s = await store.getById('jx_students', sid);
  report.check(Array.isArray(s.checks) && s.checks.length === page.checks.length + 3 && s.active === true, '清单勾选保存正确', JSON.stringify(s.checks));
}

// ------------------------------------------------------------------ 5 异常台账
async function stepIssues(report, run, call) {
  const x = ids(run);
  const today = core.today();
  const sid = 'stu_' + x.cust;
  await expectFail(report, call(x.amy, 'issues.save', { student_id: sid, occurred_on: today, description: '连续两周约不到车' }), 'INVALID', '异常没写联系了谁、预计何时解决，保存不了');
  const issueId = 'ist' + run + 'issue0001';
  const issue = { student_id: sid, occurred_on: today, stage: '科目二', kind: '约不到车', description: '连续两周约不到车', contacted: '训练场排班', eta_on: core.addDays(today, 2), client_id: issueId.slice(1) };
  await call(x.amy, 'issues.save', issue);
  let list = await call(x.amy, 'issues.list', {});
  report.check(list.open_count === 1 && list.items[0].status === '处理中', '异常进了台账，状态“处理中”');
  await expectFail(report, call(x.amy, 'issues.remove', { id: issueId }), 'FORBIDDEN', '普通成员不能删除异常记录');
  const half = await call(x.amy, 'issues.save', Object.assign({}, issue, { id: issueId, solved_on: today }));
  report.check(half.status === '已解决待回访', '解决了但还没回访，不算关闭');
  const done = await call(x.amy, 'issues.save', Object.assign({}, issue, { id: issueId, solved_on: today, revisit_ok: true }));
  list = await call(x.amy, 'issues.list', {});
  report.check(done.status === '已关闭' && list.open_count === 0, '回访确认后才关闭');
}

// ------------------------------------------------------------------ 6 今日、日历和数据
async function stepNumbers(report, run, call) {
  const x = ids(run);
  const today = core.today();
  const home = await call(x.amy, 'home.get', {});
  report.check(home.fc.active === 0 && home.dc.active === 1 && home.dc.exams7 === 1 && home.dc.booking === 1, '“今日”里的统计正确', JSON.stringify([home.fc, home.dc]));
  report.check(home.reminders.length === 1 && home.reminders[0].hints.length === 1, '7 天内有考试的学员出现在交付提醒里');
  const cal = await call(x.amy, 'calendar.get', { d: core.addDays(today, 3) });
  report.check(cal.students.length === 1 && cal.students[0].what === '考科目二', '日历上考试那天能看到这位学员');
  await call(x.amy, 'data.daily_save', { rows: [{ day: today, exposure: '200', wechat: '5', summary: '摆点两小时' }] });
  await call(x.amy, 'data.daily_save', { rows: [{ day: today, exposure: '260', wechat: '5', summary: '摆点两小时' }] });
  const board = await call(x.amy, 'data.board', {});
  const row = {};
  board.rows.forEach(function (r) { row[r.key] = r; });
  report.check(row.exposure.this_week === 260 && row.registered.this_week === 1 && row.enrolled.this_week === 1 && row.enrolled.r_this === '100.0%' && board.today_filled, '数据看板：每日数据重复保存不会重复计数，漏斗和转化率正确', JSON.stringify([row.exposure.this_week, row.registered.this_week, row.enrolled.this_week, row.enrolled.r_this]));
}

// ------------------------------------------------------------------ 7 团队之间互相看不到
async function stepIsolation(report, run, call) {
  const x = ids(run);
  const today = core.today();
  await makeTeam(x.t2, '自检临时团队 B');
  await makeMember(x.eve, x.t2, '另一个团队的人', 'admin');
  await expectFail(report, call(x.eve, 'customers.get', { id: x.cust }), 'NOT_FOUND', '别的团队打不开这位客户');
  await expectFail(report, call(x.eve, 'customers.follow', { id: x.cust, summary: '越权' }), 'NOT_FOUND', '别的团队改不了这位客户');
  await expectFail(report, call(x.eve, 'students.get', { id: 'stu_' + x.cust }), 'NOT_FOUND', '别的团队打不开这位学员');
  const theirs = await Promise.all([call(x.eve, 'customers.list', { follow: 'all' }), call(x.eve, 'students.list', { stage: 'all' }), call(x.eve, 'issues.list', { all: true }), call(x.eve, 'products.list', {})]);
  report.check(theirs.every(function (r) { return r.items.length === 0; }), '别的团队的列表里什么都没有');
  await expectFail(report, call(x.eve, 'customers.save', { name: '串团队', channel_id: x.t1 + '_ch0', grade: 'C', status: '新加微信', next_follow_on: today }), 'INVALID', '登记时不能用别的团队的渠道');
  await expectFail(report, call('st' + run + '_nobody', 'home.get', {}), 'NEED_JOIN', '没加入团队的人什么都调用不了');

  // 管理员登记一位客户；打开“成员只看自己的”以后，普通成员看不到它
  const mine = await call(x.boss, 'customers.save', { name: '管理员的客户', channel_id: x.t1 + '_ch0', grade: 'C', status: '新加微信', next_follow_on: today, client_id: x.cust2.slice(1) });
  let seen = await call(x.amy, 'customers.list', { follow: 'all' });
  report.check(seen.items.length === 2, '默认情况下，成员能看到团队里所有客户');
  await call(x.boss, 'team.update', { members_only_own: true });
  seen = await call(x.amy, 'customers.list', { follow: 'all' });
  report.check(seen.items.length === 1 && seen.items[0].id === x.cust, '打开“成员只看自己的”后，成员只剩自己的客户');
  await expectFail(report, call(x.amy, 'customers.get', { id: mine.id }), 'NOT_FOUND', '……别人的客户也打不开');
  if (config.TEAM_CREATE_CODE) {
    await expectFail(report, call('st' + run + '_nobody', 'team.create', { team_name: '乱建', my_name: '路人', code: 'WRONG' }), 'INVALID', '创建口令不对，建不了团队');
  }
}

// ------------------------------------------------------------------ 8 清理
async function stepCleanup(report, run) {
  const x = ids(run);
  let removed = (await wipeTeam(x.t1)) + (await wipeTeam(x.t2));
  // 以前的自检如果中途断了，会留下带标记的临时团队，一并清掉
  const stale = await store.findAll('jx_teams', { selftest: true }, { fields: ['name'] });
  for (let i = 0; i < stale.length; i++) { removed += await wipeTeam(stale[i]._id); }
  const jobs = [store.count('jx_teams', { selftest: true })];
  store.COLLECTIONS.forEach(function (coll) {
    if (coll === 'jx_teams') { return; }
    jobs.push(store.count(coll, { team_id: x.t1 }));
    jobs.push(store.count(coll, { team_id: x.t2 }));
  });
  const left = (await Promise.all(jobs)).reduce(function (n, v) { return n + v; }, 0);
  report.check(left === 0, '临时数据已全部删除（共 ' + removed + ' 条）', '还剩 ' + left + ' 条');
}

const RUNNERS = [stepBasics, stepPaging, stepSalesA, stepSalesB, stepStudent, stepIssues, stepNumbers, stepIsolation, stepCleanup];

async function run(ctx, d, dispatch) {
  const step = Math.max(0, Math.min(RUNNERS.length - 1, parseInt(d.step, 10) || 0));
  const runId = step === 0 ? core.randomId(4) : (/^[a-f0-9]{8}$/.test(d.run) ? d.run : '');
  if (!runId) { throw core.invalid('自检要从第一步开始。'); }
  const started = Date.now();
  const report = new Report();
  try {
    await RUNNERS[step](report, runId, dispatch);
  } catch (e) {
    report.check(false, '这一步中途出错了', (e && e.code ? e.code + ' ' : '') + errText(e));
  }
  const last = step === RUNNERS.length - 1;
  return {
    run: runId, step: step, total: RUNNERS.length, name: STEPS[step], ok: report.ok, lines: report.lines, ms: Date.now() - started,
    // 中途失败也要走到最后一步，把临时数据清掉
    next: last ? -1 : (report.ok ? step + 1 : RUNNERS.length - 1),
  };
}

module.exports = { run: run, STEPS: STEPS };
