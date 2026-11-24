// 动态计算就绪测试（MET-10 / 决策 D5）：
// getMetricReadiness 只判 来源端点在场 + 至少一条 confirmed COMPUTES_FROM 绑定 +
// 必需 mapping 齐备 + 来源为物理实体；不做派生/复合的上游传递判定。
// resolvedSpec.computeReady 保留为发布时快照，读取就绪不改任何 hash / 存储。
// 复跑：node tests/metrics/readiness-test.cjs（仓库根目录）。合成数据，真实加载 src/lib/metric_platform。
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

const ENTITY = 'entity-trade-order';
const AMOUNT = 'field-paid-amount';
const REV = 'mrev-rd-amount';
// 第二张物理表（与声明来源不同的对象）：用于事实键映射要求
const SNAPSHOT_ENTITY = {
  id: 'entity-order-snapshot', defKey: 'order_snapshot', defName: '订单快照', type: 'P',
  fields: [
    {id: 'snap-order-id', defKey: 'order_id', defName: '订单号', type: 'VARCHAR'},
    {id: 'snap-amount', defKey: 'paid_amount', defName: '支付金额', type: 'DECIMAL'},
    {id: 'snap-paid-at', defKey: 'paid_at', defName: '支付时间', type: 'DATETIME'},
    {id: 'snap-status', defKey: 'status', defName: '订单状态', type: 'VARCHAR'},
    {id: 'snap-channel', defKey: 'channel', defName: '渠道', type: 'VARCHAR'},
  ],
};

// 完整映射：时间轴 + 基础限定字段 + 维度字段（端点与声明来源同对象，事实键由 spec 直接给出）
const fullMapping = () => ({
  aggregate: 'SUM',
  timeFieldId: 'field-paid-at',
  qualifierFieldIds: ['field-status', 'field-is-test', 'field-is-void'],
  dimensionFieldIds: ['field-channel'],
});

const publishedAmount = () => {
  let source = fixtures.baseProject();
  source = {...source, entities: source.entities.concat([SNAPSHOT_ENTITY])};
  source = ok(api.createMetricDraft(source, {
    ...fixtures.paidAmountAtomic('metric-rd-amount'), revisionId: REV,
  })).source;
  return ok(api.publishMetricRevision(source, REV, {})).source;
};

const bind = (source, input) => ok(api.createMetricBinding(source, {
  role: 'COMPUTES_FROM', revisionId: REV, state: 'confirmed',
  modelRef: {collection: 'entities', objectId: ENTITY, fieldId: AMOUNT},
  evidence: {kind: 'manual', confirmedBy: 'user-owner'},
  ...input,
})).source;

const readyAmount = () => bind(publishedAmount(), {id: 'bind-rd-main', mapping: fullMapping()});

const codes = readiness => readiness.reasons.map(r => r.code);

const withoutField = (source, fieldId) => ({
  ...source,
  entities: source.entities.map(e => (e.id === ENTITY
    ? {...e, fields: e.fields.filter(f => f.id !== fieldId)} : e)),
});

test('(a) 物理来源 + confirmed 绑定 + mapping 齐备 → ready', () => {
  const readiness = api.getMetricReadiness(readyAmount(), REV);
  assert.deepEqual(readiness, {ready: true, reasons: []});
});

test('(b) 删除来源字段 → SOURCE_MISSING；resolvedSpec.computeReady 快照仍为 true', () => {
  const source = withoutField(readyAmount(), AMOUNT);
  const readiness = api.getMetricReadiness(source, REV);
  assert.equal(readiness.ready, false);
  assert.ok(codes(readiness).indexOf('SOURCE_MISSING') >= 0, JSON.stringify(readiness));
  const missing = readiness.reasons.filter(r => r.code === 'SOURCE_MISSING')[0];
  assert.equal(missing.path, 'spec.source.fieldId');
  assert.equal(api.getMetricRevision(source, REV).resolvedSpec.computeReady, true);
  // 整个来源对象删除 → 路径指向 modelId
  const noModel = {...readyAmount(), entities: [SNAPSHOT_ENTITY]};
  const objectGone = api.getMetricReadiness(noModel, REV);
  assert.ok(objectGone.reasons.some(r => r.code === 'SOURCE_MISSING' && r.path === 'spec.source.modelId'),
    JSON.stringify(objectGone));
});

