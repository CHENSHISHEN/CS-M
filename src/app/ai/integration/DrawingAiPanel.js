// 陈氏 ER AI 绘图辅助面板（INTEGRATION A6）：floating 变体 AssistantPanel，
// 与建模域共享同一 Host 客户端/会话/GATEWAY。候选用真实 GraphThumbnail
// 只读投影（compileChenCommand 产出的完整 DrawingDocument），不改 original/
// latest、不触发 onChange；确认后经 GATEWAY 守卫（作用域/锁定/选区/过期/依赖）
// 由宿主执行恰好一次 history.apply（现有文档）或走项目原创建接缝（新文档）。
// 撤销委托宿主 history undo/redo；保存回执只读真实 drawingPersistence 状态。
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';import {AssistantPanel, ChangeReview, createMessages} from '../index';
import ProviderController from './ProviderController';
import {runDrawingRequest, describeError, AI_PROVIDER_ID} from './aiRuntime';
import {deriveApplyState, TASK_STATUS, PLAN_STATUS} from '../stateAdapter';
import {drawingPersistence} from '../../../lib/drawing_persistence';
import GraphThumbnail from '../../drawing/platform/GraphThumbnail';
import {deriveThumbnailDoc} from './thumbnailDoc';

const opLabel = (op) => ({
  'drawing.chen.createDocument': '新建陈氏文档',
  'drawing.chen.createPage': '新建画布',
  'drawing.chen.patch': '修改画布',
}[op.command] || op.command);

// 主画布临时投影（R2 接缝，msg_28850767e7a3）：审阅中的候选文档上报宿主
// DocumentEditor 做只读主画布预览；已应用/无候选 → null（预览即关闭）。
// 只读投影不触碰 original/latest/history/drawings/自动保存；确认仍走 GATEWAY。
// UI-R2（msg_fe0867d7c6bb 后续）：携带真实 affectedPages（GATEWAY 按操作顺序
// 收集的受影响页 id），宿主据此投影有效目标页——createPage 把内容放在第二页
// 时不再永远预览旧的第一页。未携带 affectedPages 的候选（历史形态）保持原
// {planId, document} 契约不变。
export const deriveCandidatePreview = ({candidate, plan, appliedReceipt}) => {
  if (appliedReceipt || !candidate || !candidate.document) return null;
  return {
    planId: plan ? plan.planId : '',
    document: candidate.document,
    ...(Array.isArray(candidate.affectedPages) && candidate.affectedPages.length
      ? {affectedPages: candidate.affectedPages.slice()} : {}),
  };
};

