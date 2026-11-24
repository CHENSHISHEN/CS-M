// 草案丢弃与废弃语义测试（MET-14 / MET-07，决策 D2）：
// - discardMetricDraft：从未发布的定义连同定义删除（释放 code），已发布定义只删草案，并发校验；
// - listDefinitionDependents：汇总定义全部版本的下游依赖；
// - 基于已废弃版本修订并发布后定义级废弃解除，版本号取最大值+1；活动草案仍受保护。
// 复跑：node tests/metrics/discard-deprecate-test.cjs（仓库根目录）。合成数据，真实加载 src/lib/metric_platform。
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

const DEF_ID = 'metric-dd-amount';

// 已发布 v1.0 的公共原子
const atomicWithV10 = () => {
  const created = ok(api.createMetricDraft(fixtures.baseProject(), {
    ...fixtures.paidAmountAtomic(DEF_ID), revisionId: 'mrev-dd-amount-0',
  }));
  return ok(api.publishMetricRevision(created.source, 'mrev-dd-amount-0', {})).source;
};

// 在 v1.0 基础上再发布 v1.1（两个已发布版本）
const atomicWithTwoVersions = () => {
  const source = atomicWithV10();
  const draft = ok(api.createRevisionDraft(source, DEF_ID, {revisionId: 'mrev-dd-amount-1'}));
  return ok(api.publishMetricRevision(draft.source, 'mrev-dd-amount-1', {})).source;
};

// 两个下游派生，各依赖原子的一个版本
const withTwoDependents = () => {
  let source = atomicWithTwoVersions();
  source = ok(api.createMetricDraft(source, {
    ...fixtures.paidAmount7dDerived('metric-dd-7d-a', 'mrev-dd-amount-0'),
    code: 'paid_amount_7d_a', revisionId: 'mrev-dd-7d-a',
  })).source;
  source = ok(api.publishMetricRevision(source, 'mrev-dd-7d-a', {})).source;
  source = ok(api.createMetricDraft(source, {
    ...fixtures.paidAmount7dDerived('metric-dd-7d-b', 'mrev-dd-amount-1'),
    code: 'paid_amount_7d_b', revisionId: 'mrev-dd-7d-b',
  })).source;
  return ok(api.publishMetricRevision(source, 'mrev-dd-7d-b', {})).source;
};

const statusOf = (source, revisionId) => api.getMetricRevision(source, revisionId).status;

test('(a) 写错 code 的从未发布草案：丢弃后定义一并删除，可用同 code 再建', () => {
  const created = ok(api.createMetricDraft(fixtures.baseProject(), {
    ...fixtures.paidAmountAtomic('metric-dd-typo'), code: 'paid_amuont', revisionId: 'mrev-dd-typo',
  }));
  // 丢弃前 code 被占用
  assert.equal(api.createMetricDraft(created.source, {
    ...fixtures.paidAmountAtomic('metric-dd-typo2'), code: 'paid_amuont', revisionId: 'mrev-dd-typo2',
  }).errors[0].code, 'DUPLICATE_CODE');
  const discarded = ok(api.discardMetricDraft(created.source, 'metric-dd-typo', {expectedRevision: 1}));
  assert.equal(api.getMetricDefinition(discarded.source, 'metric-dd-typo'), null);
  assert.equal(api.getMetricRevision(discarded.source, 'mrev-dd-typo'), null);
  assert.equal(api.listMetricRevisions(discarded.source, {definitionId: 'metric-dd-typo'}).length, 0);
  // 同 code 重新创建（code 已释放）
  const again = api.createMetricDraft(discarded.source, {
    ...fixtures.paidAmountAtomic('metric-dd-typo2'), code: 'paid_amuont', revisionId: 'mrev-dd-typo2',
  });
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  // profile 其他键与模型集合原样保留
  assert.deepEqual(discarded.source.entities, created.source.entities);
  assert.deepEqual(discarded.source.profile.default, created.source.profile.default);
});

test('(a2) expectedRevision 不符返回 REVISION_CONFLICT，存储不变', () => {
  const created = ok(api.createMetricDraft(fixtures.baseProject(), {
    ...fixtures.paidAmountAtomic('metric-dd-conflict'), revisionId: 'mrev-dd-conflict',
  }));
  const edited = ok(api.updateMetricDraft(created.source, 'mrev-dd-conflict',
    {name: '改名'}, {expectedRevision: 1}));
  const before = JSON.stringify(edited.source);
  const result = api.discardMetricDraft(edited.source, 'metric-dd-conflict', {expectedRevision: 1});
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'REVISION_CONFLICT');
  assert.equal(result.errors[0].messageKey, 'metric.error.revisionConflict');
  assert.equal(JSON.stringify(edited.source), before);
  // 正确 rev 可丢弃
  ok(api.discardMetricDraft(edited.source, 'metric-dd-conflict', {expectedRevision: 2}));
});

