// 指标平台 M3A：语义字典（部门/维度/业务限定/统计周期/单位）纯函数层。
// - 存储位于 profile.metricPlatform.dictionary（schemaVersion 1 的增量键，旧项目缺失只读为空，
//   不初始化样例；dictionary 内未知键与其他分类在写入时原样保留）；
// - 业务域/概念复用 concepts，不建第二事实源；
// - 条目按稳定 id 管理；部门/维度/单位的 code 是被指标引用的稳定标识（identity），
//   限定/周期的 code 仅作字典内标签——spec 固化的是具体值快照，不存字典引用；
// - 删除与语义改动做引用检查：被草案/发布/部门 scope 引用即拒绝（DICTIONARY_IN_USE，
//   明确引导停用），不静默断引用；非语义改动（名称/说明/启停）随时允许；
// - 维度带明确值类型 string/number/boolean：'001' 按字符串类型保持字符串，false 必须是布尔 false；
//   限定值 in/not_in 逐项按类型解析校验。禁自由 SQL。
// 注：构建链不识别 ??，使用 == null 三元。

import {invalidValueError, metricError, missingFieldError, unknownKeyError} from './errors';
import {hashValue, newMetricId} from './hash';
import {isStoreWritable, readMetricPlatform, writeMetricPlatform} from './store';
import {QUALIFIER_OPS} from './validate';
import {validateWindow} from './window';

export const DICTIONARY_CATEGORIES = ['departments', 'dimensions', 'qualifiers', 'periods', 'units'];
export const DIMENSION_VALUE_TYPES = ['string', 'number', 'boolean'];
export const DICTIONARY_STATUSES = ['active', 'disabled'];

const CATEGORY_KEYS = {
  departments: ['id', 'code', 'name', 'description', 'status'],
  dimensions: ['id', 'code', 'name', 'valueType', 'description', 'status'],
  qualifiers: ['id', 'code', 'name', 'dimensionId', 'op', 'value', 'description', 'status'],
  periods: ['id', 'code', 'name', 'window', 'description', 'status'],
  units: ['id', 'code', 'name', 'description', 'status'],
};
// 语义键：改变即视为口径变化，被引用时拒绝（其余键随时可改）
const CATEGORY_SEMANTIC_KEYS = {
  departments: ['code'],
  dimensions: ['code', 'valueType'],
  qualifiers: ['dimensionId', 'op', 'value'],
  periods: ['window'],
  units: ['code'],
};
const CATEGORY_ID_PREFIX = {
  departments: 'mdept', dimensions: 'mdim', qualifiers: 'mqual',
  periods: 'mperiod', units: 'munit',
};
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

const cloneJson = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const sameValue = (left, right) => hashValue(left) === hashValue(right);

const isDictionaryCategory = (category) => DICTIONARY_CATEGORIES.indexOf(category) >= 0;

const categoryError = () => invalidValueError('dictionary.category',
  `dictionary.category must be one of ${DICTIONARY_CATEGORIES.join('/')}`);

// ---- 有类型标量解析（字典编辑器与指标限定值共用；不做启发式转换） ----
export const parseTypedScalar = (text, valueType) => {
  if (valueType === 'boolean') {
    const raw = String(text).trim().toLowerCase();
    if (raw === 'true') return {ok: true, value: true};
    if (raw === 'false') return {ok: true, value: false};
    return {ok: false, error: invalidValueError('', 'boolean value must be true or false')};
  }
  if (valueType === 'number') {
    const raw = String(text).trim();
    if (raw === '' || !/^-?\d+(\.\d+)?$/.test(raw)) {
      return {ok: false, error: invalidValueError('', 'number value expected')};
    }
    return {ok: true, value: Number(raw)};
  }
  return {ok: true, value: String(text).trim()};
};

// in/not_in 逐项按类型解析：任一项不合法即整体失败（不部分吞错）
export const parseTypedList = (text, valueType) => {
  const parts = String(text).split(',').map(s => s.trim()).filter(s => s !== '');
  if (parts.length === 0) {
    return {ok: false, error: invalidValueError('', 'at least one value expected')};
  }
  const values = [];
  for (let i = 0; i < parts.length; i += 1) {
    const parsed = parseTypedScalar(parts[i], valueType);
    if (!parsed.ok) {
      return {ok: false, error: invalidValueError('', `item ${i + 1}: ${parsed.error.message}`)};
    }
    values.push(parsed.value);
  }
  return {ok: true, values};
};

