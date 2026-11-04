import React from 'react';
// Category glyphs describe notation, never stand in for a template's actual content.
export default ({typeId, className = ''}) => {
  const rect=(x,y,w=14,h=10)=><rect x={x} y={y} width={w} height={h} rx='2' />;
  const glyph={
    flowchart:<>{rect(1,14)}<path d='M15 19H24M38 19H47M31 26V35H8V24'/><path d='M31 11L39 19L31 27L23 19Z'/>{rect(47,14)}</>,
    swimlane:<><rect x='1' y='2' width='61' height='34'/><path d='M12 2V36M1 19H62M33 10H47V27'/>{rect(19,6,14,8)}{rect(40,25,14,8)}</>,
    architecture:<><rect x='1' y='2' width='61' height='34'/>{rect(6,7,51,7)}{rect(6,23,22,8)}{rect(35,23,22,8)}</>,
    mindmap:<><ellipse cx='31' cy='19' rx='11' ry='7'/><path d='M20 17L9 7M42 15L54 6M42 23L54 33'/>{rect(1,2,13,8)}{rect(50,1,13,8)}{rect(50,29,13,8)}</>,
    orgchart:<>{rect(24,1,15,9)}<path d='M31 10V20H8V28M31 20H55V28M31 20V28'/>{rect(1,28,14,9)}{rect(24,28,14,9)}{rect(48,28,14,9)}</>,
    'uml-usecase':<><circle cx='6' cy='9' r='4'/><path d='M6 13V25L1 35M6 25L12 35M1 18H12M12 18L29 12M12 18L29 29'/><rect x='21' y='1' width='42' height='36'/><ellipse cx='44' cy='12' rx='15' ry='6'/><ellipse cx='44' cy='29' rx='15' ry='6'/></>,
    'uml-class':<>{rect(1,1,24,36)}{rect(39,1,24,36)}<path d='M1 13H25M1 25H25M39 13H63M39 25H63M25 19H39'/></>,
    sequence:<>{[2,26,50].map(x=><g key={x}>{rect(x,1,12,8)}<path d={`M${x+6} 9V37`} strokeDasharray='3 3'/></g>)}<path d='M8 17H32L28 14M32 28H56L52 25'/></>,
    'er-sketch':<>{rect(1,15,15,11)}<path d='M16 20H25M39 20H48M9 8V15'/><path d='M32 12L40 20L32 28L24 20Z'/>{rect(48,15,15,11)}<ellipse cx='9' cy='5' rx='8' ry='4'/></>,
  };
  return <svg className={`pv-type-icon ${className}`} viewBox='0 0 66 40' fill='none' stroke='currentColor' strokeWidth='1.35' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>{glyph[typeId] || glyph.architecture}</svg>;
};
