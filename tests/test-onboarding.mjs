// UX-02:空项目三步引导 + 资源树根节点"+"总菜单
//  1) getRootCreateMenu() 恰好三项 [新建 概念实体, 新建 数仓分层, 新建 数据库],key 稳定;
//     概念实体项与"企业概念模型"节点菜单的概念实体项同源(同 key、同动作);
//  2) 空项目判定 isProjectEmpty / shouldShowEmptyStateGuide 的纯函数行为;
//  3) 引导步骤 getEmptyStateGuideSteps:只读隐藏写操作,无逻辑实体时第②步改为先建逻辑实体;
//  4) 引导与菜单引用的文案键 zh/en 均存在且非空(全量 parity 见 test-i18n-parity.mjs);
//  5) ModelCatalog 源码确实经由这两个纯函数构建 root / 企业概念模型菜单,宿主按纯函数决定是否显示引导。
// 运行: node --import ./tests/esm-loader.mjs tests/test-onboarding.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zh from '../src/lang/zh.js';
import en from '../src/lang/en.js';
import {
  CATALOG_MENU_KEYS, getRootCreateMenu, getConceptModelCreateMenu,
} from '../src/lib/model_catalog_menu.js';
import {
  isProjectEmpty, shouldShowEmptyStateGuide, getEmptyStateGuideSteps, ONBOARDING_ACTIONS,
} from '../src/lib/onboarding.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let count = 0;
function ok(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}
const get = (pack, id) => id.split('.').reduce((o, k) => (o == null ? undefined : o[k]), pack);

// ---- 1) root 总菜单 ----
ok('getRootCreateMenu 恰好三项且顺序为 概念实体 / 数仓分层 / 数据库', () => {
  const items = getRootCreateMenu();
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(i => i.key), [
    CATALOG_MENU_KEYS.createConceptEntity, CATALOG_MENU_KEYS.newLayer, CATALOG_MENU_KEYS.newDatabase,
  ]);
  assert.deepEqual(items.map(i => i.action), ['createObject', 'newLayer', 'newDatabase']);
  assert.equal(items[0].type, 'conceptEntity');
  assert.equal(items[0].level, 'conceptual');
});

ok('菜单 key 为稳定字面量(持久契约,改动需同步测试)', () => {
  assert.deepEqual(getRootCreateMenu().map(i => i.key),
    ['create:conceptEntity:conceptual', 'newLayer', 'newDatabase']);
  assert.ok(Object.isFrozen(CATALOG_MENU_KEYS));
});

ok('多次调用结果一致且互不共享对象(调用方改动不污染下一次)', () => {
  const a = getRootCreateMenu();
  const b = getRootCreateMenu();
  assert.deepEqual(a, b);
  a[0].type = 'mutated';
  assert.equal(getRootCreateMenu()[0].type, 'conceptEntity');
});

ok('root 的概念实体项与"企业概念模型"节点的概念实体项同源', () => {
  const concept = getConceptModelCreateMenu();
  assert.deepEqual(concept.map(i => i.key),
    [CATALOG_MENU_KEYS.createConceptEntity, CATALOG_MENU_KEYS.createConceptDiagram]);
  assert.deepEqual(getRootCreateMenu()[0], concept[0]);
});

// ---- 2) 空项目判定 ----
ok('空项目(empty.json 形态 / 缺省集合 / null)判定为空', () => {
  assert.equal(isProjectEmpty({entities: [], logicEntities: [], views: [], diagrams: [], dicts: []}), true);
  assert.equal(isProjectEmpty({}), true);
  assert.equal(isProjectEmpty(null), true);
  // 仅有分层/数据域目录、字典、数据域等配置不算模型内容
  assert.equal(isProjectEmpty({profile: {catalog: {layers: [{id: 'l'}]}}, dicts: [{id: 'd'}], domains: [{id: 'x'}]}), true);
});

ok('任一模型对象(概念/逻辑/物理实体、视图、关系图)存在即非空', () => {
  ['conceptEntities', 'logicEntities', 'entities', 'views', 'diagrams'].forEach((name) => {
    assert.equal(isProjectEmpty({[name]: [{id: '1'}]}), false, name);
  });
});

