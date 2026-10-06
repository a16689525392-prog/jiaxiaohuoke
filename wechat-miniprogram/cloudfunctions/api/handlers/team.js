// 团队和成员：创建团队、凭邀请码加入、管理员审核、改名、停用。
// 一个微信号只属于一个团队；每个团队的数据互相看不到。
'use strict';

const config = require('../config');
const C = require('../lib/consts');
const core = require('../lib/core');
const store = require('../lib/store');
const ctxlib = require('../lib/ctx');

const TEAM_TEXT_KEYS = ['unified_entry', 'reward_desc', 'reward_when', 'reward_valid', 'reward_invalid', 'reward_public'];
const STATUS_LABEL = { active: '在用', pending: '等待审核', disabled: '已停用', left: '已退出' };

async function sessionInfo(ctx) {
  const out = { state: ctx.state, need_code: !!config.TEAM_CREATE_CODE, version: config.VERSION, today: core.today() };
  if (!ctx.member) { return out; }
  out.me = { uid: ctx.uid, name: ctx.member.name, role: ctx.member.role, is_admin: ctx.isAdmin, sees_all: ctx.seesAll };
  out.team = { name: ctx.team.name };
  if (ctx.state !== 'active') { return out; }
  out.team.members_only_own = !!ctx.team.members_only_own;
  out.team.unified_entry = ctx.team.unified_entry || '';
  if (ctx.isAdmin) {
    out.team.invite_code = ctx.team.invite_code;
    out.pending_count = await store.count('jx_members', { team_id: ctx.team._id, status: 'pending' });
  }
  return out;
}

async function insertIgnoringDuplicate(coll, doc) {
  try { await store.insert(coll, doc); } catch (e) { if (!store.isDuplicate(e)) { throw e; } }
}

// 新团队自带的渠道和话术。_id 是固定的，所以重复执行不会多出一份。
async function seed(teamId) {
  const now = core.nowStr();
  const jobs = [];
  C.DEFAULT_CHANNELS.forEach(function (ch, i) {
    jobs.push(insertIgnoringDuplicate('jx_channels', {
      _id: teamId + '_ch' + i, team_id: teamId, name: ch.name, code: ch.code, kind: ch.kind, how: ch.how,
      status: '筹备中', note: '', sort: i, archived: false,
    }));
  });
  C.DEFAULT_SCRIPTS.forEach(function (s, i) {
    jobs.push(insertIgnoringDuplicate('jx_scripts', {
      _id: teamId + '_sc' + i, team_id: teamId, grp: s.grp, scene: s.scene, when_use: s.when_use, body: s.body,
      tips: s.tips, sort: i, updated_at: now, updated_by: '',
    }));
  });
  await Promise.all(jobs);
  await store.updateById('jx_teams', teamId, { seeded: true });
}

function readName(d, errors) {
  const name = core.line(d.my_name, 40);
  if (!name) { errors.push('请填你的称呼，团队里的人靠它认出你。'); }
  else if (name.length > 20) { errors.push('称呼最多 20 个字。'); }
  return name;
}

async function newTeamDoc(name, extra) {
  return Object.assign({
    _id: 't' + core.randomId(8), name: name, invite_code: core.randomCode(8), members_only_own: false,
    unified_entry: '', reward_desc: '', reward_when: '', reward_valid: '', reward_invalid: '', reward_public: '',
    start_date: core.today(), seeded: false, created_at: core.nowStr(),
  }, extra || {});
}

function memberDoc(openid, teamId, name, role, status) {
  const now = core.nowStr();
  return {
    _id: openid, team_id: teamId, uid: 'u' + core.randomId(6), name: name, role: role, status: status,
    created_at: now, joined_at: status === 'active' ? now : '',
  };
}

async function findMember(ctx, uid) {
  const id = core.id(uid);
  const m = id ? await store.findOne('jx_members', { team_id: ctx.team._id, uid: id }) : null;
  if (!m || m.status === 'left') { throw core.notFound('没找到这位成员。'); }
  return m;
}

// 删掉一个团队和它的全部数据，返回删了多少条。
// 顺序是：业务数据 → 团队 → 成员。中途断了也没关系：团队没了以后，剩下的成员下次进来会被当作“还没加入”并清掉。
async function wipe(teamId) {
  let removed = 0;
  const data = store.COLLECTIONS.filter(function (c) { return c !== 'jx_teams' && c !== 'jx_members'; });
  for (let i = 0; i < data.length; i++) { removed += await store.removeWhere(data[i], { team_id: teamId }); }
  removed += await store.removeById('jx_teams', teamId);
  removed += await store.removeWhere('jx_members', { team_id: teamId });
  return removed;
}

function activeAdmins(ctx) {
  return store.count('jx_members', { team_id: ctx.team._id, role: 'admin', status: 'active' });
}

const handlers = {};

handlers['session.get'] = {
  level: 'any',
  fn: async function (ctx) {
    if (ctx.isAdmin && !ctx.team.seeded) { await seed(ctx.team._id); }     // 上次创建到一半断了，这里补齐
    return sessionInfo(ctx);
  },
};

