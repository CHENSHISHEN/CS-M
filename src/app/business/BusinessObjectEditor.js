import React, { useState } from 'react';
import { Button, Icon } from 'components';
import { BusinessMappings } from '../drawing/platform/References';
import { PROPERTY_TYPES } from '../../lib/businessStorage';

export default ({
  businessObject,
  source, onOpenAsset, onOpenRelated,
  allProcesses = [],
  allRules = [],
  onUpdateObject,
  readOnly = false,
}) => {
  const [activeTab, setActiveTab] = useState('properties'); // 'properties' | 'states' | 'relations'
  const [newTagInput, setNewTagInput] = useState('');

  if (!businessObject) {
    return <div className='empty-editor-tip'>请选择左侧业务对象查看或编辑</div>;
  }

  const {
    id,
    name = '',
    businessKey = '',
    definition = '',
    properties = [],
    states = [],
  } = businessObject;

  // 更新基础字段
  const handleFieldChange = (field, val) => {
    if (readOnly) return;
    onUpdateObject && onUpdateObject({
      ...businessObject,
      [field]: val,
    });
  };

  // 添加属性
  const handleAddProperty = () => {
    if (readOnly) return;
    const newProp = {
      id: `prop-${Date.now().toString(36)}`,
      name: `新业务属性_${properties.length + 1}`,
      type: 'text',
      memo: '',
    };
    onUpdateObject && onUpdateObject({
      ...businessObject,
      properties: [...properties, newProp],
    });
  };

  // 更新属性
  const handleUpdateProperty = (propId, key, value) => {
    if (readOnly) return;
    const nextProps = properties.map(p => (p.id === propId ? { ...p, [key]: value } : p));
    onUpdateObject && onUpdateObject({
      ...businessObject,
      properties: nextProps,
    });
  };

  // 删除属性
  const handleDeleteProperty = (propId) => {
    if (readOnly) return;
    const nextProps = properties.filter(p => p.id !== propId);
    onUpdateObject && onUpdateObject({
      ...businessObject,
      properties: nextProps,
    });
  };

  // 状态标签添加与删除
  const handleAddState = () => {
    if (readOnly || !newTagInput.trim()) return;
    const tag = newTagInput.trim();
    if (!states.includes(tag)) {
      onUpdateObject && onUpdateObject({
        ...businessObject,
        states: [...states, tag],
      });
    }
    setNewTagInput('');
  };

  const handleRemoveState = (st) => {
    if (readOnly) return;
    onUpdateObject && onUpdateObject({
      ...businessObject,
      states: states.filter(s => s !== st),
    });
  };

  // 计算关联信息
  const relatedProcesses = allProcesses.filter(p =>
    (p.elements || []).some(e =>
      (e.inputObjectIds || []).includes(id) || (e.outputObjectIds || []).includes(id)
    )
  );

  const relatedRules = allRules.filter(r =>
    (r.scopeRefs || []).some(ref => ref.type === 'businessObject' && ref.id === id)
  );

  return (
    <div className='business-object-editor'>
      {/* 1. 顶部基础信息 (UI-P03) */}
      <div className='object-header-card'>
        <div className='header-top-row'>
          <div className='title-group'>
            <Icon type='fa-cube' style={{ color: '#52c41a', fontSize: 20, marginRight: 10 }} />
            <input
              type='text'
              className='object-name-input'
              value={name}
              disabled={readOnly}
              onChange={e => handleFieldChange('name', e.target.value)}
              placeholder='业务对象名称（如：采购订单）'
            />
          </div>
          <div className='business-key-group'>
            <span className='key-label'>业务标识：</span>
            <input
              type='text'
              className='object-key-input'
              value={businessKey}
              disabled={readOnly}
              onChange={e => handleFieldChange('businessKey', e.target.value.toUpperCase())}
              placeholder='CODE（如：PO_ORDER）'
            />
          </div>
        </div>

        <div className='definition-group'>
          <label className='def-label'>业务定义：</label>
          <textarea
            className='def-textarea'
            value={definition}
            disabled={readOnly}
            onChange={e => handleFieldChange('definition', e.target.value)}
            placeholder='清晰阐述该业务对象的业务语义、产生源头与企业价值...'
            rows={2}
          />
        </div>

        {/* 业务状态标签列表 */}
        <div className='states-group'>
          <span className='states-label'>
            <Icon type='fa-tags' style={{ marginRight: 6 }} />
            业务生命周期状态：
          </span>
          <div className='states-list'>
            {states.map(st => (
              <span key={st} className='state-tag'>
                {st}
                {!readOnly && (
                  <Icon
                    type='fa-times'
                    className='remove-tag-btn'
                    onClick={() => handleRemoveState(st)}
                  />
                )}
              </span>
            ))}
            {!readOnly && (
              <div className='add-tag-box'>
                <input
                  type='text'
                  className='tag-input'
                  placeholder='+ 状态 (回车添加)'
                  value={newTagInput}
                  onChange={e => setNewTagInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddState()}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. 主体区：属性表格与右侧关联分析 */}
      <div className='object-editor-body'>
        <div className='properties-table-section'>
          <div className='section-toolbar'>
            <span className='section-title'>
              <Icon type='fa-list' style={{ marginRight: 6 }} />
              业务属性列表 ({properties.length})
            </span>
            {!readOnly && (
              <Button type='primary' size='small' icon='fa-plus' onClick={handleAddProperty}>
                添加业务属性
              </Button>
            )}
          </div>

          <div className='properties-table-wrapper'>
            <table className='properties-table'>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>#</th>
                  <th style={{ width: '220px' }}>属性名称</th>
                  <th style={{ width: '150px' }}>业务类型</th>
                  <th>业务说明与格式约定</th>
                  {!readOnly && <th style={{ width: '60px' }}>操作</th>}
                </tr>
              </thead>
              <tbody>
                {properties.map((prop, idx) => (
                  <tr key={prop.id}>
                    <td className='index-cell'>{idx + 1}</td>
                    <td>
                      <input
                        type='text'
                        className='table-input'
                        value={prop.name}
                        disabled={readOnly}
                        onChange={e => handleUpdateProperty(prop.id, 'name', e.target.value)}
                      />
                    </td>
                    <td>
                      <select
                        className='table-select'
                        value={prop.type}
                        disabled={readOnly}
                        onChange={e => handleUpdateProperty(prop.id, 'type', e.target.value)}
                      >
                        {PROPERTY_TYPES.map(t => (
                          <option key={t.key} value={t.key}>{t.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type='text'
                        className='table-input'
                        value={prop.memo}
                        disabled={readOnly}
                        placeholder='填写约束或枚举说明...'
                        onChange={e => handleUpdateProperty(prop.id, 'memo', e.target.value)}
                      />
                    </td>
                    {!readOnly && (
                      <td className='action-cell'>
                        <button
                          type='button'
                          className='del-btn'
                          title='删除此属性'
                          onClick={() => handleDeleteProperty(prop.id)}
                        >
                          <Icon type='fa-trash-o' />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {properties.length === 0 && (
                  <tr>
                    <td colSpan={readOnly ? 4 : 5} className='empty-table-tip'>
                      暂无业务属性，点击上方「添加业务属性」补充
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. 右侧关联摘要 (UI-P03) */}
        <div className='object-relations-sidebar'>
          <div className='rel-card'>
            <div className='card-title'>
              <Icon type='fa-random' style={{ color: '#1890ff', marginRight: 6 }} />
              引用此对象的业务流程 ({relatedProcesses.length})
            </div>
            <div className='card-content'>
              {relatedProcesses.map(p => (
                <button type='button' key={p.id} className='rel-item' onClick={() => onOpenRelated && onOpenRelated('process', p.id)}>
                  <Icon type='fa-sitemap' style={{ marginRight: 6, color: '#1890ff' }} />
                  <span>{p.name}</span> ↗
                </button>
              ))}
              {relatedProcesses.length === 0 && (
                <div className='empty-rel-hint'>暂无关联流程</div>
              )}
            </div>
          </div>

          <div className='rel-card'>
            <div className='card-title'>
              <Icon type='fa-shield' style={{ color: '#fa8c16', marginRight: 6 }} />
              适用此对象的业务规则 ({relatedRules.length})
            </div>
            <div className='card-content'>
              {relatedRules.map(r => (
                <button type='button' key={r.id} className='rel-item' onClick={() => onOpenRelated && onOpenRelated('rule', r.id)}>
                  <Icon type='fa-check-circle' style={{ marginRight: 6, color: '#fa8c16' }} />
                  <span>{r.name}</span> ↗
                </button>
              ))}
              {relatedRules.length === 0 && (
                <div className='empty-rel-hint'>暂无适用规则</div>
              )}
            </div>
          </div>

          <div className='rel-card mapping-card'><div className='card-content'><BusinessMappings object={businessObject} source={source || {}} readOnly={readOnly} onUpdate={onUpdateObject} onOpen={onOpenAsset} /></div></div>
        </div>
      </div>
    </div>
  );
};
