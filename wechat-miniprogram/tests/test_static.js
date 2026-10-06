// 不运行、只读文件的检查：页面登记全不全、WXML 里用到的东西存不存在、有没有用到云函数没有的动作。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
require('./helper');
const { ROOT, APP_JSON, loadPage, wxml } = require('./mp/runtime');
const router = require('../cloudfunctions/api/lib/router');

const PROJECT = path.resolve(ROOT, '..');
function files(dir, ext) {
  let out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') { out = out.concat(files(p, ext)); } } else if (!ext || p.endsWith(ext)) { out.push(p); }
  });
  return out;
}
const rel = (p) => path.relative(PROJECT, p);
const ALLOWED_TAGS = ['view', 'text', 'input', 'textarea', 'picker', 'scroll-view', 'block', 'include'];

test('app.json 里登记的页面，文件都齐；pages 目录里没有漏登记的', () => {
  const dirs = fs.readdirSync(path.join(ROOT, 'pages')).map((d) => 'pages/' + d + '/index').sort();
  assert.deepEqual(APP_JSON.pages.slice().sort(), dirs);
  APP_JSON.pages.forEach((p) => {
    ['.js', '.wxml', '.json'].forEach((ext) => assert.ok(fs.existsSync(path.join(ROOT, p + ext)), p + ext));
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, p + '.json'), 'utf8'));
    assert.ok(json.navigationBarTitleText, p + ' 没有标题');
  });
  assert.equal(APP_JSON.pages[0], 'pages/home/index', '第一个页面是“今日”');
  assert.equal(APP_JSON.cloud, true);
});

test('所有 JSON 文件都能解析；底部页签只用文字（不依赖图标图片）', () => {
  files(PROJECT, '.json').forEach((f) => { assert.doesNotThrow(() => JSON.parse(fs.readFileSync(f, 'utf8')), rel(f)); });
  assert.equal(APP_JSON.tabBar.list.length, 5);
  APP_JSON.tabBar.list.forEach((t) => {
    assert.ok(APP_JSON.pages.indexOf(t.pagePath) >= 0, t.pagePath);
    assert.ok(t.text);
    assert.equal(t.iconPath, undefined);
    assert.equal(t.selectedIconPath, undefined);
  });
});

test('project.config.json 指向正确的目录和 AppID', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(PROJECT, 'project.config.json'), 'utf8'));
  assert.equal(cfg.miniprogramRoot, 'miniprogram/');
  assert.equal(cfg.cloudfunctionRoot, 'cloudfunctions/');
  assert.equal(cfg.compileType, 'miniprogram');
  assert.match(cfg.appid, /^wx[0-9a-f]{16}$/);
  assert.ok(fs.existsSync(path.join(PROJECT, 'cloudfunctions/api/package.json')));
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT, 'cloudfunctions/api/package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['wx-server-sdk']);
});

