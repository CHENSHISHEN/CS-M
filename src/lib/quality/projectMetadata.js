// METADATA — AI 质量规则集与词元随项目导入的重映射/合并（纯函数，无 DOM/存储）。
// reduceProject 阶段（remapProjectMetadataForReduce）：profile.quality.modelRuleSets
// 的 scope（entities/logicEntities/conceptEntities/fields+owner）与
// standardMatch.standardRefs（standardGroups/standardFields）按导入重构的 old→新
// id 映射重绑；词元 id 不在 reduce 阶段重建（wordRoots 引用原样保留），仅
// wordRoots[].baseType 按数据类型映射 old→新换绑。
// 缺映射一律不伪造绑定：受影响规则集禁用，原引用降级为可证明拒绝的
// unresolved 引用（scope id 置 null / ref kind 置 unresolved），真实引擎
// （modelRules.runModelQuality）启用后按 SCOPE_OBJECT_MISSING / standardMatch
// error 报错，绝不误检目标同号对象；原始 id 仅存 importDiagnostics 供定位。
// _mergeDataSource 阶段（mergeProjectMetadataForImport）：词元按 defName+defKey
// 归一配对复用目标 id、撞号换新 id；规则集追加进目标 quality，id 避让、
// enabled 一律 false（源启用不自动激活）；scope 按合并后集合（old 标记 =
// reduce 后 id）+ defKey 对齐重绑；源标准字段库不随项目导入（既有接缝边界），
// 其 standardRefs 一律按未解析处理并留诊断。目标已有 quality/dataRuleSets/
// 未知设置保持；源 schemaVersion 未知时显式诊断，不静默丢弃也不执行。
// 注：构建链不识别 ??，本文件一律使用 == null 三元。
import {QUALITY_SCHEMA_VERSION} from './modelRules.js';

export const IMPORT_REF_UNRESOLVED = 'IMPORT_REF_UNRESOLVED';
export const IMPORT_QUALITY_UNKNOWN_SCHEMA = 'IMPORT_QUALITY_UNKNOWN_SCHEMA';
export const IMPORT_WORDROOT_TYPE_UNRESOLVED = 'IMPORT_WORDROOT_TYPE_UNRESOLVED';

const text = (value) => {
  if (value === undefined || value === null) return '';
  return String(value);
};
const normalized = value => text(value).normalize('NFKC').trim().toLocaleLowerCase();

const SCOPE_OBJECT_COLLECTIONS = {
  entities: 'entities',
  logicEntities: 'logicEntities',
  conceptEntities: 'conceptEntities',
};

const indexByOld = (list) => {
  const map = new Map();
  (list || []).forEach((item) => {
    if (item && item.old != null) map.set(item.old, item.id);
  });
  return map;
};
const indexFieldsByOld = (entity) => {
  const map = new Map();
  ((entity && entity.fields) || []).forEach((field) => {
    if (field && field.old != null) map.set(field.old, field.id);
  });
  return map;
};

const refDiagnostic = (ref, extra) => ({
  code: IMPORT_REF_UNRESOLVED,
  ...(ref && ref.collection != null ? {collection: ref.collection} : {}),
  ...(ref && ref.id != null ? {id: ref.id} : {}),
  ...(ref && ref.owner ? {owner: ref.owner} : {}),
  message: `unresolved ${text(ref && ref.collection)}${ref && ref.id != null ? `/${ref.id}` : ''} reference on import${extra ? `: ${extra}` : ''}`,
});

// ---------- reduce 阶段 ----------

