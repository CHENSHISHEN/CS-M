// 指标平台 M1/M3B：公共基线与部门快照（纯函数）。
// 部门口径 = 独立定义/独立 ID + 锁定的公共基线 revision + 白名单 patch + resolvedSpec 快照；
// 公共升级不触碰部门旧版，升级走显式新草案并重放 patch，冲突报错不做任意深 merge。
// 核心语义变化（聚合/单位/粒度/窗口/表达式等）必须显式分叉为独立定义，不作为 patch。
// M3B：基线扩展为三类（atomic=新增基础限定 / derived=原有白名单 / compound=仅展示键，
// 核心公式变化一律显式分叉，在新定义草案上修改）；公共升级若触及语义键则拒绝重放，
// 引导从新公共版本显式分叉。注：构建链不识别 ??，使用 == null 三元。

import {metricError} from './errors';
import {draftEtag, isStoreWritable, readMetricPlatform, writeMetricPlatform} from './store';
import {createMetricDraft} from './registry';
import {
  applyDepartmentPatch, isSemanticChange, validateDepartmentPatch,
} from './patch';
import {hashValue, newMetricId} from './hash';

// patch 纯函数在 ./patch.js（避免 registry ↔ baseline 循环引用），此处转出保持 M1 API 兼容
export {applyDepartmentPatch, isSemanticChange, validateDepartmentPatch};

const findRevision = (data, id) => (data.revisions || []).filter(item => item.id === id)[0] || null;
const findDefinition = (data, id) => (data.definitions || []).filter(item => item.id === id)[0] || null;

const storeGuard = (data) => {
  if (!isStoreWritable(data)) {
    return [metricError('SCHEMA_VERSION_UNSUPPORTED', 'profile.metricPlatform.schemaVersion',
      'metric.error.schemaUnsupported', 'metric platform schema version unsupported')];
  }
  return [];
};

// 深拷贝小对象：升级草案的 patch 与旧部门发布版隔离（R1）
const cloneJson = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

// ---- 从公共已发布版本建立部门口径（新定义 + 首个草案；M3B 起三类基线均可用） ----
// atomic=追加基础限定（addBaseQualifiers）；derived=白名单限定/粒度收窄（M1）；
// compound=显式分叉：patch 仅展示键，核心公式变化在分叉出的新定义草案上修改并发布，
// 不以任意 patch 伪装继承；forkNote 记录分叉原因（可选）。
export const createDepartmentMetricDraft = (source, input) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const baseRevision = findRevision(data, input == null ? null : input.baseRevisionId);
  if (baseRevision == null) {
    return {ok: false, errors: [metricError('UNKNOWN_REFERENCE', 'baseRevisionId',
      'metric.error.unknownReference', 'baseline revision does not exist')]};
  }
  if (baseRevision.status !== 'published') {
    return {ok: false, errors: [metricError('UNPUBLISHED_REFERENCE', 'baseRevisionId',
      'metric.error.unpublishedReference', 'baseline revision must be published')]};
  }
  const baseDefinition = findDefinition(data, baseRevision.definitionId);
  if (baseDefinition == null || baseDefinition.scope.kind !== 'public') {
    return {ok: false, errors: [metricError('SCOPE_POLICY', 'baseRevisionId', 'metric.error.scopePolicy',
      'department baseline must be a published public revision')]};
  }
  if (baseRevision.spec == null
    || ['atomic', 'derived', 'compound'].indexOf(baseRevision.spec.kind) < 0) {
    return {ok: false, errors: [metricError('INVALID_VALUE', 'baseRevisionId', 'metric.error.invalidValue',
      'department baseline requires an atomic/derived/compound metric')]};
  }
  const patchResult = validateDepartmentPatch(data, input.patch, baseRevision);
  if (patchResult.errors.length) return {ok: false, errors: patchResult.errors};
  const spec = applyDepartmentPatch(baseRevision.spec, patchResult.patch);
  if (input != null && input.name != null) spec.name = input.name;
  if (input != null && input.description != null && input.description !== '') {
    spec.description = input.description;
  }
  return createMetricDraft(source, {
    code: input.code,
    name: spec.name,
    scope: {kind: 'department', departmentId: input.departmentId},
    ownerId: input.ownerId,
    spec,
    ...(input.conceptId == null ? {} : {conceptId: input.conceptId}),
    ...(input.id == null ? {} : {id: input.id}),
    ...(input.revisionId == null ? {} : {revisionId: input.revisionId}),
    ...(input.createdAt == null ? {} : {createdAt: input.createdAt}),
    ...(input.namespace == null ? {} : {namespace: input.namespace}),
    baseline: {
      definitionId: baseDefinition.id,
      revisionId: baseRevision.id,
      baseRevisionId: baseRevision.id,
    },
    patch: patchResult.patch,
    // M3B：显式分叉标记（复合基线必为分叉；派生/原子语义适配需显式勾选），
    // 分叉草案可自由编辑，未分叉继承草案由 updateMetricDraft 保持 基线+patch 一致
    ...(input != null && input.fork === true ? {fork: true} : {}),
    ...(input == null || input.forkNote == null || input.forkNote === ''
      ? {} : {forkNote: input.forkNote}),
  });
};

