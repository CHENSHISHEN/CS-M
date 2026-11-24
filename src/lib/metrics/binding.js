// 指标平台 M4A：模型绑定领域（ModelBinding 事实记录，纯函数）。
// 存储：profile.metricPlatform.bindings（schemaVersion 1 增量键；未知键原样保留）。
// 一份事实记录 = 具体指标版本 + 角色 + 模型/字段稳定 ID 端点 + 端点快照（显示名/
// schema 指纹）+ 映射 + 证据 + 状态 + 事件历史；双向只存这一份，反查/影响均由它派生。
// 四种角色（ARCHITECTURE 3.2 / SPEC 7）：
//   COMPUTES_FROM      模型字段 → 指标版本（计算来源，参与计算 DAG）
//   MATERIALIZES_INTO  指标版本 → 模型字段（物化输出，作为数据流向记录）
//   CONSUMED_BY        指标版本 → 消费模型/应用（引用，不自动等于计算依赖）
//   SEMANTIC_MATCH     概念/逻辑对象 ↔ 指标业务概念或定义（语义映射，无数据流向）
// 不从 ER 外键自动建血缘，不按同名猜关系；端点身份 = 集合+对象 ID+字段 ID，
// 同表不同字段是两个独立端点，不因同表合并误判字段环。
// 解除（release）不抹历史：记录保留 released 状态与端点快照，查询默认排除、
// includeRelease可见。纯函数约定同 M1：读不改源；写返回 {ok:true, source, ...} 或
// {ok:false, errors:[{code,path,messageKey,message,params}]}；不使用 ?? / ?.。

import {metricError, missingFieldError} from './errors';
import {hashValue, newMetricId} from './hash';
import {readMetricPlatform, storeWriteErrors, writeMetricPlatform} from './store';
import {AGGREGATIONS} from './validate';

export const BINDING_ROLES = ['COMPUTES_FROM', 'MATERIALIZES_INTO', 'CONSUMED_BY', 'SEMANTIC_MATCH'];
export const BINDING_STATES = ['suggested', 'confirmed', 'unresolved', 'released'];
export const BINDING_COLLECTIONS = ['entities', 'logicEntities', 'conceptEntities'];
// 计算图角色（参与字段端点环检查）；消费引用/语义映射不进计算 DAG
const COMPUTE_ROLES = ['COMPUTES_FROM', 'MATERIALIZES_INTO'];
// 语义映射只允许概念/逻辑层（物理层来源/落地用另两种角色表达）
const SEMANTIC_COLLECTIONS = ['logicEntities', 'conceptEntities'];

const error = (code, path, messageKey, message, params) =>
  metricError(code, path, messageKey, message, params);

// ---- 模型解析（按集合分层：概念/逻辑对象存在只代表语义设计，不是物理实现） ----
export const findModelIn = (source, collection, objectId) => {
  if (source == null || collection == null) return null;
  const pool = source[collection];
  if (pool == null) return null;
  return (pool.filter(item => item != null && item.id === objectId)[0]) || null;
};

export const modelFieldIdsOf = (model) =>
  model == null ? [] : (model.fields || []).map(field => (field == null ? '' : field.id));

// schema 指纹：对“业务形状”（defKey + 字段 defKey/type 排序）取哈希，与对象/字段 ID
// 无关——导入重构换 id 不失效；defKey/类型变化提示检查，显示名（defName）变化不指纹
export const modelSchemaFingerprint = (model) => {
  if (model == null) return null;
  const fields = (model.fields || [])
    .map(field => (field == null ? null : {defKey: field.defKey, type: field.type}))
    .filter(field => field != null)
    .sort((a, b) => String(a.defKey).localeCompare(String(b.defKey)));
  return hashValue({defKey: model.defKey, fields});
};

const fieldOf = (model, fieldId) =>
  model == null ? null : ((model.fields || []).filter(f => f != null && f.id === fieldId)[0] || null);

// 端点在场状态（按稳定 ID 解析当前项目；不按名称回退）
export const bindingEndpoint = (source, binding) => {
  const ref = binding == null ? null : binding.modelRef;
  if (ref == null) return {present: false, object: null, field: null, collection: ref == null ? null : ref.collection};
  const object = findModelIn(source, ref.collection, ref.objectId);
  const field = object != null && ref.fieldId != null ? fieldOf(object, ref.fieldId) : null;
  if (object == null) return {present: false, object: null, field: null, collection: ref.collection};
  if (ref.fieldId != null && field == null) {
    return {present: false, object, field: null, collection: ref.collection};
  }
  return {present: true, object, field: field || null, collection: ref.collection};
};

// 指纹对比：match=一致；changed=模型仍在但业务形状变化（提示检查，不判失效）；
// missing=端点不在（以在场状态为准，不猜同名对象）
export const bindingFingerprintStatus = (source, binding) => {
  const endpoint = bindingEndpoint(source, binding);
  if (!endpoint.present) return 'missing';
  const current = modelSchemaFingerprint(endpoint.object);
  return current === binding.modelRef.schemaFingerprint ? 'match' : 'changed';
};

// ---- 内部查找 ----
// 写前守卫统一走 store.storeWriteErrors（STORE_CORRUPT / SCHEMA_VERSION_UNSUPPORTED）
const storeGuard = data => storeWriteErrors(data);
const findDefinition = (data, id) =>
  (data.definitions || []).filter(item => item.id === id)[0] || null;
const findRevision = (data, id) =>
  (data.revisions || []).filter(item => item.id === id)[0] || null;
const bindingsOf = (data) => (data.bindings == null ? [] : data.bindings);
const isHistorical = (binding) => binding.state === 'released';
// 端点键：同表不同字段 = 不同端点（SPEC 7：以字段端点展示，避免合并表节点假循环）
const endpointKeyOf = (binding) => {
  const ref = binding.modelRef;
  return `${ref.collection}\u0000${ref.objectId}\u0000${ref.fieldId == null ? '' : ref.fieldId}`;
};

