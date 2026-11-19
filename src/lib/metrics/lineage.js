// 指标平台 M5A：血缘与影响投影（纯函数，读不改源、不写库）。
// 单一事实源不变：定义/版本/依赖由 spec 派生，模型关联以 ModelBinding 为准，
// spec.source 为定义声明（DECLARED，与生效绑定同端点去重、绑定优先）。
// 关系分类投影（SPEC 7）：
//   compute     计算血缘：字段→原子（绑定/声明）→派生/复合（固定版本依赖）→落地字段；
//   inheritance 公共继承：公共版本→部门版本（虚线，不进计算 DAG，单独查环）；
//   consumption 使用引用：指标版本→消费模型/应用（不自动等于计算依赖）；
//   semantic    语义映射：概念/逻辑对象↔指标业务含义（无数据流向，不画方向箭头）。
// 方向与版本：边携带具体 revisionId 与版本号；不同版本是不同节点（固定版本隔离）。
// 失效语义：端点按稳定 ID 实判在场；不在场保留绑定/声明快照并标记 invalid，
// 不按同名复活。released 属历史（默认排除，显式筛选可见）。
// 注：构建链不识别 ??，使用 == null 三元。

import {readMetricPlatform} from './store';
import {
  BINDING_COLLECTIONS,
  bindingEndpoint,
  declaredCoveredByBinding,
  findModelIn,
  listBindingCycles,
  listMetricBindings,
  metricComputeFlowSuccessors,
} from './binding';
import {readMetricDictionary} from './dictionary';
import {listRevisionDependents} from './governance';

export const LINEAGE_PROJECTIONS = ['compute', 'inheritance', 'consumption', 'semantic'];

// 边 kind → 投影分类
const EDGE_PROJECTION = {
  'compute-source': 'compute',
  'declared-source': 'compute',
  'dependency': 'compute',
  'materialization': 'compute',
  'consumption': 'consumption',
  'baseline': 'inheritance',
  'semantic': 'semantic',
};

const metricNodeId = revisionId => `m:${revisionId}`;
const endpointNodeId = ref =>
  `f:${ref.collection}:${ref.objectId}:${ref.fieldId == null ? '' : ref.fieldId}`;
const conceptNodeId = conceptId => `mc:${conceptId}`;

const findDefinition = (data, id) =>
  (data.definitions || []).filter(item => item.id === id)[0] || null;
const findRevision = (data, id) =>
  (data.revisions || []).filter(item => item.id === id)[0] || null;

const capDepth = depth => (depth == null || depth === 'all') ? 6 : Math.max(1, Math.min(6, depth));

// ---- 边池（全量事实，按 options 过滤后参与遍历） ----
const bindingStateAllowed = (binding, options) => {
  if (binding.state === 'confirmed') return true;
  if (binding.state === 'suggested') return !!options.includeSuggested;
  if (binding.state === 'unresolved') return !!options.includeUnresolved;
  if (binding.state === 'released') return !!options.includeReleased;
  return false;
};

