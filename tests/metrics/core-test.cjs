// 指标平台 M1 合成核心测试（CommonJS + 现有 @babel/core 真实加载生产模块）。
// 复跑：node doc/developer/metric-platform-v1/core-test.cjs
// 只测真实领域 API（src/lib/metric_platform.js），不做源码正则检查；不读 template。
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const babel = require('@babel/core');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ---- 窄加载器：经 Babel(commonjs) 编译并求值 ES 模块，相对路径补 .js / /index.js ----
const moduleCache = new Map();
function loadEsModule(file) {
  const key = path.resolve(file);
  if (moduleCache.has(key)) return moduleCache.get(key);
  const code = fs.readFileSync(key, 'utf8');
  const transformed = babel.transformSync(code, {
    filename: key,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    presets: [[require.resolve('@babel/preset-env'), {targets: {node: '18'}, modules: 'commonjs'}]],
  }).code;
  const moduleObject = {exports: {}};
  moduleCache.set(key, moduleObject);
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const base = path.resolve(path.dirname(key), specifier);
      for (const suffix of ['.js', '/index.js', '']) {
        const candidate = base + suffix;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return loadEsModule(candidate).exports;
        }
      }
      throw new Error(`cannot resolve ${specifier} from ${key}`);
    }
    return require(specifier);
  };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', transformed);
  fn(moduleObject.exports, localRequire, moduleObject, key, path.dirname(key));
  return moduleObject;
}

const api = loadEsModule(path.join(PROJECT_ROOT, 'src', 'lib', 'metric_platform.js')).exports;
const fixtures = require('./core-fixtures.cjs');

let passed = 0;
let failed = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({name, error});
    console.log(`FAIL ${name}`);
    console.log(`     ${error && error.message ? error.message.split('\n')[0] : error}`);
  }
};
const codesOf = result => (result.errors || []).map(item => item.code);
const errAt = (result, code, pathValue) =>
  (result.errors || []).some(item => item.code === code
    && (pathValue === undefined || item.path === pathValue));

// =====================================================================
// 主链路夹具：原子×2 → 派生×2 → 复合；再建部门口径与公共升级
// =====================================================================
function buildMainProject() {
  let source = fixtures.baseProject();
  const concept = api.createMetricConcept(source, {id: 'concept-pay', domain: '交易', name: '支付', owner: 'user-owner'});
  assert.equal(concept.ok, true, JSON.stringify(concept.errors));
  source = concept.source;

  const atomicAmount = fixtures.paidAmountAtomic('metric-paid-amount');
  const r1 = api.createMetricDraft(source, {...atomicAmount, revisionId: 'mrev-paid-amount-1', conceptId: 'concept-pay'});
  assert.equal(r1.ok, true, JSON.stringify(r1.errors));
  const p1 = api.publishMetricRevision(r1.source, 'mrev-paid-amount-1', {publishedAt: '2026-10-20T02:00:00Z'});
  assert.equal(p1.ok, true, JSON.stringify(p1.errors));
  source = p1.source;

  const atomicOrders = fixtures.paidOrdersAtomic('metric-paid-orders');
  const r2 = api.createMetricDraft(source, {...atomicOrders, revisionId: 'mrev-paid-orders-1'});
  assert.equal(r2.ok, true, JSON.stringify(r2.errors));
  const p2 = api.publishMetricRevision(r2.source, 'mrev-paid-orders-1', {});
  assert.equal(p2.ok, true, JSON.stringify(p2.errors));
  source = p2.source;

  const derivedAmount = fixtures.paidAmount7dDerived('metric-paid-7d', 'mrev-paid-amount-1');
  const r3 = api.createMetricDraft(source, {...derivedAmount, revisionId: 'mrev-paid-7d-1', conceptId: 'concept-pay'});
  assert.equal(r3.ok, true, JSON.stringify(r3.errors));
  const p3 = api.publishMetricRevision(r3.source, 'mrev-paid-7d-1', {});
  assert.equal(p3.ok, true, JSON.stringify(p3.errors));
  source = p3.source;

  const derivedOrders = fixtures.paidOrders7dDerived('metric-paid-7d-orders', 'mrev-paid-orders-1');
  const r4 = api.createMetricDraft(source, {...derivedOrders, revisionId: 'mrev-paid-orders-7d-1'});
  assert.equal(r4.ok, true, JSON.stringify(r4.errors));
  const p4 = api.publishMetricRevision(r4.source, 'mrev-paid-orders-7d-1', {});
  assert.equal(p4.ok, true, JSON.stringify(p4.errors));
  source = p4.source;

  const compound = fixtures.aovCompound('metric-aov-7d', 'amount', 'orders', 'mrev-paid-7d-1', 'mrev-paid-orders-7d-1');
  const r5 = api.createMetricDraft(source, {...compound, revisionId: 'mrev-aov-7d-1'});
  assert.equal(r5.ok, true, JSON.stringify(r5.errors));
  const p5 = api.publishMetricRevision(r5.source, 'mrev-aov-7d-1', {});
  assert.equal(p5.ok, true, JSON.stringify(p5.errors));
  source = p5.source;
  return source;
}

// =====================================================================
// 1. 存储：缺失只读为空，不初始化样例；命名空间首写创建后稳定
// =====================================================================
test('存储：缺失时只读为空且不写入，命名空间首写创建后稳定', () => {
  const project = fixtures.baseProject();
  const before = JSON.stringify(project);
  const empty = api.readMetricPlatform(project);
  assert.equal(empty.namespace, null);
  assert.deepEqual(empty.definitions, []);
  assert.equal(project.profile.metricPlatform, undefined);
  assert.equal(JSON.stringify(project), before);
  assert.deepEqual(api.readMetricPlatform(null).definitions, []);

  const draft = api.createMetricDraft(project, {
    ...fixtures.paidAmountAtomic('metric-ns-1'), revisionId: 'mrev-ns-1', namespace: 'ns-retail',
  });
  assert.equal(draft.ok, true, JSON.stringify(draft.errors));
  assert.equal(api.readMetricPlatform(draft.source).namespace, 'ns-retail');
  // 第二次写入不传命名空间也保持稳定
  const again = api.updateMetricDraft(draft.source, 'mrev-ns-1',
    {spec: {...draft.revision.spec, description: '再改一版'}}, {});
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  assert.equal(api.readMetricPlatform(again.source).namespace, 'ns-retail');
});

test('存储：不支持的未来 schemaVersion 拒写并返回结构化错误', () => {
  const project = fixtures.baseProject();
  project.profile.metricPlatform = {schemaVersion: 99, definitions: [], revisions: []};
  const result = api.createMetricDraft(project, {
    ...fixtures.paidAmountAtomic('metric-x'), revisionId: 'mrev-x',
  });
  assert.equal(result.ok, false);
  assert.ok(errAt(result, 'SCHEMA_VERSION_UNSUPPORTED'));
});

