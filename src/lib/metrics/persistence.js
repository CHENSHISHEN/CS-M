// 指标平台 M4A：profile.metricPlatform 随项目导入/复制的持久化适配（纯函数）。
// 与 quality/projectMetadata.js 同构的两个接缝：
// - reduceProject 阶段（remapMetricPlatformForReduce）：导入重构给实体/逻辑/概念及其
//   字段换新 id，指标存储里的模型引用（原子 spec.source、factGrain.uniqueKeyFieldIds、
//   bindings 端点与 mapping 字段）按 old→新 id 重绑；缺映射不伪造绑定——相关绑定
//   转 unresolved（保留原端点快照与事件历史），草案 etag/发布 hash 按重映射后内容
//   重算。schema 指纹基于 defKey/类型（与 id 无关），导入后仍然有效。
// - _mergeDataSource 阶段（mergeMetricPlatformForImport）：导入侧指标存储不静默丢弃
//   ——命名空间采用目标（目标为空则沿用源）、概念/定义/版本/字典/绑定显式并入，
//   code/id 冲突换新并留 importDiagnostics；绑定端点仅解析到“随导入合并”的对象
//   （old 标记/新增标记两种命中），未随导入一律 unresolved，绝不误绑目标同号对象；
//   原子 spec 来源/事实键同样沿合并集合重绑，未随导入保留 unresolved 证据且不再
//   声称计算就绪；字典 code 冲突换后缀时引用（scope/维度/限定/粒度/单位/patch/
//   字典 qualifier/resolvedSpec）级联到来源对应条目；先合并字典并预分配全部 ID
//   映射，再对导入副本做恰好一次引用转换（前向引用不依赖数组顺序），全部转换完成
//   后重算导入副本的 draft etag/发布 hash——目标既有条目与来源原文件快照不改写；
//   两侧未知键（平台级/字典级）来源独有保留、同名冲突显式诊断不静默舍弃；
//   目标 schemaVersion 未知源不执行、显式诊断。
// - 发布 hash（MET-03）：来源已发布修订在任何重映射之前按自身内容校验（sha256 或旧 h<8hex>），
//   不符则整个来源指标存储拒绝导入（METRIC_IMPORT_HASH_MISMATCH 诊断）；合法重映射后以 contentHash 重算。
// 注：构建链不识别 ??，本文件一律使用 == null 三元。

import {draftEtag} from './store';
import {contentHash, hashValue, verifyRevisionHash} from './hash';

export const METRIC_PLATFORM_KEY = 'metricPlatform';
export const IMPORT_METRIC_UNKNOWN_SCHEMA = 'METRIC_IMPORT_UNKNOWN_SCHEMA';
export const IMPORT_METRIC_NAMESPACE_ADOPTED = 'METRIC_IMPORT_NAMESPACE_ADOPTED';
export const IMPORT_METRIC_CODE_RENAMED = 'METRIC_IMPORT_CODE_RENAMED';
export const IMPORT_METRIC_ID_REASSIGNED = 'METRIC_IMPORT_ID_REASSIGNED';
export const IMPORT_METRIC_ENDPOINT_UNRESOLVED = 'METRIC_IMPORT_ENDPOINT_UNRESOLVED';
export const IMPORT_METRIC_UNKNOWN_KEY_CONFLICT = 'METRIC_IMPORT_UNKNOWN_KEY_CONFLICT';
// 来源已发布修订 hash 与其自身内容不符（被篡改/损坏）：整个来源指标存储拒绝导入
export const IMPORT_METRIC_HASH_MISMATCH = 'METRIC_IMPORT_HASH_MISMATCH';

// 平台级已知键（schema1 增量合同）：合并时显式处理，其余按未知键保留策略处理
const PLATFORM_KNOWN_KEYS = ['schemaVersion', 'namespace', 'concepts', 'definitions',
  'revisions', 'bindings', 'dictionary', 'importDiagnostics'];

// ---------- reduce 阶段：old id → 新 id 重绑 ----------
// reduceProject 的 old 标记有两种模式：type='old' 时 old=原 id（直连命中）；
// type='defKey' 时 old=defKey（需经源集合按 原 id→defKey→新 id 回退，同
// remapConceptLogicalLinksForReduce 的两种命中语义）。缺映射一律不伪造绑定。

const listIn = (collections, collection) => {
  if (collection === 'entities') return collections.entities || [];
  if (collection === 'logicEntities') return collections.logicEntities || [];
  if (collection === 'conceptEntities') return collections.conceptEntities || [];
  return [];
};
const sourceIn = (collections, collection) => {
  if (collection === 'entities') return collections.sourceEntities || [];
  if (collection === 'logicEntities') return collections.sourceLogicEntities || [];
  if (collection === 'conceptEntities') return collections.sourceConceptEntities || [];
  return [];
};

const buildObjectResolver = (collections) => (collection, originalId) => {
  if (originalId == null) return null;
  const list = listIn(collections, collection);
  const direct = list.filter(item => item && item.old === originalId)[0];
  if (direct) return direct.id;
  const source = sourceIn(collections, collection)
    .filter(item => item && item.id === originalId)[0];
  if (source != null && source.defKey != null) {
    const byKey = list.filter(item => item && item.old === source.defKey)[0];
    if (byKey) return byKey.id;
  }
  return null;
};

const buildFieldResolver = (collections, resolveObject) =>
  (collection, originalObjectId, originalFieldId) => {
    if (originalFieldId == null) return null;
    const newObjectId = resolveObject(collection, originalObjectId);
    if (newObjectId == null) return null;
    const newObject = listIn(collections, collection)
      .filter(item => item && item.id === newObjectId)[0];
    if (newObject == null) return null;
    const newFields = (newObject.fields || []);
    const direct = newFields.filter(f => f != null && f.old === originalFieldId)[0];
    if (direct) return direct.id;
    const sourceObject = sourceIn(collections, collection)
      .filter(item => item != null && item.id === originalObjectId)[0];
    const sourceField = sourceObject == null ? null
      : ((sourceObject.fields || []).filter(f => f != null && f.id === originalFieldId)[0]) || null;
    if (sourceField != null && sourceField.defKey != null) {
      const byKey = newFields.filter(f => f != null && f.old === sourceField.defKey)[0];
      if (byKey) return byKey.id;
    }
    return null;
  };

