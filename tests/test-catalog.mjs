// Synthetic fixtures only. Run: node tests/test-catalog.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const moduleText = readFileSync(new URL('../src/lib/model_catalog.js', import.meta.url), 'utf8');
const api = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString('base64')}`);
const {
  readCatalog, getCatalogCategories, categoryObjects, uncategorizedObjects, inferDiagramLevel,
  createLayer, updateLayer, deleteLayer, moveLayer, createCategory, updateCategory,
  deleteCategory, moveCategory, attachLegacyGroup, addCategoryMembers,
  removeCategoryMembers, moveCategoryMembers,
} = api;

const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const table = (id, originKey, type) => ({
  id, shape: 'table', originKey, ...(type ? {type} : {}),
  position: {x: 17, y: 23}, ports: {items: [{id: `${id}-port`}]},
});
const physical = {id: 'p1', defKey: 'ORDER', type: 'P', fields: [{id: 'f1'}]};
const fixture = freeze({
  profile: {default: {db: 'db1'}},
  entities: [physical, {id: 'p2', defKey: 'UNASSIGNED'}],
  conceptEntities: [{id: 'c1', type: 'C', defName: '订单概念', fields: []}],
  logicEntities: [{id: 'l1', type: 'L', defName: '订单逻辑'}],
  views: [{id: 'v1'}], dicts: [{id: 'dict1'}],
  diagrams: [
    {id: 'd1', canvasData: {cells: [table('n1', 'p1', 'P'),
      {id: 'edge1', shape: 'erdRelation', source: {cell: 'n1'}, target: {cell: 'n2'}}]}},
    {id: 'd2', canvasData: {cells: [table('n2', 'p1')]}},
  ],
  viewGroups: [
    {id: 'g1', defKey: 'TRADE', defName: '交易', refEntities: ['p1', 'p1'],
      refDiagrams: ['d1', 'd2'], refLogicEntities: ['l1'], refViews: ['v1'], refDicts: ['dict1']},
    {id: 'g2', defKey: 'CUSTOMER', refEntities: ['p1'], refDiagrams: ['d2']},
  ],
});
let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
};
const ids = objects => objects.map(item => item.id);
const layerSource = createLayer(createLayer(fixture, {id: 'ods', defKey: 'ODS'}),
  {id: 'dwd', defKey: 'DWD', defName: '明细层'});
const mounted = freeze(attachLegacyGroup(layerSource, 'g1', 'dwd', {kind: 'domain'}));
const categorized = freeze(createCategory(mounted,
  {id: 'cat1', layerId: 'ods', kind: 'subject', members: {entity: ['p2', 'p2']}}));

test('读取旧源只返回空目录，不写模型或自动挂载', () => {
  const before = JSON.stringify(fixture);
  assert.deepEqual(readCatalog(fixture), {version: 1, layers: [], categories: []});
  assert.equal(JSON.stringify(fixture), before);
  assert.equal(fixture.profile.modelCatalog, undefined);
  assert.deepEqual(readCatalog(null), {version: 1, layers: [], categories: []});
});
test('旧主题域按原ID投影且同一物理表保留多重归属', () => {
  assert.deepEqual(getCatalogCategories(fixture).map(item => [item.id, item.legacyGroupId, item.layerId]),
    [['g1', 'g1', null], ['g2', 'g2', null]]);
  assert.deepEqual(ids(categoryObjects(fixture, 'g1').entity), ['p1']);
  assert.deepEqual(ids(categoryObjects(fixture, 'g2').entity), ['p1']);
  assert.deepEqual(Object.keys(categoryObjects(fixture, 'g1')), api.CATALOG_MEMBER_TYPES);
});
test('挂载只存目录元数据，原refs和所有实体/图保持同一引用', () => {
  assert.equal(readCatalog(mounted).categories.length, 1);
  assert.equal(getCatalogCategories(mounted).length, 2);
  assert.equal(readCatalog(mounted).categories[0].legacyGroupId, 'g1');
  assert.equal(mounted.viewGroups[0].refEntities, fixture.viewGroups[0].refEntities);
  ['entities', 'logicEntities', 'conceptEntities', 'diagrams', 'views', 'dicts'].forEach(type =>
    assert.equal(mounted[type], fixture[type]));
  assert.equal(mounted.profile.default, fixture.profile.default);
});
test('重复挂载移动既有目录，不生成第二份分类', () => {
  const moved = attachLegacyGroup(mounted, 'g1', 'ods');
  assert.equal(readCatalog(moved).categories.length, 1);
  assert.equal(readCatalog(moved).categories[0].layerId, 'ods');
  assert.deepEqual(ids(categoryObjects(moved, 'g2').entity), ['p1']);
});
test('原生分类六类成员规范化去重，不复制模型对象', () => {
  assert.deepEqual(readCatalog(categorized).categories[1].members.entity, ['p2']);
  assert.equal(categoryObjects(categorized, 'cat1').entity[0], fixture.entities[1]);
  let source = categorized;
  const selected = {conceptEntity: 'c1', logicEntity: 'l1', entity: 'p1',
    diagram: 'd1', view: 'v1', dict: 'dict1'};
  api.CATALOG_MEMBER_TYPES.forEach((type) => {
    source = addCategoryMembers(source, 'cat1', type, [selected[type], selected[type]]);
    assert(categoryObjects(source, 'cat1')[type].some(item => item.id === selected[type]));
  });
});
test('分层改名和排序不改变ID、源对象及类别顺序', () => {
  const renamed = updateLayer(categorized, 'dwd', {id: 'invalid', defName: '明细'});
  assert.equal(readCatalog(renamed).layers[1].id, 'dwd');
  assert.equal(readCatalog(renamed).layers[1].defName, '明细');
  const moved = moveLayer(renamed, 'dwd', 0);
  assert.deepEqual(readCatalog(moved).layers.map(item => item.id), ['dwd', 'ods']);
  assert.equal(moved.entities, fixture.entities);
});
test('分类移动和同级排序采用目标层内索引', () => {
  let source = createCategory(categorized, {id: 'cat2', layerId: 'ods', kind: 'domain'});
  source = moveCategory(source, 'g1', 'ods', 1);
  assert.deepEqual(readCatalog(source).categories.filter(item => item.layerId === 'ods')
    .map(item => item.id), ['cat1', 'g1', 'cat2']);
  source = moveCategory(source, 'cat2', 'ods', 0);
  assert.deepEqual(readCatalog(source).categories.filter(item => item.layerId === 'ods')
    .map(item => item.id), ['cat2', 'cat1', 'g1']);
  assert.equal(source.diagrams, fixture.diagrams);
});
test('旧分类改名同步原主题域，但只允许元数据变更', () => {
  const source = updateCategory(mounted, 'g1', {
    id: 'bad', legacyGroupId: 'g2', defKey: 'NEW_TRADE', defName: '新交易', members: {},
  });
  assert.equal(readCatalog(source).categories[0].id, 'g1');
  assert.equal(readCatalog(source).categories[0].legacyGroupId, 'g1');
  assert.equal(source.viewGroups[0].defName, '新交易');
  assert.equal(source.viewGroups[1], fixture.viewGroups[1]);
  assert.deepEqual(ids(categoryObjects(source, 'g1').entity), ['p1']);
});
test('旧分类以原refs为准，忽略目录元数据过期成员', () => {
  const catalog = readCatalog(mounted);
  const source = {...mounted, profile: {...mounted.profile, modelCatalog: {...catalog,
    categories: catalog.categories.map(item => ({...item, members: {entity: ['p2']}}))}}};
  assert.deepEqual(ids(categoryObjects(source, 'g1').entity), ['p1']);
});
test('旧分类新增概念成员只写refConceptEntities并去重', () => {
  const source = addCategoryMembers(mounted, 'g1', 'conceptEntity', ['c1', 'c1']);
  assert.deepEqual(source.viewGroups[0].refConceptEntities, ['c1']);
  assert.deepEqual(readCatalog(source).categories[0].members.conceptEntity, []);
  assert.deepEqual(ids(categoryObjects(source, 'g1').conceptEntity), ['c1']);
  assert.equal(fixture.viewGroups[0].refConceptEntities, undefined);
});
test('移走当前分类引用，其他旧归属和所有图引用/位置保持不变', () => {
  const source = moveCategoryMembers(categorized, 'g1', 'cat1', 'entity', ['p1', 'p2']);
  assert.deepEqual(ids(categoryObjects(source, 'g1').entity), []);
  assert.deepEqual(ids(categoryObjects(source, 'g2').entity), ['p1']);
  assert.deepEqual(ids(categoryObjects(source, 'cat1').entity), ['p2', 'p1']);
  assert.equal(source.diagrams, fixture.diagrams);
  assert.equal(source.entities[0], physical);
  assert.deepEqual(fixture.viewGroups[0].refEntities, ['p1', 'p1']);
});
test('删除一份旧分类归属不会作为投影复活，也不让仍有归属对象散落', () => {
  const source = deleteCategory(categorized, 'g1');
  assert.deepEqual(getCatalogCategories(source).map(item => item.id), ['cat1', 'g2']);
  assert.deepEqual(ids(categoryObjects(source, 'g2').entity), ['p1']);
  assert.deepEqual(ids(uncategorizedObjects(source).entity), []);
  assert.equal(source.diagrams, fixture.diagrams);
  assert.equal(source.entities, fixture.entities);
});
test('删除原生分类后无其他归属对象出现在待归档', () => {
  const source = deleteCategory(categorized, 'cat1');
  assert.deepEqual(ids(uncategorizedObjects(source).entity), ['p2']);
  assert.equal(source.entities, fixture.entities);
  assert.equal(deleteCategory(source, 'nonexistent'), source);
});
test('删除分层后分类留在待归档，归属和模型对象仍然可达', () => {
  const source = deleteLayer(categorized, 'dwd');
  assert.equal(getCatalogCategories(source).find(item => item.id === 'g1').layerId, null);
  assert.deepEqual(ids(categoryObjects(source, 'g1').entity), ['p1']);
  assert.equal(source.entities, fixture.entities);
  assert.equal(source.diagrams, fixture.diagrams);
});
test('无归属计算涵盖六类，不将旧投影下对象重复列为散落对象', () => {
  const objects = uncategorizedObjects(fixture);
  assert.deepEqual(ids(objects.entity), ['p2']);
  assert.deepEqual(ids(objects.conceptEntity), ['c1']);
  ['logicEntity', 'diagram', 'view', 'dict'].forEach(type => assert.deepEqual(objects[type], []));
});
test('成员删除只删指定类型引用，缺失对象引用不影响可达对象', () => {
  const source = removeCategoryMembers(categorized, 'g1', 'entity', ['p1']);
  assert.deepEqual(ids(categoryObjects(source, 'g1').entity), []);
  assert.deepEqual(ids(categoryObjects(source, 'g1').logicEntity), ['l1']);
  const dangling = addCategoryMembers(source, 'cat1', 'entity', ['missing']);
  assert.deepEqual(ids(categoryObjects(dangling, 'cat1').entity), ['p2']);
});
test('图推断优先显式级别，无类型节点依据对应源集合判别', () => {
  assert.equal(inferDiagramLevel({modelLevel: 'conceptual', canvasData: {cells: []}}, fixture), 'conceptual');
  assert.equal(inferDiagramLevel(fixture.diagrams[0], fixture), 'physical');
  assert.equal(inferDiagramLevel(fixture.diagrams[1], fixture), 'physical');
  ['C', 'L', 'P'].forEach((type, index) => {
    const expected = ['conceptual', 'logical', 'physical'][index];
    assert.equal(inferDiagramLevel({canvasData: {cells: [table('n', 'absent', type)]}}, fixture), expected);
    assert.equal(inferDiagramLevel({canvasData: {cells: [table('n', ['c1', 'l1', 'p1'][index])]}}, fixture), expected);
  });
});
test('混合、空图、未知或歧义节点不误分类，不使用relationType', () => {
  const diagram = cells => ({relationType: 'entity', canvasData: {cells}});
  assert.equal(inferDiagramLevel(diagram([table('a', 'c1', 'C'), table('b', 'l1', 'L')]), fixture), null);
  assert.equal(inferDiagramLevel(diagram([table('a', 'p1'), table('b', 'unknown')]), fixture), null);
  assert.equal(inferDiagramLevel(diagram([]), fixture), null);
  assert.equal(inferDiagramLevel({relationType: 'field'}, fixture), null);
  assert.equal(inferDiagramLevel(diagram([table('a', 'p1')]),
    {...fixture, logicEntities: [{id: 'p1'}]}), null);
  assert.equal(fixture.diagrams[0].modelLevel, undefined);
});
test('缺失ID、重复ID、非法目标目录/类型不会生成损坏的目录', () => {
  assert.throws(() => createLayer(fixture, {}));
  assert.throws(() => createLayer(layerSource, {id: 'ods'}));
  assert.throws(() => createCategory(layerSource, {id: 'g1'}));
  assert.throws(() => createCategory(layerSource, {id: 'bad', layerId: 'missing'}));
  assert.throws(() => createCategory(layerSource, {id: 'bad', kind: 'unknown'}));
  assert.throws(() => attachLegacyGroup(layerSource, 'missing', 'ods'));
  assert.throws(() => moveCategory(categorized, 'cat1', 'missing'));
  assert.throws(() => addCategoryMembers(categorized, 'cat1', 'unknown', ['p1']));
});
test('挂载/移动/删除/保存重开保持多图引用与布局，所有读操作无落盘推断', () => {
  let source = moveCategoryMembers(categorized, 'g1', 'cat1', 'entity', ['p1']);
  source = deleteCategory(source, 'g1');
  const reopened = JSON.parse(JSON.stringify(source));
  assert.deepEqual(ids(categoryObjects(reopened, 'g2').entity), ['p1']);
  assert.deepEqual(ids(categoryObjects(reopened, 'cat1').entity), ['p2', 'p1']);
  assert.deepEqual(reopened.diagrams, fixture.diagrams);
  assert.deepEqual(reopened.entities, fixture.entities);
  assert.deepEqual(readCatalog(reopened), readCatalog(source));
  const before = JSON.stringify(reopened);
  getCatalogCategories(reopened).forEach(category => categoryObjects(reopened, category));
  uncategorizedObjects(reopened);
  reopened.diagrams.forEach(item => inferDiagramLevel(item, reopened));
  assert.equal(JSON.stringify(reopened), before);
});

console.log(`\n${passed} catalog tests passed.`);