test('WXML：能解析、只用到支持的标签、绑定的处理函数页面里都有', () => {
  APP_JSON.pages.forEach((p) => {
    const file = path.join(ROOT, p + '.wxml');
    const def = loadPage(p);
    wxml.handlersIn(file).forEach((name) => {
      assert.equal(typeof def[name], 'function', p + '.wxml 绑定了 ' + name + '，页面里没有这个函数');
    });
  });
  files(ROOT, '.wxml').forEach((f) => {
    wxml.tagsIn(f).forEach((tag) => { if (tag !== '#root') { assert.ok(ALLOWED_TAGS.indexOf(tag) >= 0, rel(f) + ' 用了 <' + tag + '>'); } });
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/\{\{[^}]*\{\{/.test(src), rel(f) + ' 有嵌套的 {{');
    assert.equal((src.match(/\{\{/g) || []).length, (src.match(/\}\}/g) || []).length, rel(f) + ' 的 {{ }} 不配对');
  });
});

test('本地这套 WXML 检查确实查得出毛病（防止检查本身是摆设）', () => {
  const tmp = path.join(require('os').tmpdir(), 'wxml-check-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  const check = (src, data) => { const f = path.join(tmp, Math.random().toString(36).slice(2) + '.wxml'); fs.writeFileSync(f, src); return wxml.render(f, data || {}); };
  assert.throws(() => check('<view>{{list.join(",")}}</view>', { list: [] }), /不能调用函数/);
  assert.throws(() => check('<view wx:for="{{list}}">x</view>', { list: [1] }), /没有写 wx:key/);
  assert.throws(() => check('<view><text>x</view></text>'), /没有配对/);
  assert.throws(() => check('<view wx:else>x</view>'), /前面没有紧挨着的 wx:if/);
  assert.throws(() => check('<include src="nope.wxml"/>'), /不存在/);
  assert.throws(() => check('<view>{{a ? }}</view>'), /写错了/);
  assert.equal(check('<view>{{c.nmae}}</view>', { c: { name: 'x' } }).problems.length, 1);
  assert.equal(check('<view class="a {{b.c}}">x</view>', {}).problems.length, 1);
  assert.equal(check('<view wx:for="{{l}}" wx:key="id">x</view>', { l: [{ id: 1 }, { id: 1 }] }).problems.length, 1);
  assert.equal(check('<view wx:for="{{l}}" wx:key="id">x</view>', { l: [{}] }).problems.length, 1);
  assert.equal(check('<view>{{a || "空"}} {{n + 1}} {{l[0].x}} {{o[k + "_y"]}}</view>', { n: 1, l: [{ x: 'p' }], o: { z_y: 'q' }, k: 'z' }).problems.length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('WXSS：括号配对，没有小程序不支持的通配选择器', () => {
  files(ROOT, '.wxss').forEach((f) => {
    const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, rel(f));
    assert.ok(!/(^|[\s,}])\*\s*[{,]/.test(css), rel(f) + ' 用了 * 选择器');
    assert.ok(!/@import\s+url|https?:\/\//.test(css), rel(f) + ' 引用了外部地址');
  });
});

test('小程序端调用的动作，云函数里都有；跳转去的页面都登记过', () => {
  const actions = router.actions();
  const used = new Set();
  const js = files(ROOT, '.js');
  js.forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    const re = /\b(?:call|load|submit|act)\(\s*'([a-z_]+\.[a-z_]+)'/g;
    let m;
    while ((m = re.exec(src))) { used.add(m[1]); assert.ok(actions.indexOf(m[1]) >= 0, rel(f) + ' 调用了不存在的动作 ' + m[1]); }
  });
  const unused = actions.filter((a) => !used.has(a));
  assert.deepEqual(unused, [], '云函数里有小程序端用不到的动作');
  files(ROOT).filter((f) => /\.(js|wxml)$/.test(f)).forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    const re = /\/pages\/[a-z-]+\/index/g;
    let m;
    while ((m = re.exec(src))) { assert.ok(APP_JSON.pages.indexOf(m[0].slice(1)) >= 0, rel(f) + ' 里的 ' + m[0] + ' 没有登记'); }
  });
  const hinted = fs.readFileSync(path.join(PROJECT, 'cloudfunctions/api/handlers/overview.js'), 'utf8').match(/\/pages\/[a-z-]+\/index/g);
  hinted.forEach((u) => assert.ok(APP_JSON.pages.indexOf(u.slice(1)) >= 0, '云函数提示里的 ' + u + ' 没有登记'));
});

test('云函数的代码不用新语法（云端的 Node 版本可能比较老），也不直接碰数据库 SDK', () => {
  const dir = path.join(PROJECT, 'cloudfunctions/api');
  files(dir, '.js').forEach((f) => {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
    [[/\?\./, '?.'], [/\?\?/, '??'], [/\.replaceAll\(/, 'replaceAll'], [/\.at\(/, '.at()'], [/\.flat(Map)?\(/, 'flat'], [/Object\.fromEntries/, 'fromEntries'],
      [/Promise\.(allSettled|any)/, 'allSettled'], [/\bstructuredClone\b/, 'structuredClone'], [/#\w+\s*[=(;]/, '私有字段'], [/\.\.\.\w/, '展开语法']].forEach((pair) => {
      assert.ok(!pair[0].test(src), rel(f) + ' 用了 ' + pair[1]);
    });
    if (!/lib[\\/]store\.js$|index\.js$/.test(f)) {
      assert.ok(!/\.collection\(|database\(\)|wx-server-sdk/.test(src), rel(f) + ' 绕过 store.js 直接访问了数据库');
    }
    assert.ok(!/console\.log\(/.test(src), rel(f) + ' 留了调试输出');
  });
  assert.doesNotThrow(() => require('child_process').execFileSync(process.execPath, ['--check', path.join(dir, 'index.js')]));
});

test('界面文字和提示里没有承诺性的说法，红线原样保留', () => {
  const text = files(ROOT).filter((f) => /\.(wxml|js)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(!/保证(通过|拿证)|一定(能)?过|全(市|城|网)最低|\d+\s*天(内)?(包)?拿证/.test(text));
  const C = require('../cloudfunctions/api/lib/consts');
  assert.equal(C.RED_LINES.length, 5);
  assert.match(C.RED_LINES[0], /不承诺包过、免考、最低价、固定拿证天数/);
  assert.match(C.RED_LINES[3], /个人信息只收业务必要的/);
  const fields = JSON.stringify(C.PRODUCT_SECTIONS) + fs.readFileSync(path.join(ROOT, 'pages/customer-edit/index.wxml'), 'utf8');
  assert.ok(!/data-k="(id_?card|id_?number|idno)"/.test(fields), '表单里没有身份证号这一栏');
});
