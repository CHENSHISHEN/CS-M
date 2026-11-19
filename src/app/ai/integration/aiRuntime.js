// AI 集成运行时（INTEGRATION）：模块级单例，建模/绘图两域共享同一个
// Host IPC 客户端、同一份会话/epoch 与同一个 GATEWAY 实例（不复制第二套
// 计划/确认引擎）。副作用只经依赖注入接缝进入：
//   getModelingSnapshot() —— 宿主提供的完整有效建模草稿（main 构建）
//   commitModeling(payload) —— 幂等建模提交（restProps.update + tab 同步）
//   getDrawingDocuments() —— 当前项目绘图文档列表（重名检查/新文档）
// 绘图面板挂载时通过 registerDrawingBridge 提供当前文档的
// 快照/一次 history.apply 提交/undo 入口；卸载即注销。
// 本模块不做 UI；React 面板经订阅获取会话变化。
import {
  createGateway,
  composeModelingContext,
  composeDrawingContext,
  describeAiCapabilities,
  redactSensitiveText,
} from '../../../lib/ai/orchestration';
import {hashJson} from '../../../lib/ai/hash';

let runtime = null;

const nowId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const AI_PROVIDER_ID = 'default';

// 对话历史上限（同项目/同任务）：只保留最近若干条纯文本往来，
// 超限丢弃最旧；任何情况下不携带计划权威字段/凭据/项目数据。
export const MAX_CONVERSATION_ENTRIES = 12;

// 宿主会话缺省值：未初始化前一切请求被拒（不猜测）。
// baseVersion 是 GATEWAY 封装层要求的字符串快照版本标记（'v1' 起）。
const emptySession = () => ({
  projectSessionId: '', epoch: 1, readonly: false, baseVersion: '',
});

