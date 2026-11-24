'use strict';
/**
 * AI Host Broker — 主进程内的网络编排核心（无 Electron 依赖，可独立测试）。
 *
 * 职责（对齐 ARCHITECTURE.md §1/§2/§11 与 IMPLEMENTATION.md §4 Host Broker）：
 * - 会话绑定：requestId ↔ projectSessionId/epoch/windowId；epoch 过期请求在入网前拒绝，
 *   epoch 前进会取消旧 epoch 的在途请求并拒收迟到 chunk（generation 守卫）。
 * - 限流与并发：按 provider 配置的 requestsPerMinute / maxConcurrent，外加全局在途上限。
 * - 预算：单请求输出字符上限（超限立即断流）、总超时、流空闲超时。
 * - 凭据：只经 InMemoryCredentialVault（本轮会话内存），不进任何持久层；
 *   错误与事件输出经 redact 清洗，绝不包含 key/headers。
 * - 归一化事件流：text-delta / tool-call-* / message-end / done / error / cancelled。
 *
 * 本模块不做：项目文件读写、任意函数执行、SQL/JSON 语义校验（属 CORE 层）、
 * 自动切换 provider、声称未实测的能力。
 */

var providersRegistry = require('./providers');
var configLib = require('./config');
var _errors = require('./errors');
var AiHostError = _errors.AiHostError;
var ERROR_CODES = _errors.ERROR_CODES;
var redactText = _errors.redactText;
var randomId = _errors.randomId;
var httpLib = require('./http');
var InMemoryCredentialVault = require('./credentials').InMemoryCredentialVault;

var GLOBAL_MAX_IN_FLIGHT = 16;
var MAX_MESSAGES = 200;
var MAX_MESSAGE_TEXT = 200 * 1024;
var MAX_TOOLS = 64;
var MAX_TOOL_NAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/;
var MAX_JSON_BYTES = 32 * 1024;
var MAX_JSON_DEPTH = 16;
var MAX_TOTAL_PAYLOAD_CHARS = 2 * 1024 * 1024;

function jsonSizeOk(value, budget) {
  try {
    return JSON.stringify(value).length <= budget;
  } catch (e) {
    return false;
  }
}

function jsonDepthOk(value, depth) {
  if (depth > MAX_JSON_DEPTH) { return false; }
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) {
        if (!jsonDepthOk(value[i], depth + 1)) { return false; }
      }
    } else {
      var keys = Object.keys(value);
      for (var j = 0; j < keys.length; j += 1) {
        if (!jsonDepthOk(value[keys[j]], depth + 1)) { return false; }
      }
    }
  }
  return true;
}

/**
 * 统一请求地址解析（HOST-R1 合同，两个协议适配器共用）：
 * - 显式 config.path：origin-relative 完整覆盖 —— 只保留 baseURL 的 scheme/host/port，丢弃其路径；
 * - baseURL 已含本协议完整原生 endpoint（可带企业网关前缀或末尾斜杠）：按原地址发送，不重复拼接；
 * - baseURL 以版本段（如 /v1）结尾（可带网关前缀，如 /gw/v1/）：只补 endpoint 余下部分；
 * - 其余（origin、企业网关前缀）：保留前缀并追加完整默认 endpoint（/ai-gw → /ai-gw/v1/chat/completions）。
 * 协议错配（baseURL 指向另一协议已知 endpoint）在配置期已被 config.js 拒绝，不会到这里。
 */
