// 发布前字典一致性测试（MET-04）：spec 引用的单位/维度/部门须已登记且未停用，
// 限定值类型须符合字典维度声明；仅发布拦截（草案保存不拦），无字典的旧项目保持自由输入。
// 复跑：node tests/metrics/dict-link-test.cjs（仓库根目录）。合成数据，真实加载 src/lib/metric_platform。
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {PROJECT_ROOT, loadMetricApi} = require('./loader.cjs');

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

// 经真实字典 API 登记夹具原子用到的全部条目（+ 数值维度/停用单位/部门）
const DICT = {
  departments: [{code: 'dept-ops', name: '运营部'}],
  dimensions: [
    {code: 'dim-channel', name: '渠道', valueType: 'string'},
    {code: 'dim-region', name: '地区', valueType: 'string'},
    {code: 'dim-status', name: '订单状态', valueType: 'string'},
    {code: 'dim-is-test', name: '测试单', valueType: 'boolean'},
    {code: 'dim-is-void', name: '作废单', valueType: 'boolean'},
    {code: 'dim-level', name: '层级', valueType: 'number'},
  ],
  units: [{code: 'CNY', name: '人民币元'}, {code: 'ORDER', name: '单'}, {code: 'OLD', name: '旧单位'}],
};

const withDictionary = (source) => {
  let next = source;
  Object.keys(DICT).forEach((category) => {
    DICT[category].forEach((entry) => {
      next = ok(api.createDictionaryEntry(next, category, entry)).source;
    });
  });
  return next;
};

const entryIdByCode = (source, category, code) =>
  api.findDictionaryEntryByCode(source, category, code).id;

const disableEntry = (source, category, code) =>
  ok(api.updateDictionaryEntry(source, category, entryIdByCode(source, category, code),
    {status: 'disabled'})).source;

// 以夹具原子为底，按 specPatch 覆盖后建草案（可选部门 scope）
const atomicInput = (id, specPatch, extra) => {
  const base = fixtures.paidAmountAtomic(id);
  return {
    ...base,
    revisionId: `${id}-r1`,
    spec: {...base.spec, ...(specPatch == null ? {} : specPatch)},
    ...(extra == null ? {} : extra),
  };
};

const createAndPublish = (source, input) => {
  const draft = ok(api.createMetricDraft(source, input));
  return {draft, published: api.publishMetricRevision(draft.source, input.revisionId, {})};
};

const assertRejectedAt = (result, pathValue, code, messageKey) => {
  assert.equal(result.ok, false, '发布应被拦截');
  const hit = result.errors.filter(error => error.path === pathValue)[0];
  assert.ok(hit != null, `应有 path=${pathValue} 的错误，实际 ${JSON.stringify(result.errors)}`);
  if (code != null) assert.equal(hit.code, code);
  if (messageKey != null) assert.equal(hit.messageKey, messageKey);
  return hit;
};

const fixtureDims = fixtures.paidAmountAtomic('x').spec.dimensions;
const fixtureQualifiers = fixtures.paidAmountAtomic('x').spec.baseQualifiers;

test('(a) 未登记单位：发布 ok:false，错误 path=spec.unit，UNKNOWN_REFERENCE', () => {
  const source = withDictionary(fixtures.baseProject());
  const {published} = createAndPublish(source, atomicInput('metric-dl-a', {unit: 'USD'}));
  assertRejectedAt(published, 'spec.unit', 'UNKNOWN_REFERENCE', 'metric.error.unknownReference');
});

test('(b) 已停用单位：发布 ok:false，path=spec.unit，停用专用 messageKey', () => {
  const source = disableEntry(withDictionary(fixtures.baseProject()), 'units', 'OLD');
  const {published} = createAndPublish(source, atomicInput('metric-dl-b', {unit: 'OLD'}));
  assertRejectedAt(published, 'spec.unit', 'UNKNOWN_REFERENCE', 'metric.error.disabledDictionaryEntry');
});

