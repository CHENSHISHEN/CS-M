// 协议选项 — 来自 host-api.md 的 ProviderConfig 合同（唯一两种受支持协议）。
// 仅协议标识，不含任何模型品牌/地址预设；label 交给文案层（labels/locale）。
export const PROVIDER_PROTOCOL_OPTIONS = [
  {value: 'openai-chat'},
  {value: 'anthropic-messages'},
];
