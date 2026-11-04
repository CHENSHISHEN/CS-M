import React, {useState} from 'react';
import {Graph} from '@antv/x6';
import DrawingDocument from '../../../../public/drawing-document';
import {registerPlatformShapes, decoratePlatformCell} from './GraphEditor';
import {Action, Dialog, Field, en, download, exportVector} from './common';
const safeName=value=>String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100);
export const pageSvg = async (doc,page,includeHidden=false) => {
  registerPlatformShapes();const div=document.createElement('div');div.style.cssText='position:fixed;left:-20000px;top:0;width:1600px;height:1000px;';document.body.appendChild(div);
  const graph=new Graph({container:div,width:1600,height:1000,interacting:false,background:{color:page.scene.pageStyle?.background || '#ffffff'}});
  try{
    const canvas=DrawingDocument.isChen(doc)?DrawingDocument.project(page):DrawingDocument.projectLegacy(page);
    graph.fromJSON({cells:canvas.cells.map(c=>decoratePlatformCell(includeHidden?{...c,visible:true}:c))});
    return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Export timed out')),10000);graph.toSVG(svg=>{clearTimeout(timer);resolve(svg);},{preserveDimensions:true,copyStyles:false,padding:30});});
  }finally{graph.dispose();div.remove();}
};
export default ({doc,current,onClose}) => {
  const [chosen,setChosen]=useState([current]),[format,setFormat]=useState('svg'),[includeHidden,setIncludeHidden]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const text=(zh,eng)=>en()?eng:zh;
  return <Dialog title={text('导出画布','Export canvases')} onClose={()=>{if(!busy)onClose();}}><div className='pv-picker'>
    <div className='pv-field-row'><Action disabled={busy} onClick={()=>setChosen([current])}>{text('当前画布','Current canvas')}</Action><Action disabled={busy} onClick={()=>setChosen(doc.pages.map(p=>p.id))}>{text('全部画布','All canvases')}</Action></div>
    {doc.pages.map(p=><label className='pv-pack-option' key={p.id}><input type='checkbox' disabled={busy} checked={chosen.includes(p.id)} onChange={e=>setChosen(e.target.checked?[...chosen,p.id]:chosen.filter(id=>id!==p.id))}/>{p.name}</label>)}
    <Field label={text('格式','Format')}><select disabled={busy} value={format} onChange={e=>setFormat(e.target.value)}><option value='svg'>SVG</option><option value='png'>PNG</option></select></Field>
    <label className='pv-pack-option'><input type='checkbox' disabled={busy} checked={includeHidden} onChange={e=>setIncludeHidden(e.target.checked)}/>{text('包含隐藏图层','Include hidden layers')}</label>
    <p className='pv-note'>{text('多画布分别导出，文件名包含顺序和画布名称。','Each canvas is exported separately with its index and name.')}</p>
    {error&&<p role='alert' className='pv-error'>{error}</p>}
    <Action primary disabled={busy||!chosen.length} onClick={async()=>{setBusy(true);setError('');try{for(const [index,p] of doc.pages.entries()){if(!chosen.includes(p.id))continue;const svg=await pageSvg(doc,p,includeHidden);const name=`${safeName(doc.defName)}-${String(index+1).padStart(2,'0')}-${safeName(p.name)}`;if(format==='svg')download(name+'.svg',svg,'image/svg+xml');else{const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;await exportVector(root,name,true);}}onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?text('正在导出…','Exporting…'):text('导出所选画布','Export selected canvases')}</Action>
  </div></Dialog>;
};
