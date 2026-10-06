// 开发用：往假数据库里放一套看起来像真的数据，给本地截图和流程测试用。
'use strict';
const h = require('../helper');

async function seed() {
  h.fresh();
  const T = h.TODAY;
  const day = function (n) { return h.core.addDays(T, n); };
  const t = await h.team();
  await h.ok(t.boss, 'team.update', { name: '东校区招生组', unified_entry: '企业微信“东校区学车咨询”', reward_desc: '每成功推荐 1 位同学完成正式报名，奖励 100 元', reward_when: '被推荐人正式报名后 7 天内发放' });
  const pid = await h.product(t, {
    who: '周末有空的在校生', site: '东郊训练场，距东校区约 6 公里', shuttle: '周末早 8 点校门口班车', incl: '报名费、教材费、科目一至科目四首次考试费',
    excl: '体检费、补考费', payee_items: '全部由驾校对公账户收取', payee: '示例驾校有限公司对公账户', verified_on: T, verifier: '老板',
  });
  const mk = function (who, extra) { return h.customer(t, who, extra); };
  const all = ['e1', 'e2', 'e3', 'e4'];
  const ids = {};
  ids.lin = await mk(t.amy, { name: '林同学', grade: 'A', status: '已匹配报价', product_id: pid, contact: '微信 lin_2026', school: '东区大学 大二', vehicle: 'C1', plan: '本周内', concern: '价格', slots: '周末全天', next_action: '约到店看训练场', next_follow_on: T, notes: '比较了两家，担心后面加价。已发产品卡。' });
  ids.chen = await mk(t.amy, { name: '陈同学', grade: 'B', status: '已问需求', next_action: '发对比清单', next_follow_on: T, channel_id: t.channels[1].id });
  ids.wang = await mk(t.bob, { name: '王同学', grade: 'A', status: '犹豫中', next_action: '回答退费问题', next_follow_on: day(2), channel_id: t.channels[5].id });
  ids.zhao = await mk(t.bob, { name: '赵同学', grade: 'C', status: '新加微信', next_action: '朋友圈触达', next_follow_on: day(9), channel_id: t.channels[1].id });
  ids.sun = await mk(t.amy, { name: '孙同学', grade: 'D', status: '已问需求', next_follow_on: '', notes: '在外地实习，时间对不上' });
  ids.late = await mk(t.amy, { name: '周同学', grade: 'B', status: '已匹配报价', next_action: '问家长意见', next_follow_on: T });
  h.mock.state.collections.get('jx_customers').get(ids.late).next_follow_on = day(-2);
  ids.dep = await mk(t.bob, { name: '吴同学', grade: 'A', status: '已匹配报价', product_id: pid, next_follow_on: T });
  await h.ok(t.bob, 'customers.enroll', { id: ids.dep, action: 'deposit', checks: all, next_on: day(1), next_action: '带资料来签合同' });
  for (const [key, name, who] of [['s1', '郑同学', t.amy], ['s2', '冯同学', t.amy], ['s3', '蒋同学', t.bob]]) {
    ids[key] = await mk(who, { name: name, grade: 'A', status: '已匹配报价', product_id: pid, referrer_id: key === 's3' ? ids.s1 : '' });
    await h.ok(who, 'customers.enroll', { id: ids[key], action: 'enroll', checks: all, contract: true, receipt: true, doclist: true, next_on: T });
  }
  const stu = function (k) { return 'stu_' + ids[k]; };
  const save = async function (who, k, changes) {
    const page = await h.ok(who, 'students.get', { id: stu(k) });
    return h.ok(who, 'students.save', Object.assign({}, page.f, { id: stu(k), checks: page.checks }, changes));
  };
  await save(t.amy, 's1', { docs_status: '齐全', k1_result: '通过', k2_booking: '约不到', k2_exam_on: day(3), next_action: '跟进约车', next_action_on: day(1), checks: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'h1', 'h2', 'h3', 'k1a', 'k1b', 'k1c'] });
  await save(t.amy, 's2', { docs_status: '缺资料', docs_missing: '体检表', next_action: '催体检表', next_action_on: T });
  await h.ok(t.amy, 'issues.save', { student_id: stu('s1'), occurred_on: day(-1), stage: '科目二', kind: '约不到车', description: '连续两周约不到周末的车', contacted: '训练场排班老师', eta_on: day(2) });
  await h.ok(t.boss, 'issues.save', { occurred_on: day(-3), stage: '其他', kind: '排期变化', description: '训练场周三临时检修', contacted: '驾校教务', eta_on: day(-1), solved_on: day(-1) });
  await h.ok(t.amy, 'customers.follow', { id: ids.lin, summary: '问了补考费怎么收，已按产品卡回答。约周六到店。', grade: 'A', status: '已匹配报价', next_action: '周六带他看训练场', next_follow_on: day(3) });
  h.mock.state.collections.get('jx_customers').get(ids.lin).next_follow_on = T;
  await h.ok(t.amy, 'data.daily_save', { rows: [{ day: T, exposure: '320', wechat: '6', summary: '摆点两小时' }, { day: day(-1), exposure: '180', wechat: '3', summary: '发了 2 条短视频' }] });
  await h.ok('o-new1', 'team.join', { code: t.code, my_name: '新来的小周' });
  return { t: t, ids: ids, pid: pid, stu: stu, issue: h.mock.rows('jx_issues')[0]._id, script: h.mock.rows('jx_scripts')[3]._id };
}

module.exports = { seed: seed };
