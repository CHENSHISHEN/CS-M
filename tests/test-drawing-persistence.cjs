// 绘图持久化回归场景:把评测(DRW-02/10/11/13)的复现脚本沉淀为测试。
// 尚未修复的缺陷用 knownFailing 标注:失败 → 打印 KNOWN 且进程仍通过;
// 意外通过 → 报错,提醒修复者把对应标记改为 ok(...)。
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const babel = require('@babel/core');
const {DrawingPersistence, decode} = require(path.resolve(__dirname, '../public/drawing-persistence'));

const root = path.resolve(__dirname, '..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------- 极简测试框架 ----------
const failures = [];
const withTmp = async fn => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-m-drwp-'));
  try {await fn(dir);} finally {fs.rmSync(dir, {recursive: true, force: true});}
};
const ok = async (name, fn) => {
  try {await withTmp(fn);console.log('ok', name);}
  catch (e) {failures.push(name);console.log('FAIL', name, '\n    ', e && e.stack || e);}
};
const knownFailing = async (name, fn) => {
  let passed = false;let reason = '';
  try {await withTmp(fn);passed = true;}
  catch (e) {reason = String(e && e.message || e).split('\n')[0].slice(0, 200);}
  if (passed) {
    failures.push(name);
    console.log('FAIL', name, '\n     已知失败场景意外通过:缺陷已修复,请把 knownFailing(...) 改为 ok(...)。');
  } else console.log(`KNOWN ${name}: ${reason}`);
};

// ---------- 测试数据 ----------
const drawing = (id, name) => ({
  id, type: 'drawing', schemaVersion: 2, diagramType: 'er-sketch', notation: 'chen', revision: null,
  defName: name, defKey: `k-${id}`,
  pages: [{
    id: 'p1', name: '画布 1', kind: 'graph',
    erModel: {entities: [{id: `e-${id}`, name, kind: 'strong'}], relationships: [], attributes: []},
    scene: {
      nodes: {[`e-${id}`]: {x: 100, y: 100, width: 140, height: 58, layerId: 'main', style: {}}},
      edges: {}, annotations: [],
      layers: [{id: 'main', name: '主图层', visible: true, locked: false}],
      pageStyle: {background: '#ffffff'},
    },
    comments: [],
  }],
  enabledPacks: ['chen', 'basic'], resources: [], components: [],
});
const project = drawings => ({
  name: '回归项目', version: '0.4.0', entities: [], drawings, profile: {},
  viewGroups: [], diagrams: [], logicEntities: [], conceptEntities: [],
});
const addCommand = (id, name, current, tag) => ({
  commandId: `cmd-${tag}-${id}`,
  delta: {upsert: [drawing(id, name)], remove: [], order: [...current.map(d => d.id), id], baseRevisions: {[id]: null}},
});
const writeProject = (file, drawings) => fs.writeFileSync(file, JSON.stringify(project(drawings), null, 2));
// delay 取很大,真正的刷盘全部由测试显式触发;dispose 清掉计时器,避免进程悬挂。
const makeStore = (dir, extra = {}) => new DrawingPersistence(path.join(dir, 'store'), {notify: () => {}, delay: 3600000, maxDelay: 7200000, ...extra});
const dispose = store => store.sessions.forEach(s => {clearTimeout(s.timer);clearTimeout(s.maxTimer);s.timer = null;s.maxTimer = null;});
const codeOf = e => (e && (e.code || e.message)) || '';
const settle = p => Promise.resolve(p).then(value => ({value}), error => ({error}));
const sessionOf = (store, file) => store.sessions.get(fs.realpathSync(file));
const readJournal = (store, file) => {try {return fs.readFileSync(sessionOf(store, file).journal);} catch (e) {if (e.code === 'ENOENT') return Buffer.alloc(0);throw e;}};
const commandRecords = (store, file) => decode(readJournal(store, file)).records.filter(r => r.type === 'command');

