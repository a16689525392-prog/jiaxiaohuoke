// 测试用的小工具：装上假数据库，按“某个微信用户调用某个动作”的方式调用云函数。
'use strict';

const assert = require('node:assert/strict');
const mock = require('./mock-cloud');
const api = require('../cloudfunctions/api/index');
const core = require('../cloudfunctions/api/lib/core');
const config = require('../cloudfunctions/api/config');

const TODAY = '2026-10-07';      // 周三

function fresh() {
  mock.reset();
  core.setFakeToday(TODAY);
}

// 返回完整的信封 { ok, data | code, message, errors }
async function raw(openid, action, data) {
  mock.as(openid);
  return api.main({ action: action, data: data });
}

// 期望成功，返回 data
async function ok(openid, action, data) {
  const res = await raw(openid, action, data);
  assert.equal(res.ok, true, action + ' 应该成功，却返回：' + JSON.stringify(res));
  return res.data;
}

// 期望失败，返回信封；可以顺便检查错误码和提示里的关键字
async function fail(openid, action, data, code, text) {
  const res = await raw(openid, action, data);
  assert.equal(res.ok, false, action + ' 应该失败，却成功了：' + JSON.stringify(res.data));
  if (code) { assert.equal(res.code, code, JSON.stringify(res)); }
  if (text) { assert.ok(res.errors.join('|').indexOf(text) >= 0, '提示里应该有“' + text + '”，实际：' + res.errors.join('|')); }
  return res;
}

// 建一个团队：管理员 boss，成员 amy、bob（已通过审核）
async function team(prefix) {
  const p = prefix || '';
  const boss = p + 'o-boss';
  const amy = p + 'o-amy';
  const bob = p + 'o-bob';
  const s = await ok(boss, 'team.create', { team_name: p + '东区招生组', my_name: '老板', code: config.TEAM_CREATE_CODE });
  const code = s.team.invite_code;
  await ok(amy, 'team.join', { code: code, my_name: '小艾' });
  await ok(bob, 'team.join', { code: code, my_name: '小博' });
  const list = await ok(boss, 'members.list', {});
  const uid = {};
  for (const m of list.items) {
    if (m.status === 'pending') { await ok(boss, 'members.approve', { uid: m.uid }); }
    uid[m.name] = m.uid;
  }
  const channels = (await ok(boss, 'channels.list', {})).items;
  return { boss: boss, amy: amy, bob: bob, uid: { boss: uid['老板'], amy: uid['小艾'], bob: uid['小博'] }, code: code, channels: channels, ch: channels[0].id };
}

async function product(t, extra) {
  const form = await ok(t.boss, 'products.form', {});
  const values = {};
  form.sections.forEach(function (s) { s.fields.forEach(function (f) { values[f.key] = f.value; }); });
  Object.assign(values, { name: 'C1 周末班', vehicle: 'C1 手动挡', fee: '4,280', school: '示例驾校有限公司' }, extra || {});
  return (await ok(t.boss, 'products.save', { values: values })).id;
}

let seq = 0;
async function customer(t, who, extra) {
  seq++;
  const d = Object.assign({ name: '客户' + seq, channel_id: t.ch, grade: 'B', status: '已问需求', next_follow_on: TODAY, next_action: '发对比清单' }, extra || {});
  return (await ok(who, 'customers.save', d)).id;
}

module.exports = { assert: assert, mock: mock, core: core, config: config, TODAY: TODAY, fresh: fresh, raw: raw, ok: ok, fail: fail, team: team, product: product, customer: customer };
