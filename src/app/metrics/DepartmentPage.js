import React, {useMemo, useState, useEffect, useRef} from 'react';
import {FormatMessage, Message, Modal} from 'components';
import {
  metricApi,
  runMetricCommand,
  dictionaryOptions,
  listPublishedRevisionOptions,
  qualifierValueFromRow,
  qualifierValueToText,
  QUALIFIER_OP_KEYS,
  AGGREGATION_KEYS,
  ADDABLE_KEYS,
  KIND_KEYS,
  STATUS_KEYS,
  listSourceModels,
  findSourceModel,
} from './commands';
import {renderErrorList, renderKindBadge, renderScopeBadge, renderStatusBadge} from './parts';

// 指标平台 M3B：部门口径页（替换 PendingPage）。
// - 建立：选具体公共已发布版本（原子/派生/复合三类）+ 部门/负责人/独立编码，独立 ID 锁定基线；
//   原子=追加基础限定、派生=追加限定/收窄粒度、复合=显式分叉（核心公式在新定义草案上改）；
// - 对比：公共与部门完整 spec 并排差异（继承/新增/修改/收窄），真实存储状态，不造演示数据；
// - 升级：公共新版本 → 三方比较（旧公共/新公共/当前部门），保持旧版零写入或显式升级草案；
//   公共核心语义变化拒绝重放，引导从新版本显式分叉；
// - 写入全部经 commandRunner（一次命令一次 update），发布仍走定义页验证与本地确认。

const MANUAL_OPTION = '__manual__';
const QUALIFIER_OPS = ['eq', 'not_eq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte'];

const emptyCreateForm = () => ({
  baseRevisionId: '',
  departmentManual: false,
  departmentId: '',
  ownerId: '',
  code: '',
  name: '',
  forkNote: '',
  fork: false,
  addRows: [],            // derived → addQualifiers / atomic → addBaseQualifiers
  restrictDimensions: [], // derived only
});

const isCreateEmpty = form => form.baseRevisionId === '' && form.departmentId === ''
  && form.ownerId === '' && form.code === '' && form.name === '' && form.forkNote === ''
  && form.fork === false
  && form.addRows.length === 0 && form.restrictDimensions.length === 0;

// ---- 完整 spec 扁平化（数组按元素展开为 [i] 路径；空数组按叶子），供公共/部门并排差异 ----
const flattenSpec = (spec, prefix, out) => {
  const base = prefix == null ? '' : prefix;
  if (spec == null || typeof spec !== 'object') {
    out.push({path: base, value: spec});
    return out;
  }
  if (Array.isArray(spec)) {
    if (spec.length === 0) {
      out.push({path: base, value: []});
      return out;
    }
    spec.forEach((item, index) => {
      flattenSpec(item, `${base}[${index}]`, out);
    });
    return out;
  }
  Object.keys(spec).sort().forEach((key) => {
    flattenSpec(spec[key], base === '' ? key : `${base}.${key}`, out);
  });
  return out;
};

export const diffSpecRows = (publicSpec, departmentSpec) => {
  const left = {};
  flattenSpec(publicSpec, '', []).forEach(row => { left[row.path] = row.value; });
  const right = {};
  flattenSpec(departmentSpec, '', []).forEach(row => { right[row.path] = row.value; });
  const paths = [];
  Object.keys(left).forEach(p => { if (paths.indexOf(p) < 0) paths.push(p); });
  Object.keys(right).forEach(p => { if (paths.indexOf(p) < 0) paths.push(p); });
  paths.sort();
  const rows = paths.map((path) => {
    const hasLeft = Object.prototype.hasOwnProperty.call(left, path);
    const hasRight = Object.prototype.hasOwnProperty.call(right, path);
    const same = hasLeft && hasRight
      && JSON.stringify(left[path]) === JSON.stringify(right[path]);
    const mark = !hasLeft ? 'add' : (!hasRight ? 'remove' : (same ? 'inherit' : 'modify'));
    return {
      path: path === '' ? 'spec' : path,
      publicValue: hasLeft ? left[path] : null,
      departmentValue: hasRight ? right[path] : null,
      mark,
    };
  });
  // 空数组容器行（如 qualifiers: []）在另一侧展开为元素时是幻影行，剔除
  return rows.filter(row => !(Array.isArray(row.publicValue) && row.publicValue.length === 0
      && !row.departmentValue) || !rows.some(other => other !== row
      && other.path.indexOf(`${row.path}[`) === 0))
    .filter(row => !(Array.isArray(row.departmentValue) && row.departmentValue.length === 0
      && !row.publicValue) || !rows.some(other => other !== row
      && other.path.indexOf(`${row.path}[`) === 0));
};

const displayValue = (value) => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '""' : value;
  return JSON.stringify(value);
};

