'use strict';
// 指标存储 normalize 与只读冻结测试（MET-03 余项 / MET-09）：
// (a) 损坏集合（非数组/非对象/空元素）读取不抛 TypeError、按空处理并给出 __diagnostics；
// (b) profile.metricPlatform 非对象时任意写入 ok:false 且不改 profile；
// (c) getMetricRevision / listMetricRevisions 返回深冻结拷贝，旧 h<8hex> hash 与重复 "1.0" 只读兼容；
// 未来 schemaVersion 行为保持（只读 + SCHEMA_VERSION_UNSUPPORTED）。
// 复跑：node tests/metrics/store-test.cjs（仓库根目录）。严格模式：对冻结对象赋值必抛 TypeError。
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

const DEF_ID = 'metric-st';
const ok = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result;
};
const clone = value => JSON.parse(JSON.stringify(value));
const platformOf = source => source.profile.metricPlatform;
const withPlatform = (source, platform) => ({...source, profile: {...source.profile, metricPlatform: platform}});
const diagPaths = data => (data.__diagnostics || []).map(item => item.path);

// 已发布 v1.0 + 一个未发布草案（定义 2）
const buildStore = () => {
  const created = ok(api.createMetricDraft(fixtures.baseProject(), {
    ...fixtures.paidAmountAtomic(DEF_ID), revisionId: 'mrev-st-1',
  }));
  const published = ok(api.publishMetricRevision(created.source, 'mrev-st-1', {}));
  const draft = ok(api.createMetricDraft(published.source, {
    ...fixtures.paidOrdersAtomic('metric-st-orders'), revisionId: 'mrev-st-orders-1',
  }));
  return draft.source;
};

// 所有读入口 + 发布：不得抛（尤其 TypeError）
const exerciseReads = (source) => {
  let defs;
  let revs;
  let publish;
  assert.doesNotThrow(() => { defs = api.listMetricDefinitions(source); });
  assert.doesNotThrow(() => { defs = api.listMetricDefinitions(source, {kind: 'atomic', status: 'published'}); });
  assert.doesNotThrow(() => { revs = api.listMetricRevisions(source); });
  assert.doesNotThrow(() => { publish = api.publishMetricRevision(source, 'mrev-st-orders-1', {}); });
  assert.doesNotThrow(() => api.readMetricDictionary(source));
  assert.doesNotThrow(() => api.listMetricBindings(source));
  return {defs, revs, publish};
};

// ---------------- (a) normalize ----------------
test('(a) revisions="x"：读入口不抛、修订按空处理，__diagnostics 指向 revisions', () => {
  const platform = clone(platformOf(buildStore()));
  platform.revisions = 'x';
  const source = withPlatform(buildStore(), platform);
  const before = JSON.stringify(source);
  const {revs, publish} = exerciseReads(source);
  assert.deepEqual(revs, []);
  assert.equal(publish.ok, false);
  assert.equal(api.getMetricRevision(source, 'mrev-st-1'), null);
  const data = api.readMetricPlatform(source);
  assert.deepEqual(data.revisions, []);
  assert.ok(diagPaths(data).indexOf('profile.metricPlatform.revisions') >= 0, JSON.stringify(data.__diagnostics));
  assert.equal(data.__diagnostics[0].code, 'STORE_CORRUPT');
  assert.equal(JSON.stringify(source), before, '读取不得改写存储');
});

test('(a) definitions={}：listMetricDefinitions 返回 []，诊断指向 definitions', () => {
  const platform = clone(platformOf(buildStore()));
  platform.definitions = {};
  const source = withPlatform(buildStore(), platform);
  const {defs, publish} = exerciseReads(source);
  assert.deepEqual(defs, []);
  assert.equal(publish.ok, false);
  const data = api.readMetricPlatform(source);
  assert.deepEqual(data.definitions, []);
  assert.deepEqual(diagPaths(data), ['profile.metricPlatform.definitions']);
});

