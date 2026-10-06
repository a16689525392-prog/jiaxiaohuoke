// 交付：每位学员的节点清单、考试跟踪，以及异常台账。
'use strict';

const C = require('../lib/consts');
const core = require('../lib/core');
const store = require('../lib/store');
const ctxlib = require('../lib/ctx');
const view = require('../lib/view');
const readDate = require('./customers').readDate;

const STAGE_BLOCK = {
  '资料准备': 'handover', '科目一': 'k1', '科目二': 'k2', '科目三': 'k3', '科目四': 'k4', '已拿证待回访': 'k4', '已完结': 'ref', '退费或转校': '',
};
const NEED_DATE = '交付中的学员必须写下次动作日期，别让学员卡在你以为已经结束的环节里。';
const SUBJECTS = [['科目一', 'k1'], ['科目二', 'k2'], ['科目三', 'k3'], ['科目四', 'k4']];
const ISSUE_CLS = { '处理中': 'due-over', '已解决待回访': 'due-soon', '已关闭': 'due-none' };

const handlers = {};

async function getStudent(ctx, id) {
  const s = await store.getById('jx_students', core.id(id));
  if (!ctxlib.canSeeStudent(ctx, s)) { throw core.notFound(); }
  return s;
}

function isActiveStage(stage) { return C.DONE_STAGES.indexOf(stage) < 0; }

// 当前阶段做完了，就自动进到下一个阶段
function advance(stage, v, checks) {
  for (;;) {
    let next = '';
    if (stage === '资料准备' && v.docs_status === '齐全') { next = '科目一'; }
    else if (stage === '科目一' && v.k1_result === '通过') { next = '科目二'; }
    else if (stage === '科目二' && v.k2_result === '通过') { next = '科目三'; }
    else if (stage === '科目三' && v.k3_result === '通过') { next = '科目四'; }
    else if (stage === '科目四' && v.k4_result === '通过') { next = '已拿证待回访'; }
    else if (stage === '已拿证待回访' && v.license_on && checks.indexOf('k4c') >= 0) { next = '已完结'; }
    if (!next) { return stage; }
    stage = next;
  }
}

function openIssueCounts(issues) {
  const counts = Object.create(null);
  issues.forEach(function (i) { if (i.student_id && i.status !== '已关闭') { counts[i.student_id] = (counts[i.student_id] || 0) + 1; } });
  return counts;
}

// ------------------------------------------------------------------ 学员列表
handlers['students.list'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const tid = ctx.team._id;
    const where = { team_id: tid };
    const stage = d.stage === 'all' ? 'all' : core.choice(d.stage, C.STAGES);
    if (stage && stage !== 'all') { where.stage = stage; } else if (!stage) { where.active = true; }
    const got = await Promise.all([
      ctxlib.refs(ctx),
      store.findAll('jx_students', where),
      store.findAll('jx_issues', { team_id: tid, status: store.cmd().neq('已关闭') }, { fields: ['student_id', 'status'] }),
    ]);
    const r = got[0];
    const today = core.today();
    const issues = openIssueCounts(got[2]);
    const mine = ctxlib.wantMine(ctx, d.mine);
    let owner = '';
    if (ctx.seesAll && !mine) { owner = core.id(d.owner); if (!owner || !r.members[owner]) { owner = ''; } }
    const who = mine ? ctx.uid : owner;
    const q = core.line(d.q, 40).toLowerCase();
    const flag = core.choice(d.flag, ['due', 'exam', 'none', 'docs', 'booking']);
    const items = [];
    got[1].forEach(function (s) {
      if (who && s.owner_id !== who && s.sales_owner_id !== who) { return; }
      if (q && String(s.name || '').toLowerCase().indexOf(q) < 0 && String(s.contact || '').toLowerCase().indexOf(q) < 0) { return; }
      const it = view.studentItem(s, r, today, issues[s._id]);
      if (flag === 'due' && !(it.active && s.next_action_on && s.next_action_on <= today)) { return; }
      if (flag === 'exam' && !(it.active && it.exam_soon)) { return; }
      if (flag === 'none' && !(it.active && !s.next_action_on)) { return; }
      if (flag === 'docs' && !it.docs_missing) { return; }
      if (flag === 'booking' && !it.booking) { return; }
      it._ts = s.ts || 0;
      items.push(it);
    });
    // 没排期的最前，然后按下次动作日期，最后是新报名的在前
    items.sort(function (a, b) {
      const an = a.next_action_on;
      const bn = b.next_action_on;
      if (an !== bn) { if (!an) { return -1; } if (!bn) { return 1; } return an < bn ? -1 : 1; }
      return b._ts - a._ts;
    });
    items.forEach(function (it) { delete it._ts; });
    return {
      items: items, total: items.length, can_all: ctx.seesAll, mine: mine, owner: owner,
      filters: {
        stages: [{ value: '', label: '交付中' }].concat(C.STAGES.map(function (s) { return { value: s, label: s }; }), [{ value: 'all', label: '全部学员' }]),
        flags: [
          { value: '', label: '全部' }, { value: 'due', label: '待办到期' }, { value: 'exam', label: '7 天内考试' },
          { value: 'none', label: '没排期' }, { value: 'docs', label: '缺资料' }, { value: 'booking', label: '约不到车' },
        ],
        owners: ctx.seesAll ? [{ value: '', label: '全部负责人' }].concat(ctxlib.activeMembers(r).map(function (m) { return { value: m.uid, label: m.name }; })) : [],
      },
    };
  },
};