test('(c) 不存在的维度：发布 ok:false，path 指向该维度条目', () => {
  const source = withDictionary(fixtures.baseProject());
  const {published} = createAndPublish(source, atomicInput('metric-dl-c', {
    dimensions: fixtureDims.concat([{dimensionId: 'dim-nope', addable: 'additive'}]),
  }));
  assertRejectedAt(published, 'spec.dimensions[2].dimensionId', 'UNKNOWN_REFERENCE');
  // 已停用维度同样拦截
  const disabled = disableEntry(source, 'dimensions', 'dim-region');
  const again = createAndPublish(disabled, atomicInput('metric-dl-c2', {}));
  assertRejectedAt(again.published, 'spec.dimensions[1].dimensionId', 'UNKNOWN_REFERENCE',
    'metric.error.disabledDictionaryEntry');
});

test('(d) 不存在的部门：发布 ok:false，path=scope.departmentId', () => {
  const source = withDictionary(fixtures.baseProject());
  const {published} = createAndPublish(source, atomicInput('metric-dl-d', {},
    {scope: {kind: 'department', departmentId: 'dept-ghost'}}));
  assertRejectedAt(published, 'scope.departmentId', 'UNKNOWN_REFERENCE');
  // 登记且启用的部门可发布
  ok(createAndPublish(source, atomicInput('metric-dl-d2', {},
    {code: 'paid_amount_ops', scope: {kind: 'department', departmentId: 'dept-ops'}})).published);
});

test('(e) 限定值类型：布尔维度传字符串、数值维度传非数值、in 列表逐项校验', () => {
  const source = withDictionary(fixtures.baseProject());
  const boolString = createAndPublish(source, atomicInput('metric-dl-e1', {
    baseQualifiers: [fixtureQualifiers[0], {dimensionId: 'dim-is-test', op: 'eq', value: 'false'},
      fixtureQualifiers[2]],
  }));
  assertRejectedAt(boolString.published, 'spec.baseQualifiers[1].value', 'INVALID_VALUE',
    'metric.error.valueTypeMismatch');
  const numberText = createAndPublish(source, atomicInput('metric-dl-e2', {
    baseQualifiers: fixtureQualifiers.concat([{dimensionId: 'dim-level', op: 'gt', value: 'high'}]),
  }));
  assertRejectedAt(numberText.published, 'spec.baseQualifiers[3].value', 'INVALID_VALUE',
    'metric.error.valueTypeMismatch');
  const listItem = createAndPublish(source, atomicInput('metric-dl-e3', {
    baseQualifiers: fixtureQualifiers.concat([{dimensionId: 'dim-level', op: 'in', value: [1, '2']}]),
  }));
  assertRejectedAt(listItem.published, 'spec.baseQualifiers[3].value[1]', 'INVALID_VALUE');
  assert.equal(listItem.published.errors.some(e => e.path === 'spec.baseQualifiers[3].value[0]'), false,
    '合法项不报错');
});

test('(f) 全部合法：发布 ok:true（含数值维度数值限定）', () => {
  const source = withDictionary(fixtures.baseProject());
  const {published} = createAndPublish(source, atomicInput('metric-dl-f', {
    baseQualifiers: fixtureQualifiers.concat([{dimensionId: 'dim-level', op: 'in', value: [1, 2]}]),
  }));
  ok(published);
  assert.equal(published.revision.status, 'published');
});

