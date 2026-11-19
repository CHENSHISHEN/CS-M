// 指标平台 M2：UI 写命令编排层（纯函数，无 React）。
// - 所有写入经 M1 领域接口（src/lib/metric_platform），基于调用方提供的最新有效
//   source 执行，成功后把 M1 返回的新 source 交给一次 updateDataSource 落到项目
//   状态（事务语义：一次命令一次 update，不产生中间半提交状态）。
// - 表单 → 三类 spec 的构建器与限定值解析也在此处，供编辑器与合成测试共用。
// 注：与 src/lib/metrics 约定一致，不使用 ?? / ?.（旧构建链兼容，== null 三元）。

import * as metricApi from '../../lib/metric_platform';

export {metricApi};

// 只读守卫结果：UI 按钮已禁用，这里是第二道防线（不伪造成功）
export const readOnlyBlocked = () => ({
  ok: false,
  errors: [{code: 'READ_ONLY', path: '', messageKey: 'metric.error.readOnly',
    message: 'metric platform is read-only in current mode'}],
});

/**
 * 统一命令执行器：
 * run(latestSource) 返回 M1 结果；ok 且带新 source 时恰好调用一次 updateDataSource。
 * 返回 M1 原样结果（含 errors 供 UI 渲染 messageKey）。
 */
export const runMetricCommand = ({getSource, updateDataSource, readOnly}, run) => {
  if (readOnly) return readOnlyBlocked();
  const latest = getSource && getSource();
  const result = run(latest);
  if (result && result.ok && result.source && updateDataSource) {
    updateDataSource(result.source);
  }
  return result;
};

// ---- 限定值解析：有类型标量，不接受任意 SQL/JSON 文本 ----
export const parseQualifierValue = (text, op) => {
  const raw = String(text).trim();
  if (op === 'in' || op === 'not_in') {
    return raw.split(',').map(s => s.trim()).filter(s => s !== '')
      .map(s => (s === 'true' ? true : (s === 'false' ? false
        : (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s))));
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
};

export const qualifierValueToText = (value) => Array.isArray(value)
  ? value.map(v => String(v)).join(',') : (value == null ? '' : String(value));

// ---- 语义字典（M3A）：编辑器选择项与类型化限定值 ----
// 活动条目（未停用）供选择；dimensionByCode 含全部状态——停用维度不再新选，但旧值仍按其类型解析
export const dictionaryOptions = (source) => {
  const dict = metricApi.readMetricDictionary(source);
  const active = list => (list || []).filter(entry => entry.status !== 'disabled');
  const dimensionByCode = {};
  (dict.dimensions || []).forEach((dim) => {
    dimensionByCode[dim.code] = dim;
  });
  return {
    departments: active(dict.departments),
    dimensions: active(dict.dimensions),
    qualifiers: active(dict.qualifiers),
    periods: active(dict.periods),
    units: active(dict.units),
    dimensionByCode,
  };
};

// 字典维度命中 → 按声明值类型严格解析（'001' 字符串型保持字符串；boolean 只认 true/false）；
// 未命中（旧手工值/设计态值）→ 沿用 M2 启发式，保证旧数据兼容读取
export const qualifierValueFromRow = (row, options) => {
  const dim = options && options.dimensionByCode
    ? options.dimensionByCode[row.dimensionId] : null;
  if (dim == null) {
    return {ok: true, value: parseQualifierValue(row.value, row.op)};
  }
  const parsed = (row.op === 'in' || row.op === 'not_in')
    ? metricApi.parseTypedList(row.value, dim.valueType)
    : metricApi.parseTypedScalar(row.value, dim.valueType);
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        code: 'INVALID_VALUE', path: '', messageKey: 'metric.error.invalidValue',
        message: `value does not match dimension value type ${dim.valueType}`,
        params: {type: dim.valueType},
      },
    };
  }
  return {ok: true, value: (row.op === 'in' || row.op === 'not_in') ? parsed.values : parsed.value};
};

const qualifierFromRow = (row, options) => ({
  dimensionId: row.dimensionId,
  op: row.op,
  value: qualifierValueFromRow(row, options).value,
});

// 限定行的类型化预检：任一行不合法即返回结构化错误（path 对齐 M1 spec 位置）
export const qualifierRowsErrors = (form, options) => {
  const errors = [];
  const lists = [
    ['baseQualifiers', form.baseQualifiers],
    ['qualifiers', form.qualifiers],
  ];
  lists.forEach(([listName, rows]) => {
    (rows || []).forEach((row, index) => {
      if (row.dimensionId == null || row.dimensionId === '') return; // MISSING_FIELD 由 M1 校验
      const result = qualifierValueFromRow(row, options);
      if (!result.ok) {
        errors.push({
          ...result.error,
          path: `spec.${listName}[${index}].value`,
        });
      }
    });
  });
  return errors;
};