// ---- 结构化 diff（叶子/数组按稳定序列化对比，报告路径级差异） ----
const isPlainObject = (value) =>
  value != null && typeof value === 'object' && !Array.isArray(value);

export const diffMetricSpecs = (left, right) => {
  const changes = [];
  const walk = (a, b, path) => {
    const aPlain = isPlainObject(a);
    const bPlain = isPlainObject(b);
    if (aPlain !== bPlain || (!aPlain && !bPlain)) {
      if (hashValue(a) !== hashValue(b)) {
        changes.push({path: path || '', left: a === undefined ? null : a, right: b === undefined ? null : b});
      }
      return;
    }
    const keys = {};
    Object.keys(a == null ? {} : a).forEach(key => { keys[key] = true; });
    Object.keys(b == null ? {} : b).forEach(key => { keys[key] = true; });
    Object.keys(keys).forEach((key) => {
      const nextPath = path == null || path === '' ? key : `${path}.${key}`;
      walk(a == null ? undefined : a[key], b == null ? undefined : b[key], nextPath);
    });
  };
  walk(left, right, '');
  return changes;
};

// ---- 升级对比：旧公共 / 候选公共 / 当前部门 三方信息（只读，不写入） ----
export const compareBaselineUpgrade = (source, departmentRevisionId, candidateBaseRevisionId) => {
  const data = readMetricPlatform(source);
  const departmentRevision = findRevision(data, departmentRevisionId);
  if (departmentRevision == null || departmentRevision.baseline == null) {
    return {ok: false, errors: [metricError('UNKNOWN_REFERENCE', 'departmentRevisionId',
      'metric.error.unknownReference', 'department revision or its baseline does not exist')]};
  }
  const baselineRevision = findRevision(data, departmentRevision.baseline.baseRevisionId);
  const candidate = findRevision(data, candidateBaseRevisionId);
  if (candidate == null || candidate.status !== 'published') {
    return {ok: false, errors: [metricError('UNPUBLISHED_REFERENCE', 'candidateBaseRevisionId',
      'metric.error.unpublishedReference', 'candidate baseline revision must be published')]};
  }
  if (baselineRevision == null || candidate.definitionId !== baselineRevision.definitionId) {
    return {ok: false, errors: [metricError('INVALID_VALUE', 'candidateBaseRevisionId',
      'metric.error.invalidValue', 'candidate must be another revision of the same public definition')]};
  }
  // patch 重放到候选的冲突（不改部门旧版）
  const replay = validateDepartmentPatch(data, departmentRevision.patch, candidate);
  const publicChanges = diffMetricSpecs(baselineRevision.spec, candidate.spec);
  return {
    ok: true,
    departmentRevisionId,
    baseline: {revisionId: baselineRevision.id, version: baselineRevision.version,
      spec: baselineRevision.spec},
    candidate: {revisionId: candidate.id, version: candidate.version, spec: candidate.spec},
    department: {revisionId: departmentRevision.id, version: departmentRevision.version,
      spec: departmentRevision.spec, patch: departmentRevision.patch == null ? {} : departmentRevision.patch},
    publicChanges,
    // 公共侧核心语义变化（统计对象/单位/时间角色/窗口/公式/口径等）：
    // 白名单 patch 不能覆盖，升级重放被拒绝，必须从新公共版本显式分叉（M3B）
    semanticChanges: publicChanges.filter(isSemanticChange),
    departmentDelta: diffMetricSpecs(baselineRevision.spec, departmentRevision.spec),
    replayConflicts: replay.errors,
  };
};

