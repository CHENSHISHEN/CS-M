// S3 资源总览纯函数层：全部计数来自传入的当前有效模型（合并草稿后的搜索快照），
// 只读不写、不产生第二份模型状态；不编造健康分/趋势等派生指标。
// 版本统计走 lib/json.js:getAllVersionFile（可选严格错误参数，仅本模块启用）。
import {getAllVersionFile} from './json';
import {
  inferDiagramLevel, getCatalogCategories, readCatalog, categoryObjects,
  physicalDbSupports, readPhysicalDatabases, groupPhysicalObjects,
} from './model_catalog';
import {conceptLinkedLogicStats} from './concept_logical_links';

const ENTITY_LEVEL_COLLECTIONS = [
  {level: 'conceptual', collection: 'conceptEntities', type: 'conceptEntity'},
  {level: 'logical', collection: 'logicEntities', type: 'logicEntity'},
  {level: 'physical', collection: 'entities', type: 'entity'},
];

// S3 修订：同一集合内按 id 去重（脏树/导入造成的重复挂接不得重复计数）；
// 无 id 的条目（异常数据）按独立对象保留，不吞掉
export const dedupeById = (arr) => {
  const seen = new Set();
  return (arr || []).filter((o) => {
    if (!o || o.id == null) return true;
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });
};

// 真实模型/关系图/标准/规则统计（对象口径与目录/搜索一致）。
// 总模型数 = 概念/逻辑/物理三个命名空间各自 ID 去重后之和；
// 分层计数、图、规则、标准字段及下钻列表同样按唯一 ID 去重。
export const collectOverviewStats = (source) => {
  const levelCounts = {};
  ENTITY_LEVEL_COLLECTIONS.forEach((item) => {
    levelCounts[item.level] = dedupeById(source?.[item.collection]).length;
  });
  // 图先整体去重，分层/未分类计数基于去重后列表
  const diagrams = dedupeById(source?.diagrams);
  const diagramByLevel = (level) => diagrams
    .filter((d) => inferDiagramLevel(d, source) === level);
  const rules = dedupeById(source?.namingRules);
  // 标准字段跨分组去重（同一字段被多分组收录只计一次）
  const standardFields = dedupeById((source?.standardFields || [])
    .reduce((all, group) => all.concat(group?.fields || []), []));
  return {
    models: {
      total: levelCounts.conceptual + levelCounts.logical + levelCounts.physical,
      conceptual: levelCounts.conceptual,
      logical: levelCounts.logical,
      physical: levelCounts.physical,
    },
    diagrams: {
      total: diagrams.length,
      conceptual: diagramByLevel('conceptual').length,
      logical: diagramByLevel('logical').length,
      physical: diagramByLevel('physical').length,
      unclassified: diagrams
        .filter((d) => !inferDiagramLevel(d, source)).length,
    },
    standards: {
      groups: dedupeById(source?.standardFields).length,
      fields: standardFields.length,
      wordRoots: (source?.profile?.fieldRecommendation?.wordRoots || []).length,
    },
    // 数据域/字典/视图分别列出（各自按唯一 ID 计数）
    domains: dedupeById(getCatalogCategories(source)).length,
    layers: readCatalog(source).layers.length,
    dicts: dedupeById(source?.dicts).length,
    views: dedupeById(source?.views).length,
    // 规则：配置数与启用数区分（启用 = enable 为真）
    rules: {
      configured: rules.length,
      enabled: rules.filter((r) => r.enable).length,
    },
  };
};

// 指标下钻列表（模型/关系图给可打开对象列表；标准/规则/版本由界面进入对应模块）。
// 去重仅发生在同一集合内部（key = collection:id）：同名/同 id 对象在不同命名空间
// 是各自独立的条目，跨命名空间不得互相吞并
export const overviewDrillItems = (source, metricKey) => {
  if (metricKey === 'models') {
    return ENTITY_LEVEL_COLLECTIONS.reduce((all, item) => all
      .concat(dedupeById(source?.[item.collection])
        .map((o) => ({
          id: o.id,
          type: item.type,
          collection: item.collection,
          level: item.level,
          defKey: o.defKey,
          defName: o.defName,
          raw: o,
        }))), []);
  }
  if (metricKey === 'diagrams') {
    return dedupeById(source?.diagrams).map((d) => ({
      id: d.id,
      type: 'diagram',
      collection: 'diagrams',
      level: inferDiagramLevel(d, source),
      defKey: d.defKey,
      defName: d.defName,
      raw: d,
    }));
  }
  return [];
};

// ---- S3整改2：总览新增投影（公开字段，供 Codex 复核） ----

// 概念-逻辑覆盖：分子=至少一条有效边触碰的唯一逻辑实体数，分母=唯一逻辑实体数，
// 另列失效边待处理数（复用关联合同 helper，不另起口径）
export const overviewLinkCoverage = (source) => conceptLinkedLogicStats(source);

