// 指标平台 MET-10：动态计算就绪（决策 D5，纯函数，只读投影）。
// resolvedSpec.computeReady 是发布时快照（进入内容 hash，不改）；本函数按当前项目
// 现场判定原子版本是否仍可计算，UI 以动态值为准、与快照不一致时标注快照。
// D5 只判四件事（原子版本）：
//   ① 声明来源端点在场（按稳定 ID，复用 getDeclaredSpecSources 的在场投影）→ SOURCE_MISSING
//   ② 来源为物理实体（entities；逻辑/概念层只是语义设计）              → SOURCE_NOT_PHYSICAL
//   ③ 至少一条 confirmed COMPUTES_FROM 绑定且端点在场、落在物理层（bindingEndpoint 投影；
//      suggested/unresolved/released 不算）                              → NO_CONFIRMED_BINDING
//      （仅有逻辑/概念层的确认计算绑定时报 SOURCE_NOT_PHYSICAL @ bindings[id].modelRef.collection）
//      （确认计算绑定的端点已不在场时报 SOURCE_MISSING @ bindings[id].modelRef）
//   ④ 必需 mapping 齐备（至少一条有效绑定齐备即可；当前仅 timeFieldId，见 R-A-F1）→ MAPPING_INCOMPLETE
// 派生/复合：D5 明确不做上游传递就绪判定，原样返回发布快照、不给原因（不在此沿依赖链下钻）。
// 约定：不修改入参；损坏绑定元素（null、缺 modelRef/mapping/events）跳过或按缺失处理，不抛错。

import {bindingEndpoint, getDeclaredSpecSources, modelFieldIdsOf} from './binding';
import {readMetricPlatform} from './store';

const reason = (code, path) => ({code, path});

const nonEmptyArray = value => Array.isArray(value) && value.some(item => item != null);

// 必需映射键（R-A-F1）：只要求 timeFieldId ← spec.timeRole 非空（时间轴是语义标签，须映射到端点字段）。
// qualifierFieldIds / dimensionFieldIds / factKeyFieldIds 的必需性判定有意延后到 Phase 4：
// 目前唯一创建绑定的 UI（ModelMetricPanel）只写 aggregate + timeFieldId，binding 也没有编辑
// mapping 的接口，若按 spec 要求这些键，常见原子会因用户无法修复的原因永久"未就绪"。
// 待映射编辑器上线后再按 spec.baseQualifiers / dimensions / factGrain.uniqueKeyFieldIds 推导。
// 已写入的可选键仍要求其字段在端点上（见 judgedMappingKeys），aggregate / expression 不作要求。
const OPTIONAL_FIELD_KEYS = ['qualifierFieldIds', 'dimensionFieldIds', 'factKeyFieldIds'];

const requiredMappingKeys = (spec) => {
  const keys = [];
  if (typeof spec.timeRole === 'string' && spec.timeRole.trim() !== '') keys.push('timeFieldId');
  return keys;
};

// 参与判定的键：必需键 + 映射中已写入（非空）的可选字段键
const judgedMappingKeys = (spec, mapping) => {
  const present = mapping == null || typeof mapping !== 'object' ? []
    : OPTIONAL_FIELD_KEYS.filter(key => nonEmptyArray(mapping[key]));
  return requiredMappingKeys(spec).concat(present);
};

// 映射键齐备：有值，且引用的字段全部仍在端点对象上（字段删后绑定尚未失效时也判不齐）
const mappingKeySatisfied = (mapping, key, fieldIds) => {
  if (mapping == null || typeof mapping !== 'object') return false;
  const value = mapping[key];
  let ids = [];
  if (typeof value === 'string' && value !== '') ids = [value];
  else if (Array.isArray(value)) ids = value.filter(id => id != null && id !== '');
  if (!ids.length) return false;
  return ids.every(id => fieldIds.indexOf(id) >= 0);
};

const sourceReasons = (source, revisionId, spec) => {
  if (spec.source == null || spec.source.modelId == null || spec.source.modelId === '') {
    return [reason('SOURCE_MISSING', 'spec.source')];
  }
  const declared = getDeclaredSpecSources(source, revisionId).filter(item => item.direct)[0];
  if (declared == null || declared.endpoint.object == null) {
    return [reason('SOURCE_MISSING', 'spec.source.modelId')];
  }
  if (!declared.endpoint.present) return [reason('SOURCE_MISSING', 'spec.source.fieldId')];
  if (declared.designOnly) return [reason('SOURCE_NOT_PHYSICAL', 'spec.source.modelId')];
  return [];
};

const bindingReasons = (source, revisionId, spec) => {
  const bindings = readMetricPlatform(source).bindings || [];
  const effective = [];
  const nonPhysical = [];
  const missing = [];
  bindings.forEach((binding) => {
    if (binding == null || typeof binding !== 'object' || binding.modelRef == null) return;
    if (binding.role !== 'COMPUTES_FROM' || binding.state !== 'confirmed') return;
    if (binding.metricRevisionId !== revisionId) return;
    const endpoint = bindingEndpoint(source, binding);
    if (!endpoint.present) {
      missing.push(binding);
      return;
    }
    // COMPUTES_FROM 写入不限集合：落在逻辑/概念层的计算绑定只是语义设计，不构成有效计算来源
    if (endpoint.collection !== 'entities') {
      nonPhysical.push(binding);
      return;
    }
    effective.push({binding, endpoint});
  });
  if (!effective.length) {
    // 有确认绑定但都不可用时，给出更准确的原因而非"无确认绑定"：
    // 落在逻辑/概念层 → SOURCE_NOT_PHYSICAL；端点对象/字段已不在场 → SOURCE_MISSING
    const unusable = nonPhysical.map(binding => reason('SOURCE_NOT_PHYSICAL',
      `bindings[${binding.id}].modelRef.collection`))
      .concat(missing.map(binding => reason('SOURCE_MISSING', `bindings[${binding.id}].modelRef`)));
    return unusable.length ? unusable : [reason('NO_CONFIRMED_BINDING', 'bindings')];
  }
  const missingPerBinding = effective.map(({binding, endpoint}) => {
    const fieldIds = modelFieldIdsOf(endpoint.object);
    return judgedMappingKeys(spec, binding.mapping)
      .filter(key => !mappingKeySatisfied(binding.mapping, key, fieldIds))
      .map(key => reason('MAPPING_INCOMPLETE', `bindings[${binding.id}].mapping.${key}`));
  });
  if (missingPerBinding.some(list => list.length === 0)) return [];
  return missingPerBinding.reduce((all, list) => all.concat(list), []);
};

// getMetricReadiness(source, revisionId) → {ready, reasons:[{code, path}]}；版本不存在 → null
export const getMetricReadiness = (source, revisionId) => {
  const data = readMetricPlatform(source);
  const revision = (data.revisions || []).filter(item => item != null && item.id === revisionId)[0];
  if (revision == null) return null;
  const spec = revision.spec;
  if (spec == null || spec.kind !== 'atomic') {
    // D5：派生/复合不做上游传递判定，沿用发布时快照
    const snapshot = revision.resolvedSpec == null ? false : revision.resolvedSpec.computeReady === true;
    return {ready: snapshot, reasons: []};
  }
  const reasons = sourceReasons(source, revisionId, spec)
    .concat(bindingReasons(source, revisionId, spec));
  return {ready: reasons.length === 0, reasons};
};
