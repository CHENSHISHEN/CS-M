'use strict';
/**
 * CredentialVault — 首发实现：仅本轮应用会话的内存保险库。
 *
 * 重要事实（不得伪称）：
 * - Electron 13.1.7 没有 safeStorage API（13.x 类型与运行时均无），
 *   本项目未授权运行时升级，因此首发不存在可用的 OS 级加密持久存储。
 * - 本实现不写 localStorage / 项目文件 / 用户配置 / 磁盘任何位置；
 *   应用重启后凭据为空，UI 必须明确告知“不会跨重启保存”。
 * - “记住密钥”类持久化在换成受支持 Electron 并接 OS 凭据服务之前禁用；
 *   不允许静默退回明文落盘。见 host-api.md 安全声明。
 *
 * 接口约定：产品后续可注入实现相同接口的 OS 级 vault；
 * 除本文件注释列出的方法外不得假设其他方法存在。
 */
function InMemoryCredentialVault() {
  if (!(this instanceof InMemoryCredentialVault)) {
    return new InMemoryCredentialVault();
  }
  this._secrets = new Map();
}

InMemoryCredentialVault.prototype.set = function (refId, secret) {
  if (typeof refId !== 'string' || refId.length === 0 || refId.length > 128) {
    throw new Error('invalid credential refId');
  }
  if (typeof secret !== 'string' || secret.length === 0 || secret.length > 4096) {
    throw new Error('invalid credential value');
  }
  this._secrets.set(refId, secret);
};

InMemoryCredentialVault.prototype.get = function (refId) {
  return this._secrets.get(refId);
};

InMemoryCredentialVault.prototype.has = function (refId) {
  return this._secrets.has(refId);
};

InMemoryCredentialVault.prototype.delete = function (refId) {
  this._secrets.delete(refId);
};

InMemoryCredentialVault.prototype.clear = function () {
  this._secrets.clear();
};

InMemoryCredentialVault.prototype.size = function () {
  return this._secrets.size;
};

/** 持久化能力声明：首发恒为 false，UI 不得显示“已安全保存密钥”。 */
InMemoryCredentialVault.prototype.supportsPersistence = function () {
  return false;
};

module.exports = {
  InMemoryCredentialVault: InMemoryCredentialVault
};
