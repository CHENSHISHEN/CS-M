import React, {useState, useMemo, useEffect, useRef, useCallback} from 'react';
import _ from 'lodash/object';
import moment from 'moment';
import {
  Menu,
  Tab,
  Button,
  Loading,
  openModal,
  Message,
  Modal,
  FormatMessage,
  Upload, Terminal, Download,
  VersionListBar,
  VersionInfoBar, List, CompareList,
} from 'components';
import Dict from '../container/dict';
import Entity from '../container/entity';
import ConceptEntity from '../container/conceptentity';
import ModelCatalog from '../workbench/ModelCatalog';
import View from '../container/view';
import Relation from '../container/relation';
import Config from '../container/config';
import DbConnect from '../container/dbconnect';
import DbReverseParse from '../container/tools/dbreverseparse';
import ExportSql from '../container/tools/exportsql';
import ImportPd from '../container/tools/importpd';
import ImportExcel from '../container/tools/excel';
import ExportWord from '../container/tools/word';
import StandardField from '../container/standardfield';
import {StandardFieldLibraryContext} from '../../lib/context';
import HeaderTool from './HeaderTool';
import MessageHelp from './MessageHelp';
import ToggleCase from '../container/tools/togglecase';
import CompareTable from '../container/tools/comparetable';
import History from '../container/tools/operationshistory';
import CheckRule from '../container/checkrule';
import DataStandard from '../container/datastandard';
import { separator } from '../../../profile';
import { getMenu, getMenus, dealMenuClick } from '../../lib/contextMenuUtil';
import { moveArrayPosition } from '../../lib/array_util';
import AppCodeEdit from '../container/appcode/AppCodeEdit';
import { generateFile } from '../../lib/generatefile';
import {
  validateKey,
  updateAllData,
  allType,
  pdman2sino,
  emptyDictSQLTemplate,
  reduceProject,
  calcDomains,
  reset,
  updateHeaders,
  mergeDataSource,
  mergeData,
  mergeDomains,
  resetHeader,
  validateNeedSave,
  toggleCaseDataSource,
  toggleCaseEntityOrView,
} from '../../lib/datasource_util';
import {
  clearAllTabData,
  getAllTabData,
  getDataByTabId,
  getCache,
  replaceDataByTabId,
  setCache,
  setDataByTabId,
} from '../../lib/cache';
import {removeSave, Save} from '../../lib/event_tool';

import './style/index.less';
import {getPrefix} from '../../lib/prefixUtil';
import {firstUp} from '../../lib/string';
import {connectDB, getLogPath, selectWordFile, selectDir, showItemInFolder} from '../../lib/middle';
import { imgAll } from '../../lib/generatefile/img';
import {compareVersion} from '../../lib/update';
import {notify} from '../../lib/subscribe';
import {READING} from '../../lib/variable';
import LogicEntity from '../container/logicentity';
import {createAiHostClient} from '../ai/integration/hostClient';
import {initAiRuntime, getAiRuntime} from '../ai/integration/aiRuntime';
import ModelingAiPanel from '../ai/integration/ModelingAiPanel';
import SqlImportPanel from '../ai/integration/SqlImportPanel';
import CandidateTab from '../ai/integration/candidateTab';
import {
  WorkbenchDocumentTabs,
  WorkbenchEditorToolbar,
  WorkbenchInspector,
  WorkbenchRail,
  WorkbenchSidebar,
  WorkbenchSidebarResizer,
  WorkbenchStatusbar,
  WorkbenchTopbar,
  confirmBackProjects,
} from '../workbench/WorkbenchShell';
import {
  readWorkbenchSidebarWidth,
  writeWorkbenchSidebarWidth,
  readWorkbenchSidebarManualWidth,
  readWorkbenchSidebarAutoWidth,
  writeWorkbenchSidebarAutoWidth,
  calcFirstEntrySidebarWidth,
  clampWorkbenchSidebarWidth,
  firstEntryMeasureRowSelector,
  planFirstEntryMeasure,
  readWorkbenchInspectorWidth,
  writeWorkbenchInspectorWidth,
  clampWorkbenchInspectorWidth,
  isDataWorkbenchModule,
  workbenchInspectorHidden,
  workbenchSidebarHidden,
} from '../workbench/navigation';
import {filterTreeMenus} from '../workbench/treeFilter';
import {inferDiagramLevel, physicalMetadataPatches, applyPhysicalMetadataPatch} from '../../lib/model_catalog';
import EnterpriseHome from '../workbench/EnterpriseHome';
import DatabaseWorkspace from '../workbench/DatabaseWorkspace';
import ResourceOverview from '../workbench/ResourceOverview';
import ForwardEngineering from '../workbench/ForwardEngineering';
import DrawingWorkbench from '../drawing/DrawingWorkbench';
import {drawingPersistence} from '../../lib/drawing_persistence';
import BusinessWorkbench from '../business/BusinessWorkbench';
import MetricsWorkbench from '../metrics/MetricsWorkbench';

const TabItem = Tab.TabItem;

