import React, {useState, useMemo, useRef, useEffect, useLayoutEffect} from 'react';
import ReactDOM from 'react-dom';
import {FormatMessage, Icon, Modal, SearchSuggest, DropDown} from 'components';
import {validateNeedSave} from '../../lib/datasource_util';
import {checkAlignEnable} from '../../lib/position';
import {READING} from '../../lib/variable';
import {getDataByTabId} from '../../lib/cache';
import {
  WORKBENCH_RESERVED_EXTENSION,
  getWorkbenchPrimaryNavs,
  getWorkbenchSecondaryNavs,
  isWorkbenchNavDisabled,
  WB_SIDEBAR_MIN,
  WB_SIDEBAR_MAX,
  WB_INSPECTOR_MIN,
  WB_INSPECTOR_MAX,
} from './navigation';
import {WbIcon} from './icons';
import {calcEntityReferences, calcTableAssociations, resolveInspectorTarget} from './references';

import './style/index.less';

// 新工作台外壳由恒渲染的兄弟组件组成，由 .chiner-home-wb 类控制网格布局，
// 导航/编辑器子树不因界面状态切换而重挂载。
// 顶栏/资源树头/文档页签/编辑工具栏/右侧上下文面板按已验收原型视觉重排，
// 全部复用唯一 tabs/activeKey/menuType/草稿缓存状态，不建立第二套编辑器或模型。
// 单顶栏承载全部命令入口，图编辑工具迁至关系图上下文工具栏。