export const QUALIFIER_OP_KEYS = {
  eq: 'metrics.op.eq',
  not_eq: 'metrics.op.notEq',
  in: 'metrics.op.in',
  not_in: 'metrics.op.notIn',
  gt: 'metrics.op.gt',
  gte: 'metrics.op.gte',
  lt: 'metrics.op.lt',
  lte: 'metrics.op.lte',
};

export const AGGREGATION_KEYS = {
  SUM: 'metrics.agg.SUM',
  COUNT: 'metrics.agg.COUNT',
  COUNT_DISTINCT: 'metrics.agg.COUNT_DISTINCT',
  MIN: 'metrics.agg.MIN',
  MAX: 'metrics.agg.MAX',
  AVG: 'metrics.agg.AVG',
};

export const ADDABLE_KEYS = {
  additive: 'metrics.addable.additive',
  semi_additive: 'metrics.addable.semi',
  non_additive: 'metrics.addable.non',
};

export const KIND_KEYS = {
  atomic: 'metrics.kind.atomic',
  derived: 'metrics.kind.derived',
  compound: 'metrics.kind.compound',
};

export const STATUS_KEYS = {
  draft: 'metrics.status.draft',
  published: 'metrics.status.published',
  deprecated: 'metrics.status.deprecated',
};

// 项目真实模型清单（物理/逻辑/概念），供原子来源引用选择
export const listSourceModels = (source) => {
  if (source == null) return [];
  const pools = [
    {collection: 'entities', level: 'physical'},
    {collection: 'logicEntities', level: 'logical'},
    {collection: 'conceptEntities', level: 'conceptual'},
  ];
  const models = [];
  pools.forEach(({collection, level}) => {
    (source[collection] || []).forEach((entity) => {
      if (entity == null || !entity.id) return;
      models.push({
        id: entity.id,
        collection,
        level,
        defKey: entity.defKey || entity.id,
        defName: entity.defName || entity.defKey || entity.id,
        fields: (entity.fields || []).map(f => ({
          id: f.id, defKey: f.defKey || f.id, defName: f.defName || f.defKey || f.id,
        })),
      });
    });
  });
  return models;
};

export const findSourceModel = (source, modelId) =>
  listSourceModels(source).filter(m => m.id === modelId)[0] || null;

// 项目内已使用过的维度 id 集合（来自全部原子 spec），作为自由输入的候选建议
export const collectKnownDimensionIds = (source) => {
  const ids = [];
  const store = metricApi.readMetricPlatform(source);
  (store.revisions || []).forEach((revision) => {
    const spec = revision.spec || {};
    (spec.dimensions || []).forEach((dimension) => {
      if (dimension && dimension.dimensionId && ids.indexOf(dimension.dimensionId) < 0) {
        ids.push(dimension.dimensionId);
      }
    });
    (spec.baseQualifiers || []).concat(spec.qualifiers || []).forEach((qualifier) => {
      if (qualifier && qualifier.dimensionId && ids.indexOf(qualifier.dimensionId) < 0) {
        ids.push(qualifier.dimensionId);
      }
    });
  });
  return ids;
};

// 已发布修订选项（按类型过滤）：真实 store 中 status='published' 的修订
export const listPublishedRevisionOptions = (source, kind) => {
  const store = metricApi.readMetricPlatform(source);
  const definitionById = {};
  (store.definitions || []).forEach((definition) => {
    definitionById[definition.id] = definition;
  });
  return (store.revisions || [])
    .filter(revision => revision.status === 'published')
    .filter(revision => kind == null
      || (definitionById[revision.definitionId] || {}).kind === kind)
    .map((revision) => {
      const definition = definitionById[revision.definitionId] || {};
      const scopeLabel = definition.scope && definition.scope.kind === 'department'
        ? `${definition.scope.departmentId}` : '';
      return {
        revisionId: revision.id,
        definitionId: definition.id,
        kind: definition.kind,
        code: definition.code,
        name: definition.name,
        scope: definition.scope,
        scopeLabel,
        version: revision.version,
        unit: revision.resolvedSpec == null ? null : revision.resolvedSpec.unit,
        dimensions: revision.spec && revision.spec.kind === 'atomic'
          ? (revision.spec.dimensions || []).map(d => d.dimensionId) : [],
        spec: revision.spec,
        resolvedSpec: revision.resolvedSpec,
      };
    });
};

// ---- 表单 → 三类 spec（spec.name 与定义名称同步；跨类型字段不混填） ----
// options 为语义字典选择项（可空）：字典维度按声明类型解析限定值，未命中沿用 M2 启发式

