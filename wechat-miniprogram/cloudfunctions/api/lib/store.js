// 读写云数据库的唯一入口。业务代码不直接碰 SDK，只用这里的几个函数。
// 只用到云数据库最基础的能力（等值/范围查询、排序、分页、增删改），不依赖事务和聚合。
'use strict';

let cloud = null;
let db = null;

const COLLECTIONS = [
  'jx_teams', 'jx_members', 'jx_products', 'jx_scripts', 'jx_channels',
  'jx_customers', 'jx_followups', 'jx_students', 'jx_issues', 'jx_daily',
];
const PAGE = 1000;        // 云函数端一次最多取 1000 条
const MAX_PAGES = 10;     // 单个查询最多取 1 万条，够一个小团队用很多年

function init(sdk) {
  cloud = sdk;
  db = sdk.database();
}
function cmd() { return db.command; }

// 集合要先建好才能写。第一次使用时自动建；已经存在的会报错，忽略即可。
async function ensureCollections() {
  await Promise.all(COLLECTIONS.map(function (name) {
    return db.createCollection(name).then(function () { return true; }, function () { return false; });
  }));
}

function isMissingCollection(err) {
  const s = String((err && (err.errMsg || err.message)) || err);
  return /collection.*not.*exist|not exist.*collection|-502005|DATABASE_COLLECTION_NOT_EXIST|ResourceNotFound/i.test(s);
}

// 去掉值为 undefined 的字段，SDK 对它的处理不一致
function clean(doc) {
  const out = {};
  Object.keys(doc).forEach(function (k) { if (doc[k] !== undefined) { out[k] = doc[k]; } });
  return out;
}

function build(coll, where, opts) {
  let q = db.collection(coll).where(where || {});
  const o = opts || {};
  if (o.fields) {
    const proj = {};
    o.fields.forEach(function (f) { proj[f] = true; });
    q = q.field(proj);
  }
  (o.orderBy || []).forEach(function (pair) { q = q.orderBy(pair[0], pair[1] || 'asc'); });
  return q;
}

// 取一页
async function find(coll, where, opts) {
  const o = opts || {};
  let q = build(coll, where, o);
  if (o.skip) { q = q.skip(o.skip); }
  q = q.limit(Math.min(o.limit || 100, PAGE));
  const res = await q.get();
  return res.data || [];
}

// 取全部（自动翻页）
async function findAll(coll, where, opts) {
  const o = opts || {};
  let out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = build(coll, where, o);
    if (page) { q = q.skip(page * PAGE); }
    const res = await q.limit(PAGE).get();
    const rows = res.data || [];
    out = out.concat(rows);
    if (rows.length < PAGE) { break; }
  }
  return out;
}

async function findOne(coll, where) {
  const rows = await find(coll, where, { limit: 1 });
  return rows.length ? rows[0] : null;
}

function getById(coll, id) {
  if (!id || typeof id !== 'string') { return Promise.resolve(null); }
  return findOne(coll, { _id: id });
}

async function count(coll, where) {
  const res = await db.collection(coll).where(where || {}).count();
  return res.total || 0;
}

// 新增，返回 _id。doc 里可以自带 _id（用来保证“同一个东西只能有一条”）。
async function insert(coll, doc) {
  const res = await db.collection(coll).add({ data: clean(doc) });
  return res._id || doc._id;
}

function isDuplicate(err) {
  const s = String((err && (err.errMsg || err.message)) || err);
  return /duplicate|already exist|E11000|-502001.*dup|DuplicateKey/i.test(s);
}

async function updateById(coll, id, patch) {
  const res = await db.collection(coll).where({ _id: id }).update({ data: clean(patch) });
  return (res.stats && res.stats.updated) || 0;
}

async function updateWhere(coll, where, patch) {
  const res = await db.collection(coll).where(where).update({ data: clean(patch) });
  return (res.stats && res.stats.updated) || 0;
}

async function removeById(coll, id) {
  const res = await db.collection(coll).where({ _id: id }).remove();
  return (res.stats && res.stats.removed) || 0;
}

async function removeWhere(coll, where) {
  const res = await db.collection(coll).where(where).remove();
  return (res.stats && res.stats.removed) || 0;
}

module.exports = {
  COLLECTIONS: COLLECTIONS, init: init, cmd: cmd, ensureCollections: ensureCollections,
  isMissingCollection: isMissingCollection, isDuplicate: isDuplicate,
  find: find, findAll: findAll, findOne: findOne, getById: getById, count: count,
  insert: insert, updateById: updateById, updateWhere: updateWhere, removeById: removeById, removeWhere: removeWhere,
};
