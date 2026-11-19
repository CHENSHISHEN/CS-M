// AI Host IPC 客户端（renderer 侧）— SHELL 接缝
//
// 合同：doc/developer/platform-ai-v1/implementation/host-api.md（通道名为稳定合同，此处按合同复述）。
// - 只使用 electron 现有 ipcRenderer 的 invoke/on/removeListener；ipc 经依赖注入便于测试。
// - 不依赖任何全局注入的假后端；非 Electron 渲染进程（浏览器）显式不可用。
// - 不使用 localStorage 持久化密钥或对话（本模块不持久化任何数据）。
// - ai:event 推送按 requestId 精确匹配；同步 invoke 拒绝/同步 throw 同样清理在途并落终态；
//   终态（done/error/cancelled）只结算一次，之后的事件一律丢弃（迟到事件处理）。
// - 单实例只挂一个 ai:event 监听（防重复订阅）；dispose 移除监听、立即结算全部在途，
//   并 best-effort 通知 Host 取消这些请求（失败忽略；项目会话 endSession 仍由上层负责）。

export const AI_HOST_CHANNELS = {
  configure: 'ai:provider:configure',
  testProvider: 'ai:provider:test',
  sessionBind: 'ai:session:bind',
  sessionEpoch: 'ai:session:epoch',
  sessionEnd: 'ai:session:end',
  request: 'ai:request',
  cancel: 'ai:cancel',
  status: 'ai:getStatus',
};

export const AI_HOST_EVENT_CHANNEL = 'ai:event';

export const HOST_CLIENT_UNAVAILABLE = 'AI_HOST_UNAVAILABLE';
export const HOST_CLIENT_DISPOSED = 'CLIENT_DISPOSED';

function resolveDefaultIpc() {
  try {
    // 运行时解析：浏览器/纯 Node 环境无 ipcRenderer，视为显式不可用
    const electron = require('electron');
    const ipc = electron && electron.ipcRenderer;
    if (ipc && typeof ipc.invoke === 'function' && typeof ipc.on === 'function'
      && typeof ipc.removeListener === 'function') {
      return ipc;
    }
  } catch (e) { /* 不在 Electron 渲染进程 */ }
  return null;
}

function hostError(code, message) {
  const err = new Error(message || code || 'AI host error');
  err.code = code || 'PROVIDER_ERROR';
  err.isHostError = true;
  return err;
}

/**
 * @param {object} [options]
 *   ipc: {invoke(channel,payload), on(channel,listener), removeListener(channel,listener)}，
 *        缺省用 electron.ipcRenderer（不可用则 available=false）
 *   channels / eventChannel: 通道覆盖（默认按 host-api.md 合同）
 */
