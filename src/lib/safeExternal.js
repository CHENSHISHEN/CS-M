// 外部链接打开的统一白名单(ARCH-06)
// 渲染进程开启了 nodeIntegration,shell.openExternal 若打开 file:// / smb:// / 自定义协议,
// 可能成为代码执行入口。所有 openExternal 调用必须经过这里,仅放行 http / https / mailto。

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:'];

// 判断 URL 是否允许交给系统打开。不 trim 输入:带前导空白的 URL 视为不安全。
export function isSafeExternalUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }
  // new URL 会自动剥离首尾空白,这里显式拒绝,避免与系统实际打开的字符串不一致
  if (url !== url.trim()) {
    return false;
  }
  try {
    // URL.protocol 已被规范化为小写
    return SAFE_PROTOCOLS.includes(new URL(url).protocol);
  } catch (e) {
    return false;
  }
}

// 默认 opener:惰性 require electron,使本模块可被纯 node 测试导入
function defaultOpener(url) {
  // eslint-disable-next-line global-require,import/no-extraneous-dependencies
  return require('electron').shell.openExternal(url);
}

// 安全地用系统默认程序打开外部链接。
// 不安全 URL 不会触碰 electron,直接返回 false;打开失败同样返回 false,不抛出。
// 第二个参数 opener 仅供测试注入,业务代码只需调用 safeOpenExternal(url)。
export async function safeOpenExternal(url, opener = defaultOpener) {
  if (!isSafeExternalUrl(url)) {
    return false;
  }
  try {
    await opener(url);
    return true;
  } catch (e) {
    return false;
  }
}