const buildEdgePool = (source, options) => {
  const data = readMetricPlatform(source);
  const definitionById = {};
  (data.definitions || []).forEach((definition) => {
    definitionById[definition.id] = definition;
  });
  const edges = [];
  const addEdge = edge => edges.push(edge);

  // ① 绑定边（角色→kind；状态过滤；失效带原因与快照）
  (data.bindings || []).forEach((binding) => {
    if (!bindingStateAllowed(binding, options)) return;
    const ref = binding.modelRef;
    const endpoint = bindingEndpoint(source, binding);
    const fieldNode = endpointNodeId(ref);
    const metricNode = metricNodeId(binding.metricRevisionId);
    const invalid = !endpoint.present;
    const common = {
      bindingId: binding.id,
      state: binding.state,
      evidence: binding.evidence || null,
      confirmedAt: binding.confirmedAt == null ? null : binding.confirmedAt,
      createdBy: binding.createdBy == null ? null : binding.createdBy,
      createdAt: binding.createdAt == null ? null : binding.createdAt,
      releasedAt: binding.releasedAt == null ? null : binding.releasedAt,
      releaseReason: binding.releaseReason == null ? null : binding.releaseReason,
      unresolvedReason: (binding.unresolved || {}).reason || null,
      mapping: binding.mapping || null,
      snapshot: {
        objectName: ref.objectName == null ? null : ref.objectName,
        objectKey: ref.objectKey == null ? null : ref.objectKey,
        fieldName: ref.fieldName == null ? null : ref.fieldName,
        fieldKey: ref.fieldKey == null ? null : ref.fieldKey,
      },
      endpoint,
    };
    if (binding.role === 'COMPUTES_FROM') {
      addEdge({
        id: `compute-source:${binding.id}`, kind: 'compute-source',
        from: fieldNode, to: metricNode, direction: 'flow',
        expression: (binding.mapping || {}).aggregate == null ? null : binding.mapping.aggregate,
        ...common, invalid,
      });
    } else if (binding.role === 'MATERIALIZES_INTO') {
      addEdge({
        id: `materialization:${binding.id}`, kind: 'materialization',
        from: metricNode, to: fieldNode, direction: 'flow',
        usage: (binding.mapping || {}).usage == null ? null : binding.mapping.usage,
        ...common, invalid,
      });
    } else if (binding.role === 'CONSUMED_BY') {
      addEdge({
        id: `consumption:${binding.id}`, kind: 'consumption',
        from: metricNode, to: fieldNode, direction: 'flow',
        usage: (binding.mapping || {}).usage == null ? null : binding.mapping.usage,
        ...common, invalid,
      });
    } else if (binding.role === 'SEMANTIC_MATCH') {
      const targetNode = binding.metricRevisionId != null
        ? metricNodeId(binding.metricRevisionId) : conceptNodeId(binding.metricConceptId);
      addEdge({
        id: `semantic:${binding.id}`, kind: 'semantic',
        from: fieldNode, to: targetNode, direction: 'none',
        semanticKind: ((binding.mapping || {}).semanticKind) == null
          ? null : binding.mapping.semanticKind,
        ...common, invalid,
      });
    }
  });

  // ② 声明来源边（定义声明，非手工确认）：与同端点生效 COMPUTES_FROM 绑定去重（绑定优先）
  const activeBindings = (data.bindings || []).filter(binding => binding.state === 'confirmed'
    || binding.state === 'suggested');
  (data.revisions || []).forEach((revision) => {
    const spec = revision == null ? null : revision.spec;
    if (spec == null || spec.kind !== 'atomic') return;
    const ref = spec.source;
    if (ref == null || ref.modelId == null || ref.modelId === '') return;
    let collection = null;
    let object = null;
    for (let i = 0; i < BINDING_COLLECTIONS.length; i += 1) {
      const hit = findModelIn(source, BINDING_COLLECTIONS[i], ref.modelId);
      if (hit != null) { collection = BINDING_COLLECTIONS[i]; object = hit; break; }
    }
    const field = object != null && ref.fieldId != null
      ? ((object.fields || []).filter(f => f != null && f.id === ref.fieldId)[0] || null) : null;
    const fieldMissing = object != null && ref.fieldId != null && field == null;
    const entry = {
      ownerId: revision.id,
      specSource: {modelId: ref.modelId, ...(ref.fieldId == null ? {} : {fieldId: ref.fieldId})},
      endpoint: object == null
        ? {present: false, collection: null}
        : {present: !fieldMissing, collection},
    };
    if (declaredCoveredByBinding(source, entry, activeBindings)) return;
    addEdge({
      id: `declared-source:${revision.id}`, kind: 'declared-source',
      from: endpointNodeId({
        collection: collection == null ? 'entities' : collection,
        objectId: ref.modelId,
        ...(ref.fieldId == null ? {} : {fieldId: ref.fieldId}),
      }),
      to: metricNodeId(revision.id), direction: 'flow',
      state: 'declared', evidence: {kind: 'declared'}, invalid: !entry.endpoint.present,
      designOnly: collection !== 'entities',
      snapshot: object == null ? {} : {
        objectName: object.defName == null ? null : object.defName,
        objectKey: object.defKey == null ? null : object.defKey,
        fieldName: field == null ? null : (field.defName || field.defKey),
        fieldKey: field == null ? null : field.defKey,
      },
      endpoint: object == null
        ? {present: false, object: null, field: null, collection: null}
        : {present: !fieldMissing, object, field: field || null, collection},
    });
  });

  // ③ 指标依赖边（固定版本，由 spec 派生；上游→下游数据流）
  (data.revisions || []).forEach((revision) => {
    const spec = revision == null ? null : revision.spec;
    if (spec == null) return;
    if (spec.kind === 'derived' && spec.atomicRevisionId != null) {
      addEdge({
        id: `dependency:${revision.id}:ATOMIC_BASE`, kind: 'dependency',
        from: metricNodeId(spec.atomicRevisionId), to: metricNodeId(revision.id),
        direction: 'flow', state: 'confirmed', role: 'ATOMIC_BASE', evidence: null,
        invalid: findRevision(data, spec.atomicRevisionId) == null,
      });
    }
    if (spec.kind === 'compound' && Array.isArray(spec.refs)) {
      spec.refs.forEach((ref) => {
        if (ref == null || ref.revisionId == null) return;
        addEdge({
          id: `dependency:${revision.id}:OPERAND:${ref.key || ''}`, kind: 'dependency',
          from: metricNodeId(ref.revisionId), to: metricNodeId(revision.id),
          direction: 'flow', state: 'confirmed', role: 'OPERAND', refKey: ref.key || null,
          evidence: null, invalid: findRevision(data, ref.revisionId) == null,
        });
      });
    }
    // ④ 公共继承边（baseline，虚线，不进计算 DAG）
    if (revision.baseline != null && revision.baseline.baseRevisionId != null) {
      addEdge({
        id: `baseline:${revision.id}`, kind: 'baseline',
        from: metricNodeId(revision.baseline.baseRevisionId), to: metricNodeId(revision.id),
        direction: 'flow', state: 'confirmed', role: 'BASELINE', evidence: null,
        invalid: findRevision(data, revision.baseline.baseRevisionId) == null,
      });
    }
  });

  return {data, definitionById, edges};
};

