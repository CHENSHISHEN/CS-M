// 工作台外壳导航定义：只映射现有主容器 menuType，不引入第二套切换状态
// menuType 对应 src/app/main/index.js 左侧 Tab：1模型 2类型设置 3代码 4版本 5规则检查 6数据标准

// S3：经典布局已从源码剥离，布局枚举/本地偏好键/切换事件全部移除；
// 新工作台为唯一布局，旧本机经典偏好不再参与任何入口


// WB-003①：工作台资源树宽度是本机视图偏好，存独立本地键（不进 pdma 模型，
// 不写 profile.menuWidth，拖动不触发保存/dirty）
export const WORKBENCH_SIDEBAR_WIDTH_CACHE_KEY = 'workbench.sidebarWidth';
export const WB_SIDEBAR_MIN = 220;
export const WB_SIDEBAR_MAX = 520;
export const WB_EDITOR_MIN = 480;

// 读取持久化的偏好宽度；存储非法/不可用时回落默认 240
export const readWorkbenchSidebarWidth = (getCache) => {
  try {
    const stored = parseFloat(getCache && getCache(WORKBENCH_SIDEBAR_WIDTH_CACHE_KEY));
    return Number.isFinite(stored) && stored >= WB_SIDEBAR_MIN && stored <= WB_SIDEBAR_MAX
      ? stored : 240;
  } catch (e) {
    return 240;
  }
};

export const writeWorkbenchSidebarWidth = (setCache, width) => {
  try {
    setCache && setCache(WORKBENCH_SIDEBAR_WIDTH_CACHE_KEY, String(width));
  } catch (e) {
    // 偏好持久化失败不影响本次会话
  }
};

// S1 R5：首次自适应宽度。自动估算与手调偏好分离存储：
// - 手调偏好 = 原全局键 workbench.sidebarWidth（用户拖动/键盘写入，最高优先）；
// - 自动估算 = 按项目键 workbench.sidebarWidth.auto.<projectKey> 只写一次，
//   不进手调键、不触发保存/dirty；重开/切模块/改名不重复测量。
export const readWorkbenchSidebarManualWidth = (getCache) => {
  try {
    const raw = getCache && getCache(WORKBENCH_SIDEBAR_WIDTH_CACHE_KEY);
    if (raw == null) return null;
    const stored = parseFloat(raw);
    return Number.isFinite(stored) && stored >= WB_SIDEBAR_MIN && stored <= WB_SIDEBAR_MAX
      ? stored : null;
  } catch (e) {
    return null;
  }
};

const WORKBENCH_SIDEBAR_AUTO_CACHE_KEY = 'workbench.sidebarWidth.auto';

export const projectSidebarAutoKey = (projectKey) =>
  `${WORKBENCH_SIDEBAR_AUTO_CACHE_KEY}.${projectKey}`;

export const readWorkbenchSidebarAutoWidth = (getCache, projectKey) => {
  try {
    const raw = getCache && getCache(projectSidebarAutoKey(projectKey));
    if (raw == null) return null;
    const stored = parseFloat(raw);
    return Number.isFinite(stored) && stored >= WB_SIDEBAR_MIN && stored <= WB_SIDEBAR_MAX
      ? stored : null;
  } catch (e) {
    return null;
  }
};

export const writeWorkbenchSidebarAutoWidth = (setCache, projectKey, width) => {
  try {
    setCache && setCache(projectSidebarAutoKey(projectKey), String(width));
  } catch (e) {
    // 自动估算持久化失败不影响本次会话
  }
};

// 首次宽度 = 文本宽 + 固定装饰宽，下限260、上限 min(480, 视口35%)；
// 结果仍需经 clampWorkbenchSidebarWidth 服从窗口布局钳制
export const WORKBENCH_SIDEBAR_FIRST_ENTRY_MIN = 260;
export const calcFirstEntrySidebarWidth = (contentWidth, windowInnerWidth) => Math.round(
  Math.max(WORKBENCH_SIDEBAR_FIRST_ENTRY_MIN, Math.min(480,
    Math.min(contentWidth, windowInnerWidth * 0.35))));

// S1 整改 F5：首宽测量的一级行种类与选择器（与 ModelCatalog 行 data-catalog-kind 对齐）。
// 除根分层/概念模型/待归档分区自身外，必须包含分类行——待归档下首次可见的
// 旧主题域真实名称（getCatalogCategories 投影的 legacy 分类）由此测量，
// 不能只量"待归档"三个字。S3：概念模型提升根级；S3整改：全局概览根已移除。
export const FIRST_ENTRY_MEASURE_ROW_KINDS = ['layer', 'conceptModel', 'pending', 'category'];
export const firstEntryMeasureRowSelector = () => FIRST_ENTRY_MEASURE_ROW_KINDS
  .map(kind => `[data-catalog-kind="${kind}"]`).join(',');

