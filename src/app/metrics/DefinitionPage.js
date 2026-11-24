import React, {useMemo, useState, useEffect, useRef} from 'react';
import {FormatMessage, Message, Modal} from 'components';
import {
  metricApi,
  runMetricCommand,
  buildSpecFromForm,
  dictionaryOptions,
  isFormPristine,
  listSourceModels,
  listPublishedRevisionOptions,
  collectKnownDimensionIds,
  qualifierValueToText,
  QUALIFIER_OP_KEYS,
} from './commands';
import {renderErrorList, renderFieldRow, renderKindBadge, renderScopeBadge,
  renderStatusBadge} from './parts';

// 指标平台 M2：三类指标定义编辑器（原子/派生/复合）+ 版本闭环。
// - 全部写入经 M1 领域接口（create/update/validate/publish/createRevisionDraft/deprecate），
//   每次命令基于最新有效 source，成功后一次 updateDataSource；
// - 已发布版本不可编辑（只读视图），修订建新草案；本地确认发布不冒充服务端审核；
// - 校验错误按 M1 path 定位到具体表单控件；切换编辑目标时对未提交表单给出保留/放弃确认。

const KIND_CARDS = [
  {kind: 'atomic', titleKey: 'metrics.kind.atomic', subKey: 'metrics.kind.atomicSub'},
  {kind: 'derived', titleKey: 'metrics.kind.derived', subKey: 'metrics.kind.derivedSub'},
  {kind: 'compound', titleKey: 'metrics.kind.compound', subKey: 'metrics.kind.compoundSub'},
];

const COMMON_TIMEZONES = ['Asia/Shanghai', 'UTC', 'Asia/Tokyo', 'Asia/Hong_Kong',
  'America/New_York', 'Europe/London'];
const AGGREGATIONS = ['SUM', 'COUNT', 'COUNT_DISTINCT', 'MIN', 'MAX', 'AVG'];
const QUALIFIER_OPS = ['eq', 'not_eq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte'];
const ADDABLES = ['additive', 'semi_additive', 'non_additive'];

const emptyForm = (kind) => ({
  kind,
  name: '', code: '', scopeKind: 'public', departmentId: '', ownerId: '',
  conceptId: '', description: '',
  // 语义字典手动模式标记（M3A）：显式选择“手动输入”时为 true；旧值不在字典时按值自动判定
  departmentManual: false, unitManual: false,
  ...(kind === 'atomic' ? {
    aggregation: 'SUM', sourceModelId: '', sourceFieldId: '', unit: '',
    businessDomain: '', businessProcess: '', factGrainDescription: '',
    uniqueKeyFieldIds: [], timeRole: '', timezone: 'Asia/Shanghai',
    baseQualifiers: [], dimensions: [],
  } : {}),
  ...(kind === 'derived' ? {
    atomicRevisionId: '', windowType: 'calendarDays', windowLength: '7',
    windowEnd: 'yesterday', windowTimezone: 'Asia/Shanghai', qualifiers: [], outputGrain: [],
  } : {}),
  ...(kind === 'compound' ? {refs: [], expression: ''} : {}),
});

// 新建表单脏检查：草案尚未创建（无 revision 可比），任一字段非空或偏离默认值即脏
const isCreateFormDirty = (form) => {
  if (form == null) return false;
  const pristine = emptyForm(form.kind);
  return Object.keys(pristine).some(key =>
    JSON.stringify(form[key]) !== JSON.stringify(pristine[key]));
};

const formFromRevision = (revision, definition) => {
  const spec = revision.spec || {};
  const base = {
    kind: spec.kind,
    name: definition.name,
    code: definition.code,
    scopeKind: definition.scope ? definition.scope.kind : 'public',
    departmentId: definition.scope && definition.scope.kind === 'department'
      ? definition.scope.departmentId : '',
    ownerId: definition.ownerId,
    conceptId: definition.conceptId || '',
    description: spec.description || '',
  };
  if (spec.kind === 'atomic') {
    return {
      ...base,
      aggregation: spec.aggregation || 'SUM',
      sourceModelId: spec.source ? (spec.source.modelId || '') : '',
      sourceFieldId: spec.source ? (spec.source.fieldId || '') : '',
      unit: spec.unit || '',
      businessDomain: spec.businessDomain || '',
      businessProcess: spec.businessProcess || '',
      factGrainDescription: (spec.factGrain || {}).description || '',
      uniqueKeyFieldIds: ((spec.factGrain || {}).uniqueKeyFieldIds || []).slice(),
      timeRole: spec.timeRole || '',
      timezone: spec.timezone || '',
      baseQualifiers: (spec.baseQualifiers || []).map(q => ({
        dimensionId: q.dimensionId, op: q.op, value: qualifierValueToText(q.value),
      })),
      dimensions: (spec.dimensions || []).map(d => ({
        dimensionId: d.dimensionId, addable: d.addable || 'additive',
      })),
    };
  }
  if (spec.kind === 'derived') {
    return {
      ...base,
      atomicRevisionId: spec.atomicRevisionId || '',
      windowType: (spec.window || {}).type || 'calendarDays',
      windowLength: String((spec.window || {}).length == null ? '' : (spec.window || {}).length),
      windowEnd: (spec.window || {}).end || 'yesterday',
      windowTimezone: (spec.window || {}).timezone || '',
      qualifiers: (spec.qualifiers || []).map(q => ({
        dimensionId: q.dimensionId, op: q.op, value: qualifierValueToText(q.value),
      })),
      outputGrain: (spec.outputGrain || []).slice(),
    };
  }
  return {
    ...base,
    refs: (spec.refs || []).map(r => ({key: r.key, revisionId: r.revisionId})),
    expression: spec.expression || '',
  };
};

// 字典选择控件的“手动输入”哨兵值（M3A）：选择后显示自由输入，保留设计态/旧值能力
const MANUAL_OPTION = '__manual__';

// 表单限定行（纯渲染函数）：原子=维度自由标识+字典候选；派生=维度须来自原子声明。
// 命中字典维度时按声明值类型切换值控件（布尔=选择，数值/字符串=文本严格解析）。
const renderQualifierRows = ({listName, list, dimensionOptions, freeDimensions,
  dimensionByCode, presets, onPresetSelect, onChange, disabled}) => {
  const update = (index, patch) => {
    onChange(list.map((row, i) => (i === index ? {...row, ...patch} : row)));
  };
  const listId = `chiner-metrics-dim-${listName}`;
  return <div className='chiner-metrics-rows' data-testid={`metrics-${listName}`}>
    {presets != null && presets.length > 0 && <select
      value=''
      onChange={(e) => {
        if (e.target.value !== '') onPresetSelect(e.target.value);
      }}
      disabled={disabled}
      aria-label={FormatMessage.string({id: 'metrics.form.presetPlaceholder'})}
      data-testid={`metrics-${listName}-preset`}
    >
      <option value=''>{FormatMessage.string({id: 'metrics.form.presetPlaceholder'})}</option>
      {presets.map(preset => <option key={preset.id} value={preset.id}>
        {preset.name}（{preset.code}）
      </option>)}
    </select>}
    {list.map((row, index) => {
      const dim = dimensionByCode ? dimensionByCode[row.dimensionId] : null;
      const isBooleanDim = dim != null && dim.valueType === 'boolean'
        && row.op !== 'in' && row.op !== 'not_in';
      const valuePlaceholder = dim == null
        ? (row.op === 'in' || row.op === 'not_in'
          ? FormatMessage.string({id: 'metrics.form.valueMultiPlaceholder'})
          : FormatMessage.string({id: 'metrics.form.valuePlaceholder'}))
        : (dim.valueType === 'number'
          ? FormatMessage.string({id: 'metrics.form.valueNumberPlaceholder'})
          : (row.op === 'in' || row.op === 'not_in'
            ? FormatMessage.string({id: 'metrics.form.valueMultiPlaceholder'})
            : FormatMessage.string({id: 'metrics.form.valueStringPlaceholder'})));
      return <div
        key={index}
        className='chiner-metrics-row3'
        data-error-path={`spec.${listName}[${index}].dimensionId`}
      >
        {dimensionOptions ? <select
          value={row.dimensionId}
          onChange={e => update(index, {dimensionId: e.target.value})}
          disabled={disabled}
          aria-label={FormatMessage.string({id: 'metrics.form.dimensionId'})}
        >
          <option value=''>{FormatMessage.string({id: 'metrics.form.selectDimension'})}</option>
          {dimensionOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select> : <>
          <input
            value={row.dimensionId}
            onChange={e => update(index, {dimensionId: e.target.value})}
            disabled={disabled}
            list={listId}
            placeholder='dim-channel'
            aria-label={FormatMessage.string({id: 'metrics.form.dimensionId'})}
          />
          <datalist id={listId}>
            {(freeDimensions || []).map(d => <option key={d} value={d}/>)}
          </datalist>
        </>}
        <select
          value={row.op}
          onChange={e => update(index, {op: e.target.value})}
          disabled={disabled}
          aria-label={FormatMessage.string({id: 'metrics.form.op'})}
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
        >
          <option value=''>{FormatMessage.string({id: 'metrics.form.selectValue'})}</option>
          <option value='true'>true</option>
          <option value='false'>false</option>
        </select> : <input
          value={row.value}
          onChange={e => update(index, {value: e.target.value})}
          disabled={disabled}
          placeholder={valuePlaceholder}
          aria-label={FormatMessage.string({id: 'metrics.form.value'})}
          title={dim != null
            ? `${FormatMessage.string({id: 'metrics.form.valueTypeHint'})}: ${dim.valueType}`
            : undefined}
          data-value-type={dim == null ? undefined : dim.valueType}
        />}
        <button
          type='button'
          className='chiner-metrics-iconbtn'
          disabled={disabled}
          onClick={() => onChange(list.filter((r, i) => i !== index))}
          aria-label={FormatMessage.string({id: 'metrics.form.removeRow'})}
          title={FormatMessage.string({id: 'metrics.form.removeRow'})}
        >×</button>
      </div>;
    })}
    <button
      type='button'
      className='chiner-metrics-btn chiner-metrics-btn-ghost'
      disabled={disabled}
      onClick={() => onChange(list.concat([{dimensionId: '', op: 'eq', value: ''}]))}
      data-testid={`metrics-${listName}-add`}
    >
      + <FormatMessage id='metrics.form.addQualifier'/>
    </button>
  </div>;
};

