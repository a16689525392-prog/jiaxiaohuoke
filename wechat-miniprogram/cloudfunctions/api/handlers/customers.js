// 客户：登记、分级、跟进记录，以及付款前四项核对后的定金 / 正式报名。
'use strict';

const C = require('../lib/consts');
const core = require('../lib/core');
const store = require('../lib/store');
const ctxlib = require('../lib/ctx');
const view = require('../lib/view');

const NEED_DATE = '还在跟进的客户必须写下次跟进时间。没有时间点的跟进，最后会变成谁都以为别人会跟。';
const NO_ID_NUMBER = '这里看起来写了身份证号。系统只登记业务必要的信息，身份证号不要写进来。';
const FOLLOW_STATUSES = C.OPEN_STATUSES.concat(['暂不跟进']);
const KIND_LABEL = { create: '登记', note: '跟进', update: '调整', deposit: '定金', enroll: '报名' };
const PER_PAGE = 30;
const GRADE_ORDER = { A: 1, B: 2, C: 3 };

const handlers = {};

function isActive(grade, status) { return C.CLOSED_STATUSES.indexOf(status) < 0 && grade !== 'D'; }

function studentId(customerId) { return 'stu_' + customerId; }

async function getCustomer(ctx, id) {
  const c = await store.getById('jx_customers', core.id(id));
  if (!ctxlib.canSeeCustomer(ctx, c)) { throw core.notFound(); }
  return c;
}

function readDate(d, key, errors, label, required) {
  let v = '';
  try { v = core.parseDate(d[key]); } catch (e) { errors.push(label + '的日期格式不对。'); return ''; }
  if (required && !v) { errors.push('请填' + label + '。'); }
  return v;
}

// 客户第一次走到漏斗各环节的日期
function milestones(current, grade, status, on) {
  const upd = {};
  if (C.CONSULTED.indexOf(status) >= 0 && !current.consulted_on) { upd.consulted_on = on; }
  if (grade === 'A' && !current.grade_a_on) { upd.grade_a_on = on; }
  return upd;
}

function gradeOptions() {
  return [{ value: '', label: '未分级' }].concat(C.GRADES.map(function (g) { return { value: g, label: g }; }));
}
function gradeHelp() { return C.GRADES.map(function (g) { return { grade: g, text: C.GRADE_HELP[g] }; }); }

function addFollowup(ctx, c, kind, summary, extra) {
  return store.insert('jx_followups', Object.assign({
    team_id: ctx.team._id, customer_id: c._id, at: core.nowStr(), ts: core.stamp(), user_id: ctx.uid, kind: kind,
    summary: summary, next_action: c.next_action || '', next_follow_on: c.next_follow_on || '', grade: c.grade || '',
    status: c.status,
  }, extra || {}));
}