// ------------------------------------------------------------------ 学员详情
function issueItem(i, r) {
  const overdue = !i.solved_on && i.eta_on && i.eta_on < core.today();
  return {
    id: i._id, student_id: i.student_id || '', student_name: i.student_name || '', occurred: core.fmtDate(i.occurred_on),
    stage: i.stage || '', kind: i.kind || '', description: i.description || '', contacted: i.contacted || '',
    eta: i.eta_on ? core.fmtDate(i.eta_on) : '', eta_overdue: !!overdue, solved: i.solved_on ? core.fmtDate(i.solved_on) : '',
    status: i.status, cls: ISSUE_CLS[i.status] || '', owner: view.name(r.members, i.owner_id), closed: i.status === '已关闭',
  };
}

function sortIssues(list) {
  return list.sort(function (a, b) {
    const ac = a.status === '已关闭';
    const bc = b.status === '已关闭';
    if (ac !== bc) { return ac ? 1 : -1; }
    if (a.occurred_on !== b.occurred_on) { return a.occurred_on < b.occurred_on ? 1 : -1; }
    return (b.ts || 0) - (a.ts || 0);
  });
}

handlers['students.get'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const s = await getStudent(ctx, d.id);
    const got = await Promise.all([
      ctxlib.refs(ctx),
      store.findAll('jx_issues', { team_id: ctx.team._id, student_id: s._id }),
    ]);
    const r = got[0];
    const today = core.today();
    const checks = Array.isArray(s.checks) ? s.checks : [];
    const current = STAGE_BLOCK[s.stage] || '';
    const issues = sortIssues(got[1]);
    const item = view.studentItem(s, r, today, issues.filter(function (i) { return i.status !== '已关闭'; }).length);
    const fields = {};
    ['next_action', 'next_action_on', 'docs_status', 'docs_missing', 'k1_exam_on', 'k1_result', 'k2_booking', 'k2_exam_on',
      'k2_result', 'k3_exam_on', 'k3_result', 'k4_exam_on', 'k4_result', 'license_on', 'visit_smooth', 'visit_hard',
      'visit_worry', 'refer_willing', 'remark', 'stage', 'owner_id'].forEach(function (k) { fields[k] = s[k] || ''; });
    const keepOwner = s.owner_id || '';
    return {
      s: Object.assign(item, {
        contact: s.contact || '', enrolled: core.fmtDate(s.enrolled_on), sales_owner: view.name(r.members, s.sales_owner_id),
        product_id: s.product_id && r.products[s.product_id] ? s.product_id : '',
      }),
      f: fields, checks: checks, current: current,
      blocks: C.CHECKLIST.map(function (b) {
        let done = 0;
        const items = b.items.map(function (it) {
          const ok = checks.indexOf(it.key) >= 0;
          if (ok) { done++; }
          return { key: it.key, todo: it.todo, result: it.result, trap: it.trap, done: ok };
        });
        return { key: b.key, title: b.title, current: b.key === current, done: done, total: items.length, items: items };
      }),
      issues: issues.map(function (i) { return issueItem(i, r); }),
      stages: C.STAGES, results: C.RESULTS, today: today, can_all: ctx.seesAll,
      subjects: SUBJECTS.map(function (p) { return { name: p[0], key: p[1] }; }),
      members: ctx.seesAll ? r.memberList.filter(function (m) { return m.status === 'active' || m.uid === keepOwner; }).map(function (m) { return { id: m.uid, name: m.name + (m.status === 'active' ? '' : '（已停用）') }; }) : [],
    };
  },
};

