// 指标平台 M1/M3B：部门白名单 patch（纯函数，无仓储依赖）。
// 从 baseline.js 拆出以避免 registry ↔ baseline 循环引用（测试加载器不支持加载期环）。
// 白名单按基线类型区分；核心语义键命中即要求显式分叉，其余未知键直接拒绝。
// 注：构建链不识别 ??，使用 == null 三元。

import {metricError} from './errors';
import {validateQualifiers} from './validate';
import {hashValue} from './hash';

// 白名单 patch 键按基线类型区分（M3B）
export const PATCH_KEYS_BY_KIND = {
  derived: ['addQualifiers', 'restrictDimensions', 'display'],
  atomic: ['addBaseQualifiers', 'display'],
  compound: ['display'],
};
export const SEMANTIC_KEYS = ['aggregation', 'unit', 'factGrain', 'window', 'atomicRevisionId',
  'expression', 'refs', 'source', 'timeRole', 'timezone', 'outputGrain', 'dimensions',
  'baseQualifiers', 'qualifiers'];
// 公共升级的语义阻断键（M3B）：统计对象（source/aggregation/atomicRevisionId）、单位、
// 时间角色/时区、复合公式、事实粒度的公共侧变化不能被白名单 patch 覆盖，必须显式分叉。
// window/outputGrain/限定集变化不在此列：升级走三方比较 + patch 重放冲突检查（M1 语义）。
export const UPGRADE_BLOCKING_KEYS = ['source', 'aggregation', 'atomicRevisionId', 'unit',
  'timeRole', 'timezone', 'expression', 'refs', 'factGrain'];

const qualifierKey = (qualifier) => hashValue(qualifier);

// 公共两版本间的差异是否属于升级必须显式分叉的核心语义变化
export const isSemanticChange = (change) => {
  if (change == null || change.path == null) return false;
  return UPGRADE_BLOCKING_KEYS.indexOf(String(change.path).split('.')[0]) >= 0;
};

const lookupRevision = (data, id) => (data.revisions || []).filter(item => item.id === id)[0] || null;

