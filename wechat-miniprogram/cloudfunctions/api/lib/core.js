// 时间、校验、报错这些各处都要用的小工具。
'use strict';

const config = require('../config');

// ------------------------------------------------------------------ 报错
// 业务上的“不行”都抛 AppError：code 给程序看，message / errors 给人看。
function AppError(code, message, errors) {
  this.name = 'AppError';
  this.code = code;
  this.message = message || '';
  this.errors = errors || (message ? [message] : []);
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

function invalid(errors) {
  const list = Array.isArray(errors) ? errors : [errors];
  return new AppError('INVALID', list[0], list);
}
function forbidden(message) { return new AppError('FORBIDDEN', message || '没有权限做这个操作。'); }
function notFound(message) { return new AppError('NOT_FOUND', message || '没找到这条记录，可能已经被删除，或者不在你能看到的范围里。'); }

// ------------------------------------------------------------------ 时间
// “今天”按固定时区算（默认东八区），和服务器所在地无关。
let fakeToday = null;   // 只给测试用

function setFakeToday(day) { fakeToday = day || null; }

function now() {
  if (fakeToday) { return new Date(fakeToday + 'T10:00:00Z'); }
  return new Date(Date.now() + config.TZ_OFFSET_HOURS * 3600 * 1000);
}
function pad(n) { return n < 10 ? '0' + n : String(n); }
function isoDate(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
function today() { return isoDate(now()); }
function nowStr() {
  const d = now();
  return isoDate(d) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}
// 排序用的时间戳（毫秒）。同一毫秒里连写两条时往后错一位，先后顺序才不会乱。
let lastStamp = 0;
function stamp() {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}
function toDate(s) { return new Date(String(s).slice(0, 10) + 'T00:00:00Z'); }
function addDays(s, n) { return isoDate(new Date(toDate(s).getTime() + n * 86400000)); }
function diffDays(a, b) { return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400000); }
function weekday(s) { return (toDate(s).getUTCDay() + 6) % 7; }       // 周一 = 0
function weekStart(s) { const d = s || today(); return addDays(d, -weekday(d)); }

const DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;

// '2026-10-6'、'2026/10/06' -> 'YYYY-MM-DD'；空 -> ''；乱写 -> 抛错
function parseDate(text) {
  const t = String(text === null || text === undefined ? '' : text).trim();
  if (!t) { return ''; }
  const m = DATE_RE.exec(t);
  if (!m) { throw new Error('bad date'); }
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 2000 || y > 2100) {
    throw new Error('bad date');
  }
  return isoDate(dt);
}

const WEEKDAYS = '一二三四五六日';

function fmtMD(s) { if (!s) { return ''; } const d = toDate(s); return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日'; }
function fmtMDW(s) { return s ? fmtMD(s) + ' 周' + WEEKDAYS[weekday(s)] : ''; }
function fmtDate(s) {
  if (!s) { return ''; }
  const d = toDate(s);
  if (d.getUTCFullYear() === toDate(today()).getUTCFullYear()) { return fmtMD(s); }
  return d.getUTCFullYear() + '年' + fmtMD(s);
}
function fmtDT(s) { return s ? fmtDate(String(s).slice(0, 10)) + ' ' + String(s).slice(11, 16) : ''; }

// 到期日相对今天的说法，和给界面用的样式名
function dueInfo(s) {
  if (!s) { return { label: '未排期', cls: 'due-none' }; }
  const delta = diffDays(s, today());
  if (delta < 0) { return { label: '逾期 ' + (-delta) + ' 天', cls: 'due-over' }; }
  if (delta === 0) { return { label: '今天', cls: 'due-today' }; }
  if (delta === 1) { return { label: '明天', cls: 'due-soon' }; }
  if (delta <= 6) { return { label: delta + ' 天后 · 周' + WEEKDAYS[weekday(s)], cls: 'due-future' }; }
  return { label: fmtDate(s), cls: 'due-future' };
}

// ------------------------------------------------------------------ 数字和文字
function toNumber(v) {
  if (v === null || v === undefined) { return null; }
  const t = String(v).replace(/,/g, '').trim();
  if (!t || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) { return null; }
  const f = Number(t);
  return isFinite(f) && Math.abs(f) < 1e12 ? f : null;
}
function isNumber(v) { return toNumber(v) !== null; }
function money(v) {
  if (v === null || v === undefined || v === '') { return ''; }
  const f = toNumber(v);
  if (f === null) { return String(v); }
  const fixed = f === Math.floor(f) ? String(f) : f.toFixed(2);
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}
// '' -> null；0 到 999,999,999 的整数 -> 数字；其他 -> 抛错
function countOrNull(v) {
  const t = String(v === null || v === undefined ? '' : v).replace(/,/g, '').trim();
  if (!t) { return null; }
  if (!/^\d{1,9}$/.test(t)) { throw new Error('bad count'); }
  return Number(t);
}
function pct(a, b) { return b ? (100 * a / b).toFixed(1) + '%' : ''; }

// 单行文字：去掉换行和首尾空白，限制长度
function line(v, max) {
  if (v === null || v === undefined) { return ''; }
  return String(v).replace(/[\r\n]+/g, ' ').trim().slice(0, max || 200);
}
// 多行文字
function text(v, max) {
  if (v === null || v === undefined) { return ''; }
  return String(v).replace(/\r\n/g, '\n').trim().slice(0, max || 2000);
}
function choice(v, options, fallback) { return options.indexOf(v) >= 0 ? v : (fallback === undefined ? '' : fallback); }
function clip(s, n) {
  const t = String(s || '').replace(/\n/g, ' ');
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}
function flag(v) { return v === true || v === 1 || v === '1' || v === 'true'; }
// 客户端传来的记录 id：只接受普通的短字符串，其他一律当作没传
function id(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : ''; }
// 看起来像身份证号的内容。系统只登记业务必要的信息，身份证号不该写进来。
function looksLikeIdNumber(v) { return /(^|[^0-9])[1-9][0-9]{16}[0-9Xx]($|[^0-9])/.test(String(v || '')); }

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 不含容易看错的 0/O/1/I
function randomCode(n) {
  let out = '';
  const bytes = require('crypto').randomBytes(n);
  for (let i = 0; i < n; i++) { out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]; }
  return out;
}
function randomId(n) { return require('crypto').randomBytes(n || 6).toString('hex'); }

module.exports = {
  AppError: AppError, invalid: invalid, forbidden: forbidden, notFound: notFound,
  setFakeToday: setFakeToday, now: now, stamp: stamp, today: today, nowStr: nowStr, addDays: addDays, diffDays: diffDays,
  weekday: weekday, weekStart: weekStart, parseDate: parseDate, WEEKDAYS: WEEKDAYS,
  fmtMD: fmtMD, fmtMDW: fmtMDW, fmtDate: fmtDate, fmtDT: fmtDT, dueInfo: dueInfo,
  toNumber: toNumber, isNumber: isNumber, money: money, countOrNull: countOrNull, pct: pct,
  line: line, text: text, choice: choice, clip: clip, flag: flag, id: id, looksLikeIdNumber: looksLikeIdNumber, randomCode: randomCode, randomId: randomId,
};
