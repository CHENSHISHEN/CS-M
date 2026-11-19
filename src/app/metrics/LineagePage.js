import React, {useEffect, useMemo, useRef, useState} from 'react';
import {FormatMessage} from 'components';
import {metricApi} from './commands';
import {renderKindBadge, renderScopeBadge, renderStatusBadge} from './parts';
import {renderBindingStateTag, renderRoleTag} from './ModelMetricPanel';

// 指标平台 M5A：血缘与影响页（只读投影，不写项目）。
// - 图数据全部来自真实存储：固定版本依赖 + ModelBinding（确认/建议/失效/历史）
//   + spec.source 定义声明（DECLARED，与生效绑定同端点去重）；无硬编码演示节点；
// - 四类投影分开展示：计算（默认）/公共继承/使用引用/语义映射；继承与语义不冒充
//   计算数据流（虚线/无箭头 + 图例文字）；语义边不显示方向箭头；
// - 失效（端点不在场）保留快照并独立标记，不与正常关系仅靠颜色区分（虚线+标签）；
//   released 属历史，需显式勾选才可见；
// - 支持具体指标版本焦点、上游/下游/双向、深度、逐层展开（节点 +N 提升局部预算）、
//   缩放/平移/定位；点节点/边看类型、表达式/用途、证据、确认信息/失效原因；
// - 影响查询（指标版本/模型端点/字典维度）：直接与传递分开、按版本去重并给出
//   统计口径说明；节点/详情/目录/模型关联互跳（精确打开模型字段）。
// 与 src/lib/metrics 约定一致：不使用 ?? / ?。

const DIRECTION_OPTIONS = ['both', 'upstream', 'downstream'];
const PROJECTION_OPTIONS = ['compute', 'inheritance', 'consumption', 'semantic', 'all'];
const DEPTH_OPTIONS = ['1', '2', '3', 'all'];
const SCOPE_OPTIONS = ['all', 'public', 'department'];
// M5B-R1 指标类型筛选（SPEC 7.2）：原子/派生/复合，与范围合取过滤焦点候选
const KIND_OPTIONS = ['all', 'atomic', 'derived', 'compound'];

// 范围筛选（M5A R1）：只筛选可作为焦点的指标候选；图遍历不受影响，
// 跨范围的真实上下游仍完整展示（不隐藏必要依赖）。
const scopeMatches = (definition, filter, department) => {
  if (filter !== 'public' && filter !== 'department') return true;
  const scope = definition.scope == null ? {kind: 'public'} : definition.scope;
  if (filter === 'public') return scope.kind !== 'department';
  if (scope.kind !== 'department') return false;
  return department == null || department === ''
    || scope.departmentId === department;
};

// 类型筛选与范围同一语义：只筛选焦点候选，不裁去真实跨类型上下游
const kindMatches = (definition, filter) => filter === 'all'
  || (definition != null && definition.kind === filter);

const EDGE_KIND_KEYS = {
  'compute-source': 'metrics.lineage.edge.computeSource',
  'declared-source': 'metrics.lineage.edge.declaredSource',
  'dependency': 'metrics.lineage.edge.dependency',
  'materialization': 'metrics.lineage.edge.materialization',
  'consumption': 'metrics.lineage.edge.consumption',
  'baseline': 'metrics.lineage.edge.baseline',
  'semantic': 'metrics.lineage.edge.semantic',
};

const LAYER_KEYS = {
  entities: 'metrics.model.physical',
  logicEntities: 'metrics.model.logical',
  conceptEntities: 'metrics.model.conceptual',
};

const ROLE_KEYS = {
  ATOMIC_BASE: 'metrics.lineage.role.atomicBase',
  OPERAND: 'metrics.lineage.role.operand',
  BASELINE: 'metrics.lineage.role.baseline',
  COMPUTES_FROM: 'metrics.binding.role.computesFrom',
  MATERIALIZES_INTO: 'metrics.binding.role.materializesInto',
  CONSUMED_BY: 'metrics.binding.role.consumedBy',
  SEMANTIC_MATCH: 'metrics.binding.role.semanticMatch',
  DECLARED: 'metrics.binding.declared.tag',
  DIMENSION: 'metrics.lineage.role.dimensionRefs',
};

const NODE_W = 200;
const NODE_H = 64;
const COL_GAP = 250;
const ROW_GAP = 84;
const TOP_PAD = 14;

