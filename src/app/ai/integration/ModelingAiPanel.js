// 建模检查器 AI 页签（INTEGRATION）：
// AssistantPanel（对话）+ ProviderController（服务设置）+ ContextPicker（范围）
// + ChangeReview（三栏审阅）编排。全部业务写入经 aiRuntime 的共享 GATEWAY：
// 预演/部分勾选/确认/提交/撤销/保存回执都走同一状态机，不复制守卫逻辑。
// 面板状态由本组件持有（assistantReducer），候选与回执经 props 回调上报 main
// （临时候选 tab 渲染与项目保存接缝在 main 完成）。
import React, {forwardRef, useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react';
import {AssistantPanel, ContextPicker, ChangeReview, createMessages} from '../index';
import ProviderController from './ProviderController';
import fieldDiffRows from './fieldDiff';
import {runModelingRequest, describeError, AI_PROVIDER_ID} from './aiRuntime';
import {
  assistantReducer, createAssistantState, TASK_STATUS, PLAN_STATUS,
  deriveApplyState, dependentIds,
} from '../stateAdapter';

const COLLECTION_LABELS = {
  entities: 'entity', logicEntities: 'logicEntity', conceptEntities: 'conceptEntity',
  views: 'view', diagrams: 'diagram', dicts: 'dict',
};

const opLabel = (op) => {
  const names = {
    'model.table.create': '新建表', 'model.field.add': '新增字段',
    'model.foreignKey.create': '新建外键', 'model.diagram.create': '新建关系图',
    'standard.group.create': '新建标准分组', 'standard.root.create': '新建词根',
    'standard.field.create': '新建标准字段', 'quality.modelRuleSet.create': '新建质量规则集',
  };
  return names[op.command] || op.command;
};

const ModelingAiPanel = forwardRef(({
  runtime,                                   // aiRuntime 实例（必需）
  locale = 'zh',
  labels,
  dataSource,                                // 宿主有效草稿（上下文组合与对象选择）
  draftVersion,
  readOnly = false,
  service: serviceProp,                      // 供 main 强制同步（缺省内部状态）
  onOpenSettings,                            // 缺省在面板内渲染 ProviderController
  onCandidateChange,                         // (candidate, plan|null, meta) → main 临时候选 tab
  onSaveProject,                             // (cb(failed:boolean)) 真实 saveProject 接缝
  onOpenObject,                              // (id, type) 定位对象
  sqlPanel,                                  // 可选 SQL DDL 子视图（由 main 注入，独立组件）
  initialUserText,                           // 外部注入（质量修复候选等）一次性消费
  onInitialTextConsumed,
}, ref) => {
  const t = useMemo(() => createMessages(locale, labels), [locale, labels]);
  const [state, dispatch] = useReducer(assistantReducer,
    createAssistantState({projectId: dataSource?.name || null}));
  const [providerVisible, setProviderVisible] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [sqlVisible, setSqlVisible] = useState(false);
  // 当前候选：{planId, plan, candidate, selectedOpIds:Set}
  const [review, setReview] = useState(null);
  const [applying, setApplying] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle|dirty|saving|saved|error
  const [undoBusy, setUndoBusy] = useState(false);
  const [injectText, setInjectText] = useState(null);
  const capabilitiesRef = useRef({stream: false, tools: false, jsonMode: false});
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const contextRef = useRef([]);
  contextRef.current = state.contextItems;
  // 面板代际（INTEGRATION-R1）：停止/新任务/切项目时 +1，迟到的旧响应在 UI
  // 层静默丢弃（runtime 层已按 run 代际作废，这里保证错误提示也不冒出来）
  const uiRunRef = useRef(0);

  // ---- 服务状态：ProviderController 回喂（或 main 注入） ----
  const [serviceState, setServiceState] = useState({status: 'unconfigured'});
  useEffect(() => {
    if (serviceProp) setServiceState(serviceProp);
  }, [serviceProp]);
  const handleServiceChange = useCallback((next) => {
    setServiceState(next);
    dispatch({type: 'serviceStatus', status: next.status,
      alias: next.alias, error: next.error});
  }, []);
  const handleConfigured = useCallback((masked) => {
    if (masked && masked.capabilities) {
      capabilitiesRef.current = {
        stream: masked.capabilities.stream === true,
        tools: masked.capabilities.tools === true,
        jsonMode: masked.capabilities.jsonMode === true,
      };
    }
  }, []);

  // ---- 外部注入文本（质量修复候选）一次性进入 composer ----
  useEffect(() => {
    if (initialUserText && !injectText) {
      setInjectText(initialUserText);
      dispatch({type: 'draftChange', value: initialUserText});
      if (onInitialTextConsumed) onInitialTextConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUserText]);

  // ---- 默认隐式上下文：当前对象目录（不可移除）+ 可选显式对象 ----
  useEffect(() => {
    dispatch({type: 'contextSet', items: [{
      id: 'catalog-current', kind: 'catalog', implicit: true, removable: false,
    }]});
  }, [dataSource?.name]);

  // ---- 切项目清理（INTEGRATION-R1 保活配套）：面板常驻挂载后，项目切换
  // 经此 effect 清空上一项目的对话/候选/回执，不跨项目泄漏；同项目内
  // 切页签/临时关闭不清（宿主保活负责保留）。runtime 侧会话历史随
  // setSession 的项目/epoch 变化同步清空。 ----
  const projectId = dataSource?.name || null;
  const prevProjectRef = useRef(projectId);

  // 候选上报 main（临时候选 tab）
  const publishCandidate = useCallback((next) => {
    if (onCandidateChange) {
      onCandidateChange(next ? {
        planId: next.planId,
        plan: next.plan,
        candidate: next.candidate,
        selectedOpIds: [...next.selectedOpIds],
      } : null, 'modeling');
    }
  }, [onCandidateChange]);

  useEffect(() => {
    if (prevProjectRef.current !== projectId) {
      prevProjectRef.current = projectId;
      // 切项目：作废在途生成（旧响应不冒出来）后清理上一项目状态
      uiRunRef.current += 1;
      if (runtimeRef.current) runtimeRef.current.nextRun();
      dispatch({type: 'projectSwitch', projectId});
      setReview(null);
      setReceipt(null);
      setSaveState('idle');
      publishCandidate(null);
    }
  }, [projectId, publishCandidate]);

  // ---- ChangeReview 条目映射（candidate.changes → 按 op 聚合） ----
  const reviewItems = useMemo(() => {
    if (!review) return [];
    const byOp = new Map();
    (review.candidate.changes || []).forEach((change) => {
      if (!byOp.has(change.opId)) byOp.set(change.opId, []);
      byOp.get(change.opId).push(change);
    });
    const blockedOps = new Set((review.candidate.blockingIssues || [])
      .map(issue => issue.opId).filter(Boolean));
    return (review.plan.operations || []).map((op) => {
      const changes = byOp.get(op.opId) || [];
      const first = changes[0];
      const label = first ? (first.after?.defKey || first.before?.defKey
        || first.target?.localKey || first.target?.id) : opLabel(op);
      return {
        id: op.opId,
        category: opLabel(op),
        label,
        path: changes[0]?.target?.collection,
        selected: review.selectedOpIds.has(op.opId),
        deps: op.dependsOn || [],
        blocked: blockedOps.has(op.opId) || !changes.length,
        warn: (review.candidate.warnings || []).some(w => w.opId === op.opId && w.level === 'warning'),
        // UI-R2：能按 opId 定位的阻断 issue 挂到条目（审阅展示真实 code/message）
        issues: (review.candidate.blockingIssues || []).filter(issue => issue.opId === op.opId),
      };
    });
  }, [review]);

  const planCard = useMemo(() => {
    if (!review) return state.plan;
    const counts = review.candidate.counts || {};
    const total = (counts.create || 0) + (counts.update || 0) + (counts.remove || 0) + (counts.reuse || 0);
    const appliedCard = receipt && state.plan && state.plan.status === PLAN_STATUS.APPLIED
      ? {receipt} : null;
    return {
      id: review.planId,
      planHash: review.plan.planHash,
      title: review.plan.summary || t('plan.title'),
      status: state.plan ? state.plan.status : 'pending_review',
      actionKind: 'review',
      reviewCount: total,
      summaryRows: [
        [t('review.countCreateLabel'), String(counts.create || 0)],
        [t('review.countUpdateLabel'), String(counts.update || 0)],
        [t('review.countRemoveLabel'), String(counts.remove || 0)],
        [t('review.countReuseLabel'), String(counts.reuse || 0)],
      ],
      assumptions: (review.plan.assumptions || []).map(a => ({
        kind: a.kind === 'confirm' ? 'needConfirm' : 'assume', text: a.text || ''})),
      ...(appliedCard ? {appliedReceipt: appliedCard.receipt} : {}),
      ...(state.plan && state.plan.staleReason ? {staleReason: state.plan.staleReason} : {}),
    };
  }, [review, state.plan, receipt, t]);

  const getDiff = useCallback((itemId) => {
    if (!review) return {fieldRows: [], dependencyChips: []};
    const op = (review.plan.operations || []).find(o => o.opId === itemId) || {};
    // UI-R2：新表按字段名/类型/主键逐行展开（fieldDiffRows），FK 边/关系图
    // 表清单也给实际内容，不再只有 defKey 一行
    const rows = (review.candidate.changes || []).filter(c => c.opId === itemId)
      .reduce((all, change) => all.concat(fieldDiffRows(change)), []);
    return {
      fieldRows: rows.length ? rows : [{attr: opLabel(op), current: '—', candidate: t('review.noPreview'), kind: 'warning'}],
      dependencyChips: (op.dependsOn || []),
    };
  }, [review, t]);

  // ---- 发送 → 生成 → 封装/预演 ----
  const send = useCallback(async (text) => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const uiRun = (uiRunRef.current += 1);
    dispatch({type: 'send', text, id: `msg_u_${Date.now()}`});
    setReview(null);
    setReceipt(null);
    setSaveState('idle');
    publishCandidate(null);
    const result = await runModelingRequest({
      runtime: rt,
      userText: text,
      contextItems: contextRef.current,
      capabilities: capabilitiesRef.current,
    });
    // 被停止/新任务/切项目/更新的发送取代：结果（含错误提示）全部静默丢弃
    if (uiRun !== uiRunRef.current) return;
    if (result.kind === 'plan') {
      const selected = new Set(result.plan.operations.map(op => op.opId));
      setReview({planId: result.plan.planId, plan: result.plan,
        candidate: result.candidate, selectedOpIds: selected});
      dispatch({type: 'planUpdate', plan: {
        id: result.plan.planId, planHash: result.plan.planHash,
        title: result.plan.summary, status: 'pending_review',
        actionKind: 'review',
        reviewCount: (result.candidate.counts?.create || 0) + (result.candidate.counts?.update || 0)
          + (result.candidate.counts?.remove || 0) + (result.candidate.counts?.reuse || 0),
      }});
      publishCandidate({planId: result.plan.planId, plan: result.plan,
        candidate: result.candidate, selectedOpIds: [...selected]});
      setReviewVisible(true);
    } else if (result.kind === 'clarifying') {
      dispatch({type: 'message', message: {id: `msg_a_${Date.now()}`, role: 'assistant', text: result.text}});
      dispatch({type: 'steps', steps: []});
      // UI-R2（msg_612925afd1b5）：澄清轮回答完毕退出 GENERATING，
      // 否则发送门阻断第二轮补充答复
      dispatch({type: 'clarified'});
    } else {
      const err = describeError(result);
      dispatch({type: 'message', message: {id: `msg_e_${Date.now()}`, role: 'assistant',
        text: `${t('assistant.errorPrefix')}${err.code}: ${err.message}`,
        error: true, retryable: result.kind === 'error'}});
      dispatch({type: 'error', message: `${err.code}: ${err.message}`});
    }
  }, [publishCandidate, t]);

  const stop = useCallback(() => {
    const rt = runtimeRef.current;
    uiRunRef.current += 1; // 旧响应在 UI 层也不再冒出来
    dispatch({type: 'stop'});
    if (rt && rt.client) {
      // 取消当前在途请求：由 client dispose 单请求语义承担——运行时不追踪单
      // 请求 id 时保守丢弃（代际守卫已使迟到结果不可用）
      rt.nextRun();
    }
  }, []);

  // ---- 勾选：依赖闭包重算 + hash 变化 → 重新预演，旧确认作废 ----
  const toggleItem = useCallback(async (itemId, selected) => {
    if (!review || !runtimeRef.current) return;
    const next = new Set(review.selectedOpIds);
    if (selected) next.add(itemId); else next.delete(itemId);
    const update = runtimeRef.current.gateway.updateSelection(review.planId, [...next]);
    if (!update.ok) {
      dispatch({type: 'error', message: `${update.code}: ${update.message}`});
      return;
    }
    const prepared = await runtimeRef.current.gateway.prepare(review.planId);
    if (!prepared.ok) {
      dispatch({type: 'error', message: `${prepared.code}: ${prepared.message}`});
      return;
    }
    const nextReview = {planId: review.planId, plan: update.plan,
      candidate: prepared.candidate, selectedOpIds: next};
    setReview(nextReview);
    dispatch({type: 'planUpdate', plan: {id: update.plan.planId, planHash: update.plan.planHash,
      title: update.plan.summary, status: 'pending_review', actionKind: 'review',
      reviewCount: prepared.candidate.changes?.length || 0}});
    publishCandidate({...nextReview, selectedOpIds: [...next]});
  }, [review, publishCandidate]);

  const revalidate = useCallback(async () => {
    if (!review || !runtimeRef.current) return;
    const prepared = await runtimeRef.current.gateway.prepare(review.planId);
    if (!prepared.ok) {
      dispatch({type: 'planStale', reason: `${prepared.code}: ${prepared.message}`});
      return;
    }
    dispatch({type: 'planUpdate', plan: {id: review.planId, planHash: review.plan.planHash,
      title: review.plan.summary, status: 'pending_review', actionKind: 'review',
      reviewCount: prepared.candidate.changes?.length || 0}});
    setReview({...review, candidate: prepared.candidate});
  }, [review]);

  // ---- 确认 + 提交（守卫全部在 gateway；这里只携带 hash 与回执处理） ----
  const applyCandidate = useCallback(async () => {
    if (!review || !runtimeRef.current) return;
    const rt = runtimeRef.current;
    const planHash = review.plan.planHash;
    dispatch({type: 'confirmPlan', planHash});
    const confirmed = await rt.gateway.confirm(review.planId, {planHash});
    if (!confirmed.ok) {
      dispatch({type: 'planStale', reason: `${confirmed.code}: ${confirmed.message}`});
      return;
    }
    dispatch({type: 'applyStart'});
    setApplying(true);
    const applied = await rt.gateway.apply({planId: review.planId, confirmationId: confirmed.confirmationId});
    setApplying(false);
    if (!applied.ok) {
      if (applied.code === 'PLAN_STALE' || applied.code === 'PROJECT_CHANGED') {
        dispatch({type: 'planStale', reason: `${applied.code}: ${applied.message}`});
      } else {
        dispatch({type: 'error', message: `${applied.code}: ${applied.message}`});
        dispatch({type: 'message', message: {id: `msg_e_${Date.now()}`, role: 'assistant',
          text: `${t('assistant.applyFailed')}${applied.code}: ${applied.message}`,
          error: true, retryable: applied.detail?.retryable === true}});
      }
      return;
    }
    dispatch({type: 'applyDone', receipt: applied.receipt});
    setReceipt(applied.receipt);
    setSaveState('dirty');
    setReviewVisible(false);
    publishCandidate(null);
    dispatch({type: 'message', message: {id: `msg_a_${Date.now()}`, role: 'assistant',
      text: t('assistant.appliedTip', {commandId: applied.receipt.commandId}),
      steps: [
        {label: t('assistant.stepDraft'), state: 'done'},
        {label: t('assistant.stepReview'), state: 'done'},
        {label: t('assistant.stepApplied'), state: 'done'},
        {label: t('assistant.stepSavePending'), state: 'active'},
      ]}});
  }, [review, publishCandidate, t]);

  // ---- 撤销此变更集（CORE 逆操作 + 指纹后检 → 一次宿主提交） ----
  const undoChangeSet = useCallback(async () => {
    if (!receipt || !runtimeRef.current) return;
    setUndoBusy(true);
    const undone = await runtimeRef.current.gateway.undo({commandId: receipt.commandId});
    setUndoBusy(false);
    if (!undone.ok) {
      dispatch({type: 'message', message: {id: `msg_e_${Date.now()}`, role: 'assistant',
        text: `${t('assistant.undoFailed')}${undone.code}: ${undone.message}`, error: true}});
      return;
    }
    setReceipt(null);
    setSaveState('dirty');
    if (state.plan) dispatch({type: 'planStale', reason: t('assistant.undoDone')});
    dispatch({type: 'message', message: {id: `msg_a_${Date.now()}`, role: 'assistant',
      text: t('assistant.undoDone')}});
  }, [receipt, state.plan, t]);

  // ---- 显式保存：真实 saveProject 回调驱动 persistence ----
  const saveNow = useCallback(() => {
    if (!onSaveProject) return;
    setSaveState('saving');
    onSaveProject((failed) => {
      if (failed) {
        setSaveState('error');
        dispatch({type: 'saveFailed', error: t('assistant.saveFailed')});
      } else {
        setSaveState('saved');
        if (receipt && runtimeRef.current) {
          runtimeRef.current.gateway.notePersistence({commandId: receipt.commandId, state: 'saved'});
        }
      }
    });
  }, [onSaveProject, receipt]);

  // ---- ContextPicker 数据（对象/标准/质量） ----
  const pickerData = useMemo(() => {
    if (!dataSource) return {scope: [], groups: []};
    const selectedIds = new Set(state.contextItems.map(i => i.id));
    const groups = [];
    [['entities', '实体'], ['logicEntities', '逻辑实体'], ['conceptEntities', '概念实体'],
      ['views', '视图'], ['diagrams', '关系图']].forEach(([collection, title]) => {
      const items = (dataSource[collection] || []).map(obj => ({
        id: `obj-${collection}-${obj.id}`,
        label: obj.defKey || obj.defName || obj.id,
        path: (dataSource.viewGroups || []).filter(g => (g[`ref${collection.replace(/s$/, '').replace(/^(\w)/, m => m.toUpperCase())}`] || []).includes(obj.id)).map(g => g.defName || g.defKey).join('/'),
        type: collection,
        selected: selectedIds.has(`obj-${collection}-${obj.id}`),
        disabled: false,
      }));
      if (items.length) groups.push({id: collection, title, items});
    });
    groups.push({id: 'standards', title: t('picker.standards'), items: [{
      id: 'ctx-standards', label: t('picker.standardsSummary'), type: 'standards',
      selected: selectedIds.has('ctx-standards'), disabled: false}]});
    groups.push({id: 'quality', title: t('picker.quality'), items: [{
      id: 'ctx-quality', label: t('picker.qualitySummary'), type: 'quality',
      selected: selectedIds.has('ctx-quality'), disabled: false}]});
    return {
      scope: state.contextItems.map(item => ({
        key: item.id,
        label: item.kind === 'catalog' ? t('picker.currentCatalog')
          : item.kind === 'userText' ? t('picker.userText') : (item.label || item.id),
        included: true,
        removable: item.removable !== false,
        description: item.kind === 'catalog' ? t('picker.currentCatalogDesc') : '',
      })),
      groups,
    };
  }, [dataSource, state.contextItems, t]);

  const applyPicker = useCallback((picked) => {
    // picked: Set(itemId) —— 重建显式上下文项（隐式 catalog 始终保留）
    const items = [{
      id: 'catalog-current', kind: 'catalog', implicit: true, removable: false,
    }];
    picked.forEach((id) => {
      if (id === 'ctx-standards') items.push({id, kind: 'standards', removable: true});
      else if (id === 'ctx-quality') items.push({id, kind: 'quality', removable: true});
      else if (id.startsWith('obj-')) {
        const realId = id.substring(4); // obj-<collection>-<uuid>
        const dash = realId.indexOf('-');
        const col = realId.substring(0, dash);
        const objId = realId.substring(dash + 1);
        if (COLLECTION_LABELS[col]) {
          items.push({id, kind: 'object', removable: true,
            ref: {kind: 'existing', collection: col, id: objId}});
        }
      }
    });
    dispatch({type: 'contextSet', items});
  }, []);

  React.useImperativeHandle(ref, () => ({
    injectUserText: (text) => {
      dispatch({type: 'draftChange', value: text});
    },
    projectSwitch: (projectId) => {
      dispatch({type: 'projectSwitch', projectId});
      setReview(null);
      setReceipt(null);
      setSaveState('idle');
      publishCandidate(null);
    },
    focusComposer: () => {},
  }));

  const generating = state.taskStatus === TASK_STATUS.GENERATING;
  const applyState = deriveApplyState({
    plan: state.plan, items: reviewItems, mappings: [], applying, generating,
  });

  return <div className='chiner-ai-modeling-panel' data-ai-readonly={readOnly ? 'true' : 'false'}>
    <div className='chiner-ai-panel-actions'>
      <button type='button' className={`chiner-ai-tabbtn${!sqlVisible ? ' active' : ''}`}
        onClick={() => setSqlVisible(false)}>{t('modeling.chatTab')}</button>
      {sqlPanel && <button type='button' className={`chiner-ai-tabbtn${sqlVisible ? ' active' : ''}`}
        onClick={() => setSqlVisible(true)}>{t('modeling.sqlTab')}</button>}
    </div>
    {sqlVisible && sqlPanel ? sqlPanel : <>
      <AssistantPanel
        locale={locale}
        labels={labels}
        variant='inspector'
        platform='modeling'
        service={serviceState}
        onOpenSettings={() => setProviderVisible(true)}
        onOpenContextPicker={() => setPickerVisible(true)}
        contextItems={state.contextItems.map(item => ({
          id: item.id,
          label: item.kind === 'catalog' ? t('picker.currentCatalog')
            : item.kind === 'standards' ? t('picker.standardsSummary')
              : item.kind === 'quality' ? t('picker.qualitySummary')
                : item.kind === 'userText' ? t('picker.userText') : (item.label || item.id),
          removable: item.removable !== false,
          implicit: item.implicit === true,
          projectId: dataSource?.name,
        }))}
        onRemoveContext={(id) => {
          dispatch({type: 'contextSet', items: state.contextItems.filter(i => i.id !== id)});
        }}
        messages={state.messages}
        draft={state.draft}
        onDraftChange={(value) => dispatch({type: 'draftChange', value})}
        onSend={send}
        generating={generating}
        canStop
        onStop={stop}
        onNewTask={() => {
          dispatch({type: 'newTask'});
          // 新任务边界：作废在途生成（旧响应不冒出来）+ 清空对话历史
          uiRunRef.current += 1;
          if (runtimeRef.current) {
            runtimeRef.current.nextRun();
            runtimeRef.current.resetConversation('modeling');
          }
          // UI-R2（msg_3549d4dedf41）：本地 review/回执/候选可见一并清理——
          // 否则旧方案仍挂在审阅弹窗与临时候选 tab。已应用的项目数据不回滚，
          // 撤销台账不擅自清。
          setReview(null);
          setReviewVisible(false);
          setReceipt(null);
          setSaveState('idle');
          publishCandidate(null);
        }}
        taskStatus={state.taskStatus}
        steps={state.steps}
        plan={planCard}
        onReviewPlan={() => setReviewVisible(true)}
        onRevalidate={revalidate}
      />
      {(state.plan && state.plan.status === PLAN_STATUS.APPLIED) && <div className='chiner-ai-appliedbar'>
        <span className='chiner-ai-dot'/>
        <span>{saveState === 'saved' ? t('assistant.savedDone')
          : saveState === 'error' ? t('assistant.taskSaveFailed')
            : saveState === 'saving' ? t('assistant.saving') : t('assistant.appliedDirty')}</span>
        {saveState !== 'saved' && <button type='button' className='chiner-ai-minibtn chiner-ai-primary'
          disabled={!onSaveProject || readOnly || saveState === 'saving'} onClick={saveNow}>
          {t('assistant.saveProject')}
        </button>}
        {saveState === 'error' && <button type='button' className='chiner-ai-minibtn'
          disabled={!onSaveProject || readOnly} onClick={saveNow}>{t('assistant.retrySave')}</button>}
        {receipt && receipt.undo && receipt.undo.available && <button type='button'
          className='chiner-ai-minibtn' disabled={undoBusy} onClick={undoChangeSet}>
          {undoBusy ? t('assistant.undoing') : t('assistant.undoChangeSet')}
        </button>}
      </div>}
    </>}
    <ProviderController
      client={runtime && runtime.client}
      visible={providerVisible}
      onClose={() => setProviderVisible(false)}
      providerId={AI_PROVIDER_ID}
      locale={locale}
      labels={labels}
      onServiceChange={handleServiceChange}
      onConfigured={handleConfigured}
    />
    {pickerVisible && <ContextPicker
      locale={locale}
      labels={labels}
      scope={pickerData.scope}
      groups={pickerData.groups}
      onToggleScope={(key) => {
        applyPicker(new Set(state.contextItems
          .filter(i => i.removable !== false && i.id !== key)
          .map(i => i.id)));
      }}
      onToggleItem={(id, selected) => {
        const picked = new Set(state.contextItems.filter(i => i.kind !== 'catalog').map(i => i.id));
        if (selected) picked.add(id); else picked.delete(id);
        applyPicker(picked);
      }}
      onApply={() => setPickerVisible(false)}
      onClose={() => setPickerVisible(false)}
    />}
    <ChangeReview
      locale={locale}
      labels={labels}
      visible={reviewVisible}
      onClose={() => setReviewVisible(false)}
      onBackToChat={() => setReviewVisible(false)}
      plan={{
        title: review ? review.plan.summary : '',
        counts: review ? (review.candidate.counts || {}) : {},
        status: state.plan ? state.plan.status : 'pending_review',
        saveMode: 'project-draft',
        scopeRows: [[t('review.scopePlanHash'), review ? review.plan.planHash.slice(0, 16) : ''],
          [t('review.scopeOps'), String(review ? review.plan.operations.length : 0)]],
        ...(state.plan && state.plan.staleReason ? {staleReason: state.plan.staleReason} : {}),
      }}
      items={reviewItems}
      onToggleItem={(id, selected) => toggleItem(id, selected)}
      getDiff={getDiff}
      mappings={[]}
      blockingIssues={review ? (review.candidate.blockingIssues || []) : []}
      applying={applying}
      generating={generating}
      onApply={applyCandidate}
    />
  </div>;
});

export default React.memo(ModelingAiPanel);