const mappingWhitelist = {
  COMPUTES_FROM: ['aggregate', 'expression', 'timeFieldId', 'qualifierFieldIds',
    'dimensionFieldIds', 'factKeyFieldIds'],
  MATERIALIZES_INTO: ['usage', 'expression'],
  CONSUMED_BY: ['usage', 'expression'],
  SEMANTIC_MATCH: ['description', 'semanticKind'],
};
// mapping 中引用字段的角色键（全部进入反向影响索引，不只主度量字段）
const MAPPING_FIELD_KEYS = ['timeFieldId', 'qualifierFieldIds', 'dimensionFieldIds', 'factKeyFieldIds'];
export const mappingFieldIds = (mapping) => {
  if (mapping == null) return [];
  const ids = [];
  MAPPING_FIELD_KEYS.forEach((key) => {
    const value = mapping[key];
    if (typeof value === 'string' && value !== '') ids.push(value);
    if (Array.isArray(value)) value.filter(id => id != null).forEach(id => ids.push(id));
  });
  return ids;
};

// 端点涉及的全部字段 ID（端点字段 + mapping 角色字段）：影响索引的粒度
export const bindingFieldScope = (binding) => {
  const ids = [];
  const ref = binding.modelRef;
  if (ref != null && ref.fieldId != null) ids.push(ref.fieldId);
  mappingFieldIds(binding.mapping).forEach(id => { ids.push(id); });
  return ids;
};

// ---- 字段端点计算环（真实自依赖阻断）----
// 计算图边（M5A 修正：依赖边 + 端点边合并判定，声明来源参与确认环校验）：
//   ① 依赖边 上游→下游（derived.atomicRevisionId / compound.refs 固定版本，spec 事实）；
//   ② 端点边 物化者→取数者：confirmed MATERIALIZES_INTO(R, F) ×
//      （confirmed COMPUTES_FROM(S, F) ∪ 声明来源落在 F 的原子版本 S）→ R→S。
// 同一版本经同一字段端点既落地又取数（绑定或声明）= 真实环；同表不同字段是
// 不同端点，不误判；suggested/unresolved/released 不算有效计算边。
const dependencySuccessors = (data) => {
  const next = {};
  (data.revisions || []).forEach((revision) => {
    const spec = revision == null ? null : revision.spec;
    if (spec == null) return;
    const refs = [];
    if (spec.kind === 'derived' && spec.atomicRevisionId != null) refs.push(spec.atomicRevisionId);
    if (spec.kind === 'compound' && Array.isArray(spec.refs)) {
      spec.refs.forEach((ref) => {
        if (ref != null && ref.revisionId != null) refs.push(ref.revisionId);
      });
    }
    refs.forEach((upstream) => {
      (next[upstream] = next[upstream] || []).push(revision.id);
    });
  });
  return next;
};

// 声明来源取数者（按端点）：原子 spec.source 是定义事实（无独立 binding 也参与
// 环校验）；模型不在场时无端点可匹配，不按同名猜对象
const declaredTakersByEndpoint = (source, data) => {
  const takers = {};
  (data.revisions || []).forEach((revision) => {
    const spec = revision == null ? null : revision.spec;
    if (spec == null || spec.kind !== 'atomic') return;
    const ref = spec.source;
    if (ref == null || ref.modelId == null || ref.modelId === '') return;
    let collection = null;
    for (let i = 0; i < BINDING_COLLECTIONS.length; i += 1) {
      if (findModelIn(source, BINDING_COLLECTIONS[i], ref.modelId) != null) {
        collection = BINDING_COLLECTIONS[i];
        break;
      }
    }
    if (collection == null) return;
    const key = `${collection}\u0000${ref.modelId}\u0000${ref.fieldId == null ? '' : ref.fieldId}`;
    (takers[key] = takers[key] || []).push(revision.id);
  });
  return takers;
};

// 合并计算图 successors（可带候选边：create/confirm 共用，候选按已确认参与检查）
const computeGraphSuccessors = (source, data, candidate) => {
  const takersByEndpoint = {};
  const materializersByEndpoint = {};
  bindingsOf(data).forEach((binding) => {
    if (binding.state !== 'confirmed' || binding.metricRevisionId == null) return;
    if (binding.role === 'COMPUTES_FROM') {
      const key = endpointKeyOf(binding);
      (takersByEndpoint[key] = takersByEndpoint[key] || []).push(binding.metricRevisionId);
    } else if (binding.role === 'MATERIALIZES_INTO') {
      const key = endpointKeyOf(binding);
      (materializersByEndpoint[key] = materializersByEndpoint[key] || []).push(binding.metricRevisionId);
    }
  });
  if (candidate != null) {
    const key = `${candidate.modelRef.collection}\u0000${candidate.modelRef.objectId}\u0000${candidate.modelRef.fieldId == null ? '' : candidate.modelRef.fieldId}`;
    if (candidate.role === 'COMPUTES_FROM') {
      (takersByEndpoint[key] = takersByEndpoint[key] || []).push(candidate.metricRevisionId);
    } else if (candidate.role === 'MATERIALIZES_INTO') {
      (materializersByEndpoint[key] = materializersByEndpoint[key] || []).push(candidate.metricRevisionId);
    }
  }
  const endpointNext = {};
  const endpoints = {};
  Object.keys(materializersByEndpoint).forEach((key) => { endpoints[key] = true; });
  Object.keys(takersByEndpoint).forEach((key) => { endpoints[key] = true; });
  const declaredTakers = declaredTakersByEndpoint(source, data);
  Object.keys(declaredTakers).forEach((key) => { endpoints[key] = true; });
  Object.keys(endpoints).forEach((key) => {
    const materializers = materializersByEndpoint[key] || [];
    if (!materializers.length) return;
    const takers = (takersByEndpoint[key] || []).concat(declaredTakers[key] || []);
    if (!takers.length) return;
    materializers.forEach((m) => {
      takers.forEach((s) => {
        (endpointNext[m] = endpointNext[m] || []).push(s);
      });
    });
  });
  const dependencyNext = dependencySuccessors(data);
  return (revisionId) => (endpointNext[revisionId] || [])
    .concat(dependencyNext[revisionId] || []);
};

