// 指标平台 M3B：公共/部门口径与版本治理（纯函数）。
// - 业务域/概念同源治理：稳定 ID 不变，名称/说明可维护；被引用概念删除与实质语义
//   变更（domain）被保护（CONCEPT_IN_USE），不直接改旧发布版本，不建第二概念事实源；
// - 公共新版本影响：列受影响部门口径（含草案），供三方比较与保持旧版/显式升级决策；
// - 引用影响：任一版本的反向依赖清单（原子基/操作数/部门基线），供版本页与废弃提示。
// 约定同 M1：读不改源；写返回 {ok:true, source, ...} 或 {ok:false, errors}；不用 ?? / ?.。

import {metricError, missingFieldError} from './errors';
import {newMetricId} from './hash';
import {readMetricPlatform, storeWriteErrors, writeMetricPlatform} from './store';
import {compareBaselineUpgrade} from './baseline';

const findDefinition = (data, id) =>
  (data.definitions || []).filter(item => item.id === id)[0] || null;
const findRevision = (data, id) =>
  (data.revisions || []).filter(item => item.id === id)[0] || null;
const definitionRevisions = (data, definitionId) =>
  (data.revisions || []).filter(item => item.definitionId === definitionId);
const versionOrder = (version) => {
  const parts = String(version == null ? '0.0' : version).split('.');
  return Number(parts[0]) * 100000 + Number(parts[1] || 0);
};
const latestPublished = (data, definitionId) =>
  definitionRevisions(data, definitionId)
    .filter(item => item.status === 'published')
    .sort((a, b) => (versionOrder(a.version) < versionOrder(b.version) ? 1 : -1))[0] || null;

// 写前守卫统一走 store.storeWriteErrors（STORE_CORRUPT / SCHEMA_VERSION_UNSUPPORTED）
const storeGuard = data => storeWriteErrors(data);

// ---- 概念引用（复用 concepts 事实源；引用位置=定义归属 definition.conceptId） ----
export const listConceptReferences = (source, conceptId) => {
  const data = readMetricPlatform(source);
  const refs = [];
  (data.definitions || []).forEach((definition) => {
    if (definition.conceptId !== conceptId) return;
    const revisions = definitionRevisions(data, definition.id);
    const published = revisions.filter(item => item.status === 'published').length;
    refs.push({
      definitionId: definition.id,
      definitionCode: definition.code,
      definitionName: definition.name,
      kind: definition.kind,
      revisionId: null,
      version: null,
      status: revisions.some(item => item.status === 'draft')
        ? 'draft' : (published > 0 ? 'published' : null),
      where: ['definition.conceptId'],
    });
  });
  return refs;
};

// ---- 概念编辑：稳定 ID 不变；名称/说明/负责人/标签可维护；domain 为实质语义键，
// 被引用时改变即拒绝（引导新建概念），未引用时允许调整归属 ----
export const updateMetricConcept = (source, conceptId, patch) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const errors = [];
  if (conceptId == null) errors.push(missingFieldError('concept', 'id'));
  const concept = conceptId == null
    ? null : (data.concepts || []).filter(item => item.id === conceptId)[0] || null;
  if (concept == null) {
    return {ok: false, errors: errors.length ? errors : [metricError('UNKNOWN_REFERENCE',
      'concept.id', 'metric.error.unknownReference', `concept does not exist: ${conceptId}`)]};
  }
  if (errors.length) return {ok: false, errors};
  const next = patch == null ? {} : patch;
  const allowedKeys = ['name', 'meaning', 'owner', 'tags', 'domain'];
  Object.keys(next).forEach((key) => {
    if (allowedKeys.indexOf(key) < 0) {
      errors.push(metricError('UNKNOWN_KEY', `concept.${key}`, 'metric.error.unknownKey',
        `concept field not editable: ${key} (id is stable)`));
    }
  });
  if (next.name != null && (typeof next.name !== 'string' || next.name.trim() === '')) {
    errors.push(metricError('INVALID_VALUE', 'concept.name', 'metric.error.invalidValue',
      'concept name must be a non-empty string'));
  }
  ['meaning', 'owner'].forEach((key) => {
    if (next[key] !== undefined && next[key] !== null && typeof next[key] !== 'string') {
      errors.push(metricError('INVALID_VALUE', `concept.${key}`, 'metric.error.invalidValue',
        `concept ${key} must be a string`));
    }
  });
  if (next.tags !== undefined && next.tags !== null) {
    if (!Array.isArray(next.tags) || next.tags.some(tag => typeof tag !== 'string')) {
      errors.push(metricError('INVALID_VALUE', 'concept.tags', 'metric.error.invalidValue',
        'concept tags must be an array of strings'));
    }
  }
  if (next.domain !== undefined && next.domain !== concept.domain) {
    const refs = listConceptReferences(source, conceptId);
    if (refs.length) {
      errors.push(metricError('CONCEPT_IN_USE', 'concept.domain', 'metric.error.conceptInUse',
        `concept is referenced by ${refs.length} definition(s); domain is semantic and cannot change`,
        {refs: refs.map(ref => ref.definitionCode).join(', ')}));
    }
  }
  if (errors.length) return {ok: false, errors};
  const concepts = data.concepts.map((item) => {
    if (item.id !== conceptId) return item;
    return {
      ...item,
      ...(next.name === undefined ? {} : {name: next.name}),
      ...(next.domain === undefined ? {} : {domain: next.domain}),
      ...(next.meaning === undefined ? {} : {meaning: next.meaning}),
      ...(next.owner === undefined ? {} : {owner: next.owner}),
      ...(next.tags === undefined ? {} : {tags: next.tags}),
    };
  });
  const updated = concepts.filter(item => item.id === conceptId)[0];
  return {
    ok: true,
    source: writeMetricPlatform(source, {...data, concepts}),
    concept: JSON.parse(JSON.stringify(updated)),
  };
};

