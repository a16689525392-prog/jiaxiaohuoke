// 把数据库里的记录整理成页面直接能显示的样子，以及产品卡、话术这些“算出来”的内容。
'use strict';

const C = require('./consts');
const core = require('./core');

function isPending(v) {
  const t = String(v === null || v === undefined ? '' : v);
  return !t.trim() || t.indexOf(C.PENDING) >= 0;
}

function pendingCount(p) {
  let n = 0;
  C.PRODUCT_KEYS.forEach(function (k) { if (isPending(p[k])) { n++; } });
  return n;
}

function feeText(p) {
  const fee = String(p.fee || '').trim();
  if (core.isNumber(fee)) { return core.money(fee) + ' 元'; }
  return fee || C.PENDING;
}

function cardValue(p, keys, fallback) {
  const parts = [];
  keys.forEach(function (k) {
    const v = k === 'fee' ? feeText(p) : String(p[k] || '').trim();
    if (v) { parts.push(v); }
  });
  return parts.length ? parts.join('；') : fallback;
}

// 给客户看的产品卡，纯文字版，方便粘贴到聊天里
function cardText(p) {
  const lines = ['【' + (p.name || '班型') + '】' + (p.vehicle || '车型待补充') + '｜' + (p.school || C.PENDING)];
  lines.push('适合谁：' + (p.who || '待补充'));
  C.CARD_LAYOUT.forEach(function (sec) {
    lines.push('');
    lines.push('— ' + sec.title + ' —');
    sec.rows.forEach(function (row) { lines.push(row.label + '：' + cardValue(p, row.keys, row.fallback)); });
  });
  lines.push('');
  lines.push('我们不承诺：' + C.NO_PROMISE + '。');
  lines.push('报名方式：' + C.HOW_TO_ENROLL);
  lines.push('信息核验日期：' + (p.verified_on || '待核验') + '｜以正式合同和当前合作协议为准。');
  return lines.join('\n');
}

// 把话术里的【占位符】换成产品卡上已经核实过的内容；没核实的保持原样
function fillScript(body, product) {
  let out = String(body || '');
  if (!product) { return out; }
  Object.keys(C.SCRIPT_TOKENS).forEach(function (token) {
    const field = C.SCRIPT_TOKENS[token];
    let value = String(product[field] || '').trim();
    if (!value || value.indexOf(C.PENDING) >= 0) { return; }
    if (field === 'fee' && core.isNumber(value)) { value = core.money(value); }
    out = out.split('【' + token + '】').join(value.replace(/[。；;]+$/, ''));
  });
  return out;
}

const EXAMS = [['k1_exam_on', '科目一'], ['k2_exam_on', '科目二'], ['k3_exam_on', '科目三'], ['k4_exam_on', '科目四']];

// 最近一场还没过去的考试
function nextExam(s, today) {
  const t = today || core.today();
  let best = { on: '', subject: '' };
  EXAMS.forEach(function (pair) {
    const d = s[pair[0]];
    if (d && d >= t && (!best.on || d < best.on)) { best = { on: d, subject: pair[1] }; }
  });
  return best;
}

function examLabel(exam, today) {
  if (!exam.on) { return ''; }
  const delta = core.diffDays(exam.on, today);
  if (delta === 0) { return '今天考' + exam.subject; }
  if (delta <= 7) { return delta + ' 天后考' + exam.subject; }
  return core.fmtDate(exam.on) + ' 考' + exam.subject;
}

function gradeLabel(g) { return g ? g + ' 类' : '未分级'; }

function name(map, id, key) {
  const row = id ? map[id] : null;
  return row ? (row[key || 'name'] || '') : '';
}

function customerItem(c, r) {
  const due = c.active ? core.dueInfo(c.next_follow_on) : null;
  return {
    id: c._id, name: c.name, grade: c.grade || '', grade_label: gradeLabel(c.grade), status: c.status, active: !!c.active,
    channel: name(r.channels, c.channel_id), owner: name(r.members, c.owner_id), contact: c.contact || '',
    due_label: due ? due.label : '', due_cls: due ? due.cls : '',
    next_action: c.next_action || '', next_follow_on: c.next_follow_on || '', note: core.clip(c.notes, 46),
  };
}

function studentItem(s, r, today, openIssues) {
  const exam = nextExam(s, today);
  const due = s.active ? core.dueInfo(s.next_action_on) : null;
  return {
    id: s._id, customer_id: s.customer_id, name: s.name, stage: s.stage, active: !!s.active,
    product: name(r.products, s.product_id), owner: name(r.members, s.owner_id),
    next_action: s.next_action || '', next_action_on: s.next_action_on || '',
    due_label: due ? due.label : '', due_cls: due ? due.cls : '',
    exam_label: examLabel(exam, today), exam_soon: !!(exam.on && exam.on <= core.addDays(today, 7)),
    docs_missing: s.docs_status === '缺资料', booking: s.k2_booking === '约不到', open_issues: openIssues || 0,
  };
}

module.exports = {
  isPending: isPending, pendingCount: pendingCount, feeText: feeText, cardValue: cardValue, cardText: cardText,
  fillScript: fillScript, nextExam: nextExam, examLabel: examLabel, gradeLabel: gradeLabel, name: name,
  customerItem: customerItem, studentItem: studentItem, EXAMS: EXAMS,
};
