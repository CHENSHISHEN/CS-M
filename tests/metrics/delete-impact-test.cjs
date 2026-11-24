// 字段删除影响与绑定失效落盘测试（MET-11 / MET-12）：
// - getLineageImpact：原子 spec.factGrain.uniqueKeyFieldIds 命中算 DECLARED 直接影响；
// - applyDeleteImpact：删除字段/对象后命中绑定标记 unresolved，导航计数不再计入；
// - 同号字段重建不自动复活（只有显式 restore 才复活，且指纹一致）；
// - 无指标引用时 source 原样返回（引用相等）。
// 复跑：node tests/metrics/delete-impact-test.cjs（仓库根目录）。合成数据，真实加载 src/lib/metric_platform。
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
const ORDER_ID = 'field-order-id';

// 两个已发布原子：金额（source 为支付金额字段）与订单数（source 仅模型级），
// 二者都以订单号作事实唯一键——订单号不是任何一方的 source.fieldId
const withTwoAtomics = () => {
  let source = fixtures.baseProject();
  source = ok(api.createMetricDraft(source, {
    ...fixtures.paidAmountAtomic('metric-di-amount'), revisionId: 'mrev-di-amount',
  })).source;
  source = ok(api.publishMetricRevision(source, 'mrev-di-amount', {})).source;
  source = ok(api.createMetricDraft(source, {
    ...fixtures.paidOrdersAtomic('metric-di-orders'), revisionId: 'mrev-di-orders',
  })).source;
  return ok(api.publishMetricRevision(source, 'mrev-di-orders', {})).source;
};

// 在两原子之上加一条以订单号为端点字段的计算来源绑定 + 一条以订单号作事实键映射的绑定
const withBindings = () => {
  let source = withTwoAtomics();
  source = ok(api.createMetricBinding(source, {
    id: 'bind-di-key', role: 'COMPUTES_FROM', revisionId: 'mrev-di-orders', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: ENTITY, fieldId: ORDER_ID},
    evidence: {kind: 'manual', confirmedBy: 'user-owner'},
  })).source;
  source = ok(api.createMetricBinding(source, {
    id: 'bind-di-amount', role: 'COMPUTES_FROM', revisionId: 'mrev-di-amount', state: 'suggested',
    modelRef: {collection: 'entities', objectId: ENTITY, fieldId: 'field-paid-amount'},
    mapping: {aggregate: 'SUM', factKeyFieldIds: [ORDER_ID]},
  })).source;
  return source;
};

// 模拟字段表删除：实体中移除字段（UI 的字段删除草稿最终落入项目的形状）
const withoutField = (source, fieldId) => ({
  ...source,
  entities: source.entities.map(e => (e.id === ENTITY
    ? {...e, fields: e.fields.filter(f => f.id !== fieldId)} : e)),
});

const bindingState = (source, bindingId) =>
  api.listMetricBindings(source, {bindingId, includeReleased: true})[0].binding.state;

test('(a) 两个原子均以订单号作事实唯一键：字段影响 direct ≥ 2，角色 DECLARED', () => {
  const source = withTwoAtomics();
  const impact = api.getLineageImpact(source, {collection: 'entities', objectId: ENTITY, fieldId: ORDER_ID});
  assert.equal(impact.ok, true);
  const ids = impact.direct.metrics.map(m => m.revisionId).sort();
  assert.ok(ids.length >= 2, `direct 应 ≥ 2，实际 ${ids.length}`);
  assert.deepEqual(ids, ['mrev-di-amount', 'mrev-di-orders']);
  impact.direct.metrics.forEach(m => assert.deepEqual(m.roles, ['DECLARED']));
  // 未被引用的字段仍不命中（唯一键扫描不放宽到整表）
  const other = api.getLineageImpact(source, {collection: 'entities', objectId: ENTITY, fieldId: 'field-is-test'});
  assert.equal(other.direct.metrics.length, 0);
});

