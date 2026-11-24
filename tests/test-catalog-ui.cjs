// Synthetic hook tests. Run: node tests/test-catalog-ui.cjs
// Execute the real component and catalog operations; replace DOM/hooks and object factories.
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const root = path.resolve(__dirname, '..');
const babel = require(path.join(root, 'node_modules/@babel/core'));
const React = require(path.join(root, 'node_modules/react'));
const compile = relativePath => babel.transformFileSync(path.join(root, relativePath), {
  babelrc: false,
  configFile: false,
  presets: [require.resolve(path.join(root, 'node_modules/@babel/preset-react'))],
  plugins: [
    require.resolve(path.join(root, 'node_modules/@babel/plugin-proposal-optional-chaining')),
    require.resolve(path.join(root, 'node_modules/@babel/plugin-transform-modules-commonjs')),
  ],
}).code;

const catalog = {};
vm.runInNewContext(compile('src/lib/model_catalog.js'), {exports: catalog});
const conceptLinks = {};
vm.runInNewContext(compile('src/lib/concept_logical_links.js'), {exports: conceptLinks});

let source;
let state;
let hookIndex;
let form;
let modalOptions;
let errors;
let confirmation;
let closed;
let serial = 0;
// 组件 hook 顺序: selected=0, expanded=1, paletteOpen=2, menu=3(v0.5.0 新增 paletteOpen 后 menu 下移)
const MENU_HOOK = 3;

const FormatMessage = () => null;
FormatMessage.string = ({id}) => id;
const components = {
  Button: 'button',
  FormatMessage,
  Icon: 'icon',
  Message: {error: data => errors.push(data)},
  Modal: {confirm: (data) => { confirmation = data; }},
  openModal: (node, options) => {
    form = node;
    modalOptions = options;
    return {close: () => { closed = true; }};
  },
};
const react = {
  ...React,
  forwardRef: fn => fn,
  useState: (initial) => {
    const index = hookIndex++;
    if (!(index in state)) state[index] = initial;
    return [state[index], (value) => {
      state[index] = typeof value === 'function' ? value(state[index]) : value;
    }];
  },
  useRef: () => ({current: null}),
  useMemo: fn => fn(),
  useEffect: () => {},
  useImperativeHandle: (ref, fn) => Object.assign(ref, fn()),
};
const factories = {
  getEmptyEntity: (fields, properties) => ({fields, properties, headers: [], type: 'P'}),
  getEmptyView: () => ({fields: [], headers: [], refEntities: []}),
  emptyDict: {items: []},
  getLogicHeaders: () => [],
  getDefaultLogicSys: () => ({lePropOrient: 'V'}),
  resetHeader: () => [],
  emptyRelation: {relationType: 'field'},
};
const context = {
  exports: {},
  require: (name) => {
    if (name === 'react') return react;
    if (name === 'react-dom') return {createPortal: node => node};
    if (name === 'components') return components;
    if (name.endsWith('datasource_util')) return factories;
    if (name.endsWith('model_catalog')) return catalog;
    if (name.endsWith('concept_logical_links')) return conceptLinks;
    // 指标删除影响组件与目录行为无关,用最小桩(只读窄组件,不渲染)
    if (name.endsWith('metrics/deleteImpact')) return {summarizeMetricDeleteImpact: () => null, MetricDeleteImpactBody: () => null};
    throw new Error(`Unexpected component dependency: ${name}`);
  },
  Math: Object.assign(Object.create(Math), {uuid: () => `generated-${++serial}`}),
  window: {innerWidth: 1600, innerHeight: 900},
  document: {body: {}},
};
vm.runInNewContext(compile('src/app/workbench/ModelCatalog.js'), context);
const Component = context.exports.default;