// 渲染端 ES 模块(src/lib/*)用 babel 转成 CJS 后在 vm 里加载;每次调用得到一份全新的模块状态。
const loadSrc = (file, fakeRequire = {}) => {
  const cache = new Map();
  const load = abs => {
    if (cache.has(abs)) return cache.get(abs).exports;
    const m = {exports: {}};cache.set(abs, m);
    const code = babel.transformSync(fs.readFileSync(abs, 'utf8'), {
      babelrc: false, configFile: false,
      presets: [['@babel/preset-env', {targets: {node: 'current'}}]],
      plugins: ['@babel/plugin-proposal-optional-chaining'],
    }).code;
    vm.runInThisContext('(function(require,module,exports){' + code + '\n})', {filename: abs})(
      s => (s in fakeRequire ? fakeRequire[s] : s.startsWith('.') ? load(path.resolve(path.dirname(abs), s.endsWith('.js') ? s : s + '.js')) : require(s)),
      m, m.exports);
    return m.exports;
  };
  return load(path.resolve(root, file));
};

// 渲染端桥接:伪造 ipcRenderer.invoke,按 src/main.js 的分发表转给真实的 DrawingPersistence。
// intercept(request, forward) 可选:用于记录请求或伪造响应(如丢失的 ACK)。
const loadWrapper = (store, {intercept} = {}) => {
  const forward = async request => {
    try {
      const {method, file} = request;const owner = 'win-1';let value;
      if (method === 'open') value = await store.open(file, request.baseline, owner);
      else if (method === 'command') value = await store.command(file, request.command, owner);
      else if (method === 'flush') value = await store.flush(file, owner, request.candidate);
      else if (method === 'recovery') value = await store.recovery(file, owner);
      else throw Error('Unknown drawing operation');
      return {ok: true, value};
    } catch (error) {return {ok: false, error: error.message};}
  };
  const invoke = async (channel, request) => (intercept ? intercept(request, forward) : forward(request));
  const mod = loadSrc('src/lib/drawing_persistence.js', {electron: {ipcRenderer: {invoke, on: () => {}, send: () => {}}}});
  return mod.drawingPersistence;
};

const lockKinds = {
  empty: lock => fs.writeFileSync(lock, ''),
  garbage: lock => fs.writeFileSync(lock, '\u0000\u0001 not json {{{'),
  directory: lock => fs.mkdirSync(lock),
  negativePid: lock => fs.writeFileSync(lock, JSON.stringify({pid: -5})),
};
const age = (target, seconds) => {const t = new Date(Date.now() - seconds * 1000);fs.utimesSync(target, t, t);};
const deadPid = () => {const r = spawnSync(process.execPath, ['-e', '0']);return r.pid;};