test('(c) 无绑定 → NO_CONFIRMED_BINDING；suggested/unresolved/released 不算确认', () => {
  const bare = publishedAmount();
  assert.deepEqual(api.getMetricReadiness(bare, REV), {
    ready: false, reasons: [{code: 'NO_CONFIRMED_BINDING', path: 'bindings'}],
  });
  const suggested = bind(bare, {id: 'bind-rd-s', state: 'suggested', mapping: fullMapping()});
  assert.deepEqual(codes(api.getMetricReadiness(suggested, REV)), ['NO_CONFIRMED_BINDING']);
  const released = ok(api.releaseMetricBinding(readyAmount(), 'bind-rd-main', {reason: 'x'})).source;
  assert.deepEqual(codes(api.getMetricReadiness(released, REV)), ['NO_CONFIRMED_BINDING']);
  const unresolved = ok(api.markMetricBindingsUnresolved(readyAmount(),
    {collection: 'entities', objectId: ENTITY, fieldId: AMOUNT}, {})).source;
  assert.deepEqual(codes(api.getMetricReadiness(unresolved, REV)), ['NO_CONFIRMED_BINDING']);
});

test('(d) 逻辑层来源 → SOURCE_NOT_PHYSICAL', () => {
  let source = fixtures.baseProject();
  const logicAtomic = fixtures.paidOrdersAtomic('metric-rd-logic');
  logicAtomic.spec = {...logicAtomic.spec, source: {modelId: 'logic-order'},
    baseQualifiers: [], dimensions: [], factGrain: {description: '一行', uniqueKeyFieldIds: []}};
  source = ok(api.createMetricDraft(source, {...logicAtomic, revisionId: 'mrev-rd-logic'})).source;
  source = ok(api.publishMetricRevision(source, 'mrev-rd-logic', {})).source;
  source = ok(api.createMetricBinding(source, {
    id: 'bind-rd-logic', role: 'COMPUTES_FROM', revisionId: 'mrev-rd-logic', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: ENTITY, fieldId: 'field-order-id'},
    mapping: {timeFieldId: 'field-paid-at'},
  })).source;
  assert.deepEqual(api.getMetricReadiness(source, 'mrev-rd-logic'), {
    ready: false, reasons: [{code: 'SOURCE_NOT_PHYSICAL', path: 'spec.source.modelId'}],
  });
});

test('(e) 读取就绪不改已发布版本 hash，也不改 source', () => {
  const source = withoutField(readyAmount(), AMOUNT);
  const before = api.getMetricRevision(source, REV).hash;
  const snapshot = JSON.stringify(source);
  api.getMetricReadiness(source, REV);
  api.getMetricReadiness(readyAmount(), REV);
  assert.equal(api.getMetricRevision(source, REV).hash, before);
  assert.equal(JSON.stringify(source), snapshot);
});

test('(f) mapping 不齐 → MAPPING_INCOMPLETE（按 spec 推导必需键）', () => {
  const source = bind(publishedAmount(), {id: 'bind-rd-part', mapping: {aggregate: 'SUM',
    timeFieldId: 'field-paid-at'}});
  const readiness = api.getMetricReadiness(source, REV);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.reasons, [
    {code: 'MAPPING_INCOMPLETE', path: 'bindings[bind-rd-part].mapping.qualifierFieldIds'},
    {code: 'MAPPING_INCOMPLETE', path: 'bindings[bind-rd-part].mapping.dimensionFieldIds'},
  ]);
  // 只要有一条 confirmed 绑定映射齐备即可（另一条不齐不拖累）
  const both = bind(source, {id: 'bind-rd-full', mapping: fullMapping(),
    modelRef: {collection: 'entities', objectId: ENTITY, fieldId: 'field-order-id'}});
  assert.deepEqual(api.getMetricReadiness(both, REV), {ready: true, reasons: []});
});

