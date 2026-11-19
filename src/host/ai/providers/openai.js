'use strict';
/**
 * OpenAI-compatible chat completions 适配器。
 *
 * 归一化边界（COMMANDS.md §3）：
 * - 供应商 tool call id 与本地幂等 command ID 是不同身份，不做替换，只透传。
 * - jsonMode 只在配置显式声明 capabilities.jsonMode 时启用
 *   （保守使用 response_format:{type:'json_object'}，不假设兼容服务支持 json_schema）。
 * - 不假设所有 compatible 服务支持 tools；能力由配置声明，请求前由 Broker 校验。
 *
 * 归一化事件：text-delta / tool-call-start / tool-call-delta / tool-call-end /
 * message-end；非流式响应在 finalize 前一次性发同样事件。
 */

var DEFAULT_PATH = '/v1/chat/completions';

function buildMessages(normMessages) {
  var out = [];
  for (var i = 0; i < normMessages.length; i += 1) {
    var m = normMessages[i];
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.text || '' });
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.text || '' });
    } else if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length) {
        out.push({
          role: 'assistant',
          content: m.text || null,
          tool_calls: m.toolCalls.map(function (tc) {
            return {
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.args || {})
              }
            };
          })
        });
      } else {
        out.push({ role: 'assistant', content: m.text || '' });
      }
    } else if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.text || ''
      });
    } else {
      throw new Error('unsupported message role: ' + m.role);
    }
  }
  return out;
}

var openaiAdapter = {
  protocol: 'openai-chat',
  defaultPath: DEFAULT_PATH,

  prepare: function (config, request, apiKey) {
    var body = {
      model: config.model,
      messages: buildMessages(request.messages),
      stream: !!request.stream
    };
    if (request.tools && request.tools.length) {
      body.tools = request.tools.map(function (t) {
        return {
          type: 'function',
          function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object' } }
        };
      });
      body.tool_choice = 'auto';
    }
    if (request.jsonSchema && config.capabilities.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    if (typeof request.maxTokens === 'number' && request.maxTokens > 0) {
      body.max_tokens = Math.floor(request.maxTokens);
    }
    if (typeof request.temperature === 'number' && request.temperature >= 0 && request.temperature <= 2) {
      body.temperature = request.temperature;
    }
    var headers = {};
    if (apiKey) {
      headers.Authorization = 'Bearer ' + apiKey;
    }
    Object.keys(config.extraHeaders).forEach(function (name) {
      headers[name] = config.extraHeaders[name];
    });
    return { path: config.path || DEFAULT_PATH, headers: headers, body: body, stream: !!request.stream };
  },

  createParser: function () {
    return {
      text: '',
      toolCalls: [],       // [{id,name,argsString}]
      finishReason: null,
      usage: null,
      sawDone: false,
      nonStreamText: ''
    };
  },

  /** 流式：消费一行 SSE。 */
  consumeLine: function (state, line, emit) {
    if (!line || line.charAt(0) === ':') { return; } // 空行或注释
    if (line.indexOf('data:') !== 0) { return; }
    var payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      state.sawDone = true;
      return;
    }
    var chunk;
    try {
      chunk = JSON.parse(payload);
    } catch (e) {
      throw new Error('invalid SSE JSON chunk');
    }
    if (chunk.error) {
      var msg = chunk.error && chunk.error.message ? String(chunk.error.message).slice(0, 200) : 'provider stream error';
      var err = new Error(msg);
      err.providerError = chunk.error.type || 'provider_error';
      throw err;
    }
    var usage = chunk.usage;
    if (usage && typeof usage === 'object') {
      state.usage = {
        inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
        outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined
      };
    }
    var choices = chunk.choices || [];
    for (var i = 0; i < choices.length; i += 1) {
      var choice = choices[i];
      var delta = choice.delta || choice.message || {};
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        state.text += delta.content;
        emit({ type: 'text-delta', text: delta.content });
      }
      var tcs = delta.tool_calls;
      if (tcs && tcs.length) {
        for (var j = 0; j < tcs.length; j += 1) {
          var tc = tcs[j];
          var idx = typeof tc.index === 'number' ? tc.index : j;
          var slot = state.toolCalls[idx];
          if (!slot) {
            slot = { id: tc.id || 'call_' + idx, name: '', argsString: '' };
            state.toolCalls[idx] = slot;
            if (tc.id || (tc.function && tc.function.name)) {
              emit({ type: 'tool-call-start', id: slot.id, name: (tc.function && tc.function.name) || '' });
            }
          }
          if (tc.id) { slot.id = tc.id; }
          if (tc.function && tc.function.name) {
            slot.name += tc.function.name;
          }
          if (tc.function && typeof tc.function.arguments === 'string') {
            slot.argsString += tc.function.arguments;
            emit({ type: 'tool-call-delta', id: slot.id, name: slot.name, argsDelta: tc.function.arguments });
          }
        }
      }
      if (choice.finish_reason) {
        state.finishReason = choice.finish_reason;
      }
    }
  },

  /** 非流式：响应完成后解析完整 JSON。 */
  consumeNonStreamBody: function (state, fullText, emit) {
    var data = JSON.parse(fullText);
    var choice = data.choices && data.choices[0];
    if (!choice) {
      throw new Error('provider response missing choices');
    }
    var message = choice.message || {};
    if (typeof message.content === 'string' && message.content.length) {
      state.text = message.content;
      emit({ type: 'text-delta', text: message.content });
    } else if (Array.isArray(message.content)) {
      var joined = '';
      message.content.forEach(function (part) {
        if (part && part.type === 'text' && typeof part.text === 'string') { joined += part.text; }
      });
      state.text = joined;
      if (joined) { emit({ type: 'text-delta', text: joined }); }
    }
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
      message.tool_calls.forEach(function (tc, idx) {
        var slot = { id: tc.id || 'call_' + idx, name: '', argsString: '' };
        if (tc.function) {
          slot.name = tc.function.name || '';
          slot.argsString = typeof tc.function.arguments === 'string' ? tc.function.arguments : '';
        }
        state.toolCalls[idx] = slot;
        emit({ type: 'tool-call-start', id: slot.id, name: slot.name });
        if (slot.argsString) {
          emit({ type: 'tool-call-delta', id: slot.id, name: slot.name, argsDelta: slot.argsString });
        }
      });
    }
    state.finishReason = choice.finish_reason || null;
    if (data.usage && typeof data.usage === 'object') {
      state.usage = {
        inputTokens: typeof data.usage.prompt_tokens === 'number' ? data.usage.prompt_tokens : undefined,
        outputTokens: typeof data.usage.completion_tokens === 'number' ? data.usage.completion_tokens : undefined
      };
    }
  },

  /** 组装最终归一化结果，并发出收尾事件。 */
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
    if (state.finishReason === 'tool_calls') {
      finishReason = 'tool_use';
    } else if (state.finishReason === 'length') {
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

module.exports = { openaiAdapter: openaiAdapter };
