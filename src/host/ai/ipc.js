'use strict';
/**
 * 窄 IPC 注册桥 — 只暴露固定业务通道，不提供通用方法执行。
 *
 * 通道（IMPLEMENTATION.md §4 Host Broker 最小集）：
 *   ai:provider:configure / ai:provider:test
 *   ai:session:bind / ai:session:epoch / ai:session:end
 *   ai:request / ai:cancel / ai:getStatus
 *   推送通道（main→renderer，只发归一化事件）：默认 'ai:event'
 *
 * 安全边界：
 * - 每个请求校验 sender（webContents.id 必须已 attach），窗口销毁自动清理订阅与在途请求。
 * - ai:request 强制 windowId=sender.id，拒绝未知字段，载荷大小受限；
 *   不接受函数名/JS/文件路径类通用执行语义，仅 'chat' 一种业务操作。
 * - 凭据只经 ai:provider:configure 进入 vault（内存），任何回显均脱敏。
 * - 现实风险声明：主窗口当前 nodeIntegration=true、contextIsolation=false，
 *   本桥只收敛 AI 通道的暴露面，不构成完整渲染进程隔离（见 host-api.md）。
 */

var ERROR_CODES = require('./errors').ERROR_CODES;
var AiHostError = require('./errors').AiHostError;
var randomId = require('./errors').randomId;

var CHANNELS = {
  configure: 'ai:provider:configure',
  testProvider: 'ai:provider:test',
  sessionBind: 'ai:session:bind',
  sessionEpoch: 'ai:session:epoch',
  sessionEnd: 'ai:session:end',
  request: 'ai:request',
  cancel: 'ai:cancel',
  status: 'ai:getStatus'
};

var MAX_PAYLOAD_CHARS = 3 * 1024 * 1024;
var MAX_WINDOW_IN_FLIGHT = 4;
var REQUEST_ALLOWED_KEYS = {
  requestId: 1, projectSessionId: 1, epoch: 1, providerId: 1, kind: 1,
  messages: 1, tools: 1, jsonSchema: 1, stream: 1, maxTokens: 1, temperature: 1
};

function isPayloadSizeOk(payload) {
  try {
    return JSON.stringify(payload).length <= MAX_PAYLOAD_CHARS;
  } catch (e) {
    return false;
  }
}

/**
 * @param {object} options
 *   ipcMain: Electron ipcMain 或等价 {handle, removeHandler}
 *   broker: createAiHostBroker() 实例
 *   eventChannel: 推送通道名，默认 'ai:event'
 */
