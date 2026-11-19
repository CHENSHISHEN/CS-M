// DATA-WB-FEAT-003：概念-逻辑显式关联纯函数层（design/model-platform-v2/CONCEPT-LINKS.md）。
// 数据合同：profile.modelCatalog.conceptLogicalLinks = [
//   {id, conceptEntityId, logicalEntityId, description?,
//    unresolvedConcept?: {id,defKey,defName}, unresolvedLogical?: {id,defKey,defName}}
// ]
// 组合 (conceptEntityId, logicalEntityId) 唯一，显式多对多；端点缺失或带 unresolved
// 标识时该边按失效处理（失效由端点存在性计算，从不持久化 valid 标记）。
// 本层只做纯读写与导入重映射，不建第二份状态；UI 层用最新有效源一次事务提交。
// 注：构建链 babel/webpack4 不识别 ??，本文件一律使用 == null 三元（同 model_catalog F1）。

export const CONCEPT_LOGICAL_LINKS_KEY = 'conceptLogicalLinks';

export const readConceptLogicalLinks = (source) =>
  (source == null ? [] : (source.profile == null ? []
    : (source.profile.modelCatalog == null ? []
      : (source.profile.modelCatalog.conceptLogicalLinks || []))));

const findConcept = (source, id) =>
  (id == null ? null : ((source == null ? [] : (source.conceptEntities || []))
    .filter(c => c.id === id)[0] || null));
const findLogic = (source, id) =>
  (id == null ? null : ((source == null ? [] : (source.logicEntities || []))
    .filter(l => l.id === id)[0] || null));

// 端点身份：对象在当前项目且无 unresolved 标识 → {id, defKey, defName, present:true}；
// 不在或带 unresolved 标识 → 按 unresolved 标识保留最小身份（present:false），
// 即使目标项目恰好存在同号对象也不误显为已解析当前对象
const conceptIdentity = (source, link) => {
  if (link.unresolvedConcept == null) {
    const object = findConcept(source, link.conceptEntityId);
    if (object) {
      return {id: object.id, defKey: object.defKey, defName: object.defName, present: true};
    }
  }
  const mark = link.unresolvedConcept;
  return {
    id: mark == null ? link.conceptEntityId : mark.id,
    defKey: mark == null ? '' : mark.defKey,
    defName: mark == null ? '' : mark.defName,
    present: false,
  };
};
const logicIdentity = (source, link) => {
  if (link.unresolvedLogical == null) {
    const object = findLogic(source, link.logicalEntityId);
    if (object) {
      return {id: object.id, defKey: object.defKey, defName: object.defName, present: true};
    }
  }
  const mark = link.unresolvedLogical;
  return {
    id: mark == null ? link.logicalEntityId : mark.id,
    defKey: mark == null ? '' : mark.defKey,
    defName: mark == null ? '' : mark.defName,
    present: false,
  };
};

// 失效边 = 任一端点不在当前项目，或任一端点带 unresolved 标识
// （只要有 unresolved 标识即失效，即使端点 id 恰好命中现存对象——导入撞号不得复活）
export const isLinkEffective = (source, link) =>
  link != null && link.unresolvedConcept == null && link.unresolvedLogical == null
    && findConcept(source, link.conceptEntityId) != null
    && findLogic(source, link.logicalEntityId) != null;

// 全量解析：[{link, valid, concept, logic}]，concept/logic 为端点身份描述
export const resolveConceptLogicalLinks = (source) =>
  readConceptLogicalLinks(source).map(link => ({
    link,
    valid: isLinkEffective(source, link),
    concept: conceptIdentity(source, link),
    logic: logicIdentity(source, link),
  }));

export const linksForConcept = (source, conceptId) =>
  resolveConceptLogicalLinks(source)
    .filter(row => row.link.conceptEntityId === conceptId);

export const linksForLogic = (source, logicalId) =>
  resolveConceptLogicalLinks(source)
    .filter(row => row.link.logicalEntityId === logicalId);

// 删除影响（shell 各删除入口统一调用）：只统计端点确实指向被删对象、且该对象在当前
// 项目仍存在的边；陈旧失效边（端点对象早已删除）不属于任何现存实体，不计入
export const linkDeletionImpact = (source, ids) => {
  const conceptIds = new Set((ids == null ? {} : ids).conceptIds || []);
  const logicalIds = new Set((ids == null ? {} : ids).logicalIds || []);
  const links = readConceptLogicalLinks(source)
    .filter(link => (link.conceptEntityId != null && conceptIds.has(link.conceptEntityId)
        && findConcept(source, link.conceptEntityId) != null)
      || (link.logicalEntityId != null && logicalIds.has(link.logicalEntityId)
        && findLogic(source, link.logicalEntityId) != null))
    .map(link => ({...link}));
  return {count: links.length, links};
};

// S2 稳定来源：物理表只认 logicalEntityId，不按相似名称补线
export const physicalSourcesForLogic = (source, logicalId) =>
  (source == null ? [] : (source.entities || []))
    .filter(e => e.logicalEntityId === logicalId);

