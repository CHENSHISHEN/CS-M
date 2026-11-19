// AI 面板纯状态机与推导函数：不引用 React、core/host。
// 父级（集成者）持有该状态；组件只按 props 渲染并在回调里派发 action。

export const PLAN_STATUS = {
  PENDING: 'pending_review',
  STALE: 'stale',
  APPLYING: 'applying',
  APPLIED: 'applied',
};

export const TASK_STATUS = {
  IDLE: 'idle',
  CLARIFYING: 'clarifying',
  GENERATING: 'generating',
  AWAITING_REVIEW: 'awaiting_review',
  APPLYING: 'applying',
  APPLIED: 'applied',
  SAVE_FAILED: 'save_failed',
  ERROR: 'error',
};

export const createAssistantState = (init) => ({
  projectId: null,
  serviceStatus: 'unconfigured',
  serviceAlias: null,
  serviceError: null,
  taskStatus: TASK_STATUS.IDLE,
  runId: 0,
  messages: [],
  steps: [],
  draft: '',
  contextItems: [],
  plan: null,
  confirmedPlanHash: null,
  errorMessage: null,
  ...init,
});

// action 一览：
// serviceStatus{status,alias,error} draftChange{value} send{text,id} stop
// message{message} steps{steps} planUpdate{plan} planStale{reason}
// confirmPlan{planHash} applyStart applyDone{receipt} saveFailed{error}
// newTask projectSwitch{projectId} contextSet{items} error{message}
export const assistantReducer = (state, action) => {
  if (!action || !action.type) return state;
  switch (action.type) {
    case 'serviceStatus':
      return {
        ...state,
        serviceStatus: action.status,
        serviceAlias: action.alias === undefined ? state.serviceAlias : action.alias,
        serviceError: action.error === undefined ? null : action.error,
      };
    case 'draftChange':
      return { ...state, draft: action.value };
    case 'send': {
      const text = (action.text || '').trim();
      if (!text) return state;
      return {
        ...state,
        messages: state.messages.concat([{
          id: action.id,
          role: 'user',
          text,
        }]),
        draft: '',
        taskStatus: TASK_STATUS.GENERATING,
        errorMessage: null,
        runId: state.runId + 1,
        // 新请求立即作废旧方案确认：生成期间旧候选不可应用，
        // 不等待 planUpdate 清空（见 deriveApplyState 的 generating 阻断）
        confirmedPlanHash: null,
      };
    }
    case 'stop':
      // 停止保留输入与已完整验证的候选；不产生半成品
      return {
        ...state,
        taskStatus: state.plan && state.plan.status === PLAN_STATUS.PENDING
          ? TASK_STATUS.AWAITING_REVIEW
          : TASK_STATUS.IDLE,
      };
    case 'message':
      return { ...state, messages: state.messages.concat([action.message]) };
    case 'clarified':
      // UI-R2（msg_612925afd1b5）：澄清轮完成——从 GENERATING 退到
      // CLARIFYING 等用户答复；保留对话/方案/草稿，不是停止即完成。
      // CLARIFYING 下仍允许 send（send 会重新进入 GENERATING）
      return { ...state, taskStatus: TASK_STATUS.CLARIFYING };
    case 'steps':
      return { ...state, steps: action.steps };
    case 'planUpdate':
      return {
        ...state,
        // 方案内容变化必须重新审阅：旧确认作废
        plan: { ...action.plan, status: PLAN_STATUS.PENDING },
        confirmedPlanHash: null,
        taskStatus: TASK_STATUS.AWAITING_REVIEW,
      };
    case 'planStale':
      if (!state.plan) return state;
      return {
        ...state,
        plan: { ...state.plan, status: PLAN_STATUS.STALE, staleReason: action.reason },
        confirmedPlanHash: null,
      };
    case 'confirmPlan':
      if (!state.plan || state.plan.status !== PLAN_STATUS.PENDING) return state;
      if (action.planHash !== state.plan.planHash) return state;
      return { ...state, confirmedPlanHash: action.planHash };
    case 'applyStart':
      // 仅当方案待审阅且确认的就是当前方案（planHash 一致）时才进入应用；
      // 无方案/非 pending/未确认/确认过期一律拒绝，不得无条件切 APPLYING
      if (!state.plan || state.plan.status !== PLAN_STATUS.PENDING) return state;
      if (!state.confirmedPlanHash || state.confirmedPlanHash !== state.plan.planHash) return state;
      return { ...state, taskStatus: TASK_STATUS.APPLYING };
    case 'applyDone':
      return {
        ...state,
        taskStatus: TASK_STATUS.APPLIED,
        plan: state.plan ? { ...state.plan, status: PLAN_STATUS.APPLIED, receipt: action.receipt } : state.plan,
      };
    case 'saveFailed':
      return { ...state, taskStatus: TASK_STATUS.SAVE_FAILED, errorMessage: action.error || null };
    case 'newTask':
      // 开始新任务可以保留当前项目范围（显式与隐式上下文均保留）
      return {
        ...state,
        messages: [],
        steps: [],
        draft: '',
        plan: null,
        confirmedPlanHash: null,
        taskStatus: TASK_STATUS.IDLE,
        errorMessage: null,
      };
    case 'projectSwitch': {
      // 换项目：清隐式上下文与上一项目原文；不带旧 plan/确认
      const contextItems = state.contextItems.filter((item) =>
        !item.implicit && (item.projectId === undefined || item.projectId === null
          || item.projectId === action.projectId));
      return {
        ...state,
        projectId: action.projectId,
        messages: [],
        steps: [],
        draft: '',
        plan: null,
        confirmedPlanHash: null,
        taskStatus: TASK_STATUS.IDLE,
        errorMessage: null,
        contextItems,
      };
    }
    case 'contextSet':
      // 上下文变化不会悄悄改变已生成的方案，也不会自动确认
      return { ...state, contextItems: action.items };
    case 'error':
      return { ...state, taskStatus: TASK_STATUS.ERROR, errorMessage: action.message };
    default:
      return state;
  }
};