export const initAiRuntime = ({client, getModelingSnapshot, commitModeling, getDrawingDocuments}) => {
  if (runtime) {
    // 同一 Main 的重复初始化（重渲染保持引用）：幂等返回现有实例
    if (runtime.client === client) return runtime;
    // 新宿主接管（msg_6948bfaf64c7）：关闭项目 A 后新 Main 渲染可能先于旧
    // 卸载清理执行——绝不沿用 A 的 getModelingSnapshot/commitModeling 闭包，
    // 立即释放旧实例（在途按精确 ID 取消 + 网关清理，dispose 幂等）再建新实例
    runtime.dispose();
  }
  if (!client || typeof getModelingSnapshot !== 'function'
      || typeof commitModeling !== 'function') {
    throw new Error('initAiRuntime 需要 {client, getModelingSnapshot, commitModeling}');
  }
  const state = {
    client,
    session: emptySession(),
    listeners: new Set(),
    drawingBridge: null,   // {getSnapshot, commit, undo} 当前绘图文档桥
    runCounter: 0,         // 生成请求代际：迟到响应按代丢弃
    inflight: null,        // 当前在途生成请求 {run, requestId}（停止/取代时精确取消）
    disposed: false,
    conversations: {},     // platform → {projectSessionId, entries:[{role,text}]}
  };
  // best-effort 精确取消在途请求（Host 底座 cancel(requestId, reason)）。
  // 只取消当前记录的这一枚 ID；失败/无 cancel 能力静默忽略，迟到响应仍由
  // 代际守卫（isRunCurrent）与封存比对兜底，绝不 dispose 共享 client。
  const cancelInflight = (reason) => {
    const current = state.inflight;
    if (!current) return;
    state.inflight = null;
    if (!state.client || typeof state.client.cancel !== 'function') return;
    try {
      const settled = state.client.cancel(current.requestId, reason);
      if (settled && typeof settled.catch === 'function') {
        settled.catch(() => { /* best-effort */ });
      }
    } catch (e) { /* best-effort */ }
  };
  const beginInflight = (run, requestId) => {
    state.inflight = {run, requestId};
  };
  const endInflight = (requestId) => {
    if (state.inflight && state.inflight.requestId === requestId) {
      state.inflight = null;
    }
  };
  const notify = () => {
    state.listeners.forEach(fn => {
      try { fn(); } catch (e) { /* 订阅者异常不影响运行时 */ }
    });
  };
  const host = {
    getSession: () => state.session,
    getSnapshot: (domain) => {
      if (domain === 'drawing-document') {
        if (!state.drawingBridge) return {documents: [], documentId: null, selection: null};
        return state.drawingBridge.getSnapshot();
      }
      return getModelingSnapshot();
    },
    commit: (domain, payload) => {
      if (domain === 'drawing-document') {
        if (!state.drawingBridge) {
          return Promise.resolve({ok: false, code: 'CAPABILITY_UNAVAILABLE',
            message: '当前没有打开的陈氏 ER 文档'});
        }
        return state.drawingBridge.commit(payload);
      }
      return commitModeling(payload);
    },
    undoDrawing: (commandId) => {
      if (!state.drawingBridge) {
        return Promise.resolve({ok: false, code: 'CAPABILITY_UNAVAILABLE',
          message: '当前没有打开的陈氏 ER 文档'});
      }
      return state.drawingBridge.undo(commandId);
    },
  };
  const gateway = createGateway({host});
  runtime = {
    client,
    gateway,
    _getModelingSnapshot: getModelingSnapshot,
    available: () => client.available === true,
    // ---- 会话（main 在打开/切换/另存/关闭项目时驱动） ----
    setSession: (next) => {
      const previous = state.session;
      state.session = {...state.session, ...next};
      // 切项目 / 另存为同 ID 新项目（epoch 前进）：对话历史必须清空，
      // 绝不跨项目泄漏；只改 readonly 等字段不影响历史。
      if (String(state.session.projectSessionId) !== String(previous.projectSessionId)
          || String(state.session.epoch) !== String(previous.epoch)) {
        state.conversations = {};
        // 会话身份变化（切项目/另存/会话结束）：在途生成按精确 ID 取消
        cancelInflight('session-switched');
      }
      notify();
    },
    getSession: () => ({...state.session}),
    bumpBaseVersion: () => {
      // 字符串快照版本：v1→v2→…（GATEWAY 封装层校验 baseVersion 为字符串）
      const current = String(state.session.baseVersion || '');
      const n = parseInt(current.replace(/^v/, ''), 10) || 0;
      state.session.baseVersion = `v${n + 1}`;
    },
    // ---- 绘图桥（DrawingAiPanel 挂载注册，卸载注销） ----
    registerDrawingBridge: (bridge) => {
      state.drawingBridge = bridge;
      return () => {
        if (state.drawingBridge === bridge) state.drawingBridge = null;
      };
    },
    // 发送/比对都要读“当前真实 bridge 快照”（含手工布局/命名/锁定/选区），
    // 不允许消费 React 闭包里的旧 doc（INTEGRATION-R1）
    getDrawingSnapshot: () => host.getSnapshot('drawing-document'),
    // ---- 对话历史（INTEGRATION-R1）：同项目/同任务、逐条脱敏、带上限 ----
    getConversation: (platform) => {
      const conv = state.conversations[platform];
      return conv ? conv.entries.slice() : [];
    },
    resetConversation: (platform) => {
      delete state.conversations[platform];
      notify();
    },
    recordConversation: (platform, session, turns) => {
      const sid = session.projectSessionId;
      if (!sid) return;
      let conv = state.conversations[platform];
      if (!conv || conv.projectSessionId !== sid) {
        conv = state.conversations[platform] = {projectSessionId: sid, entries: []};
      }
      (turns || []).forEach((turn) => {
        if (turn && (turn.role === 'user' || turn.role === 'assistant')
            && typeof turn.text === 'string' && turn.text) {
          conv.entries.push({role: turn.role, text: turn.text});
        }
      });
      if (conv.entries.length > MAX_CONVERSATION_ENTRIES) {
        conv.entries = conv.entries.slice(-MAX_CONVERSATION_ENTRIES);
      }
    },
    getDrawingDocuments: () => (typeof getDrawingDocuments === 'function'
      ? (getDrawingDocuments() || []) : []),
    // ---- 订阅 ----
    subscribe: (fn) => {
      state.listeners.add(fn);
      return () => state.listeners.delete(fn);
    },
    dispose: () => {
      // 幂等：新宿主接管时可能已 dispose，旧 Main 卸载清理再来一次必须无副作用
      if (state.disposed) return;
      state.disposed = true;
      gateway.dispose();
      // 卸载运行时：在途生成按精确 ID best-effort 取消（不 dispose 共享 client）
      cancelInflight('client-disposed');
      state.listeners.clear();
      runtime = null;
    },
    // ---- 生成请求（建模/绘图共用）：runId 代际守卫 + 迟到丢弃 ----
    nextRun: () => {
      state.runCounter += 1;
      // 停止/新任务/切项目/切文档：作废上一代在途请求（精确 ID 取消，
      // 取消失败或迟到响应仍由代际守卫与封存比对兜底）
      cancelInflight('superseded');
      return state.runCounter;
    },
    // dispose 后的迟到响应同样作废：网关已清理，不允许再注册新方案
    isRunCurrent: (run) => state.runCounter === run && !state.disposed,
    staleResponse: (reason) => ({ok: false, code: 'REQUEST_STALE', message: reason}),
    // ---- 在途请求登记（runModelingRequest/runDrawingRequest 内部使用） ----
    _beginInflight: beginInflight,
    _endInflight: endInflight,
  };
  return runtime;
};

