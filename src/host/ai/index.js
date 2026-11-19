'use strict';
/**
 * AI Host 入口 — 集成者（src/main.js 接缝任务）从这里引用。
 *
 * 用法概要（完整合同见 doc/developer/platform-ai-v1/implementation/host-api.md）：
 *   const {createAiHostBroker, registerAiHostIpc} = require('./host/ai');
 *   const broker = createAiHostBroker();
 *   const aiIpc = registerAiHostIpc({ipcMain, broker});
 *   // 每个 BrowserWindow 创建后：
 *   aiIpc.attachWindow(win.webContents);
 */

var brokerLib = require('./broker');
var ipcLib = require('./ipc');

module.exports = {
  createAiHostBroker: brokerLib.createAiHostBroker,
  registerAiHostIpc: ipcLib.registerAiHostIpc,
  AI_IPC_CHANNELS: ipcLib.AI_IPC_CHANNELS,
  InMemoryCredentialVault: require('./credentials').InMemoryCredentialVault
};