test('(a) 集合类型损坏时写入拒绝 STORE_CORRUPT，不以空集合覆盖原数据', () => {
  const platform = clone(platformOf(buildStore()));
  platform.definitions = {legacy: {id: 'x'}};
  const source = withPlatform(buildStore(), platform);
  const before = JSON.stringify(source);
  const result = api.createMetricDraft(source, {...fixtures.paidAmountAtomic('metric-st-new'), code: 'new_code'});
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'STORE_CORRUPT');
  assert.equal(result.errors[0].messageKey, 'metric.error.storeCorrupt');
  assert.equal(JSON.stringify(source), before);
});

test('(a) revisions:[null, 草案, …]：空元素被过滤并记诊断，发布照常成功且落盘不含 null', () => {
  const platform = clone(platformOf(buildStore()));
  platform.revisions = [null].concat(platform.revisions).concat([42]);
  const source = withPlatform(buildStore(), platform);
  const {revs, publish} = exerciseReads(source);
  assert.deepEqual(revs.map(item => item.id).sort(), ['mrev-st-1', 'mrev-st-orders-1']);
  assert.equal(publish.ok, true, JSON.stringify(publish.errors));
  const data = api.readMetricPlatform(source);
  assert.deepEqual(diagPaths(data),
    ['profile.metricPlatform.revisions[0]', 'profile.metricPlatform.revisions[3]']);
  assert.ok(data.__diagnostics.every(item => item.code === 'STORE_CORRUPT' && typeof item.reason === 'string'));
  const written = platformOf(publish.source).revisions;
  assert.equal(written.length, 2);
  assert.ok(written.every(item => item != null && typeof item === 'object'));
  // 写后存储干净：不再有诊断
  assert.equal(api.readMetricPlatform(publish.source).__diagnostics, undefined);
});

test('(a) dictionary.units:[null]：字典读取与发布不抛，诊断指向 dictionary.units[0]', () => {
  const platform = clone(platformOf(buildStore()));
  platform.dictionary = {units: [null]};
  const source = withPlatform(buildStore(), platform);
  const {publish} = exerciseReads(source);
  assert.equal(typeof publish.ok, 'boolean');
  assert.deepEqual(api.listDictionaryEntries(source, 'units'), []);
  assert.deepEqual(diagPaths(api.readMetricPlatform(source)), ['profile.metricPlatform.dictionary.units[0]']);
});

test('(a) __diagnostics 不可枚举：不进 Object.keys / JSON / 展开；干净存储无该属性', () => {
  const platform = clone(platformOf(buildStore()));
  platform.concepts = [null];
  const data = api.readMetricPlatform(withPlatform(buildStore(), platform));
  assert.ok(Array.isArray(data.__diagnostics));
  assert.equal(Object.keys(data).indexOf('__diagnostics'), -1);
  assert.equal(JSON.stringify(data).indexOf('__diagnostics'), -1);
  assert.equal({...data}.__diagnostics, undefined);
  const clean = api.readMetricPlatform(buildStore());
  assert.equal(clean.__diagnostics, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(clean, '__diagnostics'), false);
});

test('(a) normalizeMetricPlatform 纯函数：{value, diagnostics}，不改入参', () => {
  const raw = {schemaVersion: 1, namespace: 'ns', concepts: 'bad', definitions: [null, {id: 'd'}],
    revisions: [], bindings: [null], extra: {keep: true}};
  const snapshot = JSON.stringify(raw);
  const result = api.normalizeMetricPlatform(raw);
  assert.equal(JSON.stringify(raw), snapshot);
  assert.deepEqual(result.value.concepts, []);
  assert.deepEqual(result.value.definitions, [{id: 'd'}]);
  assert.deepEqual(result.value.bindings, []);
  assert.deepEqual(result.value.extra, {keep: true}, '未知键原样保留');
  assert.deepEqual(result.diagnostics.map(item => item.path), [
    'profile.metricPlatform.concepts',
    'profile.metricPlatform.definitions[0]',
    'profile.metricPlatform.bindings[0]',
  ]);
  assert.ok(result.diagnostics.every(item => item.code === 'STORE_CORRUPT'));
  // 缺失 → 空平台，无诊断；缺字段补默认
  assert.deepEqual(api.normalizeMetricPlatform(undefined).diagnostics, []);
  const sparse = api.normalizeMetricPlatform({schemaVersion: 1}).value;
  assert.deepEqual([sparse.namespace, sparse.concepts, sparse.definitions, sparse.revisions],
    [null, [], [], []]);
});

