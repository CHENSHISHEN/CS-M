// 指标平台 M1：稳定序列化与内容哈希（etag/spec hash 用，非加密强度）。
// 注：构建链 babel/webpack4 不识别 ??，本文件一律使用 == null 三元。

const isPlainObject = (value) =>
  value != null && typeof value === 'object' && !Array.isArray(value);

// 键排序的确定性 JSON（对象键排序，数组保序），保证同内容同哈希
export const stableStringify = (value) => {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

// FNV-1a 32bit，输出 8 位十六进制前缀
export const hashString = (text) => {
  let hash = 0x811c9dc5;
  const input = String(text == null ? '' : text);
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `h${hash.toString(16).padStart(8, '0')}`;
};

export const hashValue = (value) => hashString(stableStringify(value));

// 本地 ID 生成：项目内已有 Math.uuid 补丁则复用；测试/纯函数环境降级为计数+随机，
// 不 import src/lib/Math.js 以保持本层零依赖
let fallbackSeq = 0;
export const newMetricId = (prefix) => {
  if (typeof Math.uuid === 'function') return `${prefix}-${Math.uuid()}`;
  fallbackSeq += 1;
  return `${prefix}-local-${fallbackSeq}-${Math.floor(Math.random() * 0xffffff).toString(16)}`;
};
