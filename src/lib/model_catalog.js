// Catalog operations return a new source; model objects and diagrams retain their identity.
export const CATALOG_MEMBER_TYPES = [
  'conceptEntity', 'logicEntity', 'entity', 'diagram', 'view', 'dict',
];

const collections = {
  conceptEntity: 'conceptEntities',
  logicEntity: 'logicEntities',
  entity: 'entities',
  diagram: 'diagrams',
  view: 'views',
  dict: 'dicts',
};
const refs = {
  conceptEntity: 'refConceptEntities',
  logicEntity: 'refLogicEntities',
  entity: 'refEntities',
  diagram: 'refDiagrams',
  view: 'refViews',
  dict: 'refDicts',
};
const emptyMembers = () => CATALOG_MEMBER_TYPES.reduce((all, type) => ({...all, [type]: []}), {});
const unique = ids => [...new Set(ids || [])];

export const readCatalog = (source) => {
  const catalog = source?.profile?.modelCatalog;
  return {
    version: catalog?.version || 1,
    layers: catalog?.layers || [],
    categories: catalog?.categories || [],
  };
};

const writeCatalog = (source, catalog) => ({
  ...source,
  profile: {...source?.profile, modelCatalog: {...source?.profile?.modelCatalog, ...catalog}},
});

export const getCatalogCategories = (source) => {
  const categories = readCatalog(source).categories;
  const mounted = new Set(categories.map(category => category.legacyGroupId).filter(Boolean));
  return categories.concat((source?.viewGroups || [])
    .filter(group => !mounted.has(group.id))
    .map(group => ({
      id: group.id,
      legacyGroupId: group.id,
      layerId: null,
      kind: 'subject',
      defKey: group.defKey,
      defName: group.defName,
      members: emptyMembers(),
    })));
};

const findCategory = (source, categoryOrId) => {
  const id = typeof categoryOrId === 'object' ? categoryOrId?.id : categoryOrId;
  return getCatalogCategories(source).find(category => category.id === id)
    || (typeof categoryOrId === 'object' ? categoryOrId : null);
};

const memberIds = (source, category, type) => {
  if (category?.legacyGroupId) {
    const group = (source?.viewGroups || []).find(item => item.id === category.legacyGroupId);
    return unique(group?.[refs[type]]);
  }
  return unique(category?.members?.[type]);
};

export const categoryObjects = (source, categoryOrId) => {
  const category = findCategory(source, categoryOrId);
  return CATALOG_MEMBER_TYPES.reduce((result, type) => {
    const objects = new Map((source?.[collections[type]] || []).map(item => [item.id, item]));
    return {
      ...result,
      [type]: memberIds(source, category, type).map(id => objects.get(id)).filter(Boolean),
    };
  }, {});
};

export const uncategorizedObjects = (source) => {
  const categories = getCatalogCategories(source);
  return CATALOG_MEMBER_TYPES.reduce((result, type) => {
    const assigned = new Set(categories.reduce((ids, category) =>
      ids.concat(memberIds(source, category, type)), []));
    return {
      ...result,
      [type]: (source?.[collections[type]] || []).filter(item => !assigned.has(item.id)),
    };
  }, {});
};

const requireLayer = (catalog, id) => {
  if (id != null && !catalog.layers.some(layer => layer.id === id)) {
    throw new Error(`Unknown catalog layer: ${id}`);
  }
};
const requireCategory = (source, id) => {
  const category = findCategory(source, id);
  if (!category) throw new Error(`Unknown catalog category: ${id}`);
  return category;
};
const requireId = (id) => {
  if (!id) throw new Error('Catalog IDs must be supplied by the caller');
};
const requireKind = (kind) => {
  if (!['domain', 'subject'].includes(kind)) throw new Error(`Unknown category kind: ${kind}`);
};
const names = (patch, current) => ({
  defKey: patch.defKey === undefined ? current.defKey : patch.defKey,
  defName: patch.defName === undefined ? current.defName : patch.defName,
});
const insert = (items, item, index) => {
  const result = items.slice();
  const position = index == null ? result.length : Math.max(0, Math.min(index, result.length));
  result.splice(position, 0, item);
  return result;
};

