// 分叉口径测试（MET-01 / MET-02）：分叉定义可继续修订、升级不再静默覆盖分叉。
// 复跑：node tests/metrics/fork-test.cjs（仓库根目录）。合成数据，真实加载 src/lib/metric_platform。
const assert = require('assert/strict');
const {loadMetricApi} = require('./loader.cjs');

const api = loadMetricApi();
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

const ok = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result;
};

// 公共原子 + 公共派生(近7日)已发布；再建部门定义并发布 v1.0（fork 可选）
const buildProject = (deptInput) => {
  let source = fixtures.baseProject();
  source = ok(api.createMetricDraft(source, {
    ...fixtures.paidAmountAtomic('metric-fk-amount'), revisionId: 'mrev-fk-amount-1',
  })).source;
  source = ok(api.publishMetricRevision(source, 'mrev-fk-amount-1', {})).source;
  source = ok(api.createMetricDraft(source, {
    ...fixtures.paidAmount7dDerived('metric-fk-7d', 'mrev-fk-amount-1'), revisionId: 'mrev-fk-7d-1',
  })).source;
  source = ok(api.publishMetricRevision(source, 'mrev-fk-7d-1', {})).source;
  source = ok(api.createDepartmentMetricDraft(source, {
    baseRevisionId: 'mrev-fk-7d-1', departmentId: 'dept-ops', ownerId: 'user-ops',
    code: 'ops.fk_paid_7d', id: 'metric-fk-dept', revisionId: 'mrev-fk-dept-1',
    patch: {}, ...deptInput,
  })).source;
  source = ok(api.publishMetricRevision(source, 'mrev-fk-dept-1', {})).source;
  return source;
};

// 公共发布 v1.1（窗口 14 天），作为升级候选
const publishPublicV11 = (source) => {
  const draft = ok(api.createRevisionDraft(source, 'metric-fk-7d', {revisionId: 'mrev-fk-7d-2'}));
  const edited = ok(api.updateMetricDraft(draft.source, 'mrev-fk-7d-2',
    {spec: {...draft.revision.spec, window: {...fixtures.window7d, length: 14}}}, {expectedRevision: 1}));
  return ok(api.publishMetricRevision(edited.source, 'mrev-fk-7d-2', {expectedRevision: 2})).source;
};

test('MET-02：分叉修订草案继承 fork/forkNote，核心语义可改并发布', () => {
  const source = buildProject({fork: true, forkNote: 'x'});
  const draft = ok(api.createRevisionDraft(source, 'metric-fk-dept', {revisionId: 'mrev-fk-dept-2'}));
  assert.equal(draft.revision.fork, true);
  assert.equal(draft.revision.forkNote, 'x');
  const edited = api.updateMetricDraft(draft.source, 'mrev-fk-dept-2',
    {spec: {...draft.revision.spec, window: {...fixtures.window7d, length: 30}}}, {expectedRevision: 1});
  assert.equal(edited.ok, true, JSON.stringify(edited.errors));
  const published = ok(api.publishMetricRevision(edited.source, 'mrev-fk-dept-2', {expectedRevision: 2}));
  assert.equal(published.revision.version, '1.1');
  assert.equal(published.revision.fork, true);
  assert.equal(published.revision.resolvedSpec.window.length, 30);
});

test('MET-01：分叉部门修订拒绝升级，不产生新草案、存储不变', () => {
  let source = buildProject({fork: true, forkNote: 'x'});
  const draft = ok(api.createRevisionDraft(source, 'metric-fk-dept', {revisionId: 'mrev-fk-dept-2'}));
  const edited = ok(api.updateMetricDraft(draft.source, 'mrev-fk-dept-2',
    {spec: {...draft.revision.spec, window: {...fixtures.window7d, length: 30}}}, {expectedRevision: 1}));
  source = ok(api.publishMetricRevision(edited.source, 'mrev-fk-dept-2', {expectedRevision: 2})).source;
  source = publishPublicV11(source);
  const before = JSON.stringify(source);
  const countBefore = api.readMetricPlatform(source).revisions.length;
  const result = api.upgradeDepartmentDraft(source, {
    departmentRevisionId: 'mrev-fk-dept-2', candidateBaseRevisionId: 'mrev-fk-7d-2',
    revisionId: 'mrev-fk-dept-3',
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'FORK_NOT_UPGRADABLE');
  assert.equal(result.errors[0].messageKey, 'metric.error.forkNotUpgradable');
  assert.equal(result.errors[0].path, 'departmentRevisionId');
  assert.equal(result.source, undefined); // 拒绝时不返回新存储
  assert.equal(api.readMetricPlatform(source).revisions.length, countBefore);
  assert.equal(JSON.stringify(source), before);
  // 分叉自己的 30 天窗口保持不变
  assert.equal(api.getMetricRevision(source, 'mrev-fk-dept-2').resolvedSpec.window.length, 30);
});

test('非分叉部门升级既有行为不变；非分叉草案不带 fork 键', () => {
  let source = buildProject({});
  const draft = ok(api.createRevisionDraft(source, 'metric-fk-dept', {revisionId: 'mrev-fk-dept-2'}));
  assert.equal(Object.prototype.hasOwnProperty.call(draft.revision, 'fork'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(draft.revision, 'forkNote'), false);
  // 非分叉草案改核心语义仍被拒绝
  const rejected = api.updateMetricDraft(draft.source, 'mrev-fk-dept-2',
    {spec: {...draft.revision.spec, window: {...fixtures.window7d, length: 30}}}, {expectedRevision: 1});
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errors[0].code, 'SEMANTIC_CHANGE_REQUIRES_FORK');
  // 放弃该草案后走升级：基线切到公共 v1.1，窗口随公共变为 14
  source = publishPublicV11(buildProject({}));
  const upgrade = ok(api.upgradeDepartmentDraft(source, {
    departmentRevisionId: 'mrev-fk-dept-1', candidateBaseRevisionId: 'mrev-fk-7d-2',
    revisionId: 'mrev-fk-dept-up',
  }));
  assert.equal(upgrade.revision.baseline.baseRevisionId, 'mrev-fk-7d-2');
  const published = ok(api.publishMetricRevision(upgrade.source, 'mrev-fk-dept-up', {expectedRevision: 1}));
  assert.equal(published.revision.resolvedSpec.window.length, 14);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach(({name, error}) => {
    console.log(`\n--- ${name}`);
    console.log(error && error.stack ? error.stack : error);
  });
  process.exit(1);
}
