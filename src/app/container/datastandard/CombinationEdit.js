import React, { useMemo, useRef, useState } from 'react';
import { Button, FormatMessage, Input, Message, Select } from 'components';
import {composeFullName, composeAbbreviation} from '../../../lib/data_standard_library';
import {getPrefix} from '../../../lib/prefixUtil';
import {previewNamingUpdate, updateTabData} from '../../../lib/standard_sync';

const label = key => FormatMessage.string({id: `dataStandard.${key}`});
const rootLabel = key => FormatMessage.string({id: `fieldRecommendation.${key}`});
const normalized = value => (value === undefined || value === null ? '' : String(value))
  .normalize('NFKC').trim().toLocaleLowerCase();
const PAGE_SIZE = 100;

// Word-root combination editor: ordered root selection with abbreviation and
// full-name previews. Creating a new standard uses the preview code with
// duplicate protection; editing an existing standard only refreshes the
// ordered references; applying preview naming explicitly syncs content.
// Reference names never join the composition.
export default ({prefix, dataSource, updateDataSource, onClose, editField}) => {
  const currentPrefix = getPrefix(prefix);
  const roots = dataSource.profile?.fieldRecommendation?.wordRoots || [];
  const groups = dataSource.standardFields || [];
  const editing = !!(editField && editField.field && editField.group);
  const [selectedIds, setSelectedIds] = useState(() => (editing
    ? [...(editField.field.standardMeta?.wordRootRefs || [])] : []));
  const [filter, setFilter] = useState('');
  const [availPage, setAvailPage] = useState(0);
  const [defName, setDefName] = useState(() => (editing ? editField.field.defName : ''));
  const [groupId, setGroupId] = useState(() => (editing ? editField.group.id : groups[0]?.id || ''));
  const [namingForm, setNamingForm] = useState(() => (editing
    ? editField.field.standardMeta?.namingForm || 'abbreviation' : 'abbreviation'));
  const [error, setError] = useState('');
  const [askClose, setAskClose] = useState(false);
  const initialText = useRef(JSON.stringify({
    ids: editing ? [...(editField.field.standardMeta?.wordRootRefs || [])] : [],
    name: editing ? editField.field.defName : '',
    form: namingForm,
    group: groupId,
  })).current;
  const selected = useMemo(() => selectedIds
    .map(id => roots.find(root => root.id === id)).filter(Boolean), [selectedIds, roots]);
  const matched = useMemo(() => {
    const query = normalized(filter);
    if (!query) return roots;
    return roots.filter(root => normalized(root.defName).includes(query)
      || normalized(root.defKey).includes(query)
      || normalized(root.fullName).includes(query));
  }, [roots, filter]);
  // Candidates are paginated with a visible match count; never a silent slice.
  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const safePage = Math.min(availPage, pageCount - 1);
  const available = matched.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const abbreviation = composeAbbreviation(selected);
  const fullNameResult = useMemo(() => composeFullName(selected), [selected]);
  const previewValue = namingForm === 'full' ? fullNameResult.value : abbreviation;
  const dirty = () => JSON.stringify({
    ids: selectedIds, name: defName, form: namingForm, group: groupId,
  }) !== initialText;
  const move = (index, offset) => {
    setSelectedIds((previous) => {
      const next = [...previous];
      const target = index + offset;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setError('');
  };
  const apply = (applyNaming = false) => {
    setError('');
    if (!selected.length) { setError(label('emptyCombination')); return; }
    if ((!editing || applyNaming) && !defName.trim()) { setError(label('defNameRequired')); return; }
    if ((!editing || applyNaming) && namingForm === 'full') {
      if (fullNameResult.reason === 'missingFullName') { setError(label('missingFullName')); return; }
      if (!fullNameResult.valid) { setError(label('invalidFullName')); return; }
    }
    if (editing) {
      // 保存关联保留已确认的主名称/代码；命名采用须显式同步引用。
      let next = dataSource;
      let change;
      if (applyNaming) {
        const result = previewNamingUpdate({
          dataSource,
          ...editField,
          defKey: previewValue,
          defName: defName.trim(),
        });
        if (result.error) { setError(label(result.error)); return; }
        next = result.dataSource;
        change = result.change;
      }
      updateDataSource({
        ...next,
        standardFields: (next.standardFields || []).map(g => (g.id !== editField.group.id ? g : {
          ...g,
          fields: (g.fields || []).map(f => (f.id !== editField.field.id ? f : {
            ...f,
            standardMeta: {
              ...(f.standardMeta || {}),
              wordRootRefs: [...selectedIds],
              namingForm,
            },
          })),
        })),
      });
      if (change) updateTabData([change]);
      Message.success({title: FormatMessage.string({id: 'optSuccess'})});
      onClose();
      return;
    }
    const group = groups.find(g => g.id === groupId);
    if (!group) { setError(label('groupLabel')); return; }
    const code = namingForm === 'full' ? fullNameResult.value : abbreviation;
    const exists = groups.some(g => (g.fields || [])
      .some(field => normalized(field.defKey) === normalized(code)));
    if (exists) { setError(label('duplicateField')); return; }
    // Inherit base type from the closest typed root, same as recommendations.
    const typed = [...selected].reverse().find(root => root.baseType);
    updateDataSource({
      ...dataSource,
      standardFields: groups.map(g => (g.id === group.id ? {
        ...g,
        fields: (g.fields || []).concat([{
          id: Math.uuid(),
          defKey: code,
          defName: defName.trim(),
          ...(typed ? {baseType: typed.baseType, len: typed.len, scale: typed.scale} : {}),
          standardMeta: {
            wordRootRefs: [...selectedIds],
            namingForm,
          },
        }]),
      } : g)),
    });
    Message.success({title: FormatMessage.string({id: 'optSuccess'})});
    onClose();
  };
  return <div className={`${currentPrefix}-data-standard-combination`}>
    <div className={`${currentPrefix}-data-standard-combination-columns`}>
      <div>
        <p>{label('combinationAvailable')}</p>
        <Input
          placeholder={label('rootsSearch')}
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setAvailPage(0); }}/>
        <span className={`${currentPrefix}-data-standard-count`}>
          {`${matched.length} ${label('matchCount')}`}
        </span>
        <div className={`${currentPrefix}-data-standard-combination-list`}>
          {available.map(root => <div
            key={root.id}
            className={`${currentPrefix}-data-standard-combination-option`}
            onClick={() => {
              setSelectedIds(previous => previous.concat(root.id));
              setError('');
            }}>
            <span>{root.defName}</span>
            <span>{root.defKey}</span>
            <span>{root.fullName || ''}</span>
          </div>)}
          {!available.length && <p className={`${currentPrefix}-data-standard-empty`}>{label('rootsEmpty')}</p>}
          {pageCount > 1 && <div className={`${currentPrefix}-data-standard-actions`}>
            <Button onClick={() => setAvailPage(Math.max(0, safePage - 1))}>
              {rootLabel('pagePrev')}
            </Button>
            <span>{`${safePage + 1} / ${pageCount}`}</span>
            <Button onClick={() => setAvailPage(Math.min(pageCount - 1, safePage + 1))}>
              {rootLabel('pageNext')}
            </Button>
          </div>}
        </div>
      </div>
      <div>
        <p>{label('combinationSelected')}</p>
        <div className={`${currentPrefix}-data-standard-combination-list`}>
          {selected.map((root, index) => <div
            key={`${root.id}-${index}`}
            className={`${currentPrefix}-data-standard-combination-option`}>
            <span>{`${index + 1}. ${root.defName} ${root.defKey}${root.fullName ? `(${root.fullName})` : ''}`}</span>
            <span>
              <button type='button' onClick={() => move(index, -1)}>↑</button>
              <button type='button' onClick={() => move(index, 1)}>↓</button>
              {/* The same root may legitimately appear twice; delete must
                  remove exactly this position, never all same-root slots. */}
              <button
                type='button'
                onClick={() => setSelectedIds(previous => previous
                .filter((id, i) => i !== index))}>✕</button>
            </span>
          </div>)}
          {!selected.length && <p className={`${currentPrefix}-data-standard-empty`}>{label('emptyCombination')}</p>}
        </div>
      </div>
    </div>
    <div className={`${currentPrefix}-data-standard-combination-form`}>
      <div>
        {label('namingForm')}
        <Select
          notAllowEmpty
          value={namingForm}
          onChange={e => setNamingForm(e.target.value)}>
          <Select.Option key='abbreviation' value='abbreviation'>{label('abbreviation')}</Select.Option>
          <Select.Option key='full' value='full'>{label('full')}</Select.Option>
        </Select>
      </div>
      <div>
        {label('defNameLabel')}
        <Input value={defName} onChange={e => setDefName(e.target.value)}/>
      </div>
      {!editing && <div>
        {label('groupLabel')}
        <Select
          notAllowEmpty
          value={groupId}
          onChange={e => setGroupId(e.target.value)}>
          {groups.map(g => <Select.Option
            key={g.id}
            value={g.id}>{g.defName}({g.defKey})</Select.Option>)}
        </Select>
      </div>}
      <div>
        {label('preview')}
        <span className={`${currentPrefix}-data-standard-combination-preview`}>{previewValue}</span>
      </div>
    </div>
    {editing && <p className={`${currentPrefix}-data-standard-count`}>
      {`${label('codeKeepHint')}${editField.field.defKey}`}
    </p>}
    {namingForm === 'full' && fullNameResult.reason === 'missingFullName' && <p className={`${currentPrefix}-data-standard-warning`}>
      {label('missingFullName')}
      {fullNameResult.missing.map(name => `${name};`).join(' ')}
    </p>}
    {error && <p className={`${currentPrefix}-data-standard-warning`}>{error}</p>}
    {askClose ? <div role='alertdialog' className={`${currentPrefix}-data-standard-dirty`}>
      <span>{rootLabel('dirtyTitle')}</span>
      <Button type='primary' onClick={() => apply()}>{rootLabel('dirtySave')}</Button>
      <Button onClick={onClose}>{rootLabel('dirtyDiscard')}</Button>
      <Button onClick={() => setAskClose(false)}>{rootLabel('dirtyContinue')}</Button>
    </div> : <div className={`${currentPrefix}-data-standard-actions`}>
      <Button type='primary' onClick={() => apply()}>{editing ? label('saveAssociation') : label('createField')}</Button>
      {editing && <Button onClick={() => apply(true)}>{label('applyPreviewNaming')}</Button>}
      <Button onClick={() => (dirty() ? setAskClose(true) : onClose())}>
        {FormatMessage.string({id: 'button.cancel'})}
      </Button>
    </div>}
  </div>;
};
