'use strict';
/**
 * AI Host 错误码与错误对象。
 * 错误码与 doc/developer/platform-ai-v1/COMMANDS.md 第 6 节保持一致；
 * Host 层新增网络/取消/上限相关码，见 host-api.md。
 * 任何错误消息不得包含 API key、请求头或服务端原文敏感字段。
 */

var ERROR_CODES = {
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  INVALID_REQUEST: 'INVALID_REQUEST',
  AUTH_FAILED: 'AUTH_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  STREAM_BROKEN: 'STREAM_BROKEN',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  OUTPUT_LIMIT_EXCEEDED: 'OUTPUT_LIMIT_EXCEEDED',
  CANCELLED: 'CANCELLED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  WINDOW_NOT_ALLOWED: 'WINDOW_NOT_ALLOWED',
  NOT_FOUND: 'NOT_FOUND',
  REDIRECT_BLOCKED: 'REDIRECT_BLOCKED',
  INSECURE_ENDPOINT: 'INSECURE_ENDPOINT'
};

function AiHostError(code, message, details) {
  var err = new Error(message || code);
  err.name = 'AiHostError';
  err.code = code;
  if (details) { err.details = details; }
  err.isAiHostError = true;
  return err;
}

function isAiHostError(err) {
  return !!(err && err.isAiHostError);
}

/**
 * 把敏感值从任意文本中抹掉。secret 永不为空字符串调用。
 * 每个 secret 只做一轮 split/join（有界）：即使 secret 是 [REDACTED] 的子串
 * （如 '['、'REDACTED'）也不会循环替换导致主进程卡死。
 */
function redactText(text, secrets) {
  var out = String(text == null ? '' : text);
  for (var i = 0; i < secrets.length; i += 1) {
    var s = secrets[i];
    if (s && typeof s === 'string' && s.length > 0 && out.indexOf(s) !== -1) {
      out = out.split(s).join('[REDACTED]');
    }
  }
  return out;
}

/** 生成短随机 id（requestId 未提供时兜底），不依赖 crypto.randomUUID。 */
var crypto = require('crypto');
function randomId(prefix) {
  return (prefix || 'id') + '_' + crypto.randomBytes(8).toString('hex');
}

module.exports = {
  ERROR_CODES: ERROR_CODES,
  AiHostError: AiHostError,
  isAiHostError: isAiHostError,
  redactText: redactText,
  randomId: randomId
};