test('(g) spec 不需要的映射不报缺；端点异于声明来源对象时才要求事实键', () => {
  // 无限定/无维度的原子：只需时间字段
  let source = fixtures.baseProject();
  const lean = fixtures.paidAmountAtomic('metric-rd-lean');
  lean.spec = {...lean.spec, baseQualifiers: [], dimensions: []};
  source = ok(api.createMetricDraft(source, {...lean, revisionId: 'mrev-rd-lean'})).source;
  source = ok(api.publishMetricRevision(source, 'mrev-rd-lean', {})).source;
  source = ok(api.createMetricBinding(source, {
    id: 'bind-rd-lean', role: 'COMPUTES_FROM', revisionId: 'mrev-rd-lean', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: ENTITY, fieldId: AMOUNT},
    mapping: {timeFieldId: 'field-paid-at'},
  })).source;
  assert.deepEqual(api.getMetricReadiness(source, 'mrev-rd-lean'), {ready: true, reasons: []});
  // 绑定端点为另一张物理表：spec 的事实唯一键字段 ID 不在该表上 → 需要 factKeyFieldIds
  const other = bind(publishedAmount(), {id: 'bind-rd-snap',
    modelRef: {collection: 'entities', objectId: SNAPSHOT_ENTITY.id, fieldId: 'snap-amount'},
    mapping: {timeFieldId: 'snap-paid-at', qualifierFieldIds: ['snap-status'],
      dimensionFieldIds: ['snap-channel']}});
  assert.deepEqual(api.getMetricReadiness(other, REV).reasons, [
    {code: 'MAPPING_INCOMPLETE', path: 'bindings[bind-rd-snap].mapping.factKeyFieldIds'},
  ]);
  const withKeys = bind(publishedAmount(), {id: 'bind-rd-snap2',
    modelRef: {collection: 'entities', objectId: SNAPSHOT_ENTITY.id, fieldId: 'snap-amount'},
    mapping: {timeFieldId: 'snap-paid-at', qualifierFieldIds: ['snap-status'],
      dimensionFieldIds: ['snap-channel'], factKeyFieldIds: ['snap-order-id']}});
  assert.deepEqual(api.getMetricReadiness(withKeys, REV), {ready: true, reasons: []});
});

test('(h) 映射字段被删（绑定尚未失效）→ MAPPING_INCOMPLETE', () => {
  const source = withoutField(readyAmount(), 'field-paid-at');
  assert.deepEqual(api.getMetricReadiness(source, REV).reasons, [
    {code: 'MAPPING_INCOMPLETE', path: 'bindings[bind-rd-main].mapping.timeFieldId'},
  ]);
});

// 直接改写存储里的绑定元素（模拟旧/损坏数据：普通对象但缺字段）
const withCorruptBinding = (source, mutate) => {
  const copy = JSON.parse(JSON.stringify(source));
  copy.profile.metricPlatform.bindings = copy.profile.metricPlatform.bindings.map(mutate);
  return copy;
};

test('(i) 损坏绑定（缺 modelRef/mapping/events、null 元素）不抛错', () => {
  const drop = key => b => {
    const next = {...b};
    delete next[key];
    return next;
  };
  let noRef;
  let noMapping;
  let noEvents;
  let nullElement;
  assert.doesNotThrow(() => {
    noRef = api.getMetricReadiness(withCorruptBinding(readyAmount(), drop('modelRef')), REV);
    noMapping = api.getMetricReadiness(withCorruptBinding(readyAmount(), drop('mapping')), REV);
    noEvents = api.getMetricReadiness(withCorruptBinding(readyAmount(), drop('events')), REV);
    const withNull = JSON.parse(JSON.stringify(readyAmount()));
    withNull.profile.metricPlatform.bindings.push(null);
    nullElement = api.getMetricReadiness(withNull, REV);
  });
  assert.deepEqual(codes(noRef), ['NO_CONFIRMED_BINDING']);
  assert.deepEqual(codes(noMapping), ['MAPPING_INCOMPLETE', 'MAPPING_INCOMPLETE', 'MAPPING_INCOMPLETE']);
  assert.deepEqual(noEvents, {ready: true, reasons: []});
  assert.deepEqual(nullElement, {ready: true, reasons: []});
});

test('(j) 派生/复合不做上游传递判定：返回发布快照；未知版本返回 null', () => {
  let source = readyAmount();
  source = ok(api.createMetricDraft(source, {
    ...fixtures.paidAmount7dDerived('metric-rd-7d', REV), revisionId: 'mrev-rd-7d',
  })).source;
  source = ok(api.publishMetricRevision(source, 'mrev-rd-7d', {})).source;
  // 原子来源字段已删（原子动态未就绪），派生仍按自身发布快照
  const broken = withoutField(source, AMOUNT);
  assert.equal(api.getMetricReadiness(broken, REV).ready, false);
  assert.deepEqual(api.getMetricReadiness(broken, 'mrev-rd-7d'), {ready: true, reasons: []});
  assert.equal(api.getMetricReadiness(source, 'mrev-none'), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach(({name, error}) => console.error(`\n[${name}]\n${error && error.stack}`));
  process.exit(1);
}
