// 工作台外壳导航定义：只映射现有主容器 menuType，不引入第二套切换状态
// menuType 对应 src/app/main/index.js 左侧 Tab：1模型 2类型设置 3代码 4版本 5规则检查 6数据标准 9数据库工作区


// 工作台资源树宽度是本机视图偏好，存独立本地键（不进 pdma 模型，
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

// 手调偏好读取（用户拖动/键盘写入，最高优先）；无合法手调值返回 null
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

// 工作台属性面板的“实际可见性”派生。数据库工作区（menuType 9）无对象上下文，
// 不渲染属性面板，根网格必须同步收起右侧空列。wbInspectorOpen 用户偏好不被重置：
// 回到模型/类型文档即按原开合恢复。
export const workbenchInspectorHidden = ({menuType, inspectorOpen}) =>
  !inspectorOpen || menuType === '9';

// 主域导航（无平台模块门控）：类型设置(menuType 2)复用编辑Tab，仍归属模型主域
const DATA_WORKBENCH_PRIMARY_NAVS = () => ([
  {id: 'model', menuType: '1', icon: 'fa-table', activeMenuTypes: ['1', '2']},
  {id: 'database', menuType: '9', icon: 'fa-database', activeMenuTypes: ['9']},
  // 与旧布局一致：只读模式隐藏数据标准与版本入口（对应旧 TabItem key=6/4 的 hidden 语义）
  {id: 'standard', menuType: '6', icon: 'fa-book', activeMenuTypes: ['6'], readOnlyHidden: true},
  {id: 'delivery', menuType: '3', icon: 'fa-code', activeMenuTypes: ['3']},
  {id: 'versions', menuType: '4', icon: 'fa-history', activeMenuTypes: ['4'], readOnlyHidden: true},
]);

export const getWorkbenchPrimaryNavs = () => DATA_WORKBENCH_PRIMARY_NAVS();

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