const COLLECTION_KEYS = ['entities', 'logicEntities', 'conceptEntities'];

// 原子 spec 内的模型/字段引用重映射（draft 与发布快照一并处理；发布 hash 在
// 内容被导入变换后重算，源项目内不可变性不受影响）
const remapSpecForReduce = (spec, resolveObject, resolveField) => {
  if (spec == null || spec.kind !== 'atomic') return {spec, changed: false};
  let changed = false;
  let next = spec;
  if (spec.source != null && spec.source.modelId != null) {
    const modelId = resolveAnyObject(resolveObject, spec.source.modelId);
    if (modelId.id == null) {
      // 来源模型未随导入（不该发生于整项目 reduce，但按合同如实标记）
      next = {...next, source: {...spec.source, unresolved: true}};
      changed = true;
    } else {
      const source = {...spec.source, modelId: modelId.id};
      if (spec.source.fieldId != null) {
        const fieldId = resolveField(modelId.collection, spec.source.modelId, spec.source.fieldId);
        if (fieldId == null) source.unresolvedField = true;
        else source.fieldId = fieldId;
      }
      next = {...next, source};
      changed = true;
    }
  }
  if (spec.factGrain != null && Array.isArray(spec.factGrain.uniqueKeyFieldIds)
    && spec.source != null && spec.source.modelId != null) {
    const modelId = resolveAnyObject(resolveObject, spec.source.modelId);
    const uniqueKeyFieldIds = spec.factGrain.uniqueKeyFieldIds.map((fieldId) => {
      const mapped = modelId.id == null ? null
        : resolveField(modelId.collection, spec.source.modelId, fieldId);
      return mapped == null ? fieldId : mapped;
    });
    if (uniqueKeyFieldIds.join('\u0001') !== spec.factGrain.uniqueKeyFieldIds.join('\u0001')) {
      next = {...next, factGrain: {...next.factGrain, uniqueKeyFieldIds}};
      changed = true;
    }
  }
  return {spec: next, changed};
};

// 在三个集合中解析对象（返回 {collection, id} 或 {collection: null, id: null}）
const resolveAnyObject = (resolveObject, objectId) => {
  for (let i = 0; i < COLLECTION_KEYS.length; i += 1) {
    const collection = COLLECTION_KEYS[i];
    const id = resolveObject(collection, objectId);
    if (id != null) return {collection, id};
  }
  return {collection: null, id: null};
};

const remapBindingForReduce = (binding, resolveObject, resolveField, diagnostics) => {
  if (binding == null || binding.modelRef == null) return binding;
  const ref = binding.modelRef;
  const collection = ref.collection;
  if (COLLECTION_KEYS.indexOf(collection) < 0) return binding;
  const newObjectId = resolveObject(collection, ref.objectId);
  if (newObjectId == null) {
    diagnostics.push({
      code: IMPORT_METRIC_ENDPOINT_UNRESOLVED,
      bindingId: binding.id,
      collection,
      objectId: ref.objectId,
      message: `binding endpoint ${collection}/${ref.objectId} not carried by import reduce`,
    });
    return {
      ...binding,
      state: 'unresolved',
      unresolved: {
        reason: 'IMPORT_REF_UNRESOLVED',
        collection,
        objectId: ref.objectId,
        ...(ref.fieldId == null ? {} : {fieldId: ref.fieldId}),
      },
      events: (binding.events || []).concat([{type: 'unresolved', reason: 'IMPORT_REF_UNRESOLVED'}]),
    };
  }
  const next = {...binding, modelRef: {...ref, objectId: newObjectId}};
  if (ref.fieldId != null) {
    const newFieldId = resolveField(collection, ref.objectId, ref.fieldId);
    if (newFieldId == null) {
      diagnostics.push({
        code: IMPORT_METRIC_ENDPOINT_UNRESOLVED,
        bindingId: binding.id,
        collection,
        objectId: ref.objectId,
        fieldId: ref.fieldId,
        message: `binding endpoint field ${ref.fieldId} not carried by import reduce`,
      });
      next.modelRef = {...next.modelRef};
      next.state = 'unresolved';
      next.unresolved = {
        reason: 'IMPORT_REF_UNRESOLVED',
        collection,
        objectId: ref.objectId,
        fieldId: ref.fieldId,
      };
      next.events = (binding.events || []).concat([{type: 'unresolved', reason: 'IMPORT_REF_UNRESOLVED'}]);
      return next;
    }
    next.modelRef.fieldId = newFieldId;
  }
  if (binding.mapping != null) {
    const mapping = {...binding.mapping};
    if (mapping.timeFieldId != null) {
      const mapped = resolveField(collection, ref.objectId, mapping.timeFieldId);
      if (mapped != null) mapping.timeFieldId = mapped;
    }
    ['qualifierFieldIds', 'dimensionFieldIds', 'factKeyFieldIds'].forEach((key) => {
      if (Array.isArray(mapping[key])) {
        mapping[key] = mapping[key].map((fieldId) => {
          const mapped = resolveField(collection, ref.objectId, fieldId);
          return mapped == null ? fieldId : mapped;
        });
      }
    });
    next.mapping = mapping;
  }
  return next;
};

// collections：reduceProject 中带 old 标记的中间集合与对应源集合
// {entities, logicEntities, conceptEntities, sourceEntities, sourceLogicEntities,
//  sourceConceptEntities}。返回重映射后的 metricPlatform 或 null
// （null = 无需覆盖，原样透传——含未知 schemaVersion 与无指标数据两种情况）。
export const remapMetricPlatformForReduce = (project, collections) => {
  const platform = project && project.profile && project.profile[METRIC_PLATFORM_KEY];
  if (!platform || typeof platform !== 'object') return null;
  if (platform.schemaVersion !== 1) return null;
  const resolveObject = buildObjectResolver(collections);
  const resolveField = buildFieldResolver(collections, resolveObject);
  const hasRevisions = Array.isArray(platform.revisions) && platform.revisions.length > 0;
  const hasBindings = Array.isArray(platform.bindings) && platform.bindings.length > 0;
  if (!hasRevisions && !hasBindings) return null;
  const diagnostics = [];
  const revisions = (platform.revisions || []).map((revision) => {
    if (revision == null || revision.spec == null || revision.spec.kind !== 'atomic') return revision;
    // 先按来源原内容校验（重映射之前）：只有校验通过的发布 hash 才随合法重映射重算；
    // 被篡改的保留原 hash，使不一致延续到合并阶段被拒，绝不在此“洗白”（MET-03）
    const sealedOk = verifyRevisionHash(revision).ok;
    const result = remapSpecForReduce(revision.spec, resolveObject, resolveField);
    if (!result.changed) return revision;
    const next = {...revision, spec: result.spec};
    if (next.status === 'draft') next.etag = draftEtag(next);
    if (next.status === 'published' && sealedOk) {
      next.hash = contentHash({spec: next.spec, resolvedSpec: next.resolvedSpec});
    }
    return next;
  });
  const bindings = (platform.bindings || []).map(binding =>
    remapBindingForReduce(binding, resolveObject, resolveField, diagnostics));
  return {
    ...platform,
    revisions,
    bindings,
    ...(diagnostics.length ? {importDiagnostics: (platform.importDiagnostics || []).concat(diagnostics)} : {}),
  };
};