const initialSource = () => ({
  profile: {modelCatalog: {
    version: 1,
    layers: [{id: 'ods', defKey: 'ODS'}],
    categories: [{
      id: 'cat', layerId: 'ods', kind: 'domain', defKey: 'TRADE', members: {},
    }],
  }},
  entities: [],
  logicEntities: [],
  conceptEntities: [],
  diagrams: [],
  views: [],
  dicts: [],
  viewGroups: [],
});
const reset = () => {
  source = initialSource();
  state = [];
  errors = [];
  confirmation = null;
  closed = false;
  form = null;
};
const menu = (selected, readOnly = false) => {
  hookIndex = 0;
  state[0] = selected;
  state[MENU_HOOK] = null;
  const ref = {};
  Component({
    source,
    getSource: () => source,
    onUpdate: (next) => { source = next; },
    onOpen: () => {},
    onDrag: () => {},
    readOnly,
  }, ref);
  ref.create();
  return state[MENU_HOOK]?.items || [];
};
const elements = (node) => {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (typeof node !== 'object') return [];
  return [node, ...elements(node.props?.children)];
};
const input = (name, value) => {
  const element = elements(form).find(item =>
    item.props?.['aria-label'] === `modelCatalog.${name}`);
  assert(element, `Missing form control: ${name}`);
  element.props.onChange({target: {value}});
};
const submit = () => modalOptions.buttons[0].props.onClick();
const creates = node => menu(node).filter(item => item.name.startsWith('modelCatalog.create '));
const categoryNode = {
  kind: 'category', id: 'cat', categoryId: 'cat', layerId: 'ods', category: {defKey: 'TRADE'},
};

let passed = 0;
const test = (name, run) => {
  reset();
  run();
  passed += 1;
  console.log(`PASS ${name}`);
};

