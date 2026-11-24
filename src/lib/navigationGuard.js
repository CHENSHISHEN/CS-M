// 主进程导航守卫(安全加固,终审 R1):渲染进程开启了 nodeIntegration,清洗后的 Markdown/备注
// 仍有意保留 <a href="https://…">。若用户点击恶意工程文件里的链接,主窗口会被导航到远程页面
// (或 target=_blank 开出子窗口),远程页面即拥有 Node 能力 = 代码执行。这里统一拦截:
// - will-navigate:只允许「当前页面同一文档」(仅 hash 不同,含刷新);其余一律阻止,
//   其中 http/https/mailto 经 safeOpenExternal 交给系统浏览器/邮件客户端打开;
// - window.open / target=_blank:只允许打开应用自身的页面(同协议、同 host、同 pathname,
//   query/hash 可不同,对应「操作历史」以 index.html?path=… 新开窗口);外链同上交给系统打开,其余拒绝。
// 纯 CommonJS:src/main.js(不经 webpack)直接 require;决策函数为纯函数,便于 node 测试。
const {isSafeExternalUrl, safeOpenExternal} = require('./safeExternal');

// 只有这些协议的当前页面才可能是应用自身页面(开发态 http 开发服务器 / 成品 file://)
const APP_PROTOCOLS = ['file:', 'http:', 'https:'];

// 解析 URL;非字符串、带首尾空白或无法解析时返回 null(绝不抛出)
function parseUrl(value) {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  try {
    return new URL(value);
  } catch (e) {
    return null;
  }
}

function withoutHash(u) {
  const copy = new URL(u.href);
  copy.hash = '';
  return copy.href;
}

// 同一文档:协议属于应用页面协议,且除 hash 外完全相同(刷新 / 页内 hash 路由)
function isSameDocument(current, target) {
  return APP_PROTOCOLS.includes(current.protocol) && withoutHash(current) === withoutHash(target);
}

// 应用自身页面:同协议、同 host(file:// 下为空)、同 pathname;query/hash 不限
function isSameAppPage(current, target) {
  return APP_PROTOCOLS.includes(current.protocol)
    && current.protocol === target.protocol
    && current.host === target.host
    && current.pathname === target.pathname;
}

function externalOrDeny(targetUrl) {
  return {action: isSafeExternalUrl(targetUrl) ? 'external' : 'deny'};
}

/**
 * will-navigate 决策。
 * @returns {{action: 'allow'|'external'|'deny'}}
 *   allow:放行(同一文档);external:阻止并交给系统打开;deny:阻止且不做任何事
 */
function decideNavigation(currentUrl, targetUrl) {
  try {
    const target = parseUrl(targetUrl);
    if (!target) return {action: 'deny'};
    const current = parseUrl(currentUrl);
    if (current && isSameDocument(current, target)) return {action: 'allow'};
    return externalOrDeny(targetUrl);
  } catch (e) {
    return {action: 'deny'};
  }
}

/**
 * window.open / target=_blank 决策(currentUrl 为发起窗口当前 URL)。
 * @returns {{action: 'allow'|'external'|'deny'}}
 */
function decideWindowOpen(currentUrl, targetUrl) {
  try {
    const target = parseUrl(targetUrl);
    if (!target) return {action: 'deny'};
    const current = parseUrl(currentUrl);
    if (current && isSameAppPage(current, target)) return {action: 'allow'};
    return externalOrDeny(targetUrl);
  } catch (e) {
    return {action: 'deny'};
  }
}

function currentUrlOf(contents) {
  try {
    return contents.getURL();
  } catch (e) {
    return '';
  }
}

/**
 * 给一个 webContents 安装守卫(main.js 在 app 'web-contents-created' 时对所有 webContents 调用,
 * 覆盖主窗口与经 window.open 打开的子窗口)。options.openExternal 仅供测试注入。
 */
function installNavigationGuard(contents, options) {
  if (!contents || typeof contents.on !== 'function') return false;
  const openExternal = (options && options.openExternal) || safeOpenExternal;
  contents.on('will-navigate', (event, url) => {
    const decision = decideNavigation(currentUrlOf(contents), url);
    if (decision.action === 'allow') return;
    event.preventDefault();
    if (decision.action === 'external') openExternal(url);
  });
  if (typeof contents.setWindowOpenHandler === 'function') {
    contents.setWindowOpenHandler((details) => {
      const url = details && details.url;
      const decision = decideWindowOpen(currentUrlOf(contents), url);
      if (decision.action === 'allow') return {action: 'allow'};
      if (decision.action === 'external') openExternal(url);
      return {action: 'deny'};
    });
  } else {
    // 旧版 Electron 兜底(13.1.7 已有 setWindowOpenHandler,正常不会走到这里)
    contents.on('new-window', (event, url) => {
      const decision = decideWindowOpen(currentUrlOf(contents), url);
      if (decision.action === 'allow') return;
      event.preventDefault();
      if (decision.action === 'external') openExternal(url);
    });
  }
  return true;
}

module.exports = {decideNavigation, decideWindowOpen, installNavigationGuard};