// ---- M5B 差异表业务化：path → 业务字段名，取值 → 中文窗口/操作符/聚合等；
// UUID（atomicRevisionId / refs[].revisionId / modelId / fieldId）解析为
// 指标名称+版本 / 模型与字段名称，原始 path 与原始 JSON 留在可展开技术详情 ----
const DIFF_SEG_KEYS = {
  name: 'metrics.department.diffSeg.name',
  description: 'metrics.department.diffSeg.description',
  kind: 'metrics.department.diffSeg.kind',
  businessDomain: 'metrics.department.diffSeg.businessDomain',
  businessProcess: 'metrics.department.diffSeg.businessProcess',
  aggregation: 'metrics.department.diffSeg.aggregation',
  unit: 'metrics.department.diffSeg.unit',
  timeRole: 'metrics.department.diffSeg.timeRole',
  timezone: 'metrics.department.diffSeg.timezone',
  expression: 'metrics.department.diffSeg.expression',
  atomicRevisionId: 'metrics.department.diffSeg.atomicRevisionId',
  source: 'metrics.department.diffSeg.source',
  factGrain: 'metrics.department.diffSeg.factGrain',
  uniqueKeyFieldIds: 'metrics.department.diffSeg.uniqueKeyFieldIds',
  baseQualifiers: 'metrics.department.diffSeg.baseQualifiers',
  qualifiers: 'metrics.department.diffSeg.qualifiers',
  dimensions: 'metrics.department.diffSeg.dimensions',
  outputGrain: 'metrics.department.diffSeg.outputGrain',
  refs: 'metrics.department.diffSeg.refs',
  window: 'metrics.department.diffSeg.window',
};
const DIFF_PAIR_KEYS = {
  'window.type': 'metrics.department.diffSeg.windowType',
  'window.length': 'metrics.department.diffSeg.windowLength',
  'window.end': 'metrics.department.diffSeg.windowEnd',
  'window.timezone': 'metrics.department.diffSeg.windowTimezone',
  'factGrain.description': 'metrics.department.diffSeg.factGrainDescription',
  'factGrain.uniqueKeyFieldIds': 'metrics.department.diffSeg.uniqueKeyFieldIds',
  'source.modelId': 'metrics.department.diffSeg.modelId',
  'source.fieldId': 'metrics.department.diffSeg.fieldId',
};
const DIFF_LIST_KEYS = ['qualifiers', 'baseQualifiers', 'dimensions', 'outputGrain', 'refs'];
const DIFF_LEAF_KEYS = {
  dimensionId: 'metrics.department.diffSeg.dimensionId',
  op: 'metrics.department.diffSeg.op',
  value: 'metrics.department.diffSeg.value',
  addable: 'metrics.department.diffSeg.addable',
  key: 'metrics.department.diffSeg.refKey',
  revisionId: 'metrics.department.diffSeg.refRevision',
};
const segLabel = seg => (DIFF_SEG_KEYS[seg]
  ? FormatMessage.string({id: DIFF_SEG_KEYS[seg]}) : seg);
const leafLabel = leaf => (DIFF_LEAF_KEYS[leaf]
  ? FormatMessage.string({id: DIFF_LEAF_KEYS[leaf]}) : leaf);

const diffRowLabel = (path) => {
  const p = String(path);
  if (p === '' || p === 'spec') {
    return FormatMessage.string({id: 'metrics.department.detailTitle'});
  }
  let m = p.match(/^(qualifiers|baseQualifiers|refs)\[(\d+)\]\.([A-Za-z]+)$/);
  if (m) return `${segLabel(m[1])}[${Number(m[2]) + 1}] · ${leafLabel(m[3])}`;
  m = p.match(/^(dimensions)\[(\d+)\]\.([A-Za-z]+)$/);
  if (m) return `${segLabel(m[1])}[${Number(m[2]) + 1}] · ${leafLabel(m[3])}`;
  m = p.match(new RegExp(`^(${DIFF_LIST_KEYS.join('|')})\\[(\\d+)\\]$`));
  if (m) return `${segLabel(m[1])}[${Number(m[2]) + 1}]`;
  m = p.match(/^factGrain\.uniqueKeyFieldIds\[(\d+)\]$/);
  if (m) {
    return `${FormatMessage.string({id: 'metrics.department.diffSeg.uniqueKeyFieldIds'})}[${Number(m[1]) + 1}]`;
  }
  if (DIFF_PAIR_KEYS[p]) return FormatMessage.string({id: DIFF_PAIR_KEYS[p]});
  if (DIFF_SEG_KEYS[p]) return FormatMessage.string({id: DIFF_SEG_KEYS[p]});
  return p;
};

const WINDOW_VALUE_KEYS = {
  calendarDays: 'metrics.window.calendarDays',
  rollingHours: 'metrics.window.rollingHours',
  yesterday: 'metrics.window.yesterday',
  today: 'metrics.window.today',
};

const revisionLabelOf = (source, revisionId) => {
  const rev = metricApi.getMetricRevision(source, revisionId);
  if (rev == null) return null;
  const store = metricApi.readMetricPlatform(source);
  const def = (store.definitions || []).filter(d => d.id === rev.definitionId)[0];
  if (def == null) return null;
  return `${def.name}（${def.code}）v${rev.version || '?'}`;
};

const fieldLabelOf = (source, fieldId) => {
  const models = listSourceModels(source);
  for (let i = 0; i < models.length; i += 1) {
    const field = (models[i].fields || []).filter(f => f.id === fieldId)[0];
    if (field) return field.defKey;
  }
  return null;
};

// 业务主文案：操作符/窗口/聚合/可加性中文化；UUID 引用解析为名称+版本（原始值
// 进入技术详情），数组逐项同样处理；未识别取值原样呈现，不编造业务含义
const diffValueMain = (source, path, value) => {
  if (value === null || value === undefined) return '—';
  const leaf = String(path).split('.').pop().split('[')[0];
  if (leaf === 'op' && QUALIFIER_OP_KEYS[value]) {
    return FormatMessage.string({id: QUALIFIER_OP_KEYS[value]});
  }
  if (leaf === 'aggregation' && AGGREGATION_KEYS[value]) {
    return FormatMessage.string({id: AGGREGATION_KEYS[value]});
  }
  if (leaf === 'addable' && ADDABLE_KEYS[value]) {
    return FormatMessage.string({id: ADDABLE_KEYS[value]});
  }
  if (leaf === 'kind' && KIND_KEYS[value]) {
    return FormatMessage.string({id: KIND_KEYS[value]});
  }
  if ((leaf === 'type' || leaf === 'end') && WINDOW_VALUE_KEYS[value]) {
    return FormatMessage.string({id: WINDOW_VALUE_KEYS[value]});
  }
  if (typeof value === 'boolean') {
    return FormatMessage.string({id: value ? 'metrics.common.yes' : 'metrics.common.no'});
  }
  if ((leaf === 'atomicRevisionId' || leaf === 'revisionId') && typeof value === 'string') {
    const label = revisionLabelOf(source, value);
    if (label) return label;
  }
  if (leaf === 'modelId' && typeof value === 'string') {
    const model = findSourceModel(source, value);
    if (model) return `${model.defName}（${model.defKey}）`;
  }
  if (leaf === 'fieldId' && typeof value === 'string') {
    const fieldKey = fieldLabelOf(source, value);
    if (fieldKey) return fieldKey;
  }
  if (Array.isArray(value)) {
    return value.map(item => diffValueMain(source, path, item)).join('、');
  }
  if (typeof value === 'string') return value === '' ? '""' : value;
  return displayValue(value);
};

