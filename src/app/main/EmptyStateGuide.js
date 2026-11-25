import React from 'react';

import { FormatMessage } from 'components';
import { getEmptyStateGuideSteps } from '../../lib/onboarding';

// UX-02：空项目编辑区三步引导（① 新建概念实体 ② 生成逻辑/物理模型 ③ 导出文档）。
// 是否显示由宿主按 shouldShowEmptyStateGuide 决定；按钮只调用宿主传入的既有入口：
// onAction(action) 的 action 取自 ONBOARDING_ACTIONS。只读时步骤定义不给写操作按钮。
export default React.memo(({prefix, dataSource, readOnly, onAction, openHome}) => {
  const steps = getEmptyStateGuideSteps({dataSource, readOnly});
  const cls = `${prefix}-main-guide`;
  return <div className={cls}>
    <div className={`${cls}-head`}>
      <h2><FormatMessage id='onboarding.title'/></h2>
      <p><FormatMessage id='onboarding.subtitle'/></p>
      {readOnly && <p className={`${cls}-readonly`}><FormatMessage id='onboarding.readOnlyHint'/></p>}
    </div>
    <ol className={`${cls}-steps`}>
      {steps.map((step, index) => <li key={step.key} className={`${cls}-step`}>
        <span className={`${cls}-step-no`} aria-hidden='true'>{index + 1}</span>
        <strong className={`${cls}-step-title`}>{FormatMessage.string({id: step.titleKey})}</strong>
        <span className={`${cls}-step-desc`}>{FormatMessage.string({id: step.descKey})}</span>
        {step.hintKey && <span className={`${cls}-step-hint`}>{FormatMessage.string({id: step.hintKey})}</span>}
        {step.action && <button
          type='button'
          className={`${cls}-step-action`}
          onClick={() => onAction && onAction(step.action)}
        >
          {FormatMessage.string({id: step.actionKey})}
        </button>}
      </li>)}
    </ol>
    <button type='button' className={`${cls}-home`} onClick={openHome}>
      <FormatMessage id='quick.home'/>
    </button>
  </div>;
});