function registerAiHostIpc(options) {
  var ipcMain = options.ipcMain;
  var broker = options.broker;
  var eventChannel = options.eventChannel || 'ai:event';
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain with handle() required');
  }
  if (!broker) {
    throw new Error('broker required');
  }

  var windowInFlight = new Map(); // windowId -> count

  function requireAllowedSender(event) {
    var sender = event && event.sender;
    if (!sender || typeof sender.id !== 'number' || !broker.isWindowAllowed(sender.id)) {
      throw AiHostError(ERROR_CODES.WINDOW_NOT_ALLOWED, 'sender window is not attached to AI host');
    }
    return sender;
  }

  function send(sender, payload) {
    try {
      if (sender && typeof sender.isDestroyed === 'function' && sender.isDestroyed()) {
        return;
      }
      sender.send(eventChannel, payload);
    } catch (e) { /* 窗口可能刚销毁 */ }
  }

  function wrap(fn) {
    return function (event, payload) {
      return Promise.resolve().then(function () {
        requireAllowedSender(event);
        if (payload !== undefined && !isPayloadSizeOk(payload)) {
          throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'payload too large');
        }
        return fn(event, payload);
      }).then(function (result) {
        return { ok: true, result: result === undefined ? null : result };
      }, function (err) {
        return {
          ok: false,
          code: err && err.code ? err.code : ERROR_CODES.PROVIDER_ERROR,
          message: err && err.message ? String(err.message).slice(0, 400) : 'unknown error'
        };
      });
    };
  }

  var handlers = {};

  handlers[CHANNELS.configure] = wrap(function (event, payload) {
    var providers = payload && payload.providers;
    if (payload && payload.removeIds !== undefined) {
      if (!Array.isArray(payload.removeIds)) {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'removeIds must be array');
      }
      payload.removeIds.forEach(function (id) { broker.removeProvider(id); });
    }
    var sanitized = providers === undefined ? [] : broker.configureProviders(providers);
    return { providers: sanitized.length ? sanitized : broker.listProviders() };
  });

  handlers[CHANNELS.testProvider] = wrap(function (event, payload) {
    if (!payload || typeof payload.providerId !== 'string') {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'providerId required');
    }
    var sender = event.sender;
    var n0 = windowInFlight.get(sender.id) || 0;
    if (n0 >= MAX_WINDOW_IN_FLIGHT) {
      throw AiHostError(ERROR_CODES.RATE_LIMITED, 'too many in-flight requests for window');
    }
    windowInFlight.set(sender.id, n0 + 1);
    var sessionId = 'ai-test:' + randomId('t');
    var requestId = randomId('req');
    broker.bindSession(sessionId, sender.id);
    var cleanup = function () {
      try { broker.endSession(sessionId); } catch (e) { /* noop */ }
      var n = windowInFlight.get(sender.id) || 1;
      windowInFlight.set(sender.id, Math.max(0, n - 1));
    };
    return broker.request({
      requestId: requestId,
      projectSessionId: sessionId,
      epoch: 1,
      providerId: payload.providerId,
      kind: 'chat',
      windowId: sender.id,
      messages: [{ role: 'user', text: 'ping' }],
      stream: false,
      maxTokens: 8
    }, function () { /* 测试请求不推送流事件 */ }).then(function (result) {
      cleanup();
      return { providerId: payload.providerId, reachable: true, finishReason: result.finishReason, usage: result.usage };
    }, function (err) {
      cleanup();
      throw err;
    });
  });

  handlers[CHANNELS.sessionBind] = wrap(function (event, payload) {
    if (!payload || typeof payload.projectSessionId !== 'string') {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'projectSessionId required');
    }
    // 会话归属绑定到发起窗口：其他已 attach 窗口不能操作/请求该会话
    return broker.bindSession(payload.projectSessionId, event.sender.id);
  });

  handlers[CHANNELS.sessionEpoch] = wrap(function (event, payload) {
    if (!payload || typeof payload.projectSessionId !== 'string') {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'projectSessionId required');
    }
    return broker.advanceEpoch(payload.projectSessionId, event.sender.id);
  });

  handlers[CHANNELS.sessionEnd] = wrap(function (event, payload) {
    if (!payload || typeof payload.projectSessionId !== 'string') {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'projectSessionId required');
    }
    broker.endSession(payload.projectSessionId, event.sender.id);
    return { ended: true };
  });

  handlers[CHANNELS.request] = wrap(function (event, payload) {
    var sender = event.sender;
    if (!payload || typeof payload !== 'object') {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'payload must be object');
    }
    var keys = Object.keys(payload);
    for (var i = 0; i < keys.length; i += 1) {
      if (!REQUEST_ALLOWED_KEYS[keys[i]]) {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'unknown request field: ' + keys[i]);
      }
    }
    var wrappedPayload = Object.assign({}, payload, { windowId: sender.id, kind: payload.kind || 'chat' });
    // 入网前同步预检（载荷/会话/epoch/归属/能力/限流）：失败直接 ok:false 返回，不出网、不发事件
    broker.validateRequest(wrappedPayload);
    var inFlightNow = windowInFlight.get(sender.id) || 0;
    if (inFlightNow >= MAX_WINDOW_IN_FLIGHT) {
      throw AiHostError(ERROR_CODES.RATE_LIMITED, 'too many in-flight requests for window', {
        limit: MAX_WINDOW_IN_FLIGHT
      });
    }
    windowInFlight.set(sender.id, inFlightNow + 1);
    var release = function () {
      var n = windowInFlight.get(sender.id) || 1;
      windowInFlight.set(sender.id, Math.max(0, n - 1));
    };
    var sawTerminal = false;
    // 网络阶段异步；过程与终态经 ai:event 推送；
    // 若请求在网络阶段即失败（连接错误等），补发终态错误事件，保证 renderer 一定收到终态。
    broker.request(wrappedPayload, function (envelope) {
      var t = envelope.event && envelope.event.type;
      if (t === 'done' || t === 'error' || t === 'cancelled') {
        sawTerminal = true;
      }
      send(sender, envelope);
    }).then(function () { release(); }, function (err) {
      release();
      if (!sawTerminal) {
        send(sender, {
          requestId: payload.requestId,
          generation: 1,
          event: {
            type: 'error',
            code: err && err.code ? err.code : ERROR_CODES.PROVIDER_ERROR,
            message: err && err.message ? String(err.message).slice(0, 400) : 'request failed'
          }
        });
      }
    });
    return { accepted: true, requestId: payload.requestId, windowId: sender.id };
  });

  handlers[CHANNELS.cancel] = wrap(function (event, payload) {
    if (!payload || typeof payload.requestId !== 'string') {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'requestId required');
    }
    return broker.cancel(payload.requestId, payload.reason || 'user', event.sender.id);
  });

  handlers[CHANNELS.status] = wrap(function () {
    return broker.getStatus();
  });

  Object.keys(handlers).forEach(function (channel) {
    ipcMain.handle(channel, handlers[channel]);
  });

  return {
    channels: CHANNELS,
    eventChannel: eventChannel,
    /** 集成者在创建窗口时调用；窗口销毁会自动清理（broker 监听 destroyed）。 */
    attachWindow: function (webContents) {
      broker.attachWindow(webContents);
      windowInFlight.set(webContents.id, 0);
    },
    detachWindow: function (windowId) {
      broker.detachWindow(windowId);
      windowInFlight.delete(windowId);
    },
    dispose: function () {
      Object.keys(handlers).forEach(function (channel) {
        if (typeof ipcMain.removeHandler === 'function') {
          ipcMain.removeHandler(channel);
        }
      });
      broker.cancelAll('ipc-dispose');
    }
  };
}

module.exports = {
  registerAiHostIpc: registerAiHostIpc,
  AI_IPC_CHANNELS: CHANNELS
};