// patch 校验（对照基线上下文，白名单按基线类型区分）：返回 {patch, errors}
export const validateDepartmentPatch = (data, patch, baseRevision) => {
  const errors = [];
  if (patch == null) return {patch: {}, errors};
  if (typeof patch !== 'object' || Array.isArray(patch)) {
    return {patch: {}, errors: [metricError('INVALID_VALUE', 'patch', 'metric.error.invalidValue',
      'patch must be an object')]};
  }
  const baseKind = baseRevision.spec == null ? null : baseRevision.spec.kind;
  if (baseKind !== 'atomic' && baseKind !== 'derived' && baseKind !== 'compound') {
    return {patch: {}, errors: [metricError('INVALID_VALUE', 'baseRevisionId',
      'metric.error.invalidValue', 'department baseline kind must be atomic/derived/compound')]};
  }
  const allowedKeys = PATCH_KEYS_BY_KIND[baseKind];
  Object.keys(patch).forEach((key) => {
    if (allowedKeys.indexOf(key) >= 0) return;
    if (SEMANTIC_KEYS.indexOf(key) >= 0) {
      errors.push(metricError('SEMANTIC_CHANGE_REQUIRES_FORK', `patch.${key}`,
        'metric.error.semanticFork',
        `patching ${key} changes core semantics; create an independent definition instead`));
    } else {
      errors.push(metricError('PATCH_KEY_NOT_ALLOWED', `patch.${key}`, 'metric.error.patchKey',
        `patch key not allowed for ${baseKind} baseline: ${key}`));
    }
  });
  if (errors.length) return {patch: {}, errors};
  const baseSpec = baseRevision.spec;
  const next = {};
  if (patch.addQualifiers !== undefined) {
    // derived：部门自有限定追加，维度须由基线所引原子声明（M1 语义不变）
    const atomicRevision = baseSpec.kind === 'derived'
      ? lookupRevision(data, baseSpec.atomicRevisionId) : null;
    const atomicDims = atomicRevision == null ? []
      : ((atomicRevision.spec || {}).dimensions || []).map(dimension => dimension.dimensionId);
    validateQualifiers(patch.addQualifiers, 'patch.addQualifiers').forEach(item => errors.push(item));
    const existing = new Set((baseSpec.qualifiers || []).map(qualifierKey));
    (patch.addQualifiers || []).forEach((qualifier, index) => {
      if (qualifier == null) return;
      if (existing.has(qualifierKey(qualifier))) {
        errors.push(metricError('INVALID_VALUE', `patch.addQualifiers[${index}]`,
          'metric.error.invalidValue', 'qualifier already present on baseline'));
      }
      if (atomicDims.length && atomicDims.indexOf(qualifier.dimensionId) < 0) {
        errors.push(metricError('UNKNOWN_DIMENSION', `patch.addQualifiers[${index}].dimensionId`,
          'metric.error.unknownDimension',
          `qualifier dimension not declared by baseline atomic: ${qualifier.dimensionId}`));
      }
    });
    next.addQualifiers = patch.addQualifiers;
  }
  if (patch.addBaseQualifiers !== undefined) {
    // atomic（M3B）：部门在公共原子上追加基础限定，维度须由该原子可聚合维度声明
    validateQualifiers(patch.addBaseQualifiers, 'patch.addBaseQualifiers')
      .forEach(item => errors.push(item));
    const existingBase = new Set((baseSpec.baseQualifiers || []).map(qualifierKey));
    const declared = new Set((baseSpec.dimensions || []).map(dimension => dimension.dimensionId));
    (patch.addBaseQualifiers || []).forEach((qualifier, index) => {
      if (qualifier == null) return;
      if (existingBase.has(qualifierKey(qualifier))) {
        errors.push(metricError('INVALID_VALUE', `patch.addBaseQualifiers[${index}]`,
          'metric.error.invalidValue', 'base qualifier already present on baseline'));
      }
      if (!declared.has(qualifier.dimensionId)) {
        errors.push(metricError('UNKNOWN_DIMENSION', `patch.addBaseQualifiers[${index}].dimensionId`,
          'metric.error.unknownDimension',
          `base qualifier dimension not declared by baseline atomic: ${qualifier.dimensionId}`));
      }
    });
    next.addBaseQualifiers = patch.addBaseQualifiers;
  }
  if (patch.restrictDimensions !== undefined) {
    if (!Array.isArray(patch.restrictDimensions)) {
      errors.push(metricError('INVALID_VALUE', 'patch.restrictDimensions', 'metric.error.invalidValue',
        'restrictDimensions must be an array'));
    } else {
      const allowed = new Set(baseSpec.outputGrain || []);
      patch.restrictDimensions.forEach((dim, index) => {
        if (!allowed.has(dim)) {
          errors.push(metricError('UNKNOWN_DIMENSION', `patch.restrictDimensions[${index}]`,
            'metric.error.unknownDimension',
            `restrict dimension not in baseline output grain: ${dim}`));
        }
      });
      next.restrictDimensions = patch.restrictDimensions;
    }
  }
  if (patch.display !== undefined) {
    if (typeof patch.display !== 'object' || patch.display == null || Array.isArray(patch.display)) {
      errors.push(metricError('INVALID_VALUE', 'patch.display', 'metric.error.invalidValue',
        'display must be an object'));
    } else {
      next.display = patch.display;
    }
  }
  return {patch: errors.length ? {} : next, errors};
};

// patch 应用到 spec 副本（仅白名单语义；不做深 merge）
export const applyDepartmentPatch = (baseSpec, patch) => {
  const spec = JSON.parse(JSON.stringify(baseSpec));
  if (patch == null) return spec;
  if (patch.addQualifiers != null) {
    const existing = new Set((spec.qualifiers || []).map(qualifierKey));
    const additions = patch.addQualifiers.filter(qualifier => !existing.has(qualifierKey(qualifier)));
    spec.qualifiers = (spec.qualifiers || []).concat(additions);
  }
  if (patch.addBaseQualifiers != null) {
    const existingBase = new Set((spec.baseQualifiers || []).map(qualifierKey));
    const additions = patch.addBaseQualifiers
      .filter(qualifier => !existingBase.has(qualifierKey(qualifier)));
    spec.baseQualifiers = (spec.baseQualifiers || []).concat(additions);
  }
  if (patch.restrictDimensions != null) {
    spec.outputGrain = (spec.outputGrain || [])
      .filter(dim => patch.restrictDimensions.indexOf(dim) >= 0);
  }
  if (patch.display != null) {
    // display 为展示设置，不参与计算语义，附在 spec 外由 revision.patch 记录
  }
  return spec;
};