// from →...→ to 的路径（至少经过一条边；from===to 须绕行返回，零长度不算环）
const reachablePath = (successors, from, to) => {
  const queue = [];
  const visited = {};
  const first = successors(from) || [];
  for (let i = 0; i < first.length; i += 1) {
    if (first[i] === to) return [from, to];
    if (visited[first[i]]) continue;
    visited[first[i]] = true;
    queue.push([first[i], [from, first[i]]]);
  }
  while (queue.length) {
    const pair = queue.shift();
    const node = pair[0];
    const path = pair[1];
    const next = successors(node);
    for (let i = 0; i < next.length; i += 1) {
      const target = next[i];
      if (target === to) return path.concat([target]);
      if (visited[target]) continue;
      visited[target] = true;
      queue.push([target, path.concat([target])]);
    }
  }
  return null;
};

// 全景环（诊断/测试用）：每个 confirmed 物化版本出发，绕行 ≥1 条边回到自身
export const listBindingCycles = (source) => {
  const data = readMetricPlatform(source);
  const successors = computeGraphSuccessors(source, data);
  const cycles = [];
  const reported = {};
  bindingsOf(data).forEach((binding) => {
    if (binding.state !== 'confirmed' || binding.metricRevisionId == null) return;
    if (binding.role !== 'MATERIALIZES_INTO') return;
    const start = binding.metricRevisionId;
    if (reported[start]) return;
    const path = reachablePath(successors, start, start);
    if (path != null) {
      cycles.push(path);
      path.forEach(id => { reported[id] = true; });
    }
  });
  return cycles;
};

// M5A 血缘/影响共用：合并计算流 successors（依赖边 + confirmed 端点边 + 声明取数边）。
// 只读投影，不写库；suggested/unresolved/released 绑定不进入计算流。
export const metricComputeFlowSuccessors = (source) => {
  const data = readMetricPlatform(source);
  return computeGraphSuccessors(source, data);
};

// ---- 读取查询 ----
const metricInfoOf = (data, binding) => {
  const revision = binding.metricRevisionId == null ? null : findRevision(data, binding.metricRevisionId);
  const definition = revision == null
    ? (binding.metricDefinitionId == null ? null : findDefinition(data, binding.metricDefinitionId))
    : findDefinition(data, revision.definitionId);
  const concept = binding.metricConceptId == null ? null
    : (data.concepts || []).filter(item => item.id === binding.metricConceptId)[0] || null;
  return {
    revision: revision || null,
    definition: definition || null,
    concept: concept || null,
    version: revision == null ? null : revision.version,
    metricStatus: revision == null ? null : revision.status,
  };
};

export const listMetricBindings = (source, filter) => {
  const data = readMetricPlatform(source);
  const f = filter == null ? {} : filter;
  return bindingsOf(data)
    .filter((binding) => {
      if (!f.includeReleased && isHistorical(binding)) return false;
      if (f.bindingId != null && binding.id !== f.bindingId) return false;
      if (f.revisionId != null && binding.metricRevisionId !== f.revisionId) return false;
      if (f.definitionId != null && binding.metricDefinitionId !== f.definitionId) return false;
      if (f.conceptId != null && binding.metricConceptId !== f.conceptId) return false;
      if (f.role != null && binding.role !== f.role) return false;
      if (f.state != null && binding.state !== f.state) return false;
      if (f.collection != null && binding.modelRef.collection !== f.collection) return false;
      if (f.objectId != null && binding.modelRef.objectId !== f.objectId) return false;
      if (f.fieldId != null && bindingFieldScope(binding).indexOf(f.fieldId) < 0) return false;
      return true;
    })
    .map(binding => ({
      binding,
      metric: metricInfoOf(data, binding),
      endpoint: bindingEndpoint(source, binding),
      fingerprintStatus: bindingFingerprintStatus(source, binding),
    }));
};

// 模型侧反查（同指标跨多模型、同表不同字段独立端点都按端点命中）
export const listModelMetricBindings = (source, query) => {
  const f = query == null ? {} : query;
  return listMetricBindings(source, {
    collection: f.collection,
    objectId: f.objectId,
    fieldId: f.fieldId,
    includeReleased: f.includeReleased,
  });
};

const collectUpstreamRevisions = (data, revisionId, seen) => {
  const revision = findRevision(data, revisionId);
  if (revision == null) return;
  const spec = revision.spec || {};
  const refs = [];
  if (spec.kind === 'derived' && spec.atomicRevisionId != null) refs.push(spec.atomicRevisionId);
  if (spec.kind === 'compound' && Array.isArray(spec.refs)) {
    spec.refs.forEach(ref => { if (ref != null && ref.revisionId != null) refs.push(ref.revisionId); });
  }
  refs.forEach((ref) => {
    if (seen[ref]) return;
    seen[ref] = true;
    collectUpstreamRevisions(data, ref, seen);
  });
};

