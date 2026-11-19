import React, {useMemo, useRef, useState} from 'react';
import AiIcon from './icons';
import {createMessages} from './messages';
import {composerSendGate, PLAN_STATUS, TASK_STATUS} from './stateAdapter';

// 对话面板：建模检查器页签 / 绘图辅助浮层共用。
// 全部状态由 props 驱动；draft 受控，隐藏面板不丢草稿、不重发请求。
const AssistantPanel = ({
  locale = 'zh',
  labels,
  variant = 'inspector', // inspector | floating
  platform = 'modeling', // modeling | drawing（决定文案与方案说明）
  title,
  // 服务
  service = {status: 'unconfigured'},
  onOpenSettings,
  onOpenScopeInfo,
  // 上下文
  contextItems = [],
  onRemoveContext,
  onOpenContextPicker,
  // 对话（messages = 对话数组；文案覆盖用 labels，避免同名冲突）
  messages = [],
  draft,
  onDraftChange,
  onSend,
  generating = false,
  canStop = true,
  onStop,
  onRetry,
  // 任务
  taskStatus = TASK_STATUS.IDLE,
  steps = [],
  onNewTask,
  // 方案卡
  plan,
  onReviewPlan,
  onRevalidate,
}) => {
  const t = useMemo(() => createMessages(locale, labels), [locale, labels]);
  const composingRef = useRef(false);
  const [composing, setComposing] = useState(false);
  const [innerDraft, setInnerDraft] = useState('');
  const isControlledDraft = draft !== undefined && draft !== null;
  const draftValue = isControlledDraft ? draft : innerDraft;

  const setDraft = (value) => {
    if (!isControlledDraft) setInnerDraft(value);
    if (onDraftChange) onDraftChange(value);
  };

  const unconfigured = service.status === 'unconfigured';
  const serviceError = service.status === 'error';
  const sendBlocked = unconfigured || generating;

  const doSend = () => {
    const text = draftValue.trim();
    if (!text || sendBlocked || !onSend) return;
    onSend(text);
    setDraft('');
  };

  const onKeyDown = (e) => {
    const decision = composerSendGate(e, composingRef.current);
    if (decision === 'send') {
      e.preventDefault();
      doSend();
    }
    // newline：Shift+Enter 走 textarea 默认换行；compose：IME 组合期不动作
  };

  const planStatusKey = {
    [PLAN_STATUS.PENDING]: 'plan.pending',
    [PLAN_STATUS.STALE]: 'plan.stale',
    [PLAN_STATUS.APPLYING]: 'plan.applying',
    [PLAN_STATUS.APPLIED]: 'plan.applied',
  };

  const statusLine = () => {
    if (generating || taskStatus === TASK_STATUS.GENERATING) {
      return t('assistant.taskGenerating');
    } if (taskStatus === TASK_STATUS.CLARIFYING) {
      return t('assistant.taskGenerating');
    } if (taskStatus === TASK_STATUS.AWAITING_REVIEW && plan) {
      return t('assistant.taskAwaitingReview', {count: plan.reviewCount});
    } if (taskStatus === TASK_STATUS.APPLYING) {
      return t('assistant.taskApplying');
    } if (taskStatus === TASK_STATUS.APPLIED && plan) {
      return t('assistant.taskApplied', {count: plan.reviewCount});
    } if (taskStatus === TASK_STATUS.SAVE_FAILED) {
      return t('assistant.taskSaveFailed');
    } if (taskStatus === TASK_STATUS.ERROR) {
      return t('assistant.taskError', {message: ''});
    }
    return null;
  };

  const dotClass = unconfigured ? ' is-warn' : (serviceError ? ' is-error' : '');

  return (
    <div
      className={`chiner-ai-assistant${variant === 'floating' ? ' chiner-ai-floating' : ''}`}
      data-ai-variant={variant}
      data-ai-platform={platform}
      role="complementary"
      aria-label={t('assistant.region')}
    >
      <div className="chiner-ai-servicebar">
        <span className={`chiner-ai-dot${dotClass}`} aria-hidden="true"/>
        <span className="chiner-ai-servicename">
          {unconfigured ? t('assistant.serviceUnconfigured')
            : serviceError ? t('assistant.serviceUnavailable', {error: service.error || ''})
              : t('assistant.serviceReady', {alias: service.alias || ''})}
        </span>
        {unconfigured ? (
          <span className="chiner-ai-serviceactions">
            <button type="button" className="chiner-ai-linkbtn" onClick={onOpenSettings}>
              {t('assistant.configureService')}
            </button>
            {onOpenScopeInfo && (
              <button type="button" className="chiner-ai-linkbtn" onClick={onOpenScopeInfo}>
                {t('assistant.scopeInfo')}
              </button>
            )}
            {!onOpenScopeInfo && onOpenContextPicker && (
              <button type="button" className="chiner-ai-linkbtn" onClick={onOpenContextPicker}>
                {t('assistant.scopeInfo')}
              </button>
            )}
          </span>
        ) : (
          <button type="button" className="chiner-ai-linkbtn chiner-ai-end" onClick={onOpenSettings}>
            {t('provider.title')}
          </button>
        )}
      </div>

      <div className="chiner-ai-contextbar">
        {contextItems.map((item) => (
          <span
            key={item.id}
            className="chiner-ai-pill"
            title={item.metaSummary || item.label}
          >
            <span className="chiner-ai-pill-label">{item.label}</span>
            {item.removable !== false && onRemoveContext && (
              <button
                type="button"
                className="chiner-ai-pill-remove"
                aria-label={t('assistant.removeContext', {label: item.label})}
                onClick={() => onRemoveContext(item.id)}
              >
                <AiIcon name="close" size={10}/>
              </button>
            )}
          </span>
        ))}
        {onOpenContextPicker && (
          <button type="button" className="chiner-ai-pill chiner-ai-pill-add" onClick={onOpenContextPicker}>
            <AiIcon name="plus" size={10}/>
            <span>{t('assistant.addContext')}</span>
          </button>
        )}
      </div>

      <div className="chiner-ai-chat" role="log">
        {messages.length === 0 && !generating && (
          <div className="chiner-ai-emptyhint">{t('assistant.emptyHint')}</div>
        )}
        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="chiner-ai-message">
                {m.text}
                {(m.attachments || []).map((a, i) => (
                  <details key={i} className="chiner-ai-attachment">
                    <summary>
                      <AiIcon name="file" size={12}/>
                      <span className="chiner-ai-attach-name">{a.name}</span>
                      <span className="chiner-ai-attach-meta">{t('assistant.lines', {count: a.lines})}</span>
                    </summary>
                    {a.preview && <pre className="chiner-ai-attach-preview">{a.preview}</pre>}
                  </details>
                ))}
              </div>
            );
          }
          return (
            <div key={m.id} className={`chiner-ai-reply${m.error ? ' chiner-ai-reply-error' : ''}`}>
              <div className="chiner-ai-by">
                <AiIcon name="spark" size={13}/>
                <span>{t(platform === 'drawing' ? 'assistant.nameDrawing' : 'assistant.nameModeling')}</span>
              </div>
              {m.text && <div className="chiner-ai-replytext">{m.text}</div>}
              {(m.steps || []).length > 0 && (
                <div className="chiner-ai-steps">
                  {m.steps.map((s, i) => (
                    <div key={i} className={`chiner-ai-step is-${s.state || 'done'}`}>
                      <AiIcon name={s.state === 'active' ? 'chevron' : 'check'} size={12}/>
                      <span>{s.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.error && m.retryable && onRetry && (
                <button type="button" className="chiner-ai-minibtn" onClick={() => onRetry(m.id)}>
                  {t('assistant.retry')}
                </button>
              )}
            </div>
          );
        })}

        {(generating || taskStatus === TASK_STATUS.GENERATING) && (
          <div className="chiner-ai-statusline" role="status" aria-live="polite">
            <span>{t('assistant.taskGenerating')}</span>
            {canStop && onStop && (
              <button type="button" className="chiner-ai-minibtn" onClick={onStop}>
                {t('assistant.stop')}
              </button>
            )}
          </div>
        )}
        {!generating && statusLine() && taskStatus !== TASK_STATUS.GENERATING && (
          <div className="chiner-ai-statusline" role="status" aria-live="polite">
            <span>{statusLine()}</span>
          </div>
        )}
        {taskStatus === TASK_STATUS.SAVE_FAILED && (
          <div className="chiner-ai-statusline is-error" role="alert">
            <span>{t('assistant.taskSaveFailed')}</span>
          </div>
        )}

        {plan && (
          <div className={`chiner-ai-plancard is-${plan.status}`}>
            <div className="chiner-ai-planhead">
              <AiIcon name={platform === 'drawing' ? 'diagram' : 'file'} size={13}/>
              <span>{t('plan.title')}</span>
              <span className="chiner-ai-end chiner-ai-planstate">
                {t(planStatusKey[plan.status] || 'plan.pending')}
              </span>
            </div>
            <div className="chiner-ai-planbody">
              <strong>{plan.title}</strong>
              <dl>
                {(plan.summaryRows || []).map(([k, v], i) => (
                  <div key={i}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
              {plan.status === PLAN_STATUS.STALE ? (
                <>
                  <div className="chiner-ai-stalenote" role="status">
                    {t('plan.staleNote', {reason: plan.staleReason || ''})}
                  </div>
                  <button
                    type="button"
                    className="chiner-ai-blockbtn"
                    onClick={onRevalidate}
                    disabled={!onRevalidate}
                  >
                    {t('plan.revalidate')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="chiner-ai-blockbtn chiner-ai-primary"
                  onClick={() => onReviewPlan && onReviewPlan(plan)}
                  disabled={
                    plan.status !== PLAN_STATUS.PENDING
                    || generating
                    || taskStatus === TASK_STATUS.GENERATING
                    || taskStatus === TASK_STATUS.APPLYING
                    || taskStatus === TASK_STATUS.APPLIED
                    || !onReviewPlan
                  }
                >
                  {plan.actionKind === 'create-canvas'
                    ? t('plan.reviewCanvas')
                    : t('plan.review', {count: plan.reviewCount})}
                </button>
              )}
              <div className="chiner-ai-explain">
                {t(platform === 'drawing' ? 'plan.noteDrawing' : 'plan.noteModeling')}
              </div>
              {(plan.assumptions || []).map((a, i) => (
                <div key={i} className="chiner-ai-assumption">
                  <b>{t(a.kind === 'assume' ? 'plan.assume' : 'plan.needConfirm')}：</b>{a.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="chiner-ai-composer">
        <div className="chiner-ai-composebox">
          <textarea
            aria-label={t('assistant.inputLabel')}
            placeholder={t(platform === 'drawing' ? 'assistant.placeholderDrawing' : 'assistant.placeholderModeling')}
            value={draftValue}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => { composingRef.current = true; setComposing(true); }}
            onCompositionEnd={() => { composingRef.current = false; setComposing(false); }}
            data-ai-composing={composing ? 'true' : undefined}
          />
          <div className="chiner-ai-composeactions">
            {onOpenContextPicker && (
              <button type="button" className="chiner-ai-iconbtn" onClick={onOpenContextPicker} title={t('assistant.addContext')} aria-label={t('assistant.addContext')}>
                <AiIcon name="paperclip" size={13}/>
              </button>
            )}
            {/* UI-R2（msg_a70a9694728e）：onNewTask 此前只声明未渲染——有对话后
                暴露真实可达的“开始新任务”入口；generating 中禁用，不干扰停止语义 */}
            {onNewTask && messages.length > 0 && (
              <button
                type="button"
                className="chiner-ai-iconbtn"
                onClick={onNewTask}
                disabled={generating || taskStatus === TASK_STATUS.APPLYING}
                aria-label={t('assistant.newTaskIcon')}
                title={t('assistant.newTaskIcon')}
              >
                <AiIcon name="spark" size={13}/>
              </button>
            )}
            <span className="chiner-ai-hint">{t('assistant.hintShiftEnter')}</span>
            {generating ? (
              <button
                type="button"
                className="chiner-ai-sendbtn"
                onClick={onStop}
                disabled={!canStop || !onStop}
                aria-label={t('assistant.stopIcon')}
                title={t('assistant.stopIcon')}
              >
                <AiIcon name="stop" size={13}/>
              </button>
            ) : (
              <button
                type="button"
                className="chiner-ai-sendbtn chiner-ai-primary"
                onClick={doSend}
                disabled={sendBlocked || !draftValue.trim() || !onSend}
                aria-label={unconfigured ? t('assistant.sendDisabled') : t('assistant.send')}
                title={unconfigured ? t('assistant.sendDisabled') : t('assistant.send')}
              >
                <AiIcon name="send" size={13}/>
              </button>
            )}
          </div>
        </div>
        <div className="chiner-ai-composenote">
          {unconfigured ? t('assistant.serviceUnconfigured') : t(platform === 'drawing' ? 'assistant.noteDrawing' : 'assistant.noteModeling')}
        </div>
      </div>
    </div>
  );
};

export default React.memo(AssistantPanel);