test('对象类型视图的无分类模型级别节点提供实体和图新建', () => {
  const actions = creates({kind: 'level', level: 'conceptual', categoryId: null});
  assert.equal(actions.length, 2);
  actions[0].run();
  input('categoryId', 'cat');
  input('code', 'NEW_CONCEPT');
  submit();
  assert.equal(errors.length, 0);
  assert.equal(source.conceptEntities[0].type, 'C');
  assert.equal(source.logicEntities.length, 0);
});
test('分类菜单提供逻辑/物理实体、逻辑/物理图、多表透视和字典共六个创建入口(概念对象已提升至概念模型节点)', () => {
  const names = creates(categoryNode).map(item => item.name);
  assert.equal(names.length, 6);
  // 概念实体/概念关系图不应再出现在分类菜单(S3:概念对象在概念模型根节点创建)
  assert(!names.some(name => /conceptEntity|conceptual/.test(name)), names.join('|'));
});
test('其他资源节点提供多表透视和字典创建入口', () => {
  assert.equal(creates({kind: 'other', categoryId: 'cat'}).length, 2);
});
test('概念对象节点提供同类概念实体和概念图，继承当前分类', () => {
  const actions = creates({
    kind: 'object', objectType: 'conceptEntity', objectId: 'existing',
    level: 'conceptual', categoryId: 'cat',
  });
  assert.equal(actions.length, 2);
  actions[1].run();
  input('code', 'NEW_CONCEPT_GRAPH');
  submit();
  assert.equal(source.diagrams[0].modelLevel, 'conceptual');
  assert.equal(catalog.categoryObjects(source, 'cat').diagram.length, 1);
});
test('无级别图集合保留一个创建入口，显式选择分类和图级别', () => {
  const actions = creates({kind: 'collection', objectType: 'diagram', categoryId: null});
  assert.equal(actions.length, 1);
  actions[0].run();
  input('categoryId', 'cat');
  input('modelLevel', 'logical');
  input('code', 'LOGICAL_GRAPH');
  submit();
  assert.equal(errors.length, 0);
  assert.equal(source.diagrams[0].modelLevel, 'logical');
  assert.equal(source.diagrams[0].relationType, 'entity');
  assert(closed);
});
test('缺少图级别时拒绝提交，不能创建未标记的新图', () => {
  creates({kind: 'collection', objectType: 'diagram', categoryId: 'cat'})[0].run();
  input('code', 'NEEDS_LEVEL');
  submit();
  assert.equal(source.diagrams.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(closed, false);
});
test('多表透视采用view初始化并写入独立views集合和分类归属', () => {
  creates({kind: 'collection', objectType: 'view', categoryId: 'cat'})[0].run();
  input('code', 'NEW_VIEW');
  submit();
  assert.equal(source.views.length, 1);
  assert(Array.isArray(source.views[0].refEntities));
  assert.equal(source.logicEntities.length, 0);
  assert.equal(catalog.categoryObjects(source, 'cat').view.length, 1);
});
test('数据字典采用dict初始化并写入独立dicts集合和分类归属', () => {
  creates({kind: 'collection', objectType: 'dict', categoryId: 'cat'})[0].run();
  input('code', 'NEW_DICT');
  submit();
  assert.equal(source.dicts.length, 1);
  assert(Array.isArray(source.dicts[0].items));
  assert.equal(catalog.categoryObjects(source, 'cat').dict.length, 1);
});
test('物理表创建拒绝与现有多表透视代码冲突，忽略大小写', () => {
  source.views = [{id: 'view1', defKey: 'SHARED'}];
  creates({
    kind: 'collection', objectType: 'entity', categoryId: 'cat', level: 'physical',
  })[0].run();
  input('code', 'shared');
  submit();
  assert.equal(source.entities.length, 0);
  assert.equal(errors.length, 1);
});
test('多表透视创建也拒绝与现有物理表代码冲突', () => {
  source.entities = [{id: 'physical1', defKey: 'SHARED'}];
  creates({kind: 'collection', objectType: 'view', categoryId: 'cat'})[0].run();
  input('code', 'shared');
  submit();
  assert.equal(source.views.length, 0);
  assert.equal(errors.length, 1);
});
test('新建分层提供五个预设提示并仍允许自定义代码', () => {
  menu({kind: 'root'}).find(item => item.name === 'modelCatalog.newLayer').run();
  const datalist = elements(form).find(item => item.type === 'datalist');
  assert(datalist);
  assert.equal(datalist.props.children.length, 5);
  assert.equal(datalist.props.children.map(item => item.props.value).join(','), 'ODS,DWD,DWS,ADS,DIM');
  input('code', 'CUSTOM');
  submit();
  assert(source.profile.modelCatalog.layers.some(layer => layer.defKey === 'CUSTOM'));
});
test('删除分类后选择重置为root，再次新建可进入分层创建', () => {
  menu(categoryNode).find(item => item.name === 'modelCatalog.deleteDirectory').run();
  confirmation.onOk();
  assert.equal(state[0].kind, 'root');
  assert.equal(source.profile.modelCatalog.categories.length, 0);
  assert(menu(state[0]).some(item => item.name === 'modelCatalog.newLayer'));
});
test('删除分层后重置选择，保留待归档分类', () => {
  menu({kind: 'layer', id: 'ods', layerId: 'ods', layer: {defKey: 'ODS'}})
    .find(item => item.name === 'modelCatalog.deleteDirectory').run();
  confirmation.onOk();
  assert.equal(state[0].kind, 'root');
  assert.equal(source.profile.modelCatalog.layers.length, 0);
  assert.equal(source.profile.modelCatalog.categories[0].layerId, null);
});
test('新建分类后所属分层自动展开', () => {
  menu({kind: 'layer', id: 'ods', layerId: 'ods', layer: {defKey: 'ODS'}})
    .find(item => item.name === 'modelCatalog.newCategory').run();
  input('code', 'NEW_DOMAIN');
  submit();
  assert(source.profile.modelCatalog.categories.some(category => category.defKey === 'NEW_DOMAIN'));
  assert(state[1].has('ods'));
});
test('只读状态禁止打开创建菜单', () => {
  // 先确认 MENU_HOOK 槽位正确:可写时根节点能打开非空菜单(hook 顺序漂移时这里失败,
  // 避免下面的只读断言因读错槽位而空洞通过)
  assert.ok(menu({kind: 'root'}).length > 0, `MENU_HOOK=${MENU_HOOK} 不是菜单 state 槽位`);
  assert.equal(menu({kind: 'root'}, true).length, 0);
  assert.equal(state[MENU_HOOK], null);
  assert.equal(form, null);
});

console.log(`\n${passed} catalog UI hook tests passed.`);
