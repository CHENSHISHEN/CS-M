// 指标平台 M1：指标概念、定义、草案与不可变发布版本的生命周期命令（纯函数）。
// 所有写命令返回 {ok:true, source, ...} 或 {ok:false, errors:[{code,path,messageKey,message}]}，
// 不抛领域错误；已发布版本不可变，修订走新草案；并发以 rev/etag 前置校验。
// 注：构建链不识别 ??，使用 == null 三元。

import {metricError, missingFieldError} from './errors';
import {contentHash, hashValue, newMetricId} from './hash';
import {frozenClone} from './freeze';
import {
  draftEtag, ensureNamespace, readMetricPlatform, storeWriteErrors, writeMetricPlatform,
} from './store';
import {
  atomicReAggregable, compoundReAggregable, dependencyCycleError, findDependencyCycle, metricDependencies,
} from './dependencies';
import {astRefKeys, deriveAstUnit, parseExpression} from './ast';
import {METRIC_KINDS, validateScope, validateSpecStructure} from './validate';
import {isWindowCompatible} from './window';
// MET-04：发布前字典一致性（dictionary.js 不依赖 registry，无循环引用）
import {validateSpecAgainstDictionary} from './dictionary';
// M3B：继承口径完整性检查使用部门白名单 patch 应用器（patch.js 无仓储依赖，无循环引用）
import {applyDepartmentPatch} from './patch';

const DRAFT = 'draft';
const PUBLISHED = 'published';
const DEPRECATED = 'deprecated';
const OPERAND_KINDS = ['derived', 'compound'];

const error = (code, path, messageKey, message, params) =>
  metricError(code, path, messageKey, message, params);

// 深拷贝小对象（spec/baseline/patch/返回副本）：写入、修订、发布之间隔离可变输入（R1），
// 调用方持有的旧对象（表单/patch/草案返回值）不得改变已落盘内容
const cloneJson = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

// ---- 内部查找 ----
const findDefinition = (data, id) =>
  (data.definitions || []).filter(item => item.id === id)[0] || null;
const findRevision = (data, id) =>
  (data.revisions || []).filter(item => item.id === id)[0] || null;
const definitionRevisions = (data, definitionId) =>
  (data.revisions || []).filter(item => item.definitionId === definitionId);
const activeDraft = (data, definitionId) =>
  definitionRevisions(data, definitionId).filter(item => item.status === DRAFT)[0] || null;
const versionOrder = (version) => {
  const parts = String(version == null ? '0.0' : version).split('.');
  return Number(parts[0]) * 100000 + Number(parts[1] || 0);
};
const latestPublished = (data, definitionId) =>
  definitionRevisions(data, definitionId)
    .filter(item => item.status === PUBLISHED)
    .sort((a, b) => (versionOrder(a.version) < versionOrder(b.version) ? 1 : -1))[0] || null;

// 下一个版本号：取该定义下所有修订（含已废弃）中 1.<n> 的最大 n + 1；
// 非 1.<n> 形式/空版本忽略；无任何已编号修订时从 1.0 起（不按已发布数量计，避免废弃后回收旧号）
const nextVersion = (data, definitionId) => {
  let max = -1;
  definitionRevisions(data, definitionId).forEach((item) => {
    const match = /^1\.(\d+)$/.exec(String(item.version == null ? '' : item.version));
    if (match != null && Number(match[1]) > max) max = Number(match[1]);
  });
  return `1.${max + 1}`;
};

// 定义已整体废弃：没有任何已发布修订，且存在已废弃修订（单个旧版本被废弃不算）。
// 废弃是派生状态（不存标记）：基于已废弃版本的修订发布后出现已发布修订，定义级废弃自动解除（决策 D2）
const definitionDeprecatedIn = (data, definitionId) => {
  const revisions = definitionRevisions(data, definitionId);
  return revisions.some(item => item.status === DEPRECATED)
    && !revisions.some(item => item.status === PUBLISHED);
};

export const isDefinitionDeprecated = (source, definitionId) =>
  definitionDeprecatedIn(readMetricPlatform(source), definitionId);

// 校验/发布共用：已废弃定义的遗留草案返回 DEFINITION_DEPRECATED，否则空数组。
// 定义已废弃后基于已废弃版本新建的修订草案（revivesDeprecated）不是遗留草案，放行（决策 D2）
const deprecatedDefinitionErrors = (data, revision) => {
  if (revision.revivesDeprecated === true) return [];
  if (!definitionDeprecatedIn(data, revision.definitionId)) return [];
  return [error('DEFINITION_DEPRECATED', 'definitionId',
    'metric.error.definitionDeprecated',
    `definition ${revision.definitionId} is deprecated, cannot publish`, {id: revision.definitionId})];
};

// 写前守卫统一走 store.storeWriteErrors（STORE_CORRUPT / SCHEMA_VERSION_UNSUPPORTED）
const storeGuard = data => storeWriteErrors(data);

// 并发前置校验：rev 与 etag 任一不匹配即冲突，不发生后写覆盖
const preconditionErrors = (revision, options) => {
  const opts = options == null ? {} : options;
  if (opts.expectedRevision != null && opts.expectedRevision !== revision.rev) {
    return [error('REVISION_CONFLICT', 'rev', 'metric.error.revisionConflict',
      `draft revision is ${revision.rev}, expected ${opts.expectedRevision}`,
      {actual: revision.rev, expected: opts.expectedRevision})];
  }
  if (opts.expectedEtag != null && opts.expectedEtag !== revision.etag) {
    return [error('REVISION_CONFLICT', 'etag', 'metric.error.revisionConflict',
      'draft etag mismatch', {actual: revision.etag, expected: opts.expectedEtag})];
  }
  return [];
};

