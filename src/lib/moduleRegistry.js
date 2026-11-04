/**
 * 建模平台模块注册中心 (EXT-01)
 * 统一管理内置业务模块（数据建模、业务建模、画图平台）及其元数据、路由契约与就绪状态
 */

export const MODULE_IDS = {
  DATA: 'data-modeling',
  BUSINESS: 'business-modeling',
  DRAWING: 'drawing-platform',
};

const DEFAULT_MODULES = [
  {
    id: MODULE_IDS.DATA,
    key: 'data',
    nameKey: 'home.dataModeling',
    defaultName: '数据建模',
    subKey: 'home.dataModelingSubtitle',
    defaultSub: '概念 · 逻辑 · 物理模型',
    descKey: 'home.dataModelingDesc',
    defaultDesc: '支撑企业级数据架构设计，覆盖概念、逻辑到物理数据模型设计与 DDL 生成',
    actionKey: 'home.startModeling',
    defaultAction: '开始建模',
    accentColor: '#1890ff',
    tintColor: '#e6f7ff',
    borderColor: '#91d5ff',
    icon: 'table',
    isReady: true,
    kind: 'data-model',
  },
  {
    id: MODULE_IDS.BUSINESS,
    key: 'business',
    nameKey: 'home.businessModeling',
    defaultName: '业务建模',
    subKey: 'home.businessModelingSubtitle',
    defaultSub: '业务流程 · 业务对象 · 业务规则',
    descKey: 'home.businessModelingDesc',
    defaultDesc: '面向业务专家与产品经理，梳理业务流程、业务对象与业务规则，打通业务与数据',
    actionKey: 'home.planBusiness',
    defaultAction: '梳理业务',
    accentColor: '#13c2c2',
    tintColor: '#e6fffb',
    borderColor: '#87e8de',
    icon: 'flow',
    isReady: true,
    kind: 'business-model',
  },
  {
    id: MODULE_IDS.DRAWING,
    key: 'drawing',
    nameKey: 'home.drawingPlatform',
    defaultName: '画图平台',
    subKey: 'home.drawingPlatformSubtitle',
    defaultSub: '通用流程图 · 架构图 · 自由表达',
    descKey: 'home.drawingPlatformDesc',
    defaultDesc: '提供流程图、架构图、概念草图等自由绘图能力，可独立导出或复用于模型',
    actionKey: 'home.createDrawing',
    defaultAction: '创建图形',
    accentColor: '#fa8c16',
    tintColor: '#fff7e6',
    borderColor: '#ffd591',
    icon: 'grid',
    isReady: true,
    kind: 'drawing',
  },
];

class ModuleRegistry {
  constructor() {
    this.modules = new Map();
    DEFAULT_MODULES.forEach(m => this.modules.set(m.id, { ...m }));
  }

  getModules() {
    return Array.from(this.modules.values());
  }

  getModule(idOrKey) {
    if (!idOrKey) return null;
    if (this.modules.has(idOrKey)) {
      return this.modules.get(idOrKey);
    }
    for (const m of this.modules.values()) {
      if (m.key === idOrKey || m.kind === idOrKey) {
        return m;
      }
    }
    return null;
  }

  isModuleReady(idOrKey) {
    const mod = this.getModule(idOrKey);
    return Boolean(mod && mod.isReady);
  }

  registerModule(moduleDef) {
    if (!moduleDef || !moduleDef.id) {
      throw new Error('无效的模块注册定义：缺少 id');
    }
    this.modules.set(moduleDef.id, { ...moduleDef });
  }
}

export const moduleRegistry = new ModuleRegistry();
export default moduleRegistry;