test('(g) 草案创建/更新不被字典校验拦截（先写后补）', () => {
  const source = withDictionary(fixtures.baseProject());
  const bad = {
    unit: 'USD',
    dimensions: fixtureDims.concat([{dimensionId: 'dim-nope', addable: 'additive'}]),
    baseQualifiers: [{dimensionId: 'dim-is-test', op: 'eq', value: 'false'}],
  };
  const draft = ok(api.createMetricDraft(source, atomicInput('metric-dl-g', bad,
    {scope: {kind: 'department', departmentId: 'dept-ghost'}})));
  const updated = api.updateMetricDraft(draft.source, 'metric-dl-g-r1',
    {spec: {...draft.revision.spec, unit: 'OLD-UNREGISTERED'}}, {expectedRevision: 1});
  assert.equal(updated.ok, true, JSON.stringify(updated.errors));
  // 发布时才拦截；修正 spec 后只剩部门引用错误（写后补）
  assert.equal(api.publishMetricRevision(updated.source, 'metric-dl-g-r1', {}).ok, false);
  const fixed = ok(api.updateMetricDraft(updated.source, 'metric-dl-g-r1',
    {spec: fixtures.paidAmountAtomic('metric-dl-g').spec}, {expectedRevision: 2}));
  const remaining = api.publishMetricRevision(fixed.source, 'metric-dl-g-r1', {});
  assert.equal(remaining.ok, false);
  assert.deepEqual(remaining.errors.map(error => error.path), ['scope.departmentId']);
});

test('(h) 无字典项目：同样“非法”的 spec 照常发布（旧项目自由输入）', () => {
  const source = fixtures.baseProject();
  const {published} = createAndPublish(source, atomicInput('metric-dl-h', {
    unit: 'USD',
    dimensions: fixtureDims.concat([{dimensionId: 'dim-nope', addable: 'additive'}]),
  }, {scope: {kind: 'department', departmentId: 'dept-ghost'}}));
  ok(published);
});

test('(i) 派生引用已停用维度：新发布在派生 path 拦截；已发布原子不回溯', () => {
  let source = withDictionary(fixtures.baseProject());
  source = ok(createAndPublish(source, atomicInput('metric-dl-i', {})).published).source;
  source = disableEntry(source, 'dimensions', 'dim-region');
  // 已发布原子保持 published（停用不回溯校验）
  assert.equal(api.getMetricRevision(source, 'metric-dl-i-r1').status, 'published');
  const derived = fixtures.paidAmount7dDerived('metric-dl-i7', 'metric-dl-i-r1');
  const draft = ok(api.createMetricDraft(source, {
    ...derived,
    revisionId: 'metric-dl-i7-r1',
    spec: {...derived.spec, qualifiers: [{dimensionId: 'dim-region', op: 'eq', value: 'EAST'}]},
  }));
  const published = api.publishMetricRevision(draft.source, 'metric-dl-i7-r1', {});
  assertRejectedAt(published, 'spec.outputGrain[1]', 'UNKNOWN_REFERENCE',
    'metric.error.disabledDictionaryEntry');
  assertRejectedAt(published, 'spec.qualifiers[0].dimensionId', 'UNKNOWN_REFERENCE',
    'metric.error.disabledDictionaryEntry');
  // 派生限定值类型同样校验
  const typed = ok(api.createMetricDraft(source, {
    ...fixtures.paidAmount7dDerived('metric-dl-i8', 'metric-dl-i-r1'),
    code: 'paid_amount_7d_typed',
    revisionId: 'metric-dl-i8-r1',
    spec: {...derived.spec, outputGrain: ['dim-channel'],
      qualifiers: [{dimensionId: 'dim-channel', op: 'eq', value: 1}]},
  }));
  assertRejectedAt(api.publishMetricRevision(typed.source, 'metric-dl-i8-r1', {}),
    'spec.qualifiers[0].value', 'INVALID_VALUE', 'metric.error.valueTypeMismatch');
});

test('语言表：新增 messageKey 在 zh/en 的 metric.error 下均存在', () => {
  ['zh', 'en'].forEach((lang) => {
    const text = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'lang', `${lang}.js`), 'utf8');
    const start = text.indexOf('    metric: {\n        error: {');
    assert.ok(start >= 0, `${lang} 有 metric.error 段`);
    const section = text.slice(start, text.indexOf('\n        },', start));
    ['disabledDictionaryEntry', 'valueTypeMismatch'].forEach((key) => {
      assert.ok(new RegExp(`\\n\\s+${key}: '`).test(section), `${lang}.metric.error.${key} 缺失`);
    });
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach(({name, error}) => {
    console.log(`\n--- ${name}`);
    console.log(error && error.stack ? error.stack : error);
  });
  process.exit(1);
}
