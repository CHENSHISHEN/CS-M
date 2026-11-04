import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Icon } from 'components';
import BusinessSidebar from './BusinessSidebar';
import ProcessCanvas from './ProcessCanvas';
import BusinessObjectEditor from './BusinessObjectEditor';
import BusinessRuleEditor from './BusinessRuleEditor';
import BusinessInspector from './BusinessInspector';
import '../drawing/platform/style.less';
import {clone, assetDependents, platformId} from '../../lib/drawing_platform';
import {Action, t, editableTarget, ResizeHandle} from '../drawing/platform/common';
import './style/index.less';

export default ({
  dataSource,
  updateDataSource,
  readOnly = false,
  referenceSource, onNavigate, openRequest, session, onSessionChange,
  currentPrefix = 'chiner',
}) => {
  // 从数据源读取或初始化业务模型数据
  const initialBusinessData = useMemo(() => {
    return dataSource?.business || {roles: [], businessObjects: [], rules: [], processes: []};
  }, [dataSource?.business]);

  const [businessData, setBusinessData] = useState(initialBusinessData);
  const businessRef = useRef(initialBusinessData);businessRef.current = businessData;
  const history = useRef({past: [], future: []});const [, redrawHistory] = useState(0);
  const [inspectorWidth, setInspectorWidth] = useState(288);
  const [editError, setEditError] = useState('');
  const sourceRef = useRef(dataSource); sourceRef.current = dataSource;
  useEffect(() => {if (initialBusinessData !== businessRef.current) {history.current = {past: [], future: []};businessRef.current = initialBusinessData;setBusinessData(initialBusinessData);}}, [initialBusinessData]);

  // 页签状态列表
  const [openTabs, setOpenTabs] = useState(session?.tabs || [
    ...(initialBusinessData.processes.length ? [{
      type: 'process',
      id: initialBusinessData.processes[0]?.id || 'proc-order-fulfillment',
      title: initialBusinessData.processes[0]?.name || '物资采购与入库全流程',
    }] : []),
  ]);
  const [activeTabKey, setActiveTabKey] = useState(
    session?.active || `process-${initialBusinessData.processes[0]?.id || 'proc-order-fulfillment'}`
  );

  useEffect(() => {onSessionChange && onSessionChange({tabs: openTabs, active: activeTabKey});}, [openTabs, activeTabKey]);

  // 流程内选中的元素
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [selectedElementType, setSelectedElementType] = useState(null); // 'element' | 'flow'
  const [inspectorOpen, setInspectorOpen] = useState(true);

  // 同步变动至外部数据源
  const syncToDataSource = useCallback((nextData) => {
    if (readOnly) return;
    if ((sourceRef.current.business?.revision || 0) !== (businessRef.current.revision || 0)) {setEditError(t('revisionConflict'));return;}
    if (JSON.stringify(nextData) === JSON.stringify(businessRef.current)) return;
    history.current.past.push(clone(businessRef.current));history.current.past = history.current.past.slice(-100);history.current.future = [];const committed = {...nextData, revision: (businessRef.current.revision || 0) + 1};businessRef.current = committed;
    setBusinessData(committed);
    if (updateDataSource && dataSource) {
      updateDataSource({
        ...sourceRef.current,
        business: committed,
      });
    }
  }, [updateDataSource, readOnly]);

  const travel = backward => {
    if (readOnly) return;
    if ((sourceRef.current.business?.revision || 0) !== (businessRef.current.revision || 0)) {setEditError(t('revisionConflict'));return;}
    const from = history.current[backward ? 'past' : 'future'];if (!from.length) return;
    history.current[backward ? 'future' : 'past'].push(clone(businessRef.current));const next = {...from.pop(), revision: (businessRef.current.revision || 0) + 1};
    businessRef.current = next;setBusinessData(next);updateDataSource({...sourceRef.current, business: next});redrawHistory(n => n + 1);
  };

  // 获取当前活动 Tab
  const activeTab = useMemo(() => {
    return openTabs.find(t => `${t.type}-${t.id}` === activeTabKey) || openTabs[0];
  }, [openTabs, activeTabKey]);

  // 打开新 Tab 或切换至已有 Tab
  const handleOpenItem = useCallback((type, id, elementId) => {
    const key = `${type}-${id}`;
    let itemTitle = '业务项';
    if (type === 'process') {
      const p = (businessRef.current.processes || []).find(item => item.id === id);
      itemTitle = p?.name || '流程图';
    } else if (type === 'object') {
      const b = (businessRef.current.businessObjects || []).find(item => item.id === id);
      itemTitle = b?.name || '业务对象';
    } else if (type === 'rule') {
      const r = (businessRef.current.rules || []).find(item => item.id === id);
      itemTitle = r?.name || '业务规则';
    }

    if (!openTabs.some(t => t.type === type && t.id === id)) {
      setOpenTabs(prev => [...prev, { type, id, title: itemTitle }]);
    }
    setActiveTabKey(key);
    setSelectedElementId(elementId || null);
    setSelectedElementType(elementId ? 'element' : null);
  }, [openTabs, businessData]);

  useEffect(() => {
    if (openRequest?.module === 'business' && openRequest.id !== activeTab?.id) handleOpenItem(openRequest.collection === 'businessObjects' ? 'object' : 'process', openRequest.id);
  }, [openRequest?.nonce]);

  // 关闭 Tab
  const handleCloseTab = useCallback((tabType, tabId, e) => {
    e && e.stopPropagation();
    if (openTabs.length <= 1) return;
    const nextTabs = openTabs.filter(t => !(t.type === tabType && t.id === tabId));
    setOpenTabs(nextTabs);
    if (activeTabKey === `${tabType}-${tabId}`) {
      const last = nextTabs[nextTabs.length - 1];
      setActiveTabKey(`${last.type}-${last.id}`);
    }
  }, [openTabs, activeTabKey]);

  // 新建元素 (BIZ-01, BIZ-05, BIZ-07)
  const handleCreateItem = useCallback((type, name) => {
    const id = platformId(type);
    let nextData = { ...businessData };

    if (type === 'process') {
      const newProcess = {
        id,
        name,
        description: '新建业务流程',
        goal: '',
        trigger: '',
        lanes: [
          { id: `lane-${Date.now().toString(36)}`, name: '主要责任人', height: 180 },
        ],
        elements: [
          { id: `start-${Date.now().toString(36)}`, type: 'start', name: '开始' },
        ],
        flows: [],
        presentation: { cells: [] },
      };
      nextData.processes = [...(nextData.processes || []), newProcess];
    } else if (type === 'object') {
      const newBo = {
        id,
        name,
        businessKey: `BO_${Date.now().toString(36).toUpperCase()}`,
        definition: '',
        properties: [
          { id: platformId('property'), name: '业务主键', type: 'text', memo: '系统默认生成主键' },
        ],
        states: ['新建', '有效', '作废'],
      };
      nextData.businessObjects = [...(nextData.businessObjects || []), newBo];
    } else if (type === 'rule') {
      const newRule = {
        id,
        name,
        description: '',
        conditionText: '',
        resultText: '',
        enabled: true,
        scopeRefs: [],
      };
      nextData.rules = [...(nextData.rules || []), newRule];
    }

    syncToDataSource(nextData);
    handleOpenItem(type, id);
  }, [businessData, syncToDataSource, handleOpenItem]);

  // 删除元素
  const handleDeleteItem = useCallback((type, id) => {
    let nextData = { ...businessData };
    if (type === 'process') {
      nextData.processes = (nextData.processes || []).filter(p => p.id !== id);
    } else if (type === 'object') {
      nextData.businessObjects = (nextData.businessObjects || []).filter(b => b.id !== id);
    } else if (type === 'rule') {
      nextData.rules = (nextData.rules || []).filter(r => r.id !== id);
    }
    syncToDataSource(nextData);
    const remaining = openTabs.filter(t => !(t.type === type && t.id === id));setOpenTabs(remaining);if (activeTabKey === `${type}-${id}`) setActiveTabKey(remaining.length ? `${remaining[remaining.length - 1].type}-${remaining[remaining.length - 1].id}` : '');
  }, [businessData, syncToDataSource, handleCloseTab]);

  // 角色增删
  const handleAddRole = useCallback((name) => {
    const newRole = { id: `role-${Date.now().toString(36)}`, name, description: '' };
    syncToDataSource({
      ...businessData,
      roles: [...(businessData.roles || []), newRole],
    });
  }, [businessData, syncToDataSource]);

  const handleDeleteRole = useCallback((roleId) => {
    syncToDataSource({
      ...businessData,
      roles: (businessData.roles || []).filter(r => r.id !== roleId),
    });
  }, [businessData, syncToDataSource]);

  // 流程数据更新
  const handleProcessChange = useCallback((updatedProcess) => {
    const nextProcesses = (businessData.processes || []).map(p =>
      (p.id === updatedProcess.id ? updatedProcess : p)
    );
    syncToDataSource({
      ...businessData,
      processes: nextProcesses,
    });
  }, [businessData, syncToDataSource]);

  // 业务对象数据更新
  const handleObjectChange = useCallback((updatedObject) => {
    const nextObjects = (businessData.businessObjects || []).map(b =>
      (b.id === updatedObject.id ? updatedObject : b)
    );
    syncToDataSource({
      ...businessData,
      businessObjects: nextObjects,
    });
  }, [businessData, syncToDataSource]);

  // 业务规则数据更新
  const handleRuleChange = useCallback((updatedRule) => {
    const nextRules = (businessData.rules || []).map(r =>
      (r.id === updatedRule.id ? updatedRule : r)
    );
    syncToDataSource({
      ...businessData,
      rules: nextRules,
    });
  }, [businessData, syncToDataSource]);

  // 获取当前活动对象或流程
  const currentProcess = useMemo(() => {
    return (businessData.processes || []).find(p => p.id === activeTab?.id);
  }, [businessData.processes, activeTab]);

  const currentObject = useMemo(() => {
    return (businessData.businessObjects || []).find(b => b.id === activeTab?.id);
  }, [businessData.businessObjects, activeTab]);

  const currentRule = useMemo(() => {
    return (businessData.rules || []).find(r => r.id === activeTab?.id);
  }, [businessData.rules, activeTab]);

  return (
    <div className='business-workbench-shell' tabIndex={0} onKeyDown={e => {if (!editableTarget(e.target) && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {e.preventDefault();e.stopPropagation();travel(!e.shiftKey);}}}>
      {/* 1. 左侧资源栏 (240px) */}
      <BusinessSidebar
        businessData={businessData}
        activeTabType={activeTab?.type}
        activeTabId={activeTab?.id}
        onOpenItem={handleOpenItem}
        onCreateItem={handleCreateItem}
        onDeleteItem={handleDeleteItem}
        getDeleteImpact={(type, id) => {const names = type === 'object' ? assetDependents(sourceRef.current, 'businessObjects', id) : [];return names.length ? `\n${t('deleteImpact')}: ${names.join('、')}` : '';}}
        onAddRole={handleAddRole}
        onDeleteRole={handleDeleteRole}
        readOnly={readOnly}
      />

      {/* 2. 中央编辑区（多 Tab） */}
      <div className='business-workbench-center'>
        {/* Tab 条 */}
        <div className='business-history-tools platform-v3'><strong>业务建模</strong><Action disabled={readOnly || !history.current.past.length} onClick={() => travel(true)}>{t('undo')}</Action><Action disabled={readOnly || !history.current.future.length} onClick={() => travel(false)}>{t('redo')}</Action>{activeTab?.type === 'process' && <Action onClick={() => setInspectorOpen(!inspectorOpen)}>{t('properties')}</Action>}</div>
        {editError && <div className='pv-mappings'><div className='pv-error' role='alert'>{editError}<Action onClick={() => setEditError('')}>×</Action></div></div>}
        <div className='business-tab-bar'>
          <div className='tab-items-wrapper'>
            {openTabs.map(tab => (
              <div
                key={`${tab.type}-${tab.id}`}
                className={`business-tab-item ${activeTabKey === `${tab.type}-${tab.id}` ? 'active' : ''}`}
                onClick={() => {
                  setActiveTabKey(`${tab.type}-${tab.id}`);
                  setSelectedElementId(null);
                }}
              >
                <Icon
                  type={
                    tab.type === 'process' ? 'fa-sitemap' : (tab.type === 'object' ? 'fa-cube' : 'fa-shield')
                  }
                  className='tab-icon'
                  style={{
                    color: tab.type === 'process' ? '#1890ff' : (tab.type === 'object' ? '#52c41a' : '#fa8c16'),
                  }}
                />
                <span className='tab-title'>{tab.title}</span>
                {openTabs.length > 1 && (
                  <Icon
                    type='fa-times'
                    className='tab-close'
                    onClick={e => handleCloseTab(tab.type, tab.id, e)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tab 视口内容 */}
        <div className='business-tab-content'>
          {!activeTab && <div className='empty-editor-tip'>请从左侧新建业务流程、对象、规则，或到画图平台模板中心创建业务建模包。</div>}
          {activeTab?.type === 'process' && currentProcess && (
            <ProcessCanvas
              key={currentProcess.id}
              processData={currentProcess}
              roles={businessData.roles || []}
              businessObjects={businessData.businessObjects || []}
              rules={businessData.rules || []}
              onProcessChange={handleProcessChange}
              selectedElementId={selectedElementId}
              onSelectElement={(id, type) => {
                setSelectedElementId(id);
                setSelectedElementType(type);
                if (id && !inspectorOpen) setInspectorOpen(true);
              }}
              readOnly={readOnly}
            />
          )}

          {activeTab?.type === 'object' && currentObject && (
            <BusinessObjectEditor
              key={currentObject.id}
              onOpenRelated={handleOpenItem}
              businessObject={currentObject}
              source={referenceSource || dataSource}
              onOpenAsset={ref => onNavigate && onNavigate({module: 'data', collection: ref.objectType, id: ref.objectId})}
              allProcesses={businessData.processes || []}
              allRules={businessData.rules || []}
              onUpdateObject={handleObjectChange}
              readOnly={readOnly}
            />
          )}

          {activeTab?.type === 'rule' && currentRule && (
            <BusinessRuleEditor
              key={currentRule.id}
              onOpenRelated={handleOpenItem}
              rule={currentRule}
              allBusinessObjects={businessData.businessObjects || []}
              allProcesses={businessData.processes || []}
              onUpdateRule={handleRuleChange}
              readOnly={readOnly}
            />
          )}
        </div>
      </div>

      {/* 3. 右侧上下文面板 (280px) */}
      {inspectorOpen && activeTab?.type === 'process' && (<><div className='platform-v3 business-inspector-split'><ResizeHandle side='right' startWidth={inspectorWidth} onWidth={v => setInspectorWidth(Math.max(260, Math.min(v, 440)))} /></div><div className='business-inspector-wrap' style={{width: inspectorWidth}}>
        <BusinessInspector
          activeTabType={activeTab?.type}
          selectedElementId={selectedElementId}
          selectedElementType={selectedElementType}
          activeProcess={currentProcess}
          onOpenRelated={handleOpenItem}
          onUpdateProcess={handleProcessChange}
          roles={businessData.roles || []}
          businessObjects={businessData.businessObjects || []}
          rules={businessData.rules || []}
          onUpdateElement={(updatedEl) => {
            if (!currentProcess) return;
            const nextElements = (currentProcess.elements || []).map(e =>
              (e.id === updatedEl.id ? updatedEl : e)
            );
            handleProcessChange({ ...currentProcess, elements: nextElements });
          }}
          onUpdateFlow={(updatedFlow) => {
            if (!currentProcess) return;
            const nextFlows = (currentProcess.flows || []).map(f =>
              (f.id === updatedFlow.id ? updatedFlow : f)
            );
            handleProcessChange({ ...currentProcess, flows: nextFlows });
          }}
          onClose={() => setInspectorOpen(false)}
          readOnly={readOnly}
        /></div></>
      )}
    </div>
  );
};