test('(a3) 没有草案 / 定义不存在：ok:false 且存储不变；损坏存储走写前守卫', () => {
  const source = atomicWithV10();
  const before = JSON.stringify(source);
  const noDraft = api.discardMetricDraft(source, DEF_ID, {});
  assert.equal(noDraft.ok, false);
  assert.equal(noDraft.errors[0].code, 'INVALID_VALUE');
  const missing = api.discardMetricDraft(source, 'metric-nope', {});
  assert.equal(missing.ok, false);
  assert.equal(missing.errors[0].code, 'UNKNOWN_REFERENCE');
  assert.equal(JSON.stringify(source), before);
  const corrupt = JSON.parse(before);
  corrupt.profile.metricPlatform.revisions = 'x';
  const guarded = api.discardMetricDraft(corrupt, DEF_ID, {});
  assert.equal(guarded.ok, false);
  assert.equal(guarded.errors[0].code, 'STORE_CORRUPT');
});

test('(b) 已发布定义的草案被丢弃：只删草案，已发布版本不变，可再 createRevisionDraft', () => {
  const source = atomicWithV10();
  const published = JSON.stringify(api.getMetricRevision(source, 'mrev-dd-amount-0'));
  const draft = ok(api.createRevisionDraft(source, DEF_ID, {revisionId: 'mrev-dd-draft'}));
  const discarded = ok(api.discardMetricDraft(draft.source, DEF_ID, {expectedRevision: 1}));
  const detail = api.getMetricDefinition(discarded.source, DEF_ID);
  assert.notEqual(detail, null);
  assert.equal(detail.draft, null);
  assert.equal(api.getMetricRevision(discarded.source, 'mrev-dd-draft'), null);
  assert.equal(JSON.stringify(api.getMetricRevision(discarded.source, 'mrev-dd-amount-0')), published);
  const again = api.createRevisionDraft(discarded.source, DEF_ID, {revisionId: 'mrev-dd-draft2'});
  assert.equal(again.ok, true, JSON.stringify(again.errors));
});

test('(b2) 丢弃草案同时移除指向该草案的关联，审计无悬挂引用', () => {
  const source = atomicWithV10();
  const draft = ok(api.createRevisionDraft(source, DEF_ID, {revisionId: 'mrev-dd-bound'}));
  const poked = JSON.parse(JSON.stringify(draft.source));
  poked.profile.metricPlatform.bindings = [
    {id: 'bind-draft', role: 'SEMANTIC_MATCH', state: 'suggested', metricRevisionId: 'mrev-dd-bound',
      metricDefinitionId: DEF_ID, modelRef: {collection: 'conceptEntities', objectId: 'concept-trade'}},
    {id: 'bind-keep', role: 'SEMANTIC_MATCH', state: 'suggested', metricRevisionId: 'mrev-dd-amount-0',
      metricDefinitionId: DEF_ID, modelRef: {collection: 'conceptEntities', objectId: 'concept-trade'}},
  ];
  const discarded = ok(api.discardMetricDraft(poked, DEF_ID, {expectedRevision: 1}));
  const bindings = api.readMetricPlatform(discarded.source).bindings.map(item => item.id);
  assert.deepEqual(bindings, ['bind-keep']);
  assert.deepEqual(api.auditMetricStore(discarded.source).issues, []);
});

test('(c) 两个版本各有下游：listDefinitionDependents 汇总两条（废弃前后一致）', () => {
  const source = withTwoDependents();
  // 单版本反查只看到一条
  assert.equal(api.listRevisionDependents(source, 'mrev-dd-amount-0').length, 1);
  const dependents = api.listDefinitionDependents(source, DEF_ID);
  assert.equal(dependents.length, 2);
  assert.deepEqual(dependents.map(item => item.revisionId).sort(), ['mrev-dd-7d-a', 'mrev-dd-7d-b']);
  const byId = {};
  dependents.forEach((item) => { byId[item.revisionId] = item; });
  assert.deepEqual(byId['mrev-dd-7d-a'].targetRevisionIds, ['mrev-dd-amount-0']);
  assert.deepEqual(byId['mrev-dd-7d-b'].targetRevisionIds, ['mrev-dd-amount-1']);
  assert.deepEqual(byId['mrev-dd-7d-a'].roles, ['ATOMIC_BASE']);
  const deprecated = ok(api.deprecateMetricDefinition(source, DEF_ID));
  assert.equal(api.listDefinitionDependents(deprecated.source, DEF_ID).length, 2);
  assert.deepEqual(api.listDefinitionDependents(source, 'metric-nope'), []);
});

