// A version check and short exclusive lock surround only active project commits.
// Configuration files, backups and document serialization keep their existing paths.
export const createProjectFileGuard = ({fs, path, hash, save, message}) => {
  const versions = new Map();
  const keyOf = file => {const full = path.resolve(file.endsWith('.json') ? file : `${file}.json`);return fs.existsSync(full) ? fs.realpathSync(full) : full;};
  const digest = data => hash(JSON.stringify(typeof data === 'string' ? JSON.parse(data.replace(/^\uFEFF/, '')) : data));
  const track = (file, data) => {versions.set(keyOf(file), digest(data));};
  const commit = async (file, data, closeSpace) => {
    const key = keyOf(file);const lock = `${key}.pdmaner-write-lock`;let handle;
    const acquire = () => fs.promises.open(lock, 'wx');
    try {
      try {handle = await acquire();} catch (err) {
        if (err.code !== 'EEXIST') throw err;
        // Only a proven dead process's own lock may be removed automatically.
        let stale = false;
        try {const owner = JSON.parse(await fs.promises.readFile(lock, 'utf8'));if (Number.isInteger(owner.pid) && owner.pid > 0) {try {process.kill(owner.pid, 0);} catch (signalError) {stale = signalError.code === 'ESRCH';}}} catch (readError) { /* A live or unrecognizable lock remains protected. */ }
        if (!stale) throw new Error(message('projectBusy'));
        await fs.promises.unlink(lock);handle = await acquire();
      }
      await handle.writeFile(JSON.stringify({pid: process.pid, createdAt: Date.now()}));
      const expected = versions.get(key);
      if (expected) {
        const current = JSON.parse((await fs.promises.readFile(key, 'utf8')).replace(/^\uFEFF/, ''));
        if (digest(current) !== expected) throw new Error(message('projectConflict'));
      }
      await save(key, data, closeSpace);versions.set(key, digest(data));
    } finally {
      if (handle) {await handle.close();await fs.promises.unlink(lock);}
    }
  };
  return {track, commit};
};