// ---------- merge 阶段：导入指标存储并入目标 ----------

// 合并后集合里的导入对象解析：带 old 标记 = 并入目标（old=reduce 后 id→目标 id）；
// 无 old 且 id 命中 = 原样追加的导入对象（物理实体追加项带 isNew）。两者都不命中 =
// 未随导入（未选择/未携带），绝不解析到目标既有同号对象。
const resolveMergedObject = (list, id, requireNewMarker) => {
  const merged = (list || []).filter(item => item && item.old === id)[0];
  if (merged) return merged.id;
  const appended = (list || []).filter(item => item && item.old == null
    && (!requireNewMarker || item.isNew === true) && item.id === id)[0];
  return appended ? appended.id : null;
};
const resolveMergedField = (mergedList, sourcesList, collection, objectId, fieldId) => {
  const ownerResolved = resolveMergedObject(mergedList, objectId, collection === 'entities');
  if (ownerResolved == null) return {objectId: null, fieldId: null};
  if (fieldId == null) return {objectId: ownerResolved, fieldId: null};
  const sourceOwner = ((sourcesList || []).filter(item => item && item.id === objectId)[0]) || null;
  const sourceField = sourceOwner
    && ((sourceOwner.fields || []).filter(f => f && f.id === fieldId)[0]) || null;
  if (sourceField == null) return {objectId: ownerResolved, fieldId: null};
  const mergedOwner = (mergedList || []).filter(item => item && item.id === ownerResolved)[0];
  const mergedField = mergedOwner
    && ((mergedOwner.fields || []).filter(f => f && f.defKey === sourceField.defKey)[0]) || null;
  return {objectId: ownerResolved, fieldId: (mergedField && mergedField.id) || null};
};

const remapBindingForMerge = (binding, merged, sources, diagnostics) => {
  const ref = binding.modelRef;
  const collection = ref.collection;
  const lists = {
    entities: merged.entities,
    logicEntities: merged.logicEntities,
    conceptEntities: merged.conceptEntities,
  };
  const sourceLists = {
    entities: sources.entities,
    logicEntities: sources.logicEntities,
    conceptEntities: sources.conceptEntities,
  };
  const resolved = resolveMergedField(lists[collection], sourceLists[collection],
    collection, ref.objectId, ref.fieldId);
  if (resolved.objectId == null || (ref.fieldId != null && resolved.fieldId == null)) {
    diagnostics.push({
      code: IMPORT_METRIC_ENDPOINT_UNRESOLVED,
      bindingId: binding.id,
      collection,
      objectId: ref.objectId,
      ...(ref.fieldId == null ? {} : {fieldId: ref.fieldId}),
      message: `binding endpoint ${collection}/${ref.objectId}`
        + `${ref.fieldId == null ? '' : `/${ref.fieldId}`} not carried into target project; kept unresolved`,
    });
    return {
      ...binding,
      state: 'unresolved',
      unresolved: {
        reason: 'IMPORT_REF_UNRESOLVED',
        collection,
        objectId: ref.objectId,
        ...(ref.fieldId == null ? {} : {fieldId: ref.fieldId}),
      },
      events: (binding.events || []).concat([{type: 'unresolved', reason: 'IMPORT_REF_UNRESOLVED'}]),
    };
  }
  const next = {...binding, modelRef: {...ref, objectId: resolved.objectId}};
  if (ref.fieldId != null) next.modelRef.fieldId = resolved.fieldId;
  if (binding.mapping != null) {
    const mapping = {...binding.mapping};
    ['timeFieldId'].forEach((key) => {
      if (mapping[key] != null) {
        const hit = resolveMergedField(lists[collection], sourceLists[collection],
          collection, ref.objectId, mapping[key]);
        if (hit.fieldId != null) mapping[key] = hit.fieldId;
      }
    });
    ['qualifierFieldIds', 'dimensionFieldIds', 'factKeyFieldIds'].forEach((key) => {
      if (Array.isArray(mapping[key])) {
        mapping[key] = mapping[key].map((fieldId) => {
          const hit = resolveMergedField(lists[collection], sourceLists[collection],
            collection, ref.objectId, fieldId);
          return hit.fieldId == null ? fieldId : hit.fieldId;
        });
      }
    });
    next.mapping = mapping;
  }
  return next;
};

// ---- 未知键保留：来源独有 → 保留；同名同值 → 去重；同名不同值 → 保留目标 + 显式诊断 ----
// （不静默舍弃来源，也不猜测合并语义；来源值记入诊断留证）
const mergeUnknownKeys = (base, incoming, knownKeys, diagnostics, describe) => {
  const added = {};
  Object.keys(incoming == null ? {} : incoming).forEach((key) => {
    if (knownKeys.indexOf(key) >= 0) return;
    if (base == null || base[key] === undefined) {
      added[key] = incoming[key];
      return;
    }
    if (hashValue(base[key]) === hashValue(incoming[key])) return;
    diagnostics.push({
      code: IMPORT_METRIC_UNKNOWN_KEY_CONFLICT,
      where: describe,
      key,
      message: `${describe} unknown key '${key}' differs between target and source;`
        + ' target value kept, source value recorded here (not silently dropped)',
      sourceValue: incoming[key],
    });
  });
  return added;
};

