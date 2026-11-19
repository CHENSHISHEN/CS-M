'use strict';
/**
 * Anthropic messages 协议适配器。
 *
 * 归一化边界：
 * - system 消息映射为顶层 system；连续同角色消息合并（Anthropic 要求交替）。
 * - tool 结果映射为 user content 的 tool_use_result 块（tool_result）。
 * - max_tokens 为必填：默认 4096，请求可覆盖。
 * - 无原生 JSON mode；capabilities.jsonMode 默认 false，
 *   声明 true 时通过强制单工具 tool_choice 实现结构化输出（保守、显式）。
 * - 流事件 message_start / content_block_start / content_block_delta / content_block_stop /
 *   message_delta / message_stop / ping / error 归一化。
 */

var DEFAULT_PATH = '/v1/messages';
var ANTHROPIC_VERSION = '2023-06-01';
var DEFAULT_MAX_TOKENS = 4096;

function buildAnthropicMessages(normMessages) {
  var systemParts = [];
  var messages = [];
  for (var i = 0; i < normMessages.length; i += 1) {
    var m = normMessages[i];
    if (m.role === 'system') {
      if (m.text) { systemParts.push(m.text); }
      continue;
    }
    if (m.role === 'user') {
      messages.push({ role: 'user', content: [{ type: 'text', text: m.text || '' }] });
    } else if (m.role === 'assistant') {
      var blocks = [];
      if (m.text) { blocks.push({ type: 'text', text: m.text }); }
      if (m.toolCalls && m.toolCalls.length) {
        m.toolCalls.forEach(function (tc) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args || {} });
        });
      }
      if (blocks.length === 0) { blocks.push({ type: 'text', text: '' }); }
      messages.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.toolCallId,
          content: m.text || '',
          is_error: m.isError === true
        }]
      });
    } else {
      throw new Error('unsupported message role: ' + m.role);
    }
  }
  // 合并连续同角色消息，保证交替约束
  var merged = [];
  for (var k = 0; k < messages.length; k += 1) {
    var cur = messages[k];
    var prev = merged[merged.length - 1];
    if (prev && prev.role === cur.role) {
      prev.content = prev.content.concat(cur.content);
    } else {
      merged.push({ role: cur.role, content: cur.content.slice() });
    }
  }
  return { system: systemParts.join('\n\n'), messages: merged };
}

