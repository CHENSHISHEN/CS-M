/**
 * DATA-WB-FEAT-003 / S3 企业首页直接编辑画布 —— 纯函数层
 *
 * 公共合同（S3-IMPLEMENTATION.md）：
 *   profile.enterpriseModeling.homeCanvas = {schemaVersion:1, nodes:[], edges:[]}
 *   节点 {id,kind,x,y,width,height,text?,diagramId?,parentId?}，kind ∈ rect/text/group/diagram
 *   边   {id,source,target,label?}
 *
 * 约束：本文件零 import（node 断言直接加载）；读取回落、不写默认示例；
 * 写入只替换 homeCanvas，保留 enterpriseModeling 其他元数据（名称/介绍/概览pin/旧封面）。
 */

export const HOME_CANVAS_MIME = 'application/x-pdman-enterprise-home';
export const HOME_CANVAS_SCHEMA_VERSION = 1;
export const HOME_NODE_KINDS = ['rect', 'text', 'group', 'diagram'];

// 画布节点的默认几何（新增时的兜底，非强制）
export const HOME_NODE_DEFAULTS = {
  rect: {width: 160, height: 64, text: ''},
  text: {width: 140, height: 36, text: ''},
  group: {width: 360, height: 240, text: ''},
  diagram: {width: 240, height: 150},
};

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v) => (typeof v === 'string' ? v : undefined);

/**
 * 规范化 homeCanvas：
 * - 丢弃缺 id/非法 kind/重复 id 的节点；
 * - 数值字段回落默认，字符串可选字段仅接受 string；
 * - 丢弃端点（source/target）指向不存在节点的悬挂边（坏引用不可渲染）；
 * - parentId 指向不存在节点时删除该字段、保留节点（diagramId 坏引用保留，由画布以失效态展示）。
 */
export const normalizeHomeCanvas = (raw) => {
  const nodes = [];
  const ids = new Set();
  (Array.isArray(raw?.nodes) ? raw.nodes : []).forEach((n) => {
    if (!n || typeof n.id !== 'string' || !HOME_NODE_KINDS.includes(n.kind)) return;
    const defaults = HOME_NODE_DEFAULTS[n.kind] || HOME_NODE_DEFAULTS.rect;
    const node = {
      id: n.id,
      kind: n.kind,
      x: num(n.x, 0),
      y: num(n.y, 0),
      width: Math.max(num(n.width, defaults.width), 4),
      height: Math.max(num(n.height, defaults.height), 4),
    };
    const text = str(n.text);
    if (text !== undefined) node.text = text;
    const diagramId = str(n.diagramId);
    if (n.kind === 'diagram' && diagramId !== undefined) node.diagramId = diagramId;
    const parentId = str(n.parentId);
    if (parentId !== undefined) node.parentId = parentId;
    if (!ids.has(node.id)) {
      ids.add(node.id);
      nodes.push(node);
    }
  });
  const seenEdges = new Set();
  const edges = [];
  (Array.isArray(raw?.edges) ? raw.edges : []).forEach((e) => {
    if (!e || typeof e.id !== 'string' || typeof e.source !== 'string'
      || typeof e.target !== 'string') return;
    if (!ids.has(e.source) || !ids.has(e.target) || seenEdges.has(e.id)) return;
    seenEdges.add(e.id);
    const edge = {id: e.id, source: e.source, target: e.target};
    const label = str(e.label);
    if (label !== undefined) edge.label = label;
    edges.push(edge);
  });
  nodes.forEach((n) => {
    if (n.parentId !== undefined && !ids.has(n.parentId)) delete n.parentId;
  });
  return {schemaVersion: HOME_CANVAS_SCHEMA_VERSION, nodes, edges};
};

// 安全读取：缺失/损坏一律回落空画布，不写默认示例
export const readHomeCanvas = (source) =>
  normalizeHomeCanvas(source?.profile?.enterpriseModeling?.homeCanvas);

/**
 * 基于最新有效草稿只替换 homeCanvas（合并提交，不覆盖其他 tab 草稿字段）。
 * latestSource 必须是 getDataSource() 的返回（或调用方保证的最新值）。
 */
export const writeHomeCanvas = (latestSource, canvas) => {
  const normalized = normalizeHomeCanvas(canvas);
  return {
    ...latestSource,
    profile: {
      ...latestSource?.profile,
      enterpriseModeling: {
        ...latestSource?.profile?.enterpriseModeling,
        homeCanvas: normalized,
      },
    },
  };
};

/**
 * 企业信息提交（S3-HOME-REVIEW 第4条）：基于确认时最新草稿只更新 name/description，
 * 保留 homeCanvas/概览 pin/旧封面等全部既有元数据与其他 tab 草稿；
 * 不允许用弹窗打开时的快照覆盖确认时的最新内容。
 */
