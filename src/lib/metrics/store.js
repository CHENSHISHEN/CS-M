// 指标平台 M1：profile.metricPlatform 本地存储适配（纯函数）。
// 数据合同：profile.metricPlatform = {schemaVersion:1, namespace, concepts[], definitions[], revisions[], ...未知键}
// - 缺失时只读为空，绝不初始化样例；首次写入时创建稳定项目命名空间并沿用。
// - 写入基于最新 source 浅克隆，只替换 metricPlatform 已知键；
//   profile 其他键、模型集合（entities 等）与 metricPlatform 未知键全部原样保留。
// 注：构建链不识别 ??，一律使用 == null 三元（同 concept_logical_links）。

import {newMetricId, hashValue} from './hash';
import {metricError} from './errors';

export const METRIC_PLATFORM_KEY = 'metricPlatform';
export const METRIC_PLATFORM_SCHEMA_VERSION = 1;

export const emptyMetricPlatform = () => ({
  schemaVersion: METRIC_PLATFORM_SCHEMA_VERSION,
  namespace: null,
  concepts: [],
  definitions: [],
  revisions: [],
});

// ---- normalize（MET-09）：损坏存储读取不抛 TypeError ----
// 诊断 {code:'STORE_CORRUPT', path, reason}：
// - reason 'not-object'：metricPlatform / profile / dictionary 不是普通对象 → 按空读取，store 只读（storeCorrupt）
// - reason 'not-array'：集合不是数组 → 按空读取，store 只读（不以空集合覆盖原数据，避免静默丢失）
// - reason 'invalid-element'：集合元素为 null/非对象 → 过滤该元素，store 仍可写（落盘时不再含该元素）
const STORE_CORRUPT = 'STORE_CORRUPT';
const PLATFORM_PATH = `profile.${METRIC_PLATFORM_KEY}`;
// 必备集合（缺失补 []）与可选集合（缺失保持缺失，不给旧存储凭空增键）
const REQUIRED_COLLECTIONS = ['concepts', 'definitions', 'revisions'];
const OPTIONAL_COLLECTIONS = ['bindings', 'importDiagnostics'];
const DICTIONARY_COLLECTIONS = ['departments', 'dimensions', 'qualifiers', 'periods', 'units'];

const isPlainObject = value =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const corrupt = (path, reason) => ({code: STORE_CORRUPT, path, reason});

// 规整单个集合：返回 {list, structural}；structural=true 表示集合本身类型损坏（置只读）
const normalizeList = (raw, path, diagnostics) => {
  if (!Array.isArray(raw)) {
    diagnostics.push(corrupt(path, 'not-array'));
    return {list: [], structural: true};
  }
  const list = [];
  raw.forEach((item, index) => {
    if (isPlainObject(item)) {
      list.push(item);
    } else {
      diagnostics.push(corrupt(`${path}[${index}]`, 'invalid-element'));
    }
  });
  return {list, structural: false};
};

// 纯函数：raw 为 profile.metricPlatform 原值；不修改入参，元素保持原引用（浅规整）
export const normalizeMetricPlatform = (raw) => {
  const diagnostics = [];
  if (raw == null) return {value: emptyMetricPlatform(), diagnostics};
  if (!isPlainObject(raw)) {
    diagnostics.push(corrupt(PLATFORM_PATH, 'not-object'));
    return {value: {...emptyMetricPlatform(), storeCorrupt: true}, diagnostics};
  }
  // 未来 schemaVersion：行为保持（只读空集合 + unsupported 标记），不深入检查未知结构
  if (raw.schemaVersion !== METRIC_PLATFORM_SCHEMA_VERSION) {
    return {
      value: {
        ...emptyMetricPlatform(),
        schemaVersion: raw.schemaVersion,
        unsupportedSchemaVersion: true,
      },
      diagnostics,
    };
  }
  let structural = false;
  const value = {
    ...emptyMetricPlatform(),
    ...raw,
    namespace: raw.namespace === undefined ? null : raw.namespace,
  };
  REQUIRED_COLLECTIONS.forEach((key) => {
    if (raw[key] == null) {
      value[key] = [];
      return;
    }
    const result = normalizeList(raw[key], `${PLATFORM_PATH}.${key}`, diagnostics);
    value[key] = result.list;
    if (result.structural) structural = true;
  });
  OPTIONAL_COLLECTIONS.forEach((key) => {
    if (raw[key] == null) return;
    const result = normalizeList(raw[key], `${PLATFORM_PATH}.${key}`, diagnostics);
    value[key] = result.list;
    if (result.structural) structural = true;
  });
  if (raw.dictionary != null) {
    if (!isPlainObject(raw.dictionary)) {
      diagnostics.push(corrupt(`${PLATFORM_PATH}.dictionary`, 'not-object'));
      value.dictionary = {};
      structural = true;
    } else {
      const dictionary = {...raw.dictionary};
      DICTIONARY_COLLECTIONS.forEach((key) => {
        if (raw.dictionary[key] == null) return;
        const result = normalizeList(raw.dictionary[key], `${PLATFORM_PATH}.dictionary.${key}`, diagnostics);
        dictionary[key] = result.list;
        if (result.structural) structural = true;
      });
      value.dictionary = dictionary;
    }
  }
  if (structural) value.storeCorrupt = true;
  return {value, diagnostics};
};