handlers['students.save'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const s = await getStudent(ctx, d.id);
    const r = await ctxlib.refs(ctx);
    const errors = [];
    const today = core.today();
    const v = {
      next_action: core.line(d.next_action, 120),
      next_action_on: readDate(d, 'next_action_on', errors, '下次动作日期'),
      docs_status: core.choice(d.docs_status, ['齐全', '缺资料']),
      docs_missing: core.line(d.docs_missing, 120),
      k1_exam_on: readDate(d, 'k1_exam_on', errors, '科目一考试日期'), k1_result: core.choice(d.k1_result, C.RESULTS),
      k2_booking: core.choice(d.k2_booking, ['正常', '约不到']),
      k2_exam_on: readDate(d, 'k2_exam_on', errors, '科目二考试日期'), k2_result: core.choice(d.k2_result, C.RESULTS),
      k3_exam_on: readDate(d, 'k3_exam_on', errors, '科目三考试日期'), k3_result: core.choice(d.k3_result, C.RESULTS),
      k4_exam_on: readDate(d, 'k4_exam_on', errors, '科目四考试日期'), k4_result: core.choice(d.k4_result, C.RESULTS),
      license_on: readDate(d, 'license_on', errors, '拿证日期'),
      visit_smooth: core.text(d.visit_smooth, 600), visit_hard: core.text(d.visit_hard, 600), visit_worry: core.text(d.visit_worry, 600),
      refer_willing: core.choice(d.refer_willing, ['愿意', '待定', '不愿意']),
      remark: core.text(d.remark, 1000),
      owner_id: ctxlib.pickOwner(ctx, r, d.owner_id, s.owner_id || ''),
      updated_at: core.nowStr(),
    };
    if (v.docs_status === '齐全') { v.docs_missing = ''; }
    if ([v.docs_missing, v.remark, v.visit_smooth, v.visit_hard, v.visit_worry].some(core.looksLikeIdNumber)) {
      errors.push('这里看起来写了身份证号。系统只登记业务必要的信息，身份证号不要写进来。');
    }
    const checks = C.CHECK_KEYS.filter(function (k) { return Array.isArray(d.checks) && d.checks.indexOf(k) >= 0; });
    const stageIn = core.choice(d.stage, C.STAGES, s.stage);
    // 没有手动改阶段：做完的阶段自动往下走
    const stage = stageIn === s.stage ? advance(stageIn, v, checks) : stageIn;
    v.stage = stage;
    v.active = isActiveStage(stage);
    if (v.active) {
      if (!v.next_action_on) { errors.push(NEED_DATE); }
      else if (v.next_action_on < today) { errors.push('下次动作日期已经过了。做完了就写下一步，改成今天或之后的日期。'); }
    }
    if (v.license_on && v.license_on > today) { errors.push('拿证日期不能晚于今天。'); }
    if (errors.length) { throw core.invalid(errors); }
    v.checks = store.cmd().set(checks);
    await store.updateById('jx_students', s._id, v);

    let message = '已保存。';
    if (stage !== s.stage) { message += '阶段：' + s.stage + ' → ' + stage + '。'; }
    const warnings = [];
    const failed = SUBJECTS.filter(function (p) { return v[p[1] + '_result'] === '未通过' && s[p[1] + '_result'] !== '未通过'; }).map(function (p) { return p[0]; });
    if (failed.length) { warnings.push(failed.join('、') + '没通过：和学员约好补考安排，更新考试日期和下次动作。'); }
    if (v.k2_booking === '约不到') {
      const open = await store.count('jx_issues', { team_id: ctx.team._id, student_id: s._id, status: store.cmd().neq('已关闭') });
      if (!open) { warnings.push('约不到车要记进异常台账：发生时间、联系了谁、预计什么时候解决。'); }
    }
    return { message: message, warnings: warnings, stage: stage };
  },
};