const remapQualityForReduce = (quality, collections) => {
  if (!quality || typeof quality !== 'object') return undefined;
  // 未知 schemaVersion 不在本层改写（结构未知），由合并阶段显式诊断
  if (quality.schemaVersion !== QUALITY_SCHEMA_VERSION) return undefined;
  const modelRuleSets = Array.isArray(quality.modelRuleSets) ? quality.modelRuleSets : [];
  if (!modelRuleSets.length) return undefined;
  const objectMaps = {
    entities: indexByOld(collections.entities),
    logicEntities: indexByOld(collections.logicEntities),
    conceptEntities: indexByOld(collections.conceptEntities),
  };
  const objectLists = {
    entities: collections.entities || [],
    logicEntities: collections.logicEntities || [],
    conceptEntities: collections.conceptEntities || [],
  };
  const groupMap = indexByOld(collections.standardFieldGroups);
  const standardFieldMap = new Map();
  (collections.standardFieldGroups || []).forEach((group) => {
    ((group && group.fields) || []).forEach((field) => {
      if (field && field.old != null) standardFieldMap.set(field.old, field.id);
    });
  });
  const mapScopeEntry = (entry, diagnostics) => {
    if (!entry || typeof entry !== 'object') return entry;
    if (entry.collection === 'fields') {
      const ownerCollection = entry.owner && SCOPE_OBJECT_COLLECTIONS[entry.owner.collection];
      // 未知 owner 结构原样保持，由引擎按既有合同诊断
      if (!ownerCollection) return entry;
      const ownerMapped = objectMaps[ownerCollection].get(entry.owner.id);
      if (ownerMapped == null) {
        diagnostics.push(refDiagnostic(entry));
        return {...entry, owner: {...entry.owner, id: null}, id: null, unresolved: true};
      }
      const ownerEntity = objectLists[ownerCollection].filter(o => o && o.id === ownerMapped)[0];
      const fieldMapped = ownerEntity ? indexFieldsByOld(ownerEntity).get(entry.id) : null;
      if (fieldMapped == null) {
        diagnostics.push(refDiagnostic(entry));
        return {...entry, owner: {...entry.owner, id: ownerMapped}, id: null, unresolved: true};
      }
      return {...entry, owner: {...entry.owner, id: ownerMapped}, id: fieldMapped};
    }
    if (SCOPE_OBJECT_COLLECTIONS[entry.collection]) {
      const mapped = objectMaps[entry.collection].get(entry.id);
      if (mapped == null) {
        diagnostics.push(refDiagnostic(entry));
        return {...entry, id: null, unresolved: true};
      }
      return {...entry, id: mapped};
    }
    return entry;
  };
  const mapPredicate = (predicate, diagnostics) => {
    if (!predicate || predicate.op !== 'standardMatch'
      || !Array.isArray(predicate.standardRefs)) {
      return predicate;
    }
    return {...predicate, standardRefs: predicate.standardRefs.map((ref) => {
      if (!ref || typeof ref !== 'object') return ref;
      if (ref.collection === 'standardGroups') {
        const mapped = groupMap.get(ref.id);
        if (mapped == null) {
          diagnostics.push(refDiagnostic(ref));
          return {kind: 'unresolved', collection: ref.collection};
        }
        return {...ref, id: mapped};
      }
      if (ref.collection === 'standardFields') {
        const mapped = standardFieldMap.get(ref.id);
        if (mapped == null) {
          diagnostics.push(refDiagnostic(ref));
          return {kind: 'unresolved', collection: ref.collection};
        }
        return {...ref, id: mapped};
      }
      // wordRoots 引用随词元原样保留；未知 collection 保持原样交由引擎诊断
      return ref;
    })};
  };
  return {
    ...quality,
    modelRuleSets: modelRuleSets.map((ruleSet) => {
      if (!ruleSet || typeof ruleSet !== 'object') return ruleSet;
      const diagnostics = (ruleSet.importDiagnostics || []).slice();
      const next = {
        ...ruleSet,
        scope: (ruleSet.scope || []).map(entry => mapScopeEntry(entry, diagnostics)),
        rules: (ruleSet.rules || []).map(rule => (rule && typeof rule === 'object'
          ? {...rule, predicate: mapPredicate(rule.predicate, diagnostics)} : rule)),
      };
      if (diagnostics.length) {
        next.enabled = false;
        next.importDiagnostics = diagnostics;
      }
      return next;
    }),
  };
};

