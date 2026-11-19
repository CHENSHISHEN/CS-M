import React, {useMemo} from 'react';
import AiIcon from './icons';
import {createMessages} from './messages';

// 候选预览面：渲染 prop（renderContent）接入现有模型关系图 / Chen 渲染器；
// 组件本身不画任何“看起来像正式对象”的图形——没有渲染器时显式空态。
// 常显“未应用”标记，与正式文档保存状态分离。
const CandidatePreview = ({
  locale = 'zh',
  labels,
  variant = 'modeling', // modeling | drawing
  title,
  existingRefs = [],
  candidateRefs = [],
  existingCount,
  candidateCount,
  meta = [],
  renderContent,
  footerNote,
  extraTag,
}) => {
  const t = useMemo(() => createMessages(locale, labels), [locale, labels]);
  const existing = existingCount != null ? existingCount : existingRefs.length;
  const candidates = candidateCount != null ? candidateCount : candidateRefs.length;
  const note = footerNote != null ? footerNote
    : t(variant === 'drawing' ? 'candidate.noteDrawing' : 'candidate.noteModeling');

  return (
    <div className="chiner-ai-candidate" data-ai-variant={variant}>
      <div className="chiner-ai-previewflag" role="status">
        <AiIcon name="spark" size={12}/>
        <span>{t('candidate.flag')}</span>
        {title && <span className="chiner-ai-muted">{` / ${title}`}</span>}
      </div>
      {extraTag && <span className="chiner-ai-previewtag">{extraTag || t('candidate.tagPreview')}</span>}

      <div className="chiner-ai-previewgraph" aria-label={`${t('candidate.flag')} ${title || ''}`}>
        {renderContent
          ? renderContent({existingRefs, candidateRefs})
          : (
            <div className="chiner-ai-norenderer" role="status">
              <AiIcon name="warn" size={14}/>
              <span>{t('candidate.noRenderer')}</span>
            </div>
          )}
      </div>

      <div className="chiner-ai-previewcounts">
        <span>{t('candidate.existing', {n: existing})}</span>
        <span className="chiner-ai-candidatesep">/</span>
        <span className="chiner-ai-blue">{t('candidate.candidateAdd', {n: candidates})}</span>
      </div>

      {meta.length > 0 && (
        <div className="chiner-ai-summarystrip">
          {meta.map((m, i) => (
            <span key={i}>{t('candidate.metaPrefix')}{m}</span>
          ))}
        </div>
      )}

      <p className="chiner-ai-graphnote">{note}</p>
    </div>
  );
};

export default React.memo(CandidatePreview);
