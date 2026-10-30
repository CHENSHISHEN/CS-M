import React, { useMemo, useRef, useState } from 'react';
import { Button, Checkbox, FormatMessage, Message, Select } from 'components';
import {readDictionaryWorkbook} from '../../../lib/dictionary_excel';
import {classifyDictionaryRows, applyDictionaryImport} from '../../../lib/data_standard_library';
import {getPrefix} from '../../../lib/prefixUtil';

const label = key => FormatMessage.string({id: `dataStandard.${key}`});
const LIMIT = 200;

// Read-only dictionary import: parse -> classify -> preview with per-category
// decisions -> atomic apply. Nothing is written until the final apply; the
// confirmed codes of existing items are never overwritten.
export default ({prefix, dataSource, updateDataSource}) => {
  const currentPrefix = getPrefix(prefix);
  const fileInput = useRef(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [classified, setClassified] = useState(null);
  // Selection state keyed by `defKey\0defName` per importable entry.
  const [checked, setChecked] = useState(() => new Set());
  const [fills, setFills] = useState(() => new Set());
  const [aliasChoice, setAliasChoice] = useState({});
  const [conflictChoice, setConflictChoice] = useState({});
  const [expanded, setExpanded] = useState(() => new Set());

  const entryKey = entry => `${entry.defKey}\0${entry.defName}`;
  const keyOf = (category, entry) => `${category}:${entryKey(entry)}`;
  const allKeys = (category, entries) => entries.map(entry => keyOf(category, entry));
  const toggleOne = (category, entry) => {
    setChecked((previous) => {
      const next = new Set(previous);
      const key = keyOf(category, entry);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleExpand = (name) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const pickEntries = (category, entries) => entries
    .filter(entry => checked.has(keyOf(category, entry)));

  const onFile = async (event) => {
    const input = event.target;
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    setError('');
    setClassified(null);
    const result = await file.arrayBuffer().then(buffer =>
      readDictionaryWorkbook(Buffer.from(buffer), {name: file.name}));
    if (result.error) {
      setError(label(result.error === 'missingSheets' ? 'dictMissingSheets' : 'dictInvalid'));
      return;
    }
    const next = classifyDictionaryRows(result.rootRows, result.commonRows,
      dataSource.profile?.fieldRecommendation?.wordRoots || [], dataSource.standardFields || []);
    setFileName(file.name);
    setClassified(next);
    // Importable categories default to fully selected; conflicts stay for decisions.
    setChecked(new Set([
      ...allKeys('valid', next.valid),
      ...allKeys('pending', next.pendingFullName),
      ...allKeys('ambiguous', next.ambiguous),
      ...allKeys('commonValid', next.commonValid),
    ]));
    setFills(new Set(next.duplicates
      .filter(d => d.reason === 'duplicateExisting' && d.canFill).map(d => d.existingId)));
    setAliasChoice({});
    setConflictChoice({});
    setExpanded(new Set());
  };

  const applyImport = () => {
    const rootEntries = [
      ...pickEntries('valid', classified.valid),
      ...pickEntries('pending', classified.pendingFullName),
      ...pickEntries('ambiguous', classified.ambiguous),
    ];
    const fillEntries = classified.duplicates
      .filter(d => d.reason === 'duplicateExisting' && d.canFill && fills.has(d.existingId));
    const commonEntries = pickEntries('commonValid', classified.commonValid);
    const aliasGroups = classified.commonAliasGroups.map((group, index) => {
      const primary = aliasChoice[index] || '';
      return {
        ...group,
        defName: primary,
        aliases: (group.aliasOptions || []).filter(name => name !== primary),
        decision: (group.aliasOptions || []).includes(primary) ? 'alias' : '',
        conflict: !(group.aliasOptions || []).includes(primary),
      };
    });
    // Existing-code conflicts default to keeping the confirmed standard; the
    // explicit alias decision merges the new Chinese name as an alias.
    const commonConflicts = classified.commonConflicts.map((entry, index) => ({
      ...entry,
      decision: conflictChoice[index] || '',
    }));
    if (!rootEntries.length && !fillEntries.length && !commonEntries.length
      && !aliasGroups.some(group => !group.conflict)
      && !commonConflicts.some(entry => entry.decision === 'alias')) {
      setError(label('dictNoData'));
      return;
    }
    const result = applyDictionaryImport({
      rootEntries: rootEntries.concat(fillEntries),
      commonEntries,
      aliasGroups,
      commonConflicts,
    }, dataSource, () => Math.uuid());
    updateDataSource({
      ...dataSource,
      profile: {
        ...dataSource.profile,
        fieldRecommendation: {
          ...(dataSource.profile?.fieldRecommendation || {}),
          wordRoots: result.roots,
        },
      },
      standardFields: result.standardFields,
    });
    Message.success({title: label('importApplied')});
    setClassified(null);
    setFileName('');
  };

  const rowsOf = (category, entries, renderRow) => {
    if (!entries.length) return null;
    const isOpen = expanded.has(category);
    const shown = isOpen ? entries : entries.slice(0, LIMIT);
    return <div key={category} className={`${currentPrefix}-data-standard-import-section`}>
      <div className={`${currentPrefix}-data-standard-import-head`}>
        <span>{label(category)}</span>
        <span className={`${currentPrefix}-data-standard-import-count`}>{entries.length}</span>
      </div>
      <div className={`${currentPrefix}-data-standard-import-rows`}>
        {shown.map((entry, index) => renderRow(entry, index))}
        {entries.length > LIMIT && <button type='button' onClick={() => toggleExpand(category)}>
          {isOpen ? label('showLess') : `${label('showAll')} (${entries.length} ${label('moreRows')})`}
        </button>}
      </div>
    </div>;
  };

  const summary = useMemo(() => {
    if (!classified) return null;
    return [
      ['valid', classified.valid],
      ['pending', classified.pendingFullName],
      ['ambiguous', classified.ambiguous],
      ['commonValid', classified.commonValid],
    ];
  }, [classified]);

  return <div className={`${currentPrefix}-data-standard-import`}>
    <div className={`${currentPrefix}-data-standard-actions`}>
      <Button type='primary' onClick={() => fileInput.current.click()}>{label('dictFile')}</Button>
      <input ref={fileInput} type='file' accept='.xlsx,.xlsm' hidden onChange={onFile}/>
      {fileName && <span className={`${currentPrefix}-data-standard-import-file`}>{fileName}</span>}
      {classified && <span className={`${currentPrefix}-data-standard-import-hint`}>
        {label('pendingImportHint')}
      </span>}
      {classified && <Button onClick={applyImport} type='primary'>{label('applyImport')}</Button>}
    </div>
    {error && <p className={`${currentPrefix}-data-standard-warning`}>{error}</p>}
    {classified && <div className={`${currentPrefix}-data-standard-import-preview`}>
      {summary.map(([category, entries]) => rowsOf(category, entries, entry => <div
        key={keyOf(category, entry)}
        className={`${currentPrefix}-data-standard-import-row`}>
        <Checkbox
          checked={checked.has(keyOf(category, entry))}
          onChange={() => toggleOne(category, entry)}/>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{entry.defName}</span>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{entry.defKey}</span>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{entry.fullName || ''}</span>
        {category === 'ambiguous' && entry.ambiguousWith && <span
          className={`${currentPrefix}-data-standard-import-hint`}>{label('ambiguousWith')}: {entry.ambiguousWith.join(', ')}</span>}
        {category === 'ambiguous' && entry.codeSharedWith && <span
          className={`${currentPrefix}-data-standard-import-hint`}>{label('codeSharedWith')}: {entry.codeSharedWith.join(', ')}</span>}
      </div>))}
      {rowsOf('catDuplicates', classified.duplicates, entry => <div
        key={`${entryKey(entry)}${entry.reason}`}
        className={`${currentPrefix}-data-standard-import-row`}>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{entry.defName}</span>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{entry.defKey}</span>
        <span className={`${currentPrefix}-data-standard-import-hint`}>{label(`reason${entry.reason === 'duplicateInFile' ? 'DuplicateInFile' : 'DuplicateExisting'}`)}</span>
        {entry.reason === 'duplicateExisting' && entry.canFill && <span>
          <Checkbox
            checked={fills.has(entry.existingId)}
            onChange={() => setFills((previous) => {
              const next = new Set(previous);
              if (next.has(entry.existingId)) next.delete(entry.existingId);
              else next.add(entry.existingId);
              return next;
            })}/>
          {label('fillFullName')}: {entry.fullName}
        </span>}
      </div>)}
      {rowsOf('catCommonConflicts', classified.commonConflicts, (entry, index) => <div
        key={entryKey(entry)}
        className={`${currentPrefix}-data-standard-import-row`}>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{entry.defName}</span>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{entry.defKey}</span>
        <span className={`${currentPrefix}-data-standard-import-hint`}>
          {label('conflictsWith')}: {(entry.existingNames || []).join(', ')}
        </span>
        <Select
          notAllowEmpty
          style={{width: '50%'}}
          value={conflictChoice[index] || ''}
          onChange={e => setConflictChoice(previous => ({...previous, [index]: e.target.value}))}>
          <Select.Option key='keep' value=''>{label('commonConflictKeep')}</Select.Option>
          <Select.Option key='alias' value='alias'>{label('commonConflictAlias')}</Select.Option>
        </Select>
      </div>)}
      {rowsOf('catCommonAlias', classified.commonAliasGroups, (group, index) => <div
        key={group.defKey}
        className={`${currentPrefix}-data-standard-import-row`}>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{group.defKey}</span>
        <Select
          notAllowEmpty
          style={{width: '60%'}}
          value={aliasChoice[index] || ''}
          onChange={e => setAliasChoice(previous => ({...previous, [index]: e.target.value}))}>
          {/* Keep one flat option array: mapped options and the fixed mark
              must not be siblings (the Select iterates child.props.value). */}
          {[
            <Select.Option key='pending' value=''>{label('aliasPending')}</Select.Option>,
            ...group.aliasOptions.map(name => <Select.Option
              key={name}
              value={name}>{`${label('aliasConfirm')}: ${name}`}</Select.Option>),
            <Select.Option key='__conflict__' value='__conflict__'>{label('conflictMark')}</Select.Option>,
          ]}
        </Select>
      </div>)}
      {rowsOf('catInvalid', classified.invalid, entry => <div
        key={`${entryKey(entry)}invalid`}
        className={`${currentPrefix}-data-standard-import-row`}>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{entry.defName || '-'}</span>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{entry.defKey || '-'}</span>
      </div>)}
      {rowsOf('catCommonInvalid', classified.commonInvalid, entry => <div
        key={`${entryKey(entry)}common`}
        className={`${currentPrefix}-data-standard-import-row`}>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{entry.defName || '-'}</span>
        <span className={`${currentPrefix}-data-standard-import-cell`}>{entry.defKey || '-'}</span>
      </div>)}
    </div>}
  </div>;
};