const checkTypedValue = (value, valueType, op, path) => {
  if (op === 'in' || op === 'not_in') {
    if (typeof value === 'string') {
      const parsed = parseTypedList(value, valueType);
      if (!parsed.ok) return [invalidValueError(`${path}.value`, parsed.error.message)];
      return [];
    }
    if (!Array.isArray(value)) {
      return [invalidValueError(`${path}.value`, 'in/not_in requires array value')];
    }
    const errors = [];
    value.forEach((item, index) => {
      const itemType = item === null ? 'null' : typeof item;
      if (itemType !== valueType) {
        errors.push(invalidValueError(`${path}.value[${index}]`,
          `item type ${itemType} does not match dimension value type ${valueType}`));
      }
    });
    return errors;
  }
  if (typeof value === 'string') {
    const parsed = parseTypedScalar(value, valueType);
    if (!parsed.ok) return [invalidValueError(`${path}.value`, parsed.error.message)];
    return [];
  }
  if (typeof value !== valueType) {
    return [invalidValueError(`${path}.value`,
      `value type ${value === null ? 'null' : typeof value} does not match dimension value type ${valueType}`)];
  }
  return [];
};

const coerceTypedValue = (value, valueType, op) => {
  if (typeof value === 'string') {
    if (op === 'in' || op === 'not_in') return parseTypedList(value, valueType).values;
    return parseTypedScalar(value, valueType).value;
  }
  return value;
};

// ---- 读取 ----
export const emptyMetricDictionary = () => ({
  departments: [], dimensions: [], qualifiers: [], periods: [], units: [],
});

export const readMetricDictionary = (source) => {
  const data = readMetricPlatform(source);
  const dict = data.dictionary == null || typeof data.dictionary !== 'object' ? {} : data.dictionary;
  const out = emptyMetricDictionary();
  DICTIONARY_CATEGORIES.forEach((category) => {
    out[category] = Array.isArray(dict[category]) ? dict[category].slice() : [];
  });
  if (data.unsupportedSchemaVersion === true) out.unsupportedSchemaVersion = true;
  return out;
};

export const listDictionaryEntries = (source, category, filter) => {
  const dict = readMetricDictionary(source);
  if (!isDictionaryCategory(category)) return [];
  let entries = (dict[category] || []).slice();
  if (filter != null && filter.search != null && filter.search !== '') {
    const needle = String(filter.search).toLowerCase();
    entries = entries.filter(entry =>
      String(entry.code).toLowerCase().indexOf(needle) >= 0
      || String(entry.name).toLowerCase().indexOf(needle) >= 0);
  }
  return entries;
};

export const getDictionaryEntry = (source, category, id) => {
  if (!isDictionaryCategory(category)) return null;
  return (readMetricDictionary(source)[category] || []).filter(entry => entry.id === id)[0] || null;
};

export const findDictionaryEntryByCode = (source, category, code) => {
  if (!isDictionaryCategory(category)) return null;
  return (readMetricDictionary(source)[category] || [])
    .filter(entry => entry.code === code)[0] || null;
};

// ---- 引用扫描（按稳定 code/具体值匹配，绝不由显示名反查身份） ----
// → [{definitionId, definitionCode, definitionName, kind, revisionId, version, status, where[]}]
const qualifierMatchesEntry = (qualifier, entry) => qualifier != null
  && qualifier.dimensionId === entry.dimensionId && qualifier.op === entry.op
  && sameValue(qualifier.value, entry.value);

const scanQualifierRows = (rows, category, entry, base) => {
  const hits = [];
  (rows || []).forEach((qualifier, index) => {
    if (qualifier == null) return;
    if (category === 'dimensions' && qualifier.dimensionId === entry.code) {
      hits.push(`${base}[${index}].dimensionId`);
    }
    if (category === 'qualifiers' && qualifierMatchesEntry(qualifier, entry)) {
      hits.push(`${base}[${index}]`);
    }
  });
  return hits;
};

