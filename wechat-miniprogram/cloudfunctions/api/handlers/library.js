// 资料：产品卡、统一话术、获客渠道。所有人都能看，只有管理员能改。
'use strict';

const C = require('../lib/consts');
const core = require('../lib/core');
const store = require('../lib/store');
const ctxlib = require('../lib/ctx');
const view = require('../lib/view');

const handlers = {};

async function nextSort(coll, teamId) {
  const rows = await store.find(coll, { team_id: teamId }, { fields: ['sort'], orderBy: [['sort', 'desc']], limit: 1 });
  return rows.length ? (Number(rows[0].sort) || 0) + 1 : 0;
}

async function own(coll, ctx, id, message) {
  const row = await store.getById(coll, core.id(id));
  if (!row || row.team_id !== ctx.team._id) { throw core.notFound(message); }
  return row;
}

// ------------------------------------------------------------------ 获客渠道
handlers['channels.list'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const archived = core.flag(d.archived);
    const got = await Promise.all([
      ctxlib.refs(ctx),
      store.findAll('jx_customers', ctxlib.custWhere(ctx, false), { fields: ['channel_id', 'status'] }),
    ]);
    const totals = Object.create(null);
    got[1].forEach(function (c) {
      const t = totals[c.channel_id] || (totals[c.channel_id] = { total: 0, enrolled: 0 });
      t.total++;
      if (c.status === '已正式报名') { t.enrolled++; }
    });
    const all = got[0].channelList;
    return {
      items: all.filter(function (ch) { return !!ch.archived === archived; }).map(function (ch) {
        const t = totals[ch._id] || { total: 0, enrolled: 0 };
        return {
          id: ch._id, name: ch.name, code: ch.code || '', kind: ch.kind || '', how: ch.how || '', status: ch.status || '',
          note: ch.note || '', archived: !!ch.archived, total: t.total, enrolled: t.enrolled,
        };
      }),
      archived: archived, archived_count: all.filter(function (ch) { return ch.archived; }).length,
      entry: ctx.team.unified_entry || '', can_edit: ctx.isAdmin,
    };
  },
};

handlers['channels.get'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const out = { ch: null, kinds: C.CHANNEL_KINDS, statuses: C.CHANNEL_STATUS };
    if (d.id) {
      const ch = await own('jx_channels', ctx, d.id, '没找到这个渠道。');
      out.ch = { id: ch._id, name: ch.name, code: ch.code || '', kind: ch.kind || '', how: ch.how || '', status: ch.status || '筹备中', note: ch.note || '', archived: !!ch.archived };
    }
    return out;
  },
};

handlers['channels.save'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const ch = d.id ? await own('jx_channels', ctx, d.id, '没找到这个渠道。') : null;
    const errors = [];
    const v = {
      name: core.line(d.name, 40), code: core.line(d.code, 8).toUpperCase(), kind: core.choice(d.kind, C.CHANNEL_KINDS),
      how: core.text(d.how, 600), status: core.choice(d.status, C.CHANNEL_STATUS, '筹备中'), note: core.text(d.note, 600),
    };
    if (!v.name) { errors.push('请填渠道名称。'); }
    else if (v.name.length > 20) { errors.push('渠道名称最多 20 个字。'); }
    else {
      const same = await store.findOne('jx_channels', { team_id: ctx.team._id, name: v.name });
      if (same && (!ch || same._id !== ch._id)) { errors.push('已经有同名的渠道了。'); }
    }
    if (errors.length) { throw core.invalid(errors); }
    if (ch) {
      await store.updateById('jx_channels', ch._id, v);
    } else {
      v.team_id = ctx.team._id;
      v.archived = false;
      v.sort = await nextSort('jx_channels', ctx.team._id);
      await store.insert('jx_channels', v);
    }
    return { message: '渠道已保存。' };
  },
};

handlers['channels.archive'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const ch = await own('jx_channels', ctx, d.id, '没找到这个渠道。');
    await store.updateById('jx_channels', ch._id, { archived: !ch.archived });
    return {
      archived: !ch.archived,
      message: ch.archived ? '已恢复渠道“' + ch.name + '”。' : '已停用渠道“' + ch.name + '”。已登记的客户不受影响，新登记时不再出现。',
    };
  },
};

