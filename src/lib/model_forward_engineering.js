// S2：逻辑模型 → 物理模型前向生成引擎（纯函数，React/渲染无关，node 可直测）
// 严格类型映射：数据域/基础类型 → 目标 supportId 的映射行 realType；
// 反查必须唯一；缺失/失效/歧义逐字段报错阻断，绝不把源 f.type 静默当已映射。
// 产物为独立物理实体（新实体/字段/索引/关系 ID，内部引用按新旧映射重建），
// 可选溯源键 logicalEntityId / logicalFieldId；预览与计划不写源，提交一次性合并最新源。
import {appendObjectWithOptionalCategory, createPhysicalDatabase, physicalDbSupports, readPhysicalDatabases} from './model_catalog';

// 逻辑实体 defKey 约定 LE_ 前缀：生成默认表名去前缀（用户可改写）
export const stripLogicPrefix = (defKey) => {
  const key = String(defKey == null ? '' : defKey);
  return /^le_/i.test(key) ? key.slice(3) : key;
};

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
const asTrim = (v) => String(v == null ? '' : v).trim();

const pickKeys = (obj, keys) => {
  const out = {};
  keys.forEach((k) => {
    if (obj != null && obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
};

// 复制保留的字段属性：名称/注释/长度精度/约束/默认值与规范引用（域与基础类型按解析结果重建）
const FIELD_COPY_KEYS = ['defKey', 'defName', 'comment', 'domain', 'baseType',
  'primaryKey', 'notNull', 'autoIncrement', 'defaultValue', 'hideInGraph',
  'uiHint', 'refDict', 'isStandard', 'refStandard', 'intro', 'extProps'];

// ---- G02：字段映射解析 ----
// 返回 {status: 'ok'|'manual'|'error', realType, how, len, scale, baseTypeId, baseTypeName, code}
// how ∈ domain|baseType|reverse|manual；code ∈ invalidDomain|invalidBaseType|noType|
//   cannotIdentify|ambiguous|missingTargetType
export const resolveFieldMapping = (field, source, targetSupportId, override) => {
  const mappings = (source && source.dataTypeMapping && source.dataTypeMapping.mappings) || [];
  const domains = (source && source.domains) || [];
  const supports = (source && source.profile && source.profile.dataTypeSupports) || [];
  const currentDb = (source && source.profile && source.profile.default
    && source.profile.default.db) || (supports[0] ? supports[0].id : '');
  // 长度/精度：域优先，其次字段自身
  const domainData = field && field.domain != null && field.domain !== ''
    ? (domains.filter((d) => d.id === field.domain)[0] || null) : null;
  const lenScale = {
    len: domainData && domainData.len !== undefined ? domainData.len
      : (field && field.len == null ? '' : field.len),
    scale: domainData && domainData.scale !== undefined ? domainData.scale
      : (field && field.scale == null ? '' : field.scale),
  };
  const overrideType = asTrim(override);
  if (overrideType) {
    // 显式手动覆盖：标记手动指定，不宣称来自映射。
    // 审阅5：域/基础类型引用将被移除，长度精度不再继承域，回落字段自身
    return {status: 'manual', realType: overrideType, how: 'manual',
      baseTypeId: '', baseTypeName: '',
      len: field && field.len == null ? '' : (field && field.len),
      scale: field && field.scale == null ? '' : (field && field.scale)};
  }
  let row = null;
  let how = '';
  if (field && field.domain != null && field.domain !== '') {
    if (!domainData) return {status: 'error', code: 'invalidDomain', domain: field.domain};
    row = mappings.filter((m) => m.id === domainData.applyFor)[0] || null;
    how = 'domain';
    if (!row) return {status: 'error', code: 'invalidBaseType', applyFor: domainData.applyFor};
  } else if (field && field.baseType != null && field.baseType !== '') {
    row = mappings.filter((m) => m.id === field.baseType)[0] || null;
    how = 'baseType';
    if (!row) return {status: 'error', code: 'invalidBaseType', baseType: field.baseType};
  } else {
    const typeValue = asTrim(field && field.type);
    if (!typeValue) return {status: 'error', code: 'noType'};
    // 旧逻辑字段反查：按项目当前源方言类型字符串做唯一匹配（大小写无关）
    const candidates = mappings.filter((m) => norm(m[currentDb]) === norm(typeValue));
    if (candidates.length === 0) {
      return {status: 'error', code: 'cannotIdentify', type: typeValue, db: currentDb};
    }
    if (candidates.length > 1) {
      return {status: 'error', code: 'ambiguous', type: typeValue,
        candidates: candidates.map((c) => asTrim(c.defKey) || asTrim(c.defName))};
    }
    row = candidates[0];
    how = 'reverse';
  }
  const realType = row ? row[targetSupportId] : undefined;
  if (realType == null || asTrim(realType) === '') {
    return {status: 'error', code: 'missingTargetType', how,
      baseTypeId: row.id, baseTypeName: asTrim(row.defName) || asTrim(row.defKey)};
  }
  return {status: 'ok', realType: asTrim(realType), how,
    baseTypeId: row.id, baseTypeName: asTrim(row.defName) || asTrim(row.defKey),
    ...lenScale};
};

// ---- G03：DDL 模板严格前置校验（模板缺失/空内容是可恢复阻断错误）----
export const validateDDLTemplate = (source, supportId) => {
  const supports = (source && source.profile && source.profile.dataTypeSupports) || [];
  if (!supports.some((s) => s.id === supportId)) {
    return {status: 'error', code: 'invalidSupport'};
  }
  const template = ((source && source.profile && source.profile.codeTemplates) || [])
    .filter((c) => c.applyFor === supportId && c.type === 'dbDDL')[0];
  if (!template) return {status: 'error', code: 'templateMissing'};
  if (template.createTable == null || asTrim(template.createTable) === '') {
    return {status: 'error', code: 'templateEmpty'};
  }
  return {status: 'ok', template};
};

// ---- G05：全局代码唯一（entities+views，大小写无关；批内同样阻断，不自动改名）----
export const checkDefKeyUniqueness = (source, tableNames) => {
  const taken = new Map();
  (source && source.entities || []).forEach((e) => taken.set(norm(e.defKey), e.defKey));
  (source && source.views || []).forEach((v) => taken.set(norm(v.defKey), v.defKey));
  const errors = [];
  const batchSeen = new Map();
  Object.keys(tableNames || {}).forEach((entityId) => {
    const name = asTrim(tableNames[entityId]);
    if (!name) {
      errors.push({level: 'name', entityId, code: 'emptyDefKey'});
      return;
    }
    if (taken.has(norm(name))) {
      errors.push({level: 'name', entityId, code: 'duplicateDefKey',
        defKey: name, owner: taken.get(norm(name))});
      return;
    }
    const batchOwner = batchSeen.get(norm(name));
    if (batchOwner) {
      errors.push({level: 'name', entityId, code: 'duplicateDefKey',
        defKey: name, owner: batchOwner, inBatch: true});
    } else {
      batchSeen.set(norm(name), name);
    }
  });
  return errors;
};

// ---- 生成计划：纯计算，不写源（G01/G02/G04/G05/G06）----
// options: {
//   entityIds: [逻辑实体 id],
//   target: {mode: 'existing'|'new', databaseId?,
//            newDatabase: {defKey, defName?, dbTypeId, categoryId?}},
//   tableNames: {逻辑实体id: 表名}（缺省 = 前缀 + 去LE_），
//   tablePrefix?: string,
//   overrides: {'逻辑实体id:字段id': 目标类型字符串}（手动指定），
//   skipOutScopeRelations: boolean,
//   entityTemplate?: getEmptyEntity() 基底（UI 传入，含 headers/sysProps 等），
//   headers?: 表头（无 template 时的兜底），
// }
export const planForwardGeneration = (source, options) => {
  const o = options || {};
  const errors = [];
  const warnings = [];
  const logicEntities = (source && source.logicEntities) || [];

  // 1. 目标解析
  const supportIds = physicalDbSupports(source).map((s) => s.id);
  let databaseId = null;
  let targetSupportId = null;
  let newDatabase = null;
  if (o.target && o.target.mode === 'new') {
    const nd = o.target.newDatabase || {};
    if (!asTrim(nd.defKey)) {
      errors.push({level: 'target', code: 'emptyDatabaseName'});
    } else if (supportIds.indexOf(nd.dbTypeId) < 0) {
      errors.push({level: 'target', code: 'invalidDbType', dbTypeId: nd.dbTypeId});
    } else {
      // 在当前源上试建验证（同分类重名/非法类型由 S1 规则报错），不保留产物
      try {
        createPhysicalDatabase(source, {
          id: 'S2_VALIDATE_ONLY',
          categoryId: nd.categoryId == null ? null : nd.categoryId,
          defKey: asTrim(nd.defKey),
          defName: asTrim(nd.defName) || '',
          dbTypeId: nd.dbTypeId,
        });
      } catch (e) {
        errors.push({level: 'target', code: 'databaseCreateFailed', message: e.message});
      }
      if (!errors.some((err) => err.level === 'target')) {
        newDatabase = {
          id: Math.uuid(),
          categoryId: nd.categoryId == null ? null : nd.categoryId,
          defKey: asTrim(nd.defKey),
          defName: asTrim(nd.defName) || '',
          dbTypeId: nd.dbTypeId,
        };
        databaseId = newDatabase.id;
        targetSupportId = nd.dbTypeId;
      }
    }
  } else if (o.target && o.target.mode === 'existing') {
    const db = readPhysicalDatabases(source)
      .filter((d) => d.id === o.target.databaseId)[0] || null;
    if (!db) {
      errors.push({level: 'target', code: 'targetDatabaseMissing',
        databaseId: o.target.databaseId});
    } else {
      databaseId = db.id;
      targetSupportId = db.dbTypeId;
    }
  } else {
    errors.push({level: 'target', code: 'targetRequired'});
  }
  if (targetSupportId && validateDDLTemplate(source, targetSupportId).status !== 'ok') {
    const v = validateDDLTemplate(source, targetSupportId);
    errors.push({level: 'target', code: v.code, dbTypeId: targetSupportId});
  }

  // 2. 源逻辑实体存在性 + 表名默认值
  const selected = [];
  (o.entityIds || []).forEach((id) => {
    const logic = logicEntities.filter((l) => l.id === id)[0];
    if (!logic) {
      errors.push({level: 'entity', entityId: id, code: 'logicalEntityMissing'});
      return;
    }
    selected.push(logic);
  });
  if (selected.length === 0 && !errors.length) {
    errors.push({level: 'entity', code: 'noSourceSelected'});
  }
  // 重复生成提示提前计算（即使表名冲突阻断，也能提示已有产物供改名）
  const selectedIdSet = new Set(selected.map((l) => l.id));
  (source && source.entities || []).forEach((p) => {
    if (p.logicalEntityId && selectedIdSet.has(p.logicalEntityId)) {
      warnings.push({level: 'generate', code: 'existingArtifact',
        logicalEntityId: p.logicalEntityId, defKey: p.defKey});
    }
  });
  const tableNames = {};
  selected.forEach((logic) => {
    const custom = o.tableNames ? o.tableNames[logic.id] : undefined;
    // 审阅1：未提供才回落默认名；用户显式给值（含空串/纯空白）按原样校验，
    // 空白由 checkDefKeyUniqueness 报 emptyDefKey，不再静默回落前缀默认名
    tableNames[logic.id] = custom === undefined
      ? (asTrim(o.tablePrefix) || '') + stripLogicPrefix(logic.defKey)
      : asTrim(custom);
  });
  checkDefKeyUniqueness(source, tableNames).forEach((err) => errors.push(err));

  // 3. 逐字段映射（严格解析；错误逐字段阻断）
  const entityMap = {};   // 逻辑id -> 新物理id
  const fieldMaps = {};   // 逻辑id -> {旧字段id -> 新字段id}
  const resolutions = {}; // 逻辑id -> [{fieldId, defKey, result}]
  selected.forEach((logic) => {
    entityMap[logic.id] = Math.uuid();
    fieldMaps[logic.id] = {};
    resolutions[logic.id] = [];
    (logic.fields || []).forEach((f) => {
      const key = `${logic.id}:${f.id}`;
      const result = resolveFieldMapping(f, source, targetSupportId,
        o.overrides ? o.overrides[key] : undefined);
      resolutions[logic.id].push({fieldId: f.id, defKey: f.defKey, result});
      if (result.status === 'error') {
        errors.push({level: 'field', entityId: logic.id, fieldId: f.id,
          defKey: f.defKey, entityDefKey: logic.defKey, ...result});
      }
    });
  });

  // 4. 批内字段重名（大小写无关、trim 后）阻断；字段代码为空同样逐字段阻断
  selected.forEach((logic) => {
    const seen = new Map();
    (logic.fields || []).forEach((f) => {
      const k = norm(f.defKey);
      if (!k) {
        // 审阅2：空 defKey 不允许静默生成无名字段
        errors.push({level: 'field', entityId: logic.id, fieldId: f.id,
          code: 'emptyFieldKey', defKey: f.defKey});
        return;
      }
      if (seen.has(k)) {
        errors.push({level: 'field', entityId: logic.id, fieldId: f.id,
          code: 'duplicateField', defKey: f.defKey});
      } else seen.set(k, f.defKey);
    });
  });

  if (errors.length) {
    return {status: 'error', errors, warnings, plan: null};
  }

  // 5. 组装新实体（新字段/索引 ID；引用重建；范围外关系处理）
  const outOfScope = [];   // {kind: 'correlation'|'fieldRef', from, to, field?}
  const dropped = [];      // 用户显式跳过时被移除的范围外引用（预览列出）
  const skip = !!o.skipOutScopeRelations;
  const selectedIds = new Set(selected.map((l) => l.id));
  // 第一遍：先为全部所选实体生成新字段，填满 fieldMaps（供第二遍关系/索引引用）
  const newFieldsByLogic = {};
  selected.forEach((logic) => {
    newFieldsByLogic[logic.id] = (logic.fields || []).map((f) => {
      const res = resolutions[logic.id].filter((r) => r.fieldId === f.id)[0].result;
      const newField = {
        id: Math.uuid(),
        ...pickKeys(f, FIELD_COPY_KEYS),
        type: res.realType,
        len: res.len,
        scale: res.scale,
        logicalFieldId: f.id,
      };
      if (f.baseType === undefined && res.baseTypeId) newField.baseType = res.baseTypeId;
      // 审阅5：手动覆盖类型时移除域/基础类型引用，避免 _transform 在
      // 字段编辑/图/DDL 渲染时按原映射改写回非手动类型
      if (res.how === 'manual') {
        delete newField.domain;
        delete newField.baseType;
      }
      fieldMaps[logic.id][f.id] = newField.id;
      return newField;
    });
  });
  const entities = selected.map((logic) => {
    const newEntityId = entityMap[logic.id];
    const fields = newFieldsByLogic[logic.id].map((newField, i) => {
      const f = (logic.fields || [])[i];
      const next = {...newField};
      // 字段级引用（refEntity/refEntityField 指向逻辑实体/字段）
      if (f.refEntity != null && f.refEntity !== '') {
        if (selectedIds.has(f.refEntity)) {
          next.refEntity = entityMap[f.refEntity];
          const refLogic = logicEntities.filter((l) => l.id === f.refEntity)[0];
          const mapped = refLogic && fieldMaps[refLogic.id]
            ? fieldMaps[refLogic.id][f.refEntityField] : undefined;
          if (f.refEntityField != null && f.refEntityField !== '' && !mapped) {
            errors.push({level: 'relation', entityId: logic.id, fieldId: f.id,
              code: 'refFieldMissing', refEntity: refLogic ? refLogic.defKey : f.refEntity});
          } else if (mapped) {
            next.refEntityField = mapped;
          }
        } else {
          const refName = logicEntities.filter((l) => l.id === f.refEntity)[0];
          outOfScope.push({kind: 'fieldRef', from: logic.defKey, field: f.defKey,
            to: refName ? refName.defKey : f.refEntity});
          if (skip) {
            dropped.push(outOfScope[outOfScope.length - 1]);
            delete next.refEntity;
            delete next.refEntityField;
          }
        }
      }
      return next;
    });
    // 索引重建（索引/索引字段均新 ID，fieldDefKey 按新旧字段映射）
    // 审阅3：索引字段无法在新字段中定位端点时逐索引报错阻断并定位，
    // 不在用户未明确选择时静默丢弃索引约束；源索引本身无字段仅告警不生成
    const indexes = [];
    (logic.indexes || []).forEach((idx) => {
      const sourceIdxFields = idx.fields || [];
      const missing = sourceIdxFields
        .filter(x => fieldMaps[logic.id][x.fieldDefKey] == null);
      if (sourceIdxFields.length && missing.length) {
        errors.push({level: 'index', entityId: logic.id, code: 'indexFieldMissing',
          defKey: idx.defKey || idx.defName,
          fields: missing.map(x => x.fieldDefKey)});
        return;
      }
      const idxFields = sourceIdxFields
        .map((x) => ({
          ...x,
          id: Math.uuid(),
          fieldDefKey: fieldMaps[logic.id][x.fieldDefKey],
        }));
      if (idxFields.length !== sourceIdxFields.length) {
        warnings.push({level: 'index', entityId: logic.id, index: idx.defKey,
          code: 'indexFieldDropped'});
      }
      if (idxFields.length) {
        indexes.push({
          ...pickKeys(idx, ['defKey', 'defName', 'unique', 'comment']),
          id: Math.uuid(),
          fields: idxFields,
        });
      }
    });
    // 关系重建：范围内两端换新 ID；范围外按选择阻断或显式跳过（不留逻辑 ID）
    const correlations = [];
    (logic.correlations || []).forEach((c) => {
      if (selectedIds.has(c.refEntity)) {
        const refLogic = logicEntities.filter((l) => l.id === c.refEntity)[0];
        const myField = fieldMaps[logic.id][c.myField];
        const refField = fieldMaps[c.refEntity][c.refField];
        if (!myField || !refField) {
          errors.push({level: 'relation', entityId: logic.id,
            code: 'relationFieldMissing', refEntity: refLogic ? refLogic.defKey : c.refEntity});
          return;
        }
        // 审阅4：带身份字段的关系同样必须独立新 ID（端点已换新 ID，源关系 ID 不复用）
        correlations.push({...c, id: Math.uuid(),
          myField, refEntity: entityMap[c.refEntity], refField});
      } else {
        const refName = logicEntities.filter((l) => l.id === c.refEntity)[0];
        outOfScope.push({kind: 'correlation', from: logic.defKey,
          to: refName ? refName.defKey : c.refEntity});
        if (skip) dropped.push(outOfScope[outOfScope.length - 1]);
      }
    });
    return {
      ...(o.entityTemplate || {}),
      headers: (o.entityTemplate && o.entityTemplate.headers && o.entityTemplate.headers.length)
        ? o.entityTemplate.headers : (o.headers || []),
      env: logic.env || (o.entityTemplate ? o.entityTemplate.env : undefined)
        || {base: {nameSpace: '', codeRoot: ''}},
      id: newEntityId,
      type: 'P',
      defKey: tableNames[logic.id],
      defName: logic.defName || '',
      comment: logic.comment || '',
      notes: logic.notes || {},
      fields,
      indexes,
      correlations,
      physicalDatabaseId: databaseId,
      physicalDbTypeId: targetSupportId,
      logicalEntityId: logic.id,
    };
  });

  if (outOfScope.length && !skip) {
    errors.push({level: 'relation', code: 'outOfScopeRelations', items: outOfScope});
  }
  if (errors.length) {
    return {status: 'error', errors, warnings, plan: null};
  }

  return {
    status: 'ok',
    errors,
    warnings,
    plan: {
      entities,
      entityMap,
      fieldMaps,
      outOfScope,
      dropped,
      databaseId,
      targetSupportId,
      newDatabase,
      tableNames,
    },
  };
};

// ---- G06：原子提交（审阅7：保存基底与规划输入可分离——以最新已保存源为合并基底、
// 最新有效模型为规划输入；只把新库/新表/目标分类成员原子并入基底，
// 不携带其他 tab 草稿，不覆盖无关图布局。期间任何变化回冲突，不覆盖并行编辑）----
export const buildForwardCommit = (latestSource, options, draftSource) => {
  const replan = planForwardGeneration(draftSource || latestSource, options);
  if (replan.status !== 'ok') {
    return {status: 'conflict', errors: replan.errors};
  }
  // 基底与规划源分离后再在基底上复验：基底独有的同名实体/失效模板同样冲突
  const baseNameErrors = checkDefKeyUniqueness(latestSource, replan.plan.tableNames);
  if (baseNameErrors.length) {
    return {status: 'conflict', errors: baseNameErrors};
  }
  const baseTemplate = validateDDLTemplate(latestSource, replan.plan.targetSupportId);
  if (baseTemplate.status !== 'ok') {
    return {status: 'conflict', errors: [{level: 'target', code: baseTemplate.code,
      dbTypeId: replan.plan.targetSupportId}]};
  }
  let next = latestSource;
  if (replan.plan.newDatabase) {
    try {
      next = createPhysicalDatabase(next, replan.plan.newDatabase);
    } catch (e) {
      return {status: 'conflict', errors: [{level: 'target',
        code: 'databaseCreateFailed', message: e.message}]};
    }
  }
  // 审阅6：目标库（新建或既有）归属分类时，产物表同事务挂接该分类成员；
  // 库未归类则保持未归类（允许），不伪造分类；既有成员与草稿一律保留
  const targetDb = replan.plan.databaseId
    ? readPhysicalDatabases(next).filter(d => d.id === replan.plan.databaseId)[0] : null;
  const targetCategoryId = targetDb ? targetDb.categoryId : null;
  replan.plan.entities.forEach((e) => {
    next = appendObjectWithOptionalCategory(next, 'entity', e,
      targetCategoryId == null ? null : targetCategoryId);
  });
  return {
    status: 'ok',
    nextSource: next,
    plan: replan.plan,
  };
};

// ---- UX-13：DDL 预览按目标库方言选择 ace 高亮模式 ----
// 模式均由 ace-builds/webpack-resolver（codeeditor 已引入）按需加载，无需逐个 import
const DDL_LANGUAGES = {
  mysql: 'mysql',
  postgresql: 'pgsql',
  oracle: 'plsql',
  sqlserver: 'sql',
  default: 'sql',
};
// dbTypeId：类型代码（MYSQL/PostgreSQL/ORACLE/SQLServer，大小写无关）；
// 真实项目里存的是 dataTypeSupports 的 UUID，传入 source 时先解析为该类型的 defKey
export const ddlLanguageFor = (dbTypeId, source) => {
  const supports = (source && source.profile && source.profile.dataTypeSupports) || [];
  const support = dbTypeId == null ? null : supports.filter(s => s && s.id === dbTypeId)[0];
  const raw = support ? support.defKey : dbTypeId;
  const key = String(raw == null ? '' : raw).trim().toLowerCase();
  return key !== 'default' && Object.prototype.hasOwnProperty.call(DDL_LANGUAGES, key)
    ? DDL_LANGUAGES[key] : DDL_LANGUAGES.default;
};

// ---- UX-13：向导完成后宿主定位的新表——按生成顺序取第一个确实已并入源的物理表 ----
export const firstCreatedEntity = (source, createdEntityIds) => {
  const entities = (source && source.entities) || [];
  const ids = createdEntityIds || [];
  for (let i = 0; i < ids.length; i += 1) {
    const found = entities.filter(e => e && e.id === ids[i])[0];
    if (found) return found;
  }
  return null;
};