// ---- 节点构建（按需） ----
const buildMetricNode = (data, definitionById, revisionId, extras) => {
  const revision = findRevision(data, revisionId);
  if (revision == null) {
    return {
      id: metricNodeId(revisionId), kind: 'metric', revisionId,
      name: revisionId, code: null, version: null, status: null, scope: null,
      metricKind: null, present: false, inCycle: false, ...extras,
    };
  }
  const definition = definitionById[revision.definitionId] || null;
  return {
    id: metricNodeId(revisionId), kind: 'metric', revisionId,
    definitionId: revision.definitionId,
    name: definition == null ? (revision.spec || {}).name || revisionId : definition.name,
    code: definition == null ? null : definition.code,
    version: revision.version,
    status: revision.status,
    scope: definition == null ? null : definition.scope,
    metricKind: definition == null ? null : definition.kind,
    designOnly: (revision.resolvedSpec || {}).designOnly === true,
    present: true,
    inCycle: false, ...extras,
  };
};

const buildEndpointNode = (source, ref, snapshot, endpoint, extras) => {
  const present = endpoint != null && endpoint.present;
  const object = present ? endpoint.object
    : (endpoint != null ? endpoint.object : null);
  const field = present ? endpoint.field : null;
  const objectName = (object != null && (object.defName || object.defKey))
    || (snapshot != null ? (snapshot.objectName || snapshot.objectKey) : null)
    || ref.objectId;
  return {
    id: endpointNodeId(ref), kind: ref.fieldId == null ? 'object' : 'field',
    collection: ref.collection, objectId: ref.objectId,
    fieldId: ref.fieldId == null ? null : ref.fieldId,
    name: ref.fieldId == null ? objectName : objectName,
    fieldName: (field != null && (field.defKey || field.defName))
      || (snapshot != null ? (snapshot.fieldKey || snapshot.fieldName) : null)
      || (ref.fieldId == null ? null : ref.fieldId),
    objectKey: (object != null && object.defKey)
      || (snapshot != null ? snapshot.objectKey : null) || ref.objectId,
    present, ...(extras || {}),
  };
};

const buildConceptNode = (data, conceptId, extras) => {
  const concept = (data.concepts || []).filter(item => item.id === conceptId)[0] || null;
  return {
    id: conceptNodeId(conceptId), kind: 'metricConcept', conceptId,
    name: concept == null ? conceptId : `${concept.domain || ''} / ${concept.name}`,
    code: concept == null ? null : concept.id,
    present: concept != null, ...(extras || {}),
  };
};

