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

// 仅在编辑区没有打开的页签且（已加载的）项目为空时显示；只读不影响显示（由步骤定义隐藏写操作）
export function shouldShowEmptyStateGuide({dataSource, tabCount}) {
  return !!dataSource && !tabCount && isProjectEmpty(dataSource);
}

// 打开项目时是否自动打开企业首页封面：绘图/业务平台项目保持原初始工作区（不打开）；
// 空项目不打开，让编辑区显示三步引导（用户可随时手动打开封面）；其余数据建模项目照旧打开。
// 只按已加载的数据源判断：数据源缺失时保持原行为（打开）。
export function shouldAutoOpenHomeCover({module, dataSource}) {
  if (module === 'drawing' || module === 'business') return false;
  return !(dataSource && isProjectEmpty(dataSource));
}

// 三步：① 新建概念实体 ② 生成逻辑/物理模型 ③ 导出文档。
// 第②步：已有逻辑实体 → 直接打开前向工程向导；否则先新建逻辑实体并提示原因。
// 第③步：空项目只会导出空文档，不给按钮，提示“建模后可用”。
// 只读：三步均不给动作按钮（与顶栏只读时禁用“导出”一致——导出 Word 的模板确认会走保存路径）。
export function getEmptyStateGuideSteps({dataSource, readOnly}) {
  const hasLogic = !!(dataSource && dataSource.logicEntities && dataSource.logicEntities.length);
  const write = (action, actionKey, extra) => (readOnly ? {action: null} : {action, actionKey, ...extra});
  const exportStep = isProjectEmpty(dataSource)
    ? (readOnly ? {action: null} : {action: null, hintKey: 'onboarding.export.hintEmpty'})
    : write(ONBOARDING_ACTIONS.exportDocument, 'onboarding.export.action');
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
      ...exportStep,
    },
  ];
}
