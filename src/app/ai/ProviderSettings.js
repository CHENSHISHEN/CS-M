import React, {useEffect, useMemo, useRef, useState} from 'react';
import AiIcon from './icons';
import {createMessages} from './messages';

// 服务与范围设置：全部数据经 props 注入，不读取系统已有配置；
// 凭据只在会话内传递（onCredentialChange），组件不持久化、不回显；
// 连接测试与保存的真实结果只能来自 props（testing/testResult/saveState）。
const ProviderSettings = ({
  locale = 'zh',
  labels,
  visible = false,
  value = {name: '', protocol: '', endpoint: '', model: ''},
  protocols = [],
  models = [],
  onChange,
  credential = {status: 'none'},
  onCredentialChange,
  onClearCredential,
  testing = false,
  testResult = null,
  onTest,
  onSave,
  saving = false,
  saveState = 'idle', // idle | saving | saved | error
  onClose,
}) => {
  const t = useMemo(() => createMessages(locale, labels), [locale, labels]);
  const [secret, setSecret] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!visible || typeof document === 'undefined') return undefined;
    const prev = document.activeElement;
    if (ref.current) ref.current.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (prev && prev.focus) prev.focus();
    };
  }, [visible, onClose]);

  // 关闭时丢弃会话内密钥输入，不留在 DOM
  useEffect(() => {
    if (!visible && secret) setSecret('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  // 首版凭据仅支持 none/session；stored 为保留状态，显示为禁用说明且不提供入口
  const credentialText = {
    none: t('provider.credentialNone'),
    session: t('provider.credentialSession'),
    stored: t('provider.credentialStored'),
  }[credential.status] || t('provider.credentialNone');
  const credentialDisabled = credential.status === 'stored';

  const endpointReady = !!(value.endpoint && value.endpoint.trim());
  const caps = (testResult && testResult.capabilities) || {};
  const capRow = (key, label) => {
    const v = caps[key];
    const cls = v === 'yes' ? 'is-yes' : v === 'no' ? 'is-no' : 'is-unknown';
    const text = v === 'yes' ? t('provider.capYes') : v === 'no' ? t('provider.capNo') : t('provider.capUnknown');
    return (
      <div key={key} className={`chiner-ai-cap ${cls}`}>
        <span>{label}</span>
        <b>{text}</b>
      </div>
    );
  };

  return (
    <div
      ref={ref}
      className="chiner-ai-provider"
      role="dialog"
      aria-label={t('provider.title')}
      tabIndex={-1}
    >
      <div className="chiner-ai-picker-head">
        <AiIcon name="settings" size={13}/>
        <strong>{t('provider.title')}</strong>
        <button
          type="button"
          className="chiner-ai-iconbtn chiner-ai-end"
          onClick={onClose}
          aria-label={t('provider.close')}
        >
          <AiIcon name="close" size={13}/>
        </button>
      </div>

      <div className="chiner-ai-picker-scroll">
        <label className="chiner-ai-fieldrow">
          <span className="chiner-ai-fieldlabel">{t('provider.fieldName')}</span>
          <input
            type="text"
            value={value.name || ''}
            onChange={(e) => onChange && onChange('name', e.target.value)}
            aria-label={t('provider.fieldName')}
          />
        </label>
        <label className="chiner-ai-fieldrow">
          <span className="chiner-ai-fieldlabel">{t('provider.fieldProtocol')}</span>
          <select
            value={value.protocol || ''}
            onChange={(e) => onChange && onChange('protocol', e.target.value)}
            aria-label={t('provider.fieldProtocol')}
          >
            <option value="">…</option>
            {protocols.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="chiner-ai-fieldrow">
          <span className="chiner-ai-fieldlabel">{t('provider.fieldEndpoint')}</span>
          <input
            type="text"
            value={value.endpoint || ''}
            placeholder={t('provider.endpointPlaceholder')}
            onChange={(e) => onChange && onChange('endpoint', e.target.value)}
            aria-label={t('provider.fieldEndpoint')}
          />
        </label>
        {!endpointReady && <div className="chiner-ai-fielderror">{t('provider.endpointRequired')}</div>}
        <label className="chiner-ai-fieldrow">
          <span className="chiner-ai-fieldlabel">{t('provider.fieldModel')}</span>
          <input
            type="text"
            list="chiner-ai-model-list"
            value={value.model || ''}
            placeholder={t('provider.modelPlaceholder')}
            onChange={(e) => onChange && onChange('model', e.target.value)}
            aria-label={t('provider.fieldModel')}
          />
          <datalist id="chiner-ai-model-list">
            {models.map((m) => <option key={m} value={m}/>)}
          </datalist>
        </label>

        <div className="chiner-ai-fieldblock">
          <div className="chiner-ai-fieldblockhead">
            <span className="chiner-ai-fieldlabel">{t('provider.fieldCredential')}</span>
            <span className={`chiner-ai-tiny chiner-ai-muted${credentialDisabled ? ' chiner-ai-stored-disabled' : ''}`}>
              {credentialText}
            </span>
          </div>
          <input
            type="password"
            autoComplete="off"
            value={secret}
            placeholder={t('provider.credentialPlaceholder')}
            aria-label={t('provider.fieldCredential')}
            onChange={(e) => {
              setSecret(e.target.value);
              if (onCredentialChange) onCredentialChange(e.target.value);
            }}
          />
          {credential.status === 'session' && onClearCredential && (
            <button type="button" className="chiner-ai-minibtn" onClick={onClearCredential}>
              <AiIcon name="close" size={11}/>
              {t('provider.credentialNone')}
            </button>
          )}
          <p className="chiner-ai-tiny chiner-ai-muted">{t('provider.credentialNote')}</p>
        </div>

        <div className="chiner-ai-fieldblock">
          <div className="chiner-ai-fieldblockhead">
            <span className="chiner-ai-fieldlabel">{t('provider.capabilities')}</span>
            <button
              type="button"
              className="chiner-ai-minibtn"
              onClick={onTest}
              disabled={testing || !endpointReady || !onTest}
            >
              {testing ? t('provider.testing') : t('provider.test')}
            </button>
          </div>
          {testResult && (
            <div className={`chiner-ai-testresult ${testResult.ok ? 'is-ok' : 'is-fail'}`} role="status">
              {testResult.ok
                ? t('provider.testOk', {ms: testResult.latencyMs != null ? testResult.latencyMs : '?'})
                : `${t('provider.testFail')}${testResult.error ? ` · ${testResult.error}` : ''}`}
            </div>
          )}
          <div className="chiner-ai-caps">
            {capRow('tools', t('provider.capTools'))}
            {capRow('structuredOutput', t('provider.capStructured'))}
            {capRow('streaming', t('provider.capStreaming'))}
          </div>
        </div>

        <p className="chiner-ai-tiny chiner-ai-muted">{t('provider.scopeSection')}</p>
      </div>

      <div className="chiner-ai-picker-foot">
        {saveState === 'error' && <span className="chiner-ai-fielderror">{t('provider.saveFailed')}</span>}
        {saveState === 'saved' && <span className="chiner-ai-tiny chiner-ai-muted">{t('provider.saveStateSaved')}</span>}
        <span className="chiner-ai-end"/>
        <button type="button" className="chiner-ai-minibtn" onClick={onClose}>{t('picker.cancel')}</button>
        <button
          type="button"
          className="chiner-ai-minibtn chiner-ai-primary"
          onClick={() => onSave && onSave(value)}
          disabled={saving || !endpointReady || !onSave}
        >
          {saving ? t('provider.saving') : t('provider.save')}
        </button>
      </div>
    </div>
  );
};

export default React.memo(ProviderSettings);
