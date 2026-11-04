import React from 'react';
import { t, Action } from './common';
export const membersOf = data => data.classMembers || {
  attributes: (data.fields || '').split('\n').filter(Boolean).map(s => {const match = s.match(/^([+\-#~]?)\s*([^:]+)(?::\s*(.*))?$/);return {visibility: match?.[1] || '+', name: match?.[2]?.trim() || s, type: match?.[3] || 'String'};}),
  operations: (data.methods || '').split('\n').filter(Boolean).map(s => {const match = s.match(/^([+\-#~]?)\s*([^(:]+)\((.*?)\)(?::\s*(.*))?$/);return {visibility: match?.[1] || '+', name: match?.[2]?.trim() || s, parameters: match?.[3] || '', type: match?.[4] || 'void'};}),
};
export const memberText = (rows, operations) => rows.map(r => `${r.visibility} ${r.name}${operations ? `(${r.parameters || ''})` : ''}: ${r.type}`).join('\n');
// Text style keys shared by class heading, attributes and operations.
export const CLASS_TEXT_ATTRS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'fill', 'lineHeight'];
// Class box geometry scaled by effective heading/member font sizes; defaults 14/12 keep the original 21/42/56/19px layout.
// X6 advances member lines by parseFloat(lineHeight||'1em') * fontSize, so an explicit lineHeight must drive lineH too.
export const classGeometry = attrs => {
  const member = Number(attrs?.fields?.fontSize) || 12;
  const title = Number(attrs?.label?.fontSize) || 14;
  const k = member / 12, kt = title / 14;
  const spacing = parseFloat(attrs?.fields?.lineHeight);
  const lineH = Number.isFinite(spacing) ? Math.max(15, Math.ceil(member * spacing)) : Math.max(15, Math.round(19 * k));
  const line1 = Math.round(42 * kt);
  const fieldsTop = line1 + Math.round(14 * k);
  const divider = count => fieldsTop + 6 + Math.max(1, count) * lineH;
  return {labelRefY: Math.round(21 * kt), line1, fieldsTop, lineH, divider,
    methodsGap: Math.max(15, Math.round(15 * k)),
    height: (attributeCount, operationCount) => divider(attributeCount) + Math.round(35 * k) + Math.max(1, operationCount) * lineH};
};
// Re-apply class box geometry on a live node after text style or member changes.
export const relayoutClassNode = node => {
  const members = membersOf(node.getData());
  const g = classGeometry(node.attr());
  const divider = g.divider(members.attributes.length);
  node.attr('label/refY', g.labelRefY);
  node.attr('line1/d', `M0 ${g.line1} H240`);
  node.attr('line2/d', `M0 ${divider} H240`);
  node.attr('fields/refY', g.fieldsTop);
  node.attr('methods/refY', divider + g.methodsGap);
  node.resize(node.size().width, g.height(members.attributes.length, members.operations.length));
};
export default ({data, readOnly, onChange}) => {
  const members = membersOf(data);
  return <>{['attributes', 'operations'].map(kind => <section className='pv-members' key={kind}><h3>{t(kind)}</h3>
    {members[kind].map((row, i) => <div className={`pv-member-row ${kind}`} key={i}>
      <select aria-label={t('visibility')} disabled={readOnly} value={row.visibility} onChange={e => onChange({...members, [kind]: members[kind].map((r, j) => i === j ? {...r, visibility: e.target.value} : r)})}>{['+', '-', '#', '~'].map(v => <option key={v}>{v}</option>)}</select>
      {['name', ...(kind === 'operations' ? ['parameters'] : []), 'type'].map(k => <input key={k} aria-label={t(k)} placeholder={t(k)} disabled={readOnly} value={row[k] || ''} onChange={e => onChange({...members, [kind]: members[kind].map((r, j) => i === j ? {...r, [k]: e.target.value} : r)})} />)}
      <Action disabled={readOnly} onClick={() => onChange({...members, [kind]: members[kind].filter((r, j) => j !== i)})}>×</Action>
    </div>)}<Action disabled={readOnly} onClick={() => onChange({...members, [kind]: [...members[kind], {visibility: '+', name: kind === 'attributes' ? 'attribute' : 'operation', type: kind === 'attributes' ? 'String' : 'void', parameters: ''}]})}>＋ {t('addMember')}</Action>
  </section>)}</>;
};