const modelFieldIds = (entity) =>
  entity == null ? [] : (entity.fields || []).map(field => (field == null ? '' : field.id));

const lookupModel = (source, modelId) => {
  if (source == null) return null;
  const pools = [source.entities, source.logicEntities, source.conceptEntities];
  for (let i = 0; i < pools.length; i += 1) {
    const hit = (pools[i] || []).filter(item => item != null && item.id === modelId)[0];
    if (hit != null) return hit;
  }
  return null;
};

// 模型分层解析（M4A 就绪修正）：concept/logic 对象存在只表示语义设计，
// 不构成物理计算实现；只有物理实体（entities）可作为计算就绪的来源依据
const lookupModelLayer = (source, modelId) => {
  if (source == null) return null;
  if ((source.entities || []).some(item => item != null && item.id === modelId)) return 'physical';
  if ((source.logicEntities || []).some(item => item != null && item.id === modelId)) return 'logic';
  if ((source.conceptEntities || []).some(item => item != null && item.id === modelId)) return 'concept';
  return null;
};

// ---- 读取查询 ----
export const listMetricDefinitions = (source, filter) => {
  const data = readMetricPlatform(source);
  return (data.definitions || [])
    .filter((definition) => {
      if (filter == null) return true;
      if (filter.kind != null && definition.kind !== filter.kind) return false;
      if (filter.scope != null) {
        const wanted = typeof filter.scope === 'string' ? filter.scope : filter.scope.kind;
        if (definition.scope.kind !== wanted) return false;
        if (filter.scope.departmentId != null
          && definition.scope.departmentId !== filter.scope.departmentId) return false;
      }
      if (filter.status != null) {
        const revisions = definitionRevisions(data, definition.id);
        const latest = revisions.filter(item => item.status === filter.status)[0];
        if (latest == null) return false;
      }
      if (filter.search != null && filter.search !== '') {
        const needle = String(filter.search).toLowerCase();
        const hitCode = String(definition.code).toLowerCase().indexOf(needle) >= 0;
        const hitName = String(definition.name).toLowerCase().indexOf(needle) >= 0;
        if (!hitCode && !hitName) return false;
      }
      return true;
    })
    // 返回深拷贝（MET-22）：调用方修改返回值不得改写存储内定义/修订
    .map(definition => cloneJson({
      definition,
      publishedCount: definitionRevisions(data, definition.id)
        .filter(item => item.status === PUBLISHED).length,
      draft: activeDraft(data, definition.id),
      latestPublished: latestPublished(data, definition.id),
    }));
};

export const getMetricDefinition = (source, definitionId) => {
  const data = readMetricPlatform(source);
  const definition = findDefinition(data, definitionId);
  if (definition == null) return null;
  return cloneJson({
    definition,
    revisions: definitionRevisions(data, definitionId),
    latestPublished: latestPublished(data, definitionId),
    draft: activeDraft(data, definitionId),
  });
};

// 深冻结拷贝返回（MET-22 / MET-03 余项）：返回对象不可改（严格模式赋值抛 TypeError），
// 也与存储隔离；已发布快照与 hash 不会被读取方悄悄改写。需要可编辑副本时调用方自行深拷贝
export const getMetricRevision = (source, revisionId) =>
  frozenClone(findRevision(readMetricPlatform(source), revisionId));

// 修订列表（存储顺序），可选 filter {definitionId, status}；返回深冻结拷贝（数组本身也冻结）
export const listMetricRevisions = (source, filter) => {
  const f = filter == null ? {} : filter;
  return frozenClone((readMetricPlatform(source).revisions || []).filter((item) => {
    if (f.definitionId != null && item.definitionId !== f.definitionId) return false;
    if (f.status != null && item.status !== f.status) return false;
    return true;
  }));
};

export const getMetricDependencies = (source, revisionId) =>
  metricDependencies(readMetricPlatform(source), revisionId);

// ---- 引用/语义/依赖 校验管线（发布前完整执行；结构校验复用 validate 层） ----

const checkReferenceStatus = (data, targetRevisionId, path, errors) => {
  const target = findRevision(data, targetRevisionId);
  if (target == null) {
    errors.push(error('UNKNOWN_REFERENCE', path, 'metric.error.unknownReference',
      `referenced revision does not exist: ${targetRevisionId}`, {ref: targetRevisionId}));
    return null;
  }
  if (target.status === DEPRECATED) {
    errors.push(error('DEPRECATED_REFERENCE', path, 'metric.error.deprecatedReference',
      `referenced revision is deprecated: ${targetRevisionId}`, {ref: targetRevisionId}));
    return null;
  }
  if (target.status !== PUBLISHED) {
    errors.push(error('UNPUBLISHED_REFERENCE', path, 'metric.error.unpublishedReference',
      `referenced revision is not published: ${targetRevisionId}`, {ref: targetRevisionId}));
    return null;
  }
  return target;
};

