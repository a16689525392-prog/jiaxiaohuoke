// 调用云函数的唯一入口。
//   api.call('customers.list', { follow: 'today' }).then(data => ...).catch(err => ...)
// 成功时拿到的是云函数返回的 data；失败时拿到 { code, message, errors }。
const config = require('../config.js');

const WELCOME = '/pages/welcome/index';

function currentRoute() {
  const pages = getCurrentPages();
  return pages.length ? '/' + pages[pages.length - 1].route : '';
}

function toWelcome() {
  getApp().globalData.session = null;
  if (currentRoute() !== WELCOME) { wx.reLaunch({ url: WELCOME }); }
}

// 把“调不通云函数”的各种原因翻译成人话
function networkMessage(e) {
  const text = String((e && (e.errMsg || e.message)) || e || '');
  if (/FUNCTION_NOT_FOUND|FunctionName parameter could not be found|-501000|-504002/.test(text)) {
    return '云函数 api 还没有部署。在微信开发者工具里右键 cloudfunctions/api，选“创建并部署：云端安装依赖”（以后更新时叫“上传并部署”）。';
  }
  if (/-504003|timed out|timeout|超时/i.test(text)) {
    return '云函数超时了，请再试一次。经常这样的话，到云开发控制台 → 云函数 → api → 版本与配置，把超时时间改成 20 秒。';
  }
  if (/env|Environment|-501001|INVALID_ENV/.test(text) && /not found|invalid|exist/i.test(text)) {
    return '没有找到云开发环境。请确认已经开通云开发，或者在 miniprogram/config.js 里填上环境 ID。';
  }
  return '网络不太好，请稍后再试。';
}

function call(action, data) {
  return new Promise(function (resolve, reject) {
    wx.cloud.callFunction({ name: config.FUNCTION, data: { action: action, data: data || {} } }).then(function (res) {
      const r = res && res.result;
      if (r && r.ok) { resolve(r.data); return; }
      const err = r && r.code ? r : { code: 'BAD', message: '云函数返回了看不懂的内容，请重新部署云函数。' };
      if (!err.errors || !err.errors.length) { err.errors = [err.message]; }
      if (err.code === 'NEED_JOIN') { toWelcome(); }
      reject(err);
    }, function (e) {
      const message = networkMessage(e);
      reject({ code: 'NETWORK', message: message, errors: [message], detail: String((e && e.errMsg) || e || '').slice(0, 200) });
    });
  });
}

// 我是谁、在哪个团队。结果记在 globalData 里，force 为 true 时重新取。
function session(force) {
  const app = getApp();
  if (!force && app.globalData.session) { return Promise.resolve(app.globalData.session); }
  return call('session.get').then(function (s) { app.globalData.session = s; return s; });
}

function setSession(s) { getApp().globalData.session = s; }

module.exports = { call: call, session: session, setSession: setSession, toWelcome: toWelcome, WELCOME: WELCOME };
