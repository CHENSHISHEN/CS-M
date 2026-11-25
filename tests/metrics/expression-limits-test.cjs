'use strict';
// 表达式长度/嵌套深度上限与解析异常结构化测试（MET-08）：
// (a) 超长（>2000 字符）、超深（>64 层括号）、非有限数字字面量均返回单个结构化 INVALID_VALUE，带 messageKey；
// (b) 深度 64 恰好通过、65 拒绝；解析通过的最大表达式 astToText / evaluateExpression / astRefKeys 不抛；
// (c) 经 validateMetricDraft 的复合校验：解析异常只产生结构化 errors[]（registry 对无 code 异常的包装为防御性兜底，公开入口的结构校验先于解析，无法稳定触发）。
// 复跑：node tests/metrics/expression-limits-test.cjs（仓库根目录）。
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

const nested = depth => `${'('.repeat(depth)}1${')'.repeat(depth)}`;
const catchError = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
};
const parseError = expression => catchError(() => api.parseExpression(expression, 'spec.expression'));
const assertTooComplex = (error, limit) => {
  assert.ok(error != null, 'expected a thrown structured error');
  assert.equal(error.code, 'INVALID_VALUE');
  assert.equal(error.path, 'spec.expression');
  assert.equal(error.messageKey, 'metric.error.expressionTooComplex');
  assert.equal(error.params.limit, limit);
};

test('常量导出：长度 2000、深度 64', () => {
  assert.equal(api.MAX_EXPRESSION_LENGTH, 2000);
  assert.equal(api.MAX_EXPRESSION_DEPTH, 64);
});

test('超深/超长括号（8000、3000 层）被结构化拒绝，不抛 RangeError', () => {
  [8000, 3000].forEach((depth) => {
    const error = parseError(nested(depth));
    assertTooComplex(error, 2000);
  });
});

test('20000 项平铺 1+1+… 被长度上限拒绝', () => {
  const expression = new Array(20000).fill('1').join('+');
  assertTooComplex(parseError(expression), 2000);
});

test('长度 2000 恰好通过、2001 拒绝', () => {
  const ok = `1${'+1'.repeat(999)}`; // 1999 字符
  assert.equal(ok.length, 1999);
  assert.equal(parseError(`${ok} `), null); // 2000 字符
  assertTooComplex(parseError(`${ok}  `), 2000); // 2001 字符
});

test('括号深度 64 恰好通过、65 拒绝（长度不超限时命中深度上限）', () => {
  assert.equal(parseError(nested(64)), null);
  assertTooComplex(parseError(nested(65)), 64);
  assertTooComplex(parseError(nested(100)), 64);
});

test('SAFE_DIVIDE 嵌套同样计入深度', () => {
  const build = (depth) => {
    let text = '1';
    for (let i = 0; i < depth; i += 1) text = `SAFE_DIVIDE(${text}, 1)`;
    return text;
  };
  assert.equal(parseError(build(64)), null);
  assertTooComplex(parseError(build(65)), 64);
});

test('同层多个括号不累计深度', () => {
  const expression = new Array(200).fill('(1)').join('+');
  assert.equal(parseError(expression), null);
});

test('400 位数字字面量（Infinity）被结构化拒绝', () => {
  const error = parseError('9'.repeat(400));
  assert.ok(error != null);
  assert.equal(error.code, 'INVALID_VALUE');
  assert.equal(error.path, 'spec.expression');
  assert.equal(typeof error.messageKey, 'string');
  assert.ok(error.messageKey.length > 0);
  // 小数形式同样拒绝
  assert.equal(parseError(`${'9'.repeat(400)}.5`).code, 'INVALID_VALUE');
});

test('解析通过的最大表达式：astToText / evaluateExpression / astRefKeys 不抛', () => {
  const deepest = api.parseExpression(nested(64), 'spec.expression');
  assert.equal(api.evaluateExpression(deepest, {}), 1);
  assert.equal(api.astToText(deepest), '1');
  assert.deepEqual(api.astRefKeys(deepest), []);

  const longest = api.parseExpression(`1${'+1'.repeat(999)} `, 'spec.expression');
  assert.equal(api.evaluateExpression(longest, {}), 1000);
  assert.ok(api.astToText(longest).length > 0);
  assert.equal(api.astContainsDivision(longest), false);
});