test('(b) 删除字段后同事务标记 unresolved，导航计数不再计入', () => {
  const source = withBindings();
  assert.equal(api.countActiveMetricBindings(source), 2);
  const deleted = withoutField(source, ORDER_ID);
  const next = api.applyDeleteImpact(deleted, {
    collection: 'entities', objectId: ENTITY, fieldIds: [ORDER_ID],
  });
  assert.notEqual(next, deleted);
  // 端点字段命中与 mapping 事实键命中都失效
  assert.equal(bindingState(next, 'bind-di-key'), 'unresolved');
  assert.equal(bindingState(next, 'bind-di-amount'), 'unresolved');
  const listed = api.listMetricBindings(next, {state: 'unresolved'});
  assert.equal(listed.length, 2);
  assert.equal(listed[0].binding.unresolved.reason, 'ENDPOINT_MISSING');
  assert.equal(listed[0].binding.unresolved.fieldId, ORDER_ID);
  assert.equal(api.countActiveMetricBindings(next), 0);
  // 模型集合不被改写（只写指标存储）
  assert.equal(next.entities, deleted.entities);
  // 干净存储上的审计保持干净
  const audit = api.auditMetricStore(next);
  assert.deepEqual(audit.issues || [], [], JSON.stringify(audit.issues));
});

test('(b2) 对象删除：entityIds 命中该对象全部绑定', () => {
  const source = withBindings();
  const next = api.applyDeleteImpact(source, {collection: 'entities', entityIds: [ENTITY]});
  assert.equal(bindingState(next, 'bind-di-key'), 'unresolved');
  assert.equal(bindingState(next, 'bind-di-amount'), 'unresolved');
  assert.equal(api.countActiveMetricBindings(next), 0);
});

test('(c) 同号字段重建不自动复活；显式 restore 才复活且指纹一致', () => {
  const source = withBindings();
  const deleted = withoutField(source, ORDER_ID);
  const invalidated = api.applyDeleteImpact(deleted, {
    collection: 'entities', objectId: ENTITY, fieldIds: [ORDER_ID],
  });
  // 同 ID、同 defKey/type 的字段重建
  const rebuilt = {...invalidated, entities: source.entities};
  assert.equal(bindingState(rebuilt, 'bind-di-key'), 'unresolved');
  // 全量同步也只做失效方向
  const synced = ok(api.syncMetricBindingStates(rebuilt, {}));
  assert.equal(bindingState(synced.source, 'bind-di-key'), 'unresolved');
  assert.equal(api.countActiveMetricBindings(rebuilt), 0);
  // 显式重连
  const restored = ok(api.restoreMetricBinding(rebuilt, 'bind-di-key', {}));
  const item = api.listMetricBindings(restored.source, {bindingId: 'bind-di-key'})[0];
  assert.equal(item.binding.state, 'suggested');
  assert.equal(item.fingerprintStatus, 'match');
  assert.equal(api.countActiveMetricBindings(restored.source), 1);
});

test('(d) 无指标引用时 applyDeleteImpact 返回原 source（引用相等）', () => {
  const plain = fixtures.baseProject();
  assert.equal(api.applyDeleteImpact(plain, {
    collection: 'entities', objectId: ENTITY, fieldIds: [ORDER_ID],
  }), plain);
  const source = withBindings();
  // 有绑定但未命中的字段/对象
  assert.equal(api.applyDeleteImpact(source, {
    collection: 'entities', objectId: ENTITY, fieldIds: ['field-is-test'],
  }), source);
  assert.equal(api.applyDeleteImpact(source, {collection: 'entities', entityIds: ['entity-none']}), source);
  assert.equal(api.applyDeleteImpact(source, {fieldIds: [], entityIds: []}), source);
  assert.equal(api.applyDeleteImpact(source, null), source);
  // 已失效的绑定再次删除不重复记事件
  const once = api.applyDeleteImpact(source, {collection: 'entities', objectId: ENTITY, fieldIds: [ORDER_ID]});
  assert.equal(api.applyDeleteImpact(once, {collection: 'entities', objectId: ENTITY, fieldIds: [ORDER_ID]}), once);
});

test('(e) 不给 objectId 时按绑定字段范围定位对象；集合不符不命中', () => {
  const source = withBindings();
  const next = api.applyDeleteImpact(source, {fieldIds: [ORDER_ID]});
  assert.equal(bindingState(next, 'bind-di-key'), 'unresolved');
  assert.equal(bindingState(next, 'bind-di-amount'), 'unresolved');
  assert.equal(api.applyDeleteImpact(source, {
    collection: 'logicEntities', objectId: ENTITY, fieldIds: [ORDER_ID],
  }), source);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach(({name, error}) => console.error(`\n[${name}]\n${error && error.stack}`));
  process.exit(1);
}