const dictionaryReferencesFromStore = (data, category, entry) => {
  const definitionById = {};
  (data.definitions || []).forEach((definition) => {
    definitionById[definition.id] = definition;
  });
  const refs = [];
  const refIndex = (definitionId, revisionId) => {
    const key = `${definitionId}::${revisionId == null ? '' : revisionId}`;
    let hit = null;
    refs.forEach((ref) => {
      if (ref.__key === key) hit = ref;
    });
    if (hit != null) return hit;
    const definition = definitionById[definitionId] || {id: definitionId, code: definitionId, name: definitionId};
    const created = {
      __key: key,
      definitionId,
      definitionCode: definition.code,
      definitionName: definition.name,
      kind: definition.kind,
      revisionId: revisionId == null ? null : revisionId,
      version: null,
      status: null,
      where: [],
    };
    refs.push(created);
    return created;
  };
  if (category === 'departments') {
    (data.definitions || []).forEach((definition) => {
      if (definition.scope && definition.scope.kind === 'department'
        && definition.scope.departmentId === entry.code) {
        refIndex(definition.id, null).where.push('scope.departmentId');
      }
    });
  }
  (data.revisions || []).forEach((revision) => {
    const spec = revision.spec || {};
    const where = [];
    where.push(...scanQualifierRows(spec.baseQualifiers, category, entry, 'spec.baseQualifiers'));
    where.push(...scanQualifierRows(spec.qualifiers, category, entry, 'spec.qualifiers'));
    if (category === 'dimensions') {
      (spec.dimensions || []).forEach((dimension, index) => {
        if (dimension != null && dimension.dimensionId === entry.code) {
          where.push(`spec.dimensions[${index}].dimensionId`);
        }
      });
      (spec.outputGrain || []).forEach((dim, index) => {
        if (dim === entry.code) where.push(`spec.outputGrain[${index}]`);
      });
    }
    if (category === 'units' && spec.kind === 'atomic' && spec.unit === entry.code) {
      where.push('spec.unit');
    }
    if (category === 'periods' && spec.kind === 'derived'
      && spec.window != null && sameValue(spec.window, entry.window)) {
      where.push('spec.window');
    }
    const patch = revision.patch == null ? {} : revision.patch;
    where.push(...scanQualifierRows(patch.addQualifiers, category, entry, 'patch.addQualifiers'));
    if (category === 'dimensions' && Array.isArray(patch.restrictDimensions)) {
      patch.restrictDimensions.forEach((dim, index) => {
        if (dim === entry.code) where.push(`patch.restrictDimensions[${index}]`);
      });
    }
    if (where.length) {
      const ref = refIndex(revision.definitionId, revision.id);
      ref.version = revision.version == null ? ref.version : revision.version;
      ref.status = revision.status == null ? ref.status : revision.status;
      ref.where.push(...where);
    }
  });
  return refs.map(ref => {
    const {__key, ...rest} = ref;
    return rest;
  });
};

export const listDictionaryReferences = (source, category, id) => {
  if (!isDictionaryCategory(category)) return [];
  const data = readMetricPlatform(source);
  const entry = ((data.dictionary == null ? {} : data.dictionary)[category] || [])
    .filter(item => item.id === id)[0];
  if (entry == null) return [];
  return dictionaryReferencesFromStore(data, category, entry)
    .concat(intraDictionaryReferences(data, category, entry));
};

// 字典条目间依赖（M3B）：限定条目按稳定 code 引用维度；被限定依赖的维度
// 在删除/改值类型（语义键）时同样受 DICTIONARY_IN_USE 保护，避免孤儿限定与类型失真
const intraDictionaryReferences = (data, category, entry) => {
  if (category !== 'dimensions') return [];
  const dictionary = data.dictionary == null || typeof data.dictionary !== 'object'
    ? {} : data.dictionary;
  const qualifiers = Array.isArray(dictionary.qualifiers) ? dictionary.qualifiers : [];
  return qualifiers
    .filter(qualifier => qualifier != null && qualifier.dimensionId === entry.code)
    .map(qualifier => ({
      definitionId: qualifier.id,
      definitionCode: qualifier.code,
      definitionName: qualifier.name,
      kind: 'qualifier',
      revisionId: null,
      version: null,
      status: qualifier.status,
      where: ['dictionary.qualifiers.dimensionId'],
    }));
};

