// 指标平台 M1：结构化错误与结果对象。
// 约定：所有写命令/校验不抛领域错误，返回 {ok:false, errors:[{code, path, messageKey, message}]}；
// message 为开发期英文说明，messageKey+params 供后续 UI 语言表接入（M2+），两者不混用。

export const metricError = (code, path, messageKey, message, params) => ({
  code,
  path: path == null ? '' : path,
  messageKey,
  ...(message == null ? {} : {message}),
  ...(params == null ? {} : {params}),
});

export const failResult = (errors) => ({ok: false, errors});

export const okResult = (data) => ({ok: true, ...(data == null ? {} : data)});

// 常用错误构造（保持 code 集中可检索）
export const missingFieldError = (path, key) =>
  metricError('MISSING_FIELD', `${path == null ? '' : path}${path ? '.' : ''}${key}`, 'metric.error.missingField',
    `missing required field: ${key}`, {field: key});

export const unknownKeyError = (path, key) =>
  metricError('UNKNOWN_KEY', `${path == null ? '' : path}${path ? '.' : ''}${key}`, 'metric.error.unknownKey',
    `unknown field for this metric kind: ${key}`, {field: key});

export const invalidValueError = (path, message, params) =>
  metricError('INVALID_VALUE', path, 'metric.error.invalidValue', message, params);

export const unknownReferenceError = (path, refId) =>
  metricError('UNKNOWN_REFERENCE', path, 'metric.error.unknownReference',
    `referenced revision does not exist: ${refId}`, {ref: refId});

export const firstError = (result) => (result == null ? null : (result.errors || [])[0] || null);
