// 缓存项目信息 等待后续调用update方法

const tabs = {}; // 当前已经打开的所tabs

export const getDataByTabId = (id) => {
  // 获取tab的数据
  return tabs[id];
};

export const setDataByTabId = (id, data) => {
  // 缓存tab的数据
  tabs[id] = data;
};

export const replaceDataByTabId = (id, data) => {
  // 替换tab的数据
  setDataByTabId(id, data);
};

export const removeDataByTabId = (id) => {
  // 删除tab的数据
  delete tabs[id]
};

export const getAllTabData = () => {
  return tabs;
};

export const clearAllTabData = () => {
  Object.keys(tabs).forEach((t) => {
    delete tabs[t];
  })
};

// 保存开始前的脏缓存快照。缓存条目的写点均为不可变替换（每次写入新对象），
// 因此引用对比即可区分“随本次保存落盘的内容”与“落盘窗口内的新编辑”。
export const snapshotDirtyTabData = () => {
  return Object.keys(tabs)
      .filter(t => tabs[t] && !tabs[t].isInit)
      .map(t => ({tabKey: t, entry: tabs[t]}));
};

// 保存成功后退休快照中未被再次编辑的条目（引用未变＝内容已落盘）；
// 引用已变化（窗口内再次编辑）与窗口内新增的脏条目保留。
// 返回当前是否仍存在脏编辑，供保存流程决定是否重发待保存状态。
export const retireSavedTabData = (snapshot) => {
  (snapshot || []).forEach((s) => {
    if (tabs[s.tabKey] === s.entry) {
      removeDataByTabId(s.tabKey);
    }
  });
  return Object.keys(tabs).some(t => tabs[t] && !tabs[t].isInit);
};

const cache = localStorage || {};

export const getCache = (key, needParse) => {
  const item = cache.getItem(key);
  return needParse ? JSON.parse(item) : item;
};

export const setCache = (key, value) => {
  cache.setItem(key, typeof value !== 'string' ? JSON.stringify(value) : value);
};

export const clearCache = (item) => {
  if (item) {
    cache.removeItem(item);
  } else {
    cache.clear();
  }
};

let memoryCache = {};

export const getMemoryCache = (key) => {
  return memoryCache[key];
};

export const setMemoryCache = (key, value) => {
  memoryCache[key] = value;
};

export const clearMemoryCache = () => {
  memoryCache = {};
};