var anthropicAdapter = {
  protocol: 'anthropic-messages',
  defaultPath: DEFAULT_PATH,

  prepare: function (config, request, apiKey) {
    var built = buildAnthropicMessages(request.messages);
    var body = {
      model: config.model,
      max_tokens: (typeof request.maxTokens === 'number' && request.maxTokens > 0)
        ? Math.floor(request.maxTokens) : DEFAULT_MAX_TOKENS,
      messages: built.messages
    };
    if (built.system) {
      body.system = built.system;
    }
    if (request.temperature >= 0 && request.temperature <= 1) {
      body.temperature = request.temperature;
    }
    if (request.stream) {
      body.stream = true;
    }
    if (request.jsonSchema && config.capabilities.jsonMode) {
      // 显式声明的结构化输出：强制单工具
      body.tools = [{
        name: request.jsonSchema.name || 'emit_json',
        description: 'Respond with a JSON object matching the provided schema.',
        input_schema: request.jsonSchema.schema || { type: 'object' }
      }];
      body.tool_choice = { type: 'tool', name: request.jsonSchema.name || 'emit_json' };
    } else if (request.tools && request.tools.length) {
      body.tools = request.tools.map(function (t) {
        return {
          name: t.name,
          description: t.description || '',
          input_schema: t.parameters || { type: 'object' }
        };
      });
      body.tool_choice = { type: 'auto' };
    }
    var headers = {
      'anthropic-version': ANTHROPIC_VERSION
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }
    Object.keys(config.extraHeaders).forEach(function (name) {
      headers[name] = config.extraHeaders[name];
    });
    return { path: config.path || DEFAULT_PATH, headers: headers, body: body, stream: !!request.stream };
  },

  createParser: function () {
    return {
      text: '',
      toolCalls: [],        // [{id,name,argsString}]（按 content block index 存放）
      finishReason: null,
      usage: null,
      sawStop: false,
      nonStreamText: ''
    };
  },

  consumeLine: function (state, line, emit) {
    if (!line || line.charAt(0) === ':') { return; }
    if (line.indexOf('data:') !== 0) { return; }
    var payload = line.slice(5).trim();
    if (!payload) { return; }
    var evt;
    try {
      evt = JSON.parse(payload);
    } catch (e) {
      throw new Error('invalid SSE JSON chunk');
    }
    var type = evt.type;
    if (type === 'ping') { return; }
    if (type === 'error') {
      var msg = evt.error && evt.error.message ? String(evt.error.message).slice(0, 200) : 'provider stream error';
      var err = new Error(msg);
      err.providerError = (evt.error && evt.error.type) || 'provider_error';
      throw err;
    }
    if (type === 'message_start') {
      var u1 = evt.message && evt.message.usage;
      if (u1) {
        state.usage = {
          inputTokens: typeof u1.input_tokens === 'number' ? u1.input_tokens : undefined,
          outputTokens: typeof u1.output_tokens === 'number' ? u1.output_tokens : undefined
        };
      }
      return;
    }
    if (type === 'content_block_start') {
      var block = evt.content_block || {};
      if (block.type === 'text') {
        state.toolCalls[evt.index] = null; // 占位，text 不按 index 记 toolCall
      } else if (block.type === 'tool_use') {
        var slot = { id: block.id || 'toolu_' + evt.index, name: block.name || '', argsString: '' };
        state.toolCalls[evt.index] = slot;
        emit({ type: 'tool-call-start', id: slot.id, name: slot.name });
      }
      return;
    }
    if (type === 'content_block_delta') {
      var d = evt.delta || {};
      if (d.type === 'text_delta' && typeof d.text === 'string' && d.text.length) {
        state.text += d.text;
        emit({ type: 'text-delta', text: d.text });
      } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
        var slot2 = state.toolCalls[evt.index];
        if (slot2) {
          slot2.argsString += d.partial_json;
          emit({ type: 'tool-call-delta', id: slot2.id, name: slot2.name, argsDelta: d.partial_json });
        }
      }
      return;
    }
    if (type === 'message_delta') {
      var stop = evt.delta && evt.delta.stop_reason;
      if (stop) {
        state.finishReason = stop; // end_turn | tool_use | max_tokens | stop_sequence
      }
      if (evt.usage && typeof evt.usage.output_tokens === 'number') {
        state.usage = {
          inputTokens: state.usage ? state.usage.inputTokens : undefined,
          outputTokens: evt.usage.output_tokens
        };
      }
      return;
    }
    if (type === 'message_stop') {
      state.sawStop = true;
      return;
    }
  },

  consumeNonStreamBody: function (state, fullText, emit) {
    var data = JSON.parse(fullText);
    if (!Array.isArray(data.content)) {
      throw new Error('provider response missing content');
    }
    data.content.forEach(function (block, idx) {
      if (block.type === 'text' && typeof block.text === 'string') {
        state.text += block.text;
        emit({ type: 'text-delta', text: block.text });
      } else if (block.type === 'tool_use') {
        var slot = { id: block.id || 'toolu_' + idx, name: block.name || '', argsString: JSON.stringify(block.input || {}) };
        state.toolCalls[idx] = slot;
        emit({ type: 'tool-call-start', id: slot.id, name: slot.name });
        emit({ type: 'tool-call-delta', id: slot.id, name: slot.name, argsDelta: slot.argsString });
      }
    });
    if (data.stop_reason) { state.finishReason = data.stop_reason; }
    if (data.usage) {
      state.usage = {
        inputTokens: typeof data.usage.input_tokens === 'number' ? data.usage.input_tokens : undefined,
        outputTokens: typeof data.usage.output_tokens === 'number' ? data.usage.output_tokens : undefined
      };
    }
  },

  finalize: function (state, emit) {
    var toolCalls = [];
    for (var i = 0; i < state.toolCalls.length; i += 1) {
      var slot = state.toolCalls[i];
      if (!slot || !slot.name) { continue; }
      var args = {};
      if (slot.argsString && slot.argsString.trim()) {
        try {
          args = JSON.parse(slot.argsString);
        } catch (e) {
          args = { __invalidJson: true, raw: slot.argsString.slice(0, 2000) };
        }
      }
      toolCalls.push({ id: slot.id, name: slot.name, args: args });
      emit({ type: 'tool-call-end', id: slot.id, name: slot.name });
    }
    var finishReason = null;
    if (state.finishReason === 'tool_use') {
      finishReason = 'tool_use';
    } else if (state.finishReason === 'max_tokens') {
      finishReason = 'length';
    } else if (state.finishReason) {
      finishReason = 'stop';
    }
    emit({ type: 'message-end', finishReason: finishReason, usage: state.usage || null });
    return {
      role: 'assistant',
      text: state.text,
      toolCalls: toolCalls,
      usage: state.usage || null,
      finishReason: finishReason
    };
  }
};

module.exports = { anthropicAdapter: anthropicAdapter };
