import React, { useMemo, useRef, useState } from 'react';
import { Button, FormatMessage, Message, openModal, SearchInput } from 'components';
import {FixedSizeList} from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import WordRoots from '../../../components/fieldrecommendation/WordRoots';
import CombinationEdit from './CombinationEdit';
import DictionaryImport from './DictionaryImport';
import FieldStandards from './FieldStandards';
import FieldMetaEdit from './FieldMetaEdit';
import {saveFile} from '../../../lib/json';
import {exportLibraryPackage, importLibraryPackage} from '../../../lib/data_standard_library';
import {getPrefix} from '../../../lib/prefixUtil';
import './style/index.less';

const label = key => FormatMessage.string({id: `dataStandard.${key}`});
const rootLabel = key => FormatMessage.string({id: `fieldRecommendation.${key}`});
const normalized = value => (value === undefined || value === null ? '' : String(value))
  .normalize('NFKC').trim().toLocaleLowerCase();

// Left-side "Data Standards" workspace: word-root browsing (virtualized for
// dictionary-scale libraries), field-standard management with the combination
// editor, library exchange packages and read-only dictionary import.
export default ({prefix, dataSource, updateDataSource, openStandardEdit}) => {
  const currentPrefix = getPrefix(prefix);
  const [page, setPage] = useState('roots');
  const [filter, setFilter] = useState('');
  const fileInput = useRef(null);
  const dataSourceRef = useRef(dataSource);
  dataSourceRef.current = dataSource;
  const roots = dataSource.profile?.fieldRecommendation?.wordRoots || [];
  const standardFields = dataSource.standardFields || [];
  const finalRoots = useMemo(() => {
    const query = normalized(filter);
    if (!query) return roots;
    return roots.filter(root => [root.defName, root.defKey, root.fullName]
      .some(value => normalized(value).includes(query)));
  }, [roots, filter]);
  const typeName = useMemo(() => {
    const map = new Map((dataSource.dataTypeMapping?.mappings || [])
      .map(type => [type.id, type.defName || type.defKey]));
    return id => map.get(id) || '';
  }, [dataSource.dataTypeMapping]);
  const openRootsManager = () => {
    let modal;
    // The editor owns its footer (save / guarded close) so drafts cannot be
    // dropped silently by the modal chrome.
    modal = openModal(<WordRoots
      getDataSource={() => dataSourceRef.current}
      updateDataSource={updateDataSource}
      onClose={() => modal.close()}
    />, {
      title: rootLabel('manageRoots'),
      bodyStyle: {width: '75%'},
      contentStyle: {maxHeight: '80vh'},
      // No outer X / Escape: every close path runs through the draft guard.
      closeable: false,
      buttons: [],
    });
  };
  const openCombination = (field, group) => {
    let modal;
    modal = openModal(<CombinationEdit
      prefix={prefix}
      dataSource={dataSourceRef.current}
      updateDataSource={updateDataSource}
      onClose={() => modal.close()}
      editField={field ? {field, group} : null}
    />, {
      title: label('combinationTitle'),
      bodyStyle: {width: '60%'},
      closeable: false,
      buttons: [],
    });
  };
  const openMetaEdit = (field, group) => {
    let modal;
    modal = openModal(<FieldMetaEdit
      prefix={prefix}
      dataSource={dataSourceRef.current}
      updateDataSource={updateDataSource}
      field={field}
      group={group}
      onClose={() => modal.close()}
    />, {
      title: label('metaTitle'),
      bodyStyle: {width: '50%'},
      closeable: false,
      buttons: [],
    });
  };
  const exportPackage = async () => {
    const result = exportLibraryPackage(roots, standardFields, dataSourceRef.current);
    if (result.error) {
      Message.error({title: FormatMessage.string({id: 'optFail'}), message: rootLabel(result.error)});
      return;
    }
    try {
      await saveFile(JSON.stringify(result.data, null, 2), [{name: 'JSON', extensions: ['json']}],
        undefined, {defaultPath: `${dataSource.name || 'project'}-data-standard-library.json`});
    } catch (error) {
      if (error.message) Message.error({title: FormatMessage.string({id: 'optFail'})});
    }
  };
  const commitPackage = (data, releaseUnresolved) => {
    const result = importLibraryPackage(data, dataSourceRef.current,
      () => Math.uuid(), {releaseUnresolved});
    if (result.error) {
      Message.error({title: FormatMessage.string({id: 'optFail'}),
        message: rootLabel(result.error) || label('invalidPackage')});
      return;
    }
    updateDataSource({
      ...dataSourceRef.current,
      profile: {
        ...dataSourceRef.current.profile,
        fieldRecommendation: {
          ...(dataSourceRef.current.profile?.fieldRecommendation || {}),
          wordRoots: result.roots,
        },
      },
      standardFields: result.standardFields,
    });
    Message.success({title: label(releaseUnresolved ? 'packageImportedReleased' : 'packageImported')});
  };
  const importPackage = async (event) => {
    const input = event.target;
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (error) {
      Message.error({title: FormatMessage.string({id: 'optFail'}), message: label('invalidPackage')});
      return;
    }
    const result = importLibraryPackage(data, dataSourceRef.current, () => Math.uuid());
    if (result.error === 'unresolvedRefs') {
      let modal;
      modal = openModal(<div className={`${currentPrefix}-data-standard-unresolved`}>
        <p>{label('unresolvedTitle')}</p>
        {result.unresolved.map(item => <p key={item.fieldKey}>
          {`${item.fieldKey}(${item.fieldName || ''}) -> ${item.rootIds.join(', ')}`}
        </p>)}
      </div>, {
        title: label('importPackage'),
        buttons: [
          <Button
            key='release'
            type='primary'
            onClick={() => {
            commitPackage(data, true);
            modal.close();
          }}>{label('unresolvedRelease')}</Button>,
          <Button key='cancel' onClick={() => modal.close()}>{label('unresolvedCancel')}</Button>,
        ],
      });
      return;
    }
    if (result.error) {
      Message.error({title: FormatMessage.string({id: 'optFail'}), message: label('invalidPackage')});
      return;
    }
    commitPackage(data, false);
  };
  const RootRow = ({index, style}) => {
    const root = finalRoots[index];
    return <div style={style} className={`${currentPrefix}-data-standard-root-row`}>
      <span className={`${currentPrefix}-data-standard-root-name`}>{root.defName}</span>
      <span className={`${currentPrefix}-data-standard-root-key`}>{root.defKey}</span>
      <span className={`${currentPrefix}-data-standard-root-full`}>{root.fullName || ''}</span>
      <span className={`${currentPrefix}-data-standard-root-type`}>{typeName(root.baseType)}</span>
    </div>;
  };
  const pages = [
    {key: 'roots', name: label('rootsPage')},
    {key: 'fields', name: label('fieldsPage')},
    {key: 'import', name: label('importPage')},
  ];
  return <div className={`${currentPrefix}-data-standard`}>
    <div className={`${currentPrefix}-data-standard-header`}>
      <div className={`${currentPrefix}-data-standard-tabs`}>
        {pages.map(item => <span
          key={item.key}
          className={`${currentPrefix}-data-standard-tab-${page === item.key ? 'active' : 'normal'}`}
          onClick={() => setPage(item.key)}>
          {item.name}
        </span>)}
      </div>
      <div className={`${currentPrefix}-data-standard-header-opt`}>
        {page === 'roots' && <Button onClick={openRootsManager}>{label('editRoots')}</Button>}
        {page === 'fields' && <div className={`${currentPrefix}-data-standard-actions`}>
          <Button onClick={() => openStandardEdit && openStandardEdit()}>{label('editFields')}</Button>
          <Button onClick={() => openCombination()}>{label('combination')}</Button>
          <Button onClick={exportPackage}>{label('exportPackage')}</Button>
          <Button onClick={() => fileInput.current.click()}>{label('importPackage')}</Button>
          <input ref={fileInput} type='file' accept='.json,application/json' hidden onChange={importPackage}/>
        </div>}
      </div>
    </div>
    {page === 'roots' && <div className={`${currentPrefix}-data-standard-body`}>
      <SearchInput
        placeholder={label('rootsSearch')}
        onChange={e => setFilter(e.target.value)}/>
      {finalRoots.length ? <div className={`${currentPrefix}-data-standard-list`}>
        <AutoSizer>
          {({height, width}) => <FixedSizeList
            height={height}
            width={width}
            itemCount={finalRoots.length}
            itemSize={26}>
            {RootRow}
          </FixedSizeList>}
        </AutoSizer>
      </div> : <p className={`${currentPrefix}-data-standard-empty`}>{label('rootsEmpty')}</p>}
      <span className={`${currentPrefix}-data-standard-count`}>
        {`${finalRoots.length} / ${roots.length} ${label('rootCount')}`}
      </span>
    </div>}
    {page === 'fields' && <div className={`${currentPrefix}-data-standard-body`}>
      <FieldStandards
        prefix={prefix}
        dataSource={dataSource}
        updateDataSource={updateDataSource}
        openMetaEdit={openMetaEdit}
        openCombination={openCombination}/>
    </div>}
    {/* The import preview stays mounted across page switches so a pending
        draft is never lost; only its visibility changes. */}
    <div
      className={`${currentPrefix}-data-standard-body`}
      style={{display: page === 'import' ? 'flex' : 'none'}}>
      <DictionaryImport
        prefix={prefix}
        dataSource={dataSource}
        updateDataSource={updateDataSource}/>
    </div>
  </div>;
};
