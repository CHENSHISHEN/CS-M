import React, {useEffect, useRef, useState} from 'react';
import {FormatMessage} from 'components';
import ConceptLogicalLinks from '../../workbench/ConceptLogicalLinks';
// M4B：概念实体“指标关联”面板（SEMANTIC_MATCH 对象级语义映射，语义设计态）
import ModelMetricPanel from '../../metrics/ModelMetricPanel';
import {getDataByTabId, removeDataByTabId} from '../../../lib/cache';
import {subscribeEvent, unSubscribeEvent} from '../../../lib/subscribe';

export default React.memo(({entity, dataSource, tabKey, tabDataChange,
                            hasRender, hasDestory, readOnly,
                            getDataSource, updateDataSource, jumpDetail, openMetric}) => {
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
    {/* S3-LINKS：概念详情“逻辑实现”双向面板；写接口未接线时自动只读展示 */}
    <ConceptLogicalLinks
      mode='concept'
      objectId={entity}
      dataSource={dataSource}
      getDataSource={getDataSource}
      updateDataSource={updateDataSource}
      jumpDetail={jumpDetail}
      readOnly={readOnly}/>
    {/* M4B：概念实体“指标关联”（对象级语义映射 ↔ 业务概念/具体定义版本） */}
    <ModelMetricPanel
      collection='conceptEntities'
      objectId={entity}
      dataSource={dataSource}
      getDataSource={getDataSource}
      updateDataSource={updateDataSource}
      readOnly={readOnly}
      onOpenMetric={openMetric}
    />
  </div>;
});