handlers['team.create'] = {
  level: 'any',
  fn: async function (ctx, d) {
    if (ctx.member) { throw core.invalid('你已经在团队“' + ctx.team.name + '”里了。一个微信号只能在一个团队里。'); }
    const errors = [];
    const teamName = core.line(d.team_name, 60);
    if (!teamName) { errors.push('请填团队名称，比如“××校区招生组”。'); }
    else if (teamName.length > 30) { errors.push('团队名称最多 30 个字。'); }
    const myName = readName(d, errors);
    if (config.TEAM_CREATE_CODE) {
      const code = core.line(d.code, 40).replace(/\s+/g, '').toUpperCase();
      if (code !== String(config.TEAM_CREATE_CODE).toUpperCase()) {
        errors.push('创建口令不对。口令写在云函数的 config.js 里，由部署这个小程序的人保管。');
      }
    }
    if (errors.length) { throw core.invalid(errors); }
    const team = await newTeamDoc(teamName);
    await store.insert('jx_teams', team);
    try {
      await store.insert('jx_members', memberDoc(ctx.openid, team._id, myName, 'admin', 'active'));
    } catch (e) {
      await store.removeById('jx_teams', team._id);
      if (store.isDuplicate(e)) { throw core.invalid('你已经在一个团队里了。'); }
      throw e;
    }
    await seed(team._id);
    return sessionInfo(await ctxlib.load(ctx.openid));
  },
};

handlers['team.join'] = {
  level: 'any',
  fn: async function (ctx, d) {
    if (ctx.member) { throw core.invalid('你已经在团队“' + ctx.team.name + '”里了。一个微信号只能在一个团队里。'); }
    const errors = [];
    const myName = readName(d, errors);
    const code = core.line(d.code, 40).replace(/\s+/g, '').toUpperCase();
    const team = /^[A-Z0-9]{6,12}$/.test(code) ? await store.findOne('jx_teams', { invite_code: code }) : null;
    if (!team) { errors.push('邀请码不对。请向团队管理员要最新的邀请码。'); }
    if (errors.length) { throw core.invalid(errors); }
    try {
      await store.insert('jx_members', memberDoc(ctx.openid, team._id, myName, 'member', 'pending'));
    } catch (e) {
      if (!store.isDuplicate(e)) { throw e; }
    }
    return sessionInfo(await ctxlib.load(ctx.openid));
  },
};

// 退出团队。等待审核的直接撤回；已经加入过的留一份名字，原来由他负责的记录才显示得出是谁。
handlers['team.leave'] = {
  level: 'any',
  fn: async function (ctx) {
    const m = ctx.member;
    if (!m) { return sessionInfo(ctx); }
    if (m.status !== 'pending') {
      if (m.status === 'active' && m.role === 'admin' && (await activeAdmins(ctx)) <= 1) {
        throw core.invalid('你是团队里唯一的管理员，不能退出。先在“成员”里把另一位成员设为管理员。');
      }
      await insertIgnoringDuplicate('jx_members', {
        _id: 'x_' + m.uid, team_id: m.team_id, uid: m.uid, name: m.name, role: 'member', status: 'left',
        created_at: m.created_at, joined_at: m.joined_at || '', left_at: core.nowStr(),
      });
    }
    await store.removeById('jx_members', ctx.openid);
    return sessionInfo(await ctxlib.load(ctx.openid));
  },
};

handlers['me.rename'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const errors = [];
    const name = readName({ my_name: d.name }, errors);
    if (errors.length) { throw core.invalid(errors); }
    await store.updateById('jx_members', ctx.openid, { name: name });
    return sessionInfo(await ctxlib.load(ctx.openid));
  },
};

handlers['team.get'] = {
  level: 'admin',
  fn: async function (ctx) {
    const t = ctx.team;
    const out = { name: t.name, members_only_own: !!t.members_only_own, start_date: t.start_date || '', invite_code: t.invite_code };
    TEAM_TEXT_KEYS.forEach(function (k) { out[k] = t[k] || ''; });
    out.rules = C.REFERRAL_RULES.map(function (r) { return { key: r.key, label: r.label, example: r.example, value: t[r.key] || '' }; });
    out.red_lines = C.REFERRAL_RED_LINES;
    return out;
  },
};

// 只改传进来的那几项
handlers['team.update'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const errors = [];
    const patch = {};
    if (d.name !== undefined) {
      patch.name = core.line(d.name, 60);
      if (!patch.name) { errors.push('请填团队名称。'); } else if (patch.name.length > 30) { errors.push('团队名称最多 30 个字。'); }
    }
    if (d.members_only_own !== undefined) { patch.members_only_own = core.flag(d.members_only_own); }
    if (d.start_date !== undefined) {
      try { patch.start_date = core.parseDate(d.start_date) || core.today(); } catch (e) { errors.push('开始日期的格式不对。'); }
    }
    TEAM_TEXT_KEYS.forEach(function (k) {
      if (d[k] !== undefined) { patch[k] = k === 'unified_entry' ? core.line(d[k], 80) : core.text(d[k], 300); }
    });
    if (errors.length) { throw core.invalid(errors); }
    if (Object.keys(patch).length) { await store.updateById('jx_teams', ctx.team._id, patch); }
    return sessionInfo(await ctxlib.load(ctx.openid));
  },
};