function resolveRequestURL(baseURL, protocol, explicitPath) {
  var base = new URL(baseURL);
  if (explicitPath) {
    return new URL(explicitPath, base); // 以 '/' 开头的绝对路径整体替换 pathname，保留 origin
  }
  var adapter = providersRegistry.getAdapter(protocol);
  var defaultPath = adapter && adapter.defaultPath ? adapter.defaultPath : '/';
  var basePath = base.pathname.replace(/\/+$/, ''); // 末尾斜杠归一（root → ''）
  // defaultPath 自带前导 '/'，endsWith 天然按段匹配（不会命中 /xxxv1/... 之类前缀粘连）
  if (basePath.endsWith(defaultPath)) {
    return new URL(basePath, base); // 完整 endpoint（含网关前缀）已提供：原地址发送
  }
  var versionPrefix = defaultPath.slice(0, defaultPath.indexOf('/', 1)); // 首段，如 '/v1'
  if (versionPrefix && versionPrefix !== '/' && basePath.endsWith(versionPrefix)) {
    return new URL(basePath + defaultPath.slice(versionPrefix.length), base); // /v1 已在 base 中：只补余下，不重复
  }
  return new URL(basePath + defaultPath, base); // origin / 网关前缀：追加完整默认 endpoint
}

/**
 * AI-01：凭据绑定的 endpoint 身份 = protocol + baseURL + 显式 path（均取归一化后的值）。
 * baseURL 已由 config.js 经 URL 解析归一（scheme/host 小写、默认端口、根斜杠）；
 * 这里再剥除 pathname 末尾斜杠 —— resolveRequestURL 同样剥除，故 /v1 与 /v1/ 实际出网地址相同。
 * 不同 host 字面量（127.0.0.1 vs localhost）按不同 endpoint 处理（保守）。
 */
function endpointIdentity(config) {
  var u = new URL(config.baseURL);
  var basePath = u.pathname.replace(/\/+$/, '');
  return [config.protocol, u.origin + basePath, config.path || ''].join('\n');
}

function nowMs() {
  return Date.now();
}

/**
 * @param {object} [options]
 *   vault: 可注入同接口实现；默认 InMemoryCredentialVault
 *   now: 测试可注入时钟
 */