// ---------------- (b) metricPlatform 非对象 ----------------
test('(b) profile.metricPlatform="str"：任意写入 ok:false 且 profile 不变', () => {
  const source = {...fixtures.baseProject()};
  source.profile = {...source.profile, metricPlatform: 'str'};
  const before = JSON.stringify(source.profile);
  const data = api.readMetricPlatform(source);
  assert.deepEqual(data.definitions, []);
  assert.deepEqual(diagPaths(data), ['profile.metricPlatform']);
  const writes = [
    api.createMetricDraft(source, fixtures.paidAmountAtomic('metric-st-str')),
    api.createMetricConcept(source, {name: '成交', domain: 'trade'}),
    api.createDictionaryEntry(source, 'units', {code: 'CNY', name: '人民币'}),
    api.createMetricBinding(source, {role: 'SEMANTIC_MATCH', conceptId: 'c1',
      modelRef: {collection: 'entities', objectId: 'entity-trade-order'}}),
    api.markMetricBindingsUnresolved(source, {objectId: 'entity-trade-order'}),
    api.syncMetricBindingStates(source),
    api.updateMetricConcept(source, 'c1', {name: 'x'}),
    api.createDepartmentMetricDraft(source, {}),
  ];
  writes.forEach((result, index) => {
    assert.equal(result.ok, false, `write #${index}`);
    assert.equal(result.errors[0].code, 'STORE_CORRUPT', `write #${index}: ${JSON.stringify(result.errors)}`);
  });
  assert.equal(JSON.stringify(source.profile), before);
});

test('(b) writeMetricPlatform 遇非对象 previous（字符串/数组）返回 STORE_CORRUPT，不写入', () => {
  ['str', ['a'], 7].forEach((bad) => {
    const source = {profile: {keep: 1, metricPlatform: bad}};
    const before = JSON.stringify(source);
    const result = api.writeMetricPlatform(source, api.emptyMetricPlatform());
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'STORE_CORRUPT');
    assert.equal(JSON.stringify(source), before);
  });
  // 正常路径不变：返回新 source
  const written = api.writeMetricPlatform({profile: {}}, api.emptyMetricPlatform(), 'ns-x');
  assert.equal(written.profile.metricPlatform.namespace, 'ns-x');
});

