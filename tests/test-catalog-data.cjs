const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const babel = require(path.join(root, 'node_modules/@babel/core'));
const lodash = require(path.join(root, 'node_modules/lodash'));
let sequence = 0;
const testMath = Object.create(Math);
testMath.uuid = () => `generated-${++sequence}`;
const tabs = {};
const dom = {style: {}, setAttribute() {}, getBoundingClientRect() {return {width: 160, height: 24};}};
function load(file, imports = {}) {
  const api = {};
  const code = babel.transformFileSync(path.join(root, file), {
    babelrc: false, configFile: false,
    presets: [[require.resolve(path.join(root, 'node_modules/@babel/preset-env')), {targets: {node: 'current'}}]],
    plugins: [require.resolve(path.join(root, 'node_modules/@babel/plugin-proposal-optional-chaining'))],
  }).code;
  vm.runInNewContext(code, {exports: api, Math: testMath, console,
    document: {getElementById: () => dom, createElement: () => dom, body: {appendChild() {}}},
    require(name) {
      if (Object.prototype.hasOwnProperty.call(imports, name)) return imports[name];
      throw new Error(`Unexpected import ${name}`);
    },
  }, {filename: file});
  return api;
}
// No real project templates are read: every data input below is synthetic.
const catalog = load('src/lib/model_catalog.js');
const conceptLinks = load('src/lib/concept_logical_links.js');
// 以下均为无副作用的纯模块,直接加载真实实现(utils.js / datasource_util.js 的新增依赖)
const fieldRecommendation = load('src/lib/field_recommendation.js');
const dataStandardLibrary = load('src/lib/data_standard_library.js', {'./field_recommendation': fieldRecommendation});
const modelRules = load('src/lib/quality/modelRules.js', {'../data_standard_library.js': dataStandardLibrary});
const projectMetadata = load('src/lib/quality/projectMetadata.js', {'./modelRules.js': modelRules});
const metricHash = load('src/lib/metrics/hash.js');
const metricErrors = load('src/lib/metrics/errors.js');
const metricStore = load('src/lib/metrics/store.js', {'./hash': metricHash, './errors': metricErrors});
const metricPersistence = load('src/lib/metrics/persistence.js', {'./store': metricStore, './hash': metricHash});
const util = load('src/lib/utils.js', {
  './template/教学管理系统.pdma.json': {}, '../lang': {}, lodash, dot: {},
  '../../profile': {separator: '::'}, './string': {firstUp: s => s[0].toUpperCase() + s.slice(1)},
  './Math': {}, './model_catalog': catalog, './concept_logical_links': conceptLinks,
  './quality/projectMetadata': projectMetadata, './metrics/persistence': metricPersistence,
});
const data = load('src/lib/datasource_util.js', {
  'lodash/object': lodash, moment: {}, components: {FormatMessage: {string: ({id}) => id}},
  './cache': {getAllTabData: () => tabs}, '../lib/template/empty.json': {},
  '../../profile': {separator: '::'}, './string': {firstUp: s => s[0].toUpperCase() + s.slice(1)},
  './update': {}, './template/教学管理系统.pdma.json': {}, './subscribe': {}, './utils': util,
  './event_tool': {}, './concept_logical_links': conceptLinks,
  './quality/projectMetadata': projectMetadata, './metrics/persistence': metricPersistence,
  './drawing_persistence': {drawingPersistence: {isSaved: () => true}},
});
const refs = load('src/app/workbench/references.js');
const clone = value => JSON.parse(JSON.stringify(value));
const makeSource = (suffix = '') => ({
  version: '4.9.4', profile: {dataTypeSupports: [], codeTemplates: [], uiHint: [], default: {},
    modelCatalog: {version: 1, layers: [{id: `layer${suffix}`, defKey: 'DWD', defName: '明细层'}], categories: [
      {id: `cat${suffix}`, layerId: `layer${suffix}`, kind: 'domain', defKey: 'CUSTOMER', members: {
        conceptEntity: [`c${suffix}`], logicEntity: [`l${suffix}`], entity: [`p${suffix}`],
        diagram: [`d${suffix}`], view: [`v${suffix}`], dict: [`dict${suffix}`],
      }},
      {id: `legacy${suffix}`, layerId: `layer${suffix}`, kind: 'subject', defKey: 'LEGACY',
        legacyGroupId: `group${suffix}`, members: {}},
    ]}},
  conceptEntities: [{id: `c${suffix}`, type: 'C', defKey: 'CUSTOMER', defName: '客户', comment: '', fields: [], headers: []}],
  logicEntities: [{id: `l${suffix}`, type: 'L', defKey: 'CUSTOMER_L', fields: [{id: `lf${suffix}`, defKey: 'ID'}], headers: []}],
  entities: [{id: `p${suffix}`, type: 'P', defKey: 'CUSTOMER_P', fields: [{id: `pf${suffix}`, defKey: 'ID'}], headers: []}],
  views: [{id: `v${suffix}`, defKey: 'V', fields: [], headers: []}], dicts: [{id: `dict${suffix}`, defKey: 'D', items: []}],
  domains: [], dataTypeMapping: {mappings: []},
  viewGroups: [{id: `group${suffix}`, defKey: 'LEGACY', refConceptEntities: [`c${suffix}`],
    refLogicEntities: [`l${suffix}`], refEntities: [`p${suffix}`], refDiagrams: [`d${suffix}`], refViews: [], refDicts: []}],
  diagrams: [{id: `d${suffix}`, defKey: 'BUSINESS', defName: '业务概念图', modelLevel: 'conceptual', relationType: 'field', canvasData: {cells: [
    {id: 'cn', shape: 'table', type: 'C', originKey: `c${suffix}`, ports: {items: [{id: 'out'}, {id: 'in'}]}},
    {id: 'ln', shape: 'table', type: 'L', originKey: `l${suffix}`},
    {id: 'pn', shape: 'table', type: 'P', originKey: `p${suffix}`},
    {id: 'vn', shape: 'table', originKey: `v${suffix}`},
    {id: 'edge', shape: 'erdRelation', source: {cell: 'cn', port: 'out'}, target: {cell: 'ln', port: 'in'}},
    {id: 'pedge', shape: 'erdRelation', source: {cell: 'pn', port: `pf${suffix}::out`}, target: {cell: 'pn', port: `pf${suffix}::in`}},
  ]}}],
});
const results = [];
function test(name, action) {
  Object.keys(tabs).forEach(key => delete tabs[key]);
  try {action(); results.push({name, status: 'PASS'});}
  catch (error) {results.push({name, status: 'FAIL', message: error.stack});}
}
test('概念节点独立集合且不渲染物理字段', () => {
  const source = makeSource();
  source.entities.push({...source.conceptEntities[0], defName: '错误集合', fields: [{id: 'wrong'}]});
  const ports = {items: [{id: 'in'}, {id: 'out'}]};
  const node = data.mapData2Table({id: 'cn', type: 'C', originKey: 'c'}, source, null, {}, {}, 'field', ports);
  assert.equal(node.data.defName, '客户'); assert.equal(node.data.fields.length, 0); assert.equal(node.ports, ports);
  const calculated = data.calcNodeData({type: 'C'}, {defKey: 'C', fields: [{id: 'bad'}], headers: [{refKey: 'defKey'}]}, source);
  assert.equal(calculated.fields.length, 0); assert.equal(calculated.headers.length, 0);
});
test('物理及逻辑节点保持来源与字段', () => {
  const source = makeSource();
  for (const [type, originKey] of [['P', 'p'], ['L', 'l']]) {
    const node = data.mapData2Table({type, originKey, needTransform: false}, source, null, {}, {}, 'field', {});
    assert.equal(node.data.type, type); assert.equal(node.data.fields.length, 1);
  }
});
test('有效草稿保存概念基础对象和C端口，不推断旧图级别', () => {
  const source = makeSource();
  tabs.c = {type: 'conceptEntity', isInit: false, data: {...source.conceptEntities[0], defName: '草稿客户', fields: [{id: 'bad'}]}};
  tabs.d = {type: 'diagram', isInit: false, data: {id: 'd', comment: '草稿', modelLevel: 'conceptual', cells: source.diagrams[0].canvasData.cells}};
  const saved = data.updateAllData(source);
  assert.equal(saved.result.status, true); assert.equal(saved.dataSource.conceptEntities[0].defName, '草稿客户');
  assert.equal(saved.dataSource.conceptEntities[0].fields.length, 0);
  assert.equal(saved.dataSource.diagrams[0].canvasData.cells[0].ports.items[0].id, 'out');
  delete source.diagrams[0].modelLevel; delete tabs.d.data.modelLevel;
  assert.equal(data.updateAllData(source).dataSource.diagrams[0].modelLevel, undefined);
});
test('概念18个自定义端口经保存与JSON重载后连线完整', () => {
  const source = makeSource();
  const ports = {items: Array.from({length: 18}, (_, i) => ({id: `port-${i}`, group: 'entity'}))};
  const cells = [
    {id: 'c1', type: 'C', shape: 'table', originKey: 'c', ports},
    {id: 'c2', type: 'C', shape: 'table', originKey: 'c', ports: clone(ports)},
    {id: 'custom-edge', shape: 'erdRelation', source: {cell: 'c1', port: 'port-16'}, target: {cell: 'c2', port: 'port-17'}},
  ];
  tabs.d = {type: 'diagram', isInit: false, data: {id: 'd', cells}};
  const reopened = clone(data.updateAllData(source).dataSource);
  const mapped = data.calcCellData(reopened.diagrams[0].canvasData.cells, reopened, null, {}, {}, 'field', {items: []});
  assert.equal(mapped.filter(cell => cell.shape === 'erdRelation').length, 1);
  assert.equal(mapped[0].ports.items.length, 18); assert.equal(mapped[1].ports.items[17].id, 'port-17');
});
test('概念草稿空代码和同类型代码重复会阻止保存', () => {
  const source = makeSource();
  tabs.c = {type: 'conceptEntity', isInit: false, data: {...source.conceptEntities[0], defKey: ''}};
  assert.equal(data.updateAllData(source).result.status, false);
  source.conceptEntities.push({id: 'c2', defKey: 'OTHER'}); tabs.c.data.defKey = 'other';
  assert.equal(data.updateAllData(source).result.status, false);
});
test('概念搜索含目录多归属与关系图反查，图名称可检索', () => {
  const found = util.getAllData({dataSource: makeSource()});
  const concept = found.find(group => group.key === 'conceptEntities').data[0];
  assert.equal(concept.groups.length, 2); assert.equal(concept.diagramRefs[0].cellId, 'cn');
  assert.equal(found.find(group => group.key === 'diagrams').data[0].defName, '业务概念图');
  assert.equal(found.find(group => group.key === 'fields').data.length, 2);
});
test('概念检查器读取有效草稿及表节点引用', () => {
  const source = makeSource(); const activeTab = {type: 'conceptEntity', menuKey: 'c', tabKey: 'ctab'};
  const target = refs.resolveInspectorTarget({activeTab, tabs: [activeTab], dataSource: source,
    getTabData: () => ({isInit: false, data: {...source.conceptEntities[0], defName: '草稿名称'}})});
  assert.equal(target.data.defName, '草稿名称'); assert.equal(target.type, 'conceptEntity');
  source.diagrams[0].canvasData.cells.unshift({id: 'decoration', originKey: 'c', shape: 'edit-node'});
  assert.equal(refs.calcEntityReferences('c', source)[0].cellId, 'cn');
});
test('导入重建六类ID并完整映射目录层级和旧分组', () => {
  const source = makeSource(); const before = clone(source); const imported = data.reduceProject(source, 'old');
  assert.deepEqual(clone(source), before);
  const category = imported.profile.modelCatalog.categories[0];
  const pairs = {conceptEntity: 'conceptEntities', logicEntity: 'logicEntities', entity: 'entities', diagram: 'diagrams', view: 'views', dict: 'dicts'};
  Object.keys(pairs).forEach(kind => assert.equal(category.members[kind][0], imported[pairs[kind]][0].id));
  assert.equal(category.layerId, imported.profile.modelCatalog.layers[0].id);
  assert.equal(imported.profile.modelCatalog.categories[1].legacyGroupId, imported.viewGroups[0].id);
  assert.equal(imported.viewGroups[0].refConceptEntities[0], imported.conceptEntities[0].id);
  const cells = imported.diagrams[0].canvasData.cells;
  assert.equal(cells[0].originKey, imported.conceptEntities[0].id); assert.equal(cells[1].originKey, imported.logicEntities[0].id);
  assert.equal(cells[3].originKey, imported.views[0].id); assert.equal(cells[4].source.port, 'out');
  assert.equal(cells[5].source.port, `${imported.entities[0].fields[0].id}::out`);
});
test('合并同代码概念与逻辑后沿用ID且新图目录引用不悬空', () => {
  const old = makeSource(); const incoming = makeSource('-new'); const before = clone(old);
  const merged = util._mergeDataSource(old, incoming, incoming.entities);
  assert.deepEqual(clone(old), before);
  assert.equal(merged.conceptEntities.length, 1); assert.equal(merged.conceptEntities[0].id, 'c');
  assert.equal(merged.logicEntities.length, 1); assert.equal(merged.logicEntities[0].id, 'l');
  assert.equal(merged.diagrams[1].canvasData.cells[0].originKey, 'c');
  assert.equal(merged.diagrams[1].canvasData.cells[1].originKey, 'l');
  assert.equal(merged.diagrams[1].canvasData.cells[4].source.port, 'out');
  assert.equal(merged.profile.modelCatalog.layers.length, 1);
  assert.equal(merged.profile.modelCatalog.categories[0].members.conceptEntity.length, 1);
  assert(merged.profile.modelCatalog.categories[0].members.diagram.includes(merged.diagrams[1].id));
  assert.equal(merged.viewGroups[0].refConceptEntities[0], 'c');
  assert.equal(merged.profile.modelCatalog.categories[1].legacyGroupId, merged.viewGroups[0].id);
});
test('旧项目合并概念项目保留新目录、集合及新层顺序', () => {
  const old = makeSource(); delete old.profile.modelCatalog; delete old.conceptEntities;
  const incoming = makeSource('-new'); incoming.profile.modelCatalog.layers.push({id: 'second', defKey: 'ADS'});
  const merged = util._mergeDataSource(old, incoming, incoming.entities);
  assert.equal(merged.conceptEntities.length, 1); assert.equal(merged.profile.modelCatalog.layers[1].defKey, 'ADS');
  assert.equal(merged.profile.modelCatalog.categories[0].members.conceptEntity[0], 'c-new');
});
test('合并保留空的旧主题域和已挂载目录', () => {
  const old = makeSource(); const incoming = makeSource('-new');
  incoming.viewGroups.push({id: 'empty-group', defKey: 'EMPTY'});
  incoming.profile.modelCatalog.categories.push({id: 'empty-category', layerId: 'layer-new',
    defKey: 'EMPTY', kind: 'subject', legacyGroupId: 'empty-group', members: {}});
  const merged = util._mergeDataSource(old, incoming, incoming.entities);
  const category = merged.profile.modelCatalog.categories.find(item => item.defKey === 'EMPTY');
  assert(merged.viewGroups.some(group => group.id === category.legacyGroupId));
});
test('未保存图删除引用后搜索与反查同源归零', () => {
  const source = makeSource(); source.diagrams[0].canvasData.cells = [];
  assert.equal(util.getAllData({dataSource: source}).find(group => group.key === 'conceptEntities').data[0].diagramRefs.length, 0);
  assert.equal(refs.calcEntityReferences('c', source).length, 0);
});
console.log(JSON.stringify(results, null, 2));
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
