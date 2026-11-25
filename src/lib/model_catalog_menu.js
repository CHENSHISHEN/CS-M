// UX-02：资源树"新建"菜单的纯数据定义（不含文案与处理函数，由 ModelCatalog 按 key/action 绑定）。
// key 为稳定契约：root 总菜单与"企业概念模型"节点菜单的概念实体项共用同一 key/动作，
// 保证两处入口走同一条创建路径（ModelCatalog.createObject + 企业全局上下文）。

export const CATALOG_MENU_KEYS = Object.freeze({
  createConceptEntity: 'create:conceptEntity:conceptual',
  createConceptDiagram: 'create:diagram:conceptual',
  newLayer: 'newLayer',
  newDatabase: 'newDatabase',
});

// 每次返回新对象，调用方修改不影响下一次调用
const conceptEntityItem = () => ({
  key: CATALOG_MENU_KEYS.createConceptEntity, action: 'createObject', type: 'conceptEntity', level: 'conceptual',
});

// "企业概念模型"节点：新建 概念实体 / 新建 概念关系图
export function getConceptModelCreateMenu() {
  return [
    conceptEntityItem(),
    {key: CATALOG_MENU_KEYS.createConceptDiagram, action: 'createObject', type: 'diagram', level: 'conceptual'},
  ];
}

// root 选中时"+"总菜单：[新建 概念实体, 新建 数仓分层, 新建 数据库]
export function getRootCreateMenu() {
  return [
    conceptEntityItem(),
    {key: CATALOG_MENU_KEYS.newLayer, action: 'newLayer'},
    {key: CATALOG_MENU_KEYS.newDatabase, action: 'newDatabase'},
  ];
}