// =====================================================================
// 2. 三类合法发布（合成订单模型）
// =====================================================================
test('主链路：原子/派生/复合三类合法发布，版本与 resolvedSpec 正确', () => {
  const source = buildMainProject();
  const amount = api.getMetricRevision(source, 'mrev-paid-amount-1');
  assert.equal(amount.version, '1.0');
  assert.equal(amount.status, 'published');
  assert.equal(amount.resolvedSpec.unit, 'CNY');
  assert.equal(amount.resolvedSpec.reAggregable, true);
  assert.equal(amount.resolvedSpec.computeReady, true);
  assert.equal(amount.resolvedSpec.designOnly, undefined);
  assert.deepEqual(amount.resolvedSpec.grain, ['dim-channel', 'dim-region']);

  const derived = api.getMetricRevision(source, 'mrev-paid-7d-1');
  assert.equal(derived.resolvedSpec.unit, 'CNY');
  assert.equal(derived.resolvedSpec.window.length, 7);
  assert.equal(derived.resolvedSpec.window.end, 'yesterday');
  assert.equal(derived.resolvedSpec.window.timezone, 'Asia/Shanghai');
  assert.deepEqual(derived.resolvedSpec.grain, ['dim-channel', 'dim-region']);

  const aov = api.getMetricRevision(source, 'mrev-aov-7d-1');
  assert.equal(aov.version, '1.0');
  assert.equal(aov.resolvedSpec.unit, 'CNY/ORDER');
  assert.equal(aov.resolvedSpec.reAggregable, false);
  assert.equal(aov.resolvedSpec.reAggregableReason, 'RATIO_NOT_SUMMABLE');
  assert.equal(aov.resolvedSpec.computeReady, true);
});

test('依赖：由定义/AST 派生，含固定 revision 与角色', () => {
  const source = buildMainProject();
  const aovDeps = api.getMetricDependencies(source, 'mrev-aov-7d-1');
  assert.deepEqual(aovDeps.map(item => [item.role, item.upstreamRevisionId, item.upstreamStatus]).sort(),
    [['OPERAND', 'mrev-paid-7d-1', 'published'], ['OPERAND', 'mrev-paid-orders-7d-1', 'published']].sort());
  const derivedDeps = api.getMetricDependencies(source, 'mrev-paid-7d-1');
  assert.deepEqual(derivedDeps.map(item => item.role), ['ATOMIC_BASE']);
});

// =====================================================================
// 3. 校验失败（结构化错误 code/path）
// =====================================================================
test('缺失字段：原子缺 aggregation 报 MISSING_FIELD 并定位路径', () => {
  const project = fixtures.baseProject();
  const spec = {...fixtures.paidAmountAtomic('metric-bad').spec};
  delete spec.aggregation;
  const created = api.createMetricDraft(project, {
    id: 'metric-bad', code: 'bad_1', name: '坏例子', scope: {kind: 'public'},
    ownerId: 'u', spec, revisionId: 'mrev-bad-1',
  });
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  const result = api.validateMetricDraft(created.source, 'mrev-bad-1');
  assert.equal(result.ok, false);
  assert.ok(errAt(result, 'MISSING_FIELD', 'spec.aggregation'));
});

test('未知引用：派生引用不存在/未发布的 revision 报 UNKNOWN/UNPUBLISHED', () => {
  const project = fixtures.baseProject();
  const unknown = api.createMetricDraft(project, {
    ...fixtures.paidAmount7dDerived('metric-unk', 'rev-nope'), revisionId: 'mrev-unk-1',
  });
  const published = api.publishMetricRevision(unknown.source, 'mrev-unk-1', {});
  assert.equal(published.ok, false);
  assert.ok(errAt(published, 'UNKNOWN_REFERENCE', 'spec.atomicRevisionId'));

  const draft = api.createMetricDraft(project, {
    ...fixtures.paidAmountAtomic('metric-src'), revisionId: 'mrev-src-draft',
  });
  const refDraft = api.createMetricDraft(draft.source, {
    ...fixtures.paidAmount7dDerived('metric-unk2', 'mrev-src-draft'), revisionId: 'mrev-unk2-1',
  });
  const pub = api.publishMetricRevision(refDraft.source, 'mrev-unk2-1', {});
  assert.ok(errAt(pub, 'UNPUBLISHED_REFERENCE', 'spec.atomicRevisionId'));
});

test('重复 code：同命名空间唯一，跨公共/部门也不得重复', () => {
  const source = buildMainProject();
  const dup = api.createMetricDraft(source, {
    ...fixtures.paidAmount7dDerived('metric-dup', 'mrev-paid-amount-1'), revisionId: 'mrev-dup-1',
  });
  assert.equal(dup.ok, false);
  assert.ok(errAt(dup, 'DUPLICATE_CODE', 'code'));
  const dept = api.createDepartmentMetricDraft(source, {
    baseRevisionId: 'mrev-paid-7d-1', departmentId: 'dept-ops', ownerId: 'u-ops',
    code: 'paid_amount_7d', patch: fixtures.opsPatch(),
  });
  assert.equal(dept.ok, false);
  assert.ok(errAt(dept, 'DUPLICATE_CODE', 'code'));
});

test('已发布不可变：对发布版直接编辑被拒绝，修订走新草案', () => {
  const source = buildMainProject();
  const denied = api.updateMetricDraft(source, 'mrev-paid-7d-1', {spec: {kind: 'derived'}}, {});
  assert.equal(denied.ok, false);
  assert.ok(errAt(denied, 'IMMUTABLE_PUBLISHED', 'revisionId'));
  const again = api.publishMetricRevision(source, 'mrev-paid-7d-1', {});
  assert.ok(errAt(again, 'IMMUTABLE_PUBLISHED'));
});

test('修订：新草案发布得 1.1，旧版本 1.0 原样可读', () => {
  const source = buildMainProject();
  const draft = api.createRevisionDraft(source, 'metric-paid-7d', {revisionId: 'mrev-paid-7d-2'});
  assert.equal(draft.ok, true, JSON.stringify(draft.errors));
  assert.equal(draft.revision.baseRevisionId, 'mrev-paid-7d-1');
  const edited = api.updateMetricDraft(draft.source, 'mrev-paid-7d-2', {
    spec: {...draft.revision.spec, window: {...fixtures.window7d, length: 30}},
  }, {expectedRevision: 1});
  assert.equal(edited.ok, true, JSON.stringify(edited.errors));
  const secondDraft = api.createRevisionDraft(edited.source, 'metric-paid-7d', {});
  assert.ok(errAt(secondDraft, 'ACTIVE_DRAFT_EXISTS'));
  const published = api.publishMetricRevision(edited.source, 'mrev-paid-7d-2', {expectedRevision: 2});
  assert.equal(published.ok, true, JSON.stringify(published.errors));
  assert.equal(published.version, '1.1');
  const old = api.getMetricRevision(published.source, 'mrev-paid-7d-1');
  assert.equal(old.version, '1.0');
  assert.equal(old.resolvedSpec.window.length, 7);
  assert.equal(api.getMetricRevision(published.source, 'mrev-paid-7d-2').resolvedSpec.window.length, 30);
});