// ------------------------------------------------------------------ 产品卡
handlers['products.list'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const archived = core.flag(d.archived);
    const got = await Promise.all([
      ctxlib.refs(ctx),
      store.findAll('jx_customers', ctxlib.custWhere(ctx, false), { fields: ['product_id'] }),
    ]);
    const counts = Object.create(null);
    got[1].forEach(function (c) { if (c.product_id) { counts[c.product_id] = (counts[c.product_id] || 0) + 1; } });
    const all = got[0].productList;
    return {
      items: all.filter(function (p) { return !!p.archived === archived; }).map(function (p) {
        return {
          id: p._id, name: p.name || '未命名', vehicle: p.vehicle || '', school: p.school || '', fee_text: view.feeText(p),
          pending: view.pendingCount(p), customers: counts[p._id] || 0, archived: !!p.archived,
          verified: p.verified_on ? core.fmtDate(p.verified_on) + ' 核验' : '还没核验',
        };
      }),
      archived: archived, archived_count: all.filter(function (p) { return p.archived; }).length, can_edit: ctx.isAdmin,
    };
  },
};

handlers['products.get'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const p = await own('jx_products', ctx, d.id, '没找到这个班型。');
    return {
      p: {
        id: p._id, name: p.name || '未命名', vehicle: p.vehicle || '车型待补充', school: p.school || C.PENDING,
        who: p.who || '待补充', archived: !!p.archived, verified_on: p.verified_on || '',
        verified: p.verified_on ? core.fmtDate(p.verified_on) : '待核验', verifier: p.verifier || '', basis: p.basis || '',
      },
      card: C.CARD_LAYOUT.map(function (sec) {
        return {
          title: sec.title,
          rows: sec.rows.map(function (row) {
            const value = view.cardValue(p, row.keys, row.fallback);
            return { label: row.label, value: value, pending: value === row.fallback || view.isPending(value) };
          }),
        };
      }),
      text: view.cardText(p), pending: view.pendingCount(p), no_promise: C.NO_PROMISE, how_to_enroll: C.HOW_TO_ENROLL,
      can_edit: ctx.isAdmin,
    };
  },
};

handlers['products.form'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const p = d.id ? await own('jx_products', ctx, d.id, '没找到这个班型。') : null;
    return {
      id: p ? p._id : '', is_new: !p, title: p ? '编辑 ' + (p.name || '班型') : '新增班型', vehicles: C.VEHICLE_OPTIONS,
      pending_text: C.PENDING, today: core.today(),
      sections: C.PRODUCT_SECTIONS.map(function (sec) {
        return {
          title: sec.title,
          fields: sec.fields.map(function (f) {
            return {
              key: f.key, label: f.label, example: f.example || '', hint: f.hint || '', kind: f.kind,
              value: p ? (p[f.key] || '') : (f.def || ''),
            };
          }),
        };
      }),
    };
  },
};

handlers['products.save'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const p = d.id ? await own('jx_products', ctx, d.id, '没找到这个班型。') : null;
    const src = d.values && typeof d.values === 'object' ? d.values : {};
    const errors = [];
    const v = {};
    C.PRODUCT_FIELDS.forEach(function (f) {
      if (f.kind === 'date') {
        try { v[f.key] = core.parseDate(src[f.key]); } catch (e) { errors.push(f.label + '的日期格式不对。'); v[f.key] = ''; }
      } else if (f.kind === 'long') {
        v[f.key] = core.text(src[f.key], 1000);
      } else {
        v[f.key] = core.line(src[f.key], 200);
      }
    });
    if (!v.name) { errors.push('请填班型名称。'); }
    if (v.verified_on && v.verified_on > core.today()) { errors.push('核验日期不能晚于今天。'); }
    const fee = v.fee.replace(/[,，元]/g, '').trim();
    if (core.isNumber(fee)) { v.fee = fee; }
    if (errors.length) { throw core.invalid(errors); }
    const now = core.nowStr();
    v.updated_at = now;
    let id = p ? p._id : '';
    if (p) {
      await store.updateById('jx_products', id, v);
    } else {
      v.team_id = ctx.team._id;
      v.archived = false;
      v.created_at = now;
      v.sort = await nextSort('jx_products', ctx.team._id);
      id = await store.insert('jx_products', v);
    }
    const left = view.pendingCount(v);
    return { id: id, pending: left, message: '产品卡已保存。' + (left ? '还有 ' + left + ' 项没核实。' : '所有项目都已填写。') };
  },
};

