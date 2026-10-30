import React, {useRef, useState} from 'react';
import {Button, Checkbox, FormatMessage, Input, Message, Select} from 'components';
import {getPrefix} from '../../../lib/prefixUtil';

const label = key => FormatMessage.string({id: `dataStandard.${key}`});
const rootLabel = key => FormatMessage.string({id: `fieldRecommendation.${key}`});

// Build the next standardMeta from a metadata draft. Overwrite semantics are
// explicit: clearing aliases / frequent / source must really remove those
// keys, never keep the old values alive through conditional spreads.
export const buildFieldMeta = (draft, meta) => {
  const aliases = (draft.aliases || []).map(alias => alias.trim()).filter(Boolean);
  const source = [draft.sourceName.trim(), draft.sourceVersion.trim()].some(Boolean) ? {
    ...(draft.sourceName.trim() ? {name: draft.sourceName.trim()} : {}),
    ...(draft.sourceVersion.trim() ? {version: draft.sourceVersion.trim()} : {}),
    ...(meta.source?.sheet !== undefined ? {sheet: meta.source.sheet} : {}),
    ...(meta.source?.row !== undefined ? {row: meta.source.row} : {}),
  } : undefined;
  const nextMeta = {};
  if (aliases.length) nextMeta.aliases = aliases;
  if (draft.scope !== 'project' || meta.scope) nextMeta.scope = draft.scope;
  if (draft.industry.trim()) nextMeta.industry = draft.industry.trim();
  if (draft.frequent) nextMeta.frequent = true;
  if (meta.wordRootRefs) nextMeta.wordRootRefs = meta.wordRootRefs;
  if (meta.namingForm) nextMeta.namingForm = meta.namingForm;
  if (source) nextMeta.source = source;
  return nextMeta;
};

// Per-field metadata editor: aliases, scope/industry, frequent flag and
// source. The primary Chinese name is standard CONTENT (ADR-006) — it is
// maintained through the combination editor's explicit apply-preview-naming
// entry, never silently here. Entity fields are never touched.
export default ({prefix, dataSource, updateDataSource, field, group, onClose}) => {
  const currentPrefix = getPrefix(prefix);
  const meta = field.standardMeta || {};
  const initial = () => ({
    aliases: [...(meta.aliases || [])],
    scope: meta.scope || 'project',
    industry: meta.industry || '',
    frequent: !!meta.frequent,
    sourceName: meta.source?.name || '',
    sourceVersion: meta.source?.version || '',
  });
  const [draft, setDraft] = useState(initial);
  const initialText = useRef(JSON.stringify(initial()));
  const [askClose, setAskClose] = useState(false);
  const [error, setError] = useState('');
  const roots = dataSource.profile?.fieldRecommendation?.wordRoots || [];
  const dirty = () => JSON.stringify(draft) !== initialText.current;
  const set = (patch) => {
    setError('');
    setDraft(previous => ({...previous, ...patch}));
  };
  const commit = () => {
    const nextMeta = buildFieldMeta(draft, meta);
    updateDataSource({
      ...dataSource,
      standardFields: (dataSource.standardFields || []).map(item => (item.id !== group.id ? item : {
        ...item,
        fields: (item.fields || []).map((f) => {
          if (f.id !== field.id) return f;
          const next = {...f};
          if (Object.keys(nextMeta).length) next.standardMeta = nextMeta;
          else delete next.standardMeta;
          return next;
        }),
      })),
    });
    Message.success({title: FormatMessage.string({id: 'optSuccess'})});
    onClose();
  };
  const requestClose = () => {
    if (dirty()) setAskClose(true);
    else onClose();
  };
  const refs = meta.wordRootRefs || [];
  return <div className={`${currentPrefix}-data-standard-meta-edit`}>
    <p>{`${group.defName || group.defKey} / ${field.defName}(${field.defKey})`}</p>
    <div className={`${currentPrefix}-data-standard-combination-form`}>
      <div>
        {label('scopeLabel')}
        <Select
          style={{width: 120}}
          value={draft.scope}
          onChange={e => set({scope: e.target.value})}>
          {['common', 'industry', 'project'].map(item => <Select.Option key={item} value={item}>
            {label(`scope_${item}`)}
          </Select.Option>)}
        </Select>
      </div>
      <div>
        {label('industryLabel')}
        <Input value={draft.industry} onChange={e => set({industry: e.target.value})}/>
      </div>
      <div>
        {label('sourceName')}
        <Input value={draft.sourceName} onChange={e => set({sourceName: e.target.value})}/>
      </div>
      <div>
        {label('sourceVersion')}
        <Input value={draft.sourceVersion} onChange={e => set({sourceVersion: e.target.value})}/>
      </div>
      <div>
        {label('frequentLabel')}
        <Checkbox
          checked={draft.frequent}
          onChange={() => set({frequent: !draft.frequent})}/>
      </div>
    </div>
    <div className={`${currentPrefix}-data-standard-actions`}>
      <span>{label('aliasesLabel')}</span>
      <Button onClick={() => set({aliases: draft.aliases.concat([''])})}>{label('addAlias')}</Button>
    </div>
    {draft.aliases.map((alias, index) => <div
      key={index}
      className={`${currentPrefix}-data-standard-import-row`}>
      <Input
        aria-label={label('aliasesLabel')}
        value={alias}
        onChange={e => set({aliases: draft.aliases
          .map((item, i) => (i === index ? e.target.value : item))})}/>
      <button
        type='button'
        onClick={() => set({aliases: draft.aliases.filter((item, i) => i !== index)})}>
        {rootLabel('deleteReference')}
      </button>
    </div>)}
    <div className={`${currentPrefix}-data-standard-actions`}>
      <span>{label('refsLabel')}</span>
      {refs.length ? refs.map(id => roots.find(root => root.id === id))
        .filter(Boolean)
        .map((root, index) => <span
          key={root.id}>{`${index + 1}. ${root.defName}(${root.defKey})`}</span>)
        : <span>{label('noRefs')}</span>}
    </div>
    {error && <p className={`${currentPrefix}-data-standard-warning`}>{error}</p>}
    {askClose ? <div role='alertdialog' className={`${currentPrefix}-data-standard-dirty`}>
      <span>{rootLabel('dirtyTitle')}</span>
      <Button type='primary' onClick={() => commit()}>{rootLabel('dirtySave')}</Button>
      <Button onClick={onClose}>{rootLabel('dirtyDiscard')}</Button>
      <Button onClick={() => setAskClose(false)}>{rootLabel('dirtyContinue')}</Button>
    </div> : <div className={`${currentPrefix}-data-standard-actions`}>
      <Button type='primary' onClick={() => commit()}>{label('updateField')}</Button>
      <Button onClick={requestClose}>{FormatMessage.string({id: 'button.cancel'})}</Button>
    </div>}
  </div>;
};
