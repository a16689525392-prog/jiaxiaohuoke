// 今日、跟进日历、数据、转介绍、开始与红线：这些页面只读不写（每日数据除外），都是从客户和学员记录里算出来的。
//
// 口径和原始资料一致：
//   · 客户“在跟进”= 状态不是“已正式报名 / 暂不跟进”，且分级不是 D；
//   · 学员“在交付”= 阶段不是“已完结 / 退费或转校”；
//   · 漏斗各环节按客户第一次走到那一步的日期统计。
'use strict';

const C = require('../lib/consts');
const core = require('../lib/core');
const store = require('../lib/store');
const ctxlib = require('../lib/ctx');
const view = require('../lib/view');

const CUST_FIELDS = ['name', 'contact', 'notes', 'grade', 'status', 'active', 'channel_id', 'owner_id', 'next_action', 'next_follow_on', 'registered_on'];
const MILESTONES = [['registered', 'registered_on'], ['consulted', 'consulted_on'], ['grade_a', 'grade_a_on'], ['deposit', 'deposit_on'], ['enrolled', 'enrolled_on']];
const RATE_ORDER = ['exposure', 'registered', 'consulted', 'grade_a', 'deposit', 'enrolled'];

const handlers = {};

function gradeRank(c) { return { A: 1, B: 2, C: 3 }[c.grade] || 4; }

function activeCustomers(ctx, mine) {
  const where = ctxlib.custWhere(ctx, mine);
  where.active = true;
  return store.findAll('jx_customers', where, { fields: CUST_FIELDS });
}

async function activeStudents(ctx, mine) {
  const rows = await store.findAll('jx_students', { team_id: ctx.team._id, active: true });
  return ctxlib.wantMine(ctx, mine) ? rows.filter(function (s) { return ctxlib.studentMine(ctx, s); }) : rows;
}

function followCounts(rows, today) {
  const week0 = core.weekStart(today);
  const week1 = core.addDays(week0, 6);
  const out = { active: rows.length, today: 0, overdue: 0, unscheduled: 0, week: 0, grade_a: 0 };
  rows.forEach(function (c) {
    const n = c.next_follow_on || '';
    if (!n) { out.unscheduled++; }
    else if (n === today) { out.today++; }
    else if (n < today) { out.overdue++; }
    if (n && n >= week0 && n <= week1) { out.week++; }
    if (c.grade === 'A') { out.grade_a++; }
  });
  return out;
}

function deliveryCounts(rows, today) {
  const in7 = core.addDays(today, 7);
  const out = { active: rows.length, due: 0, exams7: 0, unscheduled: 0, docs_missing: 0, booking: 0 };
  rows.forEach(function (s) {
    if (!s.next_action_on) { out.unscheduled++; } else if (s.next_action_on <= today) { out.due++; }
    const exam = view.nextExam(s, today);
    if (exam.on && exam.on <= in7) { out.exams7++; }
    if (s.docs_status === '缺资料') { out.docs_missing++; }
    if (s.k2_booking === '约不到') { out.booking++; }
  });
  return out;
}

// 待办到期（或逾期）的、7 天内有考试的学员，最早的在前
function deliveryReminders(rows, r, today, limit) {
  const in7 = core.addDays(today, 7);
  const out = [];
  rows.forEach(function (s) {
    const exam = view.nextExam(s, today);
    const todo = s.next_action_on || '';
    if (!((todo && todo <= today) || (exam.on && exam.on <= in7))) { return; }
    const hints = [];
    if (todo) {
      const delta = core.diffDays(todo, today);
      if (delta < 0) { hints.push({ text: '待办逾期 ' + (-delta) + ' 天', cls: 'due-over' }); }
      else if (delta === 0) { hints.push({ text: '今天有待办', cls: 'due-today' }); }
    }
    if (exam.on && exam.on <= in7) {
      const delta = core.diffDays(exam.on, today);
      hints.push({ text: delta === 0 ? '今天考' + exam.subject : delta + ' 天后考' + exam.subject, cls: delta === 0 ? 'due-today' : 'due-soon' });
    }
    const keys = [todo, exam.on].filter(Boolean).sort();
    out.push({ key: keys[0], ts: s.ts || 0, item: Object.assign(view.studentItem(s, r, today, 0), { hints: hints }) });
  });
  out.sort(function (a, b) { return a.key === b.key ? a.ts - b.ts : (a.key < b.key ? -1 : 1); });
  return out.slice(0, limit).map(function (x) { return x.item; });
}