// 指标 → 模型（SPEC 6.4）：直接来源/间接来源（经指标依赖链的固定版本）/物化输出/
// 消费引用/语义映射分组；directCount/transitiveCount 分开计数
export const getMetricModels = (source, revisionId, options) => {
  const data = readMetricPlatform(source);
  const revision = findRevision(data, revisionId);
  if (revision == null) return null;
  const opts = options == null ? {} : options;
  const rolesWanted = opts.roles == null ? BINDING_ROLES : opts.roles;
  const decorate = list => list.map(item => ({
    ...item,
    direct: item.metric.revision == null ? null : item.metric.revision.id === revisionId,
  }));
  const directAll = listMetricBindings(source, {revisionId, includeReleased: opts.includeReleased})
    .filter(item => rolesWanted.indexOf(item.binding.role) >= 0);
  const groups = {
    sources: directAll.filter(item => item.binding.role === 'COMPUTES_FROM'),
    materializations: directAll.filter(item => item.binding.role === 'MATERIALIZES_INTO'),
    consumers: directAll.filter(item => item.binding.role === 'CONSUMED_BY'),
    semantic: directAll.filter(item => item.binding.role === 'SEMANTIC_MATCH'),
    indirectSources: [],
  };
  if (opts.depth !== 0) {
    const seen = {};
    collectUpstreamRevisions(data, revisionId, seen);
    Object.keys(seen).forEach((upstreamId) => {
      listMetricBindings(source, {revisionId: upstreamId, role: 'COMPUTES_FROM'})
        .filter(item => rolesWanted.indexOf('COMPUTES_FROM') >= 0)
        .forEach(item => groups.indirectSources.push({...item, viaRevisionId: upstreamId}));
    });
  }
  groups.sources = decorate(groups.sources);
  groups.materializations = decorate(groups.materializations);
  groups.consumers = decorate(groups.consumers);
  groups.semantic = decorate(groups.semantic);
  groups.indirectSources = decorate(groups.indirectSources);
  groups.counts = {
    directCount: directAll.length,
    transitiveCount: groups.indirectSources.length,
  };
  return groups;
};

// 定义侧语义映射（概念实体↔业务概念或定义、逻辑属性语义度量）
export const listSemanticMetricBindings = (source, query) => {
  const f = query == null ? {} : query;
  return listMetricBindings(source, {
    role: 'SEMANTIC_MATCH',
    collection: f.collection,
    objectId: f.objectId,
    fieldId: f.fieldId,
    includeReleased: f.includeReleased,
  });
};

// ---- M4B 定义声明来源投影（只读，不写库、不伪造确认） ----
// 原子 spec.source 是 M2 指标编辑器记录的事实声明；ModelBinding 仍是唯一确认事实源。
// 本投影供模型↔指标互查：返回目标版本及其指标依赖闭包内全部原子的声明来源端点，
// 每条带 direct（是否目标版本自身）与 endpoint 在场状态（不在场保留声明原值）。
// 与生效绑定同端点（同集合+对象+字段）时由调用方去重（绑定优先），不参与
// direct/transitive 绑定计数——两边口径不同，不合并、不重复计数。
export const getDeclaredSpecSources = (source, revisionId) => {
  const data = readMetricPlatform(source);
  const revision = findRevision(data, revisionId);
  if (revision == null) return [];
  const upstream = {};
  collectUpstreamRevisions(data, revisionId, upstream);
  const ownerIds = [revisionId].concat(Object.keys(upstream));
  const results = [];
  ownerIds.forEach((ownerId) => {
    const owner = findRevision(data, ownerId);
    if (owner == null || owner.spec == null || owner.spec.kind !== 'atomic') return;
    const ref = owner.spec.source;
    if (ref == null || ref.modelId == null || ref.modelId === '') return;
    let collection = null;
    let object = null;
    for (let i = 0; i < BINDING_COLLECTIONS.length; i += 1) {
      const key = BINDING_COLLECTIONS[i];
      const hit = findModelIn(source, key, ref.modelId);
      if (hit != null) { collection = key; object = hit; break; }
    }
    const field = object != null && ref.fieldId != null ? fieldOf(object, ref.fieldId) : null;
    // 字段在场性按稳定字段 ID 实判（M5A 修正）：对象仍在但声明字段已删除 →
    // present:false（保留声明原值与对象信息，不按同名复活、不显示可打开）
    const fieldMissing = object != null && ref.fieldId != null && field == null;
    const definition = findDefinition(data, owner.definitionId);
    results.push({
      ownerId,
      direct: ownerId === revisionId,
      revision: owner,
      definition: definition || null,
      specSource: {modelId: ref.modelId, ...(ref.fieldId == null ? {} : {fieldId: ref.fieldId})},
      endpoint: object == null
        ? {present: false, object: null, field: null, collection: null}
        : {present: !fieldMissing, object, field: field || null, collection},
      designOnly: collection !== 'entities',
    });
  });
  return results;
};

// 声明来源是否已被同端点生效绑定覆盖（去重规则：绑定记录优先）
export const declaredCoveredByBinding = (source, declared, bindings) => {
  const active = (bindings || []).filter(binding => binding != null
    && binding.state !== 'released' && binding.state !== 'unresolved'
    && binding.role === 'COMPUTES_FROM'
    && binding.metricRevisionId === declared.ownerId);
  return active.some((binding) => {
    const ref = binding.modelRef;
    if (declared.endpoint.collection == null) return false;
    if (ref.collection !== declared.endpoint.collection) return false;
    if (ref.objectId !== declared.specSource.modelId) return false;
    return (ref.fieldId == null ? null : ref.fieldId)
      === (declared.specSource.fieldId == null ? null : declared.specSource.fieldId);
  });
};

// ---- 影响分析：端点（对象/字段）→ 受影响绑定 + 受影响指标（及其下游依赖者） ----
export const getBindingImpact = (source, query) => {
  const data = readMetricPlatform(source);
  if (query == null || query.collection == null || query.objectId == null) return {bindings: [], metrics: []};
  const touched = listModelMetricBindings(source, query);
  const metricSeen = {};
  const metrics = [];
  touched.forEach((item) => {
    const key = item.binding.metricRevisionId == null
      ? `def:${item.binding.metricDefinitionId}` : `rev:${item.binding.metricRevisionId}`;
    if (metricSeen[key]) return;
    metricSeen[key] = true;
    const dependents = item.metric.revision == null ? [] : dependentRevisions(data, item.metric.revision.id);
    metrics.push({
      metric: item.metric,
      role: item.binding.role,
      state: item.binding.state,
      dependents: dependents.map(dep => ({
        definitionId: dep.definitionId,
        definitionCode: dep.definitionCode,
        revisionId: dep.revisionId,
        version: dep.version,
        roles: dep.roles,
      })),
    });
  });
  return {bindings: touched, metrics};
};

