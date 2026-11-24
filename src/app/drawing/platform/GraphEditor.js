import React, { useEffect, useRef, useState } from 'react';
import DrawingDocument from '../../../../public/drawing-document';
import { Graph } from '@antv/x6';
import { registerDrawingShapes } from '../drawingShapes';
import { SHAPES, SHAPE_PACKS, MODEL_COLLECTIONS, platformId, shapeCell, edgeCell, drawingType, clone, copyWithIds, resolveAsset } from '../../../lib/drawing_platform';
import { t, titleOf, Field, Action, Dialog, ResizeHandle, usePanelWidth, download, editableTarget, useDocumentHistory, en } from './common';
import diagramPreview from './diagramPreview';
import {registerChenShapes} from './chenShapes';
import ChenProperties from './ChenProperties';
import ChenLibrary from './ChenLibrary';
import ChenInspector from './ChenInspector';
import {chenLook as lookOf, basicColors, applyLookToPage} from './ChenAppearance';
import FormatBar from './FormatBar';
import ShapeGlyph from './ShapeGlyph';
import TextRanges from './TextRanges';
import ClassMembers, {membersOf, memberText, classGeometry, relayoutClassNode, CLASS_TEXT_ATTRS} from './ClassMembers';
import { ReferenceDetails, AssetPicker } from './References';
import { IconFit, IconPointer, IconHand, IconText, IconNote, IconUndo, IconRedo } from './icons';

let registered = false;let drawingClipboard = null;
const register = () => {
  registerDrawingShapes();registerChenShapes(Graph);
  if (registered) return;
  registered = true;
  Graph.registerNode('pv-class', {inherit: 'rect', markup: [
    {tagName: 'rect', selector: 'body'}, {tagName: 'text', selector: 'label'},
    {tagName: 'path', selector: 'line1'}, {tagName: 'path', selector: 'line2'},
    {tagName: 'text', selector: 'fields'}, {tagName: 'text', selector: 'methods'},
  ], attrs: {
    label: {refX: '50%', refY: 21, textAnchor: 'middle', fontWeight: 600, fontSize: 14},
    line1: {d: 'M0 42 H240', stroke: '#7086a7', refWidth: '100%'},
    line2: {d: 'M0 118 H240', stroke: '#7086a7', refWidth: '100%'},
    fields: {refX: 12, refY: 56, textAnchor: 'start', textVerticalAnchor: 'top', fontFamily: 'monospace', fontSize: 12, fill: '#26354b'},
    methods: {refX: 12, refY: 132, textAnchor: 'start', textVerticalAnchor: 'top', fontFamily: 'monospace', fontSize: 12, fill: '#26354b'},
  }});
  Graph.registerNode('pv-embed', {inherit: 'rect', markup: [{tagName: 'rect', selector: 'body'}, {tagName: 'text', selector: 'label'}, {tagName: 'image', selector: 'preview'}], attrs: {label: {refX: 15, refY: 22, textAnchor: 'start', fontSize: 14}, preview: {refX: 10, refY: 42, refWidth: -20, refHeight: -52, preserveAspectRatio: 'xMidYMid meet'}}});
  Graph.registerNode('pv-actor', {inherit: 'rect', markup: [{tagName: 'rect', selector: 'body'}, {tagName: 'circle', selector: 'head'}, {tagName: 'path', selector: 'limbs'}, {tagName: 'text', selector: 'label'}], attrs: {
    body: {fill: 'transparent', stroke: 'transparent'}, head: {refCx: '50%', cy: 17, r: 12, fill: '#fff', stroke: '#586b83', strokeWidth: 1.6},
    limbs: {d: 'M70 29 V64 M42 42 H98 M70 64 L46 88 M70 64 L94 88', stroke: '#586b83', fill: 'none', strokeWidth: 1.6},
    label: {refX: '50%', refY: '100%', refY2: -4, textAnchor: 'middle', fontSize: 13},
  }});
};
import {chenPorts, compensateScroll, workareaBox} from './chenGeometry';
import {safeOpenExternal} from '../../../lib/safeExternal';
const decorate = cell => {
  const c = clone(cell);if (c.data?.chen && !c.source) c.ports = chenPorts(); const kind = c.data?.kind;
  if (['class', 'interface', 'enum'].includes(kind)) {
    const members = membersOf(c.data);const attributes = memberText(members.attributes);const operations = memberText(members.operations, true);
    const g = classGeometry(c.attrs);const divider = g.divider(members.attributes.length);
    c.shape = 'pv-class';c.height = Math.max(c.size?.height || c.height || 190, g.height(members.attributes.length, members.operations.length));
    c.attrs = {...c.attrs, label: {...c.attrs?.label, refX: c.attrs?.label?.refX == null ? '50%' : c.attrs.label.refX, refY: g.labelRefY, textAnchor: c.attrs?.label?.textAnchor || 'middle', textWrap: null},
      line1: {...c.attrs?.line1, d: `M0 ${g.line1} H240`},
      line2: {d: `M0 ${divider} H240`}, fields: {...c.attrs?.fields, text: attributes, refY: g.fieldsTop}, methods: {...c.attrs?.methods, text: operations, refY: divider + g.methodsGap}};
  }
  if (c.data?.unboundAsset && c.shape === 'pv-embed') c.attrs = {...c.attrs, preview: {'xlink:href': ''}};
  if (kind === 'actor') c.shape = 'pv-actor';
  return c;
};
const colorValue = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : /^#[0-9a-f]{3}$/i.test(value || '') ? `#${value.slice(1).split('').map(c => c + c).join('')}` : fallback;
const relations = ['flow', 'association', 'composition', 'inheritance', 'dependency', 'include', 'extend'];
// UAT-009 inline-editor regression fix (real-package probe: long single line
// clientWidth 62 / scrollWidth 425; 4 lines clientHeight 37 / scrollHeight 68).
// The Chen SVG label carries textWrap+ellipsis, so its bbox is the TRUNCATED
// text: refresh paths (cell:change / scroll / zoom) that copied that bbox into
// the editor SIZE overrode the correct draft measurement taken in onChange.
// Rule below: the SVG bbox only ever supplies the anchor; content size always
// comes from the untruncated textarea draft + latest font/lineHeight/spacing.
let measureCanvas = null;
const inlineBoxFor = (value, ins) => {
  if (!ins.chen || !ins.font) return {width: ins.width, x: ins.x};
  const canvas = measureCanvas || (measureCanvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  ctx.font = `${ins.font.fontStyle || 'normal'} ${ins.font.fontWeight || 400} ${ins.font.fontSize * (ins.scale || 1)}px ${ins.font.fontFamily}`;
  const spacing = (ins.font.letterSpacing || 0) * (ins.scale || 1);
  const lines = String(value).split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width + spacing * Math.max(0, l.length - 1)), 0);
  const width = Math.max(40, Math.ceil(longest) + 16);
  const lineHeight = Math.max(1, ins.font.lineHeight || 1.25);
  const height = Math.ceil(lines.length * ins.font.fontSize * lineHeight * (ins.scale || 1)) + 8;
  return {width, height, x: ins.font.textAlign === 'left' ? ins.x : ins.font.textAlign === 'right' ? ins.x + ins.width - width : ins.x + (ins.width - width) / 2};
};
// Re-anchor the editor on the (possibly truncated) SVG text rect while keeping
// the measured draft size: left keeps rect.left, center keeps rect's midpoint,
// right keeps rect.right — the ±4 matches the onChange anchor offsets.
const applyChenPosition = (prev, rect, scale) => {
  const withScale = Number.isFinite(scale) ? {...prev, scale} : prev;
  const box = inlineBoxFor(withScale.text, withScale);
  const align = withScale.font.textAlign;
  const anchorX = align === 'left' ? rect.left : align === 'right' ? rect.right : rect.left + rect.width / 2;
  const x = align === 'left' ? anchorX - 4 : align === 'right' ? anchorX - box.width + 4 : anchorX - box.width / 2;
  return {...withScale, x, y: rect.top - 3, width: box.width, height: box.height};
};

