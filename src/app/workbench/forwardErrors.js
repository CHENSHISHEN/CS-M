// DM-01：前向工程向导阻断错误的纯呈现辅助（不依赖 React，node 可直测）
// 生成器（lib/model_forward_engineering.js）产出的错误对象只含 ID 与 code；
// 这里补可读标签、整理 forward.err.<code> 文案的占位参数，并按 level 分组供向导渲染。

// 分组展示顺序；未知 level 按出现顺序追加在末尾
export const FORWARD_ERROR_LEVELS = ['name', 'target', 'entity', 'field', 'relation', 'index', 'generate'];

const str = v => (v == null ? '' : String(v));
const findById = (list, id) => (list || []).filter(x => x && x.id === id)[0] || null;

// 补可读标签：实体/字段 ID → 逻辑实体/字段代码，数据库类型 ID → 类型代码（找不到时保留原值）
export const labelForwardError = (err, source) => {
  const e = err || {};
  const logic = e.entityId != null ? findById(source && source.logicEntities, e.entityId) : null;
  const field = logic && e.fieldId != null ? findById(logic.fields, e.fieldId) : null;
  const supports = (source && source.profile && source.profile.dataTypeSupports) || [];
  const supportLabel = (id) => {
    const s = id != null ? findById(supports, id) : null;
    return s ? (s.defKey || s.defName || '') : '';
  };
  const databases = (source && source.profile && source.profile.modelCatalog
    && source.profile.modelCatalog.physicalDatabases) || [];
  const database = e.databaseId != null ? findById(databases, e.databaseId) : null;
  return {
    ...e,
    labels: {
      database: database ? str(database.defKey || database.defName) : '',
      entity: logic ? str(logic.defKey) : '',
      field: field ? str(field.defKey).trim() : '',
      db: supportLabel(e.db),
      dbTypeId: supportLabel(e.dbTypeId),
    },
  };
};

export const labelForwardErrors = (errors, source) => (errors || [])
  .map(e => labelForwardError(e, source));

// forward.err.<code> 文案的占位参数；每个占位符都给出字符串，避免缺键渲染成 "undefined"
export const forwardErrorData = (err) => {
  const e = err || {};
  const labels = e.labels || {};
  let count = '';
  if (Array.isArray(e.items)) count = String(e.items.length);
  return {
    defKey: str(e.defKey != null ? e.defKey : e.index),
    owner: str(e.owner),
    refEntity: str(e.refEntity),
    type: str(e.type),
    db: labels.db || str(e.db),
    dbTypeId: labels.dbTypeId || str(e.dbTypeId),
    domain: str(e.domain),
    baseType: str(e.baseTypeName || e.baseType || e.applyFor),
    candidates: (e.candidates || []).join(', '),
    fields: (e.fields || []).join(', '),
    message: str(e.message),
    count,
  };
};

// 定位：目标级显示数据库类型，无类型时回落所选数据库（代码，找不到则 databaseId）；
// 其余显示 逻辑实体[.字段]
const whereOf = (e) => {
  const labels = e.labels || {};
  if (e.level === 'target') {
    return labels.dbTypeId || str(e.dbTypeId) || labels.database || str(e.databaseId);
  }
  const entity = labels.entity || str(e.entityDefKey) || str(e.entityId);
  const field = labels.field || (e.level === 'field' ? str(e.defKey).trim() : '');
  return [entity, field].filter(Boolean).join('.');
};

// 全部阻断错误按 level 分组：[{level, title, lines: [{key, code, where, text}]}]
// t 为向导的 forward.* 取文案函数：t(key, data)
export const renderBlockingErrors = (blockingErrors, t) => {
  const order = FORWARD_ERROR_LEVELS.slice();
  const byLevel = {};
  (blockingErrors || []).forEach((e, i) => {
    const level = (e && e.level) || 'generate';
    if (order.indexOf(level) < 0) order.push(level);
    if (!byLevel[level]) byLevel[level] = [];
    byLevel[level].push({
      key: `${level}-${i}`,
      code: e.code,
      where: whereOf(e),
      text: t(`err.${e.code}`, forwardErrorData(e)),
    });
  });
  return order.filter(level => byLevel[level])
    .map(level => ({level, title: t(`errLevel.${level}`), lines: byLevel[level]}));
};