// ---- 写入 ----
const validateEntry = (category, input, dimensions) => {
  const errors = [];
  const path = `dictionary.${category}`;
  if (input == null || typeof input !== 'object') {
    errors.push(invalidValueError(path, 'dictionary entry must be an object'));
    return errors;
  }
  Object.keys(input).forEach((key) => {
    if (CATEGORY_KEYS[category].indexOf(key) < 0) errors.push(unknownKeyError(path, key));
  });
  if (input.code == null || String(input.code).trim() === '') errors.push(missingFieldError(path, 'code'));
  else if (typeof input.code !== 'string' || !CODE_PATTERN.test(input.code)) {
    errors.push(invalidValueError(`${path}.code`,
      `code must match ${CODE_PATTERN} (stable identity, not a display name)`));
  }
  if (input.name == null || String(input.name).trim() === '') errors.push(missingFieldError(path, 'name'));
  else if (typeof input.name !== 'string') errors.push(invalidValueError(`${path}.name`, 'name must be a string'));
  if (input.description !== undefined && typeof input.description !== 'string') {
    errors.push(invalidValueError(`${path}.description`, 'description must be a string'));
  }
  const status = input.status == null ? 'active' : input.status;
  if (DICTIONARY_STATUSES.indexOf(status) < 0) {
    errors.push(invalidValueError(`${path}.status`, `status must be one of ${DICTIONARY_STATUSES.join('/')}`));
  }
  if (category === 'dimensions') {
    if (DIMENSION_VALUE_TYPES.indexOf(input.valueType) < 0) {
      errors.push(invalidValueError(`${path}.valueType`,
        `valueType must be one of ${DIMENSION_VALUE_TYPES.join('/')}`));
    }
  }
  if (category === 'qualifiers') {
    if (input.dimensionId == null || input.dimensionId === '') {
      errors.push(missingFieldError(path, 'dimensionId'));
    } else if (!(dimensions || []).some(dim => dim.code === input.dimensionId)) {
      errors.push(metricError('UNKNOWN_REFERENCE', `${path}.dimensionId`, 'metric.error.unknownReference',
        `qualifier dimension not in dictionary: ${input.dimensionId}`, {ref: input.dimensionId}));
    }
    if (input.op == null) errors.push(missingFieldError(path, 'op'));
    else if (QUALIFIER_OPS.indexOf(input.op) < 0) {
      errors.push(invalidValueError(`${path}.op`, `op must be one of ${QUALIFIER_OPS.join('/')}`));
    }
    if (input.value === undefined || input.value === '') errors.push(missingFieldError(path, 'value'));
    else if (input.dimensionId != null && input.op != null) {
      const dimension = (dimensions || []).filter(dim => dim.code === input.dimensionId)[0];
      if (dimension != null) {
        checkTypedValue(input.value, dimension.valueType, input.op, path).forEach(e => errors.push(e));
      }
    }
  }
  if (category === 'periods') {
    validateWindow(input.window, `${path}.window`).forEach(e => errors.push(e));
  }
  return errors;
};

const writeCategory = (source, data, category, list) => {
  const dictionary = data.dictionary == null ? {} : data.dictionary;
  return writeMetricPlatform(source, {
    ...data,
    dictionary: {...dictionary, [category]: list},
  });
};

const storeGuardErrors = (data) => {
  if (!isStoreWritable(data)) {
    return [metricError('SCHEMA_VERSION_UNSUPPORTED', 'profile.metricPlatform.schemaVersion',
      'metric.error.schemaUnsupported', 'metric platform schema version unsupported')];
  }
  return [];
};

const inUseError = (category, entry, refs) => metricError('DICTIONARY_IN_USE',
  `dictionary.${category}.${entry.id}`, 'metric.error.dictionaryInUse',
  `dictionary entry is referenced by ${refs.length} metric place(s); disable it instead of deleting or changing semantics`,
  {refs: refs.map(ref => ref.definitionCode + (ref.where.length ? `@${ref.where.join('+')}` : ''))
    .join(', ').slice(0, 200)});

export const createDictionaryEntry = (source, category, input) => {
  const data = readMetricPlatform(source);
  const guard = storeGuardErrors(data);
  if (guard.length) return {ok: false, errors: guard};
  if (!isDictionaryCategory(category)) return {ok: false, errors: [categoryError()]};
  const dictionary = data.dictionary == null || typeof data.dictionary !== 'object'
    ? {} : data.dictionary;
  const current = Array.isArray(dictionary[category]) ? dictionary[category] : [];
  const dimensions = category === 'qualifiers'
    ? (dictionary.dimensions == null ? [] : dictionary.dimensions) : [];
  const candidate = {status: 'active', ...input};
  delete candidate.id;
  const errors = validateEntry(category, candidate, dimensions);
  if (errors.length) return {ok: false, errors};
  if (current.some(entry => entry.code === candidate.code)) {
    return {ok: false, errors: [metricError('DUPLICATE_CODE', `dictionary.${category}.code`,
      'metric.error.duplicateDictionaryCode',
      `dictionary code already exists in ${category}: ${candidate.code}`, {code: candidate.code})]};
  }
  const id = input.id || newMetricId(CATEGORY_ID_PREFIX[category]);
  if (current.some(entry => entry.id === id)) {
    return {ok: false, errors: [metricError('DUPLICATE_ID', `dictionary.${category}.id`,
      'metric.error.duplicateId', `dictionary entry id already exists: ${id}`, {id})]};
  }
  const entry = {id, code: candidate.code.trim(), name: candidate.name.trim(),
    ...(candidate.description == null || candidate.description === '' ? {} : {description: candidate.description}),
    status: candidate.status};
  if (category === 'dimensions') entry.valueType = candidate.valueType;
  if (category === 'qualifiers') {
    entry.dimensionId = candidate.dimensionId;
    entry.op = candidate.op;
    entry.value = cloneJson(coerceTypedValue(candidate.value,
      dimensions.filter(dim => dim.code === candidate.dimensionId)[0].valueType, candidate.op));
  }
  if (category === 'periods') entry.window = cloneJson(candidate.window);
  return {
    ok: true,
    source: writeCategory(source, data, category, current.concat([entry])),
    entry: cloneJson(entry),
  };
};

