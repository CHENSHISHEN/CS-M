import React, {useMemo, useState, useEffect, useRef} from 'react';
import {FormatMessage, Message, Modal} from 'components';
import {metricApi, runMetricCommand, QUALIFIER_OP_KEYS, qualifierValueToText} from './commands';
import {renderErrorList, renderStatusBadge} from './parts';

// 指标平台 M3A/M3B：语义字典维护页（替换原 PendingPage）。
// - 分类：业务域/概念（复用 concepts，不建第二事实源）、部门、维度、业务限定、统计周期、单位；
// - 全部读写经纯函数字典层（createDictionaryEntry/updateDictionaryEntry/deleteDictionaryEntry）
//   与概念层（createMetricConcept/updateMetricConcept/deleteMetricConcept），
//   一次命令一次 updateDataSource；
// - 被草案/发布/部门 scope 引用的条目删除与语义改动被拒绝（DICTIONARY_IN_USE /
//   CONCEPT_IN_USE），引导停用或迁移；概念稳定 ID 不变，名称/说明可维护；
// - 维度带明确值类型；限定值按维度类型严格解析（'001' 字符串型保持字符串）；
// - 只读禁写、空态如实、不自动生成演示数据；
// - M3B 脏守卫：新增/编辑表单离开（切分类/切页/关项目）先确认，空表单直接离开，
//   取消保留、确认清理，同一动作只弹一次确认（外壳经 onDirtyChange 感知活动页脏状态）。

const CATEGORIES = ['concepts', 'departments', 'dimensions', 'qualifiers', 'periods', 'units'];
const VALUE_TYPES = ['string', 'number', 'boolean'];
const TIMEZONES = ['Asia/Shanghai', 'UTC'];

const emptyDictForm = (category) => ({
  code: '',
  name: '',
  description: '',
  ...(category === 'concepts' ? {domain: '', meaning: ''} : {}),
  ...(category === 'dimensions' ? {valueType: 'string'} : {}),
  ...(category === 'qualifiers' ? {dimensionId: '', op: 'eq', value: ''} : {}),
  ...(category === 'periods' ? {
    windowType: 'calendarDays', windowLength: '7', windowEnd: 'yesterday',
    windowTimezone: 'Asia/Shanghai',
  } : {}),
});

const formFromEntry = (category, entry) => ({
  code: entry.code,
  name: entry.name,
  description: entry.description || '',
  ...(category === 'concepts' ? {
    domain: entry.domain || '',
    meaning: entry.meaning || '',
  } : {}),
  ...(category === 'dimensions' ? {valueType: entry.valueType} : {}),
  ...(category === 'qualifiers' ? {
    dimensionId: entry.dimensionId,
    op: entry.op,
    value: qualifierValueToText(entry.value),
  } : {}),
  ...(category === 'periods' ? {
    windowType: entry.window.type,
    windowLength: String(entry.window.length),
    windowEnd: entry.window.end,
    windowTimezone: entry.window.timezone,
  } : {}),
});

const inputFromForm = (category, form) => ({
  code: form.code.trim(),
  name: form.name.trim(),
  ...(form.description.trim() === '' ? {} : {description: form.description.trim()}),
  ...(category === 'dimensions' ? {valueType: form.valueType} : {}),
  ...(category === 'qualifiers' ? {dimensionId: form.dimensionId, op: form.op, value: form.value} : {}),
  ...(category === 'periods' ? {
    window: {
      type: form.windowType,
      length: Number(form.windowLength),
      end: form.windowEnd,
      timezone: form.windowTimezone,
    },
  } : {}),
});

const windowSummary = (window) => `${window.length} ${
  window.type === 'rollingHours'
    ? FormatMessage.string({id: 'metrics.window.rollingHours'})
    : FormatMessage.string({id: 'metrics.window.calendarDays'})} · ${
  window.end === 'today'
    ? FormatMessage.string({id: 'metrics.window.today'})
    : FormatMessage.string({id: 'metrics.window.yesterday'})} · ${window.timezone}`;

const opSymbol = (op) => ({
  eq: '=', not_eq: '≠', in: '∈', not_in: '∉',
  gt: '>', gte: '≥', lt: '<', lte: '≤',
}[op] || op);

// 概念引用（M3B 起由领域层提供，与字典引用同形状）：引用位置是定义归属 definition.conceptId