const checkScopePolicy = (definition, targetRevision, data, path, errors) => {
  const targetDefinition = findDefinition(data, targetRevision.definitionId);
  if (definition.scope.kind === 'public' && targetDefinition != null
    && targetDefinition.scope.kind === 'department') {
    errors.push(error('SCOPE_POLICY', path, 'metric.error.scopePolicy',
      'public metric cannot depend on department-scoped definition', {ref: targetRevision.id}));
  }
};

// 语义检查输入：operand 快照 {revision, spec, resolved}
const operandSnapshot = (data, revisionId, path, definition, errors) => {
  const target = checkReferenceStatus(data, revisionId, path, errors);
  if (target == null) return null;
  checkScopePolicy(definition, target, data, path, errors);
  const targetDefinition = findDefinition(data, target.definitionId);
  const targetSpec = target.spec;
  if (targetSpec == null || OPERAND_KINDS.indexOf(targetSpec.kind) < 0) {
    if (targetSpec != null && targetSpec.kind === 'atomic') {
      errors.push(error('INVALID_REFERENCE_KIND', path, 'metric.error.referenceKind',
        'compound can only reference derived/compound revisions (atomics need a derived window first)',
        {ref: revisionId}));
    }
    return null;
  }
  return {revision: target, definition: targetDefinition, spec: targetSpec, resolved: target.resolvedSpec};
};

const resolvedWindowOf = (resolved) =>
  resolved == null ? null : (resolved.window === undefined ? null : resolved.window);
const resolvedGrainOf = (resolved) => (resolved == null ? null : resolved.grain);
const resolvedQualifiersOf = (resolved) => (resolved == null ? [] : resolved.qualifiers) || [];
const resolvedBaseQualifiersOf = (resolved) => (resolved == null ? [] : resolved.baseQualifiers) || [];
// 有效统计限定 = 原子基础限定 + 派生/部门自有限定（R1）：不同基础过滤不得伪作同口径
const effectiveQualifiersOf = (resolved) =>
  resolvedBaseQualifiersOf(resolved).concat(resolvedQualifiersOf(resolved));
const resolvedTimeRoleOf = (resolved) => (resolved == null || resolved.timeRole == null ? null : resolved.timeRole);
const resolvedTimezoneOf = (resolved) => (resolved == null || resolved.timezone == null ? null : resolved.timezone);

const validateDerivedSemantics = (data, definition, spec, errors) => {
  const target = checkReferenceStatus(data, spec.atomicRevisionId, 'spec.atomicRevisionId', errors);
  if (target == null) return null;
  checkScopePolicy(definition, target, data, 'spec.atomicRevisionId', errors);
  const targetDefinition = findDefinition(data, target.definitionId);
  if (target.spec == null || target.spec.kind !== 'atomic') {
    errors.push(error('INVALID_REFERENCE_KIND', 'spec.atomicRevisionId', 'metric.error.referenceKind',
      'derived metric must reference an atomic revision', {ref: spec.atomicRevisionId}));
    return null;
  }
  const atomic = target.spec;
  const atomicDims = (atomic.dimensions || []).map(dimension => dimension.dimensionId);
  (spec.qualifiers || []).forEach((qualifier, index) => {
    if (qualifier.dimensionId != null && atomicDims.indexOf(qualifier.dimensionId) < 0) {
      errors.push(error('UNKNOWN_DIMENSION', `spec.qualifiers[${index}].dimensionId`,
        'metric.error.unknownDimension',
        `qualifier dimension not declared by atomic: ${qualifier.dimensionId}`,
        {dimension: qualifier.dimensionId}));
    }
  });
  (spec.outputGrain || []).forEach((dim, index) => {
    if (dim != null && atomicDims.indexOf(dim) < 0) {
      errors.push(error('UNKNOWN_DIMENSION', `spec.outputGrain[${index}]`, 'metric.error.unknownDimension',
        `output grain dimension not declared by atomic: ${dim}`, {dimension: dim}));
    }
  });
  const atomicResolved = target.resolvedSpec == null ? null : target.resolvedSpec;
  return {
    atomicRevision: target,
    atomicDefinition: targetDefinition,
    unit: atomicResolved != null ? atomicResolved.unit : atomic.unit,
    reAggregable: atomicReAggregable(atomic),
    computeReady: atomicResolved != null ? atomicResolved.computeReady === true : false,
    window: spec.window,
    qualifiers: spec.qualifiers == null ? [] : spec.qualifiers,
    // 完整来源语义（R1）：原子基础限定与时间轴随派生传播，兼容检查用有效语义而非最外层
    baseQualifiers: atomic.baseQualifiers == null ? [] : atomic.baseQualifiers,
    timeRole: atomic.timeRole == null ? null : atomic.timeRole,
    timezone: atomic.timezone == null ? null : atomic.timezone,
    grain: spec.outputGrain == null ? [] : spec.outputGrain,
  };
};

