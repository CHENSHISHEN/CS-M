import React, {useRef,useState} from 'react';
import {Dialog,Field,Action,en,t} from './common';
export default ({cell,readOnly,onChange,onClose}) => {
  const ref=useRef(null);const [range,setRange]=useState([0,0]),[error,setError]=useState(''),[draft,setDraft]=useState({text:cell.attr('label/text') || '',annotations:cell.attr('label/annotations') || []});
  const text=(a,b)=>en()?b:a;
  const change=next=>{setDraft(next);onChange(next);};
  const format=attrs=>{const [start,end]=range;if(start===end){setError(text('请先选择一段文字。','Select a text range first.'));return;}if(cell.getData()?.chenKind==='key'&&attrs.textDecoration)attrs={...attrs,textDecoration:'underline'};change({...draft,annotations:[...draft.annotations,{start,end,attrs}]});setError('');};
  return <Dialog title={text('文字与局部格式','Text and range formatting')} onClose={onClose}><div className='pv-picker'><p className='pv-note'>{text('选中文字后设置格式；修改即时进入绘图自动保存。','Select text to format it. Changes enter drawing autosave immediately.')}</p><Field label={text('图形文字','Shape text')}><textarea ref={ref} aria-label={text('局部格式文字','Range formatting text')} disabled={readOnly} value={draft.text} onChange={e=>change({text:e.target.value,annotations:[]})} onSelect={e=>setRange([e.currentTarget.selectionStart,e.currentTarget.selectionEnd])}/></Field>
    <div className='pv-field-row'>{[['B',{fontWeight:700}],['I',{fontStyle:'italic'}],['U',{textDecoration:'underline'}],['S',{textDecoration:'line-through'}]].map(([label,attrs])=><Action key={label} disabled={readOnly} onMouseDown={e=>e.preventDefault()} onClick={()=>format(attrs)}>{label}</Action>)}<input type='color' aria-label={text('局部字色','Range color')} disabled={readOnly} onChange={e=>format({fill:e.target.value})}/><Action disabled={readOnly} onClick={()=>change({...draft,annotations:[]})}>{text('清除局部格式','Clear range formats')}</Action></div>
    {error&&<p role='alert'>{error}</p>}<p className='pv-note'>{range[0]}–{range[1]} · {draft.annotations.length} {text('处格式','formats')}</p><Action onClick={onClose}>{t('close')}</Action>
  </div></Dialog>;
};