// 差异行：主信息 = 业务字段 + 业务取值；原始 path / 原始 JSON 留可展开技术详情
const renderDiffCell = (source, path, value) => {
  const main = diffValueMain(source, path, value);
  const isReference = typeof value === 'string' && value.length >= 16
    && (String(path).indexOf('RevisionId') >= 0 || String(path).indexOf('modelId') >= 0
      || String(path).indexOf('fieldId') >= 0);
  return <span
    className='chiner-metrics-diff-value'
    title={isReference ? String(value) : undefined}
    data-testid='metrics-dept-diff-value'>
    {main}
  </span>;
};

const renderDiffTech = (row) => {
  if (row.publicValue === row.departmentValue && row.publicValue == null) return null;
  return <details className='chiner-metrics-diff-tech' data-testid='metrics-dept-diff-tech'>
    <summary><FormatMessage id='metrics.department.diffRowTech'/></summary>
    <code className='chiner-metrics-mono'>{row.path}</code>
    <span>{`${displayValue(row.publicValue)} → ${displayValue(row.departmentValue)}`}</span>
  </details>;
};

const MARK_KEYS = {
  inherit: 'metrics.department.previewInherit',
  add: 'metrics.department.previewAdd',
  modify: 'metrics.department.previewModify',
  remove: 'metrics.department.previewRemove',
};

const renderMarkTag = mark => <span
  className={`chiner-metrics-tag chiner-metrics-diff-${mark}`}
  data-testid='metrics-dept-diff-mark'>
  <FormatMessage id={MARK_KEYS[mark]}/>
</span>;

