import DocumentTextStyle, {textCSS} from './DocumentTextStyle';
import React, { useEffect, useRef, useState } from 'react';
import { platformId, treeFind, treeUpdate, treeRemove, treeMove } from '../../../lib/drawing_platform';
import { t, Field, Action, useDocumentHistory, ExportActions, editableTarget, ResizeHandle, usePanelWidth } from './common';

const flatten = (root, parent = null) => [{node: root, parent}, ...(root.children || []).reduce((a, c) => a.concat(flatten(c, root)), [])];
const positions = (root, vertical, revealed) => {
  const nodes = []; const edges = []; let leaf = 0;
  const visit = (node, depth, branch = 0) => {
    const children = node.collapsed && !revealed.includes(node.id) ? [] : node.children || [];
    const next = children.map((child, i) => visit(child, depth + 1, depth ? branch : i));
    const slot = next.length ? (next[0].slot + next[next.length - 1].slot) / 2 : leaf++;
    const item = {node, slot, x: vertical ? 50 + slot * 250 : 65 + depth * 280, y: vertical ? 60 + depth * 170 : 75 + slot * 110, branch};
    nodes.push(item); next.forEach(child => edges.push({from: item, to: child})); return item;
  };
  visit(root, 0);
  return {nodes, edges, width: Math.max(950, ...nodes.map(n => n.x + 300)), height: Math.max(650, ...nodes.map(n => n.y + 150))};
};

