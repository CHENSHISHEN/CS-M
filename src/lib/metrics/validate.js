// 指标平台 M1：三类指标 spec 结构校验（判别联合 + 未知键检查，纯结构，不含仓储查询）。
// 注：构建链不识别 ??，使用 == null 三元。

import {invalidValueError, metricError, missingFieldError, unknownKeyError} from './errors';
import {validateWindow} from './window';

export const METRIC_KINDS = ['atomic', 'derived', 'compound'];
export const AGGREGATIONS = ['SUM', 'COUNT', 'COUNT_DISTINCT', 'MIN', 'MAX', 'AVG'];
export const QUALIFIER_OPS = ['eq', 'not_eq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte'];
export const ADDABILITIES = ['additive', 'semi_additive', 'non_additive'];

const ATOMIC_KEYS = ['kind', 'name', 'description', 'businessDomain', 'businessProcess', 'aggregation',
  'source', 'factGrain', 'timeRole', 'timezone', 'baseQualifiers', 'unit', 'dimensions'];
const DERIVED_KEYS = ['kind', 'name', 'description', 'atomicRevisionId', 'window', 'qualifiers', 'outputGrain'];
const COMPOUND_KEYS = ['kind', 'name', 'description', 'expression', 'refs'];

const checkUnknownKeys = (spec, keys, path, errors) => {
  Object.keys(spec == null ? {} : spec).forEach((key) => {
    if (keys.indexOf(key) < 0) errors.push(unknownKeyError(path, key));
  });
};

const checkNonEmptyString = (spec, key, path, errors) => {
  const value = spec[key];
  if (value == null || String(value).trim() === '') errors.push(missingFieldError(path, key));
  else if (typeof value !== 'string') errors.push(invalidValueError(`${path}.${key}`, `${key} must be a string`));
};

// 限定：{dimensionId, op, value} 有类型字段引用；禁止自由 SQL 字符串
export const validateQualifier = (qualifier, path, index) => {
  const errors = [];
  const at = `${path}[${index}]`;
  if (qualifier == null || typeof qualifier !== 'object') {
    errors.push(invalidValueError(at, 'qualifier must be an object'));
    return errors;
  }
  Object.keys(qualifier).forEach((key) => {
    if (['dimensionId', 'op', 'value'].indexOf(key) < 0) errors.push(unknownKeyError(at, key));
  });
  if (qualifier.dimensionId == null || qualifier.dimensionId === '') {
    errors.push(missingFieldError(at, 'dimensionId'));
  }
  if (qualifier.op == null) errors.push(missingFieldError(at, 'op'));
  else if (QUALIFIER_OPS.indexOf(qualifier.op) < 0) {
    errors.push(invalidValueError(`${at}.op`, `qualifier.op must be one of ${QUALIFIER_OPS.join('/')}`));
  }
  if (qualifier.value === undefined) errors.push(missingFieldError(at, 'value'));
  else if (qualifier.op === 'in' || qualifier.op === 'not_in') {
    if (!Array.isArray(qualifier.value)) errors.push(invalidValueError(`${at}.value`, 'in/not_in requires array value'));
  } else if (typeof qualifier.value !== 'string' && typeof qualifier.value !== 'number' && typeof qualifier.value !== 'boolean') {
    errors.push(invalidValueError(`${at}.value`, 'qualifier.value must be scalar'));
  }
  return errors;
};

export const validateQualifiers = (qualifiers, path) => {
  const errors = [];
  if (qualifiers === undefined) {
    errors.push(missingFieldError(path, path.split('.').pop()));
    return errors;
  }
  if (!Array.isArray(qualifiers)) {
    errors.push(invalidValueError(path, `${path} must be an array`));
    return errors;
  }
  qualifiers.forEach((qualifier, index) => {
    validateQualifier(qualifier, path, index).forEach(error => errors.push(error));
  });
  return errors;
};

