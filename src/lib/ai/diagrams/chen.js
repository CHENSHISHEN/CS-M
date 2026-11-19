'use strict';
// Chen 语义候选编译器（PLATFORM-AI-001 DRAWING）。
// 纯领域适配器：把设计封闭的 drawing.chen.createDocument/createPage/patch 参数编译为
// 真实 DrawingDocument（schemaVersion 2 / notation chen）候选。不请求模型、不做
// planHash/确认/readSet/幂等（CORE/集成层职责）、不提交 history/保存、不修改传入对象。
// 唯一领域依赖：public/drawing-document.js（只读复用，不复制其格式）。
const D = require('../../../../public/drawing-document');

const SUPPORTED_COMMANDS = ['drawing.chen.createDocument', 'drawing.chen.createPage', 'drawing.chen.patch'];

const blocking = (code, message, detail) => ({level: 'blocking', code, message, detail});
const warning = (code, message, detail) => ({level: 'warning', code, message, detail});
const norm = value => String(value || '').trim().toLocaleLowerCase();
const trimText = value => String(value == null ? '' : value).trim();

// 语义存储 kind → 渲染/UI kind（chenSizeOf / chenRoleOf / kindOf 的词表）
const uiKindOfNode = node => {
  if (node.roles !== undefined) return node.kind === 'identifying' ? 'identifying' : 'relationship';
  if (node.owner === undefined) return node.kind === 'weak' ? 'weak' : 'entity';
  if (node.key === 'primary') return 'key';
  if (node.key === 'partial') return 'partial-key';
  return {multivalued: 'multi', derived: 'derived', composite: 'composite'}[node.kind] || 'attribute';
};

// ---- 参数安全扫描：封闭协议之外的字段/注入载体一律拒绝 ----
const FORBIDDEN_KEYS = new Set(['markup', 'view', 'component', 'attrs']);
const scanUnsafe = (value, path, issues) => {
  if (!value || typeof value !== 'object') {
    if (typeof value === 'function') issues.push(blocking('OUTPUT_SCHEMA_INVALID', `non-serializable value at ${path}`));
    return;
  }
  if (Array.isArray(value)) {value.forEach((item, i) => scanUnsafe(item, `${path}[${i}]`, issues)); return;}
  Object.keys(value).forEach(key => {
    if (FORBIDDEN_KEYS.has(key)) issues.push(blocking('OUTPUT_SCHEMA_INVALID', `forbidden field "${key}" at ${path}.${key}`));
    else scanUnsafe(value[key], `${path}.${key}`, issues);
  });
};

// ---- scene 查询 ----
const semanticAll = page => [...page.erModel.entities, ...page.erModel.relationships, ...page.erModel.attributes];
const nodeById = (page, id) => {
  const direct = page.erModel.entities.find(n => n.id === id) || page.erModel.relationships.find(n => n.id === id)
    || page.erModel.attributes.find(n => n.id === id);
  if (direct) return direct;
  return null;
};
const nodeType = node => (node.roles !== undefined ? 'relationship' : node.owner === undefined ? 'entity' : 'attribute');
const layerOf = (page, layerId) => (page.scene.layers || []).find(l => l.id === layerId);
const isLockedNode = (page, id) => {
  const v = page.scene.nodes[id];
  if (!v) return false;
  if (v.locked) return true;
  const layer = layerOf(page, v.layerId);
  return Boolean(layer && layer.locked);
};
const isHiddenNode = (page, id) => {
  const v = page.scene.nodes[id];
  if (!v) return false;
  const layer = layerOf(page, v.layerId);
  return Boolean(layer && layer.visible === false);
};

// ---- 确定性占位布局：真实图形尺寸 + 碰撞避让，支持任意坐标 ----
const MARGIN = 12;
const rectsIntersect = (a, b) => a.x - MARGIN < b.x + b.width + MARGIN && b.x - MARGIN < a.x + a.width + MARGIN
  && a.y - MARGIN < b.y + b.height + MARGIN && b.y - MARGIN < a.y + a.height + MARGIN;
const ScenePlanner = () => {
  const rects = [];
  return {
    add(rect) {rects.push(rect);},
    reset(page) {
      rects.length = 0;
      Object.values(page.scene.nodes || {}).forEach(v => rects.push({x: v.x, y: v.y, width: v.width, height: v.height}));
    },
    place(desired) {
      let {x, y} = desired;
      for (let hop = 0; hop < 200; hop += 1) {
        if (!rects.some(r => rectsIntersect({x, y, width: desired.width, height: desired.height}, r))) break;
        y += 50 + Math.floor(hop / 20) * 40; // 逐步下移，行满后加大步长，保持确定性
      }
      rects.push({x, y, width: desired.width, height: desired.height});
      return {x, y};
    },
  };
};
const contentBounds = page => {
  const values = Object.values(page.scene.nodes || {});
  if (!values.length) return {minX: 0, minY: 0, maxX: 800, maxY: 600};
  return {
    minX: Math.min(...values.map(v => v.x)),
    minY: Math.min(...values.map(v => v.y)),
    maxX: Math.max(...values.map(v => v.x + v.width)),
    maxY: Math.max(...values.map(v => v.y + v.height)),
  };
};
const buildPlannerFromPage = page => {
  const planner = ScenePlanner();
  Object.entries(page.scene.nodes || {}).forEach(([, v]) => planner.add({x: v.x, y: v.y, width: v.width, height: v.height}));
  return planner;
};
// 新增对象的默认落点：内容包围盒右侧、纵向回到包围盒顶部（内容可扩展，无固定纸张）
const freeSpotRight = (planner, bounds, size) => planner.place({x: bounds.maxX + 90, y: bounds.minY, width: size.width, height: size.height});