export const updateDictionaryEntry = (source, category, id, patch) => {
  const data = readMetricPlatform(source);
  const guard = storeGuardErrors(data);
  if (guard.length) return {ok: false, errors: guard};
  if (!isDictionaryCategory(category)) return {ok: false, errors: [categoryError()]};
  const dictionary = data.dictionary == null || typeof data.dictionary !== 'object'
    ? {} : data.dictionary;
  const current = Array.isArray(dictionary[category]) ? dictionary[category] : [];
  const entry = current.filter(item => item.id === id)[0];
  if (entry == null) {
    return {ok: false, errors: [metricError('UNKNOWN_REFERENCE', `dictionary.${category}.id`,
      'metric.error.unknownReference', `dictionary entry does not exist: ${id}`, {ref: id})]};
  }
  const cleanPatch = patch == null ? {} : patch;
  const candidate = {...entry};
  Object.keys(cleanPatch).forEach((key) => {
    if (key !== 'id' && cleanPatch[key] !== undefined) candidate[key] = cleanPatch[key];
  });
  const dimensions = category === 'qualifiers'
    ? (dictionary.dimensions == null ? [] : dictionary.dimensions) : [];
  const errors = validateEntry(category, candidate, dimensions);
  if (errors.length) return {ok: false, errors};
  if (current.some(item => item.id !== id && item.code === candidate.code)) {
    return {ok: false, errors: [metricError('DUPLICATE_CODE', `dictionary.${category}.code`,
      'metric.error.duplicateDictionaryCode',
      `dictionary code already exists in ${category}: ${candidate.code}`, {code: candidate.code})]};
  }
  // 语义改动 + 被引用（指标或字典内依赖）→ 拒绝（不静默断引用；引导停用后新建替代条目）
  const semanticChanged = CATEGORY_SEMANTIC_KEYS[category]
    .some(key => !sameValue(candidate[key], entry[key]));
  if (semanticChanged) {
    const refs = dictionaryReferencesFromStore(data, category, entry)
      .concat(intraDictionaryReferences(data, category, entry));
    if (refs.length) return {ok: false, errors: [inUseError(category, entry, refs)]};
  }
  const next = {...candidate, id};
  if (category === 'qualifiers') {
    next.value = cloneJson(coerceTypedValue(candidate.value,
      dimensions.filter(dim => dim.code === candidate.dimensionId)[0].valueType, candidate.op));
  }
  if (category === 'periods') next.window = cloneJson(candidate.window);
  return {
    ok: true,
    source: writeCategory(source, data, category,
      current.map(item => (item.id === id ? next : item))),
    entry: cloneJson(next),
  };
};

export const deleteDictionaryEntry = (source, category, id) => {
  const data = readMetricPlatform(source);
  const guard = storeGuardErrors(data);
  if (guard.length) return {ok: false, errors: guard};
  if (!isDictionaryCategory(category)) return {ok: false, errors: [categoryError()]};
  const dictionary = data.dictionary == null || typeof data.dictionary !== 'object'
    ? {} : data.dictionary;
  const current = Array.isArray(dictionary[category]) ? dictionary[category] : [];
  const entry = current.filter(item => item.id === id)[0];
  if (entry == null) {
    return {ok: false, errors: [metricError('UNKNOWN_REFERENCE', `dictionary.${category}.id`,
      'metric.error.unknownReference', `dictionary entry does not exist: ${id}`, {ref: id})]};
  }
  const refs = dictionaryReferencesFromStore(data, category, entry)
    .concat(intraDictionaryReferences(data, category, entry));
  if (refs.length) return {ok: false, errors: [inUseError(category, entry, refs)]};
  return {
    ok: true,
    source: writeCategory(source, data, category, current.filter(item => item.id !== id)),
  };
};