ok('引导仅在"无打开页签 且 空项目"时显示', () => {
  const empty = {entities: []};
  assert.equal(shouldShowEmptyStateGuide({dataSource: empty, tabCount: 0}), true);
  assert.equal(shouldShowEmptyStateGuide({dataSource: empty, tabCount: 1}), false);
  assert.equal(shouldShowEmptyStateGuide({dataSource: {conceptEntities: [{id: 'c'}]}, tabCount: 0}), false);
});

ok('只读不影响是否显示(只读空项目同样显示引导,但隐藏写操作)', () => {
  assert.equal(shouldShowEmptyStateGuide({dataSource: {}, tabCount: 0, readOnly: true}), true);
});

// ---- 3) 引导步骤 ----
ok('三步依次为 概念实体 / 逻辑物理模型 / 导出文档,可写空项目第②步先建逻辑实体', () => {
  const steps = getEmptyStateGuideSteps({dataSource: {}, readOnly: false});
  assert.deepEqual(steps.map(s => s.key), ['concept', 'model', 'export']);
  assert.deepEqual(steps.map(s => s.action), [
    ONBOARDING_ACTIONS.createConceptEntity, ONBOARDING_ACTIONS.createLogicEntity,
    ONBOARDING_ACTIONS.exportDocument,
  ]);
  assert.equal(steps[1].hintKey, 'onboarding.model.hintNoLogic');
});

ok('已有逻辑实体时第②步直接打开前向工程', () => {
  const steps = getEmptyStateGuideSteps({dataSource: {logicEntities: [{id: 'l'}]}, readOnly: false});
  assert.equal(steps[1].action, ONBOARDING_ACTIONS.forwardEngineering);
  assert.equal(steps[1].actionKey, 'onboarding.model.action');
  assert.equal(steps[1].hintKey, undefined);
});

ok('只读:创建/生成类按钮隐藏,导出文档保留', () => {
  const steps = getEmptyStateGuideSteps({dataSource: {}, readOnly: true});
  assert.deepEqual(steps.map(s => s.action), [null, null, ONBOARDING_ACTIONS.exportDocument]);
  assert.equal(steps[0].actionKey, undefined);
  assert.equal(steps[1].actionKey, undefined);
  assert.equal(steps[1].hintKey, undefined);
});

// ---- 4) 文案 ----
ok('引导与菜单涉及的文案键 zh/en 均非空', () => {
  const ids = new Set(['onboarding.title', 'onboarding.subtitle', 'onboarding.readOnlyHint',
    'modelCatalog.create', 'modelCatalog.conceptEntity', 'modelCatalog.newLayer', 'modelCatalog.newDatabase']);
  [false, true].forEach(readOnly => [{}, {logicEntities: [{id: 'l'}]}].forEach(dataSource =>
    getEmptyStateGuideSteps({dataSource, readOnly}).forEach(s =>
      ['titleKey', 'descKey', 'actionKey', 'hintKey'].forEach(k => s[k] && ids.add(s[k])))));
  const missing = [];
  ids.forEach(id => [['zh', zh], ['en', en]].forEach(([lang, pack]) => {
    const v = get(pack, id);
    if (typeof v !== 'string' || !v.trim()) missing.push(`${lang}:${id}`);
  }));
  assert.deepEqual(missing, []);
});

// ---- 5) 接线(静态) ----
ok('ModelCatalog 经由纯函数构建 root 与企业概念模型菜单', () => {
  const src = read('src/app/workbench/ModelCatalog.js');
  assert.match(src, /getRootCreateMenu\(\)/);
  assert.match(src, /getConceptModelCreateMenu\(\)/);
  // root 不再只给"新建数仓分层"
  assert.doesNotMatch(src, /node\.kind === 'root' \|\| node\.kind === 'pending'\) add\('newLayer'/);
});

ok('工作台宿主按 shouldShowEmptyStateGuide 渲染 EmptyStateGuide', () => {
  const src = read('src/app/main/index.js');
  assert.match(src, /shouldShowEmptyStateGuide\(/);
  assert.match(src, /<EmptyStateGuide\b/);
  assert.ok(fs.existsSync(path.join(ROOT, 'src/app/main/EmptyStateGuide.js')));
});

console.log(`\n${count} passed`);