test('并发：rev/etag 前置校验冲突，不发生后写覆盖', () => {
  const source = buildMainProject();
  const draft = api.createRevisionDraft(source, 'metric-paid-7d', {revisionId: 'mrev-cc-1'});
  const first = api.updateMetricDraft(draft.source, 'mrev-cc-1',
    {spec: {...draft.revision.spec, window: {...fixtures.window7d, length: 14}}}, {expectedRevision: 1});
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  assert.equal(first.revision.rev, 2);
  // 另一编辑方持旧 rev 针对最新 source 再写：拒绝且不发生后写覆盖
  const stale = api.updateMetricDraft(first.source, 'mrev-cc-1',
    {spec: {...draft.revision.spec, window: {...fixtures.window7d, length: 30}}}, {expectedRevision: 1});
  assert.equal(stale.ok, false);
  assert.ok(errAt(stale, 'REVISION_CONFLICT', 'rev'));
  const staleEtag = api.updateMetricDraft(first.source, 'mrev-cc-1',
    {spec: {...first.revision.spec, window: {...fixtures.window7d, length: 30}}},
    {expectedEtag: draft.revision.etag});
  assert.equal(staleEtag.ok, false);
  assert.ok(errAt(staleEtag, 'REVISION_CONFLICT', 'etag'));
  assert.equal(api.getMetricRevision(first.source, 'mrev-cc-1').spec.window.length, 14);
});

test('未知键：跨类型混填报 UNKNOWN_KEY', () => {
  const project = fixtures.baseProject();
  const atomicMixed = api.createMetricDraft(project, {
    id: 'metric-mix1', code: 'mix_1', name: '混填1', scope: {kind: 'public'}, ownerId: 'u',
    revisionId: 'mrev-mix-1',
    spec: {...fixtures.paidAmountAtomic('x').spec, window: fixtures.window7d},
  });
  const v1 = api.validateMetricDraft(atomicMixed.source, 'mrev-mix-1');
  assert.ok(errAt(v1, 'UNKNOWN_KEY', 'spec.window'));
  const derivedMixed = api.createMetricDraft(project, {
    id: 'metric-mix2', code: 'mix_2', name: '混填2', scope: {kind: 'public'}, ownerId: 'u',
    revisionId: 'mrev-mix-2',
    spec: {...fixtures.paidAmount7dDerived('x', 'mrev-mix-1').spec, aggregation: 'SUM'},
  });
  const v2 = api.validateMetricDraft(derivedMixed.source, 'mrev-mix-2');
  assert.ok(errAt(v2, 'UNKNOWN_KEY', 'spec.aggregation'));
});

// =====================================================================
// 4. 语义冲突：窗口/粒度/单位/循环/废弃/scope
// =====================================================================
function buildConflictProject() {
  let source = fixtures.baseProject();
  const steps = [
    ['mrev-amt-1', fixtures.paidAmountAtomic('metric-amt'), null],
    ['mrev-amt-7d-1', fixtures.paidAmount7dDerived('metric-amt-7d', 'mrev-amt-1'), null],
    ['mrev-amt-tdy-1', {
      id: 'metric-amt-tdy', code: 'paid_amount_today', name: '今日已支付金额', kind: 'derived',
      scope: {kind: 'public'}, ownerId: 'u',
      spec: {...fixtures.paidAmount7dDerived('metric-amt-tdy', 'mrev-amt-1').spec,
        name: '今日已支付金额', window: fixtures.windowToday},
    }, null],
    ['mrev-amt-chan-1', {
      id: 'metric-amt-chan', code: 'paid_amount_7d_chan', name: '渠道粒度金额', kind: 'derived',
      scope: {kind: 'public'}, ownerId: 'u',
      spec: {...fixtures.paidAmount7dDerived('metric-amt-chan', 'mrev-amt-1').spec,
        name: '渠道粒度金额', outputGrain: ['dim-channel']},
    }, null],
    ['mrev-ord-1', fixtures.paidOrdersAtomic('metric-ord'), null],
    ['mrev-ord-7d-1', fixtures.paidOrders7dDerived('metric-ord-7d', 'mrev-ord-1'), null],
  ];
  steps.forEach(([revisionId, def]) => {
    const created = api.createMetricDraft(source, {...def, revisionId});
    assert.equal(created.ok, true, JSON.stringify(created.errors));
    const published = api.publishMetricRevision(created.source, revisionId, {});
    assert.equal(published.ok, true, JSON.stringify(published.errors));
    source = published.source;
  });
  return source;
}

test('窗口冲突：分子今日、分母近7日被阻断并定位', () => {
  const source = buildConflictProject();
  const created = api.createMetricDraft(source, {
    id: 'metric-mixwin', code: 'mix_window', name: '混窗', kind: 'compound',
    scope: {kind: 'public'}, ownerId: 'u', revisionId: 'mrev-mixwin-1',
    spec: {
      kind: 'compound', name: '混窗',
      expression: 'SAFE_DIVIDE({{today}}, {{week}})',
      refs: [{key: 'today', revisionId: 'mrev-amt-tdy-1'}, {key: 'week', revisionId: 'mrev-amt-7d-1'}],
    },
  });
  const published = api.publishMetricRevision(created.source, 'mrev-mixwin-1', {});
  assert.equal(published.ok, false);
  assert.ok(errAt(published, 'WINDOW_CONFLICT'));
});

test('粒度冲突：输出粒度不一致被阻断', () => {
  const source = buildConflictProject();
  const created = api.createMetricDraft(source, {
    id: 'metric-mixgrain', code: 'mix_grain', name: '混粒度', kind: 'compound',
    scope: {kind: 'public'}, ownerId: 'u', revisionId: 'mrev-mixgrain-1',
    spec: {
      kind: 'compound', name: '混粒度',
      expression: 'SAFE_DIVIDE({{chan}}, {{full}})',
      refs: [{key: 'chan', revisionId: 'mrev-amt-chan-1'}, {key: 'full', revisionId: 'mrev-amt-7d-1'}],
    },
  });
  const published = api.publishMetricRevision(created.source, 'mrev-mixgrain-1', {});
  assert.ok(errAt(published, 'GRAIN_CONFLICT'));
});

test('单位冲突：CNY + ORDER 被阻断并推导单位规则', () => {
  const source = buildConflictProject();
  const created = api.createMetricDraft(source, {
    id: 'metric-mixunit', code: 'mix_unit', name: '混单位', kind: 'compound',
    scope: {kind: 'public'}, ownerId: 'u', revisionId: 'mrev-mixunit-1',
    spec: {
      kind: 'compound', name: '混单位',
      expression: '({{amount}} + {{orders}})',
      refs: [{key: 'amount', revisionId: 'mrev-amt-7d-1'}, {key: 'orders', revisionId: 'mrev-ord-7d-1'}],
    },
  });
  const published = api.publishMetricRevision(created.source, 'mrev-mixunit-1', {});
  assert.ok(errAt(published, 'UNIT_CONFLICT'));
  // 数值常量乘法不冲突且单位保持；除法推导 CNY/ORDER 见主链路测试
  const simple = api.createMetricDraft(source, {
    id: 'metric-unitok2', code: 'unit_ok2', name: '单位推导', kind: 'compound',
    scope: {kind: 'public'}, ownerId: 'u', revisionId: 'mrev-unitok2-1',
    spec: {
      kind: 'compound', name: '单位推导',
      expression: '{{a}} * 2',
      refs: [{key: 'a', revisionId: 'mrev-amt-7d-1'}],
    },
  });
  const pub2 = api.publishMetricRevision(simple.source, 'mrev-unitok2-1', {});
  assert.equal(pub2.ok, true, JSON.stringify(pub2.errors));
  assert.equal(pub2.revision.resolvedSpec.unit, 'CNY');
});