const Index = React.memo(({getUserData, mode, isChildWindow,
                            open, openTemplate, config, common, prefix, projectInfo,
                            ...restProps}) => {
  const isRefreshRef = useRef(false);
  const [mainId, setMainId] = useState(Math.uuid());
  const [tabs, updateTabs] = useState([]);
  const autoSaveRef = useRef(null);
  const menuDomainRef = useRef(null);
  const activeTabStack = useRef([]);
  const importPdRef = useRef(null);
  const checkRuleRef = useRef(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const dataSourceRef = useRef({});
  dataSourceRef.current = restProps.dataSource;
  const appCodeRef = useRef(null);
  const configRef = useRef({});
  configRef.current = config;
  const [groupType, setGroupType] = useState(restProps.dataSource?.profile?.modelType || 'modalAll');
  const groupTypeRef = useRef(groupType);
  groupTypeRef.current = groupType;
  const [activeKey, updateActiveKey] = useState('');
  const tabInstanceRef = useRef({});
  const pendingDiagramLocationRef = useRef(null);
  const catalogRef = useRef(null);
  const [catalogView, setCatalogView] = useState('directory');
  const [wbFilterOpen, setWbFilterOpen] = useState(false);
  const standardFieldRef = useRef(null);
  const openStandardLibrary = useCallback(() => standardFieldRef.current?.openLibrary(), []);
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const activeTab = tabs.filter(t => t.tabKey === activeKey)[0];
  const [contextMenus, updateContextMenus] = useState([]);
  const [draggable, setDraggable] = useState(false);
  const { lang } = config;
  const cavRefArray = useRef([]);
  const headerToolRef = useRef(null);
  //const [menus, setMenus] = useState([]);
  const [menuType, setMenuType] = useState(() => (
    restProps?.dataSource?.module === 'drawing' ? '7' : (
      restProps?.dataSource?.module === 'business' ? '8' : '1'
    )
  ));
  useEffect(() => {
    if (restProps?.dataSource?.module === 'drawing') {
      setMenuType('7');
    } else if (restProps?.dataSource?.module === 'business') {
      setMenuType('8');
    }
  }, [restProps?.dataSource?.module]);
  // S3：经典布局已剥离，新工作台是唯一布局；不再读取本地布局偏好，
  // 旧 classic 偏好键不参与任何入口
  // WB-004C：图内选中镜像（图工具栏对齐禁用判断；HeaderTool 保留为无 UI
  // 控制器承载共用 imperative setIsCellSelected，两者互不影响）
  const [wbCellSelected, setWbCellSelected] = useState([]);
  // WB-002：资源树本地筛选（仅呈现层过滤，不改模型）
  const [wbTreeFilter, setWbTreeFilter] = useState('');
  // WB-002：图内选中实体（selection:changed 的附加订阅，见 selectionChanged）
  const [wbSelection, setWbSelection] = useState(null);
  // WB-002：右侧上下文面板开关（仅新布局呈现）
  const [wbInspectorOpen, setWbInspectorOpen] = useState(true);
  // WB-003①：资源树宽度 = 本机独立视图偏好（不进模型、不触发保存/dirty）；
  // 窗口变化时仅钳制实际渲染宽度，偏好值保留，宽窗口恢复后自动还原。
  // S1 R5：初始宽度优先级 = 手调偏好 > 本项目首次自动估算 > 默认240
  // projectInfo 是字符串路径（actions/core info:path），非对象
  const wbProjectKeyRef = useRef('');
  wbProjectKeyRef.current = (typeof projectInfo === 'string' ? projectInfo : projectInfo?.path)
    || restProps?.dataSource?.name || '__unsaved__';
  const [wbSidebarWidth, setWbSidebarWidth] = useState(() => {
    const manual = readWorkbenchSidebarManualWidth(getCache);
    if (manual != null) return manual;
    const auto = readWorkbenchSidebarAutoWidth(getCache, wbProjectKeyRef.current);
    return auto != null ? auto : readWorkbenchSidebarWidth(getCache);
  });
  const [wbInspectorWidth, setWbInspectorWidth] = useState(
    () => readWorkbenchInspectorWidth(getCache));
  const [wbWindowWidth, setWbWindowWidth] = useState(
    () => (typeof window === 'undefined' ? 1920 : window.innerWidth));
  useEffect(() => {
    const onWindowResize = () => setWbWindowWidth(window.innerWidth);
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);
  // S1 R5（整改 F5）：首次进入本项目工作台且无手调偏好时，按第一层真实目录名
  // （实际字体+徽标；含待归档下首次可见分类/旧主题域真实名称）测宽一次：
  // [260, min(480,视口35%)] 再服从布局钳制；结果写项目级自动键（不算手调），
  // 此后重开/切模块/改名/筛选不再测量；用户手调出现后自动估算永不覆盖。
  // fonts.ready/rAF 异步期间再次校验原始手调键（planFirstEntryMeasure），
  // 拖宽后放弃测量不覆盖本次宽度；目录未渲染（先进其他模块）或筛选生效时
  // 不置 firstSized，依 menuType/筛选变化有界重试，不永久吞掉首次模型测量。
  const wbFirstEntrySizedRef = useRef(false);
  const wbFirstMeasureAttemptsRef = useRef(0);
  useEffect(() => {
    if (wbFirstEntrySizedRef.current) return;
    const projectKey = wbProjectKeyRef.current;
    const settle = (plan) => {
      wbFirstEntrySizedRef.current = true;
      if (plan.action === 'restore' && plan.width !== wbSidebarWidth) {
        setWbSidebarWidth(plan.width);
      }
    };
    const pre = planFirstEntryMeasure({
      manualWidth: readWorkbenchSidebarManualWidth(getCache),
      storedAutoWidth: readWorkbenchSidebarAutoWidth(getCache, projectKey),
      filterActive: !!wbTreeFilter.trim(),
      attempts: wbFirstMeasureAttemptsRef.current,
    });
    if (pre.action === 'stop' || pre.action === 'restore') {
      settle(pre);
      return;
    }
    let cancelled = false;
    const measure = () => {
      if (cancelled || wbFirstEntrySizedRef.current) return;
      wbFirstMeasureAttemptsRef.current += 1;
      const catalog = document.querySelector('.chiner-model-catalog');
      const rows = catalog ? [...catalog.querySelectorAll(firstEntryMeasureRowSelector())] : [];
      const plan = planFirstEntryMeasure({
        // 手调守卫：异步等待期间用户已拖宽（手调键出现）则放弃，绝不覆盖本次宽度
        manualWidth: readWorkbenchSidebarManualWidth(getCache),
        storedAutoWidth: readWorkbenchSidebarAutoWidth(getCache, projectKey),
        filterActive: !!wbTreeFilter.trim(),
        firstLevelRowCount: rows.length,
        attempts: wbFirstMeasureAttemptsRef.current,
      });
      if (plan.action === 'stop' || plan.action === 'restore') {
        settle(plan);
        return;
      }
      if (plan.action === 'defer') return; // 不置 firstSized：等待有界重试
      const ctx = document.createElement('canvas').getContext('2d');
      let textWidth = 0;
      rows.forEach((row) => {
        const name = row.querySelector('.chiner-catalog-name');
        if (!name) return;
        ctx.font = getComputedStyle(name).font;
        let width = ctx.measureText(name.textContent || '').width;
        const badge = row.querySelector('.chiner-catalog-badge');
        if (badge) {
          ctx.font = getComputedStyle(badge).font;
          width += ctx.measureText(badge.textContent || '').width + 14;
        }
        textWidth = Math.max(textWidth, width);
      });
      // 只有真实一级层/旧主题域全部可测（测得有效文本宽）才标记 firstSized
      if (!textWidth) return;
      // 固定装饰宽：左缩进10 + 折叠箭头与边距 + 目录图标与间距 + ⋯按钮20 + 右内边距5 + 滚动条余量
      const inspectorWidth = wbInspectorOpen
        ? clampWorkbenchInspectorWidth(wbInspectorWidth, window.innerWidth) : 0;
      const next = clampWorkbenchSidebarWidth(
        calcFirstEntrySidebarWidth(textWidth + 77, window.innerWidth),
        window.innerWidth, inspectorWidth);
      if (Number.isFinite(next) && next > 0) {
        wbFirstEntrySizedRef.current = true;
        setWbSidebarWidth(next);
        writeWorkbenchSidebarAutoWidth(setCache, projectKey, next);
      }
    };
    // fonts ready 后一帧测量，避免字体未加载量宽偏小；每次条件变化重排一次尝试
    (document.fonts?.ready || Promise.resolve())
      .then(() => requestAnimationFrame(measure));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuType, wbTreeFilter]);
  // WB-002 二轮：有效草稿版本号（tabDataChange 写缓存时递增，驱动上下文面板重读草稿）
  const [wbDraftTick, setWbDraftTick] = useState(0);
  // S3：企业首页添加请求（公共合同 addRequest:{kind,nonce}），
  // ModelCatalog.onHomeAdd 打开首页并请求添加，EnterpriseHome 按 nonce 消费
  const [homeAddRequest, setHomeAddRequest] = useState(null);
  const [drawingSession, setDrawingSession] = useState(null);
  const [businessSession, setBusinessSession] = useState(null);
  // M2：指标平台（menuType 11）。首访后保活挂载（hidden 切换），未提交表单在
  // 模块往返中不静默丢失；写入经 MetricsWorkbench 内部领域命令（一次一次 update）
  const metricsRef = useRef(null);
  const [metricsKeepAlive, setMetricsKeepAlive] = useState(false);
  // M4B：指标定位事件（模型编辑器“指标关联”→ 指标平台；只接指标目标）
  const [metricsOpenRequest, setMetricsOpenRequest] = useState(null);
  useEffect(() => {
    if (menuType === '11') setMetricsKeepAlive(true);
  }, [menuType]);
  // M5B 首页指标入口（一次性意图，Home 发起）：项目打开成功进入 Main 后按项目
  // 类型分流——数据项目（module=data 或旧项目无 module）直接切到指标工作台；
  // 业务/画图项目不强改身份，给出明确说明并停留在默认模块。消费后回调清理，
  // 取消/失败不进入 Main，不残留。
  const metricsEntryRef = useRef(null);
  const metricsEntry = restProps.metricsEntry;
  const onMetricsEntryConsumed = restProps.onMetricsEntryConsumed;
  useEffect(() => {
    if (!metricsEntry || !metricsEntry.nonce) return;
    if (metricsEntryRef.current === metricsEntry.nonce) return;
    metricsEntryRef.current = metricsEntry.nonce;
    const module = restProps?.dataSource?.module;
    if (module === 'drawing' || module === 'business') {
      Message.warring({title: FormatMessage.string({id: 'metrics.entry.wrongModule', data: {
        module: FormatMessage.string({id: module === 'drawing'
          ? 'home.filterDrawing' : 'home.filterBusiness'}),
      }})});
    } else {
      setMetricsKeepAlive(true);
      setMenuType('11');
    }
    onMetricsEntryConsumed && onMetricsEntryConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricsEntry && metricsEntry.nonce]);
  const [platformRequest, setPlatformRequest] = useState(null);
  const [platformReturn, setPlatformReturn] = useState(null);
  const [ruleConfigOpen, openCheckRuleConfig] = useState(false);
  const [versionType, setVersionType] = useState('1');
  const currentVersionRef = useRef(null);
  const currentMetaRef = useRef(null);
  const projectInfoRef = useRef(projectInfo);
  projectInfoRef.current = projectInfo;
  const refreshProject = () => {
    Modal.confirm({
      title: FormatMessage.string({id: 'refreshConfirmTitle'}),
      message: FormatMessage.string({id: 'refreshConfirm'}),
      onOk:() => {
        isRefreshRef.current = true;
        if (projectInfoRef.current) {
          open(FormatMessage.string({id: 'readProject'}), projectInfoRef.current);
        } else {
          openTemplate(null, null, FormatMessage.string({id: 'readProject'}));
        }
      },
    });
  };
  const updateGroupType = (t) => {
    if(dataSourceRef.current.profile?.modelType !== t)  {
      restProps.update({
        ...dataSourceRef.current,
        profile: {
          ...dataSourceRef.current.profile,
          modelType: t,
        },
      });
      setGroupType(t);
    }
  };
  useEffect(() => {
    if(isRefreshRef.current) {
      isRefreshRef.current = false;
      updateTabs((pre) => {
        return pre.filter((p) => {
          // 企业首页/旧封面 tab 不对应模型集合对象，刷新时直接保留；
          // AI 临时候选 tab 是独立视图页（不在 allType），同样保留
          if (p.menuKey === 'home-cover' || p.type === 'ai-candidate') return true;
          const { name } = allType.filter(t => t.type === p.type)[0];
          return (restProps.dataSource[name] || []).findIndex(d => d.id === p.menuKey) > -1;
        });
      });
      setMainId(Math.uuid());
    }
  }, [restProps.dataSource]);
  // DATA-WB-FEAT-001 阶段A：数据建模项目（module 非绘图/业务）默认打开企业级首页；
  // 绘图/业务平台项目保持原初始工作区，不受影响
  useEffect(() => {
    const module = restProps?.dataSource?.module;
    if (module !== 'drawing' && module !== 'business' && tabsRef.current.length === 0) {
      _onMenuClick('home-cover', 'home', null, 'fa-home');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {if (drawingPersistence.available && !projectInfoRef.current) drawingPersistence.open('', dataSourceRef.current).catch(err => Message.error({title: err.message}));}, []);
  useEffect(() => {drawingPersistence.setCloseGuard(() => validateNeedSave(dataSourceRef.current));return () => drawingPersistence.setCloseGuard(null);}, []);
  // ===== AI 集成（PLATFORM-AI-IMPL-001/INTEGRATION）=====
  // 共享一个 Host IPC 客户端与一个 GATEWAY 实例；建模/绘图两域经同一宿主合同
  // 分发。会话（bind/epoch）按项目键驱动：切项目先 advance/end 旧会话再绑定新
  // 会话，旧 epoch 在途请求即刻作废；readonly 与 baseVersion 随项目状态同步。
  const aiRuntimeRef = useRef(null);
  const aiSessionRef = useRef(null);
  const aiCommitsRef = useRef(new Map());
  const aiPanelRef = useRef(null);
  const [aiForcedOpen, setAiForcedOpen] = useState(false);
  // R1 保活（父级）：一旦打开过 AI，检查器保持挂载；关闭（aiForcedOpen=false）
  // 只经 home-wb-no-inspector 隐藏布局，不卸载 AI 面板——草稿/消息/候选不丢，
  // More→AI 重开即恢复。切到绘图/业务平台（7/8）仍按原样卸载（域独立 AI）。
  const aiKeepAliveRef = useRef(false);
  const [aiCandidate, setAiCandidate] = useState(null);
  const aiCandidateRef = useRef(null);
  aiCandidateRef.current = aiCandidate;
  // 完整有效草稿（不是 getSearchDataSource 的有损投影）：合并已打开对象的
  // 编辑缓存与完整图 cells，作为 AI 计划/指纹/提交的统一基准
  const getAiValidDraft = useCallback(() => {
    const source = {...dataSourceRef.current};
    Object.values(getAllTabData()).filter(t => t.data && !t.isInit).forEach((t) => {
      if (t.type === 'diagram') {
        source.diagrams = (source.diagrams || []).map(d => (d.id === t.data.id
          ? {...d, canvasData: {cells: t.data.cells || []}} : d));
      } else {
        const typeName = allType.find(a => a.type === t.type)?.name;
        if (typeName && source[typeName]) {
          source[typeName] = source[typeName].map(d => (d.id === t.data.id ? t.data : d));
        }
      }
    });
    return source;
  }, []);
  // 建模域宿主提交：幂等（同 commandId 回放原结果）；写边界同步核验网关
  // expected（会话/epoch/baseVersion）与只读位；一次 restProps.update 同步
  // 已打开 tab 缓存（保留未触及草稿），失败可重试且不留已执行回执
  const commitAiModeling = useCallback(async (payload) => {
    if (aiCommitsRef.current.has(payload.commandId)) {
      return aiCommitsRef.current.get(payload.commandId);
    }
    try {
      const rt = aiRuntimeRef.current;
      const expected = payload.expected;
      if (rt && expected) {
        const session = rt.getSession();
        if (expected.projectSessionId !== session.projectSessionId
          || String(expected.epoch) !== String(session.epoch)
          || String(expected.baseVersion) !== String(session.baseVersion)) {
          return {ok: false, code: 'PROJECT_CHANGED', message: '宿主写入边界：会话/epoch/版本不匹配'};
        }
        if (session.readonly) {
          return {ok: false, code: 'READ_ONLY', message: '宿主写入边界：当前只读'};
        }
      }
      const next = payload.dataSource;
      (payload.receipt?.objects || []).forEach(({collection, id}) => {
        const type = {entities: 'entity', logicEntities: 'logicEntity',
          conceptEntities: 'conceptEntity', views: 'view'}[collection];
        if (!type) return;
        const tabKey = `${id}${separator}${type}`;
        const tabData = getDataByTabId(tabKey);
        if (tabData && tabData.data && tabData.data.id === id && !tabData.isInit) {
          const nextObj = (next[collection] || []).find(o => o.id === id);
          if (nextObj) {
            replaceDataByTabId(tabKey, {...tabData, data: nextObj});
            notify('tabDataChange', {id, d: nextObj});
          }
        }
      });
      dataSourceRef.current = next;
      restProps.update(next);
      const result = {ok: true};
      aiCommitsRef.current.set(payload.commandId, result);
      return result;
    } catch (error) {
      return {ok: false, code: 'COMMIT_FAILED', message: error && error.message};
    }
  }, [restProps]);
  if (!aiRuntimeRef.current) {
    aiRuntimeRef.current = initAiRuntime({
      client: createAiHostClient(),
      getModelingSnapshot: () => getAiValidDraft(),
      commitModeling: commitAiModeling,
      getDrawingDocuments: () => dataSourceRef.current.drawings || [],
    });
  }
  // 项目键变化 → 会话切换（旧会话作废）；卸载结束会话
  const aiProjectKey = wbProjectKeyRef.current;
  useEffect(() => {
    const rt = aiRuntimeRef.current;
    if (!rt || !rt.available()) return undefined;
    let cancelled = false;
    const run = async () => {
      if (aiSessionRef.current && aiSessionRef.current.key === aiProjectKey) return;
      const previous = aiSessionRef.current;
      aiSessionRef.current = null;
      rt.setSession({projectSessionId: '', epoch: 1, readonly: mode === READING, baseVersion: ''});
      if (previous) {
        try { await rt.client.advanceEpoch(previous.projectSessionId); } catch (e) { /* 旧会话可能已失效 */ }
        try { await rt.client.endSession(previous.projectSessionId); } catch (e) { /* 同上 */ }
      }
      const projectSessionId = `pmaner_${Math.uuid()}`;
      try {
        const bound = await rt.client.bindSession(projectSessionId);
        if (cancelled) return;
        aiSessionRef.current = {projectSessionId, epoch: bound.epoch, key: aiProjectKey};
        rt.setSession({projectSessionId, epoch: bound.epoch,
          readonly: mode === READING, baseVersion: 'v1'});
      } catch (e) {
        // Host 拒绝/不可用：会话保持空，发送请求会被拒绝并提示
      }
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiProjectKey, mode === READING]);
  // Main 卸载（关闭项目，src/app/home/index.js 换载）释放 AI 会话隔离最后一环
  // （msg_6948bfaf64c7）：结束项目会话并释放 Main 拥有的 runtime 与 client——
  // 在途按精确 ID 取消、旧宿主闭包随实例释放，新 Main 重新 initAiRuntime 绑定
  // 新宿主；异步收尾（endSession 回调）只作用于本实例，不清掉可能的新实例。
  useEffect(() => () => {
    const rt = aiRuntimeRef.current;
    const session = aiSessionRef.current;
    aiRuntimeRef.current = null;
    aiSessionRef.current = null;
    aiCommitsRef.current.clear();
    if (!rt) return;
    if (session && rt.available()) {
      rt.client.endSession(session.projectSessionId).catch(() => { /* 旧会话可能已失效 */ });
    }
    rt.dispose();      // 幂等：新宿主接管时已释放则无副作用
    rt.client.dispose(); // 本窗口客户端：结算在途 + best-effort Host 取消
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 项目草稿引用变化 → baseVersion 递增（旧计划提交前的 staleness 复验基准）
  useEffect(() => {
    const rt = aiRuntimeRef.current;
    if (rt && aiSessionRef.current) rt.bumpBaseVersion();
  }, [restProps.dataSource]);
  useEffect(() => {
    const rt = aiRuntimeRef.current;
    if (rt) rt.setSession({readonly: mode === READING});
  }, [mode]);
  // 保存成功：只有保存开始前已 dirty 的回执推到 saved（applied≠saved；
  // 保存期间/之后的新提交不得被本次成功回调误标，仍待下一次真实保存）
  const noteAiPersistenceSaved = (dirtyAtSaveStart) => {
    const rt = aiRuntimeRef.current;
    if (!rt) return;
    (dirtyAtSaveStart || []).forEach((commandId) => {
      const receipt = rt.gateway.getReceipt(commandId);
      if (receipt.ok && receipt.receipt.persistence
        && receipt.receipt.persistence.state === 'dirty') {
        rt.gateway.notePersistence({commandId, state: 'saved'});
      }
    });
  };
  const saveProject = (saveAs, callback) => {
    const isSaveAs = saveAs || !projectInfoRef.current;
    // 保存开始时刻的 dirty 回执清单：成功回调只推进这一批
    const aiRt = aiRuntimeRef.current;
    const dirtyAtSaveStart = aiRt ? aiRt.gateway.listReceipts()
      .filter(r => r.persistence && r.persistence.state === 'dirty')
      .map(r => r.commandId) : [];
    const newData = updateAllData(dataSourceRef.current);
    if (newData.result.status) {
      restProps.save(newData.dataSource, FormatMessage.string({id: 'saveProject'}), isSaveAs, (err) => {
        if (!err) {
          if (!isSaveAs) {
            // M5B 保存接缝：saveProject action 成功后已发布 canonical 已存快照
            // （saveProjectSuccess(tempData) → redux === memoryCache('data')，
            // validateNeedSave 真实清除）。这里不再用保存前的 newData.dataSource
            // 覆盖 redux——那会使 redux 与 memoryCache 引用/时间戳不一致，
            // 保存成功后仍恒显“未保存”。落盘窗口内新增的编辑不丢弃：tab 编辑
            // 重新合并后发布为待保存状态（保持脏），指标平台直写已由 action 保留。
            const tabCache = getAllTabData();
            const pendingTabIds = Object.keys(tabCache)
              .filter(c => tabCache[c] && !tabCache[c].isInit);
            if (pendingTabIds.length > 0) {
              const fresh = updateAllData(dataSourceRef.current);
              if (fresh.result.status) {
                restProps?.update(fresh.dataSource);
              }
            }
          }
          Message.success({title: FormatMessage.string({id: 'saveSuccess'})});
          clearAllTabData();
          noteAiPersistenceSaved(dirtyAtSaveStart);
          callback && callback(false);
        } else {
          callback && callback(true);
          Message.error({title: `${FormatMessage.string({id: 'saveFail'})}:${err?.message}`});
        }
      });
    } else {
      callback && callback(true);
      Modal.error({
        title: FormatMessage.string({id: 'optFail'}),
        message: newData.result.message,
        id: 'saveError',
      });
    }
  };
  useEffect(() => {
    Save(() => {
      saveProject();
    });
    return () => {
      removeSave();
    };
  }, [restProps.dataSource, tabs]);
  const validateTableStatus = (key) => {
    return tabsRef.current.findIndex(t => t.tabKey === key) >= 0;
  };
  const renderReady = (cav, key) => {
    cavRefArray.current = cavRefArray.current.filter(c => c.key !== key)
        .concat({
      cav,
      key,
    });
  };
  const locateDiagramCell = (tabKey, param, retries = 10) => {
    if (pendingDiagramLocationRef.current?.param !== param || activeKeyRef.current !== tabKey) {
      return;
    }
    const cav = cavRefArray.current.filter(c => c.key === tabKey)[0]?.cav;
    const cell = cav?.locateCell?.(param.cellId, param.originKey);
    if (cell) {
      pendingDiagramLocationRef.current = null;
    } else if (retries > 0) {
      setTimeout(() => {
        locateDiagramCell(tabKey, param, retries - 1);
      }, 100);
    } else {
      pendingDiagramLocationRef.current = null;
      Message.warring({title: FormatMessage.string({id: 'components.searchSuggest.nodeMissing'})});
    }
  };
  useEffect(() => {
    const pending = pendingDiagramLocationRef.current;
    if (pending && pending.tabKey === activeKey) {
      const frame = requestAnimationFrame(() => locateDiagramCell(pending.tabKey, pending.param));
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [activeKey, tabs]);
  // S3：经典布局剥离——updateNavEmptyHide/_groupMenuChange 随经典树头部一并移除，
  // 空/分组过滤不再写模型偏好
  const onLocation = (e) => {
    e.stopPropagation();
    const activeArray = activeKeyRef.current?.split(separator) || [];
    catalogRef.current?.jumpSimplePosition(activeArray[0], activeArray[1]);
  };
  const getCurrentCav = () => {
    return cavRefArray.current.filter(cav => activeKeyRef.current === cav.key)[0]?.cav;
  };
  useEffect(() => {
    const cavRef = getCurrentCav();
    if (cavRef) {
      setDraggable(true);
    } else {
      setDraggable(false);
    }
  }, [activeKey]);
  const _tabChange = (menuKey) => {
    updateActiveKey(menuKey);
    activeTabStack.current = activeTabStack.current.filter(k => k !== menuKey);
    activeTabStack.current.push(menuKey);
  };
  const _tabClose = (tabKey, force) => {
    const closeTab = () => {
      const tabKeys = [].concat(tabKey);
      // 重新设置激活的tab页
      let newActiveKey = null;
      activeTabStack.current = activeTabStack.current.filter(k => !tabKeys.includes(k));
      if (tabKeys.includes(activeKey)) {
        newActiveKey = activeTabStack.current[activeTabStack.current.length - 1];
      }
      updateTabs((pre) => {
        return pre.filter(t => !tabKeys.includes(t.tabKey));
      });
      cavRefArray.current = cavRefArray.current.filter(c => !tabKeys.includes(c.key));
      updateActiveKey((pre) => {
        return newActiveKey || pre;
      });
    };
    const tabData = getDataByTabId(tabKey);
    if (!force && (tabData && !tabData?.isInit)) {
      Modal.confirm({
        title: FormatMessage.string({id: 'saveConfirmTitle'}),
        message: FormatMessage.string({id: 'saveConfirm'}),
        onOk:() => {
          closeTab();
        },
      });
    } else {
      closeTab();
    }
  };
  const _tabCloseOther = (tabKey) => {
    activeTabStack.current = [tabKey];
    updateTabs(pre => pre.filter(t => t.tabKey === tabKey));
    cavRefArray.current = cavRefArray.current.filter(c => c.key === tabKey);
    updateActiveKey(tabKey);
    _tabChange(tabKey);
  };
  const _tabCloseAll = () => {
    updateTabs([]);
    cavRefArray.current = [];
    activeTabStack.current = [];
    updateActiveKey('');
  };
  const _onMenuClick = (menuKey, type, parentKey, icon, param) => {
    console.log(menuKey, type, parentKey, icon);
    const tabKey = menuKey + separator + type;
    if (type === 'diagram' && param?.originKey) {
      pendingDiagramLocationRef.current = {tabKey, param};
    } else {
      pendingDiagramLocationRef.current = null;
    }
    const tempTabs = [...tabsRef.current];
    if (!tempTabs.some(t => t.tabKey === tabKey)) {
      tempTabs.push({
        tabKey,
        menuKey,
        type,
        icon,
        style: type === 'diagram' ? { overflow: 'hidden' } : {},
        param,
      });
    } else if (param){
      if (type !== 'diagram') {
        tabInstanceRef.current[tabKey].twinkle(param.defKey);
      }
    }
    updateTabs(tempTabs);
    updateActiveKey(tabKey);
    activeTabStack.current = activeTabStack.current.filter(k => k !== tabKey);
    activeTabStack.current.push(tabKey);
  };
  const _onContextMenu = (key, type, selectedMenu, parentKey) => {
    updateContextMenus(getMenus(key, type, selectedMenu, parentKey, groupTypeRef.current));
  };
  const _contextMenuClick = (e, m, callback) => {
    dealMenuClick(dataSourceRef.current, m, restProps?.update, _tabClose,
        // eslint-disable-next-line no-use-before-define
        callback, genImg, _jumpDetail);
  };
  const getDataSource = () => {
    return dataSourceRef.current;
  };
  const getSearchDataSource = () => {
    const source = {...dataSourceRef.current};
    Object.values(getAllTabData()).filter(t => t.data && !t.isInit).forEach((t) => {
      const name = allType.find(a => a.type === t.type)?.name;
      if (name && source[name]) {
        source[name] = source[name].map(d => (d.id === t.data.id ? {
          ...d,
          ...(t.type === 'diagram' ? {canvasData: {
            cells: (t.data.cells || []).map(c => ({
              id: c.id,
              shape: c.shape,
              originKey: c.originKey,
            })),
          }} : t.data),
        } : d));
      }
    });
    return source;
  };
  // WB-004B：最小局部有效图快照接缝（仅右侧属性面板模型关联使用）。
  // 与 getSearchDataSource 的搜索快照约定互不影响：这里保留图草稿 cells 的边端点
  // （source.cell/target.cell）与表节点 originKey，并合并表对象未保存草稿（改名即时生效）。
  // 返回轻量结构 {tables: {id->有效表}, diagrams: [{id,defKey,defName,cells}]}，
  // 不深拷贝模型、不建立第二份模型状态。
  const getPlatformSource = () => {
    const source = getSearchDataSource();
    Object.values(getAllTabData()).filter(t => t.type === 'diagram' && t.data && !t.isInit).forEach(t => {
      source.diagrams = (source.diagrams || []).map(d => d.id === t.data.id ? {...d, canvasData: {cells: t.data.cells || []}} : d);
    });
    return source;
  };
  const getDiagramEdgeSnapshot = () => {
    const base = dataSourceRef.current;
    const drafts = Object.values(getAllTabData()).filter(t => t.data && !t.isInit);
    const tables = {};
    ['entities', 'logicEntities', 'conceptEntities', 'views'].forEach((name) => {
      (base[name] || []).forEach((e) => {
        tables[e.id] = e;
      });
    });
    drafts.filter(t => t.type === 'entity' || t.type === 'logicEntity' || t.type === 'conceptEntity' || t.type === 'view')
      .forEach((t) => {
        tables[t.data.id] = t.data;
      });
    const diagrams = (base.diagrams || []).map((d) => {
      const draft = drafts.filter(t => t.type === 'diagram' && t.data?.id === d.id)[0];
      return {
        id: d.id,
        defKey: d.defKey,
        defName: d.defName,
        cells: draft ? (draft.data.cells || []) : (d.canvasData?.cells || []),
      };
    });
    return {tables, diagrams};
  };
  const resize = (factor) => {
    const cavRef = getCurrentCav();
    if (cavRef) {
      cavRef.validateScale(factor);
    }
  };
  const genImg = (useBase = false, filterDiagrams = [], imageType = 'svg') => {
    const currentDiagrams = dataSourceRef.current?.diagrams || [];
    const diagrams = filterDiagrams.length === 0 ? currentDiagrams
        : currentDiagrams.filter(d => filterDiagrams.includes(d.id));
    return new Promise((resolve) => {
      const length = diagrams.length || 0;
      let count = 0;
      restProps.openLoading(FormatMessage.string({
        id: 'toolbar.exportWordStep1',
        data: { count, length },
      }));
      imgAll({
        ...dataSourceRef.current,
        diagrams,
      }, () => {
        count += 1;
        restProps.openLoading(FormatMessage.string({
          id: 'toolbar.exportWordStep1',
          data: { count, length },
        }));
      }, useBase, imageType).then((res) => {
        restProps.closeLoading();
        resolve(res);
      }).catch(() => {
        restProps.closeLoading();
      });
    });
  };
  const generateSimpleFile = (fileType) => {
    generateFile(fileType, dataSourceRef.current, (callback) => {
      genImg(true, [], 'svg').then((res) => {
        callback(res);
      });
    });
  };

  const dealExportFile = (result, file) => {
    if (result.status === 'FAILED') {
      const termReady = (term) => {
        term.write(typeof result.body === 'object' ? JSON.stringify(result.body, null, 2)
            : result.body);
      };
      restProps.closeLoading();
      Modal.error({
        bodyStyle: {width: '80%'},
        contentStyle: {width: '100%', height: '100%'},
        title: FormatMessage.string({id: 'optFail'}),
        message: <div>
          <div style={{textAlign: 'center'}}><FormatMessage id='dbConnect.log'/><a onClick={showItemInFolder}>{getLogPath()}</a></div>
          <Terminal termReady={termReady}/>
        </div>,
      });
    } else {
      restProps.closeLoading();
      Modal.success({
        title: FormatMessage.string({
          id: 'toolbar.exportSuccess',
        }),
        message: FormatMessage.string({
          id: 'toolbar.exportPath',
          data: {path: file},
        }),
      });
    }
  };

  const exportExcel = () => {
    selectDir(dataSourceRef.current.name, 'xlsx')
        .then((file) => {
          if (!file) return;
          restProps.openLoading(FormatMessage.string({id: 'toolbar.exportExcel'}));
          connectDB(dataSourceRef.current, configRef.current, {
            sinerFile: projectInfo,
            outFile: file,
          }, 'GenExcelImpl', (result) => {
            dealExportFile(result, file);
          });
        }).catch((err) => {
          restProps.closeLoading();
          Modal.error({title: FormatMessage.string({id: 'optFail'}), message: err.message || err});
        });
  };
  const exportWord = () => {
    openModal(<ExportWord
      save={restProps.save}
      projectInfo={projectInfoRef.current}
      dataSource={dataSourceRef.current}
      onOk={(t, filterDataSource) => {
      selectWordFile(dataSourceRef.current, t)
          .then((selection) => {
            if (!selection) return undefined;
            const [dir, template] = selection;
            return genImg(false, [], 'png').then((imgDir) => {
              //console.log(template, imgDir);
              restProps.openLoading(FormatMessage.string({id: 'toolbar.exportWordStep2'}));
              connectDB(filterDataSource || dataSourceRef.current, configRef.current, {
                sinerFile: projectInfo,
                docxTpl: template,
                imgDir: imgDir,
                imgExt: '.png',
                outFile: dir,
              }, 'GenDocx', (result) => {
                dealExportFile(result, dir);
              });
            });
          }).catch((err) => {
            restProps.closeLoading();
            Modal.error({title: FormatMessage.string({id: 'optFail'}), message: err.message || err});
          });
    }}/>, {
      bodyStyle: { width: '70%' },
      title: FormatMessage.string({id: 'toolbar.exportWord'}),
    });
  };
  const exportImg = (type) => {
    const cavRef = getCurrentCav();
    cavRef.exportImg(type);
  };
  /**
   * 计算类型的度量，长度,精度
   * 初衷：各个数据库类型和写法的不一致也能在逆向解析中成功识别到domain，比如 整型字段
   * mysql: INT
   * oracle: NUMBER(10), 如果也写成int，则oracle中会是 NUMBER(38)
   * 在oralce中得到的某个field为：
   * {
   *   "len": 10,
   *   "scale": null,
   *   "type": "NUMBER",
   *   "typeFullName": "NUMBER(10)"
   * }
   * 就能匹配上如下的mapping和domain了
   * 如下的mapping：
   * {
   *   "defKey": "int",
   *   "id": "IDxINT",
   *   "defName": "整数",
   *   "IDxMYSQL": "INT",
   *   "IDxORACLE": "NUMBER(10)",
   *   "IDxJAVA": "Integer"
   * },
   * 以及如下的domain定义：
   * {
   *   "defKey": "Int",
   *   "defName": "整数(INT)",
   *   "applyFor": "IDxINT",
   *   "len": "",
   *   "scale": "",
   *   "uiHint": "",
   *   "id": "IDxDOMAINxInt"
   * }
   * @param {String} len - 字段长度
   * @param {String} scale - 字段精度
   * @returns (长度[,精度]) 或者 ''
   */
  const calcMeasure = (len = '', scale = '') => {
    if (!len) {
      return '';
    }
    if (!scale) {
      return `(${len})`;
    }
    return `(${len},${scale}`;
  };
  const calcDomain = (data = [], dbKey = null, finalDomains) => {
    const dataTypeSupports = _.get(dataSourceRef.current, 'profile.dataTypeSupports', []);
    const defaultDb = _.get(dataSourceRef.current, 'profile.default.db', dataTypeSupports[0]);
    const mappings = _.get(dataSourceRef.current, 'dataTypeMapping.mappings', []);
    const domains = finalDomains || _.get(dataSourceRef.current, 'domains', []);
    const dbConn = dataSourceRef.current?.dbConn || [];
    const currentDb = dbConn.filter(d => d.id === dbKey)[0]?.type || defaultDb;
    const omitNames = ['autoIncrementName', 'notNullName', 'primaryKeyName', 'typeFullName', 'rowNo', 'typeFullName'];
    return data.map((d) => {
      return {
        ...updateHeaders(d, 'entity', true),
        fields: (d.fields || []).map((f) => {
          const domainData = domains.map((domain) => {
            const mapping = mappings.filter(m => m.id === domain.applyFor)[0];
            return {
              id: domain.id,
              // 为了存储到后面的 baseType
              applyFor: domain.applyFor,
              type: `${mapping?.[currentDb]?.toLocaleLowerCase()}${calcMeasure(domain.len || '', domain.scale || '')}`,
            };
          }).filter(domain => domain.type === `${f.type?.toLocaleLowerCase()}${calcMeasure(f.len || '', f.scale || '')}`)[0];
          const domain = domainData?.id || '';
          if (domain) {
            return {
              ..._.omit(f, omitNames),
              domain,
              len: '',
              scale: '',
              // 有domain后，type置空，才能根据domain以及目标数据库来动态生成类型
              type: '',
              baseType: domainData.applyFor,
            };
          }
          return {
            ..._.omit(f, omitNames),
            len: f.len === null ? '' : f.len,
            scale: f.scale === null ? '' : f.scale,
            domain: '',
          };
        }),
      };
    });
  };
  const injectDataSource = (dataSource, modal) => {
    // M4B 窄通知：先取导入前诊断数（update 后 dataSourceRef 尚未推进）
    const diagBefore = (dataSourceRef.current?.profile?.metricPlatform?.importDiagnostics || []).length;
    restProps?.update({...dataSource});
    Message.success({title: FormatMessage.string({id: 'optSuccess'})});
    const diagAfter = (dataSource?.profile?.metricPlatform?.importDiagnostics || []).length;
    if (diagAfter > diagBefore) {
      // 引导到指标平台“模型关联”页查看重命名/冲突/未随导入明细（不重写导入模块）
      Message.warring({title: FormatMessage.string({
        id: 'metrics.binding.diag.importNotice', data: {count: diagAfter - diagBefore}})});
    }
    modal && modal.close();
  };
  const importFromPDMan = (type) => {
    Upload('application/json', (data, file) => {
      try {
        let newData = (type === 'chiner' || type === 'PDManer') ? JSON.parse(data) : pdman2sino(JSON.parse(data), file.name);
        let modal;
        const onCancel = () => {
          modal.close();
        };
        const compareType = compareVersion('3.5.0', newData.version.split('.')) ? 'defKey' : 'old';
        newData = reduceProject(newData, compareType);
        const checkDefaultDb = () => {
          const dbPath = 'profile.default.db';
          const dataTypeSupportsPath = 'profile.dataTypeSupports';
          const newDefault = _.get(newData, dbPath);
          const currentDefault = _.get(dataSourceRef.current, dbPath);
          const newDataTypeSupport = _.get(newData, dataTypeSupportsPath, [])
              .find(d => d.id === newDefault)?.defKey?.toLocaleLowerCase() || '';
          const currentDataTypeSupport = _.get(dataSourceRef.current, dataTypeSupportsPath, [])
              .find(d => d.id === currentDefault)?.defKey?.toLocaleLowerCase() || '';
          return newDefault === currentDefault || newDataTypeSupport === currentDataTypeSupport;
        };
        const checkResult = checkDefaultDb();
        const injectData = () => {
          const onOk = () => {
            const importData = importPdRef.current.getData()
                .reduce((a, b) => a.concat((b.fields || [])
                    .map(f => ({
                      ...f,
                      group: b.id,
                    }))), []);
            restProps.openLoading();
            mergeDataSource(dataSourceRef.current, newData, importData, true, (d) => {
              if(d) {
                injectDataSource(d, modal);
              } else {
                modal?.close();
              }
              restProps.closeLoading();
            });
          };
          const allRefEntities = newData.viewGroups.reduce((a, b) => a.concat(b.refEntities), []);
          restProps.closeLoading();
          modal = openModal(<>
            {(newData.conceptEntities?.length || newData.profile?.modelCatalog) && <p className='chiner-wb-table-note'>
              <FormatMessage id='modelCatalog.importNotice'/>
            </p>}
            <ImportPd
            defaultSelected={newData.diagrams.reduce((a, b) => a
                  .concat((b.canvasData?.cells || []).map(c => c.originKey)
                      .filter(c => !!c)), [])}
            customerData={newData.viewGroups.map((g) => {
                return {
                  ...g,
                  id: dataSourceRef.current.viewGroups
                      ?.filter(group => group.defKey === g.defKey)[0]?.id || g.id,
                  fields: (newData.entities || [])
                      .filter(e => (g.refEntities || [])
                          .includes(e.id)),
                };
              }).concat({
                id: '',
                defKey: '',
                defName: FormatMessage.string({id: 'components.select.empty'}),
                fields: newData.entities.filter(e => !allRefEntities.includes(e.id)),
              })}
            ref={importPdRef}
            dataSource={dataSourceRef.current}
          /></>, {
            bodyStyle: {width: '80%'},
            buttons: [
              <Button type='primary' key='ok' onClick={onOk}><FormatMessage id='button.ok'/></Button>,
              <Button key='cancel' onClick={onCancel}><FormatMessage id='button.cancel'/></Button>],
            // eslint-disable-next-line no-nested-ternary
            title: FormatMessage.string({id: `toolbar.${type === 'chiner' ? 'importCHNR' : (type === 'PDManer' ? 'importPDManer' : 'importPDMan')}`}),
          });
        };
        if (checkResult) {
          injectData();
        } else {
          restProps.closeLoading();
          Modal.confirm({
            title: FormatMessage.string({id: 'importConfirmTitle'}),
            message: FormatMessage.string({id: 'importConfirm'}),
            onOk:() => {
              injectData();
            },
          });
        }
      } catch (err) {
        console.log(err);
        restProps.closeLoading();
        Modal.error({
          title: FormatMessage.string({id: 'optFail'}),
          message: err.message,
        });
      }
    }, (file) => {
      const calcResult = () => {
        if (type === 'chiner') {
          return file.name.endsWith('.chnr.json');
        } else if (type === 'PDManer') {
          return file.name.endsWith('.pdma.json');
        }
        return file.name.endsWith('.pdman.json');
      };
      const result = calcResult();
      if (!result) {
        Modal.error({
          title: FormatMessage.string({id: 'optFail'}),
          // eslint-disable-next-line no-nested-ternary
          message: FormatMessage.string({id: type === 'chiner' ? 'invalidCHNRFile' : (type === 'PDManer' ? 'invalidPDManerFile' : 'invalidPDManFile')}),
        });
      }
      if(result) {
        restProps.openLoading();
      }
      return result;
    });
  };
  const dealParseFile = (result, type) => {
    if (result.status === 'FAILED') {
      const termReady = (term) => {
        term.write(typeof result.body === 'object' ? JSON.stringify(result.body, null, 2)
            : result.body);
      };
      Modal.error({
        bodyStyle: {width: '80%'},
        contentStyle: {width: '100%', height: '100%'},
        title: FormatMessage.string({id: 'optFail'}),
        message: <div>
          <div style={{textAlign: 'center'}}><FormatMessage id='dbConnect.log'/><a onClick={showItemInFolder}>{getLogPath()}</a></div>
          <Terminal termReady={termReady}/>
        </div>,
      });
      restProps.closeLoading();
    } else {
      restProps.closeLoading();
      const entities = (result.body?.tables || result.body?.entities || result.body || [])
          .map((t) => {
        const fields = (t.fields || []).map(f => ({...f, id: Math.uuid()}));
        return {
          ...t,
          id: Math.uuid(),
          fields,
          oldId: t.id,
          indexes: (t.indexes || []).map(i => ({
            ...i,
            id: Math.uuid(),
            fields: (i.fields || []).map((f) => {
              return {
                ...f,
                fieldDefKey: fields.find(field => field.defKey.toLocaleLowerCase() ===
                        f.fieldDefKey.toLocaleLowerCase())?.id
                    || f.fieldDefKey,
                id: Math.uuid(),
              };
            }),
          })),
        };
      });
      const dicts = (result.body?.dicts || []).map((d) => {
        return {
          ...d,
          id: d.id || Math.uuid(),
          items: (d.items || []).map((i) => {
            return {
              ..._.omit(i, ['rowNo', 'enabledName']),
              id: Math.uuid(),
            };
          }),
        };
      });
      const viewGroups = (result.body?.groupTopics || result.body?.viewGroups)?.map((g) => {
        return {
          ...g,
          id: dataSourceRef.current.viewGroups
              ?.filter(group => group.defKey === g.defKey)[0]?.id || g.id || Math.uuid(),
          fields: (entities || [])
              .filter(e => (g.refEntities || [])
                  .includes(e.oldId)).map(e => _.omit(e, 'oldId')),
          refViews: [],
          refDiagrams: [],
          refDicts: [],
        };
      });
      let modal;
      const onCancel = () => {
        modal.close();
      };
      const onOk = () => {
        console.log('====');
        const importData = importPdRef.current.getData()
            .reduce((a, b) => a.concat((b.fields || [])
                .map(f => ({
                  ...f,
                  group: b.id,
                }))), []);
        const domains = calcDomains(result.body?.domains || [], dataSourceRef.current.dataTypeMapping?.mappings, 'defKey');
        const finallyDomains = mergeData(dataSourceRef.current?.domains || [],
            domains,false, false);
        restProps.openLoading();
        mergeDataSource(dataSourceRef.current,
            {
              domains,
              dicts,
              viewGroups: (viewGroups || [])
                  .map((g) => {
                    return {
                      ..._.omit(g, 'fields'),
                      refEntities: g.fields.map(f => f.id),
                    };
                  }),
            }, calcDomain(importData, null, finallyDomains), true, (d) => {
              if(d) {
                injectDataSource(d, modal);
              } else {
                modal?.close();
              }
              restProps.closeLoading();
            });
      };
      const allRefEntities = (viewGroups || [])
          .reduce((a, b) => a.concat(b.fields.map(f => f.id)), []);
      modal = openModal(<ImportPd
        customerData={viewGroups ? viewGroups.concat({
            id: '',
            defKey: '',
            defName: FormatMessage.string({id: 'components.select.empty'}),
            fields: entities.filter(e => !allRefEntities.includes(e.id)).map(e => _.omit(e, 'oldId')),
          }) : null}
        data={entities.map(e => _.omit(e, 'oldId'))}
        ref={importPdRef}
        dataSource={dataSourceRef.current}
      />, {
        bodyStyle: {width: '80%'},
        buttons: [
          <Button type='primary' key='ok' onClick={onOk}><FormatMessage id='button.ok'/></Button>,
          <Button key='cancel' onClick={onCancel}><FormatMessage id='button.cancel'/></Button>],
        title: FormatMessage.string({id: `toolbar.${type}`}),
      });
    }
  };
  const importFromExcel = () => {
    let model;
    const onPicker = () => {
      Upload('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', (file) => {
        model && model.close();
        restProps.openLoading();
        connectDB(dataSourceRef.current, configRef.current, {
          excelFile: file.path,
        }, 'ParseExcelFileImpl', (result) => {
          dealParseFile(result);
        });
      }, (f) => {
        return f.name.endsWith('.xlsx');
      }, false);
    };
    model = openModal(<ImportExcel onPicker={onPicker}/>, {
      title: FormatMessage.string({id: 'toolbar.importExcel'}),
    });
  };
  const importFromPb = (type) => {
    Upload(type === 'PD' ? '' : 'text/x-sql', (data) => {
      restProps.openLoading();
      connectDB(dataSourceRef.current, configRef.current, {
        [type === 'PD' ? 'pdmFile' : 'ddlFile']: data.path,
      }, type === 'PD' ? 'ParsePDMFile' : 'DDLParseImpl', (result) => {
        dealParseFile(result, type === 'PD' ? 'importPowerDesigner' : 'importDDL');
      });
    }, (file) => {
      const result = type === 'PD' ? (file.name.endsWith('.pdm') || file.name.endsWith('.PDM')) :
          (file.name.endsWith('.sql') || file.name.endsWith('.txt') || file.name.endsWith('.ddl'));
      if (!result) {
        Modal.error({
          title: FormatMessage.string({id: 'optFail'}),
          message: FormatMessage.string({id: type === 'PD' ? 'invalidPdmFile' : 'invalidDDLFile'}),
        });
      }
      return result;
    }, false);
  };
  const calcData = (oldData, newData, keyName = 'id') => {
    return newData.map((d) => {
      const index = oldData.findIndex(o => o.defKey === d.defKey);
      if (index > -1) {
        return {
          ...d,
          [keyName]: oldData[index][keyName],
        };
      }
      return d;
    }).concat(oldData
      .filter(o => newData.findIndex((n) => {
        return n.defKey === o.defKey;
      }) < 0));
  };
  const configFields = ['profile.default.entityInitFields',
    'profile.default.entityInitProperties', 'profile.sql.delimiter', 'profile.generatorDoc.docTemplate',
  'profile.relationFieldSize', 'profile.uiHint', 'profile.relationType', 'profile.extProps',
    'profile.headers',
    'profile.DDLToggleCase'];
  const parseImportJson = (text, errorId, validate, transform = value => value) => {
    try {
      const data = JSON.parse(text);
      const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
      const isObjectArray = value => Array.isArray(value) && value.every(isObject);
      const isNamedArray = value => isObjectArray(value)
        && value.every(item => typeof item.defKey === 'string' && item.defKey.trim());
      if (!isObject(data) || !validate(data, {isObject, isObjectArray, isNamedArray})) {
        throw new Error(FormatMessage.string({id: errorId}));
      }
      // 所有校验与合并先在临时数据完成，失败不得触碰当前模型或触发 update。
      return transform(data);
    } catch (error) {
      Modal.error({
        title: FormatMessage.string({id: 'optFail'}),
        message: FormatMessage.string({id: errorId}),
      });
      return null;
    }
  };
  const importConfig = () => {
    Upload('application/json', (d) => {
      const data = parseImportJson(d, 'invalidConfigFile',
        (value, {isObject, isObjectArray, isNamedArray}) =>
        isObject(value.profile)
        && ['profile.default', 'profile.sql', 'profile.generatorDoc', configFields[1], configFields[7]]
          .every(f => _.get(value, f) === undefined || isObject(_.get(value, f)))
        && [configFields[0], configFields[5]]
          .every(f => _.get(value, f) === undefined || isNamedArray(_.get(value, f)))
        && (value.profile.headers === undefined || (isObjectArray(value.profile.headers)
          && value.profile.headers.every(header => typeof header.refKey === 'string')))
        && (value.dictSQLTemplate === undefined || isObject(value.dictSQLTemplate)), (value) => {
        const codeTemplates = _.get(dataSourceRef.current, 'profile.codeTemplates', []);
        let tempData = JSON.parse(JSON.stringify(dataSourceRef.current));
        // 先建立 UI 建议的目标 ID，随后初始字段才能按导出代码恢复引用。
        [configFields[5], ...configFields.filter(f => f !== configFields[5])].forEach((f) => {
          const oldData = _.get(tempData, f);
          let newData = _.get(value, f, oldData);
          if (f === configFields[5] || f === configFields[0]) {
            newData = (newData || []).map(o => ({...o, id: Math.uuid()}));
            if (f === configFields[0]) {
              newData = newData.map(n => reset(n, tempData, ['defKey', 'id']));
            }
            newData = calcData(oldData || [], newData);
          }
          tempData = _.set(tempData, f, newData);
        });
        return {
          ...tempData,
          profile: {
            ...tempData.profile,
            codeTemplates: 'dictSQLTemplate' in value ? codeTemplates.map((t) => {
              if (t.applyFor === 'dictSQLTemplate' && t.type === 'dbDDL') {
                return value.dictSQLTemplate;
              }
              return t;
            }) : codeTemplates,
          },
        };
      });
      if (!data) return;
      restProps?.update(data);
      Message.success({title: FormatMessage.string({id: 'optSuccess'})});
    }, (file) => {
      const result = file.name.endsWith('.json');
      if (!result) {
        Modal.error({
          title: FormatMessage.string({id: 'optFail'}),
          message: FormatMessage.string({id: 'invalidConfigFile'}),
        });
      }
      return result;
    });
  };
  const exportConfig = () => {
    let data = {
      ..._.pick(dataSourceRef.current, configFields),
      dictSQLTemplate: _.get(dataSourceRef.current, 'profile.codeTemplates', [])
        .filter(t => t.applyFor === 'dictSQLTemplate' && t.type === 'dbDDL')[0],
    };
    data = _.set(data, configFields[0], _.get(data, configFields[0], [])
      .map(d => reset(d, dataSourceRef.current, ['id', 'defKey'])));
    Download(
      [JSON.stringify(data, null, 2)],
      'application/json',
      `${dataSourceRef.current.name}-${FormatMessage.string({id: 'toolbar.setting'})}-${moment().format('YYYYMDHHmmss')}.json`);

  };
  const exportDicts = () => {
    let data = {
      dicts: dataSourceRef.current.dicts || [],
    };
    Download(
        [JSON.stringify(data, null, 2)],
        'application/json',
        `${dataSourceRef.current.name}-${FormatMessage.string({id: 'toolbar.dicts'})}-${moment().format('YYYYMDHHmmss')}.json`);

  };
  const importDicts = () => {
    Upload('application/json', (d) => {
      const data = parseImportJson(d, 'invalidDictsFile', (value, {isObjectArray, isNamedArray}) =>
        isNamedArray(value.dicts) && value.dicts.every(dict =>
          dict.items === undefined || (isObjectArray(dict.items) && dict.items.every(item =>
            typeof item.defKey === 'string' || typeof item.defKey === 'number'))), (value) => {
        const current = JSON.parse(JSON.stringify(dataSourceRef.current));
        return {...current, dicts: mergeData(current.dicts || [], value.dicts, false, true)};
      });
      if (data) {
        restProps?.update(data);
        Message.success({title: FormatMessage.string({id: 'optSuccess'})});
      }
    }, (file) => {
      const result = file.name.endsWith('.json');
      if (!result) {
        Modal.error({
          title: FormatMessage.string({id: 'optFail'}),
          message: FormatMessage.string({id: 'invalidDictsFile'}),
        });
      }
      return result;
    });
  };
  const exportDomains = (type) => {
    const codeTemplates = _.get(dataSourceRef.current, 'profile.codeTemplates', [])
        .filter((t) => {
          if (type === 'dbDDL') {
            return (t.applyFor !== 'dictSQLTemplate') && (t.type === 'dbDDL');
          } else {
            return t.type === 'appCode';
          }
        });
    const dataTypeMapping = _.get(dataSourceRef.current, 'dataTypeMapping', {});
    Download(
      [JSON.stringify({
        codeTemplates,
        dataTypeSupports: _.get(dataSourceRef.current, 'profile.dataTypeSupports', [])
            .filter(d => codeTemplates.findIndex(c => c.applyFor === d.id) > -1),
        dataTypeMapping: {
          ...dataTypeMapping,
          mappings: (dataTypeMapping.mappings).map(m => Object.keys(m).reduce((a, b) => {
            const names = ['defKey', 'defName', 'id'];
            if (!names.includes(b) && codeTemplates.findIndex(c => c.applyFor === b) < 0) {
              return a;
            }
            return {
              ...a,
              [b]: m[b],
            };
          }, {})),
        },
        domains: _.get(dataSourceRef.current, 'domains', []),
      }, null, 2)],
      'application/json',
      `${dataSourceRef.current.name}-${FormatMessage.string({id: `${type === 'dbDDL' ? 'domainTab' : `project.${type}`}`})}-${moment().format('YYYYMDHHmmss')}.json`);
  };
  const importDomains = (type) => {
    Upload('application/json', (d) => {
      const data = parseImportJson(d, type === 'appCode' ? 'invalidAppCodesFile' : 'invalidDomainsFile',
        (value, {isObject, isObjectArray, isNamedArray}) => isNamedArray(value.domains)
          && isObjectArray(value.codeTemplates) && value.codeTemplates.every(template =>
            typeof template.applyFor === 'string' && typeof template.type === 'string')
          && isNamedArray(value.dataTypeSupports) && isObject(value.dataTypeMapping)
          && isNamedArray(value.dataTypeMapping.mappings),
        value => mergeDomains(JSON.parse(JSON.stringify(dataSourceRef.current)), value, type));
      if (data) {
        restProps?.update(data);
        Message.success({title: FormatMessage.string({id: 'optSuccess'})});
      }
    }, (file) => {
      const result = file.name.endsWith('.json');
      if (!result) {
        Modal.error({
          title: FormatMessage.string({id: 'optFail'}),
          message: FormatMessage.string({id: 'invalidDomainsFile'}),
        });
      }
      return result;
    });
  };
  const importFromDb = () => {
    // 判断是否已经存在数据库连接
    const dbConn = dataSourceRef.current?.dbConn || [];
    if (dbConn.length === 0) {
      Modal.error({
        title: FormatMessage.string({id: 'optFail'}),
        message: FormatMessage.string({id: 'dbReverseParse.emptyDbConn'}),
      });
    } else {
      let modal;
      const onClose = () => {
        modal && modal.close();
      };
      const onOk = (data, dbKey) => {
        restProps.openLoading();
        mergeDataSource(dataSourceRef.current, {},
            calcDomain(data, dbKey, dataSourceRef.current.domains || []), true, (d) => {
              if(d) {
                injectDataSource(d, modal);
              } else {
                modal?.close();
              }
              restProps.closeLoading();
            });
      };
      modal = openModal(<DbReverseParse
        openLoading={restProps.openLoading}
        closeLoading={restProps.closeLoading}
        config={configRef.current}
        onOk={onOk}
        onClose={onClose}
        dataSource={dataSourceRef.current}
      />, {
        closeable: false,
        title: FormatMessage.string({id: 'toolbar.importDb'}),
        bodyStyle: { width: '80%' },
      });
    }
  };
  const exportSql = (type) => {
    let modal;
    const onClose = () => {
      modal && modal.close();
    };
    modal = openModal(<ExportSql templateType={type} dataSource={dataSourceRef.current}/>, {
      title: FormatMessage.string({id: `toolbar.${type === 'dict' ? 'exportDict' : 'exportSql'}`}),
      bodyStyle: { width: '80%' },
      buttons: [
        <Button key='onClose' onClick={onClose}>
          <FormatMessage id='button.close'/>
        </Button>,
      ],
    });
  };
  const createEmptyTable = (e, key, type) => {
    const cavRef = getCurrentCav();
    cavRef?.startDrag(e, key, type);
    return cavRef;
  };
  const createTopicNode = (e) => {
    // Message.warring({title: FormatMessage.string({id: 'wait'})});
    const cavRef = getCurrentCav();
    cavRef?.createTopicNode(e);
  };
  const quickCompareDb = () => {
    setMenuType('4');
    setVersionType('2');
  };
  const createNode = (e, type) => {
    const cavRef = getCurrentCav();
    cavRef?.startRemarkDrag(e, type);
  };
  const createGroupNode = (e) => {
    const cavRef = getCurrentCav();
    cavRef?.startGroupNodeDrag(e);
  };
  const createPolygonNode = (e) => {
    const cavRef = getCurrentCav();
    cavRef?.startPolygonNodeDrag(e);
  };
  const createCircleNode = (e) => {
    const cavRef = getCurrentCav();
    cavRef?.createCircleNode(e);
  };
  const alignment = (align) => {
    const cavRef = getCurrentCav();
    cavRef?.alignment(align);
  };
  const themeChange = () => {
    const themeMode = dataSourceRef.current?.profile?.themeMode || 'themeDay';
    restProps?.update({
      ...dataSourceRef.current,
      profile: {
        ...dataSourceRef.current.profile,
        themeMode: themeMode === 'themeDay' ? 'themeNigh' : 'themeDay',
      },
    });
  };
  const showHistory = () => {
    let modal;
    const onCancel = () => {
      modal && modal.close();
    };
    const close = () => {
      onCancel();
      _tabCloseAll();
    };
    modal = openModal(<History
      config={config}
      close={close}
      info={projectInfoRef.current}
      data={dataSourceRef.current}
      openLoading={restProps.openLoading}
      closeLoading={restProps.closeLoading}
      updateProject={restProps.update}
    />, {
      bodyStyle: { width: '60%' },
      buttons:  [
        <Button key='cancel' onClick={onCancel}>
          <FormatMessage id='button.close'/>
        </Button>],
      title: FormatMessage.string({id: 'toolbar.history'}),
    });
  };
  const quickCompareTable = () => {
    let modal;
    const onCancel = () => {
      modal && modal.close();
    };
    modal = openModal(<CompareTable
      getDataSource={getDataSource}
      updateProject={restProps.update}
      openLoading={restProps.openLoading}
      closeLoading={restProps.closeLoading}
      dataSource={dataSourceRef.current}
    />, {
      bodyStyle: { width: '90%' },
      buttons:  [
        <Button key='cancel' onClick={onCancel}>
          <FormatMessage id='button.close'/>
        </Button>],
      title: FormatMessage.string({id: 'toolbar.compareTable'}),
    });
  };
  const toggleCase = () => {
    let modal;
    let tempValue;
    const onChange = (value) => {
      tempValue = value;
    };
    const onOk = () => {
      if (tempValue) {
        const toggleDatasource = toggleCaseDataSource(tempValue, dataSourceRef.current);
        restProps?.update(
            {
              ...toggleDatasource,
              profile: {
                ...toggleDatasource.profile,
                DDLToggleCase: tempValue?.DDLToggleCase || toggleDatasource?.profile?.DDLToggleCase,
              },
            },
        );
        const allTab = getAllTabData();
        Object.keys(allTab).map(t => ({tabKey: t, tabData: allTab[t]})).forEach((t) => {
          const type = t.tabData.type;
          if (type === 'entity' || type === 'view') {
            const data = toggleCaseEntityOrView(t.tabData.data, tempValue);
            if (data) {
              replaceDataByTabId(t.tabKey, {
                ...t.tabData,
                data,
              });
              notify('tabDataChange', {id: t.tabData.key, d: data});
            }
          }
        });
      }
      Message.success({title: FormatMessage.string({id: 'optSuccess'})});
      modal && modal.close();
    };
    const onCancel = () => {
      modal && modal.close();
    };
    modal = openModal(<ToggleCase
      onChange={onChange}
      dataSource={dataSourceRef.current}
    />, {
      bodyStyle: { width: '400px' },
      buttons:  [<Button type='primary' key='ok' onClick={onOk}>
        <FormatMessage id='button.ok'/>
      </Button>,
        <Button key='cancel' onClick={onCancel}>
          <FormatMessage id='button.cancel'/>
        </Button>],
      title: FormatMessage.string({id: 'toolbar.toggleCase'}),
    });
  };
  const domainMenu = useMemo(() => {
    if(menuType === '2') {
      return [
        {
          id: 'dataTypeMapping',
          defKey: 'dataTypeMapping',
          type: 'dataTypeMapping',
          icon: 'fa-cube',
          defName: FormatMessage.string({id: 'project.dataTypeMapping'}),
          children: (restProps.dataSource?.dataTypeMapping?.mappings || []).map(d => ({...d, type: 'mapping'})),
        },
        {
          id: 'domains',
          defKey: 'domains',
          type: 'domains',
          icon: 'fa-key',
          defName: FormatMessage.string({id: 'project.domains'}),
          children: (restProps.dataSource?.domains || []).map(d => ({...d, type: 'domain'})),
        },
        {
          id: 'dataTypeSupports',
          defKey: 'dataTypeSupports',
          type: 'dataTypeSupport',
          icon: 'fa-database',
          defName: FormatMessage.string({id: 'project.dataTypeSupport'}),
          children: (restProps.dataSource?.profile?.dataTypeSupports || [])
              .filter((d) =>  {
                const codeTemplate = (restProps.dataSource?.profile?.codeTemplates || [])
                    .find(c => c.applyFor === d.id);
                return codeTemplate?.type !== 'appCode';
              })
              .map(d => ({...d, type: 'dataType'})),
        },
      ];
    }
    return [];
  }, [restProps.dataSource?.dataTypeMapping?.mappings,
      restProps.dataSource?.domains,
    restProps.dataSource?.profile?.dataTypeSupports,
    restProps.dataSource?.profile?.codeTemplates,
    restProps.dataSource?.profile?.default?.db,
    config.lang, menuType]);
  const appCodeMenu = useMemo(() => {
    if(menuType === '3') {
      return (restProps.dataSource?.profile?.dataTypeSupports || [])
          .map((d) => {
            const template = (restProps.dataSource?.profile?.codeTemplates || [])
                .find(c => c.applyFor === d.id);
            if (template && template.type === 'appCode') {
              return {...d, type: 'appCode'};
            }
            return null;
          }).filter(d => !!d);
    }
    return [];
  }, [
              restProps.dataSource?.profile?.dataTypeSupports,
              restProps.dataSource?.profile?.codeTemplates,
    menuType,
    config.lang]);

  // 标准域资源统计（真实数据同源：词元/字段标准库）
  const wbStandardStats = useMemo(() => ({
    roots: (restProps.dataSource?.profile?.fieldRecommendation?.wordRoots || []).length,
    fields: (restProps.dataSource?.standardFields || [])
      .reduce((count, group) => count + (group?.fields || []).length, 0),
  }), [restProps.dataSource?.profile?.fieldRecommendation?.wordRoots,
      restProps.dataSource?.standardFields]);
  // 新工作台文档页签激活：非模型域时先切回模型域，再走既有 _tabChange
  const _wbTabChange = (tabKey) => {
    if (menuType !== '1' && menuType !== '2') {
      _menuTypeChange('1', () => _tabChange(tabKey));
    } else {
      _tabChange(tabKey);
    }
  };
  // 上下文面板“编辑表/字典”：复用唯一打开入口（已打开则仅激活）
  const _wbOpenInspectorTarget = (id, type) => {
    const icons = {
      entity: 'entity.svg',
      logicEntity: 'fa-columns',
      view: 'view.svg',
      dict: 'dict.svg',
    };
    _onMenuClick(id, type, null, icons[type] || 'entity.svg');
  };
  // WB-004C：顶栏“新建”项目对象创建，复用资源树右键 addOpt 全流程
  const _wbCreateObject = (type) => {
    _contextMenuClick(null, getMenu('add', '', type, [], groupTypeRef.current, ''));
  };
  // S2 R3：逻辑 → 物理正向生成向导（读最新有效草稿；只读不进入；
  // 提交为纯增量原子合并，不触碰既有实体/其他 tab 草稿）
  const _wbOpenForwardWizard = (preselect) => {
    if (mode === READING) return;
    let modal;
    const close = () => { modal && modal.close(); };
    modal = openModal(<ForwardEngineering
      getDraftSource={getSearchDataSource}
      getSource={getDataSource}
      preselect={preselect}
      onClose={close}
      onCommit={(next) => {
        dataSourceRef.current = next;
        restProps.update(next);
      }}
    />, {
      fullScreen: true,
      title: FormatMessage.string({id: 'forward.title'}),
      buttons: [],
    });
  };
  const tabDataChange = (data, t) => {
    setDataByTabId(t.tabKey, data);
    // WB-002 二轮：表/图有效草稿落缓存后通知上下文面板重算
    // （不创建第二份模型；递增同时刷新上下文和未保存提示）
    setWbDraftTick((pre) => pre + 1);
  };
  const hasRender = (key, instance) => {
    tabInstanceRef.current[key] = instance;
  };
  const hasDestroy = (key) => {
    delete tabInstanceRef.current[key];
  };
  const otherTabSave = (tab, callback) => {
    saveProject(false, tab, callback);
  };
  const selectionChanged = (cell, sourceTabKey) => {
    if (sourceTabKey !== activeKeyRef.current) {
      return;
    }
    headerToolRef.current.setIsCellSelected(cell);
    // WB-004C：图工具栏的对齐禁用状态镜像（checkAlignEnable 语义与原工具条一致）
    setWbCellSelected(cell || []);
    // WB-002 附加订阅：同步图内选中实体给右侧上下文面板（不影响既有工具条逻辑）。
    // 二轮修复：记录来源页签 tabKey，面板仅在"该图仍为当前激活页签"时采信该选择，
    // 背景图残留选择不再覆盖后来打开的其他对象；清空选择即回退页签上下文。
    const cells = cell || [];
    const firstEntity = cells.filter(c => c?.isNode?.() && c.getProp('originKey'))[0];
    setWbSelection(firstEntity
      ? {originKey: firstEntity.getProp('originKey'), cellId: firstEntity.id, tabKey: sourceTabKey}
      : null);
  };
  const jumpEntity = (tabKey) => {
    setMenuType('1');
    updateActiveKey(tabKey);
    activeTabStack.current = activeTabStack.current.filter(k => k !== tabKey);
    activeTabStack.current.push(tabKey);
  };
  const getConfig = () => {
    return configRef.current;
  };
  const tempData = {};
  const _openModal = (name, active) => {
    let modal = null;
    let Com = '';
    let title = '';
    const onOk = () => {
      if (Object.keys(tempData).length !== 0) {
        let tempDataSource = getDataSource();
        const filterData = ['lang', 'javaHome', 'autoSave', 'jvm', 'autoBackup'];
        if (name === 'dbreverse') {
          const { value = [], realData : { entities = [], viewGroups = [] } = {} }
              = tempData?.dbreverse || {};
          // 此处有多处需要更新
          // 先处理实体和分组信息
          const entitiesKey = (tempDataSource?.entities || [])
              .concat(tempDataSource?.views || [])
              .map(e => e.defKey);
          const newEntities = entities
              .filter(e => value.includes(e.defKey))
              .map((e) => {
                const defKey = validateKey(e.defKey, entitiesKey);
                entitiesKey.push(defKey);
                return {
                  ...e,
                  defKey,
                };
              });
          tempDataSource = {
            ...tempDataSource,
            entities: (tempDataSource?.entities || []).concat(newEntities),
            viewGroups: (tempDataSource?.viewGroups || []).concat({
              ...(viewGroups[0] || {}),
              refEntities: newEntities.map(e => e.defKey),
            }),
          };
          const valueNames = ['domains', 'dataTypeMapping.mappings'];
          valueNames.forEach((n) => {
            const oldKeys = _.get(tempDataSource, n, []).map(d => d.defKey);
            const newData = _.get(tempData, `dbreverse.realData.${n}`, [])
                .filter(d => !oldKeys.includes(d.defKey))
                .map(d => _.omit(d, '__key'));
            tempDataSource = _.set(tempDataSource, n, _.get(tempDataSource, n, []).concat(newData));
          });
        } else if (name === 'dbConnect') {
          if (new Set((tempData.dbConn || [])
              .filter(d => !!d.defName)
              .map(d => d.defName)).size !== (tempData.dbConn || []).length) {
            Modal.error({
              title: FormatMessage.string({id: 'optFail'}),
              message: FormatMessage.string({id: 'dbConnect.validateDb'}),
            });
            return;
          }
        } else if (name === 'config') {
          if ('lang' in tempData && tempData.lang !== lang) {
            // 需要更新一些默认的数据
            const needUpdates = [
              {
                key: 'profile.default.entityInitFields',
                langName: 'entityInitFields',
              },
            ];
            needUpdates.forEach(({key, langName}) => {
              tempDataSource = _.set(tempDataSource, key,
                  _.get(tempDataSource, key).map((f) => {
                    return {
                      ...f,
                      defName: FormatMessage.string({id: `projectTemplate.${langName}.${f.defKey}`})
                          || f.defName,
                    };
                  }));
            });
          }
          const userData = _.pick(tempData, filterData);
          if (Object.keys(userData).length > 0) {
            restProps?.saveUserData(userData);
          }
        }
        if ('dictSQLTemplate' in tempData) {
          const path = 'profile.codeTemplates';
          const codeTemplates = _.get(tempDataSource, path, []);
          if (codeTemplates.findIndex(c => c.applyFor === 'dictSQLTemplate') < 0) {
            codeTemplates.push(emptyDictSQLTemplate);
          }
          tempDataSource = _.set(tempDataSource, path, codeTemplates
              .map((c) => {
                if (c.applyFor === 'dictSQLTemplate') {
                  return {
                    ...c,
                    content: tempData.dictSQLTemplate || '',
                  };
                }
                return c;
              }));
        }
        const freeze = tempData.freeze;
        filterData.splice(0, 0, 'dictSQLTemplate', 'freeze');
        let needSave = false;
        Object.keys(tempData).filter(f => !filterData.includes(f)).forEach((f) => {
          needSave = true;
          tempDataSource = _.set(tempDataSource, f, tempData[f]);
        });
        if ('profile.headers' in tempData) {
          tempDataSource = {
            ...tempDataSource,
            entities: (tempDataSource.entities || []).map(e => ({
              ...e,
              headers: resetHeader(tempDataSource, e, freeze),
            })),
          };
          const allTab = getAllTabData();
          Object.keys(allTab).map(t => ({tabKey: t, tabData: allTab[t]})).forEach((t) => {
            if (t.tabData.type === 'entity' || t.tabData.type === 'view') {
              const data =  {
                ...t.tabData.data,
                headers: resetHeader(tempDataSource, t.tabData.data, freeze),
              };
              replaceDataByTabId(t.tabKey, {
                ...t.tabData,
                data,
              });
              notify('tabDataChange', {id: t.tabData.key, d: data});
            }
          });
        }
        needSave &&
        restProps?.save(tempDataSource, FormatMessage.string({id: 'saveProject'}), !projectInfoRef.current); // 配置项内容在关闭弹窗后自动保存
      }
      modal && modal.close();
    };
    const onCancel = () => {
      modal && modal.close();
    };
    if (name === 'config'){
      Com = Config;
      title = FormatMessage.string({id: 'config.title'});
    } else {
      Com = DbConnect;
      title = FormatMessage.string({id: 'dbConnect.title'});
    }
    const dataChange = (value, fieldName) => {
      tempData[fieldName] = value;
    };
    modal = openModal(<Com
      active={active}
      config={config}
      lang={config.lang}
      dataChange={dataChange}
      prefix={prefix}
      getDataSource={getDataSource}
      dataSource={restProps?.dataSource}
      updateDataSource={restProps.update}
    />, {
      bodyStyle: { width: '80%' },
      title,
      buttons: [<Button type='primary' key='ok' onClick={() => onOk(modal)}>
        <FormatMessage id='button.ok'/>
      </Button>,
        <Button key='cancel' onClick={() => onCancel(modal)}>
          <FormatMessage id='button.cancel'/>
        </Button>],
    });
  };
  const _jumpDetail = (d, key, param) => {
    // 当前表/逻辑实体的规范检查详情直接定位字段：第二个参数是 dataSource，
    // 不是对象集合键，不能继续进入菜单的 jumpDetail 路由。
    if (key && typeof key === 'object' && !Array.isArray(key) && key.profile && param?.defKey) {
      tabInstanceRef.current[activeKeyRef.current]?.twinkle(param.defKey);
      return;
    }
    if (['entities', 'logicEntities', 'conceptEntities', 'views', 'dicts'].includes(key)) {
      const type = key === 'entities' && d.type === 'refViews' ? 'view'
        : allType.find(item => item.name === key)?.type;
      setMenuType('1');
      _onMenuClick(d.id, type, null, 'fa-table');
    } else if (key === 'diagrams') {
      _onMenuClick(d.id, 'diagram', null, 'icon-guanxitu');
    } else if (key === 'diagramRefs') {
      const param = {
        originKey: d.originKey,
        cellId: d.cellId,
      };
      _onMenuClick(d.id, 'diagram', null, 'icon-guanxitu', param);
    } else if (key === 'standardFields') {
      standardFieldRef.current?.openEdit(d);
    } else {
      // 分组（viewGroups）在新目录无对应节点：仅切回模型主域
      let type = groupTypeRef.current;
      if (!d.groups || d.groups.length === 0) {
        type = 'modalAll';
        updateGroupType(type);
      }
      setMenuType('1');
    }
  };
  const navigatePlatform = request => {
    if (request.module === 'drawing') {setDrawingSession({view: 'documents', active: request.id, locate: request.cellId ? {id: request.cellId, nonce: Date.now()} : null});setPlatformReturn(menuType);setMenuType('7');return;}
    if (request.module === 'business') {setPlatformReturn(menuType);setPlatformRequest({...request, nonce: Date.now()});setMenuType('8');return;}
    const key = request.collection || 'diagrams';
    const asset = (getPlatformSource()[key === 'diagramRefs' ? 'diagrams' : key] || []).find(d => d.id === request.id);
    if (!asset) return;
    setPlatformReturn(menuType);setMenuType('1');
    _jumpDetail(key === 'diagramRefs' ? {...asset, cellId: request.cellId, originKey: asset.canvasData?.cells?.find(c => c.id === request.cellId)?.originKey} : asset, key);
  };
  // M4B/M5A 指标定位事件（只接指标目标）：definition=打开指标定义（含从模型字段预填的
  // 原子草案），bindings=打开模型关联详情，lineage=打开血缘与影响页焦点。经
  // metricsKeepAlive 保活切换，切回模型域不丢已存状态；未提交表单由
  // MetricsWorkbench 脏守卫先确认。
  const openMetricTarget = request => {
    if (!request || (request.module !== 'definition' && request.module !== 'bindings'
      && request.module !== 'lineage')) return;
    setMetricsKeepAlive(true);
    if (menuType !== '11') setPlatformReturn(menuType);
    setMetricsOpenRequest({...request, nonce: Date.now() + Math.random()});
    setMenuType('11');
  };
  // M4B 从指标平台精确打开模型/字段：端点按稳定 ID 解析当前项目（不在场即忽略，
  // 不猜同名对象）；fieldDefKey 经 tab param/twinkle 定位到具体字段行。
  const openModelFromMetrics = ref => {
    if (!ref || !ref.collection || !ref.objectId) return;
    const object = ((getDataSource() || {})[ref.collection] || [])
      .find(d => d.id === ref.objectId);
    if (!object) return;
    const typeMap = {entities: 'entity', logicEntities: 'logicEntity',
      conceptEntities: 'conceptEntity'};
    const type = typeMap[ref.collection];
    if (!type) return;
    setPlatformReturn('11');
    setMenuType('1');
    _onMenuClick(ref.objectId, type, null, 'fa-table',
      ref.fieldDefKey ? {defKey: ref.fieldDefKey} : null);
  };
  const getTabComponent = (t) => {
    const type = t.type;
    const key = t.menuKey;
    let group = [];
    if (type === 'entity' || type === 'logicEntity' || type === 'view'  || type === 'diagram' || type === 'dict') {
      // 需要计算分组信息
      // eslint-disable-next-line no-nested-ternary
      const tempType = type === 'entity' ? 'entities' : (type === 'logicEntity' ? 'logicEntities' : `${type}s`);
      const groupRefKey = [`ref${firstUp(tempType)}`];
      group = restProps?.dataSource?.viewGroups?.filter(v => v[groupRefKey]?.includes(key)) || [];
    }
    if (type === 'conceptEntity') {
      // S3 关联合同：概念实体与逻辑实体同样接收 updateDataSource/getDataSource/jumpDetail/readOnly
      return <ConceptEntity entity={key} dataSource={restProps.dataSource} tabKey={t.tabKey}
        readOnly={mode === READING}
        updateDataSource={restProps?.update}
        getDataSource={getDataSource}
        jumpDetail={_jumpDetail}
        openMetric={openMetricTarget}
        hasRender={instance => hasRender(t.tabKey, instance)}
        hasDestory={() => hasDestroy(t.tabKey)}
        tabDataChange={data => tabDataChange(data, t)}/>;
    } else if (type === 'ai-candidate') {
      // AI 临时候选页：独立视图 tab（不进 allType/tab 缓存/dirty），关闭即弃
      return <CandidateTab
        locale={config.lang === 'zh' ? 'zh' : 'en'}
        variant={aiCandidateRef.current?.variant === 'drawing' ? 'drawing' : 'modeling'}
        candidate={aiCandidateRef.current?.candidate}
        plan={aiCandidateRef.current?.plan}
        selectedOpIds={aiCandidateRef.current?.selectedOpIds}
        onClose={() => _tabClose(t.tabKey, true)}
      />;
    } else if (type === 'home') {
      // 企业级首页文档：真实计数/概览图引用与可选 profile.enterpriseModeling 元数据；
      // 不是关系图文档，不参与画布工具/对齐/图片导出等图上下文
      return <EnterpriseHome
        dataSource={restProps.dataSource}
        updateDataSource={restProps.update}
        readOnly={mode === READING}
        getDataSource={getSearchDataSource}
        addRequest={homeAddRequest}
        onOpenDiagram={(id) => _onMenuClick(id, 'diagram', null, 'icon-guanxitu')}
        onCreateDiagram={() => _wbCreateObject('diagrams')}
        onOpenCoverDiagram={() => _onMenuClick('home-cover', 'diagram', null, 'icon-guanxitu')}
      />;
    } else if (type === 'entity') {
      return (
        <Entity
          openConfig={() => _openModal('config', 'EntityInit.3')}
          saveUserData={restProps.saveUserData}
          getConfig={getConfig}
          type={type}
          getDataSource={getDataSource}
          hasRender={instance => hasRender(t.tabKey, instance)}
          hasDestory={() => hasDestroy(t.tabKey)}
          param={t.param}
          tabKey={t.tabKey}
          common={common}
          updateDataSource={restProps?.update}
          dataSource={restProps?.dataSource}
          openDict={_onMenuClick}
          entity={key}
          group={group}
          setMenuType={setMenuType}
          openCheckRuleConfig={openCheckRuleConfig}
          tabDataChange={data => tabDataChange(data, t)}
          jumpDetail={_jumpDetail}
          readOnly={mode === READING}
          openMetric={openMetricTarget}
          />);
    } else if (type === 'logicEntity') {
      return (
        <LogicEntity
          jumpDetail={_jumpDetail}
          saveUserData={restProps.saveUserData}
          getConfig={getConfig}
          type={type}
          getDataSource={getDataSource}
          hasRender={instance => hasRender(t.tabKey, instance)}
          hasDestory={() => hasDestroy(t.tabKey)}
          param={t.param}
          tabKey={t.tabKey}
          common={common}
          updateDataSource={restProps?.update}
          dataSource={restProps?.dataSource}
          openDict={_onMenuClick}
          entity={key}
          group={group}
          tabDataChange={data => tabDataChange(data, t)}
          setMenuType={setMenuType}
          openCheckRuleConfig={openCheckRuleConfig}
          readOnly={mode === READING}
          openMetric={openMetricTarget}
        />);
    } else if (type === 'view') {
      return <View
        saveUserData={restProps.saveUserData}
        getConfig={getConfig}
        type={type}
        getDataSource={getDataSource}
        updateDataSource={restProps?.update}
        hasRender={instance => hasRender(t.tabKey, instance)}
        hasDestory={() => hasDestroy(t.tabKey)}
        param={t.param}
        tabKey={t.tabKey}
        common={common}
        dataSource={restProps?.dataSource}
        openDict={_onMenuClick}
        entity={key}
        group={group}
        tabDataChange={data => tabDataChange(data, t)}
      />;
    } else if (type === 'diagram') {
      return <Relation
        readOnly={mode === READING}
        openLoading={restProps.openLoading}
        closeLoading={restProps.closeLoading}
        jumpEntity={jumpEntity}
        selectionChanged={cells => selectionChanged(cells, t.tabKey)}
        openDict={_onMenuClick}
        getDataSource={getDataSource}
        common={common}
        save={otherTabSave}
        activeKey={activeKey}
        validateTableStatus={validateTableStatus}
        tabKey={t.tabKey}
        diagramKey={key}
        group={group}
        openEntity={_onMenuClick}
        updateDataSource={restProps?.update}
        dataSource={restProps?.dataSource}
        renderReady={cav => renderReady(cav, t.tabKey)}
        tabDataChange={(data, tab) => tabDataChange(data, tab || t)}
        autoSave={restProps.autoSave}
      />;
    } else if (type === 'dict') {
      return <Dict
        param={t.param}
        hasRender={instance => hasRender(t.tabKey, instance)}
        hasDestory={() => hasDestroy(t.tabKey)}
        tabKey={t.tabKey}
        dictKey={key}
        dataSource={restProps?.dataSource}
        tabDataChange={data => tabDataChange(data, t)}
      />;
    }
    return '';
  };
  const domainGetName = (m) => {
    const dataTypeSupports = _.get(dataSourceRef.current, 'profile.dataTypeSupports', []);
    const defaultDb = _.get(dataSourceRef.current, 'profile.default.db', dataTypeSupports[0]?.id);
    if (defaultDb === m.id) {
      return `${m.defName || m.defKey}(${FormatMessage.string({id: 'project.default'})})`;
    }
    return m.defName || m.defKey;
  };
  const iconClick = (e, key) => {
    switch (key) {
      case 'save': saveProject();break;
      case 'refresh': refreshProject();break;
      case 'saveAs': saveProject(true);break;
      case 'pdman': importFromPDMan('pdman');break;
      case 'importDDL': importFromPb('DDL');break;
      case 'excel': importFromExcel();break;
      case 'chiner': importFromPDMan('chiner');break;
      case 'PDManer': importFromPDMan('PDManer');break;
      case 'powerdesigner': importFromPb('PD');break;
      case 'db': importFromDb();break;
      case 'domains': importDomains('dbDDL');break;
      case 'exportDomains': exportDomains('dbDDL');break;
      case 'appCodes': importDomains('appCode');break;
      case 'exportAppCodes': exportDomains('appCode');break;
      case 'importConfig': importConfig();break;
      case 'importDicts': importDicts();break;
      case 'exportConfig': exportConfig();break;
      case 'exportDicts': exportDicts();break;
      case 'png':
      case 'svg': exportImg(key); break;
      case 'export-excel': exportExcel(); break;
      case 'word': exportWord(); break;
      case 'html':
      case 'markdown': generateSimpleFile(key, dataSourceRef.current, projectInfoRef.current); break;
      case 'sql': exportSql('sql'); break;
      case 'dict': exportSql('dict'); break;
      case 'empty': createEmptyTable(e, null, 'entity');break;
      case 'logic': createEmptyTable(e, null, 'logicEntity');break;
      case 'concept': createEmptyTable(e, null, 'conceptEntity');break;
      case 'round': createNode(e, 'round');break;
      case 'circle': createCircleNode(e);break;
      case 'rect': createNode(e, 'rect');break;
      case 'mind': createTopicNode(e);break;
      case 'compareDb': quickCompareDb();break;
      case 'compareTable': quickCompareTable();break;
      case 'polygon': createPolygonNode(e);break;
      case 'group': createGroupNode(e);break;
      case 'alignLeft':
      case 'alignRight':
      case 'alignTop':
      case 'verticalCenter':
      case 'alignBottom':
      case 'alignRow':
      case 'alignColumn':
      case 'horizontalCenter': alignment(key);break;
      case 'toggleCase': toggleCase();break;
      case 'theme': themeChange();break;
      case 'history': showHistory();break;
      default: break;
    }
  };
  const currentPrefix = getPrefix(prefix);
  const getTabTitle = (t) => {
    if (t.menuKey === 'home-cover') {
      const titleId = t.type === 'home' ? 'enterpriseHome.title' : 'project.homeCover';
      return {
        title: FormatMessage.string({id: titleId}),
        tooltip: FormatMessage.string({id: titleId}),
      };
    }
    if (t.type === 'ai-candidate') {
      return {
        title: FormatMessage.string({id: 'ai.candidateTab'}),
        tooltip: FormatMessage.string({id: 'ai.candidateTab'}),
      };
    }
    const currentType = allType.filter(a => a.type === t.type)[0];
    const draft = getDataByTabId(t.tabKey);
    const currentData = (draft?.isInit === false && t.type !== 'diagram' ? draft.data : null)
      || restProps?.dataSource[currentType.name]?.find(d => d.id === t.menuKey);
    const tempDisplayMode = currentData?.nameTemplate || '{defKey}[{defName}]';
    return {
      title: currentData?.defName || currentData?.defKey,
      tooltip: tempDisplayMode.replace(/\{(\w+)\}/g, (match, word) => {
        return currentData?.[word] || currentData?.defKey || '';
      }),
    };
  };
  const standardFieldMemo = useMemo(() => {
    return <StandardField
      config={config}
      hideEntry
      ref={standardFieldRef}
      activeKey={activeKey}
      dataSource={restProps.dataSource}
      updateDataSource={restProps.update}
      openLoading={restProps.openLoading}
      closeLoading={restProps.closeLoading}
      projectInfo={projectInfo}
      dealExportFile={dealExportFile}
    />;
  }, [restProps.dataSource, activeKey]);
  const dropDownMenus = useMemo(() => ([
    {key: 'closeCurrent', name: FormatMessage.string({id: 'closeCurrent'})},
    {key: 'closeOthers', name: FormatMessage.string({id: 'closeOthers'})},
    {key: 'closeAll', name: FormatMessage.string({id: 'closeAll'})},
  ]),[]);
  const dropDownMenuClick = (m, e, c) => {
    switch (m.key){
      case 'closeCurrent':
        _tabClose(c.key);
        break;
      case 'closeOthers':
        _tabCloseOther(c.key);
        break;
      case 'closeAll':
        _tabCloseAll();
        break;
      default: break;
    }
  };
  const _menuTypeChange = (key, afterChange) => {
    const updateMenuType = () => {
      if (key === '5') {
        openCheckRuleConfig(false);
      }
      setMenuType(key);
      // S3：从其他主模块回到模型域且无打开文档时，默认呈现企业首页
      // （原有 tabs 与草稿保留，不强制关闭/重建）
      if (key === '1' && tabsRef.current.length === 0) {
        _onMenuClick('home-cover', 'home', null, 'fa-home');
      }
      afterChange && afterChange();
    };
    if(checkRuleRef.current && (menuType === '5') && (key !== '5')) {
      checkRuleRef.current?.checkLeave(() => {
        updateMenuType();
      });
    } else {
      updateMenuType();
    }
  };
  const _jumpPosition = (d, key) => {
    setMenuType('1');
    setWbTreeFilter('');
    catalogRef.current?.jumpPosition(d, key === 'entities' && d.type === 'refViews' ? 'views' : key);
  };
  const backProjectConfirm = async () => {
    try {await drawingPersistence.flush();} catch (err) {Message.error({title: err.message});return;}
    // M2：关闭项目会卸载指标平台（未提交表单丢失），有脏表单先确认
    const proceedClose = () => confirmBackProjects(dataSourceRef.current, restProps.close);
    if (metricsRef.current && metricsRef.current.isDirty && metricsRef.current.isDirty()) {
      metricsRef.current.checkLeave(proceedClose);
    } else {
      proceedClose();
    }
  };
  useEffect(() => {
    const clear = () => {
      if (autoSaveRef.current) {
        clearInterval(autoSaveRef.current);
      }
    };
    clear();
    if (config.autoSave && projectInfoRef.current) {
      // 开始执行自动保存任务
      autoSaveRef.current = setInterval(() => {
        if(validateNeedSave(dataSourceRef.current)) {
          console.log('autoSave');
          const newData = updateAllData(dataSourceRef.current);
          if (newData.result.status) {
            restProps.autoSave(newData.dataSource);
          }
        }
      }, config.autoSave * 60 * 1000);
    }
    return () => {
      // 结束执行自动保存任务
      clear();
    };
  }, [config.autoSave]);
  useEffect(() => {
    const themeMode = restProps.dataSource?.profile?.themeMode || '';
    document.body.setAttribute('theme', themeMode);
  }, [restProps.dataSource?.profile?.themeMode]);
  const getLatelyDataSource = () => {
    return updateAllData(dataSourceRef.current);
  };
  const mergeFromMeta = (data, meta, nextDataSource) => {
    let newDataSource;
    if (meta) {
      newDataSource = mergeDataSource(dataSourceRef.current, {}, data, true);
    } else {
      newDataSource = mergeDataSource(dataSourceRef.current, nextDataSource, data, true);
    }
    injectDataSource(newDataSource);
    return newDataSource;
  };
  const openHome = () => {
    _onMenuClick('home-cover', 'home', null, 'fa-home');
  };
  // S3：目录“企业首页组件”点击/拖放入口 —— 打开企业首页并按公共合同发起添加请求
  // （addRequest:{kind,nonce}，EnterpriseHome 消费后按 nonce 去重；只读态由首页禁写）
  const _wbHomeAdd = (kind) => {
    setHomeAddRequest({kind, nonce: Date.now()});
    if (menuType !== '1' && menuType !== '2') {
      _menuTypeChange('1', () => _onMenuClick('home-cover', 'home', null, 'fa-home'));
    } else {
      _onMenuClick('home-cover', 'home', null, 'fa-home');
    }
  };
  const renderOperatingFloor = () => {
    return (
      <>
        {
          (menuType === '4') && (versionType === '1') && <VersionInfoBar
            dataSource={restProps.dataSource}
            ref={currentVersionRef}
            empty={<MessageHelp openHome={openHome} prefix={currentPrefix}/>}
            />
        }
        {
          (menuType === '4') && (versionType === '2') && <CompareList
            mergeFromMeta={mergeFromMeta}
            closeLoading={restProps.closeLoading}
            openLoading={restProps.openLoading}
            config={config}
            dataSource={restProps.dataSource}
            ref={currentMetaRef}
            calcDomain={calcDomain}
            />
        }
        {
            (menuType === '5') && <CheckRule
              ref={checkRuleRef}
              configOpen={ruleConfigOpen}
              tabDataChange={tabDataChange}
              getDataSource={getDataSource}
              save={otherTabSave}
              jumpDetail={_jumpDetail}
              jumpEntity={jumpEntity}
              openDict={_onMenuClick}
              validateTableStatus={validateTableStatus}
              updateDataSource={restProps.update}
              closeLoading={restProps.closeLoading}
              openLoading={restProps.openLoading}
              dataSource={restProps.dataSource}
              common={common}
              setMenuType={setMenuType}
              readOnly={mode === READING}
              onRequestAiFix={aiRuntimeReady ? handleQualityAiFix : null}
            />
        }
        {
          (menuType === '6') && <DataStandard
            dataSource={restProps.dataSource}
            updateDataSource={restProps.update}
            openStandardEdit={() => standardFieldRef.current?.openEdit()}
          />
        }
        {
          (menuType === '10') && <ResourceOverview
            source={getSearchDataSource()}
            getDataSource={getDataSource}
            projectInfo={projectInfoRef.current}
            readOnly={mode === READING}
            draftVersion={wbDraftTick}
            onOpenItem={(item) => {
              // 下钻打开：实体类直接开编辑 tab；图开图；标准进字段标准编辑；规则进规则模块
              if (item.collection === 'diagrams') {
                _onMenuClick(item.id, 'diagram', null, 'icon-guanxitu');
              } else if (item.collection === 'standardFields') {
                standardFieldRef.current?.openEdit(item.raw);
              } else if (item.collection === 'namingRules') {
                _menuTypeChange('5');
              } else {
                _onMenuClick(item.id, item.type, null, 'entity.svg');
              }
            }}
            onOpenModule={(m) => _menuTypeChange(m)}
          />
        }
        {
          (menuType === '9') && <DatabaseWorkspace
            dataSource={restProps.dataSource}
            getDataSource={getDataSource}
            updateDataSource={restProps.update}
            config={config}
            lang={config.lang}
            prefix={prefix}
            readOnly={mode === READING}
            onQuickCompareDb={quickCompareDb}
            onImportFromDb={importFromDb}
            onImportDDL={() => importFromPb('DDL')}
            onOpenTypeSettings={() => _menuTypeChange('2')}
          />
        }
        <AppCodeEdit
          updateDataSource={restProps.update}
          empty={<MessageHelp openHome={openHome} prefix={currentPrefix}/>}
          dataSource={restProps.dataSource}
          ref={appCodeRef}
          style={{display: menuType === '3' ? 'block' : 'none'}}
          />
        {/* WB-003④：显示控制必须在外层包装 div 上。Tab 组件(AutoCompose)的 style
            只作用于内层 .chiner-tab，外层 .chiner-auto-compose-tab-top 包装
            (height:100%, position:relative) 在新工作台 grid 同格叠加中仍渲染在
            数据标准/交付/版本/规则检查等模块上方，透明拦截其全部点击，造成
            “模块点击无反应”。在外层整体隐藏后，非模型/类型模块恢复可操作。 */}
        <div
          className={`${currentPrefix}-wb-editor-host`}
          style={{
            display: (menuType === '1' || menuType === '2') ? 'block' : 'none',
            height: '100%',
          }}
        >
          <StandardFieldLibraryContext.Provider value={openStandardLibrary}>
          <Tab
            key={mainId}
            menuClick={dropDownMenuClick}
            dropDownMenus={dropDownMenus}
            position='top'
            showHeader={false}
            activeKey={activeKey}
            closeTab={_tabClose}
            onChange={_tabChange}
            excess={standardFieldMemo}
            empty={<MessageHelp openHome={openHome} prefix={currentPrefix}/>}
            >
            {tabs.map((t) => {
                const title = getTabTitle(t);
                return (
                  <TabItem
                    style={t.style}
                    key={t.tabKey}
                    title={title.title}
                    tooltip={title.tooltip}
                    icon={t.icon}
                    >
                    {getTabComponent(t)}
                  </TabItem>
                );
              })}
          </Tab>
          </StandardFieldLibraryContext.Provider>
        </div>
      </>
    );
  };
  const createAppCodeMenu = getMenu('add', '', 'appCode', [], '', '');
  const onListDrop = (dropId, dragId) => {
    const dataTypeSupports = dataSourceRef.current?.profile?.dataTypeSupports || [];
    const dropIndex = dataTypeSupports.findIndex(d => d.id === dropId);
    const dragIndex = dataTypeSupports.findIndex(d => d.id === dragId);
    restProps.update({
      ..._.set(
          dataSourceRef.current,
          'profile.dataTypeSupports',
          moveArrayPosition(_.get(dataSourceRef.current, 'profile.dataTypeSupports'), dragIndex, dropIndex),
      ),
    });
  };
  const onDoubleClick = (id) => {
    appCodeRef.current?.getData(id);
  };
  const setCurrentVersion = (...args) => {
    currentVersionRef.current?.setVersion(...args);
  };
  const setCurrentMeta = (m, isCustomer) => {
    currentMetaRef.current?.setMeta(m, isCustomer);
  };
  // WB-003①：单一 CSS 变量驱动网格与资源容器宽度（新布局内 CSS !important 使用该变量）
  const wbInspectorEffectiveWidth = clampWorkbenchInspectorWidth(wbInspectorWidth, wbWindowWidth);
  const wbSidebarEffectiveWidth = clampWorkbenchSidebarWidth(
    wbSidebarWidth, wbWindowWidth, wbInspectorOpen ? wbInspectorEffectiveWidth : 0);
  const homeStyle = {
    '--wb-sidebar-w': `${wbSidebarEffectiveWidth}px`,
    '--wb-inspector-w': `${wbInspectorEffectiveWidth}px`,
  };
  const wbPreviewSidebarWidth = (width, commit) => {
    const next = clampWorkbenchSidebarWidth(width, window.innerWidth,
      wbInspectorOpen ? wbInspectorEffectiveWidth : 0);
    setWbSidebarWidth(next);
    if (commit) {
      writeWorkbenchSidebarWidth(setCache, next);
    }
    return next;
  };
  const wbPreviewInspectorWidth = (width, commit) => {
    const next = clampWorkbenchInspectorWidth(width, window.innerWidth);
    setWbInspectorWidth(next);
    if (commit) writeWorkbenchInspectorWidth(setCache, next);
    return next;
  };
  const activeDiagram = restProps.dataSource.diagrams?.find(d => d.id === activeTab?.menuKey);
  const activeModelLevel = activeDiagram?.modelLevel || inferDiagramLevel(activeDiagram, restProps.dataSource);
  // ===== AI 面板节点（检查器 AI 页签内容）=====
  const aiLocale = config.lang === 'zh' ? 'zh' : 'en';
  const handleAiCandidateChange = useCallback((next, variant) => {
    // 绘图候选在绘图 AI 面板内自持预览（menuType 7 不开建模候选 tab）
    if (variant === 'drawing') return;
    setAiCandidate(next ? {...next, variant} : null);
    const tabKey = `ai-candidate${separator}ai-candidate`;
    if (next) {
      if (menuType !== '1' && menuType !== '2') {
        _menuTypeChange('1', () => _onMenuClick('ai-candidate', 'ai-candidate', null, 'fa-sparkles'));
      } else {
        _onMenuClick('ai-candidate', 'ai-candidate', null, 'fa-sparkles');
      }
    } else if (tabsRef.current.some(t => t.tabKey === tabKey)) {
      _tabClose(tabKey, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuType]);
  const aiSaveSeam = useCallback((cb) => {
    saveProject(false, (failed) => cb(failed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restProps.dataSource, tabs]);
  const aiValidDraft = useMemo(() => getAiValidDraft(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restProps.dataSource, wbDraftTick]);
  const aiRuntimeReady = aiRuntimeRef.current && aiRuntimeRef.current.available() === true;
  const aiSqlPanelNode = aiRuntimeReady ? <SqlImportPanel
    runtime={aiRuntimeRef.current}
    locale={aiLocale}
    dataSource={aiValidDraft}
    draftVersion={wbDraftTick}
    readOnly={mode === READING}
    onCandidateChange={handleAiCandidateChange}
    onSaveProject={aiSaveSeam}
  /> : null;
  const aiModelingPanelNode = aiRuntimeReady ? <ModelingAiPanel
    ref={aiPanelRef}
    runtime={aiRuntimeRef.current}
    locale={aiLocale}
    dataSource={aiValidDraft}
    draftVersion={wbDraftTick}
    readOnly={mode === READING}
    onCandidateChange={handleAiCandidateChange}
    onSaveProject={aiSaveSeam}
    sqlPanel={aiSqlPanelNode}
  /> : <div className='chiner-ai-unavailable'>
    <FormatMessage id='ai.hostUnavailable'/>
  </div>;
  // 质量规则“生成修复候选”：打开 AI 检查器并把失败摘要注入 composer（仍走完整审阅）
  const openAiAssistant = useCallback(() => {
    aiKeepAliveRef.current = true; // 打开过即保活：后续关闭只隐藏不卸载
    setAiForcedOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleQualityAiFix = useCallback((summaryText) => {
    openAiAssistant();
    if (menuType !== '1' && menuType !== '2') {
      _menuTypeChange('1', () => aiPanelRef.current?.injectUserText(summaryText));
    } else {
      aiPanelRef.current?.injectUserText(summaryText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuType]);
  const handleDisplayModeChange = (modeKey) => {
    const cavRef = getCurrentCav();
    if (cavRef && typeof cavRef.setDisplayMode === 'function') {
      cavRef.setDisplayMode(modeKey);
    }
  };
  return <Loading visible={common.loading} title={common.title}>
    <HeaderTool ref={headerToolRef}/>
    <div
      style={homeStyle}
      // 整改 F3：按“实际属性面板可见性”收起根网格右列（首页文档/数据库工作区
      // 不渲染面板也不预留 320px 空列）；wbInspectorOpen 偏好保留，返回模型文档
      // 按原开合恢复；绘图/业务平台布局不受影响。派生规则见 navigation.workbenchInspectorHidden。
      // S3整改：总览上下文收起模型资源栏与拖宽器（该栏在总览只有标题无内容），
      // 释放宽度给总览面板；仅呈现层收起，--wb-sidebar-w 与本机宽度偏好不读不写，
      // 返回模型域按原宽度恢复。派生规则见 navigation.workbenchSidebarHidden。
      className={`${currentPrefix}-home ${currentPrefix}-home-wb${menuType === '7' && drawingSession?.active ? ` ${currentPrefix}-home-drawing-focus` : ''}${workbenchInspectorHidden({menuType, activeTabType: activeTab?.type, inspectorOpen: wbInspectorOpen || aiForcedOpen, forceVisible: aiForcedOpen}) ? ` ${currentPrefix}-home-wb-no-inspector` : ''}${workbenchSidebarHidden({menuType}) ? ` ${currentPrefix}-home-wb-no-sidebar` : ''}`}>
      <WorkbenchTopbar
        key='wb-topbar'
        currentPrefix={currentPrefix}
        mode={mode}
        isChildWindow={isChildWindow}
        dataSource={restProps.dataSource}
        onToggleTheme={themeChange}
        onBackProjects={backProjectConfirm}
        onSave={() => saveProject()}
        getSearchDataSource={getSearchDataSource}
        jumpPosition={_jumpPosition}
        jumpDetail={_jumpDetail}
        iconClick={iconClick}
        openModal={_openModal}
        onCreateObject={_wbCreateObject}
        hideModelCreate
        onOpenAiAssistant={() => {
          aiKeepAliveRef.current = true; // More→AI 打开即进入保活
          setAiForcedOpen(true);
        }}
        onReturnPlatform={platformReturn && menuType !== platformReturn ? () => {setMenuType(platformReturn);setPlatformReturn(null);} : null}
        canvasExportable={!(activeTab?.type !== 'diagram' || (menuType !== '1' && menuType !== '2'))}
        compact={wbWindowWidth <= 1280}
        dataPlatform={isDataWorkbenchModule(restProps.dataSource?.module)}
      />
      {menuType === '7' ? (
        <div className={`${currentPrefix}-home-drawing-area`}>
          <DrawingWorkbench
            dataSource={restProps.dataSource}
            projectInfo={projectInfoRef.current}
            updateDataSource={next => {restProps.update(next);drawingPersistence.change(next.drawings || []).catch(() => {});}}
            session={menuType === '7' ? drawingSession : businessSession}
            onSessionChange={menuType === '7' ? setDrawingSession : setBusinessSession}
            referenceSource={getPlatformSource()}
            onNavigate={navigatePlatform}
            openRequest={platformRequest}
            readOnly={mode === READING}
            currentPrefix={currentPrefix}
          />
        </div>
      ) : null}
      {menuType === '8' ? (
        <div className={`${currentPrefix}-home-business-area`}>
          <BusinessWorkbench
            dataSource={restProps.dataSource}
            updateDataSource={restProps.update}
            session={menuType === '7' ? drawingSession : businessSession}
            onSessionChange={menuType === '7' ? setDrawingSession : setBusinessSession}
            referenceSource={getPlatformSource()}
            onNavigate={navigatePlatform}
            openRequest={platformRequest}
            readOnly={mode === READING}
            currentPrefix={currentPrefix}
          />
        </div>
      ) : null}
      {/* M2：指标平台整页（menuType 11）。首访后保活（hidden 切换不卸载），
          未提交表单在模块往返中保留；模型资源树/属性栏由 no-sidebar/no-inspector
          类收起，原布局偏好不读不写，回模型域自动恢复 */}
      {metricsKeepAlive ? (
        <div
          className={`${currentPrefix}-home-metrics-area`}
          hidden={menuType !== '11'}
        >
          <MetricsWorkbench
            ref={metricsRef}
            source={restProps.dataSource}
            getDataSource={getDataSource}
            updateDataSource={restProps.update}
            readOnly={mode === READING}
            projectDirty={validateNeedSave(restProps.dataSource)}
            openRequest={metricsOpenRequest}
            onOpenModel={openModelFromMetrics}
          />
        </div>
      ) : null}
      <div
        className={`${currentPrefix}-home-resize-container`}
        style={{display: (menuType === '7' || menuType === '8' || menuType === '11') ? 'none' : undefined}}>
        <WorkbenchSidebar
          currentPrefix={currentPrefix}
          menuType={menuType}
          filterText={wbTreeFilter}
          filterOpen={wbFilterOpen}
          onToggleFilter={() => { setWbFilterOpen(pre => !pre); setWbTreeFilter(''); }}
          onCreate={e => catalogRef.current?.create(e.currentTarget)}
          onCreateType={_wbCreateObject}
          readOnly={mode === READING}
          catalogView={catalogView}
          onToggleCatalogView={() => setCatalogView(pre => pre === 'directory' ? 'objects' : 'directory')}
          onFilterChange={setWbTreeFilter}
          showLocation={menuType === '1' && !!activeKey}
          onLocation={onLocation}
          versionType={versionType}
          onVersionTypeChange={setVersionType}
          standardStats={wbStandardStats}
          onOpenStandardEdit={() => standardFieldRef.current?.openEdit()}
        />
        <Tab activeKey={menuType} onChange={_menuTypeChange} showHeader={false}>
          <TabItem key='1' title={FormatMessage.string({id: 'modelTab'})} icon='model.svg'>
            <div className={`${currentPrefix}-home-menu-container`}>
                <ModelCatalog ref={catalogRef} source={getSearchDataSource()} getSource={getDataSource}
                  onUpdate={next => {
                    // S1 整改 F7：目录提交改变实体物理归属元数据（如删库撤归属）时，
                    // 仅同步 physicalDatabaseId/physicalDbTypeId 到已打开实体 tab 的
                    // 缓存与内部编辑 state（replaceDataByTabId + tabDataChange 通知）。
                    // 合并基准是 tab 草稿本身：保留名称/字段/notes 与 isInit，
                    // 不用已保存对象整表回退，避免保存/搜索把已删容器 ID 复活
                    physicalMetadataPatches(dataSourceRef.current, next).forEach((patch) => {
                      const tabKey = `${patch.id}${separator}entity`;
                      const tabData = getDataByTabId(tabKey);
                      if (tabData && tabData.data && tabData.data.id === patch.id) {
                        const merged = applyPhysicalMetadataPatch(tabData.data, patch);
                        replaceDataByTabId(tabKey, {...tabData, data: merged});
                        notify('tabDataChange', {id: patch.id, d: merged});
                      }
                    });
                    dataSourceRef.current = next;
                    restProps.update(next);
                  }}
                  onOpen={_onMenuClick} onCloseObject={(id, type) => _tabClose(id + separator + type, true)}
                  onDrag={createEmptyTable} filter={wbTreeFilter} viewMode={catalogView}
                  onGenerate={_wbOpenForwardWizard}
                  readOnly={mode === READING} onHome={openHome} onHomeAdd={_wbHomeAdd}/>
            </div>
          </TabItem>
          <TabItem key='2' title={FormatMessage.string({id: 'domainTab'})} icon='data_type.svg'>
            <div className={`${currentPrefix}-home-menu-container`}>
              <Menu
                mode={mode}
                ref={menuDomainRef}
                prefix={prefix}
                {...restProps}
                onContextMenu={_onContextMenu}
                contextMenus={contextMenus}
                contextMenuClick={_contextMenuClick}
                menus={wbTreeFilter && menuType === '2'
                  ? filterTreeMenus(domainMenu, wbTreeFilter) : domainMenu}
                getName={domainGetName}
                draggable={draggable}
                dragTable={createEmptyTable}
                doubleMenuClick={(key, type, parentKey) => _contextMenuClick(null,
                      getMenu('edit', key, type, [], groupTypeRef.current, parentKey))}
              />
            </div>
          </TabItem>
          <TabItem key='3' title={FormatMessage.string({id: 'appCode'})} icon='fa-code'>
            <div className={`${currentPrefix}-home-menu-container`}>
              <List
                mode={mode}
                onDoubleClick={onDoubleClick}
                onDrop={onListDrop}
                ref={menuDomainRef}
                draggable
                prefix={prefix}
                {...restProps}
                onContextMenu={_onContextMenu}
                contextMenus={contextMenus}
                contextMenuClick={_contextMenuClick}
                data={appCodeMenu}
                emptyData={<div
                  className={`${currentPrefix}-home-menu-empty`}
                >
                  <div>
                    <FormatMessage id='emptyAppCode'/>
                  </div>
                  <div>
                    <FormatMessage id='click'/>[<a onClick={() => _contextMenuClick(null, createAppCodeMenu)}><FormatMessage id='createAppCode'/></a>]
                  </div>
                </div>}
              />
            </div>
          </TabItem>
          <TabItem hidden={mode === READING} key='4' title={FormatMessage.string({id: 'versionTab'})} icon='fa-history'>
            <div className={`${currentPrefix}-home-menu-container`}>
              <VersionListBar
                versionType={versionType}
                menuType={menuType}
                openLoading={restProps.openLoading}
                closeLoading={restProps.closeLoading}
                projectInfo={projectInfo}
                getLatelyDataSource={getLatelyDataSource}
                dataSource={restProps.dataSource}
                updateDataSource={restProps.update}
                onSelected={versionType === '1' ? setCurrentVersion : setCurrentMeta}
              />
            </div>
          </TabItem>
          <TabItem key='5' title={FormatMessage.string({id: 'project.checkRule'})} icon='fa-flag-checkered' />
          <TabItem hidden={mode === READING} key='6' title={FormatMessage.string({id: 'dataStandard.tab'})} icon='fa-book' />
        </Tab>
        {/* S3整改1：经典布局 resize 分隔条 DOM 已删除（回调随经典头部剥离后成为
            未定义引用，打开项目即崩溃）；宽度拖动由 WorkbenchSidebarResizer 承载 */}
        <WorkbenchSidebarResizer
          currentPrefix={currentPrefix}
          startWidth={wbSidebarEffectiveWidth}
          onPreview={(w) => wbPreviewSidebarWidth(w, false)}
          onCommit={(w) => wbPreviewSidebarWidth(w, true)}
        />
      </div>
      <div
        className={`${currentPrefix}-home-resize-other`}
        style={{
          display: (menuType === '7' || menuType === '8' || menuType === '11') ? 'none' : undefined,
        }}
      >
        <WorkbenchDocumentTabs
          currentPrefix={currentPrefix}
          tabs={tabs}
          activeKey={activeKey}
          getTabTitle={getTabTitle}
          onTabChange={_wbTabChange}
          onTabClose={_tabClose}
          dropDownMenus={dropDownMenus}
          onTabMenuClick={dropDownMenuClick}
        />
        <WorkbenchEditorToolbar
          currentPrefix={currentPrefix}
          mode={mode}
          menuType={menuType}
          activeTab={menuType === '1' || menuType === '2' ? activeTab : null}
          getTabTitle={getTabTitle}
          modelLevel={activeModelLevel}
          displayMode={activeDiagram?.displayMode}
          onDisplayModeChange={handleDisplayModeChange}
          iconClick={iconClick}
          onZoom={resize}
          cellSelected={wbCellSelected}
          inspectorOpen={wbInspectorOpen}
          onToggleInspector={() => setWbInspectorOpen(pre => !pre)}
          inspectorAvailable={menuType !== '9' && menuType !== '10' && activeTab?.type !== 'home'}
        />
        {renderOperatingFloor()}
      </div>
      {/* DATA-WB-FEAT-001：数据库工作区（menuType 9）、资源总览（menuType 10）与首页文档
          激活时不显示属性面板（无对象上下文，不常驻空属性栏），模型/类型域其他文档保持原行为。
          AI 助手强制打开时（更多→AI）独立挂载检查器（AI 页签激活）：不复活资源总览
          空资源树，关闭恢复此前布局（wbInspectorOpen 原值），绘图/业务平台除外。
          R1 保活：打开过 AI 后（aiKeepAliveRef）检查器保持挂载，关闭只经
          home-wb-no-inspector 隐藏（display:none），AI 面板不卸载、状态不丢 */}
      {((menuType !== '7' && menuType !== '8' && menuType !== '9' && menuType !== '10' && menuType !== '11' && activeTab?.type !== 'home') || aiForcedOpen || aiKeepAliveRef.current) && menuType !== '7' && menuType !== '8' && <WorkbenchInspector
        currentPrefix={currentPrefix}
        aiForced={aiForcedOpen}
        aiPanel={aiModelingPanelNode}
        onCloseAi={() => setAiForcedOpen(false)}
        resizer={(wbInspectorOpen || aiForcedOpen) ? <WorkbenchSidebarResizer
          currentPrefix={currentPrefix}
          side='right'
          startWidth={wbInspectorEffectiveWidth}
          onPreview={w => wbPreviewInspectorWidth(w, false)}
          onCommit={w => wbPreviewInspectorWidth(w, true)}
        /> : null}
        dataSource={restProps.dataSource}
        activeTab={menuType === '1' || menuType === '2' ? activeTab : null}
        tabs={tabs}
        selection={wbSelection}
        getTabData={getDataByTabId}
        getSearchDataSource={getSearchDataSource}
        getDiagramEdgeSnapshot={getDiagramEdgeSnapshot}
        onOpenPlatformAsset={navigatePlatform}
        onLocateReference={(ref) => _jumpDetail(ref, 'diagramRefs')}
        onEditEntity={_wbOpenInspectorTarget}
        draftVersion={wbDraftTick}
      />}
      <WorkbenchRail
        key='wb-rail'
        currentPrefix={currentPrefix}
        mode={mode}
        menuType={menuType}
        module={restProps.dataSource?.module}
        onNavChange={_menuTypeChange}
      />
      <WorkbenchStatusbar
        key='wb-statusbar'
        draftVersion={wbDraftTick}
        currentPrefix={currentPrefix}
        mode={mode}
        dataSource={restProps.dataSource}
      />
    </div>
  </Loading>;
});

export default Index;