// ------------------------------------------------------------------ 列表
handlers['customers.list'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const r = await ctxlib.refs(ctx);
    const where = ctxlib.custWhere(ctx, d.mine);
    let owner = '';
    if (ctx.seesAll && !where.owner_id) {
      owner = core.id(d.owner);
      if (owner && r.members[owner]) { where.owner_id = owner; } else { owner = ''; }
    }
    const grade = d.grade === 'none' ? 'none' : core.choice(d.grade, C.GRADES);
    if (grade) { where.grade = grade === 'none' ? '' : grade; }
    const status = core.choice(d.status, C.STATUSES);
    if (status) { where.status = status; }
    const channel = core.id(d.channel);
    if (channel && r.channels[channel]) { where.channel_id = channel; }
    const follow = core.choice(d.follow, ['today', 'overdue', 'none', 'active', 'closed', 'all'], 'active');
    if (follow === 'closed') { where.active = false; } else if (follow !== 'all') { where.active = true; }

    const today = core.today();
    let rows = await store.findAll('jx_customers', where, {
      fields: ['name', 'contact', 'school', 'notes', 'grade', 'status', 'active', 'channel_id', 'owner_id', 'next_action', 'next_follow_on', 'ts'],
    });
    if (follow === 'today') { rows = rows.filter(function (c) { return c.next_follow_on === today; }); }
    if (follow === 'overdue') { rows = rows.filter(function (c) { return c.next_follow_on && c.next_follow_on < today; }); }
    if (follow === 'none') { rows = rows.filter(function (c) { return !c.next_follow_on; }); }
    const q = core.line(d.q, 40).toLowerCase();
    if (q) {
      rows = rows.filter(function (c) {
        return [c.name, c.contact, c.school, c.notes].some(function (t) { return String(t || '').toLowerCase().indexOf(q) >= 0; });
      });
    }
    // 还在跟进的排前面；其中没排期的最前，然后按下次跟进时间；最后是新登记的在前
    rows.sort(function (a, b) {
      if (!!a.active !== !!b.active) { return a.active ? -1 : 1; }
      const an = a.next_follow_on || '';
      const bn = b.next_follow_on || '';
      if (a.active && an !== bn) { if (!an) { return -1; } if (!bn) { return 1; } return an < bn ? -1 : 1; }
      return (b.ts || 0) - (a.ts || 0);
    });
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const page = Math.min(pages, Math.max(1, parseInt(d.page, 10) || 1));
    return {
      items: rows.slice((page - 1) * PER_PAGE, page * PER_PAGE).map(function (c) { return view.customerItem(c, r); }),
      total: total, page: page, pages: pages, has_more: page < pages, can_all: ctx.seesAll,
      mine: !!ctxlib.custWhere(ctx, d.mine).owner_id, owner: owner,
      filters: {
        follow: [
          { value: 'active', label: '跟进中' }, { value: 'today', label: '今天要跟' }, { value: 'overdue', label: '已逾期' },
          { value: 'none', label: '没排期' }, { value: 'closed', label: '已结束' }, { value: 'all', label: '全部' },
        ],
        grades: [{ value: '', label: '全部分级' }].concat(C.GRADES.map(function (g) { return { value: g, label: g + ' 类' }; }), [{ value: 'none', label: '未分级' }]),
        statuses: [{ value: '', label: '全部状态' }].concat(C.STATUSES.map(function (s) { return { value: s, label: s }; })),
        channels: [{ value: '', label: '全部渠道' }].concat(r.channelList.map(function (ch) { return { value: ch._id, label: ch.name + (ch.archived ? '（已停用）' : '') }; })),
        owners: ctx.seesAll ? [{ value: '', label: '全部负责人' }].concat(ctxlib.activeMembers(r).map(function (m) { return { value: m.uid, label: m.name }; })) : [],
      },
    };
  },
};

// ------------------------------------------------------------------ 登记 / 编辑资料
// current：正在编辑的那条记录（新登记时没有）。已停用的渠道和班型只有它原来就在用，才能继续留着。
function readProfile(ctx, r, d, errors, current) {
  const v = {
    name: core.line(d.name, 80), contact: core.line(d.contact, 60), school: core.line(d.school, 60),
    vehicle: core.choice(d.vehicle, C.VEHICLES), plan: core.choice(d.plan, C.PLANS), slots: core.line(d.slots, 60),
    budget: core.line(d.budget, 40), concern: core.line(d.concern, 20), remark: core.text(d.remark, 1000),
  };
  if (!v.name) { errors.push('请填称呼。'); } else if (v.name.length > 40) { errors.push('称呼太长了（最多 40 个字）。'); }
  if ([v.name, v.contact, v.remark].some(core.looksLikeIdNumber)) { errors.push(NO_ID_NUMBER); }
  const ch = core.id(d.channel_id);
  if (ch && r.channels[ch] && (!r.channels[ch].archived || (current && current.channel_id === ch))) {
    v.channel_id = ch;
  } else {
    v.channel_id = '';
    errors.push('请选来源渠道。记录客户从哪里来，后面才知道哪个渠道有效。');
  }
  const pid = core.id(d.product_id);
  v.product_id = pid && r.products[pid] && (!r.products[pid].archived || (current && current.product_id === pid)) ? pid : '';
  v.registered_on = readDate(d, 'registered_on', errors, '登记日期') || core.today();
  if (v.registered_on > core.today()) { errors.push('登记日期不能晚于今天。'); }
  return v;
}