// 端点节点引用信息（从边里恢复 ref）
const refOfEdgeNode = (nodeId) => {
  const parts = String(nodeId).split(':');
  if (parts[0] !== 'f') return null;
  return {collection: parts[1], objectId: parts[2],
    fieldId: parts[3] === '' ? null : parts.slice(3).join(':')};
};

// ---- 遍历 ----
// 邻接索引（一次性构建）：up=入边邻居，down=出边邻居；
// semantic 无向边在两端点的 up/down 均可达（保持无向呈现，不画方向箭头）。
const buildAdjacency = (edges, projections) => {
  const adjacency = new Map();
  const slotOf = (nodeId) => {
    let slot = adjacency.get(nodeId);
    if (slot == null) {
      slot = {up: [], down: []};
      adjacency.set(nodeId, slot);
    }
    return slot;
  };
  edges.forEach((edge) => {
    if (projections.indexOf(EDGE_PROJECTION[edge.kind]) < 0) return;
    if (edge.direction === 'none') {
      slotOf(edge.from).up.push({nodeId: edge.to, edge});
      slotOf(edge.from).down.push({nodeId: edge.to, edge});
      slotOf(edge.to).up.push({nodeId: edge.from, edge});
      slotOf(edge.to).down.push({nodeId: edge.from, edge});
      return;
    }
    slotOf(edge.to).up.push({nodeId: edge.from, edge});
    slotOf(edge.from).down.push({nodeId: edge.to, edge});
  });
  return adjacency;
};

/**
 * 血缘图投影。
 * options:
 *   focus {revisionId} | {collection, objectId, fieldId?} | {conceptId}
 *   direction 'both'|'upstream'|'downstream'（默认 both）
 *   depth 1..6 | 'all'（默认 2）
 *   projections ['compute',...]（默认 ['compute']）
 *   includeSuggested / includeUnresolved / includeReleased（默认全 false）
 *   expand {nodeId: 额外深度}（逐层展开：命中节点局部预算增加；
 *          每节点额度全局只生效一次，遍历任意有限图可证明终止）
 * → {ok, focusNode, nodes, edges, cycles, counts, truncated}
 */
