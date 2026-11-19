'use strict';
/**
 * 基于 Node 原生 http/https 的流式客户端（Electron 13 / Node 14 兼容）。
 * 不假定全局 fetch、AbortController 新语义或新 SDK。
 *
 * 职责：
 * - POST JSON，逐行接收响应（SSE 以 \n 分帧），按行解码 UTF-8；
 *   多字节字符跨 TCP 分片由“先找行边界字节 0x0A、后整行 decode”保证
 *   （UTF-8 续字节均 >= 0x80，不会与 0x0A 冲突）。
 * - 总超时 timeoutMs 与空闲超时 idleTimeoutMs（流式无数据即断）。
 * - 输出字节上限 maxOutputBytes，超限立即销毁连接并报 OUTPUT_LIMIT_EXCEEDED。
 * - 不跟随重定向：3xx 一律 REDIRECT_BLOCKED（防止鉴权头被携带跨域转发）。
 * - abort() 由调用方持有；中止是正常结果不是错误。
 */
var http = require('http');
var https = require('https');
var url = require('url');

// 显式禁用 keep-alive：每请求独立连接，避免 Node≥19 全局 Agent 的连接池
// 在流式/取消场景滞留 socket（也贴合 Electron13/Node14 的默认行为）。
var AGENT_HTTP = new http.Agent({ keepAlive: false, maxSockets: 64 });
var AGENT_HTTPS = new https.Agent({ keepAlive: false, maxSockets: 64 });

var _ref = require('./errors');
var AiHostError = _ref.AiHostError;
var ERROR_CODES = _ref.ERROR_CODES;
var redactText = _ref.redactText;

var LINE_SEP = 0x0A; // '\n'
var CR = 0x0D;       // '\r'
var ERROR_BODY_LIMIT = 4096;

/**
 * 发起流式 POST。
 * @param {object} options
 *   parsedURL: URL 对象（来自 config 解析结果）
 *   headers: 请求头对象（含鉴权，绝不进入日志/错误）
 *   body: string 请求体
 *   timeoutMs / idleTimeoutMs / maxOutputBytes
 *   onLine: function(line:string) 每个完整行（已去 \r）
 *   redactSecrets: string[] 出错兜底清洗用
 * @returns {{promise: Promise<{status:number, bytes:number, aborted:boolean}>, abort: function()}}
 */