// 总览统计：分子 = 至少一条有效边触碰的唯一逻辑实体数（多概念只计一次）；
// 分母 = 唯一逻辑实体 id 数（重复 id 只计一次）；另列失效边待处理数
export const conceptLinkedLogicStats = (source) => {
  const rows = resolveConceptLogicalLinks(source);
  const linked = new Set(rows.filter(row => row.valid).map(row => row.link.logicalEntityId));
  const invalid = rows.filter(row => !row.valid).length;
  const total = new Set((source == null ? [] : (source.logicEntities || []))
    .map(logic => logic.id)).size;
  return {linkedLogicCount: linked.size, totalLogicCount: total, invalidLinkCount: invalid};
};

// ---- 写命令（纯函数，返回新 source；重复/类型不符抛错由调用方提示） ----

const writeLinks = (source, links) => ({
  ...source,
  profile: {
    ...(source == null ? {} : source.profile),
    modelCatalog: {
      ...(source == null ? {} : (source.profile == null ? {} : source.profile.modelCatalog)),
      [CONCEPT_LOGICAL_LINKS_KEY]: links,
    },
  },
});

const normalizeLink = (link) => ({
  id: link.id || Math.uuid(),
  conceptEntityId: link.conceptEntityId == null ? null : link.conceptEntityId,
  logicalEntityId: link.logicalEntityId == null ? null : link.logicalEntityId,
  ...(link.description == null ? {} : {description: link.description}),
  ...(link.unresolvedConcept == null ? {} : {unresolvedConcept: link.unresolvedConcept}),
  ...(link.unresolvedLogical == null ? {} : {unresolvedLogical: link.unresolvedLogical}),
});

// 组合端点去重键：null 端点按 unresolved 来源 id 区分，不同失效来源不误合并
const linkPairKey = (link) => {
  const concept = link.conceptEntityId != null ? link.conceptEntityId
    : `unresolved:${link.unresolvedConcept == null ? '' : link.unresolvedConcept.id}`;
  const logic = link.logicalEntityId != null ? link.logicalEntityId
    : `unresolved:${link.unresolvedLogical == null ? '' : link.unresolvedLogical.id}`;
  return `${concept}::${logic}`;
};

const requireEndpoints = (source, conceptEntityId, logicalEntityId) => {
  if (findConcept(source, conceptEntityId) == null) {
    throw new Error('unknown concept entity endpoint');
  }
  if (findLogic(source, logicalEntityId) == null) {
    throw new Error('unknown logical entity endpoint');
  }
};

// 新增关联：端点必须存在且类型正确（不接受物理表 ID），组合唯一
export const addConceptLogicalLinks = (source, additions) => {
  const current = readConceptLogicalLinks(source);
  const existing = new Set(current.map(linkPairKey));
  const added = (additions || []).map((addition) => {
    requireEndpoints(source, addition.conceptEntityId, addition.logicalEntityId);
    const link = normalizeLink(addition);
    const key = linkPairKey(link);
    if (existing.has(key)) throw new Error('duplicate concept logical link pair');
    existing.add(key);
    return link;
  });
  if (!added.length) return source;
  return writeLinks(source, current.concat(added));
};

// 解除关联：只删边，保留两端实体
export const removeConceptLogicalLinks = (source, linkIds) => {
  const ids = new Set(linkIds || []);
  const current = readConceptLogicalLinks(source);
  if (!ids.size || !current.some(link => ids.has(link.id))) return source;
  return writeLinks(source, current.filter(link => !ids.has(link.id)));
};

// 编辑说明或重选端点：纯说明编辑不改端点，保留失效端点 id 与 unresolved 标识
// （有效性由 isLinkEffective 按端点存在性实时计算，保持失效）；重选保留边 ID 与
// 原说明（patch 未显式给 description 时），重选后清除该端失效标识。
// 存在性/类型/组合唯一校验只针对本次真正重选的端点，未改动的另一端即使已失效也不阻断
export const updateConceptLogicalLink = (source, linkId, patch) => {
  const current = readConceptLogicalLinks(source);
  const index = current.findIndex(link => link.id === linkId);
  if (index < 0) return source;
  const old = current[index];
  const conceptEntityId = patch.conceptEntityId === undefined
    ? old.conceptEntityId : patch.conceptEntityId;
  const logicalEntityId = patch.logicalEntityId === undefined
    ? old.logicalEntityId : patch.logicalEntityId;
  // 仅端点被真正重选（patch 给出且与旧值不同的非空 id）时校验存在性与类型；
  // 显式置 null/未改动/重选回原值均不触发（保持原失效状态）
  if (patch.conceptEntityId != null && patch.conceptEntityId !== old.conceptEntityId
    && findConcept(source, patch.conceptEntityId) == null) {
    throw new Error('unknown concept entity endpoint');
  }
  if (patch.logicalEntityId != null && patch.logicalEntityId !== old.logicalEntityId
    && findLogic(source, patch.logicalEntityId) == null) {
    throw new Error('unknown logical entity endpoint');
  }
  const next = normalizeLink({
    ...old,
    ...patch,
    id: old.id,
    conceptEntityId,
    logicalEntityId,
    description: patch.description === undefined ? old.description : patch.description,
    // 端点换新且有效即丢弃失效标识；仍缺失时不携带旧 unresolved
    unresolvedConcept: patch.conceptEntityId === undefined ? old.unresolvedConcept : null,
    unresolvedLogical: patch.logicalEntityId === undefined ? old.unresolvedLogical : null,
  });
  const key = linkPairKey(next);
  if (current.some((link, i) => i !== index && linkPairKey(link) === key)) {
    throw new Error('duplicate concept logical link pair');
  }
  const links = current.slice();
  links[index] = next;
  return writeLinks(source, links);
};