function byGradeThen(key) {
  return function (a, b) {
    const g = gradeRank(a) - gradeRank(b);
    if (g) { return g; }
    const av = a[key] || '';
    const bv = b[key] || '';
    return av === bv ? 0 : (av < bv ? -1 : 1);
  };
}

async function openIssueCount(ctx, mine) {
  const where = { team_id: ctx.team._id, status: store.cmd().neq('已关闭') };
  if (!ctxlib.wantMine(ctx, mine)) { return store.count('jx_issues', where); }
  const got = await Promise.all([
    store.findAll('jx_issues', where, { fields: ['student_id'] }),
    store.findAll('jx_students', { team_id: ctx.team._id }, { fields: ['owner_id', 'sales_owner_id'] }),
  ]);
  const ids = Object.create(null);
  got[1].forEach(function (s) { if (ctxlib.studentMine(ctx, s)) { ids[s._id] = true; } });
  return got[0].filter(function (i) { return !i.student_id || ids[i.student_id]; }).length;
}

// 系统真正用起来之前还缺什么（只给管理员看）
async function setupHints(ctx, r) {
  const hints = [];
  const products = r.productList.filter(function (p) { return !p.archived; });
  if (!products.length) {
    hints.push({ text: '还没有产品卡。先填第 1 个班型：费用包含什么、不包含什么、钱交给谁、退费转校怎么办。', url: '/pages/product-edit/index', action: '去填产品卡' });
  } else {
    let worst = products[0];
    products.forEach(function (p) { if (view.pendingCount(p) > view.pendingCount(worst)) { worst = p; } });
    const n = view.pendingCount(worst);
    if (n) {
      hints.push({ text: '产品卡“' + (worst.name || '未命名') + '”还有 ' + n + ' 项没核实。对着合作协议和合同核实后再报价。', url: '/pages/product-edit/index?id=' + worst._id, action: '去核实' });
    }
  }
  if (!ctx.team.unified_entry) {
    hints.push({ text: '还没填统一入口。每个渠道都用同一个企业微信或工作微信。', url: '/pages/settings/index', action: '去填' });
  }
  if (!(await store.count('jx_customers', { team_id: ctx.team._id }))) {
    hints.push({ text: '还没有客户。把手上已有的意向客户登记进来，每个人都写上下次跟进时间。', url: '/pages/customer-edit/index', action: '登记第一个客户' });
  }
  if (!ctx.team.reward_desc) {
    hints.push({ text: '转介绍的公开规则还没写：奖励是什么、什么时候发、什么情况不算。', url: '/pages/settings/index', action: '去写规则' });
  }
  return hints;
}

// ------------------------------------------------------------------ 今日
handlers['home.get'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const today = core.today();
    const got = await Promise.all([
      ctxlib.refs(ctx), activeCustomers(ctx, d.mine), activeStudents(ctx, d.mine), openIssueCount(ctx, d.mine),
    ]);
    const r = got[0];
    const due = got[1].filter(function (c) { return c.next_follow_on && c.next_follow_on <= today; }).sort(byGradeThen('next_follow_on'));
    const unscheduled = got[1].filter(function (c) { return !c.next_follow_on; }).sort(byGradeThen('registered_on'));
    return {
      mine: ctxlib.wantMine(ctx, d.mine), can_all: ctx.seesAll, today: today, date_label: core.fmtMDW(today),
      me: ctx.member.name, team: ctx.team.name,
      fc: followCounts(got[1], today), dc: deliveryCounts(got[2], today), issues: got[3],
      due: due.slice(0, 100).map(function (c) { return view.customerItem(c, r); }), due_total: due.length,
      unscheduled: unscheduled.slice(0, 20).map(function (c) { return view.customerItem(c, r); }), unscheduled_total: unscheduled.length,
      reminders: deliveryReminders(got[2], r, today, 50),
      hints: ctx.isAdmin ? await setupHints(ctx, r) : [],
    };
  },
};