async function readReferrer(ctx, id, selfId) {
  const rid = core.id(id);
  if (!rid || rid === selfId) { return ''; }
  const x = await store.getById('jx_customers', rid);
  return ctxlib.canSeeCustomer(ctx, x) ? rid : '';
}

// 可以选作推荐人的：已正式报名的，已经推荐过别人的，以及这条记录现在选的那位
async function referrerOptions(ctx, current, exclude) {
  const rows = await store.findAll('jx_customers', ctxlib.custWhere(ctx, false), { fields: ['name', 'status', 'referrer_id'] });
  const has = Object.create(null);
  rows.forEach(function (c) { if (c.referrer_id) { has[c.referrer_id] = true; } });
  return rows.filter(function (c) {
    return c._id !== exclude && (c.status === '已正式报名' || c._id === current || has[c._id]);
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); }).map(function (c) {
    return { id: c._id, name: c.name + (c.status === '已正式报名' ? '' : '（' + c.status + '）') };
  });
}

handlers['customers.form'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const c = d.id ? await getCustomer(ctx, d.id) : null;
    const got = await Promise.all([ctxlib.refs(ctx), referrerOptions(ctx, c ? c.referrer_id : '', c ? c._id : '')]);
    const r = got[0];
    const keepCh = c ? c.channel_id : '';
    const keepP = c ? c.product_id : '';
    const keepOwner = c ? c.owner_id : '';
    return {
      c: c ? {
        id: c._id, name: c.name, contact: c.contact || '', channel_id: c.channel_id || '', school: c.school || '',
        vehicle: c.vehicle || '', plan: c.plan || '', slots: c.slots || '', budget: c.budget || '', concern: c.concern || '',
        remark: c.remark || '', product_id: c.product_id || '', owner_id: c.owner_id || '', referrer_id: c.referrer_id || '',
        registered_on: c.registered_on || '',
      } : null,
      today: core.today(), me: ctx.uid, can_all: ctx.seesAll,
      channels: r.channelList.filter(function (ch) { return !ch.archived || ch._id === keepCh; }).map(function (ch) { return { id: ch._id, name: ch.name }; }),
      products: r.productList.filter(function (p) { return !p.archived || p._id === keepP; }).map(function (p) { return { id: p._id, name: p.name || '未命名' }; }),
      members: ctx.seesAll ? r.memberList.filter(function (m) { return m.status === 'active' || (keepOwner && m.uid === keepOwner); }).map(function (m) { return { id: m.uid, name: m.name + (m.status === 'active' ? '' : '（已停用）') }; }) : [],
      referrers: got[1], vehicles: C.VEHICLES, plans: C.PLANS, concerns: C.CONCERNS,
      grades: gradeOptions(), grade_help: gradeHelp(), statuses: FOLLOW_STATUSES,
    };
  },
};