// ---- 概念删除：被引用即拒绝（CONCEPT_IN_USE，附引用者）；未引用可删（UI 先确认） ----
export const deleteMetricConcept = (source, conceptId) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const concept = (data.concepts || []).filter(item => item.id === conceptId)[0] || null;
  if (concept == null) {
    return {ok: false, errors: [metricError('UNKNOWN_REFERENCE', 'concept.id',
      'metric.error.unknownReference', `concept does not exist: ${conceptId}`)]};
  }
  const refs = listConceptReferences(source, conceptId);
  if (refs.length) {
    return {ok: false, errors: [metricError('CONCEPT_IN_USE', 'concept.id', 'metric.error.conceptInUse',
      `concept is referenced by ${refs.length} definition(s); delete or detach them first`,
      {refs: refs.map(ref => ref.definitionCode).join(', ')})]};
  }
  return {
    ok: true,
    source: writeMetricPlatform(source,
      {...data, concepts: data.concepts.filter(item => item.id !== conceptId)}),
  };
};

// ---- 版本反向依赖：谁引用了这个版本（原子基 / 复合操作数 / 部门基线） ----
// 与 getMetricDependencies（上游）方向相反，供版本页影响提示与废弃确认。
const revisionDependentsIn = (data, revisionId) => {
  const target = findRevision(data, revisionId);
  if (target == null) return [];
  const dependents = [];
  (data.revisions || []).forEach((revision) => {
    if (revision.id === revisionId) return;
    const spec = revision.spec || {};
    const roles = [];
    if (spec.kind === 'derived' && spec.atomicRevisionId === revisionId) {
      roles.push('ATOMIC_BASE');
    }
    if (spec.kind === 'compound' && Array.isArray(spec.refs)) {
      spec.refs.forEach((ref) => {
        if (ref != null && ref.revisionId === revisionId) roles.push('OPERAND');
      });
    }
    if (revision.baseline != null && revision.baseline.baseRevisionId === revisionId) {
      roles.push('BASELINE');
    }
    if (!roles.length) return;
    const definition = findDefinition(data, revision.definitionId) || {};
    dependents.push({
      definitionId: revision.definitionId,
      definitionCode: definition.code,
      definitionName: definition.name,
      kind: definition.kind,
      scope: definition.scope || null,
      revisionId: revision.id,
      version: revision.version,
      status: revision.status,
      roles,
    });
  });
  return dependents;
};

export const listRevisionDependents = (source, revisionId) =>
  revisionDependentsIn(readMetricPlatform(source), revisionId);

