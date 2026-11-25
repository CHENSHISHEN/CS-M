// 主进程导航守卫测试(终审 R1):will-navigate / window.open 决策纯函数 + 安装逻辑(假 webContents)。
// main.js 中 app.on('web-contents-created') 的两行接线需 Electron,属 [GUI] 验收项。
const assert = require('assert');
const {decideNavigation, decideWindowOpen, installNavigationGuard} = require('../src/lib/navigationGuard');

let count = 0;
function ok(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}

const FILE_PAGE = 'file:///opt/CS-M/resources/app.asar/build/index.html';
const DEV_PAGE = 'http://127.0.0.1:3005/index.html';

// ---- decideNavigation ----
const navTable = [
  ['成品 同一 URL(刷新)', FILE_PAGE, FILE_PAGE, 'allow'],
  ['成品 仅 hash 不同', FILE_PAGE, `${FILE_PAGE}#/home`, 'allow'],
  ['当前带 hash、目标去掉 hash', `${FILE_PAGE}#/a`, FILE_PAGE, 'allow'],
  ['开发态 同一 URL', DEV_PAGE, DEV_PAGE, 'allow'],
  ['开发态 仅 hash 不同', DEV_PAGE, `${DEV_PAGE}#x`, 'allow'],
  // 开发服务器只提供 index.html,热更新走 websocket、live reload 走 location.reload,不需要同源其它路径:
  // 同源但不同 path 不放行,按普通 http 链接交给系统浏览器
  ['开发态 同源不同 path -> 系统浏览器', DEV_PAGE, 'http://127.0.0.1:3005/other.html', 'external'],
  ['开发态 同 path 不同 query -> 不视为同一文档', DEV_PAGE, `${DEV_PAGE}?path=/x`, 'external'],
  ['https 外链 -> 系统浏览器', FILE_PAGE, 'https://evil.com/x', 'external'],
  ['http 外链 -> 系统浏览器', FILE_PAGE, 'http://evil.com/x', 'external'],
  ['mailto -> 系统邮件客户端', FILE_PAGE, 'mailto:a@b.c', 'external'],
  ['file:// 其它文件 -> 拒绝', FILE_PAGE, 'file:///etc/passwd', 'deny'],
  ['file:// 同目录其它页面 -> 拒绝', FILE_PAGE, 'file:///opt/CS-M/resources/app.asar/build/evil.html', 'deny'],
  ['file:// 同文件不同 query -> 拒绝', FILE_PAGE, `${FILE_PAGE}?path=/tmp/x`, 'deny'],
  ['javascript: -> 拒绝', FILE_PAGE, 'javascript:alert(1)', 'deny'],
  ['about:blank -> 拒绝', FILE_PAGE, 'about:blank', 'deny'],
  ['about:blank 当前也是 about:blank -> 拒绝', 'about:blank', 'about:blank', 'deny'],
  ['data: -> 拒绝', FILE_PAGE, 'data:text/html,<script>x</script>', 'deny'],
  ['smb:// -> 拒绝', FILE_PAGE, 'smb://h/s', 'deny'],
  ['自定义协议 -> 拒绝', FILE_PAGE, 'vscode://x', 'deny'],
  ['前导空白 -> 拒绝', FILE_PAGE, ' https://a.b', 'deny'],
  ['畸形 URL -> 拒绝', FILE_PAGE, 'http://[::1', 'deny'],
  ['空串 -> 拒绝', FILE_PAGE, '', 'deny'],
  ['null -> 拒绝', FILE_PAGE, null, 'deny'],
  ['undefined -> 拒绝', FILE_PAGE, undefined, 'deny'],
  ['对象 -> 拒绝', FILE_PAGE, {href: FILE_PAGE}, 'deny'],
  ['当前 URL 畸形时外链仍交系统打开', 'not a url', 'https://a.b', 'external'],
  ['当前 URL 畸形时 file:// 拒绝', undefined, FILE_PAGE, 'deny'],
];
navTable.forEach(([name, current, target, expected]) => {
  ok(`decideNavigation: ${name}`, () => {
    assert.deepStrictEqual(decideNavigation(current, target), {action: expected});
  });
});

// ---- decideWindowOpen ----
const openTable = [
  // 操作历史:window.open(getFilePath(...)) 以 index.html?path=… 新开应用窗口,必须保留
  ['成品 应用自身页面带 query(操作历史)', FILE_PAGE, `${FILE_PAGE}?path=/Users/x/a.chnr.json`, 'allow'],
  ['开发态 应用自身页面带 query', DEV_PAGE, `${DEV_PAGE}?path=/x`, 'allow'],
  ['https 外链(target=_blank) -> 系统浏览器', FILE_PAGE, 'https://evil.com/x', 'external'],
  ['mailto -> 系统打开', FILE_PAGE, 'mailto:a@b.c', 'external'],
  ['开发态 同源不同 path -> 系统浏览器', DEV_PAGE, 'http://127.0.0.1:3005/x.html', 'external'],
  ['开发态 不同端口同 path -> 系统浏览器', DEV_PAGE, 'http://127.0.0.1:9999/index.html', 'external'],
  ['file:// 其它文件 -> 拒绝', FILE_PAGE, 'file:///etc/passwd', 'deny'],
  ['javascript: -> 拒绝', FILE_PAGE, 'javascript:alert(1)', 'deny'],
  ['about:blank -> 拒绝', FILE_PAGE, 'about:blank', 'deny'],
  ['畸形 URL -> 拒绝', FILE_PAGE, '::::', 'deny'],
  ['非字符串 -> 拒绝', FILE_PAGE, 42, 'deny'],
  ['当前 about:blank 时 file:// 拒绝', 'about:blank', FILE_PAGE, 'deny'],
];
openTable.forEach(([name, current, target, expected]) => {
  ok(`decideWindowOpen: ${name}`, () => {
    assert.deepStrictEqual(decideWindowOpen(current, target), {action: expected});
  });
});

