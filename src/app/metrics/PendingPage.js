import React, {useMemo, useState} from 'react';
import {FormatMessage, Message, Modal} from 'components';
import {metricApi} from './commands';

// 指标平台 M2：尚未接入页（部门口径/血缘/模型关联/语义字典/版本与变更）。
// 如实标注所属阶段与边界：不渲染任何模拟数据、按钮或假成功结果。
const PendingPage = ({titleKey, phaseKey, descKey}) => {
  return <section className='chiner-metrics-page' data-testid='metrics-pending-page'>
    <header className='chiner-metrics-page-header'>
      <h2><FormatMessage id={titleKey}/></h2>
      <span className='chiner-metrics-tag chiner-metrics-tag-warn'>
        <FormatMessage id='metrics.pending.badge'/>
      </span>
    </header>
    <div className='chiner-metrics-pending'>
      <div className='chiner-metrics-pending-icon' aria-hidden='true'>
        <svg width='34' height='34' viewBox='0 0 24 24' fill='none' stroke='currentColor'
          strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
          <path d='M4 6h16M4 12h10M4 18h7'/>
        </svg>
      </div>
      <h3><FormatMessage id={titleKey}/></h3>
      <p className='chiner-metrics-pending-phase'><FormatMessage id={phaseKey}/></p>
      <p><FormatMessage id={descKey}/></p>
      <p className='chiner-metrics-pending-note'><FormatMessage id='metrics.pending.note'/></p>
    </div>
  </section>;
};

export default React.memo(PendingPage);