export default ({doc, source, onChange, readOnly, onOpenAsset, onLocate, locateId, chenPage, onChenEdit, onChenAdd, onChenPaste, onCommands, externalHistory, onExportDocument, onAuxCommand, onPanCollapse}) => {
  const localHistory = useDocumentHistory(doc, onChange, readOnly);
  const history = externalHistory ? {...externalHistory, apply: onChange} : localHistory;
  const host = useRef(null); const graphRef = useRef(null); const latest = useRef({doc, source, onChange, readOnly});
  latest.current = {doc, source, onChange: history.apply, readOnly}; const muted = useRef(false);
  const temporaryReveal = useRef(new Set());const rejectedMutation=useRef(false);
  const displayCanvas = canvas => ({cells:(canvas?.cells || []).map(c=>temporaryReveal.current.has(c.id)||temporaryReveal.current.has(c.source?.cell)&&temporaryReveal.current.has(c.target?.cell)?{...c,visible:true}:c)});
  const lastCanvas = useRef(doc.canvasData);const batchDepth = useRef(0);const failed = useRef(false);
  const minimapHost = useRef(null);const [showMinimap,setShowMinimap] = useState(false);
  const [textRanges, setTextRanges] = useState(null);
  const [defaults, setDefaults] = useState({});const styleClipboard=useRef(null);
  const [libraryTab, setLibraryTab] = useState('library');const [favoriteComponents,setFavoriteComponents]=useState(()=>{try{return JSON.parse(localStorage.getItem('pdmaner.drawing.favoriteComponents') || '[]');}catch(e){return [];}});
  const [favorites, setFavorites] = useState(() => {try {return JSON.parse(localStorage.getItem('pdmaner.drawing.favoriteShapes') || '[]');}catch(e){return [];}});
  const favorite = shapeId => {const next=favorites.includes(shapeId)?favorites.filter(v=>v!==shapeId):[...favorites,shapeId];try {localStorage.setItem('pdmaner.drawing.favoriteShapes',JSON.stringify(next));setFavorites(next);}catch(err){setError(err.message);}};
  const palettes = [['#3566af','#e9f0fc'],['#187c72','#e4f3ef'],['#7854be','#f0eafa'],['#a46524','#fbf2df']];

  const auxiliary = useRef(false);const composing = useRef(false);
  const [inline, setInline] = useState(null);const inlineClosed = useRef(false);const inlineRef = useRef(null);inlineRef.current = inline;
  // V5-R3 follow-up (port-center drag after hand-pan): X6 emits no fresh
  // node:mouseenter for a stationary cursor, so the hovered node id survives
  // re-projections/tool switches and re-reveals its ports.
  const hoveredRef = useRef(null);const revealHoveredRef = useRef(null);
  const [selection, setSelection] = useState([]); const [, redraw] = useState(0); const [error, setError] = useState('');
  const [showWorkArea, setShowWorkArea] = useState(false);
  const [tool, setToolState] = useState('select');
  const sizeBadgeRef = useRef(null);
  const ghostRef = useRef(null);const dropHint = useRef(null);
  const [libraryWidth,setLibraryWidth] = usePanelWidth('drawing-library',236);const [panel, setPanel] = useState(window.innerWidth > 1280); const [sideWidth, setSideWidth] = usePanelWidth('graph');
  // V5-R3 on-demand inspector: 'auto' shows with a selection, 'open'/'closed'
  // are the user's explicit choice and persist across sessions (design: 无对象
  // 时默认关闭，关闭后不在每次选择时强制重新打开).
  const [inspectorMode, setInspectorMode] = useState(() => {try {const v = localStorage.getItem('pdmaner.chen.inspector');return v === 'open' || v === 'closed' ? v : 'auto';}catch(e){return 'auto';}});
  const changeInspectorMode = mode => {setInspectorMode(mode);try{localStorage.setItem('pdmaner.chen.inspector',mode);}catch(err){}};
  const chenInspectorOpen = inspectorMode === 'open' ? true : inspectorMode === 'closed' ? false : selection.length > 0;
  // Chen library permanent collapse (re-expandable strip) — pan-temporary hide
  // (Result 4) is separate and never writes this preference.
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => {try {return localStorage.getItem('pdmaner.chen.libraryCollapsed') === '1';}catch(e){return false;}});
  const changeLibraryCollapsed = v => {setLibraryCollapsed(v);try{localStorage.setItem('pdmaner.chen.libraryCollapsed', v ? '1' : '0');}catch(err){}};
  // V5-R3 Result 4: hand/Space+drag panning temporarily collapses the library
  // and inspector (CSS-only hide — every open/width/selection state survives).
  const [panCollapse, setPanCollapse] = useState(false);
  // 集成接缝：真实平移折叠状态向上通知（DocumentEditor 以此临时隐藏 AI 辅助
  // 面板：不卸载对话、不触发请求/写入；释放/中断即恢复）
  const panCollapseRef = useRef(onPanCollapse);panCollapseRef.current = onPanCollapse;
  const updatePanCollapse = (next) => {setPanCollapse(next);const cb = panCollapseRef.current;if (cb) cb(next);};
  const wrapRef = useRef(null);const workareaRef = useRef(null);const workareaRaf = useRef(0);
  // V5-R3 Result 3: opt-in work-area indicator = content bounding box + 160
  // world units of operating margin (not a paper border). Imperative DOM
  // updates — scroll/pan must not re-render React.
  const updateWorkarea = () => {
    if (workareaRaf.current) return;
    workareaRaf.current = requestAnimationFrame(() => {
      workareaRaf.current = 0;
      const g = graphRef.current;const el = workareaRef.current;
      if (!g || !el || !el.parentElement) return;
      const box = workareaBox(g.getContentArea());
      const tl = g.localToClient(box.x, box.y);
      const br = g.localToClient(box.x + box.width, box.y + box.height);
      const wrapRect = el.parentElement.getBoundingClientRect();
      el.style.left = `${Math.round(tl.x - wrapRect.left)}px`;
      el.style.top = `${Math.round(tl.y - wrapRect.top)}px`;
      el.style.width = `${Math.max(0, Math.round(br.x - tl.x))}px`;
      el.style.height = `${Math.max(0, Math.round(br.y - tl.y))}px`;
    });
  };
  const [saveShape, setSaveShape] = useState(false);const [shapeName, setShapeName] = useState('');
  const [linkDraft,setLinkDraft] = useState(null);const [libraries, setLibraries] = useState(false); const [pick, setPick] = useState(false); const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(100); const [count, setCount] = useState(0); const [copied, setCopied] = useState(drawingClipboard);
  const type = drawingType(doc.diagramType); const enabled = doc.enabledPacks || type.packs;
  const [layer, setLayer] = useState(doc.pageLayers?.[0]?.id || 'main'); const graph = graphRef.current;
  const selected = selection.length === 1 ? selection[0] : null; const node = selected?.isNode() ? selected : null;
  const edge = selected?.isEdge() ? selected : null; const data = node?.getData() || {};
  const mutate = fn => {if (!readOnly && graph) {rejectedMutation.current=false;graph.batchUpdate('platform-edit', fn);redraw(n => n + 1);}};
  const changeMeta = patch => {if (!readOnly) history.apply({...latest.current.doc, ...patch});};
  // One Chen inline session = one undoable change (design contract 2, R3
  // field repro: per-keystroke publishes made Meta+Z peel off single
  // characters). While a Chen label is being edited the per-keystroke label
  // writes stay graph-local (muted.current), and finishInline publishes the
  // final text exactly once through publishRef. Non-Chen editors keep the
  // historical per-keystroke mutate path.
  const publishRef = useRef(null);
  // True when a non-text change (e.g. an inspector style edit) landed while a
  // Chen inline session was muted — finishInline then still publishes once.
  const sessionDirty = useRef(false);
  const finishInline = value => {
    if (!inline || inlineClosed.current) return;
    inlineClosed.current = true;
    const cell = graph?.getCellById(inline.id);
    if (cell) {
      const cellView = graph.findViewByCell(cell);
      cellView?.container.classList.remove('pv-cell-editing');
      const textEl = cellView?.container.querySelector('text');
      if (textEl) textEl.style.visibility = '';
      if (inline.chen) {
        // One session = one publish: the final text, plus any inspector style
        // edits made mid-session (sessionDirty) — a style-only session where
        // the text ends up unchanged must still persist its styles.
        const publish = value !== inline.initial || sessionDirty.current;
        if (value !== inline.initial) cell.attr('label/text', value);
        sessionDirty.current = false;
        if (publish) publishRef.current?.();
      } else mutate(() => cell.attr('label/text', value));
    }
    if (inline.chen) muted.current = false;
    setInline(null);
  };
  const finishInlineRef = useRef(null);finishInlineRef.current = finishInline;
  // CHEN-UI-008 text-overlap fix: the hidden SVG label must survive every
  // re-projection. g.fromJSON rebuilds cell views from scratch (no classes, no
  // inline styles), so every fromJSON site re-applies the visual from editingId.
  const applyEditingVisual = (g, id) => {
    if (!g || !id) return;
    const cell = g.getCellById(id);
    const view = cell && g.findViewByCell(cell);
    if (view?.container) {
      view.container.classList.add('pv-cell-editing');
      view.container.querySelectorAll('text').forEach(el => { el.style.visibility = 'hidden'; });
    }
  };
  const applyEditingVisualRef = useRef(null);applyEditingVisualRef.current = applyEditingVisual;
  // Chen inline editor tracks the label through zoom/pan/scroll: the SVG text
  // rect only supplies the anchor; content size is always re-measured from the
  // draft (see module-level inlineBoxFor/applyChenPosition). Non-Chen editors
  // keep the historical bbox-sized box.
  const setInlinePosition = (id, rect, scale) => setInline(prev => {
    if (!prev || prev.id !== id) return prev;
    if (!prev.chen || !prev.font) return {...prev, x: rect.left - 4, y: rect.top - 3, width: Math.max(40, rect.width + 8), height: Math.max(22, rect.height + 6)};
    return applyChenPosition(prev, rect, prev.chen ? scale : undefined);
  });
  const setData = patch => mutate(() => node?.setData({...node.getData(), ...patch}, {overwrite: true}));
  const selectedNodes = selection.filter(c => c.isNode());
  const currentLook = chenPage ? lookOf(chenPage) : null;
  const setLook = next => {if (!chenPage) return;onChenEdit(page => {page.scene.chenAppearance = next;});};
  // Explicit apply with undoable scope (used by the style/theme flyout footer).
  const applyLookSelected = () => {if (!selectedNodes.length) return;const ids = selectedNodes.map(n => n.id);onChenEdit(page => {applyLookToPage(page, currentLook, {semanticIds: ids.filter(id => (page.scene.nodes[id] || {}).style !== undefined || DrawingDocument.semantic(page).some(n => n.id === id)), auxIds: ids.filter(id => !DrawingDocument.semantic(page).some(n => n.id === id))});});};
  const applyLookCanvas = () => {if (!window.confirm(en() ? 'Apply the current look to every object on this canvas? (one undo step)' : '将当前外观应用到当前画布全部对象？（一次撤销）')) return;onChenEdit(page => {applyLookToPage(page, currentLook, {});});};
  // Innermost visible Chen node under a local point (smallest bbox wins).
  const chenNodeAt = local => {
    if (!graph || !local) return null;
    const hits = graph.getNodes().filter(n => n.isVisible() && n.getData()?.chen && n.getBBox && (() => {const b = n.getBBox();return local.x >= b.x && local.x <= b.x + b.width && local.y >= b.y && local.y <= b.y + b.height;})());
    return hits.sort((a, b) => {const ba = a.getBBox(), bb = b.getBBox();return ba.width * ba.height - bb.width * bb.height;})[0] || null;
  };
  // A qualified owner: entity/weak, relationship/identifying, or a composite attribute.
  // Locked or hidden nodes never adopt a dragged attribute — data.locked folds in the
  // owning layer's lock at projection time, so this covers node and layer locks for both
  // the hit-test and the selected-node fallback.
  const qualifiedOwnerId = cell => {
    if (!cell?.isNode?.()) return null;
    const data = cell.getData() || {};
    if (!data.chen || data.locked || !cell.isVisible()) return null;
    if (['entity', 'weak', 'relationship', 'identifying'].includes(data.chenKind)) return cell.id;
    if (data.chenKind === 'attribute' && (chenPage?.erModel.attributes || []).some(a => a.id === cell.id && a.kind === 'composite')) return cell.id;
    return null;
  };
  const dropOwnerIdAt = local => qualifiedOwnerId(chenNodeAt(local)) || qualifiedOwnerId(node);
  const highlightDropOwner = local => {
    if (!ghostRef.current || !graph) return;
    if (dropHint.current) {const previous = graph.getCellById(dropHint.current.ownerId);graph.findViewByCell(previous)?.container.classList.remove('pv-drop-owner');dropHint.current = null;}
    const ownerId = local ? dropOwnerIdAt(local) : null;
    if (ownerId) {const owner = graph.getCellById(ownerId);graph.findViewByCell(owner)?.container.classList.add('pv-drop-owner');dropHint.current = {ownerId};}
  };
  const clearDropHint = () => {
    if (dropHint.current && graph) {const previous = graph.getCellById(dropHint.current.ownerId);graph.findViewByCell(previous)?.container.classList.remove('pv-drop-owner');}
    dropHint.current = null;
    if (ghostRef.current) ghostRef.current.style.display = 'none';
  };
  const addGroup = component => {if (readOnly || !graph) return;mutate(() => {const cells = copyWithIds(component.cells);gAdd(cells);});};
  const add = (shape, dropPoint, hitOwnerId) => {
    if (readOnly || !graph) return;
    if (shape.group) {addGroup(shape.group);return;}
    // Owner fallback must be a QUALIFIED selected owner (qualifiedOwnerId rejects
    // locked/hidden cells); the raw node?.id bypass let drops onto a locked layer
    // still adopt attributes. Hit owner stays first; no qualified owner keeps the
    // existing DocumentEditor guidance error instead of creating an orphan.
    if (shape.pack === 'chen' && chenPage && onChenAdd) {try {onChenAdd(shape.id.slice(5), hitOwnerId || qualifiedOwnerId(node), dropPoint, defaults);} catch (err) {setError(err.message);}return;}
    const center = dropPoint || graph.clientToLocal(host.current.getBoundingClientRect().left + host.current.clientWidth / 2, host.current.getBoundingClientRect().top + host.current.clientHeight / 2);
    const cell = decorate(shapeCell(shape.pack==='chen'?shape.id.slice(5):shape.id, titleOf(shape), center.x - 85, center.y - 33));if(shape.pack==='chen')cell.shape=`chen-${shape.id==='chen-composite'?'attribute':shape.id.slice(5)}`;cell.data.layer = layer;
    if (shape.pack !== 'chen' && chenPage && currentLook) {const basic = basicColors(currentLook.themeId);cell.attrs = {...cell.attrs, body: {...cell.attrs.body, fill: defaults['body/fill'] || basic.fill, stroke: defaults['body/stroke'] || basic.stroke}};}
    Object.keys(defaults).forEach(key => {const [selector,attr] = key.split('/');
      if(cell.shape==='pv-class'&&selector==='label'&&CLASS_TEXT_ATTRS.includes(attr))['fields','methods'].forEach(s=>cell.attrs[s]={...cell.attrs[s],[attr]:defaults[key]});
      cell.attrs[selector] = {...cell.attrs[selector], [attr]: defaults[key]};});
    if(cell.shape==='pv-class'&&Object.keys(defaults).some(key=>key.startsWith('label/')&&CLASS_TEXT_ATTRS.includes(key.slice(6))))Object.assign(cell,decorate(cell));
    const n = graph.addNode(cell);graph.resetSelection([n]);if (!chenPage) setPanel(true);
  };
  const showSourceLabels = () => {
    const g = graphRef.current;if (!g) return;
    muted.current = true;
    g.getNodes().forEach(n => {const d = n.getData() || {};if (!d.assetRef) return;
      const asset = resolveAsset(latest.current.source, d.assetRef);
      n.attr('label/text', asset ? asset.name || asset.defName || asset.defKey : `${t('missingReference')} · ${d.lastName || d.assetRef.objectId}`, {virtual: true});
      if (asset && d.assetRef.objectType === 'diagrams' && n.shape === 'pv-embed') n.attr('preview/xlink:href', diagramPreview(latest.current.source, asset), {virtual: true});
      n.attr('body/stroke', asset ? '#7162d8' : '#c0564c', {virtual: true});
    });
    muted.current = false;
  };
  useEffect(() => {
    register(); const g = new Graph({container: host.current, autoResize: true,
      // V5-R3 Result 3: on Chen canvases there is no paper — no painted graph
      // background and no X6 SVG grid; the workspace dots come from the CSS
      // background on .pv-graph-wrap and cover the whole viewport.
      background: chenPage ? false : {color: doc.pageColor || '#fff'}, minimap: {enabled: true, container: minimapHost.current, width: 160, height: 110, padding: 8}, grid: {visible: !chenPage, size: 10, type: 'dot', args: {color: '#d6dfed'}},
      scroller: {enabled: true, pannable: false}, mousewheel: {enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.15, maxScale: 3},
      selecting: {enabled: true, multiple: true, rubberband: !readOnly, movable: !readOnly, showNodeSelectionBox: false},
      resizing: {enabled: n => !latest.current.readOnly && !n.getData()?.locked && Boolean(g.findViewByCell(n)), minWidth: 40, minHeight: 30}, snapline: {enabled: true}, history: {enabled: false},
      embedding: {enabled: !readOnly, findParent: 'bbox', validate: ({parent}) => Boolean(parent.getData()?.container)},
      connecting: {snap: true, allowBlank: false, allowLoop: true, router: 'manhattan', connector: 'rounded',
        createEdge: () => {rejectedMutation.current=false;const c=edgeCell('', '');return g.createEdge({...c,data:{...c.data,auxiliary:auxiliary.current},source:undefined,target:undefined});},
        validateConnection: ({type,sourceView,targetView}) => !latest.current.readOnly && Boolean((type==='source'?sourceView:targetView)?.cell?.isNode())},
      interacting: cellView => latest.current.readOnly ? false : cellView.cell.getData()?.locked ? {nodeMovable: false, magnetConnectable: false} : true,
    });
    graphRef.current = g;
    try {muted.current = true;g.fromJSON({cells: (doc.canvasData?.cells || []).map(decorate)});g.cleanHistory();muted.current = false;showSourceLabels();}
    catch (err) {muted.current = true;failed.current = true;setError(`${t('loadFailed')}: ${err.message}`);}
    const counts = () => {setCount(g.getNodes().length);redraw(n => n + 1);};
    let dirty = false;
    // Publishes the current graph json as one document change (one history
    // step, one autosave checkpoint). Shared by the incremental commit path
    // and by the Chen inline editor's single end-of-session publish.
    const publishNow = () => {
      const cells = clone(g.toJSON().cells || []).map(c => temporaryReveal.current.has(c.id) ? {...c, visible: false} : c);
      // A partially drawn connection is not a valid saved relation.
      if (cells.some(c => c.shape === 'edge' && (!c.source?.cell || !c.target?.cell))) return;
      const canvasData={cells},previous=latest.current.doc.canvasData;const accepted=latest.current.onChange({...latest.current.doc,schemaVersion:1,canvasData});dirty=false;if(accepted===false){rejectedMutation.current=true;muted.current=true;g.fromJSON({cells:displayCanvas(previous).cells.map(decorate)});muted.current=false;lastCanvas.current=previous;applyEditingVisualRef.current?.(g, inlineRef.current?.id);}else lastCanvas.current=canvasData;counts();
    };
    publishRef.current = publishNow;
    const commit = () => {if (!dirty || muted.current || failed.current || latest.current.readOnly || batchDepth.current) return;publishNow();};
    g.on('batch:start', () => {batchDepth.current += 1;});g.on('batch:stop', () => {batchDepth.current = Math.max(0, batchDepth.current - 1);commit();});
    let dragging = false;
    g.on('node:mousedown', () => {rejectedMutation.current=false;dragging = true;});g.on('node:mouseup', () => {dragging = false;commit();});
    const flushDraft = () => {dragging = false;commit();};window.addEventListener('pdmaner-drawing-flush', flushDraft);window.addEventListener('mouseup', flushDraft);
    const contentChanged = args => {if (rejectedMutation.current || failed.current || latest.current.readOnly) return;
      if (muted.current) {
        // Chen inline session: draft-text writes on the edited label stay
        // graph-local (single end-of-session publish). Any other change during
        // the session — inspector style edits whose buttons swallow mousedown
        // and never blur the editor — must survive even when the text ends up
        // unchanged, so it marks the session for one final publish. X6 fires
        // nested attr paths with key 'attrs' but options.propertyPath carries
        // the full path — that is what separates a draft keystroke from a
        // style write.
        if (!(inlineRef.current && args?.cell?.id === inlineRef.current.id && args?.options?.propertyPath === 'attrs/label/text')) sessionDirty.current = true;
        return;
      }
      dirty = true;if (!dragging) commit();};
    g.on('cell:change:*', contentChanged);g.on('cell:added', contentChanged);g.on('cell:removed', contentChanged);g.on('edge:connected', contentChanged);
    const selectionChanged = () => {
      const cells = g.getSelectedCells();
      // X6 1.18's selection overlay moves independently of `interacting`.
      g.selection.widget.options.movable = !latest.current.readOnly && !cells.some(c => c.getData()?.locked || c.isNode() && c.getDescendants().some(child => child.getData()?.locked));
      setSelection(cells);redraw(n => n + 1);
    };
    g.on('history:change', counts);g.on('selection:changed', selectionChanged);
    // CHEN-UI-008 resize state (PNG 07 #04): eight handles + a live size badge
    // exist only while resizing; selection keeps the four corner handles.
    const showResizeBadge = (n, on) => {
      const badge = sizeBadgeRef.current;
      if (!badge) return;
      if (on) {
        const b = n.getBBox();
        const client = g.localToClient(b);
        badge.textContent = `${Math.round(b.width)} × ${Math.round(b.height)}`;
        badge.style.display = 'block';
        badge.style.left = `${Math.round(client.x + client.width / 2)}px`;
        badge.style.top = `${Math.round(client.y + client.height + 8)}px`;
      } else badge.style.display = 'none';
    };
    const resizeStart = ({node: n}) => {host.current?.classList.add('pv-resizing');showResizeBadge(n, true);};
    const resizing = ({node: n}) => showResizeBadge(n, true);
    const resizeEnd = ({node: n}) => {host.current?.classList.remove('pv-resizing');showResizeBadge(n, false);};
    g.on('node:resizestart', resizeStart);g.on('node:resizing', resizing);g.on('node:resizeend', resizeEnd);
    // Chen inline editor: keep the editor glued to the label through zoom, pan and scroll.
    const repositionInline = () => {const ins = inlineRef.current;if (!ins) return;const cell = g.getCellById(ins.id);const textEl = cell && g.findViewByCell(cell)?.container.querySelector('text');
      if (!textEl) {finishInlineRef.current?.(ins.text);return;}
      setInlinePosition(ins.id, textEl.getBoundingClientRect(), g.zoom ? g.zoom() : 1);};
    g.on('scale', repositionInline);g.on('translate', repositionInline);
    const scrollerContainer = g.scroller?.widget?.container;
    scrollerContainer?.addEventListener('scroll', repositionInline);
    window.addEventListener('resize', repositionInline);
    g.on('cell:change:data', ({current, previous}) => {
      if (Boolean(current?.locked) !== Boolean(previous?.locked)) {const cells = g.getSelectedCells();g.cleanSelection();g.resetSelection(cells);}
    });
    // V5-R3 direct connection (Result 5): the select tool reveals ports on
    // hover — connection dragging is the default, no dedicated connect tool.
    // The chen port markup wraps two circles in one .x6-port-body group, so
    // visibility is toggled on the group and its children together.
    const setPortsVisible = (n, visible) => {g.findViewByCell(n)?.container.querySelectorAll('.x6-port-body').forEach(port => {port.style.visibility = visible;Array.prototype.forEach.call(port.children, ch => {ch.style.visibility = visible;});});};
    // The hover id is tracked even when the reveal is gated (hand tool, read
    // only) — after a tool switch back to select, or after a fromJSON replaced
    // every view, the cursor is stationary and no new mouseenter will fire.
    g.on('node:mouseenter', ({node: n}) => {hoveredRef.current = n.id;if (!latest.current.readOnly && (!chenPage || toolRef.current === 'select')) setPortsVisible(n, 'visible');});
    g.on('node:mouseleave', ({node: n}) => {if (hoveredRef.current === n.id) hoveredRef.current = null;setPortsVisible(n, 'hidden');});
    revealHoveredRef.current = () => {const id = hoveredRef.current;if (!id) return;if (latest.current.readOnly || (chenPage && toolRef.current !== 'select')) return;const n = g.getCellById(id);if (n) setPortsVisible(n, 'visible');};
    g.on('node:dblclick', () => {if (!chenPage) setPanel(true);});g.on('edge:dblclick', () => {if (!chenPage) setPanel(true);});
    // V5-R3 inline commit contract: a click on blank canvas or any cell first
    // commits the full draft and exits the editor (Result 6); a text/note tool
    // click on blank canvas places the shape at that world point (Result 1).
    g.on('blank:click', ({x, y}) => {
      // CHEN-STUDIO-011: consume the one-shot guard first — when a pan just
      // restored the selection, this trailing click keeps it instead of
      // cleaning. Select-mode blank clicks still clear the selection.
      const panJustRestored = panSelectionRestore;panSelectionRestore = false;
      if (inlineRef.current) finishInlineRef.current(inlineRef.current.text);
      if (chenPage && !latest.current.readOnly && (toolRef.current === 'text' || toolRef.current === 'note')) {
        const s = SHAPES.find(v => v.id === toolRef.current);if (s) add(s, {x, y});return;
      }
      if (panJustRestored) return;
      g.cleanSelection();setSelection([]);
    });
    g.on('cell:mousedown', () => {if (inlineRef.current) finishInlineRef.current(inlineRef.current.text);});g.on('scale', () => setZoom(Math.round(g.zoom() * 100)));
    counts();let view;try {view=JSON.parse(localStorage.getItem(`pdmaner.drawing.viewport.${doc.id}`));}catch(err){}
    if(view && Number.isFinite(view.zoom) && view.zoom>=.15 && view.zoom<=3){g.zoomTo(view.zoom);const scroller=g.scroller.widget?.container;if(scroller){scroller.scrollLeft=view.left || 0;scroller.scrollTop=view.top || 0;}}
    else if (g.getCells().length) g.zoomToFit({padding: 65, maxScale: 1});
    let spacePanning = false;
    // CHEN-STUDIO-011: a finished hand/Space pan restores the pre-pan
    // selection (see the Chen continuous block below); the trailing
    // blank:click must not wipe it again. One-shot flag: consumed by the
    // first blank:click or the next workspace mousedown.
    let panSelectionRestore = false;
    // UAT-009 Space contract: baseline already pans on Space+left-drag and a
    // bare press never moves the scroller, so panning itself is untouched here.
    // This adds only the missing boundaries: preventDefault on a bare press
    // (page scroll / button activation) and keyup/blur restore. Text fields
    // keep typing normal spaces via the editableTarget guard.
    const onSpaceDown = e => {
      if (e.code !== 'Space' || editableTarget(e.target)) return;
      e.preventDefault();
      if (spacePanning) return;
      spacePanning = true;
      g.enablePanning();
      // CHEN-STUDIO-011: panning and rubberband are mutually exclusive (root
      // cause in the tool effect below) — a pan gesture owns the blank press.
      if (chenPage) g.disableRubberband();
      host.current?.classList.add('pv-space-panning');
    };
    const onSpaceUp = e => {
      if (e.code !== 'Space' && e.type !== 'blur') return;
      if (!spacePanning) return;
      spacePanning = false;
      if (toolRef.current !== 'hand') {g.disablePanning();if (chenPage && !latest.current.readOnly) g.enableRubberband();}
      host.current?.classList.remove('pv-space-panning');
    };
    window.addEventListener('keydown', onSpaceDown);
    window.addEventListener('keyup', onSpaceUp);
    window.addEventListener('blur', onSpaceUp);
    // ---- V5-R3 Results 3/4: continuous canvas + no-jump viewport origin ----
    // The X6 scroller container is a fixed-px element sized once at init, so
    // host resizes never reach it on their own: without this observer the
    // canvas stops filling the workspace after a sidebar/window change.
    //
    // R3 rectification (field repro: content jumped 240px = left sidebar width
    // on pan-release): the ResizeObserver callback runs only AFTER the host
    // layout already changed, so computing the anchor from the OLD rect
    // (clientToLocal(lastHost.left, …)) reads the NEW origin mapping and the
    // pre-change world point is already lost. Correct order inside the
    // callback: the DOM moved but the scroller has not been resized yet, so
    // scroll offsets and the graph matrix are still the pre-change ones — the
    // world point under the CURRENT (new) wrap top-left IS the pre-change
    // scroller-origin world point. Anchor on that, resize, then pin it back to
    // its OLD screen position (lastHost top-left). The scroller's default
    // padding function keeps ~a full viewport of whitespace on every side, so
    // the scroll correction effectively never clamps; sidebar collapse and
    // restore are exact inverses. No auto-fit, no zoom change, no reset.
    let cleanupContinuous = null;
    const scrollerWidget = g.scroller?.widget;
    // NOTE: with the scroller addon, X6 MOVES the graph host inside the
    // scroller's fixed-px content element, so the host can no longer be used
    // to observe layout. The stable outer element is .pv-graph-wrap: its size
    // follows the workspace layout (sidebar/window/panel changes).
    if (chenPage && scrollerWidget && scrollerWidget.container && wrapRef.current) {
      const scEl = scrollerWidget.container;
      let lastHost = wrapRef.current.getBoundingClientRect();
      const compensate = () => {
        const wrapEl = wrapRef.current;
        if (!wrapEl || !graphRef.current) return;
        const nowRect = wrapEl.getBoundingClientRect();
        // Anchor BEFORE resizing the scroller: scroll/matrix are untouched by
        // the host move, so this is the pre-change scroller-origin world point.
        const anchor = g.clientToLocal(nowRect.left, nowRect.top);
        scrollerWidget.resize(wrapEl.clientWidth, wrapEl.clientHeight);
        const after = g.localToClient(anchor.x, anchor.y);
        const next = compensateScroll({scrollLeft: scEl.scrollLeft, scrollTop: scEl.scrollTop, afterX: after.x, afterY: after.y, targetX: lastHost.left, targetY: lastHost.top, maxLeft: scEl.scrollWidth - scEl.clientWidth, maxTop: scEl.scrollHeight - scEl.clientHeight});
        scEl.scrollLeft = next.left;
        scEl.scrollTop = next.top;
        lastHost = nowRect;
        updateWorkarea();
      };
      const ro = new ResizeObserver(() => compensate());
      ro.observe(wrapRef.current);
      // Result 4: actual pan drags (hand tool or Space+left-drag) temporarily
      // collapse library+inspector; release, window blur, pointercancel and Esc
      // restore them. X6 emits pan:start on MOUSEDOWN already, so the collapse
      // is armed at pan:start but only activates after the first real
      // displacement (a scroll change while armed): a bare click, a bare Space
      // press or holding still never collapses anything. abortPan also unbinds
      // X6's own body-bound pan handlers via stopPanning() — not just the
      // React flag — so a mid-pan Esc/blur cannot leave a zombie pan.
      let panning = false;
      let panArmed = null;
      // CHEN-STUDIO-011: X6's SelectionManager cleans the selection on
      // blank:mousedown (before pan:start could snapshot it), so the pre-pan
      // IDs are captured on a NATIVE capture-phase mousedown on the
      // workspace — guaranteed to run before X6's own handlers on the graph
      // container, unlike React 16's document-level synthetic capture. Only
      // blank-area left presses while pan is armed (hand tool or held Space)
      // qualify; cell/port drags keep their native selection behavior.
      let panSelIds = null;
      const panWrapEl = wrapRef.current;
      const onPanMousedown = e => {
        panSelectionRestore = false;
        panSelIds = null;
        if (e.button !== 0 || !e.target.closest || e.target.closest('[data-cell-id]')) return;
        if (toolRef.current !== 'hand' && !spacePanning) return;
        const cells = g.getSelectedCells();
        if (cells.length) panSelIds = cells.map(c => c.id);
      };
      panWrapEl.addEventListener('mousedown', onPanMousedown, true);
      const restorePanSelection = () => {
        if (!panSelIds) return;
        const cells = panSelIds.map(id => g.getCellById(id)).filter(Boolean);
        panSelIds = null;
        if (cells.length) {g.resetSelection(cells);panSelectionRestore = true;}
      };
      const onPanStart = () => {panArmed = {left: scEl.scrollLeft, top: scEl.scrollTop};};
      const activateIfMoved = () => {
        if (!panArmed || panning) return;
        // 3px threshold: press-jitter never collapses, a real drag does.
        if (Math.abs(scEl.scrollLeft - panArmed.left) + Math.abs(scEl.scrollTop - panArmed.top) >= 3) {panning = true;updatePanCollapse(true);}
      };
      const onPanStop = () => {panArmed = null;if (panning) {panning = false;updatePanCollapse(false);restorePanSelection();}else panSelIds = null;};
      const abortPan = () => {if (!panArmed && !panning) return;try {scrollerWidget.stopPanning();} catch (err) {}onPanStop();};
      scrollerWidget.on('pan:start', onPanStart);
      scrollerWidget.on('pan:stop', onPanStop);
      scEl.addEventListener('scroll', activateIfMoved);
      const onPanKeydown = e => {if (e.key === 'Escape') abortPan();};
      window.addEventListener('keydown', onPanKeydown);
      window.addEventListener('blur', abortPan);
      window.addEventListener('pointercancel', abortPan);
      // Result 3: the opt-in work-area indicator (content bbox + 160 margin)
      // follows zoom, pan, scroll and content changes imperatively.
      g.on('scale', updateWorkarea);
      g.on('translate', updateWorkarea);
      g.on('render:done', updateWorkarea);
      scEl.addEventListener('scroll', updateWorkarea);
      cleanupContinuous = () => {
        ro.disconnect();
        scrollerWidget.off('pan:start', onPanStart);
        scrollerWidget.off('pan:stop', onPanStop);
        window.removeEventListener('keydown', onPanKeydown);
        window.removeEventListener('blur', abortPan);
        window.removeEventListener('pointercancel', abortPan);
        panWrapEl.removeEventListener('mousedown', onPanMousedown, true);
        scEl.removeEventListener('scroll', activateIfMoved);
        g.off('scale', updateWorkarea);
        g.off('translate', updateWorkarea);
        g.off('render:done', updateWorkarea);
        scEl.removeEventListener('scroll', updateWorkarea);
      };
    }
    return () => {try {const scroller=g.scroller.widget?.container;localStorage.setItem(`pdmaner.drawing.viewport.${doc.id}`,JSON.stringify({zoom:g.zoom(),left:scroller?.scrollLeft || 0,top:scroller?.scrollTop || 0}));}catch(err){}
      cleanupContinuous?.();
      g.off('node:resizestart', resizeStart);g.off('node:resizing', resizing);g.off('node:resizeend', resizeEnd);
      window.removeEventListener('keydown', onSpaceDown);window.removeEventListener('keyup', onSpaceUp);window.removeEventListener('blur', onSpaceUp);
      window.removeEventListener('pdmaner-drawing-flush', flushDraft);window.removeEventListener('mouseup', flushDraft);window.removeEventListener('resize', repositionInline);
      scrollerContainer?.removeEventListener('scroll', repositionInline);
      muted.current = true;g.off();g.dispose();graphRef.current = null;hoveredRef.current = null;revealHoveredRef.current = null;};
  }, [doc.id, readOnly]);
  useEffect(() => {const g = graphRef.current;if (!g || failed.current || doc.canvasData === lastCanvas.current) return;
    const selectedIds = g.getSelectedCells().map(c => c.id);muted.current = true;g.cleanSelection();g.fromJSON({cells:displayCanvas(doc.canvasData).cells.map(decorate)});muted.current = false;lastCanvas.current = doc.canvasData;g.resetSelection(selectedIds.map(id => g.getCellById(id)).filter(Boolean));setCount(g.getNodes().length);showSourceLabels();
    // Re-projection replaced every cell view: re-hide the label being edited…
    applyEditingVisualRef.current?.(g, inlineRef.current?.id);
    // …and re-reveal ports of the still-hovered node (stationary cursor, no
    // fresh mouseenter) — the R3 field repro's rect-instead-of-magnet hit.
    revealHoveredRef.current?.();
  }, [doc.canvasData]);
  useEffect(() => {if (chenPage) return;graphRef.current?.drawBackground({color: doc.pageColor || '#fff'});}, [doc.pageColor, chenPage]);
  // Hand tool keeps panning enabled until switched back; the temporary space
  // shortcut yields to it on keyup so both inputs can coexist.
  // CHEN-STUDIO-011 rubberband×panning mutex (2026-10-25 GUI evidence): with
  // rubberband enabled, X6's onBlankMouseDown starts the rubberband for ANY
  // plain blank press (ModifierKey strict match passes because no modifiers
  // are configured) in parallel with the scroller pan; the selection addon's
  // delegated document mouseup then runs stopSelecting → reset AFTER the body
  // pan:stop restore and wipes the restored selection again. While a pan
  // gesture owns the canvas (hand tool or held Space) the rubberband stays
  // disabled, so the blank press only cleans — no rubberband state, no
  // trailing document-mouseup reset. On exit restore the initial
  // `rubberband: !readOnly` config; non-Chen canvases are untouched.
  const toolRef = useRef(tool);toolRef.current = tool;
  useEffect(() => {const g = graphRef.current;if (!g || !chenPage) return;if (tool === 'hand') {g.enablePanning();g.disableRubberband();}else if (!host.current?.classList.contains('pv-space-panning')) {g.disablePanning();if (!latest.current.readOnly) g.enableRubberband();}
    // Field repro: hover happened while panning with the hand tool (reveal
    // gated); switching back to select must restore ports under the cursor.
    if (tool === 'select') revealHoveredRef.current?.();}, [tool, chenPage]);
  // Result 3: refresh the work-area box when the indicator is toggled on.
  useEffect(() => {if (chenPage && showWorkArea) updateWorkarea();}, [showWorkArea, chenPage]);
  useEffect(() => {showSourceLabels();}, [source.entities, source.logicEntities, source.conceptEntities, source.diagrams, source.business]);
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !inline?.id) return;
    const hideText = () => {
      const cell = g.getCellById(inline.id);
      if (!cell) return;
      const view = g.findViewByCell(cell);
      if (view?.container) {
        view.container.classList.add('pv-cell-editing');
        const textEls = view.container.querySelectorAll('text');
        textEls.forEach(t => {
          t.style.visibility = 'hidden';
        });
      }
    };
    hideText();
    // UAT-009: a format-bar change while editing keeps targeting this label —
    // refresh font/color/box from the live (hidden) SVG text. One atomic
    // setInline: merge the font FIRST, then anchor on the SVG rect while the
    // size is re-measured from the untruncated draft (the SVG label is
    // textWrap-truncated; its bbox must never become the editor size again).
    const refreshInlineFromCell = cell => {
      const label = cell.attr('label') || {};
      const rect = g.findViewByCell(cell)?.container.querySelector('text')?.getBoundingClientRect();
      setInline(prev => {
        if (!prev || prev.id !== inline.id || !prev.chen || !prev.font) return prev;
        const font = {...prev.font,
          fontFamily: label.fontFamily || prev.font.fontFamily,
          fontSize: label.fontSize || prev.font.fontSize,
          color: label.fill || prev.font.color,
          fontWeight: label.fontWeight || 400,
          fontStyle: label.fontStyle || 'normal',
          lineHeight: label.lineHeight != null ? parseFloat(label.lineHeight) || prev.font.lineHeight : prev.font.lineHeight,
          letterSpacing: label.letterSpacing != null ? parseFloat(label.letterSpacing) || 0 : prev.font.letterSpacing};
        return rect ? applyChenPosition({...prev, font}, rect, g.zoom ? g.zoom() : 1) : {...prev, font};
      });
    };
    // Edit start: the dblclick seed used the (possibly truncated) SVG box —
    // re-measure immediately so long/multi-line labels get a sane editor size.
    const seedCell = g.getCellById(inline.id);
    if (seedCell) refreshInlineFromCell(seedCell);
    const onChangeAny = ({cell}) => {hideText();if (cell?.id === inline.id) refreshInlineFromCell(cell);};
    g.on('cell:change:*', onChangeAny);
    return () => {
      g.off('cell:change:*', onChangeAny);
      const cell = g.getCellById(inline.id);
      if (cell) {
        const view = g.findViewByCell(cell);
        if (view?.container) {
          view.container.classList.remove('pv-cell-editing');
          const textEls = view.container.querySelectorAll('text');
          textEls.forEach(t => {
            t.style.visibility = '';
          });
        }
      }
    };
  }, [inline?.id]);
  useEffect(() => {const g=graphRef.current;const cell=g?.getCellById(locateId?.id || locateId);if(cell){muted.current=true;[...(cell.getAncestors() || []),cell].forEach(c=>{if(!c.isVisible())temporaryReveal.current.add(c.id);});g.fromJSON({cells:displayCanvas(latest.current.doc.canvasData).cells.map(decorate)});muted.current=false;const shown=g.getCellById(cell.id);g.centerCell(shown);g.resetSelection([shown]);if (!chenPage) setPanel(true);applyEditingVisualRef.current?.(g, inlineRef.current?.id);}},[locateId,doc.id]);
  const bind = ref => {const asset = resolveAsset(source, ref);setData({assetRef: ref, unboundAsset: null, lastName: asset?.name || asset?.defName || asset?.defKey});showSourceLabels();};
  const selectionSnapshot = () => {const ids = new Set(selection.map(c => c.id));selectedNodes.forEach(n => n.getDescendants().forEach(c => ids.add(c.id)));graph.getEdges().forEach(e => {if (ids.has(e.getSourceCellId()) && ids.has(e.getTargetCellId())) ids.add(e.id);});return graph.getCells().filter(c => ids.has(c.id)).map(c => {const json = c.toJSON();if (json.parent && !ids.has(json.parent)) delete json.parent;return json;});};
  const copy = () => {if (selection.length) {drawingClipboard=chenPage&&selection.some(c=>c.getData()?.chen)?{chenPage:clone(chenPage),ids:selection.filter(c=>c.isNode()&&c.getData()?.chen).map(c=>c.id)}:selectionSnapshot();setCopied(drawingClipboard);}};
  const paste = () => {if (readOnly || !drawingClipboard)return;if(drawingClipboard.chenPage){if(onChenPaste)onChenPaste(drawingClipboard);else setError('Paste Chen objects into a Chen canvas');return;}mutate(() => {const cells = DrawingDocument.clonePage({scene:{cells:drawingClipboard}}).scene.cells.map(c => ({...c, position: c.position ? {x: c.position.x + 35, y: c.position.y + 35} : undefined}));
    const ids = new Set(cells.map(c => c.id));gAdd(cells.filter(c => c.shape !== 'edge' || (ids.has(c.source?.cell) && ids.has(c.target?.cell))));});};
  const gAdd = cells => {graph.addNodes(cells.filter(c => c.shape !== 'edge'));graph.addEdges(cells.filter(c => c.shape === 'edge'));graph.resetSelection(cells.map(c => graph.getCellById(c.id)).filter(Boolean));};
  const remove = () => {if(readOnly)return;if(chenPage&&selection.some(c=>c.getData()?.chen)){const ids=selection.map(c=>c.id.startsWith('owner:')?c.id.slice(6):c.id);const next=DrawingDocument.removeSemantic(chenPage,ids);const removed=DrawingDocument.semantic(chenPage).filter(n=>!DrawingDocument.semantic(next).some(v=>v.id===n.id));const roles=chenPage.erModel.relationships.reduce((n,r)=>n+r.roles.length,0)-next.erModel.relationships.reduce((n,r)=>n+r.roles.length,0);const comments=chenPage.comments.filter(c=>removed.some(n=>n.id===c.objectId)).length;if(!window.confirm(`${t('delete')}：${removed.map(n=>n.name || n.id).join(', ')}\n${en()?'Roles':'关联角色'} ${roles} · ${en()?'Comment anchors retained as deleted':'批注保留并标记锚点已删除'} ${comments}`))return;onChenEdit(page=>Object.assign(page,next));return;}mutate(()=>graph.removeCells(selection));};
  const exportGraph = format => {
    if (!graph || error.startsWith(t('loadFailed'))) return;
    try {
      if (format === 'json' && onExportDocument) {onExportDocument();return;}
      if (format === 'json') {download(`${doc.defName}.json`, JSON.stringify({format: 'pdmaner-drawing', version: 1, document: doc}, null, 2));return;}
      graph.cleanSelection();
      if (format === 'svg') graph.toSVG(svg => download(`${doc.defName}.svg`, svg, 'image/svg+xml'), {preserveDimensions: true, copyStyles: false});
      else graph.toPNG(uri => {const link = document.createElement('a');link.href = uri;link.download = `${doc.defName}.png`;link.click();}, {padding: 30, backgroundColor: doc.pageColor || '#fff', copyStyles: false});
    } catch (err) {setError(`${t('exportFailed')}: ${err.message}`);}
  };
  const customShapes = (source.drawings || []).reduce((a, d) => a.concat(d.customShapes || []), []);
  const makeGroup = () => mutate(() => {if (selectedNodes.length < 2) return;const boxes = selectedNodes.map(n => n.getBBox());const x = Math.min(...boxes.map(b => b.x)) - 20;const y = Math.min(...boxes.map(b => b.y)) - 35;const right = Math.max(...boxes.map(b => b.right)) + 20;const bottom = Math.max(...boxes.map(b => b.bottom)) + 20;const group = graph.addNode(shapeCell('container', t('group'), x, y, {width: right - x, height: bottom - y, data: {kind: 'container', container: true, layer: 'main', group: true}}));selectedNodes.forEach(n => group.addChild(n));graph.resetSelection([group]);});
  const distribute = (vertical=false) => mutate(() => {if (selectedNodes.length < 3) return;const key=vertical?'y':'x';const nodes=selectedNodes.slice().sort((a,b)=>a.position()[key]-b.position()[key]);const first=nodes[0].position()[key],last=nodes[nodes.length-1].position()[key];nodes.slice(1,-1).forEach((n,i)=>{const value=first+(last-first)*(i+1)/(nodes.length-1);n.position(vertical?n.position().x:value,vertical?value:n.position().y);});});
  const align = direction => mutate(() => {if(selectedNodes.length<2)return;const b=selectedNodes[0].getBBox();selectedNodes.slice(1).forEach(n=>{const r=n.getBBox();let x=r.x,y=r.y;if(direction==='left')x=b.x;if(direction==='right')x=b.x+b.width-r.width;if(direction==='center')x=b.x+(b.width-r.width)/2;if(direction==='top')y=b.y;if(direction==='bottom')y=b.y+b.height-r.height;if(direction==='middle')y=b.y+(b.height-r.height)/2;n.position(x,y);});});
  const imageInput = useRef(null);
  const addImage = async event => {const file=event.target.files?.[0];event.target.value='';if(!file||readOnly)return;try{if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error(t('fileTooLarge'));const images=new Set();const collect=v=>{if(typeof v==='string'&&/^data:image\/(png|jpeg|webp);base64,/i.test(v))images.add(v);else if(v&&typeof v==='object')Object.values(v).forEach(collect);};collect(latest.current.doc);const total=[...images].reduce((n,v)=>n+Math.floor((v.length-v.indexOf(',')-1)*.75),0);if(total+file.size>50*1024*1024)throw Error(t('fileTooLarge'));const uri=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=uri;});mutate(()=>{const cell=graph.addNode({id:platformId('image'),shape:'image',x:150,y:150,width:Math.min(480,image.width),height:Math.min(480,image.width)*image.height/image.width,data:{kind:'image',layer},attrs:{image:{'xlink:href':uri}}});graph.resetSelection([cell]);});}catch(err){setError(err.message);}};
  const openLink = cell => {const link=cell?.getData()?.link;if(!link||!/^https?:\/\/|^mailto:/i.test(link))return;if(window.confirm(link)){safeOpenExternal(link).then(opened=>{if(!opened)window.open(link,'_blank','noopener');});}};

  useEffect(() => {if (onCommands) onCommands({
    selection: () => selection.map(c => c.id),
    undo: history.undo, redo: history.redo, copy, paste, cut: () => {copy();remove();}, remove,
    duplicate: () => {copy();paste();},
    selectAll: () => graph?.select(graph.getCells()), fit: () => graph?.zoomToFit({padding:60,maxScale:1}),
    zoomIn: () => graph?.zoom(.1), zoomOut: () => graph?.zoom(-.1), actualSize: () => graph?.zoomTo(1),
    applyPaletteAll: () => mutate(() => graph.getNodes().forEach(n => {n.attr('body/fill',defaults['body/fill'] || '#e9f0fc');n.attr('body/stroke',defaults['body/stroke'] || '#3566af');})),
    align, distribute, distributeVertical: () => distribute(true), group: makeGroup, ungroup: () => mutate(() => selection.filter(n=>n.isNode()&&n.getData()?.group).forEach(n=>{(n.getChildren() || []).slice().forEach(c=>n.removeChild(c));graph.removeCell(n);})), front: () => mutate(() => selection.forEach(c => c.toFront())), back: () => mutate(() => selection.forEach(c => c.toBack())),
    lock: () => mutate(() => selection.forEach(c => c.setData({...c.getData(),locked:!c.getData()?.locked}))),
    equalWidth: () => mutate(() => selectedNodes.slice(1).forEach(n => n.resize(selectedNodes[0].size().width,n.size().height))),
    equalHeight: () => mutate(() => selectedNodes.slice(1).forEach(n => n.resize(n.size().width,selectedNodes[0].size().height))),
    image: () => imageInput.current?.click(), link: () => {if(node)setLinkDraft({id:node.id,value:node.getData()?.link || 'https://'});}, openLink: () => openLink(node),
    insertText: () => add(SHAPES.find(n => n.id === 'text')), insertNote: () => add(SHAPES.find(n => n.id === 'note')),
    copyStyle:()=>{if(!node){setError(en()?'Select one shape first':'请先选择一个图形');return;}styleClipboard.current=Object.fromEntries(['label/fontFamily','label/fontSize','label/fontWeight','label/fontStyle','label/textDecoration','label/fill','label/lineHeight','label/textAnchor','body/fill','body/stroke','body/strokeWidth','body/opacity'].map(key=>[key,node.attr(key)]).filter(([,value])=>value!==undefined));},
    pasteStyle:()=>{if(!styleClipboard.current){setError(en()?'Copy a shape style first':'请先复制一个图形的样式');return;}mutate(()=>selectedNodes.forEach(n=>{let styledClass=false;Object.entries(styleClipboard.current).forEach(([key,value])=>{n.attr(key,value);const attr=key.split('/')[1];if(n.shape==='pv-class'&&key.startsWith('label/')&&CLASS_TEXT_ATTRS.includes(attr)){styledClass=true;['fields','methods'].forEach(s=>n.attr(`${s}/${attr}`,value));}});if(styledClass)relayoutClassNode(n);}));},
    favoriteSelection:()=>{if(!selectedNodes.length||selection.some(c=>c.getData()?.chen)){setError(en()?'Select auxiliary shapes; Chen symbols can be starred in the library.':'请选择辅助图形；陈氏符号可在图形库中点星收藏。');return;}setShapeName(en()?'Favorite group':'收藏组合');setSaveShape('favorite');},
    saveShape: () => {if(selection.some(c=>c.getData()?.chen)){setError('请收藏陈氏图形定义或复制画布 / Favorite a Chen definition or duplicate its canvas');return;}if(!selection.length){setError(t('selectHint'));return;}setShapeName(t('myShape'));setSaveShape(true);}, insertReference: () => setPick(true), libraries: () => setLibraries(true),
    // V5-R3 on-demand inspector: Chen toggles the persisted open/closed mode
    // (auto follows selection); non-Chen keeps the legacy boolean panel.
    properties: () => {if (chenPage) changeInspectorMode(chenInspectorOpen ? 'closed' : 'open');else setPanel(p => !p);}, export: exportGraph,
    minimap: () => setShowMinimap(v=>!v),
    // V5-R3 Result 3: Chen grid toggle switches the CSS workspace dots; the X6
    // SVG grid stays hidden (no paper rectangle). Non-Chen keeps X6's grid.
    grid: visible => {if (chenPage) wrapRef.current?.classList.toggle('pv-chen-dots-off', !visible);else if(visible)graph?.showGrid();else graph?.hideGrid();}, snap: enabled => {if(enabled) graph?.enableSnapline();else graph?.disableSnapline();},
    find: query => {if(!graph)return 0;const ids=query.trim()?graph.getNodes().filter(n=>String(n.attr('label/text') || '').toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(n=>n.id):[];muted.current=true;temporaryReveal.current.clear();ids.forEach(id=>{const n=graph.getCellById(id);[...(n.getAncestors() || []),n].forEach(c=>{if(!c.isVisible())temporaryReveal.current.add(c.id);});});graph.cleanSelection();graph.fromJSON({cells:displayCanvas(latest.current.doc.canvasData).cells.map(decorate)});muted.current=false;applyEditingVisualRef.current?.(graph, inlineRef.current?.id);const found=ids.map(id=>graph.getCellById(id)).filter(Boolean);if(found.length){graph.resetSelection(found);graph.centerCell(found[0]);}return found.length;},
  });});
  useEffect(() => {const finish = () => {if (inline) finishInline(inline.text);};window.addEventListener('pdmaner-drawing-flush', finish);return () => window.removeEventListener('pdmaner-drawing-flush', finish);}, [inline]);
  // Shared HTML5 DnD handlers. Chen canvases receive drops on the whole visible viewport
  // wrapper (.pv-graph-wrap): the X6 scroller hosts the graph content inside .pv-graph-host,
  // so viewport areas outside that content node must still accept drops. Non-Chen canvases
  // keep the historical host-bound behavior. The handlers mount on exactly one element per
  // canvas kind, so one drop always has a single receiver and is handled exactly once.
  const dndHandlers = {
    onDragOver: e => {e.preventDefault();
      if (!chenPage || !ghostRef.current) return;
      // Drop hint: highlight the qualified owner under the cursor; the ghost is a plain
      // DOM overlay, so previews never touch the graph or the revision history.
      const point = graph.clientToLocal(e.clientX, e.clientY);
      highlightDropOwner(point);
      ghostRef.current.style.display = 'block';ghostRef.current.style.left = `${e.clientX + 10}px`;ghostRef.current.style.top = `${e.clientY + 12}px`;
    },
    onDragLeave: e => {if (!e.currentTarget.contains(e.relatedTarget)) clearDropHint();},
    onDrop: e => {e.preventDefault();clearDropHint();const s = SHAPES.find(a => a.id === e.dataTransfer.getData('application/pdmaner-shape'));if (!s || readOnly) return;
      const point = graph.clientToLocal(e.clientX, e.clientY);
      add(s, point, s.pack === 'chen' ? dropOwnerIdAt(point) : undefined);},
  };
  const viewportDnd = chenPage ? dndHandlers : {};
  const hostDnd = chenPage ? {} : dndHandlers;
  return <div className={`pv-editor pv-graph-editor${chenPage ? ' pv-chen-editor' : ''}${panCollapse ? ' pv-pan-collapse' : ''}`} data-tool={chenPage ? tool : undefined} tabIndex={0} onDoubleClickCapture={e => {const id = e.target.closest('[data-cell-id]')?.dataset.cellId;const cell = graph?.getCellById(id);if (!cell?.isNode()) return;const assetRef = cell.getData()?.assetRef;if (cell.getData()?.link) {openLink(cell);return;}if (assetRef) {onOpenAsset && onOpenAsset(assetRef);return;}if (readOnly) return;
    // Chen-only guard: inline editing must respect node and layer locks (projection
    // folds the owning layer's lock into data.locked); hidden objects are never editable.
    // Non-Chen canvases keep their historical double-click behavior.
    if (cell.getData()?.locked || !cell.isVisible()) return;
    if (chenPage && cell.getData()?.chen) {
      // Chen inline edit: position a transparent editor on the label itself, never a whole-cell box.
      const cellView = graph.findViewByCell(cell);
      cellView?.container.classList.add('pv-cell-editing');
      const textEl = cellView?.container.querySelector('text');
      const box = textEl ? textEl.getBoundingClientRect() : graph.localToClient(cell.getBBox());
      const label = cell.attr('label') || {};
      if (textEl) textEl.style.visibility = 'hidden';
      inlineClosed.current = false;
      // Chen edit session transaction: graph-local keystrokes until the single
      // end-of-session publish (see finishInline / publishRef above).
      muted.current = true;sessionDirty.current = false;
      const initialText = cell.attr('label/text') || '';
      const scale = graph.zoom ? graph.zoom() : 1;
      const font = {fontFamily: label.fontFamily || '-apple-system, PingFang SC, sans-serif', fontSize: label.fontSize || 14, color: label.fill || '#303746', fontWeight: label.fontWeight || 400, fontStyle: label.fontStyle || 'normal', textAlign: label.textAnchor === 'start' ? 'left' : label.textAnchor === 'end' ? 'right' : 'center', lineHeight: label.lineHeight ? parseFloat(label.lineHeight) || 1.25 : 1.25, letterSpacing: label.letterSpacing != null ? parseFloat(label.letterSpacing) || 0 : 0};
      // Seed size from the draft, not the textWrap-truncated SVG box (a long
      // label must open at full measured width; the effect re-anchors after).
      const seed = inlineBoxFor(initialText, {chen: true, scale, font, x: box.x - 4, width: Math.max(40, box.width + 8), text: initialText});
      setInline({id, initial: initialText, text: initialText, x: seed.x, y: box.y - 3, width: seed.width, height: Math.max(22, seed.height), chen: true, scale, font});
      return;
    }
    const cellView = graph.findViewByCell(cell);
    cellView?.container.classList.add('pv-cell-editing');
    const box = graph.localToClient(cell.getBBox());
    const textEl = cellView?.container.querySelector('text');
    if (textEl) textEl.style.visibility = 'hidden';
    inlineClosed.current = false;
    setInline({id, initial: cell.attr('label/text') || '', text: cell.attr('label/text') || '', x: box.x, y: box.y, width: Math.max(160, box.width), height: Math.max(58, Math.min(box.height, 130))});}} onKeyDown={e => {
    if (editableTarget(e.target)) return;
    // V5-R3: Esc clears the temporary pan-collapse state (Result 4) and leaves
    // a placement tool (text/note) back to select.
    if (chenPage && e.key === 'Escape') {
      if (panCollapse) {updatePanCollapse(false);return;}
      if (tool !== 'select') {e.preventDefault();setToolState('select');return;}
    }
    if ((e.metaKey || e.ctrlKey) && ['z', 'c', 'v', 'a', 'd', 'x'].includes(e.key.toLowerCase())) {e.preventDefault();e.stopPropagation();
      if (e.key.toLowerCase() === 'z' && !readOnly) {e.shiftKey ? history.redo() : history.undo();}
      if (e.key.toLowerCase() === 'd') {copy();paste();}if (e.key.toLowerCase() === 'x') {copy();remove();}if (e.key.toLowerCase() === 'c') copy();if (e.key.toLowerCase() === 'v') paste();if (e.key.toLowerCase() === 'a') graph?.select(graph.getCells());
    } else if(e.key==='+'||e.key==='='){e.preventDefault();graph?.zoom(.1);}else if(e.key==='-'){e.preventDefault();graph?.zoom(-.1);}else if (['Delete', 'Backspace'].includes(e.key)) {e.preventDefault();e.stopPropagation();remove();}
  }}>
    <input type='file' ref={imageInput} hidden accept='image/png,image/jpeg,image/webp' onChange={addImage}/>
    {/* V5-R3: the Chen library can be collapsed to a re-expandable strip
        (Result 4: permanently collapsed library must stay re-expandable). */}
    {chenPage && libraryCollapsed && <div className='pv-chen-libstrip'>
      <button type='button' aria-label={en() ? 'Expand shape library' : '展开资源库'} title={en() ? 'Expand shape library' : '展开资源库'} onClick={() => changeLibraryCollapsed(false)}>»</button>
    </div>}
    {!(chenPage && libraryCollapsed) && <><aside className='pv-sidebar' style={{width:libraryWidth,boxSizing:'border-box'}}><header><strong>{t('shapeLibrary')}</strong>{chenPage && <Action aria-label={en() ? 'Collapse shape library' : '收起资源库'} title={en() ? 'Collapse shape library' : '收起资源库'} onClick={() => changeLibraryCollapsed(true)}>‹</Action>}<Action onClick={() => setLibraries(true)}>＋</Action></header>
      {chenPage ? <ChenLibrary readOnly={readOnly} enabled={enabled} look={currentLook} onLookChange={setLook} selectionCount={selectedNodes.length} onApplySelected={applyLookSelected} onApplyCanvas={applyLookCanvas} onLayers={() => onAuxCommand?.('layers')} onAdd={add} favorites={favorites} onFavorite={favorite} favoriteComponents={favoriteComponents} onRemoveComponent={componentId => {try{const next=favoriteComponents.filter(c=>c.id!==componentId);localStorage.setItem('pdmaner.drawing.favoriteComponents',JSON.stringify(next));setFavoriteComponents(next);}catch(err){setError(err.message);}}} customShapes={customShapes} columns={libraryWidth < 220 ? 2 : 3}/>
      : <>
      <div className='pv-library-tabs'>{[['library',t('shapeLibrary')],['favorites','★'],['components',t('myShapes')]].map(([key,label])=><button type='button' key={key} aria-pressed={libraryTab===key} onClick={()=>setLibraryTab(key)}>{label}</button>)}</div>
      <div className='pv-palette-row'>{palettes.map(([stroke,fill])=><button type='button' key={stroke} style={{background:stroke}} aria-label={`Palette ${stroke}`} onClick={()=>setDefaults({...defaults,'body/fill':fill,'body/stroke':stroke})}/>)}<Action disabled={readOnly||!selectedNodes.length} title='Apply palette to selected objects' onClick={()=>mutate(()=>selectedNodes.forEach(n=>{n.attr('body/fill',defaults['body/fill'] || '#e9f0fc');n.attr('body/stroke',defaults['body/stroke'] || '#3566af');}))}>{t('use')}</Action></div>
      <input className='pv-shape-search' placeholder={t('searchShapes')} value={search} onChange={e => setSearch(e.target.value)} />
      {SHAPE_PACKS.filter(p => libraryTab!=='components' && (libraryTab==='favorites' || enabled.includes(p.id))).map(p => <section className='pv-shape-pack' key={p.id}><h3>{titleOf(p)}</h3><div className='pv-shapes'>{SHAPES.filter(s => s.pack === p.id && (libraryTab!=='favorites' || favorites.includes(s.id)) && `${s.name} ${s.en}`.toLowerCase().includes(search.toLowerCase())).map(s => <div key={s.id} className='pv-shape-tile'><button type='button' draggable={!readOnly} disabled={readOnly} title={titleOf(s)} onClick={() => add(s)} onDragStart={e => e.dataTransfer.setData('application/pdmaner-shape', s.id)}>
        <ShapeGlyph shape={s}/><span>{titleOf(s)}</span></button><button type='button' className='pv-favorite-shape' aria-label={`${favorites.includes(s.id)?'Unfavorite':'Favorite'} ${titleOf(s)}`} aria-pressed={favorites.includes(s.id)} onClick={()=>favorite(s.id)}>{favorites.includes(s.id)?'★':'☆'}</button></div>)}</div></section>)}
      {libraryTab==='favorites'&&favoriteComponents.map(component=><div className='pv-favorite-component' key={component.id}><Action disabled={readOnly} onClick={()=>addGroup(component)}>{component.name}</Action><Action aria-label={en()?'Remove favorite '+component.name:'移除收藏 '+component.name} onClick={()=>{try{const next=favoriteComponents.filter(c=>c.id!==component.id);localStorage.setItem('pdmaner.drawing.favoriteComponents',JSON.stringify(next));setFavoriteComponents(next);}catch(e){setError(e.message);}}}>×</Action></div>)}
      <section className='pv-shape-pack' hidden={libraryTab!=='components'}><h3>{t('myShapes')}</h3>{customShapes.map(s => <Action key={s.id} disabled={readOnly} onClick={() => addGroup(s)}>{s.name}</Action>)}{!customShapes.length && <p className='pv-note'>{t('myShapesHint')}</p>}</section>
      </>}
      <h3>{t('layers')}</h3>{['main', 'boundary', 'notes'].map(l => <div className='pv-layer' key={l}><button type='button' className={layer === l ? 'selected' : ''} onClick={() => setLayer(l)}>{t(l)}</button>
        <Action disabled={readOnly} title={t('toggleLayer')} onClick={() => mutate(() => {const nodes = graph.getNodes().filter(n => (n.getData()?.layer || 'main') === l);const hide = nodes.some(n => n.isVisible());nodes.forEach(n => {temporaryReveal.current.delete(n.id);hide ? n.hide() : n.show();});})}>◉</Action></div>)}
      <p className='pv-note'>{t('graphHint')}</p>
    </aside><ResizeHandle startWidth={libraryWidth} onWidth={v=>setLibraryWidth(Math.max(200,Math.min(320,v)))}/></>}
    <main className='pv-editor-main'>
      {/* V5-R3 Result 1: Chen pages drop the permanent top format bar — text
          formatting lives in the inspector 文字 tab, drawing tools in the bottom
          dock. Non-Chen canvases keep the legacy bar exactly as before. */}
      {!chenPage && <FormatBar selection={selection} onRanges={() => setTextRanges(node)} mutate={mutate} readOnly={readOnly} defaults={defaults} onDefault={(key,value) => setDefaults(prev => ({...prev, [key]: value}))}/>}
      <div className='pv-tools'>
        <Action disabled={readOnly || !history.canUndo} onClick={history.undo}>{t('undo')}</Action><Action disabled={readOnly || !history.canRedo} onClick={history.redo}>{t('redo')}</Action>
        <Action disabled={readOnly || !selection.length || selection.some(c => c.getData()?.chen)} onClick={() => {setShapeName(t('myShape'));setSaveShape(true);}}>{t('saveShape')}</Action><Action disabled={!selection.length} onClick={copy}>{t('copy')}</Action><Action disabled={readOnly || !copied} onClick={paste}>{t('paste')}</Action>
        <Action disabled={readOnly || !selection.length} onClick={remove}>{t('delete')}</Action><Action onClick={() => graph.zoomToFit({padding: 50, maxScale: 1})}>{t('fit')}</Action>
        <Action disabled={readOnly} onClick={() => setPick(true)}>{t('insertReference')}</Action><Action onClick={() => setPanel(!panel)}>{t('properties')}</Action>
        <span className='pv-export'>{['svg', 'png', 'json'].map(f => <Action key={f} onClick={() => exportGraph(f)}>{f.toUpperCase()}</Action>)}</span>
      </div>{error && <div role='alert' className='pv-error'>{error}<Action onClick={() => setError('')}>×</Action></div>}
      {/* Chen: the whole visible viewport accepts drops (see dndHandlers above); non-Chen
          canvases keep drop reception on the graph host exactly as before. */}
      <div className='pv-graph-wrap' ref={wrapRef} {...viewportDnd}>
        <div className='pv-graph-host' data-inline-editing={inline ? 'true' : undefined} ref={host} {...hostDnd}/>
        {chenPage && showWorkArea && <div className='pv-chen-workarea' ref={workareaRef} aria-hidden='true'><span>{en() ? `Work area · free canvas · ${zoom}%` : `工作区域 · 自由画布 · ${zoom}%`}</span></div>}
        <div className='pv-resize-badge' ref={sizeBadgeRef} aria-hidden='true'/>
        {/* V5-R3 R3 rectification 4: discoverable on-demand inspector entry at
            the workspace top-right (design feedback-r3/01) — with nothing
            selected it opens the panel on the new-shape defaults section, so
            font/color/typography defaults are reachable again after the
            permanent top format bar was dropped. Toggling writes the persisted
            open/closed mode (auto follows selection). */}
        {chenPage && !readOnly && <button type='button' className={`pv-chen-insp-toggle${chenInspectorOpen ? ' active' : ''}`} aria-pressed={chenInspectorOpen} title={chenInspectorOpen ? (en() ? 'Hide properties' : '收起属性栏') : (en() ? 'Show properties' : '展开属性栏')} onClick={() => changeInspectorMode(chenInspectorOpen ? 'closed' : 'open')}>{en() ? 'Properties' : '属性'}</button>}
      </div>
      {/* V5-R3 Result 1: fixed bottom tool dock — select/hand/text/note + undo/redo.
          No connect button (Result 5: direct port dragging is the default).
          Text/note are placement tools: pick the tool, click blank canvas. */}
      {chenPage && <div className='pv-chen-dock' role='toolbar' aria-label={en() ? 'Drawing tools' : '绘图工具'}>
        {[
          ['select', IconPointer, en() ? 'Select' : '选择', en() ? 'Select tool' : '选择工具'],
          ['hand', IconHand, en() ? 'Pan (drag canvas)' : '平移（拖动画布）', en() ? 'Hand (drag to pan)' : '手形工具（拖动平移）'],
          ['text', IconText, en() ? 'Text (click canvas to place)' : '文字（点击画布放置）', en() ? 'Text (click canvas to place)' : '文字工具：点击画布放置'],
          ['note', IconNote, en() ? 'Note (click canvas to place)' : '便笺（点击画布放置）', en() ? 'Note (click canvas to place)' : '便笺工具：点击画布放置'],
        ].map(([key, Icon, label, title]) => (
          <button key={key} type='button' className={`pv-dock-btn${tool === key ? ' active' : ''}`} title={title} aria-label={label} aria-pressed={tool === key} disabled={readOnly && key !== 'select' && key !== 'hand'} onClick={() => setToolState(key)}><Icon size={17}/></button>
        ))}
        <span className='pv-dock-sep' aria-hidden='true'/>
        <button type='button' className='pv-dock-btn' disabled={readOnly || !history.canUndo} title={en() ? 'Undo' : '撤销'} aria-label={en() ? 'Undo' : '撤销'} onClick={history.undo}><IconUndo size={17}/></button>
        <button type='button' className='pv-dock-btn' disabled={readOnly || !history.canRedo} title={en() ? 'Redo' : '重做'} aria-label={en() ? 'Redo' : '重做'} onClick={history.redo}><IconRedo size={17}/></button>
      </div>}
      {chenPage && <div className='pv-drop-ghost' ref={ghostRef} aria-hidden='true'/>}
      <div className='pv-minimap' ref={minimapHost} style={{display:showMinimap?'block':'none'}} aria-label='Minimap'/>
      {chenPage ? <div className='pv-chen-zoomdock' role='toolbar' aria-label={en() ? 'Zoom' : '缩放'}>
        <button type='button' onClick={() => graph?.zoom(-0.1)} aria-label={en() ? 'Zoom out' : '缩小'}>−</button>
        <span>{zoom}%</span>
        <button type='button' onClick={() => graph?.zoom(0.1)} aria-label={en() ? 'Zoom in' : '放大'}>＋</button>
        <button type='button' className='pv-zoom-fit' onClick={() => graph?.zoomToFit({padding: 50, maxScale: 1})} aria-label={en() ? 'Fit canvas' : '适应画布'}><IconFit size={13}/></button>
        <button type='button' className={`pv-zoom-workarea${showWorkArea ? ' active' : ''}`} aria-pressed={showWorkArea} title={en() ? 'Toggle work area boundary' : '切换工作区域边界'} aria-label={en() ? 'Toggle work area boundary' : '切换工作区域边界'} onClick={() => setShowWorkArea(v => !v)}>{en() ? '⬚' : '⬚'}</button>
      </div> : <footer className='pv-editor-status'><span>{titleOf(type)} · {count} {t('nodes')} · {selection.length} {t('selected')}{chenPage ? ` · ${en() ? 'free canvas' : '自由画布'}` : ''}</span><span>{chenPage && <Action aria-pressed={showWorkArea} onClick={() => setShowWorkArea(v => !v)}>{en() ? 'Work area' : '工作区域'}{showWorkArea ? ' ✓' : ''}</Action>} <Action onClick={() => graph.zoom(-0.1)}>−</Action> {zoom}% <Action onClick={() => graph.zoom(0.1)}>＋</Action> · {readOnly ? t('readOnly') : t('saveHint')}</span></footer>}
    </main>
    {/* V5-R3: on-demand Chen inspector (Result 1) — auto mode follows the
        selection, explicit open/closed persists. Non-Chen keeps the boolean. */}
    {chenPage ? (chenInspectorOpen && <>
      <ResizeHandle side='right' startWidth={sideWidth} onWidth={v => setSideWidth(Math.max(244, Math.min(360, v)))} />
      <ChenInspector node={node} edge={edge} selection={selection} chenPage={chenPage} readOnly={readOnly} mutate={mutate} onChenEdit={onChenEdit} pageLayers={doc.pageLayers} currentLook={currentLook} editingId={inline?.chen ? inline.id : null} onAlign={align} onDistribute={vertical => distribute(vertical)} width={sideWidth} onClose={() => changeInspectorMode('closed')} onRanges={node ? () => setTextRanges(node) : undefined} defaults={defaults} onDefault={(key, value) => setDefaults(prev => ({...prev, [key]: value}))}/>
    </>) : (panel && <><ResizeHandle side='right' startWidth={sideWidth} onWidth={v => setSideWidth(Math.max(260, Math.min(v, 440)))} /><aside className='pv-inspector' style={{width: sideWidth}}><header><strong>{t('properties')}</strong><Action onClick={() => setPanel(false)}>×</Action></header>
      {node ? <>
        <h3>{t('nodeProperties')}</h3><Field label={t('name')}><textarea value={node.attr('label/text') || ''} disabled={readOnly || Boolean(data.assetRef)} onChange={e => mutate(() => node.attr('label/text', e.target.value))} /></Field>
        {!data.chen&&doc.pageLayers&&<Field label={t('layers')}><select disabled={readOnly} value={data.layer || doc.pageLayers[0].id} onChange={e=>setData({layer:e.target.value})}>{doc.pageLayers.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}
        {chenPage && data.chen && <ChenProperties page={chenPage} selectedId={node.id} readOnly={readOnly} onEdit={onChenEdit} />}
        {['class', 'interface', 'enum'].includes(data.kind) && <ClassMembers data={data} readOnly={readOnly} onChange={members => mutate(() => {node.setData({...data, classMembers: members}, {overwrite: true});node.attr('fields/text', memberText(members.attributes));node.attr('methods/text', memberText(members.operations, true));relayoutClassNode(node);})} />}
        <div className='pv-field-row'><Field label={t('fill')}><input type='color' disabled={readOnly} value={colorValue(node.attr('body/fill'), '#ffffff')} onChange={e => mutate(() => node.attr('body/fill', e.target.value))} /></Field><Field label={t('stroke')}><input type='color' disabled={readOnly} value={colorValue(node.attr('body/stroke'), '#7086a7')} onChange={e => mutate(() => node.attr('body/stroke', e.target.value))} /></Field></div>
        <div className='pv-field-row'><Field label={en()?'Opacity':'不透明度'}><input type='number' min='0' max='1' step='.1' disabled={readOnly} value={node.attr('body/opacity') == null?1:node.attr('body/opacity')} onChange={e=>mutate(()=>node.attr('body/opacity',Math.max(0,Math.min(1,Number(e.target.value)))))}/></Field><Field label={en()?'Outline':'边框线型'}><select title={data.chen?(en()?'Chen symbols retain semantic outlines':'陈氏图形保留语义线型'):undefined} disabled={readOnly||Boolean(data.chen)} value={node.attr('body/strokeDasharray')?'dashed':'solid'} onChange={e=>mutate(()=>node.attr('body/strokeDasharray',e.target.value==='dashed'?'5 4':''))}><option value='solid'>{en()?'Solid':'实线'}</option><option value='dashed'>{en()?'Dashed':'虚线'}</option></select></Field></div>
        <Field label={en()?'Corner radius':'圆角'}><input type='number' min='0' max='50' title={en()?'Rectangles only; semantic outlines are protected':'仅普通矩形可用，语义轮廓受保护'} disabled={readOnly||Boolean(data.chen)||node.shape!=='rect'} value={node.attr('body/rx') || 0} onChange={e=>mutate(()=>{const value=Math.max(0,Math.min(50,Number(e.target.value)));node.attr('body/rx',value);node.attr('body/ry',value);})}/></Field>
        <div className='pv-field-row'>{['width', 'height'].map(k => <Field key={k} label={t(k)}><input type='number' min='40' max='2000' disabled={readOnly} value={Math.round(node.size()[k])} onChange={e => {const v = Math.max(40, Math.min(2000, Number(e.target.value)));mutate(() => node.resize(k === 'width' ? v : node.size().width, k === 'height' ? v : node.size().height));}} /></Field>)}</div>
        <Field label={t('fontSize')}><input type='number' min='8' max='48' disabled={readOnly} value={node.attr('label/fontSize') || 14} onChange={e => mutate(() => {const v = Math.max(8, Math.min(48, Number(e.target.value)));node.attr('label/fontSize', v);if (node.shape === 'pv-class') {['fields', 'methods'].forEach(s => node.attr(`${s}/fontSize`, v));relayoutClassNode(node);}})} /></Field>
        <Field label={t('parent')}><select disabled={readOnly} value={node.getParentId() || ''} onChange={e => mutate(() => {const p = graph.getCellById(e.target.value);node.getParent()?.removeChild(node);if (p && !node.isAncestorOf(p)) p.addChild(node);})}><option value=''>{t('none')}</option>{graph.getNodes().filter(n => n.id !== node.id && n.getData()?.container && !node.isAncestorOf(n)).map(n => <option key={n.id} value={n.id}>{n.attr('label/text')}</option>)}</select></Field>
        {data.group && <Action disabled={readOnly} onClick={() => mutate(() => {(node.getChildren() || []).slice().forEach(c => node.removeChild(c));graph.removeCell(node);})}>{t('ungroup')}</Action>}
        <Action disabled={readOnly} onClick={() => mutate(() => node.toFront())}>{t('bringFront')}</Action><Action disabled={readOnly} onClick={() => mutate(() => node.toBack())}>{t('sendBack')}</Action>
        <Action disabled={readOnly} onClick={() => setData({locked: !data.locked})}>{t(data.locked ? 'unlock' : 'lock')}</Action>
        {type.id === 'architecture' && <><Field label={t('componentType')}><input disabled={readOnly} value={data.technology || ''} placeholder='PostgreSQL / Redis / API' onChange={e => setData({technology: e.target.value})} /></Field><Field label={t('protocol')}><input disabled={readOnly} value={data.protocol || ''} onChange={e => setData({protocol: e.target.value})} /></Field></>}
        <ReferenceDetails source={source} assetRef={data.assetRef} lastName={data.lastName} unboundAsset={data.unboundAsset} collections={node.shape === 'pv-embed' ? ['diagrams'] : MODEL_COLLECTIONS.filter(c => c !== 'diagrams')} readOnly={readOnly} onBind={bind} onUnbind={() => mutate(() => {const asset = resolveAsset(source, data.assetRef);node.setData({...data, assetRef: null, unboundAsset: null}, {overwrite: true});node.attr('label/text', asset?.name || asset?.defName || data.lastName || '');node.attr('body/stroke', '#7086a7');})} onOpen={onOpenAsset} onLocate={onLocate} onSnapshot={() => {
          const asset = resolveAsset(source, data.assetRef);mutate(() => {node.setData({...data, assetRef: null, referenceMode: 'snapshot', unboundAsset: null}, {overwrite: true});node.attr('label/text', asset?.name || asset?.defName || data.lastName || '');node.attr('body/stroke', '#7086a7');});
        }} />
        {data.assetRef?.objectType === 'diagrams' && <p className='pv-note'>{t('embedHint')}</p>}
      </> : edge?.getData()?.chen ? <><h3>{en()?'Chen connection':'陈氏语义连线'}</h3>{edge.id.startsWith('role:')?<ChenProperties page={chenPage} selectedId={chenPage.erModel.relationships.find(r=>r.roles.some(v=>`role:${v.id}`===edge.id))?.id} readOnly={readOnly} onEdit={onChenEdit}/>:<p className='pv-note'>{en()?'This line represents attribute ownership. Select the attribute to change its owner.':'此连线表示属性所属关系。请选中属性修改所属对象。'}</p>}</> : edge ? <><h3>{t('edgeProperties')}</h3>{['source', 'target'].map(k => <Field label={t(k === 'source' ? 'from' : 'to')} key={k}><select value={k === 'source' ? edge.getSourceCellId() : edge.getTargetCellId()} disabled={readOnly} onChange={e => mutate(() => {const n = graph.getCellById(e.target.value);const port = n?.getPorts().find(p => p.group === (k === 'source' ? 'right' : 'left'))?.id;edge[k === 'source' ? 'setSource' : 'setTarget']({cell: n.id, ...(port ? {port} : {})});})}>{graph.getNodes().filter(n => !n.getData()?.container).map(n => <option key={n.id} value={n.id}>{n.attr('label/text')}</option>)}</select></Field>)}<Field label={t('name')}><input disabled={readOnly} value={edge.getLabels()[0]?.attrs?.label?.text || ''} onChange={e => mutate(() => edge.setLabels([{attrs: {label: {text: e.target.value}}}]))} /></Field>
        <Field label={t('relation')}><select aria-label={t('relation')} value={edge.getData()?.relation || 'flow'} disabled={readOnly} onChange={e => mutate(() => {const def = edgeCell(edge.getSourceCellId(), edge.getTargetCellId(), '', e.target.value);edge.setData(def.data);edge.setAttrs(def.attrs);})}>{relations.map(r => <option key={r} value={r}>{t(r)}</option>)}</select></Field>
        {['uml-class', 'er-sketch'].includes(type.id) && ['sourceCardinality', 'targetCardinality'].map((k, i) => <Field key={k} label={t(k)}><input disabled={readOnly} value={edge.getData()?.[k] || ''} onChange={e => mutate(() => {const d = {...edge.getData(), [k]: e.target.value};edge.setData(d, {overwrite: true});const central = edge.getLabels().filter(l => !l.cardinality);edge.setLabels([...central, ...['sourceCardinality', 'targetCardinality'].filter(key => d[key]).map(key => ({cardinality: key, position: {distance: key === 'sourceCardinality' ? .15 : .85, offset: -15}, attrs: {label: {text: d[key]}}}))]);})} /></Field>)}
        <Field label={t('stroke')}><input type='color' value={colorValue(edge.attr('line/stroke'), '#7d90ab')} disabled={readOnly} onChange={e => mutate(() => edge.attr('line/stroke', e.target.value))} /></Field>
        <Field label={en()?'Line pattern':'线型'}><select disabled={readOnly} value={edge.attr('line/strokeDasharray')?'dashed':'solid'} onChange={e=>mutate(()=>edge.attr('line/strokeDasharray',e.target.value==='dashed'?'5 4':''))}><option value='solid'>{en()?'Solid':'实线'}</option><option value='dashed'>{en()?'Dashed':'虚线'}</option></select></Field><Field label={en()?'End arrow':'终点箭头'}><select disabled={readOnly} value={edge.attr('line/targetMarker')?.name || 'none'} onChange={e=>mutate(()=>edge.attr('line/targetMarker',e.target.value==='none'?null:{name:e.target.value,size:8}))}><option value='none'>{en()?'None':'无'}</option><option value='classic'>{en()?'Arrow':'箭头'}</option><option value='block'>{en()?'Triangle':'三角'}</option><option value='diamond'>{en()?'Diamond':'菱形'}</option></select></Field><Field label={t('router')}><select disabled={readOnly} value={edge.getRouter()?.name || 'normal'} onChange={e => mutate(() => edge.setRouter(e.target.value))}><option value='manhattan'>{t('orthogonal')}</option><option value='normal'>{t('straight')}</option></select></Field>
      </> : selection.length > 1 ? <><h3>{t('multiSelection')}</h3><Action disabled={readOnly} onClick={() => align('left')}>{t('alignLeft')}</Action><Action disabled={readOnly} onClick={() => align('top')}>{t('alignTop')}</Action><Action disabled={readOnly || selectedNodes.length < 3} onClick={distribute}>{t('distribute')}</Action><Action disabled={readOnly || selectedNodes.length < 2} onClick={makeGroup}>{t('group')}</Action></> : <><h3>{t('pageProperties')}</h3><Field label={t('background')}><input type='color' disabled={readOnly} value={doc.pageColor || '#ffffff'} onChange={e => {graph.drawBackground({color: e.target.value});changeMeta({pageColor: e.target.value});}} /></Field><p className='pv-note'>{t('selectHint')}</p>{doc.diagramType === 'er-sketch' && <p className='pv-note'>{t('erHint')}</p>}</>}
    </aside></>)}
    {textRanges && <TextRanges cell={textRanges} readOnly={readOnly} onClose={() => setTextRanges(null)} onChange={next => mutate(() => {const cell=graph.getCellById(textRanges.id);cell.attr('label/text',next.text);cell.attr('label/annotations',next.annotations);})}/>}
    {inline && <textarea autoFocus wrap={inline.chen ? 'off' : undefined} className={`pv-inline-label${inline.chen ? ' pv-inline-chen' : ''}`} aria-label={t('editLabel')} style={{left: inline.x, top: inline.y, width: inline.width, height: inline.height, ...(inline.chen && inline.font ? {fontFamily: inline.font.fontFamily, fontSize: inline.font.fontSize * (inline.scale || 1), color: inline.font.color, fontWeight: inline.font.fontWeight, fontStyle: inline.font.fontStyle, textAlign: inline.font.textAlign, lineHeight: Math.max(1, inline.font.lineHeight || 1.25), letterSpacing: `${(inline.font.letterSpacing || 0) * (inline.scale || 1)}px`} : {})}} value={inline.text} onCompositionStart={() => {composing.current = true;}} onCompositionEnd={e => {composing.current = false;const box = inlineBoxFor(e.currentTarget.value, inline);setInline({...inline, text: e.currentTarget.value, width: box.width, x: box.x, height: box.height});}} onChange={e => {const box = inlineBoxFor(e.target.value, inline);setInline({...inline, text: e.target.value, width: box.width, x: box.x, height: box.height});const cell=graph?.getCellById(inline.id);if(!composing.current){if (inline.chen) cell?.attr('label/text', e.target.value);else mutate(() => cell?.attr('label/text', e.target.value));}}} onBlur={e => finishInline(e.target.value)} onKeyDown={e => {e.stopPropagation();
      // Chen-only IME guard: while composing, Enter/Esc belong to the input method —
      // never submit, close or roll back. Synthetic composition events carry neither
      // isComposing nor keyCode 229, so composing.current is the authoritative guard for
      // Chen; the native checks below still cover real IME keydowns. Non-Chen editors
      // keep their historical keyboard behavior. onChange skips mutate while composing,
      // so half-composed syllables never reach the model; compositionend commits the text.
      if (composing.current && (e.key === 'Enter' || e.key === 'Escape')) return;
      if (e.key === 'Escape') {e.preventDefault();inlineClosed.current = true;const cell=graph?.getCellById(inline.id);const cellView=cell&&graph.findViewByCell(cell);cellView?.container.classList.remove('pv-cell-editing');const textEl=cellView?.container.querySelector('text');if(textEl)textEl.style.visibility='';
        // Chen cancel restores the pre-session label visually only — the draft
        // never reached the document, so no history entry and nothing to undo.
        // Style edits made mid-session are real changes, not drafts: they get
        // their single publish here (a pure text cancel still publishes zero).
        if (inline.chen) {cell?.attr('label/text', inline.initial);muted.current = false;if (sessionDirty.current) {sessionDirty.current = false;publishRef.current?.();}}
        else mutate(() => cell?.attr('label/text', inline.initial));
        setInline(null);}else if (inline.chen && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {e.preventDefault();finishInline(e.target.value);}else if (!inline.chen && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {e.preventDefault();finishInline(e.target.value);}}} />}
    {linkDraft&&<Dialog title={en()?'Set link':'设置链接'} onClose={()=>setLinkDraft(null)}><div className='pv-picker'><Field label='https:// / mailto:'><input autoFocus aria-label={en()?'Link address':'链接地址'} value={linkDraft.value} onChange={e=>setLinkDraft({...linkDraft,value:e.target.value})}/></Field><Action primary disabled={readOnly} onClick={()=>{const value=linkDraft.value.trim();if(value&&!/^(https?:\/\/|mailto:)/i.test(value)){setError(en()?'Invalid URL':'仅支持 http、https 或 mailto 链接');return;}mutate(()=>{const cell=graph.getCellById(linkDraft.id);if(cell)cell.setData({...cell.getData(),link:value});});setLinkDraft(null);}}>{t('confirm')}</Action></div></Dialog>}
    {saveShape && <Dialog title={saveShape==='favorite'?(en()?'Favorite shapes':'收藏图形'):t('saveShape')} onClose={() => setSaveShape(false)}><div className='pv-picker'><Field label={t('name')}><input value={shapeName} onChange={e => setShapeName(e.target.value)} /></Field><p className='pv-note'>{t('savedShapeHint')}</p><Action primary disabled={readOnly || !shapeName.trim()} onClick={() => {const chosen = new Set(selection.map(c => c.id));selection.filter(c => c.isNode()).forEach(n => n.getDescendants().forEach(c => chosen.add(c.id)));graph.getEdges().forEach(e => {if (chosen.has(e.getSourceCellId()) && chosen.has(e.getTargetCellId())) chosen.add(e.id);});const cells = graph.getCells().filter(c => chosen.has(c.id)).map(c => c.toJSON());const component={id:platformId('shape'),name:shapeName.trim(),cells:copyWithIds(cells)};if(saveShape==='favorite'){try{const next=[...favoriteComponents,component];localStorage.setItem('pdmaner.drawing.favoriteComponents',JSON.stringify(next));setFavoriteComponents(next);setLibraryTab('favorites');}catch(e){setError(en()?'Favorite storage is full. Export or remove an older favorite.':'本机收藏空间不足，请导出或删除旧收藏。');return;}}else changeMeta({customShapes:[...(doc.customShapes || []),component]});setSaveShape(false);}}>{t('confirm')}</Action></div></Dialog>}
    {libraries && <Dialog title={t('shapeLibrary')} onClose={() => setLibraries(false)}><div className='pv-picker'>{SHAPE_PACKS.map(p => <label className='pv-pack-option' key={p.id}><input type='checkbox' disabled={readOnly} checked={enabled.includes(p.id)} onChange={e => changeMeta({enabledPacks: e.target.checked ? [...enabled, p.id] : enabled.filter(x => x !== p.id)})} />{titleOf(p)}</label>)}</div></Dialog>}
    {pick && <AssetPicker source={source} onClose={() => setPick(false)} onChoose={ref => {if (!readOnly && graph) {const asset = resolveAsset(source, ref);const c = shapeCell('rect', asset?.name || asset?.defName || asset?.defKey);if (ref.objectType === 'diagrams') {c.shape = 'pv-embed';c.width = 450;c.height = 290;c.attrs = {...c.attrs, label: {...c.attrs.label, refX: 15, refY: 22, textAnchor: 'start', textWrap: null}, preview: {'xlink:href': diagramPreview(source, asset)}};}c.data = {...c.data, assetRef: ref, referenceMode: ref.objectType === 'diagrams' ? 'embed' : 'reference', lastName: asset?.name || asset?.defName || asset?.defKey};graph.resetSelection([graph.addNode(c)]);if (!chenPage) setPanel(true);showSourceLabels();}setPick(false);}} />}
  </div>;
};

export {register as registerPlatformShapes, decorate as decoratePlatformCell};