export const createLayer = (source, layer) => {
  const catalog = readCatalog(source);
  requireId(layer.id);
  if (catalog.layers.some(item => item.id === layer.id)) throw new Error('Duplicate layer ID');
  return writeCatalog(source, {
    ...catalog,
    layers: catalog.layers.concat({
      id: layer.id, defKey: layer.defKey || '', defName: layer.defName || '',
    }),
  });
};

export const updateLayer = (source, id, patch) => {
  const catalog = readCatalog(source);
  requireLayer(catalog, id);
  return writeCatalog(source, {
    ...catalog,
    layers: catalog.layers.map(layer =>
      (layer.id === id ? {...layer, ...names(patch, layer)} : layer)),
  });
};

// Removing a layer leaves its categories unmounted and every model object reachable.
export const deleteLayer = (source, id) => {
  const catalog = readCatalog(source);
  return writeCatalog(source, {
    ...catalog,
    layers: catalog.layers.filter(layer => layer.id !== id),
    categories: catalog.categories.map(category =>
      (category.layerId === id ? {...category, layerId: null} : category)),
  });
};

export const moveLayer = (source, id, index) => {
  const catalog = readCatalog(source);
  requireLayer(catalog, id);
  const layer = catalog.layers.find(item => item.id === id);
  return writeCatalog(source, {...catalog,
    layers: insert(catalog.layers.filter(item => item.id !== id), layer, index)});
};

export const createCategory = (source, category) => {
  const catalog = readCatalog(source);
  requireId(category.id);
  requireLayer(catalog, category.layerId);
  requireKind(category.kind || 'domain');
  if (getCatalogCategories(source).some(item => item.id === category.id)) {
    throw new Error('Duplicate category ID');
  }
  if (category.legacyGroupId) throw new Error('Use attachLegacyGroup for legacy categories');
  const members = CATALOG_MEMBER_TYPES.reduce((all, type) =>
    ({...all, [type]: unique(category.members?.[type])}), {});
  return writeCatalog(source, {
    ...catalog,
    categories: catalog.categories.concat({
      id: category.id,
      layerId: category.layerId == null ? null : category.layerId,
      kind: category.kind || 'domain',
      defKey: category.defKey || '',
      defName: category.defName || '',
      members,
    }),
  });
};

export const updateCategory = (source, id, patch) => {
  const category = requireCategory(source, id);
  const catalog = readCatalog(source);
  const kind = patch.kind || category.kind;
  requireKind(kind);
  const layerId = patch.layerId === undefined ? category.layerId : patch.layerId;
  requireLayer(catalog, layerId);
  const updated = {...category, ...names(patch, category), kind, layerId};
  const categories = catalog.categories.some(item => item.id === id)
    ? catalog.categories.map(item => (item.id === id ? updated : item))
    : catalog.categories.concat(updated);
  const next = writeCatalog(source, {...catalog, categories});
  return category.legacyGroupId ? {...next,
    viewGroups: (source.viewGroups || []).map(group => (group.id === category.legacyGroupId
      ? {...group, ...names(patch, group)} : group)),
  } : next;
};

export const deleteCategory = (source, id) => {
  const category = findCategory(source, id);
  if (!category) return source;
  const catalog = readCatalog(source);
  const next = writeCatalog(source, {...catalog,
    categories: catalog.categories.filter(item => item.id !== id)});
  // Otherwise the removed legacy category would immediately reappear as a projection.
  const withoutLegacy = category.legacyGroupId ? {...next,
    viewGroups: (source.viewGroups || []).filter(group => group.id !== category.legacyGroupId),
  } : next;
  // 删除分类后其物理模型库不删除：categoryId 置空回未归类，容器与对象仍可达
  return detachPhysicalDatabasesFromCategory(withoutLegacy, id);
};

