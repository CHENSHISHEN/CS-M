// 数据库连接配置的草稿纯事务帮助。
// DatabaseWorkspace 以本地草稿承载 DbConnect 的全部连续回调（新增/复制/删除/
// 改名/改属性/切默认），点“保存连接配置”时才一次性原子合并到最新有效模型；
// 取消或未保存不写项目源。校验语义与旧 _openModal('dbConnect') 保存一致：
// 连接名称完整（非空）且唯一，且非空默认连接必须存在于列表。
// 纯函数无 React 依赖，行为由 doc/developer/data-modeling-workbench-v1 断言覆盖。

// 基线：从当前有效 source 读取连接草稿的初始状态
export const readDbConnDraftBaseline = (source) => ({
  dbConn: (source?.dbConn || []).map(c => ({...c, properties: {...(c.properties || {})}})),
  defaultDbConn: source?.profile?.default?.dbConn || '',
});

// 空草稿哨兵：无任何待应用更改
export const EMPTY_DRAFT = null;

// 草稿积累器：DbConnect 的 dataChange(value, fieldName) 逐次合并进草稿。
// 与旧直写模式不同，这里不在单条回调里做校验阻断（表单可自由输入），
// 连续回调（如 addConn 先 default key 再 dbConn）由函数式逐次积累保证不丢字段。
// readOnly 直接忽略（防御：表单层已禁用，不应产生回调）。
export const accumulateDbConnDraft = (draft, value, fieldName, baseline, readOnly) => {
  if (readOnly) return draft || EMPTY_DRAFT;
  const base = draft || baseline;
  if (fieldName === 'dbConn') {
    return {...base, dbConn: Array.isArray(value) ? value : (baseline?.dbConn || [])};
  }
  if (fieldName === 'profile.default.dbConn') {
    return {...base, defaultDbConn: value || ''};
  }
  return base;
};

// 校验待应用草稿；返回错误键（空串=合法）
export const validateDbConnDraft = (draft) => {
  const list = draft?.dbConn || [];
  if (list.some(c => !c.defName || !String(c.defName).trim())) return 'dbConnect.validateDb';
  const names = list.map(c => c.defName);
  if (new Set(names).size !== names.length) return 'dbConnect.validateDb';
  const defaultKey = draft.defaultDbConn || '';
  if (defaultKey && !list.some(c => c.defKey === defaultKey)) return 'dbWorkspace.invalidDefault';
  return '';
};

// 原子应用：dbConn 与 profile.default.dbConn 作为同一有效配置，一次性合并进
// 最新 source（不覆盖模型对象/其他 profile 键）。返回新 source；草稿非法时抛错。
export const applyDbConnDraft = (latestSource, draft) => {
  const error = validateDbConnDraft(draft);
  if (error) throw new Error(error);
  const src = latestSource || {};
  return {
    ...src,
    dbConn: draft.dbConn,
    profile: {...src?.profile,
      default: {...(src?.profile?.default || {}), dbConn: draft.defaultDbConn || ''}},
  };
};

// 取消更改：直接丢弃草稿返回基线（不产生任何 source 写入）
export const discardDbConnDraft = () => EMPTY_DRAFT;

// 草稿相对基线是否存在待应用更改（用于按钮状态与未保存提示）
export const dbConnDraftDirty = (draft, baseline) => {
  if (!draft) return false;
  const a = JSON.stringify({d: draft.dbConn, k: draft.defaultDbConn});
  const b = JSON.stringify({d: baseline.dbConn, k: baseline.defaultDbConn});
  return a !== b;
};