handlers['customers.save'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const r = await ctxlib.refs(ctx);
    const errors = [];
    const today = core.today();
    const now = core.nowStr();

    if (d.id) {                                                     // 编辑资料
      const c = await getCustomer(ctx, d.id);
      const v = readProfile(ctx, r, d, errors, c);
      if (errors.length) { throw core.invalid(errors); }
      v.owner_id = ctxlib.pickOwner(ctx, r, d.owner_id, c.owner_id || '');
      v.referrer_id = await readReferrer(ctx, d.referrer_id, c._id);
      v.updated_at = now;
      await store.updateById('jx_customers', c._id, v);
      if (v.owner_id !== (c.owner_id || '')) {
        await addFollowup(ctx, c, 'update', '负责人由 ' + (ctxlib.memberName(r, c.owner_id) || '未指定') + ' 改为 ' + (ctxlib.memberName(r, v.owner_id) || '未指定') + '。');
      }
      // 学员和异常记录里抄了一份姓名、联系方式和销售负责人，跟着改
      if (v.name !== c.name || v.contact !== (c.contact || '') || v.owner_id !== (c.owner_id || '')) {
        await store.updateById('jx_students', studentId(c._id), { name: v.name, contact: v.contact, sales_owner_id: v.owner_id });
        if (v.name !== c.name) {
          await store.updateWhere('jx_issues', { team_id: ctx.team._id, student_id: studentId(c._id) }, { student_name: v.name });
        }
      }
      return { id: c._id, message: '资料已保存。' };
    }

    const v = readProfile(ctx, r, d, errors, null);                  // 登记新客户
    const grade = core.choice(d.grade, C.GRADES);
    const status = core.choice(d.status, FOLLOW_STATUSES, '新加微信');
    const nextOn = readDate(d, 'next_follow_on', errors, '下次跟进时间');
    const notes = core.text(d.notes, 2000);
    if (core.looksLikeIdNumber(notes)) { errors.push(NO_ID_NUMBER); }
    if (isActive(grade, status)) {
      if (!nextOn) { errors.push(NEED_DATE); } else if (nextOn < today) { errors.push('下次跟进时间不能早于今天。'); }
    }
    if (errors.length) { throw core.invalid(errors); }
    const doc = Object.assign(v, {
      team_id: ctx.team._id, grade: grade, status: status, active: isActive(grade, status), next_follow_on: nextOn,
      next_action: core.line(d.next_action, 120), notes: notes, last_contact_on: notes ? v.registered_on : '',
      owner_id: ctxlib.pickOwner(ctx, r, d.owner_id, ctx.uid), referrer_id: await readReferrer(ctx, d.referrer_id, ''),
      consulted_on: '', grade_a_on: '', chk4_on: '', deposit_on: '', enrolled_on: '',
      created_by: ctx.uid, created_at: now, updated_at: now, ts: core.stamp(),
    });
    Object.assign(doc, milestones({}, grade, status, v.registered_on));
    // 客户端每次打开登记页带一个随机号：同一次登记点了两下，只会存下一条
    const clientId = typeof d.client_id === 'string' && /^[a-z0-9]{12,40}$/.test(d.client_id) ? d.client_id : '';
    if (clientId) { doc._id = 'c' + clientId; }
    let id;
    try {
      id = await store.insert('jx_customers', doc);
    } catch (e) {
      if (!clientId || !store.isDuplicate(e)) { throw e; }
      const same = await store.getById('jx_customers', doc._id);
      if (!same || same.team_id !== ctx.team._id || same.created_by !== ctx.uid) { throw core.invalid('没有保存成功，请返回后重新登记。'); }
      return { id: same._id, message: '已登记 ' + same.name + '。' };
    }
    doc._id = id;
    await addFollowup(ctx, doc, 'create', notes || '登记客户。');
    return { id: id, message: '已登记 ' + v.name + '。' };
  },
};

