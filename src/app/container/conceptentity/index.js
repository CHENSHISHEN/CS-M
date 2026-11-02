import React, {useEffect, useRef, useState} from 'react';
import {FormatMessage} from 'components';
import {getDataByTabId, removeDataByTabId} from '../../../lib/cache';
import {subscribeEvent, unSubscribeEvent} from '../../../lib/subscribe';

export default React.memo(({entity, dataSource, tabKey, tabDataChange,
                            hasRender, hasDestory, readOnly,
                            getDataSource, updateDataSource, jumpDetail}) => {
  const initial = (dataSource.conceptEntities || []).find(item => item.id === entity) || {};
  const [data, setData] = useState(() => getDataByTabId(tabKey)?.data || initial);
  const current = useRef(data);
  current.current = data;
  const codeRef = useRef(null);
  useEffect(() => {
    tabDataChange && tabDataChange({type: 'conceptEntity', key: entity, data: current.current, isInit: true});
    hasRender && hasRender({twinkle: () => codeRef.current?.focus()});
    const id = Math.uuid();
    subscribeEvent('tabDataChange', ({id: changed, d}) => {
      if (changed === entity) setData(d);
    }, id);
    return () => {
      removeDataByTabId(tabKey);
      unSubscribeEvent('tabDataChange', id);
      hasDestory && hasDestory();
    };
  }, []);
  const change = (name, value) => {
    const next = {...current.current, [name]: value};
    current.current = next;
    setData(next);
    tabDataChange && tabDataChange({type: 'conceptEntity', key: entity, data: next, isInit: false});
  };
  return <div className='chiner-concept-entity'>
    <div className='chiner-wb-section-title'><FormatMessage id='modelCatalog.conceptEntity'/></div>
    <p className='chiner-wb-table-note'><FormatMessage id='modelCatalog.conceptHint'/></p>
    <label htmlFor={`${entity}-code`}>
      {FormatMessage.string({id: 'modelCatalog.code'})}<input
        id={`${entity}-code`}
        ref={codeRef}
        readOnly={readOnly}
        value={data.defKey || ''}
        onChange={e => change('defKey', e.target.value)}/></label>
    <label htmlFor={`${entity}-name`}>
      {FormatMessage.string({id: 'modelCatalog.name'})}<input
        id={`${entity}-name`}
        readOnly={readOnly}
        value={data.defName || ''}
        onChange={e => change('defName', e.target.value)}/></label>
    <label htmlFor={`${entity}-definition`}>
      {FormatMessage.string({id: 'modelCatalog.definition'})}<textarea
        id={`${entity}-definition`}
        readOnly={readOnly}
        value={data.comment || ''}
        onChange={e => change('comment', e.target.value)}/></label>
  </div>;
});
