import React, {useMemo, useState} from 'react';
import {FormatMessage, Message, Modal} from 'components';
import {metricApi, runMetricCommand, listPublishedRevisionOptions} from './commands';
import {renderMetricErrorText, renderScopeBadge, renderStatusBadge} from './parts';

// 指标平台 M4B：模型编辑器“指标关联”面板（概念/逻辑/物理三层入口）。
// - ModelBinding（M4A）为唯一事实源：本面板只读写 profile.metricPlatform.bindings，
//   不在模型侧复制指标定义；写入基于最新有效 source 经 runMetricCommand 一次 update；
// - 物理层（entities）提供 COMPUTES_FROM / MATERIALIZES_INTO / CONSUMED_BY 三种角色与
//   “从字段定义原子指标”预填入口（预填真实模型字段，业务语义仍需在指标定义页补齐，
//   不能一键伪造可计算指标）；逻辑/概念层只允许 SEMANTIC_MATCH（语义设计态，无数据流）；
// - 失效（unresolved）关联保留历史端点快照展示；released 关联可切换查看但不参与计数；
//   解除前展示真实影响（getBindingImpact 的下游依赖者）。
// 与 src/lib/metrics 约定一致：不使用 ?? / ?.

export const BINDING_ROLE_KEYS = {
  COMPUTES_FROM: 'metrics.binding.role.computesFrom',
  MATERIALIZES_INTO: 'metrics.binding.role.materializesInto',
  CONSUMED_BY: 'metrics.binding.role.consumedBy',
  SEMANTIC_MATCH: 'metrics.binding.role.semanticMatch',
};

const BINDING_STATE_KEYS = {
  suggested: 'metrics.binding.state.suggested',
  confirmed: 'metrics.binding.state.confirmed',
  unresolved: 'metrics.binding.state.unresolved',
  released: 'metrics.binding.state.released',
};

const FINGERPRINT_KEYS = {
  match: 'metrics.binding.fp.match',
  changed: 'metrics.binding.fp.changed',
  missing: 'metrics.binding.fp.missing',
};

// 各层允许的角色（语义映射限概念/逻辑层；物理层用来源/落地/引用表达）
export const ROLES_FOR_COLLECTION = {
  entities: ['COMPUTES_FROM', 'MATERIALIZES_INTO', 'CONSUMED_BY'],
  logicEntities: ['SEMANTIC_MATCH'],
  conceptEntities: ['SEMANTIC_MATCH'],
};

const COLLECTION_LAYER_KEYS = {
  entities: 'metrics.model.physical',
  logicEntities: 'metrics.model.logical',
  conceptEntities: 'metrics.model.conceptual',
};

const emptyLinkForm = (collection) => ({
  role: ROLES_FOR_COLLECTION[collection][0],
  targetKind: 'revision',
  revisionId: '',
  conceptId: '',
  fieldId: '',
  timeFieldId: '',
  usage: '',
  description: '',
  evidenceNote: '',
  state: 'suggested',
});

const linkFormDirty = (form) => !!(form.revisionId || form.conceptId || form.fieldId
  || form.timeFieldId || form.usage || form.description || form.evidenceNote
  || form.state !== 'suggested');

export const renderBindingStateTag = state => <span
  className={`chiner-metrics-tag chiner-metrics-binding-state-${state}`}
  data-testid={`metrics-binding-state-${state}`}>
  <FormatMessage id={BINDING_STATE_KEYS[state] || 'metrics.binding.state.suggested'}/>
</span>;

export const renderRoleTag = role => <span
  className={`chiner-metrics-tag chiner-metrics-binding-role-${role}`}
  data-testid={`metrics-binding-role-${role}`}>
  <FormatMessage id={BINDING_ROLE_KEYS[role] || BINDING_ROLE_KEYS.COMPUTES_FROM}/>
</span>;

// 角色方向预览（SPEC 6.3：确认前展示方向）
const directionTextKey = (role) => {
  if (role === 'COMPUTES_FROM') return 'metrics.binding.dir.computesFrom';
  if (role === 'MATERIALIZES_INTO') return 'metrics.binding.dir.materializesInto';
  if (role === 'CONSUMED_BY') return 'metrics.binding.dir.consumedBy';
  return 'metrics.binding.dir.semanticMatch';
};