// ---------- 场景 ----------
(async () => {
  // 基线:正常往返(open → command → flush → 重开),今天就应通过。
  await ok('基线: open→command→flush→重开 往返保持图纸且状态为 saved', async dir => {
    const file = path.join(dir, 'p.pdma.json');writeProject(file, []);
    const s1 = makeStore(dir);
    try {
      await s1.open(file, project([]), 'o');
      await s1.command(file, addCommand('d1', '订单', [], 'a'), 'o');
      const flushed = await s1.flush(file, 'o');
      assert.strictEqual(flushed.status, 'saved');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(file)).drawings.map(d => d.id), ['d1']);
    } finally {dispose(s1);}
    const s2 = makeStore(dir);
    try {
      const reopened = await s2.open(file, project([]), 'o');
      assert.strictEqual(reopened.status, 'saved');
      assert.deepStrictEqual(reopened.drawings.map(d => d.id), ['d1']);
    } finally {dispose(s2);}
  });

  await ok('基线: 未刷盘的命令重开后由日志重放(状态 local)', async dir => {
    const file = path.join(dir, 'p.pdma.json');writeProject(file, []);
    const s1 = makeStore(dir);
    try {
      await s1.open(file, project([]), 'o');
      await s1.command(file, addCommand('d1', '订单', [], 'a'), 'o');
    } finally {dispose(s1);}
    const s2 = makeStore(dir);
    try {
      const reopened = await s2.open(file, project([]), 'o');
      assert.strictEqual(reopened.status, 'local');
      assert.deepStrictEqual(reopened.drawings.map(d => d.id), ['d1']);
    } finally {dispose(s2);}
  });

  // DRW-02:渲染端 open() 之后同一 tick 的 change() 不得写进旧工程。
  await ok('DRW-02 基线: 等待 open(A) 完成后再 change(),编辑只进 A,B 完好', async dir => {
    const fileA = path.join(dir, 'A.pdma.json'), fileB = path.join(dir, 'B.pdma.json');
    const dB = drawing('B-own', 'B 自有');
    writeProject(fileA, []);writeProject(fileB, [dB]);
    const store = makeStore(dir);
    try {
      const wrapper = loadWrapper(store);
      await wrapper.open(fileB, project([dB]));
      await wrapper.open(fileA, project([]));
      await wrapper.change([drawing('A-edit', 'A 编辑')]);
      assert.deepStrictEqual((await store.recovery(fileA, 'win-1')).drawings.map(d => d.id), ['A-edit']);
      assert.deepStrictEqual((await store.recovery(fileB, 'win-1')).drawings.map(d => d.id), ['B-own']);
    } finally {dispose(store);}
  });

  await ok('DRW-02 open(A) 后同一 tick change() 不污染 B 且不删除 B 的图纸', async dir => {
    const fileA = path.join(dir, 'A.pdma.json'), fileB = path.join(dir, 'B.pdma.json');
    const dB = drawing('B-own', 'B 自有');
    writeProject(fileA, []);writeProject(fileB, [dB]);
    const store = makeStore(dir);
    try {
      const wrapper = loadWrapper(store);
      await wrapper.open(fileB, project([dB]));
      const opening = settle(wrapper.open(fileA, project([])));
      const changing = settle(wrapper.change([drawing('A-edit', 'A 编辑')]));  // 与 open 同一 tick
      await opening;await changing;
      const b = (await store.recovery(fileB, 'win-1')).drawings.map(d => d.id);
      const a = (await store.recovery(fileA, 'win-1')).drawings.map(d => d.id);
      assert.deepStrictEqual(b, ['B-own'], `B 的图纸应保持不变,实际 ${JSON.stringify(b)}`);
      assert.deepStrictEqual(a, ['A-edit'], `编辑应落入 A,实际 A=${JSON.stringify(a)}`);
    } finally {dispose(store);}
  });

  await ok('DRW-02 open(A) 之前同一 tick 的 change() 仍落入 B,且离开 B 时不重复应用', async dir => {
    const fileA = path.join(dir, 'A.pdma.json'), fileB = path.join(dir, 'B.pdma.json');
    const dB = drawing('B-own', 'B 自有');
    writeProject(fileA, []);writeProject(fileB, [dB]);
    const store = makeStore(dir);
    try {
      const wrapper = loadWrapper(store);
      await wrapper.open(fileB, project([dB]));
      const changing = settle(wrapper.change([dB, drawing('B-2', 'B 新增')]));  // 早于 open(A)
      const opening = settle(wrapper.open(fileA, project([])));
      const c = await changing;const o = await opening;
      assert(!c.error && !o.error, `不应失败: ${c.error || o.error}`);
      assert.deepStrictEqual((await store.recovery(fileB, 'win-1')).drawings.map(d => d.id), ['B-own', 'B-2']);
      assert.deepStrictEqual((await store.recovery(fileA, 'win-1')).drawings.map(d => d.id), []);
      assert.strictEqual(sessionOf(store, fileB).seq, 1, 'B 的草稿只应应用一次(刷盘会压缩日志,故看 seq)');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(fileB)).drawings.map(d => d.id), ['B-own', 'B-2'], '离开 B 前应刷盘');
    } finally {dispose(store);}
  });

  await ok('DRW-02 open(A) 失败时同一 tick 的 change() 被拒绝,绝不写入仍在会话中的 B', async dir => {
    const fileA = path.join(dir, 'A.pdma.json'), fileB = path.join(dir, 'B.pdma.json');
    const dB = drawing('B-own', 'B 自有');
    writeProject(fileA, []);writeProject(fileB, [dB]);
    const store = makeStore(dir);
    try {
      const wrapper = loadWrapper(store);
      await wrapper.open(fileB, project([dB]));
      const opening = settle(wrapper.open(fileA, null));  // 引擎拒绝:INVALID_PROJECT
      const changing = settle(wrapper.change([drawing('A-edit', 'A 编辑')]));
      assert.strictEqual(codeOf((await opening).error), 'INVALID_PROJECT');
      assert((await changing).error, 'open 失败后针对 A 的编辑必须被拒绝');
      assert.deepStrictEqual((await store.recovery(fileB, 'win-1')).drawings.map(d => d.id), ['B-own']);
      assert.strictEqual(sessionOf(store, fileB).seq, 0);
      // open 已落定:界面仍停留在 B,其后的编辑照常写入 B(不被失败的 open 永久阻塞)。
      await wrapper.change([dB, drawing('B-2', 'B 新增')]);
      assert.deepStrictEqual((await store.recovery(fileB, 'win-1')).drawings.map(d => d.id), ['B-own', 'B-2']);
    } finally {dispose(store);}
  });

  // 连续 open:在途 open 的草稿只属于它自己的工程,绝不写入"正在离开"的另一个工程。
  const threeProjects = dir => {
    const files = {A: path.join(dir, 'A.pdma.json'), B: path.join(dir, 'B.pdma.json'), C: path.join(dir, 'C.pdma.json')};
    const dB = drawing('B-own', 'B 自有'), dC = drawing('C-own', 'C 自有');
    writeProject(files.A, []);writeProject(files.B, [dB]);writeProject(files.C, [dC]);
    const disk = () => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f, 'utf8')]));
    return {files, dB, dC, disk};
  };
  const idsOf = async (store, file) => (await store.recovery(file, 'win-1')).drawings.map(d => d.id);

  await ok('DRW-02 连续 open: open(A) 失败 + 其间 change() + open(B),C 不被写入/删除,A 的编辑被丢弃', async dir => {
    const {files, dB, dC, disk} = threeProjects(dir);
    const store = makeStore(dir);
    try {
      const wrapper = loadWrapper(store);
      await wrapper.open(files.C, project([dC]));
      const before = disk();
      const oA = settle(wrapper.open(files.A, null));  // 引擎拒绝:INVALID_PROJECT
      const ch = settle(wrapper.change([drawing('A-edit', 'A 编辑')]));
      const oB = settle(wrapper.open(files.B, project([dB])));
      assert.strictEqual(codeOf((await oA).error), 'INVALID_PROJECT');
      assert((await ch).error, '针对失败工程 A 的编辑必须被拒绝');
      assert(!(await oB).error, `open(B) 应成功: ${(await oB).error}`);
      assert.deepStrictEqual(await idsOf(store, files.C), ['C-own'], 'C 的图纸不得被替换或删除');
      assert.strictEqual(sessionOf(store, files.C).seq, 0, 'C 不得收到任何命令');
      assert.deepStrictEqual(await idsOf(store, files.B), ['B-own']);
      assert.strictEqual(sessionOf(store, files.B).seq, 0);
      assert(!store.sessions.has(fs.realpathSync(files.A)), 'A 不应建立会话');
      await wrapper.flush();
      assert.deepStrictEqual(disk(), before, '任何工程文件都不应被改写');
    } finally {dispose(store);}
  });

  await ok('DRW-02 连续 open: open(A) 成功 + 其间 change() + open(B),编辑只进 A 且离开 A 时刷盘、不重复应用', async dir => {
    const {files, dB, dC, disk} = threeProjects(dir);
    const store = makeStore(dir);
    try {
      const wrapper = loadWrapper(store);
      await wrapper.open(files.C, project([dC]));
      const before = disk();
      const oA = settle(wrapper.open(files.A, project([])));
      const ch = settle(wrapper.change([drawing('A-edit', 'A 编辑')]));
      const oB = settle(wrapper.open(files.B, project([dB])));
      for (const r of [await oA, await ch, await oB]) assert(!r.error, `不应失败: ${r.error}`);
      assert.deepStrictEqual(await idsOf(store, files.C), ['C-own']);
      assert.strictEqual(sessionOf(store, files.C).seq, 0);
      assert.deepStrictEqual(await idsOf(store, files.A), ['A-edit']);
      assert.strictEqual(sessionOf(store, files.A).seq, 1, 'A 的编辑只应用一次');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(files.A)).drawings.map(d => d.id), ['A-edit'], '离开 A 前应刷盘');
      assert.deepStrictEqual(await idsOf(store, files.B), ['B-own']);
      assert.strictEqual(sessionOf(store, files.B).seq, 0);
      await wrapper.flush();
      assert.strictEqual(sessionOf(store, files.B).seq, 0, 'flush 不得把其他工程的草稿写入 B');
      const after = disk();
      assert.strictEqual(after.B, before.B);assert.strictEqual(after.C, before.C);
    } finally {dispose(store);}
  });

  await ok('DRW-02 连续 open: 被取代且失败的 open 不把旧工程草稿留给新工程,之后 flush() 不写入 B', async dir => {
    const {files, dB, dC, disk} = threeProjects(dir);
    const store = makeStore(dir);
    let failC = false;
    try {
      const realC = fs.realpathSync(files.C);
      const wrapper = loadWrapper(store, {intercept: async (request, forward) => (
        failC && request.method === 'command' && request.file === realC ? {ok: false, error: 'DISK_FULL'} : forward(request))});
      await wrapper.open(files.C, project([dC]));
      const before = disk();
      failC = true;
      assert.strictEqual((await settle(wrapper.change([dC, drawing('C-2', 'C 新增')]))).error.message, 'DISK_FULL');
      const oA = settle(wrapper.open(files.A, project([])));  // 离开 C 时写草稿失败 → open(A) 失败
      const oB = settle(wrapper.open(files.B, project([dB])));  // 在 A 失败之前已调用:A 被取代
      assert.strictEqual((await oA).error.message, 'DISK_FULL');
      failC = false;
      assert(!(await oB).error, `open(B) 应成功: ${(await oB).error}`);
      await wrapper.flush();
      assert.deepStrictEqual(await idsOf(store, files.B), ['B-own'], 'C 的草稿不得写入 B');
      assert.strictEqual(sessionOf(store, files.B).seq, 0);
      assert.deepStrictEqual(await idsOf(store, files.C), ['C-own']);
      assert(!store.sessions.has(fs.realpathSync(files.A)));
      const after = disk();
      assert.strictEqual(after.A, before.A);assert.strictEqual(after.B, before.B);assert.strictEqual(after.C, before.C);
    } finally {dispose(store);}
  });

  await ok('DRW-02 引擎: 过期 sessionId 的命令以 SESSION_STALE 拒绝且日志不变;匹配或缺省 sessionId 照常', async dir => {
    const file = path.join(dir, 'p.pdma.json');writeProject(file, []);
    const store = makeStore(dir);
    try {
      const opened = await store.open(file, project([]), 'o');
      assert(opened.sessionId, '前置: open 返回 sessionId');
      const before = readJournal(store, file);
      const stale = await settle(store.command(file, {...addCommand('d1', '订单', [], 'stale'), sessionId: 'journal-other'}, 'o'));
      assert.strictEqual(codeOf(stale.error), 'SESSION_STALE');
      assert(readJournal(store, file).equals(before), '被拒绝的命令不得写入日志');
      assert.strictEqual(sessionOf(store, file).seq, 0);
      await store.command(file, {...addCommand('d1', '订单', [], 'cur'), sessionId: opened.sessionId}, 'o');
      await store.command(file, addCommand('d2', '客户', [{id: 'd1'}], 'legacy'), 'o');  // 旧调用方不带 sessionId
      assert.deepStrictEqual((await store.recovery(file, 'o')).drawings.map(d => d.id), ['d1', 'd2']);
    } finally {dispose(store);}
  });

  await ok('DRW-02 渲染端: 会话被重建(sessionId 变化)后透明重开并以同一 commandId 重试,只应用一次', async dir => {
    const file = path.join(dir, 'A.pdma.json');writeProject(file, []);
    const store = makeStore(dir);
    const log = [];
    try {
      const wrapper = loadWrapper(store, {intercept: async (request, forward) => {
        const response = await forward(request);log.push({request, response});return response;
      }});
      await wrapper.open(file, project([]));
      const first = wrapper.getState().sessionId;
      // 会话关闭后工程被外部改写(图纸不变)→ 引擎重开时重建锚点,换发新的 sessionId。
      await store.close(file, 'win-1');
      fs.writeFileSync(file, JSON.stringify(project([])));
      const rebuilt = (await store.open(file, project([]), 'win-1')).sessionId;
      assert.notStrictEqual(rebuilt, first, '前置: 引擎应换发新的 sessionId');
      await wrapper.change([drawing('A-edit', 'A 编辑')]);
      const commands = log.filter(e => e.request.method === 'command');
      assert.strictEqual(commands.length, 2, '应恰好一次拒绝 + 一次重试');
      assert.strictEqual(commands[0].request.command.sessionId, first);
      assert(/SESSION_STALE/.test(commands[0].response.error), `首次应为 SESSION_STALE,实际 ${commands[0].response.error}`);
      assert.strictEqual(commands[1].request.command.commandId, commands[0].request.command.commandId, '重试必须沿用同一 commandId');
      assert.strictEqual(commands[1].request.command.sessionId, rebuilt);
      assert(commands[1].response.ok);
      assert.strictEqual(wrapper.getState().sessionId, rebuilt);
      const records = commandRecords(store, file);
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].sessionId, rebuilt);
      assert.deepStrictEqual((await store.recovery(file, 'win-1')).drawings.map(d => d.id), ['A-edit']);
    } finally {dispose(store);}
  });

  await ok('DRW-02 渲染端: 命令已落盘但应答为 SESSION_STALE 时重试被 commandId 去重,不重复应用', async dir => {
    const file = path.join(dir, 'A.pdma.json');writeProject(file, []);
    const store = makeStore(dir);
    let lost = 0;
    try {
      const wrapper = loadWrapper(store, {intercept: async (request, forward) => {
        const response = await forward(request);
        if (request.method === 'command' && !lost) {lost += 1;assert(response.ok);return {ok: false, error: 'SESSION_STALE'};}
        return response;
      }});
      await wrapper.open(file, project([]));
      await wrapper.change([drawing('A-edit', 'A 编辑')]);
      assert.strictEqual(lost, 1);
      assert.strictEqual(commandRecords(store, file).length, 1, '同一 commandId 只能写入一次');
      assert.strictEqual(sessionOf(store, file).seq, 1);
      assert.strictEqual(wrapper.getState().status, 'local');
    } finally {dispose(store);}
  });

  // DRW-10a:异常内容的写锁。
  const prepareLocked = async (dir, kind, ageSeconds) => {
    const file = path.join(dir, 'p.pdma.json');writeProject(file, []);
    const store = makeStore(dir);
    await store.open(file, project([]), 'o');
    await store.command(file, addCommand('d1', '订单', [], 'a'), 'o');
    const lock = `${file}.pdmaner-write-lock`;
    lockKinds[kind](lock);
    if (ageSeconds) age(lock, ageSeconds);
    return {file, store, lock};
  };

  for (const kind of ['empty', 'garbage']) {
    await ok(`DRW-10a 基线: 新鲜的${kind === 'empty' ? '空' : '垃圾内容'}锁文件仍为 PROJECT_BUSY(引擎)`, async dir => {
      const {file, store} = await prepareLocked(dir, kind, 0);
      try {
        const r = await settle(store.flush(file, 'o'));
        assert.strictEqual(codeOf(r.error), 'PROJECT_BUSY');
      } finally {dispose(store);}
    });
  }

  await ok('DRW-10a 基线: 存活进程持有的锁(含 mtime 已过期)不被回收', async dir => {
    const file = path.join(dir, 'p.pdma.json');writeProject(file, []);
    const store = makeStore(dir);
    try {
      await store.open(file, project([]), 'o');
      await store.command(file, addCommand('d1', '订单', [], 'a'), 'o');
      const lock = `${file}.pdmaner-write-lock`;
      fs.writeFileSync(lock, JSON.stringify({pid: process.pid}));age(lock, 600);
      const r = await settle(store.flush(file, 'o'));
      assert.strictEqual(codeOf(r.error), 'PROJECT_BUSY');
      assert(fs.existsSync(lock), '存活持有者的锁不应被删除');
    } finally {dispose(store);}
  });

  await knownFailing('DRW-10a 空/垃圾/目录/负 PID 且已过期的写锁可被回收(引擎 + 渲染端 guard)', async dir => {
    const problems = [];
    for (const kind of Object.keys(lockKinds)) {
      const sub = path.join(dir, `engine-${kind}`);fs.mkdirSync(sub);
      const {file, store} = await prepareLocked(sub, kind, 120);
      try {
        const r = await settle(store.flush(file, 'o'));
        if (r.error) problems.push(`engine/${kind}:${codeOf(r.error)}`);
      } finally {dispose(store);}
    }
    const {createProjectFileGuard} = loadSrc('src/lib/project_file_guard.js');
    for (const kind of Object.keys(lockKinds)) {
      const sub = path.join(dir, `guard-${kind}`);fs.mkdirSync(sub);
      const file = path.join(sub, 'g.json');fs.writeFileSync(file, JSON.stringify({a: 1}));
      const guard = createProjectFileGuard({fs, path, hash: sha, save: async (key, data) => fs.promises.writeFile(key, JSON.stringify(data)), message: key => key});
      guard.track(file, {a: 1});
      const lock = `${file}.pdmaner-write-lock`;lockKinds[kind](lock);age(lock, 120);
      const r = await settle(guard.commit(file, {a: 2}));
      if (r.error) problems.push(`guard/${kind}:${codeOf(r.error)}`);
    }
    assert.strictEqual(problems.length, 0, `过期的异常锁应可回收,实际仍被拒绝: ${problems.join(', ')}`);
  });

  // DRW-10b:两个写者并发回收同一死锁,临界区必须互斥。
  await knownFailing('DRW-10b 两个写者并发回收同一过期锁,同一时刻仅一个进入临界区(循环 30 次)', async dir => {
    const pid = deadPid();
    const problems = [];
    for (let round = 0; round < 30; round += 1) {
      const sub = path.join(dir, `r${round}`);fs.mkdirSync(sub);
      const file = path.join(sub, 'p.pdma.json');writeProject(file, []);
      const windows = [];
      const probe = name => async record => {
        if (record.type !== 'prepare') return;
        const w = {name, start: Date.now()};await sleep(30);w.end = Date.now();windows.push(w);
      };
      const stores = ['A', 'B'].map(name => new DrawingPersistence(path.join(sub, `store-${name}`), {notify: () => {}, delay: 3600000, maxDelay: 7200000, beforeSync: probe(name)}));
      try {
        for (const [i, store] of stores.entries()) {
          await store.open(file, project([]), 'o');
          await store.command(file, addCommand('d1', '订单', [], `w${i}`), 'o');
        }
        fs.writeFileSync(`${file}.pdmaner-write-lock`, JSON.stringify({pid}));
        const results = await Promise.all(stores.map(s => settle(s.flush(file, 'o'))));
        const overlap = windows.length === 2 && windows[0].start < windows[1].end && windows[1].start < windows[0].end;
        if (overlap) problems.push(`第 ${round} 轮: 两个写者同时处于临界区`);
        results.forEach(r => {if (r.error && !['PROJECT_BUSY', 'PROJECT_CONFLICT'].includes(codeOf(r.error))) problems.push(`第 ${round} 轮: 落败者得到 ${codeOf(r.error)}`);});
      } finally {stores.forEach(dispose);}
    }
    assert.strictEqual(problems.length, 0, `${problems.length} 次违例,例: ${problems[0]}`);
  });

  // DRW-11:工程文件被删除/移动。
  await knownFailing('DRW-11 工程文件被删/移走后 command/flush/recovery/close 不抛原始 ENOENT,且 recovery 可导出重放后的工程', async dir => {
    const problems = [];
    for (const mode of ['deleted', 'moved']) {
      const sub = path.join(dir, mode);fs.mkdirSync(sub);
      const file = path.join(sub, 'p.pdma.json');writeProject(file, []);
      const store = makeStore(sub);
      try {
        await store.open(file, project([]), 'o');
        await store.command(file, addCommand('d1', '订单', [], 'a'), 'o');
        if (mode === 'deleted') fs.unlinkSync(file);else fs.renameSync(file, path.join(sub, 'elsewhere.pdma.json'));
        const raw = e => e && (e.code === 'ENOENT' || /ENOENT/.test(String(e.message)));
        const c = await settle(store.command(file, addCommand('d2', '客户', [{id: 'd1'}], 'b'), 'o'));
        if (raw(c.error)) problems.push(`${mode}/command:ENOENT`);
        const f = await settle(store.flush(file, 'o'));
        if (raw(f.error)) problems.push(`${mode}/flush:ENOENT`);
        const r = await settle(store.recovery(file, 'o'));
        if (r.error) problems.push(`${mode}/recovery:${codeOf(r.error)}`);
        else if (!r.value.drawings.some(d => d.id === 'd1')) problems.push(`${mode}/recovery:缺少重放后的图纸 d1`);
        const x = await settle(store.close(file, 'o'));
        if (raw(x.error)) problems.push(`${mode}/close:ENOENT`);
      } finally {dispose(store);}
    }
    assert.strictEqual(problems.length, 0, problems.join(', '));
  });

  // DRW-13:日志被清空/删除后重开必须能察觉已 ACK 的命令丢失。
  await knownFailing('DRW-13 日志被清空/删除后重开状态为 damaged(而非 saved + 0 图纸)', async dir => {
    const problems = [];
    for (const mode of ['truncated', 'deleted']) {
      const sub = path.join(dir, mode);fs.mkdirSync(sub);
      const file = path.join(sub, 'p.pdma.json');writeProject(file, []);
      const s1 = makeStore(sub);
      let journal;
      try {
        await s1.open(file, project([]), 'o');
        for (const id of ['d1', 'd2', 'd3']) await s1.command(file, addCommand(id, `图 ${id}`, [...s1.sessions.values()][0].drawings, id), 'o');
        journal = [...s1.sessions.values()][0].journal;
      } finally {dispose(s1);}
      assert(fs.statSync(journal).size > 0, '前置: 3 条已 ACK 的命令应在日志中');
      if (mode === 'truncated') fs.truncateSync(journal, 0);else fs.unlinkSync(journal);
      const s2 = makeStore(sub);
      try {
        const reopened = await s2.open(file, project([]), 'o');
        if (reopened.status !== 'damaged') problems.push(`${mode}: 状态 ${reopened.status},seq=${reopened.seq},图纸 ${reopened.drawings.length}`);
      } finally {dispose(s2);}
    }
    assert.strictEqual(problems.length, 0, `日志丢失未被察觉 → ${problems.join('; ')}`);
  });

  if (failures.length) {
    console.log(`\n${failures.length} 个场景失败: ${failures.join(' | ')}`);
    process.exit(1);
  }
})().catch(e => {console.error(e);process.exit(1);});
