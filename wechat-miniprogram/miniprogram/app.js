// 驾校招生助手 —— 小程序入口。
// 所有数据都通过云函数 api 读写（见 utils/api.js），小程序端不直接访问数据库。
const config = require('./config.js');

App({
  globalData: { session: null },

  onLaunch: function () {
    if (!wx.cloud) {
      wx.showModal({ title: '微信版本太低', content: '请把微信升级到最新版本后再打开。', showCancel: false });
      return;
    }
    const options = { traceUser: true };
    if (config.ENV_ID) { options.env = config.ENV_ID; }
    wx.cloud.init(options);
  },
});