// 简化的反向依赖（复用治理语义：谁的计算/基线引用了这个版本）
const dependentRevisions = (data, revisionId) => {
  const results = [];
  (data.revisions || []).forEach((revision) => {
    const spec = revision.spec || {};
    const roles = [];
    if (spec.kind === 'derived' && spec.atomicRevisionId === revisionId) roles.push('ATOMIC_BASE');
    if (spec.kind === 'compound' && Array.isArray(spec.refs)) {
      spec.refs.forEach((ref) => {
        if (ref != null && ref.revisionId === revisionId) roles.push('OPERAND');
      });
    }
    if (revision.baseline != null && revision.baseline.baseRevisionId === revisionId) roles.push('BASELINE');
    if (!roles.length) return;
    const definition = findDefinition(data, revision.definitionId);
    results.push({
      definitionId: revision.definitionId,
      definitionCode: definition == null ? null : definition.code,
      revisionId: revision.id,
      version: revision.version,
      roles,
    });
  });
  return results;
};

// ---- 写命令 ----
const validateModelRef = (source, input, errors) => {
  const ref = input.modelRef == null ? {} : input.modelRef;
  if (BINDING_COLLECTIONS.indexOf(ref.collection) < 0) {
    errors.push(error('INVALID_VALUE', 'modelRef.collection', 'metric.error.invalidValue',
      `modelRef.collection must be one of ${BINDING_COLLECTIONS.join('/')}`));
    return null;
  }
  if (ref.objectId == null || ref.objectId === '') {
    errors.push(missingFieldError('modelRef', 'objectId'));
    return null;
  }
  const model = findModelIn(source, ref.collection, ref.objectId);
  if (model == null) {
    errors.push(error('UNKNOWN_REFERENCE', 'modelRef.objectId', 'metric.error.unknownReference',
      `binding endpoint model does not exist: ${ref.objectId}`, {ref: ref.objectId}));
    return null;
  }
  let field = null;
  if (ref.fieldId != null) {
    if (ref.collection === 'conceptEntities') {
      errors.push(error('INVALID_VALUE', 'modelRef.fieldId', 'metric.error.invalidValue',
        'concept entities carry no fields; use object-level semantic binding'));
      return null;
    }
    field = fieldOf(model, ref.fieldId);
    if (field == null) {
      errors.push(error('UNKNOWN_REFERENCE', 'modelRef.fieldId', 'metric.error.unknownReference',
        `binding endpoint field does not exist on model: ${ref.fieldId}`, {ref: ref.fieldId}));
      return null;
    }
  }
  return {model, field};
};

const validateMapping = (model, role, mapping, revision, errors) => {
  if (mapping == null) return;
  if (typeof mapping !== 'object' || Array.isArray(mapping)) {
    errors.push(error('INVALID_VALUE', 'mapping', 'metric.error.invalidValue', 'mapping must be an object'));
    return;
  }
  const allowed = mappingWhitelist[role] || [];
  Object.keys(mapping).forEach((key) => {
    if (allowed.indexOf(key) < 0) {
      errors.push(error('UNKNOWN_KEY', `mapping.${key}`, 'metric.error.unknownKey',
        `mapping key not allowed for role ${role}: ${key}`));
    }
  });
  if (mapping.aggregate != null && AGGREGATIONS.indexOf(mapping.aggregate) < 0) {
    errors.push(error('INVALID_VALUE', 'mapping.aggregate', 'metric.error.invalidValue',
      `mapping.aggregate must be one of ${AGGREGATIONS.join('/')}`));
  }
  if (revision != null && revision.spec != null && revision.spec.kind === 'atomic'
    && mapping.aggregate != null && revision.spec.aggregation != null
    && mapping.aggregate !== revision.spec.aggregation) {
    errors.push(error('INVALID_VALUE', 'mapping.aggregate', 'metric.error.invalidValue',
      `mapping.aggregate must match metric aggregation: ${revision.spec.aggregation}`));
  }
  // mapping 引用字段必须真实存在于端点模型（如实校验，不猜）
  mappingFieldIds(mapping).forEach((fieldId) => {
    if (modelFieldIdsOf(model).indexOf(fieldId) < 0) {
      errors.push(error('UNKNOWN_REFERENCE', 'mapping', 'metric.error.unknownReference',
        `mapping references field not on endpoint model: ${fieldId}`, {ref: fieldId}));
    }
  });
};

