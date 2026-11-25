/* 工程文件短写锁(`<工程>.pdmaner-write-lock`)。
   主进程绘图引擎 drawing-persistence.js 直接 require;渲染端 src/lib/project_file_guard.js 经 webpack 打包引用。
   两端共用同一份解析/过期/回收规则,避免各自演化。fs 由调用方注入;主进程按原样在 Node 14 上运行,不使用 `??`。

   协议:
   - 获取:open(lock, 'wx') 独占创建,写入 {pid, startTime, host, createdAt},持有期间保留句柄。
   - 过期:isLockStale —— 持有进程已不存在(ESRCH),或内容无法解析/为空且 mtime 超过 60 秒。
     EPERM 表示进程存活(无权发信号);kill 报 ESRCH/EPERM 以外的错误(无法据此判断存活)时,
     与无法解析的锁一样按 mtime 规则判定。新鲜的空锁可能是对方刚 open('wx') 尚未写入的锁,不得回收。
   - 回收:先独占获取 `<lock>.reclaim-mutex`(回收互斥,让回收者串行),在互斥内重新读取锁,
     确认仍是先前判定过期的同一个对象(dev/ino/size/mtime/内容一致)后,
     rename(lock, lock + '.reclaim-' + pid + '-' + random) 搬走再删除。
     rename 之后再核对一次被搬走的对象:若不是判定的那一把(ABA),用 link() 原子放回并返回忙。
   - 释放:只有锁路径仍指向自己创建的 inode 时才删除,绝不删除他人的锁。 */
const STALE_MS = 60000;
const RECLAIM_ROUNDS = 2;
const MAX_PID = 2147483647; // process.kill 只接受 int32 PID,更大的值会抛 ERR_INVALID_ARG_TYPE 而不是 ESRCH

// 统一 PID 解析:JSON 对象的 pid 为 1..2147483647 的整数,或同范围的纯数字字符串;其余一律视为无法解析(走 mtime 规则)。
function parseLockInfo(text) {
  let value;
  try {value = JSON.parse(String(text));} catch (e) {return null;}
  if (!value || typeof value !== 'object') return null;
  let pid = value.pid;
  if (typeof pid === 'string' && /^[0-9]+$/.test(pid)) pid = Number(pid);
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && pid <= MAX_PID ? {pid} : null;
}

// 过期判定:可解析的锁看进程是否存在(ESRCH → 过期,EPERM → 存活);kill 报其他错误(无法按存活判断)
// 与无法解析/为空的锁一样,看 mtime 是否超过阈值。
function isLockStale(info, stat, now) {
  if (info) {
    try {process.kill(info.pid, 0);return false;} catch (e) {
      if (e.code === 'ESRCH') return true;
      if (e.code === 'EPERM') return false;
    }
  }
  return Boolean(stat) && now - stat.mtimeMs > STALE_MS;
}

function lockContent(options) {
  const startTime = typeof process.uptime === 'function' ? Math.round(Date.now() - process.uptime() * 1000) : null;
  let host = options.host;
  if (host == null) {try {host = require('os').hostname();} catch (e) {host = '';}}
  return JSON.stringify({pid: process.pid, startTime, host, createdAt: Date.now()});
}

// 同一文件对象:dev+ino 相同且 size/mtime/类型未变(inode 可能被复用,故不单看 ino;ctime 会因 rename 改变,不参与比较)。
const sameStat = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.mode === b.mode;
const sameLock = (a, b) => sameStat(a.stat, b.stat) && a.text === b.text;
// rename 之后的核对不比较 ino:FAT/exFAT、部分 SMB 没有稳定的文件 ID,改名(中间名总是更长)后 ID 会变。
// 判定是否仍是同一把锁靠 dev/类型/size/mtime/内容:他人新建的锁 pid/createdAt/mtime 必然不同,ABA 照样识别;
// 同一路径上的复核(互斥内、rename 前)仍包含 ino。
const sameLockAfterRename = (moved, judged) => moved.stat.dev === judged.stat.dev && moved.stat.mode === judged.stat.mode
  && moved.stat.size === judged.stat.size && moved.stat.mtimeMs === judged.stat.mtimeMs && moved.text === judged.text;

// 读取锁快照 {stat, text, info};锁已不存在返回 null;读取期间对象发生变化或无法读取返回 {unstable: true}(按忙处理)。
// 只对普通文件读取内容(目录、符号链接、FIFO 等一律视为无法解析,不会跟随链接或阻塞)。
async function inspectLock(fs, file) {
  try {
    const before = await fs.promises.lstat(file);
    const text = before.isFile() ? await fs.promises.readFile(file, 'utf8') : null;
    const stat = await fs.promises.lstat(file);
    if (!sameStat(before, stat)) return {unstable: true};
    return {stat, text, info: text == null ? null : parseLockInfo(text)};
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return {unstable: true};
  }
}

