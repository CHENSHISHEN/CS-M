#!/usr/bin/env node
'use strict';
/**
 * HOST 契约测试（PLATFORM-AI-IMPL-001）
 *
 * 运行：node doc/developer/platform-ai-v1/implementation/host-test.cjs
 *
 * 约束：
 * - 只使用本测试进程内启动的 127.0.0.1 假 HTTP 服务器，不访问任何真实模型服务；
 * - 不打印 API key / 请求头；所有断言消息经 safeJson 清洗；
 * - 全程捕获 broker 对外输出（事件/错误/状态），结束时统一扫描密钥不泄漏。
 */

const http = require('http');
const aiHost = require('../src/host/ai');

// --- 合成密钥（仅测试进程内存中，永不打印原文） ---
const FK_OPENAI = 'sk-host-fixture-openai-0001';
const FK_ANTH = 'sk-ant-host-fixture-0002';

// --- 全局泄漏扫描 ---
const emittedCaptures = [];
function capture(obj) {
  try { emittedCaptures.push(JSON.stringify(obj)); } catch (e) { /* noop */ }
}
function safeJson(v) {
  return JSON.stringify(v, function (k, val) {
    if (typeof val === 'string') {
      return val.split(FK_OPENAI).join('[K1]').split(FK_ANTH).join('[K2]');
    }
    return val;
  });
}
function ok(cond, msg) { if (!cond) { throw new Error('assert failed: ' + msg); } }
function okEq(actual, expected, msg) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected);
  if (a !== b) { throw new Error('assert failed: ' + msg + ' expected=' + b + ' actual=' + safeJson(actual)); }
}

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log('PASS ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('FAIL ' + name + ' :: ' + e.message); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitUntil(cond, timeout, label) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > (timeout || 3000)) { throw new Error('waitUntil timeout: ' + (label || '')); }
    await sleep(15);
  }
}

// --- 假服务器（自动计数请求/捕获请求体与头，handler 收到 (req,res,server)） ---
const servers = [];
function startServer(handler) {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = {
      hits: 0,
      capturedBodies: [],
      capturedHeaders: [],
      capturedUrls: [],
      close: null
    };
    const srv = http.createServer(function (req, res) {
      server.hits += 1;
      server.capturedUrls.push(req.url);
      server.capturedHeaders.push(req.headers);
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        server.capturedBodies.push(Buffer.concat(chunks).toString('utf8'));
        handler(req, res, server);
      });
    });
    srv.on('connection', (s) => { s.setNoDelay(true); sockets.add(s); s.on('close', () => sockets.delete(s)); });
    server.close = () => new Promise((res) => {
      sockets.forEach((s) => s.destroy());
      if (typeof srv.closeAllConnections === 'function') {
        srv.closeAllConnections(); // 兜底清理 keep-alive 残留连接
      }
      srv.close(() => res());
    });
    servers.push(server);
    srv.listen(0, '127.0.0.1', () => { server.port = srv.address().port; resolve(server); });
  });
}
function readBody(server, i) {
  return JSON.parse(server.capturedBodies[i == null ? server.capturedBodies.length - 1 : i]);
}
function sse(res, obj) { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }
const SSE_HEADERS = { 'Content-Type': 'text/event-stream' };

// --- 事件收集 ---
function collector() {
  const events = [];
  return {
    events,
    fn: (envelope) => { capture(envelope); events.push(envelope); }
  };
}
function lastEventOfType(events, type) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].event && events[i].event.type === type) { return events[i].event; }
  }
  return null;
}

// --- provider 配置工厂 ---
function openaiConfig(port, overrides) {
  return Object.assign({
    id: 'fake-openai',
    protocol: 'openai-chat',
    baseURL: 'http://127.0.0.1:' + port,
    model: 'fixture-model',
    apiKey: FK_OPENAI,
    capabilities: { stream: true, tools: true, jsonMode: true },
    limits: { timeoutMs: 4000, idleTimeoutMs: 2000, maxOutputChars: 100000, maxConcurrent: 2, requestsPerMinute: 60 }
  }, overrides || {});
}
function anthropicConfig(port, overrides) {
  return Object.assign({
    id: 'fake-anthropic',
    protocol: 'anthropic-messages',
    baseURL: 'http://127.0.0.1:' + port,
    model: 'fixture-claude',
    apiKey: FK_ANTH,
    capabilities: { stream: true, tools: true, jsonMode: false },
    limits: { timeoutMs: 4000, idleTimeoutMs: 2000, maxOutputChars: 100000, maxConcurrent: 2, requestsPerMinute: 60 }
  }, overrides || {});
}