export const buildLineageGraph = (source, options) => {
  const opts = options == null ? {} : options;
  const projections = !opts.projections || !opts.projections.length
    ? ['compute'] : opts.projections;
  const direction = opts.direction == null ? 'both' : opts.direction;
  const depth = capDepth(opts.depth == null ? 2 : opts.depth);
  const expand = opts.expand || {};
  const {data, definitionById, edges} = buildEdgePool(source, opts);

  // 焦点节点
  let focusId = null;
  if (opts.focus != null && opts.focus.revisionId != null) {
    if (findRevision(data, opts.focus.revisionId) == null) {
      return {ok: false, reason: 'REVISION_NOT_FOUND', nodes: [], edges: [], cycles: []};
    }
    focusId = metricNodeId(opts.focus.revisionId);
  } else if (opts.focus != null && opts.focus.collection != null
    && opts.focus.objectId != null) {
    focusId = endpointNodeId({
      collection: opts.focus.collection,
      objectId: opts.focus.objectId,
      ...(opts.focus.fieldId == null ? {} : {fieldId: opts.focus.fieldId}),
    });
  } else if (opts.focus != null && opts.focus.conceptId != null) {
    focusId = conceptNodeId(opts.focus.conceptId);
  }
  if (focusId == null) {
    return {ok: false, reason: 'FOCUS_REQUIRED', nodes: [], edges: [], cycles: []};
  }

  // 有限 BFS（预算沿边单调 -1；expand 额度每节点全局只生效一次）：
  // - 出队预算取 budgetById 当前值，绝不重复叠加 expand（修复：旧实现每次出队
  //   重新叠加 expand，双向边回走时预算可正增长 → 无限循环）；
  // - 节点再入队仅当整数预算严格增大，且任一预算上界 = depth + Σexpand
  //   （每个额度在预算推导链中至多计入一次，推导链按事件时间严格递减），
  //   入队事件有限 → 任意有限图（含双向边/环）可证明终止；
  // - 超预算方向挂 hasMoreUp/hasMoreDown 旗标（UI「+N 展开」逐层扩展预期保留）。
  const adjacency = buildAdjacency(edges, projections);
  const nodes = new Map();
  const edgeIds = new Set();
  const ensureNode = (nodeId) => {
    if (nodes.has(nodeId)) return nodes.get(nodeId);
    let node;
    if (nodeId.indexOf('m:') === 0) {
      node = buildMetricNode(data, definitionById, nodeId.slice(2), {});
    } else if (nodeId.indexOf('mc:') === 0) {
      node = buildConceptNode(data, nodeId.slice(3), {});
    } else {
      const ref = refOfEdgeNode(nodeId);
      const hitEdge = edges.filter(edge => edge.from === nodeId || edge.to === nodeId)[0];
      node = buildEndpointNode(source, ref, hitEdge ? hitEdge.snapshot : null,
        hitEdge ? hitEdge.endpoint : null, {});
    }
    node.focus = nodeId === focusId;
    node.hasMoreUp = false;
    node.hasMoreDown = false;
    nodes.set(nodeId, node);
    return node;
  };
  ensureNode(focusId);

  const dirs = [];
  if (direction === 'both' || direction === 'upstream') dirs.push('up');
  if (direction === 'both' || direction === 'downstream') dirs.push('down');
  const expandApplied = {};
  expandApplied[focusId] = true;
  const budgetById = {};
  budgetById[focusId] = depth + (expand[focusId] || 0);
  const queue = [focusId];
  while (queue.length) {
    const currentId = queue.shift();
    const node = nodes.get(currentId);
    const budget = budgetById[currentId] == null ? 0 : budgetById[currentId];
    dirs.forEach((dir) => {
      const neighbors = ((adjacency.get(currentId) || {})[dir] || []);
      if (budget <= 0) {
        if (neighbors.length > 0) {
          if (dir === 'up') node.hasMoreUp = true;
          else node.hasMoreDown = true;
        }
        return;
      }
      neighbors.forEach(({nodeId, edge}) => {
        edgeIds.add(edge.id);
        const bonus = expandApplied[nodeId] ? 0 : (expand[nodeId] || 0);
        const candidate = budget - 1 + bonus;
        if (budgetById[nodeId] == null || candidate > budgetById[nodeId]) {
          if (bonus > 0) expandApplied[nodeId] = true;
          ensureNode(nodeId);
          budgetById[nodeId] = candidate;
          queue.push(nodeId);
        }
      });
    });
  }

  // 环标记（confirmed 计算环；仅 compute 投影时标记）
  const cycles = projections.indexOf('compute') >= 0 ? listBindingCycles(source) : [];
  const cycleRevisionIds = {};
  cycles.forEach(path => path.forEach(id => { cycleRevisionIds[id] = true; }));
  nodes.forEach((node) => {
    if (node.kind === 'metric' && cycleRevisionIds[node.revisionId]) node.inCycle = true;
  });

  const graphEdges = edges.filter(edge => edgeIds.has(edge.id));
  const nodeList = Array.from(nodes.values());
  const counts = {
    nodes: nodeList.length,
    edges: graphEdges.length,
    byProjection: projections.map((projection) => ({
      projection,
      edges: graphEdges.filter(edge => EDGE_PROJECTION[edge.kind] === projection).length,
    })),
  };
  return {
    ok: true,
    focusId,
    nodes: nodeList,
    edges: graphEdges,
    cycles,
    counts,
    truncated: nodeList.some(node => node.hasMoreUp || node.hasMoreDown),
  };
};

/**
 * 分层布局：field=0 起，metric 按计算上游最长路径 +1，落地字段/消费对象随目标指标，
 * 继承/语义节点放最右侧。环内节点按首次稳定值放置（迭代上限保护）。
 * → {columns: [{nodeId}], columnOf: {nodeId}, columnCount}
 */