const remapWordRootsForReduce = (fieldRecommendation, mappings) => {
  const roots = fieldRecommendation && fieldRecommendation.wordRoots;
  if (!fieldRecommendation || !Array.isArray(roots) || !roots.length) return undefined;
  const typeMap = indexByOld(mappings);
  const diagnostics = (fieldRecommendation.importDiagnostics || []).slice();
  const wordRoots = roots.map((root) => {
    if (!root || typeof root !== 'object' || !root.baseType) return root;
    const mapped = typeMap.get(root.baseType);
    if (mapped != null) return {...root, baseType: mapped};
    // 缺映射置空并留定位诊断，绝不保留可能命中目标同号类型的旧 id
    diagnostics.push({
      code: IMPORT_WORDROOT_TYPE_UNRESOLVED,
      rootId: root.id,
      baseType: root.baseType,
      message: `word root ${text(root.defName)}(${text(root.defKey)}) baseType ${root.baseType} unresolved on import`,
    });
    return {...root, baseType: ''};
  });
  return {
    ...fieldRecommendation,
    wordRoots,
    ...(diagnostics.length ? {importDiagnostics: diagnostics} : {}),
  };
};

// collections：reduceProject 中带 old 标记的中间集合
// {entities, logicEntities, conceptEntities, standardFieldGroups, mappings}
export const remapProjectMetadataForReduce = (project, collections) => {
  const quality = remapQualityForReduce(project && project.profile && project.profile.quality, collections);
  const fieldRecommendation = remapWordRootsForReduce(
    project && project.profile && project.profile.fieldRecommendation,
    collections == null ? [] : collections.mappings,
  );
  const result = {};
  if (quality) result.quality = quality;
  if (fieldRecommendation) result.fieldRecommendation = fieldRecommendation;
  return Object.keys(result).length ? result : null;
};

// ---------- merge 阶段 ----------

const mergeWordRoots = (targetRoots, sourceRoots, makeId) => {
  const appended = [];
  const idMap = new Map();
  const taken = new Set(targetRoots.map(root => root && root.id).filter(id => id != null));
  const pairOf = root => `${normalized(root.defName)}\0${normalized(root.defKey)}`;
  sourceRoots.forEach((root) => {
    if (!root || typeof root !== 'object') return;
    const existing = targetRoots.filter(root2 => pairOf(root2) === pairOf(root))[0]
      || appended.filter(root2 => pairOf(root2) === pairOf(root))[0];
    let finalId;
    if (existing) {
      finalId = existing.id;
    } else if (root.id != null && !taken.has(root.id)) {
      finalId = root.id;
    } else {
      finalId = makeId();
      while (taken.has(finalId)) finalId = makeId();
    }
    taken.add(finalId);
    if (root.id != null) idMap.set(root.id, finalId);
    if (!existing) appended.push({...root, id: finalId});
  });
  return {roots: targetRoots.concat(appended), idMap, appendedCount: appended.length};
};

// 合并后集合里的导入对象解析：带 old 标记 = 并入目标（old=reduce 后 id→目标 id）；
// 无 old 且 id 命中 = 原样追加的导入对象（概念/逻辑撞号保护在 _mergeData 前已
// 换 id，物理实体追加项带 isNew）；两者都不命中 = 未随导入（含未选择），
// 绝不解析到目标既有同号对象
const resolveMergedObject = (list, id, requireNewMarker) => {
  const merged = (list || []).filter(item => item && item.old === id)[0];
  if (merged) return merged.id;
  const appended = (list || []).filter(item => item && item.old == null
    && (!requireNewMarker || item.isNew === true) && item.id === id)[0];
  return appended ? appended.id : null;
};