// 工作台局部下拉菜单。锚定触发器（不依赖鼠标坐标，键盘打开同样正确）、
// 视口贴边钳制、最大高度受窗口约束且内部滚动、Enter/Space/ArrowDown 打开、
// ArrowUp/Down 移动、Enter 执行、Escape 关闭并还焦点、aria-expanded 真实。
// 共享 DropDown（含 tab 右键菜单等旧调用）行为不变。
const WbDropdown = React.memo(({currentPrefix, title, icon, label, menus, menuClick,
                                disabled, buttonClassName}) => {
  const [visible, setVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const flatItems = useMemo(() => {
    const arr = [];
    (menus || []).forEach((m) => {
      if (m.children) { m.children.forEach(c => arr.push(c)); } else { arr.push(m); }
    });
    return arr;
  }, [menus]);
  const openMenu = () => {
    if (!disabled && flatItems.length > 0) {
      setActiveIndex(-1);
      setVisible(true);
    }
  };
  const closeMenu = (focusBack) => {
    setVisible(false);
    if (focusBack) btnRef.current?.focus();
  };
  useLayoutEffect(() => {
    if (!visible || !menuRef.current || !btnRef.current) return undefined;
    const menu = menuRef.current;
    const rect = btnRef.current.getBoundingClientRect();
    menu.style.visibility = 'hidden';
    menu.style.maxHeight = `${Math.max(120, window.innerHeight - rect.bottom - 12)}px`;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = rect.left;
    if (left + mw > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - mw - 8);
    }
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - mh - 8))}px`;
    menu.style.visibility = 'visible';
    menu.focus();
    return undefined;
  }, [visible, menus]);
  useEffect(() => {
    if (!visible || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll('[role="menuitem"]');
    items.forEach((el, i) => {
      el.classList.toggle(`${currentPrefix}-wb-menu-item-active`, i === activeIndex);
    });
    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].scrollIntoView({block: 'nearest'});
    }
  }, [activeIndex, visible, currentPrefix]);
  const runItem = (m, e) => {
    if (m.disable) return;
    closeMenu(false);
    menuClick && menuClick(m, e);
  };
  const onTriggerKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openMenu();
    }
  };
  const onMenuKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flatItems.length) return;
      // React 16 合成事件有事件池：setState updater 延迟执行时事件已回收，
      // 必须同步提取方向，不能在 updater 内读 e.key
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const total = flatItems.length;
      setActiveIndex((i) => (i < 0
        ? (dir === 1 ? 0 : total - 1)
        : (i + dir + total) % total));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const m = flatItems[activeIndex];
      if (m) runItem(m, e);
    }
  };
  const renderMenu = m => <div
    key={m.key || m.name}
    role='menuitem'
    aria-disabled={m.disable ? 'true' : undefined}
    draggable={!!m.draggable}
    onDragStart={e => runItem(m, e)}
    onClick={e => runItem(m, e)}
    className={`${currentPrefix}-wb-menu-item${m.disable
      ? ` ${currentPrefix}-wb-menu-item-disable` : ''}`}
  >
    {m.icon}{m.name}
  </div>;
  return <>
    <button
      ref={btnRef}
      type='button'
      className={buttonClassName
        ? `${buttonClassName}${disabled ? ` ${buttonClassName}-disable` : ''}`
        : `${currentPrefix}-wb-menubtn${label === null ? ` ${currentPrefix}-wb-menubtn-icononly` : ''}`}
      disabled={disabled}
      title={title}
      aria-haspopup='menu'
      aria-expanded={visible ? 'true' : 'false'}
      onClick={openMenu}
      onKeyDown={onTriggerKeyDown}
    >
      <WbIcon name={icon}/>
      {label !== null && <span>{label}</span>}
      {label !== null && <WbIcon name='chevron' size={11}/>}
    </button>
    {visible && ReactDOM.createPortal(<div
      ref={menuRef}
      role='menu'
      aria-label={title}
      tabIndex='-1'
      className={`${currentPrefix}-wb-menu`}
      onBlur={() => setVisible(false)}
      onKeyDown={onMenuKeyDown}
    >
      {(menus || []).map((m) => {
        if (m.children) {
          return <React.Fragment key={m.key || m.name}>
            <div role='presentation' className={`${currentPrefix}-wb-menu-group`}>{m.icon}{m.name}</div>
            {m.children.map(renderMenu)}
          </React.Fragment>;
        }
        return renderMenu(m);
      })}
    </div>, document.body)}
  </>;
});

// 顶栏下拉组按钮（WbDropdown 菜单 + 统一图标/文字基线）
const WbMenuButton = ({currentPrefix, title, icon, menus, menuClick, disabled}) => {
  return <WbDropdown
    currentPrefix={currentPrefix}
    title={title}
    icon={icon}
    label={title}
    menus={disabled ? [] : menus}
    menuClick={menuClick}
    disabled={disabled}
  />;
};

// 属性面板“模型关联”分区（位于基本信息之后、关系图引用之前）。
// 数据由 calcTableAssociations 纯函数从有效图快照计算；默认最多 5 项可展开；
// 每个来源图 chip 复用 diagramRefs 定位流程（开图/激活 tab/定位关联表节点）。
const WB_ASSOC_MAX = 5;
const WorkbenchAssociations = React.memo(({currentPrefix, tableId, snapshot,
                                            onLocateReference}) => {
  const [expanded, updateExpanded] = useState(false);
  const associations = useMemo(() => calcTableAssociations(tableId, snapshot),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tableId, snapshot]);
  const rows = expanded ? associations.tables : associations.tables.slice(0, WB_ASSOC_MAX);
  const sourceChip = (s, tableRefId, idx) => <button
    type='button'
    key={`${s.id}${idx}`}
    className={`${currentPrefix}-wb-assoc-source`}
    onClick={() => onLocateReference({id: s.id, originKey: tableRefId, cellId: s.cellId})}
    title={s.defName || s.defKey}
  >
    <WbIcon name='diagram' size={12}/>
    <span>{s.defName || s.defKey}</span>
  </button>;
  return <div className={`${currentPrefix}-wb-assoc`}>
    <div className={`${currentPrefix}-wb-section-title`}>
      <span><FormatMessage id='workbench.inspectorAssoc'/></span>
      <span className={`${currentPrefix}-wb-tag`}>{associations.count}</span>
    </div>
    {associations.tables.length === 0 && associations.self.length === 0 && <p
      className={`${currentPrefix}-wb-table-note`}>
      <FormatMessage id='workbench.inspectorNoAssoc'/>
    </p>}
    {rows.map(t => <div
      key={t.id}
      className={`${currentPrefix}-wb-assoc-row`}
      title={`${t.defKey}${t.defName && t.defName !== t.defKey ? `[${t.defName}]` : ''}`}
    >
      <div className={`${currentPrefix}-wb-assoc-name`}>
        <WbIcon name='table' size={13}/>
        <span className={`${currentPrefix}-wb-mono`}>{t.defKey}</span>
        {t.defName && t.defName !== t.defKey
          && <span className={`${currentPrefix}-wb-assoc-displayname`}>{t.defName}</span>}
      </div>
      <div className={`${currentPrefix}-wb-assoc-sources`}>
        {t.sources.map((s, i) => sourceChip(s, t.id, i))}
      </div>
    </div>)}
    {associations.tables.length > WB_ASSOC_MAX && <button
      type='button'
      className={`${currentPrefix}-wb-assoc-toggle`}
      onClick={() => updateExpanded(pre => !pre)}
    >
      <FormatMessage id={expanded
        ? 'workbench.inspectorAssocCollapse' : 'workbench.inspectorAssocExpand'}
        data={{count: associations.tables.length}}/>
    </button>}
    {associations.self.length > 0 && <div className={`${currentPrefix}-wb-assoc-row ${currentPrefix}-wb-assoc-row-self`}>
      <div className={`${currentPrefix}-wb-assoc-name`}>
        <span className={`${currentPrefix}-wb-tag`}>
          <FormatMessage id='workbench.inspectorAssocSelf'/>
        </span>
      </div>
      <div className={`${currentPrefix}-wb-assoc-sources`}>
        {associations.self.map((s, i) => sourceChip(s, tableId, i))}
      </div>
    </div>}
  </div>;
});

// 顶部栏（原型 .topbar）：品牌 + 项目名 + 命令组（新建/数据库/导入/导出/工具）
// + 全局搜索（复用 SearchSuggest）+ 主题 + 保存主按钮 + 更多。
// 全部命令回调复用唯一 iconClick/_openModal/右键新增流程，禁用语义与原头部一致（只读隐藏命令组）。
// 经典布局已剥离，不再提供布局切换入口（onToggleLayout/layoutMenu 移除）。
export const WorkbenchTopbar = React.memo(({currentPrefix, mode, isChildWindow, dataSource,
                                            onBackProjects, onSave,
                                            getSearchDataSource, jumpPosition, jumpDetail,
                                            onToggleTheme, iconClick, openModal,
                                            onCreateObject, canvasExportable, compact, hideModelCreate}) => {
  const readOnly = mode === READING;
  const themeMode = dataSource?.profile?.themeMode;
  const menuClick = (m, e) => iconClick && iconClick(e, m.key);
  // 项目对象创建菜单：dispatch 类型 key（addOpt/右键新增全流程），文案复用 menus.add.*
  const createLabelKeys = {
    entities: 'newEntity',
    logicEntities: 'newLogicEntity',
    views: 'newView',
    diagrams: 'newRelation',
    dicts: 'newDict',
    groups: 'newGroup',
    domains: 'newDomain',
    dataTypeMapping: 'newDataType',
    dataTypeSupport: 'newDataTypeSupport',
    appCode: 'newAppCode',
  };
  const createMenus = useMemo(() => ([
    {
      name: FormatMessage.string({id: 'workbench.createModelObjects'}),
      children: ['entities', 'logicEntities', 'views', 'diagrams', 'dicts', 'groups']
        .map(t => ({key: t, name: FormatMessage.string({id: `menus.add.${createLabelKeys[t]}`})})),
    },
    {
      name: FormatMessage.string({id: 'domainTab'}),
      children: ['domains', 'dataTypeMapping', 'dataTypeSupport', 'appCode']
        .map(t => ({key: t, name: FormatMessage.string({id: `menus.add.${createLabelKeys[t]}`})})),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), []);
  // 数据库入口集中到左轨“数据库”工作区（menuType 9）
  const importMenus = useMemo(() => ([
    {
      key: 'PDManer-history',
      name: FormatMessage.string({id: 'toolbar.importPDManHistory'}),
      children: [
        {key: 'pdman', name: FormatMessage.string({id: 'toolbar.importPDMan'})},
        {key: 'chiner', name: FormatMessage.string({id: 'toolbar.importCHNR'})},
        {key: 'PDManer', name: FormatMessage.string({id: 'toolbar.importPDManer'})},
      ],
    },
    {
      key: 'other-model',
      name: FormatMessage.string({id: 'toolbar.importOtherModelFile'}),
      children: [
        {key: 'powerdesigner', name: FormatMessage.string({id: 'toolbar.importPowerDesigner'})},
        {key: 'excel', name: FormatMessage.string({id: 'toolbar.importExcel'})},
      ],
    },
    {
      key: 'db-data',
      name: FormatMessage.string({id: 'toolbar.importDbData'}),
      children: [
        {key: 'db', name: FormatMessage.string({id: 'toolbar.importDb'})},
        {key: 'importDDL', name: FormatMessage.string({id: 'toolbar.importDDL'})},
      ],
    },
    {
      key: 'sys-config',
      name: FormatMessage.string({id: 'toolbar.importJsonConfig'}),
      children: [
        {key: 'domains', name: FormatMessage.string({id: 'toolbar.importDomains'})},
        {key: 'appCodes', name: FormatMessage.string({id: 'toolbar.importAppCodes'})},
        {key: 'importConfig', name: FormatMessage.string({id: 'toolbar.importConfig'})},
      ],
    },
    {
      key: 'sys-data',
      name: FormatMessage.string({id: 'toolbar.importJsonData'}),
      children: [
        {key: 'importDicts', name: FormatMessage.string({id: 'toolbar.importDicts'})},
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), []);
  const exportMenus = useMemo(() => ([
    {
      key: 'export-file',
      name: FormatMessage.string({id: 'toolbar.exportFile'}),
      children: [
        {key: 'word', name: FormatMessage.string({id: 'toolbar.exportWord'})},
        {key: 'html', name: FormatMessage.string({id: 'toolbar.exportHtml'})},
        {key: 'export-excel', name: FormatMessage.string({id: 'toolbar.exportExcel'})},
      ],
    },
    {
      key: 'export-SQL',
      name: FormatMessage.string({id: 'toolbar.exportSQL'}),
      children: [
        {key: 'sql', name: FormatMessage.string({id: 'toolbar.exportSql'})},
        {key: 'dict', name: FormatMessage.string({id: 'toolbar.exportDict'})},
      ],
    },
    {
      key: 'export-Canvas',
      name: FormatMessage.string({id: 'toolbar.exportCanvas'}),
      children: [
        {key: 'png', name: FormatMessage.string({id: 'toolbar.exportImgPng'}), disable: !canvasExportable},
        {key: 'svg', name: FormatMessage.string({id: 'toolbar.exportImgSvg'}), disable: !canvasExportable},
      ],
    },
    {
      key: 'export-config',
      name: FormatMessage.string({id: 'toolbar.exportJsonConfig'}),
      children: [
        {key: 'exportDomains', name: FormatMessage.string({id: 'toolbar.exportDomains'})},
        {key: 'exportAppCodes', name: FormatMessage.string({id: 'toolbar.exportAppCodes'})},
        {key: 'exportConfig', name: FormatMessage.string({id: 'toolbar.exportConfig'})},
      ],
    },
    {
      key: 'export-data',
      name: FormatMessage.string({id: 'toolbar.exportJsonData'}),
      children: [
        {key: 'exportDicts', name: FormatMessage.string({id: 'toolbar.exportDicts'})},
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [canvasExportable]);
  const toolMenus = useMemo(() => ([
    {key: 'toggleCase', name: FormatMessage.string({id: 'toolbar.toggleCase'})},
    {key: 'compareTable', name: FormatMessage.string({id: 'toolbar.compareTable'})},
  ]), []);
  const moreMenus = useMemo(() => {
    // 只读（READING）语义与原头部一致：工具区全部隐藏，
    // 更多仅保留安全入口，不暴露另存/设置/大小写/数据库维护等编辑路径
    if (readOnly) {
      return [];
    }
    const base = [
      {key: 'saveAs', name: FormatMessage.string({id: 'toolbar.saveAs'})},
      {key: 'refresh', name: FormatMessage.string({id: 'toolbar.refresh'})},
      {key: 'configMenu', name: FormatMessage.string({id: 'toolbar.setting'})},
      {key: 'history', name: FormatMessage.string({id: 'toolbar.history'})},
    ];
    // 窄屏（<=1280）把低频组并入更多
    const folded = compact ? [
      {
        name: FormatMessage.string({id: 'toolbar.tool'}),
        children: toolMenus.map(m => ({...m})),
      },
    ] : [];
    return base.concat(folded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, themeMode, readOnly]);
  // 顶栏统一命令执行路径：桌面独立组与 compact 并入组走同一分支表，避免 key 被漏转发
  const runTopCommand = (m, e) => {
    if (m.key === 'configMenu') {
      openModal && openModal('config');
    } else {
      menuClick(m, e);
    }
  };
  const moreClick = runTopCommand;
  return <div className={`${currentPrefix}-wb-topbar`}>
    <div className={`${currentPrefix}-wb-topbar-brand`}>
      {!isChildWindow && <button
        type='button'
        className={`${currentPrefix}-wb-iconbtn`}
        onClick={onBackProjects}
        title={FormatMessage.string({id: 'workbench.backProjects'})}
        aria-label={FormatMessage.string({id: 'workbench.backProjects'})}
      >
        <Icon type='fa-angle-left'/>
      </button>}
      <img className={`${currentPrefix}-wb-topbar-logo`} src='./branding/logo.png' aria-hidden="true" alt=''/>
      <span className={`${currentPrefix}-wb-topbar-namegroup`}>
        <span className={`${currentPrefix}-wb-topbar-name`}>CS-M</span>
        <span className={`${currentPrefix}-wb-topbar-label`}>WORKBENCH</span>
      </span>
      <span className={`${currentPrefix}-wb-topbar-divider`}/>
      <span className={`${currentPrefix}-wb-topbar-project`} title={dataSource?.name}>
        {dataSource?.name}
      </span>
    </div>
    <div className={`${currentPrefix}-wb-topbar-menus`}>
      {!hideModelCreate && <WbMenuButton
        currentPrefix={currentPrefix}
        title={FormatMessage.string({id: 'toolbar.create'})}
        icon='plus'
        menus={createMenus}
        menuClick={(m) => onCreateObject && onCreateObject(m.key)}
        disabled={readOnly}
      />}
      <WbMenuButton
        currentPrefix={currentPrefix}
        title={FormatMessage.string({id: 'toolbar.import'})}
        icon='import'
        menus={importMenus}
        menuClick={menuClick}
        disabled={readOnly}
      />
      <WbMenuButton
        currentPrefix={currentPrefix}
        title={FormatMessage.string({id: 'toolbar.export'})}
        icon='export'
        menus={exportMenus}
        menuClick={menuClick}
        disabled={readOnly}
      />
      {!compact && <WbMenuButton
        currentPrefix={currentPrefix}
        title={FormatMessage.string({id: 'toolbar.tool'})}
        icon='settings'
        menus={toolMenus}
        menuClick={menuClick}
        disabled={readOnly}
      />}
    </div>
    <div className={`${currentPrefix}-wb-topbar-search`}>
      <SearchSuggest
        getSearchDataSource={getSearchDataSource}
        jumpPosition={jumpPosition}
        jumpDetail={jumpDetail}
        placeholder={FormatMessage.string({id: 'toolbar.search'})}
        dataSource={dataSource}
      />
    </div>
    <div className={`${currentPrefix}-wb-topbar-actions`}>
      <button
        type='button'
        className={`${currentPrefix}-wb-iconbtn`}
        onClick={onToggleTheme}
        disabled={readOnly}
        title={FormatMessage.string({id: `toolbar.${themeMode === 'themeNigh' ? 'themeDay' : 'themeNigh'}`})}
        aria-label={FormatMessage.string({id: `toolbar.${themeMode === 'themeNigh' ? 'themeDay' : 'themeNigh'}`})}
      ><WbIcon name='moon'/></button>
      <button
        type='button'
        className={`${currentPrefix}-wb-btn ${currentPrefix}-wb-btn-primary`}
        onClick={onSave}
        disabled={readOnly}
        title={FormatMessage.string({id: 'toolbar.save'})}
      >
        <WbIcon name='save'/>
        <span><FormatMessage id='toolbar.save'/></span>
      </button>
      <WbMenuButton
        currentPrefix={currentPrefix}
        title={FormatMessage.string({id: 'workbench.more'})}
        icon='more'
        menus={moreMenus}
        menuClick={moreClick}
      />
    </div>
  </div>;
});

// 资源树头部（原型 .side-title/.side-filter）：标题 + 本地筛选 + 保留的树操作入口；
// 树本体仍是容器内既有 Menu（拖拽/右键/定位能力不变），本组件不渲染第二棵树
const WB_SIDEBAR_TITLES = {
  1: 'workbench.sidebarModel',
  2: 'project.dataType',
  3: 'appCode',
  4: 'versionTab',
  5: 'project.checkRule',
  6: 'dataStandard.tab',
  9: 'workbench.domain.database',
};

export const WorkbenchSidebar = React.memo(({currentPrefix, menuType, filterText, onFilterChange,
                                              showLocation, onLocation,
                                              versionType, onVersionTypeChange,
                                              standardStats, onOpenStandardEdit, filterOpen, onToggleFilter, onCreate, readOnly, onCreateType}) => {
  const titleId = WB_SIDEBAR_TITLES[menuType] || 'workbench.sidebarModel';
  const filterable = menuType === '1' || menuType === '2';
  return <div className={`${currentPrefix}-wb-sidebar`}>
    <div className={`${currentPrefix}-wb-sidebar-title`}>
      <span><FormatMessage id={titleId}/></span>
      <span className={`${currentPrefix}-wb-sidebar-title-opt`}>
        {menuType === '1' && showLocation && <button
          type='button'
          className={`${currentPrefix}-wb-iconbtn`}
          onClick={onLocation}
          title={FormatMessage.string({id: 'location'})}
          aria-label={FormatMessage.string({id: 'location'})}
        >
          <WbIcon name='crosshair'/>
        </button>}
        {filterable && <button type='button' className={`${currentPrefix}-wb-iconbtn`}
          onClick={onToggleFilter} aria-expanded={!!filterOpen} title={FormatMessage.string({id: 'toolbar.search'})}
          aria-label={FormatMessage.string({id: 'toolbar.search'})}><WbIcon name='search'/></button>}
        {menuType === '1' && <button type='button' className={`${currentPrefix}-wb-iconbtn`}
          disabled={readOnly} onClick={onCreate} title={FormatMessage.string({id: 'toolbar.create'})}
          aria-label={FormatMessage.string({id: 'toolbar.create'})}><WbIcon name='plus'/></button>}
        {(menuType === '2' || menuType === '3') && <WbMenuButton currentPrefix={currentPrefix}
          title={FormatMessage.string({id: 'toolbar.create'})} icon='plus' disabled={readOnly}
          menus={[{key: 'domains', name: FormatMessage.string({id: 'menus.add.newDomain'})},
            {key: 'dataTypeMapping', name: FormatMessage.string({id: 'menus.add.newDataType'})},
            {key: 'dataTypeSupport', name: FormatMessage.string({id: 'menus.add.newDataTypeSupport'})},
            {key: 'appCode', name: FormatMessage.string({id: 'menus.add.newAppCode'})}]}
          menuClick={m => onCreateType && onCreateType(m.key)}/>}
      </span>
    </div>
    {filterable && filterOpen && <div className={`${currentPrefix}-wb-sidebar-filter`}>
      <WbIcon name='search' size={12}/>
      <input
        autoFocus
        onKeyDown={e => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) onToggleFilter(); }}
        value={filterText}
        onChange={e => onFilterChange(e.target.value)}
        placeholder={FormatMessage.string({id: 'workbench.sidebarFilterPlaceholder'})}
        aria-label={FormatMessage.string({id: 'workbench.sidebarFilterPlaceholder'})}
      />
      {filterText && <button
        type='button'
        className={`${currentPrefix}-wb-sidebar-filter-clear`}
        onClick={() => onFilterChange('')}
        aria-label={FormatMessage.string({id: 'workbench.sidebarFilterClear'})}
      >
        <WbIcon name='close' size={11}/>
      </button>}
    </div>}
    {menuType === '4' && <div className={`${currentPrefix}-wb-sidebar-version`}>
      <button
        type='button'
        className={versionType === '1' ? 'active' : ''}
        onClick={() => onVersionTypeChange('1')}
      >
        <FormatMessage id='versionData.modelVersion'/>
      </button>
      <button
        type='button'
        className={versionType === '2' ? 'active' : ''}
        onClick={() => onVersionTypeChange('2')}
      >
        <FormatMessage id='versionData.dbDiff'/>
      </button>
    </div>}
    {menuType === '6' && <div className={`${currentPrefix}-wb-sidebar-standard`}>
      <button
        type='button'
        className={`${currentPrefix}-wb-sidebar-standard-entry`}
        onClick={onOpenStandardEdit}
      >
        <WbIcon name='book' size={16}/>
        <span><FormatMessage id='workbench.sidebarStandardFields'/></span>
        <WbIcon name='arrow' size={12}/>
      </button>
      <div className={`${currentPrefix}-wb-sidebar-standard-stat`}>
        <FormatMessage
          id='workbench.sidebarStandardStats'
          data={{roots: standardStats?.roots || 0, fields: standardStats?.fields || 0}}/>
      </div>
    </div>}
    {menuType === '5' && <div className={`${currentPrefix}-wb-sidebar-note`}>
      <FormatMessage id='workbench.sidebarCheckHint'/>
    </div>}
    {menuType === '9' && <div className={`${currentPrefix}-wb-sidebar-note`}>
      <FormatMessage id='dbWorkspace.sidebarHint'/>
    </div>}
  </div>;
});

// 资源树右边界拖动分隔条。沿用 window mousemove/mouseup 拖动机制
// （按下拖动期间 Chromium 对文档保持隐式指针捕获，拖出窗口仍持续接收、任意位置
// 松开即结束）；拖动只改本机视图偏好（onPreview/onCommit 由主容器接线），不写模型、
// 不触发保存。键盘左右键 ±8px 微调。卸载/窗口 blur 时立即结束并移除全部监听。
export const WorkbenchSidebarResizer = React.memo(({currentPrefix, startWidth,
                                                    onPreview, onCommit, side = 'left'}) => {
  const right = side === 'right';
  const dragRef = React.useRef(null);
  // 统一保存 teardown，结束时/卸载时/blur 时都可靠移除 window 监听，
  // 不等未来某次 mouseup 才清理，无残留监听。
  const teardownRef = React.useRef(null);
  // 回调经 ref 透传：父组件 preview 重渲染时 onPreview/onCommit 引用变化，
  // 不得触发 effect 重跑（否则拖动中 cleanup 会提前终止拖动）
  const cbRef = React.useRef({});
  cbRef.current = {onPreview, onCommit};
  const endDrag = React.useCallback((commit) => {
    if (teardownRef.current) {
      teardownRef.current();
      teardownRef.current = null;
    }
    const drag = dragRef.current;
    const last = drag && drag.last;
    dragRef.current = null;
    if (drag) {
      document.body.style.cursor = drag.cursor;
      document.body.style.userSelect = drag.userSelect;
    }
    if (commit && last != null) cbRef.current.onCommit && cbRef.current.onCommit(last);
  }, []);
  React.useEffect(() => () => {
    // 卸载时结束未完成拖动：移除监听、恢复样式；宽度已在 preview 中生效，落盘保持一致
    endDrag(true);
  }, [endDrag]);
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    endDrag(true);
    dragRef.current = {x: e.clientX, start: startWidth, last: startWidth,
      cursor: document.body.style.cursor, userSelect: document.body.style.userSelect};
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      if (!dragRef.current) return;
      dragRef.current.last = cbRef.current.onPreview(dragRef.current.start
        + (ev.clientX - dragRef.current.x) * (right ? -1 : 1));
    };
    const onUp = () => endDrag(true);
    // 窗口失焦（如 Cmd+Tab 切走）时在窗口外松开不再有 mouseup，立即终止拖动
    const onBlur = () => endDrag(true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
    teardownRef.current = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  };
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = (e.key === 'ArrowLeft' ? -8 : 8) * (right ? -1 : 1);
    onCommit && onCommit(startWidth + delta);
  };
  return <div
    role='separator'
    aria-orientation='vertical'
    aria-valuenow={startWidth}
    aria-valuemin={right ? WB_INSPECTOR_MIN : WB_SIDEBAR_MIN}
    aria-valuemax={right ? WB_INSPECTOR_MAX : WB_SIDEBAR_MAX}
    tabIndex={0}
    className={`${currentPrefix}-wb-${right ? 'inspector' : 'sidebar'}-resizer`}
    onMouseDown={onMouseDown}
    onKeyDown={onKeyDown}
    title={FormatMessage.string({id: `workbench.${right ? 'inspectorResize' : 'sidebarResize'}`})}
    aria-label={FormatMessage.string({id: `workbench.${right ? 'inspectorResize' : 'sidebarResize'}`})}
  />;
});

// 文档页签条（原型 .tabs/.tab）：仅呈现唯一的 tabs 状态；激活/关闭/右键全部复用既有回调
export const WorkbenchDocumentTabs = React.memo(({currentPrefix, tabs, activeKey, getTabTitle,
                                                    onTabChange, onTabClose, dropDownMenus,
                                                    onTabMenuClick}) => {
  return <div
    className={`${currentPrefix}-wb-tabs`}
    role='tablist'
    aria-label={FormatMessage.string({id: 'workbench.docsTabsLabel'})}
  >
    <div className={`${currentPrefix}-wb-tabs-scroll`}>
      {tabs.length === 0 && <span className={`${currentPrefix}-wb-tabs-empty`}>
        <FormatMessage id='workbench.docsEmpty'/>
      </span>}
      {tabs.map((t) => {
        const title = getTabTitle(t);
        const tabData = getDataByTabId(t.tabKey);
        const dirty = !!(tabData && !tabData.isInit);
        return <DropDown
          trigger='contextMenu'
          key={t.tabKey}
          menus={dropDownMenus}
          menuClick={(menu, event) => onTabMenuClick(menu, event, {key: t.tabKey})}
        >
          <div
            role='tab'
            tabIndex={0}
            aria-selected={activeKey === t.tabKey ? 'true' : 'false'}
            className={`${currentPrefix}-wb-tab${activeKey === t.tabKey ? ` ${currentPrefix}-wb-tab-active` : ''}`}
            title={title.tooltip || title.title}
            onClick={() => onTabChange(t.tabKey)}
            onKeyDown={(e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onTabChange(t.tabKey);
              }
            }}
          >
            <span className={`${currentPrefix}-wb-tab-label`}>{title.title}</span>
            {dirty && <span className={`${currentPrefix}-wb-tab-dot`}/>}
            <button
              type='button'
              className={`${currentPrefix}-wb-tab-close`}
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(t.tabKey);
              }}
              aria-label={FormatMessage.string({id: 'closeCurrent'})}
            >
              <WbIcon name='close' size={11}/>
            </button>
          </div>
        </DropDown>;
      })}
    </div>
  </div>;
});

// 画布拖入工具（新表/逻辑实体/分组/思维导图）。与经典 GroupIcon 相同的
// HTML5 拖拽语义：draggable 元素 onDragStart 即触发 iconClick(e,key) → startDrag；
// 点击同样触发（经典 GroupIcon onClick 兼有拖拽启动与点击两路，此处保持一致）。
const WbDragTool = ({currentPrefix, name, title, disabled, hoverTitle, onAction}) => {
  return <div
    role='button'
    tabIndex={disabled ? -1 : 0}
    aria-disabled={disabled ? 'true' : undefined}
    aria-label={title}
    className={`${currentPrefix}-wb-toolbtn${disabled ? ` ${currentPrefix}-wb-toolbtn-disable` : ''}`}
    draggable={!disabled}
    onDragStart={disabled ? undefined : onAction}
    onClick={disabled ? undefined : onAction}
    onKeyDown={(e) => {
      if (!disabled && e.target === e.currentTarget
          && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onAction(e);
      }
    }}
    title={hoverTitle || title}
  >
    <WbIcon name={name}/>
  </div>;
};

// 编辑工具栏（原型 .editor-toolbar）：面包屑 + 关系图上下文工具（拖入/形状/对齐/缩放）。
// 仅在激活文档为关系图时显示画布工具（经典 checkDisable 同语义），非图文档不显示无效图工具。
export const WorkbenchEditorToolbar = React.memo(({currentPrefix, mode, menuType, activeTab,
                                                    getTabTitle, iconClick, onZoom, cellSelected,
                                                    inspectorOpen, onToggleInspector, inspectorAvailable = true}) => {
  const readOnly = mode === READING;
  const isDiagram = activeTab?.type === 'diagram' && (menuType === '1' || menuType === '2');
  const canUseCanvas = !readOnly && isDiagram;
  const alignEnable = canUseCanvas && checkAlignEnable(cellSelected || []);
  const disableTitle = FormatMessage.string({id: 'toolbar.relationEnableTitle'});
  const domainNames = {
    1: FormatMessage.string({id: 'workbench.domain.model'}),
    2: FormatMessage.string({id: 'workbench.domain.model'}),
    3: FormatMessage.string({id: 'workbench.domain.delivery'}),
    4: FormatMessage.string({id: 'workbench.domain.versions'}),
    5: FormatMessage.string({id: 'workbench.domain.checkrule'}),
    6: FormatMessage.string({id: 'workbench.domain.standard'}),
    9: FormatMessage.string({id: 'workbench.domain.database'}),
  };
  const title = activeTab ? getTabTitle(activeTab) : null;
  const shapeMenus = useMemo(() => ([
    {draggable: true, key: 'rect', icon: <span className={`${currentPrefix}-head-rect`}/>, name: FormatMessage.string({id: 'toolbar.rect'})},
    {draggable: true, key: 'round', icon: <span className={`${currentPrefix}-head-round`}/>, name: FormatMessage.string({id: 'toolbar.round'})},
    {draggable: true, key: 'circle', icon: <span className={`${currentPrefix}-head-circle`}/>, name: FormatMessage.string({id: 'toolbar.circle'})},
    {draggable: true, key: 'polygon', icon: <span className={`${currentPrefix}-head-polygon`}/>, name: FormatMessage.string({id: 'toolbar.polygon'})},
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), []);
  const alignMenus = useMemo(() => ([
    {key: 'alignLeft', icon: <span className={`${currentPrefix}-head-alignLeft`}/>, name: FormatMessage.string({id: 'toolbar.alignLeft'})},
    {key: 'horizontalCenter', icon: <span className={`${currentPrefix}-head-horizontalCenter`}/>, name: FormatMessage.string({id: 'toolbar.horizontalCenter'})},
    {key: 'alignRight', icon: <span className={`${currentPrefix}-head-alignRight`}/>, name: FormatMessage.string({id: 'toolbar.alignRight'})},
    {key: 'alignTop', icon: <span className={`${currentPrefix}-head-alignTop`}/>, name: FormatMessage.string({id: 'toolbar.alignTop'})},
    {key: 'verticalCenter', icon: <span className={`${currentPrefix}-head-verticalCenter`}/>, name: FormatMessage.string({id: 'toolbar.verticalCenter'})},
    {key: 'alignBottom', icon: <span className={`${currentPrefix}-head-alignBottom`}/>, name: FormatMessage.string({id: 'toolbar.alignBottom'})},
    {key: 'alignRow', icon: <span className={`${currentPrefix}-head-alignRow`}/>, style: {borderTop: '1px solid #DFE3EB'}, name: FormatMessage.string({id: 'toolbar.alignRow'})},
    {key: 'alignColumn', icon: <span className={`${currentPrefix}-head-alignColumn`}/>, name: FormatMessage.string({id: 'toolbar.alignColumn'})},
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), []);
  return <div className={`${currentPrefix}-wb-editortoolbar`}>
    <div className={`${currentPrefix}-wb-breadcrumb`}>
      <span>{domainNames[menuType] || domainNames[1]}</span>
      <WbIcon name='chevron' size={11}/>
      <strong title={title?.tooltip || title?.title}>{title?.title || domainNames[menuType]}</strong>
    </div>
    <div className={`${currentPrefix}-wb-toolbar-actions`}>
      {canUseCanvas && <>
        <WbDragTool
          currentPrefix={currentPrefix}
          name='table'
          title={FormatMessage.string({id: 'toolbar.emptyEntity'})}
          disabled={false}
          onAction={(e) => iconClick(e, 'empty')}
        />
        <WbDragTool
          currentPrefix={currentPrefix}
          name='columns'
          title={FormatMessage.string({id: 'toolbar.emptyLogic'})}
          onAction={(e) => iconClick(e, 'logic')}
        />
        <WbDragTool
          currentPrefix={currentPrefix}
          name='group'
          title={FormatMessage.string({id: 'toolbar.group'})}
          onAction={(e) => iconClick(e, 'group')}
        />
        <WbDragTool
          currentPrefix={currentPrefix}
          name='mind'
          title={FormatMessage.string({id: 'toolbar.mind'})}
          onAction={(e) => iconClick(e, 'mind')}
        />
        <WbDropdown
          currentPrefix={currentPrefix}
          title={FormatMessage.string({id: 'toolbar.shape'})}
          icon='shapes'
          label={null}
          buttonClassName={`${currentPrefix}-wb-toolbtn`}
          menus={shapeMenus}
          menuClick={(m, e) => iconClick(e, m.key)}
        />
        <span className={`${currentPrefix}-wb-toolbar-divider`}/>
        <WbDropdown
          currentPrefix={currentPrefix}
          title={alignEnable
            ? FormatMessage.string({id: 'toolbar.alignment'})
            : FormatMessage.string({id: 'toolbar.alignment'}) + ' · ' + disableTitle}
          icon='align'
          label={null}
          buttonClassName={`${currentPrefix}-wb-toolbtn`}
          menus={alignEnable ? alignMenus : []}
          disabled={!alignEnable}
          menuClick={(m, e) => iconClick(e, m.key)}
        />
        <span className={`${currentPrefix}-wb-toolbar-divider`}/>
        <button
          type='button'
          className={`${currentPrefix}-wb-toolbtn`}
          onClick={() => onZoom(-1)}
          title={FormatMessage.string({id: 'workbench.zoomOut'})}
          aria-label={FormatMessage.string({id: 'workbench.zoomOut'})}
        >
          <WbIcon name='minus'/>
        </button>
        <button
          type='button'
          className={`${currentPrefix}-wb-toolbtn`}
          onClick={() => onZoom(1)}
          title={FormatMessage.string({id: 'workbench.zoomIn'})}
          aria-label={FormatMessage.string({id: 'workbench.zoomIn'})}
        >
          <WbIcon name='plus'/>
        </button>
      </>}
      {/* 属性栏不可用的上下文（企业首页/数据库工作区）隐藏无效开关，默认true保留其他图种原行为 */}
      {inspectorAvailable && <button
        type='button'
        className={`${currentPrefix}-wb-iconbtn`}
        onClick={onToggleInspector}
        aria-pressed={inspectorOpen ? 'true' : 'false'}
        title={FormatMessage.string({id: inspectorOpen
          ? 'workbench.inspectorClose' : 'workbench.inspectorOpen'})}
        aria-label={FormatMessage.string({id: inspectorOpen
          ? 'workbench.inspectorClose' : 'workbench.inspectorOpen'})}
      >
        <WbIcon name='panel'/>
      </button>}
    </div>
  </div>;
});

// 右侧上下文面板（原型 .inspector）：只读属性 + 由当前有效草稿计算的引用列表
const INSPECTOR_TYPE_LABELS = {
  entity: {id: 'workbench.inspectorTypeEntity'},
  logicEntity: {id: 'workbench.inspectorTypeLogic'},
  view: {id: 'workbench.inspectorTypeView'},
  dict: {id: 'workbench.inspectorTypeDict'},
};

// 对象类型 -> viewGroups 成员键（与各编辑页分组多选一致）
const INSPECTOR_GROUP_KEYS = {
  entity: 'refEntities',
  logicEntity: 'refLogicEntities',
  view: 'refViews',
  dict: 'refDicts',
};

export const WorkbenchInspector = React.memo(({currentPrefix, dataSource, activeTab, tabs, selection,
                                                getTabData, getSearchDataSource, getDiagramEdgeSnapshot,
                                                onLocateReference, onEditEntity, draftVersion,
                                                resizer}) => {
  // 上下文优先级（resolveInspectorTarget 纯函数，见 references.js）：
  // 图内选中仅在来源图仍为激活页签时生效；对象数据优先未保存草稿（有效数据），
  // 回退已保存 dataSource；draftVersion 在草稿落缓存时递增驱动重读。
  const target = useMemo(() => resolveInspectorTarget({
    selection, activeTab, tabs, getTabData, dataSource,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [selection, activeTab, tabs, dataSource, draftVersion]);
  const references = useMemo(() => {
    if (!target) {
      return [];
    }
    // getSearchDataSource 已合并图草稿；draftVersion（草稿写入递增）变化时重算
    return calcEntityReferences(target.data.id, getSearchDataSource());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.data?.id, draftVersion, dataSource]);
  // 有效图快照仅对表类目标计算（字典无 ER 连线，不显示该分区）；
  // 依赖 target 与 draftVersion，输入/连线草稿写入时随 tick 重算
  const associationSnapshot = useMemo(() => {
    if (!target || target.type === 'dict' || !getDiagramEdgeSnapshot) {
      return null;
    }
    return getDiagramEdgeSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.data?.id, target?.type, draftVersion, dataSource]);
  const domains = useMemo(() => {
    if (!target) {
      return [];
    }
    const groupKey = INSPECTOR_GROUP_KEYS[target.type];
    return (dataSource?.viewGroups || [])
      .filter(g => (g?.[groupKey] || []).includes(target.data.id))
      .map(g => g.defName || g.defKey);
  }, [target, dataSource]);
  const renderInfo = (labelId, value, mono) => {
    return <div className={`${currentPrefix}-wb-info-line`}>
      <span><FormatMessage id={labelId}/></span>
      <strong
        className={mono ? `${currentPrefix}-wb-mono` : ''}
        title={typeof value === 'string' ? value : undefined}
      >{value}</strong>
    </div>;
  };
  return <aside
    className={`${currentPrefix}-wb-inspector`}
    aria-label={FormatMessage.string({id: 'workbench.inspectorLabel'})}
  >
    {resizer}
    <div className={`${currentPrefix}-wb-inspector-content`}>
      <div
        className={`${currentPrefix}-wb-inspector-pane`}
        data-pane='properties'
      >
        {(!target ? <div className={`${currentPrefix}-wb-inspector-empty`}>
          <WbIcon name='table' size={26}/>
          <p><FormatMessage id='workbench.inspectorEmpty'/></p>
        </div> : <>
        <div className={`${currentPrefix}-wb-object-heading`}>
          <span className={`${currentPrefix}-wb-object-icon`}>
            <WbIcon name={target.type === 'dict' ? 'book' : 'table'} size={18}/>
          </span>
          <div>
            <h2 className={`${currentPrefix}-wb-mono`} title={target.data.defKey}>{target.data.defKey}</h2>
            <p>
              {target.data.defName || target.data.defKey}
              {' · '}
              <FormatMessage id={INSPECTOR_TYPE_LABELS[target.type].id}/>
            </p>
          </div>
        </div>
        <div className={`${currentPrefix}-wb-section-title`}>
          <span><FormatMessage id='workbench.inspectorBasic'/></span>
          <span className={`${currentPrefix}-wb-tag`}>
            {target.fromSelection
              ? <FormatMessage id='workbench.inspectorFromSelection'/>
              : <FormatMessage id='workbench.inspectorFromTab'/>}
          </span>
        </div>
        {renderInfo('workbench.inspectorDefKey', target.data.defKey, true)}
        {renderInfo('workbench.inspectorDefName', target.data.defName || <FormatMessage id='workbench.inspectorNone'/>)}
        {renderInfo('workbench.inspectorDomain',
          domains.length > 0 ? domains.join(' / ') : <FormatMessage id='workbench.inspectorNone'/>)}
        {renderInfo('workbench.inspectorComment',
          target.data.comment || <FormatMessage id='workbench.inspectorNone'/>)}
        {renderInfo(target.type === 'dict' ? 'workbench.inspectorDictItems' : 'workbench.inspectorFieldCount',
          FormatMessage.string({id: 'workbench.inspectorCountValue',
            data: {count: (target.data.fields || target.data.items || []).length}}))}
        {associationSnapshot && <div className={`${currentPrefix}-wb-section-divider`}/>}
        {associationSnapshot && <WorkbenchAssociations
          key={target.data.id}
          currentPrefix={currentPrefix}
          tableId={target.data.id}
          snapshot={associationSnapshot}
          onLocateReference={onLocateReference}
        />}
        <div className={`${currentPrefix}-wb-section-divider`}/>
        <div className={`${currentPrefix}-wb-section-title`}>
          <span><FormatMessage id='workbench.inspectorRefs'/></span>
          <span className={`${currentPrefix}-wb-tag`}>{references.length}</span>
        </div>
        {references.map(r => <button
          type='button'
          key={r.id}
          className={`${currentPrefix}-wb-reference-row`}
          // 必须携带 diagram id（_jumpDetail 的 diagramRefs 分支按 d.id 开图定位）
          onClick={() => onLocateReference({id: r.id, originKey: target.data.id, cellId: r.cellId})}
          title={`${r.defKey || ''}${r.defName ? `[${r.defName}]` : ''}`}
        >
          <WbIcon name='diagram' size={14}/>
          <span>{r.defName || r.defKey}</span>
          <WbIcon name='arrow' size={12}/>
        </button>)}
        {references.length === 0 && <p className={`${currentPrefix}-wb-table-note`}>
          <FormatMessage id='workbench.inspectorNoRefs'/>
        </p>}
        <button
          type='button'
          className={`${currentPrefix}-wb-btn ${currentPrefix}-wb-btn-full`}
          onClick={() => onEditEntity(target.data.id, target.type)}
        >
          <WbIcon name='table'/>
          <span><FormatMessage id='workbench.inspectorEditEntity'/></span>
        </button>
        <div className={`${currentPrefix}-wb-inspector-footer`}>
          <WbIcon name='info' size={12}/>
          <span><FormatMessage id='workbench.inspectorFooterDraft'/></span>
        </div>
      </>)}
      </div>
    </div>
  </aside>;
});

// 主域栏图标：沿用原型线性 SVG（按 nav.id 映射，不改 navigation 定义）
const WB_RAIL_ICONS = {
  model: 'model',
  database: 'databaseIcon',
  standard: 'standard',
  delivery: 'delivery',
  versions: 'versions',
  datatype: 'layers',
  checkrule: 'check',
  extensions: 'extensions',
};

// 64px 主域栏：按 navigation.getWorkbenchPrimaryNavs 渲染
export const WorkbenchRail = React.memo(({currentPrefix, mode, menuType, onNavChange}) => {
  const renderNav = (nav) => {
    const disabled = isWorkbenchNavDisabled(nav, mode, READING);
    const active = (nav.activeMenuTypes || []).includes(menuType);
    const labelId = `workbench.domain.${nav.id}`;
    const title = disabled ? FormatMessage.string({id: 'workbench.versionDisabled'})
        : FormatMessage.string({id: labelId});
    return <button
      key={nav.id}
      type='button'
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      className={`${currentPrefix}-wb-rail-btn${active ? ` ${currentPrefix}-wb-rail-btn-active` : ''}`}
      onClick={() => onNavChange && onNavChange(nav.menuType)}
      title={title}
      aria-label={title}
    >
      <WbIcon name={WB_RAIL_ICONS[nav.id] || 'model'} size={19}/>
      <span><FormatMessage id={labelId}/></span>
    </button>;
  };
  return <nav
    className={`${currentPrefix}-wb-rail`}
    aria-label={FormatMessage.string({id: 'workbench.navLabel'})}
  >
    <span className={`${currentPrefix}-wb-rail-caption`}><FormatMessage id='workbench.modules'/></span>
    <div className={`${currentPrefix}-wb-rail-group`}>
      {getWorkbenchPrimaryNavs().map(renderNav)}
    </div>
    <div className={`${currentPrefix}-wb-rail-group ${currentPrefix}-wb-rail-secondary`}>
      {getWorkbenchSecondaryNavs().map(renderNav)}
      <button
        key={WORKBENCH_RESERVED_EXTENSION.id}
        type='button'
        disabled
        className={`${currentPrefix}-wb-rail-btn`}
        title={FormatMessage.string({id: 'workbench.extensionsHint'})}
        aria-label={FormatMessage.string({id: 'workbench.extensionsHint'})}
      >
        <Icon type={WORKBENCH_RESERVED_EXTENSION.icon}/>
        <span><FormatMessage id={`workbench.domain.${WORKBENCH_RESERVED_EXTENSION.id}`}/></span>
      </button>
    </div>
  </nav>;
});

// 底部状态条：项目、真实对象统计与未保存状态（数量取自当前模型数据，不可伪造）
export const WorkbenchStatusbar = React.memo(({currentPrefix, mode, dataSource}) => {
  const readOnly = mode === READING;
  const entityCount = (dataSource?.entities || []).length;
  const diagramCount = (dataSource?.diagrams || []).length;
  const dirty = validateNeedSave(dataSource);
  return <div className={`${currentPrefix}-wb-statusbar`} role='status'>
    <span className={`${currentPrefix}-wb-statusbar-dot`}/>
    <span className={`${currentPrefix}-wb-statusbar-project`} title={dataSource?.name}>
      {dataSource?.name}
    </span>
    <span className={`${currentPrefix}-wb-statusbar-item`}>
      {FormatMessage.string({id: 'workbench.statusEntityCount', data: {count: entityCount}})}
    </span>
    <span className={`${currentPrefix}-wb-statusbar-item`}>
      {FormatMessage.string({id: 'workbench.statusDiagramCount', data: {count: diagramCount}})}
    </span>
    {dirty && <span className={`${currentPrefix}-wb-statusbar-item ${currentPrefix}-wb-statusbar-dirty`}>
      <FormatMessage id='workbench.statusUnsaved'/>
    </span>}
    {readOnly && <span className={`${currentPrefix}-wb-statusbar-item`}>
      <FormatMessage id='workbench.statusReadonly'/>
    </span>}
    <span className={`${currentPrefix}-wb-statusbar-right`}>
      <FormatMessage id='workbench.badge'/>
    </span>
  </div>;
});

// 返回项目列表（含未保存确认）
export const confirmBackProjects = (dataSource, close) => {
  if (validateNeedSave(dataSource)) {
    Modal.confirm({
      title: FormatMessage.string({id: 'closeConfirmTitle'}),
      message: FormatMessage.string({id: 'closeConfirm'}),
      onOk: () => {
        close();
      },
    });
  } else {
    close();
  }
};