export const getAiRuntime = () => runtime;

// ---- 生成期封存守卫（INTEGRATION-R1） ----
// 发送前在本地封存会话身份（项目/epoch/baseVersion/只读位）与相关快照指纹
// （建模：完整有效草稿；绘图：当前文档含手工布局/命名/锁定 + 选区 + 文档目录）。
// 指纹只留在本地比对，绝不随请求外发。模型响应返回后、进入 submitDraft 封装前
// 重建一次封存并逐项比对：相关变化 → REQUEST_STALE，且不提交草案（不注册
// 任何可应用的旧方案）。网关既有的提交期守卫（readSet/写边界）保持原样。
const sessionIdentity = (session) => ({
  projectSessionId: session.projectSessionId,
  epoch: String(session.epoch),
  baseVersion: String(session.baseVersion == null ? '' : session.baseVersion),
  readonly: session.readonly === true,
});

export const sealModelingGuard = ({session, snapshot}) => ({
  ...sessionIdentity(session),
  snapshotFingerprint: snapshot === undefined || snapshot === null
    ? null : hashJson(snapshot),
});

export const sealDrawingGuard = ({session, snapshot}) => {
  const documents = snapshot && Array.isArray(snapshot.documents) ? snapshot.documents : [];
  const documentId = snapshot && snapshot.documentId != null ? snapshot.documentId : null;
  const current = documentId
    ? documents.find(d => d && d.id === documentId) || null : null;
  return {
    ...sessionIdentity(session),
    documentId: documentId == null ? null : documentId,
    documentFingerprint: current
      ? hashJson({document: current,
        selection: Array.isArray(snapshot.selection) ? snapshot.selection : null})
      : null,
    catalogFingerprint: hashJson(documents
      .map(d => ({id: d && d.id, name: d && d.defName}))),
  };
};

