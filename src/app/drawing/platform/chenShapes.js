let registered = false;
// Fixed oil-paint texture: one built-in SVG pattern, registered once per graph.
// No external images, no downloadable textures, no executable markup.
const oilPatternMarkup = [{tagName: 'pattern', selector: 'oilPattern', attrs: {id: 'chen-oil', width: 16, height: 16, patternUnits: 'userSpaceOnUse'}, children: [
  {tagName: 'rect', attrs: {width: 16, height: 16, fill: 'none'}},
  {tagName: 'path', attrs: {d: 'M0 4 Q8 0 16 4 T16 12', fill: 'none', stroke: '#e8c49a', strokeWidth: 1.1, opacity: 0.55}},
  {tagName: 'path', attrs: {d: 'M0 11 Q8 8 16 11', fill: 'none', stroke: '#9db3d8', strokeWidth: 0.9, opacity: 0.45}},
]}];
export const registerChenShapes = Graph => {
  if (registered) return;registered = true;
  ['entity','weak','relationship','identifying','attribute','multi','derived','key','partial-key'].forEach(kind => {
    const diamond=['relationship','identifying'].includes(kind), ellipse=['attribute','multi','derived','key','partial-key'].includes(kind);
    const shape=diamond?'polygon':ellipse?'ellipse':'rect';
    const attrs=diamond?{refPoints:'0,50 50,0 100,50 50,100'}:ellipse?{refCx:'50%',refCy:'50%',refRx:'50%',refRy:'50%'}:{refWidth:'100%',refHeight:'100%'};
    const inner=diamond?{ref:'insetBounds',refPoints:'0,50 50,0 100,50 50,100',refWidth:'100%',refHeight:'100%'}:ellipse?{ref:'insetBounds',refCx:'50%',refCy:'50%',refRx:'50%',refRy:'50%'}:{refX:4,refY:4,refWidth:-8,refHeight:-8};
    Graph.registerNode(`chen-${kind}`, {inherit:'rect',markup:[
        {tagName:shape,selector:'body'},{tagName:'rect',selector:'insetBounds'},{tagName:shape,selector:'innerShape'},
        ...oilPatternMarkup,
        {tagName:shape,selector:'oilShape'},
        {tagName:'path',selector:'sketchOuter'},{tagName:'path',selector:'sketchInner'},
        {tagName:'path',selector:'keyLine'},{tagName:'text',selector:'label'}],
      attrs:{insetBounds:{refX:4,refY:4,refWidth:-8,refHeight:-8,fill:'none',stroke:'none',opacity:0},body:{...attrs,stroke:'#3566af',fill:'#fff',strokeWidth:1.5,strokeDasharray:kind==='derived'?'5 4':''},
        innerShape:{...inner,fill:'none',stroke:'#3566af',strokeWidth:1,visibility:['weak','identifying','multi'].includes(kind)?'visible':'hidden'},
        oilShape:{...attrs,fill:'url(#chen-oil)',stroke:'#3566af',strokeWidth:1.2,visibility:'hidden',pointerEvents:'none'},
        sketchOuter:{d:'M0 0',fill:'#fff',stroke:'#3566af',strokeWidth:1.6,visibility:'hidden',pointerEvents:'none'},
        sketchInner:{d:'M0 0',fill:'none',stroke:'#3566af',strokeWidth:1.1,visibility:'hidden',pointerEvents:'none'},
        keyLine:{d:'M-25 12H25',refX:'50%',refY:'50%',stroke:'#303746',strokeDasharray:'4 3',visibility:'hidden'},
        label:{refX:'50%',refY:'50%',textAnchor:'middle',textVerticalAnchor:'middle',fontSize:14,fill:'#303746',textWrap:{width:-12,height:-10,ellipsis:true}}}});
  });
  Graph.registerEdge('chen-edge',{inherit:'edge',markup:[{tagName:'path',selector:'wrap',attrs:{fill:'none',cursor:'pointer',stroke:'transparent',strokeWidth:12}},{tagName:'path',selector:'line',attrs:{fill:'none'}},{tagName:'path',selector:'inner',attrs:{fill:'none'}}],attrs:{wrap:{connection:true},line:{connection:true,stroke:'#64748b',strokeWidth:1.3,targetMarker:null},inner:{connection:true,stroke:'#fff',strokeWidth:0,pointerEvents:'none'}}});
};