// ---- 字典合并：同 code 同内容去重、不同内容换后缀并产出 code 映射（供引用级联），
// 分类条目 id 撞号换新（身份不静默覆盖）；匹配只按 code/内容哈希，不按显示名反查 ----
const DICTIONARY_MERGE_CATEGORIES = ['departments', 'dimensions', 'qualifiers', 'periods', 'units'];

const mergeDictionaryForImport = (targetDictionary, sourceDictionary, diagnostics, makeId) => {
  if (sourceDictionary == null || typeof sourceDictionary !== 'object') {
    return {dictionary: targetDictionary, codeMaps: null, changed: false};
  }
  const base = targetDictionary == null || typeof targetDictionary !== 'object'
    ? {schemaVersion: 1} : targetDictionary;
  const next = {...base};
  const codeMaps = {};
  let changed = false;
  let appendedQualifiers = null;
  DICTIONARY_MERGE_CATEGORIES.forEach((category) => {
    const targetList = Array.isArray(base[category]) ? base[category] : [];
    const sourceList = Array.isArray(sourceDictionary[category]) ? sourceDictionary[category] : [];
    codeMaps[category] = new Map();
    if (!sourceList.length) {
      if (targetList.length) next[category] = targetList;
      return;
    }
    const takenCodes = {};
    const takenIds = {};
    targetList.forEach(entry => {
      if (entry == null) return;
      if (entry.code != null) takenCodes[entry.code] = true;
      if (entry.id != null) takenIds[entry.id] = true;
    });
    const appended = [];
    sourceList.forEach((entry) => {
      if (entry == null) return;
      let code = entry.code;
      if (code != null) {
        // 同 code：内容全等 → 去重跳过；不同 → 换后缀保留并留映射与诊断（code 是身份）
        const existing = targetList.filter(item => item && item.code === code)[0]
          || appended.filter(item => item && item.code === code)[0];
        if (existing) {
          if (hashValue(existing) === hashValue(entry)) return;
          let suffix = 2;
          let renamed = `${code}_imp`;
          while (takenCodes[renamed]) {
            renamed = `${code}_imp${suffix}`;
            suffix += 1;
          }
          takenCodes[renamed] = true;
          diagnostics.push({
            code: IMPORT_METRIC_CODE_RENAMED,
            category,
            from: code,
            to: renamed,
            message: `dictionary ${category} code conflict on import: ${code} -> ${renamed}`,
          });
          codeMaps[category].set(code, renamed);
          code = renamed;
        } else {
          takenCodes[code] = true;
        }
      }
      const item = code === entry.code ? {...entry} : {...entry, code};
      // 分类条目 ID 撞号：换新 id 留诊断（指标/字典内部引用走 code，无需级联）
      if (item.id != null && takenIds[item.id]) {
        let nextId = makeId();
        while (takenIds[nextId]) nextId = makeId();
        takenIds[nextId] = true;
        diagnostics.push({
          code: IMPORT_METRIC_ID_REASSIGNED,
          kind: 'dictionaryEntry',
          category,
          from: item.id,
          to: nextId,
          message: `dictionary ${category} entry id conflict on import: ${item.id} -> ${nextId}`,
        });
        item.id = nextId;
      } else if (item.id != null) {
        takenIds[item.id] = true;
      }
      appended.push(item);
    });
    if (category === 'qualifiers') {
      appendedQualifiers = appended;
    }
    if (appended.length) {
      next[category] = targetList.concat(appended);
      changed = true;
    } else if (targetList.length) {
      next[category] = targetList;
    }
  });
  // 字典 qualifier.dimensionId 引用维度 code：仅追加的来源条目随维度冲突换名级联
  //（在全部分类映射就绪后统一处理；目标条目永不改写，不依赖分类处理顺序）
  if (codeMaps.dimensions.size > 0 && appendedQualifiers != null) {
    appendedQualifiers.forEach((qualifier) => {
      const dimensionId = mapCode(codeMaps, 'dimensions', qualifier.dimensionId);
      if (dimensionId !== qualifier.dimensionId) {
        qualifier.dimensionId = dimensionId;
        changed = true;
      }
    });
  }
  // 字典级未知键：来源独有保留；同名冲突保留目标 + 显式诊断
  const unknownAdded = mergeUnknownKeys(base, sourceDictionary,
    DICTIONARY_MERGE_CATEGORIES.concat(['schemaVersion']), diagnostics, 'dictionary');
  Object.keys(unknownAdded).forEach((key) => {
    next[key] = unknownAdded[key];
    changed = true;
  });
  return {dictionary: changed ? next : targetDictionary, codeMaps, changed};
};

// ---- 字典 code 级联（只作用于导入副本；目标条目/引用永不改写） ----
const mapCode = (codeMaps, category, code) => {
  if (code == null || codeMaps == null) return code;
  const map = codeMaps[category];
  if (map == null) return code;
  const mapped = map.get(code);
  return mapped == null ? code : mapped;
};
const remapQualifierCodes = (qualifiers, codeMaps) => {
  if (!Array.isArray(qualifiers)) return qualifiers;
  let changed = false;
  const next = qualifiers.map((qualifier) => {
    if (qualifier == null) return qualifier;
    const dimensionId = mapCode(codeMaps, 'dimensions', qualifier.dimensionId);
    if (dimensionId === qualifier.dimensionId) return qualifier;
    changed = true;
    return {...qualifier, dimensionId};
  });
  return changed ? next : qualifiers;
};
const remapDimensionCodes = (grain, codeMaps) => {
  if (!Array.isArray(grain)) return grain;
  let changed = false;
  const next = grain.map((dim) => {
    const mapped = mapCode(codeMaps, 'dimensions', dim);
    if (mapped === dim) return dim;
    changed = true;
    return mapped;
  });
  return changed ? next : grain;
};
const remapAtomicDictionaryCodes = (spec, codeMaps) => {
  let next = spec;
  let changed = false;
  const baseQualifiers = remapQualifierCodes(next.baseQualifiers, codeMaps);
  if (baseQualifiers !== next.baseQualifiers) {
    next = {...next, baseQualifiers};
    changed = true;
  }
  if (Array.isArray(next.dimensions)) {
    let dimsChanged = false;
    const dimensions = next.dimensions.map((dimension) => {
      if (dimension == null) return dimension;
      const dimensionId = mapCode(codeMaps, 'dimensions', dimension.dimensionId);
      if (dimensionId === dimension.dimensionId) return dimension;
      dimsChanged = true;
      return {...dimension, dimensionId};
    });
    if (dimsChanged) {
      next = {...next, dimensions};
      changed = true;
    }
  }
  const unit = mapCode(codeMaps, 'units', next.unit);
  if (unit !== next.unit) {
    next = {...next, unit};
    changed = true;
  }
  return {spec: next, changed};
};
const remapDerivedDictionaryCodes = (spec, codeMaps) => {
  let next = spec;
  let changed = false;
  const qualifiers = remapQualifierCodes(next.qualifiers, codeMaps);
  if (qualifiers !== next.qualifiers) {
    next = {...next, qualifiers};
    changed = true;
  }
  const outputGrain = remapDimensionCodes(next.outputGrain, codeMaps);
  if (outputGrain !== next.outputGrain) {
    next = {...next, outputGrain};
    changed = true;
  }
  return {spec: next, changed};
};
const remapPatchDictionaryCodes = (patch, codeMaps) => {
  if (patch == null) return {patch, changed: false};
  let next = patch;
  let changed = false;
  ['addQualifiers', 'addBaseQualifiers'].forEach((key) => {
    const remapped = remapQualifierCodes(next[key], codeMaps);
    if (remapped !== next[key]) {
      next = {...next, [key]: remapped};
      changed = true;
    }
  });
  if (Array.isArray(next.restrictDimensions)) {
    const remapped = remapDimensionCodes(next.restrictDimensions, codeMaps);
    if (remapped !== next.restrictDimensions) {
      next = {...next, restrictDimensions: remapped};
      changed = true;
    }
  }
  return {patch: next, changed};
};