// 比对发送前与响应后的封存：sealed 上定义的字段逐一核对。
// 只读位只拒绝“翻转”（发送时本就只读的连续状态不误伤）。
export const verifyGenerationGuard = (sealed, current) => {
  if (!sealed || !current) return {ok: false, reason: '生成期封存缺失'};
  if (sealed.projectSessionId !== current.projectSessionId) {
    return {ok: false, reason: '生成期间项目会话已切换'};
  }
  if (sealed.epoch !== current.epoch) {
    return {ok: false, reason: '生成期间会话 epoch 已变化（切项目/另存）'};
  }
  if (sealed.baseVersion !== current.baseVersion) {
    return {ok: false, reason: '生成期间宿主草稿版本已前进（source 已被手工修改）'};
  }
  if (sealed.readonly !== current.readonly) {
    return {ok: false, reason: '生成期间会话只读状态发生变化'};
  }
  if (sealed.snapshotFingerprint !== undefined
      && sealed.snapshotFingerprint !== current.snapshotFingerprint) {
    return {ok: false, reason: '生成期间建模草稿内容已变化'};
  }
  if (sealed.documentFingerprint !== undefined) {
    if (String(sealed.documentId) !== String(current.documentId)) {
      return {ok: false, reason: '生成期间当前绘图文档已切换'};
    }
    if (sealed.documentFingerprint !== current.documentFingerprint) {
      return {ok: false, reason: '生成期间当前绘图文档/选区已变化（布局/命名/锁定/选区）'};
    }
    if (sealed.catalogFingerprint !== current.catalogFingerprint) {
      return {ok: false, reason: '生成期间绘图文档目录已变化'};
    }
  }
  return {ok: true};
};

// 构造发送给 Host 的 ChatRequest。默认能力 false → 纯文本 JSON 通道；
// 服务配置显式声明 tools 支持时附带单一 proposal 工具（参数 Schema 来自
// GATEWAY 能力目录），模型仍可回纯文本。绝不发送项目路径/密钥。
export const buildChatRequest = ({runtime, projectSessionId, epoch, messages, capabilities}) => {
  const payload = {
    requestId: `req_${nowId()}`.slice(0, 64),
    projectSessionId,
    epoch,
    providerId: AI_PROVIDER_ID,
    kind: 'chat',
    messages,
  };
  if (capabilities && capabilities.tools === true) {
    // 完整命令目录放在 system 消息里（见 buildSystemMessage）；工具参数
    // 只保留封闭骨架，宿主会拒绝未知字段。
    payload.tools = [{
      name: 'submit_operations_proposal',
      description: '以结构化参数提交一次模型变更建议（唯一允许的写入口）',
      parameters: {
        type: 'object',
        required: ['summary', 'assumptions', 'operations'],
        properties: {
          summary: {type: 'string'},
          assumptions: {type: 'array', items: {type: 'object',
            properties: {kind: {type: 'string'}, text: {type: 'string'}}}},
          operations: {type: 'array', items: {type: 'object'}},
        },
      },
    }];
  }
  return payload;
};

// system 消息：能力目录 + 权威规则（只读，不携带任何项目数据）
export const buildSystemMessage = ({platform}) => {
  const catalog = describeAiCapabilities({platforms: [platform || 'modeling']});
  return [
    '你是数据建模助手。只能通过 submit_operations_proposal 工具或输出一个 JSON 对象来提交建议，',
    'JSON 顶层字段仅允许 {summary, assumptions, operations}。',
    '不得虚构 planId/planHash/确认ID/回执等本机权威字段。',
    '命令目录与权威规则（严格遵循，未知命令会被拒绝）：',
    JSON.stringify(catalog),
  ].join('\n');
};