const validateCompoundSemantics = (data, definition, spec, errors) => {
  let ast;
  try {
    ast = parseExpression(spec.expression, 'spec.expression');
  } catch (parseError) {
    // 非结构化异常（无 code）统一包装为 INVALID_VALUE，errors[] 只含结构化错误
    errors.push(parseError != null && typeof parseError.code === 'string'
      ? parseError
      : error('INVALID_VALUE', 'spec.expression', 'metric.error.invalidExpression',
        `expression could not be parsed: ${parseError != null && parseError.message ? parseError.message : String(parseError)}`));
    return null;
  }
  const declaredKeys = (spec.refs || []).map(ref => ref.key);
  const usedKeys = astRefKeys(ast);
  usedKeys.forEach((key) => {
    if (declaredKeys.indexOf(key) < 0) {
      errors.push(error('UNKNOWN_REFERENCE', 'spec.expression', 'metric.error.unknownReference',
        `expression uses undeclared ref key: ${key}`, {ref: key}));
    }
  });
  (spec.refs || []).forEach((ref, index) => {
    if (usedKeys.indexOf(ref.key) < 0) {
      errors.push(error('INVALID_VALUE', `spec.refs[${index}].key`, 'metric.error.invalidValue',
        `declared ref key not used in expression: ${ref.key}`, {ref: ref.key}));
    }
  });
  const snapshots = {};
  (spec.refs || []).forEach((ref, index) => {
    const snapshot = operandSnapshot(data, ref.revisionId, `spec.refs[${index}].revisionId`, definition, errors);
    if (snapshot != null) snapshots[ref.key] = snapshot;
  });
  if (errors.length) return null;
  // 窗口/粒度/有效限定/时间轴 兼容：全部 operand 必须一致（不隐式扩展窗口、不混算口径）；
  // 限定比较用 基础限定+自有限定 的有效语义，不把不同过滤伪作同口径（R1）
  const keys = usedKeys;
  const first = snapshots[keys[0]];
  for (let i = 1; i < keys.length; i += 1) {
    const current = snapshots[keys[i]];
    if (!isWindowCompatible(resolvedWindowOf(first.resolved), resolvedWindowOf(current.resolved))) {
      errors.push(error('WINDOW_CONFLICT', `spec.refs[${i}]`, 'metric.error.windowConflict',
        `operand window incompatible with ${keys[0]}`, {left: keys[0], right: keys[i]}));
    }
    if (hashValue(resolvedGrainOf(first.resolved)) !== hashValue(resolvedGrainOf(current.resolved))) {
      errors.push(error('GRAIN_CONFLICT', `spec.refs[${i}]`, 'metric.error.grainConflict',
        `operand grain incompatible with ${keys[0]}`, {left: keys[0], right: keys[i]}));
    }
    if (hashValue(effectiveQualifiersOf(first.resolved))
      !== hashValue(effectiveQualifiersOf(current.resolved))) {
      errors.push(error('QUALIFIER_CONFLICT', `spec.refs[${i}]`, 'metric.error.qualifierConflict',
        `operand effective qualifiers (atomic base + own) incompatible with ${keys[0]}`,
        {left: keys[0], right: keys[i]}));
    }
    if (resolvedTimeRoleOf(first.resolved) !== resolvedTimeRoleOf(current.resolved)) {
      errors.push(error('TIME_ROLE_CONFLICT', `spec.refs[${i}]`, 'metric.error.timeRoleConflict',
        `operand base time role incompatible with ${keys[0]}`, {left: keys[0], right: keys[i]}));
    }
    if (resolvedTimezoneOf(first.resolved) !== resolvedTimezoneOf(current.resolved)) {
      errors.push(error('TIMEZONE_CONFLICT', `spec.refs[${i}]`, 'metric.error.timezoneConflict',
        `operand base timezone incompatible with ${keys[0]}`, {left: keys[0], right: keys[i]}));
    }
  }
  // 单位推导
  let unit = null;
  try {
    const derived = deriveAstUnit(ast,
      key => (snapshots[key] == null || snapshots[key].resolved == null
        ? null : snapshots[key].resolved.unit),
      'spec.expression');
    unit = derived.unit;
  } catch (unitError) {
    errors.push(unitError);
  }
  // 可再聚合与计算就绪
  const reAggregate = compoundReAggregable(spec,
    key => (snapshots[key] == null ? true : snapshots[key].resolved.reAggregable === true));
  const computeReady = keys.every(key => snapshots[key].resolved.computeReady === true);
  return {
    ast,
    unit,
    reAggregable: reAggregate.reAggregable,
    reAggregableReason: reAggregate.reason,
    computeReady,
    window: resolvedWindowOf(first.resolved),
    grain: resolvedGrainOf(first.resolved),
    // 复合继承首个 operand 的有效语义（限定分层保留可解释来源，R1）
    qualifiers: resolvedQualifiersOf(first.resolved),
    baseQualifiers: resolvedBaseQualifiersOf(first.resolved),
    timeRole: resolvedTimeRoleOf(first.resolved),
    timezone: resolvedTimezoneOf(first.resolved),
  };
};