handlers['team.reset_invite'] = {
  level: 'admin',
  fn: async function (ctx) {
    const code = core.randomCode(8);
    await store.updateById('jx_teams', ctx.team._id, { invite_code: code });
    return { invite_code: code };
  },
};

// 解散团队：要把团队名称原样输入一遍。删掉以后找不回来。
handlers['team.dissolve'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    if (core.line(d.name, 60) !== ctx.team.name) {
      throw core.invalid('团队名称没有对上，没有解散。要解散的话，请原样输入“' + ctx.team.name + '”。');
    }
    await wipe(ctx.team._id);
    return sessionInfo(await ctxlib.load(ctx.openid));
  },
};

handlers['members.list'] = {
  level: 'admin',
  fn: async function (ctx) {
    const tid = ctx.team._id;
    const got = await Promise.all([
      store.findAll('jx_members', { team_id: tid }),
      store.findAll('jx_customers', { team_id: tid, active: true }, { fields: ['owner_id'] }),
      store.findAll('jx_students', { team_id: tid, active: true }, { fields: ['owner_id'] }),
    ]);
    const customers = Object.create(null);
    const students = Object.create(null);
    got[1].forEach(function (c) { customers[c.owner_id] = (customers[c.owner_id] || 0) + 1; });
    got[2].forEach(function (s) { students[s.owner_id] = (students[s.owner_id] || 0) + 1; });
    const order = { pending: 0, active: 1, disabled: 2, left: 3 };
    const items = got[0].map(function (m) {
      return {
        uid: m.uid, name: m.name, role: m.role, role_label: m.role === 'admin' ? '管理员' : '成员', status: m.status,
        status_label: STATUS_LABEL[m.status] || m.status, is_me: m.uid === ctx.uid,
        joined: core.fmtDate(String(m.joined_at || m.created_at || '').slice(0, 10)),
        customers: customers[m.uid] || 0, students: students[m.uid] || 0,
      };
    });
    items.sort(function (a, b) {
      return (order[a.status] - order[b.status]) || (a.role === b.role ? 0 : (a.role === 'admin' ? -1 : 1)) || a.name.localeCompare(b.name);
    });
    return { items: items, invite_code: ctx.team.invite_code, members_only_own: !!ctx.team.members_only_own, team_name: ctx.team.name };
  },
};

handlers['members.approve'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const m = await findMember(ctx, d.uid);
    if (m.status !== 'pending') { throw core.invalid('这位成员不在等待审核的名单里。'); }
    await store.updateById('jx_members', m._id, { status: 'active', joined_at: core.nowStr() });
    return { message: '已通过，' + m.name + ' 现在可以使用了。' };
  },
};

handlers['members.reject'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const m = await findMember(ctx, d.uid);
    if (m.status !== 'pending') { throw core.invalid('这位成员已经加入了。不想让他继续使用，请改成“停用”。'); }
    await store.removeById('jx_members', m._id);
    return { message: '已拒绝 ' + m.name + ' 的加入申请。' };
  },
};

// 改称呼、角色，或者停用 / 恢复。团队里至少要留一位在用的管理员。
handlers['members.update'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const m = await findMember(ctx, d.uid);
    if (m.status === 'pending') { throw core.invalid('这位成员还在等待审核，先通过或拒绝。'); }
    const errors = [];
    const patch = {};
    if (d.name !== undefined) {
      patch.name = readName({ my_name: d.name }, errors);
    }
    if (d.role !== undefined) { patch.role = core.choice(d.role, ['admin', 'member'], m.role); }
    if (d.status !== undefined) { patch.status = core.choice(d.status, ['active', 'disabled'], m.status); }
    if (errors.length) { throw core.invalid(errors); }
    const role = patch.role || m.role;
    const status = patch.status || m.status;
    const wasAdmin = m.role === 'admin' && m.status === 'active';
    const staysAdmin = role === 'admin' && status === 'active';
    if (m.uid === ctx.uid && status !== 'active') { throw core.invalid('不能停用自己。'); }
    if (wasAdmin && !staysAdmin && (await activeAdmins(ctx)) <= 1) {
      throw core.invalid('团队里至少要有一位在用的管理员。先把另一位成员设为管理员。');
    }
    await store.updateById('jx_members', m._id, patch);
    let message = '已保存。';
    if (status !== m.status) {
      message = status === 'disabled' ? '已停用 ' + m.name + '。他负责的客户和学员还在他名下，记得改给别人。' : '已恢复 ' + m.name + '。';
    }
    return { message: message };
  },
};

module.exports = { handlers: handlers, sessionInfo: sessionInfo, seed: seed, newTeamDoc: newTeamDoc, memberDoc: memberDoc, wipe: wipe };