export const writeEnterpriseInfo = (latestSource, {name, description}) => ({
  ...latestSource,
  profile: {
    ...latestSource?.profile,
    enterpriseModeling: {
      ...latestSource?.profile?.enterpriseModeling,
      name,
      description,
    },
  },
});

// 内容包围盒（允许负坐标）；空画布返回 null
export const homeCanvasBounds = (canvas) => {
  const nodes = canvas?.nodes || [];
  if (!nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  });
  return {minX, minY, maxX, maxY};
};

export const findDiagram = (source, id) =>
  (Array.isArray(source?.diagrams) ? source.diagrams : []).find(d => d.id === id) || null;

// diagram 引用状态：ok=源图存在；missing=源已删（节点保留、失效提示，移除引用不删源）
export const resolveDiagramRef = (source, diagramId) => {
  const diagram = findDiagram(source, diagramId);
  return {status: diagram ? 'ok' : 'missing', diagram};
};

// 展示名与模型目录口径一致：defKey [defName]
export const diagramDisplayName = (diagram) =>
  `${diagram?.defKey || ''}${diagram?.defName ? ` [${diagram.defName}]` : ''}`.trim();

/**
 * 源图缩略几何：读取图 canvasData.cells 中 table 节点位置/尺寸与边端点，
 * 等比缩放到 boxW×boxH。纯数据投影，不渲染第二份模型；空图返回 null。
 */
export const diagramThumbGeometry = (diagram, boxW, boxH, pad = 8) => {
  const cells = Array.isArray(diagram?.canvasData?.cells) ? diagram.canvasData.cells : [];
  const nodes = new Map();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  cells.filter(c => c && c.shape === 'table' && c.position && c.size).forEach((c) => {
    const {x, y} = c.position;
    const {width, height} = c.size;
    nodes.set(c.id, {x, y, width, height});
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  });
  if (!nodes.size) return null;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const scale = Math.min(boxW / (maxX - minX), boxH / (maxY - minY));
  const project = v => ({x: (v.x - minX) * scale, y: (v.y - minY) * scale});
  const rects = Array.from(nodes.values()).map(n => ({
    ...project(n), width: n.width * scale, height: n.height * scale,
  }));
  const lines = cells
    .filter(c => c && c.shape !== 'table' && c.source?.cell && c.target?.cell
      && nodes.has(c.source.cell) && nodes.has(c.target.cell))
    .map((c) => {
      const a = nodes.get(c.source.cell);
      const b = nodes.get(c.target.cell);
      const pa = project({x: a.x + a.width / 2, y: a.y + a.height / 2});
      const pb = project({x: b.x + b.width / 2, y: b.y + b.height / 2});
      return {x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y};
    });
  return {rects, lines};
};

// ---------- 合同 ↔ X6 cells 双向映射（纯数据，供画布序列化/加载） ----------

const kindShape = {rect: 'eh-rect', text: 'eh-text', group: 'eh-group', diagram: 'eh-diagram'};
const shapeKind = {'eh-rect': 'rect', 'eh-text': 'text', 'eh-group': 'group', 'eh-diagram': 'diagram'};

/**
 * homeCanvas → graph.fromJSON 的 cells。
 * 只做数据映射（含 parent/children 嵌套与 zIndex 层级），不做图形注册。
 */
export const cellsFromHomeCanvas = (canvas) => {
  const normalized = normalizeHomeCanvas(canvas);
  const childrenOf = new Map();
  normalized.nodes.forEach((n) => {
    if (n.parentId) {
      childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) || []), n.id]);
    }
  });
  const cells = normalized.nodes.map((n) => {
    const cell = {
      id: n.id,
      shape: kindShape[n.kind],
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      zIndex: n.kind === 'group' ? 1 : 2,
    };
    if (n.text !== undefined) cell.attrs = {label: {text: n.text}};
    if (n.kind === 'diagram') {
      cell.diagramId = n.diagramId || null;
      cell.hText = n.text || '';
    }
    if (n.parentId) cell.parent = n.parentId;
    if (childrenOf.has(n.id)) cell.children = childrenOf.get(n.id);
    return cell;
  });
  normalized.edges.forEach((e) => {
    const edge = {
      id: e.id,
      shape: 'eh-edge',
      source: {cell: e.source},
      target: {cell: e.target},
      zIndex: 3,
    };
    if (e.label !== undefined) edge.labels = [{attrs: {label: {text: e.label}}}];
    cells.push(edge);
  });
  return cells;
};

/**
 * graph.toJSON().cells → homeCanvas（画布保存时序列化）。
 * 无效数据丢弃；diagramId 原样保留（含坏引用）。
 */