// 创建绑定。confirmed 绑定要求：固定 metricRevisionId 且该版本已发布（draft 只能 suggested）；
// SEMANTIC_MATCH 允许绑定业务概念（metricConceptId）或具体定义版本。
export const createMetricBinding = (source, input) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const errors = [];
  if (input == null) return {ok: false, errors: [missingFieldError('binding', 'role')]};
  if (BINDING_ROLES.indexOf(input.role) < 0) {
    return {ok: false, errors: [error('INVALID_VALUE', 'role', 'metric.error.invalidValue',
      `role must be one of ${BINDING_ROLES.join('/')}`)]};
  }
  const state = input.state == null ? 'suggested' : input.state;
  if (['suggested', 'confirmed'].indexOf(state) < 0) {
    errors.push(error('INVALID_VALUE', 'state', 'metric.error.invalidValue',
      'new binding state must be suggested or confirmed'));
  }
  if (input.role === 'SEMANTIC_MATCH' && (input.revisionId == null || input.revisionId === '')
    && (input.conceptId == null || input.conceptId === '')) {
    errors.push(error('MISSING_FIELD', 'revisionId', 'metric.error.missingField',
      'semantic binding needs a metric revision or a metric concept'));
  }
  if (input.role !== 'SEMANTIC_MATCH' && (input.revisionId == null || input.revisionId === '')) {
    errors.push(missingFieldError('binding', 'revisionId'));
  }
  if (input.role === 'SEMANTIC_MATCH' && input.modelRef != null
    && SEMANTIC_COLLECTIONS.indexOf(input.modelRef.collection) < 0) {
    errors.push(error('INVALID_VALUE', 'modelRef.collection', 'metric.error.invalidValue',
      'semantic binding endpoints must be concept or logic objects (physical layers use source/materialization roles)'));
  }
  if (input.role === 'MATERIALIZES_INTO' && input.modelRef != null && input.modelRef.fieldId == null) {
    errors.push(missingFieldError('modelRef', 'fieldId'));
  }
  if (errors.length) return {ok: false, errors};

  let revision = null;
  if (input.revisionId != null && input.revisionId !== '') {
    revision = findRevision(data, input.revisionId);
    if (revision == null) {
      return {ok: false, errors: [error('UNKNOWN_REFERENCE', 'revisionId', 'metric.error.unknownReference',
        `metric revision does not exist: ${input.revisionId}`, {ref: input.revisionId})]};
    }
  }
  if (state === 'confirmed' && revision != null && revision.status !== 'published') {
    errors.push(error('UNPUBLISHED_REFERENCE', 'revisionId', 'metric.error.unpublishedReference',
      `confirmed binding requires a published revision: ${input.revisionId}`, {ref: input.revisionId}));
  }
  let concept = null;
  if (input.conceptId != null && input.conceptId !== '') {
    concept = (data.concepts || []).filter(item => item.id === input.conceptId)[0] || null;
    if (concept == null) {
      errors.push(error('UNKNOWN_REFERENCE', 'conceptId', 'metric.error.unknownReference',
        `metric concept does not exist: ${input.conceptId}`, {ref: input.conceptId}));
    }
  }
  const endpoint = validateModelRef(source, input, errors);
  if (errors.length) return {ok: false, errors};
  const {model, field} = endpoint;
  validateMapping(model, input.role, input.mapping, revision, errors);
  if (errors.length) return {ok: false, errors};

  // 同角色同端点同版本的生效重复 → 显式拒绝（同名不同对象不算重复）
  const endpointKey = `${input.modelRef.collection}\u0000${input.modelRef.objectId}\u0000${input.modelRef.fieldId == null ? '' : input.modelRef.fieldId}`;
  const duplicate = bindingsOf(data).some((binding) => {
    if (isHistorical(binding) || binding.state === 'unresolved') return false;
    if (binding.role !== input.role) return false;
    if (binding.metricRevisionId !== (revision == null ? null : revision.id)) return false;
    return endpointKeyOf(binding) === endpointKey;
  });
  if (duplicate) {
    return {ok: false, errors: [error('BINDING_EXISTS', 'binding', 'metric.error.bindingExists',
      'an active binding with the same role/revision/endpoint already exists')]};
  }

  // 计算角色：字段端点真实环检查（候选边加入合并计算图后绕行回到自身即拒绝，
  // 含声明来源取数边与依赖边；同表不同字段不误判）
  if (COMPUTE_ROLES.indexOf(input.role) >= 0 && state === 'confirmed' && revision != null) {
    const cycleError = detectComputeCycleFor(source, data, {
      role: input.role,
      metricRevisionId: revision.id,
      modelRef: {collection: input.modelRef.collection, objectId: input.modelRef.objectId,
        fieldId: input.modelRef.fieldId},
    });
    if (cycleError != null) return {ok: false, errors: [cycleError]};
  }

  const id = input.id || newMetricId('mbind');
  if (bindingsOf(data).some(binding => binding.id === id)) {
    return {ok: false, errors: [error('DUPLICATE_ID', 'id', 'metric.error.duplicateId',
      `binding id already exists: ${id}`, {id})]};
  }
  const now = input.createdAt || null;
  const ref = input.modelRef;
  const binding = {
    id,
    namespace: data.namespace == null ? null : data.namespace,
    role: input.role,
    metricRevisionId: revision == null ? null : revision.id,
    metricDefinitionId: revision == null
      ? (input.definitionId == null ? null : input.definitionId) : revision.definitionId,
    ...(input.conceptId == null ? {} : {metricConceptId: input.conceptId}),
    modelRef: {
      collection: ref.collection,
      objectId: ref.objectId,
      ...(ref.fieldId == null ? {} : {fieldId: ref.fieldId}),
      // 端点快照：显示名/业务键/指纹固定在绑定时刻，对象删除后历史仍可读
      objectKey: model.defKey == null ? null : model.defKey,
      objectName: model.defName == null ? null : model.defName,
      ...(field == null ? {} : {fieldKey: field.defKey == null ? null : field.defKey}),
      ...(field == null ? {} : {fieldName: field.defName == null ? null : field.defName}),
      schemaFingerprint: modelSchemaFingerprint(model),
    },
    ...(input.mapping == null ? {} : {mapping: JSON.parse(JSON.stringify(input.mapping))}),
    evidence: {
      kind: (input.evidence == null || input.evidence.kind == null) ? 'manual' : input.evidence.kind,
      ...(input.evidence == null || input.evidence.confirmedBy == null
        ? {} : {confirmedBy: input.evidence.confirmedBy}),
      ...(input.evidence == null || input.evidence.note == null ? {} : {note: input.evidence.note}),
    },
    state,
    createdAt: now,
    createdBy: input.createdBy == null ? null : input.createdBy,
    events: [{
      type: 'created',
      at: now,
      by: input.createdBy == null ? null : input.createdBy,
    }],
  };
  if (state === 'confirmed') {
    binding.events.push({
      type: 'confirmed',
      at: now,
      by: input.evidence == null ? null : input.evidence.confirmedBy,
    });
    binding.confirmedAt = now;
  }
  const next = {...data, bindings: bindingsOf(data).concat([binding])};
  return {
    ok: true,
    source: writeMetricPlatform(source, next),
    binding: JSON.parse(JSON.stringify(binding)),
  };
};