// index is relative to categories in the destination layer, rather than the global array.
export const moveCategory = (source, id, layerId, index) => {
  const next = updateCategory(source, id, {layerId});
  const catalog = readCatalog(next);
  const category = catalog.categories.find(item => item.id === id);
  const others = catalog.categories.filter(item => item.id !== id);
  const siblings = others.filter(item => item.layerId === layerId);
  const target = siblings[index == null ? siblings.length : Math.max(0, index)];
  const appendPosition = siblings.length
    ? others.indexOf(siblings[siblings.length - 1]) + 1 : others.length;
  const position = target ? others.indexOf(target) : appendPosition;
  return writeCatalog(next, {...catalog, categories: insert(others, category, position)});
};

export const attachLegacyGroup = (source, groupId, layerId, patch = {}) => {
  const group = (source?.viewGroups || []).find(item => item.id === groupId);
  if (!group) throw new Error(`Unknown legacy group: ${groupId}`);
  const mounted = readCatalog(source).categories.find(item => item.legacyGroupId === groupId);
  return updateCategory(source, mounted?.id || groupId, {...patch, layerId});
};

const changeMembers = (source, categoryId, type, ids, add) => {
  if (!CATALOG_MEMBER_TYPES.includes(type)) throw new Error(`Unknown catalog member type: ${type}`);
  const category = requireCategory(source, categoryId);
  const current = memberIds(source, category, type);
  const selected = unique(ids);
  const nextIds = add ? unique(current.concat(selected))
    : current.filter(id => !selected.includes(id));
  if (category.legacyGroupId) {
    return {
      ...source,
      viewGroups: (source.viewGroups || []).map(group =>
        (group.id === category.legacyGroupId ? {...group, [refs[type]]: nextIds} : group)),
    };
  }
  const catalog = readCatalog(source);
  return writeCatalog(source, {
    ...catalog,
    categories: catalog.categories.map(item =>
      (item.id === categoryId ? {...item, members: {...item.members, [type]: nextIds}} : item)),
  });
};

export const addCategoryMembers = (source, categoryId, type, ids) =>
  changeMembers(source, categoryId, type, ids, true);

export const removeCategoryMembers = (source, categoryId, type, ids) =>
  changeMembers(source, categoryId, type, ids, false);

export const moveCategoryMembers = (source, fromId, toId, type, ids) => {
  if (fromId === toId) return source;
  const from = requireCategory(source, fromId);
  requireCategory(source, toId);
  const current = memberIds(source, from, type);
  const moving = unique(ids).filter(id => current.includes(id));
  const added = addCategoryMembers(source, toId, type, moving);
  return removeCategoryMembers(added, fromId, type, moving);
};

// S1 整改 F4：新建对象写入对应集合；仅当给出有效分类 id 时才挂接分类成员。
// 未归类容器上下文（categoryId 为空）允许保持未归类并继承容器 id/类型，
// 全项目没有任何分类时同样可提交（不自动创建域）
export const appendObjectWithOptionalCategory = (source, type, object, categoryId) => {
  if (!(type in collections)) throw new Error(`Unknown catalog member type: ${type}`);
  let next = {...source,
    [collections[type]]: [...(source[collections[type]] || []), object]};
  if (categoryId != null && categoryId !== '') {
    next = addCategoryMembers(next, categoryId, type, [object.id]);
  }
  return next;
};

// S1 整改 F7：目录提交（如删库撤归属）前后实体物理归属元数据差异（纯函数）。
// 仅提取 physicalDatabaseId / physicalDbTypeId 的变化（undefined=移除），
// 供 tab 缓存与内部编辑 state 做元数据级同步；不携带其他字段，
// 禁止用已保存对象整表回退草稿。图为 pickCell 保留 source 根元数据，无需同步。
const PHYSICAL_METADATA_KEYS = ['physicalDatabaseId', 'physicalDbTypeId'];
export const physicalMetadataPatches = (previous, next) => {
  const before = new Map((previous?.entities || []).map(o => [o.id, o]));
  const patches = [];
  (next?.entities || []).forEach((object) => {
    const old = before.get(object.id);
    if (!old) return;
    const metadata = {};
    let changed = false;
    PHYSICAL_METADATA_KEYS.forEach((key) => {
      if (old[key] !== object[key]) {
        metadata[key] = object[key]; // undefined 表示移除归属
        changed = true;
      }
    });
    if (changed) patches.push({id: object.id, type: 'entity', metadata});
  });
  return patches;
};