// ------------------------------------------------------------------ 跟进日历
handlers['calendar.get'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const today = core.today();
    const offset = Math.max(-520, Math.min(520, parseInt(d.w, 10) || 0));
    const start = core.addDays(core.weekStart(today), 7 * offset);
    let picked = today;
    try { picked = core.parseDate(d.d) || today; } catch (e) { picked = today; }
    const got = await Promise.all([ctxlib.refs(ctx), activeCustomers(ctx, d.mine), activeStudents(ctx, d.mine)]);
    const r = got[0];
    const cal = Object.create(null);
    for (let i = 0; i < 42; i++) { cal[core.addDays(start, i)] = { total: 0, A: 0, B: 0, C: 0, todo: 0, exam: 0 }; }
    got[1].forEach(function (c) {
      const day = cal[c.next_follow_on || ''];
      if (!day) { return; }
      day.total++;
      if (c.grade === 'A' || c.grade === 'B' || c.grade === 'C') { day[c.grade]++; }
    });
    got[2].forEach(function (s) {
      const day = cal[s.next_action_on || ''];
      if (day) { day.todo++; }
      view.EXAMS.forEach(function (pair) { const e = cal[s[pair[0]] || '']; if (e) { e.exam++; } });
    });
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let k = 0; k < 7; k++) {
        const day = core.addDays(start, 7 * w + k);
        const dnum = Number(day.slice(8, 10));
        row.push(Object.assign({
          day: day, num: dnum === 1 ? Number(day.slice(5, 7)) + '月' : String(dnum), first: dnum === 1,
          is_today: day === today, picked: day === picked, past: day < today,
        }, cal[day]));
      }
      weeks.push(row);
    }
    const customers = got[1].filter(function (c) { return c.next_follow_on === picked; }).sort(byGradeThen('name'));
    const students = [];
    got[2].forEach(function (s) {
      const what = [];
      if (s.next_action_on === picked) { what.push('待办'); }
      view.EXAMS.forEach(function (pair) { if (s[pair[0]] === picked) { what.push('考' + pair[1]); } });
      if (what.length) { students.push(Object.assign(view.studentItem(s, r, today, 0), { what: what.join('、') })); }
    });
    const last = core.addDays(start, 41);
    return {
      mine: ctxlib.wantMine(ctx, d.mine), can_all: ctx.seesAll, weeks: weeks, offset: offset, today: today,
      picked: picked, picked_label: core.fmtMDW(picked) + (picked === today ? '（今天）' : ''),
      range_label: core.fmtDate(start) + ' – ' + core.fmtDate(last), weekdays: core.WEEKDAYS.split(''),
      customers: customers.map(function (c) { return view.customerItem(c, r); }), students: students,
      fc: followCounts(got[1], today), dc: deliveryCounts(got[2], today),
    };
  },
};

// ------------------------------------------------------------------ 数据
function inRange(v, d0, d1) { return !!v && (!d0 || v >= d0) && (!d1 || v <= d1); }

// 曝光和手动记的加微数是每人每天填的：看“只看我的”就只加自己的，否则加全团队的
function dailyWhere(ctx, mine) {
  const where = { team_id: ctx.team._id };
  if (ctxlib.wantMine(ctx, mine)) { where.user_id = ctx.uid; }
  return where;
}

function funnel(customers, daily, d0, d1) {
  const out = { exposure: 0, wechat_manual: 0 };
  MILESTONES.forEach(function (m) {
    out[m[0]] = customers.filter(function (c) { return inRange(c[m[1]], d0, d1); }).length;
  });
  daily.forEach(function (x) {
    if (!inRange(x.day, d0, d1)) { return; }
    out.exposure += Number(x.exposure) || 0;
    out.wechat_manual += Number(x.wechat_adds) || 0;
  });
  return out;
}

function rates(f) {
  const out = {};
  for (let i = 1; i < RATE_ORDER.length; i++) {
    const prev = f[RATE_ORDER[i - 1]];
    out[RATE_ORDER[i]] = prev ? core.pct(f[RATE_ORDER[i]], prev) : '';
  }
  return out;
}

handlers['data.board'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const today = core.today();
    const week0 = core.weekStart(today);
    const got = await Promise.all([
      store.findAll('jx_customers', ctxlib.custWhere(ctx, d.mine), { fields: MILESTONES.map(function (m) { return m[1]; }).concat(['active', 'grade', 'next_follow_on']) }),
      store.findAll('jx_daily', dailyWhere(ctx, d.mine), { fields: ['day', 'exposure', 'wechat_adds'] }),
      activeStudents(ctx, d.mine), openIssueCount(ctx, d.mine),
      store.getById('jx_daily', dailyId(ctx, today)),
    ]);
    const cols = [
      funnel(got[0], got[1], week0, core.addDays(week0, 6)),
      funnel(got[0], got[1], core.addDays(week0, -7), core.addDays(week0, -1)),
      funnel(got[0], got[1], '', ''),
    ];
    const rs = cols.map(rates);
    return {
      mine: ctxlib.wantMine(ctx, d.mine), can_all: ctx.seesAll,
      week_label: core.fmtMD(week0) + ' – ' + core.fmtMD(core.addDays(week0, 6)),
      rows: C.FUNNEL.map(function (f) {
        return {
          key: f.key, label: f.label, hint: f.hint,
          this_week: cols[0][f.key], last_week: cols[1][f.key], total: cols[2][f.key],
          r_this: rs[0][f.key] || '', r_last: rs[1][f.key] || '', r_total: rs[2][f.key] || '',
        };
      }),
      fc: followCounts(got[0].filter(function (c) { return c.active; }), today), dc: deliveryCounts(got[2], today), issues: got[3],
      today_filled: !!(got[4] && got[4].exposure !== null && got[4].exposure !== undefined),
    };
  },
};