// 数仓分层分布：每分层 = 其下分类成员的唯一物理实体 ID 并集；
// 跨层重复归属在各自分层分别计入（同一对象多域归属不跨层去重，界面明示口径）；
// 未挂分层 = 无分层分类成员 + 完全未归类物理实体的去重并集
export const overviewLayerDistribution = (source) => {
  const catalog = readCatalog(source);
  const categories = getCatalogCategories(source);
  const mounted = new Set(catalog.layers.map(l => l.id));
  const memberIds = (c) => {
    const ids = new Set();
    (categoryObjects(source, c).entity || [])
      .forEach(o => { if (o && o.id != null) ids.add(o.id); });
    return ids;
  };
  const layers = catalog.layers.map(layer => {
    const ids = new Set();
    categories.filter(c => c.layerId === layer.id)
      .forEach(c => memberIds(c).forEach(id => ids.add(id)));
    return {
      layerId: layer.id,
      defKey: layer.defKey,
      defName: layer.defName,
      count: ids.size,
    };
  });
  const assigned = new Set();
  categories.filter(c => mounted.has(c.layerId))
    .forEach(c => memberIds(c).forEach(id => assigned.add(id)));
  const unassigned = new Set();
  categories.filter(c => !mounted.has(c.layerId))
    .forEach(c => memberIds(c).forEach(id => {
      if (!assigned.has(id)) unassigned.add(id);
    }));
  (source?.entities || []).forEach(e => {
    if (e && e.id != null && !assigned.has(e.id)) unassigned.add(e.id);
  });
  return {layers, unassigned: unassigned.size};
};

// 物理模型库/类型分布：全部物理表按归属分桶（具名库容器 / 兼容类型 physicalDbTypeId /
// 未指定 / 失效归属归未知回收）。assignedTotal 仅是具名库容器中的表数，不能代表整个
// 分布为空；判空与主计数使用 total（全部桶之和，即真实物理表总量）。
// types 行 key：有效类型 id / '__unspecified' / '__unknown'（名称由界面按 lang 渲染）
export const overviewDatabaseDistribution = (source) => {
  const supports = physicalDbSupports(source);
  const validType = new Set(supports.map(s => s.id));
  const nameById = new Map(supports.map(s => [s.id, s.defName || s.defKey]));
  const grouped = groupPhysicalObjects(source, {entity: source?.entities || [], diagram: []});
  const databases = readPhysicalDatabases(source)
    .map(database => ({
      databaseId: database.id,
      defKey: database.defKey,
      defName: database.defName,
      dbTypeId: database.dbTypeId,
      count: (grouped.databases.find(b => b.database.id === database.id)?.entities || []).length,
    }))
    .filter(d => d.count > 0)
    .sort((a, b) => b.count - a.count);
  const assignedTotal = databases.reduce((n, d) => n + d.count, 0);
  const buckets = new Map();
  const bump = (key, name, count) => {
    const row = buckets.get(key) || {key, name, count: 0};
    row.count += count;
    buckets.set(key, row);
  };
  databases.forEach(d => bump(
    validType.has(d.dbTypeId) ? d.dbTypeId : '__unknown',
    validType.has(d.dbTypeId) ? nameById.get(d.dbTypeId) : null, d.count));
  grouped.compatGroups.forEach(g => bump(g.key, g.name, g.entities.length));
  if (grouped.hasUnspecified) bump('__unspecified', null, grouped.unspecified.entities.length);
  if (grouped.hasUnknown) bump('__unknown', null, grouped.unknown.entities.length);
  const types = [...buckets.values()].sort((a, b) => b.count - a.count);
  return {
    // S3整改：真实物理表总量 = 全部类型桶之和（含兼容类型/未指定/未知回收），
    // 界面据此判空与作主计数；assignedTotal 单列真实展示（可为 0）
    total: types.reduce((n, x) => n + x.count, 0),
    assignedTotal,
    databases,
    types,
  };
};

// 版本统计：strictError=true 时读取失败 reject（区分“零版本”与“失败”）。
// 未保存项目（无路径）返回 unavailable，不冒充零版本也不算失败。
// projectInfo 实际是字符串路径（actions/core info:path）；兼容可选 {path} 对象。
export const readVersionStats = (projectInfo, dataSource) => {
  const path = typeof projectInfo === 'string' ? projectInfo : projectInfo?.path;
  const name = dataSource?.name;
  if (!path || !name) {
    return Promise.resolve({status: 'unavailable'});
  }
  return getAllVersionFile(path, {name}, true)
    .then((files) => ({status: 'ok', count: (files || []).length}))
    .catch((err) => ({status: 'error', message: err?.message || String(err)}));
};