// Enter 发送门：IME 组合期（isComposing 或 keyCode 229）一律不发送；
// Shift+Enter 换行放行默认行为；Enter 发送需 preventDefault。
export const composerSendGate = (event, composing) => {
  const isComposing = !!(composing || (event && (event.isComposing || event.keyCode === 229)));
  if (isComposing) return 'compose';
  if (!event || event.key !== 'Enter') return null;
  if (event.shiftKey) return 'newline';
  return 'send';
};

// 审阅阻断推导：方案状态、生成中、未选、映射未完成、依赖缺口（含引用不存在的
// deps ID 与既有依赖未选）、条目自身阻断、应用中。仅 plan.status=pending_review
// 且其余全部合法时 canApply=true；文案所需 ID/说明直接挂在 blocker 上，不产生 undefined。
export const deriveApplyState = ({ plan, items, mappings, applying, generating }) => {
  const allItems = items || [];
  const selectedItems = allItems.filter((i) => i.selected);
  const blockers = [];
  if (!plan) {
    blockers.push({ kind: 'noPlan' });
  } else if (plan.status === PLAN_STATUS.STALE) {
    blockers.push({ kind: 'stale', reason: plan.staleReason });
  } else if (plan.status === PLAN_STATUS.APPLYING) {
    blockers.push({ kind: 'applyingPlan' });
  } else if (plan.status === PLAN_STATUS.APPLIED) {
    blockers.push({ kind: 'appliedPlan' });
  } else if (plan.status !== PLAN_STATUS.PENDING) {
    // unknown / 任何非白名单状态一律阻断
    blockers.push({ kind: 'unknownPlan', status: plan.status == null ? '' : String(plan.status) });
  }
  if (generating) {
    // 新请求生成期间，旧候选不可提交
    blockers.push({ kind: 'generating' });
  }
  (mappings || []).forEach((m) => {
    if (!m.value || (Array.isArray(m.value) && m.value.length === 0)) {
      blockers.push({ kind: 'mapping', id: m.id, label: m.label });
    }
  });
  const byId = {};
  allItems.forEach((i) => { byId[i.id] = i; });
  selectedItems.forEach((it) => {
    const label = it.label == null ? it.id : it.label;
    (it.deps || []).forEach((depId) => {
      if (blockers.some((b) => (b.kind === 'dependency' || b.kind === 'dependencyMissing') && b.id === it.id)) return;
      const dep = byId[depId];
      if (!dep) {
        // 选中项引用了不存在的 deps ID：缺项以 ID 呈现
        blockers.push({ kind: 'dependencyMissing', id: it.id, label, depId: String(depId) });
      } else if (!dep.selected) {
        blockers.push({ kind: 'dependency', id: it.id, label, depId: String(depId), depLabel: dep.label || depId });
      }
    });
  });
  selectedItems.forEach((it) => {
    if (it.blocked) {
      blockers.push({ kind: 'item', id: it.id, label: it.label == null ? it.id : it.label });
    }
  });
  if (selectedItems.length === 0) {
    blockers.push({ kind: 'empty' });
  }
  const canApply = !applying && !generating && blockers.length === 0;
  return {
    selectedCount: selectedItems.length,
    blockers,
    canApply,
    applying: !!applying,
    generating: !!generating,
  };
};

// 直接依赖某项的子项（用于取消父依赖时提示受影响范围）
export const dependentIds = (items, itemId) => (items || [])
  .filter((i) => (i.deps || []).indexOf(itemId) !== -1)
  .map((i) => i.id);

export const dependentLabels = (items, itemId) => (items || [])
  .filter((i) => (i.deps || []).indexOf(itemId) !== -1)
  .map((i) => i.label);

export default {
  createAssistantState,
  assistantReducer,
  composerSendGate,
  deriveApplyState,
  dependentIds,
  dependentLabels,
  PLAN_STATUS,
  TASK_STATUS,
};