export default ({doc, onChange, readOnly, onCommands}) => {
  const history = useDocumentHistory(doc, onChange, readOnly); const svgRef = useRef(null);
  const [revealed, setRevealed] = useState([]);const scrollSelected = useRef(false);
  const [selected, setSelected] = useState(doc.treeData.id); const [error, setError] = useState('');
  const [width, setWidth] = usePanelWidth('tree'); const [panel, setPanel] = useState(window.innerWidth > 1280);
  const org = doc.diagramType === 'orgchart'; const node = treeFind(doc.treeData, selected) || doc.treeData;
  const all = flatten(doc.treeData); const parent = all.find(r => r.node.id === node.id)?.parent;
  const vertical = (doc.treeLayout || (org ? 'vertical' : 'horizontal')) === 'vertical';
  const layout = positions(doc.treeData, vertical, revealed); const colors = ['#3568b5', '#7854be', '#087969', '#a46524'];
  const selectOutline = id => {const ancestors = [];let current = all.find(r => r.node.id === id)?.parent;while (current) {ancestors.push(current.id);current = all.find(r => r.node.id === current.id)?.parent;}setRevealed(ancestors);scrollSelected.current = true;setSelected(id);};
  useEffect(() => {if (scrollSelected.current) {Array.from(svgRef.current?.querySelectorAll('[data-node-id]') || []).find(n => n.dataset.nodeId === selected)?.scrollIntoView({block: 'center', inline: 'center'});scrollSelected.current = false;}}, [selected, revealed]);
  const update = patch => history.apply(d => ({...d, treeData: treeUpdate(d.treeData, node.id, patch)}));
  const add = sibling => {
    if (readOnly) return;
    const child = {id: platformId('topic'), name: t(org ? 'newOrganization' : 'newTopic'), children: [], collapsed: false};
    const target = sibling && parent ? parent : node;
    history.apply(d => ({...d, treeData: treeUpdate(d.treeData, target.id, {collapsed: false, children: [...(target.children || []), child]})})); setSelected(child.id);
  };
  const remove = () => {if (!readOnly && node.id !== doc.treeData.id) {history.apply(d => ({...d, treeData: treeRemove(d.treeData, node.id)}));setSelected(parent?.id || doc.treeData.id);}};
  useEffect(() => {onCommands?.({selection:()=>[selected],properties:()=>setPanel(v=>!v)});});
  return <div className='pv-editor pv-tree-editor' style={textCSS(doc.textStyle)} tabIndex={0} onKeyDown={e => {
    history.keyDown(e);if (e.target.closest('.pv-tools,.pv-inspector') || readOnly || editableTarget(e.target) || e.ctrlKey || e.metaKey) return;
    if (['Tab', 'Enter', ' ', 'Delete', 'Backspace'].includes(e.key)) {e.preventDefault(); e.stopPropagation();
      if (e.key === 'Tab') add(false);else if (e.key === 'Enter') add(true);else if (e.key === ' ') update({collapsed: !node.collapsed});else remove();}
  }}>
    <DocumentTextStyle doc={doc} readOnly={readOnly} onChange={history.apply}/><aside className='pv-sidebar'><header><strong>{t(org ? 'organizationOutline' : 'outline')}</strong></header>
      <div className='pv-outline'>{all.map(({node: item, parent: p}) => <button type='button' key={item.id} className={selected === item.id ? 'selected' : ''} onClick={() => selectOutline(item.id)} draggable={!readOnly} onDragStart={e => e.dataTransfer.setData('application/pdmaner-topic', item.id)} onDragOver={e => e.preventDefault()} onDrop={e => {e.preventDefault();const id = e.dataTransfer.getData('application/pdmaner-topic');if (!id || readOnly) return;try {history.apply(d => ({...d, treeData: treeMove(d.treeData, id, item.id)}));setError('');} catch (err) {setError(t('invalidMove'));}}}>
        <span>{p ? '↳ ' : ''}{item.name}</span><small>{item.children?.length || ''}</small>
      </button>)}</div><p className='pv-note'>Tab · {t('addChild')}<br />Enter · {t('addSibling')}<br />Space · {t('collapse')}</p></aside>
    <main className='pv-editor-main'><div className='pv-tools'>
      <Action disabled={readOnly} onClick={() => add(false)}>{t('addChild')}</Action><Action disabled={readOnly} onClick={() => add(true)}>{t('addSibling')}</Action>
      <Action disabled={readOnly || !history.canUndo} onClick={history.undo}>{t('undo')}</Action><Action disabled={readOnly || !history.canRedo} onClick={history.redo}>{t('redo')}</Action>
      <Action onClick={() => setPanel(!panel)}>{t('properties')}</Action><ExportActions doc={doc} svgRef={svgRef} onError={e => setError(e.message)} />
    </div>{error && <div className='pv-error' role='alert'>{error}<Action onClick={() => setError('')}>×</Action></div>}
      <div className='pv-svg-scroll'><svg ref={svgRef} className='pv-tree-svg' xmlns='http://www.w3.org/2000/svg' viewBox={`0 0 ${layout.width} ${layout.height}`} style={{minWidth: Math.min(layout.width, 1400)}}>
        <rect width={layout.width} height={layout.height} fill={doc.pageColor || '#ffffff'} />
        {layout.edges.map(({from, to}) => <path key={`${from.node.id}-${to.node.id}`} d={vertical ? `M${from.x + 105} ${from.y + 65} V${to.y - 35} H${to.x + 105} V${to.y}` : `M${from.x + 210} ${from.y + 32} H${to.x - 35} V${to.y + 32} H${to.x}`} fill='none' stroke={org ? '#7086a7' : colors[to.branch % colors.length]} strokeWidth='2' />)}
        {layout.nodes.map(({node: item, x, y, branch}) => <g key={item.id} data-node-id={item.id} role='button' tabIndex={0} aria-label={item.name} onClick={() => setSelected(item.id)} onDoubleClick={() => {setSelected(item.id);setPanel(true);}}>
          <rect x={x} y={y} width='210' height='65' rx={org ? 5 : 12} fill={item.color || (org ? '#f0f8f5' : '#f4f1ff')} stroke={selected === item.id ? '#5145cd' : colors[branch % colors.length]} strokeWidth={selected === item.id ? 2.5 : 1.3} />
          <text x={x + 105} y={y + 28} textAnchor='middle' fontSize='15' fill='#26354b' fontFamily='-apple-system, sans-serif'>{item.name.length > 16 ? `${item.name.slice(0, 16)}…` : item.name}</text>
          <text x={x + 105} y={y + 49} textAnchor='middle' fontSize='11' fill='#586b83' fontFamily='-apple-system, sans-serif'>{item.role || (item.collapsed ? `+ ${item.children?.length || 0}` : item.children?.length ? `${item.children.length}` : '')}</text>
          <title>{item.name}</title>
        </g>)}
      </svg></div><footer className='pv-editor-status'>{t(org ? 'orgchart' : 'mindmap')} · {all.length} {t('nodes')} · {readOnly ? t('readOnly') : t('saveHint')}</footer>
    </main>
    {panel && <><ResizeHandle side='right' startWidth={width} onWidth={v => setWidth(Math.max(260, Math.min(v, 420)))} />
      <aside className='pv-inspector' style={{width}}><header><strong>{t('properties')}</strong><Action onClick={() => setPanel(false)}>×</Action></header>
        <Field label={t('name')}><input value={node.name} disabled={readOnly} onChange={e => update({name: e.target.value})} /></Field>
        {org && <><Field label={t('responsibility')}><textarea value={node.role || ''} disabled={readOnly} onChange={e => update({role: e.target.value})} /></Field>
          <Field label={t('owner')}><input value={node.owner || ''} disabled={readOnly} onChange={e => update({owner: e.target.value})} /></Field></>}
        <Field label={t('parent')}><select disabled={readOnly || node.id === doc.treeData.id} value={parent?.id || ''} onChange={e => {
          try {history.apply(d => ({...d, treeData: treeMove(d.treeData, node.id, e.target.value)}));setError('');} catch (err) {setError(t('invalidMove'));}
        }}><option value=''>—</option>{all.filter(r => !treeFind(node, r.node.id)).map(r => <option key={r.node.id} value={r.node.id}>{r.node.name}</option>)}</select></Field>
        <Field label={t('layout')}><select disabled={readOnly} value={vertical ? 'vertical' : 'horizontal'} onChange={e => history.apply(d => ({...d, treeLayout: e.target.value}))}><option value='horizontal'>{t('horizontal')}</option><option value='vertical'>{t('vertical')}</option></select></Field>
        <Field label={t('fill')}><input type='color' value={node.color || '#f4f1ff'} disabled={readOnly} onChange={e => update({color: e.target.value})} /></Field>
        <Action disabled={readOnly} onClick={() => update({collapsed: !node.collapsed})}>{t(node.collapsed ? 'expand' : 'collapse')}</Action>
        <Action disabled={readOnly || node.id === doc.treeData.id} onClick={remove}>{t('deleteBranch')}</Action>
      </aside></>}
  </div>;
};