// ------------------------------------------------------------------ 详情和跟进
handlers['customers.get'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const c = await getCustomer(ctx, d.id);
    const tid = ctx.team._id;
    const got = await Promise.all([
      ctxlib.refs(ctx),
      store.findAll('jx_followups', { team_id: tid, customer_id: c._id }, { orderBy: [['ts', 'desc']] }),
      store.getById('jx_students', studentId(c._id)),
      store.findAll('jx_customers', { team_id: tid, referrer_id: c._id }, { fields: ['name', 'status'] }),
      c.referrer_id ? store.getById('jx_customers', c.referrer_id) : null,
      store.find('jx_scripts', { team_id: tid, scene: '报价' }, { orderBy: [['sort', 'asc']], limit: 1 }),
    ]);
    const r = got[0];
    const student = got[2];
    const product = c.product_id ? r.products[c.product_id] : null;
    const item = view.customerItem(c, r);
    const locked = c.status === '已正式报名' || c.status === '已交定金';
    const enrolled = c.status === '已正式报名';
    return {
      c: Object.assign(item, {
        locked: locked, enrolled: enrolled, registered: core.fmtDate(c.registered_on), school: c.school || '',
        vehicle: c.vehicle || '', plan: c.plan || '', slots: c.slots || '', budget: c.budget || '', concern: c.concern || '',
        remark: c.remark || '', notes: c.notes || '', last_contact: core.fmtDate(c.last_contact_on),
        product_id: product ? product._id : '', product_name: product ? (product.name || '未命名') : '',
      }),
      student_id: student ? student._id : '',
      referrer: got[4] && got[4].team_id === tid ? { id: got[4]._id, name: got[4].name } : null,
      referred: got[3].map(function (x) { return { id: x._id, name: x.name, status: x.status }; }),
      product: product ? { id: product._id, name: product.name || '未命名', fee_text: view.feeText(product), pending: view.pendingCount(product) } : null,
      quote: product && got[5].length ? view.fillScript(got[5][0].body, product) : '',
      log: got[1].map(function (f) {
        return {
          id: f._id, at: core.fmtDT(f.at), who: ctxlib.memberName(r, f.user_id), kind: f.kind,
          kind_label: KIND_LABEL[f.kind] || '记录', summary: f.summary || '', grade: f.grade || '', status: f.status || '',
          next: f.next_follow_on ? core.fmtMDW(f.next_follow_on) : '', next_action: f.next_action || '',
        };
      }),
      can_delete: !student && (ctx.isAdmin || c.owner_id === ctx.uid), today: core.today(),
      follow: {
        show_grade: !enrolled, grades: gradeOptions(), grade_help: gradeHelp(),
        statuses: enrolled ? [] : (c.status === '已交定金' ? ['已交定金', '暂不跟进'] : FOLLOW_STATUSES),
        status_hint: c.status === '已交定金' ? '正式报名请点上面的“办理正式报名”。' : '收定金或正式报名，点上面的“四项核对与报名”。',
        enroll_label: c.status === '已交定金' ? '办理正式报名' : '四项核对与报名',
      },
    };
  },
};

handlers['customers.follow'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const c = await getCustomer(ctx, d.id);
    const errors = [];
    const today = core.today();
    const oldGrade = c.grade || '';
    const locked = c.status === '已正式报名' || c.status === '已交定金';    // 这两个状态只能在报名页里设
    const grade = d.grade === undefined || c.status === '已正式报名' ? oldGrade : core.choice(d.grade, C.GRADES);
    let status;
    if (locked) {
      status = c.status === '已交定金' && d.status === '暂不跟进' ? '暂不跟进' : c.status;
    } else {
      status = core.choice(d.status, FOLLOW_STATUSES, c.status);
    }
    const summary = core.text(d.summary, 2000);
    const nextAction = d.next_action === undefined ? (c.next_action || '') : core.line(d.next_action, 120);
    const nextOn = d.next_follow_on === undefined ? (c.next_follow_on || '') : readDate(d, 'next_follow_on', errors, '下次跟进时间');
    const contactOn = readDate(d, 'contact_on', errors, '沟通日期') || today;
    if (contactOn > today) { errors.push('沟通日期不能晚于今天。'); }
    if (core.looksLikeIdNumber(summary)) { errors.push(NO_ID_NUMBER); }
    const active = isActive(grade, status);
    if (active) {
      if (!nextOn) { errors.push(NEED_DATE); } else if (nextOn < today) { errors.push('下次跟进时间不能早于今天。'); }
    }
    if (!summary && grade === oldGrade && status === c.status && nextOn === (c.next_follow_on || '') && nextAction === (c.next_action || '')) {
      errors.push('没有任何改动。写一下这次沟通的要点，或者调整分级、状态、下次跟进时间。');
    }
    if (errors.length) { throw core.invalid(errors); }
    const changes = [];
    if (grade !== oldGrade) { changes.push('分级 ' + (oldGrade || '未分级') + ' → ' + (grade || '未分级')); }
    if (status !== c.status) { changes.push('状态 ' + c.status + ' → ' + status); }
    const upd = { grade: grade, status: status, active: active, next_action: nextAction, next_follow_on: nextOn, updated_at: core.nowStr() };
    if (summary) { upd.notes = summary; upd.last_contact_on = contactOn; }
    Object.assign(upd, milestones(c, grade, status, contactOn));
    await store.updateById('jx_customers', c._id, upd);
    let text = summary || (changes.length ? '调整：' + changes.join('；') : '调整了下一步动作或跟进时间。');
    if (summary && changes.length) { text += '\n（' + changes.join('；') + '）'; }
    await addFollowup(ctx, c, summary ? 'note' : 'update', text, { next_action: nextAction, next_follow_on: nextOn, grade: grade, status: status });
    return { message: '已记录。' + (nextOn && active ? '下次跟进：' + core.fmtMDW(nextOn) + '。' : '') };
  },
};

