// ProviderController — 服务设置控制器（SHELL 接缝）
//
// 复用已验收的 ProviderSettings 组件（不复制 UI）；协议/完整 endpoint/模型均为自由输入，
// 不写死模型品牌；configure→test→保存就绪全部来自 Host 真实回执：
// - apiKey 只经 ai:provider:configure 发送一次，回执为脱敏配置（无 apiKey），不回显、不持久化；
// - 非密钥配置保存在控制器状态或上层 controlled props（value/onChange 受控优先）；
// - 首次启动（重启后）内存 vault 为空，需重新配置 key（credential 状态回到 none）；
// - 能力默认全 false，仅经 props.capabilities 显式声明；测试 reachable ≠ tools 支持，
//   能力一律显示 unknown；assistant 是否 ready 由 Host 状态（getStatus/providers）判定，
//   不看表单值；测试失败 -> service status 'error'（不 ready）。
// 凭据更新边界（SHELL-R1）：
// - 新 secret / 显式 clearKey / 表单或能力变化都使已配置失效：test 前真正 configure 再 test，
//   不绕过配置沿用旧 key；测试送达的 key 同样落账（credentialStatus 真实、ref 即清不重复发）。
// - 关闭/Esc/visible=false 丢弃未提交的 secretRef（与子 UI 清 DOM 输入一致）；已交 Host vault
//   的 key 不因关闭被清除；清除走显式 clearKey 并按 Host 真实状态刷新。
// - configure/test/clear 以流程版本 + 表单签名双重 guard：关闭、新流程启动或表单漂移后，
//   迟到回执不再写入状态（不得把新表单/已关闭界面错误标 ready/saved）；保存与测试并发互斥。
// 文案经 locale/labels 传入，不改正式语言文件；不读取 Claude/Magpie 等任何外部配置。

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import ProviderSettings from '../ProviderSettings';
import {PROVIDER_PROTOCOL_OPTIONS} from './providerOptions';

export {PROVIDER_PROTOCOL_OPTIONS};

const UNKNOWN_CAPS = {tools: 'unknown', structuredOutput: 'unknown', streaming: 'unknown'};

/** 构建 configure 载荷：secret 非空才携带 apiKey（仅此一次出现）；clearKey=true 显式清除 vault 中的 key */
export function providerBuildConfigurePayload({form, capabilities, secret, providerId, clearKey}) {
  const provider = {
    id: providerId,
    label: (form && form.name) || providerId,
    protocol: form && form.protocol,
    baseURL: form && form.endpoint,
    model: form && form.model,
    capabilities: {
      stream: !!(capabilities && capabilities.stream),
      tools: !!(capabilities && capabilities.tools),
      jsonMode: !!(capabilities && capabilities.jsonMode),
    },
  };
  if (clearKey) provider.apiKey = null;
  else if (secret) provider.apiKey = secret;
  return {providers: [provider]};
}

/** 将 Host 测试回执映射为 ProviderSettings 的 testResult；reachable 不推断能力（unknown） */
export function providerMapTestReceipt({receipt, error, latencyMs}) {
  if (error) {
    return {ok: false, error: (error.code || 'PROVIDER_ERROR') + (error.message ? ': ' + error.message : ''), capabilities: UNKNOWN_CAPS};
  }
  const ok = !!(receipt && receipt.reachable);
  return {
    ok,
    latencyMs: typeof latencyMs === 'number' ? latencyMs : undefined,
    capabilities: UNKNOWN_CAPS,
    error: ok ? undefined : 'PROVIDER_ERROR',
  };
}

/** ready 判定：只看 Host 状态回执（providers 列表）与最近一次真实测试结果，不看表单值 */
export function providerDeriveService({statusReceipt, providerId, lastTest}) {
  const providers = (statusReceipt && statusReceipt.providers) || [];
  const configured = providers.some((p) => p && p.id === providerId);
  if (!configured) return {status: 'unconfigured'};
  if (lastTest && lastTest.ok === false) {
    return {status: 'error', error: lastTest.error || 'provider test failed'};
  }
  return {status: 'ready'};
}

/** configure/test 前的配置签名：表单值 + 能力声明（能力变化同样必须重配置，不沿用旧配置） */
export function providerConfigSignature(form, capabilities) {
  return JSON.stringify([
    form && form.name, form && form.protocol, form && form.endpoint, form && form.model,
    !!(capabilities && capabilities.stream), !!(capabilities && capabilities.tools), !!(capabilities && capabilities.jsonMode),
  ]);
}

/** configure 流程：真实调用 Host；返回脱敏回执（无 apiKey）。deliveredKey=本次确实发出过 key 且成功 */
export async function providerConfigureFlow({client, form, capabilities, secret, providerId, clearKey}) {
  const payload = providerBuildConfigurePayload({form, capabilities, secret, providerId, clearKey});
  const receipt = await client.configureProviders(payload);
  const providers = (receipt && receipt.providers) || [];
  const masked = providers.find((p) => p && p.id === providerId) || providers[0] || null;
  return {masked, deliveredKey: !!(!clearKey && secret && masked)};
}