async function main() {
  // ============ T01 OpenAI 非流式文本 + 鉴权头格式 ============
  await test('T01 openai non-stream text', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '你好，模型答复' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      }));
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p1');
    const c = collector();
    const result = await broker.request({
      requestId: 'r1', projectSessionId: 'p1', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: '解释当前模型' }], stream: false
    }, c.fn);
    ok(result.text === '你好，模型答复', 'text');
    ok(result.finishReason === 'stop', 'finishReason');
    okEq(result.usage, { inputTokens: 10, outputTokens: 5 }, 'usage');
    ok(lastEventOfType(c.events, 'text-delta') !== null, 'text-delta emitted');
    const done = lastEventOfType(c.events, 'done');
    ok(done && done.result.text === '你好，模型答复', 'done terminal');
    const h = srv.capturedHeaders[0];
    ok(h.authorization === 'Bearer ' + FK_OPENAI, 'auth header format');
    ok(h['content-type'] === 'application/json', 'content-type');
    const body = readBody(srv, 0);
    ok(body.model === 'fixture-model', 'model passthrough');
    ok(body.stream === false, 'stream flag false');
    ok(body.messages.length === 1 && body.messages[0].role === 'user', 'message mapping');
  });

  // ============ T02 OpenAI 非流式 tool calls ============
  await test('T02 openai non-stream tool calls', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant', content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'model.table.create', arguments: '{"code":"t_order"}' } }]
          },
          finish_reason: 'tool_calls'
        }],
        usage: { prompt_tokens: 20, completion_tokens: 7 }
      }));
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p2');
    const c = collector();
    const result = await broker.request({
      requestId: 'r2', projectSessionId: 'p2', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: '建一张订单表' }], stream: false
    }, c.fn);
    ok(result.toolCalls.length === 1, 'one tool call');
    okEq(result.toolCalls[0], { id: 'call_1', name: 'model.table.create', args: { code: 't_order' } }, 'tool call normalized');
    ok(result.finishReason === 'tool_use', 'finishReason tool_use');
    ok(lastEventOfType(c.events, 'tool-call-end') !== null, 'tool-call-end emitted');
  });

  // ============ T03 OpenAI 流式文本：UTF-8 多字节跨 TCP 分片 ============
  await test('T03 openai stream text utf8 chunk boundary', async () => {
    const srv = await startServer((async (req, res) => {
      res.writeHead(200, SSE_HEADERS);
      sse(res, { choices: [{ delta: { content: '订单' } }] });
      await sleep(30);
      // 把含 4 字节 emoji 的行从字节中间断开
      const line = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '🎉正确' } }] });
      const buf = Buffer.from(line, 'utf8');
      const cutIdx = buf.indexOf(Buffer.from('🎉', 'utf8')) + 2; // emoji 第 2 字节处
      res.write(buf.slice(0, cutIdx));
      await sleep(40);
      res.write(buf.slice(cutIdx));
      res.write('\n\n');
      await sleep(20);
      sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n');
      res.end();
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p3');
    const c = collector();
    const result = await broker.request({
      requestId: 'r3', projectSessionId: 'p3', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'hi' }], stream: true
    }, c.fn);
    ok(result.text === '订单🎉正确', 'utf8 assembled text');
    ok(result.finishReason === 'stop', 'finishReason stop');
    const deltas = c.events.filter((e) => e.event.type === 'text-delta');
    ok(deltas.length >= 2, 'multiple text deltas');
  });

  // ============ T04 OpenAI 流式 tool calls 增量拼接 ============
  await test('T04 openai stream tool calls', async () => {
    const srv = await startServer((async (req, res) => {
      res.writeHead(200, SSE_HEADERS);
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'model.field.add', arguments: '' } }] } }] });
      await sleep(20);
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"table":' } }] } }] });
      await sleep(20);
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"t1","fields":[]}' } }] } }] });
      await sleep(20);
      sse(res, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      res.write('data: [DONE]\n\n');
      res.end();
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p4');
    const c = collector();
    const result = await broker.request({
      requestId: 'r4', projectSessionId: 'p4', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: '加字段' }], stream: true,
      tools: [{ name: 'model.field.add', description: 'add fields', parameters: { type: 'object' } }]
    }, c.fn);
    okEq(result.toolCalls, [{ id: 'call_9', name: 'model.field.add', args: { table: 't1', fields: [] } }], 'stream tool call assembled');
    ok(result.finishReason === 'tool_use', 'finishReason tool_use');
    ok(lastEventOfType(c.events, 'tool-call-start') !== null, 'tool-call-start');
    const reqBody = readBody(srv, 0);
    okEq(reqBody.tools, [{ type: 'function', function: { name: 'model.field.add', description: 'add fields', parameters: { type: 'object' } } }], 'tools wire format');
    ok(reqBody.tool_choice === 'auto', 'tool_choice auto');
  });

  // ============ T05 JSON mode 请求映射 ============
  await test('T05 openai json mode request mapping', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }] }));
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p5');
    const result = await broker.request({
      requestId: 'r5', projectSessionId: 'p5', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: '输出JSON' }], stream: false,
      jsonSchema: { name: 'demo_schema', schema: { type: 'object' } }
    }, function () {});
    ok(result.text === '{"ok":true}', 'json text');
    const body = readBody(srv, 0);
    okEq(body.response_format, { type: 'json_object' }, 'response_format mapped');
  });

  // ============ T06 Anthropic 非流式（消息/工具/头映射） ============
  await test('T06 anthropic non-stream', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        content: [
          { type: 'text', text: '答复' },
          { type: 'tool_use', id: 'toolu_1', name: 'drawing.chen.patch', input: { pageId: 'p' } }
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 9, output_tokens: 4 }
      }));
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([anthropicConfig(srv.port)]);
    broker.bindSession('p6');
    const c = collector();
    const result = await broker.request({
      requestId: 'r6', projectSessionId: 'p6', epoch: 1, providerId: 'fake-anthropic', kind: 'chat',
      messages: [
        { role: 'system', text: '你是建模助手' },
        { role: 'user', text: '画图' }
      ],
      stream: false, maxTokens: 64
    }, c.fn);
    ok(result.text === '答复', 'text');
    okEq(result.toolCalls, [{ id: 'toolu_1', name: 'drawing.chen.patch', args: { pageId: 'p' } }], 'tool_use normalized');
    ok(result.finishReason === 'tool_use', 'finishReason');
    const h = srv.capturedHeaders[0];
    ok(h['x-api-key'] === FK_ANTH, 'x-api-key header');
    ok(h['anthropic-version'] === '2023-06-01', 'anthropic-version header');
    ok(h.authorization === undefined, 'no bearer header for anthropic');
    const body = readBody(srv, 0);
    ok(body.system === '你是建模助手', 'system top-level');
    ok(body.max_tokens === 64, 'max_tokens mapped');
    okEq(body.messages, [{ role: 'user', content: [{ type: 'text', text: '画图' }] }], 'messages mapping');
  });

  // ============ T07 Anthropic 流式 ============
  await test('T07 anthropic stream', async () => {
    const srv = await startServer((async (req, res) => {
      res.writeHead(200, SSE_HEADERS);
      sse(res, { type: 'message_start', message: { usage: { input_tokens: 12 } } });
      await sleep(15);
      sse(res, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      sse(res, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '画一个' } });
      await sleep(15);
      sse(res, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '订单流程' } });
      sse(res, { type: 'content_block_stop', index: 0 });
      await sleep(15);
      sse(res, { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_2', name: 'drawing.chen.createPage' } });
      sse(res, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"entities":' } });
      await sleep(15);
      sse(res, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '["Customer"]}' } });
      sse(res, { type: 'content_block_stop', index: 1 });
      sse(res, { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 33 } });
      sse(res, { type: 'message_stop' });
      res.end();
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([anthropicConfig(srv.port)]);
    broker.bindSession('p7');
    const c = collector();
    const result = await broker.request({
      requestId: 'r7', projectSessionId: 'p7', epoch: 1, providerId: 'fake-anthropic', kind: 'chat',
      messages: [{ role: 'user', text: '画一个订单流程' }], stream: true
    }, c.fn);
    ok(result.text === '画一个订单流程', 'stream text');
    okEq(result.toolCalls, [{ id: 'toolu_2', name: 'drawing.chen.createPage', args: { entities: ['Customer'] } }], 'tool args assembled');
    okEq(result.usage, { inputTokens: 12, outputTokens: 33 }, 'usage');
    ok(result.finishReason === 'tool_use', 'finishReason');
  });

  // ============ T08 401 → AUTH_FAILED 且不泄漏 key ============
  await test('T08 401 auth failed', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p8');
    const c = collector();
    let err = null;
    await broker.request({
      requestId: 'r8', projectSessionId: 'p8', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false
    }, c.fn).catch((e) => { err = e; capture(e); });
    ok(err && err.code === 'AUTH_FAILED', 'AUTH_FAILED code');
    ok(err.message.indexOf(FK_OPENAI) === -1, 'no key in message');
    const term = lastEventOfType(c.events, 'error');
    ok(term && term.code === 'AUTH_FAILED', 'terminal error event');
  });

  // ============ T09 429 → RATE_LIMITED ============
  await test('T09 429 rate limited', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'rate limit' } }));
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p9');
    let err = null;
    await broker.request({
      requestId: 'r9', projectSessionId: 'p9', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false
    }, function () {}).catch((e) => { err = e; capture(e); });
    ok(err && err.code === 'RATE_LIMITED', 'RATE_LIMITED code');
  });

  // ============ T10 5xx → PROVIDER_ERROR ============
  await test('T10 500 provider error', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p10');
    let err = null;
    await broker.request({
      requestId: 'r10', projectSessionId: 'p10', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false
    }, function () {}).catch((e) => { err = e; capture(e); });
    ok(err && err.code === 'PROVIDER_ERROR', 'PROVIDER_ERROR code');
    ok(err.details && err.details.status === 500, 'status detail');
  });

  // ============ T11 半途断流 → STREAM_BROKEN ============
  await test('T11 premature close stream broken', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(200, SSE_HEADERS);
      res.write('data: {"choices":[{"delta":');
      setTimeout(() => { try { res.socket.destroy(); } catch (e) { /* noop */ } }, 30);
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p11');
    let err = null;
    await broker.request({
      requestId: 'r11', projectSessionId: 'p11', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, function () {}).catch((e) => { err = e; capture(e); });
    ok(err && err.code === 'STREAM_BROKEN', 'STREAM_BROKEN code, got: ' + (err && err.code));
  });

  // ============ T12 总超时 → PROVIDER_TIMEOUT ============
  await test('T12 total timeout', async () => {
    const srv = await startServer((() => { /* 永不响应 */ }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port, { limits: { timeoutMs: 150, idleTimeoutMs: 5000, maxOutputChars: 100000, maxConcurrent: 2, requestsPerMinute: 60 } })]);
    broker.bindSession('p12');
    let err = null;
    await broker.request({
      requestId: 'r12', projectSessionId: 'p12', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, function () {}).catch((e) => { err = e; capture(e); });
    ok(err && err.code === 'PROVIDER_TIMEOUT', 'timeout code, got: ' + (err && err.code));
  });

  // ============ T13 流空闲超时 → PROVIDER_TIMEOUT ============
  await test('T13 idle timeout', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(200, SSE_HEADERS);
      sse(res, { choices: [{ delta: { content: '第一段' } }] });
      /* 之后沉默 */
 }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port, { limits: { timeoutMs: 5000, idleTimeoutMs: 150, maxOutputChars: 100000, maxConcurrent: 2, requestsPerMinute: 60 } })]);
    broker.bindSession('p13');
    let err = null;
    await broker.request({
      requestId: 'r13', projectSessionId: 'p13', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, function () {}).catch((e) => { err = e; capture(e); });
    ok(err && err.code === 'PROVIDER_TIMEOUT', 'idle timeout code, got: ' + (err && err.code));
  });

  // ============ T14 取消 + 迟到 chunk 拒收 ============
  await test('T14 cancel rejects late chunks', async () => {
    const srv = await startServer((async (req, res) => {
      res.writeHead(200, SSE_HEADERS);
      sse(res, { choices: [{ delta: { content: '第一段' } }] });
      await sleep(250); // 客户端已在此期间取消
      sse(res, { choices: [{ delta: { content: '迟到段' } }] });
      await sleep(50);
      res.write('data: [DONE]\n\n');
      try { res.end(); } catch (e) { /* noop */ }
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p14');
    const c = collector();
    let err = null;
    const p = broker.request({
      requestId: 'r14', projectSessionId: 'p14', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, c.fn).catch((e2) => { err = e2; });
    await waitUntil(() => c.events.some((e) => e.event.type === 'text-delta'), 2000, 'first delta');
    const cancelResult = broker.cancel('r14');
    ok(cancelResult.cancelled === true, 'cancel ack');
    await p;
    ok(err && err.code === 'CANCELLED', 'promise rejects CANCELLED, got: ' + (err && err.code));
    const termIdx = c.events.findIndex((e) => e.event.type === 'cancelled');
    ok(termIdx !== -1, 'cancelled terminal event');
    ok(c.events.slice(termIdx + 1).length === 0, 'no events after terminal');
    ok(!c.events.some((e) => e.event.type === 'done'), 'no done after cancel');
    ok(!c.events.some((e) => e.event.type === 'text-delta' && e.event.text === '迟到段'), 'late chunk dropped');
  });

  // ============ T15 epoch 过期：在途取消 + 旧 epoch 拒绝 ============
  await test('T15 epoch expiry', async () => {
    const srv = await startServer((async (req, res) => {
      res.writeHead(200, SSE_HEADERS);
      sse(res, { choices: [{ delta: { content: 'a' } }] });
      await sleep(80); sse(res, { choices: [{ delta: { content: 'b' } }] });
      await sleep(80); sse(res, { choices: [{ delta: { content: 'c' } }] });
      await sleep(80); sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n'); res.end();
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p15');
    const c = collector();
    const p = broker.request({
      requestId: 'r15a', projectSessionId: 'p15', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, c.fn).catch(() => {});
    await waitUntil(() => c.events.some((e) => e.event.type === 'text-delta'), 2000, 'first delta');
    const advanced = broker.advanceEpoch('p15');
    ok(advanced.epoch === 2, 'epoch advanced');
    await p;
    const term = c.events.find((e) => e.event.type === 'cancelled');
    ok(term && term.event.reason === 'epoch', 'in-flight cancelled by epoch');
    const hitsBefore = srv.hits;
    let err = null;
    await broker.request({
      requestId: 'r15b', projectSessionId: 'p15', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false
    }, function () {}).catch((e) => { err = e; capture(e); });
    ok(err && err.code === 'SESSION_EXPIRED', 'stale epoch rejected');
    ok(srv.hits === hitsBefore, 'stale epoch never hit network');
    // 新 epoch 正常
    const result = await broker.request({
      requestId: 'r15c', projectSessionId: 'p15', epoch: 2, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, function () {});
    ok(result.finishReason === 'stop', 'new epoch works');
  });

  // ============ T16 输出上限 → OUTPUT_LIMIT_EXCEEDED ============
  await test('T16 output limit', async () => {
    const srv = await startServer((async (req, res) => {
      res.writeHead(200, SSE_HEADERS);
      sse(res, { choices: [{ delta: { content: '1234567890' } }] });
      await sleep(60);
      sse(res, { choices: [{ delta: { content: 'abcdefghij' } }] });
      await sleep(60);
      sse(res, { choices: [{ delta: { content: 'ABCDEFGHIJ' } }] });
      await sleep(60);
      res.write('data: [DONE]\n\n'); try { res.end(); } catch (e) { /* noop */ }
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port, { limits: { timeoutMs: 4000, idleTimeoutMs: 2000, maxOutputChars: 12, maxConcurrent: 2, requestsPerMinute: 60 } })]);
    broker.bindSession('p16');
    const c = collector();
    let err = null;
    await broker.request({
      requestId: 'r16', projectSessionId: 'p16', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, c.fn).catch((e) => { err = e; capture(e); });
    ok(err && err.code === 'OUTPUT_LIMIT_EXCEEDED', 'output limit code, got: ' + (err && err.code));
    const term = lastEventOfType(c.events, 'error');
    ok(term && term.code === 'OUTPUT_LIMIT_EXCEEDED', 'terminal error event');
    await sleep(250);
    const termIdx = c.events.findIndex((e) => e.event.type === 'error');
    ok(c.events.slice(termIdx + 1).length === 0, 'stream cut after limit');
  });

  // ============ T17 每分钟限流 ============
  await test('T17 rate limit per minute', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port, { limits: { timeoutMs: 4000, idleTimeoutMs: 2000, maxOutputChars: 100000, maxConcurrent: 2, requestsPerMinute: 1 } })]);
    broker.bindSession('p17');
    const r1 = await broker.request({
      requestId: 'r17a', projectSessionId: 'p17', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false
    }, function () {});
    ok(r1.text === 'ok', 'first ok');
    let err = null;
    await broker.request({
      requestId: 'r17b', projectSessionId: 'p17', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false
    }, function () {}).catch((e) => { err = e; capture(e); });
    ok(err && err.code === 'RATE_LIMITED' && err.details.kind === 'rate', 'rate kind');
  });

  // ============ T18 并发上限 + requestId 复用 ============
  await test('T18 concurrency limit and requestId reuse', async () => {
    const srv = await startServer((async (req, res) => {
      res.writeHead(200, SSE_HEADERS);
      sse(res, { choices: [{ delta: { content: 'a' } }] });
      await sleep(150); sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n'); res.end();
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port, { limits: { timeoutMs: 4000, idleTimeoutMs: 2000, maxOutputChars: 100000, maxConcurrent: 1, requestsPerMinute: 60 } })]);
    broker.bindSession('p18');
    const p1 = broker.request({
      requestId: 'r18a', projectSessionId: 'p18', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, function () {});
    await sleep(50);
    let errSameId = null;
    await broker.request({
      requestId: 'r18a', projectSessionId: 'p18', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, function () {}).catch((e) => { errSameId = e; });
    ok(errSameId && errSameId.code === 'INVALID_REQUEST', 'requestId reuse rejected');
    let errConc = null;
    await broker.request({
      requestId: 'r18b', projectSessionId: 'p18', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, function () {}).catch((e) => { errConc = e; capture(e); });
    ok(errConc && errConc.code === 'RATE_LIMITED' && errConc.details.kind === 'concurrency', 'concurrency kind');
    const r1 = await p1;
    ok(r1.finishReason === 'stop', 'first completes');
  });

  // ============ T19 能力未声明 → CAPABILITY_UNAVAILABLE ============
  await test('T19 undeclared tools capability', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port, { capabilities: { stream: false, tools: false, jsonMode: false } })]);
    broker.bindSession('p19');
    let errTools = null;
    await broker.request({
      requestId: 'r19a', projectSessionId: 'p19', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false,
      tools: [{ name: 'model.search', parameters: { type: 'object' } }]
    }, function () {}).catch((e) => { errTools = e; capture(e); });
    ok(errTools && errTools.code === 'CAPABILITY_UNAVAILABLE', 'tools undeclared');
    let errStream = null;
    await broker.request({
      requestId: 'r19b', projectSessionId: 'p19', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, function () {}).catch((e) => { errStream = e; capture(e); });
    ok(errStream && errStream.code === 'CAPABILITY_UNAVAILABLE', 'stream undeclared');
    ok(srv.hits === 0, 'no network for undeclared capability');
  });

  // ============ T20 配置安全：回显脱敏 / vault 无持久化 / 明文HTTP拒绝 ============
  await test('T20 config safety', async () => {
    const broker = aiHost.createAiHostBroker();
    const echo = broker.configureProviders([openaiConfig(1, { apiKey: FK_OPENAI })]);
    ok(echo[0].apiKey === undefined, 'no apiKey in echo');
    const status = broker.getStatus();
    capture(status);
    ok(status.providers[0].apiKey === undefined, 'no apiKey in status');
    ok(status.credentialVault.persistent === false, 'vault not persistent');
    ok(status.credentialVault.entries === 1, 'one credential in memory');
    const protoNames = Object.getOwnPropertyNames(aiHost.InMemoryCredentialVault.prototype);
    ['save', 'persist', 'write', 'writeFile', 'dump'].forEach((bad) => {
      ok(protoNames.indexOf(bad) === -1, 'vault has no persistence method: ' + bad);
    });
    let errInsecure = null;
    try {
      broker.configureProviders([openaiConfig(1, { id: 'remote-http', baseURL: 'http://api.example.com', apiKey: 'k' })]);
    } catch (e) { errInsecure = e; capture(e); }
    ok(errInsecure && errInsecure.code === 'INVALID_REQUEST', 'non-loopback http rejected');
    const okInsecure = broker.configureProviders([openaiConfig(1, { id: 'remote-http2', baseURL: 'http://api.example.com', allowInsecureHttp: true, apiKey: 'k' })]);
    ok(okInsecure.length === 1, 'explicit allowInsecureHttp accepted');
  });

  // ============ T21 重定向 → REDIRECT_BLOCKED ============
  await test('T21 redirect blocked', async () => {
    const srv = await startServer(((req, res) => {
      res.writeHead(301, { Location: 'http://127.0.0.1:1/next' });
      res.end();
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p21');
    let err = null;
    await broker.request({
      requestId: 'r21', projectSessionId: 'p21', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false
    }, function () {}).catch((e) => { err = e; capture(e); });
    ok(err && err.code === 'REDIRECT_BLOCKED', 'redirect blocked, got: ' + (err && err.code));
  });

  // ============ T22 IPC 桥：窄通道/窗口校验/未知字段/事件推送/取消/测试通道 ============
  await test('T22 ipc bridge', async () => {
    const srv = await startServer((async (req, res, server) => {
      const body = JSON.parse(server.capturedBodies[server.capturedBodies.length - 1]);
      if (body.stream) {
        res.writeHead(200, SSE_HEADERS);
        sse(res, { choices: [{ delta: { content: '段1' } }] });
        await sleep(120);
        sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
        res.write('data: [DONE]\n\n'); res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }] }));
      }
    }));
    const broker = aiHost.createAiHostBroker();
    const registered = new Map();
    const fakeIpcMain = {
      handle: (ch, fn) => registered.set(ch, fn),
      removeHandler: (ch) => registered.delete(ch)
    };
    const sentEvents = [];
    const sender = {
      id: 42,
      send: (ch, payload) => { if (ch === 'ai:event') { capture(payload); sentEvents.push(payload); } },
      isDestroyed: () => false,
      once: () => {}
    };
    const aiIpc = aiHost.registerAiHostIpc({ ipcMain: fakeIpcMain, broker });
    ok(registered.size === 8, '8 channels registered');
    aiIpc.attachWindow(sender);
    broker.configureProviders([openaiConfig(srv.port)]);
    // 未 attach 的窗口
    const rDeny = await registered.get('ai:getStatus')({ sender: { id: 999 } }, {});
    ok(rDeny.ok === false && rDeny.code === 'WINDOW_NOT_ALLOWED', 'unattached window denied');
    // 未知字段
    const rEvil = await registered.get('ai:request')({ sender }, {
      requestId: 'q1', projectSessionId: 'pp', epoch: 1, providerId: 'fake-openai',
      messages: [{ role: 'user', text: 'x' }], execFunction: 'require("fs")'
    });
    ok(rEvil.ok === false && rEvil.code === INVALID_REQUEST_CODE, 'unknown field rejected');
    // 正常流程：bind + request + 推送 + cancel
    const rBind = await registered.get('ai:session:bind')({ sender }, { projectSessionId: 'pp' });
    ok(rBind.ok === true && rBind.result.epoch === 1, 'session bound');
    const rReq = await registered.get('ai:request')({ sender }, {
      requestId: 'q1', projectSessionId: 'pp', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    });
    ok(rReq.ok === true && rReq.result.accepted === true && rReq.result.windowId === 42, 'accepted with window binding');
    await waitUntil(() => sentEvents.some((e) => e.event.type === 'text-delta'), 2000, 'ipc text delta');
    const rCancel = await registered.get('ai:cancel')({ sender }, { requestId: 'q1' });
    ok(rCancel.ok === true && rCancel.result.cancelled === true, 'ipc cancel');
    await waitUntil(() => sentEvents.some((e) => e.event.type === 'cancelled'), 2000, 'ipc cancelled event');
    // provider test 通道（仍指向假服务器，真实网络路径）
    const rTest = await registered.get('ai:provider:test')({ sender }, { providerId: 'fake-openai' });
    ok(rTest.ok === true && rTest.result.reachable === true, 'provider test ok');
    // dispose
    aiIpc.dispose();
    ok(registered.size === 0, 'channels removed on dispose');
    ok(broker._debugState().requests === 0, 'no in-flight left');
  });

  // ============ T23 getStatus 会话/统计真实 ============
  await test('T23 status truthfulness', async () => {
    const srv = await startServer((async (req, res) => {
      res.writeHead(200, SSE_HEADERS);
      sse(res, { choices: [{ delta: { content: 'a' } }] });
      await sleep(400);
      sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n'); res.end();
    }));
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port)]);
    broker.bindSession('p23');
    const p = broker.request({
      requestId: 'r23', projectSessionId: 'p23', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    }, function () {});
    await sleep(80);
    const mid = broker.getStatus();
    capture(mid);
    ok(mid.inFlight === 1, 'inFlight counted');
    await p;
    const end = broker.getStatus();
    ok(end.inFlight === 0, 'inFlight released');
    ok(end.stats.completed === 1, 'stats completed');
  });

  // ============ T25 IPv6 loopback（::1）完整请求路径 ============
  await test('T25 ipv6 loopback request', async () => {
    const srv = await new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'v6-ok' }, finish_reason: 'stop' }] }));
      });
      s.listen(0, '::1', () => resolve({ server: s, port: s.address().port }));
      s.on('error', reject);
    });
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port, { id: 'v6', baseURL: 'http://[::1]:' + srv.port })]);
    broker.bindSession('p25');
    const result = await broker.request({
      requestId: 'r25', projectSessionId: 'p25', epoch: 1, providerId: 'v6', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false
    }, function () {});
    ok(result.text === 'v6-ok', 'ipv6 loopback works');
    await new Promise((r) => { srv.server.close(r); });
  });

  // ============ T26 会话窗口归属：A 绑定的会话 B 不可 request/advance/end/cancel ============
  await test('T26 session window ownership', async () => {
    const srv = await startServer((async (req, res, server) => {
      const body = JSON.parse(server.capturedBodies[server.capturedBodies.length - 1]);
      if (body.stream) {
        res.writeHead(200, SSE_HEADERS);
        sse(res, { choices: [{ delta: { content: 'a' } }] });
        await sleep(200);
        sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
        res.write('data: [DONE]\n\n'); res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
      }
    }));
    const broker = aiHost.createAiHostBroker();
    const registered = new Map();
    const fakeIpcMain = { handle: (ch, fn) => registered.set(ch, fn), removeHandler: (ch) => registered.delete(ch) };
    const eventsA = []; const eventsB = [];
    const senderA = { id: 11, send: (ch, p) => { if (ch === 'ai:event') { capture(p); eventsA.push(p); } }, isDestroyed: () => false, once: () => {} };
    const senderB = { id: 22, send: (ch, p) => { if (ch === 'ai:event') { capture(p); eventsB.push(p); } }, isDestroyed: () => false, once: () => {} };
    const aiIpc = aiHost.registerAiHostIpc({ ipcMain: fakeIpcMain, broker });
    aiIpc.attachWindow(senderA);
    aiIpc.attachWindow(senderB);
    broker.configureProviders([openaiConfig(srv.port)]);
    // A 绑定会话
    const rBind = await registered.get('ai:session:bind')({ sender: senderA }, { projectSessionId: 'proj' });
    ok(rBind.ok === true && rBind.result.epoch === 1, 'A binds session');
    // B 不能重绑/推进/结束 A 的会话
    const rBindB = await registered.get('ai:session:bind')({ sender: senderB }, { projectSessionId: 'proj' });
    ok(rBindB.ok === false && rBindB.code === 'WINDOW_NOT_ALLOWED', 'B rebind denied');
    const rEpochB = await registered.get('ai:session:epoch')({ sender: senderB }, { projectSessionId: 'proj' });
    ok(rEpochB.ok === false && rEpochB.code === 'WINDOW_NOT_ALLOWED', 'B epoch denied');
    const rEndB = await registered.get('ai:session:end')({ sender: senderB }, { projectSessionId: 'proj' });
    ok(rEndB.ok === false && rEndB.code === 'WINDOW_NOT_ALLOWED', 'B end denied');
    // B 不能用 A 的会话发请求（且不出网）
    const hitsBefore = srv.hits;
    const rReqB = await registered.get('ai:request')({ sender: senderB }, {
      requestId: 'qb1', projectSessionId: 'proj', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false
    });
    ok(rReqB.ok === false && rReqB.code === 'WINDOW_NOT_ALLOWED', 'B request denied');
    ok(srv.hits === hitsBefore, 'B denied request never hit network');
    ok(eventsB.length === 0, 'no events pushed to B for denied request');
    // A 正常请求，B 不能取消 A 的请求
    const rReqA = await registered.get('ai:request')({ sender: senderA }, {
      requestId: 'qa1', projectSessionId: 'proj', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    });
    ok(rReqA.ok === true, 'A request accepted');
    const rCancelB = await registered.get('ai:cancel')({ sender: senderB }, { requestId: 'qa1' });
    ok(rCancelB.ok === false && rCancelB.code === 'WINDOW_NOT_ALLOWED', 'B cancel denied');
    const rCancelA = await registered.get('ai:cancel')({ sender: senderA }, { requestId: 'qa1' });
    ok(rCancelA.ok === true && rCancelA.result.cancelled === true, 'A cancel ok');
    await waitUntil(() => eventsA.some((e) => e.event.type === 'cancelled'), 1500, 'A cancelled event');
    aiIpc.dispose();
  });

  // ============ T27 provider:test 满额拒绝不泄漏并发计数 ============
  await test('T27 window in-flight full: test call leaks no slot', async () => {
    const srv = await startServer((async (req, res, server) => {
      const body = JSON.parse(server.capturedBodies[server.capturedBodies.length - 1]);
      if (body.stream) {
        res.writeHead(200, SSE_HEADERS);
        sse(res, { choices: [{ delta: { content: 'a' } }] });
        await sleep(150);
        sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
        res.write('data: [DONE]\n\n'); res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }] }));
      }
    }));
    const broker = aiHost.createAiHostBroker();
    const registered = new Map();
    const fakeIpcMain = { handle: (ch, fn) => registered.set(ch, fn), removeHandler: (ch) => registered.delete(ch) };
    const events = [];
    const sender = { id: 33, send: (ch, p) => { if (ch === 'ai:event') { capture(p); events.push(p); } }, isDestroyed: () => false, once: () => {} };
    const aiIpc = aiHost.registerAiHostIpc({ ipcMain: fakeIpcMain, broker });
    aiIpc.attachWindow(sender);
    broker.configureProviders([openaiConfig(srv.port, { limits: { timeoutMs: 4000, idleTimeoutMs: 2000, maxOutputChars: 100000, maxConcurrent: 8, requestsPerMinute: 60 } })]);
    const rBind = await registered.get('ai:session:bind')({ sender }, { projectSessionId: 'p27' });
    ok(rBind.ok === true, 'bind p27');
    // 占满单窗口 4 个在途
    for (let i = 0; i < 4; i += 1) {
      const r = await registered.get('ai:request')({ sender }, {
        requestId: 'q27-' + i, projectSessionId: 'p27', epoch: 1, providerId: 'fake-openai', kind: 'chat',
        messages: [{ role: 'user', text: 'x' }], stream: true
      });
      ok(r.ok === true, 'request ' + i + ' accepted');
    }
    const rTestFull = await registered.get('ai:provider:test')({ sender }, { providerId: 'fake-openai' });
    ok(rTestFull.ok === false && rTestFull.code === 'RATE_LIMITED', 'provider:test rejected when window full');
    const rReqFull = await registered.get('ai:request')({ sender }, {
      requestId: 'q27-x', projectSessionId: 'p27', epoch: 1, providerId: 'fake-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: true
    });
    ok(rReqFull.ok === false && rReqFull.code === 'RATE_LIMITED', '5th request rejected when window full');
    // 等满额的 4 个完成（终态事件先于 ipc 计数释放的微任务，稍等计数归零）
    await waitUntil(() => {
      const term = events.filter((e) => ['done', 'error', 'cancelled'].indexOf(e.event.type) !== -1);
      return term.length >= 4;
    }, 5000, '4 in-flight settled');
    await sleep(100);
    // 满额期间的拒绝不得释放他人 slot：完成后计数应归零，provider:test 可用
    const rTestAfter = await registered.get('ai:provider:test')({ sender }, { providerId: 'fake-openai' });
    ok(rTestAfter.ok === true && rTestAfter.result.reachable === true, 'provider:test ok after drain');
    aiIpc.dispose();
  });

  // ============ T28 配置安全与 redact 有界 ============
  await test('T28 config credential bypass and redact bounds', async () => {
    const broker = aiHost.createAiHostBroker();
    // extraHeaders 携带凭据头 → 拒绝
    ['Authorization', 'x-api-key', 'Cookie', 'proxy-authorization'].forEach((badHeader) => {
      let err = null;
      try {
        broker.configureProviders([openaiConfig(1, { extraHeaders: { [badHeader]: 'secret-value' } })]);
      } catch (e) { err = e; }
      ok(err && err.code === 'INVALID_REQUEST', 'forbidden header rejected: ' + badHeader);
    });
    // baseURL userinfo / query 凭据 → 拒绝
    ['http://user:pass@127.0.0.1:1', 'http://127.0.0.1:1/?api_key=abc', 'http://127.0.0.1:1/?token=x'].forEach((badURL) => {
      let err = null;
      try {
        broker.configureProviders([openaiConfig(1, { id: 'bad-' + badURL.length, baseURL: badURL })]);
      } catch (e) { err = e; }
      ok(err && err.code === 'INVALID_REQUEST', 'credential-bearing baseURL rejected');
    });
    // redact 单轮有界：secret 为替换标记子串时不得死循环（本测试有全局超时兜底）
    const errors = require('../src/host/ai/errors');
    const out1 = errors.redactText('x REDACTED y', ['REDACTED']);
    ok(typeof out1 === 'string' && out1.length < 100, 'redact bounded for REDACTED');
    const out2 = errors.redactText('a[b]c', ['[']);
    ok(typeof out2 === 'string' && out2.length < 100, 'redact bounded for [');
    const out3 = errors.redactText('z [REDACTED] z', ['[REDACTED]']);
    ok(typeof out3 === 'string' && out3.length < 100, 'redact bounded for [REDACTED]');
  });

  // ============ T29 OpenAI 地址解析矩阵：严格断言 req.url，只对正确 path 给 200 ============
  await test('T29 openai url resolution strict path', async () => {
    const OPENAI_PATH = '/v1/chat/completions';
    const GW_PATH = '/ai-gw' + OPENAI_PATH;
    const valid = [OPENAI_PATH, GW_PATH];
    const srv = await startServer(((req, res) => {
      if (valid.indexOf(req.url) !== -1) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'unexpected request path' } }));
      }
    }));
    const broker = aiHost.createAiHostBroker();
    broker.bindSession('p29');
    const cases = [
      ['origin', 'http://127.0.0.1:' + srv.port, OPENAI_PATH],
      ['origin-trailing-slash', 'http://127.0.0.1:' + srv.port + '/', OPENAI_PATH],
      ['v1-base', 'http://127.0.0.1:' + srv.port + '/v1', OPENAI_PATH],
      ['v1-base-trailing-slash', 'http://127.0.0.1:' + srv.port + '/v1/', OPENAI_PATH],
      ['full-endpoint', 'http://127.0.0.1:' + srv.port + OPENAI_PATH, OPENAI_PATH],
      ['full-endpoint-trailing-slash', 'http://127.0.0.1:' + srv.port + OPENAI_PATH + '/', OPENAI_PATH],
      ['gateway-prefix', 'http://127.0.0.1:' + srv.port + '/ai-gw', GW_PATH],
      ['gateway-prefix-v1', 'http://127.0.0.1:' + srv.port + '/ai-gw/v1', GW_PATH]
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const name = cases[i][0];
      broker.configureProviders([openaiConfig(srv.port, { id: 'url-openai-' + i, baseURL: cases[i][1] })]);
      const result = await broker.request({
        requestId: 'r29-' + i, projectSessionId: 'p29', epoch: 1, providerId: 'url-openai-' + i, kind: 'chat',
        messages: [{ role: 'user', text: 'x' }], stream: false
      }, function () {});
      ok(result.text === 'ok', name + ' strict 200 (wrong path would 404)');
      ok(srv.capturedUrls[i] === cases[i][2], name + ' exact req.url, got=' + srv.capturedUrls[i]);
    }
  });

  // ============ T30 Anthropic 地址解析矩阵：严格断言 req.url ============
  await test('T30 anthropic url resolution strict path', async () => {
    const ANTH_PATH = '/v1/messages';
    const GW_PATH = '/corp-gw' + ANTH_PATH;
    const valid = [ANTH_PATH, GW_PATH];
    const srv = await startServer(((req, res) => {
      if (valid.indexOf(req.url) !== -1) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'unexpected request path' } }));
      }
    }));
    const broker = aiHost.createAiHostBroker();
    broker.bindSession('p30');
    const cases = [
      ['origin', 'http://127.0.0.1:' + srv.port, ANTH_PATH],
      ['origin-trailing-slash', 'http://127.0.0.1:' + srv.port + '/', ANTH_PATH],
      ['v1-base', 'http://127.0.0.1:' + srv.port + '/v1', ANTH_PATH],
      ['v1-base-trailing-slash', 'http://127.0.0.1:' + srv.port + '/v1/', ANTH_PATH],
      ['full-endpoint', 'http://127.0.0.1:' + srv.port + ANTH_PATH, ANTH_PATH],
      ['full-endpoint-trailing-slash', 'http://127.0.0.1:' + srv.port + ANTH_PATH + '/', ANTH_PATH],
      ['gateway-prefix', 'http://127.0.0.1:' + srv.port + '/corp-gw', GW_PATH],
      ['gateway-prefix-v1', 'http://127.0.0.1:' + srv.port + '/corp-gw/v1', GW_PATH]
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const name = cases[i][0];
      broker.configureProviders([anthropicConfig(srv.port, { id: 'url-anth-' + i, baseURL: cases[i][1] })]);
      const result = await broker.request({
        requestId: 'r30-' + i, projectSessionId: 'p30', epoch: 1, providerId: 'url-anth-' + i, kind: 'chat',
        messages: [{ role: 'user', text: 'x' }], stream: false
      }, function () {});
      ok(result.text === 'ok', name + ' strict 200 (wrong path would 404)');
      ok(srv.capturedUrls[i] === cases[i][2], name + ' exact req.url, got=' + srv.capturedUrls[i]);
    }
  });

  // ============ T31 显式 config.path：origin-relative 完整覆盖 ============
  await test('T31 explicit path overrides base path', async () => {
    const srv = await startServer(((req, res) => {
      if (req.url === '/api/chat') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
      } else if (req.url === '/msg/api') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'unexpected request path' } }));
      }
    }));
    const broker = aiHost.createAiHostBroker();
    broker.bindSession('p31');
    // base 带 /v1：显式 path 完整覆盖（不是 base+path），保留 origin
    const echo1 = broker.configureProviders([openaiConfig(srv.port, {
      id: 'p31-openai', baseURL: 'http://127.0.0.1:' + srv.port + '/v1', path: '/api/chat'
    })]);
    ok(echo1[0].path === '/api/chat', 'echo keeps explicit path');
    const r1 = await broker.request({
      requestId: 'r31a', projectSessionId: 'p31', epoch: 1, providerId: 'p31-openai', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false
    }, function () {});
    ok(r1.text === 'ok', 'openai explicit path strict 200');
    ok(srv.capturedUrls[0] === '/api/chat', 'openai origin-relative override, got=' + srv.capturedUrls[0]);
    // 显式 path 时 base 允许是另一协议 endpoint（覆盖语义，不产生错误拼接）
    broker.configureProviders([anthropicConfig(srv.port, {
      id: 'p31-anth', baseURL: 'http://127.0.0.1:' + srv.port + '/v1/chat/completions', path: '/msg/api'
    })]);
    const r2 = await broker.request({
      requestId: 'r31b', projectSessionId: 'p31', epoch: 1, providerId: 'p31-anth', kind: 'chat',
      messages: [{ role: 'user', text: 'x' }], stream: false
    }, function () {});
    ok(r2.text === 'ok', 'anthropic explicit path strict 200');
    ok(srv.capturedUrls[1] === '/msg/api', 'anthropic origin-relative override, got=' + srv.capturedUrls[1]);
  });

  // ============ T32 协议错配：另一协议已知 endpoint 配置期明确拒绝 ============
  await test('T32 foreign protocol endpoint rejected at configure', async () => {
    const broker = aiHost.createAiHostBroker();
    const bad = [
      ['openai-vs-anthropic', openaiConfig(1, { id: 'mm1', baseURL: 'http://127.0.0.1:1/v1/messages' }), 'anthropic-messages'],
      ['openai-vs-anthropic-gw', openaiConfig(1, { id: 'mm2', baseURL: 'http://127.0.0.1:1/gw/v1/messages' }), 'anthropic-messages'],
      ['openai-vs-anthropic-slash', openaiConfig(1, { id: 'mm3', baseURL: 'http://127.0.0.1:1/v1/messages/' }), 'anthropic-messages'],
      ['anthropic-vs-openai', anthropicConfig(1, { id: 'mm4', baseURL: 'http://127.0.0.1:1/v1/chat/completions' }), 'openai-chat'],
      ['anthropic-vs-openai-gw-slash', anthropicConfig(1, { id: 'mm5', baseURL: 'http://127.0.0.1:1/gw/v1/chat/completions/' }), 'openai-chat']
    ];
    for (let i = 0; i < bad.length; i += 1) {
      let err = null;
      try {
        broker.configureProviders([bad[i][1]]);
      } catch (e) { err = e; capture(e); }
      ok(err && err.code === 'INVALID_REQUEST', bad[i][0] + ' rejected with INVALID_REQUEST');
      ok(err.message.indexOf(bad[i][2]) !== -1, bad[i][0] + ' message names foreign protocol');
    }
    // 同一 baseURL 配显式 path 则允许（覆盖语义，见 T31）
    const echo = broker.configureProviders([openaiConfig(1, {
      id: 'mm-ok', baseURL: 'http://127.0.0.1:1/v1/messages', path: '/custom/chat'
    })]);
    ok(echo.length === 1 && echo[0].path === '/custom/chat', 'explicit path allows otherwise-foreign base');
  });

  // ============ T33 AI-01 凭据绑定 endpoint：改 baseURL/protocol/path 未重输 key 即清除旧 key ============
  // 假服务器：无鉴权头回 401（模拟真实服务对缺 key 的反应），有则 200；记录收到的全部头供泄漏检查
  function authEchoHandler(req, res) {
    if (!req.headers.authorization && !req.headers['x-api-key']) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'missing credential' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.indexOf('/messages') !== -1) {
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    } else {
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
    }
  }
  function headersCarry(srv, secret) {
    return srv.capturedHeaders.some((h) => JSON.stringify(h).indexOf(secret) !== -1);
  }
  function lastHeaders(srv) { return srv.capturedHeaders[srv.capturedHeaders.length - 1]; }
  let t33seq = 0;
  async function ask(broker, providerId) {
    t33seq += 1;
    let err = null;
    let result = null;
    try {
      result = await broker.request({
        requestId: 'r33-' + t33seq, projectSessionId: 'p33', epoch: 1, providerId: providerId, kind: 'chat',
        messages: [{ role: 'user', text: 'x' }], stream: false
      }, function (env) { capture(env); });
    } catch (e) { err = e; capture(e); }
    return { err: err, result: result };
  }
  function credFlag(broker, id) {
    const p = broker.listProviders().filter((x) => x.id === id)[0];
    return p ? p.hasCredential : 'missing';
  }
  const FK_NEW = 'sk-host-fixture-rotated-0003';
  const T33_SECRETS = [FK_OPENAI, FK_ANTH, FK_NEW];

  await test('T33a model-only change keeps stored key (request still authenticated)', async () => {
    const srv = await startServer(authEchoHandler);
    const broker = aiHost.createAiHostBroker();
    broker.bindSession('p33');
    broker.configureProviders([openaiConfig(srv.port, { id: 'b33a' })]);
    const cfg = openaiConfig(srv.port, { id: 'b33a', model: 'fixture-model-2', label: 'renamed', limits: { timeoutMs: 3000, idleTimeoutMs: 2000, maxOutputChars: 50000, maxConcurrent: 1, requestsPerMinute: 30 } });
    delete cfg.apiKey;
    const echo = broker.configureProviders([cfg]);
    ok(broker.vault.has('provider:b33a'), 'key kept after model/label/limits change');
    ok(echo[0].hasCredential === true, 'echo reports hasCredential=true');
    ok(echo[0].apiKey === undefined, 'echo still has no apiKey');
    const r = await ask(broker, 'b33a');
    ok(!r.err && r.result.text === 'ok', 'request succeeds, err=' + (r.err && r.err.code));
    ok(lastHeaders(srv).authorization === 'Bearer ' + FK_OPENAI, 'kept key still sent');
    ok(readBody(srv).model === 'fixture-model-2', 'new model used');
  });

  await test('T33b baseURL change without key clears it; new endpoint never sees old key', async () => {
    const oldSrv = await startServer(authEchoHandler);
    const newSrv = await startServer(authEchoHandler);
    const broker = aiHost.createAiHostBroker();
    broker.bindSession('p33');
    broker.configureProviders([openaiConfig(oldSrv.port, { id: 'b33b' })]);
    ok(credFlag(broker, 'b33b') === true, 'initially hasCredential');
    const cfg = openaiConfig(newSrv.port, { id: 'b33b' });
    delete cfg.apiKey;
    const echo = broker.configureProviders([cfg]);
    ok(!broker.vault.has('provider:b33b'), 'old key deleted after baseURL change');
    ok(echo[0].hasCredential === false, 'echo reports hasCredential=false');
    ok(credFlag(broker, 'b33b') === false, 'listProviders reports hasCredential=false');
    ok(broker.getStatus().credentialVault.entries === 0, 'status vault entries = 0');
    const r = await ask(broker, 'b33b');
    // broker 对无 key 的 provider 不拦截（本地免鉴权服务合法），请求不带鉴权头 → 服务端 401 → AUTH_FAILED
    ok(r.err && r.err.code === 'AUTH_FAILED', 'request fails with AUTH_FAILED, got=' + (r.err && r.err.code));
    ok(newSrv.hits === 1, 'new endpoint reached once');
    ok(lastHeaders(newSrv).authorization === undefined && lastHeaders(newSrv)['x-api-key'] === undefined, 'no credential header to new endpoint');
    ok(!headersCarry(newSrv, FK_OPENAI), 'old key never seen by new endpoint');
    ok(oldSrv.hits === 0, 'old endpoint not contacted');
  });

  await test('T33c baseURL change with new key: new key sent, old key never seen', async () => {
    const oldSrv = await startServer(authEchoHandler);
    const newSrv = await startServer(authEchoHandler);
    const broker = aiHost.createAiHostBroker();
    broker.bindSession('p33');
    broker.configureProviders([openaiConfig(oldSrv.port, { id: 'b33c' })]);
    const echo = broker.configureProviders([openaiConfig(newSrv.port, { id: 'b33c', apiKey: FK_NEW })]);
    ok(echo[0].hasCredential === true, 'echo hasCredential with new key');
    ok(broker.vault.get('provider:b33c') === FK_NEW, 'vault holds the new key');
    const r = await ask(broker, 'b33c');
    ok(!r.err && r.result.text === 'ok', 'request ok, err=' + (r.err && r.err.code));
    ok(lastHeaders(newSrv).authorization === 'Bearer ' + FK_NEW, 'new key sent');
    ok(!headersCarry(newSrv, FK_OPENAI), 'old key never seen by new endpoint');
  });

  await test('T33d normalization-equal baseURL keeps key; real host change clears', async () => {
    const srv = await startServer(authEchoHandler);
    const broker = aiHost.createAiHostBroker();
    broker.bindSession('p33');
    const variants = [
      // [初始 baseURL, 变更后 baseURL, 期望保留 key?]
      ['http://127.0.0.1:' + srv.port, 'http://127.0.0.1:' + srv.port + '/', true],          // URL 解析补根斜杠
      ['http://127.0.0.1:' + srv.port + '/', 'HTTP://127.0.0.1:' + srv.port, true],          // scheme 大小写
      ['http://localhost:' + srv.port + '/v1', 'http://LOCALHOST:' + srv.port + '/v1/', true], // host 大小写 + 末尾斜杠（resolveRequestURL 同样剥除）
      ['http://127.0.0.1:' + srv.port + '/v1', 'http://127.0.0.1:' + srv.port + '/v1//', true],
      ['http://127.0.0.1:' + srv.port, 'http://localhost:' + srv.port, false],               // 不同 host 字面量：保守视为改 endpoint
      ['http://127.0.0.1:' + srv.port + '/v1', 'http://127.0.0.1:' + srv.port + '/gw/v1', false] // 路径前缀变化
    ];
    for (let i = 0; i < variants.length; i += 1) {
      const id = 'b33d-' + i;
      broker.configureProviders([openaiConfig(srv.port, { id: id, baseURL: variants[i][0] })]);
      const cfg = openaiConfig(srv.port, { id: id, baseURL: variants[i][1] });
      delete cfg.apiKey;
      const echo = broker.configureProviders([cfg]);
      ok(broker.vault.has('provider:' + id) === variants[i][2], 'variant #' + i + ' keep=' + variants[i][2]);
      ok(echo[0].hasCredential === variants[i][2], 'variant #' + i + ' echo flag');
    }
    // 保留 key 的归一化变体仍能带 key 出网
    const r = await ask(broker, 'b33d-0');
    ok(!r.err && lastHeaders(srv).authorization === 'Bearer ' + FK_OPENAI, 'normalized-equal endpoint still authenticated');
  });

  await test('T33e apiKey:null still deletes; empty-string key on endpoint change also clears', async () => {
    const srv = await startServer(authEchoHandler);
    const srv2 = await startServer(authEchoHandler);
    const broker = aiHost.createAiHostBroker();
    broker.configureProviders([openaiConfig(srv.port, { id: 'b33e' })]);
    const echo = broker.configureProviders([openaiConfig(srv.port, { id: 'b33e', apiKey: null })]);
    ok(!broker.vault.has('provider:b33e'), 'apiKey:null deletes (same endpoint)');
    ok(echo[0].hasCredential === false, 'echo flag false after null');
    broker.configureProviders([openaiConfig(srv.port, { id: 'b33e2' })]);
    broker.configureProviders([openaiConfig(srv2.port, { id: 'b33e2', apiKey: '' })]);
    ok(!broker.vault.has('provider:b33e2'), 'empty-string key + baseURL change clears');
    broker.configureProviders([openaiConfig(srv.port, { id: 'b33e3' })]);
    broker.configureProviders([openaiConfig(srv.port, { id: 'b33e3', apiKey: '' })]);
    ok(broker.vault.has('provider:b33e3'), 'empty-string key with unchanged endpoint keeps (pre-existing behaviour)');
    // removeProvider 后同 id 重新配置不带 key：不复活旧 key
    broker.removeProvider('b33e3');
    const cfg = openaiConfig(srv.port, { id: 'b33e3' });
    delete cfg.apiKey;
    const echo2 = broker.configureProviders([cfg]);
    ok(!broker.vault.has('provider:b33e3') && echo2[0].hasCredential === false, 'removeProvider leaves no stale key');
  });

  await test('T33f protocol or explicit path change clears key', async () => {
    const srv = await startServer(authEchoHandler);
    const broker = aiHost.createAiHostBroker();
    broker.bindSession('p33');
    // protocol：openai-chat → anthropic-messages（同 baseURL、同 id），旧 Bearer key 不得变成 x-api-key 发出
    broker.configureProviders([openaiConfig(srv.port, { id: 'b33f' })]);
    const anth = anthropicConfig(srv.port, { id: 'b33f' });
    delete anth.apiKey;
    const echo = broker.configureProviders([anth]);
    ok(!broker.vault.has('provider:b33f') && echo[0].hasCredential === false, 'protocol change clears');
    const before = srv.hits;
    const r = await ask(broker, 'b33f');
    ok(r.err && r.err.code === 'AUTH_FAILED', 'anthropic request unauthenticated, got=' + (r.err && r.err.code));
    ok(srv.hits === before + 1 && lastHeaders(srv)['x-api-key'] === undefined, 'no x-api-key sent');
    // path：新增显式 path
    broker.configureProviders([openaiConfig(srv.port, { id: 'b33g' })]);
    const withPath = openaiConfig(srv.port, { id: 'b33g', path: '/api/chat' });
    delete withPath.apiKey;
    broker.configureProviders([withPath]);
    ok(!broker.vault.has('provider:b33g'), 'adding explicit path clears');
    // path：修改显式 path
    broker.configureProviders([openaiConfig(srv.port, { id: 'b33h', path: '/api/chat' })]);
    const changedPath = openaiConfig(srv.port, { id: 'b33h', path: '/api/other' });
    delete changedPath.apiKey;
    broker.configureProviders([changedPath]);
    ok(!broker.vault.has('provider:b33h'), 'changing explicit path clears');
    // path 不变 + 只改 model：保留
    broker.configureProviders([openaiConfig(srv.port, { id: 'b33i', path: '/api/chat' })]);
    const samePath = openaiConfig(srv.port, { id: 'b33i', path: '/api/chat', model: 'm2' });
    delete samePath.apiKey;
    broker.configureProviders([samePath]);
    ok(broker.vault.has('provider:b33i'), 'unchanged explicit path keeps key');
    ok(T33_SECRETS.every((s) => !headersCarry(srv, s)), 'no secret ever reached the server in T33f');
  });

  // ============ 收尾：全局密钥泄漏扫描 ============
  await test('T24 no credential leak in any output', async () => {
    for (let i = 0; i < emittedCaptures.length; i += 1) {
      ok(emittedCaptures[i].indexOf(FK_OPENAI) === -1, 'openai key leaked at capture #' + i);
      ok(emittedCaptures[i].indexOf(FK_ANTH) === -1, 'anthropic key leaked at capture #' + i);
    }
    ok(emittedCaptures.length > 50, 'capture coverage sufficient');
  });

  // --- 清理 ---
  await Promise.all(servers.map((s) => s.close()));
  console.log('');
  console.log('========================================');
  console.log('passed: ' + passed + '  failed: ' + failures.length);
  if (failures.length) {
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  } else {
    console.log('ALL HOST CONTRACT TESTS PASSED');
  }
}

const INVALID_REQUEST_CODE = 'INVALID_REQUEST';

main().catch((e) => {
  console.error('fatal:', e && e.message);
  process.exitCode = 1;
});