// M5B 节点文本按宽度预算截断（CJK 计 2 单位，其余 1 单位；超出加省略号），
// 完整名称经 <title> 悬浮与右侧详情面板可达，不越过 200px 节点矩形
const textUnits = text => String(text == null ? '' : text)
  .split('')
  .reduce((w, ch) => w + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
const truncateNodeText = (text, maxUnits) => {
  const s = String(text == null ? '' : text);
  if (textUnits(s) <= maxUnits) return s;
  let out = '';
  let units = 0;
  for (let i = 0; i < s.length; i += 1) {
    const u = s.charCodeAt(i) > 127 ? 2 : 1;
    if (units + u > maxUnits - 1) return `${out}…`;
    out += s[i];
    units += u;
  }
  return out;
};

const parseRole = (role) => {
  const prefix = 'BINDING:';
  if (role.indexOf(prefix) === 0) return role.slice(prefix.length);
  const dimPrefix = 'DIMENSION:';
  if (role.indexOf(dimPrefix) === 0) return 'DIMENSION';
  return role;
};

const LineagePage = ({source, readOnly, focus, onOpenDefinition, onOpenBindings, onOpenModel}) => {
  const [definitionId, setDefinitionId] = useState('');
  const [revisionId, setRevisionId] = useState('');
  const [direction, setDirection] = useState('both');
  const [depth, setDepth] = useState('3');
  const [projection, setProjection] = useState('compute');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [scopeDepartment, setScopeDepartment] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [includeSuggested, setIncludeSuggested] = useState(false);
  const [includeUnresolved, setIncludeUnresolved] = useState(false);
  const [includeReleased, setIncludeReleased] = useState(false);
  const [expand, setExpand] = useState({});
  const [selection, setSelection] = useState(null); // {type:'node'|'edge', id}
  const [impactTarget, setImpactTarget] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({x: 0, y: 0});
  const dragRef = useRef(null);
  const viewportRef = useRef(null);
  const [consumedNonce, setConsumedNonce] = useState(null);

  const store = useMemo(() => metricApi.readMetricPlatform(source), [source]);
  const definitions = store.definitions || [];
  const revisions = store.revisions || [];

  // 有已发布版本的定义（血缘以具体发布版本为焦点）
  const publishedDefs = useMemo(() => {
    const byDef = {};
    revisions.forEach((revision) => {
      if (revision.status !== 'published') return;
      (byDef[revision.definitionId] = byDef[revision.definitionId] || []).push(revision);
    });
    return definitions
      .filter(definition => (byDef[definition.id] || []).length > 0)
      .map(definition => ({definition, versions: byDef[definition.id]}));
  }, [definitions, revisions]);

  // focus 定位（模型面板/目录/关联页“查看血缘”）：nonce 只消费一次，手动选择优先
  const effectiveSelection = useMemo(() => {
    if (focus && focus.nonce && focus.nonce !== consumedNonce) {
      const defId = focus.definitionId;
      const hit = publishedDefs.filter(item => item.definition.id === defId)[0];
      if (hit) {
        let revId = focus.revisionId;
        if (revId == null || !hit.versions.some(v => v.id === revId)) {
          revId = hit.versions[hit.versions.length - 1].id;
        }
        return {definitionId: defId, revisionId: revId};
      }
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus && focus.nonce, focus && focus.definitionId, focus && focus.revisionId,
    consumedNonce, publishedDefs]);

  const currentDefinitionId = effectiveSelection
    ? effectiveSelection.definitionId : definitionId;
  const currentRevisionId = effectiveSelection
    ? effectiveSelection.revisionId : revisionId;
  const consumeFocus = () => {
    if (focus && focus.nonce && focus.nonce !== consumedNonce) {
      setConsumedNonce(focus.nonce);
    }
  };

  // 外部定位（nonce）优先于范围/类型筛选：定位目标被当前筛选排除时，对应筛选按
  // 全部呈现，保证定位焦点合法可见（保持合法焦点，不静默切版本、不静默清空）
  const focusDefEntry = currentDefinitionId
    ? publishedDefs.filter(item => item.definition.id === currentDefinitionId)[0] : null;
  const effectiveScopeFilter = effectiveSelection != null && focusDefEntry != null
    && !scopeMatches(focusDefEntry.definition, scopeFilter, scopeDepartment)
    ? 'all' : scopeFilter;
  const effectiveKindFilter = effectiveSelection != null && focusDefEntry != null
    && !kindMatches(focusDefEntry.definition, kindFilter)
    ? 'all' : kindFilter;

  // 焦点指标候选（按范围与类型合取筛选；版本选项与图遍历不受影响）
  const visibleDefs = useMemo(() => publishedDefs
    .filter(({definition}) => scopeMatches(definition, effectiveScopeFilter, scopeDepartment)
      && kindMatches(definition, effectiveKindFilter)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [publishedDefs, effectiveScopeFilter, scopeDepartment, effectiveKindFilter]);

  // 具体部门选项：字典部门真实命名 + 字典外手工 departmentId 兼容（不静默丢弃旧值）
  const departmentOptions = useMemo(() => {
    const dict = metricApi.readMetricDictionary(source);
    const dictDepartments = (dict.departments || []).slice();
    const knownCodes = {};
    dictDepartments.forEach((entry) => { knownCodes[entry.code] = true; });
    const legacyCodes = [];
    publishedDefs.forEach(({definition}) => {
      const scope = definition.scope == null ? null : definition.scope;
      if (scope != null && scope.kind === 'department'
        && scope.departmentId != null && scope.departmentId !== ''
        && !knownCodes[scope.departmentId]
        && legacyCodes.indexOf(scope.departmentId) < 0) {
        legacyCodes.push(scope.departmentId);
      }
    });
    legacyCodes.sort();
    return {dictDepartments, legacyCodes};
  }, [source, publishedDefs]);

  // 范围切换：保持合法焦点（固化当前焦点，不静默切版本）或明确清空（进入无焦点空态）
  const applyScopeFilter = (nextFilter, nextDepartment) => {
    consumeFocus();
    const defEntry = currentDefinitionId
      ? publishedDefs.filter(item => item.definition.id === currentDefinitionId)[0] : null;
    if (defEntry != null && scopeMatches(defEntry.definition, nextFilter, nextDepartment)) {
      setDefinitionId(currentDefinitionId);
      setRevisionId(currentRevisionId);
    } else {
      setDefinitionId('');
      setRevisionId('');
      setSelection(null);
      setExpand({});
      setPan({x: 0, y: 0});
      setZoom(1);
      setImpactTarget(null);
    }
    setScopeFilter(nextFilter);
    setScopeDepartment(nextDepartment);
  };

  // 类型切换：与范围切换同一契约——保持合法焦点（固化当前焦点，不切版本）
  // 或明确清空（进入无焦点空态）
  const applyKindFilter = (nextKind) => {
    consumeFocus();
    const defEntry = currentDefinitionId
      ? publishedDefs.filter(item => item.definition.id === currentDefinitionId)[0] : null;
    if (defEntry != null && kindMatches(defEntry.definition, nextKind)) {
      setDefinitionId(currentDefinitionId);
      setRevisionId(currentRevisionId);
    } else {
      setDefinitionId('');
      setRevisionId('');
      setSelection(null);
      setExpand({});
      setPan({x: 0, y: 0});
      setZoom(1);
      setImpactTarget(null);
    }
    setKindFilter(nextKind);
  };

  const versionOptions = useMemo(() => {
    const hit = publishedDefs.filter(item => item.definition.id === currentDefinitionId)[0];
    return hit ? hit.versions : [];
  }, [publishedDefs, currentDefinitionId]);

  const projections = projection === 'all'
    ? ['compute', 'inheritance', 'consumption', 'semantic'] : [projection];

  const graph = useMemo(() => {
    if (!currentRevisionId) return null;
    return metricApi.buildLineageGraph(source, {
      focus: {revisionId: currentRevisionId},
      direction, depth,
      projections,
      includeSuggested, includeUnresolved, includeReleased,
      expand,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, currentRevisionId, direction, depth, projection,
    includeSuggested, includeUnresolved, includeReleased, expand]);

  const layout = useMemo(() => (graph && graph.ok ? metricApi.layoutLineageColumns(graph) : null),
    [graph]);

  // 节点坐标（列内排序：名称稳定排序，焦点置顶）
  const positions = useMemo(() => {
    if (!layout) return null;
    const nodeById = {};
    graph.nodes.forEach((node) => { nodeById[node.id] = node; });
    const pos = {};
    layout.columns.forEach((columnIds, col) => {
      const sorted = columnIds.slice().sort((a, b) => {
        const na = nodeById[a];
        const nb = nodeById[b];
        if (na.focus !== nb.focus) return na.focus ? -1 : 1;
        return String(na.name).localeCompare(String(nb.name));
      });
      sorted.forEach((nodeId, index) => {
        pos[nodeId] = {x: col * COL_GAP, y: TOP_PAD + index * ROW_GAP, col};
      });
    });
    return pos;
  }, [layout, graph]);

  const graphSize = useMemo(() => {
    if (!positions) return {w: 0, h: 0};
    let w = 0;
    let h = 0;
    Object.keys(positions).forEach((id) => {
      w = Math.max(w, positions[id].x + NODE_W);
      h = Math.max(h, positions[id].y + NODE_H);
    });
    return {w: Math.max(w, 400), h: Math.max(h, 160)};
  }, [positions]);

  // 影响查询焦点（默认当前指标版本；字段/对象节点可切换为端点口径）
  const effectiveImpactTarget = impactTarget == null && currentRevisionId
    ? {kind: 'revision', revisionId: currentRevisionId} : impactTarget;
  const impact = useMemo(() => {
    if (effectiveImpactTarget == null) return null;
    if (effectiveImpactTarget.kind === 'revision') {
      return metricApi.getLineageImpact(source, {revisionId: effectiveImpactTarget.revisionId});
    }
    if (effectiveImpactTarget.kind === 'endpoint') {
      return metricApi.getLineageImpact(source, {
        collection: effectiveImpactTarget.collection,
        objectId: effectiveImpactTarget.objectId,
        ...(effectiveImpactTarget.fieldId == null ? {} : {fieldId: effectiveImpactTarget.fieldId}),
      });
    }
    return metricApi.getLineageImpact(source, {dimensionId: effectiveImpactTarget.dimensionId});
  }, [source, effectiveImpactTarget
    && (effectiveImpactTarget.kind === 'revision'
      ? effectiveImpactTarget.revisionId
      : (effectiveImpactTarget.kind === 'endpoint'
        ? `${effectiveImpactTarget.collection}/${effectiveImpactTarget.objectId}/${effectiveImpactTarget.fieldId || ''}`
        : effectiveImpactTarget.dimensionId))]);

  const nodeById = useMemo(() => {
    const map = {};
    (graph ? graph.nodes : []).forEach((node) => { map[node.id] = node; });
    return map;
  }, [graph]);

  const edgeById = useMemo(() => {
    const map = {};
    (graph ? graph.edges : []).forEach((edge) => { map[edge.id] = edge; });
    return map;
  }, [graph]);

  const nodeLabel = (node) => {
    if (node.kind === 'metric') {
      return `${node.name} @ v${node.version == null ? '?' : node.version}`;
    }
    if (node.kind === 'metricConcept') return node.name;
    const objectName = node.name;
    return node.fieldId == null ? objectName : `${objectName}.${node.fieldName || node.fieldId}`;
  };
  // 副行业务化：只保留编码/对象键，不让 UUID（版本 ID）占据节点主/副标题；
  // 版本 ID 仍在右侧详情面板“版本 ID”中提供
  const nodeSub = (node) => {
    if (node.kind === 'metric') {
      return node.code == null ? '' : String(node.code);
    }
    if (node.kind === 'metricConcept') return '';
    return `${node.objectKey}${node.fieldId == null ? '' : '.' + node.fieldId}`;
  };

  const onExpandNode = (nodeId) => {
    setExpand(pre => ({...pre, [nodeId]: (pre[nodeId] || 0) + 1}));
  };

  const centerNode = (nodeId) => {
    if (!positions || !positions[nodeId] || !viewportRef.current) return;
    const viewport = viewportRef.current;
    const vw = viewport.clientWidth || 800;
    const vh = viewport.clientHeight || 420;
    const p = positions[nodeId];
    setPan({
      x: vw / 2 - (p.x + NODE_W / 2) * zoom,
      y: vh / 2 - (p.y + NODE_H / 2) * zoom,
    });
  };

  // M5B 初始视图适配可见范围：按视口整体缩放并居中（不裁剪端点，完整落地端点
  // 可经缩放/平移/适应视图到达）；切换焦点版本时自动执行一次，此后不打断用户
  // 的手动缩放/平移
  const fitView = () => {
    if (!positions || !viewportRef.current) return;
    const viewport = viewportRef.current;
    const vw = viewport.clientWidth || 800;
    const vh = viewport.clientHeight || 420;
    const scale = Math.min(1, vw / (graphSize.w + 40), vh / (graphSize.h + 40));
    const zoomNext = Math.max(0.4, Math.round(scale * 100) / 100);
    setZoom(zoomNext);
    setPan({
      x: Math.round((vw - graphSize.w * zoomNext) / 2),
      y: Math.round((vh - graphSize.h * zoomNext) / 2),
    });
  };
  const fittedForRef = useRef(null);
  useEffect(() => {
    if (!positions || !currentRevisionId) return;
    if (fittedForRef.current === currentRevisionId) return;
    fittedForRef.current = currentRevisionId;
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, currentRevisionId]);

  const selectRevisionOf = (defId, revId) => {
    setDefinitionId(defId);
    setRevisionId(revId);
    setSelection(null);
    setExpand({});
    setPan({x: 0, y: 0});
    setZoom(1);
    setImpactTarget(null);
  };

  // ---- 渲染 ----
  const renderControls = () => <div
    className='chiner-metrics-lineage-controls'
    data-testid='metrics-lineage-controls'>
    <label>
      <span><FormatMessage id='metrics.lineage.focusDefinition'/></span>
      <select
        data-testid='metrics-lineage-def-select'
        value={currentDefinitionId}
        aria-label={FormatMessage.string({id: 'metrics.lineage.focusDefinition'})}
        onChange={(e) => {
          consumeFocus();
          const hit = publishedDefs.filter(item => item.definition.id === e.target.value)[0];
          selectRevisionOf(e.target.value,
            hit ? hit.versions[hit.versions.length - 1].id : '');
        }}>
        <option value=''>{FormatMessage.string({id: 'metrics.lineage.selectDefinition'})}</option>
        {visibleDefs.map(({definition}) => <option key={definition.id} value={definition.id}>
          {`${definition.name} · ${definition.code}`}
        </option>)}
      </select>
    </label>
    <div className='chiner-metrics-seg' role='group'
      aria-label={FormatMessage.string({id: 'metrics.lineage.scopeFilter'})}
      data-testid='metrics-lineage-scope'>
      {SCOPE_OPTIONS.map(option => <button
        key={option}
        type='button'
        className={effectiveScopeFilter === option ? 'active' : ''}
        data-testid={`metrics-lineage-scope-${option}`}
        aria-pressed={effectiveScopeFilter === option}
        onClick={() => applyScopeFilter(option,
          option === 'department' ? scopeDepartment : '')}>
        <FormatMessage id={`metrics.lineage.scope.${option}`}/>
      </button>)}
    </div>
    {effectiveScopeFilter === 'department' ? <label>
      <span><FormatMessage id='metrics.lineage.scopeDept'/></span>
      <select
        data-testid='metrics-lineage-scope-dept'
        value={scopeDepartment}
        aria-label={FormatMessage.string({id: 'metrics.lineage.scopeDept'})}
        onChange={(e) => applyScopeFilter('department', e.target.value)}>
        <option value=''>{FormatMessage.string({id: 'metrics.lineage.scopeDeptAll'})}</option>
        {departmentOptions.dictDepartments.map(dept => <option key={dept.id} value={dept.code}>
          {`${dept.name}（${dept.code}）`}
        </option>)}
        {departmentOptions.legacyCodes.map(code => <option key={`legacy-${code}`} value={code}>
          {FormatMessage.string({id: 'metrics.lineage.scopeDeptLegacy', data: {dept: code}})}
        </option>)}
      </select>
    </label> : null}
    <div className='chiner-metrics-seg' role='group'
      aria-label={FormatMessage.string({id: 'metrics.lineage.kindFilter'})}
      data-testid='metrics-lineage-kind'>
      {KIND_OPTIONS.map(option => <button
        key={option}
        type='button'
        className={effectiveKindFilter === option ? 'active' : ''}
        data-testid={`metrics-lineage-kind-${option}`}
        aria-pressed={effectiveKindFilter === option}
        onClick={() => applyKindFilter(option)}>
        <FormatMessage id={`metrics.lineage.kind.${option}`}/>
      </button>)}
    </div>
    <label>
      <span><FormatMessage id='metrics.lineage.focusVersion'/></span>
      <select
        data-testid='metrics-lineage-rev-select'
        value={currentRevisionId}
        aria-label={FormatMessage.string({id: 'metrics.lineage.focusVersion'})}
        onChange={(e) => {
          consumeFocus();
          selectRevisionOf(currentDefinitionId, e.target.value);
        }}>
        <option value=''>{FormatMessage.string({id: 'metrics.lineage.selectVersion'})}</option>
        {versionOptions.map(version => <option key={version.id} value={version.id}>
          {`v${version.version} · ${version.status}`}
        </option>)}
      </select>
    </label>
    <div className='chiner-metrics-seg' role='group'
      aria-label={FormatMessage.string({id: 'metrics.lineage.direction'})}
      data-testid='metrics-lineage-direction'>
      {DIRECTION_OPTIONS.map(option => <button
        key={option}
        type='button'
        className={direction === option ? 'active' : ''}
        data-testid={`metrics-lineage-direction-${option}`}
        onClick={() => setDirection(option)}>
        <FormatMessage id={`metrics.lineage.dir.${option}`}/>
      </button>)}
    </div>
    <label>
      <span><FormatMessage id='metrics.lineage.depth'/></span>
      <select
        data-testid='metrics-lineage-depth'
        value={depth}
        aria-label={FormatMessage.string({id: 'metrics.lineage.depth'})}
        onChange={e => setDepth(e.target.value)}>
        {DEPTH_OPTIONS.map(option => <option key={option} value={option}>
          {option === 'all'
            ? FormatMessage.string({id: 'metrics.lineage.depthAll'})
            : FormatMessage.string({id: 'metrics.lineage.depthN', data: {n: option}})}
        </option>)}
      </select>
    </label>
    <div className='chiner-metrics-seg' role='group'
      aria-label={FormatMessage.string({id: 'metrics.lineage.projection'})}
      data-testid='metrics-lineage-projection'>
      {PROJECTION_OPTIONS.map(option => <button
        key={option}
        type='button'
        className={projection === option ? 'active' : ''}
        data-testid={`metrics-lineage-projection-${option}`}
        onClick={() => setProjection(option)}>
        <FormatMessage id={`metrics.lineage.proj.${option}`}/>
      </button>)}
    </div>
    <div className='chiner-metrics-lineage-states'
      role='group'
      aria-label={FormatMessage.string({id: 'metrics.lineage.stateFilter'})}>
      <span><FormatMessage id='metrics.lineage.stateFilter'/></span>
      <label data-testid='metrics-lineage-state-suggested'>
        <input type='checkbox' checked={includeSuggested}
          onChange={e => setIncludeSuggested(e.target.checked)}/>
        <FormatMessage id='metrics.binding.state.suggested'/>
      </label>
      <label data-testid='metrics.lineage-state-unresolved'>
        <input type='checkbox' checked={includeUnresolved}
          onChange={e => setIncludeUnresolved(e.target.checked)}/>
        <FormatMessage id='metrics.binding.state.unresolved'/>
      </label>
      <label data-testid='metrics-lineage-state-released'>
        <input type='checkbox' checked={includeReleased}
          onChange={e => setIncludeReleased(e.target.checked)}/>
        <FormatMessage id='metrics.lineage.includeReleased'/>
      </label>
    </div>
    <div className='chiner-metrics-lineage-zoom'>
      <button type='button' className='chiner-metrics-btn chiner-metrics-btn-mini'
        data-testid='metrics-lineage-zoom-in'
        onClick={() => setZoom(z => Math.min(2.5, Math.round(z * 1.2 * 100) / 100))}>+</button>
      <button type='button' className='chiner-metrics-btn chiner-metrics-btn-mini'
        data-testid='metrics-lineage-zoom-out'
        onClick={() => setZoom(z => Math.max(0.4, Math.round(z / 1.2 * 100) / 100))}>−</button>
      <button type='button' className='chiner-metrics-btn chiner-metrics-btn-mini'
        data-testid='metrics-lineage-zoom-reset'
        onClick={() => { setZoom(1); setPan({x: 0, y: 0}); }}>
        <FormatMessage id='metrics.lineage.zoomReset'/>
      </button>
      <button type='button' className='chiner-metrics-btn chiner-metrics-btn-mini'
        data-testid='metrics-lineage-zoom-fit'
        onClick={() => fitView()}>
        <FormatMessage id='metrics.lineage.fitView'/>
      </button>
    </div>
    <p className='chiner-metrics-lineage-scope-note'
      data-testid='metrics-lineage-scope-note'>
      <FormatMessage id='metrics.lineage.scopeNote'/>
    </p>
  </div>;

  const renderNode = (node) => {
    const pos = positions[node.id];
    if (!pos) return null;
    const selected = selection && selection.type === 'node' && selection.id === node.id;
    const invalid = node.present === false;
    // 第三行标签也按宽度预算截断（完整信息在 <title> 悬浮与详情面板）
    const tagsText = [
      node.kind === 'metric' && node.metricKind
        ? FormatMessage.string({id: `metrics.kind.${node.metricKind}`}) : '',
      node.kind === 'metric' && node.metricKind && node.scope ? ' · ' : '',
      node.kind === 'metric' && node.scope
        ? (node.scope.kind === 'department'
          ? FormatMessage.string({id: 'metrics.scope.departmentNamed',
            data: {dept: node.scope.departmentId}})
          : FormatMessage.string({id: 'metrics.scope.public'}))
        : '',
      node.kind !== 'metric' && node.collection
        ? FormatMessage.string({id: LAYER_KEYS[node.collection]
          || 'metrics.model.physical'}) : '',
      invalid ? ' · ' + FormatMessage.string({id: 'metrics.lineage.notPresent'}) : '',
      node.inCycle ? ' · ' + FormatMessage.string({id: 'metrics.lineage.inCycle'}) : '',
    ].filter(Boolean).join('');
    const className = [
      'chiner-metrics-ln-node',
      `chiner-metrics-ln-node-${node.kind}`,
      invalid ? 'chiner-metrics-ln-node-invalid' : '',
      node.focus ? 'chiner-metrics-ln-node-focus' : '',
      selected ? 'chiner-metrics-ln-node-selected' : '',
    ].filter(Boolean).join(' ');
    const fullTitle = nodeSub(node)
      ? `${nodeLabel(node)} · ${nodeSub(node)}` : nodeLabel(node);
    return <g key={node.id} transform={`translate(${pos.x} ${pos.y})`}
      className={className}
      data-testid='metrics-lineage-node'
      data-node-id={node.id}
      data-kind={node.kind}
      data-full-title={fullTitle}
      role='button'
      tabIndex={0}
      aria-label={nodeLabel(node)}
      onClick={() => setSelection({type: 'node', id: node.id})}
      onKeyDown={e => {
        if (e.key === 'Enter') setSelection({type: 'node', id: node.id});
      }}>
      <rect width={NODE_W} height={NODE_H} rx={6}/>
      <title>{fullTitle}{tagsText ? ` · ${tagsText}` : ''}</title>
      <text x={10} y={20} className='chiner-metrics-ln-node-name'>
        {truncateNodeText(nodeLabel(node), 26)}
      </text>
      <text x={10} y={36} className='chiner-metrics-ln-node-sub'>
        {truncateNodeText(nodeSub(node), 34)}
      </text>
      <text x={10} y={52} className='chiner-metrics-ln-node-tags'>
        {truncateNodeText(tagsText, 34)}
      </text>
      {node.hasMoreUp && <g className='chiner-metrics-ln-expand'
        data-testid='metrics-lineage-node-expand-up'
        transform={`translate(-13 ${NODE_H / 2 - 11})`}
        onClick={e => { e.stopPropagation(); onExpandNode(node.id, 'up'); }}>
        <rect width={22} height={22} rx={11}/>
        <text x={11} y={15}>+</text>
        <title><FormatMessage id='metrics.lineage.expandUp'/></title>
      </g>}
      {node.hasMoreDown && <g className='chiner-metrics-ln-expand'
        data-testid='metrics-lineage-node-expand-down'
        transform={`translate(${NODE_W - 9} ${NODE_H / 2 - 11})`}
        onClick={e => { e.stopPropagation(); onExpandNode(node.id, 'down'); }}>
        <rect width={22} height={22} rx={11}/>
        <text x={11} y={15}>+</text>
        <title><FormatMessage id='metrics.lineage.expandDown'/></title>
      </g>}
    </g>;
  };

  const renderEdge = (edge) => {
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!from || !to) return null;
    const selected = selection && selection.type === 'edge' && selection.id === edge.id;
    const className = [
      'chiner-metrics-ln-edge',
      `chiner-metrics-ln-edge-${edge.kind}`,
      edge.state === 'released' ? 'chiner-metrics-ln-edge-released' : '',
      edge.invalid ? 'chiner-metrics-ln-edge-invalid' : '',
      selected ? 'chiner-metrics-ln-edge-selected' : '',
    ].filter(Boolean).join(' ');
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const mid = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
    return <g key={edge.id} className={className}
      data-testid='metrics-lineage-edge'
      data-edge-id={edge.id}
      data-kind={edge.kind}
      onClick={() => setSelection({type: 'edge', id: edge.id})}>
      <path className='chiner-metrics-ln-edge-hit' d={d}>
        <title>{FormatMessage.string({id: EDGE_KIND_KEYS[edge.kind]
          || 'metrics.lineage.edge.dependency'})}</title>
      </path>
      <path className='chiner-metrics-ln-edge-stroke' d={d}
        markerEnd={edge.kind === 'semantic' ? undefined : `url(#ln-arrow-${edge.kind})`}/>
      {edge.state === 'declared'
        ? <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6}
          className='chiner-metrics-ln-edge-label'>
          <FormatMessage id='metrics.binding.declared.tag'/>
        </text> : null}
    </g>;
  };

  const renderGraph = () => {
    if (!graph || !graph.ok || !positions) return null;
    return <div className='chiner-metrics-lineage-graph-wrap'
      data-testid='metrics-lineage-graph'>
      <div className='chiner-metrics-lineage-legend'
        data-testid='metrics-lineage-legend'>
        <span className='chiner-metrics-ln-legend-item'>
          <i className='ln-flow'/><FormatMessage id='metrics.lineage.legend.flow'/>
        </span>
        <span className='chiner-metrics-ln-legend-item'>
          <i className='ln-baseline'/><FormatMessage id='metrics.lineage.legend.baseline'/>
        </span>
        <span className='chiner-metrics-ln-legend-item'>
          <i className='ln-semantic'/><FormatMessage id='metrics.lineage.legend.semantic'/>
        </span>
        <span className='chiner-metrics-ln-legend-item'>
          <i className='ln-consumption'/><FormatMessage id='metrics.lineage.legend.consumption'/>
        </span>
        <span className='chiner-metrics-ln-legend-item'>
          <i className='ln-declared'/><FormatMessage id='metrics.lineage.legend.declared'/>
        </span>
        <span className='chiner-metrics-ln-legend-item'>
          <i className='ln-invalid'/><FormatMessage id='metrics.lineage.legend.invalid'/>
        </span>
        {graph.cycles.length > 0 ? <span
          className='chiner-metrics-ln-legend-item chiner-metrics-ln-legend-cycle'
          data-testid='metrics-lineage-cycle-note'>
          <FormatMessage id='metrics.lineage.legend.cycle'
            data={{count: graph.cycles.length}}/>
        </span> : null}
      </div>
      <div
        className='chiner-metrics-lineage-viewport'
        ref={viewportRef}
        data-testid='metrics-lineage-viewport'
        onMouseDown={(e) => {
          dragRef.current = {x: e.clientX, y: e.clientY, pan};
        }}
        onMouseMove={(e) => {
          if (!dragRef.current) return;
          setPan({
            x: dragRef.current.pan.x + (e.clientX - dragRef.current.x),
            y: dragRef.current.pan.y + (e.clientY - dragRef.current.y),
          });
        }}
        onMouseUp={() => { dragRef.current = null; }}
        onMouseLeave={() => { dragRef.current = null; }}
        onWheel={(e) => {
          setZoom(z => Math.max(0.4, Math.min(2.5,
            Math.round(z * (e.deltaY < 0 ? 1.1 : 0.9) * 100) / 100)));
        }}>
        <svg
          width={Math.round(graphSize.w * zoom)}
          height={Math.round(graphSize.h * zoom)}
          viewBox={`0 0 ${graphSize.w} ${graphSize.h}`}
          style={{overflow: 'visible'}}
          data-testid='metrics-lineage-svg'
          role='img'
          aria-label={FormatMessage.string({id: 'metrics.lineage.graphAria'})}>
          <defs>
            {['compute-source', 'declared-source', 'dependency', 'materialization',
              'consumption', 'baseline'].map(kind => <marker
                key={kind}
                id={`ln-arrow-${kind}`}
                viewBox='0 0 10 10'
                refX={9}
                refY={5}
                markerWidth={7}
                markerHeight={7}
                orient='auto-start-reverse'>
                <path d='M 0 1 L 9 5 L 0 9 z'/>
              </marker>)}
          </defs>
          {/* M5B-R1 变换单次化：缩放只经 svg width/viewBox（graphSize*zoom ↔ graphSize）
              应用一次；g 仅平移（pan 存屏幕像素，除以 zoom 换回 viewBox 单位），
              节点实际尺寸 = NODE_W*zoom，拖拽与鼠标像素一致（不再双重缩放）。
              svg 自身 overflow:visible——fitView 按更大的外部 viewport 居中时，
              内容可越出 svg 元素自身边界，统一由外层 viewport 裁剪（svg 不预裁剪） */}
          <g transform={`translate(${pan.x / zoom} ${pan.y / zoom})`}>
            {graph.edges.map(renderEdge)}
            {graph.nodes.map(renderNode)}
          </g>
        </svg>
      </div>
    </div>;
  };

  const selectedNode = selection && selection.type === 'node' ? nodeById[selection.id] : null;
  const selectedEdge = selection && selection.type === 'edge' ? edgeById[selection.id] : null;

  const renderNodeDetail = (node) => {
    const ref = node.kind === 'field' || node.kind === 'object'
      ? {collection: node.collection, objectId: node.objectId,
        ...(node.fieldId == null ? {} : {fieldId: node.fieldId})}
      : null;
    return <div className='chiner-metrics-lineage-detail-body'
      data-testid='metrics-lineage-node-detail'
      data-node-id={node.id}>
      <h4 data-testid='metrics-lineage-detail-title'>{nodeLabel(node)}</h4>
      <p className='chiner-metrics-ln-detail-sub'>{nodeSub(node)}</p>
      {node.kind === 'metric' ? <>
        {node.metricKind ? renderKindBadge(node.metricKind) : null}
        {node.scope ? renderScopeBadge(node.scope) : null}
        {node.status ? renderStatusBadge(node.status) : null}
        {node.designOnly ? <span className='chiner-metrics-tag chiner-metrics-tag-warn'>
          <FormatMessage id='metrics.view.designOnly'/>
        </span> : null}
        {node.inCycle ? <span className='chiner-metrics-tag chiner-metrics-tag-warn'
          data-testid='metrics-lineage-detail-cycle'>
          <FormatMessage id='metrics.lineage.inCycle'/>
        </span> : null}
        <p className='chiner-metrics-ln-detail-line'>
          <FormatMessage id='metrics.lineage.detail.revision'/>
          <code>{node.revisionId}</code>
        </p>
      </> : null}
      {ref ? <p className='chiner-metrics-ln-detail-line'>
        <FormatMessage id={LAYER_KEYS[ref.collection] || 'metrics.model.physical'}/>
        <code>{`${ref.objectId}${ref.fieldId == null ? '' : '.' + ref.fieldId}`}</code>
      </p> : null}
      {node.present === false ? <p
        className='chiner-metrics-ln-detail-invalid'
        data-testid='metrics-lineage-detail-invalid'>
        <FormatMessage id='metrics.lineage.notPresent'/>
      </p> : null}
      <div className='chiner-metrics-ln-detail-actions'>
        <button type='button' className='chiner-metrics-btn chiner-metrics-btn-mini'
          data-testid='metrics-lineage-locate'
          onClick={() => centerNode(node.id)}>
          <FormatMessage id='metrics.lineage.locate'/>
        </button>
        {node.kind === 'metric' && node.definitionId && onOpenDefinition ? <button
          type='button' className='chiner-metrics-btn chiner-metrics-btn-mini'
          data-testid='metrics-lineage-open-definition'
          onClick={() => onOpenDefinition(node.definitionId, 'view', null, node.revisionId)}>
          <FormatMessage id='metrics.binding.openDefinition'/>
        </button> : null}
        {node.kind === 'metric' && onOpenBindings ? <button
          type='button' className='chiner-metrics-btn chiner-metrics-btn-mini'
          data-testid='metrics-lineage-open-bindings'
          onClick={() => onOpenBindings(node.definitionId, node.revisionId)}>
          <FormatMessage id='metrics.lineage.openBindings'/>
        </button> : null}
        {ref && node.present && onOpenModel ? <button
          type='button' className='chiner-metrics-btn chiner-metrics-btn-mini'
          data-testid='metrics-lineage-open-model'
          onClick={() => onOpenModel({
            collection: ref.collection,
            objectId: ref.objectId,
            fieldDefKey: node.kind === 'field' ? (node.fieldName || null) : null,
          })}>
          <FormatMessage id='metrics.binding.openModel'/>
        </button> : null}
        {ref ? <button
          type='button' className='chiner-metrics-btn chiner-metrics-btn-mini'
          data-testid='metrics-lineage-impact-endpoint'
          onClick={() => setImpactTarget({
            kind: 'endpoint', collection: ref.collection,
            objectId: ref.objectId, ...(ref.fieldId == null ? {} : {fieldId: ref.fieldId}),
          })}>
          <FormatMessage id='metrics.lineage.impactFromHere'/>
        </button> : null}
        {node.kind === 'metric' ? <button
          type='button' className='chiner-metrics-btn chiner-metrics-btn-mini'
          data-testid='metrics-lineage-impact-revision'
          onClick={() => setImpactTarget({kind: 'revision', revisionId: node.revisionId})}>
          <FormatMessage id='metrics.lineage.impactFromHere'/>
        </button> : null}
      </div>
    </div>;
  };

  const renderEdgeDetail = (edge) => {
    const from = nodeById[edge.from];
    const to = nodeById[edge.to];
    return <div className='chiner-metrics-lineage-detail-body'
      data-testid='metrics-lineage-edge-detail'
      data-edge-id={edge.id}>
      <h4 data-testid='metrics-lineage-detail-title'>
        <FormatMessage id={EDGE_KIND_KEYS[edge.kind] || 'metrics.lineage.edge.dependency'}/>
      </h4>
      <p className='chiner-metrics-ln-detail-path'>
        <span>{from ? nodeLabel(from) : edge.from}</span>
        <i aria-hidden='true'>
          {edge.kind === 'semantic' ? '↔' : ' → '}
        </i>
        <span>{to ? nodeLabel(to) : edge.to}</span>
      </p>
      {edge.kind === 'semantic' ? <p className='chiner-metrics-ln-detail-note'>
        <FormatMessage id='metrics.lineage.semanticNoDirection'/>
      </p> : null}
      <p className='chiner-metrics-ln-detail-line'>
        {edge.state === 'declared'
          ? <span className='chiner-metrics-tag chiner-metrics-binding-role-DECLARED'>
            <FormatMessage id='metrics.binding.declared.tag'/>
          </span>
          : renderBindingStateTag(edge.state)}
        {edge.role ? <span className='chiner-metrics-ln-role'>
          <FormatMessage id={ROLE_KEYS[edge.role] || 'metrics.lineage.role.operand'}/>
        </span> : null}
        {edge.refKey ? <code>{edge.refKey}</code> : null}
      </p>
      {edge.expression ? <p className='chiner-metrics-ln-detail-line'>
        <FormatMessage id='metrics.lineage.detail.expression'/>
        <code>{edge.expression}</code>
      </p> : null}
      {edge.usage ? <p className='chiner-metrics-ln-detail-line'>
        <FormatMessage id='metrics.lineage.detail.usage'/>
        <span>{edge.usage}</span>
      </p> : null}
      {edge.evidence ? <p className='chiner-metrics-ln-detail-line'>
        <FormatMessage id='metrics.lineage.detail.evidence'/>
        <span>{edge.evidence.kind}</span>
        {edge.evidence.confirmedBy ? <code>{edge.evidence.confirmedBy}</code> : null}
        {edge.evidence.note ? <span title={edge.evidence.note}>{edge.evidence.note}</span> : null}
      </p> : null}
      {edge.confirmedAt ? <p className='chiner-metrics-ln-detail-line'>
        <FormatMessage id='metrics.lineage.detail.confirmedAt'/>
        <code>{String(edge.confirmedAt)}</code>
      </p> : null}
      {edge.invalid ? <p className='chiner-metrics-ln-detail-invalid'
        data-testid='metrics-lineage-detail-invalid'>
        <FormatMessage id='metrics.lineage.edgeInvalid'/>
        {edge.unresolvedReason ? <code>{edge.unresolvedReason}</code> : null}
        {edge.snapshot && (edge.snapshot.objectName || edge.snapshot.objectKey)
          ? <span className='chiner-metrics-ln-snapshot'>
            <FormatMessage id='metrics.binding.endpointSnapshot'/>
            {`${edge.snapshot.objectName || edge.snapshot.objectKey}${edge.snapshot.fieldKey
              ? '.' + edge.snapshot.fieldKey : ''}`}
          </span> : null}
      </p> : null}
      {edge.state === 'released' ? <p className='chiner-metrics-ln-detail-note'>
        <FormatMessage id='metrics.lineage.releasedNote'/>
        {edge.releaseReason ? <code>{edge.releaseReason}</code> : null}
      </p> : null}
      {edge.state === 'suggested' ? <p className='chiner-metrics-ln-detail-note'>
        <FormatMessage id='metrics.lineage.suggestedNote'/>
      </p> : null}
      {edge.designOnly ? <p className='chiner-metrics-ln-detail-note'>
        <FormatMessage id='metrics.binding.declared.designOnly'/>
      </p> : null}
      {graph && edge.kind === 'materialization' && edge.from.indexOf('m:') === 0
        && graph.cycles.some(path => path.indexOf(edge.from.slice(2)) >= 0) ? <p
          className='chiner-metrics-ln-detail-invalid'
          data-testid='metrics-lineage-detail-cycle'>
          <FormatMessage id='metrics.lineage.inCycle'/>
        </p> : null}
    </div>;
  };

  const renderImpact = () => {
    if (!impact || !impact.ok) return null;
    const focusLabel = impact.focus.kind === 'revision'
      ? (nodeById[`m:${impact.focus.revisionId}`]
        ? nodeLabel(nodeById[`m:${impact.focus.revisionId}`])
        : impact.focus.revisionId)
      : (impact.focus.kind === 'endpoint'
        ? `${impact.focus.objectId}${impact.focus.fieldId == null ? '' : '.' + impact.focus.fieldId}`
        : impact.focus.dimensionId);
    return <section className='chiner-metrics-lineage-impact'
      data-testid='metrics-lineage-impact'
      data-impact-kind={impact.focus.kind}>
      <header>
        <h3><FormatMessage id='metrics.lineage.impact.title'/></h3>
        <span className='chiner-metrics-tag' data-testid='metrics-lineage-impact-focus'>
          {focusLabel}
        </span>
        <span data-testid='metrics-lineage-impact-stats'>
          <FormatMessage id='metrics.lineage.impact.stats'
            data={{direct: impact.stats.directCount,
              transitive: impact.stats.transitiveCount,
              endpoints: impact.stats.endpointCount,
              baseline: impact.stats.baselineNotifyCount}}/>
        </span>
      </header>
      <div className='chiner-metrics-lineage-impact-cols'>
        <div className='chiner-metrics-lineage-impact-col'
          data-testid='metrics-lineage-impact-direct'>
          <h4><FormatMessage id='metrics.lineage.impact.direct'/></h4>
          {impact.direct.metrics.length === 0 ? <p
            className='chiner-metrics-binding-group-empty'>
            <FormatMessage id='metrics.lineage.impact.none'/>
          </p> : impact.direct.metrics.map(entry => <div
            key={entry.revisionId}
            className='chiner-metrics-lineage-impact-row'
            data-testid='metrics-lineage-impact-direct-row'
            data-revision-id={entry.revisionId}>
            <div>
              <strong>{entry.name}</strong>
              <code>v{entry.version}</code>
              {(entry.roles || []).map((role, i) => <span
                key={i}
                className='chiner-metrics-ln-role'>
                {renderRoleTag(parseRole(role))}
              </span>)}
            </div>
            {onOpenDefinition && entry.definitionId ? <button
              type='button'
              className='chiner-metrics-btn chiner-metrics-btn-mini'
              onClick={() => onOpenDefinition(entry.definitionId, 'view', null, entry.revisionId)}>
              <FormatMessage id='metrics.binding.openDefinition'/>
            </button> : null}
          </div>)}
          {impact.dictionaryQualifiers && impact.dictionaryQualifiers.length > 0 ? <p
            className='chiner-metrics-ln-detail-note'
            data-testid='metrics-lineage-impact-dict'>
            <FormatMessage id='metrics.lineage.impact.dictQualifiers'
              data={{count: impact.dictionaryQualifiers.length}}/>
            {impact.dictionaryQualifiers.map(q => q.code).join(', ')}
          </p> : null}
        </div>
        <div className='chiner-metrics-lineage-impact-col'
          data-testid='metrics-lineage-impact-transitive'>
          <h4><FormatMessage id='metrics.lineage.impact.transitive'/></h4>
          {impact.transitive.metrics.length === 0 ? <p
            className='chiner-metrics-binding-group-empty'>
            <FormatMessage id='metrics.lineage.impact.none'/>
          </p> : impact.transitive.metrics.map(entry => <div
            key={entry.revisionId}
            className='chiner-metrics-lineage-impact-row'
            data-testid='metrics-lineage-impact-transitive-row'
            data-revision-id={entry.revisionId}>
            <div>
              <strong>{entry.name}</strong>
              <code>v{entry.version}</code>
              <span className='chiner-metrics-ln-path'
                title={(entry.path || []).join(' → ')}>
                <FormatMessage id='metrics.lineage.impact.path'
                  data={{count: (entry.path || []).length - 1}}/>
              </span>
            </div>
            {onOpenDefinition && entry.definitionId ? <button
              type='button'
              className='chiner-metrics-btn chiner-metrics-btn-mini'
              onClick={() => onOpenDefinition(entry.definitionId, 'view', null, entry.revisionId)}>
              <FormatMessage id='metrics.binding.openDefinition'/>
            </button> : null}
          </div>)}
        </div>
      </div>
      <ul className='chiner-metrics-lineage-caliber'
        data-testid='metrics-lineage-impact-caliber'>
        {impact.notes.map((note, index) => <li key={index}>
          <FormatMessage id={note.messageKey}/>
        </li>)}
        <li><FormatMessage id='metrics.lineage.impact.dedup'/></li>
      </ul>
    </section>;
  };

  return <section className='chiner-metrics-page chiner-metrics-lineage-page'
    data-testid='metrics-lineage-page'>
    <header className='chiner-metrics-page-header'>
      <div>
        <h2 data-testid='metrics-lineage-title'>
          <FormatMessage id='metrics.lineage.title'/>
        </h2>
        <p className='chiner-metrics-page-sub'>
          <FormatMessage id='metrics.lineage.subtitle'/>
        </p>
      </div>
    </header>

    {publishedDefs.length === 0 ? <div className='chiner-metrics-empty'
      data-testid='metrics-lineage-empty'>
      <h3><FormatMessage id='metrics.lineage.emptyTitle'/></h3>
      <p><FormatMessage id='metrics.lineage.emptyDesc'/></p>
    </div> : <>
      {renderControls()}
      {!currentRevisionId ? <div className='chiner-metrics-empty'
        data-testid='metrics-lineage-no-focus'>
        <h3><FormatMessage id='metrics.lineage.noFocusTitle'/></h3>
        <p><FormatMessage id='metrics.lineage.noFocusDesc'/></p>
      </div> : <>
        <div className='chiner-metrics-lineage-main'>
          <div className='chiner-metrics-lineage-graph-area'>
            {graph && graph.ok && graph.edges.length === 0
              && graph.nodes.length <= 1 ? <div className='chiner-metrics-empty'
                data-testid='metrics-lineage-no-relations'>
              <h3><FormatMessage id='metrics.lineage.noRelationsTitle'/></h3>
              <p><FormatMessage id='metrics.lineage.noRelationsDesc'/></p>
            </div> : renderGraph()}
          </div>
          <aside className='chiner-metrics-lineage-detail'
            data-testid='metrics-lineage-detail'>
            <h3><FormatMessage id='metrics.lineage.detail.title'/></h3>
            {selectedNode ? renderNodeDetail(selectedNode)
              : selectedEdge ? renderEdgeDetail(selectedEdge)
                : <p className='chiner-metrics-binding-group-empty'>
                  <FormatMessage id='metrics.lineage.detail.empty'/>
                </p>}
          </aside>
        </div>
        {renderImpact()}
      </>}
    </>}
  </section>;
};

export default React.memo(LineagePage);
