import React, {useEffect, useMemo, useRef, useState} from 'react';
import AiIcon from './icons';
import {createMessages} from './messages';
import {deriveApplyState, dependentIds, PLAN_STATUS} from './stateAdapter';

// UI-R2（协调者 msg_c7ea57c1a78b）：审阅弹窗 position:fixed 被检查器/绘图 aux
// 等祖先的 transform/overflow 当作包含块捕获，整卡被裁进侧栏。真实 GUI 挂载时
// portal 到 document.body（body 带 data-ui=workbench 的 --wb-* token，明暗主题
// 继续生效；焦点/Esc 监听仍挂在 document，不受 portal 影响）。SSR/组件测试环境
// 无 DOM 时保持内联渲染，renderToStaticMarkup 断言不受影响。
let createPortalToBody = null;
try {
  // eslint-disable-next-line global-require
  createPortalToBody = require('react-dom').createPortal;
} catch (e) {
  createPortalToBody = null;
}

// 三栏变更审阅弹窗：勾选/映射由父级持有，关闭或 Esc 不提交且不丢状态；
// 阻断未解决时按钮禁用并写明原因；applying 中不可关闭（本地原子提交不可半路取消）。
const ChangeReview = ({
  locale = 'zh',
  labels,
  visible = false,
  onClose,
  onBackToChat,
  plan,
  items = [],
  onToggleItem,
  activeItemId,
  onSelectItem,
  getDiff,
  mappings = [],
  onMappingChange,
  blockingIssues = [],
  applying = false,
  generating = false,
  onApply,
}) => {
  const t = useMemo(() => createMessages(locale, labels), [locale, labels]);
  const dialogRef = useRef(null);
  const [activeTab, setActiveTab] = useState('fields');
  const [depNotice, setDepNotice] = useState(null);

  const applyState = useMemo(
    () => deriveApplyState({plan, items, mappings, applying, generating}),
    [plan, items, mappings, applying, generating],
  );

  useEffect(() => {
    if (!visible) {
      setDepNotice(null);
      return undefined;
    }
    if (typeof document === 'undefined') return undefined;
    const prev = document.activeElement;
    if (dialogRef.current) dialogRef.current.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !applying) {
        e.stopPropagation();
        if (onClose) onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (prev && prev.focus) prev.focus();
    };
  }, [visible, applying, onClose]);

  if (!visible) return null;

  const currentId = activeItemId
    || (items.length > 0 ? items[0].id : null);
  const activeItem = items.find((i) => i.id === currentId) || null;
  const diff = (activeItem && getDiff) ? (getDiff(activeItem.id) || {}) : {};
  const fieldRows = diff.fieldRows || [];
  const depChips = diff.dependencyChips || [];
  const pendingMappings = mappings.filter((m) => !m.value);

  const handleToggle = (item) => {
    if (!onToggleItem) return;
    const next = !item.selected;
    let affected = [];
    if (!next) {
      // 取消父依赖：计算仍被选中的直接子项，展示受影响范围
      affected = dependentIds(items, item.id)
        .filter((id) => {
          const child = items.find((i) => i.id === id);
          return child && child.selected;
        });
      if (affected.length > 0) {
        setDepNotice(t('review.depNotice', {
          label: item.label,
          items: affected
            .map((id) => (items.find((i) => i.id === id) || {}).label)
            .filter(Boolean)
            .join('、'),
        }));
      } else {
        setDepNotice(null);
      }
    } else {
      setDepNotice(null);
    }
    onToggleItem(item.id, next, affected);
  };

  const firstBlocker = applyState.blockers[0];
  const blockerText = () => {
    if (applying) return t('review.applying');
    const b = firstBlocker;
    if (!b) return null;
    switch (b.kind) {
      case 'mapping':
        return t('review.blockedMapping', {n: applyState.blockers.filter((x) => x.kind === 'mapping').length});
      case 'dependency':
        return t('review.blockedDependency', {label: b.label, dep: b.depLabel});
      case 'dependencyMissing':
        return t('review.blockedDependencyMissing', {label: b.label, dep: b.depId});
      case 'item': {
        // UI-R2：条目阻断要能定位——优先给出该项真实 issue 的 code/message，
        // 而不是只说“存在未解决问题”（issues 由集成面板从 candidate 挂到条目上）
        const blockedItem = items.find((i) => i.id === b.id);
        const issue = blockedItem && Array.isArray(blockedItem.issues) ? blockedItem.issues[0] : null;
        if (issue) {
          return t('review.blockedItemIssue', {label: b.label, code: issue.code || '', message: issue.message || ''});
        }
        return t('review.blockedItem', {label: b.label});
      }
      case 'stale':
        return t('review.blockedStale');
      case 'applyingPlan':
        return t('review.blockedApplying');
      case 'appliedPlan':
        return t('review.blockedApplied');
      case 'generating':
        return t('review.blockedGenerating');
      case 'empty':
        return t('review.blockedEmpty');
      default:
        return t('review.blockedUnknownPlan');
    }
  };

  const kindLabel = {new: 'review.kindNew', modified: 'review.kindModified', deleted: 'review.kindDeleted', warning: 'review.kindWarning'};
  const kindPrefix = {new: '+ ', modified: '≈ ', deleted: '− ', warning: '! '};

  const applyLabel = applyState.canApply
    ? t('review.apply', {n: applyState.selectedCount})
    : t('review.applyBlocked', {n: applyState.blockers.filter((x) => x.kind !== 'empty').length || 1});

  const overlay = (
    <div
      className="chiner-ai-review-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !applying && onClose) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="chiner-ai-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chiner-ai-review-title"
        tabIndex={-1}
      >
        <header className="chiner-ai-dialoghead">
          <AiIcon name="file" size={15}/>
          <strong id="chiner-ai-review-title">{t('review.title')}</strong>
          <span className="chiner-ai-tag">{t('review.tagNotApplied')}</span>
          <span className="chiner-ai-end"/>
          <button
            type="button"
            className="chiner-ai-iconbtn"
            onClick={onClose}
            disabled={applying}
            aria-label={t('review.close')}
            title={t('review.close')}
          >
            <AiIcon name="close" size={14}/>
          </button>
        </header>

        <div className="chiner-ai-dialogmeta">
          <span>{plan ? plan.title : ''}</span>
          <span className="chiner-ai-muted">/</span>
          <span className="chiner-ai-muted">
            {/* UI-R2：candidate.counts 合同键是 remove（create/update/remove/reuse），
                历史宿主可能传 delete —— 两者对齐，绝不出“删除 undefined 条” */}
            {(() => {
              const counts = (plan && plan.counts) || {};
              const removeCount = counts.remove != null ? counts.remove : (counts.delete || 0);
              return <>{t('review.countCreate', {n: counts.create || 0})}
                {t('review.countUpdate', {n: counts.update || 0})}
                {t('review.countDelete', {n: removeCount})}</>;
            })()}
          </span>
          {pendingMappings.length > 0 && (
            <span className="chiner-ai-end chiner-ai-tag chiner-ai-tagwarn">
              {t('review.pendingTitle', {n: pendingMappings.length})}
            </span>
          )}
        </div>

        {plan && plan.status === PLAN_STATUS.STALE && (
          <div className="chiner-ai-stalebanner" role="alert">
            <AiIcon name="warn" size={13}/>
            {t('review.staleBanner', {reason: plan.staleReason || ''})}
          </div>
        )}

        {/* UI-R2：阻断诊断可理解——直接列出 candidate.blockingIssues 的真实
            code/message（有 opId 时标出定位），不能只汇总成“先处理 n 项” */}
        {blockingIssues.filter((i) => i && i.level !== 'warning').length > 0 && (
          <div className="chiner-ai-blockinglist" role="alert">
            <AiIcon name="warn" size={13}/>
            <div>
              <b>{t('review.blockingTitle')}</b>
              <ul>
                {blockingIssues.filter((i) => i && i.level !== 'warning').slice(0, 8).map((issue, i) => (
                  <li key={i}>
                    <span className="chiner-ai-mono">
                      {t('review.blockingItem', {code: issue.code || 'UNKNOWN', message: issue.message || ''})}
                    </span>
                    {issue.opId && <span className="chiner-ai-blockingat">
                      {t('review.blockingAt', {opId: issue.opId})}
                    </span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="chiner-ai-reviewbody">
          <section className="chiner-ai-changelist" aria-label={t('review.listTitle', {n: items.length})}>
            <h3>{t('review.listTitle', {n: items.length})}</h3>
            {items.map((item) => (
              <div
                key={item.id}
                className={`chiner-ai-changeitem${item.id === currentId ? ' is-active' : ''}${item.warn ? ' has-warn' : ''}`}
                role="listitem"
              >
                <input
                  type="checkbox"
                  checked={!!item.selected}
                  disabled={applying}
                  onChange={() => handleToggle(item)}
                  aria-label={item.label}
                />
                <span
                  className="chiner-ai-changeitem-text"
                  onClick={() => onSelectItem && onSelectItem(item.id)}
                >
                  {item.category}
                  {item.label && <small>{item.label}</small>}
                </span>
                {item.warn && (
                  <span className="chiner-ai-tag chiner-ai-tagwarn" title={t('review.itemPendingTag')}>
                    !
                  </span>
                )}
                {/* UI-R2：阻断项给可见标记；title 带真实 issue code/message 定位 */}
                {item.blocked && (
                  <span
                    className="chiner-ai-tag chiner-ai-tagwarn"
                    title={(Array.isArray(item.issues) && item.issues.length
                      ? item.issues.map((issue) => `${issue.code || 'UNKNOWN'}: ${issue.message || ''}`).join('\n')
                      : t('review.itemPendingTag'))}
                  >
                    !
                  </span>
                )}
              </div>
            ))}
            <p className="chiner-ai-explain">{t('review.depHint')}</p>
            {depNotice && <div className="chiner-ai-depnotice" role="status">{depNotice}</div>}
          </section>

          <section className="chiner-ai-diff" aria-label={t('review.tabFields')}>
            {activeItem ? (
              <>
                <h1 className="chiner-ai-difftitle">
                  <span className="chiner-ai-mono">{activeItem.label || activeItem.category}</span>
                  <span className={`chiner-ai-tag chiner-ai-kind-${diff.kind || 'new'}`}>
                    {t(kindLabel[diff.kind] || 'review.kindNew')}
                  </span>
                </h1>
                {activeItem.path && <div className="chiner-ai-tiny chiner-ai-muted">{activeItem.path}</div>}
                <div className="chiner-ai-difftabs" role="tablist">
                  {[['fields', 'review.tabFields'], ['deps', 'review.tabDeps'], ['notes', 'review.tabNotes']].map(([key, msg]) => (
                    <span
                      key={key}
                      role="tab"
                      aria-selected={activeTab === key}
                      className={activeTab === key ? 'is-active' : ''}
                      onClick={() => setActiveTab(key)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') setActiveTab(key);
                      }}
                    >
                      {t(msg)}
                    </span>
                  ))}
                </div>

                {activeTab === 'fields' && (
                  <table className="chiner-ai-difftable">
                    <thead>
                      <tr>
                        <th style={{width: '25%'}}>{t('review.colAttr')}</th>
                        <th style={{width: '21%'}}>{t('review.colCurrent')}</th>
                        <th>{t('review.colCandidate')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fieldRows.map((row, i) => (
                        <tr key={i}>
                          <td>{row.attr}</td>
                          <td className="chiner-ai-muted">{row.current == null ? '—' : row.current}</td>
                          <td className={`chiner-ai-cell-${row.kind}`}>
                            <span aria-hidden="true">{kindPrefix[row.kind] || ''}</span>
                            {row.candidate}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {activeTab === 'notes' && (
                  <div className="chiner-ai-diffnotes chiner-ai-muted">{diff.notes || '—'}</div>
                )}

                {diff.warning && (
                  <div className="chiner-ai-warning" role="alert">
                    <b>{diff.warning.title}</b>
                    {diff.warning.body && <br/>}
                    {diff.warning.body}
                  </div>
                )}
                {activeTab !== 'deps' && (
                  <div className="chiner-ai-dependencies">
                    <div>{t('review.depsOfItem')}</div>
                    <div className="chiner-ai-depchips">
                      {depChips.length === 0 ? <span className="chiner-ai-muted">—</span>
                        : depChips.map((c, i) => <span key={i} className="chiner-ai-pill">{c}</span>)}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="chiner-ai-muted">{t('review.diffEmpty')}</div>
            )}
          </section>

          <aside className="chiner-ai-reviewinfo">
            <h3>{t('review.scopeTitle')}</h3>
            {((plan && plan.scopeRows) || []).map(([k, v], i) => (
              <div key={i} className="chiner-ai-inforow"><span>{k}</span><b>{v}</b></div>
            ))}
            {mappings.length > 0 && (
              <div className="chiner-ai-infosection">
                <h3>{t('review.pendingTitle', {n: pendingMappings.length})}</h3>
                {mappings.map((m) => (
                  <div key={m.id} className="chiner-ai-mapping">
                    <label className="chiner-ai-tiny chiner-ai-muted" htmlFor={`chiner-ai-map-${m.id}`}>{m.label}</label>
                    <select
                      id={`chiner-ai-map-${m.id}`}
                      value={m.value || ''}
                      disabled={applying}
                      aria-label={m.label}
                      onChange={(e) => onMappingChange && onMappingChange(m.id, e.target.value)}
                    >
                      <option value="">{m.placeholder || '…'}</option>
                      {(m.options || []).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
                <p>{t('review.mappingNote')}</p>
              </div>
            )}
            <div className="chiner-ai-infosection">
              <h3>{t('review.execTitle')}</h3>
              <p>{plan && plan.saveMode === 'drawing-autosave' ? t('review.execDrawing') : t('review.execProjectDraft')}</p>
            </div>
          </aside>
        </div>

        <footer className="chiner-ai-dialogfoot">
          <div className="chiner-ai-savehint">
            <strong>{t('review.selectedCount', {n: applyState.selectedCount})}</strong>
            <span>{blockerText() || (plan && plan.saveMode === 'drawing-autosave'
              ? t('review.saveHintDrawing') : t('review.saveHintProject'))}</span>
          </div>
          <span className="chiner-ai-end"/>
          <button type="button" className="chiner-ai-minibtn" onClick={onBackToChat} disabled={applying || !onBackToChat}>
            {t('review.back')}
          </button>
          <button
            type="button"
            className="chiner-ai-minibtn chiner-ai-primary"
            disabled={!applyState.canApply || !onApply}
            onClick={() => onApply && onApply()}
          >
            {applying ? t('review.applying') : applyLabel}
          </button>
        </footer>
      </section>
    </div>
  );
  if (createPortalToBody && typeof document !== 'undefined' && document.body) {
    return createPortalToBody(overlay, document.body);
  }
  return overlay;
};

export default React.memo(ChangeReview);