async function discard(fs, file, isDirectory) {
  try {if (isDirectory) await fs.promises.rmdir(file);else await fs.promises.unlink(file);} catch (e) { /* 非空目录等留作证据,不影响已腾出的锁路径 */ }
}

// 把误搬走的锁放回原路径:link 在路径已被重新创建时以 EEXIST 失败,绝不覆盖第三方的新锁。
async function restore(fs, aside, file, isDirectory) {
  try {
    if (isDirectory) {await fs.promises.rename(aside, file);return;}
    try {await fs.promises.link(aside, file);} catch (e) {
      if (e.code === 'EEXIST') return; // 第三方已在空档创建新锁:保留其锁;原持有者释放时按 inode 校验,不会误删
      await fs.promises.rename(aside, file); // 不支持硬链接的文件系统退回 rename
      return;
    }
  } catch (e) {return;} finally {if (!isDirectory) await fs.promises.unlink(aside).catch(() => {});}
}

// 搬走并删除判定过期的那一把锁。返回 'removed'(已腾出路径)、'gone'(已被他人回收)或 'busy'(路径上已不是判定的那一把)。
async function reclaimLock(fs, file, judged) {
  const aside = `${file}.reclaim-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
  try {await fs.promises.rename(file, aside);} catch (e) {
    return e.code === 'ENOENT' ? 'gone' : 'busy'; // 搬不走(权限、被占用等)的锁仍按忙处理
  }
  const moved = await inspectLock(fs, aside);
  const isDirectory = Boolean(moved && moved.stat && moved.stat.isDirectory());
  if (moved && !moved.unstable && sameLockAfterRename(moved, judged)) {await discard(fs, aside, isDirectory);return 'removed';}
  await restore(fs, aside, file, isDirectory);
  return 'busy';
}

async function create(fs, file, options) {
  let handle;
  try {handle = await fs.promises.open(file, 'wx');} catch (e) {
    if (e.code === 'EEXIST' || e.code === 'ENOENT') return null; // 落败一律按忙处理,不向上抛原始错误
    throw e;
  }
  const held = {handle, stat: null};
  try {
    held.stat = await handle.stat();
    await handle.writeFile(lockContent(options));
    return held;
  } catch (e) {
    await releaseWriteLock(fs, file, held);throw e;
  }
}

// 在回收互斥内回收:互斥保证同一时刻只有一个回收者,且互斥内确认路径上仍是判定过期的那一把锁。
async function reclaimSerialized(fs, file, judged, options) {
  const mutexFile = `${file}.reclaim-mutex`;
  const mutex = await acquire(fs, mutexFile, options, false);
  if (!mutex) return 'busy';
  try {
    const current = await inspectLock(fs, file);
    if (!current) return 'gone';
    if (current.unstable || !sameLock(current, judged)) return 'busy';
    return await reclaimLock(fs, file, judged);
  } finally {await releaseWriteLock(fs, mutexFile, mutex);}
}

async function acquire(fs, file, options, serialize) {
  for (let round = 0; ; round += 1) {
    const held = await create(fs, file, options);
    if (held) return held;
    if (round >= RECLAIM_ROUNDS) return null; // 回收后仍抢不到(或已被他人回收两次):按忙处理
    const judged = await inspectLock(fs, file);
    if (!judged) continue; // 锁刚被释放或回收,直接重试 open('wx')
    if (judged.unstable || !isLockStale(judged.info, judged.stat, Date.now())) return null;
    if (options.onStale) await options.onStale(file); // 仅供测试构造交错;生产环境不传
    const outcome = serialize ? await reclaimSerialized(fs, file, judged, options) : await reclaimLock(fs, file, judged);
    if (outcome === 'busy') return null;
  }
}

// 获取写锁:成功返回持有凭据,锁被占用(或无法安全回收)返回 null,其余 I/O 错误原样抛出。
// options: {host?: string, onStale?: async (lockPath) => void}
function acquireWriteLock(fs, file, options) {
  return acquire(fs, file, options || {}, true);
}

// 释放写锁:关闭句柄;仅当锁路径仍是自己创建的 inode 时删除。
async function releaseWriteLock(fs, file, held) {
  await held.handle.close().catch(() => {});
  if (!held.stat) return;
  try {
    const current = await fs.promises.lstat(file);
    if (current.dev === held.stat.dev && current.ino === held.stat.ino) await fs.promises.unlink(file);
  } catch (e) { /* 已不存在:无需删除 */ }
}

module.exports = {STALE_MS, parseLockInfo, isLockStale, inspectLock, reclaimLock, acquireWriteLock, releaseWriteLock};