// ------------------------------------------------------------------ 异常台账
function issueStatus(solvedOn, revisitOk) {
  if (solvedOn && revisitOk) { return '已关闭'; }
  return solvedOn ? '已解决待回访' : '处理中';
}

// 这位成员能看到的学员 id；能看全部的返回 null
async function visibleStudentIds(ctx) {
  if (ctx.seesAll) { return null; }
  const rows = await store.findAll('jx_students', { team_id: ctx.team._id }, { fields: ['owner_id', 'sales_owner_id'] });
  const ids = Object.create(null);
  rows.forEach(function (s) { if (ctxlib.studentMine(ctx, s)) { ids[s._id] = true; } });
  return ids;
}

async function visibleIssues(ctx, where, opts) {
  const got = await Promise.all([store.findAll('jx_issues', where, opts), visibleStudentIds(ctx)]);
  const ids = got[1];
  return ids ? got[0].filter(function (i) { return !i.student_id || ids[i.student_id]; }) : got[0];
}

async function getIssue(ctx, id) {
  const i = await store.getById('jx_issues', core.id(id));
  if (!i || i.team_id !== ctx.team._id) { throw core.notFound(); }
  if (i.student_id && !ctx.seesAll) {
    const s = await store.getById('jx_students', i.student_id);
    if (!ctxlib.canSeeStudent(ctx, s)) { throw core.notFound(); }
  }
  return i;
}

handlers['issues.list'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const all = core.flag(d.all);
    const where = { team_id: ctx.team._id };
    if (!all) { where.status = store.cmd().neq('已关闭'); }
    const got = await Promise.all([ctxlib.refs(ctx), visibleIssues(ctx, where)]);
    const list = sortIssues(got[1]);
    return {
      items: list.map(function (i) { return issueItem(i, got[0]); }), all: all, can_delete: ctx.isAdmin,
      open_count: list.filter(function (i) { return i.status !== '已关闭'; }).length,
    };
  },
};

handlers['issues.form'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const issue = d.id ? await getIssue(ctx, d.id) : null;
    const preset = issue ? (issue.student_id || '') : core.id(d.student);
    const got = await Promise.all([ctxlib.refs(ctx), store.findAll('jx_students', { team_id: ctx.team._id }, { fields: ['name', 'stage', 'active', 'owner_id', 'sales_owner_id'] })]);
    const r = got[0];
    const students = got[1].filter(function (s) {
      return (ctx.seesAll || ctxlib.studentMine(ctx, s)) && (s.active || s._id === preset);
    }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh'); });
    const keepOwner = issue ? (issue.owner_id || '') : '';
    return {
      issue: issue ? {
        id: issue._id, student_id: issue.student_id || '', occurred_on: issue.occurred_on || '', stage: issue.stage || '',
        kind: issue.kind || '', description: issue.description || '', contacted: issue.contacted || '', eta_on: issue.eta_on || '',
        solved_on: issue.solved_on || '', revisit_ok: !!issue.revisit_ok, owner_id: issue.owner_id || '', remark: issue.remark || '',
        status: issue.status,
      } : null,
      preset: students.some(function (s) { return s._id === preset; }) ? preset : '',
      students: students.map(function (s) { return { id: s._id, name: s.name + ' · ' + s.stage }; }),
      stages: C.ISSUE_STAGES, kinds: C.ISSUE_KINDS, today: core.today(), me: ctx.uid, can_all: ctx.seesAll, can_delete: ctx.isAdmin,
      members: ctx.seesAll ? r.memberList.filter(function (m) { return m.status === 'active' || (keepOwner && m.uid === keepOwner); }).map(function (m) { return { id: m.uid, name: m.name + (m.status === 'active' ? '' : '（已停用）') }; }) : [],
    };
  },
};

