#!/usr/bin/env node
'use strict';
/**
 * 指标平台 M5A — 血缘与影响测试（真实源码经 Babel 加载，真实 M1/M4A/M5A API）。
 *
 * 运行：node doc/developer/metric-platform-v1/lineage-test.cjs（仓库根目录）
 *
 * 范围（合成夹具，不读模板/真实项目/tester）：
 * - 领域层 buildLineageGraph/layoutLineageColumns/getLineageImpact：方向与固定版本
 *   隔离、继承不算计算、同表不同字段无假环、真正循环（含声明来源参与确认环校验、
 *   合法链路零长度路径不误报）、直接/传递去重、声明来源覆盖/去重、失效状态与快照、
 *   三类影响口径（指标版本/模型端点/字典维度）；
 * - UI 层 LineagePage（合成 React）：真实空态/无关系态、投影与状态筛选、逐层展开、
 *   节点/边详情（表达式/用途/证据/失效原因）、互跳回调（含精确打开模型字段）、
 *   影响面板统计与口径说明；
 * - 工作台/main 接缝：openRequest lineage 定位、模型页“查看血缘”改指血缘页、
 *   目录/关联页入口；zh/en 语言键奇偶。
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const babel = require(path.join(PROJECT_ROOT, 'node_modules', '@babel', 'core'));
const realReact = require(path.join(PROJECT_ROOT, 'node_modules', 'react'));
const reactDomServer = require(path.join(PROJECT_ROOT, 'node_modules', 'react-dom', 'server'));

// ---------------------------------------------------------------- 断言器
let passed = 0;
let failed = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (e) {
    failed += 1;
    failures.push(name);
    console.log(`FAIL ${name}`);
    console.log(`     ${e && e.message ? e.message.split('\n')[0] : e}`);
    if (process.env.M5A_DEBUG && e && e.stack) console.log(e.stack.split('\n').slice(1, 8).join('\n'));
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const assertIncludes = (hay, needle, msg) => {
  assert(String(hay).indexOf(needle) !== -1, `${msg || 'expected inclusion'} — 未找到 "${needle}"`);
};
const eq = (actual, expected, msg) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${msg || 'not equal'} — 实际 ${a} 期望 ${b}`);
};

// ---------------------------------------------------------------- 加载器
function loadWithStubs(filename, stubs, customReact, cache) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const source = fs.readFileSync(filename, 'utf8');
  const {code} = babel.transformSync(source, {
    filename,
    presets: [
      [path.join(PROJECT_ROOT, 'node_modules', '@babel', 'preset-env'),
        {targets: {node: '12'}, modules: 'commonjs'}],
      path.join(PROJECT_ROOT, 'node_modules', '@babel', 'preset-react'),
    ],
    babelrc: false, configFile: false, sourceType: 'module',
  });
  const m = new Module(filename, null);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m.require = (request) => {
    if (customReact && request === 'react') return customReact;
    if (!customReact && request === 'react') return realReact;
    if (stubs && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (Module.builtinModules.includes(request)) return require(request);
    if (/\.(less|css|svg|png|jpe?g|gif)$/i.test(request)) return {};
    const abs = path.resolve(path.dirname(filename), request);
    const isFile = p => fs.existsSync(p) && fs.statSync(p).isFile();
    for (const candidate of [abs, `${abs}.js`, path.join(abs, 'index.js')]) {
      if (isFile(candidate)) return loadWithStubs(candidate, stubs, customReact, cache);
    }
    throw new Error(`模块不允许引用外部依赖: ${request}`);
  };
  m._compile(code, filename);
  cache.set(filename, m);
  return m.exports;
}

const zhLang = loadWithStubs(path.join(PROJECT_ROOT, 'src/lang/zh.js'), {}, null, new Map()).default;
const enLang = loadWithStubs(path.join(PROJECT_ROOT, 'src/lang/en.js'), {}, null, new Map()).default;
const lookup = (obj, dotted) => {
  let cur = obj;
  for (const part of String(dotted).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
};
const interpolate = (text, data) => String(text == null ? '' : text)
  .replace(/\{(\w+)\}/g, (all, word) => (data && Object.prototype.hasOwnProperty.call(data, word)
    ? String(data[word]) : all));

const confirms = [];
const FormatMessageStub = Object.assign(
  ({id, data}) => interpolate(lookup(zhLang, id) != null ? lookup(zhLang, id) : id, data),
  {string: ({id, data}) => {
    const v = lookup(zhLang, id);
    return v == null ? (id || '') : interpolate(v, data);
  }});
const componentStubs = {
  'components': {
    FormatMessage: FormatMessageStub,
    Message: {
      success: () => {},
      error: () => {},
    },
    Modal: {
      confirm: n => confirms.push(n),
      info: () => {},
    },
  },
};

const metricsDir = path.join(PROJECT_ROOT, 'src', 'app', 'metrics');
const realCache = new Map();
const loadReal = f => loadWithStubs(path.join(metricsDir, f), componentStubs, null, realCache);

// ---------------------------------------------------------------- 合成 React
function createSyntheticReact() {
  let hooks = [];
  let cursor = 0;
  let pendingEffects = [];
  let effectState = new Map();
  let mount = null;
  const depsEqual = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  };
  const sharedRef = {current: null};
  const react = {
    createElement: realReact.createElement,
    Fragment: realReact.Fragment,
    memo: Component => Component,
    forwardRef: render => {
      const wrapped = props => render(props, sharedRef);
      wrapped.__syntheticForward = true;
      return wrapped;
    },
    useState: initial => {
      if (!hooks[cursor]) hooks[cursor] = {value: typeof initial === 'function' ? initial() : initial};
      const slot = hooks[cursor];
      cursor += 1;
      const setState = update => {
        const next = typeof update === 'function' ? update(slot.value) : update;
        if (Object.is(next, slot.value)) return;
        slot.value = next;
        if (mount) mount.scheduleRender();
      };
      return [slot.value, setState];
    },
    useMemo: (factory, deps) => {
      const prev = hooks[cursor];
      if (!prev || !depsEqual(prev.deps, deps)) hooks[cursor] = {deps, value: factory()};
      cursor += 1;
      return hooks[cursor - 1].value;
    },
    useCallback: (fn, deps) => {
      const prev = hooks[cursor];
      if (!prev || !depsEqual(prev.deps, deps)) hooks[cursor] = {deps, fn};
      cursor += 1;
      return hooks[cursor - 1].fn;
    },
    useRef: initial => {
      if (!hooks[cursor]) hooks[cursor] = {current: initial};
      const slot = hooks[cursor];
      cursor += 1;
      return slot;
    },
    useEffect: (effect, deps) => {
      pendingEffects.push({index: cursor, effect, deps});
      if (!hooks[cursor]) hooks[cursor] = {type: 'effect'};
      cursor += 1;
    },
    useImperativeHandle: (ref, factory) => {
      if (ref) ref.current = factory();
      cursor += 1;
    },
  };
  react.default = react;
  const runEffects = () => {
    pendingEffects.forEach(({index, effect, deps}) => {
      const prev = effectState.get(index);
      if (!prev || !depsEqual(prev.deps, deps)) {
        if (prev && typeof prev.cleanup === 'function') prev.cleanup();
        effectState.set(index, {deps, cleanup: effect()});
      }
    });
    pendingEffects = [];
  };
  function mountComponent(Comp, props) {
    hooks = []; cursor = 0; pendingEffects = []; effectState = new Map();
    sharedRef.current = null;
    const m = {
      props,
      element: null,
      rendering: false,
      queued: false,
      setProps(patch) {
        m.props = Object.assign({}, m.props, patch);
        m.render();
      },
      scheduleRender() {
        if (m.rendering) { m.queued = true; return; }
        m.render();
      },
      render() {
        m.rendering = true;
        do {
          m.queued = false;
          cursor = 0;
          m.element = Comp(m.props);
          runEffects();
        } while (m.queued);
        m.rendering = false;
      },
    };
    mount = m;
    m.render();
    return m;
  }
  return {react, mountComponent, sharedRef};
}

const synthetic = createSyntheticReact();
const synthCache = new Map();
const loadSynthReact = f => loadWithStubs(path.join(metricsDir, f), componentStubs,
  synthetic.react, synthCache);

const collect = (element, pred, found = []) => {
  if (Array.isArray(element)) {
    element.forEach(c => collect(c, pred, found));
    return found;
  }
  if (!element || typeof element !== 'object') return found;
  if (pred(element)) found.push(element);
  const children = element.props && element.props.children;
  if (children == null) return found;
  collect(children, pred, found);
  return found;
};
const byTestId = (root, testid) => collect(root,
  el => el.props && el.props['data-testid'] === testid);
const firstByTestId = (root, testid) => {
  const hits = byTestId(root, testid);
  return hits.length ? hits[0] : null;
};
const setTestId = (root, testid, value) => {
  const el = firstByTestId(root, testid);
  if (!el) throw new Error(`未找到控件 ${testid}`);
  el.props.onChange({target: {value}});
};
const selectTestId = setTestId;
const countType = (root, Comp) => collect(root, el => el.type === Comp).length;

// ---------------------------------------------------------------- 夹具与真实 API
const fixtures = require('./core-fixtures.cjs');
const coreApi = loadWithStubs(path.join(PROJECT_ROOT, 'src/lib/metric_platform.js'),
  {}, null, new Map());

/**
 * 合成世界：
 * 金额/订单两原子（paid_amount 修订出 v1、v2 两版）→ 各自派生 → 复合客单价；
 * 部门派生（baseline 锁公共 v1）；绑定：confirmed 来源（金额 v1）、suggested 来源
 * （订单）、物化输出（复合→dws_aov.aov）、使用引用（复合→portal 模型）、语义映射
 * （逻辑对象↔概念）；金额原子 spec.source 声明同表另一字段（声明来源去重用）。
 */
