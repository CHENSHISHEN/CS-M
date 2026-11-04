import React, { useState } from 'react';
import { MODEL_COLLECTIONS, sourceObjects, makeAssetRef, resolveAsset, assetOccurrences } from '../../../lib/drawing_platform';
import { t, Field, Action, Dialog, en } from './common';

export const AssetPicker = ({source, onChoose, onClose, collections = MODEL_COLLECTIONS}) => {
  const [kind, setKind] = useState(collections[0]); const [query, setQuery] = useState('');
  const items = sourceObjects(source, kind).filter(o => `${o.name || ''} ${o.defName || ''} ${o.defKey || ''}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog title={t('chooseAsset')} onClose={onClose}><div className='pv-picker'>
    <Field label={t('assetType')}><select value={kind} onChange={e => setKind(e.target.value)}>{collections.map(c => <option key={c} value={c}>{t(c)}</option>)}</select></Field>
    <Field label={t('search')}><input autoFocus value={query} onChange={e => setQuery(e.target.value)} /></Field>
    <div className='pv-picker-list'>{items.map(o => <button type='button' key={o.id} onClick={() => onChoose(makeAssetRef(kind, o.id))}>
      <strong>{o.name || o.defName || o.defKey}</strong><span>{o.defKey || o.businessKey || ''}</span><small>{o.id}</small>
    </button>)}{!items.length && <p className='pv-empty'>{t('noResults')}</p>}</div>
  </div></Dialog>;
};

export const ReferenceDetails = ({source, assetRef, lastName, unboundAsset, readOnly, collections, onBind, onUnbind, onOpen, onLocate, onSnapshot}) => {
  const [pick, setPick] = useState(false); const [locations, setLocations] = useState(false);
  const asset = resolveAsset(source, assetRef); const refs = assetRef ? assetOccurrences(source, assetRef) : [];
  return <div className='pv-reference'>
    <h3>{t('linkedAssets')}</h3>
    {assetRef && <div className={`pv-reference-card ${asset ? '' : 'missing'}`}><strong>{asset?.name || asset?.defName || asset?.defKey || lastName || assetRef.objectId}</strong>
      <small>{asset ? t(assetRef.objectType) : t('missingReference')}</small>
      {asset && <Action onClick={() => onOpen && onOpen(assetRef)}>{t('openSource')} ↗</Action>}
      <p>{t('occurrenceCount', {diagrams: refs.length, instances: refs.reduce((n, r) => n + r.ids.length, 0)})}</p>
      <Action onClick={() => setLocations(true)}>{t('locations')}</Action>
      {!readOnly && <><Action onClick={() => setPick(true)}>{t('rebind')}</Action><Action onClick={onUnbind}>{t('unlink')}</Action>{onSnapshot && <Action onClick={onSnapshot}>{t('independentCopy')}</Action>}</>}
    </div>}
    {!assetRef && unboundAsset && <div className='pv-reference-card missing'><strong>{unboundAsset.lastName}</strong><small>{t('unboundReference')}</small></div>}
    {!assetRef && <p className='pv-note'>{t('bindingHint')}</p>}
    {!readOnly && !assetRef && <Action onClick={() => setPick(true)}>{t('chooseAsset')}</Action>}
    {pick && <AssetPicker source={source} collections={collections} onClose={() => setPick(false)} onChoose={ref => {onBind(ref);setPick(false);}} />}
    {locations && <Dialog title={t('locations')} onClose={() => setLocations(false)}><div className='pv-picker'>
      <p>{t('occurrenceCount', {diagrams: refs.length, instances: refs.reduce((n, r) => n + r.ids.length, 0)})}</p>
      {refs.map(r => <div className='pv-reference-card' key={`${r.module}-${r.id}`}><strong>{r.name}</strong><small>{t(r.module === 'data' ? 'dataModel' : 'drawing')}{r.module==='drawing'&&` · ${r.pageCount || 1} ${en()?'canvases':'个画布'} · ${r.ids.length} ${en()?'instances':'个实例'}`}</small>
        {r.ids.map((id, i) => <Action key={id} onClick={() => {onLocate && onLocate(r, id);setLocations(false);}}>{t('locateInstance', {index: i + 1})}</Action>)}</div>)}
      {!refs.length && <p>{t('zeroReferences')}</p>}
    </div></Dialog>}
  </div>;
};

export const BusinessMappings = ({object, source, readOnly, onUpdate, onOpen}) => {
  const [pick, setPick] = useState(false); const mappings = object.modelRefs || [];
  return <div className='pv-mappings'><h3>{t('modelMappings')}</h3><p className='pv-note'>{t('mappingHint')}</p>
    {mappings.map(ref => {const asset = resolveAsset(source, ref);return <div className={`pv-reference-card ${asset ? '' : 'missing'}`} key={`${ref.objectType}-${ref.objectId}`}>
      <small>{t(ref.objectType)}</small><strong>{asset?.defName || asset?.defKey || ref.lastName || ref.objectId}</strong>
      {asset ? <Action onClick={() => onOpen(ref)}>{t('openSource')} ↗</Action> : <p>{t('missingReference')}</p>}
      {!readOnly && <Action onClick={() => onUpdate({...object, modelRefs: mappings.filter(r => r !== ref)})}>{t('unlink')}</Action>}
    </div>;})}
    {!readOnly && <Action onClick={() => setPick(true)}>{t('addMapping')}</Action>}
    {pick && <AssetPicker source={source} collections={['conceptEntities', 'logicEntities', 'entities']} onClose={() => setPick(false)} onChoose={ref => {
      if (!mappings.some(r => r.objectId === ref.objectId && r.objectType === ref.objectType)) {
        const asset = resolveAsset(source, ref); onUpdate({...object, modelRefs: [...mappings, {...ref, lastName: asset?.defName || asset?.defKey}]});
      } setPick(false);
    }} />}
  </div>;
};
