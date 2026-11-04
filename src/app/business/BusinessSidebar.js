import React, { useState } from 'react';
import { Icon, Modal } from 'components';
import { PROCESS_ELEMENT_CONFIGS } from './processShapes';

export default ({
  businessData,
  activeTabType, // 'process' | 'object' | 'rule'
  activeTabId,
  onOpenItem, // (type: 'process' | 'object' | 'rule', id: string) => void
  onCreateItem, // (type: 'process' | 'object' | 'rule', name: string) => void
  getDeleteImpact,
  onDeleteItem, // (type: 'process' | 'object' | 'rule', id: string) => void
  onAddRole,
  onDeleteRole,
  onAddProcessElement, // (elementType: string) => void
  readOnly = false,
}) => {
  const [searchKey, setSearchKey] = useState('');
  const [activeSection, setActiveSection] = useState('all'); // 'all' | 'process' | 'object' | 'rule' | 'role'

  const {
    processes = [],
    businessObjects = [],
    rules = [],
    roles = [],
  } = businessData || {};

  const filterText = searchKey.trim().toLowerCase();

  const filteredProcesses = processes.filter(p => (p.name || '').toLowerCase().includes(filterText));
  const filteredObjects = businessObjects.filter(b => (b.name || b.businessKey || '').toLowerCase().includes(filterText));
  const filteredRules = rules.filter(r => (r.name || '').toLowerCase().includes(filterText));
  const filteredRoles = roles.filter(r => (r.name || '').toLowerCase().includes(filterText));

  // 弹窗创建对象
  const handlePromptCreate = (type, title, placeholder) => {
    if (readOnly) return;
    Modal.prompt({
      title,
      placeholder,
      onOk: (name) => {
        if (!name || !name.trim()) return;
        onCreateItem && onCreateItem(type, name.trim());
      },
    });
  };

  const handleCreateRole = () => {
    if (readOnly) return;
    Modal.prompt({
      title: '新增业务角色',
      placeholder: '请输入角色名称（如：采购专员、财务主管）',
      onOk: (name) => {
        if (!name || !name.trim()) return;
        onAddRole && onAddRole(name.trim());
      },
    });
  };

  return (
    <div className='business-sidebar-container'>
      {/* 头部标题与搜索 */}
      <div className='business-sidebar-header'>
        <div className='sidebar-brand'>
          <Icon type='fa-briefcase' style={{ color: '#13c2c2', marginRight: 8, fontSize: 15 }} />
          <span className='header-title'>业务建模资源</span>
        </div>
      </div>

      <div className='business-sidebar-search'>
        <Icon type='fa-search' className='search-icon' />
        <input
          type='text'
          placeholder='搜索流程、对象、规则...'
          value={searchKey}
          onChange={e => setSearchKey(e.target.value)}
        />
        {searchKey && (
          <Icon type='fa-times-circle' className='clear-icon' onClick={() => setSearchKey('')} />
        )}
      </div>

      <div className='business-sidebar-body'>
        {/* 1. 业务流程 (UI-P02) */}
        <div className='sidebar-group'>
          <div className='group-header'>
            <span className='group-title'>
              <Icon type='fa-random' style={{ color: '#1890ff', marginRight: 6 }} />
              业务流程 ({filteredProcesses.length})
            </span>
            {!readOnly && (
              <button
                type='button'
                className='create-btn'
                title='新建业务流程'
                onClick={() => handlePromptCreate('process', '新建业务流程', '请输入流程名称（如：物资采购审批流程）')}
              >
                <Icon type='fa-plus' />
              </button>
            )}
          </div>
          <div className='group-list'>
            {filteredProcesses.map(proc => (
              <div
                key={proc.id}
                className={`item-row ${activeTabType === 'process' && activeTabId === proc.id ? 'active' : ''}`}
                onClick={() => onOpenItem && onOpenItem('process', proc.id)}
              >
                <Icon type='fa-sitemap' className='item-icon' />
                <span className='item-name' title={proc.name}>{proc.name}</span>
                {!readOnly && (
                  <button
                    type='button'
                    className='row-action-btn'
                    title='删除流程'
                    onClick={(e) => {
                      e.stopPropagation();
                      Modal.confirm({
                        title: '删除流程',
                        message: `确定要删除业务流程「${proc.name}」吗？`,
                        onOk: () => onDeleteItem && onDeleteItem('process', proc.id),
                      });
                    }}
                  >
                    <Icon type='fa-trash-o' />
                  </button>
                )}
              </div>
            ))}
            {filteredProcesses.length === 0 && (
              <div className='empty-hint'>暂无业务流程</div>
            )}
          </div>
        </div>

        {/* 2. 业务对象 (UI-P03) */}
        <div className='sidebar-group'>
          <div className='group-header'>
            <span className='group-title'>
              <Icon type='fa-cube' style={{ color: '#52c41a', marginRight: 6 }} />
              业务对象 ({filteredObjects.length})
            </span>
            {!readOnly && (
              <button
                type='button'
                className='create-btn'
                title='新建业务对象'
                onClick={() => handlePromptCreate('object', '新建业务对象', '请输入业务对象名称（如：采购订单、入库单）')}
              >
                <Icon type='fa-plus' />
              </button>
            )}
          </div>
          <div className='group-list'>
            {filteredObjects.map(bo => (
              <div
                key={bo.id}
                className={`item-row ${activeTabType === 'object' && activeTabId === bo.id ? 'active' : ''}`}
                onClick={() => onOpenItem && onOpenItem('object', bo.id)}
              >
                <Icon type='fa-table' className='item-icon' style={{ color: '#52c41a' }} />
                <span className='item-name' title={`${bo.name} (${bo.businessKey || ''})`}>
                  {bo.name}
                </span>
                {!readOnly && (
                  <button
                    type='button'
                    className='row-action-btn'
                    title='删除对象'
                    onClick={(e) => {
                      e.stopPropagation();
                      Modal.confirm({
                        title: '删除业务对象',
                        message: `确定要删除业务对象「${bo.name}」吗？${getDeleteImpact ? getDeleteImpact('object', bo.id) : ''}`,
                        onOk: () => onDeleteItem && onDeleteItem('object', bo.id),
                      });
                    }}
                  >
                    <Icon type='fa-trash-o' />
                  </button>
                )}
              </div>
            ))}
            {filteredObjects.length === 0 && (
              <div className='empty-hint'>暂无业务对象</div>
            )}
          </div>
        </div>

        {/* 3. 业务规则 (UI-P04) */}
        <div className='sidebar-group'>
          <div className='group-header'>
            <span className='group-title'>
              <Icon type='fa-shield' style={{ color: '#fa8c16', marginRight: 6 }} />
              业务规则 ({filteredRules.length})
            </span>
            {!readOnly && (
              <button
                type='button'
                className='create-btn'
                title='新建业务规则'
                onClick={() => handlePromptCreate('rule', '新建业务规则', '请输入规则名称（如：大额采购审批规则）')}
              >
                <Icon type='fa-plus' />
              </button>
            )}
          </div>
          <div className='group-list'>
            {filteredRules.map(rule => (
              <div
                key={rule.id}
                className={`item-row ${activeTabType === 'rule' && activeTabId === rule.id ? 'active' : ''}`}
                onClick={() => onOpenItem && onOpenItem('rule', rule.id)}
              >
                <Icon
                  type={rule.enabled ? 'fa-check-circle' : 'fa-minus-circle'}
                  className='item-icon'
                  style={{ color: rule.enabled ? '#52c41a' : '#bfbfbf' }}
                />
                <span className='item-name' title={rule.name}>{rule.name}</span>
                {!readOnly && (
                  <button
                    type='button'
                    className='row-action-btn'
                    title='删除规则'
                    onClick={(e) => {
                      e.stopPropagation();
                      Modal.confirm({
                        title: '删除业务规则',
                        message: `确定要删除业务规则「${rule.name}」吗？`,
                        onOk: () => onDeleteItem && onDeleteItem('rule', rule.id),
                      });
                    }}
                  >
                    <Icon type='fa-trash-o' />
                  </button>
                )}
              </div>
            ))}
            {filteredRules.length === 0 && (
              <div className='empty-hint'>暂无业务规则</div>
            )}
          </div>
        </div>

        {/* 4. 角色与职责维护 (BIZ-03) */}
        <div className='sidebar-group'>
          <div className='group-header'>
            <span className='group-title'>
              <Icon type='fa-users' style={{ color: '#722ed1', marginRight: 6 }} />
              业务角色 ({filteredRoles.length})
            </span>
            {!readOnly && (
              <button
                type='button'
                className='create-btn'
                title='新增角色'
                onClick={handleCreateRole}
              >
                <Icon type='fa-plus' />
              </button>
            )}
          </div>
          <div className='group-list'>
            {filteredRoles.map(role => (
              <div key={role.id} className='item-row role-row'>
                <Icon type='fa-user' className='item-icon' style={{ color: '#722ed1' }} />
                <span className='item-name' title={role.name}>{role.name}</span>
                {!readOnly && (
                  <button
                    type='button'
                    className='row-action-btn'
                    title='删除角色'
                    onClick={(e) => {
                      e.stopPropagation();
                      Modal.confirm({
                        title: '删除角色',
                        message: `确定要删除角色「${role.name}」吗？`,
                        onOk: () => onDeleteRole && onDeleteRole(role.id),
                      });
                    }}
                  >
                    <Icon type='fa-trash-o' />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 5. 流程图元快捷面板（在活动流程图时辅助展示） */}
        {activeTabType === 'process' && (
          <div className='sidebar-group process-tools-group'>
            <div className='group-header'>
              <span className='group-title'>
                <Icon type='fa-th-large' style={{ color: '#1890ff', marginRight: 6 }} />
                流程元素工具
              </span>
            </div>
            <div className='element-tools-grid'>
              {PROCESS_ELEMENT_CONFIGS.map(cfg => (
                <div
                  key={cfg.type}
                  className='element-tool-card'
                  title={`点击向当前流程添加【${cfg.name}】`}
                  onClick={() => onAddProcessElement && onAddProcessElement(cfg.type)}
                >
                  <span className='tool-dot' style={{ backgroundColor: cfg.color }} />
                  <span className='tool-label'>{cfg.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