// 建模请求：组合受限上下文 → 发送前封存 → 迟到守卫 → 响应后比对封存 → submitDraft → prepare。
// 返回：
//   {kind:'plan', plan, candidate}
//   {kind:'clarifying', text}
//   {kind:'invalid', code, problems|message}
//   {kind:'error', code, message}   网络/会话失败（用户可重试）
//   {ok:false, code:'REQUEST_STALE'} 停止/切项目/只读翻转/dispose/生成期宿主变化
export const runModelingRequest = async ({runtime, userText, contextItems, platform = 'modeling', capabilities}) => {
  const session = runtime.getSession();
  if (!runtime.available()) {
    return {kind: 'error', code: 'AI_HOST_UNAVAILABLE', message: '当前环境不支持 AI 服务'};
  }
  if (!session.projectSessionId) {
    return {kind: 'error', code: 'SESSION_EXPIRED', message: '项目会话尚未建立，请重新打开项目'};
  }
  const run = runtime.nextRun();
  const snapshot = getSnapshotForCompose(runtime);
  const redacted = redactSensitiveText(String(userText || ''));
  // 发送前本地封存：会话身份 + 建模草稿指纹（不外发，响应后比对）
  const sealed = sealModelingGuard({session, snapshot});
  const composed = composeModelingContext({
    dataSource: snapshot,
    items: contextItems || [],
  });
  if (!composed.ok) {
    return {kind: 'error', code: composed.code, message: composed.message};
  }
  const userMessage = [
    '【项目上下文（受限 DTO）】',
    JSON.stringify(composed.payload),
    '',
    '【用户请求】',
    redacted.text,
    '',
    '请依据上下文给出 {summary, assumptions, operations} 的 JSON 建议；如信息不足，直接输出需要澄清的问题文本。',
    (redacted.notices || []).map(n => `（提示：${n}）`).join('\n'),
  ].filter(Boolean).join('\n');
  // 同项目/同任务的脱敏对话历史（带上限）：澄清答复/“把刚才的改成…”保留前文；
  // 历史条目只含纯文本，不含计划权威/凭据/项目数据
  const history = runtime.getConversation('modeling')
    .map(entry => ({role: entry.role, text: entry.text}));
  const messages = [
    {role: 'system', text: buildSystemMessage({platform})},
    ...history,
    {role: 'user', text: userMessage},
  ];
  let result;
  const chatRequest = buildChatRequest({
    runtime,
    projectSessionId: session.projectSessionId,
    epoch: session.epoch,
    messages,
    capabilities,
  });
  // 记录在途 requestId：停止/新任务/会话切换/dispose 时按此精确取消
  runtime._beginInflight(run, chatRequest.requestId);
  try {
    result = await runtime.client.request(chatRequest);
  } catch (error) {
    runtime._endInflight(chatRequest.requestId);
    if (!runtime.isRunCurrent(run)) {
      return runtime.staleResponse('请求已被新任务取代或会话已切换，结果作废');
    }
    return {kind: 'error', code: error && error.code, message: (error && error.message) || '请求失败'};
  }
  runtime._endInflight(chatRequest.requestId);
  if (!runtime.isRunCurrent(run)) {
    return runtime.staleResponse('请求已被新任务取代或会话已切换，结果作废');
  }
  // 响应封装前比对封存：生成期间手工改 source/bump 版本/切项目/转只读/卸载
  // → REQUEST_STALE，且不把旧方案送进 GATEWAY（不注册可应用旧方案）
  const guard = verifyGenerationGuard(sealed,
    sealModelingGuard({session: runtime.getSession(), snapshot: getSnapshotForCompose(runtime)}));
  if (!guard.ok) {
    return runtime.staleResponse(`生成期间宿主已变化，响应作废：${guard.reason}`);
  }
  const submitted = await submitModelOutput({runtime, platform, result, documentId: null});
  recordConversationTurn(runtime, 'modeling', session, redacted.text, submitted);
  return submitted;
};

