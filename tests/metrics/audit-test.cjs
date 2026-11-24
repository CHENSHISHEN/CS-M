// 哈希可校验与存储审计测试（MET-03 / MET-22）：SHA-256 内容哈希、发布 hash 校验、
// 存储审计（哈希不符/重复版本/悬空引用）、读取返回副本、导入不洗白被篡改内容。
// 复跑：node tests/metrics/audit-test.cjs（仓库根目录）。合成数据，真实加载 src/lib/metric_platform。
const assert = require('assert/strict');
const crypto = require('crypto');
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
const clone = value => JSON.parse(JSON.stringify(value));
// 仅测试内用 node crypto 作为对照真值；被测实现不得依赖 crypto
const nodeSha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// 公共原子 v1.0 + 公共派生(近7日) v1.0，均经真实 API 发布
const buildStore = () => {
  let source = fixtures.baseProject();
  source = ok(api.createMetricDraft(source, {
    ...fixtures.paidAmountAtomic('metric-au-amount'), revisionId: 'mrev-au-amount-1',
  })).source;
  source = ok(api.publishMetricRevision(source, 'mrev-au-amount-1', {})).source;
  source = ok(api.createMetricDraft(source, {
    ...fixtures.paidAmount7dDerived('metric-au-7d', 'mrev-au-amount-1'), revisionId: 'mrev-au-7d-1',
  })).source;
  source = ok(api.publishMetricRevision(source, 'mrev-au-7d-1', {})).source;
  return source;
};

const platformOf = source => source.profile.metricPlatform;
const withPlatform = (source, platform) => ({...source, profile: {...source.profile, metricPlatform: platform}});
const legacyHashOf = revision => api.hashValue({spec: revision.spec, resolvedSpec: revision.resolvedSpec});
const issuesOf = (result, code) => result.issues.filter(issue => issue.code === code);

// 旧版本库：全部已发布修订改用旧算法 h<8hex>（模拟升级前保存的项目）
const toLegacyStore = (source) => {
  const platform = clone(platformOf(source));
  platform.revisions = platform.revisions.map(revision => (revision.status === 'draft' ? revision
    : {...revision, hash: legacyHashOf(revision)}));
  return withPlatform(source, platform);
};

const emptyMerge = {entities: [], logicEntities: [], conceptEntities: []};
const importInto = (targetProfile, sourceProfile, ids) => {
  let cursor = 0;
  const proposals = ids || [];
  return api.mergeMetricPlatformForImport({
    targetProfile, sourceProfile, merged: emptyMerge, sources: emptyMerge,
    makeId: () => (cursor < proposals.length ? proposals[cursor++] : `id-gen-${cursor++}`),
  });
};