export const layoutLineageColumns = (graph) => {
  const columnOf = {};
  const nodes = graph.nodes || [];
  nodes.forEach((node) => {
    if (node.kind === 'field' || node.kind === 'object') columnOf[node.id] = 0;
    else if (node.kind === 'metric') columnOf[node.id] = 1;
    else columnOf[node.id] = 2;
  });
  const computeEdges = (graph.edges || []).filter(edge =>
    EDGE_PROJECTION[edge.kind] === 'compute' && edge.direction === 'flow');
  const relaxed = (nodeId, value) => {
    if (value > (columnOf[nodeId] == null ? -1 : columnOf[nodeId])) columnOf[nodeId] = value;
  };
  for (let round = 0; round <= nodes.length; round += 1) {
    let changed = false;
    computeEdges.forEach((edge) => {
      const from = columnOf[edge.from] == null ? null : columnOf[edge.from];
      const to = columnOf[edge.to] == null ? null : columnOf[edge.to];
      if (from != null && edge.kind !== 'materialization') {
        if (to == null || to < from + 1) {
          if (columnOf[edge.to] !== from + 1) {
            relaxed(edge.to, from + 1);
            changed = true;
          }
        }
      }
      if (edge.kind === 'materialization' && from != null) {
        if (columnOf[edge.to] == null || columnOf[edge.to] < from + 1) {
          relaxed(edge.to, from + 1);
          changed = true;
        }
      }
    });
    if (!changed) break;
  }
  const maxColumn = Math.max(0, ...nodes.map(node => columnOf[node.id] || 0));
  // 继承/语义目标靠右（不参与计算层）
  (graph.edges || []).forEach((edge) => {
    if (edge.kind === 'baseline' || edge.kind === 'semantic') {
      relaxed(edge.to, maxColumn + 1);
    }
  });
  const columnCount = Math.max(0, ...nodes.map(node => columnOf[node.id] || 0)) + 1;
  const columns = [];
  for (let i = 0; i < columnCount; i += 1) columns.push([]);
  nodes.forEach((node) => {
    columns[columnOf[node.id] || 0].push(node.id);
  });
  return {columns, columnOf, columnCount};
};

// ---- 影响分析 ----

// 计算下游闭包（含路径），复用 binding 计算流语义；返回 {revisionId: path[]}
const computeDownstreamClosure = (source, startRevisionIds) => {
  const successors = metricComputeFlowSuccessors(source);
  const closure = {};
  const queue = startRevisionIds.map(id => ({id, path: [id]}));
  const enqueued = {};
  startRevisionIds.forEach((id) => { enqueued[id] = true; });
  while (queue.length) {
    const item = queue.shift();
    (successors(item.id) || []).forEach((next) => {
      const prevPath = closure[next];
      const candidate = item.path.concat([next]);
      if (prevPath == null || candidate.length < prevPath.length) {
        closure[next] = candidate;
      }
      if (!enqueued[next]) {
        enqueued[next] = true;
        queue.push({id: next, path: candidate});
      }
    });
  }
  return closure;
};

const metricSummary = (data, definitionById, revisionId, extra) => {
  const revision = findRevision(data, revisionId);
  const definition = revision == null ? null : definitionById[revision.definitionId] || null;
  return {
    revisionId,
    definitionId: revision == null ? null : revision.definitionId,
    code: definition == null ? null : definition.code,
    name: definition == null ? null : definition.name,
    kind: definition == null ? null : definition.kind,
    scope: definition == null ? null : definition.scope,
    version: revision == null ? null : revision.version,
    status: revision == null ? null : revision.status,
    ...(extra || {}),
  };
};

const patchDimensionHit = (patch, dimensionId) => {
  if (patch == null) return false;
  const lists = []
    .concat(patch.addQualifiers || [])
    .concat(patch.addBaseQualifiers || []);
  if (lists.some(q => q != null && q.dimensionId === dimensionId)) return true;
  if (Array.isArray(patch.restrictDimensions)
    && patch.restrictDimensions.indexOf(dimensionId) >= 0) return true;
  return false;
};

/**
 * 变更影响查询（只读）：
 *   {revisionId} 指标版本变更 | {collection, objectId, fieldId?} 模型端点变更
 *   | {dimensionId} 语义字典维度变更。
 * 直接=绑定/声明命中端点或定义直接引用；传递=沿固定版本依赖与 confirmed 计算流
 * 闭包；BASELINE 单列为口径通知（不算计算下游）。全部按 revisionId 去重。
 */