export const atomicSpecFromForm = (form, options) => {
  const spec = {
    kind: 'atomic',
    name: form.name,
    description: form.description,
    businessDomain: form.businessDomain,
    businessProcess: form.businessProcess,
    aggregation: form.aggregation,
    factGrain: {
      description: form.factGrainDescription,
      uniqueKeyFieldIds: (form.uniqueKeyFieldIds || []).slice(),
    },
    timeRole: form.timeRole,
    timezone: form.timezone,
    baseQualifiers: (form.baseQualifiers || []).map(q => qualifierFromRow(q, options)),
    unit: form.unit,
    dimensions: (form.dimensions || []).map(d => ({dimensionId: d.dimensionId, addable: d.addable})),
  };
  // 来源引用：未绑定 → 设计态（source 缺省），发布为“未计算就绪”的设计定义
  if (form.sourceModelId) {
    spec.source = form.sourceFieldId
      ? {modelId: form.sourceModelId, fieldId: form.sourceFieldId}
      : {modelId: form.sourceModelId};
  }
  return spec;
};

export const derivedSpecFromForm = (form, options) => {
  const spec = {
    kind: 'derived',
    name: form.name,
    description: form.description,
    atomicRevisionId: form.atomicRevisionId,
    window: {
      type: form.windowType,
      length: Number(form.windowLength),
      end: form.windowEnd,
      timezone: form.windowTimezone,
    },
    qualifiers: (form.qualifiers || []).map(q => qualifierFromRow(q, options)),
    outputGrain: (form.outputGrain || []).slice(),
  };
  return spec;
};

export const compoundSpecFromForm = (form) => {
  return {
    kind: 'compound',
    name: form.name,
    description: form.description,
    expression: form.expression,
    refs: (form.refs || []).map(r => ({key: r.key, revisionId: r.revisionId})),
  };
};

// 表单是否偏离已加载草案（粗粒度脏检查：语义字段逐一比较）
const sameQualifierList = (left, right) => {
  if ((left || []).length !== (right || []).length) return false;
  return (left || []).every((q, i) => {
    const other = right[i];
    return q.dimensionId === other.dimensionId && q.op === other.op
      && JSON.stringify(q.value) === JSON.stringify(other.value);
  });
};

export const sameAtomicSpec = (form, spec, options) => {
  if (spec == null || spec.kind !== 'atomic') return false;
  const current = atomicSpecFromForm(form, options);
  return current.aggregation === spec.aggregation
    && current.description === (spec.description || '')
    && current.businessDomain === spec.businessDomain
    && current.businessProcess === spec.businessProcess
    && current.timeRole === spec.timeRole
    && current.timezone === spec.timezone
    && current.unit === spec.unit
    && current.factGrain.description === (spec.factGrain || {}).description
    && JSON.stringify(current.factGrain.uniqueKeyFieldIds)
      === JSON.stringify((spec.factGrain || {}).uniqueKeyFieldIds || [])
    && JSON.stringify(current.source || null) === JSON.stringify(spec.source || null)
    && sameQualifierList(current.baseQualifiers, spec.baseQualifiers || [])
    && JSON.stringify(current.dimensions) === JSON.stringify(spec.dimensions || []);
};

export const sameDerivedSpec = (form, spec, options) => {
  if (spec == null || spec.kind !== 'derived') return false;
  const current = derivedSpecFromForm(form, options);
  return current.atomicRevisionId === spec.atomicRevisionId
    && current.description === (spec.description || '')
    && current.window.type === spec.window.type
    && String(current.window.length) === String(spec.window.length)
    && current.window.end === spec.window.end
    && current.window.timezone === spec.window.timezone
    && sameQualifierList(current.qualifiers, spec.qualifiers || [])
    && JSON.stringify(current.outputGrain) === JSON.stringify(spec.outputGrain || []);
};

export const sameCompoundSpec = (form, spec) => {
  if (spec == null || spec.kind !== 'compound') return false;
  const current = compoundSpecFromForm(form);
  return current.expression === spec.expression
    && current.description === (spec.description || '')
    && JSON.stringify(current.refs) === JSON.stringify(spec.refs || []);
};

export const isFormPristine = (form, revision, definition, options) => {
  if (revision == null || definition == null) return false;
  const spec = revision.spec;
  const metaSame = form.name === definition.name
    && form.ownerId === definition.ownerId
    && (form.conceptId || null) === (definition.conceptId || null);
  if (!metaSame) return false;
  if (spec.kind === 'atomic') return sameAtomicSpec(form, spec, options);
  if (spec.kind === 'derived') return sameDerivedSpec(form, spec, options);
  if (spec.kind === 'compound') return sameCompoundSpec(form, spec);
  return false;
};

// 表单 → spec 的统一入口：先做限定值类型化预检，失败返回结构化错误（不触发写命令）
export const buildSpecFromForm = (form, options) => {
  const errors = qualifierRowsErrors(form, options);
  if (errors.length) return {ok: false, errors};
  if (form.kind === 'atomic') return {ok: true, spec: atomicSpecFromForm(form, options)};
  if (form.kind === 'derived') return {ok: true, spec: derivedSpecFromForm(form, options)};
  return {ok: true, spec: compoundSpecFromForm(form)};
};
