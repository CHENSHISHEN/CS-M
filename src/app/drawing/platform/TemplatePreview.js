import React, {useMemo} from 'react';
import GraphThumbnail from './GraphThumbnail';
import {instantiateTemplate} from '../../../lib/drawing_platform';

export default ({template}) => {
  const result = useMemo(() => instantiateTemplate({}, template), [template.id]);
  const source = result.source;
  const doc = template.module === 'drawing' ? source.drawings[0] : template.module === 'business' ? source.business.processes[0] : source.diagrams[0];
  if (template.module === 'drawing' && !doc.treeData && !doc.sequenceData) return <GraphThumbnail doc={doc} cacheKey={`builtin-v2:${template.id}:${template.version}`} title={template.name}/>;
  if (doc.treeData) {
    const all = [];let leaf = 0;
    const visit = (n, depth, parent) => {const row = {n, x: 25 + depth * 230, y: 30, parent};all.push(row);const children = (n.children || []).map(c => visit(c, depth + 1, row));row.y = children.length ? (children[0].y + children[children.length - 1].y) / 2 : 35 + leaf++ * 95;return row;};visit(doc.treeData, 0);
    return <svg viewBox={`0 0 ${Math.max(...all.map(n => n.x)) + 215} ${Math.max(...all.map(n => n.y)) + 90}`} className='pv-real-preview'>{all.map(r => <g key={r.n.id}>{r.parent && <path d={`M${r.parent.x + 185} ${r.parent.y + 25} H${r.x - 20} V${r.y + 25} H${r.x}`} fill='none' stroke='#9d94d5' />}<rect x={r.x} y={r.y} width='185' height='50' rx='8' fill='#f4f1ff' stroke='#9d94d5' /><text x={r.x + 92} y={r.y + 30} textAnchor='middle'>{r.n.name}</text></g>)}</svg>;
  }
  if (doc.sequenceData) {
    const seq = doc.sequenceData;const x = id => 90 + seq.participants.findIndex(p => p.id === id) * 250;const height = 125 + seq.messages.length * 70;
    return <svg viewBox={`0 0 ${seq.participants.length * 250} ${height}`} className='pv-real-preview'>{seq.participants.map(p => <g key={p.id}><rect x={x(p.id) - 70} y='20' width='140' height='35' rx='5' fill='#f4f6fb' stroke='#aab7cb' /><text x={x(p.id)} y='43' textAnchor='middle'>{p.name}</text><path d={`M${x(p.id)} 55 V${height - 10}`} stroke='#aab7cb' strokeDasharray='5 5' /></g>)}{seq.messages.map((m, i) => <g key={m.id}><path d={`M${x(m.from)} ${100 + i * 70} H${x(m.to)}`} stroke='#7d90ab' strokeDasharray={m.kind === 'return' ? '5 5' : ''} /><text x={(x(m.from) + x(m.to)) / 2} y={90 + i * 70} textAnchor='middle'>{m.text}</text></g>)}</svg>;
  }
  const cells = template.module === 'business' ? doc.elements.map((e, i) => ({id: e.id, x: 40 + i % 3 * 250, y: 40 + Math.floor(i / 3) * 160, width: 190, height: 70, attrs: {label: {text: e.name}}, data: {kind: e.type}})) : (doc.canvasData?.cells || []);
  const nodes = cells.filter(c => !c.source).map(c => ({...c, x: (c.position?.x != null ? c.position.x : c.x || 0), y: (c.position?.y != null ? c.position.y : c.y || 0), width: c.size?.width || c.width || 200, height: c.size?.height || c.height || 70}));
  const edges = template.module === 'business' ? doc.flows.map(f => ({...f, source: {cell: f.source}, target: {cell: f.target}})) : cells.filter(c => c.source);
  const width = Math.max(400, ...nodes.map(n => n.x + n.width)) + 35;const height = Math.max(250, ...nodes.map(n => n.y + n.height)) + 35;
  const text = n => {if (!n.originKey) return n.attrs?.label?.text || '';const object = (source[{C: 'conceptEntities', L: 'logicEntities', P: 'entities'}[n.type]] || []).find(o => o.id === n.originKey);return object?.defName || '';};
  return <svg viewBox={`0 0 ${width} ${height}`} className='pv-real-preview'>
    {nodes.filter(n => n.data?.container).map(n => <g key={n.id}><rect x={n.x} y={n.y} width={n.width} height={n.height} fill='#f1f5fb' stroke='#bdcadd' /><text x={n.x + 15} y={n.y + 23}>{text(n)}</text></g>)}
    {edges.map(e => {const a = nodes.find(n => n.id === e.source.cell);const b = nodes.find(n => n.id === e.target.cell);return a && b ? <path key={e.id} d={`M${a.x + a.width / 2} ${a.y + a.height / 2} L${b.x + b.width / 2} ${b.y + b.height / 2}`} fill='none' stroke='#7d90ab' strokeWidth='1.6' /> : null;})}
    {nodes.filter(n => !n.data?.container).map(n => <g key={n.id}>
      {n.shape === 'ellipse' ? <ellipse cx={n.x + n.width / 2} cy={n.y + n.height / 2} rx={n.width / 2} ry={n.height / 2} fill='#fff' stroke='#8d9db6' /> : n.shape === 'polygon' || n.data?.kind === 'decision' ? <polygon points={`${n.x + n.width / 2},${n.y} ${n.x + n.width},${n.y + n.height / 2} ${n.x + n.width / 2},${n.y + n.height} ${n.x},${n.y + n.height / 2}`} fill='#fff' stroke='#8d9db6' /> : <rect x={n.x} y={n.y} width={n.width} height={n.height} rx='5' fill='#fff' stroke='#8d9db6' />}
      <text x={n.x + n.width / 2} y={n.y + (n.data?.fields ? 25 : n.height / 2 + 5)} textAnchor='middle'>{text(n)}</text>
      {n.data?.fields && <><path d={`M${n.x} ${n.y + 42} h${n.width} M${n.x} ${n.y + 118} h${n.width}`} stroke='#8d9db6' />{n.data.fields.split('\n').map((s, i) => <text key={s} x={n.x + 12} y={n.y + 65 + i * 20}>{s}</text>)}<text x={n.x + 12} y={n.y + 145}>{n.data.methods}</text></>}
    </g>)}
  </svg>;
};
