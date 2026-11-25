import React, {useEffect, useRef, useState, useMemo} from 'react';
import DrawingDocument from '../../../../public/drawing-document';
import {validateDrawing, treeFind} from '../../../lib/drawing_platform';
import {drawingPersistence} from '../../../lib/drawing_persistence';
import {getAiRuntime} from '../../../app/ai/integration/aiRuntime';
import DrawingAiPanel from '../../../app/ai/integration/DrawingAiPanel';
import GraphEditor from './GraphEditor';
import GraphThumbnail from './GraphThumbnail';
import TreeEditor from './TreeEditor';
import SequenceEditor from './SequenceEditor';
import PageExport from './PageExport';
import LegacyUpgrade from './LegacyUpgrade';
import {Action, Dialog, Field, t, en, download, exportVector, useDocumentHistory, humanError} from './common';
import {MENU_ICONS, IconHistory, IconMore, IconExport, IconLayers, IconExport as IconChevronSub} from './icons';

// Chen menu submenu row (e.g. 导出当前画布 ›, 保存与恢复 ›): opens on hover or
// click, renders items in a nested panel with the same icon/shortcut contract.
const ChenSubmenu = ({item, onCommand, shortcuts, readOnly}) => {
  const [open, setOpen] = useState(false);
  const [, zh, english, items] = item;
  const label = en() ? english : zh;
  const SubIcon = MENU_ICONS[item[0].slice(1)] || IconChevronSub;
  return <div className={`pv-menu-subwrap${open ? ' open' : ''}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type='button' role='menuitem' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span className='pv-menu-item-icon' aria-hidden='true'><SubIcon size={16}/></span>
      <span className='pv-menu-item-text'>{label}</span>
      <span className='pv-menu-sub-arrow' aria-hidden='true'>›</span>
    </button>
    {open && <div className='pv-submenu' role='menu'>
      {items.map(([action, z, e]) => {
        const Icon = MENU_ICONS[action];
        const shortcut = shortcuts[action];
        return <button type='button' role='menuitem' key={action} disabled={readOnly && action === 'save'}
          onClick={() => {setOpen(false);onCommand(action);}}>
          <span className='pv-menu-item-icon' aria-hidden='true'>{Icon ? <Icon size={16}/> : null}</span>
          <span className='pv-menu-item-text'>{en() ? e : z}</span>
          {shortcut && <kbd className='pv-menu-shortcut' aria-hidden='true'>{shortcut}</kbd>}
        </button>;
      })}
    </div>}
  </div>;
};

export default ({doc: original, onChange, onBack, readOnly, source, onOpenAsset, onLocate, locateId, onCreateDrawing, onToggleTheme, onNew, onTemplate, onImport, onDuplicate}) => {
  const doc = useMemo(() => original.schemaVersion === 2 ? original : DrawingDocument.upgrade(original), [original]);
  const latest=useRef(doc);latest.current=doc;const commands=useRef({});
  const history=useDocumentHistory(doc,next=>{latest.current=next;return onChange(next);},readOnly);
  const [active,setActive]=useState(()=>{try{return localStorage.getItem(`pdmaner.drawing.page.${doc.id}`) || doc.pages[0].id;}catch(e){return doc.pages[0].id;}});
  const p=doc.pages.find(v=>v.id===active) || doc.pages[0];const chen=DrawingDocument.isChen(doc);
  const [exporting,setExporting]=useState(false),[upgrading,setUpgrading]=useState(false);
  const [error,setError]=useState(''),[aux,setAux]=useState(''),[menu,setMenu]=useState(''),[rename,setRename]=useState(null),[name,setName]=useState('');
  const [saveState,setSaveState]=useState(drawingPersistence.getState()),[versions,setVersions]=useState([]),[preview,setPreview]=useState(null),[commentEditing,setCommentEditing]=useState(null),[comment,setComment]=useState(''),[commentLocate,setCommentLocate]=useState(null),[query,setQuery]=useState('');
  const [grid,setGrid]=useState(true),[snap,setSnap]=useState(true),[versionName,setVersionName]=useState(null),[findCount,setFindCount]=useState(null),[repairing,setRepairing]=useState(false);
  // AI 辅助层平移隐藏：GraphEditor 真实平移（>=3px 滚动累计）时临时隐藏 AI
  // 面板（不卸载对话、不触发请求/写入），释放即恢复
  const [aiPanHidden,setAiPanHidden]=useState(false);
  // R2 候选主画布临时投影（msg_28850767e7a3）：DrawingAiPanel 上报审阅中的候选
  // 文档；投影为只读 GraphEditor（复用 Chen 投影），原画布保活只隐藏——原页/
  // 选区/视口原样，关闭/返回即恢复。候选不改 original/latest/history/drawings/
  // 自动保存；确认应用仍走 GATEWAY 单次 history.apply。
  const [aiCandidate,setAiCandidate]=useState(null);
  const [aiCandidatePreviewOn,setAiCandidatePreviewOn]=useState(false);
  const aiCandidateSeen=useRef(null);
  useEffect(()=>{if(aiCandidate!==aiCandidateSeen.current){aiCandidateSeen.current=aiCandidate;setAiCandidatePreviewOn(Boolean(aiCandidate&&DrawingDocument.isChen(aiCandidate.document)));}},[aiCandidate]);
  // UI-R2：候选投影按真实受影响页选择——deriveCandidatePreview 携带 GATEWAY
  // 按操作顺序收集的 affectedPages；createPage 把内容放第二页时投影目标页，
  // 不再固定 pages[0] 预览旧空页。找不到受影响页（历史候选）回退第一页。
  const aiCandidateAffectedPages=aiCandidate&&Array.isArray(aiCandidate.affectedPages)?aiCandidate.affectedPages:[];
  const aiCandidatePage=aiCandidate&&DrawingDocument.isChen(aiCandidate.document)
    ?((aiCandidate.document.pages||[]).find(page=>aiCandidateAffectedPages.includes(page.id))||aiCandidate.document.pages[0]||null)
    :null;
  const aiCandidateCanvas=useMemo(()=>aiCandidatePage?DrawingDocument.project(aiCandidatePage):null,[aiCandidatePage]);
  const aiCandidateViewDoc=aiCandidatePage&&aiCandidateCanvas?{...aiCandidate.document,id:`${aiCandidate.document.id}:ai:${aiCandidate.planId}`,schemaVersion:1,pageLayers:aiCandidatePage.scene.layers,canvasData:aiCandidateCanvas,treeData:aiCandidatePage.treeData,sequenceData:aiCandidatePage.sequenceData,pageColor:aiCandidatePage.scene.pageStyle?.background||'#ffffff'}:null;
  const aiApplyCandidate=next=>{
    // 单次 history.apply：候选经 DocumentEditor.apply（clone+validate+一次历史）
    return apply(d=>Object.assign(d,next));
  };
  const aiGetSelection=()=>{
    const ids=commands.current.selection?.() || [];
    if(!chen || !ids.length) return null;
    const semanticIds=new Set(DrawingDocument.semantic(p).map(v=>v.id));
    const picked=ids.filter(id=>semanticIds.has(id));
    return picked.length?picked:null;
  };
  const text=(zh,english)=>en()?english:zh;
  // CHEN-UAT-009 P0: readable Chinese copy for damaged-journal recovery errors;
  // the raw code (DAMAGED_JOURNAL, …) always stays visible as details.
  const repairLabels={
    DAMAGED_JOURNAL:['本机恢复日志已损坏，自动保存已暂停。','The local recovery journal is damaged; autosave paused.'],
    INVALID_SNAPSHOT:['恢复快照校验未通过，已停止且未改动任何文件；当前草稿仍可导出恢复副本。','The recovery snapshot failed validation; nothing was changed and the draft can still be exported.'],
    BACKUP_FAILED:['备份原始日志失败，已停止恢复；原始文件未改动。','Backing up the original journal failed; recovery stopped and original files are unchanged.'],
    REBUILD_FAILED:['重建恢复日志失败，已停止；原始备份与当前草稿均保留。','Rebuilding the journal failed; the backup and the current draft are retained.'],
    REPAIR_NOT_REQUIRED:['恢复日志当前未损坏，可直接重试写入。','The journal is not damaged; retry the checkpoint directly.'],
  };
  const repairHuman=error=>{const message=typeof error==='string'?error:error?.message||String(error);return repairLabels[message]?text(repairLabels[message][0],repairLabels[message][1]):humanError(error);};
  // A failed change() republishes status:'error' with error 'DAMAGED_JOURNAL',
  // so the damaged condition is recognized from either the status or the code —
  // the recovery entry and its readable banner must stay consistent in both.
  const isDamaged=saveState.status==='damaged' || String(saveState.error || '').includes('DAMAGED_JOURNAL');
  const repairJournal=async()=>{
    if(readOnly)return;
    if(!window.confirm(text('将恢复日志并继续保存：\n· 原始日志文件会先完整备份保留，作为排查证据；\n· 以当前绘图内容重建恢复记录并写入项目；\n· 无法证明的损坏尾部不保证恢复。\n继续吗？','Repair the journal and continue saving:\n· Original log files are fully backed up first as evidence;\n· The journal is rebuilt from the current drawing content and written to the project;\n· An unprovable damaged tail is not guaranteed.\nContinue?')))return;
    setRepairing(true);
    // A successful repair clears the stale local error banner (the underlying
    // store is healthy again); a failure keeps the readable message.
    try{await drawingPersistence.repair();setError('');}
    catch(e){setError(repairHuman(e));}
    finally{setRepairing(false);}
  };
  useEffect(()=>drawingPersistence.subscribe(setSaveState),[]);
  useEffect(()=>{if(aux==='find')return()=>commands.current.find?.('');},[aux]);
  useEffect(()=>{try{localStorage.setItem(`pdmaner.drawing.page.${doc.id}`,p.id);}catch(e){}},[p.id]);
  useEffect(()=>{if(!locateId)return;const id=locateId.id || locateId;const page=doc.pages.find(v=>[...(v.scene.annotations || []),...(v.scene.cells || [])].some(c=>c.id===id) || Object.prototype.hasOwnProperty.call(v.scene.nodes || {},id));if(page)setActive(page.id);},[locateId]);
  const apply = change => {
    if(readOnly)return false;
    try{const next=DrawingDocument.clone(latest.current);change(next);if(JSON.stringify(next)===JSON.stringify(latest.current))return true;const issues=validateDrawing(next);if(issues.length)throw Error(issues.join(', '));history.apply(next);setError('');return true;}
    catch(e){setError(humanError(e));return false;}
  };
  const editPage = change => apply(next=>change(next.pages.find(v=>v.id===p.id)));
  const exportDocument=()=>download(`${doc.defName}.drawing.json`,JSON.stringify({format:'pdmaner-drawing',version:2,document:doc},null,2));
  // Chen projection stability: DrawingDocument.project(p) must keep its result
  // identity across unrelated re-renders (autosave state, menus). A fresh
  // object every render gave GraphEditor a "new" canvasData and rebuilt every
  // cell view — re-hiding hovered ports with no fresh mouseenter (R3 field
  // repro). Memoize on the page itself; the legacy path is untouched.
  const chenCanvas=useMemo(()=>chen?DrawingDocument.project(p):null,[chen,p]);
  const canvas=chen?chenCanvas:DrawingDocument.projectLegacy(p);
  const viewDoc={...doc,id:`${doc.id}:${p.id}`,schemaVersion:1,pageLayers:p.scene.layers,canvasData:canvas,treeData:p.treeData,sequenceData:p.sequenceData,pageColor:p.scene.pageStyle?.background || '#ffffff'};
  const commitView=next=>{
    if(readOnly)return false;
    return apply(d=>{
      let page=d.pages.find(v=>v.id===p.id);
      if(chen){
        const currentNodes=new Set(DrawingDocument.semantic(page).map(v=>v.id));const actualNodes=new Set(next.canvasData.cells.filter(c=>!DrawingDocument.isEdge(c)).map(c=>c.id));
        const removed=[...currentNodes].filter(v=>!actualNodes.has(v));if(removed.length)page=DrawingDocument.removeSemantic(page,removed);
        const oldEdges=new Set(DrawingDocument.project(page).cells.filter(DrawingDocument.isEdge).map(c=>c.id));
        const converted=new Set();
        next.canvasData.cells.filter(c=>DrawingDocument.isEdge(c)&&!c.data?.chen&&!c.data?.auxiliary&&currentNodes.has(c.source?.cell)&&currentNodes.has(c.target?.cell)).forEach(c=>{page=DrawingDocument.connect(page,c.source.cell,c.target.cell);converted.add(c.id);});
        const liveEdges=new Set(next.canvasData.cells.filter(DrawingDocument.isEdge).map(c=>c.id));
        if(!removed.length)page=DrawingDocument.removeSemantic(page,[...oldEdges].filter(v=>v.startsWith('role:')&&!liveEdges.has(v)));
        page=DrawingDocument.capture(page,{cells:next.canvasData.cells.filter(c=>!converted.has(c.id))});
        d.pages=d.pages.map(v=>v.id===page.id?page:v);
      }else {page.scene.cells=DrawingDocument.captureLegacy(page,next.canvasData);if(next.treeData)page.treeData=next.treeData;if(next.sequenceData)page.sequenceData=next.sequenceData;}
      const target=d.pages.find(v=>v.id===p.id);target.scene.pageStyle={...target.scene.pageStyle,background:next.pageColor};
      ['enabledPacks','customShapes','treeLayout','textStyle'].forEach(key=>{if(next[key]!=null)d[key]=next[key];});
    });
  };
  const addSemantic=(kind,ownerId,point,defaults={})=>editPage(page=>{
    const owner=page.erModel.entities.some(n=>n.id===ownerId)?{type:'entity',id:ownerId}:page.erModel.relationships.some(n=>n.id===ownerId)?{type:'relationship',id:ownerId}:page.erModel.attributes.some(n=>n.id===ownerId&&n.kind==='composite')?{type:'attribute',id:ownerId}:null;
    if(!['entity','weak','relationship','identifying'].includes(kind)&&!owner)throw Error(text('请先选择实体、联系或复合属性，再添加属性。','Select an entity, relationship or composite attribute first.'));
    const origin=owner?page.scene.nodes[ownerId]:null;
    // A drop point is the cursor position: center the new node's real geometry on
    // it (same semantic as the generic palette), never use it as the top-left.
    const size=DrawingDocument.chenSizeOf(kind);
    const n=DrawingDocument.addSemantic(page,kind,text(({entity:'实体',weak:'弱实体',relationship:'联系',identifying:'标识联系',attribute:'属性',composite:'复合属性',multi:'多值属性',derived:'派生属性',key:'编号','partial-key':'部分键'})[kind],kind),point ? point.x - size.width / 2 : (origin?origin.x:150+DrawingDocument.semantic(page).length*30),point ? point.y - size.height / 2 : (origin?origin.y-120:160),owner);
    // New nodes inherit the canvas look (theme colors + render style) unless the
    // user set explicit defaults in the format bar.
    const look=DrawingDocument.chenAppearanceOf(page);
    const theme=DrawingDocument.chenThemes[look.themeId] || DrawingDocument.chenThemes.default;
    const role=DrawingDocument.chenRoleOf(kind);
    n.page.scene.nodes[n.id].style={fill:defaults['body/fill'] || theme[role].fill,stroke:defaults['body/stroke'] || theme[role].stroke,bold:Number(defaults['label/fontWeight'])>=600,italic:defaults['label/fontStyle']==='italic',underline:defaults['label/textDecoration']==='underline',strike:defaults['label/textDecoration']==='line-through',lineHeight:defaults['label/lineHeight'],textAnchor:defaults['label/textAnchor'],fontSize:defaults['label/fontSize'],fontFamily:defaults['label/fontFamily'],color:defaults['label/fill'],...(look.styleId!=='standard'?{renderStyle:look.styleId}:{})};Object.assign(page,n.page);
  });
  const newPage=()=>apply(d=>{let n=d.pages.length+1;while(d.pages.some(p=>p.name===`画布 ${n}`))n+=1;const page=DrawingDocument.page(`画布 ${n}`);if(chen)page.erModel=DrawingDocument.emptyModel();d.pages.push(page);setActive(page.id);});
  const copyPage=()=>apply(d=>{const next=DrawingDocument.clonePage(p);let n=1;while(d.pages.some(v=>v.name===`${p.name} 副本 ${n}`))n+=1;next.name=`${p.name} 副本 ${n}`;d.pages.push(next);setActive(next.id);});
  const reorder=offset=>apply(d=>{const i=d.pages.findIndex(v=>v.id===p.id);if(i+offset<0||i+offset>=d.pages.length)return;[d.pages[i],d.pages[i+offset]]=[d.pages[i+offset],d.pages[i]];});
  const menuCommand=async key=>{
    setMenu('');try{
      if(key==='newDocument')onNew?.();else if(key==='fromTemplate')onTemplate?.();else if(key==='importDocument')onImport?.();else if(key==='duplicateDocument')onDuplicate?.();else if(key==='back')onBack?.();else if(key==='theme')onToggleTheme?.();else if(key==='upgrade')setUpgrading(true);else if(key==='exportPages')setExporting(true);else if(key==='undo')history.undo();else if(key==='redo')history.redo();else if(key==='native')exportDocument();else if(key==='save')await drawingPersistence.flush();
      else if(key==='newPage')newPage();else if(key==='copyPage')copyPage();else if(key==='pageRename'){setRename('page');setName(p.name);}else if(key==='documentRename'){setRename('document');setName(doc.defName);}
      else if(key==='deletePage'){if(doc.pages.length>1&&window.confirm(text('删除当前画布及其内容？','Delete the current canvas?')))apply(d=>{d.pages=d.pages.filter(v=>v.id!==p.id);});}
      else if(key==='left')reorder(-1);else if(key==='right')reorder(1);
      else if(key==='grid'){commands.current.grid?.(!grid);setGrid(!grid);}else if(key==='snap'){commands.current.snap?.(!snap);setSnap(!snap);}
      else if(key==='fullScreen'){if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('.pv-document-shell')?.requestFullscreen();}
      else if(key==='history'){setAux('history');setVersions(await drawingPersistence.versions());}
      else if(key==='savePanel')setAux('save');
      else if(key==='comments'||key==='layers'||key==='ai')setAux(aux===key?'':key);
      else if(key==='svg'||key==='png'){if(p.kind==='graph')commands.current.export?.(key);else {const svg=document.querySelector('.pv-tree-svg,.pv-sequence-preview svg');await exportVector(svg,doc.defName,key==='png');}}
      else if(key==='find')setAux('find');else if(key.startsWith('align:'))commands.current.align?.(key.split(':')[1]);
      else commands.current[key]?.();
    }catch(e){setError(humanError(e));}
  };
  const SHORTCUTS = {
    undo: '⌘Z', redo: '⌘⇧Z', copy: '⌘C', cut: '⌘X', paste: '⌘V', duplicate: '⌘D', remove: '⌫', selectAll: '⌘A', find: '⌘F',
    save: '⌘S', native: '⌘E', fullScreen: 'F11', properties: '⌥P', layers: '⌥L', comments: '⌥C',
    grid: '⌥G', snap: '⌥S', fit: '⇧1', actualSize: '⇧0', group: '⌘G', ungroup: '⌘⇧G', front: '⌘]', back: '⌘['
  };
  const saveLabel=({idle:'准备保存',pending:'正在保存…',local:'已保存到本机恢复区',saved:'已写入项目文件',conflict:'项目冲突 · 恢复区已保存',error:'保存失败',damaged:'恢复日志损坏'})[saveState.status] || saveState.status;
  const englishSave=({idle:'Ready',pending:'Saving…',local:'Saved in local recovery',saved:'Written to project',conflict:'Conflict · local recovery retained',error:'Save failed',damaged:'Recovery log damaged'})[saveState.status] || saveState.status;
  // CHEN-UI-008 menus: same commands, grouped with headers, icons, real submenus
  // and ONLY shortcuts that are actually bound in keydown handlers.
  const SHORTCUTS_REAL = {
    undo: '⌘Z', redo: '⌘⇧Z', copy: '⌘C', cut: '⌘X', paste: '⌘V', duplicate: '⌘D',
    selectAll: '⌘A', find: '⌘F', save: '⌘S', remove: '⌫',
  };
  const chenMenus = {
    file: [
      ['@doc', '文档', 'Document'],
      ['newDocument','新建绘图','New drawing'],['fromTemplate','从模板创建…','Create from template…'],['duplicateDocument','创建同项目副本','Duplicate in project'],['documentRename','重命名文档','Rename document'],
      ['@io','输入输出','Import & export'],
      ['importDocument','导入绘图文件…','Import drawing…'],
      ['>exportCanvas','导出当前画布','Export canvas',[['svg','SVG','SVG'],['png','PNG','PNG']]],
      ['native','导出可编辑文档','Export editable file'],['exportPages','批量导出画布…','Export canvases…'],
      ['@save','保存恢复','Save & restore'],
      ['>saveRestore','保存与恢复','Save & recovery',[['save','立即写入项目','Write checkpoint'],['savePanel','保存与恢复','Save & recovery'],['history','本机历史','Local history']]],
      ['back','返回绘图列表','Back to drawings'],
    ],
    edit: [
      ['@edit','编辑','Edit'],
      ['undo','撤销','Undo'],['redo','重做','Redo'],
      ['copy','复制','Copy'],['cut','剪切','Cut'],['paste','粘贴','Paste'],['duplicate','重复','Duplicate'],
      ['remove','删除','Delete'],['selectAll','全选','Select all'],['find','查找文本','Find text'],
    ],
    view: [
      ['@view','视图','View'],
      ['grid',grid?'隐藏网格':'显示网格','Toggle grid'],['snap',snap?'关闭吸附':'开启吸附','Toggle snapping'],['minimap','小地图','Minimap'],
      ['theme','切换界面深浅','Toggle UI theme'],['fit','适应画布','Fit canvas'],['actualSize','实际大小','Actual size'],['fullScreen','全屏','Full screen'],
      ['properties','属性面板','Properties'],['layers','图层','Layers'],
    ],
    insert: [
      ['@insert','插入','Insert'],
      ['insertText','文本','Text'],['insertNote','便笺','Note'],['image','本机图片','Local image'],['link','设置链接','Set link'],['openLink','打开链接','Open link'],
      ['@manage','管理','Manage'],
      ['insertReference','模型引用','Model reference'],['saveShape','保存为项目组件','Save as project component'],['favoriteSelection','收藏选中图形','Favorite selected shapes'],['libraries','管理图形库','Shape libraries'],['comments','批注','Comments'],
      // V5-R3→集成：AI 绘图入口在插入菜单（design 交互契约 #9），仅陈氏文档适配
      ['ai','AI 绘图','AI drawing'],
    ],
    canvas: [
      ['@canvas','画布','Canvas'],
      ['newPage','新增画布','New canvas'],['pageRename','重命名画布','Rename canvas'],['copyPage','复制画布','Duplicate canvas'],
      ['left','左移画布','Move left'],['right','右移画布','Move right'],['deletePage','删除画布','Delete canvas'],
    ],
    arrange: [
      ['@align','对齐与分布','Align & distribute'],
      ['align:left','左对齐','Align left'],['align:center','水平居中','Center horizontally'],['align:right','右对齐','Align right'],['align:top','顶对齐','Align top'],['align:middle','垂直居中','Center vertically'],['align:bottom','底对齐','Align bottom'],
      ['distribute','水平分布','Distribute horizontally'],['distributeVertical','垂直分布','Distribute vertically'],['equalWidth','等宽','Equal width'],['equalHeight','等高','Equal height'],
      ['@combine','组合与层级','Group & order'],
      ['group','组合','Group'],['ungroup','解组','Ungroup'],['front','置顶','Bring front'],['back','置底','Send back'],['lock','锁定 / 解锁','Lock / unlock'],
      ['@style','样式','Style'],
      ['copyStyle','复制样式','Copy style'],['pasteStyle','粘贴样式','Paste style'],['applyPaletteAll','应用配色到全画布','Apply palette to canvas'],
    ],
    headerMore: [
      ['@quick','快捷','Quick'],
      ['savePanel','保存与恢复','Save & recovery'],['history','本机历史','Local history'],['theme','切换界面深浅','Toggle UI theme'],['fullScreen','全屏','Full screen'],
      ['back','返回绘图列表','Back to drawings'],
    ],
    exportQuick: [
      ['@export','导出','Export'],
      ['svg','当前画布 SVG','Canvas SVG'],['png','当前画布 PNG','Canvas PNG'],['exportPages','批量导出画布…','Export canvases…'],['native','导出可编辑文档','Export editable file'],
    ],
  };
  const menus = chen ? chenMenus : {
    file:[['newDocument','新建绘图','New drawing'],['fromTemplate','从模板创建…','Create from template…'],['importDocument','导入绘图文件…','Import drawing…'],['duplicateDocument','创建同项目副本','Duplicate in project'],['back','返回绘图列表','Back to drawings'],...(!chen&&doc.diagramType==='er-sketch'?[['upgrade','升级为陈氏 ER 副本…','Create Chen ER copy…']]:[]),['documentRename','重命名文档','Rename document'],['save','立即写入项目','Write checkpoint'],['native','导出可编辑文件','Export editable file'],['exportPages','批量导出画布…','Export canvases…'],['svg','导出当前画布 SVG','Export canvas SVG'],['png','导出当前画布 PNG','Export canvas PNG']],
    edit:[['undo','撤销','Undo'],['redo','重做','Redo'],['copy','复制','Copy'],['cut','剪切','Cut'],['paste','粘贴','Paste'],['duplicate','重复','Duplicate'],['remove','删除','Delete'],['selectAll','全选','Select all'],['find','查找文本','Find text']],
    view:[['grid',grid?'隐藏网格':'显示网格','Toggle grid'],['snap',snap?'关闭吸附':'开启吸附','Toggle snapping'],['minimap','小地图','Minimap'],['theme','切换界面深浅','Toggle UI theme'],['fit','适应画布','Fit canvas'],['actualSize','实际大小','Actual size'],['properties','属性面板','Properties'],['layers','图层','Layers'],['fullScreen','全屏','Full screen']],
    insert:[['insertText','文本','Text'],['insertNote','便笺','Note'],['image','本机图片','Local image'],['link','设置链接','Set link'],['openLink','打开链接','Open link'],['insertReference','模型引用','Model reference'],['saveShape','保存为项目组件','Save as project component'],['favoriteSelection','收藏选中图形','Favorite selected shapes'],['libraries','管理图形库','Shape libraries'],['comments','批注','Comments']],
    canvas:[['newPage','新增画布','New canvas'],['pageRename','重命名画布','Rename canvas'],['copyPage','复制画布','Duplicate canvas'],['left','左移画布','Move left'],['right','右移画布','Move right'],['deletePage','删除画布','Delete canvas']],
    arrange:[['align:left','左对齐','Align left'],['align:center','水平居中','Center horizontally'],['align:right','右对齐','Align right'],['align:top','顶对齐','Align top'],['align:middle','垂直居中','Center vertically'],['align:bottom','底对齐','Align bottom'],['distribute','水平分布','Distribute horizontally'],['distributeVertical','垂直分布','Distribute vertically'],['equalWidth','等宽','Equal width'],['equalHeight','等高','Equal height'],['group','组合','Group'],['ungroup','解组','Ungroup'],['front','置顶','Bring front'],['back','置底','Send back'],['lock','锁定 / 解锁','Lock / unlock'],['copyStyle','复制样式','Copy style'],['pasteStyle','粘贴样式','Paste style'],['applyPaletteAll','应用配色到全画布','Apply palette to canvas']],
  };
  return <div className={`pv-document-shell${chen ? ' pv-chen-shell' : ''}`} onMouseDownCapture={e=>{if(!e.target.closest('.pv-menu-anchor'))setMenu('');}} onKeyDown={e=>{if(e.key==='Escape')setMenu('');if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='f'&&!e.target.closest('input,textarea,[contenteditable]')){e.preventDefault();e.stopPropagation();setAux('find');}if(menu&&['ArrowDown','ArrowUp'].includes(e.key)){const items=Array.from(e.currentTarget.querySelectorAll('.pv-command-menu [role=menuitem]:not(:disabled)'));if(items.length){e.preventDefault();const index=items.indexOf(document.activeElement);items[(index+(e.key==='ArrowDown'?1:items.length-1)+items.length)%items.length].focus();}}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopPropagation();drawingPersistence.flush().catch(err=>setError(repairHuman(err)));}}}>
    <header className={`pv-document-header${chen ? ' pv-chen-header' : ''}`}>
      <div className='pv-header-brand'>
        <Action className='pv-back-btn' onClick={onBack} aria-label={text('返回绘图列表','Back to drawings')}>‹</Action>
        <span className='pv-studio-logo' title='CS-M Drawing Platform'>C</span>
        <div className='pv-title-meta'>
          <strong title={doc.defName}>{doc.defName}</strong>
          <small>{chen?text('画图平台 / 陈氏 ER','Drawing / Chen ER'):text('绘图文档','Drawing document')}</small>
        </div>
      </div>

      {!chen && <button type='button' className={`pv-save-indicator ${saveState.status}`} title={saveState.error || text('仅绘图自动保存；数据/业务编辑仍按原方式保存。','Only drawing documents autosave. Model edits retain their existing save behavior.')} onClick={()=>setAux('save')} aria-live='polite'>
        <span className='pv-save-dot' />
        <span className='pv-save-text'>{text(saveLabel,englishSave)}</span>
      </button>}

      <nav className='pv-header-nav'>
        {/* CHEN-UAT-009: menus open on click only; once one is open, hovering a
            sibling top-level trigger switches to it (no auto-open on bare hover).
            Outside-click/Esc/keyboard closing below stays unchanged. */}
        {['file','edit','view','insert','canvas','arrange'].map(key=><div className='pv-menu-anchor' key={key} onMouseEnter={()=>menu && menu!==key && setMenu(key)}>
          <button type='button' className={`pv-menu-trigger${menu===key?' active':''}`} aria-expanded={menu===key} onClick={()=>setMenu(menu===key?'':key)}>
            {text(({file:'文件',edit:'编辑',view:'视图',insert:'插入',canvas:'画布',arrange:'排列'})[key],key)}
            <span className='pv-trigger-caret'>▾</span>
          </button>
          {menu===key&&<div className='pv-command-menu' role='menu' onKeyDown={e=>{if(e.key==='Escape')setMenu('');if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='f'&&!e.target.closest('input,textarea,[contenteditable]')){e.preventDefault();e.stopPropagation();setAux('find');}}}>
            {menus[key].map(item=>{
              if(chen && item[0].startsWith('@')) return <div className='pv-menu-grouphead' key={item[0]} role='presentation'>{text(item[1],item[2])}</div>;
              if(chen && item[0].startsWith('>')) return <ChenSubmenu key={item[0]} item={item} onCommand={menuCommand} shortcuts={SHORTCUTS_REAL} readOnly={readOnly}/>;
              const [action,zh,english]=item;
              const disabled = p.kind!=='graph'&&['copy','cut','paste','duplicate','remove','selectAll','grid','snap','minimap','insertText','insertNote','image','link','openLink','insertReference','saveShape','favoriteSelection','libraries','align:left','align:center','align:right','align:top','align:middle','align:bottom','distribute','distributeVertical','equalWidth','equalHeight','group','ungroup','front','back','lock','applyPaletteAll','copyStyle','pasteStyle','exportPages'].includes(action)||readOnly&&!['back','copy','selectAll','find','svg','png','native','exportPages','fit','actualSize','properties','grid','snap','minimap','theme','layers','fullScreen'].includes(action)||p.kind!=='graph'&&['newPage','copyPage'].includes(action)||doc.pages.length===1&&action==='deletePage';
              const shortcut = chen ? SHORTCUTS_REAL[action] : SHORTCUTS[action];
              const isDivider = !chen && ['copy','documentRename','fit','insertReference','comments','distribute','group','copyStyle'].includes(action);
              const MenuIcon = chen ? MENU_ICONS[action] : null;
              return <React.Fragment key={action}>
                {isDivider && <div className='pv-menu-divider' />}
                <button type='button' role='menuitem' className={action === 'remove' ? 'pv-danger-item' : ''} title={p.kind!=='graph'?text('部分通用命令仅适用于自由画板，请使用此图种的专属工具。','Some commands are available on graph canvases only. Use this editor’s dedicated tools.'):undefined} disabled={disabled} onClick={()=>menuCommand(action)}>
                  {chen && <span className='pv-menu-item-icon' aria-hidden='true'>{MenuIcon ? <MenuIcon size={16}/> : null}</span>}
                  <span className='pv-menu-item-text'>{text(zh,english)}</span>
                  {shortcut && <kbd className='pv-menu-shortcut' aria-hidden='true'>{shortcut}</kbd>}
                </button>
              </React.Fragment>;
            })}
          </div>}
        </div>)}
      </nav>

      {chen ? <div className='pv-chen-header-right'>
        <button type='button' className={`pv-save-indicator ${saveState.status}`} title={saveState.error || text('仅绘图自动保存；数据/业务编辑仍按原方式保存。','Only drawing documents autosave. Model edits retain their existing save behavior.')} onClick={()=>setAux('save')} aria-live='polite'>
          <span className='pv-save-dot' />
          <span className='pv-save-text'>{text(saveLabel,englishSave)}</span>
        </button>
        <div className='pv-menu-anchor'>
          <button type='button' className={`pv-header-icon-btn${menu==='headerMore'?' active':''}`} aria-label={text('更多操作','More actions')} aria-expanded={menu==='headerMore'} onClick={()=>setMenu(menu==='headerMore'?'':'headerMore')}><IconMore size={16}/></button>
          {menu==='headerMore'&&<div className='pv-command-menu pv-anchored-right' role='menu'>{menus.headerMore.map(item=>{
            if(item[0].startsWith('@')) return <div className='pv-menu-grouphead' key={item[0]} role='presentation'>{text(item[1],item[2])}</div>;
            const [action,zh,english]=item;const MenuIcon=MENU_ICONS[action];
            return <button type='button' role='menuitem' key={action} onClick={()=>menuCommand(action)}>
              <span className='pv-menu-item-icon' aria-hidden='true'>{MenuIcon ? <MenuIcon size={16}/> : null}</span>
              <span className='pv-menu-item-text'>{text(zh,english)}</span></button>;
          })}</div>}
        </div>
        <div className='pv-menu-anchor'>
          <button type='button' className='pv-header-icon-btn' aria-label={text('本机历史','Local history')} title={undefined} onClick={()=>menuCommand('history')}><IconHistory size={16}/></button>
        </div>
        <div className='pv-menu-anchor'>
          <button type='button' className={`pv-chen-export-btn${menu==='exportQuick'?' active':''}`} aria-haspopup='menu' aria-expanded={menu==='exportQuick'} onClick={()=>setMenu(menu==='exportQuick'?'':'exportQuick')}>
            <IconExport size={13}/>{text('导出','Export')}
          </button>
          {menu==='exportQuick'&&<div className='pv-command-menu pv-anchored-right' role='menu'>{menus.exportQuick.map(item=>{
            if(item[0].startsWith('@')) return <div className='pv-menu-grouphead' key={item[0]} role='presentation'>{text(item[1],item[2])}</div>;
            const [action,zh,english]=item;const MenuIcon=MENU_ICONS[action];const disabled=readOnly&&!['svg','png','native','exportPages'].includes(action);
            return <button type='button' role='menuitem' key={action} disabled={disabled} onClick={()=>menuCommand(action)}>
              <span className='pv-menu-item-icon' aria-hidden='true'>{MenuIcon ? <MenuIcon size={16}/> : null}</span>
              <span className='pv-menu-item-text'>{text(zh,english)}</span></button>;
          })}</div>}
        </div>
      </div> : <div className='pv-document-tabs-right'>
        {[['properties','属性','Properties'],['layers','图层','Layers'],['comments','批注','Comments'],['history','历史','History'],['ai','AI','AI']].map(([key,zh,english])=>(
          <Action key={key} className={`pv-tab-btn${aux===key?' active':''}`} onClick={()=>menuCommand(key)}>
            {key==='ai' && <span className='pv-ai-spark' aria-hidden='true'>✨</span>}
            {text(zh,english)}
          </Action>
        ))}
      </div>}
    </header>
    {(error || ['conflict','error','damaged'].includes(saveState.status))&&<div role='alert' className='pv-error'>{isDamaged && !error ? text('本机恢复日志已损坏，自动保存已暂停：可恢复日志并继续保存，或先导出恢复副本。','The local recovery journal is damaged and autosave paused: repair the journal to continue saving, or export a recovery copy first.') : (error || (saveState.error ? humanError(saveState.error) : text('项目文件发生外部修改，已停止覆盖。','External changes detected; project writes stopped.')))}{isDamaged?<small> · {text('详情','details')}: {saveState.error || 'DAMAGED_JOURNAL'}</small>:null}<Action onClick={()=>{setError('');setAux('save');}}>{text('查看恢复','Recovery')}</Action></div>}
    {p.kind==='tree'?<TreeEditor key={p.id} doc={viewDoc} onChange={commitView} readOnly={readOnly} onCommands={next=>{commands.current=next;}}/>:p.kind==='sequence'?<SequenceEditor key={p.id} doc={viewDoc} onChange={commitView} readOnly={readOnly} onCommands={next=>{commands.current=next;}}/>:<>
      {/* 原主画布：候选临时投影期间保活只隐藏（原页/选区/视口原样保留） */}
      <div className={`pv-main-editor${aiCandidatePreviewOn&&aiCandidateViewDoc?' pv-main-editor-hidden':''}`}>
        <GraphEditor key={p.id} doc={viewDoc} source={source} readOnly={readOnly} onChange={commitView} onOpenAsset={onOpenAsset} onLocate={onLocate} locateId={commentLocate || locateId} chenPage={chen?p:null} onChenEdit={editPage} onChenAdd={addSemantic} onChenPaste={payload=>editPage(page=>Object.assign(page,DrawingDocument.duplicateSemantic(payload.chenPage,payload.ids,page)))} externalHistory={history} onCommands={next=>{commands.current=next;}} onExportDocument={exportDocument} aux={aux} onAuxCommand={key=>menuCommand(key)} onPanCollapse={setAiPanHidden}/>
      </div>
      {/* R2 候选只读投影：复用真实 GraphEditor/Chen 投影，独立 commands，绝不
          触碰真实文档/历史/自动保存；随候选清除或页签关闭而卸载 */}
      {aiCandidatePreviewOn&&aiCandidateViewDoc&&<GraphEditor key={`ai-preview:${aiCandidate.planId}`} doc={aiCandidateViewDoc} source={source} readOnly onChange={()=>false} chenPage={aiCandidatePage} onCommands={()=>{}} onPanCollapse={()=>{}}/>}
    </>}
    <footer className={`pv-pages${chen ? ' pv-chen-pages' : ''}`} role='tablist' aria-label={text('画布','Canvases')}>{chen && <span className='pv-pages-icon' aria-hidden='true'><IconLayers size={14}/></span>}{doc.pages.map(page=><button type='button' key={page.id} role='tab' aria-selected={page.id===p.id&&!aiCandidatePreviewOn} onClick={()=>{setAiCandidatePreviewOn(false);document.activeElement?.blur();setActive(page.id);}} onDoubleClick={()=>{setRename('page');setName(page.name);}}>{page.name}</button>)}{aiCandidateViewDoc&&aiCandidate&&<button type='button' role='tab' className='pv-ai-candidate-tab' aria-selected={aiCandidatePreviewOn} title={text('AI 候选预览（未应用，不改动当前文档）；点击可返回原画布','AI candidate preview (not applied; the current document is unchanged). Click again to return.')} onClick={()=>setAiCandidatePreviewOn(v=>!v)}>{aiCandidate.document.defName}{aiCandidatePage&&aiCandidateAffectedPages.length?` · ${aiCandidatePage.name}`:''} · {text('未应用','not applied')}</button>}<Action disabled={readOnly||p.kind!=='graph'} title={p.kind!=='graph'?text('此编辑器本期仅单画布','Single canvas for this editor'):text('新增画布','New canvas')} onClick={newPage}>＋</Action><Action onClick={()=>setMenu(menu==='canvas'?'':'canvas')}>⋯</Action>{chen ? <span className='pv-pages-stats'>{DrawingDocument.semantic(p).length} {text('个语义对象','semantic objects')} · {p.scene.layers[0]?.name || text('主图层','Main layer')} · {text('概念 ER','Conceptual ER')}{DrawingDocument.warnings(p).length ? <Action onClick={()=>setAux('validation')}>{DrawingDocument.warnings(p).length} {text('条提示','warnings')}</Action> : null}</span> : <span>{text('本机项目','Local project')}</span>}</footer>
    {/* 保活（INTEGRATION-R1）：陈氏文档的 AI 辅助 aside 常驻挂载，切 aux 页签/临时关闭
        只切换 pv-aux-closed 隐藏类，不 unmount——对话/候选/服务状态往返保留；
        清理只随文档/项目切换（组件重挂载），候选不写入项目。其余 aux 保持按需挂载。 */}
    {aux && !(chen && aux==='ai') && <aside className={`pv-document-aux${chen ? ' pv-chen-aux' : ''}${aiPanHidden ? ' pv-ai-pan-hidden' : ''}`}><header><strong>{text(({layers:'图层',comments:'本机批注',history:'本机版本',ai:'AI 绘图',save:'保存与恢复',find:'查找文本',validation:'模型检查'})[aux] || aux,aux)}</strong><Action onClick={()=>setAux('')}>×</Action></header>
      {aux==='layers'&&<>{p.scene.layers.map((l,index)=><div className='pv-layer-card' key={l.id}><input aria-label={text('图层名称','Layer name')} value={l.name} disabled={readOnly} onChange={e=>editPage(page=>{page.scene.layers[index].name=e.target.value;})}/><label><input type='checkbox' disabled={readOnly} checked={l.visible!==false} onChange={e=>editPage(page=>{page.scene.layers[index].visible=e.target.checked;})}/>{text('显示','Visible')}</label><label><input type='checkbox' disabled={readOnly} checked={Boolean(l.locked)} onChange={e=>editPage(page=>{page.scene.layers[index].locked=e.target.checked;})}/>{text('锁定','Locked')}</label><Action disabled={readOnly||index===0} onClick={()=>editPage(page=>{[page.scene.layers[index-1],page.scene.layers[index]]=[page.scene.layers[index],page.scene.layers[index-1]];})}>↑</Action><Action disabled={readOnly||index===p.scene.layers.length-1} onClick={()=>editPage(page=>{[page.scene.layers[index+1],page.scene.layers[index]]=[page.scene.layers[index],page.scene.layers[index+1]];})}>↓</Action><Action disabled={readOnly||p.scene.layers.length===1} title={text('删除图层，内容移至其他图层','Delete layer and move its content')} onClick={()=>{if(!window.confirm(text('删除此图层，所有内容移至剩余图层？','Delete this layer and move all content to another layer?')))return;editPage(page=>{const target=page.scene.layers.find(v=>v.id!==l.id).id;Object.values(page.scene.nodes).forEach(n=>{if(n.layerId===l.id)n.layerId=target;});[...(page.scene.annotations || []),...(page.scene.cells || [])].forEach(n=>{if(n.data?.layer===l.id)n.data.layer=target;});page.scene.layers=page.scene.layers.filter(v=>v.id!==l.id);});}}>×</Action></div>)}<Action disabled={readOnly} onClick={()=>editPage(page=>{page.scene.layers.push({id:DrawingDocument.id('layer'),name:text('新图层','New layer'),visible:true,locked:false});})}>＋ {text('图层','Layer')}</Action></>}
      {aux==='comments'&&<><textarea aria-label={text('批注内容','Comment')} disabled={readOnly} value={comment} onChange={e=>setComment(e.target.value)}/><Action disabled={readOnly||!comment.trim()} onClick={()=>{editPage(page=>page.comments.push({id:DrawingDocument.id('comment'),text:comment.trim(),objectId:commands.current.selection?.()[0] || null,resolved:false,createdAt:Date.now()}));setComment('');}}>{text('添加批注','Add comment')}</Action>{p.comments.map(c=><div className='pv-role' key={c.id}><p>{c.text}</p><Action disabled={readOnly} onClick={()=>setCommentEditing({...c})}>{text('编辑','Edit')}</Action>{c.objectId&&<small>{chen?!DrawingDocument.semantic(p).some(n=>n.id===c.objectId)&&text('对象已删除','Object deleted'):p.kind==='tree'?!treeFind(p.treeData,c.objectId)&&text('对象已删除','Object deleted'):p.kind==='sequence'?![...(p.sequenceData.participants || []),...(p.sequenceData.messages || [])].some(n=>n.id===c.objectId)&&text('对象已删除','Object deleted'):!(p.scene.cells || []).some(n=>n.id===c.objectId)&&text('对象已删除','Object deleted')}</small>}{c.objectId&&p.kind==='graph'&&<Action onClick={()=>setCommentLocate({id:c.objectId,nonce:Date.now()})}>{text('定位对象','Locate object')}</Action>}<Action disabled={readOnly} onClick={()=>editPage(page=>{const comment=page.comments.find(v=>v.id===c.id);comment.resolved=!comment.resolved;})}>{c.resolved?text('重新打开','Reopen'):text('解决','Resolve')}</Action></div>)}</>}
      {aux==='history'&&<><Action disabled={readOnly} onClick={()=>setVersionName('')}>{text('创建命名版本','Create named version')}</Action><p className='pv-note'>{text('恢复会创建新的修改，不覆盖其他模型编辑。','Restoring creates a new revision and preserves other model edits.')}</p>{versions.map(v=><div className='pv-role' key={v.id}><strong>{v.name || new Date(v.time).toLocaleString()}</strong>{v.named&&<Action disabled={readOnly} onClick={async()=>{try{await drawingPersistence.deleteVersion(v.id);setVersions(await drawingPersistence.versions());}catch(e){setError(humanError(e));}}}>×</Action>}<Action onClick={async()=>{try{const project=await drawingPersistence.version(v.id);setPreview(project.drawings?.find(v=>v.id===doc.id) || null);}catch(e){setError(humanError(e));}}}>{t('preview')}</Action></div>)}{!versions.length&&<p>{text('首次写入项目后生成本机版本。','Local versions appear after the first checkpoint.')}</p>}{preview&&<><p>{preview.defName}</p>{(!preview.pages||preview.pages[0].kind==='graph')&&<GraphThumbnail doc={preview} cacheKey={`history:${preview.id}:${preview.revision}`} title={preview.defName}/>}<Action disabled={readOnly} onClick={()=>{apply(d=>Object.assign(d,preview,{revision:d.revision}));setPreview(null);}}>{text('恢复为新版本','Restore as new revision')}</Action></>}</>}
      {aux==='ai'&&!chen&&<div className='pv-empty'><h2>{text('AI 绘图 · 未适配','AI drawing · Not adapted')}</h2><p>{text('当前图种暂未接入 AI 绘图；仅陈氏 ER 文档支持。','This notation is not adapted yet; only Chen ER documents are supported.')}</p><Action onClick={()=>setAux('')}>{text('返回','Back')}</Action></div>}
      {aux==='find'&&<><Field label={text('查找文本','Find text')}><input autoFocus value={query} onChange={e=>{setQuery(e.target.value);setFindCount(null);}}/></Field><Action onClick={()=>setFindCount(commands.current.find?.(query) || 0)}>{text('查找','Find')}</Action>{findCount!==null&&<p role='status'>{text(`找到 ${findCount} 个对象`,`Found ${findCount} objects`)}</p>}</>}
      {aux==='validation'&&<>{DrawingDocument.warnings(p).map(w=><div className='pv-role' key={`${w.id}:${w.code}`}><p>{text(({unnamed:'对象尚未命名','roles-required':'联系至少需要两个角色','identification-required':'弱实体尚缺标识联系','duplicate-attribute-name':'同一所属对象下属性重名'})[w.code],w.code)}</p><Action onClick={()=>setCommentLocate({id:w.id,nonce:Date.now()})}>{text('定位对象','Locate object')}</Action></div>)}{!DrawingDocument.warnings(p).length&&<p>{text('当前没有语义提示。','No semantic warnings.')}</p>}</>}
      {aux==='save'&&<><p>{text(saveLabel,englishSave)}</p><p className='pv-note'>{saveState.error ? humanError(saveState.error) : ''}</p><p className='pv-note'>{text('状态：正在连接 → 保存中 → 已写入项目；未持久确认前不会显示“已保存”。','Status: connecting → saving → written to project. “Saved” appears only after durable confirmation.')}</p><p className='pv-note'>{text('自动保存只覆盖绘图。正常关闭等待落盘；强杀可恢复已确认的日志前缀。','Drawing-only autosave. Normal close waits for persistence; acknowledged operations can be recovered after a crash.')}</p>
      {isDamaged&&<><p className='pv-note'>{text('恢复日志损坏：恢复会先完整备份原始日志文件（anchor、commands.log、previous 引用）与当前完整草稿，再以当前绘图内容重建恢复记录并写入项目；无法证明的损坏尾部不保证恢复。','Damaged recovery journal: repair first fully backs up the original log files (anchor, commands.log, previous references) and the complete current draft, then rebuilds the record from the current drawing content and writes the project; an unprovable damaged tail is not guaranteed.')}{saveState.error?` (${saveState.error})`:''}</p><Action disabled={readOnly||repairing} onClick={repairJournal}>{repairing?text('正在恢复日志……','Repairing journal…'):text('恢复日志并继续保存','Repair journal and continue saving')}</Action></>}
      <Action onClick={()=>drawingPersistence.flush().catch(e=>setError(humanError(e)))}>{text('重试写入','Retry checkpoint')}</Action><Action onClick={async()=>{try{const recovery=await drawingPersistence.recovery();download('drawing-recovery.pdma.json',JSON.stringify(recovery,null,2));}catch(e){setError(humanError(e));}}}>{text('导出可编辑恢复副本','Export editable recovery copy')}</Action></>}
    </aside>}
    {/* 陈氏文档的 AI 辅助：常驻挂载（保活），aux!=='ai' 仅 CSS 隐藏（pv-aux-closed）；
        平移隐藏继续复用 pv-ai-pan-hidden。对话/候选/服务状态跨 aux 切换与临时关闭保留。 */}
    {chen && <aside
      className={`pv-document-aux pv-chen-aux pv-ai-aux${aux==='ai' ? '' : ' pv-aux-closed'}${aiPanHidden ? ' pv-ai-pan-hidden' : ''}`}
      data-ai-keep='drawing'
      aria-hidden={aux==='ai' ? 'false' : 'true'}>
      <header><strong>{text('AI 绘图','AI drawing')}</strong><Action onClick={()=>setAux('')}>×</Action></header>
      <DrawingAiPanel
        runtime={getAiRuntime()}
        doc={doc}
        readOnly={readOnly}
        getDocuments={()=>((source && source.drawings) || [doc]).filter(Boolean)}
        getSelection={aiGetSelection}
        applyCandidate={aiApplyCandidate}
        onCreateDocument={next=>onCreateDrawing && onCreateDrawing(next)}
        undoLast={()=>history.undo()}
        onCandidateChange={setAiCandidate}/>
    </aside>}
    {commentEditing&&<Dialog title={text('编辑批注','Edit comment')} onClose={()=>setCommentEditing(null)}><div className='pv-picker'><textarea aria-label={text('编辑批注内容','Edit comment text')} value={commentEditing.text} onChange={e=>setCommentEditing({...commentEditing,text:e.target.value})}/><Action primary disabled={readOnly||!commentEditing.text.trim()} onClick={()=>{editPage(page=>{const c=page.comments.find(v=>v.id===commentEditing.id);if(c)c.text=commentEditing.text.trim();});setCommentEditing(null);}}>{t('confirm')}</Action></div></Dialog>}
    {versionName!==null&&<Dialog title={text('创建命名版本','Create named version')} onClose={()=>setVersionName(null)}><div className='pv-picker'><Field label={text('版本名称','Version name')}><input autoFocus maxLength={80} aria-label={text('版本名称','Version name')} value={versionName} onChange={e=>setVersionName(e.target.value)}/></Field><Action primary disabled={readOnly||!versionName.trim()} onClick={async()=>{try{await drawingPersistence.saveVersion(versionName);setVersions(await drawingPersistence.versions());setVersionName(null);}catch(e){setError(humanError(e));}}}>{t('confirm')}</Action></div></Dialog>}
    {upgrading&&<LegacyUpgrade doc={doc} page={p} onClose={()=>setUpgrading(false)} onCreate={onCreateDrawing}/>}
    {exporting&&<PageExport doc={doc} current={p.id} onClose={()=>setExporting(false)}/>}
    {rename&&<Dialog title={t('rename')} onClose={()=>setRename(null)}><div className='pv-picker'><Field label={t('name')}><input autoFocus value={name} onChange={e=>setName(e.target.value)}/></Field><Action primary disabled={readOnly||!name.trim()} onClick={()=>{apply(d=>{if(rename==='document')d.defName=name.trim();else d.pages.find(v=>v.id===p.id).name=name.trim();});setRename(null);}}>{t('confirm')}</Action></div></Dialog>}
  </div>;
};