// 候选计算绑定的环检查（create 即确认与 confirm 共用）：
// 候选边（按已确认语义）加入合并计算图（依赖边 + 端点边[绑定与声明来源]）后，
// 从候选版本出发绕行 ≥1 条边回到自身即环（含同版本同端点自环）。
// 返回错误对象或 null。
const detectComputeCycleFor = (source, data, candidate) => {
  const successors = computeGraphSuccessors(source, data, candidate);
  const path = reachablePath(successors, candidate.metricRevisionId, candidate.metricRevisionId);
  if (path != null) {
    return error('BINDING_CYCLE', 'binding', 'metric.error.bindingCycle',
      `field endpoint would create a real compute cycle: ${path.join(' -> ')}`,
      {path: path.join(' -> ')});
  }
  return null;
};

// 确认：suggested → confirmed（端点在场、版本已发布、通过环检查）
export const confirmMetricBinding = (source, bindingId, options) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const binding = bindingsOf(data).filter(item => item.id === bindingId)[0] || null;
  if (binding == null) {
    return {ok: false, errors: [error('UNKNOWN_REFERENCE', 'bindingId', 'metric.error.unknownReference',
      `binding does not exist: ${bindingId}`, {ref: bindingId})]};
  }
  if (binding.state !== 'suggested') {
    return {ok: false, errors: [error('BINDING_STATE_INVALID', 'binding.state', 'metric.error.bindingStateInvalid',
      `only suggested bindings can be confirmed (current: ${binding.state})`,
      {state: binding.state})]};
  }
  const endpoint = bindingEndpoint(source, binding);
  if (!endpoint.present) {
    return {ok: false, errors: [error('BINDING_ENDPOINT_MISSING', 'modelRef', 'metric.error.bindingEndpointMissing',
      `binding endpoint is missing in current project: ${binding.modelRef.objectId}`,
      {ref: binding.modelRef.objectId})]};
  }
  const revision = binding.metricRevisionId == null ? null : findRevision(data, binding.metricRevisionId);
  if (revision != null && revision.status !== 'published') {
    return {ok: false, errors: [error('UNPUBLISHED_REFERENCE', 'revisionId', 'metric.error.unpublishedReference',
      `confirmed binding requires a published revision: ${revision.id}`, {ref: revision.id})]};
  }
  if (COMPUTE_ROLES.indexOf(binding.role) >= 0 && revision != null) {
    const cycleError = detectComputeCycleFor(source, data, {
      role: binding.role,
      metricRevisionId: revision.id,
      modelRef: {
        collection: binding.modelRef.collection,
        objectId: binding.modelRef.objectId,
        ...(binding.modelRef.fieldId == null ? {} : {fieldId: binding.modelRef.fieldId}),
      },
    });
    if (cycleError != null) return {ok: false, errors: [cycleError]};
  }
  const opts = options == null ? {} : options;
  const now = opts.at || null;
  const bindings = bindingsOf(data).map((item) => {
    if (item.id !== bindingId) return item;
    const next = {
      ...item,
      state: 'confirmed',
      confirmedAt: now,
      evidence: {
        ...item.evidence,
        ...(opts.confirmedBy == null ? {} : {confirmedBy: opts.confirmedBy}),
      },
      events: item.events.concat([{type: 'confirmed', at: now, by: opts.confirmedBy == null ? null : opts.confirmedBy}]),
    };
    return next;
  });
  const updated = bindings.filter(item => item.id === bindingId)[0];
  return {
    ok: true,
    source: writeMetricPlatform(source, {...data, bindings}),
    binding: JSON.parse(JSON.stringify(updated)),
  };
};

// 解除当前绑定：状态 → released，记录原因与时间；记录与端点快照保留（不抹历史）
export const releaseMetricBinding = (source, bindingId, options) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const binding = bindingsOf(data).filter(item => item.id === bindingId)[0] || null;
  if (binding == null) {
    return {ok: false, errors: [error('UNKNOWN_REFERENCE', 'bindingId', 'metric.error.unknownReference',
      `binding does not exist: ${bindingId}`, {ref: bindingId})]};
  }
  if (isHistorical(binding)) {
    return {ok: false, errors: [error('BINDING_STATE_INVALID', 'binding.state', 'metric.error.bindingStateInvalid',
      'binding is already released', {state: binding.state})]};
  }
  const opts = options == null ? {} : options;
  const now = opts.at || null;
  const bindings = bindingsOf(data).map((item) => {
    if (item.id !== bindingId) return item;
    return {
      ...item,
      state: 'released',
      releasedAt: now,
      ...(opts.reason == null ? {} : {releaseReason: opts.reason}),
      events: item.events.concat([{
        type: 'released',
        at: now,
        by: opts.by == null ? null : opts.by,
        ...(opts.reason == null ? {} : {reason: opts.reason}),
      }]),
    };
  });
  const updated = bindings.filter(item => item.id === bindingId)[0];
  return {
    ok: true,
    source: writeMetricPlatform(source, {...data, bindings}),
    binding: JSON.parse(JSON.stringify(updated)),
  };
};

// 显式重连：unresolved → suggested（端点必须按原稳定 ID 在场；同号新对象不自动复活）
export const restoreMetricBinding = (source, bindingId, options) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const binding = bindingsOf(data).filter(item => item.id === bindingId)[0] || null;
  if (binding == null) {
    return {ok: false, errors: [error('UNKNOWN_REFERENCE', 'bindingId', 'metric.error.unknownReference',
      `binding does not exist: ${bindingId}`, {ref: bindingId})]};
  }
  if (binding.state !== 'unresolved') {
    return {ok: false, errors: [error('BINDING_STATE_INVALID', 'binding.state', 'metric.error.bindingStateInvalid',
      `only unresolved bindings can be restored (current: ${binding.state})`,
      {state: binding.state})]};
  }
  const endpoint = bindingEndpoint(source, binding);
  if (!endpoint.present) {
    return {ok: false, errors: [error('BINDING_ENDPOINT_MISSING', 'modelRef', 'metric.error.bindingEndpointMissing',
      `binding endpoint is still missing: ${binding.modelRef.objectId}`,
      {ref: binding.modelRef.objectId})]};
  }
  const opts = options == null ? {} : options;
  const now = opts.at || null;
  const bindings = bindingsOf(data).map((item) => {
    if (item.id !== bindingId) return item;
    const next = {...item, state: 'suggested'};
    delete next.unresolved;
    return {
      ...next,
      events: item.events.concat([{type: 'restored', at: now, by: opts.by == null ? null : opts.by}]),
    };
  });
  const updated = bindings.filter(item => item.id === bindingId)[0];
  return {
    ok: true,
    source: writeMetricPlatform(source, {...data, bindings}),
    binding: JSON.parse(JSON.stringify(updated)),
  };
};

