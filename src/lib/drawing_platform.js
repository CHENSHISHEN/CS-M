import DrawingDocument from '../../public/drawing-document';
import { createDefaultBusinessModel } from './businessStorage';

let serial = 0;
export const platformId = (prefix = 'p') => `${prefix}-${Date.now().toString(36)}-${(++serial).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const clone = value => JSON.parse(JSON.stringify(value));
export const DRAWING_TYPES = [
  {id: 'flowchart', family: 'graph', name: '流程图', en: 'Flowchart', color: '#3568b5', icon: 'fa-random', packs: ['basic', 'flow'], templates: ['订单退款流程', '用户注册与验证']},
  {id: 'swimlane', family: 'graph', name: '泳道图', en: 'Swimlane', color: '#087969', icon: 'fa-columns', packs: ['basic', 'flow', 'lane'], templates: ['采购申请审批', '售后工单流转']},
  {id: 'architecture', family: 'graph', name: '架构图', en: 'Architecture', color: '#51617e', icon: 'fa-cubes', packs: ['basic', 'architecture'], templates: ['电商分层架构', '数据平台分层架构']},
  {id: 'mindmap', family: 'tree', name: '思维导图', en: 'Mind map', color: '#7854be', icon: 'fa-sitemap', packs: [], templates: ['产品需求拆解', '项目复盘']},
  {id: 'orgchart', family: 'tree', name: '组织结构图', en: 'Organization', color: '#087969', icon: 'fa-users', packs: [], templates: ['产品研发团队', '项目职责结构']},
  {id: 'uml-usecase', family: 'graph', name: 'UML 用例图', en: 'UML use case', color: '#596579', icon: 'fa-user-o', packs: ['basic', 'usecase'], templates: ['商城用户用例', '订单后台用例']},
  {id: 'uml-class', family: 'graph', name: 'UML 类图', en: 'UML class', color: '#596579', icon: 'fa-list-alt', packs: ['basic', 'class'], templates: ['订单领域类图', '权限角色类图']},
  {id: 'sequence', family: 'sequence', name: 'UML 时序图', en: 'Sequence', color: '#a46524', icon: 'fa-exchange', packs: [], templates: ['下单与库存扣减', '登录鉴权']},
  {id: 'er-sketch', family: 'graph', name: 'ER 概念图', en: 'Chen ER', color: '#3568b5', icon: 'fa-table', packs: ['er', 'basic'], templates: ['读者借阅', '学生选课']},
];
export const drawingType = id => DRAWING_TYPES.find(t => t.id === id) || DRAWING_TYPES[2];
export const SHAPE_PACKS = [
  {id: 'chen', name: '陈氏 ER', en: 'Chen ER'},
  {id: 'basic', name: '基础图形', en: 'Basic'}, {id: 'flow', name: '流程符号', en: 'Flowchart'},
  {id: 'lane', name: '泳池 / 泳道', en: 'Lanes'}, {id: 'architecture', name: '架构组件', en: 'Architecture'},
  {id: 'class', name: 'UML 类与接口', en: 'Classes'}, {id: 'usecase', name: 'UML 用例', en: 'Use cases'},
  {id: 'er', name: 'ER 概念图', en: 'Chen ER'},
];
export const SHAPES = [
  ['rect', '矩形', 'Rectangle', 'basic', 'rect'], ['rounded', '圆角矩形', 'Rounded', 'basic', 'rect'],
  ['ellipse', '椭圆', 'Ellipse', 'basic', 'ellipse'], ['text', '文字', 'Text', 'basic', 'rect'], ['note', '便签', 'Note', 'basic', 'rect'],
  ['start', '开始 / 结束', 'Start / End', 'flow', 'ellipse'], ['activity', '处理', 'Activity', 'flow', 'rect'],
  ['decision', '判断', 'Decision', 'flow', 'polygon'], ['document', '文档', 'Document', 'flow', 'polygon'],
  ['input', '数据输入', 'Input', 'flow', 'polygon'], ['subprocess', '子流程', 'Subprocess', 'flow', 'rect'],
  ['lane', '泳道', 'Lane', 'lane', 'rect'], ['pool', '泳池', 'Pool', 'lane', 'rect'],
  ['service', '应用服务', 'Service', 'architecture', 'rect'], ['database', '数据库', 'Database', 'architecture', 'cylinder'],
  ['queue', '消息队列', 'Queue', 'architecture', 'rect'], ['terminal', '终端', 'Client', 'architecture', 'rect'], ['container', '边界容器', 'Boundary', 'architecture', 'rect'],
  ['class', '类', 'Class', 'class', 'rect'], ['interface', '接口', 'Interface', 'class', 'rect'], ['enum', '枚举', 'Enum', 'class', 'rect'], ['package', '包', 'Package', 'class', 'rect'],
  ['actor', '参与者', 'Actor', 'usecase', 'rect'], ['usecase', '用例', 'Use case', 'usecase', 'ellipse'], ['boundary', '系统边界', 'System boundary', 'usecase', 'rect'],
  ['entity', '实体', 'Entity', 'er', 'rect'], ['attribute', '属性', 'Attribute', 'er', 'ellipse'], ['relationship', '联系', 'Relationship', 'er', 'polygon'],
  ...[['entity','实体','Entity'],['weak','弱实体','Weak entity'],['relationship','联系','Relationship'],['identifying','标识联系','Identifying relationship'],['attribute','属性','Attribute'],['composite','复合属性','Composite attribute'],['multi','多值属性','Multivalued attribute'],['derived','派生属性','Derived attribute'],['key','键属性','Key attribute'],['partial-key','部分键','Partial key']].map(([key, name, en]) => [`chen-${key}`, name, en, 'chen', key]),
].map(([id, name, en, pack, shape]) => ({id, name, en, pack, shape}));

export const graphPorts = () => ({groups: ['top', 'right', 'bottom', 'left'].reduce((a, p) => ({...a, [p]: {position: p,
  attrs: {circle: {r: 4, magnet: true, stroke: '#7162d8', fill: '#fff', style: {visibility: 'hidden'}}}}}), {}), items: ['top', 'right', 'bottom', 'left'].map(p => ({id: p, group: p}))});

export const shapeCell = (kind, name, x = 160, y = 140, extra = {}) => {
  const def = SHAPES.find(s => s.id === kind) || SHAPES[0];
  const container = ['container', 'boundary', 'package', 'pool', 'lane'].includes(kind);
  const width = container ? 660 : kind === 'decision' || kind === 'relationship' ? 126 : kind === 'class' || kind === 'interface' ? 240 : 170;
  const height = container ? 170 : kind === 'class' || kind === 'interface' ? 190 : kind === 'decision' || kind === 'relationship' ? 90 : 66;
  const points = kind === 'input' ? '15,0 100,0 85,60 0,60' : kind === 'document' ? '0,0 100,0 100,50 75,60 25,50 0,60' : '50,0 100,50 50,100 0,50';
  return {id: platformId('node'), shape: def.shape, x, y, width, height, zIndex: container ? -1 : 1,
    data: {kind, container, layer: container ? 'boundary' : 'main', ...(extra.data || {})},
    attrs: {body: {fill: kind === 'note' ? '#fff3d6' : container ? '#f1f5fb' : '#fff', stroke: '#7086a7', strokeWidth: 1.3,
      ...(kind === 'text' ? {fill: 'transparent', stroke: 'transparent'} : {}), rx: ['rounded', 'activity', 'service'].includes(kind) ? 8 : 2,
      ...(def.shape === 'polygon' ? {refPoints: points} : {})},
    label: {text: name || def.name, fill: '#26354b', fontSize: 14, textWrap: {width: -20, height: -12, ellipsis: true},
      ...(container ? {refX: 15, refY: 18, textAnchor: 'start', textVerticalAnchor: 'top'} : {})}},
    ports: graphPorts(), ...extra};
};
export const edgeCell = (source, target, label = '', relation = 'flow') => {
  const uml = ['association', 'composition', 'inheritance', 'include', 'extend'].includes(relation);
  return {id: platformId('edge'), shape: 'edge', zIndex: 0, source: {cell: source, port: 'right'}, target: {cell: target, port: 'left'},
    router: {name: 'manhattan'}, connector: {name: 'rounded'}, data: {relation},
    attrs: {line: {stroke: '#7d90ab', strokeWidth: 1.5,
      strokeDasharray: ['include', 'extend', 'return', 'dependency'].includes(relation) ? '6 4' : '',
      sourceMarker: relation === 'composition' ? {name: 'diamond', size: 10} : null,
      targetMarker: relation === 'inheritance' ? {name: 'block', size: 10, fill: '#fff'} : uml && !['include', 'extend'].includes(relation) ? null : {name: 'classic', size: 7}}},
    labels: label ? [{attrs: {label: {text: label, fontSize: 12}}}] : []};
};

const treeNode = (name, children = []) => ({id: platformId('topic'), name, children, collapsed: false});
export const newDrawing = (typeId, name, sample = false, variant = 0) => {
  const type = drawingType(typeId);
  const doc = {id: platformId('drawing'), defKey: platformId('diagram'), defName: name || type.name,
    type: 'drawing', schemaVersion: 1, revision: 0, diagramType: type.id, canvasData: {cells: []}, enabledPacks: type.packs.slice()};
  if (type.family === 'tree') {
    const names = type.id === 'orgchart' ? ['产品组', '研发组', '质量组'] : variant ? ['目标回顾', '问题分析', '改进行动'] : ['用户与场景', '核心能力', '发布计划'];
    doc.treeData = treeNode(doc.defName, sample ? names.map((n, i) => treeNode(n, [treeNode(type.id === 'orgchart' ? ['产品经理', '工程师', '测试工程师'][i] : `${n}明细`)])) : []);
  } else if (type.family === 'sequence') {
    const participants = (variant ? ['用户端', '鉴权服务', '用户数据库'] : ['用户端', '订单服务', '库存服务']).map(n => ({id: platformId('participant'), name: n}));
    doc.sequenceData = {participants: sample ? participants : [], messages: sample ? [
      {id: platformId('message'), from: participants[0].id, to: participants[1].id, text: variant ? '提交凭据' : '创建订单', kind: 'sync', fragmentId: ''},
      {id: platformId('message'), from: participants[1].id, to: participants[2].id, text: variant ? '校验用户' : '预占库存', kind: 'sync', fragmentId: ''},
      {id: platformId('message'), from: participants[2].id, to: participants[1].id, text: variant ? '用户信息' : '预占成功', kind: 'return', fragmentId: ''},
      {id: platformId('message'), from: participants[1].id, to: participants[0].id, text: variant ? '返回令牌' : '返回订单编号', kind: 'return', fragmentId: ''}] : [], fragments: []};
  } else if (sample) {
    let cells = [];
    if (type.id === 'architecture') {
      ['接入层', '业务服务', '基础设施'].forEach((n, row) => {
        const c = shapeCell('container', n, 65, 45 + row * 235, {width: 900, height: 200});
        cells.push(c);
        const names = (variant ? [['数据源', '业务系统', '日志采集'], ['ODS', 'DWD', 'DWS'], ['对象存储', 'Hive', 'ClickHouse']] : [['Web商城', '移动端', '开放接口'], ['订单服务', '支付服务', '商品服务'], ['PostgreSQL', 'Redis', '消息队列']])[row];
        names.forEach((s, col) => cells.push(shapeCell(row === 2 && col === 0 ? 'database' : 'service', s, 110 + col * 280, 115 + row * 235, {parent: c.id})));
      });
      const n = cells.filter(c => !c.data.container);
      for (let i = 0; i < 6; i += 1) cells.push({...edgeCell(n[i].id, n[i + 3].id), source: {cell: n[i].id, port: 'bottom'}, target: {cell: n[i + 3].id, port: 'top'}});
    } else if (type.id === 'uml-class') {
      const names = variant ? ['User', 'Role', 'Permission'] : ['Customer', 'Order', 'OrderItem'];
      const ns = names.map((n, i) => shapeCell('class', n, 80 + i * 310, 150 + (i % 2) * 160,
        {data: {kind: 'class', fields: '+ id: Identifier\n+ name: String', methods: '+ save(): void'}}));
      cells = [...ns, edgeCell(ns[0].id, ns[1].id, '1 : N', 'association'), edgeCell(ns[1].id, ns[2].id, '1..*', 'composition')];
    } else if (type.id === 'uml-usecase') {
      const bound = shapeCell('boundary', variant ? '订单管理系统' : '商城系统', 275, 90, {width: 600, height: 550});
      const actor = shapeCell('actor', variant ? '运营人员' : '客户', 60, 275, {width: 140, height: 100});
      const ns = (variant ? ['查询订单', '审核退款', '查看退款记录'] : ['浏览商品', '提交订单', '完成支付']).map((n, i) => shapeCell('usecase', n, 440, 160 + i * 145, {parent: bound.id, width: 230}));
      cells = [bound, actor, ...ns, ...ns.map(n => edgeCell(actor.id, n.id, '', 'association')), edgeCell(ns[1].id, ns[2].id, '«include»', 'include')];
    } else if (type.id === 'er-sketch') {
      const ns = [shapeCell('entity', variant ? '学生' : '读者', 80, 280), shapeCell('relationship', variant ? '选修' : '借阅', 410, 270), shapeCell('entity', variant ? '课程' : '图书', 720, 280)];
      const attrs = [shapeCell('attribute', variant ? '学号' : '读者编号', 80, 100), shapeCell('attribute', variant ? '成绩' : '借阅日期', 410, 500), shapeCell('attribute', variant ? '课程号' : '图书编号', 720, 100)];
      cells = [...ns, ...attrs, edgeCell(ns[0].id, ns[1].id, 'N', 'association'), edgeCell(ns[1].id, ns[2].id, 'M', 'association'), ...attrs.map((n, i) => edgeCell(n.id, ns[i].id, '', 'association'))];
    } else {
      const lane = type.id === 'swimlane';
      const titles = lane ? variant ? ['客户', '客服', '售后专员'] : ['申请人', '主管', '财务'] : [];
      const lanes = titles.map((n, i) => shapeCell('lane', n, 30, 30 + 190 * i, {width: 1040, height: 190}));
      const names = lane ? [variant ? '收到工单' : '提交申请', '资料校验', '符合条件？', '审批处理', '退回申请', '处理结束']
        : variant ? ['注册申请', '校验账户', '信息有效？', '创建账户', '提示错误', '注册结束'] : ['收到退款申请', '校验订单', '符合条件？', '原路退款', '拒绝申请', '处理结束'];
      const ns = names.map((n, i) => shapeCell(i === 0 || i === 5 ? 'start' : i === 2 ? 'decision' : 'activity', n,
        lane ? 105 + (i % 3) * 300 : [400, 400, 420, 680, 120, 400][i], lane ? [92, 92, 275, 275, 470, 470][i] : [45, 175, 315, 490, 490, 670][i],
        lane ? {parent: lanes[[0, 0, 1, 1, 2, 2][i]].id} : {}));
      cells = [...lanes, ...ns, ...[[0, 1, ''], [1, 2, ''], [2, 3, '是'], [2, 4, '否'], [3, 5, ''], [4, 5, '']].map(([a, b, text]) => edgeCell(ns[a].id, ns[b].id, text))];
    }
    doc.canvasData = {cells};
  }
  return doc;
};

export const PLATFORM_TEMPLATES = DRAWING_TYPES.reduce((a, t) => a.concat(t.templates.map((name, i) =>
  ({id: `${t.id}-${i}`, typeId: t.id, module: 'drawing', name, variant: i, tags: [t.name], version: 1}))), []).concat(
  ['订单审批', '采购入库', '客户准入'].map((name, i) => ({id: `business-${i}`, module: 'business', typeId: 'business-process', name, variant: i, tags: ['业务建模包'], version: 1})),
  ['订单概念模型', '订单逻辑模型', '订单物理模型'].map((name, i) => ({id: `data-${i}`, module: 'data', typeId: ['conceptual', 'logical', 'physical'][i], name, variant: i, tags: ['数据建模包'], version: 1})),
);

// Copy only identities and their references. Labels remain user text, never guessed references.
export const copyWithIds = (value) => {
  const ids = new Map();
  const collect = v => {
    if (!v || typeof v !== 'object') return;
    if (v.id) ids.set(v.id, platformId('copy'));
    Object.values(v).forEach(collect);
  };
  collect(value);
  const visit = (v, key) => {
    if (typeof v === 'function') return undefined;
    if (key === 'assetRef' || key === 'sourceRef') return undefined; // External bindings require an explicit new choice.
    if (typeof v === 'string') return ['id', 'cell', 'parent', 'children', 'source', 'target', 'from', 'to', 'fragmentId', 'roleId', 'ownerRoleId', 'laneId', 'inputObjectIds', 'outputObjectIds', 'ruleIds'].includes(key) ? ids.get(v) || v : v;
    if (Array.isArray(v)) return v.map(e => visit(e, key));
    if (v && typeof v === 'object') {
      const result = Object.keys(v).reduce((a, k) => ({...a, [k]: visit(v[k], k)}), {});
      if (v.assetRef) {result.referenceMode = 'unbound';result.unboundAsset = {objectType: v.assetRef.objectType, lastName: v.lastName || v.assetRef.objectId};}
      return result;
    }
    return v;
  };
  return visit(value);
};

export const instantiateTemplate = (source, template, name) => {
  if (!template || template.version !== 1) throw new Error('Unsupported template');
  const title = name?.trim() || template.name;
  if (template.module === 'drawing') {
    const doc = newDrawing(template.typeId, title, true, template.variant);
    return {source: {...source, drawings: [...(source.drawings || []), doc]}, module: 'drawing', documentId: doc.id};
  }
  if (template.module === 'business') {
    const payload = copyWithIds(createDefaultBusinessModel());
    payload.processes[0].name = title;
    const scenarios = [
      {roles: ['订单专员', '业务主管', '履约专员'], objects: ['订单', '履约确认'], keys: ['ORDER', 'FULFILLMENT'], definition: '客户提交的商品与服务订单，记录金额和履约约定。', props: ['订单编号', '订单总额', '客户名称', '申请日期', '是否加急'], second: ['确认编号', '交付数量', '确认人'], states: ['草稿', '待审批', '待履约', '已完成', '已取消'], rule: '超额订单需主管审批', condition: '订单.订单总额 > 50000', result: '由业务主管审批后进入履约', nodes: ['提交订单', '录入订单明细', '金额是否>5万?', '业务主管审批', '履约确认', '流程结束'], goal: '明确订单审批和履约责任'},
      {roles: ['采购专员', '部门主管', '仓库管理员'], objects: ['采购订单', '入库验收单'], keys: ['PURCHASE_ORDER', 'GOODS_RECEIPT'], definition: '企业向供应商发出的正式订货凭证。', props: ['采购单号', '采购总额', '供应商名称', '申请日期', '是否紧急'], second: ['验收单号', '实收数量', '检验人'], states: ['草稿', '待审批', '待入库', '已完成', '已作废'], rule: '大额采购审批规则', condition: '采购订单.采购总额 > 50000', result: '由部门主管审批后进入入库验收', nodes: ['提交采购单', '录入采购明细', '金额是否>5万?', '部门主管审批', '验收入库', '流程结束'], goal: '保障采购审批与入库质量'},
      {roles: ['客户经理', '准入主管', '服务专员'], objects: ['客户准入申请', '准入确认'], keys: ['CUSTOMER_APPLICATION', 'ADMISSION'], definition: '客户主体、资质与业务申请的准入记录。', props: ['申请编号', '申请额度', '客户名称', '申请日期', '是否加急'], second: ['确认编号', '服务数量', '复核人'], states: ['草稿', '待复核', '待开通', '已准入', '已撤回'], rule: '客户准入复核', condition: '申请资质需要补充复核', result: '主管复核通过后开通客户服务', nodes: ['提交准入申请', '录入客户资料', '需要主管复核?', '主管复核', '开通服务与确认', '流程结束'], goal: '确保客户资质核查与准入责任清晰'},
    ];
    const scenario = scenarios[template.variant];
    payload.roles.forEach((r, i) => {r.name = scenario.roles[i];r.description = `${r.name}职责`;});
    payload.businessObjects.forEach((o, i) => {o.name = scenario.objects[i];o.businessKey = scenario.keys[i];o.definition = i ? `${scenario.objects[0]}的处理结果与确认记录` : scenario.definition;o.states = i ? ['待处理', '已确认', '已退回'] : scenario.states;o.properties.forEach((p, j) => {p.name = (i ? scenario.second : scenario.props)[j];p.memo = '';});});
    const process = payload.processes[0];process.description = `${title}的职责、业务对象与规则`;process.goal = scenario.goal;process.trigger = `由${scenario.roles[0]}提交申请`;process.lanes.forEach((l, i) => {l.name = scenario.roles[i];});process.elements.forEach((e, i) => {e.name = scenario.nodes[i];});
    payload.rules[0].name = scenario.rule;payload.rules[0].description = scenario.rule;payload.rules[0].conditionText = scenario.condition;payload.rules[0].resultText = scenario.result;
    payload.rules[1].name = `${scenario.objects[1]}完整性要求`;payload.rules[1].description = '处理结果须完成确认';payload.rules[1].conditionText = `${scenario.objects[1]}.确认人不为空`;payload.rules[1].resultText = `将${scenario.objects[0]}标记为已完成`;
    if (template.variant === 2) {process.flows[2].condition = '是，需要复核';process.flows[3].condition = '否，常规准入';process.flows[5].condition = '开通成功';}
    const business = {...source.business, revision: (source.business?.revision || 0) + 1};
    ['roles', 'businessObjects', 'rules', 'processes'].forEach(k => { business[k] = [...(business[k] || []), ...payload[k]]; });
    return {source: {...source, business}, module: 'business', documentId: payload.processes[0].id};
  }
  const collection = ['conceptEntities', 'logicEntities', 'entities'][template.variant];
  const uniqueCode = (base, objects) => { let code = base; let i = 2; while (objects.some(o => o.defKey === code)) { code = `${base}_${i++}`; } return code; };
  const existing = source[collection] || [];
  const entities = ['订单', '订单明细'].map((defName, i) => ({id: platformId('model'), defKey: uniqueCode(['orders', 'order_item'][i], existing), defName,
    type: ['C', 'L', 'P'][template.variant], comment: '平台原创起始模型', properties: {}, indexes: [], correlations: [], env: {base: {nameSpace: '', codeRoot: ''}}, notes: {}, nameTemplate: '{defKey}[{defName}]',
    headers: (template.variant === 1 ? ['defKey', 'defName', 'primaryKey', 'baseType'] : ['defKey', 'defName', 'primaryKey', 'type', 'len', 'scale', 'comment']).map(refKey => ({refKey, hideInGraph: refKey === 'comment', freeze: refKey === 'defKey' || refKey === 'defName'})),
    sysProps: {nameTemplate: '{defKey}[{defName}]', lePropOrient: 'V', propShowFields: ['N', 'K', 'T']},
    fields: template.variant === 0 ? [] : [['id', '标识', 'BIGINT'], [i ? 'order_id' : 'order_amount', i ? '订单编号' : '订单金额', i ? 'BIGINT' : 'DECIMAL']].map(([defKey, fName, type], j) =>
      ({id: platformId('field'), defKey, defName: fName, type, baseType: template.variant === 1 ? (source.dataTypeMapping?.mappings || []).find(m => (m.defKey || m.defName || '').toUpperCase().includes(type === 'DECIMAL' ? 'NUMBER' : 'INTEGER'))?.id || '' : '', len: '', scale: '', primaryKey: j === 0, notNull: true, autoIncrement: false, defaultValue: '', comment: ''}))}));
  const diagramId = platformId('diagram');
  const diagram = {id: diagramId, defKey: uniqueCode('order_design', source.diagrams || []), defName: title,
    modelLevel: ['conceptual', 'logical', 'physical'][template.variant], relationType: ['conceptEntity', 'logicEntity', 'entity'][template.variant],
    canvasData: {cells: entities.map((e, i) => ({id: platformId('instance'), shape: 'table', type: ['C', 'L', 'P'][template.variant], originKey: e.id, x: 100 + i * 420, y: 130, width: 300, height: 180}))}};
  const nodes = diagram.canvasData.cells;
  diagram.canvasData.cells.push({id: platformId('relation'), shape: 'erdRelation', source: {cell: nodes[0].id, port: 'out'}, target: {cell: nodes[1].id, port: 'in'}, relation: '1:n', fillColor: '#7086a7'});
  return {source: {...source, [collection]: [...existing, ...entities], diagrams: [...(source.diagrams || []), diagram]}, module: 'data', documentId: diagramId};
};

export const treeFind = (root, id) => {
  if (!root) return null;
  if (root.id === id) return root;
  return (root.children || []).reduce((found, child) => found || treeFind(child, id), null);
};
export const treeUpdate = (root, id, patch) => root.id === id ? {...root, ...patch} : {...root, children: (root.children || []).map(c => treeUpdate(c, id, patch))};
export const treeRemove = (root, id) => ({...root, children: (root.children || []).filter(c => c.id !== id).map(c => treeRemove(c, id))});
export const treeMove = (root, id, parentId) => {
  const node = treeFind(root, id); const parent = treeFind(root, parentId);
  if (!node || !parent || root.id === id || treeFind(node, parentId)) throw new Error('Invalid tree move');
  const without = treeRemove(root, id);
  const target = treeFind(without, parentId);
  return treeUpdate(without, parentId, {children: [...(target.children || []), node], collapsed: false});
};

export const MODEL_COLLECTIONS = ['businessObjects', 'conceptEntities', 'logicEntities', 'entities', 'diagrams'];
export const sourceObjects = (source, type) => type === 'businessObjects' ? source.business?.businessObjects || [] : source[type] || [];
export const makeAssetRef = (collection, objectId) => ({workspaceId: 'current-project', documentId: collection, objectType: collection, objectId});
export const resolveAsset = (source, ref) => ref && ref.workspaceId === 'current-project' && MODEL_COLLECTIONS.includes(ref.objectType)
  ? sourceObjects(source, ref.objectType).find(o => o.id === ref.objectId) || null : null;
export const assetOccurrences = (source, ref) => {
  const result = [];
  (source.diagrams || []).forEach(doc => {
    if (!['entities', 'logicEntities', 'conceptEntities'].includes(ref?.objectType)) return;
    const type = {entities: 'P', logicEntities: 'L', conceptEntities: 'C'}[ref.objectType];
    const ids = (doc.canvasData?.cells || []).filter(c => c.originKey === ref.objectId && (c.type || 'P') === type).map(c => c.id);
    if (ids.length) result.push({id: doc.id, name: doc.defName || doc.defKey, ids, module: 'data'});
  });
  (source.drawings || []).forEach(doc => {
    const ids = DrawingDocument.allCells(doc).filter(c => c.data?.assetRef?.workspaceId === ref?.workspaceId && c.data?.assetRef?.objectType === ref?.objectType && c.data?.assetRef?.objectId === ref?.objectId).map(c => c.id);
    if (ids.length) result.push({id: doc.id, name: doc.defName, ids, pageCount:doc.pages?doc.pages.filter(page=>[...(page.scene?.annotations || []),...(page.scene?.cells || [])].some(c=>ids.includes(c.id))).length:1, module: 'drawing'});
  });
  return result;
};

export const validateDrawing = doc => {
  const issues = []; const ids = new Set();
  if (doc?.schemaVersion === 2) {
    const issues = DrawingDocument.errors(doc);
    if (!issues.length && !DrawingDocument.isChen(doc)) doc.pages.forEach(p => issues.push(...validateDrawing({...doc, schemaVersion: 1, canvasData: {cells:p.scene.cells || []}, treeData:p.treeData, sequenceData:p.sequenceData})));
    return issues;
  }
  if (!doc || typeof doc !== 'object' || doc.schemaVersion > 1 || (doc.diagramType && !DRAWING_TYPES.some(t => t.id === doc.diagramType))) return ['unsupported-schema'];
  issues.push(...DrawingDocument.errors({...doc,id:doc.id || 'validation-only'}));
  const family = doc.diagramType ? drawingType(doc.diagramType).family : 'graph';
  if (family === 'tree' && !doc.treeData || family === 'sequence' && !doc.sequenceData) return ['missing-structure'];
  if (Number(Boolean(doc.treeData)) + Number(Boolean(doc.sequenceData)) > 1) return ['mixed-structure'];
  const add = id => { if (!id || ids.has(id)) issues.push('duplicate-id'); ids.add(id); };
  if (doc.treeData) {
    const visit = (node, ancestors = new Set()) => {
      if (!node || ancestors.has(node.id)) { issues.push('tree-cycle'); return; }
      if (typeof node.name !== 'string' || (node.children && !Array.isArray(node.children))) {issues.push('invalid-tree-node');return;}
      add(node.id); (node.children || []).forEach(c => visit(c, new Set([...ancestors, node.id])));
    }; visit(doc.treeData);
  } else if (doc.sequenceData) {
    const {participants = [], messages = [], fragments = []} = doc.sequenceData;
    if (![participants, messages, fragments].every(Array.isArray)) return ['invalid-sequence'];
    if (fragments.some(f => !['alt', 'opt', 'loop'].includes(f.kind)) || messages.some(m => !['sync', 'async', 'return'].includes(m.kind))) issues.push('invalid-sequence-kind');
    participants.concat(messages, fragments).forEach(p => add(p.id));
    const ps = new Set(participants.map(p => p.id)); const fs = new Set(fragments.map(f => f.id));
    fragments.forEach(f => {const indices = messages.map((m, i) => m.fragmentId === f.id ? i : -1).filter(i => i >= 0);if (indices.length && indices[indices.length - 1] - indices[0] + 1 !== indices.length) issues.push('fragment-order');const group = messages.filter(m => m.fragmentId === f.id);const firstElse = group.findIndex(m => m.fragmentBranch === 'else');if (f.kind === 'alt' && firstElse >= 0 && group.slice(firstElse).some(m => m.fragmentBranch !== 'else')) issues.push('fragment-order');});
    messages.forEach(m => { if (!ps.has(m.from) || !ps.has(m.to) || (m.fragmentId && !fs.has(m.fragmentId))) issues.push('missing-message-target'); });
  } else {
    const cells = doc.canvasData?.cells || [];
    if (!Array.isArray(cells)) return ['invalid-cells'];
    const shapes = ['image', 'rect', 'ellipse', 'polygon', 'cylinder', 'edge', 'pv-class', 'pv-actor', 'pv-embed', 'drawing-rect', 'drawing-rounded-rect', 'drawing-ellipse', 'drawing-diamond', 'drawing-text', 'drawing-note', 'chen-entity', 'chen-weak', 'chen-relationship', 'chen-identifying', 'chen-attribute', 'chen-multi', 'chen-derived', 'chen-key', 'chen-partial-key', 'chen-edge'];
    cells.forEach(c => {add(c.id);if (!shapes.includes(c.shape)) issues.push('unsupported-shape');});
    cells.filter(c => c.shape === 'edge' || c.source || c.target).forEach(c => {
      if (!ids.has(c.source?.cell || c.source) || !ids.has(c.target?.cell || c.target)) issues.push('missing-edge-target');
    });
  }
  return issues;
};

export const assetDependents = (source, collection, objectId) => {
  const names = [];
  (source.drawings || []).forEach(doc => {if (DrawingDocument.allCells(doc).some(c => c.data?.assetRef?.objectType === collection && c.data?.assetRef?.objectId === objectId)) names.push(doc.defName || doc.defKey);});
  (source.business?.businessObjects || []).forEach(o => {if ((o.modelRefs || []).some(r => r.objectType === collection && r.objectId === objectId)) names.push(o.name);});
  if (collection === 'businessObjects') {
    (source.business?.processes || []).forEach(p => {if ((p.elements || []).some(e => [...(e.inputObjectIds || []), ...(e.outputObjectIds || [])].includes(objectId))) names.push(p.name);});
    (source.business?.rules || []).forEach(r => {if ((r.scopeRefs || []).some(s => s.type === 'businessObject' && s.id === objectId)) names.push(r.name);});
  }
  return Array.from(new Set(names.filter(Boolean)));
};

export const replaceDrawing = (source, next, expectedRevision) => {
  const current = (source.drawings || []).find(d => d.id === next.id);
  if (!current || (current.revision || 0) !== expectedRevision) throw new Error('revision-conflict');
  if (JSON.stringify({...current, revision: 0}) === JSON.stringify({...next, revision: 0})) return source;
  return {...source, drawings: source.drawings.map(d => d.id === next.id ? {...next, revision: (current.revision || 0) + 1} : d)};
};
