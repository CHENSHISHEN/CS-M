import React, {useContext, useMemo, useState} from 'react';
import {Button, Checkbox, Icon, Input, Message, Modal, openModal, Select} from 'components';
import {ConfigContent} from '../../lib/context';
import {categoryObjects, getCatalogCategories} from '../../lib/model_catalog';
import {
  addConceptLogicalLinks,
  linksForConcept,
  linksForLogic,
  physicalSourcesForLogic,
  removeConceptLogicalLinks,
  updateConceptLogicalLink,
} from '../../lib/concept_logical_links';

import './style/concept-logical-links.less';

// 局部中英文文案（不修改共享 lang 文件；S3-LINKS 合同）
const LABELS = {
  zh: {
    logicImpl: '逻辑实现',
    conceptSource: '概念来源',
    physicalSource: '物理来源',
    code: '代码',
    name: '名称',
    domain: '所属域',
    fieldCount: '字段数',
    description: '关联说明',
    noDescription: '未填写说明',
    open: '打开',
    unlink: '解除',
    editDesc: '编辑说明',
    addLogic: '关联已有逻辑实体',
    addConcept: '关联已有概念实体',
    linked: '已关联',
    invalidTarget: '关联目标已删除',
    reselect: '重新选择',
    unlinkTitle: '解除关联',
    unlinkMessage: '只解除关联，保留两端实体。确定解除该关联吗？',
    unlinkKeepNote: '解除后两端实体保留，仅删除此关联边。',
    empty: '暂无关联',
    emptyLogic: '暂无逻辑实体',
    emptyConcept: '暂无概念实体',
    filterPlaceholder: '搜索代码/名称',
    allCategories: '全部分类',
    pickerTitleLogic: '关联已有逻辑实体',
    pickerTitleConcept: '关联已有概念实体',
    ok: '确定',
    cancel: '取消',
    pickerEmpty: '没有匹配的对象',
    dupError: '该关联已存在（同一概念与逻辑实体只能关联一次）',
    endpointError: '关联目标无效，请重新选择',
    saveSuccess: '关联已更新',
    descTitle: '编辑关联说明',
    invalidTag: '失效',
  },
  en: {
    logicImpl: 'Logical Implementations',
    conceptSource: 'Concept Sources',
    physicalSource: 'Physical Sources',
    code: 'Code',
    name: 'Name',
    domain: 'Domain',
    fieldCount: 'Fields',
    description: 'Link Description',
    noDescription: 'No description',
    open: 'Open',
    unlink: 'Unlink',
    editDesc: 'Edit description',
    addLogic: 'Link existing logical entities',
    addConcept: 'Link existing concept entities',
    linked: 'Linked',
    invalidTarget: 'Link target was deleted',
    reselect: 'Re-select',
    unlinkTitle: 'Unlink',
    unlinkMessage: 'This only removes the link; both entities are kept. Continue?',
    unlinkKeepNote: 'Both entities are kept; only this link edge is removed.',
    empty: 'No links yet',
    emptyLogic: 'No logical entities',
    emptyConcept: 'No concept entities',
    filterPlaceholder: 'Search code/name',
    allCategories: 'All categories',
    pickerTitleLogic: 'Link existing logical entities',
    pickerTitleConcept: 'Link existing concept entities',
    ok: 'OK',
    cancel: 'Cancel',
    pickerEmpty: 'No matching objects',
    dupError: 'This link already exists (one concept and one logical entity can be linked only once)',
    endpointError: 'Invalid link target, please select again',
    saveSuccess: 'Links updated',
    descTitle: 'Edit link description',
    invalidTag: 'Invalid',
  },
};

const typeLabel = (labels, mode) => (mode === 'concept' ? labels.logicImpl : labels.conceptSource);

// 供容器（如逻辑实体详情 tab 标题）复用的局部文案，不修改共享 lang
export const conceptLogicalLinksLabels = (lang) => (lang === 'en' ? LABELS.en : LABELS.zh);

// 端点对象在当前项目里的分类名（沿用目录元数据，不做名称推断）
const categoryNamesOf = (source, type, id) => {
  if (!source) return [];
  return getCatalogCategories(source)
    .filter(category => (categoryObjects(source, category)[type] || [])
      .some(object => object.id === id))
    .map(category => category.defName || category.defKey)
    .filter(Boolean);
};