function buildWorld() {
  let source = fixtures.baseProject();
  source = {
    ...source,
    entities: source.entities.concat([
      {id: 'entity-dws-aov', defKey: 'dws_trade_aov', defName: '客单价汇总', type: 'P',
        fields: [
          {id: 'field-aov', defKey: 'aov', defName: '客单价', type: 'DECIMAL'},
          {id: 'field-aov-date', defKey: 'stat_date', defName: '统计日期', type: 'DATE'},
        ]},
      {id: 'entity-portal', defKey: 'ads_ops_board', defName: '经营看板', type: 'P',
        fields: [{id: 'field-board-aov', defKey: 'aov_7d', defName: '近7日客单价', type: 'DECIMAL'}]},
    ]),
  };
  const concept = coreApi.createMetricConcept(source,
    {id: 'concept-pay', domain: '交易', name: '支付', owner: 'user-owner'});
  source = concept.source;
  const publish = (draft, revId) => {
    const p = coreApi.publishMetricRevision(draft.source, revId, {});
    assert(p.ok, JSON.stringify(p.errors));
    return p.source;
  };
  // 金额原子 v1（修订来源字段为同表 order_id → 声明来源与绑定端点不同，覆盖去重用例）
  const amountV1Spec = JSON.parse(JSON.stringify(fixtures.paidAmountAtomic('metric-paid-amount')));
  amountV1Spec.spec.source = {modelId: 'entity-trade-order', fieldId: 'field-order-id'};
  const a1 = coreApi.createMetricDraft(source, Object.assign(amountV1Spec,
    {revisionId: 'mrev-paid-amount-1', conceptId: 'concept-pay'}));
  assert(a1.ok, JSON.stringify(a1.errors));
  source = publish(a1, 'mrev-paid-amount-1');
  // 金额原子 v2（来源切回金额字段）：同定义两版本供版本隔离
  const amountV2Spec = JSON.parse(JSON.stringify(fixtures.paidAmountAtomic('metric-paid-amount')));
  const a2 = coreApi.createRevisionDraft(source, 'metric-paid-amount', {});
  assert(a2.ok, JSON.stringify(a2.errors));
  source = a2.source;
  const a2u = coreApi.updateMetricDraft(source, a2.revision.id,
    {spec: amountV2Spec.spec}, {});
  assert(a2u.ok, JSON.stringify(a2u.errors));
  source = publish(a2u, a2.revision.id);
  const amountV2Id = a2.revision.id;
  // 订单原子
  const o1 = coreApi.createMetricDraft(source, Object.assign(
    fixtures.paidOrdersAtomic('metric-paid-orders'), {revisionId: 'mrev-paid-orders-1'}));
  assert(o1.ok, JSON.stringify(o1.errors));
  source = publish(o1, 'mrev-paid-orders-1');
  // 派生锁定金额 v1（固定版本）
  const d1 = coreApi.createMetricDraft(source, Object.assign(
    fixtures.paidAmount7dDerived('metric-paid-7d', 'mrev-paid-amount-1'),
    {revisionId: 'mrev-paid-7d-1', conceptId: 'concept-pay'}));
  source = publish(d1, 'mrev-paid-7d-1');
  const d2 = coreApi.createMetricDraft(source, Object.assign(
    fixtures.paidOrders7dDerived('metric-paid-orders-7d', 'mrev-paid-orders-1'),
    {revisionId: 'mrev-paid-orders-7d-1'}));
  source = publish(d2, 'mrev-paid-orders-7d-1');
  // 复合（引用两派生固定版本）
  const c1 = coreApi.createMetricDraft(source, fixtures.aovCompound('metric-aov-7d',
    'amount', 'orders', 'mrev-paid-7d-1', 'mrev-paid-orders-7d-1'));
  assert(c1.ok, JSON.stringify(c1.errors));
  source = publish(c1, c1.revision.id);
  const aovRevId = c1.revision.id;
  // 部门派生（baseline 锁公共金额 7 日 v1；公共继承非计算）
  const dep = coreApi.createDepartmentMetricDraft(source, {
    baseRevisionId: 'mrev-paid-7d-1', departmentId: 'ops', ownerId: 'user-ops',
    code: 'ops.paid_amount_7d', patch: fixtures.opsPatch(),
  });
  assert(dep.ok, JSON.stringify(dep.errors));
  source = publish(dep, dep.revision.id);
  const deptRevId = dep.revision.id;
  // 绑定
  const bind = (input) => {
    const r = coreApi.createMetricBinding(source, input);
    assert(r.ok, JSON.stringify(r.errors));
    source = r.source;
    return r.binding;
  };
  bind({id: 'mb-src-amount', role: 'COMPUTES_FROM', revisionId: 'mrev-paid-amount-1',
    modelRef: {collection: 'entities', objectId: 'entity-trade-order',
      fieldId: 'field-paid-amount'},
    mapping: {aggregate: 'SUM', timeFieldId: 'field-paid-at'},
    evidence: {kind: 'manual', note: '口径评审 2026-10', confirmedBy: 'u-owner'},
    state: 'confirmed', createdBy: 'u-owner'});
  bind({id: 'mb-src-orders', role: 'COMPUTES_FROM', revisionId: 'mrev-paid-orders-1',
    modelRef: {collection: 'entities', objectId: 'entity-trade-order', fieldId: 'field-order-id'},
    state: 'suggested', createdBy: 'u-owner'});
  bind({id: 'mb-mat-aov', role: 'MATERIALIZES_INTO', revisionId: aovRevId,
    modelRef: {collection: 'entities', objectId: 'entity-dws-aov', fieldId: 'field-aov'},
    mapping: {usage: 'DWS 日表落地'}, state: 'confirmed', createdBy: 'u-owner'});
  bind({id: 'mb-consume-board', role: 'CONSUMED_BY', revisionId: aovRevId,
    modelRef: {collection: 'entities', objectId: 'entity-portal', fieldId: 'field-board-aov'},
    mapping: {usage: '经营看板消费'}, state: 'confirmed', createdBy: 'u-owner'});
  bind({id: 'mb-sem-logic', role: 'SEMANTIC_MATCH', revisionId: aovRevId,
    modelRef: {collection: 'logicEntities', objectId: 'logic-order'},
    mapping: {description: '订单逻辑承载支付语义', semanticKind: 'measure'},
    state: 'confirmed', createdBy: 'u-owner'});
  return {source, aovRevId, amountV2Id, deptRevId};
}