function dailyId(ctx, day) { return 'd_' + ctx.team._id + '_' + ctx.uid + '_' + day; }

handlers['data.daily_get'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const today = core.today();
    let end = today;
    try { end = core.parseDate(d.end) || today; } catch (e) { end = today; }
    if (end > today) { end = today; }
    const first = core.addDays(end, -13);
    const _ = store.cmd();
    const got = await Promise.all([
      store.findAll('jx_customers', ctxlib.custWhere(ctx, d.mine), { fields: MILESTONES.map(function (m) { return m[1]; }) }),
      store.findAll('jx_daily', { team_id: ctx.team._id, user_id: ctx.uid, day: _.gte(first).and(_.lte(end)) }),
    ]);
    const mineRows = Object.create(null);
    got[1].forEach(function (x) { mineRows[x.day] = x; });
    const days = [];
    for (let i = 0; i < 14; i++) {
      const day = core.addDays(end, -i);
      const own = mineRows[day] || {};
      const row = {
        day: day, label: core.fmtMD(day), weekday: '周' + core.WEEKDAYS[core.weekday(day)], is_today: day === today,
        exposure: own.exposure === null || own.exposure === undefined ? '' : String(own.exposure),
        wechat: own.wechat_adds === null || own.wechat_adds === undefined ? '' : String(own.wechat_adds),
        summary: own.summary || '',
      };
      MILESTONES.forEach(function (m) {
        row[m[0]] = got[0].filter(function (c) { return c[m[1]] === day; }).length;
      });
      days.push(row);
    }
    return {
      mine: ctxlib.wantMine(ctx, d.mine), can_all: ctx.seesAll, days: days, end: end,
      range_label: core.fmtMD(first) + ' – ' + core.fmtMD(end),
      prev_end: core.addDays(end, -14), next_end: end >= today ? '' : (core.addDays(end, 14) > today ? today : core.addDays(end, 14)),
    };
  },
};

handlers['data.daily_save'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const today = core.today();
    const rows = Array.isArray(d.rows) ? d.rows.slice(0, 31) : [];
    let bad = 0;
    let saved = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] && typeof rows[i] === 'object' ? rows[i] : {};
      let day = '';
      try { day = core.parseDate(row.day); } catch (e) { day = ''; }
      if (!day || day > today) { continue; }
      const id = dailyId(ctx, day);
      const old = await store.getById('jx_daily', id);
      const v = { summary: core.line(row.summary, 500), updated_at: core.nowStr() };
      [['exposure', 'exposure'], ['wechat', 'wechat_adds']].forEach(function (pair) {
        try {
          v[pair[1]] = core.countOrNull(row[pair[0]]);
        } catch (e) {                    // 不是整数：保持原来的值，并告诉用户
          bad++;
          v[pair[1]] = old && old[pair[1]] !== undefined ? old[pair[1]] : null;
        }
      });
      if (old) {
        if (old.exposure !== v.exposure || old.wechat_adds !== v.wechat_adds || (old.summary || '') !== v.summary) {
          await store.updateById('jx_daily', id, v);
          saved++;
        }
      } else if (v.exposure !== null || v.wechat_adds !== null || v.summary) {
        try {
          await store.insert('jx_daily', Object.assign({ _id: id, team_id: ctx.team._id, user_id: ctx.uid, day: day }, v));
        } catch (e) {
          if (!store.isDuplicate(e)) { throw e; }
          await store.updateById('jx_daily', id, v);
        }
        saved++;
      }
    }
    return {
      saved: saved, bad: bad, warn: bad > 0,
      message: bad ? '有 ' + bad + ' 个数字没看懂，没有改动它们。曝光和加微数只填整数。' : '每日数据已保存。',
    };
  },
};