// 来源字段引用：COUNT 允许省 fieldId（计行数），其余聚合必须显式字段
export const validateAtomicSource = (source, aggregation, path) => {
  const errors = [];
  if (source == null) return errors; // 设计态：允许无物理来源，由上层标记未计算就绪
  if (typeof source !== 'object') {
    errors.push(invalidValueError(path, 'source must be an object'));
    return errors;
  }
  Object.keys(source).forEach((key) => {
    if (['modelId', 'fieldId'].indexOf(key) < 0) errors.push(unknownKeyError(path, key));
  });
  if (source.modelId == null || source.modelId === '') errors.push(missingFieldError(path, 'modelId'));
  if (aggregation !== 'COUNT' && (source.fieldId == null || source.fieldId === '')) {
    errors.push(missingFieldError(path, 'fieldId'));
  }
  return errors;
};

export const validateAtomicSpec = (spec, path) => {
  const errors = [];
  if (spec == null || typeof spec !== 'object') {
    errors.push(metricError('INVALID_VALUE', path, 'metric.error.invalidValue', 'spec must be an object'));
    return errors;
  }
  checkUnknownKeys(spec, ATOMIC_KEYS, path, errors);
  ['kind', 'name', 'description', 'businessDomain', 'businessProcess', 'aggregation',
    'timeRole', 'timezone', 'unit'].forEach((key) => {
    checkNonEmptyString(spec, key, path, errors);
  });
  if (spec.aggregation != null && AGGREGATIONS.indexOf(spec.aggregation) < 0) {
    errors.push(invalidValueError(`${path}.aggregation`,
      `aggregation must be one of ${AGGREGATIONS.join('/')}`));
  }
  validateAtomicSource(spec.source, spec.aggregation, `${path}.source`).forEach(error => errors.push(error));
  if (spec.factGrain === undefined) {
    errors.push(missingFieldError(path, 'factGrain'));
  } else if (spec.factGrain == null || typeof spec.factGrain !== 'object') {
    errors.push(invalidValueError(`${path}.factGrain`, 'factGrain must be an object'));
  } else {
    Object.keys(spec.factGrain).forEach((key) => {
      if (['description', 'uniqueKeyFieldIds'].indexOf(key) < 0) {
        errors.push(unknownKeyError(`${path}.factGrain`, key));
      }
    });
    if (spec.factGrain.description == null || spec.factGrain.description === '') {
      errors.push(missingFieldError(`${path}.factGrain`, 'description'));
    }
    if (spec.factGrain.uniqueKeyFieldIds === undefined) {
      errors.push(missingFieldError(`${path}.factGrain`, 'uniqueKeyFieldIds'));
    } else if (!Array.isArray(spec.factGrain.uniqueKeyFieldIds)) {
      errors.push(invalidValueError(`${path}.factGrain.uniqueKeyFieldIds`, 'uniqueKeyFieldIds must be an array'));
    }
  }
  if (spec.baseQualifiers === undefined) {
    errors.push(missingFieldError(path, 'baseQualifiers'));
  } else {
    validateQualifiers(spec.baseQualifiers, `${path}.baseQualifiers`).forEach(error => errors.push(error));
  }
  if (spec.dimensions === undefined) {
    errors.push(missingFieldError(path, 'dimensions'));
  } else if (!Array.isArray(spec.dimensions)) {
    errors.push(invalidValueError(`${path}.dimensions`, 'dimensions must be an array'));
  } else {
    spec.dimensions.forEach((dimension, index) => {
      const at = `${path}.dimensions[${index}]`;
      if (dimension == null || typeof dimension !== 'object') {
        errors.push(invalidValueError(at, 'dimension must be an object'));
        return;
      }
      Object.keys(dimension).forEach((key) => {
        if (['dimensionId', 'addable'].indexOf(key) < 0) errors.push(unknownKeyError(at, key));
      });
      if (dimension.dimensionId == null || dimension.dimensionId === '') {
        errors.push(missingFieldError(at, 'dimensionId'));
      }
      if (dimension.addable != null && ADDABILITIES.indexOf(dimension.addable) < 0) {
        errors.push(invalidValueError(`${at}.addable`, `addable must be one of ${ADDABILITIES.join('/')}`));
      }
    });
  }
  return errors;
};

