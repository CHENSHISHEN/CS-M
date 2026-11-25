// UX-02：空项目三步引导的纯逻辑（是否显示、每步文案键与动作），由 EmptyStateGuide 渲染。

// "空项目"：没有任何模型对象——概念实体、逻辑实体、物理表、视图、关系图均为空。
// 分层/数据域目录、字典、数据域、类型配置等不算模型内容（新建空项目自带数据域等配置）。
const MODEL_COLLECTIONS = ['conceptEntities', 'logicEntities', 'entities', 'views', 'diagrams'];

export const ONBOARDING_ACTIONS = Object.freeze({
  createConceptEntity: 'createConceptEntity',
  createLogicEntity: 'createLogicEntity',
  forwardEngineering: 'forwardEngineering',
  exportDocument: 'exportDocument',
});

export function isProjectEmpty(dataSource) {
  const ds = dataSource || {};
  return MODEL_COLLECTIONS.every(name => !(ds[name] && ds[name].length));
}

// 仅在编辑区没有打开的页签且项目为空时显示；只读不影响显示（由步骤定义隐藏写操作）
export function shouldShowEmptyStateGuide({dataSource, tabCount}) {
  return !tabCount && isProjectEmpty(dataSource);
}

// 三步：① 新建概念实体 ② 生成逻辑/物理模型 ③ 导出文档。
// 第②步：已有逻辑实体 → 直接打开前向工程向导；否则先新建逻辑实体并提示原因。
// 只读：①② 不给动作按钮，③ 导出文档为只读安全操作保留。
export function getEmptyStateGuideSteps({dataSource, readOnly}) {
  const hasLogic = !!(dataSource && dataSource.logicEntities && dataSource.logicEntities.length);
  const write = (action, actionKey, extra) => (readOnly ? {action: null} : {action, actionKey, ...extra});
  return [
    {
      key: 'concept',
      titleKey: 'onboarding.concept.title',
      descKey: 'onboarding.concept.desc',
      ...write(ONBOARDING_ACTIONS.createConceptEntity, 'onboarding.concept.action'),
    },
    {
      key: 'model',
      titleKey: 'onboarding.model.title',
      descKey: 'onboarding.model.desc',
      ...(hasLogic
        ? write(ONBOARDING_ACTIONS.forwardEngineering, 'onboarding.model.action')
        : write(ONBOARDING_ACTIONS.createLogicEntity, 'onboarding.model.actionNoLogic',
          {hintKey: 'onboarding.model.hintNoLogic'})),
    },
    {
      key: 'export',
      titleKey: 'onboarding.export.title',
      descKey: 'onboarding.export.desc',
      action: ONBOARDING_ACTIONS.exportDocument,
      actionKey: 'onboarding.export.action',
    },
  ];
}
