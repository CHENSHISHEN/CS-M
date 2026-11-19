import React, {useCallback, useEffect, useRef} from 'react';

import { Table } from 'components';
// M5B-R1：物理实体字段删除前指标影响确认（无影响不阻扰）
import {makeFieldsDeleteCheck} from '../../metrics/deleteImpact';

export default React.memo(({data, dataSource, update, FieldsExtraOpt,customerHeaders,
                             dataChange, offsetHeight, updateDataSource, ready, freeze, param,
                             hasRender, hasDestory, getDataSource, openDict, defaultGroups,
                             getRestData, type, openConfig, searchRef}) => {
  const tableRef = useRef(null);
  useEffect(() => {
    hasRender && hasRender({
      twinkle: (key) => {
        tableRef.current?.twinkleTr(key);
      },
    });
    return () => {
      hasDestory && hasDestory();
    };
  }, []);
  const search = useCallback((f, value) => {
    const reg = new RegExp((value || '')
        .replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
    return reg.test(f.defName) || reg.test(f.defKey);
  }, []);
  return <Table
    searchRef={searchRef}
    search={search}
    needHideInGraph={false}
    openConfig={openConfig}
    isEntity={type === 'entity'}
    getRestData={getRestData}
    ref={tableRef}
    twinkle={param?.defKey}
    customerHeaders={customerHeaders}
    freeze={freeze}
    offsetHeight={offsetHeight}
    data={data}
    dataSource={dataSource}
    update={update}
    ExtraOpt={FieldsExtraOpt}
    tableDataChange={dataChange}
    updateDataSource={updateDataSource}
    ready={ready}
    getDataSource={getDataSource}
    openDict={openDict}
    defaultGroups={defaultGroups}
    // M5B-R1：仅物理实体（指标绑定目标集合 entities）接入字段删除影响确认；
    // 未保存实体（无 id）/无指标关联字段不增加阻扰
    checkFieldsDelete={type === 'entity' && data && data.id
      ? makeFieldsDeleteCheck(getDataSource || (() => dataSource), 'entities', data.id)
      : undefined}
  />;
});