// 绘图请求：读取真实最新 bridge 快照（不消费 React 闭包旧 doc）→ 封存 → 发送 →
// 响应后比对 → submitDraft。composeDrawingContext 由封存快照组装。
export const runDrawingRequest = async ({runtime, userText, document, selection, capabilities}) => {
  const session = runtime.getSession();
  if (!runtime.available()) {
    return {kind: 'error', code: 'AI_HOST_UNAVAILABLE', message: '当前环境不支持 AI 服务'};
  }
  if (!session.projectSessionId) {
    return {kind: 'error', code: 'SESSION_EXPIRED', message: '项目会话尚未建立，请重新打开项目'};
  }
  // 当前真实 bridge 快照（含手工布局/命名/锁定/选区）；桥注销后 documents 为空
  const bridgeSnapshot = safeDrawingSnapshot(runtime);
  const bridgeDocs = bridgeSnapshot && Array.isArray(bridgeSnapshot.documents)
    ? bridgeSnapshot.documents : [];
  const bridgeDocId = bridgeSnapshot && bridgeSnapshot.documentId != null
    ? bridgeSnapshot.documentId : null;
  const liveDoc = bridgeDocId
    ? bridgeDocs.find(d => d && d.id === bridgeDocId) || null : null;
  const effectiveDoc = liveDoc || document || null;
  const effectiveSelection = bridgeSnapshot && bridgeSnapshot.selection != null
    ? bridgeSnapshot.selection : selection;
  const composed = composeDrawingContext({document: effectiveDoc, selection: effectiveSelection});
  if (!composed.ok) {
    return {kind: 'error', code: composed.code, message: composed.message};
  }
  const run = runtime.nextRun();
  const redacted = redactSensitiveText(String(userText || ''));
  const sealSnapshot = {
    documents: bridgeDocs.length ? bridgeDocs : (effectiveDoc ? [effectiveDoc] : []),
    documentId: bridgeDocId != null ? bridgeDocId
      : (effectiveDoc ? effectiveDoc.id : null),
    selection: Array.isArray(effectiveSelection) ? effectiveSelection : null,
  };
  const sealed = sealDrawingGuard({session, snapshot: sealSnapshot});
  const userMessage = [
    '【绘图上下文（受限 DTO）】',
    JSON.stringify(composed.payload),
    '',
    '【用户请求】',
    redacted.text,
    '',
    '请给出 {summary, assumptions, operations} 的 JSON 建议（drawing.chen.* 命令）；信息不足时输出澄清问题文本。',
  ].join('\n');
  const history = runtime.getConversation('drawing')
    .map(entry => ({role: entry.role, text: entry.text}));
  const messages = [
    {role: 'system', text: buildSystemMessage({platform: 'drawing'})},
    ...history,
    {role: 'user', text: userMessage},
  ];
  let result;
  const chatRequest = buildChatRequest({
    runtime,
    projectSessionId: session.projectSessionId,
    epoch: session.epoch,
    messages,
    capabilities,
  });
  // 记录在途 requestId：停止/新任务/会话切换/dispose 时按此精确取消
  runtime._beginInflight(run, chatRequest.requestId);
  try {
    result = await runtime.client.request(chatRequest);
  } catch (error) {
    runtime._endInflight(chatRequest.requestId);
    if (!runtime.isRunCurrent(run)) {
      return runtime.staleResponse('请求已被新任务取代或会话已切换，结果作废');
    }
    return {kind: 'error', code: error && error.code, message: (error && error.message) || '请求失败'};
  }
  runtime._endInflight(chatRequest.requestId);
  if (!runtime.isRunCurrent(run)) {
    return runtime.staleResponse('请求已被新任务取代或会话已切换，结果作废');
  }
  // 响应封装前比对封存：生成期间宿主 Chen 文档被手工替换/改名/切文档、
  // 布局/锁定/选区变化、桥注销（卸载）→ REQUEST_STALE
  const freshSnapshot = safeDrawingSnapshot(runtime);
  const freshSeal = sealDrawingGuard({session: runtime.getSession(),
    snapshot: {
      documents: freshSnapshot && Array.isArray(freshSnapshot.documents)
        ? freshSnapshot.documents : [],
      documentId: freshSnapshot && freshSnapshot.documentId != null
        ? freshSnapshot.documentId : null,
      selection: freshSnapshot ? freshSnapshot.selection : null,
    }});
  const guard = verifyGenerationGuard(sealed, freshSeal);
  if (!guard.ok) {
    return runtime.staleResponse(`生成期间宿主绘图状态已变化，响应作废：${guard.reason}`);
  }
  const submitted = await submitModelOutput({runtime, platform: 'drawing', result,
    documentId: effectiveDoc ? effectiveDoc.id : null});
  recordConversationTurn(runtime, 'drawing', session, redacted.text, submitted);
  return submitted;
};