const DrawingAiPanel = ({runtime, locale = 'zh', labels, doc, readOnly = false,
                          getDocuments, getSelection, applyCandidate, onCreateDocument,
                          undoLast, onCandidateChange}) => {
  const t = useMemo(() => createMessages(locale, labels), [locale, labels]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState(null);          // GATEWAY plan
  const [candidate, setCandidate] = useState(null); // 绘图候选
  const [reviewVisible, setReviewVisible] = useState(false);
  const [selectedOpIds, setSelectedOpIds] = useState(new Set());
  const [applying, setApplying] = useState(false);
  const [appliedReceipt, setAppliedReceipt] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [serviceState, setServiceState] = useState({status: 'unconfigured'});
  const [providerVisible, setProviderVisible] = useState(false);
  const [capabilities, setCapabilities] = useState({stream: false, tools: false, jsonMode: false});
  const [persistenceState, setPersistenceState] = useState(() => drawingPersistence.getState());
  const commitsRef = useMemo(() => new Map(), []);
  // 面板代际（INTEGRATION-R1）：停止/新任务/切文档时 +1，迟到的旧响应在 UI
  // 层静默丢弃，错误提示也不冒出来
  const uiRunRef = useRef(0);

  useEffect(() => drawingPersistence.subscribe(setPersistenceState), []);

  // ---- 候选上报宿主（R2 主画布临时投影）：仅审阅中的候选可见；
  //      应用/撤销态变化/清空时自动同步 null（宿主预览随之下线） ----
  const candidatePreview = useMemo(() => deriveCandidatePreview({candidate, plan, appliedReceipt}),
    [candidate, plan, appliedReceipt]);
  const candidateCbRef = useRef(onCandidateChange);
  candidateCbRef.current = onCandidateChange;
  useEffect(() => {
    if (candidateCbRef.current) candidateCbRef.current(candidatePreview);
  }, [candidatePreview]);

  // ---- 切文档清理：面板常驻挂载后，宿主切换当前文档时清上一文档的对话/候选 ----
  const prevDocIdRef = useRef(doc ? doc.id : null);
  useEffect(() => {
    const docId = doc ? doc.id : null;
    if (prevDocIdRef.current !== docId) {
      prevDocIdRef.current = docId;
      uiRunRef.current += 1;
      setMessages([]); setPlan(null); setCandidate(null); setAppliedReceipt(null);
      setErrorMsg(''); setGenerating(false);
      if (runtime) {
        runtime.nextRun();
        runtime.resetConversation('drawing');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc && doc.id, runtime]);

  // ---- 绘图域宿主桥：快照/一次提交/undo（挂载注册，卸载注销） ----
  useEffect(() => {
    if (!runtime) return undefined;
    const bridge = {
      getSnapshot: () => ({
        documents: (typeof getDocuments === 'function' ? getDocuments() : []).slice(),
        documentId: doc ? doc.id : null,
        selection: (typeof getSelection === 'function' ? getSelection() : null),
      }),
      commit: async (payload) => {
        if (commitsRef.has(payload.commandId)) return commitsRef.get(payload.commandId);
        try {
          // 宿主写边界：同步核验网关 expected（会话/epoch/baseVersion/documentId）
          const expected = payload.expected;
          if (expected) {
            const session = runtime ? runtime.getSession() : null;
            if (!session
              || expected.projectSessionId !== session.projectSessionId
              || String(expected.epoch) !== String(session.epoch)
              || String(expected.baseVersion) !== String(session.baseVersion)
              || (expected.documentId !== undefined
                && expected.documentId !== (doc ? doc.id : null))) {
              return {ok: false, code: 'PROJECT_CHANGED', message: '宿主写入边界：会话/版本/文档不匹配'};
            }
            if (session.readonly) {
              return {ok: false, code: 'READ_ONLY', message: '宿主写入边界：当前只读'};
            }
          }
          if (payload.historyParams && payload.historyParams.isNewDocument) {
            onCreateDocument && onCreateDocument(payload.document);
          } else {
            const ok = applyCandidate(payload.document);
            if (ok === false) {
              return {ok: false, code: 'COMMIT_FAILED', message: '画布提交被拒绝（只读或校验失败）'};
            }
          }
          const result = {ok: true};
          commitsRef.set(payload.commandId, result);
          return result;
        } catch (error) {
          return {ok: false, code: 'COMMIT_FAILED', message: error && error.message};
        }
      },
      undo: async () => {
        try {
          undoLast && undoLast();
          return {ok: true};
        } catch (error) {
          return {ok: false, code: 'UNDO_UNKNOWN', message: error && error.message};
        }
      },
    };
    return runtime.registerDrawingBridge(bridge);
  }, [runtime, doc && doc.id, getDocuments, getSelection, applyCandidate,
    onCreateDocument, undoLast, commitsRef]);

  const pushMessage = useCallback((message) => {
    setMessages(pre => pre.concat([message]));
  }, []);

  const send = useCallback(async (text) => {
    if (!runtime || !doc) return;
    const uiRun = (uiRunRef.current += 1);
    setGenerating(true);
    setErrorMsg('');
    setPlan(null);
    setCandidate(null);
    setAppliedReceipt(null);
    pushMessage({id: `msg_u_${Date.now()}`, role: 'user', text});
    const result = await runDrawingRequest({
      runtime, userText: text, document: doc,
      selection: (typeof getSelection === 'function' ? getSelection() : null),
      capabilities,
    });
    // 被停止/新任务/切文档取代：结果（含错误提示）全部静默丢弃
    if (uiRun !== uiRunRef.current) {
      setGenerating(false);
      return;
    }
    setGenerating(false);
    if (result.kind === 'plan') {
      setPlan(result.plan);
      setCandidate(result.candidate);
      setSelectedOpIds(new Set(result.plan.operations.map(op => op.opId)));
      setReviewVisible(true);
    } else if (result.kind === 'clarifying') {
      pushMessage({id: `msg_a_${Date.now()}`, role: 'assistant', text: result.text});
    } else {
      const err = describeError(result);
      setErrorMsg(`${err.code}: ${err.message}`);
      pushMessage({id: `msg_e_${Date.now()}`, role: 'assistant',
        text: `${t('assistant.errorPrefix')}${err.code}: ${err.message}`,
        error: true, retryable: result.kind === 'error'});
    }
  }, [runtime, doc, getSelection, capabilities, pushMessage, t]);

  const stop = useCallback(() => {
    if (runtime) runtime.nextRun();
    uiRunRef.current += 1; // 旧响应在 UI 层也不再冒出来
    setGenerating(false);
  }, [runtime]);

  const reviewItems = useMemo(() => {
    if (!plan || !candidate) return [];
    const blockedOps = new Set((candidate.blockingIssues || []).map(i => i.opId).filter(Boolean));
    return (plan.operations || []).map(op => {
      const changes = (candidate.changes || []).filter(c => c.opId === op.opId);
      const first = changes[0];
      return {
        id: op.opId,
        category: opLabel(op),
        label: first ? (first.after && first.after.name) || (first.target && first.target.localKey) || opLabel(op) : opLabel(op),
        path: first && first.target ? first.target.collection : undefined,
        selected: selectedOpIds.has(op.opId),
        deps: op.dependsOn || [],
        blocked: blockedOps.has(op.opId) || !changes.length,
        warn: (candidate.warnings || []).some(w => w.opId === op.opId),
        // UI-R2：能按 opId 定位的阻断 issue 挂到条目（审阅展示真实 code/message）
        issues: (candidate.blockingIssues || []).filter(i => i.opId === op.opId),
      };
    });
  }, [plan, candidate, selectedOpIds]);

  const getDiff = useCallback((itemId) => {
    if (!candidate) return {fieldRows: [], dependencyChips: []};
    // UI-R2：语义对象行带 kind/key/角色等实际内容，不只一行名称
    const rows = (candidate.changes || []).filter(c => c.opId === itemId).map(change => {
      const after = change.after || {};
      const before = change.before || {};
      const detail = (obj) => [
        obj.name ? `名称=${obj.name}` : '',
        obj.kind ? `类型=${obj.kind}` : '',
        obj.key ? `键=${obj.key}` : '',
        obj.cardinality ? `基数=${obj.cardinality}` : '',
      ].filter(Boolean).join(' · ');
      return {
        attr: `${change.target?.collection || ''} · ${(after.name)
          || change.target?.localKey || change.target?.id || ''}`,
        current: change.before ? (detail(before) || '—') : '—',
        candidate: change.after ? (detail(after) || '—') : '—',
        kind: change.kind === 'create' ? 'new' : change.kind === 'remove' ? 'deleted' : 'modified',
      };
    });
    return {fieldRows: rows, dependencyChips: []};
  }, [candidate]);

  const toggleItem = useCallback(async (itemId, selected) => {
    if (!runtime || !plan) return;
    const next = new Set(selectedOpIds);
    if (selected) next.add(itemId); else next.delete(itemId);
    const update = runtime.gateway.updateSelection(plan.planId, [...next]);
    if (!update.ok) {
      setErrorMsg(`${update.code}: ${update.message}`);
      return;
    }
    const prepared = await runtime.gateway.prepare(plan.planId);
    if (!prepared.ok) {
      setErrorMsg(`${prepared.code}: ${prepared.message}`);
      return;
    }
    setPlan(update.plan);
    setCandidate(prepared.candidate);
    setSelectedOpIds(next);
  }, [runtime, plan, selectedOpIds]);

  const applyNow = useCallback(async () => {
    if (!runtime || !plan) return;
    const confirmed = await runtime.gateway.confirm(plan.planId, {planHash: plan.planHash});
    if (!confirmed.ok) {
      setErrorMsg(`${confirmed.code}: ${confirmed.message}`);
      return;
    }
    setApplying(true);
    const applied = await runtime.gateway.apply({planId: plan.planId,
      confirmationId: confirmed.confirmationId});
    setApplying(false);
    if (!applied.ok) {
      setErrorMsg(`${applied.code}: ${applied.message}`);
      return;
    }
    setAppliedReceipt(applied.receipt);
    setReviewVisible(false);
    pushMessage({id: `msg_a_${Date.now()}`, role: 'assistant',
      text: t('drawing.applied', {commandId: applied.receipt.commandId})});
  }, [runtime, plan, pushMessage, t]);

  const undoChangeSet = useCallback(async () => {
    if (!runtime || !appliedReceipt) return;
    const undone = await runtime.gateway.undo({commandId: appliedReceipt.commandId});
    if (!undone.ok) {
      setErrorMsg(`${undone.code}: ${undone.message}`);
      return;
    }
    setAppliedReceipt(null);
    pushMessage({id: `msg_a_${Date.now()}`, role: 'assistant', text: t('assistant.undoDone')});
  }, [runtime, appliedReceipt, pushMessage, t]);

  const planCard = useMemo(() => {
    if (!plan || !candidate) return null;
    const counts = candidate.counts || {};
    return {
      id: plan.planId,
      planHash: plan.planHash,
      title: plan.summary || t('plan.title'),
      status: appliedReceipt ? PLAN_STATUS.APPLIED : PLAN_STATUS.PENDING,
      actionKind: (candidate.isNewDocument || (plan.operations || []).some(op => op.command === 'drawing.chen.createDocument')) ? 'create-canvas' : 'review',
      reviewCount: (counts.create || 0) + (counts.update || 0) + (counts.remove || 0),
      summaryRows: [
        [t('review.countCreateLabel'), String(counts.create || 0)],
        [t('review.countUpdateLabel'), String(counts.update || 0)],
        [t('review.countRemoveLabel'), String(counts.remove || 0)],
      ],
      assumptions: (plan.assumptions || []).map(a => ({kind: a.kind === 'confirm' ? 'needConfirm' : 'assume', text: a.text || ''})),
    };
  }, [plan, candidate, appliedReceipt, t]);

  const applyState = deriveApplyState({
    plan: planCard, items: reviewItems, mappings: [], applying, generating,
  });

  return <div className='chiner-ai-drawing-panel'>
    <AssistantPanel
      locale={locale}
      labels={labels}
      variant='floating'
      platform='drawing'
      service={serviceState}
      onOpenSettings={() => setProviderVisible(true)}
      contextItems={[{
        id: 'drawing-current', label: doc ? doc.defName : '', removable: false, implicit: true,
      }]}
      messages={messages}
      draft={draft}
      onDraftChange={setDraft}
      onSend={send}
      generating={generating}
      canStop
      onStop={stop}
      onNewTask={() => {
        setMessages([]); setPlan(null); setCandidate(null); setAppliedReceipt(null);
        // UI-R2（msg_3549d4dedf41）：审阅弹窗可见一并清理（plan/candidate 已
        // 置空，残留 visible 会渲染空弹窗）；候选 null 经 effect 自动上报宿主
        setReviewVisible(false);
        // 新任务边界：作废在途生成（旧响应不冒出来）+ 清空绘图域对话历史
        uiRunRef.current += 1;
        if (runtime) {
          runtime.nextRun();
          runtime.resetConversation('drawing');
        }
      }}
      taskStatus={generating ? TASK_STATUS.GENERATING
        : (appliedReceipt ? TASK_STATUS.APPLIED
          : (plan ? TASK_STATUS.AWAITING_REVIEW : TASK_STATUS.IDLE))}
      plan={planCard}
      onReviewPlan={() => setReviewVisible(true)}
      onRevalidate={async () => {
        if (!runtime || !plan) return;
        const prepared = await runtime.gateway.prepare(plan.planId);
        if (prepared.ok) setCandidate(prepared.candidate);
        else setErrorMsg(`${prepared.code}: ${prepared.message}`);
      }}
    />
    {candidate && candidate.document && <div className='chiner-ai-drawing-preview'>
      <span className='chiner-ai-candidate-badge'>{t('candidate.flag')}</span>
      {/* PREVIEW-FINAL：侧卡缩略图按 affectedPages 命中页只读投影（与主画布
          DocumentEditor 同约定），不固定 pages[0]、不改原 candidate.document */}
      <GraphThumbnail doc={deriveThumbnailDoc(candidate)} cacheKey={`ai:${plan ? plan.planId : ''}`}
        title={candidate.document.defName}/>
    </div>}
    {errorMsg && <p className='chiner-ai-sql-error' role='alert'>{errorMsg}</p>}
    {appliedReceipt && <div className='chiner-ai-appliedbar'>
      <span>{persistenceState.status === 'saved' ? t('drawing.savedProject')
        : t('drawing.autosaveState', {status: persistenceState.status})}</span>
      {appliedReceipt.undo && appliedReceipt.undo.available && <button type='button'
        className='chiner-ai-minibtn' onClick={undoChangeSet}>
        {t('assistant.undoChangeSet')}
      </button>}
    </div>}
    <ProviderController
      client={runtime && runtime.client}
      visible={providerVisible}
      onClose={() => setProviderVisible(false)}
      providerId={AI_PROVIDER_ID}
      locale={locale}
      labels={labels}
      onServiceChange={setServiceState}
      onConfigured={(masked) => {
        if (masked && masked.capabilities) {
          setCapabilities({
            stream: masked.capabilities.stream === true,
            tools: masked.capabilities.tools === true,
            jsonMode: masked.capabilities.jsonMode === true,
          });
        }
      }}
    />
    <ChangeReview
      locale={locale}
      labels={labels}
      visible={reviewVisible}
      onClose={() => setReviewVisible(false)}
      onBackToChat={() => setReviewVisible(false)}
      plan={{
        title: plan ? plan.summary : '',
        counts: candidate ? (candidate.counts || {}) : {},
        status: appliedReceipt ? 'applied' : 'pending_review',
        saveMode: 'drawing-autosave',
        scopeRows: [[t('review.scopePlanHash'), plan ? plan.planHash.slice(0, 16) : ''],
          [t('review.scopeOps'), String(plan ? plan.operations.length : 0)]],
      }}
      items={reviewItems}
      onToggleItem={toggleItem}
      getDiff={getDiff}
      mappings={[]}
      blockingIssues={candidate ? (candidate.blockingIssues || []) : []}
      applying={applying}
      generating={generating}
      onApply={applyNow}
    />
  </div>;
};

export default React.memo(DrawingAiPanel);