// ---- installNavigationGuard(假 webContents) ----
function fakeContents(url, {withHandler = true} = {}) {
  const listeners = {};
  const c = {
    url,
    handler: null,
    getURL() { return this.url; },
    on(name, fn) { listeners[name] = fn; return this; },
    emit(name, ...args) { return listeners[name](...args); },
    listeners,
  };
  if (withHandler) c.setWindowOpenHandler = (fn) => { c.handler = fn; };
  return c;
}
function fakeEvent() {
  return {prevented: false, preventDefault() { this.prevented = true; }};
}

ok('install: will-navigate 同一文档放行,不打开外部', () => {
  const opened = [];
  const c = fakeContents(FILE_PAGE);
  assert.equal(installNavigationGuard(c, {openExternal: u => opened.push(u)}), true);
  const e = fakeEvent();
  c.emit('will-navigate', e, `${FILE_PAGE}#/x`);
  assert.equal(e.prevented, false);
  assert.deepStrictEqual(opened, []);
});
ok('install: will-navigate 外链被阻止并交系统打开', () => {
  const opened = [];
  const c = fakeContents(FILE_PAGE);
  installNavigationGuard(c, {openExternal: u => opened.push(u)});
  const e = fakeEvent();
  c.emit('will-navigate', e, 'https://evil.com/x');
  assert.equal(e.prevented, true);
  assert.deepStrictEqual(opened, ['https://evil.com/x']);
});
ok('install: will-navigate file:// / javascript: 被阻止且不打开', () => {
  const opened = [];
  const c = fakeContents(FILE_PAGE);
  installNavigationGuard(c, {openExternal: u => opened.push(u)});
  ['file:///etc/passwd', 'javascript:alert(1)'].forEach((u) => {
    const e = fakeEvent();
    c.emit('will-navigate', e, u);
    assert.equal(e.prevented, true);
  });
  assert.deepStrictEqual(opened, []);
});
ok('install: setWindowOpenHandler 外链 deny + 系统打开;应用自身页面 allow;其余 deny', () => {
  const opened = [];
  const c = fakeContents(FILE_PAGE);
  installNavigationGuard(c, {openExternal: u => opened.push(u)});
  assert.equal(typeof c.handler, 'function');
  assert.deepStrictEqual(c.handler({url: 'https://evil.com/x'}), {action: 'deny'});
  assert.deepStrictEqual(c.handler({url: `${FILE_PAGE}?path=/a`}), {action: 'allow'});
  assert.deepStrictEqual(c.handler({url: 'file:///etc/passwd'}), {action: 'deny'});
  assert.deepStrictEqual(c.handler({url: 'about:blank'}), {action: 'deny'});
  assert.deepStrictEqual(c.handler(undefined), {action: 'deny'});
  assert.deepStrictEqual(opened, ['https://evil.com/x']);
});
ok('install: 无 setWindowOpenHandler 时回退 new-window 事件', () => {
  const opened = [];
  const c = fakeContents(FILE_PAGE, {withHandler: false});
  installNavigationGuard(c, {openExternal: u => opened.push(u)});
  const e1 = fakeEvent();
  c.emit('new-window', e1, 'https://a.b/');
  assert.equal(e1.prevented, true);
  const e2 = fakeEvent();
  c.emit('new-window', e2, `${FILE_PAGE}?path=/a`);
  assert.equal(e2.prevented, false);
  assert.deepStrictEqual(opened, ['https://a.b/']);
});
ok('install: getURL 抛错时按无当前页面处理(只外链/拒绝)', () => {
  const opened = [];
  const c = fakeContents(FILE_PAGE);
  c.getURL = () => { throw new Error('destroyed'); };
  installNavigationGuard(c, {openExternal: u => opened.push(u)});
  const e = fakeEvent();
  c.emit('will-navigate', e, FILE_PAGE);
  assert.equal(e.prevented, true);
  assert.deepStrictEqual(opened, []);
});
ok('install: 非法 contents 返回 false 不抛错', () => {
  assert.equal(installNavigationGuard(null), false);
  assert.equal(installNavigationGuard({}), false);
});
ok('install: 默认 opener 为 safeOpenExternal(不安全 URL 不会触碰 electron)', () => {
  const c = fakeContents(FILE_PAGE);
  installNavigationGuard(c);
  const e = fakeEvent();
  c.emit('will-navigate', e, 'file:///etc/passwd'); // deny 分支不调用 opener,node 下不会 require electron
  assert.equal(e.prevented, true);
});

// ---- main.js 接线(源码断言;运行时行为为 [GUI] 验收项) ----
ok('main.js 在 web-contents-created 上为所有 webContents 安装导航守卫', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.ok(src.includes("require('./lib/navigationGuard')"));
  assert.ok(/app\.on\('web-contents-created',[^\n]*installNavigationGuard\(contents\)/.test(src));
});
ok('成品构建把 navigationGuard.js / safeExternal.js 复制到 app/build/lib', () => {
  const cfg = require('fs').readFileSync(require('path').join(__dirname, '..', 'config', 'webpack.pro.config.js'), 'utf8');
  assert.ok(cfg.includes("'../src/lib/navigationGuard.js'"));
  assert.ok(cfg.includes("'../src/lib/safeExternal.js'"));
});

console.log(`\n${count} tests passed`);