const nodeIds = graph => graph.nodes.map(n => n.id);
const edgeOf = (graph, id) => graph.edges.filter(e => e.id === id)[0];

// ================================================================ 领域层

test('L1 方向与固定版本隔离：派生锁 v1；依赖边指向固定版本；边方向正确', () => {
  const {source, aovRevId, amountV2Id} = buildWorld();
  const g = coreApi.buildLineageGraph(source,
    {focus: {revisionId: aovRevId}, direction: 'both', depth: 'all'});
  assert(g.ok, '图构建成功');
  // 固定版本隔离：依赖边只指向派生锁定的 v1；v2 只能经“自己的声明来源边”入图
  const depToV2 = g.edges.filter(e => e.kind === 'dependency' && e.to === `m:${amountV2Id}`);
  eq(depToV2.length, 0, '无依赖边指向 v2（派生锁定 v1）');
  const dep = g.edges.filter(e => e.kind === 'dependency'
    && e.from === 'm:mrev-paid-amount-1' && e.to === 'm:mrev-paid-7d-1')[0];
  assert(dep, '指标依赖方向：原子 v1 → 派生（上游→下游，固定版本）');
  if (nodeIds(g).indexOf(`m:${amountV2Id}`) >= 0) {
    const v2Edges = g.edges.filter(e => e.from === `m:${amountV2Id}` || e.to === `m:${amountV2Id}`);
    assert(v2Edges.every(e => e.kind === 'declared-source' && e.to === `m:${amountV2Id}`),
      'v2 仅以自身声明来源边入图（不冒充依赖/绑定）');
  }
  // 方向：字段→原子（compute-source）、复合→落地字段（materialization）
  const src = g.edges.filter(e => e.kind === 'compute-source'
    && e.to === 'm:mrev-paid-amount-1')[0];
  assert(src && src.from === 'f:entities:entity-trade-order:field-paid-amount',
    '计算来源方向：模型字段 → 指标');
  const mat = g.edges.filter(e => e.kind === 'materialization'
    && e.from === `m:${aovRevId}`)[0];
  assert(mat && mat.to === 'f:entities:entity-dws-aov:field-aov', '物化输出方向：指标 → 落地字段');
  // 上游-only 视图不含落地/消费
  const up = coreApi.buildLineageGraph(source,
    {focus: {revisionId: aovRevId}, direction: 'upstream', depth: 'all'});
  assert(up.edges.every(e => e.kind !== 'materialization' && e.kind !== 'consumption'),
    '上游视图不含物化/消费边');
});

test('L2 公共继承不算计算：baseline 单列投影；影响单列为口径通知', () => {
  const {source, deptRevId} = buildWorld();
  const computeOnly = coreApi.buildLineageGraph(source,
    {focus: {revisionId: deptRevId}, direction: 'both', depth: 'all', projections: ['compute']});
  assert(computeOnly.edges.every(e => e.kind !== 'baseline'), '计算投影不含继承边');
  const inherit = coreApi.buildLineageGraph(source,
    {focus: {revisionId: deptRevId}, direction: 'both', depth: 'all', projections: ['inheritance']});
  const base = inherit.edges.filter(e => e.kind === 'baseline')[0];
  assert(base && base.from === 'm:mrev-paid-7d-1' && base.to === `m:${deptRevId}`,
    '继承边：公共版本 → 部门版本');
  // 影响口径：BASELINE 是通知不是计算下游
  const impact = coreApi.getLineageImpact(source, {revisionId: 'mrev-paid-7d-1'});
  const directCodes = impact.direct.metrics.map(m => m.code);
  assert(directCodes.indexOf('ops.paid_amount_7d') >= 0, '部门版本在直接影响中（BASELINE）');
  const deptEntry = impact.direct.metrics.filter(m => m.code === 'ops.paid_amount_7d')[0];
  eq(deptEntry.roles, ['BASELINE'], '部门版本角色=BASELINE');
  eq(impact.stats.baselineNotifyCount, 1, '口径通知单独计数');
  assert(impact.transitive.metrics.every(m => m.code !== 'ops.paid_amount_7d'),
    '继承不计入计算传递影响');
});

