/* Shared by Electron's persistence service and the drawing renderer. Pure JSON only. */
let serial = 0;
const id = (prefix = 'd') => `${prefix}-${Date.now().toString(36)}-${(++serial).toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const clone = value => JSON.parse(JSON.stringify(value));
const layer = () => ({id: 'main', name: '主图层', visible: true, locked: false});
const page = name => ({id: id('page'), name, kind: 'graph', scene: {nodes: {}, edges: {}, annotations: [], layers: [layer()], pageStyle: {background: '#ffffff'}}, comments: []});
const emptyModel = () => ({entities: [], relationships: [], attributes: []});
const isChen = doc => doc.schemaVersion === 2 && doc.notation === 'chen';
const isEdge = cell => Boolean(cell.source || cell.target || cell.shape === 'edge' || cell.shape === 'chen-edge');
const allCells = doc => doc.pages ? doc.pages.reduce((a, p) => a.concat(p.scene?.annotations || [], p.scene?.cells || []), []) : doc.canvasData?.cells || [];
const upgrade = original => {
  if (original.schemaVersion === 2) return clone(original);
  const d = clone(original);const p = page('画布 1');
  p.kind = d.treeData ? 'tree' : d.sequenceData ? 'sequence' : 'graph';
  p.scene = {...p.scene, cells: clone(d.canvasData?.cells || []), pageStyle: {background: d.pageColor || '#ffffff'}};
  if (d.treeData) p.treeData = d.treeData;
  if (d.sequenceData) p.sequenceData = d.sequenceData;
  const layerIds=new Set(['main',...(p.scene.cells || []).map(c=>c.data?.layer || 'main')]);p.scene.layers=[...layerIds].map(key=>({id:key,name:key==='main'?'主图层':key,visible:true,locked:false}));
  d.schemaVersion = 2;d.notation = 'legacy-free';d.pages = [p];
  delete d.canvasData;delete d.treeData;delete d.sequenceData;delete d.pageColor;
  return d;
};
const projectLegacy = p => ({cells:(p.scene.cells || []).map(c=>{const l=p.scene.layers.find(l=>l.id===(c.data?.layer || 'main'));return {...c,visible:c.visible!==false&&l?.visible!==false,data:{...c.data,locked:Boolean(c.data?.locked || l?.locked)}};})});
const captureLegacy = (p, canvas) => {const before=new Map((p.scene.cells || []).map(c=>[c.id,c]));return canvas.cells.map(c=>{const l=p.scene.layers.find(l=>l.id===(c.data?.layer || 'main'));const old=before.get(c.id);return {...c,visible:l?.visible===false?old?.visible:c.visible,data:{...c.data,layer:l?.id || p.scene.layers[0].id,locked:l?.locked?old?.data?.locked:c.data?.locked}};});};
const semantic = p => [...p.erModel.entities, ...p.erModel.relationships, ...p.erModel.attributes];
// Chen appearance registry shared by projection, capture and the renderer UI.
// Themes are per-role color groups (fill/stroke) plus one edge color; ids and the
// nine registered shapes stay fixed so old documents keep loading unchanged.
const chenStylesById = {standard: 1, sketch: 1, oil: 1};
const chenThemes = {
  default: {label: '默认', en: 'Default', entity: {fill: '#ffffff', stroke: '#3566af'}, relationship: {fill: '#ffffff', stroke: '#3566af'}, attribute: {fill: '#ffffff', stroke: '#3566af'}, basic: {fill: '#ffffff', stroke: '#3566af'}, edge: '#64748b'},
  fresh: {label: '清新', en: 'Fresh', entity: {fill: '#e5f0fb', stroke: '#3566af'}, relationship: {fill: '#eee6fa', stroke: '#7854be'}, attribute: {fill: '#faeede', stroke: '#a46524'}, basic: {fill: '#e6f2f0', stroke: '#2f7d78'}, edge: '#6f7fae'},
  dopamine: {label: '多巴胺', en: 'Dopamine', entity: {fill: '#fdeae6', stroke: '#b0552f'}, relationship: {fill: '#fdf3cf', stroke: '#8a6116'}, attribute: {fill: '#e5f7e8', stroke: '#257a45'}, basic: {fill: '#e3eefb', stroke: '#3566af'}, edge: '#8a7bb0'},
  dusk: {label: '暮色', en: 'Dusk', entity: {fill: '#e4e9f2', stroke: '#2c4470'}, relationship: {fill: '#e3def0', stroke: '#5b4a86'}, attribute: {fill: '#e2ebe4', stroke: '#3f6b52'}, basic: {fill: '#efece6', stroke: '#7a7265'}, edge: '#7a86a8'},
};
const chenAppearanceOf = page => {const a = page?.scene?.chenAppearance;return {version: 1, styleId: chenStylesById[a?.styleId] ? a.styleId : 'standard', themeId: chenThemes[a?.themeId] ? a.themeId : 'default'};};
const chenRoleOf = kind => ['entity', 'weak'].includes(kind) ? 'entity' : ['relationship', 'identifying'].includes(kind) ? 'relationship' : 'attribute';
const hashSeed = value => {let h = 2166136261;for (let i = 0; i < value.length; i += 1) {h ^= value.charCodeAt(i);h = Math.imul(h, 16777619);}return h >>> 0;};
const mulberry = seed => () => {seed |= 0;seed = (seed + 0x6D2B79F5) | 0;let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;return ((t ^ (t >>> 14)) >>> 0) / 4294967296;};
// Deterministic hand-drawn outline: the seed is the node id and size, so the same
// object renders the identical path after reopen, clone or SVG/PNG export.
const sketchD = (kind, width, height, seedText, inset = 0) => {
  const rand = mulberry(hashSeed(`${seedText}|${kind}|${Math.round(width)}x${Math.round(height)}|${inset}`));
  const j = scale => (rand() - 0.5) * 2 * scale;
  const w = Math.max(8, width - inset * 2), h = Math.max(8, height - inset * 2);
  const diamond = ['relationship', 'identifying'].includes(kind);
  const box = ['entity', 'weak', 'rect', 'rounded'].includes(kind);
  let corners;
  if (diamond) corners = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
  else if (box) corners = [[0, 0], [w, 0], [w, h], [0, h]];
  else {corners = Array.from({length: 8}, (_, i) => {const a = Math.PI * 2 * i / 8 + j(0.07);const rx = w / 2 * (1 + j(0.05)), ry = h / 2 * (1 + j(0.07));return [w / 2 + Math.cos(a) * rx, h / 2 + Math.sin(a) * ry];});}
  const pts = corners.map(([x, y]) => [Math.max(1, Math.min(w - 1, x + j(2.2))), Math.max(1, Math.min(h - 1, y + j(2.2)))]);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[pts.length - 1], pts[0]);
  let d = `M${start[0].toFixed(2)} ${start[1].toFixed(2)}`;
  for (let i = 0; i < pts.length; i += 1) {const anchor = mid(pts[i], pts[(i + 1) % pts.length]);d += ` Q${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} ${anchor[0].toFixed(2)} ${anchor[1].toFixed(2)}`;}
  return d + ' Z';
};
const positionOf = (p, nodeId) => p.scene.nodes[nodeId] || {x: 100, y: 100, width: 140, height: 60, layerId: 'main', style: {}};
const kindOf = (p, n) => p.erModel.entities.includes(n) ? n.kind === 'weak' ? 'weak' : 'entity' : p.erModel.relationships.includes(n) ? n.kind === 'identifying' ? 'identifying' : 'relationship' : n.key === 'primary' ? 'key' : n.key === 'partial' ? 'partial-key' : n.kind === 'multivalued' ? 'multi' : n.kind === 'derived' ? 'derived' : 'attribute';
const normalizeName = name => String(name || '').trim().toLocaleLowerCase();
const errors = doc => {
  const e=[];
  if (!doc || typeof doc !== 'object' || !doc.id || ![1,2].includes(doc.schemaVersion || 1)) return ['unsupported-schema'];
  const unsafe=(v,seen=new Set())=>{if(!v||typeof v!=='object')return false;if(seen.has(v))return true;seen.add(v);const bad=Object.keys(v).some(k=>['__proto__','prototype','constructor'].includes(k)||unsafe(v[k],seen));seen.delete(v);return bad;};
  if(unsafe(doc))return ['unsafe-content'];
  const supported=new Set(['image','rect','ellipse','polygon','cylinder','edge','pv-class','pv-actor','pv-embed','drawing-rect','drawing-rounded-rect','drawing-ellipse','drawing-diamond','drawing-text','drawing-note','chen-entity','chen-weak','chen-relationship','chen-identifying','chen-attribute','chen-multi','chen-derived','chen-key','chen-partial-key','chen-edge']);
  const checkCells=cells=>{if(!Array.isArray(cells)){e.push('invalid-cells');return;}cells.forEach(c=>{if(!c||typeof c.id!=='string'||!supported.has(c.shape)){e.push('unsupported-shape');return;}if(c.markup||c.view||c.component)e.push('unsafe-content');const inspectAttrs=v=>{if(!v||typeof v!=='object')return;Object.entries(v).forEach(([key,value])=>{if(/^on[a-z]/i.test(key))e.push('unsafe-content');else inspectAttrs(value);});};inspectAttrs(c.attrs);if(c.shape==='image'){const uri=c.attrs?.image?.['xlink:href'] || c.attrs?.image?.href;if(typeof uri!=='string'||!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(uri))e.push('invalid-image');}if(c.data?.link&&!/^(https?:\/\/|mailto:)/i.test(c.data.link))e.push('invalid-link');});};
  if(doc.customShapes&&!Array.isArray(doc.customShapes))e.push('invalid-components');else (doc.customShapes || []).forEach(s=>checkCells(s?.cells));
  if (doc.schemaVersion !== 2) {checkCells(doc.canvasData?.cells || []);return Array.from(new Set(e));}
  if(!['chen','legacy-free'].includes(doc.notation))e.push('unsupported-notation');
  if (!Array.isArray(doc.pages) || !doc.pages.length || doc.pages.length > 200) return ['invalid-pages'];
  const pageIds = new Set(), names = new Set();
  doc.pages.forEach(p => {
    if(!p||typeof p!=='object'){e.push('invalid-page');return;}
    if(!Array.isArray(p.comments)||p.comments.some(c=>!c||typeof c.id!=='string'||typeof c.text!=='string'))e.push('invalid-comments');
    if (!p.id || pageIds.has(p.id)) e.push('duplicate-page');pageIds.add(p.id);
    const name=normalizeName(p.name);if (!name || name.length > 80 || names.has(name)) e.push('page-name');names.add(name);
    if (!p.scene || !Array.isArray(p.scene.layers) || !p.scene.layers.length) {e.push('invalid-scene');return;}
    if(p.scene.layers.some(l=>!l||typeof l.id!=='string'||typeof l.name!=='string')){e.push('invalid-layer');return;}
    const layers=new Set(p.scene.layers.map(l=>l.id));if(layers.size!==p.scene.layers.length)e.push('duplicate-layer');
    if (!['graph','tree','sequence'].includes(p.kind)) e.push('invalid-page-kind');
    if (isChen(doc)) {if(p.kind!=='graph')e.push('invalid-page-kind');
      const m=p.erModel;if (!m || !['entities','relationships','attributes'].every(k=>Array.isArray(m[k]))) {e.push('invalid-er');return;}
      const nodes=semantic(p), ids=new Set(nodes.map(n=>n.id));
      if(ids.size!==nodes.length || nodes.some(n=>!n.id || typeof n.name!=='string'))e.push('duplicate-node');
      const ent=new Set(m.entities.map(n=>n.id)), rel=new Set(m.relationships.map(n=>n.id)), attrs=new Map(m.attributes.map(n=>[n.id,n]));
      if(m.entities.some(n=>!['strong','weak'].includes(n.kind)))e.push('invalid-entity-kind');
      const roleIds=new Set();m.relationships.forEach(r=>{
        if(!['ordinary','identifying'].includes(r.kind) || !Array.isArray(r.roles)){e.push('invalid-relationship');return;}
        r.roles.forEach(role=>{if(!role.id || roleIds.has(role.id) || !ent.has(role.entityId))e.push('invalid-role');roleIds.add(role.id);
          if(!['one','many'].includes(role.cardinality) || !['partial','total'].includes(role.participation) || role.cardinality==='many' && !['N','M','P'].includes(role.manyLabel))e.push('invalid-role-constraint');
          if(r.kind==='identifying' && m.entities.find(n=>n.id===role.entityId)?.kind==='weak' && role.participation!=='total')e.push('weak-participation');
        });
      });
      m.attributes.forEach(a=>{
        if(!['simple','composite','multivalued','derived'].includes(a.kind)|| !['none','primary','partial'].includes(a.key))e.push('invalid-attribute');
        const owner=a.owner;const owners=owner?.type==='entity'?ent:owner?.type==='relationship'?rel:owner?.type==='attribute'?new Set(attrs.keys()):new Set();
        if(!owner || !owners.has(owner.id))e.push('missing-owner');
        if(owner?.type==='attribute' && attrs.get(owner.id)?.kind!=='composite')e.push('non-composite-owner');
        const visited=new Set([a.id]);let next=a;
        while(next?.owner?.type==='attribute'){if(visited.has(next.owner.id)){e.push('owner-cycle');break;}visited.add(next.owner.id);next=attrs.get(next.owner.id);}
        if(a.key!=='none' && (a.kind!=='simple' || next?.owner?.type==='relationship'))e.push('invalid-key');
      });
      nodes.forEach(n=>{const v=p.scene.nodes?.[n.id];if(v?.annotations?.some(a=>!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<0||a.end<=a.start||a.end>n.name.length||!a.attrs||Object.keys(a.attrs).some(k=>!['fill','fontWeight','fontStyle','textDecoration'].includes(k))))e.push('invalid-text-range');if(!v || !['x','y','width','height'].every(k=>Number.isFinite(v[k])) || v.width<20 || v.height<20 || !layers.has(v.layerId))e.push('invalid-node-geometry');});
      if(Object.keys(p.scene.nodes || {}).some(key=>!ids.has(key)))e.push('orphan-scene-node');
    }
    const cells=isChen(doc)?p.scene.annotations:p.scene.cells || [];
    if(!Array.isArray(cells)||cells.some(c=>!c||typeof c!=='object')){e.push('invalid-cells');return;}checkCells(cells);
    const ids=new Set(cells.map(c=>c.id));if(ids.size!==cells.length)e.push('duplicate-cell');if(isChen(doc))semantic(p).forEach(n=>{if(ids.has(n.id))e.push('duplicate-cell');ids.add(n.id);});
    cells.filter(isEdge).forEach(c=>{if(!ids.has(c.source?.cell || c.source)||!ids.has(c.target?.cell || c.target))e.push('missing-edge-target');});
  });
  return Array.from(new Set(e));
};
const warnings = p => {
  if(!p.erModel)return[];
  const m=p.erModel;const out=[];
  semantic(p).forEach(n=>{if(!n.name.trim())out.push({id:n.id,code:'unnamed'});});
  const names=new Set();m.attributes.forEach(a=>{const key=`${a.owner.type}:${a.owner.id}:${normalizeName(a.name)}`;if(names.has(key))out.push({id:a.id,code:'duplicate-attribute-name'});names.add(key);});
  m.relationships.forEach(r=>{if(r.roles.length<2)out.push({id:r.id,code:'roles-required'});});
  m.entities.filter(n=>n.kind==='weak').forEach(n=>{if(!m.relationships.some(r=>r.kind==='identifying'&&r.roles.some(v=>v.entityId===n.id)))out.push({id:n.id,code:'identification-required'});});
  const strongIds=new Set(m.entities.filter(n=>n.kind!=='weak').map(n=>n.id));
  m.attributes.filter(a=>a.key==='partial'&&a.owner?.type==='entity'&&strongIds.has(a.owner.id)).forEach(a=>out.push({id:a.id,code:'partial-key-owner'}));
  return out;
};
// Default node geometry per Chen symbol kind — shared by addSemantic and the
// editor so a drop point can be centered on the created node's real bounds.
const chenSizeOf = kind => ['relationship','identifying'].includes(kind) ? {width: 110, height: 76} : ['attribute','multi','derived','key','partial-key','composite'].includes(kind) ? {width: 120, height: 46} : {width: 140, height: 58};
const addSemantic = (p, kind, name, x=200, y=200, owner) => {
  const next=clone(p), nodeId=id('er');let node;
  if(['entity','weak'].includes(kind)){node={id:nodeId,name,kind:kind==='weak'?'weak':'strong'};next.erModel.entities.push(node);}
  else if(['relationship','identifying'].includes(kind)){node={id:nodeId,name,kind:kind==='identifying'?'identifying':'ordinary',roles:[]};next.erModel.relationships.push(node);}
  else {
    if(!owner)throw Error('owner-required');
    // New operations only: a partial key belongs to a weak entity. Legacy
    // documents with this anomaly load unchanged and only raise a warning.
    if(kind==='partial-key'){const ownerEntity=owner?.type==='entity'?next.erModel.entities.find(v=>v.id===owner.id):null;if(!ownerEntity||ownerEntity.kind!=='weak')throw Error('weak-entity-key');}
    node={id:nodeId,name,kind:{multi:'multivalued',derived:'derived',composite:'composite'}[kind] || 'simple',key:kind==='key'?'primary':kind==='partial-key'?'partial':'none',owner};next.erModel.attributes.push(node);
  }
  const size=chenSizeOf(kind);
  next.scene.nodes[nodeId]={x,y,width:size.width,height:size.height,layerId:next.scene.layers[0].id,style:{}};
  return {page:next,id:nodeId};
};
const connect = (p, a, b) => {
  const n=clone(p);const ent=n.erModel.entities.find(e=>e.id===a || e.id===b);const rel=n.erModel.relationships.find(e=>e.id===a || e.id===b);
  if(!ent||!rel)throw Error('entity-relationship-only');
  rel.roles.push({id:id('role'),entityId:ent.id,name:'',cardinality:'many',manyLabel:'N',participation:rel.kind==='identifying'&&ent.kind==='weak'?'total':'partial'});return n;
};
const removeSemantic = (p, selected) => {
  const n=clone(p);const removed=new Set(selected);let changed=true;
  while(changed){changed=false;n.erModel.attributes.forEach(a=>{if(removed.has(a.owner.id)&&!removed.has(a.id)){removed.add(a.id);changed=true;}});}
  n.erModel.entities=n.erModel.entities.filter(a=>!removed.has(a.id));n.erModel.relationships=n.erModel.relationships.filter(a=>!removed.has(a.id)).map(r=>({...r,roles:r.roles.filter(v=>!removed.has(v.entityId)&&!removed.has(`role:${v.id}`))}));
  n.erModel.attributes=n.erModel.attributes.filter(a=>!removed.has(a.id));removed.forEach(key=>{delete n.scene.nodes[key];});
  const validEdges=new Set([...n.erModel.attributes.map(a=>`owner:${a.id}`),...n.erModel.relationships.flatMap(r=>r.roles.map(v=>`role:${v.id}`))]);Object.keys(n.scene.edges).forEach(key=>{if(!validEdges.has(key))delete n.scene.edges[key];});
  n.scene.annotations=n.scene.annotations.filter(c=>!removed.has(c.id)&&!removed.has(c.source?.cell)&&!removed.has(c.target?.cell));return n;
};
const chenEdgeColorOf = p => chenThemes[chenAppearanceOf(p).themeId].edge;
const project = p => {
  // C03: the canvas look is a preview/new-node default only. Projection never uses
  // it as a dynamic fallback — objects without explicit style keep the standard
  // default colors, so switching themes never silently recolors existing objects.
  const edgeColor=chenEdgeColorOf(p);
  const nodes=semantic(p).map(n=>{
    const v=positionOf(p,n.id),kind=kindOf(p,n),rel=['relationship','identifying'].includes(kind),s=v.style || {},l=p.scene.layers.find(a=>a.id===v.layerId);
    const rs=chenStylesById[s.renderStyle]?s.renderStyle:'standard';
    const fill=s.fill || '#ffffff',stroke=s.stroke || '#3566af';
    const double=['weak','identifying','multi'].includes(kind);
    // CHEN-UAT-009 typography persistence: optional style fields map back to X6.
    // letterSpacing keeps a finite 0 (never swallowed by a || fallback); the
    // vertical anchor derives refY/refY2 with legacy documents defaulting to
    // letter spacing 0 / middle (identical to the previous projection).
    const vertical=['top','bottom'].includes(s.textVerticalAnchor)?s.textVerticalAnchor:'middle';
    return {id:n.id,shape:`chen-${kind}`,zIndex:Math.max(0,p.scene.layers.findIndex(l=>l.id===v.layerId))*10000+(v.zIndex == null?1:v.zIndex),parent:v.parent,x:v.x,y:v.y,width:v.width,height:v.height,visible:l?.visible!==false,data:{chen:true,chenKind:kind,kind,layer:v.layerId,locked:Boolean(l?.locked || v.locked),link:v.link,...(rs!=='standard'?{renderStyle:rs}:{})},
      attrs:{body:{fill,stroke,strokeWidth:s.strokeWidth || 1.5,opacity:s.opacity == null?1:s.opacity,visibility:rs==='sketch'?'hidden':'visible',strokeDasharray:kind==='derived'?'5 4':''},label:{text:n.name,annotations:v.annotations || [],fontSize:s.fontSize || 14,fontFamily:s.fontFamily || '-apple-system, PingFang SC, sans-serif',fontWeight:s.bold?700:400,fontStyle:s.italic?'italic':'normal',lineHeight:s.lineHeight || '1.2em',textAnchor:s.textAnchor || 'middle',refX:s.textAnchor==='start'?12:s.textAnchor==='end'?'100%':'50%',refX2:s.textAnchor==='end'?-12:0,textVerticalAnchor:vertical,refY:vertical==='top'?'0%':vertical==='bottom'?'100%':'50%',refY2:vertical==='top'?6:vertical==='bottom'?-6:0,...(Number.isFinite(s.letterSpacing)?{letterSpacing:s.letterSpacing}:{}),fill:s.color || '#303746',textDecoration:kind==='key'?'underline':s.underline?'underline':s.strike?'line-through':''},
        innerShape:{stroke,visibility:double&&rs!=='sketch'?'visible':'hidden'},
        sketchOuter:{d:rs==='sketch'?sketchD(kind,v.width,v.height,n.id):'M0 0',visibility:rs==='sketch'?'visible':'hidden',fill,stroke,strokeWidth:1.6,strokeDasharray:kind==='derived'?'5 4':''},
        sketchInner:{d:rs==='sketch'&&double?sketchD(kind,v.width,v.height,n.id,4):'M0 0',visibility:rs==='sketch'&&double?'visible':'hidden',fill:'none',stroke,strokeWidth:1.1,strokeDasharray:kind==='derived'?'5 4':''},
        oilShape:{visibility:rs==='oil'?'visible':'hidden',fill:'url(#chen-oil)',stroke,strokeWidth:1.2,strokeDasharray:kind==='derived'?'5 4':''},
        keyLine:{visibility:kind==='partial-key'?'visible':'hidden',strokeDasharray:'4 3'}}};
  });
  const map=new Map(nodes.map(n=>[n.id,n]));const edges=[];
  const edge=(edgeId,a,b,label,total=false)=>{
    if(!map.has(a)||!map.has(b))return;
    edges.push({id:edgeId,shape:'chen-edge',router:{name:'normal'},connector:{name:'normal'},source:{cell:a},target:{cell:b},visible:map.get(a).visible&&map.get(b).visible,vertices:p.scene.edges?.[edgeId]?.vertices || [],data:{chen:true,total},attrs:{line:{stroke:edgeColor,strokeWidth:total?5:1.3,targetMarker:null,sourceMarker:null},inner:{strokeWidth:total?2.5:0}},labels:label?[{position:{distance:.3,offset:-13},attrs:{label:{text:label,fontSize:12,fill:'#607087'}}}]:[]});
  };
  p.erModel.relationships.forEach(r=>r.roles.forEach(v=>edge(`role:${v.id}`,v.entityId,r.id,v.cardinality==='one'?'1':v.manyLabel,v.participation==='total')));
  p.erModel.attributes.forEach(a=>edge(`owner:${a.id}`,a.owner.id,a.id,''));
  return {cells:[...nodes,...edges,...projectLegacy({...p,scene:{...p.scene,cells:p.scene.annotations}}).cells]};
};
const capture = (p, canvas) => {
  const n=clone(p),byId=new Map(canvas.cells.map(c=>[c.id,c]));
  semantic(n).forEach(v=>{const c=byId.get(v.id);if(!c)return;
    const xy=c.position || c,size=c.size || c;const previous=n.scene.nodes[v.id];
    n.scene.nodes[v.id]={...previous,zIndex:(c.zIndex || 0)%10000,annotations:c.attrs?.label?.text===v.name?c.attrs?.label?.annotations || []:[],layerId:c.data?.layer || previous.layerId,locked:n.scene.layers.find(l=>l.id===previous.layerId)?.locked?previous.locked:Boolean(c.data?.locked),link:c.data?.link,parent:c.parent,x:xy.x,y:xy.y,width:size.width,height:size.height,style:{...previous.style,renderStyle:c.data?.renderStyle,opacity:c.attrs?.body?.opacity,fill:c.attrs?.body?.fill,stroke:c.attrs?.body?.stroke,strokeWidth:c.attrs?.body?.strokeWidth,lineHeight:c.attrs?.label?.lineHeight,textAnchor:c.attrs?.label?.textAnchor,letterSpacing:Number.isFinite(c.attrs?.label?.letterSpacing)?c.attrs.label.letterSpacing:undefined,textVerticalAnchor:['top','bottom'].includes(c.attrs?.label?.textVerticalAnchor)?c.attrs.label.textVerticalAnchor:(c.attrs?.label?.refY==='0%'?'top':c.attrs?.label?.refY==='100%'?'bottom':undefined),fontSize:c.attrs?.label?.fontSize,fontFamily:c.attrs?.label?.fontFamily,color:c.attrs?.label?.fill,bold:Number(c.attrs?.label?.fontWeight)>=600,italic:c.attrs?.label?.fontStyle==='italic',underline:kindOf(n,v)==='key'?false:c.attrs?.label?.textDecoration==='underline',strike:c.attrs?.label?.textDecoration==='line-through'}};
    if(c.attrs?.label?.text!=null)v.name=String(c.attrs.label.text);
  });
  canvas.cells.filter(c=>c.data?.chen && isEdge(c)).forEach(c=>{n.scene.edges[c.id]={vertices:c.vertices || []};});
  n.scene.annotations=captureLegacy({...p,scene:{...p.scene,cells:p.scene.annotations}},{cells:canvas.cells.filter(c=>!c.data?.chen)});return n;
};
const clonePage = (original, mapping) => {
  const p=clone(original),ids=new Map();
  const collect=v=>{if(v&&typeof v==='object'){if(v.id)ids.set(v.id,id('copy'));Object.values(v).forEach(collect);}};collect(p);if(mapping)ids.forEach((value,key)=>mapping.set(key,value));
  const refKeys=['id','objectId','entityId','cell','parent','layerId','layer','roleId','ownerRoleId','laneId','source','target','from','to','fragmentId'];
  const visit=(v,k)=>{
    if(k==='assetRef')return clone(v);
    if(typeof v==='string'){if(refKeys.includes(k))return ids.get(v)||v;if(v.startsWith('role:')||v.startsWith('owner:')){const [prefix,key]=v.split(':');return `${prefix}:${ids.get(key)||key}`;}return v;}
    if(Array.isArray(v))return v.map(x=>visit(x,k));
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([key,value])=>{const nextKey=ids.get(key)||key.startsWith('role:')&&`role:${ids.get(key.slice(5))||key.slice(5)}`||key.startsWith('owner:')&&`owner:${ids.get(key.slice(6))||key.slice(6)}`||key;return[nextKey,visit(value,key)];}));return v;
  };return visit(p);
};
const importCopy = original => {
  const d=clone(original);d.id=id('drawing');d.revision=0;
  d.pages=d.pages.map(p=>clonePage(p));
  const detach=value=>{if(!value||typeof value!=='object')return;if(value.assetRef){value.referenceMode='unbound';value.unboundAsset={objectType:value.assetRef.objectType,lastName:value.lastName || value.assetRef.objectId};delete value.assetRef;}Object.values(value).forEach(detach);};detach(d);return d;
};
const duplicateSemantic = (source, chosen, target=source) => {
  const selected=new Set(chosen);let changed=true;
  while(changed){changed=false;source.erModel.attributes.forEach(a=>{if(selected.has(a.owner.id)&&!selected.has(a.id)){selected.add(a.id);changed=true;}});}
  const mapping=new Map(),copy=clonePage(source,mapping),next=clone(target);const targetIds=new Set(semantic(target).map(n=>n.id));
  const selectedNew=new Set([...selected].map(key=>mapping.get(key)).filter(Boolean));const inverse=new Map([...mapping].map(([a,b])=>[b,a]));
  const entities=copy.erModel.entities.filter(n=>selectedNew.has(n.id));entities.forEach(n=>targetIds.add(n.id));
  const relationships=copy.erModel.relationships.filter(n=>selectedNew.has(n.id)).map(r=>({...r,roles:r.roles.map(role=>({...role,entityId:selectedNew.has(role.entityId)?role.entityId:inverse.get(role.entityId)||role.entityId})).filter(role=>targetIds.has(role.entityId))}));relationships.forEach(r=>targetIds.add(r.id));
  const attributes=copy.erModel.attributes.filter(n=>selectedNew.has(n.id)).map(a=>({...a,owner:{...a.owner,id:selectedNew.has(a.owner.id)?a.owner.id:inverse.get(a.owner.id)||a.owner.id}}));
  attributes.forEach(a=>targetIds.add(a.id));const validAttributes=attributes.filter(a=>targetIds.has(a.owner.id));
  next.erModel.entities.push(...entities);next.erModel.relationships.push(...relationships);next.erModel.attributes.push(...validAttributes);
  const inserted=[...entities,...relationships,...validAttributes];inserted.forEach(n=>{const position=copy.scene.nodes[n.id];next.scene.nodes[n.id]={...position,x:position.x+35,y:position.y+35,layerId:next.scene.layers[0].id,parent:undefined};});
  return next;
};
const newChen = (name='ER 概念图',sample=false,variant=0) => {
  let p=page('画布 1');p.erModel=emptyModel();
  if(sample){
    const labels=[['客户','下单','订单','客户编号','订单编号'],['读者','借阅','图书','读者编号','图书编号'],['学生','选修','课程','学号','课程号'],['员工','抚养','家属','员工编号','家属姓名'],['供应商','供应','零件','供应商编号','零件编号']][variant%5];
    const add=(kind,text,x,y,owner)=>{const result=addSemantic(p,kind,text,x,y,owner);p=result.page;return result.id;};
    const a=add('entity',labels[0],90,260),r=add(variant===3?'identifying':'relationship',labels[1],390,250),b=add(variant===3?'weak':'entity',labels[2],700,260);
    p=connect(p,a,r);p=connect(p,r,b);p.erModel.relationships[0].roles[0].cardinality=variant===1||variant===2?'many':'one';
    add('key',labels[3],100,90,{type:'entity',id:a});add(variant===3?'partial-key':'key',labels[4],710,90,{type:'entity',id:b});
    add('attribute',variant===2?'成绩':variant===1?'借阅日期':variant===3?'出生日期':variant===4?'供应数量':'日期',variant===4?650:390,450,{type:'relationship',id:r});
    if(variant===0){add('attribute','姓名',90,450,{type:'entity',id:a});add('multi','联系电话',265,90,{type:'entity',id:a});const prod=add('entity','商品',1000,260),contains=add('relationship','包含',865,250);p=connect(p,b,contains);p=connect(p,contains,prod);add('attribute','数量',865,450,{type:'relationship',id:contains});add('key','商品编号',1010,90,{type:'entity',id:prod});}
    if(variant===3)add('derived','年龄',710,450,{type:'entity',id:b});
    if(variant===4){const c=add('entity','项目',390,560);p=connect(p,c,r);p.erModel.relationships[0].roles[2].manyLabel='P';}
  }
  return {id:id('drawing'),type:'drawing',schemaVersion:2,diagramType:'er-sketch',notation:'chen',revision:0,defName:name,defKey:id('er'),pages:[p],enabledPacks:['chen','basic'],resources:[],components:[]};
};
const convertLegacy = (original, mapping) => {
  const source=original.schemaVersion===2?original:upgrade(original),old=source.pages[0];const d=newChen(`${original.defName} · 陈氏 ER`),ids=new Map();let p=d.pages[0];
  const nodes=(old.scene.cells || []).filter(c=>!isEdge(c));const edges=(old.scene.cells || []).filter(isEdge);const byId=new Map(nodes.map(c=>[c.id,c]));
  const insert=(c,kind,owner)=>{const pos=c.position || c,size=c.size || c;const out=addSemantic(p,kind,String(c.attrs?.label?.text || ''),pos.x || 0,pos.y || 0,owner);p=out.page;ids.set(c.id,out.id);Object.assign(p.scene.nodes[out.id],{width:size.width || 140,height:size.height || 58,style:{fill:c.attrs?.body?.fill,stroke:c.attrs?.body?.stroke,fontSize:c.attrs?.label?.fontSize}});};
  nodes.filter(c=>['entity','weak','relationship','identifying'].includes(mapping[c.id]?.kind)).forEach(c=>insert(c,mapping[c.id].kind));
  const attributes=nodes.filter(c=>!['aux','entity','weak','relationship','identifying',undefined].includes(mapping[c.id]?.kind));
  let todo=attributes.slice();while(todo.length){const ready=todo.filter(c=>ids.has(mapping[c.id].owner));if(!ready.length)throw Error('Choose valid attribute owners; cyclic owners are not allowed');ready.forEach(c=>{const ownerId=ids.get(mapping[c.id].owner),type=p.erModel.entities.some(n=>n.id===ownerId)?'entity':p.erModel.relationships.some(n=>n.id===ownerId)?'relationship':'attribute';insert(c,mapping[c.id].kind,{type,id:ownerId});});todo=todo.filter(c=>!ready.includes(c));}
  nodes.filter(c=>!ids.has(c.id)).forEach(c=>{const n=clone(c);n.id=id('aux');ids.set(c.id,n.id);p.scene.annotations.push(n);});
  edges.forEach(e=>{const a=ids.get(e.source?.cell || e.source),b=ids.get(e.target?.cell || e.target);if(!a||!b)return;
    const entity=p.erModel.entities.find(n=>n.id===a||n.id===b),rel=p.erModel.relationships.find(n=>n.id===a||n.id===b);
    if(entity&&rel){p=connect(p,entity.id,rel.id);const role=p.erModel.relationships.find(n=>n.id===rel.id).roles.slice(-1)[0];if(e.labels?.[0]?.attrs?.label?.text==='1'){role.cardinality='one';role.manyLabel=null;}return;}
    if(p.erModel.attributes.some(n=>n.id===a&&n.owner.id===b||n.id===b&&n.owner.id===a))return;
    const n=clone(e);n.id=id('aux-edge');n.source={cell:a};n.target={cell:b};n.data={...n.data,chen:false,auxiliary:true};p.scene.annotations.push(n);
  });
  p.scene.annotations.forEach(c=>{if(c.parent)c.parent=ids.get(c.parent);if(c.children)c.children=c.children.map(key=>ids.get(key)).filter(Boolean);});
  d.pages=[p];const issues=errors(d);if(issues.length)throw Error(issues.join(', '));return d;
};
module.exports={id,clone,page,emptyModel,isChen,isEdge,allCells,upgrade,errors,warnings,semantic,positionOf,kindOf,addSemantic,connect,removeSemantic,project,projectLegacy,captureLegacy,capture,clonePage,importCopy,duplicateSemantic,newChen,convertLegacy,chenThemes,chenAppearanceOf,chenRoleOf,chenSizeOf,sketchD};