const mergeQualityForImport = ({targetQuality, sourceQuality, merged, sources, wordRootIdMap, makeId}) => {
  if (!sourceQuality || typeof sourceQuality !== 'object') return undefined;
  const knownSchema = sourceQuality.schemaVersion === QUALITY_SCHEMA_VERSION;
  const sourceSets = Array.isArray(sourceQuality.modelRuleSets) ? sourceQuality.modelRuleSets : [];
  if (knownSchema && !sourceSets.length) return undefined;
  const targetBase = (targetQuality && typeof targetQuality === 'object') ? targetQuality
    : {schemaVersion: QUALITY_SCHEMA_VERSION, modelRuleSets: [], dataRuleSets: []};
  if (!knownSchema) {
    // 源 quality 结构未知：整体不导入也不执行，显式留诊断（目标侧保持原样）
    return {...targetBase,
      importDiagnostics: (targetBase.importDiagnostics || []).concat([{
        code: IMPORT_QUALITY_UNKNOWN_SCHEMA,
        schemaVersion: sourceQuality.schemaVersion,
        message: `source profile.quality schemaVersion=${text(sourceQuality.schemaVersion)} is not importable; kept in the source project only`,
      }])};
  }
  const targetSets = Array.isArray(targetBase.modelRuleSets) ? targetBase.modelRuleSets : [];
  const takenSetIds = new Set(targetSets.map(set => set && set.id).filter(id => id != null));
  const takenRuleIds = new Set(targetSets.reduce((ids, set) => ids.concat(
    ((set && set.rules) || []).map(rule => rule && rule.id)), []).filter(id => id != null));
  const uniqueId = (id, taken) => {
    if (id != null && !taken.has(id)) {
      taken.add(id);
      return id;
    }
    let next = makeId();
    while (taken.has(next)) next = makeId();
    taken.add(next);
    return next;
  };
  const resolveOwner = (collection, id) => resolveMergedObject(
    merged[collection], id, collection === 'entities');
  const resolveField = (collection, entry) => {
    const ownerId = entry.owner && entry.owner.id;
    const ownerResolved = resolveOwner(collection, ownerId);
    if (ownerId == null || ownerResolved == null) return {ownerId: ownerResolved, fieldId: null};
    const sourceOwner = ((sources[collection] || []).filter(
      item => item && item.id === ownerId)[0]);
    const sourceField = sourceOwner
      && ((sourceOwner.fields || []).filter(field => field && field.id === entry.id)[0]);
    if (!sourceField) return {ownerId: ownerResolved, fieldId: null};
    const mergedOwner = (merged[collection] || []).filter(item => item && item.id === ownerResolved)[0];
    const mergedField = mergedOwner
      && ((mergedOwner.fields || []).filter(field => field && field.defKey === sourceField.defKey)[0]);
    return {ownerId: ownerResolved, fieldId: (mergedField && mergedField.id) || null};
  };
  const mapScopeEntry = (entry, diagnostics) => {
    if (!entry || typeof entry !== 'object') return entry;
    if (entry.collection === 'fields') {
      const ownerCollection = entry.owner && SCOPE_OBJECT_COLLECTIONS[entry.owner.collection];
      if (!ownerCollection) return entry;
      const resolved = resolveField(ownerCollection, entry);
      if (resolved.fieldId == null) {
        diagnostics.push(refDiagnostic(entry));
        return {...entry, owner: {...entry.owner, id: resolved.ownerId}, id: null, unresolved: true};
      }
      return {...entry, owner: {...entry.owner, id: resolved.ownerId}, id: resolved.fieldId};
    }
    if (SCOPE_OBJECT_COLLECTIONS[entry.collection]) {
      const mapped = resolveOwner(entry.collection, entry.id);
      if (mapped == null) {
        diagnostics.push(refDiagnostic(entry));
        return {...entry, id: null, unresolved: true};
      }
      return {...entry, id: mapped};
    }
    return entry;
  };
  const mapPredicate = (predicate, diagnostics) => {
    if (!predicate || predicate.op !== 'standardMatch'
      || !Array.isArray(predicate.standardRefs)) {
      return predicate;
    }
    return {...predicate, standardRefs: predicate.standardRefs.map((ref) => {
      if (!ref || typeof ref !== 'object') return ref;
      if (ref.collection === 'wordRoots') {
        const mapped = wordRootIdMap.get(ref.id);
        if (mapped == null) {
          diagnostics.push(refDiagnostic(ref));
          return {kind: 'unresolved', collection: ref.collection};
        }
        return {...ref, id: mapped};
      }
      if (ref.collection === 'standardFields' || ref.collection === 'standardGroups') {
        // 源标准字段库不随项目导入（既有 _mergeDataSource 边界）：引用一律
        // 未解析，绝不绑定目标同号标准对象
        diagnostics.push(refDiagnostic(ref, 'standard library does not travel with project import'));
        return {kind: 'unresolved', collection: ref.collection};
      }
      return ref;
    })};
  };
  const importedSets = sourceSets.map((ruleSet) => {
    if (!ruleSet || typeof ruleSet !== 'object') return ruleSet;
    const diagnostics = (ruleSet.importDiagnostics || []).slice();
    const next = {
      ...ruleSet,
      id: uniqueId(ruleSet.id, takenSetIds),
      enabled: false,
      scope: (ruleSet.scope || []).map(entry => mapScopeEntry(entry, diagnostics)),
      rules: (ruleSet.rules || []).map(rule => (rule && typeof rule === 'object'
        ? {...rule, id: uniqueId(rule.id, takenRuleIds),
          predicate: mapPredicate(rule.predicate, diagnostics)} : rule)),
      ...(diagnostics.length ? {importDiagnostics: diagnostics} : {}),
    };
    return next;
  });
  return {
    ...targetBase,
    schemaVersion: QUALITY_SCHEMA_VERSION,
    modelRuleSets: targetSets.concat(importedSets),
    dataRuleSets: Array.isArray(targetBase.dataRuleSets) ? targetBase.dataRuleSets : [],
  };
};