// ---- 原子 spec 模型来源沿真实合并集合重绑（old=并入目标 / isNew=原样追加两种命中，
// 字段按 defKey 对齐）；未随导入不伪造引用：保留原端点 + unresolved 证据 + 诊断，
// 导入副本的 resolvedSpec 不再声称计算就绪；绝不误绑目标同号对象 ----
const mergedListsOf = (merged) => ({
  entities: (merged && merged.entities) || [],
  logicEntities: (merged && merged.logicEntities) || [],
  conceptEntities: (merged && merged.conceptEntities) || [],
});
const sourceListsOf = (sources) => ({
  entities: (sources && sources.entities) || [],
  logicEntities: (sources && sources.logicEntities) || [],
  conceptEntities: (sources && sources.conceptEntities) || [],
});

const remapSpecSourceForMerge = (spec, merged, sources, diagnostics, revisionId) => {
  if (spec == null || spec.kind !== 'atomic'
    || spec.source == null || spec.source.modelId == null) {
    return {spec, changed: false, sourceReady: true};
  }
  const lists = mergedListsOf(merged);
  const sourceLists = sourceListsOf(sources);
  let resolvedCollection = null;
  let resolvedObjectId = null;
  for (let i = 0; i < COLLECTION_KEYS.length; i += 1) {
    const collection = COLLECTION_KEYS[i];
    const hit = resolveMergedObject(lists[collection], spec.source.modelId,
      collection === 'entities');
    if (hit != null) {
      resolvedCollection = collection;
      resolvedObjectId = hit;
      break;
    }
  }
  let next = spec;
  let changed = false;
  let sourceReady = true;
  if (resolvedCollection == null) {
    diagnostics.push({
      code: IMPORT_METRIC_ENDPOINT_UNRESOLVED,
      kind: 'spec.source',
      revisionId,
      objectId: spec.source.modelId,
      message: `atomic spec source model ${spec.source.modelId} not carried into target`
        + ' project; kept with unresolved evidence and not compute-ready',
    });
    next = {...next, source: {...spec.source, unresolved: true}};
    changed = true;
    sourceReady = false;
  } else {
    const source = {...spec.source, modelId: resolvedObjectId};
    if (spec.source.fieldId != null) {
      const fieldHit = resolveMergedField(lists[resolvedCollection],
        sourceLists[resolvedCollection], resolvedCollection,
        spec.source.modelId, spec.source.fieldId);
      if (fieldHit.fieldId == null) {
        source.unresolvedField = true;
        sourceReady = false;
        diagnostics.push({
          code: IMPORT_METRIC_ENDPOINT_UNRESOLVED,
          kind: 'spec.source',
          revisionId,
          collection: resolvedCollection,
          objectId: spec.source.modelId,
          fieldId: spec.source.fieldId,
          message: `atomic spec source field ${spec.source.fieldId} not carried into`
            + ' target project; kept with unresolved evidence and not compute-ready',
        });
      } else {
        source.fieldId = fieldHit.fieldId;
      }
    }
    next = {...next, source};
    changed = true;
  }
  if (spec.factGrain != null && Array.isArray(spec.factGrain.uniqueKeyFieldIds)
    && resolvedCollection != null) {
    const uniqueKeyFieldIds = spec.factGrain.uniqueKeyFieldIds.map((fieldId) => {
      const hit = resolveMergedField(lists[resolvedCollection], sourceLists[resolvedCollection],
        resolvedCollection, spec.source.modelId, fieldId);
      return hit.fieldId == null ? fieldId : hit.fieldId;
    });
    if (uniqueKeyFieldIds.join('\u0001') !== spec.factGrain.uniqueKeyFieldIds.join('\u0001')) {
      next = {...next, factGrain: {...next.factGrain, uniqueKeyFieldIds}};
      changed = true;
    }
  }
  return {spec: next, changed, sourceReady};
};

// ---- 版本转换：基于原始来源值恰好一次应用全部映射（definition/baseline/前向引用），
// 字典 code 级联 + resolvedSpec 同步；转换完成后重算 draft etag / 发布 hash ----
const remapBaselineForImport = (baseline, definitionIdMap, revisionIdMap) => {
  if (baseline == null) return baseline;
  let next = baseline;
  if (next.definitionId != null) {
    const mapped = definitionIdMap.get(next.definitionId);
    if (mapped != null && mapped !== next.definitionId) next = {...next, definitionId: mapped};
  }
  if (next.revisionId != null) {
    const mapped = revisionIdMap.get(next.revisionId);
    if (mapped != null && mapped !== next.revisionId) next = {...next, revisionId: mapped};
  }
  if (next.baseRevisionId != null) {
    const mapped = revisionIdMap.get(next.baseRevisionId);
    if (mapped != null && mapped !== next.baseRevisionId) next = {...next, baseRevisionId: mapped};
  }
  return next;
};