export const validateDerivedSpec = (spec, path) => {
  const errors = [];
  if (spec == null || typeof spec !== 'object') {
    errors.push(metricError('INVALID_VALUE', path, 'metric.error.invalidValue', 'spec must be an object'));
    return errors;
  }
  checkUnknownKeys(spec, DERIVED_KEYS, path, errors);
  ['kind', 'name', 'atomicRevisionId'].forEach((key) => {
    checkNonEmptyString(spec, key, path, errors);
  });
  if (spec.description !== undefined && typeof spec.description !== 'string') {
    errors.push(invalidValueError(`${path}.description`, 'description must be a string'));
  }
  validateWindow(spec.window, `${path}.window`).forEach(error => errors.push(error));
  if (spec.qualifiers === undefined) errors.push(missingFieldError(path, 'qualifiers'));
  else validateQualifiers(spec.qualifiers, `${path}.qualifiers`).forEach(error => errors.push(error));
  if (spec.outputGrain === undefined) errors.push(missingFieldError(path, 'outputGrain'));
  else if (!Array.isArray(spec.outputGrain)) {
    errors.push(invalidValueError(`${path}.outputGrain`, 'outputGrain must be an array of dimension ids'));
  } else {
    spec.outputGrain.forEach((dim, index) => {
      if (dim == null || dim === '') {
        errors.push(invalidValueError(`${path}.outputGrain[${index}]`, 'outputGrain item must be a dimension id'));
      }
    });
  }
  return errors;
};

export const validateCompoundSpec = (spec, path) => {
  const errors = [];
  if (spec == null || typeof spec !== 'object') {
    errors.push(metricError('INVALID_VALUE', path, 'metric.error.invalidValue', 'spec must be an object'));
    return errors;
  }
  checkUnknownKeys(spec, COMPOUND_KEYS, path, errors);
  ['kind', 'name', 'expression'].forEach((key) => {
    checkNonEmptyString(spec, key, path, errors);
  });
  if (spec.description !== undefined && typeof spec.description !== 'string') {
    errors.push(invalidValueError(`${path}.description`, 'description must be a string'));
  }
  if (spec.refs === undefined) {
    errors.push(missingFieldError(path, 'refs'));
  } else if (!Array.isArray(spec.refs) || spec.refs.length === 0) {
    errors.push(invalidValueError(`${path}.refs`, 'refs must be a non-empty array'));
  } else {
    const seen = {};
    spec.refs.forEach((ref, index) => {
      const at = `${path}.refs[${index}]`;
      if (ref == null || typeof ref !== 'object') {
        errors.push(invalidValueError(at, 'ref must be an object'));
        return;
      }
      Object.keys(ref).forEach((key) => {
        if (['key', 'revisionId'].indexOf(key) < 0) errors.push(unknownKeyError(at, key));
      });
      if (ref.key == null || ref.key === '') errors.push(missingFieldError(at, 'key'));
      if (ref.revisionId == null || ref.revisionId === '') errors.push(missingFieldError(at, 'revisionId'));
      if (ref.key != null) {
        if (seen[ref.key]) errors.push(invalidValueError(at, `duplicate ref key: ${ref.key}`));
        seen[ref.key] = true;
      }
    });
  }
  return errors;
};

export const validateSpecStructure = (spec, path) => {
  if (spec == null || spec.kind == null) {
    return [missingFieldError(path == null ? 'spec' : path, 'kind')];
  }
  if (spec.kind === 'atomic') return validateAtomicSpec(spec, path);
  if (spec.kind === 'derived') return validateDerivedSpec(spec, path);
  if (spec.kind === 'compound') return validateCompoundSpec(spec, path);
  return [invalidValueError(`${path}.kind`, `kind must be one of ${METRIC_KINDS.join('/')}`)];
};

export const validateScope = (scope, path) => {
  const errors = [];
  if (scope == null || typeof scope !== 'object') {
    errors.push(missingFieldError(path == null ? 'scope' : path, 'scope'));
    return errors;
  }
  Object.keys(scope).forEach((key) => {
    if (['kind', 'departmentId'].indexOf(key) < 0) errors.push(unknownKeyError(path, key));
  });
  if (scope.kind !== 'public' && scope.kind !== 'department') {
    errors.push(invalidValueError(`${path}.kind`, "scope.kind must be 'public' or 'department'"));
  }
  if (scope.kind === 'department' && (scope.departmentId == null || scope.departmentId === '')) {
    errors.push(missingFieldError(path, 'departmentId'));
  }
  return errors;
};
