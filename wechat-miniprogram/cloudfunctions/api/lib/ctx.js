// 每次调用的“上下文”：是谁、在哪个团队、能看到什么。
// 身份只认微信给云函数的 openid，客户端传什么都不作数。
'use strict';

const core = require('./core');
const store = require('./store');

async function load(openid) {
  const ctx = {
    openid: openid, member: null, team: null, uid: '', isAdmin: false, seesAll: false, state: 'none', _refs: null,
  };
  if (!openid) { return ctx; }
  const member = await store.getById('jx_members', openid);
  if (!member) { return ctx; }
  const team = await store.getById('jx_teams', member.team_id);
  if (!team) {
    // 成员记录指向一个不存在的团队（创建到一半失败）：当作还没加入
    await store.removeById('jx_members', openid);
    return ctx;
  }
  ctx.member = member;
  ctx.team = team;
  ctx.uid = member.uid;
  ctx.state = member.status;                       // active / pending / disabled
  if (member.status === 'active') {
    ctx.isAdmin = member.role === 'admin';
    ctx.seesAll = ctx.isAdmin || !team.members_only_own;
  }
  return ctx;
}

function requireActive(ctx) {
  if (ctx.state !== 'active') { throw new core.AppError('NEED_JOIN', '还没有加入团队，或者账号已被停用。'); }
}
function requireAdmin(ctx) {
  requireActive(ctx);
  if (!ctx.isAdmin) { throw core.forbidden('这个操作需要管理员来做。'); }
}

// 名字对照表：成员、渠道、班型。一次调用里只查一遍。
function refs(ctx) {
  if (!ctx._refs) {
    const tid = ctx.team._id;
    ctx._refs = Promise.all([
      store.findAll('jx_members', { team_id: tid }),
      store.findAll('jx_channels', { team_id: tid }, { orderBy: [['sort', 'asc']] }),
      store.findAll('jx_products', { team_id: tid }, { orderBy: [['sort', 'asc']] }),
    ]).then(function (r) {
      // 用没有原型的对象当对照表：客户端传来的 id 不管是什么字符串，都只会查到真实的记录
      const out = {
        members: Object.create(null), memberList: r[0], channels: Object.create(null), channelList: r[1],
        products: Object.create(null), productList: r[2],
      };
      r[0].forEach(function (m) { out.members[m.uid] = m; });
      r[1].forEach(function (c) { out.channels[c._id] = c; });
      r[2].forEach(function (p) { out.products[p._id] = p; });
      return out;
    });
  }
  return ctx._refs;
}

function memberName(r, uid) { const m = uid ? r.members[uid] : null; return m ? m.name : ''; }
function activeMembers(r) { return r.memberList.filter(function (m) { return m.status === 'active'; }); }

// 只看自己的：成员被限制时强制，否则听调用方的
function wantMine(ctx, mine) { return !ctx.seesAll || core.flag(mine); }

function custWhere(ctx, mine) {
  const w = { team_id: ctx.team._id };
  if (wantMine(ctx, mine)) { w.owner_id = ctx.uid; }
  return w;
}
function canSeeCustomer(ctx, c) {
  return !!c && c.team_id === ctx.team._id && (ctx.seesAll || c.owner_id === ctx.uid);
}
// 学员：交付负责人和当初的销售负责人都能看到
function canSeeStudent(ctx, s) {
  return !!s && s.team_id === ctx.team._id && (ctx.seesAll || s.owner_id === ctx.uid || s.sales_owner_id === ctx.uid);
}
function studentMine(ctx, s) { return s.owner_id === ctx.uid || s.sales_owner_id === ctx.uid; }

// 负责人：只能选在用的成员；被限制的成员没得选，保持原样
function pickOwner(ctx, r, wanted, fallback) {
  if (!ctx.seesAll || !wanted || typeof wanted !== 'string') { return fallback; }
  const m = r.members[wanted];
  return m && m.status === 'active' ? wanted : fallback;
}

module.exports = {
  load: load, requireActive: requireActive, requireAdmin: requireAdmin, refs: refs, memberName: memberName,
  activeMembers: activeMembers, wantMine: wantMine, custWhere: custWhere, canSeeCustomer: canSeeCustomer,
  canSeeStudent: canSeeStudent, studentMine: studentMine, pickOwner: pickOwner,
};