// 发布前完整校验：结构 → 引用/权限 → 语义 → 粒度 → 依赖 → 就绪
const validateRevisionForPublish = (source, data, revision) => {
  const errors = [];
  const definition = findDefinition(data, revision.definitionId);
  if (definition == null) {
    errors.push(error('UNKNOWN_REFERENCE', 'definitionId', 'metric.error.unknownReference',
      `revision has no definition: ${revision.definitionId}`));
    return {errors};
  }
  const spec = revision.spec;
  validateSpecStructure(spec, 'spec').forEach(item => errors.push(item));
  // MET-04：spec 与语义字典一致性（单位/维度/部门存在且未停用、限定值类型符合维度声明）
  validateSpecAgainstDictionary(data, spec, definition.scope).forEach(item => errors.push(item));
  if (revision.baseline != null && revision.baseline.baseRevisionId != null) {
    const base = checkReferenceStatus(data, revision.baseline.baseRevisionId,
      'baseline.baseRevisionId', errors);
    if (base != null && base.spec != null && base.spec.kind !== spec.kind) {
      errors.push(error('INVALID_REFERENCE_KIND', 'baseline.baseRevisionId', 'metric.error.referenceKind',
        'department snapshot kind must match baseline kind'));
    }
  }
  if (errors.length) return {errors};
  let semantic = null;
  if (spec.kind === 'atomic') {
    // 模型引用有效性（存在性；概念/逻辑引用是语义设计，不是物理计算实现——M4A）
    let sourceLayer = null;
    if (spec.source != null && spec.source.modelId != null) {
      const model = lookupModel(source, spec.source.modelId);
      if (model == null) {
        errors.push(error('UNKNOWN_REFERENCE', 'spec.source.modelId', 'metric.error.unknownReference',
          `source model does not exist: ${spec.source.modelId}`, {ref: spec.source.modelId}));
      } else {
        sourceLayer = lookupModelLayer(source, spec.source.modelId);
        if (spec.source.fieldId != null
          && modelFieldIds(model).indexOf(spec.source.fieldId) < 0) {
          errors.push(error('UNKNOWN_REFERENCE', 'spec.source.fieldId', 'metric.error.unknownReference',
            `source field does not exist on model: ${spec.source.fieldId}`, {ref: spec.source.fieldId}));
        }
      }
    }
    const hasSource = spec.source != null && spec.source.modelId != null;
    semantic = {
      unit: spec.unit,
      reAggregable: atomicReAggregable(spec),
      // 计算就绪（元数据级）仅认物理实体来源；概念/逻辑对象 = 语义设计（designOnly），
      // 设计元数据就绪不代表实际 SQL 执行（SPEC 1/8）
      computeReady: hasSource && sourceLayer === 'physical',
      designOnly: !hasSource || sourceLayer !== 'physical',
      ...(sourceLayer != null ? {sourceLayer} : {}),
      window: null,
      qualifiers: spec.baseQualifiers == null ? [] : spec.baseQualifiers,
      baseQualifiers: spec.baseQualifiers == null ? [] : spec.baseQualifiers,
      timeRole: spec.timeRole == null ? null : spec.timeRole,
      timezone: spec.timezone == null ? null : spec.timezone,
      grain: (spec.dimensions || []).map(dimension => dimension.dimensionId),
    };
  } else if (spec.kind === 'derived') {
    semantic = validateDerivedSemantics(data, definition, spec, errors);
  } else {
    semantic = validateCompoundSemantics(data, definition, spec, errors);
  }
  if (errors.length) return {errors};
  // 依赖环（定义级：候选 spec + 全部既有 revision 参与遍历）
  const cycle = findDependencyCycle(data, revision.id, spec, definition.id);
  if (cycle != null) errors.push(dependencyCycleError(cycle.cycleRevisionIds));
  return {errors, semantic};
};

// ---- 概念（指标族组织入口，不承担计算） ----
export const createMetricConcept = (source, concept) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const errors = [];
  if (concept == null || concept.name == null || concept.name === '') {
    errors.push(missingFieldError('concept', 'name'));
  }
  if (concept != null && concept.domain == null) errors.push(missingFieldError('concept', 'domain'));
  if (errors.length) return {ok: false, errors};
  const id = concept.id || newMetricId('mconcept');
  if ((data.concepts || []).some(item => item.id === id)) {
    return {ok: false, errors: [error('DUPLICATE_ID', 'concept.id', 'metric.error.duplicateId',
      `concept id already exists: ${id}`)]};
  }
  const next = {
    ...data,
    concepts: data.concepts.concat([{
      id,
      domain: concept.domain,
      name: concept.name,
      ...(concept.meaning == null ? {} : {meaning: concept.meaning}),
      ...(concept.owner == null ? {} : {owner: concept.owner}),
      ...(concept.tags == null ? {} : {tags: concept.tags}),
    }]),
  };
  return {
    ok: true,
    source: writeMetricPlatform(source, next, concept.namespace),
    concept: next.concepts[next.concepts.length - 1],
  };
};