handlers['customers.remove'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const c = await getCustomer(ctx, d.id);
    const student = await store.getById('jx_students', studentId(c._id));
    if (student || !(ctx.isAdmin || c.owner_id === ctx.uid)) {
      throw core.forbidden('已报名的学员不能删除；其他客户只有管理员或负责人可以删除。');
    }
    const tid = ctx.team._id;
    await store.updateWhere('jx_customers', { team_id: tid, referrer_id: c._id }, { referrer_id: '' });
    await store.removeWhere('jx_followups', { team_id: tid, customer_id: c._id });
    await store.removeById('jx_customers', c._id);
    return { message: '已删除 ' + c.name + '。' };
  },
};

// ------------------------------------------------------------------ 四项核对、定金、正式报名
function pickProduct(r, wanted, fallback) {
  const list = r.productList.filter(function (p) { return !p.archived; });
  let product = null;
  [wanted, fallback].forEach(function (id) {
    if (!product && id) { list.forEach(function (p) { if (p._id === id) { product = p; } }); }
  });
  return { list: list, product: product || (list.length ? list[0] : null) };
}

handlers['customers.enroll_info'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const c = await getCustomer(ctx, d.id);
    const got = await Promise.all([ctxlib.refs(ctx), store.getById('jx_students', studentId(c._id))]);
    const r = got[0];
    if (got[1]) { return { student_id: got[1]._id }; }
    const picked = pickProduct(r, core.id(d.product_id), c.product_id);
    const p = picked.product;
    return {
      student_id: '', c: { id: c._id, name: c.name, status: c.status, grade: c.grade || '' }, is_deposit: c.status === '已交定金',
      products: picked.list.map(function (x) { return { id: x._id, name: x.name || '未命名' }; }),
      product: p ? { id: p._id, name: p.name || '未命名', pending: view.pendingCount(p) } : null,
      checks: C.FOUR_CHECKS.map(function (ch) {
        return {
          key: ch.key, label: ch.label,
          rows: p ? ch.fields.map(function (k) {
            const value = k === 'fee' ? view.feeText(p) : String(p[k] || '').trim();
            return { label: C.PRODUCT_LABELS[k], value: value || C.PENDING, pending: view.isPending(value) };
          }) : [],
        };
      }),
      today: core.today(), me: ctx.uid, can_all: ctx.seesAll,
      members: ctx.seesAll ? ctxlib.activeMembers(r).map(function (m) { return { id: m.uid, name: m.name }; }) : [],
      default_todo: '发资料清单，确认身份证明、照片和体检', red_line: C.RED_LINES[1],
    };
  },
};

