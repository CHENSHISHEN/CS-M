import React from 'react';
import FormatBar from './FormatBar';
import {en} from './common';
export const textCSS = style => ({'--drawing-font':style?.['label/fontFamily'] || '-apple-system, PingFang SC, sans-serif','--drawing-font-size':`${style?.['label/fontSize'] || 14}px`,'--drawing-text-color':style?.['label/fill'] || '#303746','--drawing-text-weight':style?.['label/fontWeight'] || 400,'--drawing-text-style':style?.['label/fontStyle'] || 'normal','--drawing-text-decoration':style?.['label/textDecoration'] || 'none'});
export default ({doc,readOnly,onChange}) => <FormatBar selection={[]} readOnly={readOnly} defaults={doc.textStyle || {}} mutate={()=>{}} onDefault={(key,value)=>onChange({...doc,textStyle:{...doc.textStyle,[key]:value}})} textOnly scopeLabel={en()?'All diagram text':'当前图稿全部文字'}/>;