handlers['products.archive'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const p = await own('jx_products', ctx, d.id, '没找到这个班型。');
    await store.updateById('jx_products', p._id, { archived: !p.archived });
    return { archived: !p.archived, message: p.archived ? '已恢复这个班型。' : '已停用这个班型。已经匹配它的客户和学员不受影响。' };
  },
};

// ------------------------------------------------------------------ 统一话术
handlers['scripts.list'] = {
  level: 'member',
  fn: async function (ctx, d) {
    const got = await Promise.all([
      ctxlib.refs(ctx),
      store.findAll('jx_scripts', { team_id: ctx.team._id }, { orderBy: [['sort', 'asc']] }),
    ]);
    const products = got[0].productList.filter(function (p) { return !p.archived; });
    const pid = core.id(d.product_id);
    let product = null;
    products.forEach(function (p) { if (p._id === pid) { product = p; } });
    const names = C.SCRIPT_GROUPS.slice();
    got[1].forEach(function (s) { if (names.indexOf(s.grp) < 0) { names.push(s.grp); } });
    const groups = [];
    names.forEach(function (name) {
      const items = got[1].filter(function (s) { return s.grp === name; }).map(function (s) {
        return { id: s._id, scene: s.scene, when_use: s.when_use || '', body: view.fillScript(s.body, product), tips: s.tips || '' };
      });
      if (items.length) { groups.push({ name: name, items: items }); }
    });
    return {
      groups: groups, product_id: product ? product._id : '',
      products: products.map(function (p) { return { id: p._id, name: p.name || '未命名' }; }),
      order: C.SALES_ORDER, forbidden: C.FORBIDDEN, can_edit: ctx.isAdmin,
    };
  },
};

handlers['scripts.get'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const out = { s: null, groups: C.SCRIPT_GROUPS, tokens: Object.keys(C.SCRIPT_TOKENS) };
    if (d.id) {
      const s = await own('jx_scripts', ctx, d.id, '没找到这条话术。');
      out.s = { id: s._id, grp: s.grp, scene: s.scene, when_use: s.when_use || '', body: s.body || '', tips: s.tips || '' };
    }
    return out;
  },
};

handlers['scripts.save'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const s = d.id ? await own('jx_scripts', ctx, d.id, '没找到这条话术。') : null;
    const errors = [];
    const v = {
      grp: core.line(d.grp, 20), scene: core.line(d.scene, 40), when_use: core.line(d.when_use, 120),
      body: core.text(d.body, 3000), tips: core.text(d.tips, 1000), updated_at: core.nowStr(), updated_by: ctx.uid,
    };
    if (!v.grp) { errors.push('请选分组。'); }
    if (!v.scene) { errors.push('请写场景名称。'); }
    if (!v.body) { errors.push('请写话术内容。'); }
    if (errors.length) { throw core.invalid(errors); }
    if (s) {
      await store.updateById('jx_scripts', s._id, v);
    } else {
      v.team_id = ctx.team._id;
      v.sort = await nextSort('jx_scripts', ctx.team._id);
      await store.insert('jx_scripts', v);
    }
    return { message: '话术已保存。全团队看到的是同一份。' };
  },
};

handlers['scripts.remove'] = {
  level: 'admin',
  fn: async function (ctx, d) {
    const s = await own('jx_scripts', ctx, d.id, '没找到这条话术。');
    await store.removeById('jx_scripts', s._id);
    return { message: '已删除这条话术。' };
  },
};

module.exports = { handlers: handlers, own: own };