// 首测重试预算：每次 fonts.ready+rAF 实际尝试消耗一次；只防异常场景下的
// 无限重试，正常模块切换/筛选清除远用不完
export const FIRST_ENTRY_MEASURE_MAX_ATTEMPTS = 60;

// S1 整改 F5：首测执行决策（纯函数）：
// - stop(manual)：手调偏好已存在（含异步等待期间新出现），永不自动测宽/覆盖；
// - restore：本项目已有自动估算，直接采用；
// - stop(exhausted)：重试预算耗尽；
// - defer(filter|no-rows)：筛选生效或目录未渲染（如用户先进入其他模块），
//   本次不测且【不置 firstSized】，由 menuType/筛选/目录渲染变化触发有界重试，
//   不永久吞掉首次模型测量；
// - measure：一级行齐备，执行真实测量（测成才由调用方置 firstSized）。
export const planFirstEntryMeasure = ({manualWidth, storedAutoWidth, filterActive,
  firstLevelRowCount, attempts, maxAttempts = FIRST_ENTRY_MEASURE_MAX_ATTEMPTS}) => {
  if (manualWidth != null) return {action: 'stop', reason: 'manual'};
  if (storedAutoWidth != null) return {action: 'restore', width: storedAutoWidth};
  if (attempts != null && attempts >= maxAttempts) return {action: 'stop', reason: 'exhausted'};
  if (filterActive) return {action: 'defer', reason: 'filter'};
  if (firstLevelRowCount != null && !firstLevelRowCount) {
    return {action: 'defer', reason: 'no-rows'};
  }
  return {action: 'measure'};
};

// 当前窗口下允许的最大资源树宽：主栏64 + 编辑区下限 + （展开时的属性面板）
export const clampWorkbenchSidebarWidth = (width, windowInnerWidth, inspectorWidth) => {
  const maxAllow = windowInnerWidth - 64 - WB_EDITOR_MIN - (inspectorWidth || 0);
  return Math.round(Math.min(WB_SIDEBAR_MAX, Math.max(WB_SIDEBAR_MIN,
    Math.min(width, Math.max(WB_SIDEBAR_MIN, maxAllow)))));
};

export const WORKBENCH_INSPECTOR_WIDTH_CACHE_KEY = 'workbench.inspectorWidth';
export const WB_INSPECTOR_MIN = 260;
export const WB_INSPECTOR_MAX = 560;

export const readWorkbenchInspectorWidth = (getCache) => {
  try {
    const stored = parseFloat(getCache && getCache(WORKBENCH_INSPECTOR_WIDTH_CACHE_KEY));
    return Number.isFinite(stored) && stored >= WB_INSPECTOR_MIN && stored <= WB_INSPECTOR_MAX
      ? stored : 320;
  } catch (e) {
    return 320;
  }
};

export const writeWorkbenchInspectorWidth = (setCache, width) => {
  try {
    setCache && setCache(WORKBENCH_INSPECTOR_WIDTH_CACHE_KEY, String(width));
  } catch (e) {
    // 偏好持久化失败不影响本次会话。
  }
};

export const clampWorkbenchInspectorWidth = (width, windowInnerWidth) => {
  const maxAllow = Math.max(WB_INSPECTOR_MIN,
    windowInnerWidth - 64 - WB_SIDEBAR_MIN - WB_EDITOR_MIN);
  return Math.round(Math.max(WB_INSPECTOR_MIN, Math.min(width, WB_INSPECTOR_MAX, maxAllow)));
};


// 主域导航按项目模块门控（DATA-WB-FEAT-001 整改 F2）：
// - 数据建模平台（module 为 data 或旧项目缺失）：应用新数据轨——左轨不含
//   业务建模/画图平台入口，新增“数据库”工作区（menuType 9）；
// - 独立业务/绘图项目（module=business/drawing）：保留原导航行为与原顶部
//   数据库入口，本轮不改其平台源码。
// 全局项目首页三平台入口不受此影响。
export const isDataWorkbenchModule = (module) => module !== 'drawing' && module !== 'business';