// ---- 主题/风格（仅真实注册表，非法拒绝） ----
// drawing-document.js 未导出 chenStylesById；此清单与其注册表及 schema enum 保持一致
const STYLE_IDS = ['standard', 'sketch', 'oil'];
const THEME_IDS = Object.keys(D.chenThemes);
const styleForNode = (uiKind, themeId, styleId) => {
  const theme = D.chenThemes[themeId];
  const colors = theme[D.chenRoleOf(uiKind)] || theme.basic;
  const style = {fill: colors.fill, stroke: colors.stroke};
  if (styleId && styleId !== 'standard') style.renderStyle = styleId;
  return style;
};

// ---- ChenGraph（createDocument/createPage 共用）编译 ----
const compileGraph = (page, graph, themeId, styleId, allocateId, issues, warnings, idMap) => {
  const entities = Array.isArray(graph.entities) ? graph.entities : [];
  const relationships = Array.isArray(graph.relationships) ? graph.relationships : [];
  const attributes = Array.isArray(graph.attributes) ? graph.attributes : [];
  if (!entities.length) issues.push(blocking('OUTPUT_SCHEMA_INVALID', 'graph.entities must contain at least one entity'));
  const seenKeys = new Set();
  const claimKey = (key, label) => {
    if (!key || typeof key !== 'string') {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label} localKey missing`)); return false;}
    if (seenKeys.has(key)) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `duplicate localKey in plan: ${key}`)); return false;}
    seenKeys.add(key);
    return true;
  };
  const checkName = (name, label) => {
    const trimmed = trimText(name);
    if (!trimmed) issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} name is empty`));
    else if (trimmed.length > 240) issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} name too long`));
    return trimmed;
  };
  if (issues.length) return;

  // 1. 实体
  const entityByKey = new Map();
  entities.forEach((draft, index) => {
    if (!draft || typeof draft !== 'object') {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `entities[${index}] invalid`)); return;}
    if (!claimKey(draft.localKey, `entities[${index}]`)) return;
    const name = checkName(draft.name, `entity ${draft.localKey}`);
    if (!['strong', 'weak'].includes(draft.kind)) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `entity ${draft.localKey} kind must be strong|weak`)); return;}
    const node = {id: allocateId('er'), name, kind: draft.kind};
    page.erModel.entities.push(node);
    entityByKey.set(draft.localKey, node);
    idMap[draft.localKey] = {id: node.id, type: 'entity'};
  });
  if (issues.length) return;

  // 2. 联系与角色
  relationships.forEach((draft, index) => {
    if (!draft || typeof draft !== 'object') {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `relationships[${index}] invalid`)); return;}
    if (!claimKey(draft.localKey, `relationships[${index}]`)) return;
    const name = checkName(draft.name, `relationship ${draft.localKey}`);
    if (!['ordinary', 'identifying'].includes(draft.kind)) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `relationship ${draft.localKey} kind must be ordinary|identifying`)); return;}
    const roles = Array.isArray(draft.roles) ? draft.roles : [];
    if (roles.length < 2 || roles.length > 12) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `relationship ${draft.localKey} needs 2..12 roles`)); return;}
    const roleNodes = [];
    let bad = false;
    roles.forEach((role, rIndex) => {
      if (!role || typeof role !== 'object' || !claimKey(role.localKey, `relationship ${draft.localKey} roles[${rIndex}]`)) {bad = true; return;}
      const entity = entityByKey.get(role.entityKey);
      if (!entity) {issues.push(blocking('REFERENCE_UNRESOLVED', `role ${role.localKey} entityKey not found: ${role.entityKey}`)); bad = true; return;}
      if (!['one', 'many'].includes(role.cardinality) || !['partial', 'total'].includes(role.participation)) {
        issues.push(blocking('INVALID_CHEN_SEMANTICS', `role ${role.localKey} cardinality/participation invalid`)); bad = true; return;
      }
      let manyLabel = null;
      if (role.cardinality === 'many') {
        manyLabel = role.manyLabel || 'N';
        if (!['N', 'M', 'P'].includes(manyLabel)) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `role ${role.localKey} manyLabel must be N|M|P`)); bad = true; return;}
      }
      if (draft.kind === 'identifying' && entity.kind === 'weak' && role.participation !== 'total') {
        issues.push(blocking('INVALID_CHEN_SEMANTICS', `weak entity ${entity.name} must participate totally in identifying relationship ${name}`)); bad = true; return;
      }
      const roleNode = {id: allocateId('role'), entityId: entity.id, name: trimText(role.name), cardinality: role.cardinality, manyLabel, participation: role.participation};
      roleNodes.push(roleNode);
      idMap[role.localKey] = {id: roleNode.id, type: 'role'};
    });
    if (bad) return;
    const node = {id: allocateId('er'), name, kind: draft.kind, roles: roleNodes};
    page.erModel.relationships.push(node);
    idMap[draft.localKey] = {id: node.id, type: 'relationship'};
  });
  if (issues.length) return;

  // 3. 属性：按 owner 依赖分轮插入，属性 owner 必须是 composite，环/悬空拒绝
  const attrByKey = new Map();
  let todo = attributes.slice();
  for (let guard = 0; todo.length && guard <= attributes.length + 1; guard += 1) {
    const ready = todo.filter(draft => {
      const owner = draft?.owner || {};
      return owner.type === 'entity' && entityByKey.has(owner.key) || owner.type === 'relationship'
        && page.erModel.relationships.some(r => idMap[owner.key]?.id === r.id)
        || owner.type === 'attribute' && attrByKey.has(owner.key);
    });
    if (!ready.length) break;
    ready.forEach(draft => {
      if (!claimKey(draft.localKey, 'attribute')) return;
      const name = checkName(draft.name, `attribute ${draft.localKey}`);
      if (!['simple', 'composite', 'multivalued', 'derived'].includes(draft.kind) || !['none', 'primary', 'partial'].includes(draft.key)) {
        issues.push(blocking('INVALID_CHEN_SEMANTICS', `attribute ${draft.localKey} kind/key invalid`)); return;
      }
      const owner = draft.owner || {};
      let ownerId;
      let ownerKind = owner.type;
      if (owner.type === 'entity') ownerId = entityByKey.get(owner.key).id;
      else if (owner.type === 'relationship') ownerId = idMap[owner.key].id;
      else {
        const parent = attrByKey.get(owner.key);
        if (parent.node.kind !== 'composite') {issues.push(blocking('INVALID_CHEN_SEMANTICS', `attribute ${draft.localKey} owner attribute is not composite: ${owner.key}`)); return;}
        ownerId = parent.node.id;
        ownerKind = 'attribute';
      }
      // 键属性约束：非 simple 不得为键；键的根 owner 不能是联系；partial key 只属于弱实体
      if (draft.key !== 'none') {
        if (draft.kind !== 'simple') {issues.push(blocking('INVALID_CHEN_SEMANTICS', `key attribute ${draft.localKey} must be simple`)); return;}
        let root = {type: ownerKind, id: ownerId};
        while (root.type === 'attribute') {
          const parent = page.erModel.attributes.find(a => a.id === root.id);
          root = {type: parent.owner.type, id: parent.owner.id};
        }
        if (root.type === 'relationship') {issues.push(blocking('INVALID_CHEN_SEMANTICS', `key attribute ${draft.localKey} cannot belong to a relationship`)); return;}
        if (draft.key === 'partial') {
          const ownerEntity = page.erModel.entities.find(e => e.id === root.id);
          if (!ownerEntity || ownerEntity.kind !== 'weak') {issues.push(blocking('INVALID_CHEN_SEMANTICS', `partial key ${draft.localKey} only belongs to a weak entity`)); return;}
        }
      }
      const node = {id: allocateId('er'), name, kind: draft.kind, key: draft.key, owner: {type: ownerKind, id: ownerId}};
      page.erModel.attributes.push(node);
      attrByKey.set(draft.localKey, {node, ownerKey: owner.key, ownerType: ownerKind});
      idMap[draft.localKey] = {id: node.id, type: 'attribute'};
    });
    if (issues.length) return;
    const done = new Set(ready);
    todo = todo.filter(draft => !done.has(draft));
  }
  if (todo.length) {
    issues.push(blocking('INVALID_CHEN_SEMANTICS',
      `attributes with unresolvable or cyclic owners: ${todo.map(a => a?.localKey).join(', ')}`));
    return;
  }

  // 4. 布局：实体一行；相邻两实体联系居中同行，否则下移一行；属性按 owner 扇形/下置；复合子属性随父
  const planner = ScenePlanner();
  const sizeOf = uiKind => D.chenSizeOf(uiKind);
  page.erModel.entities.forEach((node, index) => {
    const size = sizeOf(uiKindOfNode(node));
    const spot = planner.place({x: 80 + index * 480, y: 300, width: size.width, height: size.height});
    page.scene.nodes[node.id] = {x: spot.x, y: spot.y, width: size.width, height: size.height, layerId: page.scene.layers[0].id, style: styleForNode(uiKindOfNode(node), themeId, styleId)};
  });
  const entityCenter = node => {
    const v = page.scene.nodes[node.id];
    return {x: v.x + v.width / 2, y: v.y + v.height / 2};
  };
  page.erModel.relationships.forEach(rel => {
    const size = sizeOf(uiKindOfNode(rel));
    const partners = rel.roles.map(r => page.erModel.entities.find(e => e.id === r.entityId));
    const centers = partners.map(entityCenter);
    const avg = {x: centers.reduce((a, c) => a + c.x, 0) / centers.length, y: centers.reduce((a, c) => a + c.y, 0) / centers.length};
    const orderedX = partners.map(p => page.erModel.entities.indexOf(p)).sort((a, b) => a - b);
    const adjacent = partners.length === 2 && orderedX[1] - orderedX[0] === 1;
    const desired = adjacent
      ? {x: avg.x - size.width / 2, y: 300 + (58 - size.height) / 2, width: size.width, height: size.height}
      : {x: avg.x - size.width / 2, y: 640, width: size.width, height: size.height};
    const spot = planner.place(desired);
    page.scene.nodes[rel.id] = {x: spot.x, y: spot.y, width: size.width, height: size.height, layerId: page.scene.layers[0].id, style: styleForNode(uiKindOfNode(rel), themeId, styleId)};
  });
  const placeAttributeGroup = (ownerId, center, below) => {
    const owned = page.erModel.attributes.filter(a => a.owner.id === ownerId && a.owner.type !== 'attribute');
    const sorted = owned.slice().sort((a, b) => (a.key === 'none') - (b.key === 'none'));
    const perRow = 3;
    sorted.forEach((attr, i) => {
      const size = sizeOf(uiKindOfNode(attr));
      const row = Math.floor(i / perRow);
      const inRow = i % perRow;
      const rowItems = Math.min(perRow, sorted.length - row * perRow);
      const rowWidth = rowItems * 150;
      const desired = {
        x: center.x - rowWidth / 2 + inRow * 150 + (150 - size.width) / 2,
        y: below ? center.y + 90 + row * 70 : center.y - 90 - size.height - row * 70,
        width: size.width, height: size.height,
      };
      const spot = planner.place(desired);
      page.scene.nodes[attr.id] = {x: spot.x, y: spot.y, width: size.width, height: size.height, layerId: page.scene.layers[0].id, style: styleForNode(uiKindOfNode(attr), themeId, styleId)};
    });
  };
  page.erModel.entities.forEach(e => placeAttributeGroup(e.id, entityCenter(e), false));
  page.erModel.relationships.forEach(r => {
    const v = page.scene.nodes[r.id];
    placeAttributeGroup(r.id, {x: v.x + v.width / 2, y: v.y + v.height / 2}, true);
  });
  // 复合子属性：按深度逐层放到父属性下方
  let pending = page.erModel.attributes.filter(a => a.owner.type === 'attribute');
  for (let guard = 0; pending.length && guard <= page.erModel.attributes.length; guard += 1) {
    const ready = pending.filter(a => page.erModel.attributes.some(p => p.id === a.owner.id && p.owner.type !== 'attribute')
      || page.erModel.attributes.some(p => p.id === a.owner.id && page.scene.nodes[p.id]));
    if (!ready.length) break;
    ready.forEach(attr => {
      const parent = page.erModel.attributes.find(a => a.id === attr.owner.id);
      const pv = page.scene.nodes[parent.id];
      const size = sizeOf(uiKindOfNode(attr));
      const spot = planner.place({x: pv.x + pv.width / 2 - size.width / 2, y: pv.y + pv.height + 50, width: size.width, height: size.height});
      page.scene.nodes[attr.id] = {x: spot.x, y: spot.y, width: size.width, height: size.height, layerId: page.scene.layers[0].id, style: styleForNode(uiKindOfNode(attr), themeId, styleId)};
    });
    const done = new Set(ready);
    pending = pending.filter(a => !done.has(a));
  }
  if (pending.length) issues.push(blocking('INVALID_CHEN_SEMANTICS', 'composite attribute chain cannot be placed'));

  // 5. 业务完备性提示（弱实体缺标识联系由 D.warnings 汇总）
  const entityNames = new Map();
  page.erModel.entities.forEach(e => {
    const key = norm(e.name);
    if (entityNames.has(key)) warnings.push(warning('DUPLICATE_ENTITY_NAME', `duplicate entity name: ${e.name}`));
    entityNames.set(key, e.id);
  });
};

const changesForCreatedPage = (page, idMap) => {
  const changes = [];
  Object.entries(idMap).forEach(([key, entry]) => {
    if (entry.type === 'entity' || entry.type === 'relationship' || entry.type === 'attribute') {
      const node = nodeById(page, entry.id);
      changes.push({changeIndex: null, kind: 'create', target: {collection: 'drawingSemantic', id: entry.id, localKey: key, type: entry.type}, after: {name: node.name, kind: node.kind, key: node.key, owner: node.owner}});
    } else if (entry.type === 'role') {
      changes.push({changeIndex: null, kind: 'create', target: {collection: 'drawingSemantic', id: entry.id, localKey: key, type: 'role'}, after: {}});
    } else if (entry.type === 'page') {
      changes.push({changeIndex: null, kind: 'create', target: {collection: 'drawingPages', id: entry.id, localKey: key, type: 'page'}, after: {name: page.name}});
    }
  });
  return changes;
};

// ---- createDocument / createPage ----
const compileCreate = (command, args, input, allocateId, scope, issues, warnings) => {
  const name = trimText(args.name);
  const pageName = trimText(command === 'drawing.chen.createDocument' ? args.pageName : args.name);
  if (!name || name.length > 80) issues.push(blocking('INVALID_CHEN_SEMANTICS', `${command} name must be 1..80 chars after trim`));
  if (command === 'drawing.chen.createDocument' && (!pageName || pageName.length > 80)) issues.push(blocking('INVALID_CHEN_SEMANTICS', 'pageName must be 1..80 chars after trim'));
  const themeId = args.themeId;
  const styleId = args.styleId;
  if (!THEME_IDS.includes(themeId)) issues.push(blocking('INVALID_CHEN_SEMANTICS', `unknown themeId: ${themeId}`));
  if (!STYLE_IDS.includes(styleId)) issues.push(blocking('INVALID_CHEN_SEMANTICS', `unknown styleId: ${styleId}`));
  if (issues.length) return null;
  if (command === 'drawing.chen.createDocument') {
    const documents = Array.isArray(input?.source?.documents) ? input.source.documents : [];
    const clash = documents.some(doc => doc && norm(doc.defName) === norm(name));
    if (clash) issues.push(blocking('DUPLICATE_NAME', `document name already exists: ${name}`));
  } else {
    if (!input.document || !D.isChen(input.document)) {
      issues.push(blocking('CAPABILITY_UNAVAILABLE', 'createPage needs an open chen drawing document'));
      return null;
    }
    if (input.document.pages.length >= 200) issues.push(blocking('INVALID_CHEN_SEMANTICS', 'document reaches the 200-page limit'));
    if (input.document.pages.some(p => norm(p.name) === norm(pageName))) issues.push(blocking('DUPLICATE_NAME', `page name already exists: ${pageName}`));
  }
  if (issues.length) return null;

  const page = D.page(pageName);
  page.id = allocateId('page');
  page.erModel = D.emptyModel();
  const idMap = {};
  if (args.localKey) idMap[args.localKey] = command === 'drawing.chen.createDocument'
    ? {id: null, type: 'document'} : {id: page.id, type: 'page'};
  compileGraph(page, args.graph || {}, themeId, styleId, allocateId, issues, warnings, idMap);
  if (issues.length) return null;
  page.scene.chenAppearance = {version: 1, themeId, styleId};

  let document;
  if (command === 'drawing.chen.createDocument') {
    document = {
      id: allocateId('drawing'), type: 'drawing', schemaVersion: 2, diagramType: 'er-sketch',
      notation: 'chen', revision: 0, defName: name, defKey: allocateId('er'),
      pages: [page], enabledPacks: ['chen', 'basic'], resources: [], components: [],
    };
    if (args.localKey) idMap[args.localKey].id = document.id;
  } else {
    document = D.clone(input.document);
    document.pages.push(page);
  }
  const docErrors = D.errors(document);
  if (docErrors.length) {
    issues.push(blocking('INVALID_CHEN_SEMANTICS', `compiled document fails drawing validation: ${docErrors.join(', ')}`));
    return null;
  }
  (D.warnings(page) || []).forEach(w => warnings.push(warning(w.code, `${w.code} on ${w.id}`, {nodeId: w.id})));
  const changes = changesForCreatedPage(page, idMap);
  if (command === 'drawing.chen.createDocument') {
    changes.push({changeIndex: null, kind: 'create', target: {collection: 'drawingDocuments', id: document.id, localKey: args.localKey, type: 'document'}, after: {defName: document.defName, pages: 1}});
  }
  return {document, page, changes, idMap};
};

// ---- patch ----
const validateRoleDraft = (role, relationshipKind, entity, label, issues) => {
  if (!role || typeof role !== 'object') {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label} invalid role`)); return null;}
  if (!['one', 'many'].includes(role.cardinality) || !['partial', 'total'].includes(role.participation)) {
    issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} cardinality/participation invalid`)); return null;
  }
  let manyLabel = null;
  if (role.cardinality === 'many') {
    manyLabel = role.manyLabel || 'N';
    if (!['N', 'M', 'P'].includes(manyLabel)) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} manyLabel must be N|M|P`)); return null;}
  }
  if (relationshipKind === 'identifying' && entity.kind === 'weak' && role.participation !== 'total') {
    issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label}: weak entity must participate totally in identifying relationship`)); return null;
  }
  return {id: null, entityId: entity.id, name: trimText(role.name), cardinality: role.cardinality, manyLabel, participation: role.participation};
};

const compilePatch = (command, args, input, allocateId, scope, issues, warnings) => {
  const document = input.document;
  if (!document || !D.isChen(document)) {
    issues.push(blocking('CAPABILITY_UNAVAILABLE', 'patch needs an open chen drawing document'));
    return null;
  }
  const doc = D.clone(document);
  const pageIndex = doc.pages.findIndex(p => p.id === args.pageId);
  if (pageIndex < 0) {issues.push(blocking('REFERENCE_UNRESOLVED', `pageId not found: ${args.pageId}`)); return null;}
  let page = doc.pages[pageIndex];
  const baseErrors = new Set(D.errors(document));
  const idMap = {};
  const changes = [];
  const selection = Array.isArray(scope?.selection) ? new Set(scope.selection) : null;
  const seedBindings = input.bindings && typeof input.bindings === 'object' ? input.bindings : {};
  const inSelection = (id, label) => {
    if (selection && !selection.has(id)) {
      issues.push(blocking('OUT_OF_SELECTION', `${label} (${id}) is outside the current selection`));
      return false;
    }
    return true;
  };
  const resolveRef = (ref, label) => {
    if (!ref || typeof ref !== 'object') {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label} reference missing`)); return null;}
    let id = null;
    if (ref.kind === 'local') {
      const local = idMap[ref.key] || seedBindings[ref.key];
      if (!local) {issues.push(blocking('REFERENCE_UNRESOLVED', `local key not produced in this plan: ${ref.key}`)); return null;}
      id = local.id;
    } else if (ref.kind === 'existing') {
      if (ref.collection !== 'drawingSemantic') {
        issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label}: only drawingSemantic references are accepted (got ${ref.collection})`));
        return null;
      }
      id = ref.id;
    } else {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label}: unknown reference kind`)); return null;}
    const node = nodeById(page, id);
    if (!node) {issues.push(blocking('REFERENCE_UNRESOLVED', `${label} object not on page ${args.pageId}: ${id}`)); return null;}
    return node;
  };
  const requireUnlocked = (node, label) => {
    if (isLockedNode(page, node.id)) {issues.push(blocking('LOCKED_GRAPH_OBJECT', `${label} (${node.id}) is locked`)); return false;}
    if (isHiddenNode(page, node.id)) warnings.push(warning('HIDDEN_TARGET', `${label} (${node.id}) is on a hidden layer`));
    return true;
  };
  const planner = buildPlannerFromPage(page);
  const bounds = () => contentBounds(page);
  const sceneFor = node => page.scene.nodes[node.id];
  const claimLocalKey = (key, label) => {
    if (!key || typeof key !== 'string') {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label} localKey missing`)); return false;}
    if (idMap[key] || seedBindings[key]) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `duplicate localKey in plan: ${key}`)); return false;}
    return true;
  };
  const placeNewNode = (node, desired) => {
    const size = D.chenSizeOf(uiKindOfNode(node));
    const b = bounds();
    const spot = planner.place({x: desired ? desired.x : b.maxX + 90, y: desired ? desired.y : b.minY, width: size.width, height: size.height});
    page.scene.nodes[node.id] = {x: spot.x, y: spot.y, width: size.width, height: size.height, layerId: page.scene.layers[0].id, style: {}};
    return page.scene.nodes[node.id];
  };

  (Array.isArray(args.changes) ? args.changes : []).forEach((change, index) => {
    if (issues.length) return;
    if (!change || typeof change !== 'object' || typeof change.kind !== 'string') {
      issues.push(blocking('OUTPUT_SCHEMA_INVALID', `changes[${index}] invalid`)); return;
    }
    const label = `changes[${index}] (${change.kind})`;
    switch (change.kind) {
      case 'addEntity': {
        const name = trimText(change.name);
        if (!name || name.length > 240) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} name must be 1..240 chars`)); return;}
        if (!['strong', 'weak'].includes(change.entityKind)) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} entityKind must be strong|weak`)); return;}
        if (!claimLocalKey(change.localKey, label)) return;
        const node = {id: allocateId('er'), name, kind: change.entityKind};
        page.erModel.entities.push(node);
        idMap[change.localKey] = {id: node.id, type: 'entity'};
        placeNewNode(node);
        changes.push({changeIndex: index, kind: 'create', target: {collection: 'drawingSemantic', id: node.id, localKey: change.localKey, type: 'entity'}, after: {name, kind: node.kind}});
        if (node.kind === 'weak') warnings.push(warning('identification-required', `weak entity ${name} needs an identifying relationship`, {nodeId: node.id}));
        return;
      }
      case 'addRelationship': {
        const name = trimText(change.name);
        if (!name || name.length > 240) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} name must be 1..240 chars`)); return;}
        if (!['ordinary', 'identifying'].includes(change.relationshipKind)) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} relationshipKind must be ordinary|identifying`)); return;}
        const roleDrafts = Array.isArray(change.roles) ? change.roles : [];
        if (roleDrafts.length < 2 || roleDrafts.length > 12) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} needs 2..12 roles`)); return;}
        if (!claimLocalKey(change.localKey, label)) return;
        const usedKeys = new Set([change.localKey, ...Object.keys(seedBindings), ...Object.keys(idMap)]);
        const partners = [];
        let bad = false;
        roleDrafts.forEach((role, rIndex) => {
          if (bad || !role || typeof role !== 'object' || !role.localKey) {if (!bad) issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label} roles[${rIndex}] localKey missing`)); bad = true; return;}
          if (usedKeys.has(role.localKey)) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `duplicate localKey in plan: ${role.localKey}`)); bad = true; return;}
          usedKeys.add(role.localKey);
          const entity = resolveRef(role.entity, `${label} roles[${rIndex}].entity`);
          if (!entity) {bad = true; return;}
          if (nodeType(entity) !== 'entity') {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} roles[${rIndex}].entity is not an entity`)); bad = true; return;}
          if (!inSelection(entity.id, `${label} roles[${rIndex}].entity`)) {bad = true; return;}
          if (!requireUnlocked(entity, `${label} roles[${rIndex}].entity`)) {bad = true; return;}
          const roleNode = validateRoleDraft(role, change.relationshipKind, entity, `${label} roles[${rIndex}]`, issues);
          if (!roleNode) {bad = true; return;}
          roleNode.id = allocateId('role');
          partners.push({role: roleNode, localKey: role.localKey});
        });
        if (bad || issues.length) return;
        const node = {id: allocateId('er'), name, kind: change.relationshipKind, roles: partners.map(p => p.role)};
        page.erModel.relationships.push(node);
        idMap[change.localKey] = {id: node.id, type: 'relationship'};
        partners.forEach(p => {idMap[p.localKey] = {id: p.role.id, type: 'role'};});
        const centers = partners.map(p => sceneFor(page.erModel.entities.find(e => e.id === p.role.entityId)))
          .filter(Boolean).map(v => ({x: v.x + v.width / 2, y: v.y + v.height / 2}));
        const avgX = centers.length ? centers.reduce((a, c) => a + c.x, 0) / centers.length : bounds().maxX + 90;
        placeNewNode(node, {x: avgX - 55, y: 640});
        changes.push({changeIndex: index, kind: 'create', target: {collection: 'drawingSemantic', id: node.id, localKey: change.localKey, type: 'relationship'}, after: {name, kind: node.kind, roles: node.roles.map(r => r.id)}});
        partners.forEach(p => changes.push({changeIndex: index, kind: 'create', target: {collection: 'drawingSemantic', id: p.role.id, localKey: p.localKey, type: 'role', roleOf: node.id}, after: {entityId: p.role.entityId, cardinality: p.role.cardinality, participation: p.role.participation}}));
        return;
      }
      case 'addAttribute': {
        const name = trimText(change.name);
        if (!name || name.length > 240) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} name must be 1..240 chars`)); return;}
        if (!['simple', 'composite', 'multivalued', 'derived'].includes(change.attributeKind) || !['none', 'primary', 'partial'].includes(change.key)) {
          issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} attributeKind/key invalid`)); return;}
        if (!claimLocalKey(change.localKey, label)) return;
        const owner = change.owner || {};
        const ownerNode = resolveRef(owner.ref, `${label} owner.ref`);
        if (!ownerNode) return;
        const expected = owner.type;
        if (nodeType(ownerNode) !== expected) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} owner.type ${expected} does not match target object`)); return;}
        if (expected === 'attribute' && ownerNode.kind !== 'composite') {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} owner attribute is not composite`)); return;}
        if (!inSelection(ownerNode.id, `${label} owner`)) return;
        if (!requireUnlocked(ownerNode, `${label} owner`)) return;
        if (change.key !== 'none') {
          if (change.attributeKind !== 'simple') {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} key attribute must be simple`)); return;}
          let root = ownerNode;
          while (root.owner && root.owner.type === 'attribute') root = page.erModel.attributes.find(a => a.id === root.owner.id);
          const rootType = root.roles !== undefined ? 'relationship' : root.owner === undefined ? 'entity' : (root.owner ? root.owner.type : 'entity');
          if (rootType === 'relationship') {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} key attribute cannot belong to a relationship`)); return;}
          if (change.key === 'partial' && root.kind !== 'weak') {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} partial key only belongs to a weak entity`)); return;}
        }
        const node = {id: allocateId('er'), name, kind: change.attributeKind, key: change.key, owner: {type: expected, id: ownerNode.id}};
        page.erModel.attributes.push(node);
        idMap[change.localKey] = {id: node.id, type: 'attribute'};
        const ownerScene = sceneFor(ownerNode);
        const desired = expected === 'relationship'
          ? {x: ownerScene.x + ownerScene.width / 2 - 60, y: ownerScene.y + ownerScene.height + 90}
          : expected === 'attribute'
            ? {x: ownerScene.x, y: ownerScene.y + ownerScene.height + 50}
            : {x: ownerScene.x + ownerScene.width / 2 - 60, y: ownerScene.y - 90 - 46};
        placeNewNode(node, desired);
        changes.push({changeIndex: index, kind: 'create', target: {collection: 'drawingSemantic', id: node.id, localKey: change.localKey, type: 'attribute'}, after: {name, kind: node.kind, key: node.key, owner: node.owner}});
        return;
      }
      case 'rename': {
        const node = resolveRef(change.target, `${label} target`);
        if (!node) return;
        if (!inSelection(node.id, `${label} target`)) return;
        if (!requireUnlocked(node, `${label} target`)) return;
        const name = trimText(change.name);
        if (!name || name.length > 240) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} name must be 1..240 chars`)); return;}
        const before = node.name;
        node.name = name;
        const scene = sceneFor(node);
        if (scene && scene.annotations && scene.annotations.length) delete scene.annotations; // 文本区间随旧名失效
        changes.push({changeIndex: index, kind: 'update', target: {collection: 'drawingSemantic', id: node.id, type: nodeType(node)}, before: {name: before}, after: {name}});
        return;
      }
      case 'connectRole': {
        const rel = resolveRef(change.relationship, `${label} relationship`);
        if (!rel) return;
        if (nodeType(rel) !== 'relationship') {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} relationship target is not a relationship`)); return;}
        if (!inSelection(rel.id, `${label} relationship`)) return;
        if (!requireUnlocked(rel, `${label} relationship`)) return;
        const draft = change.role || {};
        if (!draft.localKey) {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label} role localKey missing`)); return;}
        const entity = resolveRef(draft.entity, `${label} role.entity`);
        if (!entity) return;
        if (nodeType(entity) !== 'entity') {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} role.entity is not an entity`)); return;}
        if (!inSelection(entity.id, `${label} role.entity`)) return;
        if (!requireUnlocked(entity, `${label} role.entity`)) return;
        const roleNode = validateRoleDraft(draft, rel.kind, entity, `${label} role`, issues);
        if (!roleNode) return;
        roleNode.id = allocateId('role');
        const before = rel.roles.map(r => r.id);
        rel.roles.push(roleNode);
        idMap[draft.localKey] = {id: roleNode.id, type: 'role'};
        changes.push({changeIndex: index, kind: 'create', target: {collection: 'drawingSemantic', id: roleNode.id, localKey: draft.localKey, type: 'role', roleOf: rel.id}, after: {entityId: entity.id, cardinality: roleNode.cardinality, participation: roleNode.participation}});
        changes.push({changeIndex: index, kind: 'update', target: {collection: 'drawingSemantic', id: rel.id, type: 'relationship'}, before: {roles: before}, after: {roles: rel.roles.map(r => r.id)}});
        return;
      }
      case 'remove': {
        const node = resolveRef(change.target, `${label} target`);
        if (!node) return;
        if (!inSelection(node.id, `${label} target`)) return;
        if (isLockedNode(page, node.id)) {issues.push(blocking('LOCKED_GRAPH_OBJECT', `${label} target (${node.id}) is locked`)); return;}
        // 级联也受锁定/选区保护：先算级联范围，任何级联受害者被锁或在选区外 → 阻断整个删除
        const cascadedIds = new Set();
        let growing = true;
        while (growing) {
          growing = false;
          page.erModel.attributes.forEach(a => {
            if (!cascadedIds.has(a.id) && cascadedIds.has(a.owner.id) || a.owner.id === node.id && !cascadedIds.has(a.id)) {
              cascadedIds.add(a.id);
              growing = true;
            }
          });
        }
        cascadedIds.delete(node.id);
        for (const victimId of cascadedIds) {
          if (isLockedNode(page, victimId)) {issues.push(blocking('LOCKED_GRAPH_OBJECT', `${label} cascade victim (${victimId}) is locked; unlock it or include it in the review scope`)); return;}
          if (!inSelection(victimId, `${label} cascade victim`)) return;
        }
        // 幸存联系上被裁剪的角色：其所属联系被锁/越选区同样阻断
        if (nodeType(node) === 'entity') {
          for (const rel of page.erModel.relationships) {
            if (!rel.roles.some(r => r.entityId === node.id)) continue;
            if (isLockedNode(page, rel.id)) {issues.push(blocking('LOCKED_GRAPH_OBJECT', `${label} cascade touches roles of locked relationship (${rel.id})`)); return;}
            if (!inSelection(rel.id, `${label} cascade role owner`)) return;
          }
        }
        const semanticBefore = semanticAll(page);
        const beforeNode = nodeById(page, node.id);
        const next = D.removeSemantic(page, [node.id]);
        const survivors = semanticAll(next);
        const cascaded = semanticBefore.filter(n => n.id !== node.id && !survivors.some(s => s.id === n.id));
        const removedRoles = [];
        semanticBefore.forEach(beforeRel => {
          if (beforeRel.roles === undefined) return;
          const afterRel = survivors.find(s => s.id === beforeRel.id);
          if (!afterRel) return;
          beforeRel.roles.forEach(role => {if (!afterRel.roles.some(r => r.id === role.id)) removedRoles.push({relationship: beforeRel, role});});
        });
        page = next;
        doc.pages[pageIndex] = page;
        planner.reset(page); // 后续 add/layout 需要最新占位
        changes.push({changeIndex: index, kind: 'remove', target: {collection: 'drawingSemantic', id: node.id, type: nodeType(beforeNode)}, before: {name: beforeNode.name, kind: beforeNode.kind, key: beforeNode.key, owner: beforeNode.owner}});
        cascaded.forEach(victim => changes.push({changeIndex: index, kind: 'remove', target: {collection: 'drawingSemantic', id: victim.id, type: nodeType(victim)}, before: {name: victim.name, kind: victim.kind, cascade: true}}));
        removedRoles.forEach(entry => changes.push({changeIndex: index, kind: 'update', target: {collection: 'drawingSemantic', id: entry.relationship.id, type: 'relationship'}, before: {roles: entry.relationship.roles.map(r => r.id)}, after: {roles: survivors.find(s => s.id === entry.relationship.id).roles.map(r => r.id)}}));
        return;
      }
      case 'setAppearance': {
        const themeId = change.themeId;
        const styleId = change.styleId;
        if (!THEME_IDS.includes(themeId)) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} unknown themeId: ${themeId}`)); return;}
        if (!STYLE_IDS.includes(styleId)) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} unknown styleId: ${styleId}`)); return;}
        const targets = Array.isArray(change.targets) ? change.targets : [];
        if (!targets.length || targets.length > 150) {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label} needs 1..150 targets`)); return;}
        const nodes = [];
        for (const ref of targets) {
          const node = resolveRef(ref, `${label} targets`);
          if (!node) return;
          if (!inSelection(node.id, `${label} targets`)) return;
          if (!requireUnlocked(node, `${label} targets`)) return;
          nodes.push(node);
        }
        const theme = D.chenThemes[themeId];
        nodes.forEach(node => {
          const scene = sceneFor(node);
          if (!scene) {issues.push(blocking('INVALID_CHEN_SEMANTICS', `${label} target ${node.id} has no scene entry`)); return;}
          const before = {fill: scene.style?.fill, stroke: scene.style?.stroke, renderStyle: scene.style?.renderStyle};
          const uiKind = uiKindOfNode(node);
          const colors = theme[D.chenRoleOf(uiKind)] || theme.basic;
          scene.style = {...(scene.style || {}), fill: colors.fill, stroke: colors.stroke};
          if (styleId === 'standard') delete scene.style.renderStyle;
          else scene.style.renderStyle = styleId;
          changes.push({changeIndex: index, kind: 'update', target: {collection: 'drawingSemantic', id: node.id, type: nodeType(node)}, before, after: {fill: scene.style.fill, stroke: scene.style.stroke, renderStyle: scene.style.renderStyle}});
        });
        return;
      }
      case 'layout': {
        if (change.preserveOthers !== true) {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label} preserveOthers must be true`)); return;}
        if (!['LR', 'TB'].includes(change.direction)) {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label} direction must be LR|TB`)); return;}
        const targets = Array.isArray(change.targets) ? change.targets : [];
        if (!targets.length || targets.length > 150) {issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label} needs 1..150 targets`)); return;}
        const nodes = [];
        for (const ref of targets) {
          const node = resolveRef(ref, `${label} targets`);
          if (!node) return;
          if (!inSelection(node.id, `${label} targets`)) return;
          if (!requireUnlocked(node, `${label} targets`)) return;
          nodes.push(node);
        }
        const ordered = nodes.slice().sort((a, b) => {
          const sa = sceneFor(a); const sb = sceneFor(b);
          return (sa.y - sb.y) || (sa.x - sb.x) || a.id.localeCompare(b.id);
        });
        const first = sceneFor(ordered[0]);
        let cursorX = first.x;
        let cursorY = first.y;
        ordered.forEach(node => {
          const scene = sceneFor(node);
          const before = {x: scene.x, y: scene.y};
          if (change.direction === 'LR') {
            scene.x = cursorX; scene.y = first.y;
            cursorX += scene.width + 200;
          } else {
            scene.x = first.x; scene.y = cursorY;
            cursorY += scene.height + 120;
          }
          changes.push({changeIndex: index, kind: 'update', target: {collection: 'drawingSemantic', id: node.id, type: nodeType(node)}, before, after: {x: scene.x, y: scene.y}});
        });
        planner.reset(page); // 移动后刷新占位，保证后续新增避让
        return;
      }
      default:
        issues.push(blocking('OUTPUT_SCHEMA_INVALID', `${label} unknown change kind: ${change.kind}`));
    }
  });
  if (issues.length) return null;
  const finalErrors = D.errors(doc).filter(code => !baseErrors.has(code));
  if (finalErrors.length) {
    issues.push(blocking('INVALID_CHEN_SEMANTICS', `patched page fails drawing validation: ${finalErrors.join(', ')}`));
    return null;
  }
  (D.warnings(page) || []).forEach(w => warnings.push(warning(w.code, `${w.code} on ${w.id}`, {nodeId: w.id})));
  return {document: doc, page, changes, idMap};
};

const compile = input => {
  const issues = [];
  const warnings = [];
  const command = input?.command;
  if (!SUPPORTED_COMMANDS.includes(command)) {
    return {ok: false, issues: [blocking('CAPABILITY_UNAVAILABLE', `unknown drawing command: ${command}`)], changes: [], idMap: {}};
  }
  const args = input?.args;
  if (!args || typeof args !== 'object') {
    return {ok: false, issues: [blocking('OUTPUT_SCHEMA_INVALID', 'args must be an object')], changes: [], idMap: {}};
  }
  scanUnsafe(args, 'args', issues);
  const scope = input?.scope;
  const document = input?.document;
  if (scope?.documentId && document && document.id && scope.documentId !== document.id) {
    issues.push(blocking('PLAN_STALE', `scope.documentId ${scope.documentId} does not match document ${document.id}`));
  }
  if (scope && scope.platform !== undefined && scope.platform !== 'drawing') {
    issues.push(blocking('CAPABILITY_UNAVAILABLE', `scope.platform must be drawing, got ${scope.platform}`));
  }
  if (issues.length) return {ok: false, issues, changes: [], idMap: {}};
  const allocateId = typeof input?.allocateId === 'function' ? input.allocateId : (prefix => D.id(prefix || 'er'));
  const result = command === 'drawing.chen.patch'
    ? compilePatch(command, args, {document, bindings: input?.bindings}, allocateId, scope, issues, warnings)
    : compileCreate(command, args, {document, source: input?.source}, allocateId, scope, issues, warnings);
  if (!result || issues.length) return {ok: false, issues: issues.length ? issues : [blocking('INVALID_CHEN_SEMANTICS', 'compilation rejected')], changes: [], idMap: {}};
  return {ok: true, document: result.document, page: result.page, changes: result.changes, warnings, idMap: result.idMap};
};

const compileChenCommand = input => {
  try {
    return compile(input);
  } catch (error) {
    return {ok: false, issues: [blocking('OUTPUT_SCHEMA_INVALID', `compiler rejected input: ${error && error.message}`)], changes: [], idMap: {}};
  }
};

module.exports = {compileChenCommand, SUPPORTED_COMMANDS};