// 部门细化限定行（维度候选由基线声明限定，值按字典维度类型解析）
const renderPatchRows = ({rows, dimensionChoices, dimensionByCode, onChange, disabled}) => {
  const update = (index, patch) => {
    onChange(rows.map((row, i) => (i === index ? {...row, ...patch} : row)));
  }
  ;
  return <div className='chiner-metrics-rows' data-testid='metrics-dept-patch-rows'>
    {rows.map((row, index) => {
      const dim = dimensionByCode ? dimensionByCode[row.dimensionId] : null;
      const isBooleanDim = dim != null && dim.valueType === 'boolean'
        && row.op !== 'in' && row.op !== 'not_in';
      return <div key={index} className='chiner-metrics-row3'>
        <select
          value={row.dimensionId}
          onChange={e => update(index, {dimensionId: e.target.value})}
          disabled={disabled}
          aria-label={FormatMessage.string({id: 'metrics.form.dimensionId'})}
          data-testid='metrics-dept-qual-dim'
        >
          <option value=''>{FormatMessage.string({id: 'metrics.form.selectDimension'})}</option>
          {dimensionChoices.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={row.op}
          onChange={e => update(index, {op: e.target.value})}
          disabled={disabled}
          aria-label={FormatMessage.string({id: 'metrics.form.op'})}
          data-testid='metrics-dept-qual-op'
        >
          {QUALIFIER_OPS.map(op => <option key={op} value={op}>
            {FormatMessage.string({id: QUALIFIER_OP_KEYS[op] || 'metrics.op.eq'})}
          </option>)}
        </select>
        {isBooleanDim ? <select
          value={row.value}
          onChange={e => update(index, {value: e.target.value})}
          disabled={disabled}
          aria-label={FormatMessage.string({id: 'metrics.form.value'})}
          data-testid='metrics-dept-qual-value'
        >
          <option value=''>{FormatMessage.string({id: 'metrics.form.selectValue'})}</option>
          <option value='true'>true</option>
          <option value='false'>false</option>
        </select> : <input
          value={row.value}
          onChange={e => update(index, {value: e.target.value})}
          disabled={disabled}
          placeholder={FormatMessage.string({id: 'metrics.form.valuePlaceholder'})}
          aria-label={FormatMessage.string({id: 'metrics.form.value'})}
          title={dim != null
            ? `${FormatMessage.string({id: 'metrics.form.valueTypeHint'})}: ${dim.valueType}` : undefined}
          data-testid='metrics-dept-qual-value'
        />}
        <button
          type='button'
          className='chiner-metrics-iconbtn'
          disabled={disabled}
          onClick={() => onChange(rows.filter((r, i) => i !== index))}
          aria-label={FormatMessage.string({id: 'metrics.form.removeRow'})}
        >×</button>
      </div>;
    })}
    <button
      type='button'
      className='chiner-metrics-btn chiner-metrics-btn-ghost'
      disabled={disabled}
      onClick={() => onChange(rows.concat([{dimensionId: '', op: 'eq', value: ''}]))}
      data-testid='metrics-dept-qual-add'
    >
      + <FormatMessage id='metrics.form.addQualifier'/>
    </button>
  </div>;
};

const DepartmentPage = ({source, commandRunner, readOnly, onOpenDefinition, onDirtyChange}) => {
  // view: 'list' | 'create' | {mode:'detail', definitionId}
  const [view, setView] = useState('list');
  const [form, setForm] = useState(emptyCreateForm());
  const [commandErrors, setCommandErrors] = useState([]);
  const dirtyRef = useRef(false);

  const store = useMemo(() => metricApi.readMetricPlatform(source), [source]);
  const dictOptions = useMemo(() => dictionaryOptions(source), [source]);

  // ---- 部门口径清单（真实 store；含升级可用标记） ----
  const entries = useMemo(() => metricApi.listMetricDefinitions(source,
    {scope: {kind: 'department'}}), [source]);
  const upgradeFlags = useMemo(() => {
    const flags = {};
    entries.forEach((entry) => {
      const rev = entry.latestPublished || entry.draft;
      if (rev == null || rev.baseline == null) return;
      const status = metricApi.departmentUpgradeStatus(source, rev.id);
      flags[entry.definition.id] = !!(status && status.ok && status.upgradeAvailable);
    });
    return flags;
  }, [source, entries]);
  const upgradeCount = Object.keys(upgradeFlags).filter(id => upgradeFlags[id]).length;

  // ---- 公共基线选项（具体已发布版本，三类均可；scope 必须 public） ----
  const baselines = useMemo(() => listPublishedRevisionOptions(source)
    .filter(option => option.scope && option.scope.kind === 'public'), [source]);
  const baselineByRevisionId = useMemo(() => {
    const map = {};
    baselines.forEach(option => { map[option.revisionId] = option; });
    return map;
  }, [baselines]);
  const selectedBaseline = form.baseRevisionId
    ? baselineByRevisionId[form.baseRevisionId] : null;
  const baselineKind = selectedBaseline ? selectedBaseline.kind : null;

  // ---- 建立表单 patch 预检与预览（纯本地计算，不写入） ----
  const buildPatch = (currentForm) => {
    const options = dictionaryOptions(source);
    const errors = [];
    const typedRows = [];
    (currentForm.addRows || []).forEach((row, index) => {
      if (row.dimensionId === '' && String(row.value).trim() === '') return; // 整行留空忽略
      if (row.dimensionId === '') {
        errors.push({code: 'MISSING_FIELD', path: `patch.rows[${index}].dimensionId`,
          messageKey: 'metric.error.missingField', params: {field: 'dimensionId'}});
        return;
      }
      const parsed = qualifierValueFromRow(row, options);
      if (!parsed.ok) {
        errors.push({...parsed.error, path: `patch.rows[${index}].value`});
        return;
      }
      typedRows.push({dimensionId: row.dimensionId, op: row.op, value: parsed.value});
    });
    if (errors.length) return {ok: false, errors};
    const patch = {};
    if (baselineKind === 'derived') {
      if (typedRows.length) patch.addQualifiers = typedRows;
      if ((currentForm.restrictDimensions || []).length) {
        patch.restrictDimensions = currentForm.restrictDimensions.slice();
      }
    } else if (baselineKind === 'atomic') {
      if (typedRows.length) patch.addBaseQualifiers = typedRows;
    }
    return {ok: true, patch};
  };

  const preview = useMemo(() => {
    if (!selectedBaseline) return null;
    const built = buildPatch(form);
    if (!built.ok) return {ok: false, errors: built.errors};
    const departmentSpec = metricApi.applyDepartmentPatch(selectedBaseline.spec, built.patch);
    const rows = diffSpecRows(selectedBaseline.spec, departmentSpec)
      .filter(row => row.mark !== 'inherit');
    return {ok: true, patch: built.patch, departmentSpec, rows};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, selectedBaseline, source]);

  // ---- 脏上报（仅建立表单；详情/清单只读） ----
  const dirty = view === 'create' && !isCreateEmpty(form);
  dirtyRef.current = dirty;
  useEffect(() => {
    onDirtyChange && onDirtyChange(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const switchView = (next) => {
    const apply = () => {
      setCommandErrors([]);
      if (next === 'create') {
        setForm(emptyCreateForm());
        setView('create');
      } else {
        setView(next);
      }
    };
    if (dirtyRef.current) {
      Modal.confirm({
        title: FormatMessage.string({id: 'metrics.dirty.title'}),
        message: FormatMessage.string({id: 'metrics.dirty.message'}),
        onOk: apply,
      });
    } else {
      apply();
    }
  };

  const runDept = (run, afterOk) => {
    setCommandErrors([]);
    const result = runMetricCommand(commandRunner, run);
    if (result && result.ok) {
      afterOk && afterOk(result);
    } else {
      setCommandErrors((result && result.errors) || []);
    }
    return result;
  };

  const updateForm = (patch) => setForm(pre => ({...pre, ...patch}));

  const submitCreate = () => {
    if (!selectedBaseline) {
      setCommandErrors([{code: 'MISSING_FIELD', path: 'baseRevisionId',
        messageKey: 'metric.error.missingField', params: {field: 'baseRevisionId'}}]);
      return;
    }
    const built = buildPatch(form);
    if (!built.ok) {
      setCommandErrors(built.errors);
      return;
    }
    const departmentId = form.departmentId.trim();
    const input = {
      baseRevisionId: form.baseRevisionId,
      departmentId,
      ownerId: form.ownerId.trim(),
      code: form.code.trim(),
      ...(form.name.trim() === '' ? {} : {name: form.name.trim()}),
      ...(form.forkNote.trim() === '' ? {} : {forkNote: form.forkNote.trim()}),
      // 复合基线必为显式分叉；派生/原子由显式勾选决定
      fork: baselineKind === 'compound' ? true : form.fork === true,
      patch: built.patch,
    };
    if (departmentId === '') {
      setCommandErrors([{code: 'MISSING_FIELD', path: 'scope.departmentId',
        messageKey: 'metric.error.missingField', params: {field: 'departmentId'}}]);
      return;
    }
    runDept(latest => metricApi.createDepartmentMetricDraft(latest, input), (result) => {
      setForm(emptyCreateForm());
      setView('list');
      Message.success({title: FormatMessage.string({id: 'metrics.department.created'})});
      onDirtyChange && onDirtyChange(false);
      onOpenDefinition && onOpenDefinition(result.definition.id);
    });
  };

  // ---- 详情视图数据 ----
  const detail = view && view.mode === 'detail'
    ? metricApi.getMetricDefinition(source, view.definitionId) : null;
  const detailRevision = detail == null ? null
    : (detail.latestPublished || detail.draft);
  const detailBaselineRevision = detailRevision != null && detailRevision.baseline != null
    ? metricApi.getMetricRevision(source, detailRevision.baseline.baseRevisionId) : null;
  const upgradeStatus = detailRevision != null && detailRevision.status === 'published'
    && detailRevision.baseline != null
    ? metricApi.departmentUpgradeStatus(source, detailRevision.id) : null;
  const upgrade = upgradeStatus && upgradeStatus.ok && upgradeStatus.upgradeAvailable
    ? upgradeStatus : null;

  const doUpgrade = () => {
    if (!upgrade || !detailRevision) return;
    Modal.confirm({
      title: FormatMessage.string({id: 'metrics.department.upgradeDo'}),
      message: FormatMessage.string({id: 'metrics.publish.message'}),
      onOk: () => {
        runDept(latest => metricApi.upgradeDepartmentDraft(latest, {
          departmentRevisionId: detailRevision.id,
          candidateBaseRevisionId: upgrade.candidate.revisionId,
        }), (result) => {
          Message.success({title: FormatMessage.string({id: 'metrics.department.upgraded'})});
          onOpenDefinition && onOpenDefinition(result.revision.definitionId);
        });
      },
    });
  };

  const forkFromCandidate = () => {
    if (!upgrade) return;
    const apply = () => {
      // 公共语义变化引导的显式分叉：预选新公共版本并默认分叉模式（可改）
      setForm({...emptyCreateForm(), baseRevisionId: upgrade.candidate.revisionId, fork: true});
      setView('create');
      setCommandErrors([]);
    };
    if (dirtyRef.current) {
      Modal.confirm({
        title: FormatMessage.string({id: 'metrics.dirty.title'}),
        message: FormatMessage.string({id: 'metrics.dirty.message'}),
        onOk: apply,
      });
    } else {
      apply();
    }
  };

  // ---- 渲染 ----
  if (view === 'create') {
    return <section className='chiner-metrics-page' data-testid='metrics-department-page'>
      <header className='chiner-metrics-page-header'>
        <div>
          <h2 data-testid='metrics-dept-create-title'>
            <FormatMessage id='metrics.department.createTitle'/>
          </h2>
          <p className='chiner-metrics-page-sub'><FormatMessage id='metrics.department.subtitle'/></p>
        </div>
        <button
          type='button'
          className='chiner-metrics-btn'
          data-testid='metrics-dept-cancel'
          onClick={() => switchView('list')}
        >
          <FormatMessage id='metrics.department.backList'/>
        </button>
      </header>
      <div className='chiner-metrics-form-card' data-testid='metrics-dept-create-form'>
        <h3 className='chiner-metrics-form-title'>
          <FormatMessage id='metrics.department.createTitle'/>
        </h3>
        <div className='chiner-metrics-form-grid'>
          <div className='chiner-metrics-field' data-error-path='baseRevisionId'>
            <label className='chiner-metrics-field-label'>
              <FormatMessage id='metrics.department.baselineSelect'/>
            </label>
            <select
              value={form.baseRevisionId}
              onChange={e => updateForm({baseRevisionId: e.target.value})}
              disabled={readOnly}
              data-testid='metrics-dept-baseline-select'
            >
              <option value=''>{FormatMessage.string({id: 'metrics.form.selectOperand'})}</option>
              {baselines.map(option => <option key={option.revisionId} value={option.revisionId}>
                {`${option.code} @ v${option.version} · ${FormatMessage.string(
                  {id: `metrics.kind.${option.kind}`})}`}
              </option>)}
            </select>
            <p className='chiner-metrics-field-hint'>
              <FormatMessage id='metrics.department.baselineHint'/>
            </p>
          </div>
          <div className='chiner-metrics-field' data-error-path='scope.departmentId'>
            <label className='chiner-metrics-field-label'>
              <FormatMessage id='metrics.scope.department'/>
            </label>
            {dictOptions.departments.length > 0 ? (() => {
              const codes = dictOptions.departments.map(d => d.code);
              const manual = form.departmentManual === true
                || (form.departmentId !== '' && codes.indexOf(form.departmentId) < 0);
              return <>
                <select
                  value={manual ? MANUAL_OPTION : form.departmentId}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === MANUAL_OPTION) updateForm({departmentManual: true});
                    else updateForm({departmentId: next, departmentManual: false});
                  }}
                  disabled={readOnly}
                  data-testid='metrics-dept-department-select'
                >
                  <option value=''>{FormatMessage.string({id: 'metrics.form.selectDepartment'})}</option>
                  {dictOptions.departments.map(d => <option key={d.id} value={d.code}>
                    {d.name}（{d.code}）
                  </option>)}
                  <option value={MANUAL_OPTION}>
                    {FormatMessage.string({id: 'metrics.form.manualOption'})}
                  </option>
                </select>
                {manual && <input
                  value={form.departmentId}
                  onChange={e => updateForm({departmentId: e.target.value})}
                  disabled={readOnly}
                  placeholder={FormatMessage.string({id: 'metrics.form.departmentPlaceholder'})}
                  aria-label={FormatMessage.string({id: 'metrics.form.departmentPlaceholder'})}
                  data-testid='metrics-dept-department'
                />}
              </>;
            })() : <input
              value={form.departmentId}
              onChange={e => updateForm({departmentId: e.target.value})}
              disabled={readOnly}
              placeholder={FormatMessage.string({id: 'metrics.form.departmentPlaceholder'})}
              aria-label={FormatMessage.string({id: 'metrics.form.departmentPlaceholder'})}
              data-testid='metrics-dept-department'
            />}
          </div>
          <div className='chiner-metrics-field' data-error-path='ownerId'>
            <label className='chiner-metrics-field-label'>
              <FormatMessage id='metrics.form.owner'/>
            </label>
            <input
              value={form.ownerId}
              onChange={e => updateForm({ownerId: e.target.value})}
              disabled={readOnly}
              placeholder={FormatMessage.string({id: 'metrics.form.owner'})}
              aria-label={FormatMessage.string({id: 'metrics.form.owner'})}
              data-testid='metrics-dept-owner'
            />
          </div>
          <div className='chiner-metrics-field' data-error-path='code'>
            <label className='chiner-metrics-field-label'>
              <FormatMessage id='metrics.department.code'/>
            </label>
            <input
              value={form.code}
              onChange={e => updateForm({code: e.target.value})}
              disabled={readOnly}
              placeholder={FormatMessage.string({id: 'metrics.form.code'})}
              className='chiner-metrics-mono'
              aria-label={FormatMessage.string({id: 'metrics.department.code'})}
              data-testid='metrics-dept-code'
            />
          </div>
          <div className='chiner-metrics-field'>
            <label className='chiner-metrics-field-label'>
              <FormatMessage id='metrics.department.name'/>
            </label>
            <input
              value={form.name}
              onChange={e => updateForm({name: e.target.value})}
              disabled={readOnly}
              placeholder={FormatMessage.string({id: 'metrics.department.namePlaceholder'})}
              aria-label={FormatMessage.string({id: 'metrics.department.name'})}
              data-testid='metrics-dept-name'
            />
          </div>
          <div className='chiner-metrics-field chiner-metrics-field-span'>
            <label className='chiner-metrics-field-label'>
              <FormatMessage id='metrics.department.forkNote'/>
            </label>
            <input
              value={form.forkNote}
              onChange={e => updateForm({forkNote: e.target.value})}
              disabled={readOnly}
              placeholder={FormatMessage.string({id: 'metrics.department.forkNotePlaceholder'})}
              aria-label={FormatMessage.string({id: 'metrics.department.forkNote'})}
              data-testid='metrics-dept-forknote'
            />
          </div>
          {baselineKind !== 'compound' && selectedBaseline && <label
            className='chiner-metrics-check chiner-metrics-field-span'
            data-testid='metrics-dept-fork-check'
          >
            <input
              type='checkbox'
              checked={form.fork}
              onChange={e => updateForm({fork: e.target.checked})}
              disabled={readOnly}
              data-testid='metrics-dept-fork-input'
            />
            <span>
              <FormatMessage id='metrics.department.forkFlag'/>
              <span className='chiner-metrics-field-hint'>
                <FormatMessage id='metrics.department.forkFlagHint'/>
              </span>
            </span>
          </label>}
        </div>

        {selectedBaseline && <div className='chiner-metrics-field chiner-metrics-dept-patch'>
          <h3 className='chiner-metrics-form-title'>
            <FormatMessage id='metrics.department.patchTitle'/>
            {renderKindBadge(baselineKind)}
          </h3>
          <p className='chiner-metrics-muted'>
            <FormatMessage id={baselineKind === 'derived' ? 'metrics.department.patchDerived'
              : (baselineKind === 'atomic' ? 'metrics.department.patchAtomic'
                : 'metrics.department.patchCompound')}/>
          </p>
          {baselineKind === 'derived' && <>
            {renderPatchRows({
              rows: form.addRows,
              dimensionChoices: (selectedBaseline.spec.outputGrain || []),
              dimensionByCode: dictOptions.dimensionByCode,
              onChange: rows => updateForm({addRows: rows}),
              disabled: readOnly,
            })}
            <div className='chiner-metrics-checks' data-testid='metrics-dept-restrict'>
              <span className='chiner-metrics-field-label'>
                <FormatMessage id='metrics.department.restrictDimensions'/>
              </span>
              {(selectedBaseline.spec.outputGrain || []).map(dim => <label
                key={dim}
                className='chiner-metrics-check'
              >
                <input
                  type='checkbox'
                  checked={form.restrictDimensions.indexOf(dim) >= 0}
                  onChange={e => updateForm({restrictDimensions: e.target.checked
                    ? form.restrictDimensions.concat([dim])
                    : form.restrictDimensions.filter(d => d !== dim)})}
                  disabled={readOnly}
                  data-testid={`metrics-dept-restrict-${dim}`}
                />
                <code className='chiner-metrics-mono'>{dim}</code>
              </label>)}
            </div>
          </>}
          {baselineKind === 'atomic' && renderPatchRows({
            rows: form.addRows,
            dimensionChoices: (selectedBaseline.spec.dimensions || [])
              .map(dimension => dimension.dimensionId),
            dimensionByCode: dictOptions.dimensionByCode,
            onChange: rows => updateForm({addRows: rows}),
            disabled: readOnly,
          })}
          {baselineKind === 'compound' && <p className='chiner-metrics-muted'>
            <FormatMessage id='metrics.department.semanticNote'/>
          </p>}
        </div>}

        {preview && preview.ok && preview.rows.length > 0 && <div
          className='chiner-metrics-side-card' data-testid='metrics-dept-preview'>
          <h3><FormatMessage id='metrics.department.previewTitle'/></h3>
          <table className='chiner-metrics-table chiner-metrics-diff-table'>
            <thead>
              <tr>
                <th><FormatMessage id='metrics.department.diffRow'/></th>
                <th><FormatMessage id='metrics.department.diffPublic'/></th>
                <th><FormatMessage id='metrics.department.diffDept'/></th>
                <th/>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map(row => <tr key={row.path} data-testid='metrics-dept-preview-row'>
                <td>
                  <span className='chiner-metrics-diff-field'>{diffRowLabel(row.path)}</span>
                  {renderDiffTech(row)}
                </td>
                <td>{renderDiffCell(source, row.path, row.publicValue)}</td>
                <td>{renderDiffCell(source, row.path, row.departmentValue)}</td>
                <td>{renderMarkTag(row.mark)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}

        {commandErrors.length > 0 && <div className='chiner-metrics-field-errors'>
          {renderErrorList({errors: commandErrors, testId: 'metrics-dept-errors'})}
        </div>}

        <div className='chiner-metrics-form-buttons'>
          <button
            type='button'
            className='chiner-metrics-btn chiner-metrics-btn-primary'
            data-testid='metrics-dept-submit'
            disabled={readOnly || !selectedBaseline}
            onClick={submitCreate}
          >
            <FormatMessage id='metrics.department.submit'/>
          </button>
          <button
            type='button'
            className='chiner-metrics-btn'
            data-testid='metrics-dept-cancel'
            onClick={() => switchView('list')}
          >
            <FormatMessage id='metrics.department.cancel'/>
          </button>
        </div>
      </div>
    </section>;
  }

  if (view && view.mode === 'detail' && detail != null) {
    const definition = detail.definition;
    const rows = detailBaselineRevision != null
      ? diffSpecRows(detailBaselineRevision.spec, detailRevision.spec) : [];
    return <section className='chiner-metrics-page' data-testid='metrics-department-page'>
      <header className='chiner-metrics-page-header'>
        <div>
          <h2 data-testid='metrics-dept-detail-title'>
            {definition.name} <code className='chiner-metrics-mono'>{definition.code}</code>
          </h2>
          <p className='chiner-metrics-page-sub chiner-metrics-inline'>
            {renderKindBadge(definition.kind)}
            {renderScopeBadge(definition.scope)}
            {detailRevision.version
              ? <span className='chiner-metrics-tag'>v{detailRevision.version}</span> : null}
            {renderStatusBadge(detailRevision.status)}
            {detailBaselineRevision != null && baselineByRevisionId[detailBaselineRevision.id]
              ? <span className='chiner-metrics-tag chiner-metrics-tag-public'>
                <FormatMessage id='metrics.department.baselineLocked'/> · v{detailBaselineRevision.version}
              </span> : null}
          </p>
        </div>
        <div className='chiner-metrics-inline'>
          {detail.draft && <button
            type='button'
            className='chiner-metrics-btn chiner-metrics-btn-primary'
            data-testid='metrics-dept-open-draft'
            onClick={() => onOpenDefinition && onOpenDefinition(definition.id)}
          >
            <FormatMessage id='metrics.department.openDraft'/>
          </button>}
          {detail.latestPublished && <button
            type='button'
            className='chiner-metrics-btn'
            data-testid='metrics-dept-view-published'
            onClick={() => onOpenDefinition && onOpenDefinition(definition.id)}
          >
            <FormatMessage id={detail.draft
              ? 'metrics.department.viewPublished' : 'metrics.department.revise'}/>
          </button>}
          <button
            type='button'
            className='chiner-metrics-btn'
            data-testid='metrics-dept-back'
            onClick={() => switchView('list')}
          >
            <FormatMessage id='metrics.department.backList'/>
          </button>
        </div>
      </header>

      <div className='chiner-metrics-dept-layout'>
        <div className='chiner-metrics-form-card' data-testid='metrics-dept-detail'>
          <h3 className='chiner-metrics-form-title'>
            <FormatMessage id='metrics.department.detailTitle'/>
          </h3>
          {detailBaselineRevision == null ? <p className='chiner-metrics-muted'>
            <FormatMessage id='metrics.department.noBaseline'/>
          </p> : <div className='chiner-metrics-table-wrap'>
            <table className='chiner-metrics-table chiner-metrics-diff-table'
              data-testid='metrics-dept-diff-table'>
              <thead>
                <tr>
                  <th><FormatMessage id='metrics.department.diffRow'/></th>
                  <th>
                    <FormatMessage id='metrics.department.diffPublic'/>
                    {detailBaselineRevision.version
                      ? ` v${detailBaselineRevision.version}` : ''}
                  </th>
                  <th>
                    <FormatMessage id='metrics.department.diffDept'/>
                    {detailRevision.version ? ` v${detailRevision.version}` : ''}
                  </th>
                  <th/>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => <tr
                  key={row.path}
                  data-testid='metrics-dept-diff-row'
                  data-diff-mark={row.mark}
                >
                  <td>
                    <span className='chiner-metrics-diff-field'>{diffRowLabel(row.path)}</span>
                    {renderDiffTech(row)}
                  </td>
                  <td>{renderDiffCell(source, row.path, row.publicValue)}</td>
                  <td>{renderDiffCell(source, row.path, row.departmentValue)}</td>
                  <td>{renderMarkTag(row.mark)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
        </div>

        <div className='chiner-metrics-side-column'>
          <div className='chiner-metrics-side-card' data-testid='metrics-dept-upgrade-panel'>
            <h3><FormatMessage id='metrics.department.upgradeTitle'/></h3>
            {upgrade == null ? <p className='chiner-metrics-muted'>
              <FormatMessage id='metrics.department.upgradeNone'/>
            </p> : <>
              <p className='chiner-metrics-muted'>
                <FormatMessage id='metrics.department.upgradeAvailable'/>
              </p>
              <h4><FormatMessage id='metrics.department.threeWay'/></h4>
              <div data-testid='metrics-dept-three-way'>
                <p className='chiner-metrics-muted'>
                  <FormatMessage id='metrics.department.publicChanges'/>
                </p>
                <ul className='chiner-metrics-deplist' data-testid='metrics-dept-public-changes'>
                  {(upgrade.compare.publicChanges || []).map(change => <li key={change.path}>
                    <span className='chiner-metrics-diff-field'>{diffRowLabel(change.path)}</span>
                    <span>
                      {renderDiffCell(source, change.path, change.left)}
                      {' → '}
                      {renderDiffCell(source, change.path, change.right)}
                    </span>
                  </li>)}
                </ul>
                <p className='chiner-metrics-muted'>
                  <FormatMessage id='metrics.department.deptDelta'/>
                </p>
                <ul className='chiner-metrics-deplist' data-testid='metrics-dept-dept-delta'>
                  {(upgrade.compare.departmentDelta || []).map(change => <li key={change.path}>
                    <span className='chiner-metrics-diff-field'>{diffRowLabel(change.path)}</span>
                    <span>
                      {renderDiffCell(source, change.path, change.left)}
                      {' → '}
                      {renderDiffCell(source, change.path, change.right)}
                    </span>
                  </li>)}
                </ul>
                {(upgrade.compare.semanticChanges || []).length > 0 && <p
                  className='chiner-metrics-zero-note' data-testid='metrics-dept-semantic-warning'
                  role='status'>
                  <FormatMessage id='metrics.department.upgradeSemantic' data={
                    {paths: upgrade.compare.semanticChanges.map(c => diffRowLabel(c.path)).join('、')}}/>
                </p>}
                {(upgrade.compare.replayConflicts || []).length > 0 && <p
                  className='chiner-metrics-zero-note' data-testid='metrics-dept-replay-conflicts'>
                  <FormatMessage id='metrics.department.upgradeConflict'/>
                </p>}
              </div>
              <div className='chiner-metrics-inline'>
                <button
                  type='button'
                  className='chiner-metrics-btn'
                  data-testid='metrics-dept-keep-old'
                  disabled={readOnly}
                  onClick={() => Message.success({
                    title: FormatMessage.string({id: 'metrics.department.keepDone'})})
                  }
                >
                  <FormatMessage id='metrics.department.upgradeKeep'/>
                </button>
                <button
                  type='button'
                  className='chiner-metrics-btn chiner-metrics-btn-primary'
                  data-testid='metrics-dept-upgrade-submit'
                  disabled={readOnly
                    || (upgrade.compare.semanticChanges || []).length > 0
                    || (upgrade.compare.replayConflicts || []).length > 0}
                  onClick={doUpgrade}
                >
                  <FormatMessage id='metrics.department.upgradeDo'/>
                </button>
                {(upgrade.compare.semanticChanges || []).length > 0 && <button
                  type='button'
                  className='chiner-metrics-btn'
                  data-testid='metrics-dept-fork-entry'
                  disabled={readOnly}
                  onClick={forkFromCandidate}
                >
                  <FormatMessage id='metrics.department.upgradeForkEntry'/>
                </button>}
              </div>
              <p className='chiner-metrics-field-hint'>
                <FormatMessage id='metrics.department.upgradeKeepNote'/>
              </p>
            </>}
          </div>

          <div className='chiner-metrics-side-card' data-testid='metrics-dept-timeline'>
            <h3><FormatMessage id='metrics.department.timelineTitle'/></h3>
            <ul className='chiner-metrics-timeline'>
              {detailBaselineRevision != null && <li>
                <FormatMessage id='metrics.department.timelineBaseline' data={
                  {version: detailBaselineRevision.version || '—'}}/>
              </li>}
              {(detail.revisions || []).slice().reverse().map(revision => <li key={revision.id}>
                <FormatMessage id='metrics.department.timelineDept' data={{
                  version: revision.version
                    || FormatMessage.string({id: 'metrics.versions.unpublished'}),
                  summary: STATUS_KEYS[revision.status]
                    ? FormatMessage.string({id: STATUS_KEYS[revision.status]}) : revision.status,
                }}/>
                {revision.forkNote ? <p className='chiner-metrics-field-hint'>
                  <FormatMessage id='metrics.department.forkNoteLabel'/>：{revision.forkNote}
                </p> : null}
                {revision.upgradedFromRevisionId ? <p className='chiner-metrics-field-hint'>
                  <FormatMessage id='metrics.department.timelineUpgrade'/>
                </p> : null}
              </li>)}
            </ul>
            <p className='chiner-metrics-field-hint'>
              <FormatMessage id='metrics.department.semanticNote'/>
            </p>
          </div>
        </div>
      </div>
    </section>;
  }

  // ---- 清单视图 ----
  return <section className='chiner-metrics-page' data-testid='metrics-department-page'>
    <header className='chiner-metrics-page-header'>
      <div>
        <h2 data-testid='metrics-department-title'>
          <FormatMessage id='metrics.department.title'/>
        </h2>
        <p className='chiner-metrics-page-sub'><FormatMessage id='metrics.department.subtitle'/></p>
      </div>
      <button
        type='button'
        className='chiner-metrics-btn chiner-metrics-btn-primary'
        data-testid='metrics-dept-create-entry'
        disabled={readOnly}
        onClick={() => switchView('create')}
      >
        <FormatMessage id='metrics.department.create'/>
      </button>
    </header>
    {upgradeCount > 0 && <p className='chiner-metrics-zero-note' data-testid='metrics-dept-upgrade-count'>
      <FormatMessage id='metrics.department.upgradeAvailable'/>（{upgradeCount}）</p>}
    {entries.length === 0 ? <div className='chiner-metrics-empty' data-testid='metrics-dept-empty'>
      <h3><FormatMessage id='metrics.department.emptyTitle'/></h3>
      <p><FormatMessage id='metrics.department.emptyDesc'/></p>
    </div> : <div className='chiner-metrics-table-wrap'>
      <table className='chiner-metrics-table' data-testid='metrics-dept-table'>
        <thead>
          <tr>
            <th><FormatMessage id='metrics.department.col.definition'/></th>
            <th><FormatMessage id='metrics.department.col.department'/></th>
            <th><FormatMessage id='metrics.department.col.baseline'/></th>
            <th><FormatMessage id='metrics.department.col.version'/></th>
            <th/>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => {
            const definition = entry.definition;
            const rev = entry.latestPublished || entry.draft;
            const baselineRevision = rev != null && rev.baseline != null
              ? metricApi.getMetricRevision(source, rev.baseline.baseRevisionId) : null;
            const baselineDefinition = baselineRevision != null
              ? (store.definitions || []).filter(d => d.id === baselineRevision.definitionId)[0]
              : null;
            return <tr
              key={definition.id}
              data-testid='metrics-dept-row'
              data-definition-id={definition.id}
            >
              <td>
                <strong>{definition.name}</strong>
                <code className='chiner-metrics-mono'>{definition.code}</code>
                {renderKindBadge(definition.kind)}
              </td>
              <td>
                {definition.scope.departmentId} / {definition.ownerId}
              </td>
              <td>
                {baselineDefinition == null ? <span className='chiner-metrics-muted'>
                  <FormatMessage id='metrics.department.noBaseline'/>
                </span> : <span>
                  <code className='chiner-metrics-mono'>{baselineDefinition.code}</code>
                  {baselineRevision.version ? ` @ v${baselineRevision.version}` : ''}
                </span>}
              </td>
              <td>
                {rev ? <span className='chiner-metrics-inline'>
                  {rev.version ? <span className='chiner-metrics-tag'>v{rev.version}</span> : null}
                  {renderStatusBadge(rev.status)}
                  {entry.draft && entry.latestPublished
                    ? <span className='chiner-metrics-tag'>
                      <FormatMessage id='metrics.status.hasDraft'/>
                    </span> : null}
                  {upgradeFlags[definition.id] ? <span
                    className='chiner-metrics-tag chiner-metrics-tag-warn'
                    data-testid='metrics-dept-upgrade-flag'>
                    <FormatMessage id='metrics.department.upgradeTitle'/>
                  </span> : null}
                </span> : '—'}
              </td>
              <td>
                <button
                  type='button'
                  className='chiner-metrics-btn'
                  data-testid='metrics-dept-open'
                  onClick={() => switchView({mode: 'detail', definitionId: definition.id})}
                >
                  <FormatMessage id='metrics.dictionary.refsView'/>
                </button>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>}
  </section>;
};

export default React.memo(DepartmentPage);
