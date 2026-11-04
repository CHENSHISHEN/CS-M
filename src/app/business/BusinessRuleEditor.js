import React, { useMemo } from 'react';
import { Icon, Modal } from 'components';
import {t} from '../drawing/platform/common';
import { checkRuleIntegrity } from '../../lib/businessStorage';

export default ({
  rule,
  allBusinessObjects = [],
  allProcesses = [],
  onUpdateRule, onOpenRelated,
  readOnly = false,
}) => {
  if (!rule) {
    return <div className='empty-editor-tip'>请选择左侧业务规则查看或编辑</div>;
  }

  const {
    id,
    name = '',
    description = '',
    conditionText = '',
    resultText = '',
    enabled = true,
    scopeRefs = [],
  } = rule;

  // 更新字段
  const handleFieldChange = (field, val) => {
    if (readOnly) return;
    onUpdateRule && onUpdateRule({
      ...rule,
      [field]: val,
    });
  };

  // 适用范围切换绑定
  const handleToggleScope = (type, targetId) => {
    if (readOnly) return;
    const exists = scopeRefs.some(r => r.type === type && r.id === targetId);
    let nextRefs = [];
    if (exists) {
      nextRefs = scopeRefs.filter(r => !(r.type === type && r.id === targetId));
    } else {
      nextRefs = [...scopeRefs, { type, id: targetId }];
    }
    onUpdateRule && onUpdateRule({
      ...rule,
      scopeRefs: nextRefs,
    });
  };

  // 规则完整性校验 (BIZ-09)
  const integrityIssues = useMemo(() => {
    return checkRuleIntegrity(rule, allBusinessObjects, allProcesses);
  }, [rule, allBusinessObjects, allProcesses]);

  return (
    <div className='business-rule-editor'>
      {/* 1. 顶部规则标题与启用开关 (UI-P04) */}
      <div className='rule-header-card'>
        <div className='header-top-row'>
          <div className='title-group'>
            <Icon type='fa-shield' style={{ color: '#fa8c16', fontSize: 20, marginRight: 10 }} />
            <input
              type='text'
              className='rule-name-input'
              value={name}
              disabled={readOnly}
              onChange={e => handleFieldChange('name', e.target.value)}
              placeholder='业务规则名称（如：大额采购审批规则）'
            />
          </div>

          {/* 启用/停用真实操作开关 */}
          <div className='enable-toggle-group'>
            <span className='toggle-label'>规则状态：</span>
            <button
              type='button'
              className={`rule-toggle-switch ${enabled ? 'active' : ''}`}
              disabled={readOnly}
              onClick={() => handleFieldChange('enabled', !enabled)}
              title={enabled ? '点击停用此规则' : '点击启用此规则'}
            >
              <span className='switch-slider' />
              <span className='switch-text'>{enabled ? '已启用' : '已停用'}</span>
            </button>
          </div>
        </div>

        <div className='desc-group'>
          <label className='field-label'>规则业务说明：</label>
          <textarea
            className='field-textarea'
            value={description}
            disabled={readOnly}
            onChange={e => handleFieldChange('description', e.target.value)}
            placeholder='说明该规则的业务背景、合规要求与防范风险...'
            rows={2}
          />
        </div>
      </div>

      {/* 2. 规则表达式与结论定义 */}
      <div className='rule-editor-body'>
        <div className='rule-logic-column'>
          {/* 条件描述 */}
          <div className='rule-section-card'>
            <div className='section-title'>
              <Icon type='fa-filter' style={{ color: '#1890ff', marginRight: 6 }} />
              业务触发条件 (WHEN)
            </div>
            <textarea
              className='logic-textarea condition-textarea'
              value={conditionText}
              disabled={readOnly}
              onChange={e => handleFieldChange('conditionText', e.target.value)}
              placeholder='自然语言或业务判定条件，例如：&#10;采购订单.采购总额 > 50000 且 采购单.是否加急 == true'
              rows={4}
            />
          </div>

          {/* 结论描述 */}
          <div className='rule-section-card'>
            <div className='section-title'>
              <Icon type='fa-check-square-o' style={{ color: '#52c41a', marginRight: 6 }} />
              执行结论与动作 (THEN)
            </div>
            <textarea
              className='logic-textarea result-textarea'
              value={resultText}
              disabled={readOnly}
              onChange={e => handleFieldChange('resultText', e.target.value)}
              placeholder='业务结论或流转动作，例如：&#10;强制阻断直接下单，任务自动流转至「部门主管审批」节点会签'
              rows={4}
            />
          </div>
        </div>

        {/* 3. 右侧适用范围与完整性检查 (UI-P04) */}
        <div className='rule-scope-column'>
          {/* 适用对象绑定 */}
          <div className='scope-card'>
            <div className='card-title'>
              <Icon type='fa-tags' style={{ color: '#1890ff', marginRight: 6 }} />
              适用业务对象范围
            </div>
            <div className='scope-list'>
              {allBusinessObjects.map((bo) => {
                const checked = scopeRefs.some(r => r.type === 'businessObject' && r.id === bo.id);
                return (
                  <label key={bo.id} className={`scope-item-checkbox ${checked ? 'checked' : ''}`}>
                    <input
                      type='checkbox'
                      checked={checked}
                      disabled={readOnly}
                      onChange={() => handleToggleScope('businessObject', bo.id)}
                    />
                    <span className='name'>{bo.name}</span><button type='button' onClick={e => {e.preventDefault();e.stopPropagation();onOpenRelated && onOpenRelated('object', bo.id);}}>↗</button>
                    <span className='key'>({bo.businessKey || bo.id})</span>
                  </label>
                );
              })}
              {allBusinessObjects.length === 0 && (
                <div className='empty-hint'>暂无可关联的业务对象</div>
              )}
            </div>
          </div>

          <div className='scope-card'><div className='card-title'>{t('activityScope')}</div><div className='scope-list'>{allProcesses.map(p => <div key={p.id}><strong>{p.name}</strong>{(p.elements || []).filter(e => e.type === 'activity').map(e => <div className='scope-item-checkbox' key={e.id}><label><input type='checkbox' disabled={readOnly} checked={scopeRefs.some(r => r.type === 'activity' && r.id === e.id)} onChange={() => handleToggleScope('activity', e.id)} /> {e.name}</label><button type='button' onClick={() => onOpenRelated && onOpenRelated('process', p.id, e.id)}>↗</button></div>)}</div>)}</div></div>

          {/* 规则完整性检查报告 (BIZ-09) */}
          <div className='integrity-card'>
            <div className='card-title'>
              <Icon
                type={integrityIssues.length === 0 ? 'fa-check-circle' : 'fa-exclamation-circle'}
                style={{ color: integrityIssues.length === 0 ? '#52c41a' : '#faad14', marginRight: 6 }}
              />
              规则完整性检查
            </div>
            <div className='integrity-body'>
              {integrityIssues.length === 0 ? (
                <div className='valid-banner'>
                  <Icon type='fa-check' style={{ marginRight: 6 }} />
                  规则定义完整，适用范围与表达式结构规范。
                </div>
              ) : (
                <div className='issues-list'>
                  {integrityIssues.map((issue, idx) => (
                    <div key={idx} className={`issue-row ${issue.level}`}>
                      <Icon
                        type={issue.level === 'error' ? 'fa-times-circle' : 'fa-exclamation-triangle'}
                        style={{ marginRight: 6 }}
                      />
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
