// 本地测试用的假 wx-server-sdk：一个放在内存里的小数据库。
// 只实现业务代码用到的那部分，并且故意比真的更严格——用到没实现的东西直接报错，
// 这样代码不会悄悄依赖一个“只在假数据库里成立”的行为。
'use strict';

const Module = require('module');

const state = { collections: new Map(), openid: 'openid-test', seq: 0, ops: 0, failNext: null };

function Cmd(op, arg) { this.op = op; this.arg = arg; this.more = []; }
Cmd.prototype.and = function (other) {
  if (!(other instanceof Cmd)) { throw new Error('mock: and() 只接受查询指令'); }
  this.more.push(other);
  return this;
};

const command = {
  eq: function (v) { return new Cmd('eq', v); },
  neq: function (v) { return new Cmd('neq', v); },
  lt: function (v) { return new Cmd('lt', v); },
  lte: function (v) { return new Cmd('lte', v); },
  gt: function (v) { return new Cmd('gt', v); },
  gte: function (v) { return new Cmd('gte', v); },
  in: function (v) { if (!Array.isArray(v)) { throw new Error('mock: in() 要数组'); } return new Cmd('in', v); },
  nin: function (v) { if (!Array.isArray(v)) { throw new Error('mock: nin() 要数组'); } return new Cmd('nin', v); },
  set: function (v) { return new Cmd('set', v); },
  remove: function () { return new Cmd('remove'); },
  inc: function (v) { return new Cmd('inc', v); },
};

function isPlain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Cmd) && !(v instanceof Date); }

function matchOne(value, cond) {
  if (cond instanceof Cmd) {
    let ok;
    const has = value !== undefined;
    switch (cond.op) {
      case 'eq': ok = value === cond.arg; break;
      case 'neq': ok = value !== cond.arg; break;
      case 'lt': ok = has && value !== null && typeof value === typeof cond.arg && value < cond.arg; break;
      case 'lte': ok = has && value !== null && typeof value === typeof cond.arg && value <= cond.arg; break;
      case 'gt': ok = has && value !== null && typeof value === typeof cond.arg && value > cond.arg; break;
      case 'gte': ok = has && value !== null && typeof value === typeof cond.arg && value >= cond.arg; break;
      case 'in': ok = cond.arg.indexOf(value) >= 0; break;
      case 'nin': ok = cond.arg.indexOf(value) < 0; break;
      default: throw new Error('mock: 查询里不能用 ' + cond.op);
    }
    return ok && cond.more.every(function (m) { return matchOne(value, m); });
  }
  if (cond === undefined) { throw new Error('mock: 查询条件的值是 undefined（真的 SDK 会报错）'); }
  if (cond !== null && typeof cond === 'object') { throw new Error('mock: 查询条件只能是简单值或查询指令'); }
  return value === cond;
}

function matches(doc, where) {
  return Object.keys(where).every(function (k) { return matchOne(doc[k], where[k]); });
}

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function missing(name) {
  const e = new Error('collection.get:fail -502005 database collection not exists. [ResourceNotFound] Db or Table not exist: ' + name);
  e.errCode = -502005;
  return e;
}

function checkData(data, forUpdate) {
  if (!isPlain(data)) { throw new Error('mock: data 要是对象'); }
  Object.keys(data).forEach(function (k) {
    const v = data[k];
    if (v === undefined) { throw new Error('mock: 字段 ' + k + ' 的值是 undefined'); }
    if (forUpdate && k === '_id') { throw new Error('mock: 不能更新 _id'); }
    if (forUpdate && (Array.isArray(v) || isPlain(v))) {
      throw new Error('mock: 更新时字段 ' + k + ' 是数组或对象，请用 _.set() 整体替换，避免真数据库按字段合并');
    }
    if (!forUpdate && v instanceof Cmd) { throw new Error('mock: 新增时不能用更新指令'); }
  });
}

