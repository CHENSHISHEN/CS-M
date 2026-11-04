import DocumentTextStyle, {textCSS} from './DocumentTextStyle';
import React, { useRef, useState, useEffect } from 'react';
import { platformId } from '../../../lib/drawing_platform';
import { t, Field, Action, useDocumentHistory, ExportActions, Dialog, ResizeHandle, usePanelWidth } from './common';

export default ({doc, onChange, readOnly, onCommands}) => {
  const [panel, setPanel] = useState(window.innerWidth > 1280);const [panelWidth, setPanelWidth] = usePanelWidth('sequence');
  const history = useDocumentHistory(doc, onChange, readOnly); const svgRef = useRef(null);
  const [selected, setSelected] = useState(''); const [error, setError] = useState(''); const [removing, setRemoving] = useState(null);
  const seq = doc.sequenceData; const {participants, messages, fragments} = seq;
  const selectedMessage = messages.find(m => m.id === selected);
  const width = Math.max(900, 220 + participants.length * 250); const height = Math.max(520, 190 + messages.length * 86);
  const xOf = id => 150 + participants.findIndex(p => p.id === id) * 250;
  const change = fn => {try {history.apply(d => ({...d, sequenceData: fn(d.sequenceData)}));setError('');} catch (err) {setError(`${t('fragmentOrder')} · ${selectedMessage?.text || ''}`);}};
  const patchMessage = (id, patch) => change(s => ({...s, messages: s.messages.map(m => m.id === id ? {...m, ...patch} : m)}));
  const addMessage = () => {
    if (participants.length < 2) {setError(t('needParticipants'));return;}
    const m = {id: platformId('message'), from: participants[0].id, to: participants[1].id, text: t('newMessage'), kind: 'sync', fragmentId: ''};
    change(s => ({...s, messages: [...s.messages, m]}));setSelected(m.id);
  };
  const sourceLines = ['@startuml', ...participants.map((p, i) => `participant ${JSON.stringify(p.name)} as p${i + 1}`)];let openFragment = '';let branch = '';
  messages.forEach(m => {if (openFragment !== m.fragmentId) {if (openFragment) sourceLines.push('end');const f = fragments.find(a => a.id === m.fragmentId);if (f) sourceLines.push(`${f.kind} [${f.label}]`);openFragment = m.fragmentId;branch = '';}
    if (m.fragmentBranch === 'else' && branch !== 'else' && openFragment) sourceLines.push(`else [${fragments.find(a => a.id === openFragment)?.elseLabel || t('otherwise')}]`);branch = m.fragmentBranch;
    sourceLines.push(`p${participants.findIndex(p => p.id === m.from) + 1} ${m.kind === 'return' ? '-->' : m.kind === 'async' ? '->>' : '->'} p${participants.findIndex(p => p.id === m.to) + 1}: ${m.text.replace(/\n/g, ' ')}`);
  });if (openFragment) sourceLines.push('end');sourceLines.push('@enduml');const sourceText = sourceLines.join('\n');

  const reorder = (index, offset) => {if (index + offset < 0 || index + offset >= messages.length) return;change(s => {const a = s.messages.slice();[a[index], a[index + offset]] = [a[index + offset], a[index]];return {...s, messages: a};});};
  useEffect(() => {onCommands?.({selection:()=>[selected],properties:()=>setPanel(v=>!v)});});
  return <div className='pv-editor pv-sequence-editor' style={textCSS(doc.textStyle)} tabIndex={0} onKeyDown={history.keyDown}>
    <DocumentTextStyle doc={doc} readOnly={readOnly} onChange={history.apply}/><aside className='pv-sidebar'><header><strong>{t('participants')}</strong></header>
      {participants.map(p => <div className='pv-participant' key={p.id}><input aria-label={t('participantName')} disabled={readOnly} value={p.name} onChange={e => change(s => ({...s, participants: s.participants.map(a => a.id === p.id ? {...a, name: e.target.value} : a)}))} />
        <Action disabled={readOnly} onClick={() => setRemoving(p)}>×</Action></div>)}
      <Action disabled={readOnly} onClick={() => change(s => ({...s, participants: [...s.participants, {id: platformId('participant'), name: `${t('participant')} ${s.participants.length + 1}`}]}))}>＋ {t('participant')}</Action>
      <h3>{t('fragments')}</h3>{fragments.map(f => <div key={f.id} className='pv-fragment'><strong>{f.kind}</strong><input aria-label={t('condition')} disabled={readOnly} value={f.label} onChange={e => change(s => ({...s, fragments: s.fragments.map(a => a.id === f.id ? {...a, label: e.target.value} : a)}))} />
        {f.kind === 'alt' && <input aria-label={t('elseCondition')} value={f.elseLabel || ''} disabled={readOnly} onChange={e => change(s => ({...s, fragments: s.fragments.map(a => a.id === f.id ? {...a, elseLabel: e.target.value} : a)}))} />}
        <Action disabled={readOnly} onClick={() => change(s => ({...s, fragments: s.fragments.filter(a => a.id !== f.id), messages: s.messages.map(m => m.fragmentId === f.id ? {...m, fragmentId: ''} : m)}))}>×</Action></div>)}
      {['alt', 'opt', 'loop'].map(kind => <Action key={kind} disabled={readOnly} onClick={() => change(s => ({...s, fragments: [...s.fragments, {id: platformId('fragment'), kind, label: t('condition'), elseLabel: t('otherwise')}]}))}>＋ {kind}</Action>)}
    </aside>
    <main className='pv-editor-main'><div className='pv-tools'><Action disabled={readOnly} onClick={addMessage}>＋ {t('message')}</Action>
      <Action disabled={readOnly || !history.canUndo} onClick={history.undo}>{t('undo')}</Action><Action disabled={readOnly || !history.canRedo} onClick={history.redo}>{t('redo')}</Action>
      <Action onClick={() => setPanel(!panel)}>{t('properties')}</Action><ExportActions doc={doc} svgRef={svgRef} onError={e => setError(e.message)} /></div>
      {error && <div className='pv-error' role='alert'>{error}<Action onClick={() => setError('')}>×</Action></div>}
      <div className='pv-sequence-preview'><svg ref={svgRef} xmlns='http://www.w3.org/2000/svg' viewBox={`0 0 ${width} ${height}`}>
        <rect width={width} height={height} fill='#fff' />
        {messages.map((m, i) => selected === m.id && <rect key={`selection-${m.id}`} x='45' y={101 + i * 86} width={width - 90} height='60' rx='5' fill='#eeedff' />)}
        <defs><marker id={`arrow-${doc.id}`} markerWidth='9' markerHeight='8' refX='8' refY='4' orient='auto'><path d='M0,0 L8,4 L0,8' fill='none' stroke='#596b87' /></marker><marker id={`sync-${doc.id}`} markerWidth='9' markerHeight='8' refX='8' refY='4' orient='auto'><path d='M0,0 L8,4 L0,8 Z' fill='#596b87' /></marker></defs>
        {participants.map(p => <g key={p.id}><rect x={xOf(p.id) - 80} y='25' width='160' height='40' rx='5' fill='#f4f6fb' stroke='#bdcadd' />
          <text x={xOf(p.id)} y='50' textAnchor='middle' fontSize='14' fill='#26354b' fontFamily='sans-serif'>{p.name.slice(0, 18)}</text>
          <path d={`M${xOf(p.id)} 65 V${height - 35}`} stroke='#bdcadd' strokeDasharray='6 5' /></g>)}
        {fragments.map(f => {const indices = messages.map((m, i) => m.fragmentId === f.id ? i : -1).filter(i => i >= 0);if (!indices.length) return null;
          const y = 95 + Math.min(...indices) * 86;const h = (Math.max(...indices) - Math.min(...indices) + 1) * 86;
          const elseIndex = messages.findIndex(m => m.fragmentId === f.id && m.fragmentBranch === 'else');
          return <g key={f.id}><rect x='40' y={y} width={width - 80} height={h} fill='none' stroke='#a7b8cf' /><rect x='40' y={y} width='65' height='23' fill='#eef1fa' stroke='#a7b8cf' />
            <text x='49' y={y + 16} fontSize='12' fill='#26354b'>{f.kind}</text><text x='118' y={y + 16} fontSize='12' fill='#586b83'>[{f.label}]</text>{f.kind === 'alt' && elseIndex >= 0 && <><path d={`M40 ${105 + elseIndex * 86} H${width - 40}`} stroke='#a7b8cf' strokeDasharray='6 4' /><text x='118' y={121 + elseIndex * 86} fontSize='12' fill='#586b83'>[{f.elseLabel || t('otherwise')}]</text></>}</g>;
        })}
        {messages.filter(m => m.kind === 'sync').map(m => {const i = messages.indexOf(m);const reply = messages.findIndex((r, j) => j > i && r.kind === 'return' && r.from === m.to && r.to === m.from);return <rect key={`activation-${m.id}`} x={xOf(m.to) - 6} y={132 + i * 86} width='12' height={reply >= 0 ? (reply - i) * 86 : 24} fill='#e7ecf6' stroke='#a7b8cf' />;})}
        {messages.map((m, i) => {const from = xOf(m.from);const to = xOf(m.to);const y = 132 + i * 86;return <g key={m.id} role='button' aria-label={m.text} onClick={() => setSelected(m.id)}>
          <path d={from === to ? `M${from} ${y} h65 v28 h-65` : `M${from} ${y} H${to}`} fill='none' stroke={selected === m.id ? '#5145cd' : '#596b87'} strokeWidth='1.7' strokeDasharray={m.kind === 'return' ? '6 4' : ''} markerEnd={`url(#${m.kind === 'sync' ? 'sync' : 'arrow'}-${doc.id})`} />
          <text x={(from + to) / 2 + (from === to ? 45 : 0)} y={y - 11} textAnchor='middle' fontSize='13' fill='#26354b' fontFamily='sans-serif'>{i + 1}  {m.text.slice(0, 35)}</text>
        </g>;})}
      </svg></div>
      <div className='pv-message-table'><h3>{t('messages')}</h3><table><thead><tr><th>#</th><th>{t('from')}</th><th>{t('to')}</th><th>{t('name')}</th><th>{t('kind')}</th><th>{t('actions')}</th></tr></thead><tbody>
        {messages.map((m, i) => <tr key={m.id} className={selected === m.id ? 'selected' : ''} onClick={() => setSelected(m.id)}><td>{i + 1}</td>
          {['from', 'to'].map(k => <td key={k}><select aria-label={t(k)} disabled={readOnly} value={m[k]} onChange={e => patchMessage(m.id, {[k]: e.target.value})}>{participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>)}
          <td><input aria-label={t('messageName')} value={m.text} disabled={readOnly} onChange={e => patchMessage(m.id, {text: e.target.value})} /></td>
          <td><select value={m.kind} disabled={readOnly} onChange={e => patchMessage(m.id, {kind: e.target.value})}>{['sync', 'async', 'return'].map(k => <option key={k} value={k}>{t(k)}</option>)}</select></td>
          <td><Action disabled={readOnly || !i} onClick={() => reorder(i, -1)}>↑</Action><Action disabled={readOnly || i === messages.length - 1} onClick={() => reorder(i, 1)}>↓</Action><Action disabled={readOnly} onClick={() => change(s => ({...s, messages: s.messages.filter(a => a.id !== m.id)}))}>×</Action></td></tr>)}
      </tbody></table><details><summary>{t('generatedSource')}</summary><textarea readOnly aria-label={t('generatedSource')} value={sourceText} /></details>{!messages.length && <p className='pv-empty'>{t('addMessageHint')}</p>}</div>
    </main>
    {panel && <><ResizeHandle side='right' startWidth={panelWidth} onWidth={setPanelWidth} /><aside className='pv-inspector' style={{width: panelWidth}}><header><strong>{t('messageProperties')}</strong><Action onClick={() => setPanel(false)}>×</Action></header>{selectedMessage ? <>
      <Field label={t('name')}><input disabled={readOnly} value={selectedMessage.text} onChange={e => patchMessage(selectedMessage.id, {text: e.target.value})} /></Field>
      <Field label={t('fragments')}><select value={selectedMessage.fragmentId} disabled={readOnly} onChange={e => patchMessage(selectedMessage.id, {fragmentId: e.target.value})}><option value=''>{t('none')}</option>{fragments.map(f => <option key={f.id} value={f.id}>{f.kind} [{f.label}]</option>)}</select></Field>
      {fragments.find(f => f.id === selectedMessage.fragmentId)?.kind === 'alt' && <Field label={t('fragmentBranch')}><select value={selectedMessage.fragmentBranch || 'main'} disabled={readOnly} onChange={e => patchMessage(selectedMessage.id, {fragmentBranch: e.target.value})}><option value='main'>{t('mainBranch')}</option><option value='else'>{t('otherwise')}</option></select></Field>}<p className='pv-note'>{t('sequenceHint')}</p>
    </> : <p className='pv-note'>{t('selectMessage')}</p>}</aside></>}
    {removing && <Dialog title={t('deleteParticipant')} onClose={() => setRemoving(null)}><div className='pv-picker'><p>{t('deleteParticipantHint', {name: removing.name, count: messages.filter(m => m.from === removing.id || m.to === removing.id).length})}</p>
      <Action primary onClick={() => {change(s => ({...s, participants: s.participants.filter(p => p.id !== removing.id), messages: s.messages.filter(m => m.from !== removing.id && m.to !== removing.id)}));setRemoving(null);}}>{t('confirm')}</Action></div></Dialog>}
  </div>;
};
