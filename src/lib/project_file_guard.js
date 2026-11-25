// A version check and short exclusive lock surround only active project commits.
// Configuration files, backups and document serialization keep their existing paths.
// 锁协议(内容、过期判定、原子回收)与主进程绘图引擎共用 public/write-lock.js,两端不各自实现。
import {parseLockInfo, acquireWriteLock, releaseWriteLock} from '../../public/write-lock';

export {parseLockInfo};

// onLockStale:仅供测试构造并发交错的钩子(判定锁过期之后、回收之前调用),生产环境不传。
export const createProjectFileGuard = ({fs, path, hash, save, message, onLockStale}) => {
  const versions = new Map();
  const keyOf = file => {const full = path.resolve(file.endsWith('.json') ? file : `${file}.json`);return fs.existsSync(full) ? fs.realpathSync(full) : full;};
  const digest = data => hash(JSON.stringify(typeof data === 'string' ? JSON.parse(data.replace(/^\uFEFF/, '')) : data));
  const track = (file, data) => {versions.set(keyOf(file), digest(data));};
  const commit = async (file, data, closeSpace) => {
    const key = keyOf(file);const lock = `${key}.pdmaner-write-lock`;let held;
    try {
      // 存活进程的锁、新鲜的空/异常锁一律受保护;只有过期锁会经串行化的 rename 原子回收。
      held = await acquireWriteLock(fs, lock, {onStale: onLockStale});
      if (!held) throw new Error(message('projectBusy'));
      const expected = versions.get(key);
      if (expected) {
        const current = JSON.parse((await fs.promises.readFile(key, 'utf8')).replace(/^\uFEFF/, ''));
        if (digest(current) !== expected) throw new Error(message('projectConflict'));
      }
      await save(key, data, closeSpace);versions.set(key, digest(data));
    } finally {
      if (held) await releaseWriteLock(fs, lock, held);
    }
  };
  return {track, commit};
};