function createAiHostBroker(options) {
  var opts = options || {};
  var vault = opts.vault || new InMemoryCredentialVault();
  var now = opts.now || nowMs;

  var providers = new Map();   // id -> {config}
  var sessions = new Map();    // projectSessionId -> {epoch, lastActiveAt}
  var requests = new Map();    // requestId -> record
  var windows = new Map();     // windowId -> {webContents}
  var rateState = new Map();   // providerId -> {window:[ts], active}
  var stats = { total: 0, failed: 0, cancelled: 0, completed: 0 };

  /** 脱敏回显 + 凭据是否在 vault（只给布尔，读取时实时计算，反映清除后的真实状态） */
  function sanitizeWithCredential(config) {
    var out = configLib.sanitizeProviderConfig(config);
    out.hasCredential = vault.has('provider:' + config.id);
    return out;
  }

  function requireProvider(providerId) {
    var entry = providers.get(providerId);
    if (!entry) {
      throw AiHostError(ERROR_CODES.AI_NOT_CONFIGURED, 'provider not configured', { providerId: providerId });
    }
    return entry;
  }

  function getSession(projectSessionId) {
    var s = sessions.get(projectSessionId);
    if (!s) {
      throw AiHostError(ERROR_CODES.SESSION_EXPIRED, 'project session not bound', {
        projectSessionId: projectSessionId
      });
    }
    return s;
  }

  /** 会话归属校验：绑定了 owner 的会话只允许 owner 窗口操作/请求。 */
  function requireSessionOwner(session, actorWindowId) {
    if (session.ownerWindowId != null && actorWindowId !== session.ownerWindowId) {
      throw AiHostError(ERROR_CODES.WINDOW_NOT_ALLOWED, 'project session owned by another window', {
        ownerWindow: session.ownerWindowId
      });
    }
  }

  function getRateState(providerId) {
    var rs = rateState.get(providerId);
    if (!rs) {
      rs = { window: [], active: 0 };
      rateState.set(providerId, rs);
    }
    return rs;
  }

  function checkRate(providerId, limits) {
    var rs = getRateState(providerId);
    var t = now();
    rs.window = rs.window.filter(function (ts) { return t - ts < 60000; });
    if (rs.active >= limits.maxConcurrent) {
      throw AiHostError(ERROR_CODES.RATE_LIMITED, 'provider concurrency limit reached', {
        limit: limits.maxConcurrent, kind: 'concurrency'
      });
    }
    if (rs.window.length >= limits.requestsPerMinute) {
      var oldest = rs.window[0];
      throw AiHostError(ERROR_CODES.RATE_LIMITED, 'provider rate limit reached', {
        limit: limits.requestsPerMinute,
        retryAfterMs: Math.max(1000, 60000 - (t - oldest)),
        kind: 'rate'
      });
    }
  }

  function consumeRateSlot(providerId) {
    var rs = getRateState(providerId);
    rs.window.push(now());
    rs.active += 1;
  }

  function releaseRateSlot(providerId) {
    var rs = rateState.get(providerId);
    if (rs && rs.active > 0) { rs.active -= 1; }
  }

  /** 归一化事件出口守卫：closed/迟到 generation 丢弃；text 超限即断流。 */
  function makeGuardedEmit(record) {
    return function guardedEmit(event) {
      if (record.closed) { return false; }
      if (event.type === 'text-delta' && typeof event.text === 'string') {
        record.textChars += event.text.length;
        if (record.textChars > record.limits.maxOutputChars) {
          failRequest(record, AiHostError(ERROR_CODES.OUTPUT_LIMIT_EXCEEDED,
            'output exceeded char limit', { maxOutputChars: record.limits.maxOutputChars }));
          return false;
        }
      }
      try {
        record.onEvent({ requestId: record.requestId, generation: record.generation, event: event });
      } catch (e) { /* 订阅方异常不影响流 */ }
      return true;
    };
  }

  function settleRequest(record, terminalEvent) {
    if (record.closed) { return; }
    record.closed = true;
    record.terminal = terminalEvent;
    record.generation += 1; // 后续任何迟到输出都不再放出
    try {
      record.onEvent({ requestId: record.requestId, generation: record.generation, event: terminalEvent });
    } catch (e) { /* noop */ }
    requests.delete(record.requestId);
    releaseRateSlot(record.providerId);
    if (terminalEvent.type === 'done') { stats.completed += 1; }
    else if (terminalEvent.type === 'cancelled') { stats.cancelled += 1; }
    else { stats.failed += 1; }
  }

  function failRequest(record, err) {
    if (record.abortFn) { record.abortFn(); }
    settleRequest(record, {
      type: 'error',
      code: err && err.code ? err.code : ERROR_CODES.PROVIDER_ERROR,
      message: redactText(err && err.message ? err.message : 'request failed', record.secrets),
      details: err && err.details ? err.details : undefined
    });
  }

  function cancelRecord(record, reason) {
    if (record.abortFn) { record.abortFn(); }
    settleRequest(record, { type: 'cancelled', reason: reason || 'user' });
  }

  function validateChatPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'payload must be an object');
    }
    var requestId = payload.requestId;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'requestId invalid');
    }
    if (requests.has(requestId)) {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'requestId in use', { requestId: requestId });
    }
    if (typeof payload.projectSessionId !== 'string' || payload.projectSessionId.length === 0 || payload.projectSessionId.length > 128) {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'projectSessionId invalid');
    }
    if (typeof payload.epoch !== 'number' || !isFinite(payload.epoch) || payload.epoch < 1 || Math.floor(payload.epoch) !== payload.epoch) {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'epoch invalid');
    }
    if (typeof payload.providerId !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(payload.providerId)) {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'providerId invalid');
    }
    if (payload.windowId !== undefined && typeof payload.windowId !== 'number') {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'windowId invalid');
    }
    if (payload.kind !== 'chat') {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'unsupported kind', { kind: String(payload.kind) });
    }
    var messages = payload.messages;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'messages must be 1..' + MAX_MESSAGES + ' items');
    }
    var totalChars = 0;
    for (var i = 0; i < messages.length; i += 1) {
      var m = messages[i];
      if (!m || typeof m !== 'object') {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'message must be object');
      }
      if (['system', 'user', 'assistant', 'tool'].indexOf(m.role) === -1) {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'message role invalid');
      }
      if (m.text !== undefined && (typeof m.text !== 'string' || m.text.length > MAX_MESSAGE_TEXT)) {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'message text invalid');
      }
      if (m.text) { totalChars += m.text.length; }
      if (m.role === 'tool') {
        if (typeof m.toolCallId !== 'string' || m.toolCallId.length === 0 || m.toolCallId.length > 128) {
          throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'tool message requires toolCallId');
        }
      }
      if (m.toolCalls !== undefined) {
        if (!Array.isArray(m.toolCalls) || m.toolCalls.length > MAX_TOOLS) {
          throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'toolCalls invalid');
        }
        for (var j = 0; j < m.toolCalls.length; j += 1) {
          var tc = m.toolCalls[j];
          if (!tc || typeof tc.id !== 'string' || tc.id.length === 0 || tc.id.length > 128 ||
            !MAX_TOOL_NAME_RE.test(String(tc.name))) {
            throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'toolCall invalid');
          }
          if (tc.args !== undefined && (!tc.args || typeof tc.args !== 'object' || !jsonSizeOk(tc.args, MAX_JSON_BYTES))) {
            throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'toolCall args invalid');
          }
        }
      }
    }
    if (totalChars > MAX_TOTAL_PAYLOAD_CHARS) {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'payload too large');
    }
    var tools = payload.tools;
    if (tools !== undefined) {
      if (!Array.isArray(tools) || tools.length === 0 || tools.length > MAX_TOOLS) {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'tools invalid');
      }
      for (var k = 0; k < tools.length; k += 1) {
        var t = tools[k];
        if (!t || !MAX_TOOL_NAME_RE.test(String(t.name))) {
          throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'tool name invalid');
        }
        if (t.description !== undefined && (typeof t.description !== 'string' || t.description.length > 2000)) {
          throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'tool description invalid');
        }
        if (t.parameters !== undefined && (!jsonDepthOk(t.parameters, 1) || !jsonSizeOk(t.parameters, MAX_JSON_BYTES))) {
          throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'tool parameters invalid');
        }
      }
    }
    var jsonSchema = payload.jsonSchema;
    if (jsonSchema !== undefined) {
      if (!jsonSchema || !MAX_TOOL_NAME_RE.test(String(jsonSchema.name || ''))) {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'jsonSchema name invalid');
      }
      if (!jsonSchema.schema || !jsonDepthOk(jsonSchema.schema, 1) || !jsonSizeOk(jsonSchema.schema, MAX_JSON_BYTES)) {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'jsonSchema invalid');
      }
    }
    if (payload.stream !== undefined && typeof payload.stream !== 'boolean') {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'stream must be boolean');
    }
    if (payload.maxTokens !== undefined && (typeof payload.maxTokens !== 'number' || payload.maxTokens < 1 || payload.maxTokens > 32768 || Math.floor(payload.maxTokens) !== payload.maxTokens)) {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'maxTokens invalid');
    }
    if (payload.temperature !== undefined && (typeof payload.temperature !== 'number' || payload.temperature < 0 || payload.temperature > 2)) {
      throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'temperature invalid');
    }
  }

  /**
   * 入网前预检：载荷校验 + provider/能力/会话/epoch/归属/限流检查。
   * 无副作用（不动计数、不建记录）；IPC 层据此同步拒绝请求。
   */
  function precheckRequest(payload) {
    validateChatPayload(payload);
    var providerEntry = requireProvider(payload.providerId);
    var config = providerEntry.config;
    var adapter = providersRegistry.getAdapter(config.protocol);
    if (!adapter) {
      throw AiHostError(ERROR_CODES.CAPABILITY_UNAVAILABLE, 'protocol adapter missing');
    }
    var session = getSession(payload.projectSessionId);
    requireSessionOwner(session, typeof payload.windowId === 'number' ? payload.windowId : null);
    if (payload.epoch !== session.epoch) {
      throw AiHostError(ERROR_CODES.SESSION_EXPIRED, 'epoch mismatch', {
        currentEpoch: session.epoch, requestEpoch: payload.epoch
      });
    }
    var stream = payload.stream === true;
    if (stream && !config.capabilities.stream) {
      throw AiHostError(ERROR_CODES.CAPABILITY_UNAVAILABLE, 'provider stream capability not declared');
    }
    if (payload.tools && !config.capabilities.tools) {
      throw AiHostError(ERROR_CODES.CAPABILITY_UNAVAILABLE, 'provider tools capability not declared');
    }
    if (payload.jsonSchema && !config.capabilities.jsonMode) {
      throw AiHostError(ERROR_CODES.CAPABILITY_UNAVAILABLE, 'provider jsonMode capability not declared');
    }
    if (requests.size >= GLOBAL_MAX_IN_FLIGHT) {
      throw AiHostError(ERROR_CODES.RATE_LIMITED, 'host busy', { kind: 'global' });
    }
    checkRate(config.id, config.limits);
    return { config: config, adapter: adapter };
  }

  /**
   * 发起一次归一化 chat 请求。
   * @param payload 校验后的请求（见 host-api.md）
   * @param onEvent function({requestId, generation, event}) 归一化事件回调
   * @returns Promise<result> result 为最终归一化消息；失败 reject AiHostError。
   *          流式过程只经 onEvent；terminal 事件同时经 onEvent 与 promise 结果表达。
   */
  function request(payload, onEvent) {
    stats.total += 1;
    var checked;
    try {
      checked = precheckRequest(payload);
    } catch (e) {
      stats.failed += 1;
      return Promise.reject(e);
    }
    var config = checked.config;
    var adapter = checked.adapter;
    var session = sessions.get(payload.projectSessionId);
    session.lastActiveAt = now();

    var requestId = payload.requestId;
    var record = {
      requestId: requestId,
      projectSessionId: payload.projectSessionId,
      epoch: payload.epoch,
      windowId: typeof payload.windowId === 'number' ? payload.windowId : null,
      providerId: config.id,
      generation: 1,
      closed: false,
      textChars: 0,
      limits: config.limits,
      abortFn: null,
      onEvent: onEvent || function () {},
      secrets: [],
      startedAt: now()
    };
    requests.set(requestId, record);

    var apiKey = vault.get('provider:' + config.id);
    if (apiKey) { record.secrets.push(apiKey); }
    Object.keys(config.extraHeaders).forEach(function (name) {
      record.secrets.push(config.extraHeaders[name]);
    });

    var state = adapter.createParser();
    var nonStreamChunks = [];

    var prepared = adapter.prepare(config, payload, apiKey);
    var bodyString = JSON.stringify(prepared.body);
    var targetURL = resolveRequestURL(config.baseURL, config.protocol, config.path);

    var guardedEmit = makeGuardedEmit(record);

    consumeRateSlot(config.id);

    var handle = httpLib.postJsonStream({
      parsedURL: targetURL,
      headers: prepared.headers,
      body: bodyString,
      timeoutMs: config.limits.timeoutMs,
      idleTimeoutMs: config.limits.idleTimeoutMs,
      maxOutputBytes: config.limits.maxOutputChars * 6 + 65536,
      redactSecrets: record.secrets,
      onLine: function (line) {
        if (record.closed) { return; }
        if (prepared.stream) {
          try {
            adapter.consumeLine(state, line, guardedEmit);
          } catch (e) {
            var code = e && e.providerError === 'overloaded_error' ? ERROR_CODES.RATE_LIMITED : ERROR_CODES.STREAM_BROKEN;
            failRequest(record, AiHostError(code, e.message || 'stream parse failed'));
            handle.abort();
          }
        } else {
          nonStreamChunks.push(line);
        }
      }
    });
    record.abortFn = function () { handle.abort(); };

    function terminalToError(recordRef) {
      var t = recordRef.terminal;
      if (t && t.type === 'error') {
        return AiHostError(t.code, t.message, t.details);
      }
      return AiHostError(ERROR_CODES.CANCELLED, 'request cancelled');
    }

    return handle.promise.then(function (outcome) {
      if (record.closed) {
        throw terminalToError(record);
      }
      if (outcome && outcome.aborted) {
        settleRequest(record, { type: 'cancelled', reason: 'aborted' });
        throw AiHostError(ERROR_CODES.CANCELLED, 'request cancelled');
      }
      var finalizeResultLocal;
      try {
        if (!prepared.stream) {
          var fullText = nonStreamChunks.join('\n');
          adapter.consumeNonStreamBody(state, fullText, guardedEmit);
        }
        finalizeResultLocal = adapter.finalize(state, guardedEmit);
        if (record.textChars > config.limits.maxOutputChars) {
          throw AiHostError(ERROR_CODES.OUTPUT_LIMIT_EXCEEDED, 'output exceeded char limit');
        }
      } catch (e) {
        failRequest(record, e && e.isAiHostError ? e : AiHostError(ERROR_CODES.STREAM_BROKEN,
          redactText(e && e.message ? e.message : 'response parse failed', record.secrets)));
        throw terminalToError(record);
      }
      settleRequest(record, { type: 'done', result: finalizeResultLocal });
      return finalizeResultLocal;
    }, function (err) {
      if (record.closed) {
        // 已被 cancel/settle：迟到错误不再覆盖终态
        throw terminalToError(record);
      }
      failRequest(record, err);
      throw err;
    });
  }

  var broker = {
    vault: vault,

    request: request,

    /** IPC 层同步预检（无副作用）；失败抛 AiHostError。 */
    validateRequest: precheckRequest,

    configureProviders: function (list) {
      if (!Array.isArray(list) || list.length > 16) {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'providers must be an array (<=16)');
      }
      var sanitized = [];
      for (var i = 0; i < list.length; i += 1) {
        var normalized;
        try {
          normalized = configLib.normalizeProviderConfig(list[i]);
        } catch (e) {
          throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'provider config invalid: ' + e.message, { index: i });
        }
        var refId = 'provider:' + normalized.config.id;
        var previous = providers.get(normalized.config.id);
        var endpointChanged = !!previous
          && endpointIdentity(previous.config) !== endpointIdentity(normalized.config);
        providers.set(normalized.config.id, { config: normalized.config });
        if (normalized.apiKey) {
          // 新 key 总是优先
          vault.set(refId, normalized.apiKey);
        } else if (list[i].apiKey === null) {
          vault.delete(refId);
        } else if (endpointChanged) {
          // AI-01：凭据绑定 endpoint —— 改了 baseURL/protocol/path 却未重输 key，
          // 旧 key 不得随新地址出网，直接清除（请求将不带鉴权头，由服务端拒绝）
          vault.delete(refId);
        }
        // 其余情况：保留已存凭据（本轮会话内存中），允许只改 model/label/limits 等非敏感设置
        sanitized.push(sanitizeWithCredential(normalized.config));
      }
      return sanitized;
    },

    removeProvider: function (providerId) {
      providers.delete(providerId);
      vault.delete('provider:' + providerId);
      rateState.delete(providerId);
    },

    listProviders: function () {
      var out = [];
      providers.forEach(function (entry) {
        out.push(sanitizeWithCredential(entry.config));
      });
      return out;
    },

    bindSession: function (projectSessionId, ownerWindowId) {
      if (typeof projectSessionId !== 'string' || projectSessionId.length === 0 || projectSessionId.length > 128) {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'projectSessionId invalid');
      }
      if (ownerWindowId !== undefined && typeof ownerWindowId !== 'number') {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'ownerWindowId invalid');
      }
      var s = sessions.get(projectSessionId);
      if (!s) {
        s = { epoch: 1, ownerWindowId: typeof ownerWindowId === 'number' ? ownerWindowId : null, lastActiveAt: now() };
        sessions.set(projectSessionId, s);
      } else if (typeof ownerWindowId === 'number') {
        requireSessionOwner(s, ownerWindowId);
      }
      return { projectSessionId: projectSessionId, epoch: s.epoch };
    },

    /** epoch 前进：取消旧 epoch 在途请求；旧 epoch 的新请求一律 SESSION_EXPIRED。 */
    advanceEpoch: function (projectSessionId, actorWindowId) {
      var s = getSession(projectSessionId);
      if (actorWindowId !== undefined) {
        requireSessionOwner(s, actorWindowId);
      }
      s.epoch += 1;
      s.lastActiveAt = now();
      requests.forEach(function (record) {
        if (record.projectSessionId === projectSessionId && record.epoch < s.epoch) {
          cancelRecord(record, 'epoch');
        }
      });
      return { projectSessionId: projectSessionId, epoch: s.epoch };
    },

    endSession: function (projectSessionId, actorWindowId) {
      var s = sessions.get(projectSessionId);
      if (!s) {
        return;
      }
      if (actorWindowId !== undefined) {
        requireSessionOwner(s, actorWindowId);
      }
      requests.forEach(function (record) {
        if (record.projectSessionId === projectSessionId) {
          cancelRecord(record, 'session-end');
        }
      });
      sessions.delete(projectSessionId);
    },

    attachWindow: function (webContents) {
      if (!webContents || typeof webContents.id !== 'number') {
        throw AiHostError(ERROR_CODES.INVALID_REQUEST, 'webContents invalid');
      }
      var self = this;
      windows.set(webContents.id, { webContents: webContents });
      var onGone = function () { self.detachWindow(webContents.id); };
      if (typeof webContents.once === 'function') {
        webContents.once('destroyed', onGone);
      }
      return webContents.id;
    },

    detachWindow: function (windowId) {
      windows.delete(windowId);
      requests.forEach(function (record) {
        if (record.windowId === windowId) {
          cancelRecord(record, 'window-closed');
        }
      });
      // 该窗口拥有的会话一并结束（窗口已销毁，归属不再有意义）
      var ownedSessions = [];
      sessions.forEach(function (s, id) {
        if (s.ownerWindowId === windowId) { ownedSessions.push(id); }
      });
      ownedSessions.forEach(function (id) {
        requests.forEach(function (record) {
          if (record.projectSessionId === id) {
            cancelRecord(record, 'session-end');
          }
        });
        sessions.delete(id);
      });
    },

    isWindowAllowed: function (windowId) {
      return windows.has(windowId);
    },

    cancel: function (requestId, reason, fromWindowId) {
      var record = requests.get(requestId);
      if (!record) {
        throw AiHostError(ERROR_CODES.NOT_FOUND, 'request not found', { requestId: requestId });
      }
      if (typeof fromWindowId === 'number'
        && typeof record.windowId === 'number'
        && fromWindowId !== record.windowId) {
        throw AiHostError(ERROR_CODES.WINDOW_NOT_ALLOWED, 'request owned by another window');
      }
      cancelRecord(record, reason || 'user');
      return { requestId: requestId, cancelled: true };
    },

    cancelAll: function (reason) {
      var ids = [];
      requests.forEach(function (record, id) { ids.push(id); });
      ids.forEach(function (id) {
        var record = requests.get(id);
        if (record) { cancelRecord(record, reason || 'shutdown'); }
      });
      return ids.length;
    },

    getStatus: function () {
      return {
        providers: broker.listProviders(),
        inFlight: requests.size,
        sessions: Array.from(sessions.keys()).map(function (id) {
          return { projectSessionId: id, epoch: sessions.get(id).epoch };
        }),
        credentialVault: { persistent: vault.supportsPersistence(), entries: vault.size() },
        stats: { total: stats.total, completed: stats.completed, failed: stats.failed, cancelled: stats.cancelled }
      };
    },

    /** 供测试与诊断：请求注册表大小（不含内容）。 */
    _debugState: function () {
      return { requests: requests.size, windows: windows.size };
    },

    _randomId: randomId
  };

  return broker;
}

module.exports = {
  createAiHostBroker: createAiHostBroker,
  ERROR_CODES: ERROR_CODES
};