test('循环依赖：复合互相引用（版本链回环）被检出并给出路径', () => {
  const source = buildConflictProject();
  // C1 引用 amount7d（合法发布）
  const c1 = api.createMetricDraft(source, {
    id: 'metric-c1', code: 'c1', name: 'C1', kind: 'compound', scope: {kind: 'public'},
    ownerId: 'u', revisionId: 'mrev-c1-1',
    spec: {kind: 'compound', name: 'C1', expression: '{{a}} * 2',
      refs: [{key: 'a', revisionId: 'mrev-amt-7d-1'}]},
  });
  const pc1 = api.publishMetricRevision(c1.source, 'mrev-c1-1', {});
  assert.equal(pc1.ok, true, JSON.stringify(pc1.errors));
  // C2 引用 C1（合法发布）
  const c2 = api.createMetricDraft(pc1.source, {
    id: 'metric-c2', code: 'c2', name: 'C2', kind: 'compound', scope: {kind: 'public'},
    ownerId: 'u', revisionId: 'mrev-c2-1',
    spec: {kind: 'compound', name: 'C2', expression: 'SAFE_DIVIDE({{c1}}, {{c1}})',
      refs: [{key: 'c1', revisionId: 'mrev-c1-1'}]},
  });
  const pc2 = api.publishMetricRevision(c2.source, 'mrev-c2-1', {});
  assert.equal(pc2.ok, true, JSON.stringify(pc2.errors));
  // C1 新版引用 C2 → 定义级回环 → 阻断
  const c1v2 = api.createRevisionDraft(pc2.source, 'metric-c1', {revisionId: 'mrev-c1-2'});
  assert.equal(c1v2.ok, true, JSON.stringify(c1v2.errors));
  const switched = api.updateMetricDraft(c1v2.source, 'mrev-c1-2', {
    spec: {kind: 'compound', name: 'C1', expression: 'SAFE_DIVIDE({{c2}}, {{c2}})',
      refs: [{key: 'c2', revisionId: 'mrev-c2-1'}]},
  }, {expectedRevision: 1});
  assert.equal(switched.ok, true, JSON.stringify(switched.errors));
  const published = api.publishMetricRevision(switched.source, 'mrev-c1-2', {expectedRevision: 2});
  assert.equal(published.ok, false);
  const cycleError = (published.errors || []).filter(item => item.code === 'CYCLE_DEPENDENCY')[0];
  assert.ok(cycleError, JSON.stringify(published.errors));
  assert.deepEqual(cycleError.params.path, ['mrev-c1-2', 'mrev-c2-1', 'mrev-c1-1']);
});

test('废弃与 scope 策略：废弃引用阻断；公共不得依赖部门', () => {
  const source = buildMainProject();
  const deprecated = api.deprecateMetricDefinition(source, 'metric-paid-amount');
  assert.equal(deprecated.ok, true, JSON.stringify(deprecated.errors));
  const old = api.getMetricRevision(deprecated.source, 'mrev-paid-amount-1');
  assert.equal(old.status, 'deprecated'); // 历史仍可读
  const derived = api.createMetricDraft(deprecated.source, {
    id: 'metric-after-dep', code: 'after_dep', name: '废弃后引用', kind: 'derived',
    scope: {kind: 'public'}, ownerId: 'u', revisionId: 'mrev-after-dep-1',
    spec: {...fixtures.paidAmount7dDerived('x', 'mrev-paid-amount-1').spec, name: '废弃后引用'},
  });
  const published = api.publishMetricRevision(derived.source, 'mrev-after-dep-1', {});
  assert.ok(errAt(published, 'DEPRECATED_REFERENCE', 'spec.atomicRevisionId'));

  // 公共复合引用部门口径 → SCOPE_POLICY
  const main = buildMainProject();
  const dept = api.createDepartmentMetricDraft(main, {
    baseRevisionId: 'mrev-paid-7d-1', departmentId: 'dept-ops', ownerId: 'u-ops',
    code: 'ops.paid_amount_7d', patch: fixtures.opsPatch(),
    id: 'metric-ops-paid-7d', revisionId: 'mrev-ops-paid-7d-1',
  });
  assert.equal(dept.ok, true, JSON.stringify(dept.errors));
  const deptPub = api.publishMetricRevision(dept.source, 'mrev-ops-paid-7d-1', {});
  assert.equal(deptPub.ok, true, JSON.stringify(deptPub.errors));
  const publicRefDept = api.createMetricDraft(deptPub.source, {
    id: 'metric-pub-ref-dept', code: 'pub_ref_dept', name: '公共引用部门', kind: 'compound',
    scope: {kind: 'public'}, ownerId: 'u', revisionId: 'mrev-prd-1',
    spec: {kind: 'compound', name: '公共引用部门', expression: '{{d}} * 2',
      refs: [{key: 'd', revisionId: 'mrev-ops-paid-7d-1'}]},
  });
  const refused = api.publishMetricRevision(publicRefDept.source, 'mrev-prd-1', {});
  assert.ok(errAt(refused, 'SCOPE_POLICY'));
});

test('来源校验：模型/字段必须存在；限定维度必须已声明', () => {
  const project = fixtures.baseProject();
  const badModel = api.createMetricDraft(project, {
    id: 'm-badmodel', code: 'bad_model', name: '坏模型', scope: {kind: 'public'}, ownerId: 'u',
    revisionId: 'mrev-badmodel-1',
    spec: {...fixtures.paidAmountAtomic('x').spec, source: {modelId: 'entity-nope', fieldId: 'f'}},
  });
  assert.ok(errAt(api.validateMetricDraft(badModel.source, 'mrev-badmodel-1'),
    'UNKNOWN_REFERENCE', 'spec.source.modelId'));
  const badField = api.createMetricDraft(project, {
    id: 'm-badfield', code: 'bad_field', name: '坏字段', scope: {kind: 'public'}, ownerId: 'u',
    revisionId: 'mrev-badfield-1',
    spec: {...fixtures.paidAmountAtomic('x').spec,
      source: {modelId: 'entity-trade-order', fieldId: 'field-nope'}},
  });
  assert.ok(errAt(api.validateMetricDraft(badField.source, 'mrev-badfield-1'),
    'UNKNOWN_REFERENCE', 'spec.source.fieldId'));

  const source = buildMainProject();
  const dimUnknown = api.createMetricDraft(source, {
    id: 'm-baddim', code: 'bad_dim', name: '坏维度', kind: 'derived', scope: {kind: 'public'},
    ownerId: 'u', revisionId: 'mrev-baddim-1',
    spec: {...fixtures.paidAmount7dDerived('x', 'mrev-paid-amount-1').spec,
      name: '坏维度', qualifiers: [{dimensionId: 'dim-nope', op: 'eq', value: 1}]},
  });
  const dimError = api.publishMetricRevision(dimUnknown.source, 'mrev-baddim-1', {});
  assert.ok(errAt(dimError, 'UNKNOWN_DIMENSION', 'spec.qualifiers[0].dimensionId'));
});