// ---- 新建定义 + 首个草案 ----
export const createMetricDraft = (source, input) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const errors = [];
  if (input == null || input.code == null || input.code === '') errors.push(missingFieldError('code', 'code'));
  if (input != null && input.name == null) errors.push(missingFieldError('name', 'name'));
  if (input != null && input.ownerId == null) errors.push(missingFieldError('ownerId', 'ownerId'));
  if (errors.length) return {ok: false, errors};
  if (input == null || input.spec == null || METRIC_KINDS.indexOf(input.spec.kind) < 0) {
    errors.push(error('INVALID_VALUE', 'spec.kind', 'metric.error.invalidValue',
      `spec.kind must be one of ${METRIC_KINDS.join('/')}`));
    return {ok: false, errors};
  }
  validateScope(input.scope, 'scope').forEach(item => errors.push(item));
  if ((data.definitions || []).some(item => item.code === input.code)) {
    errors.push(error('DUPLICATE_CODE', 'code', 'metric.error.duplicateCode',
      `metric code already exists in namespace: ${input.code}`, {code: input.code}));
  }
  if (errors.length) return {ok: false, errors};
  const definitionId = input.id || newMetricId('metric');
  const revisionId = input.revisionId || newMetricId('mrev');
  // 显式 ID 唯一（R1）：定义/修订 ID 碰撞直接拒绝，不容许覆盖或歧义引用
  if (findDefinition(data, definitionId) != null) {
    errors.push(error('DUPLICATE_ID', 'id', 'metric.error.duplicateId',
      `metric definition id already exists: ${definitionId}`, {id: definitionId}));
  }
  if (findRevision(data, revisionId) != null) {
    errors.push(error('DUPLICATE_ID', 'revisionId', 'metric.error.duplicateId',
      `metric revision id already exists: ${revisionId}`, {id: revisionId}));
  }
  if (errors.length) return {ok: false, errors};
  // 命名空间先于定义确定（R1）：首个定义即与注册表命名空间一致，所有身份引用统一
  const namespace = ensureNamespace(data, input.namespace);
  const now = input.createdAt || null;
  const definition = {
    id: definitionId,
    namespace,
    code: input.code,
    name: input.name,
    kind: input.spec.kind,
    scope: cloneJson(input.scope),
    ownerId: input.ownerId,
    ...(input.conceptId == null ? {} : {conceptId: input.conceptId}),
    createdAt: now,
  };
  const revision = {
    id: revisionId,
    definitionId,
    version: null,
    status: DRAFT,
    rev: 1,
    spec: cloneJson(input.spec),
    ...(input.baseline == null ? {} : {baseline: cloneJson(input.baseline)}),
    ...(input.patch == null ? {} : {patch: cloneJson(input.patch)}),
    // M3B：部门显式分叉原因（可选，纯记录，不参与语义计算）
    ...(input.forkNote == null || input.forkNote === '' ? {} : {forkNote: String(input.forkNote)}),
    // M3B：显式分叉标记——分叉草案可自由编辑核心语义（baseline 保留公共来源供比较），
    // 未分叉的继承草案必须保持 基线+白名单patch（updateMetricDraft 强制）
    ...(input.fork === true ? {fork: true} : {}),
    hash: null,
    etag: null,
    createdBy: input.ownerId,
    createdAt: now,
  };
  revision.etag = draftEtag(revision);
  const next = {
    ...data,
    namespace,
    definitions: data.definitions.concat([definition]),
    revisions: data.revisions.concat([revision]),
  };
  return {
    ok: true,
    source: writeMetricPlatform(source, next),
    definition: cloneJson(definition),
    revision: cloneJson(revision),
  };
};

// ---- 既有定义修订：从已发布版本复制出新草案（原版本不动） ----
export const createRevisionDraft = (source, definitionId, options) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const definition = findDefinition(data, definitionId);
  if (definition == null) {
    return {ok: false, errors: [error('UNKNOWN_REFERENCE', 'definitionId', 'metric.error.unknownReference',
      `definition does not exist: ${definitionId}`)]};
  }
  if (activeDraft(data, definitionId) != null) {
    return {ok: false, errors: [error('ACTIVE_DRAFT_EXISTS', 'definitionId', 'metric.error.activeDraft',
      'definition already has an active draft')]};
  }
  const opts = options == null ? {} : options;
  // 显式 revisionId 唯一（R1）
  if (opts.revisionId != null && findRevision(data, opts.revisionId) != null) {
    return {ok: false, errors: [error('DUPLICATE_ID', 'revisionId', 'metric.error.duplicateId',
      `metric revision id already exists: ${opts.revisionId}`, {id: opts.revisionId})]};
  }
  const base = opts.baseRevisionId == null
    ? latestPublished(data, definitionId) : findRevision(data, opts.baseRevisionId);
  // 决策 D2：显式 baseRevisionId 可指向本定义的已废弃版本（废弃后的恢复路径，无 reactivate API）；
  // 默认基准仍为最新已发布版本
  const baseUsable = base != null && (base.status === PUBLISHED
    || (opts.baseRevisionId != null && base.status === DEPRECATED && base.definitionId === definitionId));
  if (!baseUsable) {
    return {ok: false, errors: [error('UNPUBLISHED_REFERENCE', 'baseRevisionId',
      'metric.error.unpublishedReference', 'base revision must be a published (or deprecated) revision of this definition')]};
  }
  // 定义已整体废弃时新建的修订：发布即解除定义级废弃，不受遗留草案的 DEFINITION_DEPRECATED 拦截
  const revives = base.definitionId === definitionId && definitionDeprecatedIn(data, definitionId);
  const revision = {
    id: opts.revisionId || newMetricId('mrev'),
    definitionId,
    version: null,
    status: DRAFT,
    rev: 1,
    spec: JSON.parse(JSON.stringify(base.spec)),
    hash: null,
    etag: null,
    createdBy: opts.createdBy == null ? definition.ownerId : opts.createdBy,
    createdAt: opts.createdAt || null,
    baseRevisionId: base.id,
    // baseline/patch 与已发布版本隔离副本（R1）：旧发布对象不被新草案引用悄悄改变
    ...(base.baseline == null ? {} : {baseline: cloneJson(base.baseline)}),
    ...(base.patch == null ? {} : {patch: cloneJson(base.patch)}),
    // 显式分叉的定义继续修订时保留分叉标记与原因（MET-02），否则核心语义编辑会被拒绝
    ...(base.fork === true ? {fork: true} : {}),
    ...(base.forkNote == null || base.forkNote === '' ? {} : {forkNote: base.forkNote}),
    ...(revives ? {revivesDeprecated: true} : {}),
  };
  revision.etag = draftEtag(revision);
  const next = {...data, revisions: data.revisions.concat([revision])};
  return {ok: true, source: writeMetricPlatform(source, next), revision: cloneJson(revision)};
};

