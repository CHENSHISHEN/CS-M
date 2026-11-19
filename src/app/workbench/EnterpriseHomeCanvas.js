/**
 * DATA-WB-FEAT-003 / S3 企业首页直接编辑画布（EnterpriseHomeCanvas）
 *
 * 独立 X6 Graph：注册名全部 eh-* 命名空间（eh-rect/eh-text/eh-group/eh-diagram/eh-edge），
 * 不触碰 Chen/ercanvas/drawing 的注册与协议。合同读写经 lib/enterprise_home 纯函数层：
 *   保存 = 最新 getDataSource() 合并提交（只替换 homeCanvas，不覆盖其他 tab 草稿）；
 *   读取 = 空项目回落空画布，不写默认示例。
 * 支持拖放(MIME application/x-pdman-enterprise-home)/点击添加、双击编辑(失焦确认/Esc取消)、
 * 连接与标签、移动/尺寸/删除、撤销重做、平移缩放、内容适应找回（允许负坐标，无固定纸张）。
 * readOnly 禁用全部写路径（键盘/拖放/删除/undo/连线/嵌入），仅保留平移缩放与查看。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Graph} from '@antv/x6';
import '@antv/x6-react-shape';
import {Button, Modal, openModal} from 'components';
import {
  HOME_CANVAS_MIME,
  HOME_NODE_DEFAULTS,
  HOME_NODE_KINDS,
  cellsFromHomeCanvas,
  diagramDisplayName,
  diagramThumbGeometry,
  homeCanvasFromCells,
  homeLabel,
  readHomeCanvas,
  resolveDiagramRef,
  writeHomeCanvas,
} from '../../lib/enterprise_home';
import {getMemoryCache} from '../../lib/cache';
import {CONFIG} from '../../lib/variable';
import {WbIcon} from './icons';

// 局部文案：语言取运行配置（与 FormatMessage 同源），字典在 lib/enterprise_home，
// 不触碰 lang/zh.js / lang/en.js 等他人语言文件
const currentLang = () => {
  const config = getMemoryCache(CONFIG);
  return (config && config.lang) || 'zh';
};
const L = key => homeLabel(currentLang(), key);

const BLUE = '#3566af';
const kindShape = {rect: 'eh-rect', text: 'eh-text', group: 'eh-group', diagram: 'eh-diagram'};

const homePorts = () => ({
  groups: ['top', 'bottom', 'left', 'right'].reduce((prev, pos) => ({
    ...prev,
    [pos]: {
      position: pos,
      attrs: {
        circle: {
          r: 4,
magnet: true,
stroke: BLUE,
strokeWidth: 1.5,
          fill: '#ffffff',
          // 显隐交给 CSS（.x6-port-body 默认隐藏、节点 hover 显示）：
          // 不用 portProp 内联样式，避免悬停产生模型写入与 history 噪声
        },
      },
    },
  }), {}),
  items: [
    {group: 'top', id: 'port-top'},
    {group: 'bottom', id: 'port-bottom'},
    {group: 'left', id: 'port-left'},
    {group: 'right', id: 'port-right'},
  ],
});

// diagram 节点渲染所需的最新数据源：模块级 holder + 订阅，
// react-shape 组件不经过 props 也能拿到最新 diagrams（其他 tab 改图后本画布可刷新）
const diagramStore = {version: 0, source: null, listeners: new Set()};
const setDiagramStoreSource = (source) => {
  if (diagramStore.source === source) return; // 身份未变不广播
  diagramStore.source = source || null;
  diagramStore.version += 1;
  diagramStore.listeners.forEach(listener => listener());
};
const useDiagramStore = () => {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force(v => v + 1);
    diagramStore.listeners.add(listener);
    return () => { diagramStore.listeners.delete(listener); };
  }, []);
  return diagramStore;
};

// diagram 引用节点：标题 + 源图缩略（等比投影自源图 canvasData，只读不重渲模型）。
// 源失效：保留节点、红框 + 失效提示；移除引用节点不删源图。
const HomeDiagramNode = ({node}) => {
  useDiagramStore();
  const source = diagramStore.source;
  const diagramId = node.prop('diagramId');
  const customText = node.prop('hText');
  const {status, diagram} = resolveDiagramRef(source, diagramId);
  let name = customText || '';
  if (!name && diagram) name = diagramDisplayName(diagram);
  if (!name && diagramId && status === 'missing') name = L('invalidRef');
  const geometry = diagram ? diagramThumbGeometry(diagram, 196, 92) : null;
  return <div className={`chiner-ehc-diagram${status === 'missing' ? ' chiner-ehc-diagram-missing' : ''}`}>
    <div className='chiner-ehc-diagram-head' title={name}>
      <WbIcon name='diagram' size={13}/>
      <span>{name || L('addDiagram')}</span>
      {status === 'missing' && <em>{L('invalidRef')}</em>}
    </div>
    <div className='chiner-ehc-diagram-body'>
      {geometry
        ? <svg viewBox='0 0 196 92' preserveAspectRatio='xMidYMid meet' aria-hidden='true'>
          {geometry.lines.map((l, i) => <line
            key={`l${i}`}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            className='chiner-ehc-diagram-line'/>)}
          {geometry.rects.map((r, i) => <rect
            key={`r${i}`}
            x={r.x}
            y={r.y}
            width={Math.max(r.width, 2)}
            height={Math.max(r.height, 2)}
            rx='2'
            className='chiner-ehc-diagram-cell'/>)}
        </svg>
        : <div className='chiner-ehc-diagram-empty'>
          <WbIcon name='diagram' size={22}/>
          <span>{status === 'missing' ? L('invalidRef') : L('pickDiagramEmpty')}</span>
        </div>}
    </div>
  </div>;
};

// 一次性注册，模块级守卫；仅新增 eh-* 名称，不改任何既有注册
let shapesRegistered = false;
const ensureHomeShapes = () => {
  if (shapesRegistered) return;
  shapesRegistered = true;
  const labelBase = {
    fontSize: 13,
    fill: '#303746',
    textAnchor: 'middle',
    textVerticalAnchor: 'middle',
  };
  Graph.registerNode('eh-rect', {
    inherit: 'rect',
    zIndex: 2,
    attrs: {
      body: {fill: '#ffffff', stroke: BLUE, strokeWidth: 1.5, rx: 6, ry: 6},
      label: labelBase,
    },
    ports: homePorts(),
  });
  Graph.registerNode('eh-text', {
    inherit: 'rect',
    zIndex: 2,
    attrs: {
      body: {fill: 'transparent', stroke: 'transparent', strokeWidth: 0},
      label: {...labelBase, fontSize: 15, fontWeight: 600},
    },
    ports: homePorts(),
  });
  Graph.registerNode('eh-group', {
    inherit: 'rect',
    zIndex: 1,
    attrs: {
      body: {
        fill: 'rgba(53,102,175,.04)',
stroke: '#8baeea',
        strokeWidth: 1.2,
strokeDasharray: '6 4',
rx: 8,
ry: 8,
      },
      label: {
        fontSize: 13,
fontWeight: 600,
fill: '#365a89',
        refX: 12,
refY: 10,
textAnchor: 'start',
textVerticalAnchor: 'top',
      },
    },
    ports: homePorts(),
  });
  Graph.registerNode('eh-diagram', {
    inherit: 'react-shape',
    zIndex: 2,
    component: <HomeDiagramNode/>,
  });
  Graph.registerEdge('eh-edge', {
    inherit: 'edge',
    zIndex: 3,
    router: {name: 'manhattan'},
    connector: {name: 'rounded'},
    attrs: {
      line: {stroke: BLUE, strokeWidth: 1.6, targetMarker: {name: 'classic', size: 7}},
    },
    defaultLabel: {
      markup: [{tagName: 'rect', selector: 'body'}, {tagName: 'text', selector: 'label'}],
      attrs: {
        body: {
          fill: '#ffffff',
stroke: BLUE,
strokeWidth: 1,
rx: 3,
ry: 3,
          refWidth: '140%',
refHeight: '140%',
        },
        label: {...labelBase, fontSize: 11},
      },
      position: {distance: 0.5},
    },
  });
};

// diagram 搜索选择器：真实 diagrams 过滤，无伪造项；空态提供新建入口
const DiagramPicker = ({diagrams, onPick, onCreate}) => {
  const [keyword, setKeyword] = useState('');
  const kw = keyword.trim().toLowerCase();
  const list = kw
    ? diagrams.filter(d => `${d.defKey || ''} ${d.defName || ''}`.toLowerCase().includes(kw))
    : diagrams;
  return <div className='chiner-ehc-picker'>
    <input
      className='chiner-ehc-picker-search'
      value={keyword}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      placeholder={L('pickDiagramSearch')}
      aria-label={L('pickDiagramSearch')}
      onChange={e => setKeyword(e.target.value)}/>
    {list.length > 0 ? <ul className='chiner-ehc-picker-list' role='listbox' aria-label={L('pickDiagram')}>
      {list.map((d) => {
        const geometry = diagramThumbGeometry(d, 120, 44);
        return <li
          key={d.id}
          role='option'
          aria-selected={false}
          tabIndex={0}
          title={diagramDisplayName(d)}
          onClick={() => onPick(d)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(d); }
          }}>
          <span className='chiner-ehc-picker-name'>{diagramDisplayName(d)}</span>
          {geometry && <svg
            className='chiner-ehc-picker-thumb'
            viewBox='0 0 120 44'
            preserveAspectRatio='xMidYMid meet'
            aria-hidden='true'>
            {geometry.lines.map((l, i) => <line key={`l${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}/>)}
            {geometry.rects.map((r, i) => <rect
              key={`r${i}`}
              x={r.x}
              y={r.y}
              width={Math.max(r.width, 2)}
              height={Math.max(r.height, 2)}
              rx='1'/>)}
          </svg>}
        </li>;
      })}
    </ul>
      : <div className='chiner-ehc-picker-empty'>
        <p>{L('pickDiagramEmpty')}</p>
        {onCreate && <Button type='primary' onClick={onCreate}>{L('pickDiagramCreate')}</Button>}
      </div>}
  </div>;
};

const EnterpriseHomeCanvas = ({
  dataSource,
  getDataSource,
  updateDataSource,
  readOnly = false,
  addRequest,
  onOpenDiagram,
  onCreateDiagram,
}) => {
  const wrapRef = useRef(null);
  const containerRef = useRef(null);
  const graphRef = useRef(null);
  const loading = useRef(false);
  const lastWritten = useRef(null);
  const addNonce = useRef(null);
  const editingRef = useRef(null);
  // 每次渲染刷新最新 props（事件闭包读 latest.current，避免陈旧值）
  const latest = useRef({});
  latest.current = {
    dataSource, getDataSource, updateDataSource, readOnly, onOpenDiagram, onCreateDiagram,
  };

  const [zoom, setZoom] = useState(100);
  const [hist, setHist] = useState({undo: false, redo: false});
  const [counts, setCounts] = useState({nodes: 0, edges: 0, selected: 0});
  const [editing, setEditing] = useState(null);

  const latestSource = useCallback(() => {
    const current = latest.current;
    const source = current.getDataSource ? current.getDataSource() : current.dataSource;
    return source || {};
  }, []);

  const syncState = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    setZoom(Math.round(g.zoom() * 100));
    setHist({undo: g.canUndo(), redo: g.canRedo()});
    setCounts({
      nodes: g.getNodes().length,
      edges: g.getEdges().length,
      selected: g.getSelectedCells().length,
    });
  }, []);

  // S3-HOME-REVIEW 第1/2条：保存同步进行（无 350ms 局部等待，改完立即可被 Cmd+S 读到），
  // 且先做归一化内容比较——内容未变（悬停/选择/缩放等非内容事件）一律不写项目
  const saveNow = useCallback(() => {
    const g = graphRef.current;
    if (!g || loading.current || latest.current.readOnly) return;
    const canvas = homeCanvasFromCells(g.toJSON().cells);
    const json = JSON.stringify(canvas);
    if (json === lastWritten.current) return; // 内容相同不 update
    lastWritten.current = json;
    latest.current.updateDataSource
      && latest.current.updateDataSource(writeHomeCanvas(latestSource(), canvas));
  }, [latestSource]);

  // 内容事件在当前动作完成时同步进入项目（见事件绑定处）：
  // 拖拽/缩放过程中的高频 position/size 变化由 node:moved / node:resized 完成时提交
  const scheduleSave = useCallback(() => saveNow(), [saveNow]);

  // ---- 内联编辑（双击）：失焦确认 / Enter 确认 / Escape 取消 ----
  // S3-HOME-REVIEW 第3条：提交时再次检查最新 readOnly——模式切只读后失焦/Enter 不写画布
  const finishEditing = useCallback((commit) => {
    const state = editingRef.current;
    editingRef.current = null;
    setEditing(null);
    if (!state || !commit || latest.current.readOnly) return;
    const g = graphRef.current;
    const cell = g && g.getCellById(state.cellId);
    if (!cell) return;
    if (state.isEdge) {
      const value = state.value.trim();
      if (value) cell.setLabels([{attrs: {label: {text: value}}}]);
      else cell.removeLabels();
    } else if (cell.shape === 'eh-diagram') {
      cell.prop('hText', state.value);
    } else {
      cell.attr('label/text', state.value);
    }
  }, []);

  const beginEditing = useCallback((cell, clientX, clientY, isEdge) => {
    let value = '';
    if (isEdge) {
      value = cell.getLabelAt(0)?.attrs?.label?.text || '';
    } else if (cell.shape === 'eh-diagram') {
      value = cell.prop('hText') || '';
    } else {
      value = cell.attr('label/text') || '';
    }
    // 编辑器为 position:fixed（见 less），client 坐标与 CSS 定位同一参照系
    const left = Math.max(clientX - 80, 8);
    const top = Math.max(clientY - 14, 8);
    const state = {cellId: cell.id, isEdge, value, left, top};
    editingRef.current = state;
    setEditing(state);
  }, []);

  const viewportCenter = useCallback(() => {
    const g = graphRef.current;
    const dom = containerRef.current;
    if (!g || !dom) return {x: 0, y: 0};
    const rect = dom.getBoundingClientRect();
    // 坐标按视口缩放换算：clientToLocal 已含平移/缩放
    return g.clientToLocal(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, []);

  const addDiagramNode = useCallback((diagram, atPoint) => {
    const g = graphRef.current;
    if (!g || latest.current.readOnly) return;
    const center = atPoint || viewportCenter();
    g.addNode({
      id: Math.uuid(),
      shape: kindShape.diagram,
      x: center.x - HOME_NODE_DEFAULTS.diagram.width / 2,
      y: center.y - HOME_NODE_DEFAULTS.diagram.height / 2,
      width: HOME_NODE_DEFAULTS.diagram.width,
      height: HOME_NODE_DEFAULTS.diagram.height,
      diagramId: diagram.id,
      hText: diagramDisplayName(diagram),
      // diagram 引用不挂连接桩：与 cellsFromHomeCanvas 重载路径一致（只读缩略、双击开源）
    });
    syncState();
  }, [syncState, viewportCenter]);

  const openDiagramPicker = useCallback((atPoint) => {
    const diagrams = latestSource().diagrams || [];
    let modal;
    modal = openModal(<DiagramPicker
      diagrams={diagrams}
      onPick={(diagram) => { modal.close(); addDiagramNode(diagram, atPoint); }}
      onCreate={latest.current.onCreateDiagram
        ? () => { modal.close(); latest.current.onCreateDiagram(); }
        : null}
    />, {
      title: L('pickDiagram'),
      bodyStyle: {width: 420},
      buttons: [<Button key='cancel' onClick={() => modal.close()}>{L('cancel')}</Button>],
    });
  }, [addDiagramNode, latestSource]);

  const addNodeAt = useCallback((kind, localPoint) => {
    const g = graphRef.current;
    if (!g || latest.current.readOnly || !HOME_NODE_KINDS.includes(kind)) return;
    if (kind === 'diagram') {
      openDiagramPicker(localPoint);
      return;
    }
    const defaults = HOME_NODE_DEFAULTS[kind];
    const center = localPoint || viewportCenter();
    let text = '';
    if (kind === 'text') text = L('addText');
    else if (kind === 'group') text = L('addGroup');
    g.addNode({
      id: Math.uuid(),
      shape: kindShape[kind],
      x: center.x - defaults.width / 2,
      y: center.y - defaults.height / 2,
      width: defaults.width,
      height: defaults.height,
      attrs: text ? {label: {text}} : undefined,
      ports: homePorts(),
    });
    syncState();
  }, [openDiagramPicker, syncState, viewportCenter]);

  // ---- Graph 初始化（一次） ----
  useEffect(() => {
    ensureHomeShapes();
    if (!containerRef.current) return undefined;
    const g = new Graph({
      container: containerRef.current,
      autoResize: true,
      grid: {size: 10, visible: true, type: 'dot', args: {color: '#d3dbe7', thickness: 1}},
      scroller: {enabled: true, pageVisible: false, pageBreak: false, pannable: true, modifiers: ['ctrl', 'meta']},
      mousewheel: {enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.2, maxScale: 3},
      // 内容范围随图形扩展（含负坐标），不固定纸张：scroller 内容区跟随内容包围盒
      selecting: {
        enabled: true,
multiple: true,
rubberband: true,
        showNodeSelectionBox: true,
className: 'chiner-ehc-selection',
      },
      resizing: {enabled: () => !latest.current.readOnly, minWidth: 24, minHeight: 20},
      snapline: {enabled: true, sharp: true},
      history: {enabled: true},
      keyboard: {enabled: true},
      embedding: {
        enabled: true,
        findParent: ({node}) => {
          if (latest.current.readOnly || node.shape === kindShape.group) return [];
          return g.getNodesUnderNode(node).filter(n => n.shape === kindShape.group);
        },
        validate: ({parent}) => parent.shape === kindShape.group,
      },
      connecting: {
        snap: true,
        allowBlank: false,
        allowLoop: true,
        allowNode: false,
        router: {name: 'manhattan'},
        connector: {name: 'rounded'},
        createEdge: () => g.createEdge({shape: 'eh-edge'}),
        validateConnection: ({targetMagnet}) => !latest.current.readOnly && Boolean(targetMagnet),
      },
      interacting: () => !latest.current.readOnly,
    });
    graphRef.current = g;

    const loadFromSource = () => {
      loading.current = true;
      try {
        g.fromJSON({cells: cellsFromHomeCanvas(readHomeCanvas(latestSource()))});
      } catch (err) {
        // 损坏数据回落空画布，不写默认示例
        g.clearCells();
      }
      g.cleanHistory();
      // S3-HOME-REVIEW 第1条：记录初始基线——读取/悬停/选择/缩放不产生 dirty 写入
      lastWritten.current = JSON.stringify(homeCanvasFromCells(g.toJSON().cells));
      loading.current = false;
    };
    loadFromSource();
    setDiagramStoreSource(latestSource());
    // 有内容则定位到内容，保证平移/缩放后仍可找回
    if (g.getCellCount() > 0) {
      setTimeout(() => { g.centerContent(); syncState(); }, 0);
    } else {
      syncState();
    }

    // S3-HOME-REVIEW 第2条：真实内容变更在动作完成时同步进入项目（scheduleSave 即 saveNow）。
    // cell:change:* 过滤手势中间态的高频 key（拖动 position / 缩放 size / 拉线 source、target）：
    //   - 普通拖动/缩放由 node:moved / node:resized 完成时提交；
    //   - 选择框整体拖拽等无完成事件的路径由 window mouseup 兜底同步冲刷；
    //   - 撤销/重做在调用点同步提交。其余变更（文字/标签/parent 等）逐事件同步保存。
    const events = ['cell:added', 'cell:removed', 'edge:connected'];
    events.forEach(ev => g.on(ev, () => { scheduleSave(); syncState(); }));
    g.on('cell:change:*', ({key}) => {
      if (['position', 'size', 'source', 'target'].includes(key)) return;
      scheduleSave(); syncState();
    });
    g.on('node:moved', () => { scheduleSave(); syncState(); });
    g.on('node:resized', () => { scheduleSave(); syncState(); });
    const handleGlobalMouseUp = () => scheduleSave(); // 手势兜底（内容比较保证无变化不写）
    window.addEventListener('mouseup', handleGlobalMouseUp);
    g.history.on('change', syncState);
    g.on('selection:changed', syncState);
    g.on('scale', syncState);
    g.on('translate', () => setZoom(Math.round(g.zoom() * 100)));

    // 悬停连接桩的显隐交给 CSS（.x6-port-body 默认隐藏、hover 显示），
    // 不再用 portProp 写模型——悬停不产生任何写入与 history 噪声

    // 双击：diagram 引用 → 打开源图；其他图形 → 编辑文字；边 → 编辑标签
    g.on('node:dblclick', ({node, e}) => {
      if (node.shape === kindShape.diagram) {
        const {status, diagram} = resolveDiagramRef(latestSource(), node.prop('diagramId'));
        if (status === 'ok' && latest.current.onOpenDiagram) {
          latest.current.onOpenDiagram(diagram.id);
        } else {
          Modal.error({title: L('invalidRef')});
        }
        return;
      }
      if (latest.current.readOnly) return;
      beginEditing(node, e.clientX, e.clientY, false);
    });
    g.on('edge:dblclick', ({edge, e}) => {
      if (latest.current.readOnly) return;
      beginEditing(edge, e.clientX, e.clientY, true);
    });

    // 只读仍允许平移缩放，但键盘写路径全部关闭；
    // 编辑器打开时按 backspace 清空输入不触发删除快捷键
    g.bindKey(['backspace', 'delete'], () => {
      if (loading.current || latest.current.readOnly || editingRef.current) return;
      const cells = g.getSelectedCells();
      if (cells.length) g.removeCells(cells);
    });
    // 撤销/重做每次均同步提交（含纯 position 变更的恢复，不依赖 cell 事件过滤）
    g.bindKey(['ctrl+z', 'meta+z'], () => {
      if (loading.current || latest.current.readOnly) return;
      if (g.canUndo()) { g.undo(); saveNow(); }
    });
    g.bindKey(['ctrl+shift+z', 'meta+shift+z', 'ctrl+y', 'meta+y'], () => {
      if (loading.current || latest.current.readOnly) return;
      if (g.canRedo()) { g.redo(); saveNow(); }
    });

    // 树/目录 MIME 拖放：application/x-pdman-enterprise-home，JSON {kind}
    const dom = containerRef.current;
    const handleDragOver = (e) => {
      if (latest.current.readOnly) return;
      if (e.dataTransfer && e.dataTransfer.types.includes(HOME_CANVAS_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const handleDrop = (e) => {
      if (latest.current.readOnly) return;
      const raw = e.dataTransfer && e.dataTransfer.getData(HOME_CANVAS_MIME);
      if (!raw) return;
      e.preventDefault();
      let payload = null;
      try { payload = JSON.parse(raw); } catch (err) { payload = null; }
      if (!payload || !HOME_NODE_KINDS.includes(payload.kind)) return;
      const pos = g.clientToLocal(e.clientX, e.clientY);
      addNodeAt(payload.kind, pos);
    };
    dom.addEventListener('dragover', handleDragOver);
    dom.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      dom.removeEventListener('dragover', handleDragOver);
      dom.removeEventListener('drop', handleDrop);
      saveNow(); // 卸载前同步冲刷（内容比较保证无变化时不写）
      g.dispose();
      graphRef.current = null;
    };
  }, []);

  // 外部 dataSource 变化：与最近一次写入比对，仅真正的外部编辑才重载画布
  useEffect(() => {
    const json = JSON.stringify(readHomeCanvas(latestSource()));
    if (lastWritten.current !== null && json !== lastWritten.current && graphRef.current) {
      loading.current = true;
      let cells = null;
      try {
        cells = cellsFromHomeCanvas(readHomeCanvas(latestSource()));
      } catch (err) { cells = null; }
      if (cells) {
        try { graphRef.current.fromJSON({cells}); } catch (err) { /* 回落保持现状 */ }
      }
      graphRef.current.cleanHistory();
      // 外部变更重载后同样重置基线，避免陈旧 lastWritten 引起空写
      lastWritten.current = JSON.stringify(homeCanvasFromCells(graphRef.current.toJSON().cells));
      loading.current = false;
      syncState();
    }
    setDiagramStoreSource(latestSource());
  }, [dataSource, getDataSource, latestSource, syncState]);

  // ModelCatalog 点击添加请求：{kind, nonce}，新节点放当前视口中央
  useEffect(() => {
    const request = addRequest;
    if (!request || !request.nonce || request.nonce === addNonce.current) return;
    addNonce.current = request.nonce;
    if (!graphRef.current || latest.current.readOnly) return;
    addNodeAt(request.kind, null);
  }, [addRequest, addNodeAt]);

  // S3-HOME-REVIEW 第3条：模式切只读时若正在内联编辑，直接取消（不提交）
  useEffect(() => {
    if (readOnly && editingRef.current) finishEditing(false);
  }, [readOnly, finishEditing]);

  // ---- 工具条 ----
  const toolAdd = kind => () => addNodeAt(kind, null);
  const toolUndo = () => {
    const g = graphRef.current;
    if (!g || latest.current.readOnly || !g.canUndo()) return;
    g.undo();
    saveNow(); // 撤销每次均同步提交
  };
  const toolRedo = () => {
    const g = graphRef.current;
    if (!g || latest.current.readOnly || !g.canRedo()) return;
    g.redo();
    saveNow();
  };
  const toolDelete = () => {
    const g = graphRef.current;
    if (!g || latest.current.readOnly) return;
    const cells = g.getSelectedCells();
    if (cells.length) g.removeCells(cells);
  };
  const toolZoom = factor => () => {
    const g = graphRef.current;
    if (!g) return;
    g.zoom(factor);
    setZoom(Math.round(g.zoom() * 100));
  };
  const toolFit = () => {
    const g = graphRef.current;
    if (!g) return;
    g.zoomToFit({padding: 60, maxScale: 1.5});
    setZoom(Math.round(g.zoom() * 100));
  };
  const toolReset = () => {
    const g = graphRef.current;
    if (!g) return;
    g.zoomTo(1);
    g.centerContent();
    setZoom(100);
  };

  const empty = counts.nodes === 0;
  const toolBtn = (key, icon, onClick, disabled) => <button
    key={key}
    type='button'
    className='chiner-ehc-tool-btn'
    onClick={onClick}
    disabled={disabled}
    title={L(key)}
    aria-label={L(key)}>
    {icon}
  </button>;

  return <div className='chiner-ehc' ref={wrapRef}>
    <div
      className={`chiner-ehc-toolbar${readOnly ? ' chiner-ehc-toolbar-ro' : ''}`}
      role='toolbar'
      aria-label={L('canvasLabel')}>
      {!readOnly && <>
        <span className='chiner-ehc-tool-group'>
          {toolBtn('addRect', <i className='fa fa-square-o'/>, toolAdd('rect'), false)}
          {toolBtn('addText', <i className='fa fa-font'/>, toolAdd('text'), false)}
          {toolBtn('addGroup', <i className='fa fa-object-group'/>, toolAdd('group'), false)}
          {toolBtn('addDiagram', <WbIcon name='diagram' size={14}/>, toolAdd('diagram'), false)}
        </span>
        <span className='chiner-ehc-tool-sep'/>
        <span className='chiner-ehc-tool-group'>
          {toolBtn('undo', <i className='fa fa-undo'/>, toolUndo, !hist.undo)}
          {toolBtn('redo', <i className='fa fa-repeat'/>, toolRedo, !hist.redo)}
          {toolBtn('deleteSelected', <i className='fa fa-trash-o'/>, toolDelete, counts.selected === 0)}
        </span>
        <span className='chiner-ehc-tool-sep'/>
      </>}
      <span className='chiner-ehc-tool-group'>
        {toolBtn('zoomOut', <i className='fa fa-search-minus'/>, toolZoom(-0.1), false)}
        <button
          type='button'
          className='chiner-ehc-tool-zoom'
          onClick={toolReset}
          title={L('zoomReset')}
          aria-label={L('zoomReset')}>{zoom}%</button>
        {toolBtn('zoomIn', <i className='fa fa-search-plus'/>, toolZoom(0.1), false)}
        {toolBtn('zoomFit', <i className='fa fa-arrows-alt'/>, toolFit, false)}
      </span>
    </div>
    <div className='chiner-ehc-main'>
      <div
        className='chiner-ehc-container'
        ref={containerRef}
        tabIndex={0}
        role='application'
        aria-label={L('canvasLabel')}/>
      {empty && !readOnly && <div className='chiner-ehc-empty'>
        <div className='chiner-ehc-empty-card'>
          <p className='chiner-ehc-empty-title'>{L('emptyTitle')}</p>
          <p className='chiner-ehc-empty-hint'>{L('emptyHint')}</p>
          <div className='chiner-ehc-empty-actions'>
            <button type='button' onClick={toolAdd('rect')}><i className='fa fa-square-o'/>{L('addRect')}</button>
            <button type='button' onClick={toolAdd('text')}><i className='fa fa-font'/>{L('addText')}</button>
            <button type='button' onClick={toolAdd('group')}><i className='fa fa-object-group'/>{L('addGroup')}</button>
            <button type='button' onClick={toolAdd('diagram')}><WbIcon name='diagram' size={14}/>{L('addDiagram')}</button>
          </div>
        </div>
      </div>}
    </div>
    <div className='chiner-ehc-status'>
      <span>{counts.nodes} {L('nodeCount')} · {counts.selected} {L('selectedCount')}</span>
      {readOnly && <span className='chiner-ehc-status-ro'>{L('readOnly')}</span>}
    </div>
    {editing && <div className='chiner-ehc-editor' style={{left: editing.left, top: editing.top}}>
      {/* 双击编辑：失焦确认 / Enter 确认 / Escape 取消 */}
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        defaultValue={editing.value}
        aria-label={L('canvasLabel')}
        onChange={(e) => { if (editingRef.current) editingRef.current.value = e.target.value; }}
        onBlur={() => finishEditing(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') finishEditing(false);
          else if (e.key === 'Enter') finishEditing(true);
        }}/>
    </div>}
  </div>;
};

export default React.memo(EnterpriseHomeCanvas);
