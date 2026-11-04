import React,{useEffect,useState,useRef} from 'react';
import DrawingDocument from '../../../../public/drawing-document';
import {pageSvg} from './PageExport';
const cache=new Map();
export const contentKey = doc => {
  const identities=new Map();const collect=v=>{if(v&&typeof v==='object'){if(v.id&&!identities.has(v.id))identities.set(v.id,`id${identities.size}`);Object.values(v).forEach(collect);}};collect(doc);
  const visit=v=>typeof v==='string'?identities.get(v)||v:Array.isArray(v)?v.map(visit):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[identities.get(k)||k,visit(x)])):v;
  const {id,defKey,defName,revision,...content}=doc;const text=JSON.stringify(visit(content));let hash=2166136261;for(let i=0;i<text.length;i+=1){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16);
};let queue=Promise.resolve();let fontVersion=0;if(document.fonts?.addEventListener)document.fonts.addEventListener('loadingdone',()=>{fontVersion+=1;cache.clear();window.dispatchEvent(new Event('pdmaner-preview-fonts'));});
export default ({doc,cacheKey,title}) => {
  const [fontEpoch,setFontEpoch]=useState(fontVersion);useEffect(()=>{const change=()=>setFontEpoch(fontVersion);window.addEventListener('pdmaner-preview-fonts',change);return()=>window.removeEventListener('pdmaner-preview-fonts',change);},[]);
  cacheKey=`${cacheKey}:${contentKey(doc)}:renderer3:${fontEpoch}:${window.devicePixelRatio || 1}`;
  const host=useRef(null);const [visible,setVisible]=useState(false);
  useEffect(()=>{if(!window.IntersectionObserver){setVisible(true);return undefined;}const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'250px'});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
  const [uri,setUri]=useState(cache.get(cacheKey)?.uri || ''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{if(!visible)return undefined;let live=true;setError('');let entry=cache.get(cacheKey);
    setUri(entry?.uri || '');if(!entry){entry={users:0};entry.promise=queue.catch(()=>{}).then(async()=>{if(!entry.users)throw Error('Preview cancelled');if(window.document.fonts)await window.document.fonts.ready;const document=doc.schemaVersion===2?doc:DrawingDocument.upgrade(doc);const svg=await pageSvg(document,document.pages[0]);entry.uri=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;return entry.uri;});cache.set(cacheKey,entry);if(cache.size>100)cache.delete(cache.keys().next().value);queue=entry.promise.catch(()=>{});}
    entry.users=(entry.users || 0)+1;entry.promise.then(value=>{if(live)setUri(value);},err=>{cache.delete(cacheKey);if(live)setError(err.message);});
    return()=>{live=false;entry.users=Math.max(0,entry.users-1);};
  },[cacheKey,attempt,visible]);
  if(error)return <div ref={host} className='pv-real-preview pv-thumbnail-error' role='status'><span>{error}</span><button type='button' onClick={()=>setAttempt(v=>v+1)}>↻</button></div>;
  return uri?<img ref={host} className='pv-real-preview pv-rendered-thumbnail' src={uri} alt={title || doc.defName}/>:<div ref={host} className='pv-real-preview pv-thumbnail-loading' role='status' aria-label='Rendering preview'><span>···</span></div>;
};