// 关联选择弹窗：按代码/名称搜索、按分类筛选、多选一次确认（单选用于失效端点重选）。
// 按钮在弹窗 options 层，通过 checkedIdsHolder 桥接读取列表内部勾选状态
const openLinkPicker = ({labels, source, mode, multiple, linkedIds, onConfirm}) => {
  const targetType = mode === 'concept' ? 'logicEntity' : 'conceptEntity';
  const collectionKey = mode === 'concept' ? 'logicEntities' : 'conceptEntities';
  const pick = (source == null ? [] : (source[collectionKey] || []));
  const categories = getCatalogCategories(source || {});
  const checkedIdsHolder = {ids: []};
  const BridgedPicker = () => {
    const [keyword, setKeyword] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [checked, setChecked] = useState([]);
    checkedIdsHolder.ids = checked;
    const linked = new Set(linkedIds || []);
    const rows = pick.filter((object) => {
      const word = keyword.trim().toLowerCase();
      const key = String(object.defKey || '').toLowerCase();
      const name = String(object.defName || '').toLowerCase();
      const matchWord = !word || key.includes(word) || name.includes(word);
      const matchCategory = !categoryId
        || (categoryObjects(source || {}, categories.find(c => c.id === categoryId) || {})[targetType] || [])
          .some(object2 => object2.id === object.id);
      return matchWord && matchCategory;
    });
    const toggle = (id, on) => {
      setChecked(pre => (multiple ? (on ? pre.concat(id) : pre.filter(x => x !== id))
        : (on ? [id] : [])));
    };
    return <div className='chiner-cll-picker'>
      <div className='chiner-cll-picker-toolbar'>
        <Input
          value={keyword}
          placeholder={labels.filterPlaceholder}
          onChange={e => setKeyword(e.target.value)}/>
        <Select
          notAllowEmpty
          allowClear
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}>
          {
            categories.map(category => <Select.Option key={category.id} value={category.id}>
              {category.defName || category.defKey}
            </Select.Option>)
          }
        </Select>
      </div>
      <div className='chiner-cll-picker-list'>
        {
          rows.length ? rows.map((object) => {
            const isLinked = linked.has(object.id);
            const isChecked = checked.includes(object.id);
            return <div
              key={object.id}
              className={`chiner-cll-picker-row ${isLinked ? 'chiner-cll-picker-row-linked' : ''}`}>
              <Checkbox
                disable={isLinked}
                checked={isChecked}
                value={object.id}
                onChange={(e, value) => toggle(value, e.target.checked)}/>
              <span className='chiner-cll-object-key'>{object.defKey}</span>
              <span className='chiner-cll-object-name'>{object.defName}</span>
              {isLinked && <span className='chiner-cll-tag'>{labels.linked}</span>}
            </div>;
          }) : <div className='chiner-cll-empty'>{labels.pickerEmpty}</div>
        }
      </div>
    </div>;
  };
  let modal = null;
  const onOk = () => {
    modal && modal.close();
    onConfirm(checkedIdsHolder.ids);
  };
  modal = openModal(<BridgedPicker/>, {
    title: <span><Icon type='fa-link'/>
      {mode === 'concept' ? labels.pickerTitleLogic : labels.pickerTitleConcept}</span>,
    buttons: [
      <Button key='ok' type='primary' onClick={onOk}>{labels.ok}</Button>,
      <Button key='cancel' onClick={() => modal && modal.close()}>{labels.cancel}</Button>,
    ],
  });
};