test('(d) 废弃后基于旧版本修订并发布：定义级废弃解除，新版本号 max+1，旧版本仍为已废弃', () => {
  const source = atomicWithTwoVersions();
  assert.equal(api.isDefinitionDeprecated(source, DEF_ID), false);
  const deprecated = ok(api.deprecateMetricDefinition(source, DEF_ID)).source;
  assert.equal(api.isDefinitionDeprecated(deprecated, DEF_ID), true);
  // 默认（不指定 base）仍要求已发布版本
  assert.equal(api.createRevisionDraft(deprecated, DEF_ID, {}).errors[0].code, 'UNPUBLISHED_REFERENCE');
  const draft = ok(api.createRevisionDraft(deprecated, DEF_ID,
    {baseRevisionId: 'mrev-dd-amount-0', revisionId: 'mrev-dd-revive'}));
  assert.equal(draft.revision.baseRevisionId, 'mrev-dd-amount-0');
  // 发布前仍是定义级废弃，校验/发布不被 DEFINITION_DEPRECATED 拦截
  assert.equal(api.isDefinitionDeprecated(draft.source, DEF_ID), true);
  ok(api.validateMetricDraft(draft.source, 'mrev-dd-revive', {expectedRevision: 1}));
  const published = ok(api.publishMetricRevision(draft.source, 'mrev-dd-revive', {expectedRevision: 1}));
  assert.equal(published.version, '1.2');
  assert.equal(published.revision.status, 'published');
  assert.equal(api.isDefinitionDeprecated(published.source, DEF_ID), false);
  assert.equal(statusOf(published.source, 'mrev-dd-amount-0'), 'deprecated');
  assert.equal(statusOf(published.source, 'mrev-dd-amount-1'), 'deprecated');
  assert.equal(api.getMetricDefinition(published.source, DEF_ID).latestPublished.id, 'mrev-dd-revive');
});

test('(d2) 废弃前遗留草案仍不可发布；丢弃后基于已废弃版本修订可发布', () => {
  const source = atomicWithTwoVersions();
  const legacy = ok(api.createRevisionDraft(source, DEF_ID, {revisionId: 'mrev-dd-legacy'}));
  const deprecated = ok(api.deprecateMetricDefinition(legacy.source, DEF_ID)).source;
  const blocked = api.publishMetricRevision(deprecated, 'mrev-dd-legacy', {});
  assert.equal(blocked.errors[0].code, 'DEFINITION_DEPRECATED');
  const discarded = ok(api.discardMetricDraft(deprecated, DEF_ID, {expectedRevision: 1})).source;
  // 已发布过的定义丢弃草案后定义保留（仍为已废弃）
  assert.notEqual(api.getMetricDefinition(discarded, DEF_ID), null);
  assert.equal(api.isDefinitionDeprecated(discarded, DEF_ID), true);
  const revive = ok(api.createRevisionDraft(discarded, DEF_ID,
    {baseRevisionId: 'mrev-dd-amount-1', revisionId: 'mrev-dd-revive2'}));
  const published = ok(api.publishMetricRevision(revive.source, 'mrev-dd-revive2', {}));
  assert.equal(published.version, '1.2');
  assert.equal(api.isDefinitionDeprecated(published.source, DEF_ID), false);
});

test('(e) 有活动草案时基于已废弃版本修订仍受 ACTIVE_DRAFT_EXISTS 保护', () => {
  const source = atomicWithTwoVersions();
  const legacy = ok(api.createRevisionDraft(source, DEF_ID, {revisionId: 'mrev-dd-active'}));
  const deprecated = ok(api.deprecateMetricDefinition(legacy.source, DEF_ID)).source;
  const before = JSON.stringify(deprecated);
  const result = api.createRevisionDraft(deprecated, DEF_ID, {baseRevisionId: 'mrev-dd-amount-0'});
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'ACTIVE_DRAFT_EXISTS');
  assert.equal(JSON.stringify(deprecated), before);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach(({name, error}) => {
    console.log(`\n--- ${name}`);
    console.log(error && error.stack ? error.stack : error);
  });
  process.exit(1);
}