/**
 * test 流程：必要时先 configure（key 只在此进入 Host），再真实测试一次并计时。
 * 已有 masked 时仅在无新 secret 且未显式 clearKey 的情况下沿用已配置——
 * 换 key / 清除 key 必须先真正 configure 再 test，不得绕过配置用旧 key 出网。
 */
export async function providerTestFlow(opts) {
  let masked = opts.masked || null;
  let configured = false;
  let deliveredKey = false;
  if (!masked || opts.secret || opts.clearKey) {
    const result = await providerConfigureFlow(opts);
    masked = result.masked;
    configured = true;
    deliveredKey = result.deliveredKey;
  }
  const t0 = Date.now();
  try {
    const receipt = await testViaClient(opts.client, masked);
    return {receipt, masked, mapped: providerMapTestReceipt({receipt, latencyMs: Date.now() - t0}), configured, deliveredKey};
  } catch (error) {
    return {receipt: null, masked, mapped: providerMapTestReceipt({error, latencyMs: Date.now() - t0}), configured, deliveredKey};
  }
}
function testViaClient(client, masked) {
  if (!masked) return Promise.reject({code: 'INVALID_REQUEST', message: 'provider not configured'});
  return client.testProvider(masked.id);
}

const defaultForm = {name: '', protocol: '', endpoint: '', model: ''};

/**
 * 受控/非受控：
 * - value/onChange 存在时表单由上层持有（controlled props）；
 * - 否则表单存控制器状态。密钥只存 React ref（会话内），不落任何持久层。
 */