// 诊断挂在不可枚举属性上：不进 JSON / 展开 / Object.keys，写回时不会落盘
const attachDiagnostics = (value, diagnostics) => {
  if (diagnostics.length) {
    Object.defineProperty(value, '__diagnostics', {
      value: diagnostics, enumerable: false, configurable: true, writable: false,
    });
  }
  return value;
};

// 只读入口：不存在 → 空；schemaVersion 不认识 → 空集合 + unsupported 标记（写命令据此拒绝）；
// 结构损坏 → 按空/过滤读取 + __diagnostics（集合/根类型损坏时 storeCorrupt，写命令拒绝）
export const readMetricPlatform = (source) => {
  const holder = source == null ? null : source.profile;
  if (holder == null) return emptyMetricPlatform();
  if (!isPlainObject(holder)) {
    return attachDiagnostics({...emptyMetricPlatform(), storeCorrupt: true},
      [corrupt('profile', 'not-object')]);
  }
  const normalized = normalizeMetricPlatform(holder[METRIC_PLATFORM_KEY]);
  return attachDiagnostics(normalized.value, normalized.diagnostics);
};

export const isStoreWritable = (data) =>
  data.unsupportedSchemaVersion !== true && data.storeCorrupt !== true;

// 统一写前守卫（各模块 storeGuard 共用）：损坏优先于版本不支持
export const storeWriteErrors = (data) => {
  if (data != null && data.storeCorrupt === true) {
    return [metricError(STORE_CORRUPT, PLATFORM_PATH, 'metric.error.storeCorrupt',
      'metric platform store is corrupt; read-only until repaired')];
  }
  if (data != null && data.unsupportedSchemaVersion === true) {
    return [metricError('SCHEMA_VERSION_UNSUPPORTED', `${PLATFORM_PATH}.schemaVersion`,
      'metric.error.schemaUnsupported', 'metric platform schema version unsupported')];
  }
  return [];
};

// 首写创建稳定命名空间：已有则原样保留（外部传入不同值也不改）；没有则用入参或生成
export const ensureNamespace = (data, namespace) => {
  if (data.namespace != null && data.namespace !== '') return data.namespace;
  const next = (namespace == null || namespace === '') ? newMetricId('mns') : namespace;
  return next;
};

// 唯一落盘通道：保留 profile 全部其他键与 metricPlatform 未知键。
// 既有 metricPlatform / profile 不是普通对象（字符串/数组等）→ {ok:false, errors:[STORE_CORRUPT]}，不写入
// （正常调用方先经 storeWriteErrors 拒绝，到不了这里；此处为最后防线）
export const writeMetricPlatform = (source, data, namespace) => {
  if (data != null && data.storeCorrupt === true) return {ok: false, errors: storeWriteErrors(data)};
  if (!isStoreWritable(data)) {
    throw new Error('metric platform schema version unsupported');
  }
  const base = source == null ? {} : source;
  if (base.profile != null && !isPlainObject(base.profile)) {
    return {ok: false, errors: [metricError(STORE_CORRUPT, 'profile', 'metric.error.storeCorrupt',
      'profile is not an object; metric platform write refused')]};
  }
  const profile = base.profile == null ? {} : base.profile;
  const stored = profile[METRIC_PLATFORM_KEY];
  if (stored != null && !isPlainObject(stored)) {
    return {ok: false, errors: [metricError(STORE_CORRUPT, PLATFORM_PATH, 'metric.error.storeCorrupt',
      'metric platform store is not an object; write refused')]};
  }
  const previous = stored == null ? {} : stored;
  const nextData = {
    ...previous,
    ...data,
    schemaVersion: METRIC_PLATFORM_SCHEMA_VERSION,
    namespace: ensureNamespace(data, namespace),
  };
  return {
    ...base,
    profile: {
      ...profile,
      [METRIC_PLATFORM_KEY]: nextData,
    },
  };
};

// draft 并发 etag：内容哈希 + rev 计数（registry 维护 rev）
export const draftEtag = (revision) => hashValue({
  id: revision.id,
  rev: revision.rev,
  spec: revision.spec,
  baseline: revision.baseline == null ? null : revision.baseline,
  patch: revision.patch == null ? null : revision.patch,
});

export const namespaceOf = (source) => readMetricPlatform(source).namespace;