const DefinitionPage = ({source, commandRunner, readOnly, focus, onDirtyChange}) => {
  // editor: null | {phase:'create',kind,form} | {phase:'draft',definitionId,revisionId,baseRev,form}
  //        | {phase:'view',definitionId,revisionId}
  const [editor, setEditor] = useState(null);
  const [validation, setValidation] = useState(null); // {ok, errors, signature}
  const [commandErrors, setCommandErrors] = useState([]);
  const [saveNotice, setSaveNotice] = useState('');
  const containerRef = useRef(null);
  const expressionRef = useRef(null);
  const dirtyRef = useRef(false);

  const latestSource = () => (commandRunner && commandRunner.getSource
    ? commandRunner.getSource() : source);

  const concepts = useMemo(() => metricApi.readMetricPlatform(source).concepts || [], [source]);
  const sourceModels = useMemo(() => listSourceModels(source), [source]);
  const knownDimensions = useMemo(() => collectKnownDimensionIds(source), [source]);
  // 语义字典（M3A）：编辑器实际选择与类型化解析依据；无字典时全部回落旧行为
  const dictOptions = useMemo(() => dictionaryOptions(source), [source]);
  const dimensionChoices = useMemo(() => {
    const merged = [];
    (dictOptions.dimensions || []).forEach((dim) => {
      if (merged.indexOf(dim.code) < 0) merged.push(dim.code);
    });
    knownDimensions.forEach((dim) => {
      if (merged.indexOf(dim) < 0) merged.push(dim);
    });
    return merged;
  }, [dictOptions, knownDimensions]);

  const editorDefinition = useMemo(() => {
    if (!editor || editor.phase === 'create') return null;
    return metricApi.getMetricDefinition(source, editor.definitionId);
  }, [source, editor]);
  const editorRevision = useMemo(() => {
    if (!editor || editor.phase === 'create') return null;
    return metricApi.getMetricRevision(source, editor.revisionId);
  }, [source, editor]);

  // create 阶段草案尚不存在：以真实表单状态对照空表单判定脏（不依赖 revision）；
  // draft 阶段与已加载草案逐一比较。
  const dirty = !!(editor && editor.phase !== 'view' && (
    editor.phase === 'create'
      ? isCreateFormDirty(editor.form)
      : editorDefinition && editorRevision
        && !isFormPristine(editor.form, editorRevision, editorDefinition.definition, dictOptions)));
  dirtyRef.current = dirty;
  useEffect(() => {
    onDirtyChange && onDirtyChange(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // 复合表达式实时解析/单位推导（受限文法，绝不 eval；仅 compound 表单计算）
  const expressionState = useMemo(() => {
    if (!editor || editor.phase === 'view' || editor.form.kind !== 'compound') return null;
    const form = editor.form;
    if (!form.expression) return {empty: true};
    const operandUnits = {};
    (form.refs || []).forEach((ref) => {
      const hit = listPublishedRevisionOptions(source)
        .filter(o => o.kind !== 'atomic' && o.revisionId === ref.revisionId)[0];
      if (hit && hit.unit != null) operandUnits[ref.key] = hit.unit;
    });
    try {
      const ast = metricApi.parseExpression(form.expression, 'spec.expression');
      let unit = null;
      let unitError = null;
      try {
        unit = metricApi.deriveAstUnit(ast, key => operandUnits[key], 'spec.expression').unit;
      } catch (unitErr) {
        unitError = unitErr;
      }
      return {
        ast, unit, unitError, text: metricApi.astToText(ast),
        division: metricApi.astContainsDivision(ast),
      };
    } catch (parseError) {
      return {parseError};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor && editor.phase !== 'view' ? editor.form.expression : null,
    editor && editor.phase !== 'view' ? editor.form.refs : null, source]);

  // 打开/切换编辑目标：未提交表单先给出保留/放弃确认（已保存草案不受影响）
  const loadTarget = (target) => {
    const apply = () => {
      setValidation(null);
      setCommandErrors([]);
      setSaveNotice('');
      if (target == null) {
        setEditor(null);
        return;
      }
      if (target.mode === 'create') {
        // M4B 从模型字段发起原子草案：预填真实模型来源（collection==='entities' 的
        // modelId/fieldId），业务语义（过程/粒度/时间/单位/限定）仍需人工补齐，
        // 发布校验由 M1 如实执行——预填本身不构成可计算指标
        const kind = target.kind || 'atomic';
        const form = emptyForm(kind);
        const prefill = target.prefill;
        if (prefill && kind === 'atomic' && prefill.collection === 'entities'
          && prefill.objectId) {
          form.sourceModelId = prefill.objectId;
          form.sourceFieldId = prefill.fieldId || '';
        }
        setEditor({phase: 'create', kind,
          form, prefill: prefill || null});
        return;
      }
      const detail = metricApi.getMetricDefinition(latestSource(), target.definitionId);
      if (detail == null) {
        setEditor(null);
        return;
      }
      if (target.revisionId) {
        const revision = (detail.revisions || []).filter(r => r.id === target.revisionId)[0];
        if (revision && revision.status === 'draft') {
          setEditor({phase: 'draft', definitionId: target.definitionId,
            revisionId: revision.id, baseRev: revision.rev,
            form: formFromRevision(revision, detail.definition)});
          return;
        }
        if (revision) {
          setEditor({phase: 'view', definitionId: target.definitionId, revisionId: revision.id});
          return;
        }
      }
      if (detail.draft) {
        setEditor({phase: 'draft', definitionId: target.definitionId,
          revisionId: detail.draft.id, baseRev: detail.draft.rev,
          form: formFromRevision(detail.draft, detail.definition)});
      } else if (detail.latestPublished) {
        setEditor({phase: 'view', definitionId: target.definitionId,
          revisionId: detail.latestPublished.id});
      } else {
        setEditor(null);
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

  useEffect(() => {
    if (!focus || !focus.nonce) return;
    loadTarget(focus.definitionId == null
      ? {mode: 'create', kind: focus.kind, prefill: focus.prefill} : focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus && focus.nonce]);

  // ---- 命令 ----
  const runCommand = (run, afterOk) => {
    setCommandErrors([]);
    setSaveNotice('');
    const result = runMetricCommand(commandRunner, run);
    if (result && result.ok) {
      afterOk && afterOk(result);
    } else {
      setCommandErrors((result && result.errors) || []);
    }
    return result;
  };

  // 表单 → spec：限定值先按字典维度类型预检，失败直接渲染结构化错误、不触发写命令
  const createDraft = () => {
    const form = editor.form;
    const scope = form.scopeKind === 'department'
      ? {kind: 'department', departmentId: form.departmentId.trim()} : {kind: 'public'};
    runCommand(latest => {
      const build = buildSpecFromForm(form, dictionaryOptions(latest));
      if (!build.ok) return build;
      return metricApi.createMetricDraft(latest, {
        code: form.code.trim(),
        name: form.name.trim(),
        scope,
        ownerId: form.ownerId.trim(),
        ...(form.conceptId ? {conceptId: form.conceptId} : {}),
        spec: build.spec,
      });
    }, (result) => {
      setEditor({phase: 'draft', definitionId: result.definition.id,
        revisionId: result.revision.id, baseRev: result.revision.rev, form});
      setSaveNotice('metrics.notice.draftSaved');
    });
  };

  const saveDraft = () => {
    const form = editor.form;
    runCommand(latest => {
      const build = buildSpecFromForm(form, dictionaryOptions(latest));
      if (!build.ok) return build;
      return metricApi.updateMetricDraft(latest, editor.revisionId, {
        name: form.name.trim(),
        ownerId: form.ownerId.trim(),
        conceptId: form.conceptId || null,
        spec: build.spec,
      }, {expectedRevision: editor.baseRev});
    }, (result) => {
      setEditor(pre => ({...pre, baseRev: result.revision.rev, form}));
      setValidation(null);
      setSaveNotice('metrics.notice.draftSaved');
    });
  };

  // 校验/发布只针对已存储草案：表单脏时禁用（按钮+handler 双守卫），避免校验/发布旧 revision
  const validateDraft = () => {
    if (dirtyRef.current) {
      setSaveNotice('metrics.editor.saveFirst');
      return;
    }
    setCommandErrors([]);
    const result = metricApi.validateMetricDraft(latestSource(), editor.revisionId,
      {expectedRevision: editor.baseRev});
    setValidation({ok: result.ok, errors: result.errors || [], signature: result.signature});
  };

  const publishDraft = () => {
    if (dirtyRef.current) {
      setSaveNotice('metrics.editor.saveFirst');
      return;
    }
    Modal.confirm({
      title: FormatMessage.string({id: 'metrics.publish.title'}),
      message: FormatMessage.string({id: 'metrics.publish.message'}),
      onOk: () => {
        runCommand(latest => metricApi.publishMetricRevision(latest, editor.revisionId,
          {expectedRevision: editor.baseRev}), () => {
          setEditor({phase: 'view', definitionId: editor.definitionId,
            revisionId: editor.revisionId});
          setValidation(null);
          Message.success({title: FormatMessage.string({id: 'metrics.notice.published'})});
        });
      },
    });
  };

  const reviseDraft = () => {
    runCommand(latest => metricApi.createRevisionDraft(latest, editor.definitionId,
      {baseRevisionId: editor.revisionId}), (result) => {
      const detail = metricApi.getMetricDefinition(result.source, editor.definitionId);
      setEditor({phase: 'draft', definitionId: editor.definitionId,
        revisionId: result.revision.id, baseRev: result.revision.rev,
        form: formFromRevision(result.revision, detail.definition)});
      setValidation(null);
    });
  };

  // 丢弃草案（MET-14）：从未发布的定义连同定义删除（释放 code），已发布过的只删草案；
  // 用加载时的草案 id + rev 做并发前置校验（防误删后建的同号草案），冲突时由既有冲突提示引导重载
  const discardDraft = () => {
    const detail = metricApi.getMetricDefinition(latestSource(), editor.definitionId);
    const everPublished = !!detail
      && (detail.revisions || []).some(r => r.status !== 'draft');
    // 丢弃会级联移除指向该草案（从未发布时为该定义）的关联：确认前如实告知条数
    const removedBindings = metricApi.countDiscardDraftBindings(latestSource(), editor.definitionId);
    const discardMessage = FormatMessage.string(everPublished
      ? {id: 'metrics.discard.messagePublished'}
      : {id: 'metrics.discard.messageNew',
        data: {code: detail ? detail.definition.code : ''}});
    Modal.confirm({
      title: FormatMessage.string({id: 'metrics.discard.title'}),
      message: removedBindings > 0 ? <div data-testid='metrics-discard-confirm'>
        <p>{discardMessage}</p>
        <p data-testid='metrics-discard-bindings'>{FormatMessage.string({id: 'metrics.discard.bindingsRemoved',
          data: {count: removedBindings}})}</p>
      </div> : discardMessage,
      onOk: () => {
        runCommand(latest => metricApi.discardMetricDraft(latest, editor.definitionId,
          {expectedRevision: editor.baseRev, expectedRevisionId: editor.revisionId}), (result) => {
          const after = metricApi.getMetricDefinition(result.source, editor.definitionId);
          const remain = after == null ? null
            : (after.latestPublished
              || (after.revisions || []).filter(r => r.status === 'deprecated')[0]);
          setEditor(remain
            ? {phase: 'view', definitionId: editor.definitionId, revisionId: remain.id}
            : null);
          setValidation(null);
          Message.success({title: FormatMessage.string({id: 'metrics.notice.draftDiscarded'})});
        });
      },
    });
  };

  const deprecateDefinition = () => {
    Modal.confirm({
      title: FormatMessage.string({id: 'metrics.deprecate.title'}),
      message: FormatMessage.string({id: 'metrics.deprecate.message'}),
      onOk: () => {
        runCommand(latest => metricApi.deprecateMetricDefinition(latest, editor.definitionId),
          (result) => {
            const detail = metricApi.getMetricDefinition(result.source, editor.definitionId);
            const remain = (detail.revisions || []).filter(r => r.status === 'published')[0]
              || (detail.revisions || []).filter(r => r.status === 'deprecated')[0];
            setEditor(remain
              ? {phase: 'view', definitionId: editor.definitionId, revisionId: remain.id}
              : null);
          });
      },
    });
  };

  const onLocateError = (path) => {
    if (!containerRef.current || !path) return null;
    const query = (p) => containerRef.current
      .querySelector(`[data-error-path="${p}"]`);
    const direct = query(path);
    if (direct) return direct;
    // M1 行级错误 path（如 spec.baseQualifiers[0]）回落到字段区块锚点
    const parent = String(path).replace(/\.[^.]+$/, '');
    return parent !== path ? query(parent) : null;
  };

  const insertExpression = (text) => {
    const form = editor.form;
    const input = expressionRef.current;
    if (!input || input.selectionStart == null) {
      updateForm({expression: form.expression + text});
      return;
    }
    const start = input.selectionStart;
    const end = input.selectionEnd || start;
    updateForm({expression: form.expression.slice(0, start) + text + form.expression.slice(end)});
  };

  const updateForm = (patch) => {
    setEditor(pre => (pre && pre.phase !== 'view' ? {...pre, form: {...pre.form, ...patch}} : pre));
    // 任何表单改动使过期校验结果/签名失效（旧结果不再适用于当前输入）
    setValidation(null);
  };

  // 字典业务限定预设 → 追加一行限定（值按维度类型以文本回显，保存时严格类型化解析）
  const addQualifierPreset = (listName, presetId) => {
    const preset = (dictOptions.qualifiers || []).filter(p => p.id === presetId)[0];
    if (preset == null || !editor || editor.phase === 'view') return;
    const row = {
      dimensionId: preset.dimensionId,
      op: preset.op,
      value: qualifierValueToText(preset.value),
    };
    updateForm({[listName]: (editor.form[listName] || []).concat([row])});
  };

  const formProps = {form: editor ? editor.form : null};

  // ---- 选择视图（无编辑目标）：三类型卡 + 可继续的草案 + 已发布定义 ----
  if (!editor) {
    const entries = metricApi.listMetricDefinitions(source);
    const draftEntries = entries.filter(e => e.draft);
    const publishedEntries = entries.filter(e => e.latestPublished);
    return <section className='chiner-metrics-page' ref={containerRef} data-testid='metrics-definition-page'>
      <header className='chiner-metrics-page-header'>
        <div>
          <h2 data-testid='metrics-definition-title'><FormatMessage id='metrics.definition.title'/></h2>
          <p className='chiner-metrics-page-sub'><FormatMessage id='metrics.definition.subtitle'/></p>
        </div>
      </header>
      <div className='chiner-metrics-kindcards'>
        {KIND_CARDS.map(card => <button
          key={card.kind}
          type='button'
          className='chiner-metrics-kindcard'
          data-testid={`metrics-new-${card.kind}`}
          disabled={readOnly}
          onClick={() => loadTarget({mode: 'create', kind: card.kind})}
        >
          <strong><FormatMessage id={card.titleKey}/></strong>
          <span><FormatMessage id={card.subKey}/></span>
        </button>)}
      </div>
      {entries.length === 0 && <div className='chiner-metrics-empty'>
        <h3><FormatMessage id='metrics.definition.emptyTitle'/></h3>
        <p><FormatMessage id='metrics.definition.emptyDesc'/></p>
      </div>}
      {draftEntries.length > 0 && <>
        <h3 className='chiner-metrics-group-title'><FormatMessage id='metrics.definition.continueDrafts'/></h3>
        <div className='chiner-metrics-chiplist'>
          {draftEntries.map(({definition, draft}) => <button
            key={definition.id}
            type='button'
            className='chiner-metrics-chip'
            data-testid='metrics-continue-draft'
            onClick={() => loadTarget({definitionId: definition.id, revisionId: draft.id})}
          >
            <span>{definition.name}</span>
            <code>{definition.code}</code>
            {renderKindBadge(definition.kind)}
            {renderStatusBadge('draft')}
          </button>)}
        </div>
      </>}
      {publishedEntries.length > 0 && <>
        <h3 className='chiner-metrics-group-title'><FormatMessage id='metrics.definition.publishedList'/></h3>
        <div className='chiner-metrics-chiplist'>
          {publishedEntries.map(({definition, latestPublished}) => <button
            key={definition.id}
            type='button'
            className='chiner-metrics-chip'
            data-testid='metrics-view-published'
            onClick={() => loadTarget({definitionId: definition.id, revisionId: latestPublished.id})}
          >
            <span>{definition.name}</span>
            <code>{definition.code}</code>
            {renderKindBadge(definition.kind)}
            <span className='chiner-metrics-tag'>v{latestPublished.version}</span>
          </button>)}
        </div>
      </>}
    </section>;
  }

  // ---- 创建/编辑表单 ----
  if (editor.phase === 'create' || editor.phase === 'draft') {
    const form = editor.form;
    const isCreate = editor.phase === 'create';
    const kind = form.kind;
    const selectedModel = form.sourceModelId
      ? sourceModels.filter(m => m.id === form.sourceModelId)[0] : null;
    // 派生：所选原子修订的声明维度（限定/输出粒度必须来自其中）
    const atomicOptions = listPublishedRevisionOptions(source, 'atomic');
    const selectedAtomic = kind === 'derived'
      ? atomicOptions.filter(o => o.revisionId === form.atomicRevisionId)[0] : null;
    const atomicDimensionIds = selectedAtomic ? selectedAtomic.dimensions : [];
    // 复合：已发布派生/复合选项（表达式解析状态见顶层 expressionState）
    const operandOptions = kind === 'compound'
      ? listPublishedRevisionOptions(source).filter(o => o.kind !== 'atomic') : [];

    return <section className='chiner-metrics-page' ref={containerRef} data-testid='metrics-editor-page'>
      <header className='chiner-metrics-page-header'>
        <div>
          <h2>
            <FormatMessage id={isCreate ? 'metrics.editor.newTitle' : 'metrics.editor.editTitle'}/>
            {renderKindBadge(kind)}
            {!isCreate && editorRevision ? <span className='chiner-metrics-tag chiner-metrics-tag-draft'>
              <FormatMessage id='metrics.status.draft'/> · rev {editor.baseRev}
            </span> : null}
          </h2>
          <p className='chiner-metrics-page-sub'><FormatMessage id='metrics.editor.subtitle'/></p>
        </div>
        {!isCreate && <button
          type='button'
          className='chiner-metrics-btn'
          onClick={() => loadTarget(null)}
          data-testid='metrics-close-editor'
        >
          <FormatMessage id='metrics.editor.backList'/>
        </button>}
      </header>

      {isCreate && editor.prefill && <div
        className='chiner-metrics-binding-banner'
        role='status'
        data-testid='metrics-prefill-note'>
        <FormatMessage id='metrics.form.prefillNote'/>
      </div>}

      <div className='chiner-metrics-editor-layout'>
        <div className='chiner-metrics-form-card'>
          <h3 className='chiner-metrics-form-title'>
            <FormatMessage id={`metrics.kind.${kind}`}/>
            <span className='chiner-metrics-tag'><FormatMessage id='metrics.editor.versionedRefs'/></span>
          </h3>
          <div className='chiner-metrics-form-grid'>
            {renderFieldRow({labelKey: 'metrics.form.name', errorPath: 'name', children:
              <input
                value={form.name}
                onChange={e => updateForm({name: e.target.value})}
                disabled={readOnly}
                data-testid='metrics-form-name'
              />})}
            {renderFieldRow({labelKey: 'metrics.form.code', errorPath: 'code',
              hint: isCreate ? 'metrics.form.codeHint' : null, children:
              <input
                value={form.code}
                onChange={e => updateForm({code: e.target.value})}
                disabled={readOnly || !isCreate}
                className='chiner-metrics-mono'
                data-testid='metrics-form-code'
              />})}
            {renderFieldRow({labelKey: 'metrics.form.scope', errorPath: 'scope',
              hint: isCreate ? 'metrics.form.scopeHint' : null, children:
              isCreate ? <div className='chiner-metrics-inline'>
                <select
                  value={form.scopeKind}
                  onChange={e => updateForm({scopeKind: e.target.value})}
                  disabled={readOnly}
                  data-testid='metrics-form-scope'
                >
                  <option value='public'>{FormatMessage.string({id: 'metrics.scope.public'})}</option>
                  <option value='department'>{FormatMessage.string({id: 'metrics.scope.department'})}</option>
                </select>
                {form.scopeKind === 'department' && (dictOptions.departments.length > 0
                  ? (() => {
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
                        aria-label={FormatMessage.string({id: 'metrics.scope.department'})}
                        data-testid='metrics-form-department-select'
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
                        data-testid='metrics-form-department'
                      />}
                    </>;
                  })()
                  : <input
                    value={form.departmentId}
                    onChange={e => updateForm({departmentId: e.target.value})}
                    disabled={readOnly}
                    placeholder={FormatMessage.string({id: 'metrics.form.departmentPlaceholder'})}
                    aria-label={FormatMessage.string({id: 'metrics.form.departmentPlaceholder'})}
                    data-testid='metrics-form-department'
                  />)}
              </div> : renderScopeBadge(editorDefinition
                ? editorDefinition.definition.scope : {kind: form.scopeKind})})}
            {renderFieldRow({labelKey: 'metrics.form.owner', errorPath: 'ownerId', children:
              <input
                value={form.ownerId}
                onChange={e => updateForm({ownerId: e.target.value})}
                disabled={readOnly}
                data-testid='metrics-form-owner'
              />})}
            {renderFieldRow({labelKey: 'metrics.form.concept', errorPath: 'conceptId', children:
              <select
                value={form.conceptId}
                onChange={e => updateForm({conceptId: e.target.value})}
                disabled={readOnly}
                data-testid='metrics-form-concept'
              >
                <option value=''>{FormatMessage.string({id: 'metrics.form.noConcept'})}</option>
                {concepts.map(c => <option key={c.id} value={c.id}>{c.domain} / {c.name}</option>)}
              </select>})}
            {renderFieldRow({labelKey: 'metrics.form.description', errorPath: 'spec.description', children:
              <input
                value={form.description}
                onChange={e => updateForm({description: e.target.value})}
                disabled={readOnly}
                data-testid='metrics-form-description'
              />})}

            {kind === 'atomic' && <>
              {renderFieldRow({labelKey: 'metrics.form.aggregation', errorPath: 'spec.aggregation', children:
                <select
                  value={form.aggregation}
                  onChange={e => updateForm({aggregation: e.target.value})}
                  disabled={readOnly}
                  data-testid='metrics-form-aggregation'
                >
                  {AGGREGATIONS.map(a => <option key={a} value={a}>
                    {FormatMessage.string({id: `metrics.agg.${a}`})}
                  </option>)}
                </select>})}
              {renderFieldRow({labelKey: 'metrics.form.unit', errorPath: 'spec.unit',
                hint: dictOptions.units.length > 0 ? 'metrics.form.unitHint' : null, children:
                dictOptions.units.length > 0 ? (() => {
                  const codes = dictOptions.units.map(u => u.code);
                  const manual = form.unitManual === true
                    || (form.unit !== '' && codes.indexOf(form.unit) < 0);
                  return <div className='chiner-metrics-inline'>
                    <select
                      value={manual ? MANUAL_OPTION : form.unit}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === MANUAL_OPTION) updateForm({unitManual: true});
                        else updateForm({unit: next, unitManual: false});
                      }}
                      disabled={readOnly}
                      aria-label={FormatMessage.string({id: 'metrics.form.unit'})}
                      data-testid='metrics-form-unit-select'
                    >
                      <option value=''>{FormatMessage.string({id: 'metrics.form.selectUnit'})}</option>
                      {dictOptions.units.map(u => <option key={u.id} value={u.code}>
                        {u.name}（{u.code}）
                      </option>)}
                      <option value={MANUAL_OPTION}>
                        {FormatMessage.string({id: 'metrics.form.manualOption'})}
                      </option>
                    </select>
                    {manual && <input
                      value={form.unit}
                      onChange={e => updateForm({unit: e.target.value})}
                      disabled={readOnly}
                      placeholder='CNY / ORDER / RATIO'
                      className='chiner-metrics-mono'
                      data-testid='metrics-form-unit'
                    />}
                  </div>;
                })() : <input
                  value={form.unit}
                  onChange={e => updateForm({unit: e.target.value})}
                  disabled={readOnly}
                  placeholder='CNY / ORDER / RATIO'
                  data-testid='metrics-form-unit'
                />})}
              {renderFieldRow({labelKey: 'metrics.form.sourceModel', errorPath: 'spec.source.modelId',
                hint: 'metrics.form.sourceHint', span: true, children:
                <div className='chiner-metrics-inline'>
                  <select
                    value={form.sourceModelId}
                    onChange={e => updateForm({sourceModelId: e.target.value, sourceFieldId: ''})}
                    disabled={readOnly}
                    data-testid='metrics-form-source-model'
                  >
                    <option value=''>{FormatMessage.string({id: 'metrics.form.sourceDesign'})}</option>
                    {sourceModels.map(m => <option key={m.id} value={m.id}>
                      {levelLabel(m.level)} · {m.defName}（{m.defKey}）
                    </option>)}
                  </select>
                  {form.sourceModelId && <select
                    value={form.sourceFieldId}
                    onChange={e => updateForm({sourceFieldId: e.target.value})}
                    disabled={readOnly}
                    data-testid='metrics-form-source-field'
                  >
                    <option value=''>
                      {form.aggregation === 'COUNT'
                        ? FormatMessage.string({id: 'metrics.form.countNoField'})
                        : FormatMessage.string({id: 'metrics.form.selectField'})}
                    </option>
                    {(selectedModel ? selectedModel.fields : []).map(f => <option
                      key={f.id} value={f.id}>{f.defName}（{f.defKey}）</option>)}
                  </select>}
                </div>})}
              {renderFieldRow({labelKey: 'metrics.form.businessDomain', errorPath: 'spec.businessDomain', children:
                <input
                  value={form.businessDomain}
                  onChange={e => updateForm({businessDomain: e.target.value})}
                  disabled={readOnly}
                  data-testid='metrics-form-domain'
                />})}
              {renderFieldRow({labelKey: 'metrics.form.businessProcess', errorPath: 'spec.businessProcess', children:
                <input
                  value={form.businessProcess}
                  onChange={e => updateForm({businessProcess: e.target.value})}
                  disabled={readOnly}
                  data-testid='metrics-form-process'
                />})}
              {renderFieldRow({labelKey: 'metrics.form.timeRole', errorPath: 'spec.timeRole', children:
                <input
                  value={form.timeRole}
                  onChange={e => updateForm({timeRole: e.target.value})}
                  disabled={readOnly}
                  placeholder={FormatMessage.string({id: 'metrics.form.timeRolePlaceholder'})}
                  data-testid='metrics-form-timerole'
                />})}
              {renderFieldRow({labelKey: 'metrics.form.timezone', errorPath: 'spec.timezone', children: <>
                <input
                  value={form.timezone}
                  onChange={e => updateForm({timezone: e.target.value})}
                  disabled={readOnly}
                  list='chiner-metrics-tz'
                  data-testid='metrics-form-timezone'
                />
                <datalist id='chiner-metrics-tz'>
                  {COMMON_TIMEZONES.map(tz => <option key={tz} value={tz}/>)}
                </datalist>
              </>})}
              {renderFieldRow({labelKey: 'metrics.form.factGrain', errorPath: 'spec.factGrain.description',
                hint: 'metrics.form.factGrainHint', span: true, children:
                <input
                  value={form.factGrainDescription}
                  onChange={e => updateForm({factGrainDescription: e.target.value})}
                  disabled={readOnly}
                  placeholder={FormatMessage.string({id: 'metrics.form.factGrainPlaceholder'})}
                  data-testid='metrics-form-factgrain'
                />})}
              {renderFieldRow({labelKey: 'metrics.form.uniqueKeys', errorPath: 'spec.factGrain.uniqueKeyFieldIds',
                hint: form.sourceModelId ? 'metrics.form.uniqueKeysHint'
                  : 'metrics.form.uniqueKeysNeedModel', span: true, children:
                form.sourceModelId ? <div className='chiner-metrics-checks'
                  data-testid='metrics-form-uniquekeys'>
                  {(selectedModel ? selectedModel.fields : []).map(f => <label key={f.id}
                    className='chiner-metrics-check'>
                    <input
                      type='checkbox'
                      checked={form.uniqueKeyFieldIds.indexOf(f.id) >= 0}
                      onChange={e => updateForm({uniqueKeyFieldIds: e.target.checked
                        ? form.uniqueKeyFieldIds.concat([f.id])
                        : form.uniqueKeyFieldIds.filter(id => id !== f.id)})}
                      disabled={readOnly}
                    />
                    <span>{f.defName}（{f.defKey}）</span>
                  </label>)}
                </div> : <p className='chiner-metrics-muted'>
                  <FormatMessage id='metrics.form.uniqueKeysNeedModel'/>
                </p>})}
              {renderFieldRow({labelKey: 'metrics.form.baseQualifiers', errorPath: 'spec.baseQualifiers',
                hint: 'metrics.form.qualifierHint', span: true, children:
                renderQualifierRows({
                  listName: 'baseQualifiers',
                  list: form.baseQualifiers,
                  dimensionOptions: null,
                  freeDimensions: dimensionChoices,
                  dimensionByCode: dictOptions.dimensionByCode,
                  presets: dictOptions.qualifiers,
                  onPresetSelect: presetId => addQualifierPreset('baseQualifiers', presetId),
                  onChange: baseQualifiers => updateForm({baseQualifiers}),
                  disabled: readOnly,
                })})}
              {renderFieldRow({labelKey: 'metrics.form.dimensions', errorPath: 'spec.dimensions',
                hint: 'metrics.form.dimensionsHint', span: true, children:
                <div className='chiner-metrics-rows' data-testid='metrics-form-dimensions'>
                  {form.dimensions.map((dim, index) => <div
                    key={index}
                    className='chiner-metrics-row3'
                    data-error-path={`spec.dimensions[${index}].dimensionId`}
                  >
                    <input
                      value={dim.dimensionId}
                      onChange={e => updateForm({dimensions: form.dimensions.map((d, i) => (
                        i === index ? {...d, dimensionId: e.target.value} : d))})}
                      disabled={readOnly}
                      list='chiner-metrics-dim-declare'
                      placeholder='dim-channel'
                      aria-label={FormatMessage.string({id: 'metrics.form.dimensionId'})}
                    />
                    <datalist id='chiner-metrics-dim-declare'>
                      {dimensionChoices.map(d => <option key={d} value={d}/>)}
                    </datalist>
                    <select
                      value={dim.addable}
                      onChange={e => updateForm({dimensions: form.dimensions.map((d, i) => (
                        i === index ? {...d, addable: e.target.value} : d))})}
                      disabled={readOnly}
                      aria-label={FormatMessage.string({id: 'metrics.form.addable'})}
                    >
                      {ADDABLES.map(a => <option key={a} value={a}>
                        {FormatMessage.string({id: `metrics.addable.${a}`})}
                      </option>)}
                    </select>
                    <button
                      type='button'
                      className='chiner-metrics-iconbtn'
                      disabled={readOnly}
                      onClick={() => updateForm({dimensions:
                        form.dimensions.filter((d, i) => i !== index)})}
                      aria-label={FormatMessage.string({id: 'metrics.form.removeRow'})}
                    >×</button>
                  </div>)}
                  <button
                    type='button'
                    className='chiner-metrics-btn chiner-metrics-btn-ghost'
                    disabled={readOnly}
                    onClick={() => updateForm({dimensions:
                      form.dimensions.concat([{dimensionId: '', addable: 'additive'}])})}
                    data-testid='metrics-dimensions-add'
                  >
                    + <FormatMessage id='metrics.form.addDimension'/>
                  </button>
                </div>})}
            </>}

            {kind === 'derived' && <>
              {renderFieldRow({labelKey: 'metrics.form.atomicRevision', errorPath: 'spec.atomicRevisionId',
                hint: 'metrics.form.atomicRevisionHint', span: true, children:
                <select
                  value={form.atomicRevisionId}
                  onChange={e => updateForm({atomicRevisionId: e.target.value})}
                  disabled={readOnly}
                  data-testid='metrics-form-atomic-rev'
                >
                  <option value=''>{FormatMessage.string({id: 'metrics.form.selectAtomic'})}</option>
                  {atomicOptions.map(o => <option key={o.revisionId} value={o.revisionId}>
                    {o.name}（{o.code}）@ v{o.version}
                    {o.scopeLabel ? ` · ${o.scopeLabel}` : ''}
                  </option>)}
                </select>})}
              {dictOptions.periods.length > 0 && renderFieldRow({
                labelKey: 'metrics.form.windowPreset', errorPath: 'spec.window', children:
                <select
                  value=''
                  onChange={(e) => {
                    // 选择字典周期 → 填入具体窗口值（快照进 spec，字典后续变更不影响本定义）
                    const preset = dictOptions.periods.filter(p => p.id === e.target.value)[0];
                    if (preset == null) return;
                    updateForm({
                      windowType: preset.window.type,
                      windowLength: String(preset.window.length),
                      windowEnd: preset.window.end,
                      windowTimezone: preset.window.timezone,
                    });
                  }}
                  disabled={readOnly}
                  aria-label={FormatMessage.string({id: 'metrics.form.windowPreset'})}
                  data-testid='metrics-form-window-preset'
                >
                  <option value=''>{FormatMessage.string({id: 'metrics.form.windowPresetCustom'})}</option>
                  {dictOptions.periods.map(p => <option key={p.id} value={p.id}>
                    {p.name}（{p.code}）
                  </option>)}
                </select>})}
              {renderFieldRow({labelKey: 'metrics.form.windowType', errorPath: 'spec.window.type', children:
                <select
                  value={form.windowType}
                  onChange={e => updateForm({windowType: e.target.value})}
                  disabled={readOnly}
                  data-testid='metrics-form-window-type'
                >
                  <option value='calendarDays'>{FormatMessage.string({id: 'metrics.window.calendarDays'})}</option>
                  <option value='rollingHours'>{FormatMessage.string({id: 'metrics.window.rollingHours'})}</option>
                </select>})}
              {renderFieldRow({labelKey: 'metrics.form.windowLength', errorPath: 'spec.window.length', children:
                <input
                  type='number'
                  min='1'
                  value={form.windowLength}
                  onChange={e => updateForm({windowLength: e.target.value})}
                  disabled={readOnly}
                  data-testid='metrics-form-window-length'
                />})}
              {renderFieldRow({labelKey: 'metrics.form.windowEnd', errorPath: 'spec.window.end',
                hint: 'metrics.form.windowEndHint', children:
                <select
                  value={form.windowEnd}
                  onChange={e => updateForm({windowEnd: e.target.value})}
                  disabled={readOnly}
                  data-testid='metrics-form-window-end'
                >
                  <option value='yesterday'>{FormatMessage.string({id: 'metrics.window.yesterday'})}</option>
                  <option value='today'>{FormatMessage.string({id: 'metrics.window.today'})}</option>
                </select>})}
              {renderFieldRow({labelKey: 'metrics.form.windowTimezone', errorPath: 'spec.window.timezone', children: <>
                <input
                  value={form.windowTimezone}
                  onChange={e => updateForm({windowTimezone: e.target.value})}
                  disabled={readOnly}
                  list='chiner-metrics-tz'
                />
                <datalist id='chiner-metrics-tz'>
                  {COMMON_TIMEZONES.map(tz => <option key={tz} value={tz}/>)}
                </datalist>
              </>})}
              {renderFieldRow({labelKey: 'metrics.form.qualifiers', errorPath: 'spec.qualifiers',
                hint: selectedAtomic ? 'metrics.form.derivedQualifierHint'
                  : 'metrics.form.needAtomic', span: true, children:
                selectedAtomic ? renderQualifierRows({
                  listName: 'qualifiers',
                  list: form.qualifiers,
                  dimensionOptions: atomicDimensionIds,
                  dimensionByCode: dictOptions.dimensionByCode,
                  presets: (dictOptions.qualifiers || [])
                    .filter(p => atomicDimensionIds.indexOf(p.dimensionId) >= 0),
                  onPresetSelect: presetId => addQualifierPreset('qualifiers', presetId),
                  onChange: qualifiers => updateForm({qualifiers}),
                  disabled: readOnly,
                }) : <p className='chiner-metrics-muted'>
                  <FormatMessage id='metrics.form.needAtomic'/>
                </p>})}
              {renderFieldRow({labelKey: 'metrics.form.outputGrain', errorPath: 'spec.outputGrain',
                hint: selectedAtomic ? 'metrics.form.outputGrainHint'
                  : 'metrics.form.needAtomic', span: true, children:
                selectedAtomic ? <div className='chiner-metrics-checks'
                  data-testid='metrics-form-outputgrain'>
                  {atomicDimensionIds.map(d => <label key={d} className='chiner-metrics-check'>
                    <input
                      type='checkbox'
                      checked={form.outputGrain.indexOf(d) >= 0}
                      onChange={e => updateForm({outputGrain: e.target.checked
                        ? form.outputGrain.concat([d])
                        : form.outputGrain.filter(x => x !== d)})}
                      disabled={readOnly}
                    />
                    <span>{d}</span>
                  </label>)}
                </div> : <p className='chiner-metrics-muted'>
                  <FormatMessage id='metrics.form.needAtomic'/>
                </p>})}
            </>}

            {kind === 'compound' && <>
              {renderFieldRow({labelKey: 'metrics.form.refs', errorPath: 'spec.refs',
                hint: 'metrics.form.refsHint', span: true, children:
                <div className='chiner-metrics-rows' data-testid='metrics-form-refs'>
                  {(form.refs || []).map((ref, index) => <div
                    key={index}
                    className='chiner-metrics-row3'
                    data-error-path={`spec.refs[${index}].revisionId`}
                  >
                    <input
                      value={ref.key}
                      onChange={e => updateForm({refs: form.refs.map((r, i) => (
                        i === index ? {...r, key: e.target.value} : r))})}
                      disabled={readOnly}
                      className='chiner-metrics-mono'
                      placeholder='amount'
                      aria-label={FormatMessage.string({id: 'metrics.form.refKey'})}
                    />
                    <select
                      value={ref.revisionId}
                      onChange={e => updateForm({refs: form.refs.map((r, i) => (
                        i === index ? {...r, revisionId: e.target.value} : r))})}
                      disabled={readOnly}
                      aria-label={FormatMessage.string({id: 'metrics.form.refRevision'})}
                    >
                      <option value=''>{FormatMessage.string({id: 'metrics.form.selectOperand'})}</option>
                      {operandOptions.map(o => <option key={o.revisionId} value={o.revisionId}>
                        {o.name}（{o.code}）@ v{o.version}
                        {o.scopeLabel ? ` · ${o.scopeLabel}` : ''}
                      </option>)}
                    </select>
                    <button
                      type='button'
                      className='chiner-metrics-iconbtn'
                      disabled={readOnly}
                      onClick={() => updateForm({refs: form.refs.filter((r, i) => i !== index)})}
                      aria-label={FormatMessage.string({id: 'metrics.form.removeRow'})}
                    >×</button>
                  </div>)}
                  <button
                    type='button'
                    className='chiner-metrics-btn chiner-metrics-btn-ghost'
                    disabled={readOnly}
                    onClick={() => updateForm({refs: (form.refs || [])
                      .concat([{key: '', revisionId: ''}])})}
                    data-testid='metrics-refs-add'
                  >
                    + <FormatMessage id='metrics.form.addRef'/>
                  </button>
                </div>})}
              {renderFieldRow({labelKey: 'metrics.form.expression', errorPath: 'spec.expression',
                hint: 'metrics.form.expressionHint', span: true, children:
                <div className='chiner-metrics-expression'>
                  <div className='chiner-metrics-expression-tools' role='toolbar'>
                    {(form.refs || []).filter(r => r.key).map((ref, i) => <button
                      key={i}
                      type='button'
                      className='chiner-metrics-btn chiner-metrics-btn-ghost chiner-metrics-mono'
                      disabled={readOnly}
                      onClick={() => insertExpression(`{{${ref.key}}}`)}
                      title={`{{${ref.key}}}`}
                    >{`{{${ref.key}}}`}</button>)}
                    {['+', '-', '*', '/', '(', ')'].map(op => <button
                      key={op}
                      type='button'
                      className='chiner-metrics-btn chiner-metrics-btn-ghost chiner-metrics-mono'
                      disabled={readOnly}
                      onClick={() => insertExpression(op)}
                    >{op}</button>)}
                    <button
                      type='button'
                      className='chiner-metrics-btn chiner-metrics-btn-ghost chiner-metrics-mono'
                      disabled={readOnly}
                      onClick={() => insertExpression('SAFE_DIVIDE(, )')}
                    >SAFE_DIVIDE(, )</button>
                  </div>
                  <textarea
                    ref={expressionRef}
                    value={form.expression}
                    onChange={e => updateForm({expression: e.target.value})}
                    disabled={readOnly}
                    rows='3'
                    className='chiner-metrics-mono'
                    placeholder='SAFE_DIVIDE({{amount}}, {{orders}})'
                    data-testid='metrics-form-expression'
                  />
                  <div className='chiner-metrics-expression-state'
                    data-testid='metrics-expression-state'>
                    {expressionState && expressionState.parseError ? <div
                      className='chiner-metrics-expression-error'>
                      <FormatMessage id='metrics.editor.expressionInvalid'/>：
                      <FormatMessage
                        id={expressionState.parseError.messageKey || 'metric.error.invalidExpression'}
                        data={expressionState.parseError.params}/>
                    </div> : null}
                    {expressionState && expressionState.ast ? <div>
                      <div><FormatMessage id='metrics.editor.expressionParsed'/>：
                        <code>{expressionState.text}</code></div>
                      <div>
                        <FormatMessage id='metrics.editor.derivedUnit'/>：
                        {expressionState.unitError
                          ? <FormatMessage id={expressionState.unitError.messageKey
                            || 'metric.error.unitConflict'}
                            data={expressionState.unitError.params}/>
                          : <code>{expressionState.unit == null
                            ? FormatMessage.string({id: 'metrics.editor.unitUnknown'})
                            : expressionState.unit}</code>}
                      </div>
                      {expressionState.division ? <div className='chiner-metrics-zero-note'
                        data-testid='metrics-zero-policy'>
                        <FormatMessage id={
                          form.expression.indexOf('SAFE_DIVIDE') >= 0
                            ? 'metrics.editor.zeroSafeDivide' : 'metrics.editor.zeroPlainDivide'}/>
                      </div> : null}
                    </div> : null}
                    {expressionState && expressionState.empty ? <div
                      className='chiner-metrics-muted'>
                      <FormatMessage id='metrics.editor.expressionEmpty'/>
                    </div> : null}
                  </div>
                </div>})}
            </>}
          </div>

          {commandErrors.length > 0 && <div className='chiner-metrics-field-errors'>
            {renderErrorList({errors: commandErrors, onLocate: onLocateError,
              testId: 'metrics-command-errors'})}
          </div>}
          {saveNotice ? <div className={`chiner-metrics-notice${saveNotice === 'metrics.editor.saveFirst' ? ' chiner-metrics-notice-warn' : ''}`}
            data-testid='metrics-save-notice'
            role='status'>
            <FormatMessage id={saveNotice}/>
            {saveNotice !== 'metrics.editor.saveFirst'
              && <FormatMessage id='metrics.notice.projectDirty'/>}
          </div> : null}
          {!isCreate && dirty && <div
            className='chiner-metrics-notice chiner-metrics-notice-warn'
            data-testid='metrics-save-first-hint'
            role='status'>
            <FormatMessage id='metrics.editor.saveFirst'/>
          </div>}
          {commandErrors.some(e => e.code === 'REVISION_CONFLICT') && <div
            className='chiner-metrics-notice chiner-metrics-notice-warn'>
            <FormatMessage id='metrics.editor.conflictHint'/>
            <button
              type='button'
              className='chiner-metrics-btn'
              onClick={() => {
                const latest = latestSource();
                const revision = metricApi.getMetricRevision(latest, editor.revisionId);
                const detail = metricApi.getMetricDefinition(latest, editor.definitionId);
                if (revision && detail) {
                  setEditor(pre => ({
                    ...pre, baseRev: revision.rev,
                    form: formFromRevision(revision, detail.definition),
                  }));
                  setCommandErrors([]);
                  setValidation(null);
                }
              }}
              data-testid='metrics-conflict-reload'
            >
              <FormatMessage id='metrics.editor.conflictReload'/>
            </button>
          </div>}

          <div className='chiner-metrics-form-actions'>
            <span className='chiner-metrics-muted'>
              <FormatMessage id='metrics.editor.draftNote'/>
            </span>
            <span className='chiner-metrics-form-buttons'>
              {isCreate ? <button
                type='button'
                className='chiner-metrics-btn chiner-metrics-btn-primary'
                data-testid='metrics-create-draft'
                disabled={readOnly}
                onClick={createDraft}
              >
                <FormatMessage id='metrics.editor.createDraft'/>
              </button> : <>
                <button
                  type='button'
                  className='chiner-metrics-btn'
                  data-testid='metrics-save-draft'
                  disabled={readOnly || !dirty}
                  onClick={saveDraft}
                >
                  <FormatMessage id='metrics.editor.saveDraft'/>
                </button>
                <button
                  type='button'
                  className='chiner-metrics-btn'
                  data-testid='metrics-validate-draft'
                  disabled={readOnly || dirty}
                  title={dirty ? FormatMessage.string({id: 'metrics.editor.saveFirst'}) : undefined}
                  onClick={validateDraft}
                >
                  <FormatMessage id='metrics.editor.validate'/>
                </button>
                <button
                  type='button'
                  className='chiner-metrics-btn chiner-metrics-btn-primary'
                  data-testid='metrics-publish-draft'
                  disabled={readOnly || dirty}
                  title={dirty ? FormatMessage.string({id: 'metrics.editor.saveFirst'}) : undefined}
                  onClick={publishDraft}
                >
                  <FormatMessage id='metrics.editor.publish'/>
                </button>
                <button
                  type='button'
                  className='chiner-metrics-btn chiner-metrics-btn-danger'
                  data-testid='metrics-discard-draft'
                  disabled={readOnly}
                  onClick={discardDraft}
                >
                  <FormatMessage id='metrics.editor.discardDraft'/>
                </button>
              </>}
            </span>
          </div>
        </div>

        <aside className='chiner-metrics-side'>
          <div className='chiner-metrics-side-card' data-testid='metrics-validation-panel'>
            <h3><FormatMessage id='metrics.editor.validation'/></h3>
            {validation == null ? <p className='chiner-metrics-muted'>
              <FormatMessage id='metrics.editor.validationIdle'/>
            </p> : (validation.ok
              ? <div className='chiner-metrics-validation-ok' data-testid='metrics-validation-ok'>
                <FormatMessage id='metrics.editor.validationOk'/>
                <p className='chiner-metrics-muted'>
                  <FormatMessage id='metrics.editor.validationOkNote'/>
                </p>
              </div>
              : renderErrorList({errors: validation.errors, onLocate: onLocateError,
                testId: 'metrics-validation-errors'}))}
          </div>
          <div className='chiner-metrics-side-card'>
            <h3><FormatMessage id='metrics.editor.scopeNoteTitle'/></h3>
            <p><FormatMessage id='metrics.editor.scopeNote1'/></p>
            <p><FormatMessage id='metrics.editor.scopeNote2'/></p>
            <p><FormatMessage id='metrics.editor.scopeNote3'/></p>
          </div>
        </aside>
      </div>
    </section>;
  }

  // ---- 已发布版本只读视图 ----
  const detail = editorDefinition;
  const revision = editorRevision;
  if (!detail || !revision) {
    return <section className='chiner-metrics-page' data-testid='metrics-definition-page'>
      <div className='chiner-metrics-empty'>
        <h3><FormatMessage id='metrics.definition.missingTitle'/></h3>
        <button type='button' className='chiner-metrics-btn'
          onClick={() => loadTarget(null)}>
          <FormatMessage id='metrics.editor.backList'/>
        </button>
      </div>
    </section>;
  }
  const definition = detail.definition;
  const spec = revision.spec || {};
  const resolved = revision.resolvedSpec || {};
  // MET-10：计算就绪以当前项目动态判定为准；resolvedSpec.computeReady 只是发布时快照
  const snapshotReady = resolved.computeReady === true;
  const readiness = metricApi.getMetricReadiness(source, revision.id)
    || {ready: snapshotReady, reasons: []};
  const dependencies = metricApi.getMetricDependencies(source, revision.id);
  const versionRows = (detail.revisions || []).slice().sort((a, b) => {
    const order = (v) => {
      if (v == null) return -1;
      const parts = String(v).split('.');
      return Number(parts[0]) * 100000 + Number(parts[1] || 0);
    };
    return order(a.version) < order(b.version) ? 1 : -1;
  });
  const renderFact = (labelKey, value, mono) => <div className='chiner-metrics-fact'
    key={labelKey}>
    <span><FormatMessage id={labelKey}/></span>
    <strong className={mono ? 'chiner-metrics-mono' : ''}>{value == null || value === ''
      ? '—' : (typeof value === 'boolean'
        ? <FormatMessage id={value ? 'metrics.common.yes' : 'metrics.common.no'}/> : String(value))}
    </strong>
  </div>;

  return <section className='chiner-metrics-page' ref={containerRef} data-testid='metrics-view-page'>
    <header className='chiner-metrics-page-header'>
      <div>
        <h2>
          {definition.name}
          {renderKindBadge(definition.kind)}
          {renderScopeBadge(definition.scope)}
          <span className='chiner-metrics-tag'>v{revision.version}</span>
          {renderStatusBadge(revision.status)}
        </h2>
        <p className='chiner-metrics-page-sub'>
          <code>{definition.code}</code>
          {definition.conceptId ? ' · ' + conceptLabel(concepts, definition.conceptId) : ''}
        </p>
      </div>
      <div className='chiner-metrics-header-actions'>
        <button
          type='button'
          className='chiner-metrics-btn'
          onClick={() => loadTarget(null)}
        >
          <FormatMessage id='metrics.editor.backList'/>
        </button>
        {/* 决策 D2：已废弃版本也可修订，修订发布后定义级废弃自动解除 */}
        {(revision.status === 'published' || revision.status === 'deprecated') && !readOnly && <button
          type='button'
          className='chiner-metrics-btn'
          data-testid='metrics-revise'
          disabled={!!detail.draft}
          title={detail.draft
            ? FormatMessage.string({id: 'metrics.view.activeDraftExists'}) : undefined}
          onClick={reviseDraft}
        >
          <FormatMessage id='metrics.view.revise'/>
        </button>}
        {revision.status === 'published' && !readOnly && <button
          type='button'
          className='chiner-metrics-btn chiner-metrics-btn-danger'
          data-testid='metrics-deprecate'
          onClick={deprecateDefinition}
        >
          <FormatMessage id='metrics.view.deprecate'/>
        </button>}
      </div>
    </header>

    {commandErrors.length > 0 && <div className='chiner-metrics-field-errors'>
      {renderErrorList({errors: commandErrors, onLocate: onLocateError})}
    </div>}

    <div className='chiner-metrics-versionbar' data-testid='metrics-version-bar'>
      {versionRows.map(r => <button
        key={r.id}
        type='button'
        className={`chiner-metrics-version-chip${r.id === revision.id ? ' active' : ''}`}
        onClick={() => loadTarget({definitionId: definition.id, revisionId: r.id})}
        data-testid='metrics-version-chip'
      >
        {r.version ? `v${r.version}` : <FormatMessage id='metrics.status.draft'/>}
        {renderStatusBadge(r.status)}
      </button>)}
    </div>
    {detail.draft && detail.draft.id !== revision.id && <div className='chiner-metrics-notice'>
      <FormatMessage id='metrics.view.hasDraftNotice'/>
      <button
        type='button'
        className='chiner-metrics-btn'
        onClick={() => loadTarget({definitionId: definition.id, revisionId: detail.draft.id})}
        data-testid='metrics-open-draft'
      >
        <FormatMessage id='metrics.view.openDraft'/>
      </button>
    </div>}

    <div className='chiner-metrics-editor-layout'>
      <div className='chiner-metrics-form-card'>
        <h3 className='chiner-metrics-form-title'>
          <FormatMessage id={`metrics.kind.${spec.kind}`}/>
          <span className='chiner-metrics-tag'><FormatMessage id='metrics.view.readonly'/></span>
        </h3>
        <div className='chiner-metrics-facts'>
          {renderFact('metrics.form.owner', definition.ownerId, true)}
          {renderFact('metrics.form.description', spec.description)}
          {spec.kind === 'atomic' && <>
            {renderFact('metrics.form.aggregation', aggLabel(spec.aggregation))}
            {renderFact('metrics.form.unit', spec.unit, true)}
            {renderFact('metrics.form.businessDomain', spec.businessDomain)}
            {renderFact('metrics.form.businessProcess', spec.businessProcess)}
            {renderFact('metrics.form.sourceModel',
              sourceModelLabel(sourceModels, spec.source), true)}
            {renderFact('metrics.form.factGrain',
              (spec.factGrain || {}).description)}
            {renderFact('metrics.form.uniqueKeys',
              ((spec.factGrain || {}).uniqueKeyFieldIds || []).join(', '), true)}
            {renderFact('metrics.form.timeRole', spec.timeRole)}
            {renderFact('metrics.form.timezone', spec.timezone, true)}
            <div className='chiner-metrics-fact chiner-metrics-fact-span'>
              <span><FormatMessage id='metrics.form.baseQualifiers'/></span>
              <div>{renderQualifierFacts(spec.baseQualifiers)}</div>
            </div>
            <div className='chiner-metrics-fact chiner-metrics-fact-span'>
              <span><FormatMessage id='metrics.form.dimensions'/></span>
              <div className='chiner-metrics-fact-list'>
                {(spec.dimensions || []).map(d => <span key={d.dimensionId}
                  className='chiner-metrics-tag'>
                  {d.dimensionId} · <FormatMessage id={`metrics.addable.${d.addable}`}/>
                </span>)}
                {(spec.dimensions || []).length === 0 && '—'}
              </div>
            </div>
          </>}
          {spec.kind === 'derived' && <>
            {renderFact('metrics.form.atomicRevision',
              revisionOptionLabel(source, spec.atomicRevisionId), true)}
            {renderFact('metrics.form.window', windowLabel(spec.window))}
            <div className='chiner-metrics-fact chiner-metrics-fact-span'>
              <span><FormatMessage id='metrics.form.qualifiers'/></span>
              <div>{renderQualifierFacts(spec.qualifiers)}</div>
            </div>
            {renderFact('metrics.form.outputGrain',
              (spec.outputGrain || []).join(' × '), true)}
          </>}
          {spec.kind === 'compound' && <>
            <div className='chiner-metrics-fact chiner-metrics-fact-span'>
              <span><FormatMessage id='metrics.form.expression'/></span>
              <div><code className='chiner-metrics-mono'>{spec.expression}</code></div>
            </div>
            <div className='chiner-metrics-fact chiner-metrics-fact-span'>
              <span><FormatMessage id='metrics.form.refs'/></span>
              <div className='chiner-metrics-fact-list'>
                {(spec.refs || []).map(r => <span key={r.key} className='chiner-metrics-tag'>
                  {r.key} → {revisionOptionLabel(source, r.revisionId)}
                </span>)}
              </div>
            </div>
            {containsDivisionSafe(spec.expression) ? <div
              className='chiner-metrics-fact chiner-metrics-fact-span'>
              <span><FormatMessage id='metrics.editor.zeroPolicy'/></span>
              <div>
                <FormatMessage id={String(spec.expression).indexOf('SAFE_DIVIDE') >= 0
                  ? 'metrics.editor.zeroSafeDivide' : 'metrics.editor.zeroPlainDivide'}/>
              </div>
            </div> : null}
          </>}
        </div>
      </div>
      <aside className='chiner-metrics-side'>
        <div className='chiner-metrics-side-card' data-testid='metrics-resolved-panel'>
          <h3><FormatMessage id='metrics.view.resolved'/></h3>
          <div className='chiner-metrics-facts'>
            {renderFact('metrics.resolved.unit', resolved.unit, true)}
            {renderFact('metrics.resolved.reAggregable',
              <FormatMessage id={resolved.reAggregable
                ? 'metrics.common.yes' : 'metrics.common.no'}/>)}
            {resolved.reAggregableReason ? renderFact('metrics.resolved.reason',
              resolved.reAggregableReason) : null}
            {renderFact('metrics.resolved.computeReady',
              <FormatMessage id={readiness.ready
                ? 'metrics.common.yes' : 'metrics.common.no'}/>)}
            {readiness.ready !== snapshotReady ? <p className='chiner-metrics-muted'
              data-testid='metrics-ready-snapshot'>
              <FormatMessage id={snapshotReady
                ? 'metrics.resolved.snapshotReady' : 'metrics.resolved.snapshotNotReady'}/>
            </p> : null}
            {readiness.reasons.length ? <ul className='chiner-metrics-deplist'
              data-testid='metrics-ready-reasons'>
              {readiness.reasons.map(item => <li key={`${item.code}:${item.path}`}>
                <FormatMessage id={`metrics.resolved.readinessReason.${item.code}`}/>
                {' '}<code>{item.path}</code>
              </li>)}
            </ul> : null}
            {resolved.designOnly ? <div className='chiner-metrics-notice'
              data-testid='metrics-design-only'>
              <FormatMessage id='metrics.view.designOnly'/>
            </div> : null}
            {spec.kind !== 'atomic' && resolved.window ? renderFact('metrics.form.window',
              windowLabel(resolved.window)) : null}
            {spec.kind !== 'atomic' && resolved.grain ? renderFact('metrics.form.outputGrain',
              (resolved.grain || []).join(' × '), true) : null}
            {resolved.timeRole ? renderFact('metrics.form.timeRole', resolved.timeRole) : null}
            {resolved.timezone ? renderFact('metrics.form.timezone', resolved.timezone, true) : null}
          </div>
        </div>
        <div className='chiner-metrics-side-card' data-testid='metrics-dependency-panel'>
          <h3><FormatMessage id='metrics.view.dependencies'/></h3>
          {dependencies.length === 0 ? <p className='chiner-metrics-muted'>
            <FormatMessage id='metrics.view.noDependencies'/>
          </p> : <ul className='chiner-metrics-deplist'>
            {dependencies.map(dep => <li key={dep.upstreamRevisionId}>
              <span className='chiner-metrics-tag'>{dep.role}</span>
              <code>{revisionOptionLabel(source, dep.upstreamRevisionId)}</code>
              {dep.exists
                ? renderStatusBadge(dep.upstreamStatus)
                : <span className='chiner-metrics-tag chiner-metrics-tag-warn'>
                  <FormatMessage id='metrics.view.depMissing'/>
                </span>}
            </li>)}
          </ul>}
        </div>
      </aside>
    </div>
  </section>;
};

// ---- 视图辅助（纯渲染/纯函数，无 hooks） ----
const levelLabel = (level) => ({
  physical: FormatMessage.string({id: 'metrics.model.physical'}),
  logical: FormatMessage.string({id: 'metrics.model.logical'}),
  conceptual: FormatMessage.string({id: 'metrics.model.conceptual'}),
}[level] || level);

const aggLabel = (aggregation) => aggregation == null ? '—'
  : `${aggregation} · ${FormatMessage.string({id: `metrics.agg.${aggregation}`})}`;

const conceptLabel = (concepts, conceptId) => {
  const hit = concepts.filter(c => c.id === conceptId)[0];
  return hit ? `${hit.domain} / ${hit.name}` : conceptId;
};

const sourceModelLabel = (models, sourceRef) => {
  if (sourceRef == null || !sourceRef.modelId) {
    return FormatMessage.string({id: 'metrics.view.designSource'});
  }
  const model = models.filter(m => m.id === sourceRef.modelId)[0];
  const field = model && sourceRef.fieldId
    ? (model.fields.filter(f => f.id === sourceRef.fieldId)[0] || {}).defKey : null;
  return model
    ? `${model.defKey}${field ? `.${field}` : ''}`
    : FormatMessage.string({id: 'metrics.view.sourceMissing'});
};

const revisionOptionLabel = (source, revisionId) => {
  const store = metricApi.readMetricPlatform(source);
  const revision = (store.revisions || []).filter(r => r.id === revisionId)[0];
  if (revision == null) return revisionId;
  const definition = (store.definitions || [])
    .filter(d => d.id === revision.definitionId)[0];
  const name = definition ? `${definition.name}（${definition.code}）` : revision.definitionId;
  return `${name} @ ${revision.version || FormatMessage.string({id: 'metrics.status.draft'})}`;
};

const windowLabel = (window) => {
  if (window == null) return '—';
  const type = window.type === 'rollingHours'
    ? FormatMessage.string({id: 'metrics.window.rollingHours'})
    : FormatMessage.string({id: 'metrics.window.calendarDays'});
  const end = window.end === 'today'
    ? FormatMessage.string({id: 'metrics.window.today'})
    : FormatMessage.string({id: 'metrics.window.yesterday'});
  return `${end} · ${window.length} ${type} · ${window.timezone}`;
};

const renderQualifierFacts = (list) => {
  if (!list || !list.length) return <span>—</span>;
  return <div className='chiner-metrics-fact-list'>
    {list.map((q, i) => <span key={i} className='chiner-metrics-tag chiner-metrics-mono'>
      {q.dimensionId} {opSymbol(q.op)} {qualifierValueToText(q.value)}
    </span>)}
  </div>;
};

const opSymbol = (op) => ({
  eq: '=', not_eq: '≠', in: '∈', not_in: '∉',
  gt: '>', gte: '≥', lt: '<', lte: '≤',
}[op] || op);

const containsDivisionSafe = (expression) => {
  try {
    const ast = metricApi.parseExpression(expression, 'spec.expression');
    return metricApi.astContainsDivision(ast);
  } catch (e) {
    return String(expression).indexOf('/') >= 0;
  }
};

export default React.memo(DefinitionPage);
