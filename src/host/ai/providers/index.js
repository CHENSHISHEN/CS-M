'use strict';
var openai = require('./openai');
var anthropic = require('./anthropic');

var adapters = {
  'openai-chat': openai.openaiAdapter,
  'anthropic-messages': anthropic.anthropicAdapter
};

function getAdapter(protocol) {
  return adapters[protocol] || null;
}

module.exports = {
  getAdapter: getAdapter,
  protocols: Object.keys(adapters)
};