handlers['customers.enroll'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const c = await getCustomer(ctx, d.id);
    const r = await ctxlib.refs(ctx);
    const sid = studentId(c._id);
    const existing = await store.getById('jx_students', sid);
    if (existing && c.status === '已正式报名') { return { student_id: sid, message: c.name + ' 已经正式报名了。' }; }

    const errors = [];
    const today = core.today();
    const action = core.choice(d.action, ['deposit', 'enroll']);
    if (!action) { errors.push('请选这次是收定金，还是正式报名。'); }
    const product = pickProduct(r, core.id(d.product_id), c.product_id).product;
    if (!product) { errors.push('还没有产品卡，先去填一个班型。'); }
    const ticked = Array.isArray(d.checks) ? d.checks : [];
    const missing = C.FOUR_CHECKS.filter(function (ch) { return ticked.indexOf(ch.key) < 0; }).map(function (ch) { return ch.label; });
    if (missing.length) { errors.push('付款前四项核对还没做完：' + missing.join('、') + '。四项都和客户对上了再收款。'); }
    const on = readDate(d, 'on', errors, '日期') || today;
    if (on > today) { errors.push('日期不能晚于今天。'); }
    const nextOn = readDate(d, 'next_on', errors, '下次日期');
    const nextAction = core.line(d.next_action, 120);
    if (action === 'deposit') {
      if (!nextOn) { errors.push('收了定金还没正式报名，必须写下次跟进时间。'); }
      else if (nextOn < today) { errors.push('下次跟进时间不能早于今天。'); }
    } else if (action === 'enroll') {
      if (!core.flag(d.contract) || !core.flag(d.receipt)) {
        errors.push('正式报名要先签合同、开具付款凭证。钱、合同、资料、负责人要能一一对应。');
      }
      if (!nextOn) { errors.push('请写交付的下次动作日期，比如今天发资料清单。'); }
      else if (nextOn < today) { errors.push('交付的下次动作日期不能早于今天。'); }
    }
    if (errors.length) { throw core.invalid(errors); }

    const now = core.nowStr();
    const upd = {
      product_id: product._id, updated_at: now, last_contact_on: on, chk4_on: c.chk4_on || on, deposit_on: c.deposit_on || on,
      consulted_on: c.consulted_on || on, grade_a_on: c.grade_a_on || on, grade: 'A',   // 肯付款的人，细节一定是确认过的
    };
    const pname = product.name || '未命名';
    if (action === 'deposit') {
      Object.assign(upd, { status: '已交定金', active: true, next_action: nextAction, next_follow_on: nextOn });
      await store.updateById('jx_customers', c._id, upd);
      await addFollowup(ctx, c, 'deposit', '已和客户完成付款前四项核对，按正规流程收定金并开具凭证。班型：' + pname + '。',
        { next_action: nextAction, next_follow_on: nextOn, grade: 'A', status: '已交定金' });
      return { student_id: '', message: '已记录定金。下次跟进：' + core.fmtMDW(nextOn) + '。' };
    }

    // 正式报名。没有事务，所以按“先建学员、再改客户、最后记日志”的顺序写；
    // 学员的 _id 由客户决定，同一位客户不管提交几次都只会有一条学员记录。
    const done = ['e1', 'e2', 'e3', 'e4', 'e5'];
    if (core.flag(d.doclist)) { done.push('e6'); }
    if (core.flag(d.told_owner)) { done.push('h1'); }
    let created = !existing;
    if (!existing) {
      try {
        await store.insert('jx_students', {
          _id: sid, team_id: ctx.team._id, customer_id: c._id, name: c.name, contact: c.contact || '',
          sales_owner_id: c.owner_id || '', product_id: product._id, owner_id: ctxlib.pickOwner(ctx, r, d.owner_id, ctx.uid),
          enrolled_on: on, stage: '资料准备', active: true, next_action: nextAction || '发资料清单，确认身份证明、照片和体检',
          next_action_on: nextOn, docs_status: '', docs_missing: '', k1_exam_on: '', k1_result: '', k2_booking: '',
          k2_exam_on: '', k2_result: '', k3_exam_on: '', k3_result: '', k4_exam_on: '', k4_result: '', license_on: '',
          visit_smooth: '', visit_hard: '', visit_worry: '', refer_willing: '', remark: '', checks: done,
          created_at: now, updated_at: now, ts: core.stamp(),
        });
      } catch (e) {
        if (!store.isDuplicate(e)) { throw e; }
        created = false;                          // 同一次报名被提交了两次，另一次已经建好了
      }
    }
    Object.assign(upd, { status: '已正式报名', active: false, enrolled_on: c.enrolled_on || on, next_action: '', next_follow_on: '' });
    await store.updateById('jx_customers', c._id, upd);
    if (created) {
      await addFollowup(ctx, c, 'enroll', '已和客户完成付款前四项核对，签合同并开具凭证，正式报名。班型：' + pname + '。',
        { next_action: '', next_follow_on: '', grade: 'A', status: '已正式报名' });
    }
    return { student_id: sid, message: c.name + ' 已正式报名，转入交付。按节点往下做。' };
  },
};

module.exports = { handlers: handlers, isActive: isActive, studentId: studentId, readDate: readDate, GRADE_ORDER: GRADE_ORDER };
