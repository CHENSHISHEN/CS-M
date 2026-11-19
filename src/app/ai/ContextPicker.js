import React, {useEffect, useMemo, useRef} from 'react';
import AiIcon from './icons';
import {createMessages} from './messages';

// 发送范围与可选上下文选择器：纯展示与上报，不读任何系统配置。
// 定位为 AI 面板内的浮层（父容器 position:relative）。
const ContextPicker = ({
  locale = 'zh',
  labels,
  visible = false,
  scope = [],
  groups = [],
  onToggleScope,
  onToggleItem,
  onApply,
  onClose,
}) => {
  const t = useMemo(() => createMessages(locale, labels), [locale, labels]);
  const ref = useRef(null);

  useEffect(() => {
    if (!visible || typeof document === 'undefined') return undefined;
    const prev = document.activeElement;
    if (ref.current) ref.current.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (onClose) onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (prev && prev.focus) prev.focus();
    };
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div
      ref={ref}
      className="chiner-ai-picker"
      role="dialog"
      aria-label={t('picker.title')}
      tabIndex={-1}
    >
      <div className="chiner-ai-picker-head">
        <AiIcon name="scope" size={13}/>
        <strong>{t('picker.title')}</strong>
        <button
          type="button"
          className="chiner-ai-iconbtn chiner-ai-end"
          onClick={onClose}
          aria-label={t('picker.cancel')}
        >
          <AiIcon name="close" size={13}/>
        </button>
      </div>

      <div className="chiner-ai-picker-scroll">
        <h4>{t('picker.scopeTitle')}</h4>
        <div className="chiner-ai-picker-scope">
          {scope.map((s) => (
            <span
              key={s.key}
              className={`chiner-ai-pill${s.included === false ? ' is-off' : ''}`}
              title={s.description}
            >
              <span className="chiner-ai-pill-label">{s.label}</span>
              {s.included === false ? (
                onToggleScope && (
                  <button
                    type="button"
                    className="chiner-ai-pill-remove"
                    aria-label={t('picker.removeItem', {label: s.label})}
                    onClick={() => onToggleScope(s.key, true)}
                  >
                    <AiIcon name="plus" size={10}/>
                  </button>
                )
              ) : (
                s.removable !== false && onToggleScope && (
                  <button
                    type="button"
                    className="chiner-ai-pill-remove"
                    aria-label={t('picker.removeItem', {label: s.label})}
                    onClick={() => onToggleScope(s.key, false)}
                  >
                    <AiIcon name="close" size={10}/>
                  </button>
                )
              )}
            </span>
          ))}
        </div>
        <p className="chiner-ai-picker-note">{t('picker.scopeNote')}</p>

        <h4>{t('picker.pickTitle')}</h4>
        {groups.length === 0 && <div className="chiner-ai-picker-empty">{t('picker.empty')}</div>}
        {groups.map((g) => (
          <div key={g.id} className="chiner-ai-picker-group">
            <div className="chiner-ai-picker-grouptitle">{g.title}</div>
            {g.items.map((it) => (
              <label
                key={it.id}
                className={`chiner-ai-picker-item${it.disabled ? ' is-disabled' : ''}${it.selected ? ' is-selected' : ''}`}
                title={it.disabled ? it.disabledReason : (it.path || it.label)}
              >
                <input
                  type="checkbox"
                  checked={!!it.selected}
                  disabled={!!it.disabled}
                  onChange={() => onToggleItem && onToggleItem(g.id, it.id, !it.selected)}
                  aria-label={it.path ? `${it.label} ${it.path}` : it.label}
                />
                <span className="chiner-ai-picker-itemlabel">
                  <span>{it.label}</span>
                  {it.path && <small>{it.path}</small>}
                  {it.disabled && it.disabledReason && <small className="chiner-ai-picker-reason">{it.disabledReason}</small>}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="chiner-ai-picker-foot">
        <button type="button" className="chiner-ai-minibtn" onClick={onClose}>{t('picker.cancel')}</button>
        <button type="button" className="chiner-ai-minibtn chiner-ai-primary" onClick={onApply}>{t('picker.apply')}</button>
      </div>
    </div>
  );
};

export default React.memo(ContextPicker);