// 对象/字段删除时的批量失效（M4B 在删除确认处接线；M4A 提供 API）：
// 命中端点（对象级或字段级，按稳定 ID）的生效/建议绑定 → unresolved，保留端点快照
export const markMetricBindingsUnresolved = (source, query, options) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  if (query == null || query.objectId == null) {
    return {ok: false, errors: [missingFieldError('unresolved', 'objectId')]};
  }
  const opts = options == null ? {} : options;
  const now = opts.at || null;
  const reason = opts.reason == null ? 'ENDPOINT_MISSING' : opts.reason;
  let touched = 0;
  const bindings = bindingsOf(data).map((binding) => {
    // 损坏元素（缺 modelRef 等）原样保留、不参与失效，不让删除路径抛错
    if (binding == null || binding.modelRef == null) return binding;
    if (isHistorical(binding) || binding.state === 'unresolved') return binding;
    const ref = binding.modelRef;
    const objectHit = ref.objectId === query.objectId
      && (query.collection == null || ref.collection === query.collection);
    if (!objectHit) return binding;
    const fieldHit = query.fieldId == null || bindingFieldScope(binding).indexOf(query.fieldId) >= 0;
    if (!fieldHit) return binding;
    touched += 1;
    return {
      ...binding,
      state: 'unresolved',
      unresolved: {
        reason,
        at: now,
        ...(query.collection == null ? {} : {collection: query.collection}),
        objectId: query.objectId,
        ...(query.fieldId == null ? {} : {fieldId: query.fieldId}),
      },
      events: (Array.isArray(binding.events) ? binding.events : []).concat([{
        type: 'unresolved',
        at: now,
        by: opts.by == null ? null : opts.by,
        reason,
      }]),
    };
  });
  if (!touched) {
    return {ok: true, source, touched: 0};
  }
  return {
    ok: true,
    source: writeMetricPlatform(source, {...data, bindings}),
    touched,
  };
};

// 全量同步：只做 失效方向（在场 → 不在场 → unresolved），绝不自动复活
// （unresolved 的恢复必须显式 restoreMetricBinding，防导入同号误绑）
export const syncMetricBindingStates = (source, options) => {
  const data = readMetricPlatform(source);
  const guard = storeGuard(data);
  if (guard.length) return {ok: false, errors: guard};
  const opts = options == null ? {} : options;
  const now = opts.at || null;
  let touched = 0;
  const bindings = bindingsOf(data).map((binding) => {
    if (isHistorical(binding) || binding.state === 'unresolved') return binding;
    if (bindingEndpoint(source, binding).present) return binding;
    touched += 1;
    return {
      ...binding,
      state: 'unresolved',
      unresolved: {
        reason: 'ENDPOINT_MISSING',
        at: now,
        collection: binding.modelRef.collection,
        objectId: binding.modelRef.objectId,
        ...(binding.modelRef.fieldId == null ? {} : {fieldId: binding.modelRef.fieldId}),
      },
      events: binding.events.concat([{
        type: 'unresolved', at: now, by: null, reason: 'ENDPOINT_MISSING',
      }]),
    };
  });
  if (!touched) return {ok: true, source, touched: 0};
  return {
    ok: true,
    source: writeMetricPlatform(source, {...data, bindings}),
    touched,
  };
};

// 删除影响落盘（MET-12）：字段/对象删除经用户确认后，由删除入口在同一次项目更新里调用。
// impact = {fieldIds, entityIds}，可选 collection / objectId 限定端点：
//   entityIds → 对象级失效；fieldIds → 字段级失效（给 objectId 时限定该对象，
//   未给时按绑定字段范围定位所属对象）。命中生效/建议绑定 → unresolved（保留端点快照）。
// 无命中原样返回 source（引用相等）；存储不可写（storeGuard：损坏/版本不支持）同样原样
// 返回，单个损坏绑定元素（缺 modelRef）跳过、缺 events 按空历史补——删除本身不因指标存储
// 受阻（"只提示不阻止"）。同号重建不复活，须显式 restore。
export const applyDeleteImpact = (source, impact, options) => {
  const f = impact == null ? {} : impact;
  const withCollection = query => (f.collection == null ? query : {...query, collection: f.collection});
  let next = source;
  const mark = (query) => {
    const result = markMetricBindingsUnresolved(next, withCollection(query), options);
    if (result.ok) next = result.source;
  };
  (f.entityIds || []).forEach((objectId) => {
    if (objectId != null && objectId !== '') mark({objectId});
  });
  (f.fieldIds || []).forEach((fieldId) => {
    if (fieldId == null || fieldId === '') return;
    if (f.objectId != null) {
      mark({objectId: f.objectId, fieldId});
      return;
    }
    const objectIds = [];
    bindingsOf(readMetricPlatform(next)).forEach((binding) => {
      if (binding == null || binding.modelRef == null
        || bindingFieldScope(binding).indexOf(fieldId) < 0) return;
      if (objectIds.indexOf(binding.modelRef.objectId) < 0) objectIds.push(binding.modelRef.objectId);
    });
    objectIds.forEach(objectId => mark({objectId, fieldId}));
  });
  return next;
};

// 导航计数口径：只计生效/建议绑定（released 属历史、unresolved 已失效，均不计入）
export const countActiveMetricBindings = source => bindingsOf(readMetricPlatform(source))
  .filter(binding => binding != null && binding.state !== 'released'
    && binding.state !== 'unresolved').length;