handlers['issues.save'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const issue = d.id ? await getIssue(ctx, d.id) : null;
    const r = await ctxlib.refs(ctx);
    const errors = [];
    const today = core.today();
    let student = null;
    if (d.student_id) { student = await getStudent(ctx, d.student_id); }      // 看不到的学员直接报“没找到”
    const v = {
      student_id: student ? student._id : '', student_name: student ? student.name : '',
      occurred_on: readDate(d, 'occurred_on', errors, '发生日期', true),
      stage: core.choice(d.stage, C.ISSUE_STAGES), kind: core.line(d.kind, 20),
      description: core.text(d.description, 1000), contacted: core.line(d.contacted, 120),
      eta_on: readDate(d, 'eta_on', errors, '预计解决时间'), solved_on: readDate(d, 'solved_on', errors, '实际解决日期'),
      revisit_ok: core.flag(d.revisit_ok),
      owner_id: ctxlib.pickOwner(ctx, r, d.owner_id, issue ? (issue.owner_id || '') : ctx.uid),
      remark: core.text(d.remark, 1000), updated_at: core.nowStr(),
    };
    if (!v.description) { errors.push('请写问题描述。'); }
    if (v.occurred_on && v.occurred_on > today) { errors.push('发生日期不能晚于今天。'); }
    if (v.solved_on && v.solved_on > today) { errors.push('实际解决日期不能晚于今天。'); }
    if (!v.solved_on) {
      if (!v.contacted) { errors.push('请写联系了谁。不能只回一句“我帮你问问”。'); }
      if (!v.eta_on) { errors.push('请写预计什么时候解决，学员需要一个明确的答复时间。'); }
      if (v.revisit_ok) { errors.push('还没填实际解决日期，不能先勾“已回访确认”。'); }
    }
    if ([v.description, v.contacted, v.remark].some(core.looksLikeIdNumber)) {
      errors.push('这里看起来写了身份证号。系统只登记业务必要的信息，身份证号不要写进来。');
    }
    if (errors.length) { throw core.invalid(errors); }
    v.status = issueStatus(v.solved_on, v.revisit_ok);
    if (issue) {
      await store.updateById('jx_issues', issue._id, v);
    } else {
      Object.assign(v, { team_id: ctx.team._id, created_by: ctx.uid, created_at: core.nowStr(), ts: core.stamp() });
      const clientId = typeof d.client_id === 'string' && /^[a-z0-9]{12,40}$/.test(d.client_id) ? d.client_id : '';
      if (clientId) { v._id = 'i' + clientId; }
      try { await store.insert('jx_issues', v); } catch (e) { if (!clientId || !store.isDuplicate(e)) { throw e; } }
    }
    return {
      status: v.status, warn: v.status === '已解决待回访',
      message: v.status === '已解决待回访' ? '已保存。问题解决以后还要回访一次，确认学员那边真的没问题了，才算关闭。' : '已保存，状态：' + v.status + '。',
    };
  },
};

handlers['issues.remove'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const i = await getIssue(ctx, d.id);
    await store.removeById('jx_issues', i._id);
    return { message: '已删除这条异常记录。' };
  },
};

module.exports = {
  handlers: handlers, advance: advance, issueStatus: issueStatus, visibleIssues: visibleIssues, isActiveStage: isActiveStage,
};