test('L3 同表不同字段不产生假环；字段端点独立成节点', () => {
  let {source, aovRevId} = buildWorld();
  // compound 物化到 dws_aov.aov；另一指标从同表不同字段（stat_date）取数 → 无环
  const other = coreApi.createMetricBinding(source, {
    role: 'COMPUTES_FROM', revisionId: 'mrev-paid-orders-1',
    modelRef: {collection: 'entities', objectId: 'entity-dws-aov', fieldId: 'field-aov-date'},
    state: 'confirmed', createdBy: 'u',
  });
  assert(other.ok, `同表不同字段应允许：${JSON.stringify(other.errors)}`);
  source = other.source;
  eq(coreApi.listBindingCycles(source), [], '无假环');
  const g = coreApi.buildLineageGraph(source,
    {focus: {revisionId: aovRevId}, direction: 'both', depth: 'all'});
  assert(nodeIds(g).indexOf('f:entities:entity-dws-aov:field-aov') >= 0
    && nodeIds(g).indexOf('f:entities:entity-dws-aov:field-aov-date') >= 0,
    '同表两个字段是两个端点节点');
});

test('L4 真正循环：自环/跨端点环检出；声明来源参与确认环校验；合法链不误报', () => {
  const {source, aovRevId} = buildWorld();
  // (a) 协调者用例1：合法 原子→派生→复合→ads 输出 无环（零长度路径不误报）
  eq(coreApi.listBindingCycles(source), [], '合法链路 listBindingCycles 为空');
  // (b) 协调者用例2：复合物化回其依赖原子声明的来源字段 → 真实环拒绝
  //     （金额原子 v2 spec.source 声明 field-paid-amount；复合经派生依赖它）
  const bad = coreApi.createMetricBinding(source, {
    role: 'MATERIALIZES_INTO', revisionId: aovRevId,
    modelRef: {collection: 'entities', objectId: 'entity-trade-order',
      fieldId: 'field-paid-amount'},
    state: 'confirmed', createdBy: 'u',
  });
  assert(!bad.ok && bad.errors[0].code === 'BINDING_CYCLE',
    '声明来源参与确认环校验（复合→声明字段→原子→派生→复合）');
  const path = bad.errors[0].params.path;
  assert(String(path).indexOf('mrev-paid-amount-1') >= 0
    && String(path).indexOf('mrev-paid-7d-1') >= 0, '环路径含原子与派生版本');
  // (c) 同版本同端点自环：v1 在 field-paid-amount 有 confirmed 取数绑定，
  //     再物化同字段 → 真实自环拒绝
  const selfLoop = coreApi.createMetricBinding(source, {
    role: 'MATERIALIZES_INTO', revisionId: 'mrev-paid-amount-1',
    modelRef: {collection: 'entities', objectId: 'entity-trade-order',
      fieldId: 'field-paid-amount'},
    state: 'confirmed', createdBy: 'u',
  });
  assert(!selfLoop.ok && selfLoop.errors[0].code === 'BINDING_CYCLE',
    '同版本经同字段既取数（confirmed 绑定）又落地 → 自环拒绝');
  // (d) 旧写防线保持：纯绑定跨端点环（端点避开 spec.source 声明字段）仍拒绝
  let s2 = fixtures.baseProject();
  const mk = (factory, id, rev) => {
    const r = coreApi.createMetricDraft(s2, Object.assign(factory(id), {revisionId: rev}));
    const p = coreApi.publishMetricRevision(r.source, rev, {});
    assert(p.ok, JSON.stringify(p.errors));
    s2 = p.source;
  };
  mk(fixtures.paidAmountAtomic, 'm-paid', 'r-paid-1');
  const d = coreApi.createMetricDraft(s2,
    fixtures.paidAmount7dDerived('m-paid-7d', 'r-paid-1'));
  const pd = coreApi.publishMetricRevision(d.source, d.revision.id, {});
  assert(pd.ok, JSON.stringify(pd.errors));
  s2 = pd.source;
  const b = (input) => {
    const r = coreApi.createMetricBinding(s2, input);
    assert(r.ok, JSON.stringify(r.errors));
    s2 = r.source;
    return r;
  };
  // paid 物化 f-channel；7d 从 f-channel 取数（边 paid→7d）；7d 物化 f-status
  b({role: 'MATERIALIZES_INTO', revisionId: 'r-paid-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-trade-order', fieldId: 'field-channel'}});
  b({role: 'COMPUTES_FROM', revisionId: d.revision.id, state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-trade-order', fieldId: 'field-channel'}});
  b({role: 'MATERIALIZES_INTO', revisionId: d.revision.id, state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-trade-order', fieldId: 'field-status'}});
  // paid 再从 f-status 取数 → paid→7d→paid 闭环拒绝
  const close = coreApi.createMetricBinding(s2, {
    role: 'COMPUTES_FROM', revisionId: 'r-paid-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-trade-order', fieldId: 'field-status'}});
  assert(!close.ok && close.errors[0].code === 'BINDING_CYCLE', '纯绑定跨端点环仍拒绝');
  // 全景环如实报告：拒绝写入后 store 保持无环（诊断口径与写防线一致）
  eq(coreApi.listBindingCycles(s2).length, 0, '拒绝写入后 store 保持无环');
});

test('L5 影响直接/传递去重：同版本多角色一次；传递带路径；端点去重', () => {
  const {source, aovRevId} = buildWorld();
  const impact = coreApi.getLineageImpact(source, {revisionId: aovRevId});
  // 直接：无定义直接引用复合 → 空；但复合自身有端点（物化/消费/语义映射）
  eq(impact.stats.directCount, 0, '复合无下游定义引用');
  eq(impact.stats.endpointCount, 3, '物化 + 消费 + 语义端点各一（去重后）');
  // 金额 v1：直接=paid_7d(ATOMIC_BASE)+部门(BASELINE)；传递=复合
  const amountImpact = coreApi.getLineageImpact(source, {revisionId: 'mrev-paid-amount-1'});
  eq(amountImpact.stats.directCount, 2, '金额 v1 直接 2（派生 + 部门基线）');
  const transitiveCodes = amountImpact.transitive.metrics.map(m => m.code);
  eq(transitiveCodes, ['app_aov_7d'], '传递=复合（沿依赖链，去重）');
  const path = amountImpact.transitive.metrics[0].path;
  // 传递路径从直接下游出发（焦点自身不计入路径）
  assert(amountImpact.direct.metrics.some(m => m.revisionId === path[0]),
    '传递路径起点为直接下游版本');
  assert(path.indexOf('mrev-paid-7d-1') >= 0, '路径经过直接下游');
  eq(path[path.length - 1], aovRevId, '传递路径终点为传递受影响版本');
  // 同一版本同时命中 BINDING 与 DECLARED → 端点影响只计一次
  const eImpact = coreApi.getLineageImpact(source,
    {collection: 'entities', objectId: 'entity-trade-order', fieldId: 'field-paid-amount'});
  const revIds = eImpact.direct.metrics.map(m => m.revisionId);
  eq(revIds.filter(id => id === 'mrev-paid-amount-1').length, 1,
    '绑定与声明命中同一版本只计一次（去重）');
});

test('L6 声明来源覆盖/去重：绑定优先；未覆盖声明可见且不伪造确认', () => {
  const {source, aovRevId, amountV2Id} = buildWorld();
  // 声明边共 3 条：v1→field-order-id（无同端点生效绑定）、v2→field-paid-amount
  // （v1 的绑定不覆盖 v2，按版本隔离）、订单原子→模型级声明。
  const g = coreApi.buildLineageGraph(source,
    {focus: {revisionId: aovRevId}, direction: 'both', depth: 'all'});
  const declared = g.edges.filter(e => e.kind === 'declared-source');
  eq(declared.length, 3, `声明边 3 条（实际 ${declared.length}）`);
  const declaredV1 = declared.filter(e => e.to === 'm:mrev-paid-amount-1');
  eq(declaredV1.length, 1, 'v1 恰一条声明边');
  eq(declaredV1[0].from, 'f:entities:entity-trade-order:field-order-id', '声明端点=spec.source');
  eq(declaredV1[0].state, 'declared', '声明边状态=declared');
  assert(declaredV1[0].evidence && declaredV1[0].evidence.kind === 'declared',
    '证据=定义声明，不伪造手工确认');
  assert(declaredV1[0].confirmedAt == null, '无确认时间');
  // 同版本同端点生效绑定覆盖声明：v1 在 field-paid-amount 有 confirmed 绑定
  assert(!g.edges.some(e => e.kind === 'declared-source'
    && e.to === 'm:mrev-paid-amount-1'
    && e.from === 'f:entities:entity-trade-order:field-paid-amount'),
  '同版本同端点生效绑定覆盖声明（不重复）');
  // v2 声明可见（版本隔离：v1 绑定不覆盖 v2）
  assert(declared.some(e => e.to === `m:${amountV2Id}`
    && e.from === 'f:entities:entity-trade-order:field-paid-amount'),
  'v2 的同字段声明不被 v1 绑定覆盖');
  // 绑定边与声明边并存且可区分
  assert(g.edges.some(e => e.kind === 'compute-source'
    && e.to === 'm:mrev-paid-amount-1'), 'confirmed 绑定边在场');
});

test('L7 失效状态：端点删除 → 边失效 + 快照保留；unresolved 可筛出；不按同名复活', () => {
  const {source, aovRevId} = buildWorld();
  // 删除物化端点对象 → 图上物化边 invalid，节点 present=false，快照可读
  const broken = {...source,
    entities: source.entities.filter(e => e.id !== 'entity-dws-aov')};
  const g = coreApi.buildLineageGraph(broken,
    {focus: {revisionId: aovRevId}, direction: 'both', depth: 'all'});
  const mat = g.edges.filter(e => e.kind === 'materialization')[0];
  assert(mat.invalid === true, '端点删除后物化边失效');
  const node = g.nodes.filter(n => n.id === 'f:entities:entity-dws-aov:field-aov')[0];
  assert(node && node.present === false, '端点节点不在场');
  assert(node.name === '客单价汇总', '失效节点保留绑定时刻快照名（不按同名复活）');
  // suggested 默认不可见，勾选后可见且不冒充 confirmed
  const strict = coreApi.buildLineageGraph(source,
    {focus: {revisionId: aovRevId}, direction: 'both', depth: 'all'});
  assert(!strict.edges.some(e => e.state === 'suggested'), '默认不含 suggested');
  const withSuggested = coreApi.buildLineageGraph(source,
    {focus: {revisionId: aovRevId}, direction: 'both', depth: 'all', includeSuggested: true});
  const sug = withSuggested.edges.filter(e => e.state === 'suggested');
  assert(sug.length === 1 && sug[0].kind === 'compute-source', '勾选后 suggested 来源边可见');
  // released 历史：解除后默认排除、显式筛出且带历史标记
  const released = coreApi.releaseMetricBinding(source, 'mb-consume-board',
    {reason: '看板下线', by: 'u'});
  assert(released.ok, '解除成功');
  const gAfter = coreApi.buildLineageGraph(released.source,
    {focus: {revisionId: aovRevId}, direction: 'both', depth: 'all'});
  assert(!gAfter.edges.some(e => e.kind === 'consumption'), '解除后默认不可见');
  const gHist = coreApi.buildLineageGraph(released.source,
    {focus: {revisionId: aovRevId}, direction: 'both', depth: 'all', includeReleased: true,
      projections: ['compute', 'consumption']});
  const hist = gHist.edges.filter(e => e.kind === 'consumption')[0];
  assert(hist && hist.state === 'released' && hist.releaseReason === '看板下线',
    '历史可筛出并保留解除原因');
  // unresolved：批量失效后边带原因
  const marked = coreApi.markMetricBindingsUnresolved(released.source,
    {collection: 'entities', objectId: 'entity-trade-order', fieldId: 'field-paid-amount'},
    {reason: 'FIELD_DELETED'});
  assert(marked.ok && marked.touched >= 1, '端点命中绑定批量失效');
  const gUnres = coreApi.buildLineageGraph(marked.source,
    {focus: {revisionId: aovRevId}, direction: 'both', depth: 'all', includeUnresolved: true});
  const unresolvedEdge = gUnres.edges.filter(e => e.state === 'unresolved')[0];
  assert(unresolvedEdge && unresolvedEdge.unresolvedReason === 'FIELD_DELETED',
    'unresolved 边带失效原因');
});

test('L8 声明端点字段缺失按稳定 ID 实判（协调者补充）：不显示可打开', () => {
  const {source} = buildWorld();
  // 对象仍在、声明字段已删除 → present:false；保留声明原值
  const broken = {...source,
    entities: source.entities.map(e => (e.id === 'entity-trade-order'
      ? {...e, fields: e.fields.filter(f => f.id !== 'field-order-id')} : e))};
  const declared = coreApi.getDeclaredSpecSources(broken, 'mrev-paid-amount-1')
    .filter(entry => entry.specSource.fieldId === 'field-order-id');
  eq(declared.length, 1, '声明来源仍返回（快照）');
  assert(declared[0].endpoint.present === false, '字段缺失 → present:false');
  eq(declared[0].specSource.fieldId, 'field-order-id', '声明原值保留');
  assert(declared[0].endpoint.object != null, '对象信息保留');
  // 对象整体缺失 → collection:null
  const gone = {...broken,
    entities: broken.entities.filter(e => e.id !== 'entity-trade-order')};
  const goneEntry = coreApi.getDeclaredSpecSources(gone, 'mrev-paid-amount-1')
    .filter(entry => entry.specSource.fieldId === 'field-order-id')[0];
  assert(goneEntry.endpoint.present === false && goneEntry.endpoint.collection === null,
    '对象缺失 → present:false + collection:null');
});

test('L9 三类影响口径：端点影响含声明来源；维度影响覆盖限定/维度/输出粒度/patch', () => {
  const {source} = buildWorld();
  // 端点 field-order-id：订单原子 suggested 绑定（默认影响查询含生效绑定，suggested 非 released）
  const eImpact = coreApi.getLineageImpact(source,
    {collection: 'entities', objectId: 'entity-trade-order', fieldId: 'field-order-id'});
  const codes = eImpact.direct.metrics.map(m => `${m.code}:${m.roles.join('|')}`);
  assert(codes.indexOf('paid_orders:BINDING:COMPUTES_FROM') >= 0, '绑定命中（suggested 属生效关联）');
  assert(codes.indexOf('paid_amount:DECLARED') >= 0, '声明来源命中（未被绑定覆盖）');
  assert(eImpact.stats.transitiveCount >= 2, '传递闭包含派生与复合');
  // 模型级端点
  const modelImpact = coreApi.getLineageImpact(source,
    {collection: 'entities', objectId: 'entity-trade-order'});
  assert(modelImpact.direct.metrics.length >= 2, '模型级影响命中多指标');
  // 维度影响
  const dimImpact = coreApi.getLineageImpact(source, {dimensionId: 'dim-channel'});
  const dimCodes = dimImpact.direct.metrics.map(m => m.code);
  ['paid_amount', 'paid_orders', 'paid_amount_7d', 'paid_orders_7d']
    .forEach(code => assert(dimCodes.indexOf(code) >= 0, `维度引用命中 ${code}`));
  assert(dimImpact.direct.metrics.every(m => m.roles[0].indexOf('DIMENSION:') === 0),
    '维度影响角色标注引用位置');
  // 影响说明为结构化 messageKey（UI 本地化渲染）
  assert(dimImpact.notes.every(n => n.messageKey
    && lookup(zhLang, n.messageKey) != null), '口径说明键存在');
});

test('L10 分层布局：字段→原子→派生/复合→落地字段 列序单调', () => {
  const {source, aovRevId} = buildWorld();
  const g = coreApi.buildLineageGraph(source,
    {focus: {revisionId: aovRevId}, direction: 'both', depth: 'all'});
  const {columnOf} = coreApi.layoutLineageColumns(g);
  const col = id => columnOf[id];
  assert(col('f:entities:entity-trade-order:field-paid-amount') < col('m:mrev-paid-amount-1'),
    '来源字段列 < 原子列');
  assert(col('m:mrev-paid-amount-1') < col('m:mrev-paid-7d-1'), '原子列 < 派生列');
  assert(col('m:mrev-paid-7d-1') < col(`m:${aovRevId}`), '派生列 < 复合列');
  assert(col(`m:${aovRevId}`) < col('f:entities:entity-dws-aov:field-aov'), '复合列 < 落地字段列');
});

// ================================================================ UI 层

const LineageReal = loadReal('LineagePage.js').default;
const render = el => reactDomServer.renderToStaticMarkup(el);

test('U1 真实空态：无已发布指标显示引导，不渲染演示节点', () => {
  const empty = fixtures.baseProject();
  const html = render(realReact.createElement(LineageReal, {
    source: empty, readOnly: false, focus: null,
    onOpenDefinition: () => {}, onOpenBindings: () => {}, onOpenModel: () => {},
  }));
  assertIncludes(html, FormatMessageStub.string({id: 'metrics.lineage.emptyTitle'}), '空态标题');
  assert(html.indexOf('metrics-lineage-node') < 0, '无演示节点');
});

test('U2 真实组件渲染（SSR）：节点/边/图例/影响面板来自真实投影', () => {
  const {source, aovRevId} = buildWorld();
  const html = render(realReact.createElement(LineageReal, {
    source, readOnly: true, focus: {definitionId: 'metric-aov-7d',
      revisionId: aovRevId, nonce: 1},
    onOpenDefinition: () => {}, onOpenBindings: () => {}, onOpenModel: () => {},
  }));
  ['客单价汇总', 'dws_trade_aov', '已支付成交金额', 'mrev-paid-amount-1',
    '近7日客单价', '计算 / 数据流向', '影响分析', '传递影响'].forEach(needle =>
    assertIncludes(html, needle, `真实内容 ${needle}`));
  assertIncludes(html, '定义声明', '声明边标签可见');
  assertIncludes(html, 'field-order-id', '声明端点字段可见');
});

const LineageSynth = loadSynthReact('LineagePage.js').default;

test('U3 投影与状态筛选交互：默认计算；切继承仅继承边；全部投影含消费/语义', () => {
  const {source, deptRevId} = buildWorld();
  // 焦点=公共派生 paid_7d（有部门继承下游与计算上游）
  const mount = synthetic.mountComponent(LineageSynth, {
    source, readOnly: false,
    focus: {definitionId: 'metric-paid-7d', revisionId: 'mrev-paid-7d-1', nonce: 1},
    onOpenDefinition: () => {}, onOpenBindings: () => {}, onOpenModel: () => {},
  });
  const kinds = () => byTestId(mount.element, 'metrics-lineage-edge').map(e => e.props['data-kind']);
  const computeKinds = ['compute-source', 'declared-source', 'dependency', 'materialization'];
  assert(kinds().length > 0 && kinds().every(k => computeKinds.indexOf(k) >= 0),
    `默认仅计算投影（实际 ${JSON.stringify(kinds())}）`);
  firstByTestId(mount.element, 'metrics-lineage-projection-inheritance').props.onClick();
  const inheritKinds = kinds();
  assert(inheritKinds.length === 1 && inheritKinds[0] === 'baseline',
    `继承投影仅继承边（实际 ${JSON.stringify(inheritKinds)}）`);
  const inheritNodes = byTestId(mount.element, 'metrics-lineage-node')
    .map(n => n.props['data-node-id']);
  assert(inheritNodes.indexOf(`m:${deptRevId}`) >= 0, '继承投影含部门版本节点');
  firstByTestId(mount.element, 'metrics-lineage-projection-all').props.onClick();
  const allKinds = kinds();
  assert(allKinds.indexOf('baseline') >= 0 && computeKinds.some(k => allKinds.indexOf(k) >= 0),
    '全部投影混合计算与继承（分线型呈现）');
  firstByTestId(mount.element, 'metrics-lineage-state-suggested')
    .props.children.filter(c => c.type === 'input')[0].props.onChange({target: {checked: true}});
  assert(byTestId(mount.element, 'metrics-lineage-edge').length >= allKinds.length,
    '勾选 suggested 后边数不减少（该焦点闭包无 suggested，语义保持）');
});

test('U4 逐层展开：深度1截断 + 展开按钮增加局部预算', () => {
  const {source, aovRevId} = buildWorld();
  const mount = synthetic.mountComponent(LineageSynth, {
    source, readOnly: false,
    focus: {definitionId: 'metric-aov-7d', revisionId: aovRevId, nonce: 1},
    onOpenDefinition: () => {}, onOpenBindings: () => {}, onOpenModel: () => {},
  });
  selectTestId(mount.element, 'metrics-lineage-depth', '1');
  const nodeCountDepth1 = byTestId(mount.element, 'metrics-lineage-node').length;
  const expandBtn = byTestId(mount.element, 'metrics-lineage-node-expand-down')[0]
    || byTestId(mount.element, 'metrics-lineage-node-expand-up')[0];
  assert(expandBtn != null, '深度1存在可展开节点');
  expandBtn.props.onClick({stopPropagation: () => {}});
  const nodeCountExpanded = byTestId(mount.element, 'metrics-lineage-node').length;
  assert(nodeCountExpanded > nodeCountDepth1, '展开后节点增加');
  // 全深度无截断
  selectTestId(mount.element, 'metrics-lineage-depth', 'all');
  const expandLeft = byTestId(mount.element, 'metrics-lineage-node-expand-down').length
    + byTestId(mount.element, 'metrics-lineage-node-expand-up').length;
  eq(expandLeft, 0, '全深度无展开按钮');
});

test('U5 节点/边详情：表达式/用途/证据/失效原因；焦点节点高亮与版本为主信息', () => {
  const {source, aovRevId} = buildWorld();
  const mount = synthetic.mountComponent(LineageSynth, {
    source, readOnly: false,
    focus: {definitionId: 'metric-aov-7d', revisionId: aovRevId, nonce: 1},
    onOpenDefinition: () => {}, onOpenBindings: () => {}, onOpenModel: () => {},
  });
  // 点击计算来源边：SUM 表达式 + 证据备注 + 确认人
  const srcEdge = byTestId(mount.element, 'metrics-lineage-edge')
    .filter(e => e.props['data-kind'] === 'compute-source')[0];
  srcEdge.props.onClick();
  const edgeDetail = firstByTestId(mount.element, 'metrics-lineage-edge-detail');
  const edgeHtml = render(edgeDetail);
  assertIncludes(edgeHtml, 'SUM', '聚合表达式可见');
  assertIncludes(edgeHtml, '口径评审 2026-10', '证据备注可见');
  assertIncludes(edgeHtml, 'u-owner', '确认人可见');
  // 点击物化边：用途可见
  const matEdge = byTestId(mount.element, 'metrics-lineage-edge')
    .filter(e => e.props['data-kind'] === 'materialization')[0];
  matEdge.props.onClick();
  assertIncludes(render(firstByTestId(mount.element, 'metrics-lineage-edge-detail')),
    'DWS 日表落地', '物化用途可见');
  // 点击焦点复合节点：版本与状态为主信息、操作按钮齐备
  const focusNode = byTestId(mount.element, 'metrics-lineage-node')
    .filter(n => n.props['data-node-id'] === `m:${aovRevId}`)[0];
  focusNode.props.onClick();
  const nodeDetail = firstByTestId(mount.element, 'metrics-lineage-node-detail');
  const nodeHtml = render(nodeDetail);
  assertIncludes(nodeHtml, 'v1.0', '版本主信息');
  assertIncludes(nodeHtml, 'app_aov_7d', '编码可见');
  ['metrics-lineage-open-definition', 'metrics-lineage-open-bindings',
    'metrics-lineage-impact-revision', 'metrics-lineage-locate'].forEach(tid =>
    assert(firstByTestId(mount.element, tid) != null, `操作 ${tid} 存在`));
});

test('U6 互跳回调：打开定义带版本；模型关联带版本；精确打开模型字段', () => {
  const {source, aovRevId} = buildWorld();
  const calls = {def: [], bindings: [], model: []};
  const mount = synthetic.mountComponent(LineageSynth, {
    source, readOnly: false,
    focus: {definitionId: 'metric-aov-7d', revisionId: aovRevId, nonce: 1},
    onOpenDefinition: (...args) => calls.def.push(args),
    onOpenBindings: (...args) => calls.bindings.push(args),
    onOpenModel: (...args) => calls.model.push(args),
  });
  // 焦点节点：打开定义 / 关联
  byTestId(mount.element, 'metrics-lineage-node')
    .filter(n => n.props['data-node-id'] === `m:${aovRevId}`)[0].props.onClick();
  firstByTestId(mount.element, 'metrics-lineage-open-definition').props.onClick();
  eq(calls.def[calls.def.length - 1], ['metric-aov-7d', 'view', null, aovRevId],
    '打开定义携带具体版本');
  firstByTestId(mount.element, 'metrics-lineage-open-bindings').props.onClick();
  eq(calls.bindings[calls.bindings.length - 1], ['metric-aov-7d', aovRevId],
    '打开模型关联携带具体版本');
  // 物化端点字段节点：精确打开模型字段（fieldDefKey）
  byTestId(mount.element, 'metrics-lineage-node')
    .filter(n => n.props['data-node-id'] === 'f:entities:entity-dws-aov:field-aov')[0]
    .props.onClick();
  firstByTestId(mount.element, 'metrics-lineage-open-model').props.onClick();
  eq(calls.model[calls.model.length - 1],
    [{collection: 'entities', objectId: 'entity-dws-aov', fieldDefKey: 'aov'}],
    '按集合+对象+字段 defKey 精确打开');
});

test('U7 影响面板：默认焦点=当前版本；端点节点切换影响口径；统计与说明渲染', () => {
  const {source, aovRevId} = buildWorld();
  const mount = synthetic.mountComponent(LineageSynth, {
    source, readOnly: false,
    focus: {definitionId: 'metric-aov-7d', revisionId: aovRevId, nonce: 1},
    onOpenDefinition: () => {}, onOpenBindings: () => {}, onOpenModel: () => {},
  });
  const impact = firstByTestId(mount.element, 'metrics-lineage-impact');
  assert(impact != null && impact.props['data-impact-kind'] === 'revision', '默认版本影响');
  assert(firstByTestId(mount.element, 'metrics-lineage-impact-direct-row') == null,
    '复合无直接下游定义');
  // 切到金额原子版本 → 直接/传递行出现
  selectTestId(mount.element, 'metrics-lineage-def-select', 'metric-paid-amount');
  selectTestId(mount.element, 'metrics-lineage-rev-select', 'mrev-paid-amount-1');
  const directRows = byTestId(mount.element, 'metrics-lineage-impact-direct-row');
  assert(directRows.length === 2, `直接行=派生+部门基线（实际 ${directRows.length}）`);
  const transRows = byTestId(mount.element, 'metrics-lineage-impact-transitive-row');
  eq(transRows.length, 1, '传递行=复合');
  const caliber = firstByTestId(mount.element, 'metrics-lineage-impact-caliber');
  const caliberHtml = render(caliber);
  assertIncludes(caliberHtml, FormatMessageStub.string(
    {id: 'metrics.lineage.impact.caliber.direct'}), '口径说明-直接');
  assertIncludes(caliberHtml, FormatMessageStub.string(
    {id: 'metrics.lineage.impact.dedup'}), '口径说明-去重');
  // 端点节点“以此为焦点查影响”
  byTestId(mount.element, 'metrics-lineage-node')
    .filter(n => n.props['data-node-id'] === 'f:entities:entity-trade-order:field-order-id')[0]
    .props.onClick();
  firstByTestId(mount.element, 'metrics-lineage-impact-endpoint').props.onClick();
  eq(firstByTestId(mount.element, 'metrics-lineage-impact').props['data-impact-kind'],
    'endpoint', '切换为端点影响口径');
});

test('U8 无关系状态：设计定义无声明无绑定 → 如实无关系，不造边', () => {
  // 独立小世界：无来源设计原子（发布为“未计算就绪”），无绑定无依赖
  let source = fixtures.baseProject();
  const designSpec = JSON.parse(JSON.stringify(fixtures.paidAmountAtomic('m-design')));
  delete designSpec.spec.source;
  const r = coreApi.createMetricDraft(source, Object.assign(designSpec,
    {revisionId: 'mrev-design-1'}));
  assert(r.ok, JSON.stringify(r.errors));
  const p = coreApi.publishMetricRevision(r.source, 'mrev-design-1', {});
  assert(p.ok, JSON.stringify(p.errors));
  source = p.source;
  const mount = synthetic.mountComponent(LineageSynth, {
    source, readOnly: false,
    focus: {definitionId: 'm-design', revisionId: 'mrev-design-1', nonce: 1},
    onOpenDefinition: () => {}, onOpenBindings: () => {}, onOpenModel: () => {},
  });
  const empty = firstByTestId(mount.element, 'metrics-lineage-no-relations');
  assert(empty != null, '无关系状态显示');
  // 无关系时空态取代图渲染（不画焦点节点、不造边）
  eq(byTestId(mount.element, 'metrics-lineage-node').length, 0, '空态下不渲染节点');
});

test('U9 工作台接线：openRequest lineage 定位；导航无 M5 徽标；目录/关联页入口', () => {
  const WorkbenchSynth = loadSynthReact('MetricsWorkbench.js').default;
  const CatalogSynthComp = loadSynthReact('CatalogPage.js').default;
  const BindingsSynth = loadSynthReact('BindingsPage.js').default;
  const {source, aovRevId} = buildWorld();
  const state = {source, updates: 0};
  const mount = synthetic.mountComponent(WorkbenchSynth, {
    source: state.source, getDataSource: () => state.source,
    updateDataSource: next => { state.source = next; state.updates += 1; },
    readOnly: false, projectDirty: false, openRequest: null, onOpenModel: () => {},
  });
  // 导航徽标：lineage 无 pending 标记
  const navLineage = firstByTestId(mount.element, 'metrics-nav-lineage');
  const pendingBadge = collect(navLineage,
    el => el.props && el.props.className === 'chiner-metrics-nav-pending');
  eq(pendingBadge.length, 0, '无“尚未接入”徽标');
  // openRequest lineage → 血缘页
  mount.setProps({openRequest: {module: 'lineage', definitionId: 'metric-aov-7d',
    revisionId: aovRevId, nonce: 501}});
  const lineagePages = collect(mount.element, el => el.type === LineageSynth);
  eq(lineagePages.length, 1, '血缘页挂载');
  // 目录页：行内“血缘与影响”按钮（已发布定义）
  firstByTestId(mount.element, 'metrics-nav-catalog').props.onClick();
  const catalogEl = collect(mount.element, el => el.type === CatalogSynthComp)[0];
  assert(typeof catalogEl.props.onOpenLineage === 'function', '目录页接线 onOpenLineage');
  // 关联页：详情头“血缘与影响”按钮
  firstByTestId(mount.element, 'metrics-nav-bindings').props.onClick();
  const bindingsEl = collect(mount.element, el => el.type === BindingsSynth)[0];
  assert(typeof bindingsEl.props.onOpenLineage === 'function', '关联页接线 onOpenLineage');
  // LineagePage → 模型关联互跳接线
  assert(typeof lineagePages[0].props.onOpenBindings === 'function', '血缘页接线 onOpenBindings');
});

test('U10 模型页“查看血缘”改指血缘页（此前定位 bindings）；声明字段缺失不显示可打开', () => {
  const PanelSynth = loadSynthReact('ModelMetricPanel.js').default;
  const {source} = buildWorld();
  const metricCalls = [];
  const mount = synthetic.mountComponent(PanelSynth, {
    collection: 'entities', objectId: 'entity-dws-aov',
    dataSource: source, getDataSource: () => source,
    updateDataSource: () => {}, readOnly: false,
    onOpenMetric: req => metricCalls.push(req),
  });
  const lineageBtn = byTestId(mount.element, 'metrics-binding-open-lineage')[0];
  lineageBtn.props.onClick();
  eq(metricCalls[0].module, 'lineage', 'openMetric 目标=血缘页');
  eq(metricCalls[0].revisionId != null, true, '携带具体版本');
  // 声明字段缺失：面板声明行显示缺失标记（金额 v1 声明 field-order-id，删除之）
  const broken = {...source,
    entities: source.entities.map(e => (e.id === 'entity-trade-order'
      ? {...e, fields: e.fields.filter(f => f.id !== 'field-order-id')} : e))};
  const mount2 = synthetic.mountComponent(PanelSynth, {
    collection: 'entities', objectId: 'entity-trade-order',
    dataSource: broken, getDataSource: () => broken,
    updateDataSource: () => {}, readOnly: false, onOpenMetric: () => {},
  });
  const declaredRows = byTestId(mount2.element, 'metrics-declared-row')
    .filter(row => row.props['data-revision-id'] === 'mrev-paid-amount-1');
  eq(declaredRows.length, 1, '声明行仍在（快照）');
  const missingTag = collect(declaredRows[0],
    el => el.props && el.props['data-testid'] === 'metrics-declared-field-missing');
  eq(missingTag.length, 1, '缺失字段行显示失效标记');
});

test('U11 main 接缝与 zh/en 语言键奇偶', () => {
  const mainSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/main/index.js'), 'utf8');
  assertIncludes(mainSource, "request.module !== 'lineage'", 'openMetricTarget 接受 lineage 目标');
  // zh/en 血缘键奇偶
  const zhLin = lookup(zhLang, 'metrics.lineage');
  const enLin = lookup(enLang, 'metrics.lineage');
  assert(zhLin != null && enLin != null, '两侧均有 lineage 段');
  const flat = (obj, prefix) => {
    const keys = [];
    Object.keys(obj || {}).forEach((key) => {
      const value = obj[key];
      const dotted = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object') keys.push(...flat(value, dotted));
      else keys.push(dotted);
    });
    return keys;
  };
  const zhKeys = flat(zhLin, 'metrics.lineage').sort();
  const enKeys = flat(enLin, 'metrics.lineage').sort();
  eq(zhKeys, enKeys, 'zh/en lineage 键完全奇偶');
  zhKeys.forEach(key => assert(lookup(zhLang, key) != null
    && lookup(enLang, key) != null, `键双侧可解析 ${key}`));
  // 组件引用键存在（抽查渲染用键）
  ['metrics.lineage.title', 'metrics.lineage.edge.computeSource',
    'metrics.lineage.impact.caliber.endpointDirect', 'metrics.lineage.col.actions']
    .forEach(key => assert(lookup(zhLang, key) != null, `zh 键存在 ${key}`));
});

// ---------------------------------------------------------------- 汇总
console.log(`\n${passed} passed, ${failed} failed${failed ? ': ' + failures.join('；') : ''}`);
process.exit(failed ? 1 : 0);
