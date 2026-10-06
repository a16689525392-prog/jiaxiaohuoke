// 把“动作名”对到处理函数上，并在进门时查清楚调用的人是谁、有没有权限。
'use strict';

const core = require('./core');
const store = require('./store');
const ctxlib = require('./ctx');

const HANDLERS = Object.assign(
  Object.create(null),
  require('../handlers/team').handlers,
  require('../handlers/library').handlers,
  require('../handlers/customers').handlers,
  require('../handlers/delivery').handlers,
  require('../handlers/overview').handlers
);

async function loadCtx(openid) {
  try {
    return await ctxlib.load(openid);
  } catch (e) {
    if (!store.isMissingCollection(e)) { throw e; }
    await store.ensureCollections();          // 第一次使用：集合还没建，建好再来
    return ctxlib.load(openid);
  }
}

// level：any = 谁都可以（还没加入团队的也行）；member = 团队里在用的成员；admin = 管理员
async function dispatch(openid, action, data) {
  const h = HANDLERS[action];
  if (!h) { throw new core.AppError('NO_ACTION', '小程序和云函数的版本对不上，请重新上传并部署云函数。'); }
  const ctx = await loadCtx(openid);
  if (h.level === 'admin') { ctxlib.requireAdmin(ctx); } else if (h.level !== 'any') { ctxlib.requireActive(ctx); }
  return h.fn(ctx, data || {});
}

// 自检要反过来调用上面的 dispatch，所以放在最后登记
HANDLERS['selftest.run'] = {
  level: 'admin',
  fn: function (ctx, d) { return require('./selftest').run(ctx, d, dispatch); },
};

module.exports = { dispatch: dispatch, actions: function () { return Object.keys(HANDLERS).sort(); } };