test('表达式引用：未声明/未使用的 ref key 报错；AST 无 eval', () => {
  const source = buildConflictProject();
  const undeclared = api.createMetricDraft(source, {
    id: 'm-undecl', code: 'undecl', name: '未声明', kind: 'compound', scope: {kind: 'public'},
    ownerId: 'u', revisionId: 'mrev-undecl-1',
    spec: {kind: 'compound', name: '未声明', expression: '{{ghost}} + 1',
      refs: [{key: 'a', revisionId: 'mrev-amt-7d-1'}]},
  });
  assert.ok(errAt(api.validateMetricDraft(undeclared.source, 'mrev-undecl-1'),
    'UNKNOWN_REFERENCE', 'spec.expression'));
  const unused = api.createMetricDraft(source, {
    id: 'm-unused', code: 'unused', name: '未使用', kind: 'compound', scope: {kind: 'public'},
    ownerId: 'u', revisionId: 'mrev-unused-1',
    spec: {kind: 'compound', name: '未使用', expression: '{{a}} + 1',
      refs: [{key: 'a', revisionId: 'mrev-amt-7d-1'}, {key: 'b', revisionId: 'mrev-amt-tdy-1'}]},
  });
  const unusedResult = api.validateMetricDraft(unused.source, 'mrev-unused-1');
  assert.ok((unusedResult.errors || []).some(item => item.code === 'INVALID_VALUE'
    && item.path === 'spec.refs[1].key'));

  const ast = api.parseExpression('SAFE_DIVIDE({{a}}, 0.5)', 'spec.expression');
  assert.equal(api.evaluateExpression(ast, {a: 10}), 20);
  assert.equal(api.evaluateExpression(ast, {a: 10, b: 0}), 20);
  const zero = api.parseExpression('SAFE_DIVIDE({{a}}, {{b}})', 'x');
  assert.equal(api.evaluateExpression(zero, {a: 10, b: 0}), null);
  const plain = api.parseExpression('{{a}} / {{b}}', 'x');
  assert.ok(Number.isNaN(api.evaluateExpression(plain, {a: 1, b: 0})));
  assert.equal(api.astToText(api.parseExpression('({{a}} + 1) * 2', 'x')), '(({{a}} + 1) * 2)');
});

// =====================================================================
// 5. 设计态与窗口语义
// =====================================================================
test('设计态：无来源可发布为设计定义，标记未计算就绪', () => {
  const project = fixtures.baseProject();
  const spec = {...fixtures.paidAmountAtomic('m-design').spec};
  delete spec.source;
  const created = api.createMetricDraft(project, {
    id: 'm-design', code: 'design_amount', name: '设计态金额', scope: {kind: 'public'},
    ownerId: 'u', spec, revisionId: 'mrev-design-1',
  });
  const published = api.publishMetricRevision(created.source, 'mrev-design-1', {});
  assert.equal(published.ok, true, JSON.stringify(published.errors));
  assert.equal(published.revision.resolvedSpec.computeReady, false);
  assert.equal(published.revision.resolvedSpec.designOnly, true);
  // 依赖设计态原子的派生同样未就绪，但不冒充已执行
  const derived = api.createMetricDraft(published.source, {
    ...fixtures.paidAmount7dDerived('m-design-7d', 'mrev-design-1'), revisionId: 'mrev-design-7d-1',
    code: 'design_amount_7d',
  });
  const derivedPub = api.publishMetricRevision(derived.source, 'mrev-design-7d-1', {});
  assert.equal(derivedPub.ok, true, JSON.stringify(derivedPub.errors));
  assert.equal(derivedPub.revision.resolvedSpec.computeReady, false);
});

test('窗口语义：截至昨日 7 自然日 = [D-6 00:00, D+1 00:00)，不含今日', () => {
  // asOf=10-15 → D=昨日10-14 → [10-08, 10-15)，窗口不含 10-15（今日）
  const range = api.computeWindowRange(fixtures.window7d, '2026-10-15');
  assert.equal(range.startInclusive, '2026-10-08T00:00:00');
  assert.equal(range.endExclusive, '2026-10-15T00:00:00');
  assert.equal(range.timezone, 'Asia/Shanghai');
  const hours = api.computeWindowRange(
    {type: 'rollingHours', length: 48, end: 'today', timezone: 'Asia/Shanghai'}, '2026-10-15');
  assert.equal(hours.startInclusive, '2026-10-14T00:00:00.000Z');
  assert.equal(hours.endExclusive, '2026-10-16T00:00:00.000Z');
  const badWindow = api.validateWindow({type: 'lightYears', length: 0}, 'spec.window');
  assert.deepEqual(badWindow.map(item => item.code),
    ['INVALID_VALUE', 'INVALID_VALUE', 'MISSING_FIELD', 'MISSING_FIELD']);
});

// =====================================================================
// 6. 公共基线与部门快照
// =====================================================================
function buildDepartmentProject() {
  const main = buildMainProject();
  const dept = api.createDepartmentMetricDraft(main, {
    baseRevisionId: 'mrev-paid-7d-1', departmentId: 'dept-ops', ownerId: 'user-ops',
    code: 'ops.paid_amount_7d', name: '运营·近7日已支付金额',
    patch: {addQualifiers: [{dimensionId: 'dim-channel', op: 'eq', value: 'APP'}],
      restrictDimensions: ['dim-channel', 'dim-region'], display: {defaultChart: 'line'}},
    id: 'metric-ops-paid-7d', revisionId: 'mrev-ops-paid-7d-1',
  });
  assert.equal(dept.ok, true, JSON.stringify(dept.errors));
  const published = api.publishMetricRevision(dept.source, 'mrev-ops-paid-7d-1', {});
  assert.equal(published.ok, true, JSON.stringify(published.errors));
  return published.source;
}

test('部门口径：独立 ID、锁定基线、白名单 patch 与 resolvedSpec', () => {
  const source = buildDepartmentProject();
  const deptRev = api.getMetricRevision(source, 'mrev-ops-paid-7d-1');
  assert.equal(deptRev.version, '1.0');
  assert.notEqual(deptRev.definitionId, 'metric-paid-7d');
  assert.notEqual(deptRev.id, 'mrev-paid-7d-1');
  assert.deepEqual(deptRev.baseline, {definitionId: 'metric-paid-7d',
    revisionId: 'mrev-paid-7d-1', baseRevisionId: 'mrev-paid-7d-1'});
  assert.deepEqual(deptRev.patch.addQualifiers, [{dimensionId: 'dim-channel', op: 'eq', value: 'APP'}]);
  assert.deepEqual(deptRev.resolvedSpec.qualifiers, [{dimensionId: 'dim-channel', op: 'eq', value: 'APP'}]);
  assert.deepEqual(deptRev.resolvedSpec.grain, ['dim-channel', 'dim-region']);
  const definition = api.getMetricDefinition(source, 'metric-ops-paid-7d');
  assert.deepEqual(definition.definition.scope, {kind: 'department', departmentId: 'dept-ops'});
});