export function createAiHostClient(options = {}) {
  const ipc = options.ipc || resolveDefaultIpc();
  const channels = options.channels || AI_HOST_CHANNELS;
  const eventChannel = options.eventChannel || AI_HOST_EVENT_CHANNEL;
  const inflight = new Map(); // requestId -> entry
  let disposed = false;
  let subscribed = false;
  let listener = null;

  const rejectWith = (code, message) => Promise.reject(hostError(code, message));

  function settle(entry, err, result) {
    if (entry.settled) return;
    entry.settled = true;
    inflight.delete(entry.requestId);
    if (err) entry.reject(err);
    else entry.resolve(result);
  }

  function handleEnvelope(_event, envelope) {
    if (!envelope || typeof envelope.requestId !== 'string') return;
    const entry = inflight.get(envelope.requestId);
    // 精确 requestId 匹配：未知 id（含其他窗口的请求）与已结算请求的迟到事件全部忽略
    if (!entry || entry.settled) return;
    const event = envelope.event || {};
    if (typeof entry.onEvent === 'function') {
      try { entry.onEvent(event, envelope.generation); } catch (e) { /* 回调异常不影响结算 */ }
    }
    if (event.type === 'done') {
      settle(entry, null, event.result);
    } else if (event.type === 'error') {
      settle(entry, hostError(event.code, event.message));
    } else if (event.type === 'cancelled') {
      const err = hostError('CANCELLED', 'request cancelled: ' + (event.reason || 'user'));
      err.cancelled = true;
      err.reason = event.reason;
      settle(entry, err);
    }
  }

  function ensureSubscribed() {
    if (subscribed) return;
    listener = (event, envelope) => handleEnvelope(event, envelope);
    ipc.on(eventChannel, listener);
    subscribed = true;
  }

  function invoke(channel, payload) {
    if (disposed) return rejectWith(HOST_CLIENT_DISPOSED, 'host client disposed');
    if (!ipc) return rejectWith(HOST_CLIENT_UNAVAILABLE, 'AI host IPC not available in this environment');
    let promise;
    try {
      promise = ipc.invoke(channel, payload);
    } catch (e) {
      // invoke 同步 throw 同样转为拒绝终态，不向调用方抛同步异常
      return rejectWith(null, e && e.message);
    }
    return promise.then((resp) => {
      if (resp && resp.ok) return resp.result;
      throw hostError(resp && resp.code, resp && resp.message);
    }, (err) => {
      throw hostError(null, err && err.message);
    });
  }

  /**
   * 发起一次 chat 请求。
   * @param {object} payload ChatRequest（含 requestId/projectSessionId/epoch/providerId/kind...）
   * @param {function} [onEvent] 流事件回调 (event, generation)，终态事件同样先回调再结算
   * @returns {Promise<object>} 终态 promise：done -> resolve(done.result)；error/cancelled/同步拒绝 -> reject(err.code)
   */
  function request(payload, onEvent) {
    if (disposed) return rejectWith(HOST_CLIENT_DISPOSED, 'host client disposed');
    if (!ipc) return rejectWith(HOST_CLIENT_UNAVAILABLE, 'AI host IPC not available in this environment');
    if (!payload || typeof payload.requestId !== 'string') {
      return rejectWith('INVALID_REQUEST', 'requestId required');
    }
    if (inflight.has(payload.requestId)) {
      return rejectWith('INVALID_REQUEST', 'requestId already in flight');
    }
    ensureSubscribed();
    let entry;
    const promise = new Promise((resolve, reject) => {
      entry = {requestId: payload.requestId, onEvent, settled: false, resolve, reject};
    });
    inflight.set(payload.requestId, entry);
    // 入网前同步校验失败时 host 直接 {ok:false} 且不发事件：这里也必须清理在途并落终态；
    // ipc.invoke 同步 throw（桥/环境异常）同样立即结算，不能留下永不终态的 pending
    try {
      ipc.invoke(channels.request, payload).then((resp) => {
        if (!resp || resp.ok !== true) {
          settle(entry, hostError(resp && resp.code, resp && resp.message));
        }
        // accepted：网络过程与终态走 ai:event 推送
      }, (err) => {
        settle(entry, hostError(null, err && err.message));
      });
    } catch (e) {
      settle(entry, hostError(null, e && e.message));
    }
    return promise;
  }

  return {
    channels,
    eventChannel,
    get available() { return !disposed && !!ipc; },
    get disposed() { return disposed; },
    get inFlightCount() { return inflight.size; },
    /** 配置/删除 provider；回执为脱敏 provider 列表（无 apiKey） */
    configureProviders: (input) => invoke(channels.configure, input),
    /** 连接测试：回执 {providerId, reachable, finishReason, usage}（真实出网一次） */
    testProvider: (providerId) => invoke(channels.testProvider, {providerId}),
    /** 会话绑定到当前窗口；返回 {projectSessionId, epoch:1} */
    bindSession: (projectSessionId) => invoke(channels.sessionBind, {projectSessionId}),
    /** epoch 前进：旧 epoch 在途请求被取消；返回新 epoch */
    advanceEpoch: (projectSessionId) => invoke(channels.sessionEpoch, {projectSessionId}),
    /** 结束会话：取消其全部在途请求 */
    endSession: (projectSessionId) => invoke(channels.sessionEnd, {projectSessionId}),
    /** chat 请求（见上） */
    request,
    /** 取消在途请求（仅本窗口所属）；请求终态经 cancelled 事件结算 */
    cancel: (requestId, reason) => invoke(channels.cancel, {requestId, reason}),
    /** Host 状态（providers/sessions/credentialVault/stats），ready 判定的事实来源 */
    getStatus: () => invoke(channels.status),
    /** 卸载清理：移除 ai:event 订阅、立即结算全部在途（CLIENT_DISPOSED），并 best-effort 通知 Host 取消 */
    dispose() {
      if (disposed) return;
      disposed = true;
      if (subscribed && ipc && listener) {
        try { ipc.removeListener(eventChannel, listener); } catch (e) { /* noop */ }
      }
      subscribed = false;
      listener = null;
      const entries = Array.from(inflight.values());
      entries.forEach((entry) => settle(entry, hostError(HOST_CLIENT_DISPOSED, 'host client disposed')));
      // best-effort：请 Host 取消仍在途的请求（本客户端已结算，取消只为停止 Host 侧出网；
      // 失败/同步 throw 一律忽略。项目会话生命周期 endSession/epoch 仍由上层负责，dispose 不代表整个会话结束）
      if (ipc) {
        entries.forEach((entry) => {
          try {
            Promise.resolve(ipc.invoke(channels.cancel, {requestId: entry.requestId, reason: 'client-disposed'}))
              .catch(() => { /* best-effort */ });
          } catch (e) { /* best-effort */ }
        });
      }
    },
  };
}