function Query(name, where) { this.name = name; this._where = where || {}; this._order = []; this._skip = 0; this._limit = 100; this._fields = null; }
Query.prototype.where = function (w) {
  if (!isPlain(w)) { throw new Error('mock: where 要是对象'); }
  const q = new Query(this.name, w);
  return q;
};
Query.prototype.orderBy = function (field, dir) {
  if (dir !== 'asc' && dir !== 'desc') { throw new Error('mock: orderBy 方向只能是 asc / desc'); }
  this._order.push([field, dir]);
  return this;
};
Query.prototype.skip = function (n) { this._skip = n; return this; };
Query.prototype.limit = function (n) {
  if (!(n > 0) || n > 1000) { throw new Error('mock: limit 要在 1 到 1000 之间'); }
  this._limit = n;
  return this;
};
Query.prototype.field = function (f) { this._fields = Object.keys(f).filter(function (k) { return f[k]; }); return this; };
Query.prototype._rows = function () {
  state.ops++;
  if (state.failNext) { const e = state.failNext; state.failNext = null; throw e; }
  const coll = state.collections.get(this.name);
  if (!coll) { throw missing(this.name); }
  const where = this._where;
  return Array.from(coll.values()).filter(function (doc) { return matches(doc, where); });
};
Query.prototype.get = async function () {
  let rows = this._rows();
  const order = this._order;
  if (order.length) {
    rows = rows.slice().sort(function (a, b) {
      for (let i = 0; i < order.length; i++) {
        const av = a[order[i][0]];
        const bv = b[order[i][0]];
        if (av === bv) { continue; }
        const less = av === undefined || av === null ? true : (bv === undefined || bv === null ? false : av < bv);
        return (less ? -1 : 1) * (order[i][1] === 'asc' ? 1 : -1);
      }
      return 0;
    });
  }
  rows = rows.slice(this._skip, this._skip + this._limit);
  const fields = this._fields;
  return {
    data: rows.map(function (doc) {
      if (!fields) { return clone(doc); }
      const out = { _id: doc._id };
      fields.forEach(function (f) { if (doc[f] !== undefined) { out[f] = clone(doc[f]); } });
      return out;
    }),
  };
};
Query.prototype.count = async function () { return { total: this._rows().length }; };
Query.prototype.update = async function (opts) {
  checkData(opts.data, true);
  const rows = this._rows();
  let updated = 0;
  rows.forEach(function (doc) {
    let changed = false;
    Object.keys(opts.data).forEach(function (k) {
      const v = opts.data[k];
      let next;
      if (v instanceof Cmd) {
        if (v.op === 'set') { next = clone(v.arg); }
        else if (v.op === 'remove') { if (k in doc) { delete doc[k]; changed = true; } return; }
        else if (v.op === 'inc') { next = (Number(doc[k]) || 0) + v.arg; }
        else { throw new Error('mock: 更新里不能用 ' + v.op); }
      } else {
        next = v;
      }
      if (JSON.stringify(doc[k]) !== JSON.stringify(next)) { doc[k] = next; changed = true; }
    });
    if (changed) { updated++; }          // 和 MongoDB 一样：值没变不算更新
  });
  return { stats: { updated: updated } };
};
Query.prototype.remove = async function () {
  if (!Object.keys(this._where).length) { throw new Error('mock: 不带条件的删除'); }
  const rows = this._rows();
  const coll = state.collections.get(this.name);
  rows.forEach(function (doc) { coll.delete(doc._id); });
  return { stats: { removed: rows.length } };
};
Query.prototype.add = async function (opts) {
  state.ops++;
  if (state.failNext) { const e = state.failNext; state.failNext = null; throw e; }
  const coll = state.collections.get(this.name);
  if (!coll) { throw missing(this.name); }
  checkData(opts.data, false);
  const doc = clone(opts.data);
  if (doc._id === undefined) { state.seq++; doc._id = 'auto' + String(state.seq).padStart(8, '0') + Math.random().toString(16).slice(2, 10); }
  if (typeof doc._id !== 'string') { throw new Error('mock: _id 要是字符串'); }
  if (coll.has(doc._id)) {
    const e = new Error('collection.add:fail -502001 database request fail. [FailedOperation] multiple write errors: [{write errors: [{E11000 duplicate key error collection: ' + this.name + ' index: _id_ dup key: { : "' + doc._id + '" }}]}]');
    e.errCode = -502001;
    throw e;
  }
  coll.set(doc._id, doc);
  return { _id: doc._id };
};
Query.prototype.doc = function () { throw new Error('mock: 没有实现 doc()，请用 where({_id})'); };

const database = {
  command: command,
  collection: function (name) { return new Query(name, {}); },
  createCollection: async function (name) {
    if (state.collections.has(name)) { const e = new Error('createCollection:fail -501001 resource system error. Table exist'); e.errCode = -501001; throw e; }
    state.collections.set(name, new Map());
    return { errMsg: 'createCollection:ok' };
  },
};

const sdk = {
  DYNAMIC_CURRENT_ENV: Symbol('DYNAMIC_CURRENT_ENV'),
  init: function () {},
  database: function () { return database; },
  getWXContext: function () { return { OPENID: state.openid, APPID: 'wx-test' }; },
};

// 让 require('wx-server-sdk') 拿到上面这个假的
const realLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') { return sdk; }
  return realLoad.apply(this, arguments);
};

module.exports = {
  sdk: sdk, state: state,
  reset: function () { state.collections = new Map(); state.openid = 'openid-test'; state.ops = 0; state.failNext = null; },
  as: function (openid) { state.openid = openid; },
  rows: function (name) { const c = state.collections.get(name); return c ? Array.from(c.values()).map(clone) : []; },
  raw: function (name, id) { const c = state.collections.get(name); return c ? c.get(id) : undefined; },
};