test('公共升级：部门旧版不动，提供差异与显式升级，不静默覆盖', () => {
  const source = buildDepartmentProject();
  // 公共发布 1.1（窗口 30 天）
  const draft = api.createRevisionDraft(source, 'metric-paid-7d', {revisionId: 'mrev-paid-7d-2'});
  const edited = api.updateMetricDraft(draft.source, 'mrev-paid-7d-2',
    {spec: {...draft.revision.spec, window: {...fixtures.window7d, length: 30}}}, {expectedRevision: 1});
  const publicV11 = api.publishMetricRevision(edited.source, 'mrev-paid-7d-2', {expectedRevision: 2});
  assert.equal(publicV11.ok, true, JSON.stringify(publicV11.errors));
  // 部门旧版原样：基线与 resolvedSpec 未被触碰
  const deptOld = api.getMetricRevision(publicV11.source, 'mrev-ops-paid-7d-1');
  assert.equal(deptOld.baseline.revisionId, 'mrev-paid-7d-1');
  assert.equal(deptOld.resolvedSpec.window.length, 7);
  assert.deepEqual(deptOld.resolvedSpec.qualifiers, [{dimensionId: 'dim-channel', op: 'eq', value: 'APP'}]);
  // 三方对比：公共变化可解释
  const compare = api.compareBaselineUpgrade(publicV11.source, 'mrev-ops-paid-7d-1', 'mrev-paid-7d-2');
  assert.equal(compare.ok, true, JSON.stringify(compare.errors));
  const windowChange = compare.publicChanges.filter(change => change.path === 'window.length')[0];
  assert.deepEqual([windowChange.left, windowChange.right], [7, 30]);
  assert.equal(compare.departmentDelta.some(change => change.path === 'qualifiers'), true);
  // 显式升级：新草案基线切到 1.1，旧部门发布版不动
  const upgrade = api.upgradeDepartmentDraft(publicV11.source, {
    departmentRevisionId: 'mrev-ops-paid-7d-1', candidateBaseRevisionId: 'mrev-paid-7d-2',
    revisionId: 'mrev-ops-paid-7d-2', createdBy: 'user-ops',
  });
  assert.equal(upgrade.ok, true, JSON.stringify(upgrade.errors));
  assert.equal(upgrade.revision.baseline.baseRevisionId, 'mrev-paid-7d-2');
  assert.deepEqual(upgrade.revision.patch.addQualifiers,
    [{dimensionId: 'dim-channel', op: 'eq', value: 'APP'}]);
  const upgraded = api.publishMetricRevision(upgrade.source, 'mrev-ops-paid-7d-2', {expectedRevision: 1});
  assert.equal(upgraded.ok, true, JSON.stringify(upgraded.errors));
  assert.equal(upgraded.version, '1.1');
  assert.equal(upgraded.revision.resolvedSpec.window.length, 30);
  const untouched = api.getMetricRevision(upgraded.source, 'mrev-ops-paid-7d-1');
  assert.equal(untouched.resolvedSpec.window.length, 7);
});

test('升级冲突：patch 重放到候选失败时不写入、不做深 merge', () => {
  const source = buildDepartmentProject();
  // 公共 1.2 收窄输出粒度，部门 restrictDimensions 的 dim-channel 失效
  const draft = api.createRevisionDraft(source, 'metric-paid-7d', {revisionId: 'mrev-paid-7d-3'});
  const edited = api.updateMetricDraft(draft.source, 'mrev-paid-7d-3',
    {spec: {...draft.revision.spec, outputGrain: ['dim-region']}}, {expectedRevision: 1});
  const publicV12 = api.publishMetricRevision(edited.source, 'mrev-paid-7d-3', {expectedRevision: 2});
  assert.equal(publicV12.ok, true, JSON.stringify(publicV12.errors));
  const before = JSON.stringify(api.readMetricPlatform(publicV12.source).revisions);
  const upgrade = api.upgradeDepartmentDraft(publicV12.source, {
    departmentRevisionId: 'mrev-ops-paid-7d-1', candidateBaseRevisionId: 'mrev-paid-7d-3',
    revisionId: 'mrev-ops-paid-7d-3',
  });
  assert.equal(upgrade.ok, false);
  assert.ok(errAt(upgrade, 'UNKNOWN_DIMENSION', 'patch.restrictDimensions[0]'));
  assert.equal(JSON.stringify(api.readMetricPlatform(publicV12.source).revisions), before);
});

test('patch 白名单：语义键要求显式分叉，未知键拒绝', () => {
  const source = buildMainProject();
  const semantic = api.createDepartmentMetricDraft(source, {
    baseRevisionId: 'mrev-paid-7d-1', departmentId: 'dept-fin', ownerId: 'u-fin',
    code: 'fin.paid_amount_7d', patch: {unit: 'USD'},
  });
  assert.ok(errAt(semantic, 'SEMANTIC_CHANGE_REQUIRES_FORK', 'patch.unit'));
  const unknown = api.createDepartmentMetricDraft(source, {
    baseRevisionId: 'mrev-paid-7d-1', departmentId: 'dept-fin', ownerId: 'u-fin',
    code: 'fin.paid_amount_7d', patch: {atomicRevisionId: 'mrev-paid-orders-1'},
  });
  assert.ok(errAt(unknown, 'SEMANTIC_CHANGE_REQUIRES_FORK', 'patch.atomicRevisionId'));
  const weird = api.createDepartmentMetricDraft(source, {
    baseRevisionId: 'mrev-paid-7d-1', departmentId: 'dept-fin', ownerId: 'u-fin',
    code: 'fin.paid_amount_7d', patch: {whatever: 1},
  });
  assert.ok(errAt(weird, 'PATCH_KEY_NOT_ALLOWED', 'patch.whatever'));
  const dupQualifier = api.createDepartmentMetricDraft(source, {
    baseRevisionId: 'mrev-paid-7d-1', departmentId: 'dept-fin', ownerId: 'u-fin',
    code: 'fin.paid_amount_7d', patch: fixtures.opsPatch(),
  });
  assert.equal(dupQualifier.ok, true); // 基线 qualifiers 为空，新增 APP 合法
});

// =====================================================================
// 7. 数据保护、目录与序列化
// =====================================================================
test('写入保护：profile 其他键、模型资产与 metricPlatform 未知键全部保留', () => {
  const source = buildDepartmentProject();
  // 注入未知键（模拟未来版本数据）
  const withFuture = JSON.parse(JSON.stringify(source));
  withFuture.profile.metricPlatform.futureKey = {keep: true};
  withFuture.profile.otherModule = {keep: 1};
  const draft = api.createRevisionDraft(withFuture, 'metric-paid-7d', {revisionId: 'mrev-keep-1'});
  assert.equal(draft.ok, true, JSON.stringify(draft.errors));
  const store = api.readMetricPlatform(draft.source);
  assert.deepEqual(store.futureKey, {keep: true});
  assert.deepEqual(draft.source.profile.otherModule, {keep: 1});
  assert.deepEqual(draft.source.profile.modelCatalog, source.profile.modelCatalog);
  assert.deepEqual(draft.source.profile.default, source.profile.default);
  assert.equal(draft.source.entities, withFuture.entities); // 模型数组同一引用不复制不丢失
  assert.equal(draft.source.diagrams, withFuture.diagrams);
  assert.equal(draft.source.viewGroups, withFuture.viewGroups);
  assert.equal(draft.source.dicts, withFuture.dicts);
  assert.deepEqual(draft.source.logicEntities, withFuture.logicEntities);
});