// ------------------------------------------------------------------ 转介绍
handlers['referrals.list'] = {
  level: 'member',
  fn: async function (ctx) {
    const tid = ctx.team._id;
    const got = await Promise.all([
      store.findAll('jx_customers', { team_id: tid }, { fields: ['name', 'status', 'referrer_id', 'owner_id'] }),
      store.findAll('jx_students', { team_id: tid, refer_willing: '愿意' }, { fields: ['name', 'owner_id', 'sales_owner_id', 'stage'] }),
    ]);
    const names = Object.create(null);
    got[0].forEach(function (c) { names[c._id] = c.name; });
    const people = Object.create(null);
    got[0].forEach(function (c) {
      if (!c.referrer_id || !names[c.referrer_id]) { return; }
      if (!ctx.seesAll && c.owner_id !== ctx.uid) { return; }
      const p = people[c.referrer_id] || (people[c.referrer_id] = { id: c.referrer_id, name: names[c.referrer_id], total: 0, enrolled: 0, who: [] });
      p.total++;
      if (c.status === '已正式报名') { p.enrolled++; }
      p.who.push(c.name + '（' + c.status + '）');
    });
    const list = Object.keys(people).map(function (k) { return people[k]; }).sort(function (a, b) { return (b.enrolled - a.enrolled) || (b.total - a.total); });
    list.forEach(function (p) { p.who = p.who.join('、'); });
    return {
      rules: C.REFERRAL_RULES.map(function (r) { return { label: r.label, value: ctx.team[r.key] || '', example: r.example }; }),
      rules_ready: !!ctx.team.reward_desc, red_lines: C.REFERRAL_RED_LINES, people: list, can_edit: ctx.isAdmin,
      willing: got[1].filter(function (s) { return ctx.seesAll || ctxlib.studentMine(ctx, s); }).map(function (s) { return { id: s._id, name: s.name, stage: s.stage }; }),
    };
  },
};

// ------------------------------------------------------------------ 开始与红线
handlers['guide.get'] = {
  level: 'member',
  fn: async function (ctx) {
    const today = core.today();
    let s = ctx.team.start_date || today;
    try { s = core.parseDate(s) || today; } catch (e) { s = today; }
    const base = s > today ? s : today;            // 每周、每月的事会重复，显示下一次轮到的日期
    const nextSunday = core.addDays(base, (6 - core.weekday(base)) % 7);
    let nextMonth = base;
    if (base.slice(8, 10) !== '01') {
      const y = Number(base.slice(0, 4));
      const m = Number(base.slice(5, 7));
      nextMonth = (m === 12 ? (y + 1) + '-01' : y + '-' + (m < 9 ? '0' : '') + (m + 1)) + '-01';
    }
    const plan = [
      ['第 1 天', s, '产品卡填第 1 个班型；已有的意向客户登记进来，分级并排好下次跟进时间。'],
      ['第 1 周内', core.addDays(s, 6), '对着合作协议和合同核验产品卡：报名主体、收款主体、合同盖什么章、退费转校、售后联系人。'],
      ['第 1 周内', core.addDays(s, 6), '把统一话术里的【】换成自己的信息，全团队用同一套说法。'],
      ['第 2 周内', core.addDays(s, 13), '定统一入口和渠道码；备好首批内容和摆点物料；写好转介绍的公开规则。'],
      ['第 3 周内', core.addDays(s, 20), '把登记和接待流程跑一遍：找两三个熟人，完整走一次“登记 → 分级 → 跟进 → 四项核对”。'],
      ['第 4 周起', core.addDays(s, 21), '正式招生：有人加微信就登记，每次沟通后写下次跟进时间，每天收工前看一眼数据。'],
      ['每周日', nextSunday, '周复盘：三类案例各一个，只改一句话术、调一个渠道。'],
      ['每月初', nextMonth, '比较各渠道的有效线索、报名人数、实际成本和后续转介绍。'],
    ];
    const r = ctx.isAdmin ? await ctxlib.refs(ctx) : null;
    return {
      start: s, start_label: core.fmtDate(s),
      plan: plan.map(function (p) {
        const repeating = p[0] === '每周日' || p[0] === '每月初';
        return { when: p[0], date: core.fmtMDW(p[1]), text: p[2], repeating: repeating, past: !repeating && p[1] < today };
      }),
      red_lines: C.RED_LINES, hints: ctx.isAdmin ? await setupHints(ctx, r) : [],
    };
  },
};

module.exports = { handlers: handlers, followCounts: followCounts, deliveryCounts: deliveryCounts, funnel: funnel, rates: rates };
