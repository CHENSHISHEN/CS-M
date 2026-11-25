// 指标平台：只读返回值的深冻结（MET-03 余项）。
// - deepFreeze：原地递归冻结并返回同一对象；原始值原样返回。已冻结对象视为已处理（防环）。
// - frozenClone：JSON 安全深拷贝（等价 structuredClone 的 JSON 子集；主进程 Node 14 无 structuredClone）
//   后深冻结，供 getMetricRevision / listMetricRevisions 等只读 API 返回，
//   调用方无法借返回值改写存储内的已发布快照与 hash。
// 注：构建链不识别 ??，使用 == null 三元。

export const deepFreeze = (value) => {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.getOwnPropertyNames(value).forEach((key) => {
    deepFreeze(value[key]);
  });
  return value;
};

export const frozenClone = value =>
  (value == null ? value : deepFreeze(JSON.parse(JSON.stringify(value))));
