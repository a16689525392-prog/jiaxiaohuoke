// 云函数入口。小程序端只调用这一个函数：
//   wx.cloud.callFunction({ name: 'api', data: { action: 'customers.list', data: {...} } })
// 返回 { ok: true, data } 或 { ok: false, code, message, errors }。
// 数据库只在这里读写，小程序端不直接访问；“是谁”只认微信传给云函数的 openid。
'use strict';

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const core = require('./lib/core');
const store = require('./lib/store');
const router = require('./lib/router');

store.init(cloud);

exports.main = async function (event) {
  const started = Date.now();
  const wx = cloud.getWXContext() || {};
  const openid = wx.OPENID || '';
  const action = event && typeof event.action === 'string' ? event.action : '';
  const data = event && event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {};
  if (!openid) { return { ok: false, code: 'NO_OPENID', message: '请在小程序里使用。', errors: ['请在小程序里使用。'] }; }
  try {
    const result = await router.dispatch(openid, action, data);
    return { ok: true, data: result === undefined ? null : result, ms: Date.now() - started };
  } catch (e) {
    if (e instanceof core.AppError) {
      return { ok: false, code: e.code, message: e.message, errors: e.errors };
    }
    if (store.isMissingCollection(e)) {
      await store.ensureCollections();
      const text = '刚刚完成了数据库的初始化，请再试一次。';
      return { ok: false, code: 'RETRY', message: text, errors: [text] };
    }
    console.error('[api]', action, e);
    const message = '服务器出错了，请稍后再试。';
    return { ok: false, code: 'SERVER', message: message, errors: [message], detail: String((e && (e.errMsg || e.message)) || e).slice(0, 300) };
  }
};