// 只在请求结果对当前代际有效（plan/clarifying）时记录对话；
// REQUEST_STALE / error 不写入历史（失败轮次不产生前文）。
const recordConversationTurn = (runtime, platform, session, redactedUserText, submitted) => {
  if (!submitted || (submitted.kind !== 'plan' && submitted.kind !== 'clarifying')) return;
  const turns = [{role: 'user', text: String(redactedUserText || '')}];
  if (submitted.kind === 'clarifying') {
    turns.push({role: 'assistant', text: redactSensitiveText(String(submitted.text || '')).text});
  } else {
    const summary = redactSensitiveText(String((submitted.plan && submitted.plan.summary) || '')).text;
    turns.push({role: 'assistant', text: `已生成方案（待审阅）：${summary.slice(0, 80)}`});
  }
  runtime.recordConversation(platform, session, turns);
};

const safeDrawingSnapshot = (runtime) => {
  if (typeof runtime.getDrawingSnapshot !== 'function') return null;
  try { return runtime.getDrawingSnapshot(); } catch (e) { return null; }
};

// 模型输出 → 封装 → 预演。文本围栏/权威字段拒绝等全部由 GATEWAY draft 层
// 处理；这里只挑选 toolCalls args 或 text。
export const submitModelOutput = async ({runtime, platform, result, documentId}) => {
  let modelOutput = null;
  if (result && Array.isArray(result.toolCalls) && result.toolCalls.length
      && result.toolCalls[0].args) {
    modelOutput = result.toolCalls[0].args;
  } else if (result && typeof result.text === 'string') {
    modelOutput = result.text;
  }
  if (modelOutput === null) {
    return {kind: 'error', code: 'OUTPUT_SCHEMA_INVALID', message: '模型没有返回可用的建议内容'};
  }
  const submitted = await runtime.gateway.submitDraft({
    platform,
    modelOutput,
    ...(documentId ? {documentId} : {}),
  });
  if (submitted.kind === 'plan') {
    const prepared = await runtime.gateway.prepare(submitted.plan.planId);
    if (!prepared.ok) {
      return {kind: 'invalid', code: prepared.code, message: prepared.message};
    }
    return {kind: 'plan', plan: submitted.plan, candidate: prepared.candidate};
  }
  return submitted; // clarifying | invalid
};

// 组合上下文使用的建模快照：宿主注入的完整有效草稿（不经有损搜索投影）
const getSnapshotForCompose = (runtime) => {
  if (runtime._getModelingSnapshot) {
    try { return runtime._getModelingSnapshot(); } catch (e) { return null; }
  }
  return null;
};

export const describeError = (result) => {
  if (!result) return {code: 'UNKNOWN', message: '未知错误'};
  if (result.kind === 'invalid') {
    const problems = Array.isArray(result.problems)
      ? result.problems.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join('；')
      : (result.message || '');
    return {code: result.code || 'OUTPUT_SCHEMA_INVALID', message: problems};
  }
  return {code: result.code || 'ERROR', message: result.message || '处理失败'};
};

export default {initAiRuntime, getAiRuntime, runModelingRequest, runDrawingRequest,
  submitModelOutput, buildChatRequest, buildSystemMessage, describeError,
  sealModelingGuard, sealDrawingGuard, verifyGenerationGuard,
  MAX_CONVERSATION_ENTRIES, AI_PROVIDER_ID};