// S1 整改 F7：把元数据补丁合并进实体草稿——仅动两键，移除即 delete，
// 名称/字段/notes 等草稿内容与调用方保管的 isInit 一概不动
export const applyPhysicalMetadataPatch = (draft, patch) => {
  const merged = {...draft};
  Object.keys(patch.metadata).forEach((key) => {
    if (patch.metadata[key] === undefined) delete merged[key];
    else merged[key] = patch.metadata[key];
  });
  return merged;
};

const levels = {C: 'conceptual', L: 'logical', P: 'physical'};

// Inference is for display only: never persist it or use relationType as a model level.
export const inferDiagramLevel = (diagram, source) => {
  if (Object.values(levels).includes(diagram?.modelLevel)) return diagram.modelLevel;
  const tables = (diagram?.canvasData?.cells || []).filter(cell => cell.shape === 'table');
  if (!tables.length) return null;
  const inferred = tables.map((cell) => {
    const explicit = levels[cell.type || cell.data?.type];
    if (explicit) return explicit;
    const id = cell.originKey || cell.data?.id;
    const matches = ['conceptEntity', 'logicEntity', 'entity'].filter(type =>
      (source?.[collections[type]] || []).some(item => item.id === id));
    return matches.length === 1 ? levels[{conceptEntity: 'C', logicEntity: 'L', entity: 'P'}[matches[0]]]
      : null;
  });
  return inferred.every(level => level && level === inferred[0]) ? inferred[0] : null;
};

// ---- DATA-WB-FEAT-001 阶段A：企业级元数据与物理库分组的纯函数层 ----
// 均为可选兼容元数据：读取时回落，不改变任何既有集合/ID；写入由调用方通过
// profile.enterpriseModeling / 对象级 physicalDbTypeId 显式进行，本层不自动迁移旧数据。

// 企业级首页元数据（可选）。缺失时名称回落项目名、描述为空、概览图为空数组。
export const getEnterpriseModeling = (source) => {
  const meta = source?.profile?.enterpriseModeling || {};
  return {
    name: meta.name || source?.name || '',
    description: meta.description || '',
    overviewDiagramIds: unique(meta.overviewDiagramIds),
  };
};

// 有效数据库类型 = dataTypeSupports 中存在 dbDDL 生成模板的项（与 DbConnect 的过滤一致）。
export const physicalDbSupports = (source) => {
  const codeTemplates = source?.profile?.codeTemplates || [];
  return (source?.profile?.dataTypeSupports || [])
    .filter(support => codeTemplates.some(c => c.applyFor === support.id && c.type === 'dbDDL'));
};

export const UNSPECIFIED_DB = null;
export const UNKNOWN_DB = '__unknown_db__';

// ---- 按需物理模型库（S1 R6）：可选兼容元数据，读取回落、不自动迁移旧数据 ----

export const readPhysicalDatabases = (source) =>
  (source?.profile?.modelCatalog?.physicalDatabases || []);

const writePhysicalDatabases = (source, databases) => ({
  ...source,
  profile: {...source?.profile,
    modelCatalog: {...source?.profile?.modelCatalog, physicalDatabases: databases}},
});

const normalizeDatabaseName = (defKey) => String(defKey || '').trim();

// 库名唯一性口径：同一 categoryId（含未归类 null）内 defKey 忽略大小写唯一
// S1 整改 F1：构建链 babel 未配 nullish 插件、webpack4(acorn6) 不识别 ??，
// 新增代码一律用 ==null 三元，不用 ?? 操作符
const nullableId = (id) => (id == null ? null : id);
const findDatabaseDuplicate = (databases, categoryId, defKey, ignoreId) =>
  databases.some(db => db.id !== ignoreId
    && nullableId(db.categoryId) === nullableId(categoryId)
    && String(db.defKey || '').toLowerCase() === defKey.toLowerCase());

