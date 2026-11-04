import React from 'react';
import DrawingDocument from '../../../../public/drawing-document';
import {roleColors} from './ChenAppearance';
const OIL_PATTERN = <defs><pattern id='chen-oil' width='16' height='16' patternUnits='userSpaceOnUse'>
  <path d='M0 4 Q8 0 16 4 T16 12' fill='none' stroke='#e8c49a' strokeWidth='1.1' opacity='0.55'/>
  <path d='M0 11 Q8 8 16 11' fill='none' stroke='#9db3d8' strokeWidth='0.9' opacity='0.45'/>
</pattern></defs>;
export default ({shape, look}) => {
  const kind=shape.id.replace(/^chen-/,'');
  const ellipse=['ellipse','start','usecase','attribute','composite','multi','derived','key','partial-key'].includes(kind),diamond=['decision','relationship','identifying'].includes(kind);
  const chen=shape.pack==='chen';
  const theme=chen&&look?DrawingDocument.chenThemes[look.themeId]||DrawingDocument.chenThemes.default:null;
  const colors=chen&&look?roleColors(kind,look.themeId):null;
  const sketch=chen&&look&&look.styleId==='sketch',oil=chen&&look&&look.styleId==='oil';
  const outline=(inset,props)=><g {...props}>{diamond?<polygon points={`40,${7+inset} ${71-inset},25 40,${43-inset} ${9+inset},25`}/>:ellipse?<ellipse cx='40' cy='25' rx={31-inset} ry={17-inset}/>:<rect x={9+inset} y={8+inset} width={62-inset*2} height={34-inset*2} rx={['rounded','activity'].includes(kind)?7:1}/>}</g>;
  const seed=`glyph-${kind}`;
  // Sketch outlines live inside the same 62x34 outer box the regular outline uses
  // within the 80x50 viewBox; sketchD itself shrinks by inset*2, so the inner
  // (double-line) variant passes the OUTER box plus inset — never pre-shrunk sizes
  // (double reduction) and never sizes that overflow the viewBox.
  // POLISH-v3: at preview sizes DrawingDocument.sketchD's midpoint-anchored curves
  // cut corners by half and read as an oval, so the same weak entity no longer looks
  // like the same shape across the three style cards. Rect-family previews draw a
  // corner-preserving wobble instead (corners stay on the curve, edges bow slightly,
  // deterministic per phase); diamonds/ellipses keep sketchD.
  const previewSketchD=(inset,phase)=>{
    const c=[[inset,inset],[62-inset,inset],[62-inset,34-inset],[inset,34-inset]];
    const q=(a,b,dx,dy)=>`${(a[0]+b[0])/2+dx} ${(a[1]+b[1])/2+dy}`;
    return `M${c[0][0]} ${c[0][1]}`
      +` Q${q(c[0],c[1],0,-(2.2+phase))} ${c[1][0]} ${c[1][1]}`
      +` Q${q(c[1],c[2],1.6-phase,0)} ${c[2][0]} ${c[2][1]}`
      +` Q${q(c[2],c[3],0,2.2+phase)} ${c[3][0]} ${c[3][1]}`
      +` Q${q(c[3],c[0],-(1.6-phase),0)} ${c[0][0]} ${c[0][1]} Z`;
  };
  const boxKind=!diamond&&!ellipse;
  const sketchPath=inset=>boxKind?previewSketchD(inset?4:0,inset?0.9:0.4):DrawingDocument.sketchD(diamond?'relationship':'attribute',62,34,seed,inset?4:0);
  return <svg viewBox='0 0 80 50' className='pv-shape-glyph' aria-hidden='true'>
    {oil&&OIL_PATTERN}
    {sketch
      ? <g fill={colors?colors.fill:'none'} stroke={colors?colors.stroke:'currentColor'} strokeWidth='1.6' strokeDasharray={kind==='derived'?'4 3':undefined}><path transform='translate(9,8)' d={sketchPath(0)}/>{['weak','identifying','multi'].includes(kind)&&<path transform='translate(13,12)' d={sketchPath(4)}/>}</g>
      : outline(0,{stroke:colors?colors.stroke:'currentColor',fill:colors?colors.fill:'none',strokeWidth:'1.5',strokeDasharray:kind==='derived'?'4 3':undefined})}
    {!sketch&&['weak','identifying','multi'].includes(kind)&&outline(4,{stroke:colors?colors.stroke:'currentColor',fill:'none',strokeWidth:'1'})}
    {!sketch&&oil&&outline(0,{fill:'url(#chen-oil)',stroke:colors?colors.stroke:'currentColor',strokeWidth:'1.2',strokeDasharray:kind==='derived'?'4 3':undefined,pointerEvents:'none'})}
    {['key','partial-key'].includes(kind)&&<><text x='40' y='29' textAnchor='middle' fontSize='12' fill={colors?colors.stroke:'currentColor'}>ID</text><path d='M31 32H49' stroke={colors?colors.stroke:'currentColor'} strokeDasharray={kind==='partial-key'?'3 2':undefined}/></>}
    {['class','interface','enum'].includes(kind)&&<path d='M9 19H71M9 31H71' stroke='currentColor'/>}
  </svg>;
};