// ---- 导入/合并 ID 重映射 ----
// 端点解析：marker 为集合项上的来源标识键（reduce 用 [type]，merge 用 old）。
// 命中顺序：1) 标记匹配（merge 并入项 old=导入id / reduce old 模式直连）；
// 2) 来源集合中存在该 id 时：按 defKey 再按标记匹配（reduce defKey 模式）、
//    或命中无标记的同 id 项（merge 追加项）；来源不存在则一律 unresolved，
//    绝不回退裸 id（禁止目标项目同号误绑）。
const resolveEndpoint = (endpointId, collection, marker, identitySource) => {
  if (endpointId == null) return {resolved: false, id: null};
  const items = collection || [];
  const hit = items.filter(item => item[marker] === endpointId)[0];
  if (hit) return {resolved: true, id: hit.id};
  const identityObject = (identitySource || []).filter(item => item.id === endpointId)[0];
  const identity = identityObject == null
    ? {id: endpointId, defKey: '', defName: ''}
    : {id: identityObject.id, defKey: identityObject.defKey, defName: identityObject.defName};
  if (identityObject != null) {
    if (identityObject.defKey) {
      const byKey = items.filter(item => item[marker] === identityObject.defKey)[0];
      if (byKey) return {resolved: true, id: byKey.id};
    }
    const appended = items.filter(item => item[marker] == null && item.id === endpointId)[0];
    if (appended) return {resolved: true, id: appended.id};
  }
  return {resolved: false, id: null, identity};
};

// reduce（导入重构/旧版本升级）：边 ID 重新分配；缺来源端点置 null 并保留最小身份
export const remapConceptLogicalLinksForReduce = (links, context) => {
  const marker = context.marker || 'old';
  return (links || []).map((link) => {
    const concept = resolveEndpoint(link.conceptEntityId,
      context.concepts, marker, context.sourceConcepts);
    const logic = resolveEndpoint(link.logicalEntityId,
      context.logics, marker, context.sourceLogics);
    const next = normalizeLink({
      id: Math.uuid(),
      conceptEntityId: concept.resolved ? concept.id : null,
      logicalEntityId: logic.resolved ? logic.id : null,
      description: link.description,
      unresolvedConcept: concept.resolved ? null : (concept.identity || link.unresolvedConcept),
      unresolvedLogical: logic.resolved ? null : (logic.identity || link.unresolvedLogical),
    });
    if (next.unresolvedConcept == null) delete next.unresolvedConcept;
    if (next.unresolvedLogical == null) delete next.unresolvedLogical;
    return next;
  });
};

// merge（合并进目标项目）：目标边原样保留；导入边经标记映射，换新边 ID 后按端点对
// 去重（目标已有同端点对边时保留目标边）；导入侧不存在的端点（撞目标同号也不认）
// → null + 最小身份
export const mergeConceptLogicalLinkCollections = (targetLinks, importedLinks, context) => {
  const marker = context.marker || 'old';
  const targets = (targetLinks || []).slice();
  const keys = new Set(targets.map(linkPairKey));
  (importedLinks || []).forEach((link) => {
    const concept = resolveEndpoint(link.conceptEntityId,
      context.concepts, marker, context.importedConcepts);
    const logic = resolveEndpoint(link.logicalEntityId,
      context.logics, marker, context.importedLogics);
    const next = normalizeLink({
      id: Math.uuid(),
      conceptEntityId: concept.resolved ? concept.id : null,
      logicalEntityId: logic.resolved ? logic.id : null,
      description: link.description,
      unresolvedConcept: concept.resolved ? null : (concept.identity || link.unresolvedConcept),
      unresolvedLogical: logic.resolved ? null : (logic.identity || link.unresolvedLogical),
    });
    if (next.unresolvedConcept == null) delete next.unresolvedConcept;
    if (next.unresolvedLogical == null) delete next.unresolvedLogical;
    const key = linkPairKey(next);
    if (keys.has(key)) return; // 目标已有同端点对边：保留目标边，不重复
    keys.add(key);
    targets.push(next);
  });
  return targets;
};