const DictionaryPage = ({source, commandRunner, readOnly, onDirtyChange}) => {
  const [category, setCategory] = useState('departments');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyDictForm('departments'));
  const [editing, setEditing] = useState(null); // {category, id, form, base, entry}
  const [commandErrors, setCommandErrors] = useState([]);
  const [refsFor, setRefsFor] = useState(null); // {category, id, code} | null
  const dirtyRef = useRef(false);

  const store = useMemo(() => metricApi.readMetricPlatform(source), [source]);
  const dictionary = useMemo(() => metricApi.readMetricDictionary(source), [source]);
  const dimensions = dictionary.dimensions || [];

  const entries = useMemo(() => {
    if (category === 'concepts') {
      const needle = search.trim().toLowerCase();
      return (store.concepts || []).filter(c => needle === ''
        || (c.domain || '').toLowerCase().indexOf(needle) >= 0
        || (c.name || '').toLowerCase().indexOf(needle) >= 0);
    }
    return metricApi.listDictionaryEntries(source, category,
      search.trim() === '' ? null : {search: search.trim()});
  }, [source, store, category, search]);

  // ---- 脏状态（M3B）：新增表单偏离空表单 / 编辑表单偏离原条目，二者任一即脏 ----
  const formDirty = formOpen
    && JSON.stringify(form) !== JSON.stringify(emptyDictForm(category));
  const editingDirty = editing != null
    && JSON.stringify(editing.form) !== JSON.stringify(editing.base);
  const dirty = formDirty || editingDirty;
  dirtyRef.current = dirty;
  useEffect(() => {
    onDirtyChange && onDirtyChange(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // 脏守卫：空表单直接离开；有未提交内容时单次确认（确定=放弃清理，取消=保留）
  const confirmLoseForm = (apply) => {
    if (!dirtyRef.current) {
      apply();
      return;
    }
    Modal.confirm({
      title: FormatMessage.string({id: 'metrics.dirty.title'}),
      message: FormatMessage.string({id: 'metrics.dirty.message'}),
      onOk: apply,
    });
  };

  const runDict = (run, afterOk) => {
    setCommandErrors([]);
    const result = runMetricCommand(commandRunner, run);
    if (result && result.ok) {
      afterOk && afterOk(result);
    } else {
      setCommandErrors((result && result.errors) || []);
    }
    return result;
  };

  const switchCategory = (next) => {
    confirmLoseForm(() => {
      setCategory(next);
      setSearch('');
      setFormOpen(false);
      setForm(emptyDictForm(next));
      setEditing(null);
      setRefsFor(null);
      setCommandErrors([]);
    });
  };

  const openCreateForm = () => {
    confirmLoseForm(() => {
      setFormOpen(pre => !pre);
      setForm(emptyDictForm(category));
      setEditing(null);
      setCommandErrors([]);
    });
  };

  const openEditForm = (entry) => {
    confirmLoseForm(() => {
      setEditing({category, id: entry.id, form: formFromEntry(category, entry),
        base: formFromEntry(category, entry), entry});
      setFormOpen(false);
      setCommandErrors([]);
    });
  };

  const submitCreate = () => {
    if (category === 'concepts') {
      runDict(latest => metricApi.createMetricConcept(latest, {
        domain: form.domain.trim(),
        name: form.name.trim(),
        ...(form.meaning.trim() === '' ? {} : {meaning: form.meaning.trim()}),
      }), () => {
        setForm(emptyDictForm(category));
        setFormOpen(false);
        Message.success({title: FormatMessage.string({id: 'metrics.concept.created'})});
      });
      return;
    }
    runDict(latest => metricApi.createDictionaryEntry(latest, category, inputFromForm(category, form)),
      () => {
        setForm(emptyDictForm(category));
        setFormOpen(false);
        Message.success({title: FormatMessage.string({id: 'metrics.dictionary.saved'})});
      });
  };

  const submitEdit = () => {
    const target = editing;
    if (target.category === 'concepts') {
      const patch = {
        name: target.form.name.trim(),
        ...(target.form.meaning.trim() === '' ? {meaning: null} : {meaning: target.form.meaning.trim()}),
        ...(target.form.domain.trim() !== target.entry.domain
          ? {domain: target.form.domain.trim()} : {}),
      };
      runDict(latest => metricApi.updateMetricConcept(latest, target.id, patch), () => {
        setEditing(null);
        Message.success({title: FormatMessage.string({id: 'metrics.concept.saved'})});
      });
      return;
    }
    runDict(latest => metricApi.updateDictionaryEntry(latest, target.category,
      target.id, inputFromForm(target.category, target.form)), () => {
      setEditing(null);
      Message.success({title: FormatMessage.string({id: 'metrics.dictionary.saved'})});
    });
  };

  const toggleStatus = (entry) => {
    const nextStatus = entry.status === 'disabled' ? 'active' : 'disabled';
    runDict(latest => metricApi.updateDictionaryEntry(latest, category, entry.id, {status: nextStatus}));
  };

  const removeEntry = (entry) => {
    const conceptDelete = category === 'concepts';
    Modal.confirm({
      title: FormatMessage.string({id: conceptDelete
        ? 'metrics.concept.deleteTitle' : 'metrics.dictionary.deleteTitle'}),
      message: FormatMessage.string({id: conceptDelete
        ? 'metrics.concept.deleteMessage' : 'metrics.dictionary.deleteMessage'}),
      onOk: () => {
        const result = conceptDelete
          ? runDict(latest => metricApi.deleteMetricConcept(latest, entry.id))
          : runDict(latest => metricApi.deleteDictionaryEntry(latest, category, entry.id));
        // 被引用拒绝时不静默：顺带展开引用面板，明确“为何不能删、可停用/可迁移”
        if (result && !result.ok && (result.errors || []).some(e =>
          e.code === 'DICTIONARY_IN_USE' || e.code === 'CONCEPT_IN_USE')) {
          setRefsFor({category, id: entry.id, code: entry.code || entry.name});
        }
      },
    });
  };

  const updateFormState = (patch) => setForm(pre => ({...pre, ...patch}));
  const updateEditingState = (patch) => setEditing(pre => (pre ? {...pre, form: {...pre.form, ...patch}} : pre));

  // 被引用概念：业务域为实质语义键，编辑时锁定（领域层同样拒绝，双保险）
  const conceptDomainLocked = editing != null && editing.category === 'concepts'
    && metricApi.listConceptReferences(source, editing.id).length > 0;

  // 表单字段（新增/编辑共用渲染）
  const renderFormFields = (current, update, formCategory) => <>
    {formCategory === 'concepts' && <input
      value={current.domain}
      onChange={e => update({domain: e.target.value})}
      placeholder={FormatMessage.string({id: 'metrics.concept.domainPlaceholder'})}
      aria-label={FormatMessage.string({id: 'metrics.concept.domainPlaceholder'})}
      disabled={readOnly || conceptDomainLocked}
      title={conceptDomainLocked
        ? FormatMessage.string({id: 'metrics.concept.domainLocked'}) : undefined}
      data-testid='metrics-dictf-domain'
    />}
    {formCategory !== 'concepts' && <input
      value={current.code}
      onChange={e => update({code: e.target.value})}
      placeholder={FormatMessage.string({id: 'metrics.dictionary.codePlaceholder'})}
      aria-label={FormatMessage.string({id: 'metrics.dictionary.col.code'})}
      disabled={readOnly || (editing != null && editing.category === formCategory)}
      className='chiner-metrics-mono'
      data-testid='metrics-dictf-code'
    />}
    <input
      value={current.name}
      onChange={e => update({name: e.target.value})}
      placeholder={FormatMessage.string({id: 'metrics.dictionary.namePlaceholder'})}
      aria-label={FormatMessage.string({id: 'metrics.dictionary.col.name'})}
      disabled={readOnly}
      data-testid='metrics-dictf-name'
    />
    {formCategory === 'concepts' && <input
      value={current.meaning}
      onChange={e => update({meaning: e.target.value})}
      placeholder={FormatMessage.string({id: 'metrics.concept.meaningPlaceholder'})}
      aria-label={FormatMessage.string({id: 'metrics.concept.meaning'})}
      disabled={readOnly}
      data-testid='metrics-dictf-meaning'
    />}
    {formCategory === 'dimensions' && <select
      value={current.valueType}
      onChange={e => update({valueType: e.target.value})}
      disabled={readOnly}
      aria-label={FormatMessage.string({id: 'metrics.dictionary.valueTypeLabel'})}
      data-testid='metrics-dictf-valuetype'
    >
      {VALUE_TYPES.map(t => <option key={t} value={t}>
        {FormatMessage.string({id: `metrics.dictionary.valueType.${t}`})}
      </option>)}
    </select>}
    {formCategory === 'qualifiers' && <>
      <select
        value={current.dimensionId}
        onChange={e => update({dimensionId: e.target.value})}
        disabled={readOnly}
        aria-label={FormatMessage.string({id: 'metrics.dictionary.dimension'})}
        data-testid='metrics-dictf-dimension'
      >
        <option value=''>{FormatMessage.string({id: 'metrics.form.selectDimension'})}</option>
        {dimensions.map(d => <option key={d.id} value={d.code}>{d.name}（{d.code}）</option>)}
      </select>
      <select
        value={current.op}
        onChange={e => update({op: e.target.value})}
        disabled={readOnly}
        aria-label={FormatMessage.string({id: 'metrics.form.op'})}
        data-testid='metrics-dictf-op'
      >
        {Object.keys(QUALIFIER_OP_KEYS).map(op => <option key={op} value={op}>
          {FormatMessage.string({id: QUALIFIER_OP_KEYS[op]})}
        </option>)}
      </select>
      <input
        value={current.value}
        onChange={e => update({value: e.target.value})}
        placeholder={FormatMessage.string({id: 'metrics.form.valuePlaceholder'})}
        aria-label={FormatMessage.string({id: 'metrics.form.value'})}
        disabled={readOnly}
        data-testid='metrics-dictf-value'
      />
    </>}
    {formCategory === 'periods' && <>
      <select
        value={current.windowType}
        onChange={e => update({windowType: e.target.value})}
        disabled={readOnly}
        aria-label={FormatMessage.string({id: 'metrics.form.windowType'})}
        data-testid='metrics-dictf-window-type'
      >
        <option value='calendarDays'>{FormatMessage.string({id: 'metrics.window.calendarDays'})}</option>
        <option value='rollingHours'>{FormatMessage.string({id: 'metrics.window.rollingHours'})}</option>
      </select>
      <input
        type='number'
        min='1'
        value={current.windowLength}
        onChange={e => update({windowLength: e.target.value})}
        disabled={readOnly}
        aria-label={FormatMessage.string({id: 'metrics.form.windowLength'})}
        data-testid='metrics-dictf-window-length'
      />
      <select
        value={current.windowEnd}
        onChange={e => update({windowEnd: e.target.value})}
        disabled={readOnly}
        aria-label={FormatMessage.string({id: 'metrics.form.windowEnd'})}
        data-testid='metrics-dictf-window-end'
      >
        <option value='yesterday'>{FormatMessage.string({id: 'metrics.window.yesterday'})}</option>
        <option value='today'>{FormatMessage.string({id: 'metrics.window.today'})}</option>
      </select>
      <select
        value={current.windowTimezone}
        onChange={e => update({windowTimezone: e.target.value})}
        disabled={readOnly}
        aria-label={FormatMessage.string({id: 'metrics.form.windowTimezone'})}
        data-testid='metrics-dictf-window-timezone'
      >
        {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
      </select>
    </>}
    <input
      value={current.description}
      onChange={e => update({description: e.target.value})}
      placeholder={FormatMessage.string({id: 'metrics.dictionary.descriptionPlaceholder'})}
      aria-label={FormatMessage.string({id: 'metrics.dictionary.descriptionPlaceholder'})}
      disabled={readOnly}
      data-testid='metrics-dictf-description'
    />
  </>;

  const renderEntryDetail = (entry) => {
    if (category === 'concepts') return <span>{entry.domain}</span>;
    if (category === 'dimensions') return <span className='chiner-metrics-tag'>
      <FormatMessage id={`metrics.dictionary.valueType.${entry.valueType}`}/>
    </span>;
    if (category === 'qualifiers') return <span
      className='chiner-metrics-mono'>{entry.dimensionId} {opSymbol(entry.op)} {
      qualifierValueToText(entry.value)}</span>;
    if (category === 'periods') return <span>{windowSummary(entry.window)}</span>;
    return <span>{entry.description || '—'}</span>;
  };

  const activeRefs = refsFor == null ? [] : (refsFor.category === 'concepts'
    ? metricApi.listConceptReferences(source, refsFor.id)
    : metricApi.listDictionaryReferences(source, refsFor.category, refsFor.id));

  return <section className='chiner-metrics-page' data-testid='metrics-dictionary-page'>
    <header className='chiner-metrics-page-header'>
      <div>
        <h2 data-testid='metrics-dictionary-title'><FormatMessage id='metrics.dictionary.title'/></h2>
        <p className='chiner-metrics-page-sub'><FormatMessage id='metrics.dictionary.subtitle'/></p>
      </div>
      <button
        type='button'
        className='chiner-metrics-btn chiner-metrics-btn-primary'
        data-testid='metrics-dict-add'
        disabled={readOnly}
        onClick={openCreateForm}
      >
        <FormatMessage id='metrics.dictionary.add'/>
      </button>
    </header>

    <div className='chiner-metrics-catalog-filters'>
      <div className='chiner-metrics-seg' role='group'
        aria-label={FormatMessage.string({id: 'metrics.dictionary.title'})}>
        {CATEGORIES.map(cat => <button
          key={cat}
          type='button'
          className={category === cat ? 'active' : ''}
          onClick={() => switchCategory(cat)}
          data-testid={`metrics-dict-cat-${cat}`}
        >
          <FormatMessage id={`metrics.dictionary.cat.${cat}`}/>
        </button>)}
      </div>
      <input
        className='chiner-metrics-search'
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={FormatMessage.string({id: 'metrics.dictionary.searchPlaceholder'})}
        aria-label={FormatMessage.string({id: 'metrics.dictionary.searchPlaceholder'})}
        data-testid='metrics-dictionary-search'
      />
    </div>

    {category === 'concepts' && <p className='chiner-metrics-muted chiner-metrics-dict-note'>
      <FormatMessage id='metrics.dictionary.conceptNote'/>
    </p>}

    {formOpen && <div className='chiner-metrics-dict-form' data-testid='metrics-dict-form'>
      {renderFormFields(form, updateFormState, category)}
      <span className='chiner-metrics-form-buttons'>
        <button
          type='button'
          className='chiner-metrics-btn chiner-metrics-btn-primary'
          data-testid='metrics-dict-submit'
          disabled={readOnly}
          onClick={submitCreate}
        >
          <FormatMessage id='metrics.dictionary.save'/>
        </button>
        <button
          type='button'
          className='chiner-metrics-btn'
          data-testid='metrics-dict-cancel'
          onClick={() => confirmLoseForm(() => setFormOpen(false))}
        >
          <FormatMessage id='metrics.dictionary.cancel'/>
        </button>
      </span>
    </div>}

    {commandErrors.length > 0 && <div className='chiner-metrics-field-errors'>
      {renderErrorList({errors: commandErrors, testId: 'metrics-dict-errors'})}
    </div>}

    {entries.length === 0 ? <div className='chiner-metrics-empty' data-testid='metrics-dict-empty'>
      <h3><FormatMessage id='metrics.dictionary.emptyTitle'/></h3>
      <p><FormatMessage id='metrics.dictionary.emptyDesc'/></p>
    </div> : <div className='chiner-metrics-table-wrap'>
      <table className='chiner-metrics-table' data-testid='metrics-dict-table'>
        <thead>
          <tr>
            <th><FormatMessage id='metrics.dictionary.col.code'/></th>
            <th><FormatMessage id='metrics.dictionary.col.name'/></th>
            <th><FormatMessage id='metrics.dictionary.col.detail'/></th>
            {category !== 'concepts' && <th><FormatMessage id='metrics.dictionary.col.status'/></th>}
            <th><FormatMessage id='metrics.dictionary.col.refs'/></th>
            <th><FormatMessage id='metrics.dictionary.col.actions'/></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => {
            const isEditing = editing != null && editing.category === category
              && editing.id === entry.id;
            return <tr
              key={entry.id}
              data-testid='metrics-dict-row'
              data-entry-id={entry.id}
            >
              {isEditing ? <td colSpan={category === 'concepts' ? 5 : 6}>
                <div className='chiner-metrics-dict-form' data-testid='metrics-dict-edit-form'>
                  {renderFormFields(editing.form, updateEditingState, category)}
                  <span className='chiner-metrics-form-buttons'>
                    <button
                      type='button'
                      className='chiner-metrics-btn chiner-metrics-btn-primary'
                      data-testid='metrics-dict-edit-submit'
                      disabled={readOnly}
                      onClick={submitEdit}
                    >
                      <FormatMessage id='metrics.dictionary.save'/>
                    </button>
                    <button
                      type='button'
                      className='chiner-metrics-btn'
                      onClick={() => confirmLoseForm(() => setEditing(null))}
                    >
                      <FormatMessage id='metrics.dictionary.cancel'/>
                    </button>
                  </span>
                </div>
              </td> : <>
                <td><code className='chiner-metrics-mono'>
                  {category === 'concepts' ? entry.id : entry.code}
                </code></td>
                <td>{entry.name}</td>
                <td>{renderEntryDetail(entry)}</td>
                {category !== 'concepts' && <td>
                  {entry.status === 'disabled'
                    ? <span className='chiner-metrics-tag chiner-metrics-tag-status-deprecated'>
                      <FormatMessage id='metrics.dictionary.statusDisabled'/>
                    </span>
                    : <span className='chiner-metrics-tag chiner-metrics-tag-status-published'>
                      <FormatMessage id='metrics.dictionary.statusActive'/>
                    </span>}
                </td>}
                <td>
                  <button
                    type='button'
                    className='chiner-metrics-btn chiner-metrics-btn-ghost'
                    data-testid='metrics-dict-refs'
                    onClick={() => setRefsFor(refsFor && refsFor.id === entry.id
                      ? null : {category, id: entry.id, code: entry.code || entry.name})}
                  >
                    <FormatMessage id='metrics.dictionary.refsView'/>
                  </button>
                </td>
                <td>
                  <div className='chiner-metrics-cell-actions'>
                    {category !== 'concepts' && <>
                      <button
                        type='button'
                        className='chiner-metrics-btn'
                        data-testid='metrics-dict-edit'
                        disabled={readOnly}
                        onClick={() => openEditForm(entry)}
                      >
                        <FormatMessage id='metrics.dictionary.edit'/>
                      </button>
                      <button
                        type='button'
                        className='chiner-metrics-btn'
                        data-testid='metrics-dict-toggle'
                        disabled={readOnly}
                        onClick={() => toggleStatus(entry)}
                      >
                        <FormatMessage id={entry.status === 'disabled'
                          ? 'metrics.dictionary.enable' : 'metrics.dictionary.disable'}/>
                      </button>
                    </>}
                    {category === 'concepts' && <button
                      type='button'
                      className='chiner-metrics-btn'
                      data-testid='metrics-dict-edit'
                      disabled={readOnly}
                      onClick={() => openEditForm(entry)}
                    >
                      <FormatMessage id='metrics.concept.edit'/>
                    </button>}
                    <button
                      type='button'
                      className='chiner-metrics-btn chiner-metrics-btn-danger'
                      data-testid='metrics-dict-delete'
                      disabled={readOnly}
                      onClick={() => removeEntry(entry)}
                    >
                      <FormatMessage id={category === 'concepts'
                        ? 'metrics.concept.delete' : 'metrics.dictionary.delete'}/>
                    </button>
                  </div>
                </td>
              </>}
            </tr>;
          })}
        </tbody>
      </table>
      <p className='chiner-metrics-table-note'>
        <FormatMessage id='metrics.dictionary.footerNote' data={{count: entries.length}}/>
      </p>
    </div>}

    {refsFor != null && <div className='chiner-metrics-side-card' data-testid='metrics-dict-ref-list'>
      <h3><FormatMessage id='metrics.dictionary.refsTitle' data={{code: refsFor.code}}/></h3>
      {activeRefs.length === 0 ? <p className='chiner-metrics-muted'>
        <FormatMessage id='metrics.dictionary.refsEmpty'/>
      </p> : <ul className='chiner-metrics-deplist'>
        {activeRefs.map(ref => <li key={`${ref.definitionId}-${ref.revisionId}`}>
          <strong>{ref.definitionName}</strong>
          <code>{ref.definitionCode}</code>
          {ref.version ? <span className='chiner-metrics-tag'>v{ref.version}</span> : null}
          {ref.status ? renderStatusBadge(ref.status) : null}
          <span className='chiner-metrics-fact-list'>
            {ref.where.map(where => <code key={where} className='chiner-metrics-mono'>{where}</code>)}
          </span>
        </li>)}
      </ul>}
      {activeRefs.length > 0 && <p className='chiner-metrics-table-note'>
        <FormatMessage id='metrics.dictionary.refsNote'/>
      </p>}
    </div>}
  </section>;
};

export default React.memo(DictionaryPage);