// 新建物理模型库容器：类型必须是有效 DDL 支持；id/名称由调用方给出，不建真实连接
export const createPhysicalDatabase = (source, database) => {
  requireId(database?.id);
  const defKey = normalizeDatabaseName(database.defKey);
  if (!defKey) throw new Error('physical database defKey required');
  const supportIds = new Set(physicalDbSupports(source).map(s => s.id));
  if (!supportIds.has(database.dbTypeId)) throw new Error('unknown physical database type');
  const databases = readPhysicalDatabases(source);
  if (databases.some(db => db.id === database.id)) throw new Error('Duplicate database ID');
  if (findDatabaseDuplicate(databases, database.categoryId, defKey)) {
    throw new Error('duplicate physical database defKey');
  }
  return writePhysicalDatabases(source, databases.concat({
    id: database.id,
    categoryId: database.categoryId == null ? null : database.categoryId,
    defKey,
    defName: normalizeDatabaseName(database.defName),
    dbTypeId: database.dbTypeId,
  }));
};

// 本期库编辑仅重命名：id/categoryId/dbTypeId 均不变（非空库禁止直接换类型伪转换）
export const renamePhysicalDatabase = (source, id, patch) => {
  const databases = readPhysicalDatabases(source);
  const current = databases.find(db => db.id === id);
  if (!current) throw new Error(`Unknown physical database: ${id}`);
  const defKey = normalizeDatabaseName(patch.defKey);
  if (!defKey) throw new Error('physical database defKey required');
  if (findDatabaseDuplicate(databases, current.categoryId, defKey, id)) {
    throw new Error('duplicate physical database defKey');
  }
  return writePhysicalDatabases(source, databases.map(db =>
    (db.id === id ? {...db, defKey, defName: normalizeDatabaseName(patch.defName)} : db)));
};

const omitKey = (obj, key) => {
  const {[key]: removed, ...rest} = obj; // eslint-disable-line no-unused-vars
  return rest;
};

// 删除模型库分组：仅撤容器归属；对象去 physicalDatabaseId、保留 physicalDbTypeId 落兼容类型组
export const deletePhysicalDatabase = (source, id) => {
  const databases = readPhysicalDatabases(source);
  if (!databases.some(db => db.id === id)) return source;
  const stripMembership = (obj) => (obj.physicalDatabaseId === id
    ? omitKey(obj, 'physicalDatabaseId') : obj);
  return {
    ...writePhysicalDatabases(source, databases.filter(db => db.id !== id)),
    entities: (source?.entities || []).map(stripMembership),
    diagrams: (source?.diagrams || []).map(stripMembership),
  };
};

// 删除分类时容器 categoryId 置空（回未归类），容器本体与其对象不动
const detachPhysicalDatabasesFromCategory = (source, categoryId) => {
  const databases = readPhysicalDatabases(source);
  if (!databases.some(db => db.categoryId === categoryId)) return source;
  return writePhysicalDatabases(source, databases.map(db =>
    (db.categoryId === categoryId ? {...db, categoryId: null} : db)));
};