const remapResolvedSpecForImport = (resolvedSpec, codeMaps, definitionIdMap, revisionIdMap, sourceReady) => {
  if (resolvedSpec == null) return {resolvedSpec, changed: false};
  let next = resolvedSpec;
  let changed = false;
  const unit = mapCode(codeMaps, 'units', next.unit);
  if (unit !== next.unit) {
    next = {...next, unit};
    changed = true;
  }
  const grain = remapDimensionCodes(next.grain, codeMaps);
  if (grain !== next.grain) {
    next = {...next, grain};
    changed = true;
  }
  const qualifiers = remapQualifierCodes(next.qualifiers, codeMaps);
  if (qualifiers !== next.qualifiers) {
    next = {...next, qualifiers};
    changed = true;
  }
  const baseQualifiers = remapQualifierCodes(next.baseQualifiers, codeMaps);
  if (baseQualifiers !== next.baseQualifiers) {
    next = {...next, baseQualifiers};
    changed = true;
  }
  const baseline = remapBaselineForImport(next.baseline, definitionIdMap, revisionIdMap);
  if (baseline !== next.baseline) {
    next = {...next, baseline};
    changed = true;
  }
  if (!sourceReady && next.computeReady !== false) {
    next = {...next, computeReady: false, designOnly: true};
    changed = true;
  }
  return {resolvedSpec: next, changed};
};

const convertRevisionForImport = (revision, context) => {
  const {definitionIdMap, revisionIdMap, codeMaps, merged, sources, diagnostics} = context;
  const remapRevisionId = (id) => {
    if (id == null) return id;
    const mapped = revisionIdMap.get(id);
    return mapped == null ? id : mapped;
  };
  const next = {...revision};
  if (next.id != null) next.id = remapRevisionId(next.id);
  if (next.definitionId != null) {
    const mapped = definitionIdMap.get(next.definitionId);
    if (mapped != null) next.definitionId = mapped;
  }
  if (next.baseRevisionId != null) next.baseRevisionId = remapRevisionId(next.baseRevisionId);
  if (next.upgradedFromRevisionId != null) {
    next.upgradedFromRevisionId = remapRevisionId(next.upgradedFromRevisionId);
  }
  let sourceReady = true;
  if (next.spec != null) {
    let spec = next.spec;
    let specChanged = false;
    if (spec.kind === 'atomic') {
      const sourceResult = remapSpecSourceForMerge(spec, merged, sources, diagnostics, revision.id);
      spec = sourceResult.spec;
      sourceReady = sourceResult.sourceReady;
      specChanged = sourceResult.changed;
      const dictResult = remapAtomicDictionaryCodes(spec, codeMaps);
      spec = dictResult.spec;
      specChanged = specChanged || dictResult.changed;
    } else if (spec.kind === 'derived') {
      if (spec.atomicRevisionId != null) {
        const mapped = remapRevisionId(spec.atomicRevisionId);
        if (mapped !== spec.atomicRevisionId) {
          spec = {...spec, atomicRevisionId: mapped};
          specChanged = true;
        }
      }
      const dictResult = remapDerivedDictionaryCodes(spec, codeMaps);
      spec = dictResult.spec;
      specChanged = specChanged || dictResult.changed;
    } else if (spec.kind === 'compound' && Array.isArray(spec.refs)) {
      let refsChanged = false;
      const refs = spec.refs.map((ref) => {
        if (ref == null || ref.revisionId == null) return ref;
        const mapped = remapRevisionId(ref.revisionId);
        if (mapped === ref.revisionId) return ref;
        refsChanged = true;
        return {...ref, revisionId: mapped};
      });
      if (refsChanged) {
        spec = {...spec, refs};
        specChanged = true;
      }
    }
    if (specChanged) next.spec = spec;
  }
  if (next.baseline != null) {
    const baseline = remapBaselineForImport(next.baseline, definitionIdMap, revisionIdMap);
    if (baseline !== next.baseline) next.baseline = baseline;
  }
  if (next.patch != null) {
    const patchResult = remapPatchDictionaryCodes(next.patch, codeMaps);
    if (patchResult.changed) next.patch = patchResult.patch;
  }
  if (next.resolvedSpec != null) {
    const resolvedResult = remapResolvedSpecForImport(next.resolvedSpec, codeMaps,
      definitionIdMap, revisionIdMap, sourceReady);
    if (resolvedResult.changed) next.resolvedSpec = resolvedResult.resolvedSpec;
  }
  // 全部转换完成后按导入副本内容重算（未触及的条目重算值与原值一致，幂等）；
  // 目标既有版本与来源原文件的历史快照不在此路径上
  if (next.status === 'draft') {
    next.etag = draftEtag(next);
  } else if (next.hash != null) {
    // 合并入口已按来源原内容校验通过（见 mergeMetricPlatformForImport），此处重算合法转换后的内容
    next.hash = contentHash({spec: next.spec, resolvedSpec: next.resolvedSpec});
  }
  return next;
};

