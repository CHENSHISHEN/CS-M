'use strict';
/**
 * Provider 服务配置：归一化、校验与脱敏。
 *
 * 设计要点（ARCHITECTURE.md §11）：
 * - 配置 {id,label,protocol,baseURL,model,credentialRef,capabilities,limits}；
 *   capability 由用户显式声明，默认不声称 tools/json —— “compatible”名称不等于能力。
 * - 非敏感部分可由集成层持久化到用户配置；credentialRef 只是引用，
 *   凭据本体只进 vault，永不进入项目文件 / localStorage / 日志。
 * - 远程 endpoint 常规要求 HTTPS；http 仅允许 loopback（127.0.0.1/localhost/::1），
 *   除非 allowInsecureHttp 显式为 true（UI 需呈现风险）。
 */

var providersRegistry = require('./providers');

var PROTOCOLS = {
  'openai-chat': true,
  'anthropic-messages': true
};

// 凭据只允许经 apiKey→vault 通道；以下头名携带凭据，禁止经 extraHeaders 绕过
var FORBIDDEN_HEADER_RE = /^(authorization|x-api-key|cookie|set-cookie|proxy-authorization|proxy-authenticate)$/i;

var DEFAULT_LIMITS = {
  timeoutMs: 120000,      // 单请求总超时
  idleTimeoutMs: 30000,   // 流式无数据超时
  maxOutputChars: 200000, // 单请求输出上限（字符）
  maxConcurrent: 2,       // 同一 provider 并发上限
  requestsPerMinute: 30   // 同一 provider 每分钟请求上限
};

function isLoopbackHost(hostname) {
  var h = String(hostname || '').toLowerCase();
  if (h.charAt(0) === '[' && h.charAt(h.length - 1) === ']') {
    h = h.slice(1, -1); // 防御：个别调用方传入带方括号的 IPv6 字面量
  }
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function parseBaseURL(raw) {
  var u;
  try {
    u = new URL(raw);
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return null;
  }
  // userinfo（user:pass@host）与 query（?api_key=...）都可能携带凭据，一律拒绝
  if (u.username || u.password) {
    return null;
  }
  if (u.search) {
    return null;
  }
  return u;
}

/**
 * 归一化单个 provider 配置。返回 {config, apiKey}：
 * config 为可持久化/可回显的安全部分；apiKey 仅出现于入参（交给 vault），不在 config 中。
 */
function normalizeProviderConfig(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('provider config must be an object');
  }
  var id = input.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(id)) {
    throw new Error('provider id invalid');
  }
  var protocol = input.protocol;
  if (!PROTOCOLS[protocol]) {
    throw new Error('provider protocol unsupported: ' + protocol);
  }
  var baseURL = parseBaseURL(input.baseURL);
  if (!baseURL) {
    throw new Error('provider baseURL invalid');
  }
  if (baseURL.protocol === 'http:' && !isLoopbackHost(baseURL.hostname) && input.allowInsecureHttp !== true) {
    throw new Error('non-loopback http endpoint requires explicit allowInsecureHttp');
  }
  var explicitPath = typeof input.path === 'string' && input.path.length > 1 && input.path.charAt(0) === '/' && input.path.length <= 256
    ? input.path : null;
  if (!explicitPath) {
    // HOST-R1：baseURL 指向另一协议的原生 endpoint（含网关前缀/末尾斜杠变体）时明确拒绝，
    // 不悄悄拼出错误路径；确需该地址时用显式 path 做 origin-relative 完整覆盖。
    var basePath = baseURL.pathname.replace(/\/+$/, '');
    var knownProtocols = providersRegistry.protocols;
    for (var pi = 0; pi < knownProtocols.length; pi += 1) {
      var otherProtocol = knownProtocols[pi];
      if (otherProtocol === protocol) { continue; }
      var otherPath = providersRegistry.getAdapter(otherProtocol).defaultPath;
      if (basePath === otherPath || basePath.endsWith(otherPath)) {
        throw new Error('baseURL path "' + basePath + '" is the native endpoint of protocol "' + otherProtocol + '" (' + otherPath + '); configure that protocol or set "path" explicitly');
      }
    }
  }
  var model = input.model;
  if (typeof model !== 'string' || model.length === 0 || model.length > 200) {
    throw new Error('provider model invalid');
  }
  var capsInput = input.capabilities || {};
  var capabilities = {
    stream: capsInput.stream !== false,
    tools: capsInput.tools === true,
    jsonMode: capsInput.jsonMode === true
  };
  var limitsInput = input.limits || {};
  var limits = {};
  Object.keys(DEFAULT_LIMITS).forEach(function (key) {
    var v = limitsInput[key];
    if (typeof v === 'number' && isFinite(v) && v > 0) {
      limits[key] = Math.floor(v);
    } else {
      limits[key] = DEFAULT_LIMITS[key];
    }
  });
  var extraHeaders = {};
  if (input.extraHeaders && typeof input.extraHeaders === 'object') {
    Object.keys(input.extraHeaders).forEach(function (name) {
      var value = input.extraHeaders[name];
      if (FORBIDDEN_HEADER_RE.test(name)) {
        throw new Error('credential headers are not allowed in extraHeaders: ' + name);
      }
      if (typeof name === 'string' && typeof value === 'string' && name.length > 0 && name.length <= 64 && value.length <= 512) {
        extraHeaders[name] = value;
      }
    });
  }
  var config = {
    id: id,
    label: typeof input.label === 'string' && input.label.length > 0 && input.label.length <= 64 ? input.label : id,
    protocol: protocol,
    baseURL: String(baseURL),
    model: model,
    allowInsecureHttp: input.allowInsecureHttp === true,
    capabilities: capabilities,
    limits: limits,
    extraHeaders: extraHeaders,
    path: explicitPath
  };
  if (input.requestPath) {
    delete config.requestPath;
  }
  var apiKey = typeof input.apiKey === 'string' && input.apiKey.length > 0 && input.apiKey.length <= 4096
    ? input.apiKey : null;
  return { config: config, apiKey: apiKey };
}

/** 回显/状态用：确保没有 apiKey、没有凭据本体。 */
function sanitizeProviderConfig(config) {
  var out = {};
  Object.keys(config).forEach(function (key) {
    out[key] = config[key];
  });
  delete out.apiKey;
  return out;
}

module.exports = {
  DEFAULT_LIMITS: DEFAULT_LIMITS,
  normalizeProviderConfig: normalizeProviderConfig,
  sanitizeProviderConfig: sanitizeProviderConfig,
  isLoopbackHost: isLoopbackHost
};