export const getLineageImpact = (source, query) => {
  if (query == null) return {ok: false, reason: 'QUERY_REQUIRED'};
  const data = readMetricPlatform(source);
  const definitionById = {};
  (data.definitions || []).forEach((definition) => {
    definitionById[definition.id] = definition;
  });
  const notes = [];
  const buildResult = (focus, directMetrics, endpoints) => {
    const directIds = {};
    directMetrics.forEach((entry) => { directIds[entry.revisionId] = true; });
    const startIds = directMetrics.map(entry => entry.revisionId)
      .filter(id => id != null);
    const closure = computeDownstreamClosure(source, startIds);
    const transitive = [];
    Object.keys(closure).forEach((revisionId) => {
      if (directIds[revisionId]) return;
      transitive.push(metricSummary(data, definitionById, revisionId,
        {path: closure[revisionId]}));
    });
    transitive.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const baselineCount = directMetrics
      .filter(entry => (entry.roles || []).indexOf('BASELINE') >= 0).length;
    const endpointSeen = {};
    const dedupedEndpoints = endpoints.filter((endpoint) => {
      const key = `${endpoint.collection}\u0000${endpoint.objectId}\u0000${endpoint.fieldId == null ? '' : endpoint.fieldId}`;
      if (endpointSeen[key]) return false;
      endpointSeen[key] = true;
      return true;
    });
    return {
      ok: true,
      focus,
      direct: {metrics: directMetrics, endpoints: dedupedEndpoints},
      transitive: {metrics: transitive},
      stats: {
        directCount: directMetrics.length,
        baselineNotifyCount: baselineCount,
        transitiveCount: transitive.length,
        endpointCount: dedupedEndpoints.length,
      },
      notes,
    };
  };

  if (query.revisionId != null) {
    const revision = findRevision(data, query.revisionId);
    if (revision == null) return {ok: false, reason: 'REVISION_NOT_FOUND'};
    // 直接下游：定义直接引用（ATOMIC_BASE/OPERAND 计算；BASELINE 口径通知）
    const directMetrics = listRevisionDependents(source, query.revisionId)
      .map(dep => metricSummary(data, definitionById, dep.revisionId, {roles: dep.roles}));
    // 直接端点：该版本的生效绑定（落地/消费/来源；released 不算受影响端点）
    const endpoints = [];
    listMetricBindings(source, {revisionId: query.revisionId, includeReleased: false})
      .forEach((item) => {
        endpoints.push({
          collection: item.binding.modelRef.collection,
          objectId: item.binding.modelRef.objectId,
          fieldId: item.binding.modelRef.fieldId == null ? null : item.binding.modelRef.fieldId,
          objectName: item.endpoint.object == null
            ? (item.binding.modelRef.objectName || item.binding.modelRef.objectKey)
            : (item.endpoint.object.defName || item.endpoint.object.defKey),
          fieldName: item.endpoint.field == null
            ? (item.binding.modelRef.fieldKey || item.binding.modelRef.fieldName || null)
            : (item.endpoint.field.defKey || item.endpoint.field.defName),
          role: item.binding.role, state: item.binding.state,
          present: item.endpoint.present,
        });
      });
    notes.push({messageKey: 'metrics.lineage.impact.caliber.direct'});
    notes.push({messageKey: 'metrics.lineage.impact.caliber.transitive'});
    notes.push({messageKey: 'metrics.lineage.impact.caliber.baseline'});
    return buildResult({kind: 'revision', revisionId: query.revisionId},
      directMetrics, endpoints);
  }

  if (query.collection != null && query.objectId != null) {
    const model = findModelIn(source, query.collection, query.objectId);
    const field = model != null && query.fieldId != null
      ? ((model.fields || []).filter(f => f != null && f.id === query.fieldId)[0] || null)
      : null;
    // 复用 M4A 绑定影响语义：命中绑定（端点字段或 mapping 角色字段）→ 受影响指标
    const impactBindings = listMetricBindings(source, {
      collection: query.collection,
      objectId: query.objectId,
      ...(query.fieldId == null ? {} : {fieldId: query.fieldId}),
      includeReleased: false,
    });
    const directMetrics = [];
    const seen = {};
    impactBindings.forEach((item) => {
      if (item.binding.metricRevisionId == null) return;
      if (seen[item.binding.metricRevisionId]) {
        const exist = directMetrics.filter(m => m.revisionId === item.binding.metricRevisionId)[0];
        exist.roles = (exist.roles || []).concat([`BINDING:${item.binding.role}`]);
        return;
      }
      seen[item.binding.metricRevisionId] = true;
      directMetrics.push(metricSummary(data, definitionById, item.binding.metricRevisionId,
        {roles: [`BINDING:${item.binding.role}`]}));
    });
    // 声明来源命中（原子 spec.source 端点；同端点绑定已在上面去重）
    const coveredRevisionIds = {};
    impactBindings.forEach((item) => {
      if (item.binding.role === 'COMPUTES_FROM' && item.binding.metricRevisionId != null) {
        coveredRevisionIds[item.binding.metricRevisionId] = true;
      }
    });
    (data.revisions || []).forEach((revision) => {
      const spec = revision == null ? null : revision.spec;
      if (spec == null || spec.kind !== 'atomic') return;
      const ref = spec.source;
      if (ref == null || ref.modelId !== query.objectId) return;
      if (query.fieldId != null && ref.fieldId !== query.fieldId) return;
      if (query.fieldId == null && ref.fieldId != null) {
        // 模型级查询不命中字段级声明（不同端点粒度）
      }
      if (seen[revision.id]) return;
      seen[revision.id] = true;
      directMetrics.push(metricSummary(data, definitionById, revision.id,
        {roles: ['DECLARED'], declaredEndpointMissing: model == null || field == null
          ? model == null : (ref.fieldId != null && field == null)}));
    });
    const endpoints = impactBindings.map(item => ({
      collection: query.collection,
      objectId: query.objectId,
      fieldId: item.binding.modelRef.fieldId == null ? null : item.binding.modelRef.fieldId,
      objectName: model == null ? (item.binding.modelRef.objectName || null)
        : (model.defName || model.defKey),
      fieldName: field == null ? null : (field.defKey || field.defName),
      role: item.binding.role, state: item.binding.state,
      present: model != null && (query.fieldId == null || field != null),
    }));
    notes.push({messageKey: 'metrics.lineage.impact.caliber.endpointDirect'});
    notes.push({messageKey: 'metrics.lineage.impact.caliber.transitive'});
    return buildResult({
      kind: 'endpoint', collection: query.collection, objectId: query.objectId,
      ...(query.fieldId == null ? {} : {fieldId: query.fieldId}),
      present: model != null && (query.fieldId == null || field != null),
    }, directMetrics, endpoints);
  }

  if (query.dimensionId != null) {
    const directMetrics = [];
    const seen = {};
    (data.revisions || []).forEach((revision) => {
      const spec = revision == null ? null : revision.spec;
      const wheres = [];
      if (spec != null) {
        (spec.baseQualifiers || []).concat(spec.qualifiers || [])
          .forEach(q => { if (q != null && q.dimensionId === query.dimensionId) wheres.push('qualifier'); });
        (spec.dimensions || [])
          .forEach(d => { if (d != null && d.dimensionId === query.dimensionId) wheres.push('dimension'); });
        (spec.outputGrain || [])
          .forEach(g => { if (g === query.dimensionId) wheres.push('outputGrain'); });
      }
      if (patchDimensionHit(revision.patch, query.dimensionId)) wheres.push('patch');
      if (!wheres.length) return;
      if (seen[revision.id]) return;
      seen[revision.id] = true;
      directMetrics.push(metricSummary(data, definitionById, revision.id,
        {roles: [`DIMENSION:${Array.from(new Set(wheres)).join('+')}`]}));
    });
    // 字典内依赖：限定条目引用该维度（复用 M3B 语义，只读扫描）
    const dictionary = readMetricDictionary(source);
    const dictQualifiers = (dictionary.qualifiers || [])
      .filter(qualifier => qualifier != null && qualifier.dimensionId === query.dimensionId)
      .map(qualifier => ({code: qualifier.code, name: qualifier.name}));
    notes.push({messageKey: 'metrics.lineage.impact.caliber.dimensionDirect'});
    notes.push({messageKey: 'metrics.lineage.impact.caliber.transitive'});
    const result = buildResult({kind: 'dimension', dimensionId: query.dimensionId},
      directMetrics, []);
    result.dictionaryQualifiers = dictQualifiers;
    return result;
  }

  return {ok: false, reason: 'QUERY_REQUIRED'};
};