function postJsonStream(options) {
  var parsedURL = options.parsedURL;
  var headers = options.headers;
  var bodyString = options.body;
  var timeoutMs = options.timeoutMs;
  var idleTimeoutMs = options.idleTimeoutMs;
  var maxOutputBytes = options.maxOutputBytes;
  var onLine = options.onLine || function () {};
  var redactSecrets = options.redactSecrets || [];

  var transport = parsedURL.protocol === 'https:' ? https : http;
  var settled = false;
  var aborted = false;
  var req = null;
  var totalTimer = null;
  var idleTimer = null;
  var bytesReceived = 0;
  var lineBuf = null; // Buffer 残片
  var settlers = null;

  function finish(resolveFn, rejectFn, value) {
    if (settled) { return; }
    settled = true;
    if (totalTimer) { clearTimeout(totalTimer); }
    if (idleTimer) { clearTimeout(idleTimer); }
    if (value instanceof Error) {
      rejectFn(value);
    } else {
      resolveFn(value);
    }
  }

  var promise = new Promise(function (resolve, reject) {
    settlers = { resolve: resolve, reject: reject };
    // URL.hostname 对 IPv6 字面量可能带 []（Node 版本行为差异）；http.request 需要裸地址
    var host = parsedURL.hostname;
    if (host && host.charAt(0) === '[' && host.charAt(host.length - 1) === ']') {
      host = host.slice(1, -1);
    }
    var reqOptions = {
      protocol: parsedURL.protocol,
      hostname: host,
      port: parsedURL.port || (parsedURL.protocol === 'https:' ? 443 : 80),
      path: parsedURL.pathname + (parsedURL.search || ''),
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString, 'utf8')
      }, headers)
    };

    req = transport.request(Object.assign({ agent: parsedURL.protocol === 'https:' ? AGENT_HTTPS : AGENT_HTTP }, reqOptions), function (res) {
      var status = res.statusCode || 0;
      var errorChunks = [];
      var errorBytes = 0;

      function failWith(code, message, details) {
        res.destroy();
        finish(resolve, reject, AiHostError(code, message, details));
      }

      if (status >= 300 && status < 400) {
        var loc = res.headers && res.headers.location ? String(res.headers.location) : '';
        res.resume();
        failWith(ERROR_CODES.REDIRECT_BLOCKED,
          'provider returned redirect; following redirects with credentials is not allowed',
          { status: status, locationPrefix: redactText(loc.slice(0, 64), redactSecrets) });
        return;
      }

      if (status < 200 || status >= 300) {
        res.on('data', function (chunk) {
          if (errorBytes < ERROR_BODY_LIMIT) {
            errorChunks.push(chunk);
            errorBytes += chunk.length;
          }
        });
        res.on('end', function () {
          var excerpt = redactText(Buffer.concat(errorChunks).toString('utf8').slice(0, 200), redactSecrets);
          var code;
          var message;
          if (status === 401 || status === 403) {
            code = ERROR_CODES.AUTH_FAILED;
            message = 'provider rejected credentials (HTTP ' + status + ')';
          } else if (status === 429) {
            code = ERROR_CODES.RATE_LIMITED;
            message = 'provider rate limited (HTTP 429)';
          } else {
            code = ERROR_CODES.PROVIDER_ERROR;
            message = 'provider error (HTTP ' + status + ')';
          }
          finish(resolve, reject, AiHostError(code, message, { status: status, bodyExcerpt: excerpt }));
        });
        res.on('error', function () {
          finish(resolve, reject, AiHostError(ERROR_CODES.PROVIDER_ERROR,
            'provider error response truncated', { status: status }));
        });
        return;
      }

      // 2xx：流式逐行
      res.on('data', function (chunk) {
        if (settled || aborted) { return; }
        if (idleTimer) { clearTimeout(idleTimer); }
        idleTimer = setTimeout(function () {
          failWith(ERROR_CODES.PROVIDER_TIMEOUT, 'stream idle timeout', { idleTimeoutMs: idleTimeoutMs });
        }, idleTimeoutMs);

        bytesReceived += chunk.length;
        if (bytesReceived > maxOutputBytes) {
          failWith(ERROR_CODES.OUTPUT_LIMIT_EXCEEDED, 'response exceeded output limit', {
            maxOutputBytes: maxOutputBytes
          });
          return;
        }
        var buf = lineBuf ? Buffer.concat([lineBuf, chunk]) : chunk;
        var start = 0;
        var sepIdx = buf.indexOf(LINE_SEP);
        while (sepIdx !== -1) {
          var lineEnd = sepIdx;
          if (lineEnd > start && buf[lineEnd - 1] === CR) {
            lineEnd -= 1;
          }
          var text = buf.toString('utf8', start, lineEnd);
          lineBuf = null;
          try {
            onLine(text);
          } catch (e) {
            failWith(ERROR_CODES.STREAM_BROKEN, 'response line processing failed');
            return;
          }
          start = sepIdx + 1;
          lineBuf = null;
          sepIdx = buf.indexOf(LINE_SEP, start);
        }
        if (start < buf.length) {
          lineBuf = buf.slice(start);
        } else {
          lineBuf = null;
        }
      });

      res.on('end', function () {
        if (settled || aborted) { return; }
        if (lineBuf && lineBuf.length > 0) {
          try {
            onLine(lineBuf.toString('utf8'));
          } catch (e) {
            failWith(ERROR_CODES.STREAM_BROKEN, 'response line processing failed');
            return;
          }
          lineBuf = null;
        }
        finish(resolve, reject, { status: status, bytes: bytesReceived, aborted: false });
      });

      res.on('error', function (err) {
        if (settled || aborted) { return; }
        finish(resolve, reject, AiHostError(ERROR_CODES.STREAM_BROKEN, 'response stream failed', {
          reasonCode: err && err.code ? String(err.code) : undefined
        }));
      });

      res.on('close', function () {
        if (settled || aborted) { return; }
        if (!res.complete) {
          finish(resolve, reject, AiHostError(ERROR_CODES.STREAM_BROKEN, 'response stream closed before completion'));
        }
      });
    });

    req.on('error', function (err) {
      if (settled) { return; }
      if (aborted) {
        finish(resolve, reject, { status: 0, bytes: bytesReceived, aborted: true });
        return;
      }
      var code = ERROR_CODES.STREAM_BROKEN;
      var message = 'request failed';
      if (err && (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ECONNRESET')) {
        message = 'network failure: ' + err.code;
      }
      finish(resolve, reject, AiHostError(code, message, { reasonCode: err && err.code ? String(err.code) : undefined }));
    });

    totalTimer = setTimeout(function () {
      if (settled) { return; }
      req.destroy();
      finish(resolve, reject, AiHostError(ERROR_CODES.PROVIDER_TIMEOUT, 'request total timeout', { timeoutMs: timeoutMs }));
    }, timeoutMs);

    idleTimer = setTimeout(function () {
      if (settled) { return; }
      req.destroy();
      finish(resolve, reject, AiHostError(ERROR_CODES.PROVIDER_TIMEOUT, 'request idle before response', { idleTimeoutMs: idleTimeoutMs }));
    }, idleTimeoutMs);

    req.write(bodyString);
    req.end();
  });

  return {
    promise: promise,
    abort: function () {
      if (settled || aborted) { return; }
      aborted = true;
      if (totalTimer) { clearTimeout(totalTimer); }
      if (idleTimer) { clearTimeout(idleTimer); }
      if (req) {
        try { req.destroy(); } catch (e) { /* noop */ }
      }
      // destroy 不保证触发 error 事件，这里确定性地以 aborted 结果落地
      if (settlers) {
        finish(settlers.resolve, settlers.reject, { status: 0, bytes: bytesReceived, aborted: true });
      }
    },
    isAborted: function () {
      return aborted;
    }
  };
}

module.exports = {
  postJsonStream: postJsonStream
};
