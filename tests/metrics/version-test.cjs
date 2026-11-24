// 指标版本号测试（MET-05）：版本按最大值递增、废弃定义不可再发布、旧数据重复版本只读兼容。
// 复跑：node tests/metrics/version-test.cjs（仓库根目录）。合成数据，真实加载 src/lib/metric_platform。
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

const DEF_ID = 'metric-ver';
const ok = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result;
};

// 建一个已发布 v1.0 的原子指标
const baseWithV10 = () => {
  const created = ok(api.createMetricDraft(fixtures.baseProject(), {
    ...fixtures.paidAmountAtomic(DEF_ID), revisionId: 'mrev-ver-0',
  }));
  return ok(api.publishMetricRevision(created.source, 'mrev-ver-0', {})).source;
};

// 从最新发布版本开新草案并发布，返回 {source, revision}
const publishNext = (source, revisionId) => {
  const draft = ok(api.createRevisionDraft(source, DEF_ID, {revisionId}));
  const published = ok(api.publishMetricRevision(draft.source, revisionId, {}));
  return {source: published.source, revision: published.revision};
};

const versionsOf = (source) => api.getMetricDefinition(source, DEF_ID).revisions
  .filter(item => item.version != null).map(item => item.version);

test('废弃旧版本后继续发布：版本号取最大值+1，不重复(a)', () => {
  let source = baseWithV10();
  const r1 = publishNext(source, 'mrev-ver-1');
  assert.equal(r1.revision.version, '1.1');
  source = r1.source;
  // 仅废弃 v1.0（不存在单修订废弃 API，按落盘形状把该修订置为 deprecated）
  const poked = JSON.parse(JSON.stringify(source));
  poked.profile.metricPlatform.revisions.forEach((item) => {
    if (item.id === 'mrev-ver-0') item.status = 'deprecated';
  });
  const r2 = publishNext(poked, 'mrev-ver-2');
  assert.equal(r2.revision.version, '1.2');
  const versions = versionsOf(r2.source);
  assert.deepEqual(versions.slice().sort(), ['1.0', '1.1', '1.2']);
  assert.equal(new Set(versions).size, versions.length);
});

test('连发到 1.12：1.9 排在 1.10 之前，latest 为 1.12(b)', () => {
  let source = baseWithV10();
  for (let i = 1; i <= 12; i += 1) {
    const next = publishNext(source, `mrev-ver-${i}`);
    assert.equal(next.revision.version, `1.${i}`);
    source = next.source;
  }
  const info = api.getMetricDefinition(source, DEF_ID);
  assert.equal(info.latestPublished.version, '1.12');
  // 删去 1.12/1.11 后 latest 应为 1.10 而非 1.9（数值比较而非字符串比较）
  const trimmed = JSON.parse(JSON.stringify(source));
  trimmed.profile.metricPlatform.revisions = trimmed.profile.metricPlatform.revisions
    .filter(item => item.version !== '1.12' && item.version !== '1.11');
  assert.equal(api.getMetricDefinition(trimmed, DEF_ID).latestPublished.version, '1.10');
});

test('整定义废弃后发布遗留草案：ok:false 且存储不变(c)', () => {
  let source = baseWithV10();
  const draft = ok(api.createRevisionDraft(source, DEF_ID, {revisionId: 'mrev-ver-left'}));
  const deprecated = ok(api.deprecateMetricDefinition(draft.source, DEF_ID));
  const before = JSON.stringify(deprecated.source);
  const result = api.publishMetricRevision(deprecated.source, 'mrev-ver-left', {});
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'DEFINITION_DEPRECATED');
  assert.equal(result.errors[0].messageKey, 'metric.error.definitionDeprecated');
  assert.equal(JSON.stringify(deprecated.source), before);
  const left = api.getMetricRevision(deprecated.source, 'mrev-ver-left');
  assert.equal(left.status, 'draft');
  assert.equal(left.version, null);
});

test('旧数据已有两个 "1.0"：readMetricPlatform 不抛错且原样返回(d)', () => {
  const source = baseWithV10();
  const legacy = JSON.parse(JSON.stringify(source));
  const dup = JSON.parse(JSON.stringify(
    legacy.profile.metricPlatform.revisions.filter(item => item.id === 'mrev-ver-0')[0]));
  dup.id = 'mrev-ver-dup';
  legacy.profile.metricPlatform.revisions.push(dup);
  const before = JSON.stringify(legacy);
  let data;
  assert.doesNotThrow(() => { data = api.readMetricPlatform(legacy); });
  const forDef = data.revisions.filter(item => item.definitionId === DEF_ID);
  assert.deepEqual(forDef.map(item => item.version), ['1.0', '1.0']);
  assert.deepEqual(forDef.map(item => item.id), ['mrev-ver-0', 'mrev-ver-dup']);
  assert.equal(JSON.stringify(legacy), before);
  assert.doesNotThrow(() => api.getMetricDefinition(legacy, DEF_ID));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach(({name, error}) => {
    console.log(`\n--- ${name}`);
    console.log(error && error.stack ? error.stack : error);
  });
  process.exit(1);
}
