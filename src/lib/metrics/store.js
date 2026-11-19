// 指标平台 M1：profile.metricPlatform 本地存储适配（纯函数）。
// 数据合同：profile.metricPlatform = {schemaVersion:1, namespace, concepts[], definitions[], revisions[], ...未知键}
// - 缺失时只读为空，绝不初始化样例；首次写入时创建稳定项目命名空间并沿用。
// - 写入基于最新 source 浅克隆，只替换 metricPlatform 已知键；
//   profile 其他键、模型集合（entities 等）与 metricPlatform 未知键全部原样保留。
// 注：构建链不识别 ??，一律使用 == null 三元（同 concept_logical_links）。

import {newMetricId, hashValue} from './hash';

export const METRIC_PLATFORM_KEY = 'metricPlatform';
export const METRIC_PLATFORM_SCHEMA_VERSION = 1;

export const emptyMetricPlatform = () => ({
  schemaVersion: METRIC_PLATFORM_SCHEMA_VERSION,
  namespace: null,
  concepts: [],
  definitions: [],
  revisions: [],
});

// 只读入口：不存在 → 空；schemaVersion 不认识 → 空集合 + unsupported 标记（写命令据此拒绝）
export const readMetricPlatform = (source) => {
  const holder = source == null ? null : source.profile;
  if (holder == null) return emptyMetricPlatform();
  const data = holder[METRIC_PLATFORM_KEY];
  if (data == null || typeof data !== 'object') return emptyMetricPlatform();
  if (data.schemaVersion !== METRIC_PLATFORM_SCHEMA_VERSION) {
    return {
      ...emptyMetricPlatform(),
      schemaVersion: data.schemaVersion,
      unsupportedSchemaVersion: true,
    };
  }
  return {
    ...emptyMetricPlatform(),
    ...data,
    concepts: data.concepts == null ? [] : data.concepts.slice(),
    definitions: data.definitions == null ? [] : data.definitions.slice(),
    revisions: data.revisions == null ? [] : data.revisions.slice(),
  };
};

export const isStoreWritable = (data) =>
  data.unsupportedSchemaVersion !== true;

// 首写创建稳定命名空间：已有则原样保留（外部传入不同值也不改）；没有则用入参或生成
export const ensureNamespace = (data, namespace) => {
  if (data.namespace != null && data.namespace !== '') return data.namespace;
  const next = (namespace == null || namespace === '') ? newMetricId('mns') : namespace;
  return next;
};

// 唯一落盘通道：保留 profile 全部其他键与 metricPlatform 未知键
export const writeMetricPlatform = (source, data, namespace) => {
  if (!isStoreWritable(data)) {
    throw new Error('metric platform schema version unsupported');
  }
  const base = source == null ? {} : source;
  const profile = base.profile == null ? {} : base.profile;
  const previous = profile[METRIC_PLATFORM_KEY] == null ? {} : profile[METRIC_PLATFORM_KEY];
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