// ---- 显式升级：基于候选公共版本重放 patch 建新草案；旧部门发布版不动 ----
// 公共侧存在核心语义变化（semanticChanges）时拒绝重放：白名单 patch 不能覆盖
// 统计对象/单位/时间角色等变化，需从候选公共版本显式分叉为新部门定义（M3B）。
export const upgradeDepartmentDraft = (source, input) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const departmentRevision = findRevision(data, input == null ? null : input.departmentRevisionId);
  if (departmentRevision == null || departmentRevision.status !== 'published'
    || departmentRevision.baseline == null) {
    return {ok: false, errors: [metricError('UNKNOWN_REFERENCE', 'departmentRevisionId',
      'metric.error.unknownReference',
      'upgrade requires a published department revision with a locked baseline')]};
  }
  // 分叉口径没有可继承的基线契约：重放 patch 会静默覆盖分叉自己的修改（MET-01），拒绝升级
  if (departmentRevision.fork === true) {
    return {ok: false, errors: [metricError('FORK_NOT_UPGRADABLE', 'departmentRevisionId',
      'metric.error.forkNotUpgradable',
      'forked department revision cannot be upgraded; edit it via a new revision draft instead')]};
  }
  const definition = findDefinition(data, departmentRevision.definitionId);
  if (definition == null) {
    return {ok: false, errors: [metricError('UNKNOWN_REFERENCE', 'definitionId',
      'metric.error.unknownReference', 'department definition does not exist')]};
  }
  const activeDrafts = (data.revisions || []).filter(item =>
    item.definitionId === definition.id && item.status === 'draft');
  if (activeDrafts.length) {
    return {ok: false, errors: [metricError('ACTIVE_DRAFT_EXISTS', 'definitionId',
      'metric.error.activeDraft', 'definition already has an active draft')]};
  }
  const compare = compareBaselineUpgrade(source, input.departmentRevisionId, input.candidateBaseRevisionId);
  if (!compare.ok) return compare;
  if (compare.replayConflicts.length) {
    return {ok: false, errors: compare.replayConflicts};
  }
  if (compare.semanticChanges.length) {
    return {ok: false, errors: [metricError('SEMANTIC_CHANGE_REQUIRES_FORK', 'candidateBaseRevisionId',
      'metric.error.semanticFork',
      `public revision changed core semantics (${compare.semanticChanges
        .map(change => change.path).join(', ')}); fork a new department definition from it instead`,
      {paths: compare.semanticChanges.map(change => change.path).join(', ')})]};
  }
  const candidate = findRevision(data, input.candidateBaseRevisionId);
  const spec = applyDepartmentPatch(candidate.spec, departmentRevision.patch == null
    ? {} : departmentRevision.patch);
  const revisionId = (input == null ? null : input.revisionId) || newMetricId('mrev');
  // 显式 revisionId 唯一（R1）：不容许覆盖既有修订
  if (findRevision(data, revisionId) != null) {
    return {ok: false, errors: [metricError('DUPLICATE_ID', 'revisionId', 'metric.error.duplicateId',
      `metric revision id already exists: ${revisionId}`, {id: revisionId})]};
  }
  const now = (input == null ? null : input.createdAt) || null;
  const revision = {
    id: revisionId,
    definitionId: definition.id,
    version: null,
    status: 'draft',
    rev: 1,
    spec,
    baseline: {
      definitionId: candidate.definitionId,
      revisionId: candidate.id,
      baseRevisionId: candidate.id,
    },
    patch: cloneJson(departmentRevision.patch == null ? {} : departmentRevision.patch),
    hash: null,
    etag: null,
    createdBy: (input == null ? null : input.createdBy) || definition.ownerId,
    createdAt: now,
    upgradedFromRevisionId: departmentRevision.id,
  };
  revision.etag = draftEtag(revision);
  const next = {...data, revisions: data.revisions.concat([revision])};
  return {
    ok: true,
    source: writeMetricPlatform(source, next),
    revision: cloneJson(revision),
    publicChanges: compare.publicChanges,
  };
};
