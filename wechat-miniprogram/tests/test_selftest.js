'use strict';
const { test, beforeEach } = require('node:test');
const h = require('./helper');
const assert = h.assert;

beforeEach(h.fresh);

async function runAll(t) {
  const out = [];
  let step = 0;
  let run = '';
  while (step >= 0) {
    const res = await h.ok(t.boss, 'selftest.run', { step: step, run: run });
    out.push(res);
    run = res.run;
    step = res.next;
    assert.ok(out.length <= 10);
  }
  return out;
}

test('自检在假数据库上全部通过，并且不留下任何临时数据、不碰业务数据', async () => {
  const t = await h.team();
  await h.customer(t, t.amy);
  const snapshot = () => JSON.stringify(['jx_teams', 'jx_members', 'jx_customers', 'jx_followups', 'jx_channels', 'jx_scripts', 'jx_products', 'jx_students', 'jx_issues', 'jx_daily'].map((c) => h.mock.rows(c)));
  const before = snapshot();
  const steps = await runAll(t);
  assert.equal(steps.length, 9);
  for (const s of steps) {
    assert.equal(s.ok, true, s.name + '：' + JSON.stringify(s.lines.filter((l) => !l.ok)));
    assert.ok(s.lines.length >= 1);
  }
  assert.ok(steps.reduce((n, s) => n + s.lines.length, 0) >= 50);
  assert.equal(snapshot(), before);
});

test('自检中途失败会直接跳到清理；上次没清掉的临时团队也会被清走', async () => {
  const t = await h.team();
  const first = await h.ok(t.boss, 'selftest.run', { step: 0 });
  await h.ok(t.boss, 'selftest.run', { step: 1, run: first.run });
  await h.ok(t.boss, 'selftest.run', { step: 2, run: first.run });
  assert.ok(h.mock.rows('jx_teams').some((x) => x.selftest));
  // 模拟这次自检就此中断；过一阵重新跑一遍
  const steps = await runAll(t);
  assert.ok(steps.every((s) => s.ok));
  assert.ok(!h.mock.rows('jx_teams').some((x) => x.selftest));
  assert.equal(h.mock.rows('jx_customers').length, 0);
  assert.equal(h.mock.rows('jx_members').length, 3);
  // 跳过前面的步骤直接跑后面的会失败，下一步应当是清理
  const s0 = await h.ok(t.boss, 'selftest.run', { step: 0 });
  const bad = await h.ok(t.boss, 'selftest.run', { step: 4, run: s0.run });
  assert.equal(bad.ok, false);
  assert.equal(bad.next, 8);
  await h.fail(t.boss, 'selftest.run', { step: 2, run: 'not-a-run' }, 'INVALID');
});
