// 由“当前有效数据”（已保存模型 + 未保存图草稿合并后的 searchSource，即
// main/index.js getSearchDataSource 的返回值）计算实体被哪些关系图引用。
// cells 与搜索反查同源：getSearchDataSource 已将图草稿的 canvasData.cells
// 合并为 {id, shape, originKey} 列表，这里仅做呈现层聚合，不改任何模型数据。
export const calcEntityReferences = (entityId, searchSource) => {
  if (!entityId || !searchSource) {
    return [];
  }
  const diagrams = searchSource.diagrams || [];
  const references = [];
  diagrams.forEach((d) => {
    const cells = (d.canvasData?.cells) || [];
    const hit = cells.find(c => c.shape === 'table' && c.originKey === entityId);
    if (hit) {
      // 同一图多次引用该实体时按图去重，定位取首个匹配 cell
      references.push({
        id: d.id,
        defKey: d.defKey,
        defName: d.defName,
        cellId: hit.id,
      });
    }
  });
  return references;
};

export default calcEntityReferences;

// 上下文面板目标解析（纯函数）：
// 1) 图内选中仅在“该图仍是当前激活页签”时采信（背景图残留选择不覆盖后来打开的对象）；
// 2) 对象数据优先读该对象页签的未保存草稿（有效数据），回退已保存 dataSource；
// 3) 清空选择 / 非属性型页签（关系图等）→ 回退页签对象或空态。
const TAB_COLLECTIONS = {
  conceptEntity: 'conceptEntities',
  entity: 'entities',
  logicEntity: 'logicEntities',
  view: 'views',
  dict: 'dicts',
};
const findDraftData = (tabs, getTabData, type, menuKey) => {
  const t = (tabs || []).filter(x => x.type === type && x.menuKey === menuKey)[0];
  if (!t) {
    return null;
  }
  const tabData = getTabData ? getTabData(t.tabKey) : null;
  return (tabData && tabData.data && tabData.isInit === false) ? tabData.data : null;
};
// 直接关联表计算（纯函数）。
// 输入 snapshot 为 main/index.js getDiagramEdgeSnapshot 的最小局部有效图快照：
//   tables: 表稳定ID -> 有效表数据（已合并对象页签未保存草稿，改名即时生效）
//   diagrams: [{id, defKey, defName, cells}]（已合并图页签未保存草稿，连线增删/撤销即时生效）
// 语义：仅统计 shape==='erdRelation' 且两端 cellId 均解析为有效表节点（shape==='table'
// 且 originKey 在 tables 中）的直接邻接；同图共现、箭头样式、名称相似性不推断关联。
// 按表稳定 ID 去重并保留全部来源图；多图/多边重复不重复计表；重复节点保留首个定位节点；
// 自关联单独返回不算另一张表；分组/装饰线(edit-node*)/悬空边/已删除对象自然被忽略。
export const calcTableAssociations = (tableId, snapshot) => {
  const empty = {count: 0, tables: [], self: []};
  if (!tableId || !snapshot) {
    return empty;
  }
  const validTables = snapshot.tables || {};
  const result = new Map(); // 表ID -> {id, defKey, defName, type, sources: Map(图ID -> source)}
  const selfSources = new Map(); // 图ID -> source（自关联）
  const addSource = (map, diagram, cellId) => {
    const source = {id: diagram.id, defKey: diagram.defKey, defName: diagram.defName, cellId};
    const exist = map.get(diagram.id);
    if (!exist || (!exist.cellId && cellId)) {
      map.set(diagram.id, source);
    }
  };
  (snapshot.diagrams || []).forEach((diagram) => {
    const cells = diagram.cells || [];
    // 同图内有效表节点：cellId -> 表ID（重复节点取首个，用于定位）
    const nodeByCell = new Map();
    cells.forEach((c) => {
      if (c.shape === 'table' && c.originKey && validTables[c.originKey]
          && !nodeByCell.has(c.id)) {
        nodeByCell.set(c.id, c.originKey);
      }
    });
    cells.forEach((c) => {
      if (c.shape !== 'erdRelation') {
        return;
      }
      const sourceId = nodeByCell.get(c.source?.cell);
      const targetId = nodeByCell.get(c.target?.cell);
      if (!sourceId || !targetId) {
        return; // 悬空端点：端点不是有效表节点（分组/装饰/删除对象）
      }
      // 每条边两向各判一次：mine=当前表端，other=对端表；定位节点取对端 cellId
      [[sourceId, targetId, c.target?.cell], [targetId, sourceId, c.source?.cell]]
        .forEach(([mine, other, otherCellId]) => {
          if (mine !== tableId) {
            return;
          }
          if (other === tableId) {
            addSource(selfSources, diagram, otherCellId);
            return;
          }
          if (!result.has(other)) {
            const t = validTables[other];
            result.set(other, {
              id: other,
              defKey: t.defKey,
              defName: t.defName || t.defKey,
              type: t.type,
              sources: new Map(),
            });
          }
          addSource(result.get(other).sources, diagram, otherCellId);
        });
    });
  });
  return {
    count: result.size,
    tables: Array.from(result.values())
      .map(t => ({...t, sources: Array.from(t.sources.values())})),
    self: Array.from(selfSources.values()),
  };
};

export const resolveInspectorTarget = ({selection, activeTab, tabs, getTabData, dataSource}) => {
  if (selection?.originKey && activeTab?.type === 'diagram'
      && activeTab.tabKey === selection.tabKey) {
    const type = Object.keys(TAB_COLLECTIONS).find(key =>
      (dataSource?.[TAB_COLLECTIONS[key]] || []).some(e => e.id === selection.originKey));
    if (type) {
      const data = findDraftData(tabs, getTabData, type, selection.originKey)
        || dataSource[TAB_COLLECTIONS[type]].find(e => e.id === selection.originKey);
      return {type, data, fromSelection: true};
    }
  }
  const tab = activeTab;
  if (!tab) {
    return null;
  }
  const collection = TAB_COLLECTIONS[tab.type];
  if (!collection) {
    return null;
  }
  const draft = findDraftData(tabs, getTabData, tab.type, tab.menuKey);
  const data = draft
    || (dataSource?.[collection] || []).filter(e => e.id === tab.menuKey)[0];
  return data ? {type: tab.type, data, fromSelection: false} : null;
};