// ---- 复合校验：errors[] 只含结构化错误 ----
const buildSource = () => {
  let source = fixtures.baseProject();
  const step = (result) => {
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.source;
  };
  source = step(api.createMetricConcept(source, {id: 'concept-pay', domain: '交易', name: '支付', owner: 'user-owner'}));
  source = step(api.createMetricDraft(source, {
    ...fixtures.paidAmountAtomic('metric-paid-amount'), revisionId: 'mrev-paid-amount-1', conceptId: 'concept-pay'}));
  source = step(api.publishMetricRevision(source, 'mrev-paid-amount-1', {publishedAt: '2026-10-20T02:00:00Z'}));
  source = step(api.createMetricDraft(source, {
    ...fixtures.paidAmount7dDerived('metric-paid-7d', 'mrev-paid-amount-1'), revisionId: 'mrev-paid-7d-1'}));
  source = step(api.publishMetricRevision(source, 'mrev-paid-7d-1', {}));
  return source;
};

const validateCompound = (source, id, expression) => {
  const compound = {
    id,
    code: `c_${id}`,
    name: id,
    kind: 'compound',
    scope: {kind: 'public'},
    ownerId: 'user-owner',
    spec: {kind: 'compound', name: id, expression, refs: [{key: 'amount', revisionId: 'mrev-paid-7d-1'}]},
  };
  const created = api.createMetricDraft(source, {...compound, revisionId: `rev-${id}`});
  if (!created.ok) return created;
  return api.validateMetricDraft(created.source, `rev-${id}`, {});
};

test('复合校验：超长/超深/非有限数字均为单个结构化 INVALID_VALUE', () => {
  const source = buildSource();
  const cases = {
    deep8000: nested(8000),
    deep3000: nested(3000),
    deep100: `{{amount}}+${nested(100)}`,
    flat20000: new Array(20000).fill('1').join('+'),
    huge: `{{amount}}*${'9'.repeat(400)}`,
  };
  Object.keys(cases).forEach((name) => {
    const result = validateCompound(source, name, cases[name]);
    assert.equal(result.ok, false, name);
    assert.equal(result.errors.length, 1, `${name}: ${JSON.stringify(result.errors)}`);
    assert.equal(result.errors[0].code, 'INVALID_VALUE', name);
    assert.equal(typeof result.errors[0].messageKey, 'string', name);
  });
});

test('复合校验：非字符串表达式也只产生结构化 errors[]', () => {
  const source = buildSource();
  const created = api.createMetricDraft(source, {
    id: 'weird', code: 'c_weird', name: 'weird', kind: 'compound', scope: {kind: 'public'}, ownerId: 'user-owner',
    spec: {kind: 'compound', name: 'weird', expression: '{{amount}}', refs: [{key: 'amount', revisionId: 'mrev-paid-7d-1'}]},
    revisionId: 'rev-weird',
  });
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  // 绕过入口校验直接改写草案表达式为非字符串
  const mutated = created.source;
  const revision = mutated.profile.metricPlatform.revisions.filter(r => r.id === 'rev-weird')[0];
  revision.spec.expression = {};
  const result = api.validateMetricDraft(mutated, 'rev-weird', {});
  assert.equal(result.ok, false);
  result.errors.forEach((item) => {
    assert.equal(typeof item.code, 'string');
    assert.equal(typeof item.messageKey, 'string');
    assert.ok(!(item instanceof Error));
  });
  assert.ok(result.errors.some(item => item.code === 'INVALID_VALUE' && item.path === 'spec.expression'),
    JSON.stringify(result.errors));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach(({name, error}) => {
    console.log(`\n--- ${name}`);
    console.log(error && error.stack ? error.stack : error);
  });
  process.exit(1);
}
