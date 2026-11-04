const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const crypto = require('crypto');
const babel = require('@babel/core');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
function load(file) {
  const p = path.resolve(file);
  const m = {exports: {}};
  const code = babel.transformSync(fs.readFileSync(p, 'utf8'), {
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-env', {targets: {node: 'current'}}]],
    plugins: ['@babel/plugin-proposal-optional-chaining'],
  }).code;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', {filename: p})(
    s => (s.startsWith('.') ? load(path.resolve(path.dirname(p), s.endsWith('.js') ? s : s + '.js')) : require(s)),
    m,
    m.exports
  );
  return m.exports;
}

const {createProjectFileGuard} = load(path.join(root, 'src/lib/project_file_guard.js'));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-guard-'));
  const file = path.join(dir, 'test.pdma.json');
  const original = {version: '0.3.0', drawings: [{id: 'one'}]};
  fs.writeFileSync(file, JSON.stringify(original));

  const options = {
    fs,
    path,
    hash: v => crypto.createHash('sha256').update(v).digest('hex'),
    save: async (f, d) => {
      const tmp = f + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(d));
      await fs.promises.rename(tmp, f);
    },
    message: k => k,
  };

  const a = createProjectFileGuard(options);
  const b = createProjectFileGuard(options);
  a.track(file, original);
  b.track(file, original);

  const next = {...original, name: 'first writer'};
  await a.commit(file, next);
  await assert.rejects(b.commit(file, {...original, name: 'stale writer'}), /projectConflict/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), next);
  assert(!fs.existsSync(file + '.pdmaner-write-lock'));
  console.log('PASS stale window cannot overwrite and draft payload unchanged');

  fs.writeFileSync(file + '.pdmaner-write-lock', JSON.stringify({pid: process.pid}));
  await assert.rejects(a.commit(file, next), /projectBusy/);
  assert(fs.existsSync(file + '.pdmaner-write-lock'));
  fs.unlinkSync(file + '.pdmaner-write-lock');
  console.log('PASS concurrent live writer is protected');

  const fail = createProjectFileGuard({
    ...options,
    save: async () => {
      throw new Error('simulated disk failure');
    },
  });
  fail.track(file, next);
  await assert.rejects(fail.commit(file, {...next, name: 'lost'}), /disk failure/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), next);
  assert(!fs.existsSync(file + '.pdmaner-write-lock'));
  console.log('PASS failed commit retains file and releases own lock');

  const link = path.join(dir, 'alias.pdma.json');
  fs.symlinkSync(file, link);
  const c = createProjectFileGuard(options);
  c.track(link, next);
  await c.commit(link, {...next, name: 'through alias'});
  assert(fs.lstatSync(link).isSymbolicLink());
  assert.equal(JSON.parse(fs.readFileSync(file)).name, 'through alias');
  console.log('PASS symlink aliases resolve to one guarded target');

  fs.rmSync(dir, {recursive: true});
  console.log('All 4 project file guard checks passed.');
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