test('目录检索：kind/scope/搜索过滤正确', () => {
  const source = buildDepartmentProject();
  const all = api.listMetricDefinitions(source, {});
  assert.equal(all.length, 6);
  const compounds = api.listMetricDefinitions(source, {kind: 'compound'});
  assert.deepEqual(compounds.map(item => item.definition.code), ['app_aov_7d']);
  const departments = api.listMetricDefinitions(source,
    {scope: {kind: 'department', departmentId: 'dept-ops'}});
  assert.deepEqual(departments.map(item => item.definition.code), ['ops.paid_amount_7d']);
  const searched = api.listMetricDefinitions(source, {search: '客单价'});
  assert.deepEqual(searched.map(item => item.definition.code), ['app_aov_7d']);
  const atomicPublished = api.listMetricDefinitions(source, {kind: 'atomic'});
  assert.equal(atomicPublished[0].publishedCount, 1);
  assert.equal(atomicPublished[0].draft, null);
});

test('序列化重读：JSON 往返后全部读取一致', () => {
  const source = buildDepartmentProject();
  const roundTrip = JSON.parse(JSON.stringify(source));
  assert.deepEqual(api.readMetricPlatform(roundTrip), api.readMetricPlatform(source));
  ['mrev-paid-amount-1', 'mrev-paid-7d-1', 'mrev-aov-7d-1', 'mrev-ops-paid-7d-1'].forEach((id) => {
    assert.deepEqual(api.getMetricRevision(roundTrip, id), api.getMetricRevision(source, id));
  });
  assert.deepEqual(api.getMetricDependencies(roundTrip, 'mrev-aov-7d-1'),
    api.getMetricDependencies(source, 'mrev-aov-7d-1'));
});

test('类型切换：无发布版本的新草案可切换，已有发布版本后拒绝', () => {
  const project = fixtures.baseProject();
  const created = api.createMetricDraft(project, {
    ...fixtures.paidAmountAtomic('metric-switch'), revisionId: 'mrev-switch-1',
  });
  const switched = api.updateMetricDraft(created.source, 'mrev-switch-1', {
    spec: {kind: 'derived', name: '切换', atomicRevisionId: 'x',
      window: fixtures.window7d, qualifiers: [], outputGrain: []},
  }, {expectedRevision: 1});
  assert.equal(switched.ok, true, JSON.stringify(switched.errors));
  assert.equal(api.getMetricDefinition(switched.source, 'metric-switch').definition.kind, 'derived');
  // 发布后不可再切
  const published = api.publishMetricRevision(switched.source, 'mrev-switch-1', {expectedRevision: 2});
  assert.equal(published.ok, false, '引用 x 不存在，发布失败符合预期');
  const draft2 = api.updateMetricDraft(switched.source, 'mrev-switch-1', {
    spec: fixtures.paidAmountAtomic('x').spec,
  }, {expectedRevision: 2});
  assert.equal(draft2.ok, true, JSON.stringify(draft2.errors));
  const fixed = api.updateMetricDraft(draft2.source, 'mrev-switch-1', {
    spec: {...fixtures.paidAmountAtomic('x').spec, name: '切换回原子'},
  }, {expectedRevision: 3});
  const publishedAtomic = api.publishMetricRevision(fixed.source, 'mrev-switch-1', {expectedRevision: 4});
  assert.equal(publishedAtomic.ok, true, JSON.stringify(publishedAtomic.errors));
  const next = api.createRevisionDraft(publishedAtomic.source, 'metric-switch', {revisionId: 'mrev-switch-2'});
  const denySwitch = api.updateMetricDraft(next.source, 'mrev-switch-2', {
    spec: {kind: 'derived', name: '再切', atomicRevisionId: 'x',
      window: fixtures.window7d, qualifiers: [], outputGrain: []},
  }, {expectedRevision: 1});
  assert.equal(denySwitch.ok, false);
  assert.ok(errAt(denySwitch, 'INVALID_VALUE', 'spec.kind'));
});

test('错误结构：包含 code/path/messageKey，UI 可解释定位', () => {
  const project = fixtures.baseProject();
  const created = api.createMetricDraft(project, {
    id: 'm-errshape', code: 'err_shape', name: '错误形状', scope: {kind: 'public'}, ownerId: 'u',
    revisionId: 'mrev-errshape-1', spec: {kind: 'atomic', name: '错误形状'},
  });
  const result = api.validateMetricDraft(created.source, 'mrev-errshape-1');
  assert.equal(result.ok, false);
  (result.errors || []).forEach((item) => {
    assert.equal(typeof item.code, 'string');
    assert.equal(typeof item.path, 'string');
    assert.equal(typeof item.messageKey, 'string');
  });
  assert.ok((result.errors || []).length >= 5);
});

// =====================================================================
// 8. R1 边界整改：命名空间一致 / 显式ID唯一 / 快照引用隔离 / 基础限定传播
// =====================================================================
test('R1 命名空间：首写定义与注册表同命名空间，后续定义沿用', () => {
  const project = fixtures.baseProject();
  const first = api.createMetricDraft(project,
    {...fixtures.paidAmountAtomic('metric-ns-a'), revisionId: 'mrev-ns-a'});
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  const store = api.readMetricPlatform(first.source);
  assert.notEqual(store.namespace, null);
  assert.equal(first.definition.namespace, store.namespace); // 首个定义即一致
  const second = api.createMetricDraft(first.source,
    {...fixtures.paidOrdersAtomic('metric-ns-b'), revisionId: 'mrev-ns-b'});
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  assert.equal(second.definition.namespace, store.namespace); // 后续定义沿用
  assert.equal(api.readMetricPlatform(second.source).namespace, store.namespace);
});

test('R1 显式ID唯一：定义/修订ID碰撞拒绝；createRevisionDraft与部门升级同样检查', () => {
  const source = buildMainProject();
  const dupDefinition = api.createMetricDraft(source, {
    ...fixtures.paidOrdersAtomic('metric-paid-orders'), code: 'other_code', revisionId: 'mrev-new-1',
  });
  assert.equal(dupDefinition.ok, false);
  assert.ok(errAt(dupDefinition, 'DUPLICATE_ID', 'id'));
  const dupRevision = api.createMetricDraft(source, {
    ...fixtures.paidOrdersAtomic('metric-new-2'), code: 'new_code_2', revisionId: 'mrev-paid-orders-1',
  });
  assert.equal(dupRevision.ok, false);
  assert.ok(errAt(dupRevision, 'DUPLICATE_ID', 'revisionId'));
  const dupRevisionDraft = api.createRevisionDraft(source, 'metric-paid-7d',
    {revisionId: 'mrev-paid-orders-1'});
  assert.ok(errAt(dupRevisionDraft, 'DUPLICATE_ID', 'revisionId'));
  const dupUpgrade = api.upgradeDepartmentDraft(buildDepartmentProject(), {
    departmentRevisionId: 'mrev-ops-paid-7d-1', candidateBaseRevisionId: 'mrev-paid-7d-1',
    revisionId: 'mrev-ops-paid-7d-1',
  });
  assert.ok(errAt(dupUpgrade, 'DUPLICATE_ID', 'revisionId'));
});