const DATA_WORKBENCH_PRIMARY_NAVS = () => ([
  // 类型设置(menuType 2)复用编辑Tab，仍归属模型主域
  {id: 'model', menuType: '1', icon: 'fa-table', activeMenuTypes: ['1', '2']},
  // S3：资源总览（menuType 10）——真实统计面板，独立左轨入口
  {id: 'overview', menuType: '10', icon: 'fa-tachometer', activeMenuTypes: ['10']},
  // M2：指标平台（menuType 11）——独立全宽模块，与数据建模共享同一项目模型与
  // 元数据（module=data 身份不变，切换入口不写 dataSource.module）
  {id: 'metrics', menuType: '11', icon: 'fa-line-chart', activeMenuTypes: ['11']},
  {id: 'database', menuType: '9', icon: 'fa-database', activeMenuTypes: ['9']},
  // 与旧布局一致：只读模式隐藏数据标准与版本入口（对应旧 TabItem key=6/4 的 hidden 语义）
  {id: 'standard', menuType: '6', icon: 'fa-book', activeMenuTypes: ['6'], readOnlyHidden: true},
  {id: 'delivery', menuType: '3', icon: 'fa-code', activeMenuTypes: ['3']},
  {id: 'versions', menuType: '4', icon: 'fa-history', activeMenuTypes: ['4'], readOnlyHidden: true},
]);

const LEGACY_WORKBENCH_PRIMARY_NAVS = () => ([
  {id: 'model', menuType: '1', icon: 'fa-table', activeMenuTypes: ['1', '2']},
  {id: 'business', menuType: '8', icon: 'fa-briefcase', activeMenuTypes: ['8']},
  {id: 'drawing', menuType: '7', icon: 'fa-sitemap', activeMenuTypes: ['7']},
  {id: 'standard', menuType: '6', icon: 'fa-book', activeMenuTypes: ['6'], readOnlyHidden: true},
  {id: 'delivery', menuType: '3', icon: 'fa-code', activeMenuTypes: ['3']},
  {id: 'versions', menuType: '4', icon: 'fa-history', activeMenuTypes: ['4'], readOnlyHidden: true},
]);

export const getWorkbenchPrimaryNavs = (module) =>
  (isDataWorkbenchModule(module)
    ? DATA_WORKBENCH_PRIMARY_NAVS() : LEGACY_WORKBENCH_PRIMARY_NAVS());

// 整改 F3：工作台属性面板的“实际可见性”派生。首页文档（tab type 'home'）、
// 数据库工作区（menuType 9）、资源总览（menuType 10）与指标平台（menuType 11，
// M2：指标模块整页占位、无对象上下文）不渲染属性面板，根网格必须同步收起右侧
// 空列（GUI 按工作区右边界验收，不能只看 aside DOM 不存在）。
// wbInspectorOpen 用户偏好不被重置：回到模型/类型文档即按原开合恢复。
// 绘图/业务平台（menuType 7/8）布局保持原样，不受 home 文档激活影响。
export const workbenchInspectorHidden = ({menuType, activeTabType, inspectorOpen, forceVisible}) =>
  !inspectorOpen || (forceVisible !== true
    && ((menuType === '9' || menuType === '10' || menuType === '11' || activeTabType === 'home') && menuType !== '7' && menuType !== '8'));
// forceVisible（INTEGRATION-R1）：更多→AI 强制打开时，即使处于首页/数据库工作区/
// 资源总览（常规隐藏属性面板的上下文）也必须实际可见——只靠挂载不够，
// no-inspector 的 display:none 会把挂载的面板整个藏掉。

// S3整改：资源总览（menuType 10）上下文收起模型资源栏——总览下该栏只有标题无资源
// 内容却占 --wb-sidebar-w 宽度。收起仅是呈现层：宽度状态与本机偏好不读不写，
// 返回模型域即按原宽度恢复；64px 左轨（wb-rail）保留，绘图/业务平台不受影响。
// M2：指标平台（menuType 11）同理收起模型资源栏（指标模块使用自己的 208px 二级导航）。
export const workbenchSidebarHidden = ({menuType}) => menuType === '10' || menuType === '11';

// 次级导航：不占主域位，但保持清晰可达
export const getWorkbenchSecondaryNavs = () => ([
  {id: 'datatype', menuType: '2', icon: 'fa-cube', activeMenuTypes: ['2']},
  {id: 'checkrule', menuType: '5', icon: 'fa-flag-checkered', activeMenuTypes: ['5']},
]);

// 扩展为预留入口：当前无生产实现，必须禁用且不提供假交互
export const WORKBENCH_RESERVED_EXTENSION = {id: 'extensions', icon: 'fa-puzzle-piece', disabled: true};

export const isWorkbenchNavDisabled = (nav, mode, readingFlag) => {
  if (!nav) {
    return true;
  }
  if (nav.disabled) {
    return true;
  }
  return !!(nav.readOnlyHidden && mode === readingFlag);
};
