// 凭据状态判定（AI-01 配套）：configure 回执落账后界面显示的 credentialStatus。
// Host 回执里的 hasCredential（broker 实时读 vault）是权威来源：
// - hasCredential === false：Host 已无 key（例如改了 endpoint/协议但没重输 key，broker 会静默清除）→ 'none'；
// - 本次确实送达了 key，或 Host 报告 hasCredential === true → 'session'（首版凭据只存会话内存）；
// - 回执缺少 hasCredential（旧 Host / 无回执）→ 保持原状态，不臆测。
// 'none' 只表示「没有凭据」，不是错误：无需 key 的本地服务仍可正常测试/就绪。
export function credentialStatusFromReceipt(masked, deliveredKey, previousStatus) {
  if (masked && masked.hasCredential === false) return 'none';
  if (deliveredKey) return 'session';
  if (masked && masked.hasCredential === true) return 'session';
  return previousStatus;
}
