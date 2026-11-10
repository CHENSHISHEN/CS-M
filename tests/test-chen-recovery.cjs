// CS-M damaged drawing journal recovery & repair tests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const { DrawingPersistence, hash } = require(path.join(root, 'public/drawing-persistence'));
const schema = require(path.join(root, 'public/drawing-document'));

let failures = 0, checks = 0;
const check = (condition, message) => {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${message}`);
  } else {
    console.log(`PASS ${message}`);
  }
};
const throwsCode = async (promise, code, message) => {
  try {
    await promise;
    check(false, `${message} (expected ${code}, no throw)`);
  } catch (e) {
    check(e.message.includes(code) || e.code === code, `${message} → ${e.message}`);
  }
};
const doc = (name) => {
  const d = schema.newChen(name);
  if (schema.errors(d).length) throw Error('selftest fixture invalid');
  return d;
};
const deltaOf = (drawings) => ({ upsert: drawings, remove: [], order: drawings.map(d => d.id), baseRevisions: {} });

(async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cs-m-repair-'));
  const owner = 'owner-1';
  const frame = { version: '0.4.0', name: '合成项目', profile: { author: 'selftest' }, drawings: [] };
  const d0 = doc('图0'), d1 = doc('图1'), d2 = doc('图2'), d3 = doc('图3');
  frame.drawings = [d0];
  const projectFile = path.join(tempDir, 'synthetic.pdma.json');
  await fs.promises.writeFile(projectFile, JSON.stringify(frame, null, 2));
  const key = fs.realpathSync(projectFile);
  const sessionDir = path.join(tempDir, hash(key));
  const journalFile = path.join(sessionDir, 'commands.log');

  const store = () => new DrawingPersistence(tempDir, { delay: 1e9, maxDelay: 1e9 });

  // 1. healthy save -> reopen
  const s1 = store();
  await s1.open(projectFile, frame, owner);
  await s1.command(projectFile, { commandId: 'c1', delta: deltaOf([d0, d1]) }, owner);
  await s1.flush(projectFile, owner);
  check((await s1.recovery(projectFile, owner)).drawings.length === 2, 'healthy flush keeps 2 drawings');
  const diskAfterFlush = JSON.parse(await fs.promises.readFile(projectFile, 'utf8'));
  check(diskAfterFlush.drawings.length === 2, 'project file on disk has 2 drawings');

  // 2. inject a bad journal record
  await s1.command(projectFile, { commandId: 'c2-pending', delta: deltaOf([d0, d1, d2]) }, owner);
  await fs.promises.appendFile(journalFile, 'this-is-not-a-valid-record\n');
  const damagedBytes = await fs.promises.readFile(journalFile);
  const s2 = store();
  const damaged = await s2.open(projectFile, diskAfterFlush, owner);
  check(damaged.status === 'damaged' && damaged.recovered, 'open with bad record -> status damaged');
  await throwsCode(s2.command(projectFile, { commandId: 'c3', delta: deltaOf([d0, d1, d2]) }, owner), 'DAMAGED_JOURNAL', 'command while damaged');
  await throwsCode(s2.flush(projectFile, owner), 'DAMAGED_JOURNAL', 'flush while damaged');

  // 3. repair: evidence backup + rebuilt journal
  const snapshot = { ...frame, drawings: [d0, d1, d2] };
  const repaired = await s2.repair(projectFile, snapshot, owner);
  check(repaired.status === 'saved', `repair status saved (got ${repaired.status})`);
  check(repaired.drawings.length === 3, 'repair seals the full 3-drawing snapshot');
  const backups = (await fs.promises.readdir(sessionDir)).filter(n => n.startsWith('repair-backup-'));
  check(backups.length === 1, 'one evidence backup folder kept');
  const backupDir = path.join(sessionDir, backups[0]);
  const backedJournal = await fs.promises.readFile(path.join(backupDir, 'commands.log'));
  check(backedJournal.equals(damagedBytes), 'backup keeps the original damaged bytes untouched');
  check(fs.existsSync(path.join(backupDir, 'anchor.json')), 'backup keeps the original anchor');
  const currentRecovery = JSON.parse(await fs.promises.readFile(path.join(backupDir, 'current-recovery.pdma.json'), 'utf8'));
  check(currentRecovery.drawings.length === 3 && currentRecovery.name === '合成项目', 'backup seals the complete current draft');

  // 4. reopen after repair is healthy
  const s3 = store();
  const reopened = await s3.open(projectFile, JSON.parse(await fs.promises.readFile(projectFile, 'utf8')), owner);
  check(reopened.status === 'saved' && reopened.drawings.length === 3, 'reopen after repair is saved');
  await s3.command(projectFile, { commandId: 'c4', delta: deltaOf([d0, d1, d2, d3]) }, owner);
  await s3.flush(projectFile, owner);
  check((await s3.recovery(projectFile, owner)).drawings.length === 4, 'can continue commands after repair');

  // 5. untitled damaged journal repair
  const uStore = store();
  const uInit = await uStore.open('', frame, owner);
  check(uInit.status === 'local', 'untitled init is local');
  await uStore.command('', { commandId: 'u1', delta: deltaOf([d0, d1]) }, owner);
  const uSessionDir = path.join(tempDir, hash(`untitled:${owner}`));
  const uJournal = path.join(uSessionDir, 'commands.log');
  await fs.promises.appendFile(uJournal, 'corrupt-untitled-line\n');
  const uDamagedStore = store();
  const uDamaged = await uDamagedStore.open('', frame, owner);
  check(uDamaged.status === 'damaged', 'untitled damaged open detected');
  const uRepaired = await uDamagedStore.repair('', { ...frame, drawings: [d0, d1] }, owner);
  check(uRepaired.status === 'local' && uRepaired.drawings.length === 2, 'untitled repair status is local');

  // Clean up
  await fs.promises.rm(tempDir, { recursive: true, force: true });
  console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASS'} (${checks} checks passed)`);
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('selftest crashed:', e);
  process.exit(1);
});