// 物理对象按显式归属路由（不推断、不迁移）：
// 1. physicalDatabaseId 命中容器 → 该模型库桶（含空库，容器永显示于其分类处）；
// 2. physicalDatabaseId 非空但容器不存在 → 未知数据库回收组（归属失效，可达不丢）；
// 3. 无任何归属 → 未指定组；
// 4. 仅 physicalDbTypeId 且类型有效 → 兼容类型组（只有有对象才显示）；
// 5. 仅 physicalDbTypeId 且类型无效 → 未知数据库回收组。
export const groupPhysicalObjects = (source, objects) => {
  const supports = physicalDbSupports(source);
  const supportById = new Map(supports.map(s => [s.id, s]));
  const databases = readPhysicalDatabases(source).map(database => ({
    database, entities: [], diagrams: [],
  }));
  const databaseById = new Map(databases.map(bucket => [bucket.database.id, bucket]));
  const groups = new Map(supports.map(s => [s.id, {
    key: s.id, name: s.defName || s.defKey, support: s, entities: [], diagrams: [],
  }]));
  const unspecified = {key: UNSPECIFIED_DB, name: null, support: null, entities: [], diagrams: []};
  const unknown = {key: UNKNOWN_DB, name: null, support: null, entities: [], diagrams: []};
  const route = (o) => {
    if (o.physicalDatabaseId != null) {
      return databaseById.get(o.physicalDatabaseId) || unknown;
    }
    if (o.physicalDbTypeId == null) return unspecified;
    return groups.get(o.physicalDbTypeId) || unknown;
  };
  (objects.entity || []).forEach((o) => {
    route(o).entities.push(o);
  });
  (objects.diagram || []).filter(d => inferDiagramLevel(d, source) === 'physical')
    .forEach((d) => {
      route(d).diagrams.push(d);
    });
  return {
    databases,
    compatGroups: [...groups.values()].filter(g => g.entities.length + g.diagrams.length > 0),
    unspecified,
    unknown,
    hasUnspecified: unspecified.entities.length + unspecified.diagrams.length > 0,
    hasUnknown: unknown.entities.length + unknown.diagrams.length > 0,
  };
};

// 当前分类上下文的模型库可见性划分（S1 整改 F2，按协调者既定规则）：
// - owner 上下文：归属本分类的容器始终显示（含空库，空库只在 owner 显示）；
// - 引用上下文：有效容器被多个分类中的对象引用时，在引用对象所在的当前分类
//   同样显示原库（保留库 id/defKey/defName，可在该库下新建对象，新增对象
//   归属当前分类，不改库 owner）；判有效性看全局容器本身，不因 categoryId
//   不等于当前分类而误判失效；
// - 不引入外类库虚拟类别：调用方传入本上下文对象集合，容器桶中的对象
//   即本分类引用，对象随其源容器展示，不再需要额外回收组。
export const partitionVisibleDatabases = (physical, categoryId, categoryIds) => {
  const valid = new Set(categoryIds || []);
  const current = nullableId(categoryId);
  const visible = [];
  (physical.databases || []).forEach((bucket) => {
    const {database} = bucket;
    const owner = database.categoryId == null || !valid.has(database.categoryId)
      ? null : database.categoryId;
    const referencedHere = bucket.entities.length + bucket.diagrams.length > 0;
    if (owner === current || referencedHere) {
      visible.push(bucket);
    }
  });
  return {visible};
};

// 兼容旧引用：仅取可见容器
export const visibleDatabaseGroups = (physical, categoryId, categoryIds) =>
  partitionVisibleDatabases(physical, categoryId, categoryIds).visible;

// 概念关系图 = 显式/推断为 conceptual 的关系图（企业全局投影使用）。
export const conceptDiagrams = (source) =>
  (source?.diagrams || []).filter(d => inferDiagramLevel(d, source) === 'conceptual');

// 企业首页/全局概览节点卡片 = 全部概念关系图（自动展示，无需 pin）
// 与显式 pin 的 overviewDiagramIds 的并集（按图实例去重）。
// 旧项目无新元数据时概念图也完整可见，不会首页空白；
// 失效 pin ID（图已删）跳过显示、数据保留，不自动清理。
export const enterpriseOverviewDiagrams = (source) => {
  const pinnedIds = unique(source?.profile?.enterpriseModeling?.overviewDiagramIds);
  const diagramById = new Map((source?.diagrams || []).map(d => [d.id, d]));
  const result = [];
  const seen = new Set();
  conceptDiagrams(source).forEach((d) => {
    seen.add(d.id);
    result.push({diagram: d, pinned: pinnedIds.includes(d.id)});
  });
  pinnedIds.forEach((id) => {
    if (!seen.has(id) && diagramById.has(id)) {
      seen.add(id);
      result.push({diagram: diagramById.get(id), pinned: true});
    }
  });
  return result;
};