// ---------------- (a) SHA-256 原语 ----------------
test('(a) sha256Hex 已知向量：abc / 空串 / 两块消息', () => {
  assert.equal(api.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(api.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(api.sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('(a) sha256Hex 非 ASCII 按 UTF-8 编码，与 node crypto 一致（中文/emoji/边界长度）', () => {
  const samples = ['已支付成交金额（近7日）', '指标😀口径', 'é', 'a'.repeat(55), 'a'.repeat(56),
    'a'.repeat(64), '中'.repeat(100)];
  samples.forEach((text) => {
    assert.equal(api.sha256Hex(text), nodeSha256(text), `mismatch for ${JSON.stringify(text.slice(0, 12))}`);
  });
});

test('(a) contentHash = "sha256:" + sha256Hex(stableStringify(value))，与键序无关', () => {
  const value = {b: [1, {d: '中', c: null}], a: 'x'};
  assert.equal(api.contentHash(value), `sha256:${nodeSha256(api.stableStringify(value))}`);
  assert.equal(api.contentHash(value), api.contentHash({a: 'x', b: [1, {c: null, d: '中'}]}));
  assert.match(api.contentHash(value), /^sha256:[0-9a-f]{64}$/);
  // 旧 FNV hashValue 保持不变（等值比较/etag 仍用它）
  assert.match(api.hashValue(value), /^h[0-9a-f]{8}$/);
});

// ---------------- 新发布 hash ----------------
test('新发布修订 hash 为 sha256: 前缀并可校验通过', () => {
  const source = buildStore();
  ['mrev-au-amount-1', 'mrev-au-7d-1'].forEach((id) => {
    const revision = api.getMetricRevision(source, id);
    assert.match(revision.hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(revision.hash, api.contentHash({spec: revision.spec, resolvedSpec: revision.resolvedSpec}));
    assert.deepEqual(api.verifyRevisionHash(revision), {ok: true, legacy: false});
  });
  const audit = api.auditMetricStore(source);
  assert.deepEqual(audit, {ok: true, issues: []});
});

// ---------------- (b) 篡改检测 ----------------
test('(b) 篡改已发布修订 spec.unit → auditMetricStore 报 HASH_MISMATCH 指向该修订', () => {
  const source = buildStore();
  const platform = clone(platformOf(source));
  platform.revisions.filter(r => r.id === 'mrev-au-amount-1')[0].spec.unit = 'USD';
  const tampered = withPlatform(source, platform);
  const verify = api.verifyRevisionHash(platform.revisions.filter(r => r.id === 'mrev-au-amount-1')[0]);
  assert.deepEqual(verify, {ok: false, legacy: false});
  const audit = api.auditMetricStore(tampered);
  assert.equal(audit.ok, false);
  assert.deepEqual(issuesOf(audit, 'HASH_MISMATCH'), [{code: 'HASH_MISMATCH', path: 'revisions[mrev-au-amount-1].hash'}]);
  assert.equal(audit.issues.length, 1, JSON.stringify(audit.issues));
});

test('(b) 篡改 resolvedSpec / 置空 hash / 非法格式 hash 均判不一致', () => {
  const revision = api.getMetricRevision(buildStore(), 'mrev-au-7d-1');
  assert.deepEqual(api.verifyRevisionHash({...revision, resolvedSpec: {...revision.resolvedSpec, unit: 'X'}}),
    {ok: false, legacy: false});
  assert.deepEqual(api.verifyRevisionHash({...revision, hash: null}), {ok: false, legacy: false});
  assert.deepEqual(api.verifyRevisionHash({...revision, hash: 'md5:abc'}), {ok: false, legacy: false});
  assert.deepEqual(api.verifyRevisionHash({...revision, hash: revision.hash.toUpperCase()}),
    {ok: false, legacy: false});
  // 草案不校验（无发布 hash）：ok=true 并标记 skipped
  assert.deepEqual(api.verifyRevisionHash({...revision, status: 'draft', hash: null}),
    {ok: true, legacy: false, skipped: true});
});

// ---------------- (c) 读取返回副本 ----------------
test('(c) 修改 getMetricRevision 返回对象不影响存储内数据', () => {
  const source = buildStore();
  const before = JSON.stringify(source);
  const revision = api.getMetricRevision(source, 'mrev-au-amount-1');
  revision.spec.unit = 'USD';
  revision.resolvedSpec.unit = 'USD';
  revision.hash = 'sha256:forged';
  revision.spec.baseQualifiers.push({dimensionId: 'x', op: 'eq', value: 1});
  const reread = api.getMetricRevision(source, 'mrev-au-amount-1');
  assert.equal(reread.spec.unit, 'CNY');
  assert.equal(reread.resolvedSpec.unit, 'CNY');
  assert.equal(reread.spec.baseQualifiers.length, 3);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(api.auditMetricStore(source), {ok: true, issues: []});
});

test('(c) getMetricDefinition / listMetricDefinitions 返回副本，修改不影响存储', () => {
  const source = buildStore();
  const before = JSON.stringify(source);
  const detail = api.getMetricDefinition(source, 'metric-au-amount');
  detail.definition.code = 'hacked';
  detail.revisions[0].spec.unit = 'USD';
  detail.latestPublished.resolvedSpec.unit = 'USD';
  const entries = api.listMetricDefinitions(source);
  entries[0].definition.name = 'hacked';
  entries[0].latestPublished.spec.unit = 'USD';
  assert.equal(JSON.stringify(source), before);
  assert.equal(api.getMetricDefinition(source, 'metric-au-amount').definition.code, 'paid_amount');
  assert.equal(api.getMetricRevision(source, 'mrev-au-amount-1').spec.unit, 'CNY');
});

// ---------------- (d) 旧格式兼容 ----------------
test('(d) 旧 h<8hex> 哈希：verifyRevisionHash → {ok:true, legacy:true}，audit 不报 HASH_MISMATCH', () => {
  const legacy = toLegacyStore(buildStore());
  platformOf(legacy).revisions.forEach((revision) => {
    assert.match(revision.hash, /^h[0-9a-f]{8}$/);
    assert.deepEqual(api.verifyRevisionHash(revision), {ok: true, legacy: true});
  });
  assert.deepEqual(api.auditMetricStore(legacy), {ok: true, issues: []});
  // 旧格式内容被篡改仍判不一致（旧算法重算比对）
  const revision = clone(platformOf(legacy).revisions[0]);
  revision.spec.unit = 'USD';
  assert.deepEqual(api.verifyRevisionHash(revision), {ok: false, legacy: true});
});

// ---------------- (e) 重复版本只报告 ----------------
test('(e) 历史库一个定义下两个 "1.0" → DUPLICATE_VERSION（后者路径），存储不改写', () => {
  const legacy = toLegacyStore(buildStore());
  const platform = clone(platformOf(legacy));
  const first = platform.revisions.filter(r => r.id === 'mrev-au-amount-1')[0];
  platform.revisions.push({...clone(first), id: 'mrev-au-amount-dup', publishedAt: null});
  const store = withPlatform(legacy, platform);
  const before = JSON.stringify(store);
  const audit = api.auditMetricStore(store);
  assert.equal(audit.ok, false);
  assert.deepEqual(audit.issues, [{code: 'DUPLICATE_VERSION', path: 'revisions[mrev-au-amount-dup].version'}]);
  assert.equal(JSON.stringify(store), before, 'audit 只报告不修复');
  assert.equal(platformOf(store).revisions.filter(r => r.version === '1.0'
    && r.definitionId === 'metric-au-amount').length, 2);
});

// ---------------- 悬空引用 ----------------
test('DANGLING_REFERENCE：定义缺失 / 派生原子引用缺失 / 绑定版本引用缺失，顺序确定', () => {
  const source = buildStore();
  const platform = clone(platformOf(source));
  const orphan = clone(platform.revisions.filter(r => r.id === 'mrev-au-amount-1')[0]);
  orphan.id = 'mrev-orphan';
  orphan.definitionId = 'metric-missing';
  orphan.hash = api.contentHash({spec: orphan.spec, resolvedSpec: orphan.resolvedSpec});
  const derived = platform.revisions.filter(r => r.id === 'mrev-au-7d-1')[0];
  derived.spec.atomicRevisionId = 'mrev-missing';
  derived.hash = api.contentHash({spec: derived.spec, resolvedSpec: derived.resolvedSpec});
  derived.baseRevisionId = 'mrev-missing-base';
  platform.revisions.push(orphan);
  platform.bindings = [{id: 'bind-x', role: 'COMPUTES_FROM', metricRevisionId: 'mrev-gone',
    metricDefinitionId: 'metric-gone', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-trade-order'}}];
  const store = withPlatform(source, platform);
  const before = JSON.stringify(store);
  const first = api.auditMetricStore(store);
  assert.deepEqual(first.issues, [
    {code: 'DANGLING_REFERENCE', path: 'revisions[mrev-au-7d-1].baseRevisionId'},
    {code: 'DANGLING_REFERENCE', path: 'revisions[mrev-au-7d-1].spec.atomicRevisionId'},
    {code: 'DANGLING_REFERENCE', path: 'revisions[mrev-orphan].definitionId'},
    {code: 'DANGLING_REFERENCE', path: 'bindings[bind-x].metricRevisionId'},
    {code: 'DANGLING_REFERENCE', path: 'bindings[bind-x].metricDefinitionId'},
  ]);
  assert.deepEqual(api.auditMetricStore(store), first, '确定性');
  assert.equal(JSON.stringify(store), before);
});

test('auditMetricStore 空项目/无存储 → ok', () => {
  assert.deepEqual(api.auditMetricStore(fixtures.baseProject()), {ok: true, issues: []});
  assert.deepEqual(api.auditMetricStore(null), {ok: true, issues: []});
});

// ---------------- (f) 导入 ----------------
test('(f) 合并导入：来源发布内容被篡改 → 拒绝导入，不并入任何内容，留 HASH_MISMATCH 诊断', () => {
  assert.equal(api.IMPORT_METRIC_HASH_MISMATCH, 'METRIC_IMPORT_HASH_MISMATCH');
  const sourcePlatform = clone(platformOf(buildStore()));
  sourcePlatform.revisions.filter(r => r.id === 'mrev-au-amount-1')[0].spec.unit = 'USD';
  const sourceBefore = JSON.stringify(sourcePlatform);
  // 目标已有指标存储：原样保留，仅追加诊断
  const target = {...fixtures.baseProject(), profile: {metricPlatform: {schemaVersion: 1, namespace: 'mns-t',
    concepts: [], definitions: [], revisions: [], bindings: []}}};
  const result = importInto(target.profile, {metricPlatform: sourcePlatform});
  assert.equal(result.revisions.length, 0, '不并入任何版本');
  assert.equal(result.definitions.length, 0, '不并入任何定义');
  assert.equal(result.namespace, 'mns-t');
  const diags = (result.importDiagnostics || []).filter(d => d.code === 'METRIC_IMPORT_HASH_MISMATCH');
  assert.equal(diags.length, 1);
  assert.deepEqual(diags[0].revisionIds, ['mrev-au-amount-1']);
  assert.equal(JSON.stringify(sourcePlatform), sourceBefore, '来源输入不被修改');
  // 目标无指标存储：同样拒绝，仅留诊断（让导入通知可见）
  const fresh = importInto({}, {metricPlatform: sourcePlatform});
  assert.equal((fresh.revisions || []).length, 0);
  assert.equal((fresh.definitions || []).length, 0);
  assert.equal((fresh.importDiagnostics || [])[0].code, 'METRIC_IMPORT_HASH_MISMATCH');
});

test('(f) reduce 阶段不洗白：被篡改的原子即使被重映射，hash 仍不一致，随后合并被拒', () => {
  const store = buildStore();
  const platform = clone(platformOf(store));
  platform.revisions.filter(r => r.id === 'mrev-au-amount-1')[0].spec.unit = 'USD';
  const project = withPlatform(store, platform);
  const renamed = {...fixtures.orderEntity, id: 'entity-new', old: fixtures.orderEntity.id,
    fields: fixtures.orderEntity.fields.map(f => ({...f, id: `${f.id}-new`, old: f.id}))};
  const reduced = api.remapMetricPlatformForReduce(project, {
    entities: [renamed], logicEntities: [], conceptEntities: [],
    sourceEntities: [fixtures.orderEntity], sourceLogicEntities: [], sourceConceptEntities: [],
  });
  const atomic = reduced.revisions.filter(r => r.id === 'mrev-au-amount-1')[0];
  assert.equal(atomic.spec.source.modelId, 'entity-new', '确实发生了重映射');
  assert.equal(api.verifyRevisionHash(atomic).ok, false, '被篡改内容不得被重算 hash 洗白');
  const result = importInto({}, {metricPlatform: reduced});
  assert.equal((result.revisions || []).length, 0);
  assert.equal(result.importDiagnostics[0].code, 'METRIC_IMPORT_HASH_MISMATCH');
});

test('(f) 干净导出（sha256）往返：reduce 重映射 + 合并 ID 换新后 hash 均校验通过', () => {
  const store = buildStore();
  const renamed = {...fixtures.orderEntity, id: 'entity-new', old: fixtures.orderEntity.id,
    fields: fixtures.orderEntity.fields.map(f => ({...f, id: `${f.id}-new`, old: f.id}))};
  const reduced = api.remapMetricPlatformForReduce(store, {
    entities: [renamed], logicEntities: [], conceptEntities: [],
    sourceEntities: [fixtures.orderEntity], sourceLogicEntities: [], sourceConceptEntities: [],
  });
  reduced.revisions.forEach((revision) => {
    assert.match(revision.hash, /^sha256:/);
    assert.deepEqual(api.verifyRevisionHash(revision), {ok: true, legacy: false});
  });
  // 导入到同一项目：版本 ID 撞号换新，派生对原子的引用随之改写（spec 合法变更）
  const result = importInto(store.profile, {metricPlatform: reduced},
    ['metric-n1', 'metric-n2', 'mrev-n1', 'mrev-n2']);
  const imported = result.revisions.filter(r => r.id === 'mrev-n1' || r.id === 'mrev-n2');
  assert.equal(imported.length, 2);
  const derived = imported.filter(r => r.spec.kind === 'derived')[0];
  assert.equal(derived.spec.atomicRevisionId, 'mrev-n1', '派生引用随换新改写');
  result.revisions.forEach((revision) => {
    assert.deepEqual(api.verifyRevisionHash(revision), {ok: true, legacy: false}, revision.id);
  });
  assert.equal(api.auditMetricStore(withPlatform(store, result)).issues
    .filter(i => i.code === 'HASH_MISMATCH').length, 0);
});

test('(f) 旧格式导出（h<8hex>）仍可导入，导入后 hash 校验通过', () => {
  const legacy = toLegacyStore(buildStore());
  const result = importInto({}, {metricPlatform: clone(platformOf(legacy))});
  assert.equal(result.revisions.length, 2);
  result.revisions.forEach((revision) => {
    assert.equal(api.verifyRevisionHash(revision).ok, true, revision.id);
  });
  assert.equal((result.importDiagnostics || []).some(d => d.code === 'METRIC_IMPORT_HASH_MISMATCH'), false);
});

test('导入拒绝诊断有中英文文案（模型关联页诊断标签）', () => {
  const zh = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'lang', 'zh.js'), 'utf8');
  const en = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'lang', 'en.js'), 'utf8');
  assert.match(zh, /hashMismatch:\s*'/);
  assert.match(en, /hashMismatch:\s*'/);
  const page = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app', 'metrics', 'BindingsPage.js'), 'utf8');
  assert.match(page, /METRIC_IMPORT_HASH_MISMATCH:\s*'metrics\.binding\.diag\.hashMismatch'/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach(({name, error}) => {
    console.log(`\n--- ${name}`);
    console.log(error && error.stack ? error.stack : error);
  });
  process.exit(1);
}