const ProviderController = ({
  locale = 'zh',
  labels,
  visible = false,
  onClose,
  client,                                   // createAiHostClient() 实例（必需）
  value,
  defaultValue = defaultForm,
  onChange,
  protocols = PROVIDER_PROTOCOL_OPTIONS,
  models = [],                              // 不写死模型品牌：默认无候选，自由输入
  capabilities,                             // 显式能力声明，缺省全 false
  providerId = 'default',
  onConfigured,                             // (maskedProvider) Host 脱敏回执（含 ID，无 apiKey）
  onServiceChange,                          // ({status:'unconfigured'|'ready'|'error', error?})
}) => {
  const [form, setForm] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : form;

  const secretRef = useRef('');
  const configuredSigRef = useRef('');
  const maskedRef = useRef(null);
  const lastTestRef = useRef(null);
  const flowVersionRef = useRef(0); // configure/test/clear 流程版本：关闭弹层或新流程启动即作废在途回执
  const latestSigRef = useRef('');  // 最新表单+能力签名：表单漂移后旧流程迟到回执不得写入状态
  const [credentialStatus, setCredentialStatus] = useState('none');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [hostStatus, setHostStatus] = useState(null);

  const caps = useMemo(() => ({
    stream: !!(capabilities && capabilities.stream),
    tools: !!(capabilities && capabilities.tools),
    jsonMode: !!(capabilities && capabilities.jsonMode),
  }), [capabilities]);

  const currentSig = providerConfigSignature(current, caps);
  latestSigRef.current = currentSig;

  // 关闭/Esc/visible=false：丢弃未提交的密钥输入（与子 ProviderSettings 清 DOM 输入语义一致），
  // 已交 Host vault 的 key 不因此清除（清除只能显式 clearKey）；同时作废在途 configure/test，
  // 其迟到回执不得把已关闭界面标成 ready/saved 或写入 credential 状态。
  const invalidateFlows = useCallback(() => {
    secretRef.current = '';
    flowVersionRef.current += 1;
    setTesting(false);
    setSaving(false);
    setSaveState('idle');
  }, []);

  useEffect(() => {
    if (!visible) invalidateFlows();
  }, [visible, invalidateFlows]);

  const handleClose = useCallback(() => {
    invalidateFlows();
    if (onClose) onClose();
  }, [invalidateFlows, onClose]);

  /** 流程回执是否已过期：有更新流程/已关闭（版本变化），或表单/能力已漂移（签名变化） */
  const isStale = useCallback((version, startSig) => (
    version !== flowVersionRef.current || startSig !== latestSigRef.current
  ), []);

  const publishService = useCallback((statusReceipt, lastTest) => {
    if (!onServiceChange) return;
    onServiceChange(providerDeriveService({statusReceipt, providerId, lastTest}));
  }, [onServiceChange, providerId]);

  const refreshStatus = useCallback(async () => {
    if (!client || !client.available) {
      setHostStatus(null);
      publishService(null, lastTestRef.current);
      return null;
    }
    try {
      const receipt = await client.getStatus();
      setHostStatus(receipt);
      publishService(receipt, lastTestRef.current);
      return receipt;
    } catch (e) {
      setHostStatus(null);
      publishService(null, lastTestRef.current);
      return null;
    }
  }, [client, publishService]);

  /** 配置真实送达后的本地落账：清 ref（key 不静默重复发）、credential 状态真实、签名/回执对齐 */
  const applyConfigured = useCallback((masked, deliveredKey, sig) => {
    secretRef.current = ''; // key 只发一次，发完即清；不回显、不保留
    if (deliveredKey) setCredentialStatus('session');
    configuredSigRef.current = sig;
    if (masked) {
      maskedRef.current = masked;
      if (onConfigured) onConfigured(masked);
    }
  }, [onConfigured]);

  const handleCredentialChange = useCallback((secret) => {
    secretRef.current = secret || '';
  }, []);

  const handleClearCredential = useCallback(async () => {
    if (!client || !client.available) return;
    const version = ++flowVersionRef.current;
    try {
      // Host 合同：apiKey:null = 清除 vault 中该 key（真实回执后本地回到 none）
      const {masked} = await providerConfigureFlow({
        client, form: current, capabilities: caps, providerId, clearKey: true,
      });
      if (isStale(version, currentSig)) return; // 迟到回执：界面已关闭/已有新流程/表单已变
      secretRef.current = '';
      setCredentialStatus('none');
      if (masked) maskedRef.current = masked;
      await refreshStatus(); // 清除后服务状态按 Host 真实状态刷新
    } catch (e) { /* 保留现状，不清除 */ }
  }, [client, current, caps, currentSig, providerId, refreshStatus, isStale]);

  const handleTest = useCallback(async () => {
    if (!client || !client.available || testing || saving) return; // 保存/测试并发互斥
    const version = ++flowVersionRef.current;
    const startSig = currentSig;
    setTesting(true);
    try {
      // dirty：表单或能力与上次已配置不一致、从未配置、或本地有未提交的新 secret——必须真正 configure 后再 test
      const pendingSecret = secretRef.current !== '';
      const dirty = pendingSecret || !maskedRef.current || configuredSigRef.current !== startSig;
      const flow = await providerTestFlow({
        client, form: current, capabilities: caps, secret: secretRef.current,
        providerId, masked: dirty ? null : maskedRef.current,
      });
      if (isStale(version, startSig)) return; // 迟到响应：不改写新表单/已关闭界面状态
      if (flow.configured) applyConfigured(flow.masked, flow.deliveredKey, startSig);
      setTestResult(flow.mapped);
      lastTestRef.current = flow.mapped.ok ? {ok: true} : {ok: false, error: flow.mapped.error};
      await refreshStatus();
    } catch (error) {
      if (isStale(version, startSig)) return;
      const mapped = providerMapTestReceipt({error});
      setTestResult(mapped);
      lastTestRef.current = {ok: false, error: mapped.error};
      await refreshStatus();
    } finally {
      if (version === flowVersionRef.current) setTesting(false);
    }
  }, [client, testing, saving, current, caps, currentSig, providerId, refreshStatus, applyConfigured, isStale]);

  const handleSave = useCallback(async () => {
    if (!client || !client.available || saving || testing) return; // 保存/测试并发互斥
    const version = ++flowVersionRef.current;
    const startSig = currentSig;
    setSaving(true);
    setSaveState('saving');
    try {
      const {masked, deliveredKey} = await providerConfigureFlow({
        client, form: current, capabilities: caps, secret: secretRef.current, providerId,
      });
      if (isStale(version, startSig)) return; // 迟到回执：不得把已关闭界面/新表单标 saved
      applyConfigured(masked, deliveredKey, startSig);
      await refreshStatus();
      if (!isStale(version, startSig)) setSaveState('saved');
    } catch (error) {
      if (!isStale(version, startSig)) setSaveState('error');
    } finally {
      if (version === flowVersionRef.current) setSaving(false);
    }
  }, [client, saving, testing, current, caps, currentSig, providerId, refreshStatus, applyConfigured, isStale]);

  const handleChange = useCallback((field, fieldValue) => {
    if (!controlled) setForm((prev) => ({...prev, [field]: fieldValue}));
    if (onChange) onChange(field, fieldValue);
  }, [controlled, onChange]);

  return (
    <ProviderSettings
      locale={locale}
      labels={labels}
      visible={visible}
      onClose={handleClose}
      value={current}
      protocols={protocols}
      models={models}
      onChange={handleChange}
      credential={{status: credentialStatus}}
      onCredentialChange={handleCredentialChange}
      onClearCredential={handleClearCredential}
      onTest={handleTest}
      testing={testing}
      testResult={testResult}
      onSave={handleSave}
      saving={saving}
      saveState={saveState}
    />
  );
};

export default ProviderController;