// ---- 编辑草案（仅 draft 可编辑；已发布不可变） ----
export const updateMetricDraft = (source, revisionId, patch, options) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const revision = findRevision(data, revisionId);
  if (revision == null) {
    return {ok: false, errors: [error('UNKNOWN_REFERENCE', 'revisionId', 'metric.error.unknownReference',
      `revision does not exist: ${revisionId}`)]};
  }
  if (revision.status !== DRAFT) {
    return {ok: false, errors: [error('IMMUTABLE_PUBLISHED', 'revisionId', 'metric.error.immutable',
      `revision ${revisionId} is ${revision.status} and immutable; create a new draft`)]};
  }
  const conflict = preconditionErrors(revision, options);
  if (conflict.length) return {ok: false, errors: conflict};
  const next = patch == null ? {} : patch;
  if (next.spec !== undefined && next.spec.kind !== revision.spec.kind) {
    // 三类型切换只允许发生在尚无任何发布版本的新草案上（SPEC 9.2）
    const hasPublished = definitionRevisions(data, revision.definitionId)
      .some(item => item.status === PUBLISHED);
    if (hasPublished) {
      return {ok: false, errors: [error('INVALID_VALUE', 'spec.kind', 'metric.error.invalidValue',
        'published-type change requires a new definition (kind switch not allowed)')]};
    }
  }
  // M3B 继承口径完整性：带基线且未显式分叉的部门草案，spec 必须保持 基线+白名单patch
  // （仅名称/说明自由）；直接改核心语义/限定等于绕过分叉伪装继承，拒绝并引导显式分叉，
  // 公共来源（baseline）与差异比较记录不丢失。
  if (next.spec !== undefined && revision.baseline != null && revision.fork !== true) {
    const base = findRevision(data, revision.baseline.baseRevisionId);
    if (base != null) {
      const inherited = applyDepartmentPatch(base.spec,
        revision.patch == null ? {} : revision.patch);
      const keys = {};
      Object.keys(inherited == null ? {} : inherited).forEach(key => { keys[key] = true; });
      Object.keys(next.spec).forEach(key => { keys[key] = true; });
      const diverged = Object.keys(keys).filter((key) => {
        if (key === 'name' || key === 'description' || key === 'kind') return false;
        return hashValue(inherited == null ? undefined : inherited[key])
          !== hashValue(next.spec[key]);
      });
      if (diverged.length) {
        return {ok: false, errors: [error('SEMANTIC_CHANGE_REQUIRES_FORK', `spec.${diverged[0]}`,
          'metric.error.semanticFork',
          `department draft must stay baseline+patch (whitelist inheritance); diverged keys require an explicit fork: ${diverged.join(', ')}`,
          {paths: diverged.join(', ')})]};
      }
    }
  }
  const kindSwitched = next.spec !== undefined && next.spec.kind !== revision.spec.kind;
  const revisions = data.revisions.map((item) => {
    if (item.id !== revisionId) return item;
    const updated = {
      ...item,
      spec: next.spec === undefined ? item.spec : cloneJson(next.spec),
      rev: item.rev + 1,
    };
    updated.etag = draftEtag(updated);
    return updated;
  });
  let definitions = data.definitions;
  const definition = findDefinition(data, revision.definitionId);
  if (definition != null && (next.name !== undefined || next.ownerId !== undefined
      || next.conceptId !== undefined || kindSwitched)) {
    definitions = data.definitions.map((item) => {
      if (item.id !== definition.id) return item;
      return {
        ...item,
        ...(next.name === undefined ? {} : {name: next.name}),
        ...(next.ownerId === undefined ? {} : {ownerId: next.ownerId}),
        ...(next.conceptId === undefined ? {} : {conceptId: next.conceptId}),
        ...(kindSwitched ? {kind: next.spec.kind} : {}),
      };
    });
  }
  return {
    ok: true,
    source: writeMetricPlatform(source, {...data, revisions, definitions}),
    revision: cloneJson(revisions.filter(item => item.id === revisionId)[0]),
  };
};

// ---- 校验草案（不写入） ----
export const validateMetricDraft = (source, revisionId, options) => {
  const data = readMetricPlatform(source);
  const revision = findRevision(data, revisionId);
  if (revision == null) {
    return {ok: false, errors: [error('UNKNOWN_REFERENCE', 'revisionId', 'metric.error.unknownReference',
      `revision does not exist: ${revisionId}`)]};
  }
  // 与发布一致：已废弃定义的遗留草案校验即失败，不能「校验通过、发布被拒」
  const deprecated = deprecatedDefinitionErrors(data, revision);
  if (deprecated.length) return {ok: false, errors: deprecated};
  const conflict = preconditionErrors(revision, options);
  if (conflict.length) return {ok: false, errors: conflict};
  const result = validateRevisionForPublish(source, data, revision);
  if (result.errors.length) return {ok: false, errors: result.errors};
  return {ok: true, signature: hashValue(result.semantic)};
};