test('R1 快照隔离：输入/旧草案/表单引用不改变已落盘草案与发布快照', () => {
  const project = fixtures.baseProject();
  const input = fixtures.paidAmountAtomic('metric-iso');
  const created = api.createMetricDraft(project, {...input, revisionId: 'mrev-iso-1'});
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  assert.notEqual(created.revision.spec, input.spec); // 写入命令返回副本，不共享输入引用
  const published = api.publishMetricRevision(created.source, 'mrev-iso-1', {});
  assert.equal(published.ok, true, JSON.stringify(published.errors));
  const hashBefore = published.revision.hash;
  input.spec.unit = 'USD';       // 修改旧输入 spec
  created.revision.spec.unit = 'EUR'; // 修改旧草案返回对象
  const stored = api.getMetricRevision(published.source, 'mrev-iso-1');
  assert.equal(stored.spec.unit, 'CNY'); // 发布快照不被旧引用改变
  assert.equal(stored.resolvedSpec.unit, 'CNY');
  assert.equal(stored.hash, hashBefore);
  assert.equal(stored.hash, api.hashValue({spec: stored.spec, resolvedSpec: stored.resolvedSpec}));
  // 修订路径同样隔离：patch.spec 写入后，表单对象再变不影响草案
  const c2 = api.createMetricDraft(project,
    {...fixtures.paidAmountAtomic('metric-iso2'), revisionId: 'mrev-iso-2'});
  const formSpec = {...c2.revision.spec, description: '表单编辑中'};
  const updated = api.updateMetricDraft(c2.source, 'mrev-iso-2', {spec: formSpec}, {});
  assert.equal(updated.ok, true, JSON.stringify(updated.errors));
  formSpec.unit = 'USD';
  const storedDraft = api.getMetricRevision(updated.source, 'mrev-iso-2');
  assert.equal(storedDraft.spec.unit, 'CNY');
  assert.equal(storedDraft.spec.description, '表单编辑中');
});

test('R1 基础限定传播：resolvedSpec 携带完整来源语义，复合继承有效语义', () => {
  const source = buildMainProject();
  const derived = api.getMetricRevision(source, 'mrev-paid-7d-1');
  assert.deepEqual(derived.resolvedSpec.baseQualifiers, [
    {dimensionId: 'dim-status', op: 'eq', value: 'PAID'},
    {dimensionId: 'dim-is-test', op: 'eq', value: false},
    {dimensionId: 'dim-is-void', op: 'eq', value: false},
  ]);
  assert.equal(derived.resolvedSpec.timeRole, '支付时间');
  assert.equal(derived.resolvedSpec.timezone, 'Asia/Shanghai');
  assert.deepEqual(derived.resolvedSpec.qualifiers, []); // 自有限定与基础限定分层保留
  const aov = api.getMetricRevision(source, 'mrev-aov-7d-1');
  assert.equal(aov.status, 'published'); // 主链两原子同排除作废单，一致可发布
  assert.deepEqual(aov.resolvedSpec.baseQualifiers, derived.resolvedSpec.baseQualifiers);
  assert.equal(aov.resolvedSpec.timeRole, '支付时间');
  assert.equal(aov.resolvedSpec.timezone, 'Asia/Shanghai');
});

test('R1 口径不一致拒绝：基础限定不同 QUALIFIER_CONFLICT；时间轴不同 TIME_ROLE_CONFLICT', () => {
  // 金额原子排除作废单，计数原子不排除 → 有效统计语义不同，不得伪作同口径
  let source = fixtures.baseProject();
  const steps = [
    ['mrev-amt-1', fixtures.paidAmountAtomic('metric-amt')],
    ['mrev-amt-7d-1', fixtures.paidAmount7dDerived('metric-amt-7d', 'mrev-amt-1')],
    ['mrev-ordv-1', fixtures.paidOrdersWithVoidAtomic('metric-ordv')],
    ['mrev-ordv-7d-1', fixtures.paidOrders7dDerived('metric-ordv-7d', 'mrev-ordv-1')],
  ];
  steps.forEach(([revisionId, def]) => {
    const created = api.createMetricDraft(source, {...def, revisionId});
    assert.equal(created.ok, true, JSON.stringify(created.errors));
    const published = api.publishMetricRevision(created.source, revisionId, {});
    assert.equal(published.ok, true, JSON.stringify(published.errors));
    source = published.source;
  });
  const mixed = api.createMetricDraft(source, {
    ...fixtures.aovCompound('metric-mixqv', 'amount', 'orders', 'mrev-amt-7d-1', 'mrev-ordv-7d-1'),
    revisionId: 'mrev-mixqv-1',
  });
  const refused = api.publishMetricRevision(mixed.source, 'mrev-mixqv-1', {});
  assert.equal(refused.ok, false);
  assert.ok(errAt(refused, 'QUALIFIER_CONFLICT'));

  // 支付时间轴 vs 下单时间轴：同窗口不同时间角色 → TIME_ROLE_CONFLICT
  let src2 = fixtures.baseProject();
  const steps2 = [
    ['mrev-pay-1', fixtures.paidAmountAtomic('metric-pay')],
    ['mrev-pay-7d-1', fixtures.paidAmount7dDerived('metric-pay-7d', 'mrev-pay-1')],
    ['mrev-oa-1', fixtures.paidAmountOrderedAtAtomic('metric-oa')],
    ['mrev-oa-7d-1', {...fixtures.paidAmount7dDerived('metric-oa-7d', 'mrev-oa-1'),
      code: 'ordered_amount_7d'}],
  ];
  steps2.forEach(([revisionId, def]) => {
    const created = api.createMetricDraft(src2, {...def, revisionId});
    assert.equal(created.ok, true, JSON.stringify(created.errors));
    const published = api.publishMetricRevision(created.source, revisionId, {});
    assert.equal(published.ok, true, JSON.stringify(published.errors));
    src2 = published.source;
  });
  const mixedRole = api.createMetricDraft(src2, {
    ...fixtures.aovCompound('metric-mixtr', 'pay', 'ordered', 'mrev-pay-7d-1', 'mrev-oa-7d-1'),
    revisionId: 'mrev-mixtr-1',
  });
  const refusedRole = api.publishMetricRevision(mixedRole.source, 'mrev-mixtr-1', {});
  assert.equal(refusedRole.ok, false);
  assert.ok(errAt(refusedRole, 'TIME_ROLE_CONFLICT'));
});

// =====================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach(({name, error}) => {
    console.log(`\n--- ${name}`);
    console.log(error && error.stack ? error.stack : error);
  });
  process.exit(1);
}
