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
const loadWrapper = (store, {intercept, on = () => {}, send = () => {}} = {}) => {
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
  const mod = loadSrc('src/lib/drawing_persistence.js', {electron: {ipcRenderer: {invoke, on, send}}});
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
const lockLeftovers = dir => fs.readdirSync(dir).filter(n => n.includes('pdmaner-write-lock'));

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
    // 渲染端 guard 同一基线:刚创建、尚未写入内容的锁不得被误回收。
    await ok(`DRW-10a 基线: 新鲜的${kind === 'empty' ? '空' : '垃圾内容'}锁文件仍为 projectBusy(guard)`, async dir => {
      const {createProjectFileGuard} = loadSrc('src/lib/project_file_guard.js');
      const file = path.join(dir, 'g.json');fs.writeFileSync(file, JSON.stringify({a: 1}));
      const guard = createProjectFileGuard({fs, path, hash: sha, save: async (key, data) => fs.promises.writeFile(key, JSON.stringify(data)), message: key => key});
      guard.track(file, {a: 1});
      const lock = `${file}.pdmaner-write-lock`;lockKinds[kind](lock);
      const r = await settle(guard.commit(file, {a: 2}));
      assert.strictEqual(codeOf(r.error), 'projectBusy');
      assert(fs.existsSync(lock), '新鲜锁不应被删除');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {a: 1});
    });
  }

  await ok('DRW-10a 统一 PID 解析: 引擎与 guard 共用 parseLockInfo(接受数字与数字字符串 PID)', async () => {
    const engineSide = require(path.resolve(root, 'public/write-lock'));
    const guardSide = loadSrc('src/lib/project_file_guard.js');
    const cases = [
      ['{"pid":123}', {pid: 123}], ['{"pid":"123"}', {pid: 123}], ['{"pid":123,"startTime":1,"host":"h","createdAt":2}', {pid: 123}],
      ['{"pid":-5}', null], ['{"pid":0}', null], ['{"pid":"-5"}', null], ['{"pid":"12a"}', null], ['{"pid":1.5}', null],
      ['{"pid":" 7"}', null], ['{}', null], ['[1]', null], ['null', null], ['', null], ['\u0000\u0001 not json {{{', null],
    ];
    for (const [text, want] of cases) {
      assert.deepStrictEqual(engineSide.parseLockInfo(text), want, `引擎: ${JSON.stringify(text)}`);
      assert.deepStrictEqual(guardSide.parseLockInfo(text), want, `guard: ${JSON.stringify(text)}`);
    }
  });

  await ok('DRW-10a 数字字符串 PID: 死进程的锁两处都可回收,存活进程的锁两处都为忙', async dir => {
    const dead = String(deadPid());
    const {createProjectFileGuard} = loadSrc('src/lib/project_file_guard.js');
    for (const [pid, busy] of [[dead, false], [String(process.pid), true]]) {
      const sub = path.join(dir, `p${pid}`);fs.mkdirSync(sub);
      const file = path.join(sub, 'p.pdma.json');writeProject(file, []);
      const store = makeStore(sub);
      try {
        await store.open(file, project([]), 'o');
        await store.command(file, addCommand('d1', '订单', [], 'a'), 'o');
        fs.writeFileSync(`${file}.pdmaner-write-lock`, JSON.stringify({pid}));
        const r = await settle(store.flush(file, 'o'));
        assert.strictEqual(codeOf(r.error) || 'ok', busy ? 'PROJECT_BUSY' : 'ok', `引擎 pid="${pid}"`);
      } finally {dispose(store);}
      const gfile = path.join(sub, 'g.json');fs.writeFileSync(gfile, JSON.stringify({a: 1}));
      const guard = createProjectFileGuard({fs, path, hash: sha, save: async (key, data) => fs.promises.writeFile(key, JSON.stringify(data)), message: key => key});
      guard.track(gfile, {a: 1});
      fs.writeFileSync(`${gfile}.pdmaner-write-lock`, JSON.stringify({pid}));
      const g = await settle(guard.commit(gfile, {a: 2}));
      assert.strictEqual(codeOf(g.error) || 'ok', busy ? 'projectBusy' : 'ok', `guard pid="${pid}"`);
    }
  });

  // process.kill 对超出 int32 的 PID 抛 ERR_INVALID_ARG_TYPE(不是 ESRCH):这类"可解析"的锁不能因此永久占用。
  await ok('DRW-10a 超大/非法 PID: 解析为无法解析 → 按 mtime 规则(过期可回收、新鲜仍为忙),引擎与 guard 一致', async dir => {
    const writeLock = require(path.resolve(root, 'public/write-lock'));
    const guardSide = loadSrc('src/lib/project_file_guard.js');
    const table = [
      ['{"pid":99999999999}', null], ['{"pid":4294967296}', null], ['{"pid":2147483648}', null], ['{"pid":"99999999999"}', null],
      ['{"pid":2147483647}', {pid: 2147483647}], ['{"pid":"abc"}', null], ['{"pid":1.5}', null], ['{"pid":-1}', null], ['{"pid":0}', null],
    ];
    for (const [text, want] of table) {
      assert.deepStrictEqual(writeLock.parseLockInfo(text), want, `引擎: ${text}`);
      assert.deepStrictEqual(guardSide.parseLockInfo(text), want, `guard: ${text}`);
    }
    // 第二道防线:即便调用方绕过解析直接给出超大 PID,kill 的非 ESRCH/EPERM 错误也退回 mtime 规则。
    assert.strictEqual(writeLock.isLockStale({pid: 99999999999}, {mtimeMs: 0}, Date.now()), true);
    assert.strictEqual(writeLock.isLockStale({pid: 99999999999}, {mtimeMs: Date.now()}, Date.now()), false);
    const {createProjectFileGuard} = guardSide;
    const dead = deadPid();
    const lockTexts = {huge: '{"pid":99999999999}', int32: '{"pid":4294967296}', over: '{"pid":2147483648}', abc: '{"pid":"abc"}', frac: '{"pid":1.5}', neg: '{"pid":-1}', zero: '{"pid":0}', dead: JSON.stringify({pid: dead})};
    const problems = [];
    for (const [name, text] of Object.entries(lockTexts)) {
      for (const ageSeconds of [120, 0]) {
        const expectBusy = ageSeconds === 0 && name !== 'dead'; // 死进程的锁不论新旧都可回收
        const sub = path.join(dir, `${name}-${ageSeconds}`);fs.mkdirSync(sub);
        const file = path.join(sub, 'p.pdma.json');writeProject(file, []);
        const store = makeStore(sub);
        try {
          await store.open(file, project([]), 'o');
          await store.command(file, addCommand('d1', '订单', [], 'a'), 'o');
          const lock = `${file}.pdmaner-write-lock`;fs.writeFileSync(lock, text);if (ageSeconds) age(lock, ageSeconds);
          const r = await settle(store.flush(file, 'o'));
          if ((codeOf(r.error) || 'ok') !== (expectBusy ? 'PROJECT_BUSY' : 'ok')) problems.push(`engine/${name}/${ageSeconds}s:${codeOf(r.error) || 'ok'}`);
        } finally {dispose(store);}
        const gfile = path.join(sub, 'g.json');fs.writeFileSync(gfile, JSON.stringify({a: 1}));
        const guard = createProjectFileGuard({fs, path, hash: sha, save: async (key, data) => fs.promises.writeFile(key, JSON.stringify(data)), message: key => key});
        guard.track(gfile, {a: 1});
        const glock = `${gfile}.pdmaner-write-lock`;fs.writeFileSync(glock, text);if (ageSeconds) age(glock, ageSeconds);
        const g = await settle(guard.commit(gfile, {a: 2}));
        if ((codeOf(g.error) || 'ok') !== (expectBusy ? 'projectBusy' : 'ok')) problems.push(`guard/${name}/${ageSeconds}s:${codeOf(g.error) || 'ok'}`);
      }
    }
    assert.strictEqual(problems.length, 0, `与预期不符: ${problems.join(', ')}`);
  });

  // 无稳定文件 ID 的文件系统(FAT/exFAT、部分 SMB):rename 后 ino 会变、且不支持硬链接。
  // 用注入的 fs 模拟:回收中间文件(.reclaim-<pid>-<rand>)的 lstat 返回不同的 ino,link 一律 EPERM。
  const unstableInodeFs = () => {
    const shifted = st => Object.assign(Object.create(Object.getPrototypeOf(st)), st, {ino: st.ino + 7777});
    const promises = Object.assign({}, fs.promises, {
      lstat: async p => {const st = await fs.promises.lstat(p);return /\.reclaim-[0-9]+-[0-9a-f]+$/.test(p) ? shifted(st) : st;},
      link: async () => {throw Object.assign(Error('EPERM: hard links not supported'), {code: 'EPERM'});},
    });
    return Object.assign({}, fs, {promises});
  };

  await ok('DRW-10b 无稳定 inode 的文件系统: 死进程锁仍可回收(不退化为永久忙)', async dir => {
    const writeLock = require(path.resolve(root, 'public/write-lock'));
    for (const [kind, prepare] of [['dead', l => fs.writeFileSync(l, JSON.stringify({pid: deadPid()}))], ['empty-old', l => {fs.writeFileSync(l, '');age(l, 120);}]]) {
      const lock = path.join(dir, `${kind}.pdmaner-write-lock`);prepare(lock);
      const held = await writeLock.acquireWriteLock(unstableInodeFs(), lock, {});
      assert(held, `${kind}: 过期锁应可回收`);
      assert.strictEqual(JSON.parse(fs.readFileSync(lock, 'utf8')).pid, process.pid);
      await writeLock.releaseWriteLock(fs, lock, held);
    }
    assert.deepStrictEqual(lockLeftovers(dir), []);
  });

  await ok('DRW-10b 无稳定 inode 的文件系统: 被误搬走的他人新锁仍判为外来锁并放回(无硬链接时退回 rename)', async dir => {
    const writeLock = require(path.resolve(root, 'public/write-lock'));
    const lock = path.join(dir, 'x.pdmaner-write-lock');
    fs.writeFileSync(lock, JSON.stringify({pid: deadPid()}));
    const judged = await writeLock.inspectLock(fs, lock);
    const winner = await writeLock.acquireWriteLock(fs, lock, {});
    assert(winner, '胜者应获得锁');
    const heldText = fs.readFileSync(lock, 'utf8');
    assert.strictEqual(await writeLock.reclaimLock(unstableInodeFs(), lock, judged), 'busy');
    assert.strictEqual(fs.readFileSync(lock, 'utf8'), heldText, '胜者的锁应被放回原路径');
    assert.deepStrictEqual(lockLeftovers(dir), ['x.pdmaner-write-lock'], '不应遗留回收中间文件');
    await writeLock.releaseWriteLock(fs, lock, winner);
    assert.deepStrictEqual(lockLeftovers(dir), []);
  });

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

  await ok('DRW-10a 空/垃圾/目录/负 PID 且已过期的写锁可被回收(引擎 + 渲染端 guard)', async dir => {
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
  await ok('DRW-10b 两个写者并发回收同一过期锁,同一时刻仅一个进入临界区(循环 30 次)', async dir => {
    const pid = deadPid();
    const problems = [];
    for (let round = 0; round < 30; round += 1) {
      const sub = path.join(dir, `r${round}`);fs.mkdirSync(sub);
      const file = path.join(sub, 'p.pdma.json');writeProject(file, []);
      const windows = [];let inside = 0;let maxInside = 0;
      // 除时间窗外再用实时计数:只要两个写者曾同时停留在临界区,maxInside 必为 2。
      const probe = name => async record => {
        if (record.type !== 'prepare') return;
        inside += 1;maxInside = Math.max(maxInside, inside);
        const w = {name, start: Date.now()};await sleep(30);w.end = Date.now();windows.push(w);
        inside -= 1;
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
        if (overlap || maxInside > 1) problems.push(`第 ${round} 轮: 两个写者同时处于临界区`);
        results.forEach(r => {if (r.error && !['PROJECT_BUSY', 'PROJECT_CONFLICT'].includes(codeOf(r.error))) problems.push(`第 ${round} 轮: 落败者得到 ${codeOf(r.error)}`);});
        if (!results.some(r => !r.error)) problems.push(`第 ${round} 轮: 死锁未被任何写者回收`);
        if (fs.readdirSync(sub).some(n => n.includes('pdmaner-write-lock'))) problems.push(`第 ${round} 轮: 遗留锁/回收文件 ${fs.readdirSync(sub).join(',')}`);
      } finally {stores.forEach(dispose);}
    }
    assert.strictEqual(problems.length, 0, `${problems.length} 次违例,例: ${problems[0]}`);
  });

  // DRW-10b 确定性交错:onLockStale 钩子让两个写者都先读到同一把过期锁(都判定过期),
  // 再按指定顺序逐个放行——即"慢速落败者在胜者已回收并重建新锁之后才动手"的 ABA 场景。
  const staleGate = names => {
    const arrived = new Set();const release = {};const gates = {};let all;
    const allArrived = new Promise(resolve => {all = resolve;});
    names.forEach(n => {gates[n] = new Promise(resolve => {release[n] = resolve;});});
    const hook = name => async lockPath => {
      if (!lockPath.endsWith('.pdmaner-write-lock')) return; // 只在主锁的过期判定处拦截
      arrived.add(name);if (names.every(n => arrived.has(n))) all();
      await gates[name];
    };
    const within = (promise, what) => {
      let timer;const timeout = new Promise((resolve, reject) => {timer = setTimeout(() => reject(Error(`${what}(已到达: ${[...arrived].join(',') || '无'})`)), 3000);});
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    };
    return {hook, within, waitAll: () => within(allArrived, '写者未全部在判定过期后到达交错点'), release: n => release[n]()};
  };
  const holdPoint = () => {let entered;let leave;const inside = new Promise(r => {entered = r;});const hold = new Promise(r => {leave = r;});return {inside, hold, entered: () => entered(), leave: () => leave()};};

  await ok('DRW-10b 确定性交错(引擎): 两个写者都判定同一把锁过期后,落败者不得搬走胜者的新锁,得到 PROJECT_BUSY', async dir => {
    const file = path.join(dir, 'p.pdma.json');writeProject(file, []);
    const lock = `${file}.pdmaner-write-lock`;
    const gate = staleGate(['A', 'B']);const pointA = holdPoint();
    let inside = 0;let maxInside = 0;
    const probe = name => async record => {
      if (record.type !== 'prepare') return;
      inside += 1;maxInside = Math.max(maxInside, inside);
      if (name === 'A') {pointA.entered();await pointA.hold;}
      inside -= 1;
    };
    const stores = {};
    for (const name of ['A', 'B']) stores[name] = new DrawingPersistence(path.join(dir, `store-${name}`), {notify: () => {}, delay: 3600000, maxDelay: 7200000, beforeSync: probe(name), onLockStale: gate.hook(name)});
    try {
      for (const [i, name] of ['A', 'B'].entries()) {
        await stores[name].open(file, project([]), 'o');
        await stores[name].command(file, addCommand('d1', '订单', [], `w${i}`), 'o');
      }
      fs.writeFileSync(lock, JSON.stringify({pid: deadPid()}));
      const flushA = settle(stores.A.flush(file, 'o'));const flushB = settle(stores.B.flush(file, 'o'));
      await gate.waitAll();
      gate.release('A');await gate.within(pointA.inside, 'A 未能回收并进入临界区');
      const held = fs.lstatSync(lock);const heldText = fs.readFileSync(lock, 'utf8');
      const info = JSON.parse(heldText);
      assert.deepStrictEqual(Object.keys(info).sort(), ['createdAt', 'host', 'pid', 'startTime'], '锁内容应为 {pid, startTime, host, createdAt}');
      assert.strictEqual(info.pid, process.pid);
      gate.release('B');const b = await gate.within(flushB, 'B 未返回');
      assert.strictEqual(codeOf(b.error), 'PROJECT_BUSY');
      const after = fs.lstatSync(lock);
      assert.strictEqual(after.ino, held.ino, '胜者的锁被替换');
      assert.strictEqual(fs.readFileSync(lock, 'utf8'), heldText);
      pointA.leave();const a = await flushA;
      assert(!a.error, `胜者应保存成功: ${codeOf(a.error)}`);
      assert.strictEqual(maxInside, 1);
      assert.deepStrictEqual(lockLeftovers(dir), []);
    } finally {pointA.leave();Object.values(stores).forEach(dispose);}
  });

  await ok('DRW-10b 确定性交错(guard): 两个写者都判定同一把锁过期后,落败者得到 projectBusy 且胜者的锁不变', async dir => {
    const {createProjectFileGuard} = loadSrc('src/lib/project_file_guard.js');
    const file = path.join(dir, 'g.json');fs.writeFileSync(file, JSON.stringify({a: 1}));
    const lock = `${file}.pdmaner-write-lock`;
    const gate = staleGate(['A', 'B']);const pointA = holdPoint();
    const make = (name, save) => createProjectFileGuard({fs, path, hash: sha, message: key => key, save, onLockStale: gate.hook(name)});
    const a = make('A', async (key, data) => {pointA.entered();await pointA.hold;await fs.promises.writeFile(key, JSON.stringify(data));});
    const b = make('B', async () => {throw Error('落败者不应进入临界区');});
    a.track(file, {a: 1});b.track(file, {a: 1});
    fs.writeFileSync(lock, JSON.stringify({pid: deadPid()}));
    try {
      const pa = settle(a.commit(file, {a: 2}));const pb = settle(b.commit(file, {a: 3}));
      await gate.waitAll();
      gate.release('A');await gate.within(pointA.inside, 'A 未能回收并进入临界区');
      const held = fs.lstatSync(lock);const heldText = fs.readFileSync(lock, 'utf8');
      assert.deepStrictEqual(Object.keys(JSON.parse(heldText)).sort(), ['createdAt', 'host', 'pid', 'startTime']);
      gate.release('B');const rb = await gate.within(pb, 'B 未返回');
      assert.strictEqual(codeOf(rb.error), 'projectBusy');
      assert.strictEqual(fs.lstatSync(lock).ino, held.ino, '胜者的锁被替换');
      assert.strictEqual(fs.readFileSync(lock, 'utf8'), heldText);
      pointA.leave();const ra = await pa;
      assert(!ra.error, `胜者应保存成功: ${codeOf(ra.error)}`);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {a: 2});
      assert.deepStrictEqual(lockLeftovers(dir), []);
    } finally {pointA.leave();}
  });

  await ok('DRW-10b ABA 兜底: 越过回收互斥的慢速落败者若搬走了胜者的新锁,原子放回并返回忙,不删除胜者的锁', async dir => {
    const writeLock = require(path.resolve(root, 'public/write-lock'));
    const lock = path.join(dir, 'x.pdmaner-write-lock');
    fs.writeFileSync(lock, JSON.stringify({pid: deadPid()}));
    const judged = await writeLock.inspectLock(fs, lock); // 落败者 B 读到并判定过期
    assert(writeLock.isLockStale(judged.info, judged.stat, Date.now()));
    const winner = await writeLock.acquireWriteLock(fs, lock, {}); // 胜者 A 回收旧锁并持有新锁(inode 可能被复用)
    assert(winner, '胜者应获得锁');
    const held = fs.lstatSync(lock);const heldText = fs.readFileSync(lock, 'utf8');
    // 最坏交错:B 直接对路径执行 rename 回收(模拟回收互斥失效)。
    assert.strictEqual(await writeLock.reclaimLock(fs, lock, judged), 'busy');
    assert.strictEqual(fs.lstatSync(lock).ino, held.ino, '胜者的锁应被原子放回原路径');
    assert.strictEqual(fs.readFileSync(lock, 'utf8'), heldText);
    assert.deepStrictEqual(lockLeftovers(dir), ['x.pdmaner-write-lock'], '不应遗留回收中间文件');
    await writeLock.releaseWriteLock(fs, lock, winner);
    assert.deepStrictEqual(lockLeftovers(dir), []);
  });

  await ok('DRW-10b 释放只删除自己的锁: 锁路径已被换成他人的锁时,持有者释放不删除它', async dir => {
    const writeLock = require(path.resolve(root, 'public/write-lock'));
    const lock = path.join(dir, 'x.pdmaner-write-lock');
    const mine = await writeLock.acquireWriteLock(fs, lock, {});
    fs.renameSync(lock, path.join(dir, 'stolen'));fs.writeFileSync(lock, JSON.stringify({pid: process.pid, createdAt: Date.now()}));
    await writeLock.releaseWriteLock(fs, lock, mine);
    assert(fs.existsSync(lock), '他人的锁不应被删除');
  });

  await ok('DRW-10b 回收互斥: 崩溃遗留的过期互斥文件可回收;新鲜的互斥文件(他人正在回收)使本次写入为 PROJECT_BUSY', async dir => {
    for (const [mutexAge, busy] of [[120, false], [0, true]]) {
      const sub = path.join(dir, `m${mutexAge}`);fs.mkdirSync(sub);
      const file = path.join(sub, 'p.pdma.json');writeProject(file, []);
      const store = makeStore(sub);
      const lock = `${file}.pdmaner-write-lock`;
      try {
        await store.open(file, project([]), 'o');
        await store.command(file, addCommand('d1', '订单', [], 'a'), 'o');
        fs.writeFileSync(lock, JSON.stringify({pid: deadPid()}));
        fs.writeFileSync(`${lock}.reclaim-mutex`, '');if (mutexAge) age(`${lock}.reclaim-mutex`, mutexAge);
        const r = await settle(store.flush(file, 'o'));
        if (busy) {
          assert.strictEqual(codeOf(r.error), 'PROJECT_BUSY');
          assert.deepStrictEqual(lockLeftovers(sub).sort(), ['p.pdma.json.pdmaner-write-lock', 'p.pdma.json.pdmaner-write-lock.reclaim-mutex']);
        } else {
          assert(!r.error, `应回收成功: ${codeOf(r.error)}`);
          assert.deepStrictEqual(lockLeftovers(sub), []);
        }
      } finally {dispose(store);}
    }
  });

  // DRW-11:工程文件被删除/移动。
  await ok('DRW-11 工程文件被删/移走后 command/flush/recovery/close 不抛原始 ENOENT,且 recovery 可导出重放后的工程', async dir => {
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

  // DRW-11 细节:会话键稳定、日志与恢复副本、文件重现。
  const missingSetup = async (dir, mode, {symlinked = false, owner = 'o'} = {}) => {
    const real = path.join(dir, 'real');fs.mkdirSync(real);
    let sub = real;
    if (symlinked) {sub = path.join(dir, 'link');fs.symlinkSync(real, sub);}  // 类似 macOS /var→/private/var
    const file = path.join(sub, 'p.pdma.json');writeProject(file, []);
    const store = makeStore(dir);
    await store.open(file, project([]), owner);
    await store.command(file, addCommand('d1', '订单', [], 'a'), owner);
    const key = sessionOf(store, file).key;
    const away = path.join(real, 'elsewhere.pdma.json');
    const remove = () => (mode === 'deleted' ? fs.unlinkSync(path.join(real, 'p.pdma.json')) : fs.renameSync(path.join(real, 'p.pdma.json'), away));
    const restore = () => (mode === 'deleted' ? null : fs.renameSync(away, path.join(real, 'p.pdma.json')));
    return {store, file, key, remove, restore, real};
  };
  for (const mode of ['deleted', 'moved']) {
    for (const symlinked of [false, true]) {
      await ok(`DRW-11 ${mode}${symlinked ? '(符号链接目录)' : ''}: 会话键不变,编辑继续入日志,flush 返回 error 而非抛错,recovery 含删除前后的编辑`, async dir => {
        const {store, file, key, remove} = await missingSetup(dir, mode, {symlinked});
        try {
          remove();
          assert.strictEqual(store.canonical(file), key, '文件缺失后 canonical 必须仍映射到同一会话键');
          assert(store.sessions.has(store.canonical(file)));
          const c = await store.command(file, addCommand('d2', '客户', [{id: 'd1'}], 'b'), 'o');
          assert(c.seq === 2);
          const f = await store.flush(file, 'o');
          assert.strictEqual(f.status, 'error');assert.strictEqual(f.error, 'PROJECT_FILE_MISSING');
          assert(f.seq === 2 && f.checkpointSeq === 0, '会话保持,编辑未落盘');
          assert(store.sessions.has(key), '会话保持');
          const again = await store.flush(file, 'o');   // 重复 flush 同样不抛
          assert.strictEqual(again.error, 'PROJECT_FILE_MISSING');
          assert.deepStrictEqual(decode(fs.readFileSync(store.sessions.get(key).journal)).records.filter(r => r.type === 'command').map(r => r.seq), [1, 2], '日志保持');
          const r = await store.recovery(file, 'o');
          assert.deepStrictEqual(r.drawings.map(d => d.id), ['d1', 'd2']);
          assert.strictEqual(r.name, '回归项目', '恢复副本带工程元数据');
          const x = await settle(store.close(file, 'o'));
          assert.strictEqual(codeOf(x.error), 'PROJECT_FILE_MISSING', 'close 以带码错误拒绝,不是原始 ENOENT');
          assert(store.sessions.has(key), '仍有未落盘编辑时 close 不丢会话');
          assert.deepStrictEqual((await store.recovery(file, 'o')).drawings.map(d => d.id), ['d1', 'd2']);
        } finally {dispose(store);}
      });
    }
  }

  await ok('DRW-11 工程所在目录整体被删除: command/flush/recovery 仍不抛原始 ENOENT,也不重建目录', async dir => {
    const {store, file, key, real} = await missingSetup(dir, 'deleted');
    try {
      fs.rmSync(real, {recursive: true, force: true});
      assert.strictEqual(store.canonical(file), key);
      await store.command(file, addCommand('d2', '客户', [{id: 'd1'}], 'b'), 'o');
      const f = await store.flush(file, 'o');
      assert.strictEqual(f.error, 'PROJECT_FILE_MISSING');
      assert(!fs.existsSync(real), 'flush 不得把已删除的目录重新建出来');
      assert.deepStrictEqual((await store.recovery(file, 'o')).drawings.map(d => d.id), ['d1', 'd2']);
    } finally {dispose(store);}
  });

  for (const mode of ['deleted', 'moved']) {
    await ok(`DRW-11 ${mode}后文件原内容重现(改回/还原): 下一次 flush 正常落盘,含缺失期间的编辑`, async dir => {
      const {store, file, remove, restore, real} = await missingSetup(dir, mode);
      try {
        const original = fs.readFileSync(path.join(real, 'p.pdma.json'));
        remove();
        await store.command(file, addCommand('d2', '客户', [{id: 'd1'}], 'b'), 'o');
        assert.strictEqual((await store.flush(file, 'o')).error, 'PROJECT_FILE_MISSING');
        if (mode === 'deleted') fs.writeFileSync(path.join(real, 'p.pdma.json'), original);else restore();
        const saved = await store.flush(file, 'o');
        assert.strictEqual(saved.status, 'saved');assert.strictEqual(saved.error, '');
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(real, 'p.pdma.json'))).drawings.map(d => d.id), ['d1', 'd2']);
        await store.close(file, 'o');assert(store.sessions.size === 0);
      } finally {dispose(store);}
    });
  }

  await ok('DRW-11 文件被删后以不同内容重现: flush 为 PROJECT_CONFLICT,绝不覆盖,恢复副本仍可导出', async dir => {
    const {store, file, remove, real, key} = await missingSetup(dir, 'deleted');
    try {
      remove();
      await store.command(file, addCommand('d2', '客户', [{id: 'd1'}], 'b'), 'o');
      assert.strictEqual((await store.flush(file, 'o')).error, 'PROJECT_FILE_MISSING');
      const other = JSON.stringify(project([drawing('x', '别人写的')]), null, 2);
      fs.writeFileSync(path.join(real, 'p.pdma.json'), other);
      const r = await settle(store.flush(file, 'o'));
      assert.strictEqual(codeOf(r.error), 'PROJECT_CONFLICT');
      assert.strictEqual(fs.readFileSync(path.join(real, 'p.pdma.json'), 'utf8'), other, '不得覆盖重现的文件');
      assert.deepStrictEqual((await store.recovery(file, 'o')).drawings.map(d => d.id), ['d1', 'd2']);
      assert.strictEqual(store.state(store.sessions.get(key), false).status, 'conflict');
    } finally {dispose(store);}
  });

  await ok('DRW-11 已落盘后文件被删: 无待写入时 flush 不报错;重开(open)已有会话时返回 error 状态而非抛 ENOENT', async dir => {
    const {store, file, remove, key} = await missingSetup(dir, 'deleted');
    try {
      assert.strictEqual((await store.flush(file, 'o')).status, 'saved');
      remove();
      assert.strictEqual((await store.flush(file, 'o')).status, 'saved');
      const reopened = await store.open(file, project([]), 'o');
      assert.strictEqual(reopened.status, 'error');assert.strictEqual(reopened.error, 'PROJECT_FILE_MISSING');
      assert(store.sessions.has(key));
    } finally {dispose(store);}
  });

  // 陈旧错误:文件回来 / 检查点已提交之后,无待写入的 flush 不得再报错;真正的未落盘失败仍须报错。
  await ok('DRW-11 已落盘 → 删文件 → open(error) → 原样还原: flush 与再次 open 均为 saved,不留陈旧 PROJECT_FILE_MISSING', async dir => {
    const {store, file, remove, real} = await missingSetup(dir, 'deleted');
    try {
      const original = fs.readFileSync(path.join(real, 'p.pdma.json'));
      assert.strictEqual((await store.flush(file, 'o')).status, 'saved');
      const saved = fs.readFileSync(path.join(real, 'p.pdma.json'));
      remove();
      assert.strictEqual((await store.open(file, project([]), 'o')).error, 'PROJECT_FILE_MISSING');
      fs.writeFileSync(path.join(real, 'p.pdma.json'), saved);
      const f = await store.flush(file, 'o');
      assert.strictEqual(f.status, 'saved');assert.strictEqual(f.error, '');
      const again = await store.open(file, project([]), 'o');
      assert.strictEqual(again.status, 'saved');assert.strictEqual(again.error, '');
      assert(original.length > 0);
    } finally {dispose(store);}
  });

  await ok('DRW-11 渲染端: 文件缺失期间 open 后还原,flush/关闭屏障/离开工程均不抛', async dir => {
    const {store, file, remove, real} = await missingSetup(dir, 'deleted', {owner: 'win-1'});
    const handlers = {}, sent = [];
    const hadWindow = 'window' in global, oldWindow = global.window, hadDocument = 'document' in global, oldDocument = global.document;
    global.window = {dispatchEvent: () => {}};global.document = {activeElement: null};
    try {
      const wrapper = loadWrapper(store, {on: (channel, fn) => {handlers[channel] = fn;}, send: (channel, payload) => sent.push({channel, payload})});
      await wrapper.open(file, project([]));
      await wrapper.flush();
      const saved = fs.readFileSync(path.join(real, 'p.pdma.json'));
      remove();
      await wrapper.open(file, project([]));
      assert.strictEqual(wrapper.getState().status, 'error');
      fs.writeFileSync(path.join(real, 'p.pdma.json'), saved);
      assert.strictEqual((await wrapper.flush()).status, 'saved');
      await handlers['drawing-before-close']({}, 'req-2');
      assert.strictEqual(sent[0].payload.ok, true, '文件已回来且全部落盘,屏障应放行');
      const other = path.join(real, 'other.pdma.json');writeProject(other, []);
      await wrapper.open(other, project([]));   // leaveSession 不得抛
    } finally {
      if (hadWindow) global.window = oldWindow;else delete global.window;
      if (hadDocument) global.document = oldDocument;else delete global.document;
      dispose(store);
    }
  });

  await ok('DRW-11 检查点提交之后的收尾失败只让当次 flush 报错,后续无待写入 flush 为 saved', async dir => {
    let failCommit = true;
    const writeRecord = (handle, content) => {
      if (failCommit && content.includes('"type":"commit"')) throw new Error('模拟 commit 记录写入失败');
      return handle.writeFile(content);
    };
    const file = path.join(dir, 'p.pdma.json');writeProject(file, []);
    const store = makeStore(dir, {writeRecord});
    try {
      await store.open(file, project([]), 'o');
      await store.command(file, addCommand('d1', '订单', [], 'a'), 'o');
      const first = await settle(store.flush(file, 'o'));
      assert(first.error, '检查点提交后的失败本次仍须报告');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(file)).drawings.map(d => d.id), ['d1'], '检查点已写入工程文件');
      failCommit = false;
      const second = await store.flush(file, 'o');
      assert.strictEqual(second.status, 'saved');assert.strictEqual(second.error, '');
    } finally {dispose(store);}
  });

  await ok('DRW-11 真正的未落盘失败仍报 error(有待写入时不被清除)', async dir => {
    let fail = true;
    const writeRecord = (handle, content) => {
      if (fail && content.includes('"type":"prepare"')) throw new Error('模拟 prepare 记录写入失败');
      return handle.writeFile(content);
    };
    const file = path.join(dir, 'p.pdma.json');writeProject(file, []);
    const store = makeStore(dir, {writeRecord});
    try {
      await store.open(file, project([]), 'o');
      await store.command(file, addCommand('d1', '订单', [], 'a'), 'o');
      assert(( await settle(store.flush(file, 'o'))).error);
      assert(( await settle(store.flush(file, 'o'))).error, '仍有待写入,重复 flush 继续报错');
      assert.strictEqual(store.state(store.sessions.get(store.canonical(file)), false).status, 'error');
      fail = false;
      assert.strictEqual((await store.flush(file, 'o')).status, 'saved');
    } finally {dispose(store);}
  });

  // 渲染端:flush 返回 status error 时发布错误状态、不触发重开循环、且对调用方(关闭屏障/返回/保存)仍是失败。
  await ok('DRW-11 渲染端: flush 遇 PROJECT_FILE_MISSING 发布 error 并抛出,不重开;commit 同样不当作已保存', async dir => {
    const {store, file, remove} = await missingSetup(dir, 'deleted', {owner: 'win-1'});
    try {
      const calls = [];
      const wrapper = loadWrapper(store, {intercept: (request, forward) => {calls.push(request.method);return forward(request);}});
      await wrapper.open(file, project([]));
      await wrapper.change([drawing('d1', '订单'), drawing('d9', '新图')]);
      remove();
      const before = calls.length;
      const f = await settle(wrapper.flush());
      assert.strictEqual(f.error && f.error.message, 'PROJECT_FILE_MISSING');
      assert.deepStrictEqual(calls.slice(before), ['flush'], '不得触发 open 重开循环');
      assert.strictEqual(wrapper.getState().status, 'error');assert.strictEqual(wrapper.getState().error, 'PROJECT_FILE_MISSING');
      const cm = await settle(wrapper.commit(file, project([drawing('d1', '订单')])));
      assert.strictEqual(cm.error && cm.error.message, 'PROJECT_FILE_MISSING', 'commit 不得返回 baseline 当作已保存');
      const rec = await wrapper.recovery();
      assert(rec.drawings.some(d => d.id === 'd9'), '恢复副本含缺失期间的编辑');
    } finally {dispose(store);}
  });

  await ok('DRW-11 关闭屏障: 文件缺失时 drawing-before-close 回报 ok:false 且 recoveryAvailable(不得静默放行)', async dir => {
    const {store, file, remove} = await missingSetup(dir, 'deleted', {owner: 'win-1'});
    const handlers = {}, sent = [];
    const hadWindow = 'window' in global, oldWindow = global.window, hadDocument = 'document' in global, oldDocument = global.document;
    global.window = {dispatchEvent: () => {}};global.document = {activeElement: null};  // 渲染端 settleInputs 需要的最小 DOM 桩
    try {
      const wrapper = loadWrapper(store, {on: (channel, fn) => {handlers[channel] = fn;}, send: (channel, payload) => sent.push({channel, payload})});
      await wrapper.open(file, project([]));
      await wrapper.change([drawing('d1', '订单'), drawing('d9', '新图')]);
      remove();
      await handlers['drawing-before-close']({}, 'req-1');
      assert.strictEqual(sent.length, 1);
      const {payload} = sent[0];
      assert.strictEqual(payload.ok, false, '屏障必须视为未落盘');
      assert.strictEqual(payload.error, 'PROJECT_FILE_MISSING');
      assert.strictEqual(payload.recoveryAvailable, true);
    } finally {
      if (hadWindow) global.window = oldWindow;else delete global.window;
      if (hadDocument) global.document = oldDocument;else delete global.document;
      dispose(store);
    }
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