// targetProfile/sourceProfile：_mergeDataSource 两侧 profile；
// merged：{entities, logicEntities, conceptEntities} 合并后集合（old/isNew 标记）；
// sources：{entities, logicEntities, conceptEntities} 源（reduce 后）集合；
// makeId：Math.uuid。返回写入结果 profile 的 metricPlatform 或 null（无需覆盖）。
export const mergeMetricPlatformForImport = ({targetProfile, sourceProfile, merged, sources, makeId}) => {
  const targetPlatform = targetProfile && targetProfile[METRIC_PLATFORM_KEY];
  const sourcePlatform = sourceProfile && sourceProfile[METRIC_PLATFORM_KEY];
  if (!sourcePlatform || typeof sourcePlatform !== 'object') return null;
  const sourceUnknownKeyCount = Object.keys(sourcePlatform)
    .filter(key => PLATFORM_KNOWN_KEYS.indexOf(key) < 0).length;
  const sourceEmpty = !((sourcePlatform.definitions || []).length
    || (sourcePlatform.revisions || []).length
    || (sourcePlatform.concepts || []).length
    || (sourcePlatform.bindings || []).length
    || (sourcePlatform.dictionary != null && Object.keys(sourcePlatform.dictionary).length)
    || sourceUnknownKeyCount);
  if (sourceEmpty) return null;
  const targetBase = (targetPlatform && typeof targetPlatform === 'object') ? targetPlatform : null;
  if (sourcePlatform.schemaVersion !== 1) {
    // 源结构未知：整体不导入不执行，目标原样，显式诊断（不静默丢弃也不猜测）
    if (targetBase == null) return null;
    return {
      ...targetBase,
      importDiagnostics: (targetBase.importDiagnostics || []).concat([{
        code: IMPORT_METRIC_UNKNOWN_SCHEMA,
        schemaVersion: sourcePlatform.schemaVersion,
        message: `source profile.metricPlatform schemaVersion=${sourcePlatform.schemaVersion}`
          + ' is not importable; kept in the source project only',
      }]),
    };
  }
  // 来源发布 hash 校验（任何 ID/引用重映射之前，按来源自身内容；旧 h<8hex> 用旧算法）：
  // 任一不符 → 整个来源指标存储拒绝导入，不并入任何内容，只在目标留显式诊断（MET-03）。
  // 目标原无指标存储时以最小空存储承载诊断，使导入通知可见（不静默丢弃）。
  const tamperedIds = (sourcePlatform.revisions || [])
    .filter(revision => revision != null && !verifyRevisionHash(revision).ok)
    .map(revision => revision.id);
  if (tamperedIds.length) {
    const holder = targetBase != null ? targetBase : {
      schemaVersion: 1, namespace: null, concepts: [], definitions: [], revisions: [], bindings: [],
    };
    return {
      ...holder,
      importDiagnostics: (holder.importDiagnostics || []).concat([{
        code: IMPORT_METRIC_HASH_MISMATCH,
        revisionIds: tamperedIds,
        message: `source metric revision hash mismatch (${tamperedIds.join(', ')}); `
          + 'content was modified after publish, nothing from the source metric store was imported',
      }]),
    };
  }
  const diagnostics = [];
  // 命名空间：目标已有则沿用目标；目标没有（或无指标存储）则沿用源的稳定命名空间
  let namespace = targetBase != null && targetBase.namespace != null && targetBase.namespace !== ''
    ? targetBase.namespace : sourcePlatform.namespace;
  if (targetBase == null || targetBase.namespace == null || targetBase.namespace === '') {
    diagnostics.push({
      code: IMPORT_METRIC_NAMESPACE_ADOPTED,
      namespace: sourcePlatform.namespace,
      message: `adopted source metric namespace ${sourcePlatform.namespace} on import`,
    });
  }
  const targetConcepts = targetBase != null && Array.isArray(targetBase.concepts)
    ? targetBase.concepts : [];
  const targetDefinitions = targetBase != null && Array.isArray(targetBase.definitions)
    ? targetBase.definitions : [];
  const targetRevisions = targetBase != null && Array.isArray(targetBase.revisions)
    ? targetBase.revisions : [];
  const targetBindings = targetBase != null && Array.isArray(targetBase.bindings)
    ? targetBase.bindings : [];

  // ---- 阶段一：字典合并（产出 code 映射）+ 概念/定义/版本 ID 全量预分配 ----
  //（来源原 id 一并占位，冲突换新的 id 不得抢占来源既有 id；映射先于任何引用转换就绪）
  const dictionaryMerge = mergeDictionaryForImport(targetBase != null ? targetBase.dictionary : undefined,
    sourcePlatform.dictionary, diagnostics, makeId);
  const dictionary = dictionaryMerge.dictionary;
  const codeMaps = dictionaryMerge.codeMaps;

  const conceptIdMap = new Map();
  const takenConceptIds = {};
  targetConcepts.forEach(item => { if (item && item.id != null) takenConceptIds[item.id] = true; });
  (sourcePlatform.concepts || []).forEach((concept) => {
    if (concept != null && concept.id != null) takenConceptIds[concept.id] = true;
  });
  const importedConcepts = [];
  (sourcePlatform.concepts || []).forEach((concept) => {
    if (concept == null) return;
    if (concept.id != null && takenConceptIds[concept.id]
      && (targetConcepts.some(item => item && item.id === concept.id)
        || importedConcepts.some(item => item.id === concept.id))) {
      const existing = targetConcepts.filter(item => item.id === concept.id)[0]
        || importedConcepts.filter(item => item.id === concept.id)[0];
      if (existing && hashValue(existing) === hashValue(concept)) {
        conceptIdMap.set(concept.id, concept.id);
        return; // 同 id 同内容 → 去重跳过
      }
      let nextId = makeId();
      while (takenConceptIds[nextId]) nextId = makeId();
      takenConceptIds[nextId] = true;
      conceptIdMap.set(concept.id, nextId);
      diagnostics.push({
        code: IMPORT_METRIC_ID_REASSIGNED,
        kind: 'concept',
        from: concept.id,
        to: nextId,
        message: `concept id conflict on import: ${concept.id} -> ${nextId}`,
      });
      importedConcepts.push({...concept, id: nextId});
      return;
    }
    if (concept.id != null) conceptIdMap.set(concept.id, concept.id);
    importedConcepts.push({...concept});
  });

  const takenDefinitionCodes = {};
  targetDefinitions.forEach(item => { if (item && item.code != null) takenDefinitionCodes[item.code] = true; });
  const takenDefinitionIds = {};
  targetDefinitions.forEach(item => { if (item && item.id != null) takenDefinitionIds[item.id] = true; });
  (sourcePlatform.definitions || []).forEach((definition) => {
    if (definition != null && definition.id != null) takenDefinitionIds[definition.id] = true;
  });
  const definitionIdMap = new Map();
  const importedDefinitions = [];
  (sourcePlatform.definitions || []).forEach((definition) => {
    if (definition == null) return;
    const next = {...definition, namespace};
    if (next.code != null && takenDefinitionCodes[next.code]) {
      let suffix = 2;
      let code = `${next.code}_imp`;
      while (takenDefinitionCodes[code]) {
        code = `${next.code}_imp${suffix}`;
        suffix += 1;
      }
      takenDefinitionCodes[code] = true;
      diagnostics.push({
        code: IMPORT_METRIC_CODE_RENAMED,
        kind: 'definition',
        from: next.code,
        to: code,
        message: `metric code conflict on import: ${next.code} -> ${code}`,
      });
      next.code = code;
    } else if (next.code != null) {
      takenDefinitionCodes[next.code] = true;
    }
    if (next.id != null && takenDefinitionIds[next.id]
      && (targetDefinitions.some(item => item && item.id === next.id)
        || importedDefinitions.some(item => item.id === next.id))) {
      let nextId = makeId();
      while (takenDefinitionIds[nextId]) nextId = makeId();
      takenDefinitionIds[nextId] = true;
      definitionIdMap.set(next.id, nextId);
      diagnostics.push({
        code: IMPORT_METRIC_ID_REASSIGNED,
        kind: 'definition',
        from: next.id,
        to: nextId,
        message: `definition id conflict on import: ${next.id} -> ${nextId}`,
      });
      next.id = nextId;
    } else if (next.id != null) {
      takenDefinitionIds[next.id] = true;
      definitionIdMap.set(next.id, next.id);
    }
    if (next.conceptId != null) {
      const mapped = conceptIdMap.get(next.conceptId);
      if (mapped != null) next.conceptId = mapped;
    }
    // 部门 code 冲突换名时，来源定义 scope 引用级联到来源对应部门条目
    if (next.scope != null && next.scope.departmentId != null) {
      const mappedDepartment = mapCode(codeMaps, 'departments', next.scope.departmentId);
      if (mappedDepartment !== next.scope.departmentId) {
        next.scope = {...next.scope, departmentId: mappedDepartment};
      }
    }
    importedDefinitions.push(next);
  });

  const takenRevisionIds = {};
  targetRevisions.forEach(item => { if (item && item.id != null) takenRevisionIds[item.id] = true; });
  (sourcePlatform.revisions || []).forEach((revision) => {
    if (revision != null && revision.id != null) takenRevisionIds[revision.id] = true;
  });
  const revisionIdMap = new Map();
  (sourcePlatform.revisions || []).forEach((revision) => {
    if (revision == null || revision.id == null) return;
    if (takenRevisionIds[revision.id]
      && (targetRevisions.some(item => item && item.id === revision.id))) {
      let nextId = makeId();
      while (takenRevisionIds[nextId]) nextId = makeId();
      takenRevisionIds[nextId] = true;
      revisionIdMap.set(revision.id, nextId);
      diagnostics.push({
        code: IMPORT_METRIC_ID_REASSIGNED,
        kind: 'revision',
        from: revision.id,
        to: nextId,
        message: `revision id conflict on import: ${revision.id} -> ${nextId}`,
      });
      return;
    }
    revisionIdMap.set(revision.id, revision.id);
  });

  // ---- 阶段二：引用恰好一次转换（前向引用不依赖数组顺序）+ etag/hash 重算 ----
  const importedRevisions = (sourcePlatform.revisions || [])
    .map(revision => (revision == null ? revision
      : convertRevisionForImport(revision, {
        definitionIdMap, revisionIdMap, codeMaps, merged, sources, diagnostics,
      })))
    .filter(revision => revision != null);

  // ---- 绑定：端点按合并集合重绑（未随导入 → unresolved，不误绑同号）；指标引用重映射 ----
  const takenBindingIds = {};
  targetBindings.forEach(item => { if (item && item.id != null) takenBindingIds[item.id] = true; });
  (sourcePlatform.bindings || []).forEach((binding) => {
    if (binding != null && binding.id != null) takenBindingIds[binding.id] = true;
  });
  const importedBindings = [];
  (sourcePlatform.bindings || []).forEach((binding) => {
    if (binding == null) return;
    const remapped = remapBindingForMerge(binding, merged, sources, diagnostics);
    // 退化输入（无 modelRef）原样透回时克隆，保证不改写来源对象
    const next = remapped === binding ? {...binding} : remapped;
    if (next.metricRevisionId != null) {
      const mapped = revisionIdMap.get(next.metricRevisionId);
      if (mapped != null) next.metricRevisionId = mapped;
    }
    if (next.metricDefinitionId != null) {
      const mapped = definitionIdMap.get(next.metricDefinitionId);
      if (mapped != null) next.metricDefinitionId = mapped;
    }
    if (next.metricConceptId != null) {
      const mapped = conceptIdMap.get(next.metricConceptId);
      if (mapped != null) next.metricConceptId = mapped;
    }
    next.namespace = namespace;
    if (next.id != null && takenBindingIds[next.id]
      && (targetBindings.some(item => item && item.id === next.id)
        || importedBindings.some(item => item.id === next.id))) {
      let nextId = makeId();
      while (takenBindingIds[nextId]) nextId = makeId();
      takenBindingIds[nextId] = true;
      diagnostics.push({
        code: IMPORT_METRIC_ID_REASSIGNED,
        kind: 'binding',
        from: next.id,
        to: nextId,
        message: `binding id conflict on import: ${next.id} -> ${nextId}`,
      });
      next.id = nextId;
    } else if (next.id != null) {
      takenBindingIds[next.id] = true;
    }
    importedBindings.push(next);
  });

  // ---- 阶段三：组装（目标未知键原样；来源独有未知键保留，同名冲突显式诊断） ----
  const unknownKeysAdded = mergeUnknownKeys(targetBase, sourcePlatform,
    PLATFORM_KNOWN_KEYS, diagnostics, 'metricPlatform');
  const result = {
    ...(targetBase || {}),
    schemaVersion: 1,
    namespace,
    concepts: targetConcepts.concat(importedConcepts),
    definitions: targetDefinitions.concat(importedDefinitions),
    revisions: targetRevisions.concat(importedRevisions),
    bindings: targetBindings.concat(importedBindings),
    ...(dictionary === undefined ? {} : {dictionary}),
    ...unknownKeysAdded,
  };
  if (diagnostics.length) {
    result.importDiagnostics = ((targetBase && targetBase.importDiagnostics) || []).concat(diagnostics);
  }
  // 目标与源两侧完全一致（无任何新增/诊断/未知键）时无需覆盖
  if (!importedConcepts.length && !importedDefinitions.length && !importedRevisions.length
    && !importedBindings.length && dictionary === (targetBase == null ? undefined : targetBase.dictionary)
    && !diagnostics.length && !Object.keys(unknownKeysAdded).length) {
    return null;
  }
  return result;
};
