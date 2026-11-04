import React from 'react';
import { Icon } from 'components';
import {platformId} from '../../lib/drawing_platform';
import {t, Field, Action} from '../drawing/platform/common';
import { ELEMENT_TYPES } from '../../lib/businessStorage';

export default ({
  activeTabType, // 'process' | 'object' | 'rule'
  selectedElementId,
  selectedElementType, // 'element' | 'flow'
  activeProcess,
  roles = [],
  businessObjects = [],
  rules = [],
  onUpdateElement, onUpdateProcess, onOpenRelated,
  onUpdateFlow,
  onClose,
  readOnly = false,
}) => {
  // 1. 如果当前选中的是流程图中的元素
  if (activeTabType === 'process' && selectedElementId) {
    if (selectedElementType === 'element') {
      const element = (activeProcess?.elements || []).find(e => e.id === selectedElementId);
      if (!element) return null;

      const lanes = activeProcess?.lanes || [];

      // 切换输入业务对象
      const handleToggleInputObject = (boId) => {
        if (readOnly) return;
        const currentInputs = element.inputObjectIds || [];
        const nextInputs = currentInputs.includes(boId)
          ? currentInputs.filter(id => id !== boId)
          : [...currentInputs, boId];
        onUpdateElement && onUpdateElement({ ...element, inputObjectIds: nextInputs });
      };

      // 切换输出业务对象
      const handleToggleOutputObject = (boId) => {
        if (readOnly) return;
        const currentOutputs = element.outputObjectIds || [];
        const nextOutputs = currentOutputs.includes(boId)
          ? currentOutputs.filter(id => id !== boId)
          : [...currentOutputs, boId];
        onUpdateElement && onUpdateElement({ ...element, outputObjectIds: nextOutputs });
      };

      return (
        <div className='business-inspector-container'>
          <div className='inspector-header'>
            <span className='title'>节点上下文属性</span>
            <button type='button' className='close-btn' onClick={onClose}><Icon type='fa-times' /></button>
          </div>

          <div className='inspector-body'>
            <div className='element-card'>
              <div className='element-type-tag'>{element.type.toUpperCase()}</div>
              <div className='element-name'>{element.name}</div>
            </div>

            {/* 名称修改 */}
            <div className='form-item'>
              <label>节点名称</label>
              <input
                type='text'
                value={element.name}
                disabled={readOnly}
                onChange={e => onUpdateElement && onUpdateElement({ ...element, name: e.target.value })}
              />
            </div>

            {/* 泳道职责分配 (BIZ-03) */}
            {element.type === ELEMENT_TYPES.ACTIVITY && (
              <div className='form-item'>
                <label>所属职责泳道</label>
                <select
                  value={element.laneId || ''}
                  disabled={readOnly}
                  onChange={e => onUpdateElement && onUpdateElement({ ...element, laneId: e.target.value })}
                >
                  <option value=''>未分配泳道</option>
                  {lanes.map((lane) => {
                    const role = roles.find(r => r.id === lane.roleId);
                    return (
                      <option key={lane.id} value={lane.id}>
                        {lane.name || role?.name || '泳道'}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {/* 业务活动专属：输入与输出业务对象关联 (BIZ-08) */}
            {element.type === ELEMENT_TYPES.ACTIVITY && (
              <>
                <div className='form-item section-box'>
                  <label>
                    <Icon type='fa-arrow-circle-right' style={{ color: '#1890ff', marginRight: 6 }} />
                    输入业务对象 (Input Objects)
                  </label>
                  <div className='checkbox-group'>
                    {businessObjects.map(bo => (
                      <label key={bo.id} className='object-checkbox-item'>
                        <input
                          type='checkbox'
                          checked={(element.inputObjectIds || []).includes(bo.id)}
                          disabled={readOnly}
                          onChange={() => handleToggleInputObject(bo.id)}
                        />
                        <span>{bo.name}</span><button type='button' onClick={e => {e.preventDefault();e.stopPropagation();onOpenRelated && onOpenRelated('object', bo.id);}}>↗</button>
                      </label>
                    ))}
                  </div>
                </div>

                <div className='form-item section-box'>
                  <label>
                    <Icon type='fa-arrow-circle-left' style={{ color: '#52c41a', marginRight: 6 }} />
                    输出业务对象 (Output Objects)
                  </label>
                  <div className='checkbox-group'>
                    {businessObjects.map(bo => (
                      <label key={bo.id} className='object-checkbox-item'>
                        <input
                          type='checkbox'
                          checked={(element.outputObjectIds || []).includes(bo.id)}
                          disabled={readOnly}
                          onChange={() => handleToggleOutputObject(bo.id)}
                        />
                        <span>{bo.name}</span><button type='button' onClick={e => {e.preventDefault();e.stopPropagation();onOpenRelated && onOpenRelated('object', bo.id);}}>↗</button>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
            <div className='form-item section-box'><label>{t('applicableRules')}</label>{rules.map(r => <div key={r.id}><label><input type='checkbox' disabled={readOnly} checked={(r.scopeRefs || []).some(ref => ref.type === 'activity' && ref.id === element.id)} onChange={() => onOpenRelated && onOpenRelated('rule', r.id)} /> {r.name}</label><button type='button' onClick={() => onOpenRelated && onOpenRelated('rule', r.id)}>↗</button></div>)}</div>
          </div>
        </div>
      );
    }

    if (selectedElementType === 'flow') {
      const flow = (activeProcess?.flows || []).find(f => f.id === selectedElementId);
      if (!flow) return null;

      return (
        <div className='business-inspector-container'>
          <div className='inspector-header'>
            <span className='title'>流转分支属性</span>
            <button type='button' className='close-btn' onClick={onClose}><Icon type='fa-times' /></button>
          </div>
          <div className='inspector-body'>
            <div className='form-item'>
              <label>分支判定条件 (Condition)</label>
              <input
                type='text'
                value={flow.condition || ''}
                disabled={readOnly}
                placeholder='如：金额 > 5万元'
                onChange={e => onUpdateFlow && onUpdateFlow({ ...flow, condition: e.target.value })}
              />
            </div>

            <div className='form-item checkbox-row'>
              <label>
                <input
                  type='checkbox'
                  checked={flow.isDefault || false}
                  disabled={readOnly}
                  onChange={e => onUpdateFlow && onUpdateFlow({ ...flow, isDefault: e.target.checked })}
                />
                <span style={{ marginLeft: 8 }}>标记为默认分支 (Default Branch)</span>
              </label>
            </div>
          </div>
        </div>
      );
    }
  }

  if (activeTabType === 'process' && activeProcess) {
    const patch = value => !readOnly && onUpdateProcess && onUpdateProcess({...activeProcess, ...value});
    return <div className='business-inspector-container'><div className='inspector-header'><strong>{t('processProperties')}</strong><button type='button' onClick={onClose}>×</button></div><div className='inspector-body pv-mappings'>
      {['name', 'description', 'goal', 'trigger'].map(k => <Field key={k} label={t(k)}><input disabled={readOnly} value={activeProcess[k] || ''} onChange={e => patch({[k]: e.target.value})} /></Field>)}
      <Field label={t('owner')}><select disabled={readOnly} value={activeProcess.ownerRoleId || ''} onChange={e => patch({ownerRoleId: e.target.value})}><option value=''>{t('none')}</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <h3>{t('responsibilityLanes')}</h3>{(activeProcess.lanes || []).map(l => <div key={l.id} className='pv-reference-card'><Field label={t('name')}><input disabled={readOnly} value={l.name} onChange={e => patch({lanes: activeProcess.lanes.map(a => a.id === l.id ? {...a, name: e.target.value} : a)})} /></Field><Field label={t('role')}><select disabled={readOnly} value={l.roleId || ''} onChange={e => patch({lanes: activeProcess.lanes.map(a => a.id === l.id ? {...a, roleId: e.target.value} : a)})}><option value=''>{t('none')}</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><Action disabled={readOnly} onClick={() => patch({lanes: activeProcess.lanes.filter(a => a.id !== l.id), elements: (activeProcess.elements || []).map(e => e.laneId === l.id ? {...e, laneId: null} : e)})}>{t('deleteLane')}</Action></div>)}
      <Action disabled={readOnly} onClick={() => patch({lanes: [...(activeProcess.lanes || []), {id: platformId('lane'), name: t('newLane'), roleId: '', height: 180}]})}>＋ {t('newLane')}</Action>
    </div></div>;
  }

  // 默认概要
  return (
    <div className='business-inspector-container empty'>
      <div className='empty-hint-card'>
        <Icon type='fa-info-circle' style={{ fontSize: 24, color: '#bfbfbf', marginBottom: 8 }} />
        <p>在左侧选择业务对象、规则或在流程图中选择节点以查看属性。</p>
      </div>
    </div>
  );
};
