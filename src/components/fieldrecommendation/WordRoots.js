import React, {useMemo, useRef, useState} from 'react';
import {Button, FormatMessage, Select} from 'components';
import {saveFile} from '../../lib/json';
import {validateWordRoots, exportWordRoots, importWordRoots} from '../../lib/field_recommendation';
import {findRootReferences} from '../../lib/data_standard_library';

const label = key => FormatMessage.string({id: `fieldRecommendation.${key}`});
const PAGE_SIZE = 50;
const SCOPES = ['common', 'industry', 'project'];

// Draft guard shared shape: an unsaved editor must offer an explicit
// save / discard choice instead of silently dropping changes.
const DirtyGuard = ({show, onSave, onDiscard, onContinue}) => (!show ? null
  : <div role='alertdialog' className='chiner-field-recommendation-dirty'>
    <span>{label('dirtyTitle')}</span>
    <Button type='primary' onClick={onSave}>{label('dirtySave')}</Button>
    <Button onClick={onDiscard}>{label('dirtyDiscard')}</Button>
    <Button onClick={onContinue}>{label('dirtyContinue')}</Button>
  </div>);

export default ({getDataSource, updateDataSource, onClose}) => {
  const source = getDataSource();
  const initial = () => (source.profile?.fieldRecommendation?.wordRoots || [])
    .map(root => ({...root}));
  const [roots, setRoots] = useState(initial);
  // Snapshot once; serializing a 4k-root draft on every render is too costly.
  const initialRef = useRef(null);
  if (initialRef.current === null) initialRef.current = JSON.stringify(initial());
  const initialText = initialRef;
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState('');
  const [askClose, setAskClose] = useState(false);
  const fileInput = useRef(null);
  const dirty = () => JSON.stringify(roots) !== initialText.current;
  const normalized = value => (value === undefined || value === null ? '' : String(value))
    .normalize('NFKC').trim().toLocaleLowerCase();
  const filtered = useMemo(() => {
    const query = normalized(filter);
    if (!query) return roots;
    return roots.filter(root => [root.defName, root.defKey, root.fullName]
      .some(value => normalized(value).includes(query)));
  }, [roots, filter]);
  // Pagination keeps the input grid bounded for 4k-dictionary libraries.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const update = (id, key, value) => {
    setStatus('');
    setRoots(previous => previous.map(root => (root.id === id ? {...root, [key]: value} : root)));
  };
  const updateMeta = (id, patch) => {
    setStatus('');
    setRoots(previous => previous.map(root => (root.id === id
      ? {...root, standardMeta: {...(root.standardMeta || {}), ...patch}} : root)));
  };
  const updateReference = (id, index, key, value) => {
    setStatus('');
    setRoots(previous => previous.map(root => (root.id === id ? {...root,
      referenceNames: (root.referenceNames || []).map((item, i) => (i === index
        ? {...item, [key]: value} : item))} : root)));
  };
  const addReference = (id) => {
    setStatus('');
    setRoots(previous => previous.map(root => (root.id === id ? {...root,
      referenceNames: [...(root.referenceNames || []), {fullName: '', defKey: ''}]} : root)));
  };
  const removeReference = (id, index) => {
    setStatus('');
    setRoots(previous => previous.map(root => (root.id === id ? {...root,
      referenceNames: (root.referenceNames || []).filter((item, i) => i !== index)} : root)));
  };
  const save = (closeAfter) => {
    const current = getDataSource();
    const result = validateWordRoots(roots, current);
    if (result.error) { setStatus(label(result.error)); return; }
    updateDataSource({
      ...current,
      profile: {...current.profile,
        fieldRecommendation: {
          ...current.profile?.fieldRecommendation, wordRoots: result.roots,
        }},
    });
    // The cleaned result becomes the new draft baseline; otherwise trimmed
    // values / dropped empty rows would look like unsaved changes (false
    // dirty prompts on the next close attempt).
    const cleaned = result.roots.map(root => ({...root}));
    setRoots(cleaned);
    initialText.current = JSON.stringify(cleaned);
    if (closeAfter) { onClose(); return; }
    setStatus(label('saveRoots'));
  };
  const requestClose = () => {
    if (dirty()) setAskClose(true);
    else onClose();
  };
  const importFile = async (event) => {
    const input = event.target;
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const result = importWordRoots(
        JSON.parse(await file.text()), roots, getDataSource(), () => Math.uuid(),
      );
      if (result.error) setStatus(label(result.error));
      else { setRoots(result.roots); setStatus(label('importSuccess')); }
    } catch (error) { setStatus(label('invalidRoots')); }
  };
  const exportFile = async () => {
    const result = exportWordRoots(roots, getDataSource());
    if (result.error) { setStatus(label(result.error)); return; }
    try {
      await saveFile(JSON.stringify(result.data, null, 2), [{name: 'JSON', extensions: ['json']}],
        undefined, {defaultPath: 'word-roots.json'});
      setStatus(label('exportSuccess'));
    } catch (error) {
      if (error.message) setStatus(label('exportError'));
    }
  };
  // Delete protection: a root referenced by any standard field combination
  // must be released there first; the confirmed field code stays untouched.
  const removeRoot = (root) => {
    const references = findRootReferences(root.id, getDataSource().standardFields);
    if (references.length) {
      setStatus(label('rootInUse'));
      return;
    }
    setStatus('');
    setRoots(previous => previous.filter(item => item.id !== root.id));
  };
  const headers = ['defName', 'defKey', 'fullName', 'baseType', 'len', 'scale'];
  const referenceText = root => (root.referenceNames || [])
    .map(name => [name.defKey, name.fullName].filter(Boolean).join('/')).join(', ');
  return <div className='chiner-word-roots-manager'>
    <p>{label('rootHelp')}</p>
    <div className='chiner-field-recommendation-actions'>
      <Button onClick={() => setRoots(previous => previous.concat({
        id: Math.uuid(), defName: '', defKey: '', fullName: '', baseType: '', len: '', scale: '',
      }))}>{label('addRoot')}</Button>
      <Button onClick={() => fileInput.current.click()}>{label('importRoots')}</Button>
      <Button onClick={exportFile}>{label('exportRoots')}</Button>
      <input ref={fileInput} type='file' accept='.json,application/json' hidden onChange={importFile}/>
      <input
        aria-label={label('rootFilter')}
        placeholder={label('rootFilter')}
        value={filter}
        onChange={(event) => { setFilter(event.target.value); setPage(0); }}/>
    </div>
    <div className='chiner-word-roots-scroll'>
      <table>
        <thead><tr>{headers.map(key => <th key={key}>{label(key)}</th>)}<th>{label('referenceNames')}</th><th>{label('operation')}</th></tr></thead>
        <tbody>{pageRows.map(root => <React.Fragment key={root.id}>
          <tr data-root-id={root.id}>
            {headers.map(key => <td key={key}>
              {key === 'baseType' ? <select
                aria-label={label(key)}
                value={root[key]}
                onChange={event => update(root.id, key, event.target.value)}>
                <option value=''>{label('keepType')}</option>
                {(source.dataTypeMapping?.mappings || []).map(type => <option
                  key={type.id}
                  value={type.id}>
                  {type.defName || type.defKey}</option>)}
              </select> : <input
                aria-label={label(key)}
                value={root[key] === undefined ? '' : root[key]}
                type={key === 'len' || key === 'scale' ? 'number' : 'text'}
                min='0'
                step='1'
                onChange={event => update(root.id, key, event.target.value)}/>}
            </td>)}
            <td className='chiner-word-roots-reference'>{referenceText(root)}</td>
            <td>
              <button
                type='button'
                onClick={() => setExpandedId(expandedId === root.id ? '' : root.id)}>
                {expandedId === root.id ? label('rootCollapse') : label('rootDetail')}
              </button>
              <button
                type='button'
                onClick={() => removeRoot(root)}
              >
                {label('deleteRoot')}</button>
            </td>
          </tr>
          {expandedId === root.id && <tr data-root-detail={root.id}>
            <td colSpan={headers.length + 2} className='chiner-word-roots-detail'>
              <div className='chiner-field-recommendation-actions'>
                {label('scopeLabel')}
                <Select
                  style={{width: 120}}
                  value={root.standardMeta?.scope || 'project'}
                  onChange={event => updateMeta(root.id, {scope: event.target.value})}>
                  {SCOPES.map(scope => <Select.Option key={scope} value={scope}>
                    {label(`scope_${scope}`)}
                  </Select.Option>)}
                </Select>
                <span>{label('industryLabel')}</span>
                <input
                  aria-label={label('industryLabel')}
                  value={root.standardMeta?.industry || ''}
                  onChange={event => updateMeta(root.id, {industry: event.target.value})}/>
                <span>{label('sourceName')}</span>
                <input
                  aria-label={label('sourceName')}
                  value={root.standardMeta?.source?.name || ''}
                  onChange={event => updateMeta(root.id,
                    {source: {...(root.standardMeta?.source || {}), name: event.target.value}})}/>
                <span>{label('sourceVersion')}</span>
                <input
                  aria-label={label('sourceVersion')}
                  value={root.standardMeta?.source?.version || ''}
                  onChange={event => updateMeta(root.id, {source: {
                    ...(root.standardMeta?.source || {}),
                    version: event.target.value,
                  }})}/>
              </div>
              <div className='chiner-field-recommendation-actions'>
                <span>{label('referenceNames')}</span>
                <Button onClick={() => addReference(root.id)}>{label('addReference')}</Button>
              </div>
              {(root.referenceNames || []).map((name, index) => <div
                key={index}
                className='chiner-field-recommendation-actions'>
                <span>{label('refFullName')}</span>
                <input
                  aria-label={label('refFullName')}
                  value={name.fullName || ''}
                  onChange={event => updateReference(root.id, index, 'fullName', event.target.value)}/>
                <span>{label('refDefKey')}</span>
                <input
                  aria-label={label('refDefKey')}
                  value={name.defKey || ''}
                  onChange={event => updateReference(root.id, index, 'defKey', event.target.value)}/>
                <button type='button' onClick={() => removeReference(root.id, index)}>
                  {label('deleteReference')}
                </button>
              </div>)}
            </td>
          </tr>}
        </React.Fragment>)}
        </tbody>
      </table>
      {!roots.length && <p className='chiner-field-recommendation-empty'>{label('emptyRoots')}</p>}
      {pageCount > 1 && <div className='chiner-field-recommendation-actions'>
        <Button onClick={() => setPage(Math.max(0, safePage - 1))}>{label('pagePrev')}</Button>
        <span>{`${safePage + 1} / ${pageCount} (${filtered.length} ${label('rootCount')})`}</span>
        <Button onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}>{label('pageNext')}</Button>
      </div>}
    </div>
    {status && <p role='status' className='chiner-field-recommendation-warning'>{status}</p>}
    <DirtyGuard
      show={askClose}
      onSave={() => save(true)}
      onDiscard={() => onClose()}
      onContinue={() => setAskClose(false)}/>
    <div className='chiner-field-recommendation-actions'>
      <Button type='primary' onClick={() => save(false)}>{label('saveRoots')}</Button>
      <Button onClick={requestClose}>{label('close')}</Button>
      <span>{label('saveProjectHint')}</span>
    </div>
  </div>;
};