// ---- 定义反向依赖（MET-07）：汇总该定义全部版本（含已废弃/草案）的下游依赖 ----
// 废弃是定义级操作，确认时须看到所有版本的下游，而不只是当前行版本。
// 同一下游修订引用多个版本时合并为一条：roles 去重并集，targetRevisionIds/targetVersions
// 记录它依赖的本定义版本；本定义内部修订不计入（定义级依赖环已被拒绝）。
export const listDefinitionDependents = (source, definitionId) => {
  const data = readMetricPlatform(source);
  const merged = [];
  const byRevisionId = {};
  definitionRevisions(data, definitionId).forEach((target) => {
    revisionDependentsIn(data, target.id).forEach((dependent) => {
      if (dependent.definitionId === definitionId) return;
      let entry = byRevisionId[dependent.revisionId];
      if (entry == null) {
        entry = {...dependent, roles: [], targetRevisionIds: [], targetVersions: []};
        byRevisionId[dependent.revisionId] = entry;
        merged.push(entry);
      }
      dependent.roles.forEach((role) => {
        if (entry.roles.indexOf(role) < 0) entry.roles.push(role);
      });
      if (entry.targetRevisionIds.indexOf(target.id) < 0) {
        entry.targetRevisionIds.push(target.id);
        entry.targetVersions.push(target.version == null ? null : target.version);
      }
    });
  });
  return merged;
};

// ---- 公共新版本影响清单：基线定义下未锁定到该公共版本的全部部门口径（含草案） ----
// publicRevisionId 通常是该公共定义最新发布版本；受影响 = 锁定在旧公共版本的部门。
export const listPublicRevisionImpacts = (source, publicRevisionId) => {
  const data = readMetricPlatform(source);
  const publicRevision = findRevision(data, publicRevisionId);
  if (publicRevision == null || publicRevision.status !== 'published') {
    return {ok: false, errors: [metricError('UNPUBLISHED_REFERENCE', 'publicRevisionId',
      'metric.error.unpublishedReference', 'public revision must be published')]};
  }
  const publicDefinition = findDefinition(data, publicRevision.definitionId);
  if (publicDefinition == null || publicDefinition.scope.kind !== 'public') {
    return {ok: false, errors: [metricError('SCOPE_POLICY', 'publicRevisionId',
      'metric.error.scopePolicy', 'impacted baselines require a public definition')]};
  }
  const impacted = [];
  (data.revisions || []).forEach((revision) => {
    if (revision.baseline == null
      || revision.baseline.definitionId !== publicRevision.definitionId) return;
    if (revision.baseline.baseRevisionId === publicRevisionId) return;
    const definition = findDefinition(data, revision.definitionId);
    if (definition == null || definition.scope.kind !== 'department') return;
    const locked = findRevision(data, revision.baseline.baseRevisionId);
    impacted.push({
      definition,
      revision,
      lockedVersion: locked == null ? null : locked.version,
      candidateVersion: publicRevision.version,
      candidateRevisionId: publicRevisionId,
      status: revision.status,
    });
  });
  return {
    ok: true,
    publicDefinition,
    publicRevision,
    impacted,
  };
};

// ---- 部门口径升级状态：锁定基线 vs 基线定义最新发布版本（只读，供部门页升级面板） ----
export const departmentUpgradeStatus = (source, departmentRevisionId) => {
  const data = readMetricPlatform(source);
  const revision = findRevision(data, departmentRevisionId);
  if (revision == null || revision.baseline == null) {
    return {ok: false, errors: [metricError('UNKNOWN_REFERENCE', 'departmentRevisionId',
      'metric.error.unknownReference', 'department revision or its baseline does not exist')]};
  }
  const baselineDefinition = findDefinition(data, revision.baseline.definitionId);
  if (baselineDefinition == null || baselineDefinition.scope.kind !== 'public') {
    return {ok: false, errors: [metricError('SCOPE_POLICY', 'baseline.definitionId',
      'metric.error.scopePolicy', 'department baseline definition must be public')]};
  }
  // 分叉口径没有可继承的基线契约，升级必被拒（FORK_NOT_UPGRADABLE）：不再提示无效升级
  if (revision.fork === true) {
    return {
      ok: true,
      upgradeAvailable: false,
      reason: 'FORK',
      baselineDefinitionId: baselineDefinition.id,
      lockedRevisionId: revision.baseline.baseRevisionId,
      candidate: null,
      compare: null,
    };
  }
  const candidate = latestPublished(data, baselineDefinition.id);
  const upgradeAvailable = candidate != null
    && candidate.id !== revision.baseline.baseRevisionId;
  return {
    ok: true,
    upgradeAvailable,
    baselineDefinitionId: baselineDefinition.id,
    lockedRevisionId: revision.baseline.baseRevisionId,
    candidate: upgradeAvailable
      ? {revisionId: candidate.id, version: candidate.version} : null,
    compare: upgradeAvailable
      ? compareBaselineUpgrade(source, departmentRevisionId, candidate.id) : null,
  };
};

// 概念 id 生成（与 registry.createMetricConcept 同规则，供 UI 预览等场景）——非持久化入口
export const newConceptId = () => newMetricId('mconcept');