// 概念-逻辑双向关联面板：
// concept 模式 = 概念详情“逻辑实现”；logic 模式 = 逻辑详情“概念来源”。
// 物理链路只依 S2 稳定来源 logicalEntityId，不按相似名称补线。
// 所有写入基于最新有效源一次事务提交（getDataSource→纯函数→updateDataSource），
// 不覆盖其他 tab 草稿；readOnly 或未接入写接口时仅允许查看与跳转。
const ConceptLogicalLinks = React.memo(({mode = 'concept', objectId, dataSource,
                                        getDataSource, updateDataSource, jumpDetail, readOnly}) => {
  const {lang} = useContext(ConfigContent);
  const labels = lang === 'en' ? LABELS.en : LABELS.zh;
  const [nonce, setNonce] = useState(0);
  const [filter, setFilter] = useState('');
  const latest = () => (getDataSource ? getDataSource() : dataSource);
  const writable = !readOnly && !!updateDataSource;
  const source = latest();
  const otherType = mode === 'concept' ? 'logicEntity' : 'conceptEntity';
  const otherCollection = mode === 'concept' ? 'logicEntities' : 'conceptEntities';
  const rows = useMemo(() => (mode === 'concept'
    ? linksForConcept(source || {}, objectId)
    : linksForLogic(source || {}, objectId)),
  [source, objectId, mode, nonce]);
  const word = filter.trim().toLowerCase();
  const visibleRows = rows.filter((row) => {
    if (!word) return true;
    const other = mode === 'concept' ? row.logic : row.concept;
    return String(other.defKey || '').toLowerCase().includes(word)
      || String(other.defName || '').toLowerCase().includes(word);
  });
  const physicalOfLogic = useMemo(() => (mode === 'logic'
    ? physicalSourcesForLogic(source || {}, objectId) : []),
  [source, objectId, mode, nonce]);

  const localError = (error) => {
    if (/duplicate/.test(error.message)) return labels.dupError;
    if (/unknown.*endpoint/.test(error.message)) return labels.endpointError;
    return error.message;
  };
  const commit = (action) => {
    const current = latest();
    if (!current || !writable) return;
    let next = null;
    try {
      next = action(current);
    } catch (error) {
      Message.error({title: localError(error)});
      return;
    }
    updateDataSource(next);
    setNonce(n => n + 1);
  };
  const jump = (object, collectionKey) => {
    jumpDetail && jumpDetail(object, collectionKey);
  };
  const onUnlink = (row) => {
    Modal.confirm({
      title: labels.unlinkTitle,
      message: <div className='chiner-cll-confirm'>
        <p>{labels.unlinkMessage}</p>
        <p className='chiner-cll-confirm-note'>{labels.unlinkKeepNote}</p>
      </div>,
      onOk: () => commit(latestSource => removeConceptLogicalLinks(latestSource, [row.link.id])),
    });
  };
  const onEditDescription = (row) => {
    let value = row.link.description || '';
    let modal = null;
    modal = openModal(<div className='chiner-cll-desc-edit'>
      <Input
        defaultValue={value}
        placeholder={labels.description}
        onChange={e => {value = e.target.value;}}/>
    </div>, {
      title: <span><Icon type='fa-edit'/>{labels.descTitle}</span>,
      focusFirst: true,
      buttons: [
        <Button
          key='ok'
          type='primary'
          onClick={() => {
            modal && modal.close();
            commit(latestSource => updateConceptLogicalLink(latestSource, row.link.id,
              {description: value}));
          }}>{labels.ok}</Button>,
        <Button key='cancel' onClick={() => modal && modal.close()}>{labels.cancel}</Button>,
      ],
    });
  };
  // 失效端点重选：保留边 ID 与说明，替换缺失一端；另一端类型校验由纯函数层保证
  const onReselect = (row) => {
    const missingEnd = row.concept.present
      ? {key: 'logicalEntityId', mode: 'concept'}
      : {key: 'conceptEntityId', mode: 'logic'};
    openLinkPicker({
      labels,
      source: latest(),
      mode: missingEnd.mode,
      multiple: false,
      linkedIds: [],
      onConfirm: (ids) => {
        if (!ids || !ids.length) return;
        commit(latestSource => updateConceptLogicalLink(latestSource, row.link.id,
          {[missingEnd.key]: ids[0]}));
      },
    });
  };
  // 双向新增：concept 侧多选关联逻辑实体；logic 侧同样可主动多选关联已有概念
  // （已关联置灰不可重复添加，组合唯一由纯函数层阻断）
  const onAdd = () => {
    const current = latest();
    if (!current || !writable) return;
    openLinkPicker({
      labels,
      source: current,
      mode,
      multiple: true,
      linkedIds: rows.filter(row => row.valid)
        .map(row => (mode === 'concept' ? row.link.logicalEntityId : row.link.conceptEntityId)),
      onConfirm: (ids) => {
        if (!ids || !ids.length) return;
        commit(latestSource => addConceptLogicalLinks(latestSource,
          ids.map(id => (mode === 'concept'
            ? {conceptEntityId: objectId, logicalEntityId: id}
            : {conceptEntityId: id, logicalEntityId: objectId}))));
      },
    });
  };
  const physicalJump = (entity) => {
    jump(entity, 'entities');
  };
  return <div className='chiner-cll' data-mode={mode}>
    <div className='chiner-cll-header'>
      <span className='chiner-cll-title'>{typeLabel(labels, mode)}</span>
      {
        writable && <Button
          className='chiner-cll-add'
          onClick={onAdd}>
          <Icon type='fa-plus'/>{mode === 'concept' ? labels.addLogic : labels.addConcept}
        </Button>
      }
    </div>
    <div className='chiner-cll-toolbar'>
      <Input
        value={filter}
        placeholder={labels.filterPlaceholder}
        onChange={e => setFilter(e.target.value)}/>
    </div>
    <div className='chiner-cll-rows'>
      {
        visibleRows.length ? visibleRows.map((row) => {
          const other = mode === 'concept' ? row.logic : row.concept;
          const otherObject = other.present
            ? ((latest() == null ? [] : (latest()[otherCollection] || []))
              .filter(o => o.id === other.id)[0]) : null;
          const categories = other.present
            ? categoryNamesOf(latest(), otherType, other.id) : [];
          const physicals = mode === 'concept' && row.valid
            ? physicalSourcesForLogic(latest() || {}, row.link.logicalEntityId) : [];
          return <div
            key={row.link.id}
            className={`chiner-cll-row ${row.valid ? '' : 'chiner-cll-row-invalid'}`}>
            <div className='chiner-cll-row-main'>
              <div className='chiner-cll-row-title'>
                <span className='chiner-cll-object-key'>{other.defKey || other.id}</span>
                <span className='chiner-cll-object-name'>{other.defName}</span>
                {row.valid
                  ? null
                  : <span className='chiner-cll-tag chiner-cll-tag-invalid'>
                    {labels.invalidTag}·{labels.invalidTarget}</span>}
              </div>
              <div className='chiner-cll-row-meta'>
                {other.present && <span>{labels.domain}：{categories.join(' / ') || '-'}</span>}
                {mode === 'concept' && otherObject
                  && <span>{labels.fieldCount}：{(otherObject.fields || []).length}</span>}
              </div>
              {row.link.description
                ? <div className='chiner-cll-row-desc'>{row.link.description}</div>
                : <div className='chiner-cll-row-desc chiner-cll-row-desc-empty'>
                  {labels.noDescription}</div>}
              {mode === 'concept' && physicals.length > 0 && (
                <div className='chiner-cll-row-physical'>
                  <span className='chiner-cll-row-physical-label'>{labels.physicalSource}：</span>
                  {
                    physicals.map(entity => <a
                      key={entity.id}
                      role='link'
                      tabIndex={0}
                      onClick={() => physicalJump(entity)}
                      onKeyUp={e => (e.key === 'Enter' && physicalJump(entity))}>
                      {entity.defKey || entity.id}
                    </a>)
                  }
                </div>
              )}
            </div>
            <div className='chiner-cll-row-actions'>
              {other.present && otherObject && <Button
                onClick={() => jump(otherObject, otherCollection)}>
                <Icon type='fa-external-link'/>{labels.open}
              </Button>}
              {writable && <Button onClick={() => onEditDescription(row)}>
                <Icon type='fa-edit'/>{labels.editDesc}
              </Button>}
              {writable && !row.valid && <Button onClick={() => onReselect(row)}>
                <Icon type='fa-retweet'/>{labels.reselect}
              </Button>}
              {writable && <Button
                className='chiner-cll-row-unlink'
                onClick={() => onUnlink(row)}>
                <Icon type='fa-unlink'/>{labels.unlink}
              </Button>}
            </div>
          </div>;
        }) : <div className='chiner-cll-empty'>
          {(latest() == null ? [] : (latest()[otherCollection] || [])).length === 0
            ? (mode === 'concept' ? labels.emptyLogic : labels.emptyConcept)
            : labels.empty}
        </div>
      }
    </div>
    {
      mode === 'logic' && (
        <div className='chiner-cll-physical'>
          <div className='chiner-cll-title'>{labels.physicalSource}</div>
          {
            physicalOfLogic.length ? physicalOfLogic.map(entity => (
              <div key={entity.id} className='chiner-cll-row chiner-cll-row-physical-item'>
                <span className='chiner-cll-object-key'>{entity.defKey || entity.id}</span>
                <span className='chiner-cll-object-name'>{entity.defName}</span>
                <Button onClick={() => physicalJump(entity)}>
                  <Icon type='fa-external-link'/>{labels.open}
                </Button>
              </div>
            )) : <div className='chiner-cll-empty'>{labels.empty}</div>
          }
        </div>
      )
    }
  </div>;
});

export default ConceptLogicalLinks;