const ModelMetricPanel = ({collection, objectId, dataSource, getDataSource,
                           updateDataSource, readOnly, onOpenMetric}) => {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkForm, setLinkForm] = useState(emptyLinkForm(collection));
  const [linkErrors, setLinkErrors] = useState([]);
  const [showReleased, setShowReleased] = useState(false);
  const [nonce, setNonce] = useState(0);

  const latest = () => (getDataSource ? getDataSource() : dataSource);
  const source = latest();
  const writable = !readOnly && !!updateDataSource;
  // 与指标平台同一写纪律：最新有效 source + 一次命令一次 update + 只读双防线
  const commandRunner = useMemo(() => ({
    getSource: latest,
    updateDataSource,
    readOnly,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [dataSource, getDataSource, updateDataSource, readOnly]);

  const allowedRoles = ROLES_FOR_COLLECTION[collection] || [];
  const model = metricApi.findModelIn(source, collection, objectId);
  const fields = model == null ? [] : (model.fields || []);

  const allBindings = useMemo(() => metricApi.listModelMetricBindings(
    source, {collection, objectId, includeReleased: true}),
  [source, collection, objectId, nonce]);
  const active = allBindings.filter(item => item.binding.state !== 'released');
  const released = allBindings.filter(item => item.binding.state === 'released');
  const byRole = {};
  allowedRoles.forEach((role) => {
    byRole[role] = active.filter(item => item.binding.role === role);
  });
  // 概念/逻辑层的 SEMANTIC_MATCH 同样按角色归组；物理层不展示语义组（领域层不允许）
  const computeSourceCount = byRole.COMPUTES_FROM ? byRole.COMPUTES_FROM.length : 0;

  // M4B 定义声明来源投影（只读）：原子 spec.source 指向本对象的指标（真实 revisions
  // 派生；明确标记为“定义声明”，非绑定记录）；同端点已有生效绑定 → 绑定优先不重复
  const declaredRows = useMemo(() => {
    const data = metricApi.readMetricPlatform(source);
    const definitionById = {};
    (data.definitions || []).forEach((definition) => {
      definitionById[definition.id] = definition;
    });
    const results = [];
    (data.revisions || []).forEach((revision) => {
      const spec = revision == null ? null : revision.spec;
      if (spec == null || spec.kind !== 'atomic') return;
      const ref = spec.source;
      if (ref == null || ref.modelId !== objectId) return;
      if (metricApi.findModelIn(source, collection, objectId) == null) return;
      const declaredField = ref.fieldId == null ? null
        : (fields.filter(f => f.id === ref.fieldId)[0] || null);
      // 字段在场性按稳定 ID 实判（M5A）：声明字段已删除 → present:false，不显示可打开
      const entry = {
        ownerId: revision.id,
        revision,
        definition: definitionById[revision.definitionId] || null,
        specSource: ref,
        endpoint: {
          present: ref.fieldId == null || declaredField != null,
          object: model,
          field: declaredField,
          collection,
        },
        fieldMissing: ref.fieldId != null && declaredField == null,
        designOnly: collection !== 'entities',
      };
      if (metricApi.declaredCoveredByBinding(source, entry,
        allBindings.map(item => item.binding))) return;
      results.push(entry);
    });
    return results;
  }, [source, collection, objectId, model, fields, allBindings, nonce]);

  const revisionOptions = useMemo(() => listPublishedRevisionOptions(source), [source, nonce]);
  const concepts = useMemo(() => metricApi.readMetricPlatform(source).concepts || [],
    [source, nonce]);

  const runBindingCommand = (run, okMessage) => {
    const result = runMetricCommand(commandRunner, run);
    if (result && result.ok) {
      setNonce(n => n + 1);
      if (okMessage) Message.success({title: FormatMessage.string({id: okMessage})});
    } else {
      Message.error({title: (result && result.errors && result.errors[0]
        && result.errors[0].message) || 'error'});
    }
    return result;
  };

  const openDefinitionOf = (item) => {
    onOpenMetric && onOpenMetric({
      module: 'definition',
      definitionId: item.binding.metricDefinitionId,
      revisionId: item.binding.metricRevisionId,
      mode: 'view',
    });
  };
  // M5A：模型页“查看血缘”改指实际血缘页焦点（此前定位模型关联详情）；
  // 未提交表单由 MetricsWorkbench 脏守卫先确认（openRequest 同一通道）
  const openLineageOf = (item) => {
    onOpenMetric && onOpenMetric({
      module: 'lineage',
      definitionId: item.binding.metricDefinitionId,
      revisionId: item.binding.metricRevisionId,
    });
  };

  const onConfirmBinding = (item) => {
    runBindingCommand(latestSource => metricApi.confirmMetricBinding(
      latestSource, item.binding.id, {}), 'metrics.binding.done.confirmed');
  };
  const onRestoreBinding = (item) => {
    runBindingCommand(latestSource => metricApi.restoreMetricBinding(
      latestSource, item.binding.id, {}), 'metrics.binding.done.restored');
  };
  // 解除前展示真实影响：直接绑定 + 该版本下游依赖者（getBindingImpact 真实派生）
  const onReleaseBinding = (item) => {
    const impact = metricApi.getBindingImpact(latest(),
      {collection, objectId, fieldId: item.binding.modelRef.fieldId});
    const metricEntry = impact.metrics.filter(m => m.metric.revision != null
      && m.metric.revision.id === item.binding.metricRevisionId)[0];
    const dependents = metricEntry ? metricEntry.dependents : [];
    Modal.confirm({
      title: FormatMessage.string({id: 'metrics.binding.releaseConfirm.title'}),
      message: <div className='chiner-metrics-binding-confirm'>
        <p><FormatMessage
          id={dependents.length ? 'metrics.binding.releaseConfirm.impact' : 'metrics.binding.releaseConfirm.message'}
          data={{count: dependents.length}}/></p>
        {dependents.length > 0 && <ul className='chiner-metrics-binding-impact-list'>
          {dependents.map(dep => <li key={dep.revisionId}>
            <code>{dep.definitionCode}</code>
            <span>{' v' + dep.version}</span>
          </li>)}
        </ul>}
        <p className='chiner-metrics-binding-confirm-note'>
          <FormatMessage id='metrics.binding.releaseConfirm.keepNote'/>
        </p>
      </div>,
      onOk: () => runBindingCommand(latestSource => metricApi.releaseMetricBinding(
        latestSource, item.binding.id, {reason: 'manual-release'}),
      'metrics.binding.done.released'),
    });
  };

  // ---- 关联已有指标表单 ----
  const updateLinkForm = (patch) => {
    setLinkForm(pre => ({...pre, ...patch}));
  };
  const cancelLinkForm = () => {
    const apply = () => {
      setLinkOpen(false);
      setLinkForm(emptyLinkForm(collection));
      setLinkErrors([]);
    };
    if (linkFormDirty(linkForm)) {
      Modal.confirm({
        title: FormatMessage.string({id: 'metrics.dirty.title'}),
        message: FormatMessage.string({id: 'metrics.binding.form.cancelDirty'}),
        onOk: apply,
      });
    } else {
      apply();
    }
  };
  const submitLinkForm = () => {
    setLinkErrors([]);
    const form = linkForm;
    const revision = form.targetKind === 'revision'
      ? revisionOptions.filter(o => o.revisionId === form.revisionId)[0] : null;
    const mapping = {};
    if (form.role === 'COMPUTES_FROM') {
      if (revision && revision.spec && revision.spec.aggregation) {
        mapping.aggregate = revision.spec.aggregation;
      }
      if (form.timeFieldId) mapping.timeFieldId = form.timeFieldId;
    } else if (form.role === 'MATERIALIZES_INTO' || form.role === 'CONSUMED_BY') {
      if (form.usage) mapping.usage = form.usage;
    } else if (form.role === 'SEMANTIC_MATCH' && form.description) {
      mapping.description = form.description;
    }
    const modelRef = {collection, objectId};
    if (form.fieldId) modelRef.fieldId = form.fieldId;
    const result = runMetricCommand(commandRunner, latestSource => metricApi.createMetricBinding(
      latestSource, {
        role: form.role,
        revisionId: form.targetKind === 'revision' ? form.revisionId : null,
        conceptId: form.role === 'SEMANTIC_MATCH' && form.targetKind === 'concept'
          ? form.conceptId : null,
        definitionId: revision ? revision.definitionId : null,
        modelRef,
        ...(Object.keys(mapping).length ? {mapping} : {}),
        evidence: form.evidenceNote ? {kind: 'manual', note: form.evidenceNote} : {kind: 'manual'},
        state: form.state,
      }));
    if (result && result.ok) {
      setLinkOpen(false);
      setLinkForm(emptyLinkForm(collection));
      setNonce(n => n + 1);
      Message.success({title: FormatMessage.string({id: 'metrics.binding.done.created'})});
    } else {
      setLinkErrors((result && result.errors) || []);
    }
  };
  const submitDisabled = readOnly
    || (linkForm.targetKind === 'revision' && !linkForm.revisionId)
    || (linkForm.targetKind === 'concept' && !linkForm.conceptId)
    || (linkForm.role === 'MATERIALIZES_INTO' && !linkForm.fieldId);

  // 字段角色摘要（物理层“字段与指标”）：端点字段 + mapping 角色字段均计入；
  // 定义声明来源（未被绑定覆盖）以声明标签附在对应字段行，不与绑定重复计数
  const fieldRows = useMemo(() => {
    if (collection !== 'entities') return [];
    return fields.map((field) => {
      const hits = active.filter(item => item.binding.modelRef.fieldId === field.id
        || metricApi.mappingFieldIds(item.binding.mapping).indexOf(field.id) >= 0);
      const declaredHits = declaredRows
        .filter(entry => entry.specSource.fieldId === field.id);
      return {field, hits, declaredHits};
    });
  }, [collection, fields, active, declaredRows]);

  const fromFieldDefine = (field) => {
    onOpenMetric && onOpenMetric({
      module: 'definition',
      mode: 'create',
      kind: 'atomic',
      prefill: {collection, objectId, fieldId: field.id},
    });
  };

  const renderBindingRow = (item) => {
    const binding = item.binding;
    const metric = item.metric;
    const field = binding.modelRef.fieldId == null ? null
      : (fields.filter(f => f.id === binding.modelRef.fieldId)[0] || null);
    return <div
      key={binding.id}
      className={`chiner-metrics-binding-row${item.endpoint.present ? '' : ' chiner-metrics-binding-row-missing'}`}
      data-testid='metrics-binding-row'
      data-binding-id={binding.id}
      data-role={binding.role}
      data-state={binding.state}>
      <div className='chiner-metrics-binding-row-main'>
        <div className='chiner-metrics-binding-row-title'>
          {metric.revision || metric.definition
            ? <strong>{(metric.definition || {}).name}</strong>
            : <strong>{(metric.concept || {}).name || (metric.concept || {}).id}</strong>}
          {metric.revision && <code>v{metric.version}</code>}
          {renderRoleTag(binding.role)}
          {renderBindingStateTag(binding.state)}
          {item.fingerprintStatus !== 'match' && item.endpoint.present
            ? <span className='chiner-metrics-tag chiner-metrics-tag-warn'
              data-testid='metrics-binding-fp-changed'>
              <FormatMessage id={FINGERPRINT_KEYS[item.fingerprintStatus]}/>
            </span> : null}
          {!item.endpoint.present
            ? <span className='chiner-metrics-tag chiner-metrics-tag-warn'
              data-testid='metrics-binding-endpoint-missing'>
              <FormatMessage id='metrics.binding.endpointMissing'/>
            </span> : null}
        </div>
        <div className='chiner-metrics-binding-row-meta'>
          {metric.definition && <span><code>{metric.definition.code}</code></span>}
          {metric.definition && renderScopeBadge(metric.definition.scope)}
          {metric.concept && <span>{(metric.concept || {}).domain}
            {' / '}{(metric.concept || {}).name}</span>}
          {field && <span className='chiner-metrics-binding-field'>
            <FormatMessage id='metrics.binding.endpointField'/>
            {field.defKey || field.id}
          </span>}
          {!item.endpoint.present && binding.modelRef.fieldKey
            && <span className='chiner-metrics-binding-field'>
              <FormatMessage id='metrics.binding.endpointSnapshot'/>
              {binding.modelRef.objectName || binding.modelRef.objectKey}
              {'.'}{binding.modelRef.fieldKey}
            </span>}
          {binding.evidence && binding.evidence.note
            ? <span title={binding.evidence.note}>{binding.evidence.note}</span> : null}
          {binding.state === 'unresolved' && binding.unresolved
            ? <span className='chiner-metrics-binding-unresolved-reason'>
              <FormatMessage id='metrics.binding.unresolvedWhy'/>
              {binding.unresolved.reason}
            </span> : null}
        </div>
      </div>
      <div className='chiner-metrics-binding-row-actions'>
        {(metric.definition || metric.revision) && onOpenMetric && <button
          type='button'
          className='chiner-metrics-btn chiner-metrics-btn-mini'
          data-testid='metrics-binding-open-definition'
          onClick={() => openDefinitionOf(item)}>
          <FormatMessage id='metrics.binding.openDefinition'/>
        </button>}
        {metric.revision && onOpenMetric && <button
          type='button'
          className='chiner-metrics-btn chiner-metrics-btn-mini'
          data-testid='metrics-binding-open-lineage'
          onClick={() => openLineageOf(item)}>
          <FormatMessage id='metrics.binding.openLineage'/>
        </button>}
        {writable && binding.state === 'suggested'
          && (metric.revision == null || metric.metricStatus === 'published')
          && <button
            type='button'
            className='chiner-metrics-btn chiner-metrics-btn-mini chiner-metrics-btn-primary'
            data-testid='metrics-binding-confirm'
            onClick={() => onConfirmBinding(item)}>
            <FormatMessage id='metrics.binding.confirm'/>
          </button>}
        {writable && binding.state === 'unresolved' && item.endpoint.present && <button
          type='button'
          className='chiner-metrics-btn chiner-metrics-btn-mini chiner-metrics-btn-primary'
          data-testid='metrics-binding-restore'
          onClick={() => onRestoreBinding(item)}>
          <FormatMessage id='metrics.binding.restore'/>
        </button>}
        {writable && binding.state !== 'released' && <button
          type='button'
          className='chiner-metrics-btn chiner-metrics-btn-mini chiner-metrics-binding-release'
          data-testid='metrics-binding-release'
          onClick={() => onReleaseBinding(item)}>
          <FormatMessage id='metrics.binding.release'/>
        </button>}
      </div>
    </div>;
  };

  const targetOptionsForRole = (role) => {
    if (role === 'COMPUTES_FROM') return revisionOptions.filter(o => o.kind === 'atomic');
    return revisionOptions;
  };
  const selectedRevision = linkForm.targetKind === 'revision'
    ? targetOptionsForRole(linkForm.role)
      .filter(o => o.revisionId === linkForm.revisionId)[0] : null;

  return <section
    className='chiner-metrics-model-panel'
    data-testid='model-metric-panel'
    data-collection={collection}
    data-object-id={objectId}>
    <header className='chiner-metrics-model-panel-header'>
      <div>
        <h3 data-testid='model-metric-panel-title'>
          <FormatMessage id='metrics.binding.panelTitle'/>
          <span className='chiner-metrics-tag'>
            <FormatMessage id={COLLECTION_LAYER_KEYS[collection] || 'metrics.model.physical'}/>
          </span>
        </h3>
        <p className='chiner-metrics-page-sub'>
          <FormatMessage id={collection === 'entities'
            ? 'metrics.binding.panelSubPhysical' : 'metrics.binding.panelSubSemantic'}/>
        </p>
      </div>
      {writable && <button
        type='button'
        className='chiner-metrics-btn chiner-metrics-btn-primary'
        data-testid='metrics-binding-add'
        onClick={() => {
          setLinkOpen(true);
          setLinkErrors([]);
        }}>
        <FormatMessage id='metrics.binding.addExisting'/>
      </button>}
      {!writable && <button
        type='button'
        className='chiner-metrics-btn chiner-metrics-btn-primary'
        data-testid='metrics-binding-add'
        disabled
        title={FormatMessage.string({id: 'metrics.binding.emptyReadonly'})}>
        <FormatMessage id='metrics.binding.addExisting'/>
      </button>}
    </header>

    <div
      className='chiner-metrics-binding-banner'
      role='status'
      data-testid='metrics-binding-banner'>
      <FormatMessage
        id='metrics.binding.banner'
        data={{sources: computeSourceCount,
          total: active.length,
          metric: model == null ? (objectId || '') : (model.defName || model.defKey || objectId)}}/>
    </div>

    {active.length === 0 && released.length === 0 ? <div
      className='chiner-metrics-empty chiner-metrics-binding-empty'
      data-testid='metrics-binding-empty'>
      <h3><FormatMessage id='metrics.binding.emptyTitle'/></h3>
      <p><FormatMessage id={writable
        ? 'metrics.binding.emptyDesc' : 'metrics.binding.emptyReadonly'}/></p>
    </div> : null}

    {allowedRoles.map(role => (byRole[role] || []).length > 0 ? <div
      key={role}
      className='chiner-metrics-binding-group'
      data-testid='metrics-binding-group'
      data-role={role}>
      <div className='chiner-metrics-binding-group-head'>
        {renderRoleTag(role)}
        <span className='chiner-metrics-binding-group-count'>
          {(byRole[role] || []).length}</span>
        <span className='chiner-metrics-binding-group-dir'>
          <FormatMessage id={directionTextKey(role)}/>
        </span>
      </div>
      <div className='chiner-metrics-binding-rows'>
        {(byRole[role] || []).map(renderBindingRow)}
      </div>
    </div> : null)}

    {declaredRows.length > 0 && <div
      className='chiner-metrics-binding-group chiner-metrics-declared-group'
      data-testid='metrics-declared-group'>
      <div className='chiner-metrics-binding-group-head'>
        <span className='chiner-metrics-binding-group-title'>
          <FormatMessage id='metrics.binding.declared.title'/>
        </span>
        <span className='chiner-metrics-binding-group-count'>{declaredRows.length}</span>
        <span className='chiner-metrics-tag chiner-metrics-binding-role-DECLARED'
          data-testid='metrics-declared-tag'>
          <FormatMessage id='metrics.binding.declared.tag'/>
        </span>
      </div>
      <p className='chiner-metrics-binding-group-empty chiner-metrics-declared-note'>
        <FormatMessage id='metrics.binding.declared.note'/>
      </p>
      <div className='chiner-metrics-binding-rows'>
        {declaredRows.map(entry => <div
          key={entry.ownerId}
          className='chiner-metrics-binding-row chiner-metrics-declared-row'
          data-testid='metrics-declared-row'
          data-revision-id={entry.ownerId}>
          <div className='chiner-metrics-binding-row-main'>
            <div className='chiner-metrics-binding-row-title'>
              {entry.definition && <strong>{entry.definition.name}</strong>}
              <code>v{entry.revision.version}</code>
              {renderStatusBadge(entry.revision.status)}
              <span className='chiner-metrics-tag chiner-metrics-binding-role-DECLARED'>
                <FormatMessage id='metrics.binding.declared.tag'/>
              </span>
              {entry.designOnly && <span className='chiner-metrics-tag chiner-metrics-tag-warn'>
                <FormatMessage id='metrics.binding.declared.designOnly'/>
              </span>}
              {entry.fieldMissing && <span
                className='chiner-metrics-tag chiner-metrics-tag-warn'
                data-testid='metrics-declared-field-missing'>
                <FormatMessage id='metrics.binding.endpointMissing'/>
              </span>}
            </div>
            <div className='chiner-metrics-binding-row-meta'>
              {entry.definition && <span><code>{entry.definition.code}</code></span>}
              <span className='chiner-metrics-binding-field'>
                {entry.fieldMissing
                  ? <FormatMessage id='metrics.binding.endpointMissing'/>
                  : (entry.endpoint.field
                    ? <><FormatMessage id='metrics.binding.endpointField'/>
                      {entry.endpoint.field.defKey || entry.endpoint.field.id}</>
                    : <FormatMessage id='metrics.binding.declared.modelLevel'/>)}
              </span>
            </div>
          </div>
          <div className='chiner-metrics-binding-row-actions'>
            {onOpenMetric && <button
              type='button'
              className='chiner-metrics-btn chiner-metrics-btn-mini'
              data-testid='metrics-declared-open-definition'
              onClick={() => onOpenMetric({
                module: 'definition',
                definitionId: entry.revision.definitionId,
                revisionId: entry.ownerId,
                mode: 'view',
              })}>
              <FormatMessage id='metrics.binding.openDefinition'/>
            </button>}
          </div>
        </div>)}
      </div>
    </div>}

    {released.length > 0 ? <div className='chiner-metrics-binding-released'>
      <button
        type='button'
        className='chiner-metrics-btn chiner-metrics-btn-mini'
        data-testid='metrics-binding-toggle-released'
        aria-expanded={showReleased}
        onClick={() => setShowReleased(pre => !pre)}>
        <FormatMessage id={showReleased
          ? 'metrics.binding.hideReleased' : 'metrics.binding.showReleased'}
        data={{count: released.length}}/>
      </button>
      {showReleased && <div className='chiner-metrics-binding-rows'
        data-testid='metrics-binding-released-rows'>
        {released.map(renderBindingRow)}
      </div>}
    </div> : null}

    {linkOpen && <div
      className='chiner-metrics-binding-form'
      data-testid='metrics-binding-form'>
      <h4><FormatMessage id='metrics.binding.formTitle'/></h4>
      <div className='chiner-metrics-binding-form-grid'>
        <label>
          <span><FormatMessage id='metrics.binding.form.role'/></span>
          <select
            data-testid='metrics-binding-form-role'
            value={linkForm.role}
            disabled={readOnly}
            onChange={e => updateLinkForm({role: e.target.value, revisionId: '',
              targetKind: 'revision'})}>
            {allowedRoles.map(role => <option
              key={role}
              value={role}>{FormatMessage.string({id: BINDING_ROLE_KEYS[role]})}</option>)}
          </select>
        </label>
        {linkForm.role === 'SEMANTIC_MATCH' && <label>
          <span><FormatMessage id='metrics.binding.form.targetKind'/></span>
          <select
            data-testid='metrics-binding-form-target-kind'
            value={linkForm.targetKind}
            disabled={readOnly}
            onChange={e => updateLinkForm({targetKind: e.target.value, revisionId: '',
              conceptId: ''})}>
            <option value='revision'>
              {FormatMessage.string({id: 'metrics.binding.form.targetRevision'})}
            </option>
            <option value='concept'>
              {FormatMessage.string({id: 'metrics.binding.form.targetConcept'})}
            </option>
          </select>
        </label>}
        {linkForm.targetKind === 'revision' && <label>
          <span><FormatMessage id='metrics.binding.form.revision'/></span>
          <select
            data-testid='metrics-binding-form-revision'
            value={linkForm.revisionId}
            disabled={readOnly}
            onChange={e => updateLinkForm({revisionId: e.target.value})}>
            <option value=''>
              {FormatMessage.string({id: linkForm.role === 'COMPUTES_FROM'
                ? 'metrics.binding.form.selectAtomic' : 'metrics.binding.form.selectRevision'})}
            </option>
            {targetOptionsForRole(linkForm.role).map(option => <option
              key={option.revisionId}
              value={option.revisionId}>
              {`${option.name} @ v${option.version} · ${option.code}`}
            </option>)}
          </select>
        </label>}
        {linkForm.role === 'SEMANTIC_MATCH' && linkForm.targetKind === 'concept' && <label>
          <span><FormatMessage id='metrics.binding.form.concept'/></span>
          <select
            data-testid='metrics-binding-form-concept'
            value={linkForm.conceptId}
            disabled={readOnly}
            onChange={e => updateLinkForm({conceptId: e.target.value})}>
            <option value=''>{FormatMessage.string({id: 'metrics.binding.form.selectConcept'})}</option>
            {concepts.map(concept => <option key={concept.id} value={concept.id}>
              {`${concept.domain} / ${concept.name}`}
            </option>)}
          </select>
        </label>}
        {collection !== 'conceptEntities' && <label>
          <span><FormatMessage id='metrics.binding.form.endpointField'/></span>
          <select
            data-testid='metrics-binding-form-field'
            value={linkForm.fieldId}
            disabled={readOnly}
            onChange={e => updateLinkForm({fieldId: e.target.value})}>
            <option value=''>
              {FormatMessage.string({id: linkForm.role === 'MATERIALIZES_INTO'
                ? 'metrics.binding.form.fieldRequired' : 'metrics.binding.form.fieldOptional'})}
            </option>
            {fields.map(field => <option key={field.id} value={field.id}>
              {`${field.defKey || field.id} · ${field.defName || ''}`}
            </option>)}
          </select>
        </label>}
        {linkForm.role === 'COMPUTES_FROM' && selectedRevision
          && (selectedRevision.spec || {}).aggregation && <label>
          <span><FormatMessage id='metrics.binding.form.aggregate'/></span>
          <input
            readOnly
            data-testid='metrics-binding-form-aggregate'
            value={selectedRevision.spec.aggregation}/>
        </label>}
        {linkForm.role === 'COMPUTES_FROM' && <label>
          <span><FormatMessage id='metrics.binding.form.timeField'/></span>
          <select
            data-testid='metrics-binding-form-timefield'
            value={linkForm.timeFieldId}
            disabled={readOnly}
            onChange={e => updateLinkForm({timeFieldId: e.target.value})}>
            <option value=''>{FormatMessage.string({id: 'metrics.binding.form.timeFieldNone'})}</option>
            {fields.map(field => <option key={field.id} value={field.id}>
              {field.defKey || field.id}
            </option>)}
          </select>
        </label>}
        {(linkForm.role === 'MATERIALIZES_INTO' || linkForm.role === 'CONSUMED_BY') && <label>
          <span><FormatMessage id='metrics.binding.form.usage'/></span>
          <input
            data-testid='metrics-binding-form-usage'
            value={linkForm.usage}
            disabled={readOnly}
            placeholder={FormatMessage.string({id: 'metrics.binding.form.usagePlaceholder'})}
            onChange={e => updateLinkForm({usage: e.target.value})}/>
        </label>}
        {linkForm.role === 'SEMANTIC_MATCH' && <label>
          <span><FormatMessage id='metrics.binding.form.description'/></span>
          <input
            data-testid='metrics-binding-form-description'
            value={linkForm.description}
            disabled={readOnly}
            placeholder={FormatMessage.string({id: 'metrics.binding.form.descriptionPlaceholder'})}
            onChange={e => updateLinkForm({description: e.target.value})}/>
        </label>}
        <label>
          <span><FormatMessage id='metrics.binding.form.state'/></span>
          <select
            data-testid='metrics-binding-form-state'
            value={linkForm.state}
            disabled={readOnly}
            onChange={e => updateLinkForm({state: e.target.value})}>
            <option value='suggested'>
              {FormatMessage.string({id: 'metrics.binding.state.suggested'})}
            </option>
            <option value='confirmed'>
              {FormatMessage.string({id: 'metrics.binding.state.confirmed'})}
            </option>
          </select>
        </label>
        <label>
          <span><FormatMessage id='metrics.binding.form.evidence'/></span>
          <input
            data-testid='metrics-binding-form-evidence'
            value={linkForm.evidenceNote}
            disabled={readOnly}
            placeholder={FormatMessage.string({id: 'metrics.binding.form.evidencePlaceholder'})}
            onChange={e => updateLinkForm({evidenceNote: e.target.value})}/>
        </label>
      </div>
      <p className='chiner-metrics-binding-dir-preview' role='status'
        data-testid='metrics-binding-dir-preview'>
        <FormatMessage id={directionTextKey(linkForm.role)}/>
        {linkForm.targetKind === 'revision' && linkForm.revisionId
          ? (selectedRevision ? ` · ${selectedRevision.name} @ v${selectedRevision.version}` : '')
          : ''}
      </p>
      <p className='chiner-metrics-field-hint'>
        <FormatMessage id='metrics.binding.form.hint'/>
      </p>
      <div className='chiner-metrics-binding-form-actions'>
        <button
          type='button'
          className='chiner-metrics-btn chiner-metrics-btn-primary'
          data-testid='metrics-binding-submit'
          disabled={submitDisabled}
          onClick={submitLinkForm}>
          <FormatMessage id='metrics.binding.submit'/>
        </button>
        <button
          type='button'
          className='chiner-metrics-btn'
          data-testid='metrics-binding-cancel'
          onClick={cancelLinkForm}>
          <FormatMessage id='metrics.binding.cancel'/>
        </button>
      </div>
      {linkErrors.length > 0 && <div className='chiner-metrics-field-errors'
        data-testid='metrics-binding-form-errors'>
        {linkErrors.map((error, i) => <div key={i}>{renderMetricErrorText(error)}</div>)}
      </div>}
    </div>}

    {fieldRows.length > 0 && <div
      className='chiner-metrics-binding-fields'
      data-testid='metrics-binding-fields'>
      <div className='chiner-metrics-binding-fields-head'>
        <h4><FormatMessage id='metrics.binding.fieldsTitle'/></h4>
        {writable && <p className='chiner-metrics-field-hint'>
          <FormatMessage id='metrics.binding.fieldsHint'/>
        </p>}
      </div>
      <table className='chiner-metrics-table' data-testid='metrics-binding-fields-table'>
        <thead>
          <tr>
            <th><FormatMessage id='metrics.binding.col.field'/></th>
            <th><FormatMessage id='metrics.binding.col.type'/></th>
            <th><FormatMessage id='metrics.binding.col.metricRoles'/></th>
            <th><FormatMessage id='metrics.binding.col.actions'/></th>
          </tr>
        </thead>
        <tbody>
          {fieldRows.map(({field, hits, declaredHits}) => <tr
            key={field.id}
            data-testid='metrics-binding-field-row'
            data-field-id={field.id}>
            <td>
              <div className='chiner-metrics-cell-name'>
                <strong>{field.defKey || field.id}</strong>
                <code>{field.defName || field.defKey || field.id}</code>
              </div>
            </td>
            <td><code>{field.type || ''}</code></td>
            <td>
              {hits.map(item => <span
                key={item.binding.id}
                className='chiner-metrics-binding-field-ref'
                data-testid='metrics-binding-field-ref'>
                {renderRoleTag(item.binding.role)}
                {item.metric.definition
                  ? <span>{item.metric.definition.name}
                    {item.metric.version ? ' @ v' + item.metric.version : ''}</span>
                  : <span>{(item.metric.concept || {}).name || ''}</span>}
              </span>)}
              {declaredHits.map(entry => <span
                key={'declared-' + entry.ownerId}
                className='chiner-metrics-binding-field-ref'
                data-testid='metrics-declared-field-ref'>
                <span className='chiner-metrics-tag chiner-metrics-binding-role-DECLARED'>
                  <FormatMessage id='metrics.binding.declared.tag'/>
                </span>
                {entry.definition
                  ? <span>{entry.definition.name} @ v{entry.revision.version}</span> : null}
              </span>)}
              {hits.length === 0 && declaredHits.length === 0
                ? <span className='chiner-metrics-muted'>—</span> : null}
            </td>
            <td>
              {writable && onOpenMetric && <button
                type='button'
                className='chiner-metrics-btn chiner-metrics-btn-mini'
                data-testid='metrics-binding-define-atomic'
                title={FormatMessage.string({id: 'metrics.binding.defineAtomicHint'})}
                onClick={() => fromFieldDefine(field)}>
                <FormatMessage id='metrics.binding.defineAtomic'/>
              </button>}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}
  </section>;
};

export default React.memo(ModelMetricPanel);