export const homeCanvasFromCells = (cells) => {
  const nodes = [];
  const edges = [];
  const ids = new Set();
  (Array.isArray(cells) ? cells : []).forEach((c) => {
    if (!c) return;
    if (c.shape === 'eh-edge' || (c.source && c.target)) {
      const sourceId = c.source?.cell;
      const targetId = c.target?.cell;
      if (typeof c.id !== 'string' || typeof sourceId !== 'string' || typeof targetId !== 'string') return;
      const edge = {id: c.id, source: sourceId, target: targetId};
      const label = str(c.labels?.[0]?.attrs?.label?.text);
      if (label !== undefined) edge.label = label;
      edges.push(edge);
      return;
    }
    const kind = shapeKind[c.shape];
    if (!kind || typeof c.id !== 'string') return;
    // 兼容两种 cells 形态：X6 toJSON 的 position/size 与建图元数据的扁平 x/y/width/height
    const cellX = c.position?.x !== undefined ? c.position.x : c.x;
    const cellY = c.position?.y !== undefined ? c.position.y : c.y;
    const cellW = c.size?.width !== undefined ? c.size.width : c.width;
    const cellH = c.size?.height !== undefined ? c.size.height : c.height;
    const node = {
      id: c.id,
      kind,
      x: num(cellX, 0),
      y: num(cellY, 0),
      width: Math.max(num(cellW, HOME_NODE_DEFAULTS[kind].width), 4),
      height: Math.max(num(cellH, HOME_NODE_DEFAULTS[kind].height), 4),
    };
    if (kind === 'diagram') {
      node.diagramId = typeof c.diagramId === 'string' ? c.diagramId : null;
      node.text = typeof c.hText === 'string' ? c.hText : '';
    } else {
      const text = str(c.attrs?.label?.text);
      if (text !== undefined) node.text = text;
    }
    if (typeof c.parent === 'string') node.parentId = c.parent;
    if (!ids.has(node.id)) {
      ids.add(node.id);
      nodes.push(node);
    }
  });
  const result = {schemaVersion: HOME_CANVAS_SCHEMA_VERSION, nodes, edges};
  // 复用规范化：过滤悬挂边/坏 parentId
  return normalizeHomeCanvas(result);
};

// ---------- 局部中英文文案（独立 module，不改他人语言文件） ----------

export const HOME_LABELS = {
  zh: {
    canvasLabel: '企业架构画布',
    addRect: '矩形',
    addText: '文字',
    addGroup: '分组',
    addDiagram: '关系图引用',
    undo: '撤销',
    redo: '重做',
    deleteSelected: '删除选中',
    zoomIn: '放大',
    zoomOut: '缩小',
    zoomFit: '适应内容',
    zoomReset: '重置缩放',
    emptyTitle: '从工具条或左侧目录拖入，开始绘制企业架构',
    emptyHint: '支持矩形 / 文字 / 分组 / 关系图引用，可连接、编辑、撤销重做',
    editTitle: '编辑企业信息',
    name: '企业名称',
    description: '企业介绍',
    nameRequired: '请输入企业名称',
    openCover: '打开封面图',
    pickDiagram: '选择关系图',
    pickDiagramSearch: '搜索 defKey / defName',
    pickDiagramEmpty: '暂无关系图',
    pickDiagramCreate: '新建关系图',
    confirm: '确定',
    cancel: '取消',
    invalidRef: '源图已删除',
    nodeCount: '图形',
    selectedCount: '选中',
    readOnly: '只读',
    saveFailed: '保存失败',
    invalidMime: '不支持的内容',
  },
  en: {
    canvasLabel: 'Enterprise architecture canvas',
    addRect: 'Rect',
    addText: 'Text',
    addGroup: 'Group',
    addDiagram: 'Diagram ref',
    undo: 'Undo',
    redo: 'Redo',
    deleteSelected: 'Delete selected',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomFit: 'Fit content',
    zoomReset: 'Reset zoom',
    emptyTitle: 'Drag from the toolbar or catalog to draw the enterprise architecture',
    emptyHint: 'Rect / text / group / diagram refs, connectable, editable, undo & redo',
    editTitle: 'Edit enterprise info',
    name: 'Enterprise name',
    description: 'Description',
    nameRequired: 'Enterprise name is required',
    openCover: 'Open cover diagram',
    pickDiagram: 'Choose a diagram',
    pickDiagramSearch: 'Search defKey / defName',
    pickDiagramEmpty: 'No diagrams yet',
    pickDiagramCreate: 'New diagram',
    confirm: 'OK',
    cancel: 'Cancel',
    invalidRef: 'Source removed',
    nodeCount: 'shapes',
    selectedCount: 'selected',
    readOnly: 'Read only',
    saveFailed: 'Save failed',
    invalidMime: 'Unsupported content',
  },
};

export const homeLabel = (lang, key) =>
  (HOME_LABELS[lang] && HOME_LABELS[lang][key]) || HOME_LABELS.zh[key] || key;