// ---- 发布（不可变快照 + resolvedSpec 固化） ----
export const publishMetricRevision = (source, revisionId, options) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const revision = findRevision(data, revisionId);
  if (revision == null) {
    return {ok: false, errors: [error('UNKNOWN_REFERENCE', 'revisionId', 'metric.error.unknownReference',
      `revision does not exist: ${revisionId}`)]};
  }
  if (revision.status === PUBLISHED || revision.status === DEPRECATED) {
    return {ok: false, errors: [error('IMMUTABLE_PUBLISHED', 'revisionId', 'metric.error.immutable',
      `revision ${revisionId} is already ${revision.status}`)]};
  }
  // 已废弃的定义不可再发布遗留草案（防绕过废弃）
  const deprecated = deprecatedDefinitionErrors(data, revision);
  if (deprecated.length) return {ok: false, errors: deprecated};
  const conflict = preconditionErrors(revision, options);
  if (conflict.length) return {ok: false, errors: conflict};
  const result = validateRevisionForPublish(source, data, revision);
  if (result.errors.length) return {ok: false, errors: result.errors};
  const semantic = result.semantic;
  const version = nextVersion(data, revision.definitionId);
  const specSnapshot = cloneJson(revision.spec); // 发布快照与旧草案/表单/patch 引用隔离（R1）
  const resolvedSpec = {
    kind: revision.spec.kind,
    unit: semantic.unit,
    reAggregable: semantic.reAggregable,
    ...(semantic.reAggregableReason == null ? {} : {reAggregableReason: semantic.reAggregableReason}),
    computeReady: semantic.computeReady,
    ...(semantic.computeReady ? {} : {designOnly: true}),
    window: cloneJson(semantic.window === undefined ? null : semantic.window),
    grain: cloneJson(semantic.grain),
    qualifiers: cloneJson(semantic.qualifiers),
    // 完整来源语义（R1）：基础限定与时间轴固化进快照，兼容检查/血缘可解释
    ...(semantic.baseQualifiers == null ? {} : {baseQualifiers: cloneJson(semantic.baseQualifiers)}),
    ...(semantic.timeRole == null ? {} : {timeRole: semantic.timeRole}),
    ...(semantic.timezone == null ? {} : {timezone: semantic.timezone}),
    // M4A：来源分层固化（physical=物理实现；logic/concept=语义设计，不代表已计算）
    ...(semantic.sourceLayer == null ? {} : {sourceLayer: semantic.sourceLayer}),
    ...(revision.baseline == null ? {} : {baseline: cloneJson(revision.baseline)}),
  };
  const published = {
    ...revision,
    version,
    status: PUBLISHED,
    spec: specSnapshot,
    resolvedSpec,
    hash: contentHash({spec: specSnapshot, resolvedSpec}),
    publishedAt: (options == null ? null : options.publishedAt) || null,
  };
  const revisions = data.revisions.map(item => (item.id === revisionId ? published : item));
  return {
    ok: true,
    source: writeMetricPlatform(source, {...data, revisions}),
    revision: cloneJson(published),
    version,
  };
};

// ---- 废弃：保留历史可读，限制新发布继续引用 ----
export const deprecateMetricDefinition = (source, definitionId) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  if (findDefinition(data, definitionId) == null) {
    return {ok: false, errors: [error('UNKNOWN_REFERENCE', 'definitionId', 'metric.error.unknownReference',
      `definition does not exist: ${definitionId}`)]};
  }
  let touched = 0;
  const revisions = data.revisions.map((item) => {
    if (item.definitionId !== definitionId || item.status !== PUBLISHED) return item;
    touched += 1;
    return {...item, status: DEPRECATED};
  });
  if (!touched) {
    return {ok: false, errors: [error('INVALID_VALUE', 'definitionId', 'metric.error.invalidValue',
      'definition has no published revision to deprecate')]};
  }
  return {ok: true, source: writeMetricPlatform(source, {...data, revisions})};
};

// ---- 丢弃草案（MET-14）：仅删除活动草案；从未发布过的定义连同定义一并删除（释放 code）。
// 已发布/已废弃版本不动；并发以草案 rev/etag 前置校验（同 updateMetricDraft）。
// 指向被删草案/定义的关联记录一并移除，不留悬挂引用（auditMetricStore 的 DANGLING_REFERENCE）。
export const discardMetricDraft = (source, definitionId, options) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  if (findDefinition(data, definitionId) == null) {
    return {ok: false, errors: [error('UNKNOWN_REFERENCE', 'definitionId', 'metric.error.unknownReference',
      `definition does not exist: ${definitionId}`)]};
  }
  const draft = activeDraft(data, definitionId);
  if (draft == null) {
    return {ok: false, errors: [error('INVALID_VALUE', 'definitionId', 'metric.error.invalidValue',
      'definition has no active draft to discard')]};
  }
  const conflict = preconditionErrors(draft, options);
  if (conflict.length) return {ok: false, errors: conflict};
  const everPublished = definitionRevisions(data, definitionId).some(item => item.status !== DRAFT);
  const removedRevisionIds = everPublished
    ? [draft.id]
    : definitionRevisions(data, definitionId).map(item => item.id);
  const removed = id => removedRevisionIds.indexOf(id) >= 0;
  const next = {
    ...data,
    revisions: data.revisions.filter(item => !removed(item.id)),
    ...(everPublished ? {} : {definitions: data.definitions.filter(item => item.id !== definitionId)}),
  };
  if (Array.isArray(data.bindings)) {
    next.bindings = data.bindings.filter(binding => !removed(binding.metricRevisionId)
      && (everPublished || binding.metricDefinitionId !== definitionId));
  }
  return {
    ok: true,
    source: writeMetricPlatform(source, next),
    definitionRemoved: !everPublished,
  };
};
