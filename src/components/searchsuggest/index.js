import React, { useState, useMemo, useRef, useEffect } from 'react';
import ReactDom from 'react-dom';
import {FixedSizeTree as Tree} from 'react-vtree';
import AutoSizer from 'react-virtualized-auto-sizer';

import SearchInput from '../searchinput';
import FormatMessage from '../formatmessage';
import Button from '../button';
import { openModal } from '../modal';
import {getPrefix} from '../../lib/prefixUtil';
import {addBodyClick, removeBodyClick} from '../../lib/listener';
import './style/index.less';
import MoreList from './MoreList';
import {postWorkerFuc} from '../../lib/event_tool';

export default React.memo(({placeholder, prefix, dataSource,
                             jumpPosition, jumpDetail, getSearchDataSource}) => {
  const currentPrefix = getPrefix(prefix);
  const listRef = useRef(null);
  const modalRef = useRef(null);
  const id = useMemo(() => Math.uuid(), []);
  const suggestRef = useRef(null);
  const searchRef = useRef(null);
  const comSearchRef = useRef(null);
  const [searchValue, setSearchValue] = useState('');
  const [allData, setAllData] = useState([]);
  const sourceChangeRef = useRef(false);
  const searchRequestRef = useRef(0);
  const dataSourceRef = useRef({});
  dataSourceRef.current = {...dataSource};
  const jumpCallbacks = useRef({});
  jumpCallbacks.current = {jumpPosition, jumpDetail};

  const onChange = async (e) => {
    searchRequestRef.current += 1;
    const request = searchRequestRef.current;
    setSearchValue(e.target.value);
    if ((sourceChangeRef.current || getSearchDataSource) && e.target.value) {
      const data = await postWorkerFuc('utils.getAllData', true, [
        {dataSource: getSearchDataSource ? getSearchDataSource() : dataSourceRef.current},
      ]);
      if (request === searchRequestRef.current) {
        setAllData(data);
        sourceChangeRef.current = false;
      }
    }
  };
  useEffect(() => {
    addBodyClick(id, (e) => {
      if (!searchRef?.current?.contains(e.target) && !listRef?.current?.contains(e.target)) {
        setSearchValue('');
        comSearchRef.current.resetSearchValue();
      }
    });
    return () => {
      removeBodyClick(id);
    };
  }, []);
  useEffect(() => {
    sourceChangeRef.current = true;
  }, [dataSource.entities, dataSource.views,
    dataSource.logicEntities, dataSource.conceptEntities, dataSource.profile?.modelCatalog,
    dataSource.diagrams, dataSource.dicts,
    dataSource.viewGroups, dataSource.standardFields]);
  const calcSuggest = (suggest, search) => {
    if (!search) return <span>{suggest}</span>;
    const reg = new RegExp(`(${search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'ig');
    return <span>{suggest.split(reg).map((part, i) => (i % 2 ?
      <span key={i} className={`${currentPrefix}-search-suggest-list-search`}>{part}</span> : part))}</span>;
  };
  const _jumpPosition = (...args) => {
    setSearchValue('');
    comSearchRef.current.resetSearchValue();
    modalRef.current?.close();
    jumpCallbacks.current.jumpPosition && jumpCallbacks.current.jumpPosition(...args);
  };
  const _jumpDetail = (...args) => {
    setSearchValue('');
    comSearchRef.current.resetSearchValue();
    modalRef.current?.close();
    jumpCallbacks.current.jumpDetail && jumpCallbacks.current.jumpDetail(...args);
  };
  const getOpt = (d, key) => {
    let opt = '';
    switch (key){
      case 'conceptEntities':
      case 'entities':
        opt = <>[<a
          onClick={() => _jumpPosition(d, key)}
        ><FormatMessage id='components.searchSuggest.position'/></a>|<a
          onClick={() => _jumpDetail(d, key)}
        ><FormatMessage id='components.searchSuggest.detail'/></a>]</>;
        break;
      case 'logicEntities':
        opt = <>[<a
          onClick={() => _jumpPosition(d, key)}
        ><FormatMessage id='components.searchSuggest.position'/></a>|<a
          onClick={() => _jumpDetail(d, key)}
        ><FormatMessage id='components.searchSuggest.detail'/></a>]</>;
        break;
      case 'fields': opt = <>[<a
        onClick={() => _jumpDetail(d, key)}
      ><FormatMessage id='components.searchSuggest.detail'/></a>]</>;
        break;
      case 'dicts': opt = <>[<a
        onClick={() => _jumpPosition(d, key)}
      ><FormatMessage id='components.searchSuggest.position'/></a>|<a
        onClick={() => _jumpDetail(d, key)}
      ><FormatMessage id='components.searchSuggest.detail'/></a>]</>;
        break;
      case 'dictItems': opt = <>[<a
        onClick={() => _jumpDetail(d, key)}
      ><FormatMessage id='components.searchSuggest.detail'/></a>]</>;
        break;
      case 'standardFields': opt = <>[<a
        onClick={() => _jumpDetail(d, key)}
      ><FormatMessage id='components.searchSuggest.detail'/></a>]</>;
        break;
      case 'diagrams': opt = <>[<a
        onClick={() => _jumpDetail(d, key)}
      ><FormatMessage id='components.searchSuggest.open'/></a>]</>;
        break;
      case 'diagramRefs': opt = <>[<a
        onClick={() => _jumpDetail(d, key)}
      ><FormatMessage id='components.searchSuggest.locate'/></a>]</>;
        break;
      default: break;
    }
    return opt;
  };
  const Node = useMemo(() => ({data: {aData, node, parent, search}, style}) => {
    if(parent) {
      if(['entities', 'logicEntities', 'conceptEntities'].includes(parent.key)) {
        return <div
          style={style}
          className={`${currentPrefix}-search-suggest-list-item ${currentPrefix}-search-suggest-list-item-refs`}
        >
          <span style={{display: 'flex'}}>
            <span title={node.suggest} style={{minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis'}}>
              {calcSuggest(node.suggest, search)}
            </span>
            <span style={{flexShrink: 0, paddingLeft: 8}}>
              <FormatMessage id='components.searchSuggest.diagramRefs'/>
              ({node.diagramRefs?.length || 0})
              {!node.diagramRefs?.length && <>{' '}<FormatMessage id='components.searchSuggest.noRefs'/></>}
            </span>
          </span>
          <span>{getOpt(node, parent.key)}</span>
        </div>;
      }
      if(parent.key === 'diagramRefs') {
        return <div
          style={style}
          className={`${currentPrefix}-search-suggest-list-item ${currentPrefix}-search-suggest-list-item-ref`}
        >
          <span title={node.suggest}>{calcSuggest(node.suggest, search)}</span>
          <span>{getOpt(node, 'diagramRefs')}</span>
        </div>;
      }
      return <div style={style} className={`${currentPrefix}-search-suggest-list-item`}>
        <span>{calcSuggest(node.suggest, search)}</span>
        <span>{getOpt(node, parent.key)}</span>
      </div>;
    }
    return <div style={style} className={`${currentPrefix}-search-suggest-list-group`}>
      <span>
        <FormatMessage id={`components.searchSuggest.${node.key}`}/>
          (<FormatMessage
            id='components.searchSuggest.length'
            data={{count: aData.find(ad => ad.key === node.key)?.data?.length}}
        />)
      </span>
    </div>;
  }, []);
  const getItemList = (data, aData, search, isMore) => {
    const suggestRect = suggestRef.current.getBoundingClientRect();
    const finalData = data.filter(d => d.data.length > 0);
    const currentLength = finalData.reduce((p, n) => {
      const childLength = ['entities', 'logicEntities', 'conceptEntities'].includes(n.key)
          ? n.data.length + n.data.reduce((a, b) => a + (b.diagramRefs?.length || 0), 0)
          : n.data?.length || 0;
      return p + childLength;
    }, finalData.length);
    const getNodeData = (node, nestingLevel, parent) => {
      return ({
        data: {
          aData,
          search,
          id: `${parent?.key || 'group'}:${parent?.originKey || node.entity || node.dict || ''}:${node.id || node.key}`,
          node,
          nestingLevel,
          isOpenByDefault: true,
          parent,
        },
        nestingLevel,
        node,
      });
    };
    function* treeWalker() {
      for (let i = 0; i < finalData.length; i += 1) {
        yield getNodeData(finalData[i], 0);
      }

      while (true) {
        const parent = yield;
        const parentData = parent.node.data || [];
        for (let i = 0; i < parentData.length; i += 1) {
          const node = parentData[i];
          yield getNodeData(node, parent.nestingLevel + 1, parent.node);
          if (['entities', 'logicEntities', 'conceptEntities'].includes(parent.node.key)) {
            for (let j = 0; j < (node.diagramRefs || []).length; j += 1) {
              const refNode = {
                ...node.diagramRefs[j],
                key: 'diagramRefs',
                type: 'refDiagrams',
                originKey: node.id,
                suggest: `${node.diagramRefs[j].defKey}-${node.diagramRefs[j].defName || node.diagramRefs[j].defKey}${node.diagramRefs[j].groups?.length ? `@${node.diagramRefs[j].groups.map(g => g.name).join('|')}` : ''}`,
              };
              yield getNodeData(refNode, parent.nestingLevel + 2, {key: 'diagramRefs', originKey: node.id});
            }
          }
        }
      }
    }
    const calcHeight = window.innerHeight - suggestRect.bottom - 10 - (isMore ? 26 : 0);
    if(isMore === undefined) {
      return <div>
        <AutoSizer>
          {({width, height}) => {
            return <Tree
              treeWalker={treeWalker}
              itemSize={26}
              width={width}
              height={height}
            >
              {Node}
            </Tree>;
          }}
        </AutoSizer>
      </div>;
    }
    return <Tree
      treeWalker={treeWalker}
      itemSize={26}
      height={currentLength * 26 <= calcHeight ? currentLength * 26 : calcHeight}
    >
      {Node}
    </Tree>;
  };
  const getFilterData = (data = [], value) => {
    const reg = new RegExp((value || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
    return data
        .filter((d) => {
          return reg.test(d.defKey || '') || reg.test(d.defName || '');
        });
  };
  const getFilterRefData = (data = [], value) => {
    const reg = new RegExp((value || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
    return data.filter((d) => {
      return reg.test(d.defKey || '') || reg.test(d.defName || '');
    });
  };
  const moreClick = (filterData) => {
    const onOK = () => {
      modalRef.current && modalRef.current.close();
      modalRef.current = null;
    };
    modalRef.current = openModal(<MoreList
      allData={allData}
      filterData={filterData}
      getItemList={getItemList}
      currentPrefix={currentPrefix}
      getFilterData={getFilterData}
      getFilterRefData={getFilterRefData}
      placeholder={placeholder}
      search={searchValue}
    />, {
      title: <FormatMessage id='components.searchSuggest.moreList'/>,
      buttons: [
        <Button key='onOK' onClick={onOK} type='primary'>
          <FormatMessage id='button.close'/>
        </Button>],
    });
  };
  const childrenMemo = useMemo(() => {
    if (searchValue) {
      // 数据表 视图 数据字典 字段库
      const suggestRect = suggestRef.current.getBoundingClientRect();
      const filterData = allData.map((d) => {
        return {
          ...d,
          data: ['entities', 'logicEntities', 'conceptEntities'].includes(d.key)
              ? getFilterRefData(d.data, searchValue)
              : getFilterData(d.data, searchValue),
        };
      }).filter(d => d.data.length > 0);
      const simpleFilterData = filterData.map(d => ({
        ...d,
        data: d.data.slice(0, 4),
      }));
      const moreFilterData = filterData.map(d => ({
        ...d,
        data: d.data.slice(4, d.data.length),
      }));
      const isMore = moreFilterData.some(d => d.data.length > 0);
      return <div
        className={`${currentPrefix}-search-suggest-list`}
        ref={listRef}
        style={{
            maxWidth: 'calc(100% - 10px)',
            right: 5,
            top: suggestRect.bottom + 2,
            width: suggestRect.width * 2,
          }}
      >
        {
          simpleFilterData.length > 0 ? <>{getItemList(simpleFilterData, filterData,
              searchValue, isMore)}{
            isMore ?
              <div
                className={`${currentPrefix}-search-suggest-more`}
                onClick={() => moreClick(filterData)}
              >
                <FormatMessage id='components.searchSuggest.more'/>
              </div> : ''
          }</> : <div className={`${currentPrefix}-search-suggest-empty`}>
            <FormatMessage id='components.searchSuggest.empty'/>
          </div>
        }
      </div>;
    }
    return '';
  }, [searchValue, allData]);
  return <div className={`${currentPrefix}-search-suggest`} ref={suggestRef}>
    <SearchInput
      comRef={comSearchRef}
      ref={searchRef}
      defaultValue={searchValue}
      placeholder={placeholder}
      onChange={onChange}/>
    {
      ReactDom.createPortal(childrenMemo, document.body)
    }
  </div>;
});