// targetProfile/sourceProfile：_mergeDataSource 两侧 profile；
// merged：{entities, logicEntities, conceptEntities} 合并后集合（含 old/isNew 标记）；
// sources：{entities, logicEntities, conceptEntities} 源（reduce 后）集合，供字段
// defKey 对齐；makeId：Math.uuid。返回需写入结果 profile 的键，null 表示无需覆盖。
export const mergeProjectMetadataForImport = ({targetProfile, sourceProfile, merged, sources, makeId}) => {
  const targetFieldRec = targetProfile && targetProfile.fieldRecommendation;
  const sourceFieldRec = sourceProfile && sourceProfile.fieldRecommendation;
  const sourceRoots = (sourceFieldRec && Array.isArray(sourceFieldRec.wordRoots))
    ? sourceFieldRec.wordRoots : [];
  let fieldRecommendation;
  let wordRootIdMap = new Map();
  if (sourceRoots.length) {
    const targetRoots = (targetFieldRec && Array.isArray(targetFieldRec.wordRoots))
      ? targetFieldRec.wordRoots : [];
    const mergedRoots = mergeWordRoots(targetRoots, sourceRoots, makeId);
    wordRootIdMap = mergedRoots.idMap;
    const carriedDiagnostics = (targetFieldRec && targetFieldRec.importDiagnostics || [])
      .concat((sourceFieldRec && sourceFieldRec.importDiagnostics) || []);
    if (mergedRoots.appendedCount > 0 || carriedDiagnostics.length > (targetFieldRec && targetFieldRec.importDiagnostics || []).length) {
      fieldRecommendation = {
        ...(targetFieldRec || {}),
        wordRoots: mergedRoots.roots,
        ...(carriedDiagnostics.length ? {importDiagnostics: carriedDiagnostics} : {}),
      };
    }
  }
  const quality = mergeQualityForImport({
    targetQuality: targetProfile && targetProfile.quality,
    sourceQuality: sourceProfile && sourceProfile.quality,
    merged, sources, wordRootIdMap, makeId,
  });
  const result = {};
  if (quality) result.quality = quality;
  if (fieldRecommendation) result.fieldRecommendation = fieldRecommendation;
  return Object.keys(result).length ? result : null;
};