// ---------------- (c) 冻结拷贝 ----------------
const isDeepFrozen = (value) => {
  if (value == null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.keys(value).every(key => isDeepFrozen(value[key]));
};

test('(c) getMetricRevision 返回深冻结拷贝：赋值抛 TypeError，hash 仍校验通过', () => {
  const source = buildStore();
  const before = JSON.stringify(source);
  const revision = api.getMetricRevision(source, 'mrev-st-1');
  assert.ok(isDeepFrozen(revision));
  assert.throws(() => { revision.spec.x = 1; }, TypeError);
  assert.throws(() => { revision.hash = 'sha256:forged'; }, TypeError);
  assert.throws(() => { revision.spec.dimensions.push({}); }, TypeError);
  assert.deepEqual(api.verifyRevisionHash(revision), {ok: true, legacy: false});
  assert.deepEqual(api.verifyRevisionHash(api.getMetricRevision(source, 'mrev-st-1')), {ok: true, legacy: false});
  assert.equal(JSON.stringify(source), before);
  // 存储内对象未被冻结（不冻结活引用，后续写命令照常）
  assert.equal(Object.isFrozen(platformOf(source).revisions[0]), false);
  ok(api.createRevisionDraft(source, DEF_ID, {revisionId: 'mrev-st-2'}));
});

test('(c) listMetricRevisions 返回深冻结拷贝，支持 definitionId/status 过滤', () => {
  const source = buildStore();
  const all = api.listMetricRevisions(source);
  assert.deepEqual(all.map(item => item.id), ['mrev-st-1', 'mrev-st-orders-1']);
  assert.ok(isDeepFrozen(all));
  assert.throws(() => { all[0].spec.unit = 'USD'; }, TypeError);
  assert.throws(() => { all.push({}); }, TypeError);
  assert.deepEqual(api.listMetricRevisions(source, {definitionId: DEF_ID}).map(item => item.id), ['mrev-st-1']);
  assert.deepEqual(api.listMetricRevisions(source, {status: 'draft'}).map(item => item.id), ['mrev-st-orders-1']);
  assert.equal(api.getMetricRevision(source, 'mrev-st-1').spec.unit, 'CNY');
});

test('(c) deepFreeze：递归冻结并返回同一对象，原始值原样返回', () => {
  const value = {a: {b: [1, {c: 2}]}};
  assert.equal(api.deepFreeze(value), value);
  assert.ok(isDeepFrozen(value));
  assert.equal(api.deepFreeze(null), null);
  assert.equal(api.deepFreeze('s'), 's');
});

test('(c) 旧数据兼容：h<8hex> 旧 hash 与重复 "1.0" 原样可读', () => {
  const source = buildStore();
  const platform = clone(platformOf(source));
  const rev = platform.revisions.filter(item => item.id === 'mrev-st-1')[0];
  rev.hash = api.hashValue({spec: rev.spec, resolvedSpec: rev.resolvedSpec});
  const dup = clone(rev);
  dup.id = 'mrev-st-dup';
  platform.revisions.push(dup);
  const legacy = withPlatform(source, platform);
  const before = JSON.stringify(legacy);
  const data = api.readMetricPlatform(legacy);
  assert.equal(data.__diagnostics, undefined);
  const forDef = api.listMetricRevisions(legacy, {definitionId: DEF_ID});
  assert.deepEqual(forDef.map(item => [item.id, item.version]), [['mrev-st-1', '1.0'], ['mrev-st-dup', '1.0']]);
  forDef.forEach((item) => {
    assert.match(item.hash, /^h[0-9a-f]{8}$/);
    assert.deepEqual(api.verifyRevisionHash(item), {ok: true, legacy: true});
  });
  assert.equal(JSON.stringify(legacy), before);
});

test('(c) 未来 schemaVersion：只读空集合 + 写入 SCHEMA_VERSION_UNSUPPORTED（行为保持）', () => {
  const platform = clone(platformOf(buildStore()));
  platform.schemaVersion = 99;
  const source = withPlatform(buildStore(), platform);
  const before = JSON.stringify(source);
  const data = api.readMetricPlatform(source);
  assert.equal(data.unsupportedSchemaVersion, true);
  assert.equal(data.schemaVersion, 99);
  assert.deepEqual(data.revisions, []);
  assert.deepEqual(api.listMetricRevisions(source), []);
  const result = api.createMetricDraft(source, {...fixtures.paidAmountAtomic('metric-st-future'), code: 'future'});
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'SCHEMA_VERSION_UNSUPPORTED');
  const publish = api.publishMetricRevision(source, 'mrev-st-orders-1', {});
  assert.equal(publish.errors[0].code, 'SCHEMA_VERSION_UNSUPPORTED');
  assert.equal(JSON.stringify(source), before);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach(({name, error}) => {
    console.log(`\n--- ${name}`);
    console.log(error && error.stack ? error.stack : error);
  });
  process.exit(1);
}
