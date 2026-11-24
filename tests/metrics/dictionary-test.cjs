#!/usr/bin/env node
'use strict';
/**
 * 指标平台 M3A — 语义字典与类型化编辑接入测试（真实源码经 Babel 加载，真实 M1/M3A API）。
 *
 * 运行：node doc/developer/metric-platform-v1/dictionary-test.cjs（仓库根目录）
 *
 * 范围与手法（不新增依赖，不访问网络/模板/真实项目）：
 * - 纯函数层：字典五分类 CRUD、值类型（'001' 字符串不被数字化、false 必须布尔）、
 *   引用保护（草案/发布/部门 scope 引用 → 删除与语义改动拒绝、停用引导）、
 *   发布历史 hash 不受字典变更影响、未知键保留、未来 schema 拒写；
 * - UI 层（真实 DictionaryPage / DefinitionPage / MetricsWorkbench 合成挂载）：
 *   空态、维护链（一次命令一次 update）、字典条目在三类编辑器实际选用并类型化落库、
 *   旧手工值兼容、只读阻断、语言奇偶。
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
    if (process.env.M3A_DEBUG && e && e.stack) console.log(e.stack.split('\n').slice(1, 8).join('\n'));
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

// ---------------------------------------------------------------- 加载器（同 ui-test）
function loadWithStubs(filename, stubs, customReact, cache) {
  const moduleCache = cache;
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const source = fs.readFileSync(filename, 'utf8');
  const {code} = babel.transformSync(source, {
    filename,
    presets: [
      [path.join(PROJECT_ROOT, 'node_modules', '@babel', 'preset-env'),
        {targets: {node: '12'}, modules: 'commonjs'}],
      path.join(PROJECT_ROOT, 'node_modules', '@babel', 'preset-react'),
    ],
    babelrc: false,
    configFile: false,
    sourceType: 'module',
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
      if (isFile(candidate)) return loadWithStubs(candidate, stubs, customReact, moduleCache);
    }
    throw new Error(`模块不允许引用外部依赖: ${request}`);
  };
  m._compile(code, filename);
  moduleCache.set(filename, m);
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

const messages = [];
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
      success: n => messages.push({kind: 'success', title: n && n.title}),
      error: n => messages.push({kind: 'error', title: n && n.title}),
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

// ---------------------------------------------------------------- 合成 React（同 ui-test）
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
const firstByTestId = (root, testid) => {
  const hits = collect(root, el => el.props && el.props['data-testid'] === testid);
  return hits.length ? hits[0] : null;
};
const setTestId = (root, testid, value) => {
  const el = firstByTestId(root, testid);
  if (!el) throw new Error(`未找到控件 ${testid}`);
  el.props.onChange({target: {value}});
};

// ---------------------------------------------------------------- 夹具
const fixtures = require('./core-fixtures.cjs');
const coreApi = loadWithStubs(path.join(PROJECT_ROOT, 'src/lib/metric_platform.js'),
  {}, null, new Map());

const DICT_ENTRIES = {
  departments: {id: 'dept-ops', code: 'ops', name: '运营部'},
  dimensions: [
    {id: 'dim-channel-id', code: 'dim-channel', name: '渠道', valueType: 'string'},
    {id: 'dim-is-app-id', code: 'dim-is-app', name: '是否APP', valueType: 'boolean'},
  ],
  qualifiers: {id: 'qual-channel-app', code: 'channel-app', name: 'APP渠道',
    dimensionId: 'dim-channel', op: 'eq', value: 'APP'},
  periods: {id: 'period-7d', code: 'last-7d', name: '近7日',
    window: {type: 'calendarDays', length: 7, end: 'yesterday', timezone: 'Asia/Shanghai'}},
  units: [{id: 'unit-cny', code: 'CNY', name: '人民币元'},
    {id: 'unit-pct', code: 'PCT', name: '百分比'}],
};

function buildDictionary(source) {
  let next = source;
  const created = coreApi.createDictionaryEntry(next, 'departments', DICT_ENTRIES.departments);
  assert(created.ok, JSON.stringify(created.errors));
  next = created.source;
  DICT_ENTRIES.dimensions.forEach((dim) => {
    const r = coreApi.createDictionaryEntry(next, 'dimensions', dim);
    assert(r.ok, JSON.stringify(r.errors));
    next = r.source;
  });
  const q = coreApi.createDictionaryEntry(next, 'qualifiers', DICT_ENTRIES.qualifiers);
  assert(q.ok, JSON.stringify(q.errors));
  next = q.source;
  const p = coreApi.createDictionaryEntry(next, 'periods', DICT_ENTRIES.periods);
  assert(p.ok, JSON.stringify(p.errors));
  next = p.source;
  DICT_ENTRIES.units.forEach((unit) => {
    const r = coreApi.createDictionaryEntry(next, 'units', unit);
    assert(r.ok, JSON.stringify(r.errors));
    next = r.source;
  });
  return next;
}

// 字典 + 指标：发布原子/派生 + 部门草案，分别制造 scope/维度/单位/周期/限定引用
function buildDictProject() {
  let source = buildDictionary(fixtures.baseProject());
  // MET-04：有字典项目发布前校验维度登记——补登夹具原子用到的其余维度（仅夹具设置）
  [{id: 'dim-region-id', code: 'dim-region', name: '地区', valueType: 'string'},
    {id: 'dim-status-id', code: 'dim-status', name: '订单状态', valueType: 'string'},
    {id: 'dim-is-test-id', code: 'dim-is-test', name: '测试单', valueType: 'boolean'},
    {id: 'dim-is-void-id', code: 'dim-is-void', name: '作废单', valueType: 'boolean'}].forEach((dim) => {
    const r = coreApi.createDictionaryEntry(source, 'dimensions', dim);
    assert(r.ok, JSON.stringify(r.errors));
    source = r.source;
  });
  const atomic =coreApi.createMetricDraft(source, Object.assign(
    fixtures.paidAmountAtomic('metric-paid-amount'), {revisionId: 'mrev-paid-amount-1'}));
  assert(atomic.ok, JSON.stringify(atomic.errors));
  const pubAtomic = coreApi.publishMetricRevision(atomic.source, 'mrev-paid-amount-1', {});
  assert(pubAtomic.ok, JSON.stringify(pubAtomic.errors));
  source = pubAtomic.source;
  const derived = coreApi.createMetricDraft(source, Object.assign(
    fixtures.paidAmount7dDerived('metric-paid-7d', 'mrev-paid-amount-1'),
    {revisionId: 'mrev-paid-7d-1'}));
  assert(derived.ok, JSON.stringify(derived.errors));
  const pubDerived = coreApi.publishMetricRevision(derived.source, 'mrev-paid-7d-1', {});
  assert(pubDerived.ok, JSON.stringify(pubDerived.errors));
  source = pubDerived.source;
  // 部门草案：scope=ops（部门引用）+ APP 限定（限定条目值匹配）+ 7日窗口（周期引用）
  const deptDerived = coreApi.createMetricDraft(source, {
    id: 'metric-ops-paid-7d',
    revisionId: 'mrev-ops-paid-7d-draft',
    code: 'ops.app_paid_amount_7d',
    name: '运营APP近7日支付金额',
    scope: {kind: 'department', departmentId: 'ops'},
    ownerId: 'user-owner',
    spec: {
      kind: 'derived',
      name: '运营APP近7日支付金额',
      atomicRevisionId: 'mrev-paid-amount-1',
      window: {type: 'calendarDays', length: 7, end: 'yesterday', timezone: 'Asia/Shanghai'},
      qualifiers: [{dimensionId: 'dim-channel', op: 'eq', value: 'APP'}],
      outputGrain: ['dim-channel'],
    },
  });
  assert(deptDerived.ok, JSON.stringify(deptDerived.errors));
  return deptDerived.source;
}

const makeWorld = (source) => {
  const state = {source, updates: 0};
  const commandRunner = {
    getSource: () => state.source,
    updateDataSource: next => { state.source = next; state.updates += 1; },
    readOnly: false,
  };
  return {state, commandRunner};
};

// ================================================================ 纯函数层
test('D1 空字典只读为空：不初始化样例，list/get 返回空', () => {
  const project = fixtures.baseProject();
  const dict = coreApi.readMetricDictionary(project);
  eq(dict.departments, [], '空部门');
  eq(dict.dimensions, [], '空维度');
  eq(coreApi.listDictionaryEntries(project, 'units', null), [], '空单位');
  eq(coreApi.getDictionaryEntry(project, 'departments', 'any'), null, '查无条目');
  eq(coreApi.findDictionaryEntryByCode(project, 'units', 'CNY'), null, '按编码查无');
});

test('D2 五分类创建与读取：编码/名称/类型/窗口落库，search 生效', () => {
  const source = buildDictionary(fixtures.baseProject());
  const dict = coreApi.readMetricDictionary(source);
  eq(dict.departments.length, 1, '部门 1 条');
  eq(dict.departments[0].code, 'ops', '部门编码');
  eq(dict.dimensions.length, 2, '维度 2 条');
  eq(dict.qualifiers[0].value, 'APP', '限定值类型化（字符串）');
  eq(dict.periods[0].window.length, 7, '周期窗口');
  eq(dict.units.length, 2, '单位 2 条');
  const hit = coreApi.listDictionaryEntries(source, 'units', {search: 'cny'});
  eq(hit.length, 1, 'search 按编码命中（大小写不敏感）');
  eq(hit[0].code, 'CNY', '命中 CNY');
  const byName = coreApi.listDictionaryEntries(source, 'dimensions', {search: '渠道'});
  eq(byName.length, 1, 'search 按名称命中');
  const entry = coreApi.getDictionaryEntry(source, 'dimensions', 'dim-channel-id');
  eq(entry.valueType, 'string', 'getDictionaryEntry');
});

test('D3 结构校验：重复编码/未知键/非法值类型/非法编码拒绝', () => {
  const source = buildDictionary(fixtures.baseProject());
  const dup = coreApi.createDictionaryEntry(source, 'units', {code: 'CNY', name: '重复'});
  eq(dup.ok, false, '重复编码拒绝');
  eq(dup.errors[0].code, 'DUPLICATE_CODE', '错误码');
  eq(dup.errors[0].messageKey, 'metric.error.duplicateDictionaryCode', 'messageKey');
  const unknown = coreApi.createDictionaryEntry(source, 'units',
    {code: 'X1', name: 'x', extra: 1});
  eq(unknown.ok, false, '未知键拒绝');
  eq(unknown.errors[0].code, 'UNKNOWN_KEY', '未知键错误码');
  const badType = coreApi.createDictionaryEntry(source, 'dimensions',
    {code: 'dim-x', name: 'x', valueType: 'date'});
  eq(badType.ok, false, '非法值类型拒绝');
  const badCode = coreApi.createDictionaryEntry(source, 'units', {code: '运营 部', name: 'x'});
  eq(badCode.ok, false, '编码含空格/非ASCII拒绝（编码是稳定标识不是显示名）');
  const badWindow = coreApi.createDictionaryEntry(source, 'periods',
    {code: 'p1', name: 'x', window: {type: 'calendarDays', length: 0, end: 'yesterday', timezone: 'UTC'}});
  eq(badWindow.ok, false, '窗口长度非法拒绝（复用 validateWindow）');
  const badDim = coreApi.createDictionaryEntry(source, 'qualifiers',
    {code: 'q1', name: 'x', dimensionId: 'dim-not-exist', op: 'eq', value: 'A'});
  eq(badDim.ok, false, '限定维度不在字典拒绝');
  eq(badDim.errors[0].code, 'UNKNOWN_REFERENCE', '维度引用错误码');
});

test('D4 类型化解析：001 保持字符串、false 严格布尔、in/not_in 逐项解析', () => {
  eq(coreApi.parseTypedScalar('001', 'string').value, '001', '字符串型 001 不数字化');
  assert(typeof coreApi.parseTypedScalar('001', 'string').value === 'string', '001 是 string');
  eq(coreApi.parseTypedScalar('001', 'number').value, 1, '数值型 001 → 1');
  eq(coreApi.parseTypedScalar('false', 'boolean').value, false, 'false → 布尔');
  assert(typeof coreApi.parseTypedScalar('false', 'boolean').value === 'boolean', 'false 是 boolean');
  eq(coreApi.parseTypedScalar('TRUE', 'boolean').value, true, '大小写不敏感布尔');
  eq(coreApi.parseTypedScalar('abc', 'number').ok, false, '数值型非数字拒绝');
  eq(coreApi.parseTypedScalar('yes', 'boolean').ok, false, '布尔非 true/false 拒绝');
  eq(coreApi.parseTypedList('APP,MINI', 'string').values, ['APP', 'MINI'], '字符串列表');
  eq(coreApi.parseTypedList(' 1 , 2 ', 'number').values, [1, 2], '数值列表逐项解析');
  eq(coreApi.parseTypedList('1,abc', 'number').ok, false, '列表任一项非法整体拒绝');
  eq(coreApi.parseTypedList(',', 'string').ok, false, '空列表拒绝');
});

test('D5 限定条目值类型化存储：不匹配维度类型拒绝，in 存数组', () => {
  const source = buildDictionary(fixtures.baseProject());
  const boolQ = coreApi.createDictionaryEntry(source, 'qualifiers', {
    code: 'is-app', name: 'APP单', dimensionId: 'dim-is-app', op: 'eq', value: 'false'});
  assert(boolQ.ok, JSON.stringify(boolQ.errors || []));
  eq(boolQ.entry.value, false, '文本 false 按布尔维度存布尔');
  const badBool = coreApi.createDictionaryEntry(boolQ.source, 'qualifiers', {
    code: 'is-app-2', name: 'x', dimensionId: 'dim-is-app', op: 'eq', value: 'APP'});
  eq(badBool.ok, false, '布尔维度字符串值拒绝');
  const badNum = coreApi.createDictionaryEntry(boolQ.source, 'qualifiers', {
    code: 'q-num', name: 'x', dimensionId: 'dim-channel', op: 'gt', value: 'abc'});
  // dim-channel 是字符串维度，gt + 字符串值不报类型错误？——字符串维度任何字符串都合法；
  // 用数值维度验证拒绝路径
  eq(badNum.ok, true, '字符串维度接受字符串值');
  const dimNum = coreApi.createDictionaryEntry(badNum.source, 'dimensions',
    {code: 'dim-level', name: '层级', valueType: 'number'});
  assert(dimNum.ok, JSON.stringify(dimNum.errors || []));
  const badLevel = coreApi.createDictionaryEntry(dimNum.source, 'qualifiers', {
    code: 'q-level', name: 'x', dimensionId: 'dim-level', op: 'gte', value: 'high'});
  eq(badLevel.ok, false, '数值维度字符串值拒绝');
  const inQ = coreApi.createDictionaryEntry(dimNum.source, 'qualifiers', {
    code: 'q-in', name: 'x', dimensionId: 'dim-channel', op: 'in', value: 'APP,MINI'});
  assert(inQ.ok, JSON.stringify(inQ.errors || []));
  eq(inQ.entry.value, ['APP', 'MINI'], 'in 存字符串数组');
  const badInNum = coreApi.createDictionaryEntry(inQ.source, 'qualifiers', {
    code: 'q-in-num', name: 'x', dimensionId: 'dim-level', op: 'not_in', value: '1,abc'});
  eq(badInNum.ok, false, '数值列表含非数值拒绝');
});

test('D6 引用保护：scope/维度/单位/周期/限定被引用即拒绝删除与语义改动，停用可用', () => {
  const source = buildDictProject();
  // 部门：被部门草案 scope 引用
  const delDept = coreApi.deleteDictionaryEntry(source, 'departments', 'dept-ops');
  eq(delDept.ok, false, '删除被 scope 引用部门拒绝');
  eq(delDept.errors[0].code, 'DICTIONARY_IN_USE', 'DICTIONARY_IN_USE');
  assertIncludes(delDept.errors[0].params.refs, 'ops.app_paid_amount_7d', '错误指明引用者');
  const renameDept = coreApi.updateDictionaryEntry(source, 'departments', 'dept-ops',
    {code: 'ops2'});
  eq(renameDept.ok, false, '被引用部门改编码（语义）拒绝');
  const renameDeptName = coreApi.updateDictionaryEntry(source, 'departments', 'dept-ops',
    {name: '运营部（新）'});
  eq(renameDeptName.ok, true, '非语义改动（名称）允许');
  const disableDept = coreApi.updateDictionaryEntry(renameDeptName.source, 'departments',
    'dept-ops', {status: 'disabled'});
  eq(disableDept.ok, true, '停用允许（不删数据、不断引用）');
  eq(coreApi.findDictionaryEntryByCode(disableDept.source, 'departments', 'ops').status,
    'disabled', '停用状态落库');
  const enableDept = coreApi.updateDictionaryEntry(disableDept.source, 'departments',
    'dept-ops', {status: 'active'});
  eq(enableDept.ok, true, '重新启用允许');
  // 维度：被发布原子 dimensions/outputGrain 与草案 qualifiers 引用
  const delDim = coreApi.deleteDictionaryEntry(enableDept.source, 'dimensions', 'dim-channel-id');
  eq(delDim.ok, false, '删除被引用维度拒绝');
  assertIncludes(delDim.errors[0].params.refs, 'paid_amount', '引用者含发布原子');
  assertIncludes(delDim.errors[0].params.refs, 'ops.app_paid_amount_7d', '引用者含部门草案');
  const changeDimType = coreApi.updateDictionaryEntry(enableDept.source, 'dimensions',
    'dim-channel-id', {valueType: 'number'});
  eq(changeDimType.ok, false, '被引用维度改值类型（语义）拒绝');
  // 单位：被发布原子 spec.unit 引用
  const delUnit = coreApi.deleteDictionaryEntry(enableDept.source, 'units', 'unit-cny');
  eq(delUnit.ok, false, '删除被引用单位拒绝');
  // 周期：被发布派生 spec.window 值匹配引用
  const delPeriod = coreApi.deleteDictionaryEntry(enableDept.source, 'periods', 'period-7d');
  eq(delPeriod.ok, false, '删除被窗口值匹配的周期拒绝');
  const changePeriod = coreApi.updateDictionaryEntry(enableDept.source, 'periods', 'period-7d',
    {window: {type: 'calendarDays', length: 30, end: 'yesterday', timezone: 'Asia/Shanghai'}});
  eq(changePeriod.ok, false, '被引用周期改窗口（语义）拒绝');
  // 限定：被草案 qualifiers 值匹配引用
  const delQual = coreApi.deleteDictionaryEntry(enableDept.source, 'qualifiers', 'qual-channel-app');
  eq(delQual.ok, false, '删除被值匹配引用的限定拒绝');
  // 未引用条目可安全删除
  const delPct = coreApi.deleteDictionaryEntry(enableDept.source, 'units', 'unit-pct');
  eq(delPct.ok, true, '未引用条目删除成功');
  eq(coreApi.findDictionaryEntryByCode(delPct.source, 'units', 'PCT'), null, '删除后查无');
});

test('D6b 引用清单：where 指明引用位置（scope/维度/单位/窗口/限定）', () => {
  const source = buildDictProject();
  const deptRefs = coreApi.listDictionaryReferences(source, 'departments', 'dept-ops');
  eq(deptRefs.length, 1, '部门引用 1 处');
  eq(deptRefs[0].where, ['scope.departmentId'], '引用位置 scope');
  eq(deptRefs[0].definitionCode, 'ops.app_paid_amount_7d', '引用定义');
  const dimRefs = coreApi.listDictionaryReferences(source, 'dimensions', 'dim-channel-id');
  assert(dimRefs.length >= 2, `维度引用 ≥2（发布原子+部门草案），实际 ${dimRefs.length}`);
  const whereAll = dimRefs.map(r => r.where.join('|')).join('|');
  assertIncludes(whereAll, 'spec.dimensions[0].dimensionId', '维度声明引用');
  assertIncludes(whereAll, 'outputGrain', '输出粒度引用');
  const unitRefs = coreApi.listDictionaryReferences(source, 'units', 'unit-cny');
  assertIncludes(unitRefs.map(r => r.where.join('|')).join('|'), 'spec.unit', '单位引用位置');
  const periodRefs = coreApi.listDictionaryReferences(source, 'periods', 'period-7d');
  assertIncludes(periodRefs.map(r => r.where.join('|')).join('|'), 'spec.window', '窗口引用位置');
  const qualRefs = coreApi.listDictionaryReferences(source, 'qualifiers', 'qual-channel-app');
  assertIncludes(qualRefs.map(r => r.where.join('|')).join('|'),
    'spec.qualifiers[0]', '限定引用位置');
});

test('D7 字典变更不改发布历史：hash/spec/resolvedSpec 不变', () => {
  const source = buildDictProject();
  const before = coreApi.getMetricRevision(source, 'mrev-paid-amount-1');
  const beforeHash = before.hash;
  const r1 = coreApi.updateDictionaryEntry(source, 'units', 'unit-cny', {name: '人民币（元）'});
  assert(r1.ok, JSON.stringify(r1.errors || []));
  const r2 = coreApi.updateDictionaryEntry(r1.source, 'units', 'unit-cny', {status: 'disabled'});
  assert(r2.ok, JSON.stringify(r2.errors || []));
  const r3 = coreApi.createDictionaryEntry(r2.source, 'dimensions',
    {code: 'dim-new', name: '新维度', valueType: 'string'});
  assert(r3.ok, JSON.stringify(r3.errors || []));
  const after = coreApi.getMetricRevision(r3.source, 'mrev-paid-amount-1');
  eq(after.hash, beforeHash, '发布 hash 不变');
  eq(after.spec.unit, 'CNY', '发布 spec 单位快照不变');
  eq(after.resolvedSpec.unit, 'CNY', 'resolvedSpec 快照不变');
  // 停用单位仍可被旧草案读取显示，但编辑器不再新选（DU4 覆盖）
});

test('D8 存储兼容：未知键保留、未来 schema 拒写读空', () => {
  const source = buildDictProject();
  const withUnknown = JSON.parse(JSON.stringify(source));
  withUnknown.profile.metricPlatform.futureCarrier = {keep: true};
  withUnknown.profile.metricPlatform.dictionary.extraCategory = [{id: 'x'}];
  const r = coreApi.createDictionaryEntry(withUnknown, 'units',
    {code: 'ORDER2', name: '订单数2'});
  assert(r.ok, JSON.stringify(r.errors || []));
  eq(r.source.profile.metricPlatform.futureCarrier, {keep: true}, 'metricPlatform 未知键保留');
  eq(r.source.profile.metricPlatform.dictionary.extraCategory, [{id: 'x'}],
    'dictionary 未知分类保留');
  eq(r.source.profile.modelCatalog.layers.length, 1, 'profile 其他键保留');
  const future = JSON.parse(JSON.stringify(r.source));
  future.profile.metricPlatform.schemaVersion = 99;
  eq(coreApi.readMetricDictionary(future).unsupportedSchemaVersion, true, '未来 schema 读空+标记');
  const futureWrite = coreApi.createDictionaryEntry(future, 'units', {code: 'X', name: 'x'});
  eq(futureWrite.ok, false, '未来 schema 拒写');
  eq(futureWrite.errors[0].code, 'SCHEMA_VERSION_UNSUPPORTED', '拒写错误码');
});

test('D9 概念复用：字典页不建第二概念事实源（concepts 原样读取）', () => {
  let source = fixtures.baseProject();
  const concept = coreApi.createMetricConcept(source,
    {id: 'concept-pay', domain: '交易', name: '支付'});
  assert(concept.ok, JSON.stringify(concept.errors || []));
  const dict = coreApi.readMetricDictionary(concept.source);
  eq(dict.concepts, undefined, 'dictionary 不含 concepts（复用 store.concepts）');
  eq(coreApi.readMetricPlatform(concept.source).concepts.length, 1, '概念仍在原 concepts');
});

// ================================================================ UI 层
const DictionarySynthComp = loadSynthReact('DictionaryPage.js').default;
const DefinitionSynthComp = loadSynthReact('DefinitionPage.js').default;
const WorkbenchSynth = loadSynthReact('MetricsWorkbench.js').default;
const PendingSynthComp = loadSynthReact('PendingPage.js').default;
const DictionaryReal = loadReal('DictionaryPage.js').default;
const render = el => reactDomServer.renderToStaticMarkup(el);

test('DU1 字典页空态与工作台接线：真实组件挂载，不渲染演示数据', () => {
  const project = fixtures.baseProject();
  const html = render(realReact.createElement(DictionaryReal, {
    source: project, commandRunner: null, readOnly: false,
  }));
  assertIncludes(html, 'metrics-dict-empty', '真实空态');
  assertIncludes(html, FormatMessageStub.string({id: 'metrics.dictionary.emptyTitle'}), '空态文案');
  assert(!(html.indexOf('dim-channel') >= 0), '不出现示例维度');
  assert(!(html.indexOf('运营部') >= 0), '不出现示例部门');
  // 工作台：字典页挂载真实 DictionaryPage，不再 PendingPage
  const {state, commandRunner} = makeWorld(project);
  const mount = synthetic.mountComponent(WorkbenchSynth, {
    source: state.source, getDataSource: () => state.source,
    updateDataSource: commandRunner.updateDataSource, readOnly: false, projectDirty: false,
  });
  firstByTestId(mount.element, 'metrics-nav-dictionary').props.onClick();
  eq(collect(mount.element, el => el.type === DictionarySynthComp).length, 1,
    '字典页挂载真实 DictionaryPage');
  eq(collect(mount.element, el => el.type === PendingSynthComp).length, 0,
    '字典页不再渲染未接入页');
  // 导航项不再带 M3 徽标
  const navBtn = firstByTestId(mount.element, 'metrics-nav-dictionary');
  eq(collect(navBtn, el => el.props
    && el.props.className === 'chiner-metrics-nav-pending').length, 0, '无未接入徽标');
});

test('DU2 维护链：部门/维度/限定/周期/单位经表单真实创建（一次命令一次 update）', () => {
  const {state, commandRunner} = makeWorld(fixtures.baseProject());
  const mount = synthetic.mountComponent(DictionarySynthComp, {
    source: state.source, commandRunner, readOnly: false,
  });
  // 部门
  firstByTestId(mount.element, 'metrics-dict-add').props.onClick();
  assert(firstByTestId(mount.element, 'metrics-dict-form') != null, '新增表单展开');
  setTestId(mount.element, 'metrics-dictf-code', 'ops');
  setTestId(mount.element, 'metrics-dictf-name', '运营部');
  let updatesBefore = state.updates;
  firstByTestId(mount.element, 'metrics-dict-submit').props.onClick();
  mount.setProps({source: state.source});
  eq(state.updates, updatesBefore + 1, '创建部门一次 update');
  eq(coreApi.readMetricDictionary(state.source).departments.length, 1, '部门真实落库');
  // 字符串维度
  firstByTestId(mount.element, 'metrics-dict-cat-dimensions').props.onClick();
  firstByTestId(mount.element, 'metrics-dict-add').props.onClick();
  setTestId(mount.element, 'metrics-dictf-code', 'dim-channel');
  setTestId(mount.element, 'metrics-dictf-name', '渠道');
  eq(firstByTestId(mount.element, 'metrics-dictf-valuetype').props.value, 'string', '默认字符串类型');
  updatesBefore = state.updates;
  firstByTestId(mount.element, 'metrics-dict-submit').props.onClick();
  mount.setProps({source: state.source});
  eq(state.updates, updatesBefore + 1, '创建维度一次 update');
  // 业务限定（引用字典维度）
  firstByTestId(mount.element, 'metrics-dict-cat-qualifiers').props.onClick();
  firstByTestId(mount.element, 'metrics-dict-add').props.onClick();
  setTestId(mount.element, 'metrics-dictf-code', 'channel-app');
  setTestId(mount.element, 'metrics-dictf-name', 'APP渠道');
  setTestId(mount.element, 'metrics-dictf-dimension', 'dim-channel');
  setTestId(mount.element, 'metrics-dictf-value', 'APP');
  firstByTestId(mount.element, 'metrics-dict-submit').props.onClick();
  mount.setProps({source: state.source});
  eq(coreApi.readMetricDictionary(state.source).qualifiers.length, 1, '限定真实落库');
  // 周期（7日）
  firstByTestId(mount.element, 'metrics-dict-cat-periods').props.onClick();
  firstByTestId(mount.element, 'metrics-dict-add').props.onClick();
  setTestId(mount.element, 'metrics-dictf-code', 'last-7d');
  setTestId(mount.element, 'metrics-dictf-name', '近7日');
  setTestId(mount.element, 'metrics-dictf-window-length', '7');
  firstByTestId(mount.element, 'metrics-dict-submit').props.onClick();
  mount.setProps({source: state.source});
  eq(coreApi.readMetricDictionary(state.source).periods[0].window.length, 7, '周期窗口落库');
  // 单位 CNY
  firstByTestId(mount.element, 'metrics-dict-cat-units').props.onClick();
  firstByTestId(mount.element, 'metrics-dict-add').props.onClick();
  setTestId(mount.element, 'metrics-dictf-code', 'CNY');
  setTestId(mount.element, 'metrics-dictf-name', '人民币元');
  firstByTestId(mount.element, 'metrics-dict-submit').props.onClick();
  mount.setProps({source: state.source});
  eq(coreApi.readMetricDictionary(state.source).units.length, 1, '单位落库');
  // 搜索过滤
  setTestId(mount.element, 'metrics-dictionary-search', 'cny');
  const rows = collect(mount.element, el => el.props
    && el.props['data-testid'] === 'metrics-dict-row');
  eq(rows.length, 1, '搜索 CNY 命中 1 行');
});

test('DU3 引用保护 UI：删除被引用条目拒绝并展开引用清单；未引用可删', () => {
  const {state, commandRunner} = makeWorld(buildDictProject());
  const mount = synthetic.mountComponent(DictionarySynthComp, {
    source: state.source, commandRunner, readOnly: false,
  });
  // 未引用单位 PCT 可删（confirm 录制 → onOk）
  firstByTestId(mount.element, 'metrics-dict-cat-units').props.onClick();
  const rows = () => collect(mount.element, el => el.props
    && el.props['data-testid'] === 'metrics-dict-row');
  eq(rows().length, 2, '两个单位');
  const pctRow = rows().filter(r => r.props['data-entry-id'] === 'unit-pct')[0];
  confirms.length = 0;
  collect(pctRow, el => el.props
    && el.props['data-testid'] === 'metrics-dict-delete')[0].props.onClick();
  eq(confirms.length, 1, '删除需确认');
  const updatesBefore = state.updates;
  confirms[0].onOk();
  mount.setProps({source: state.source});
  eq(state.updates, updatesBefore + 1, '未引用删除一次 update');
  eq(coreApi.findDictionaryEntryByCode(state.source, 'units', 'PCT'), null, 'PCT 已删');
  // 被引用 CNY 删除拒绝：错误上屏 + 引用面板自动展开
  const cnyRow = collect(mount.element, el => el.props
    && el.props['data-entry-id'] === 'unit-cny')[0];
  confirms.length = 0;
  collect(cnyRow, el => el.props
    && el.props['data-testid'] === 'metrics-dict-delete')[0].props.onClick();
  confirms[0].onOk();
  mount.setProps({source: state.source});
  eq(state.updates, updatesBefore + 1, '被引用删除零写入');
  assert(firstByTestId(mount.element, 'metrics-dict-errors') != null, 'DICTIONARY_IN_USE 上屏');
  const html = render(mount.element);
  assertIncludes(html, 'DICTIONARY_IN_USE', '错误码呈现');
  assert(firstByTestId(mount.element, 'metrics-dict-ref-list') != null, '引用面板自动展开');
  assertIncludes(html, 'paid_amount', '引用清单含真实定义');
  // 引用按钮手动切换
  firstByTestId(mount.element, 'metrics-dict-refs') == null
    ? assert(false, '引用按钮存在') : null;
});

test('DU4 原子编辑器实际选用：部门/单位/限定预设/类型化值（001 字符串、false 布尔）', () => {
  const {state, commandRunner} = makeWorld(buildDictProject());
  const mount = synthetic.mountComponent(DefinitionSynthComp, {
    source: state.source, commandRunner, readOnly: false, focus: null,
    onDirtyChange: () => {},
  });
  firstByTestId(mount.element, 'metrics-new-atomic').props.onClick();
  // 部门从字典选择
  setTestId(mount.element, 'metrics-form-scope', 'department');
  const deptSelect = firstByTestId(mount.element, 'metrics-form-department-select');
  assert(deptSelect != null, '部门字典选择控件出现');
  const deptCodes = collect(deptSelect, el => el.type === 'option')
    .map(o => o.props.value);
  assert(deptCodes.indexOf('ops') >= 0, `字典部门 ops 可选，实际 ${JSON.stringify(deptCodes)}`);
  setTestId(mount.element, 'metrics-form-department-select', 'ops');
  // 单位从字典选择
  const unitSelect = firstByTestId(mount.element, 'metrics-form-unit-select');
  assert(unitSelect != null, '单位字典选择控件出现');
  setTestId(mount.element, 'metrics-form-unit-select', 'CNY');
  // 限定预设：字典业务限定一键填入
  const presetSelect = firstByTestId(mount.element, 'metrics-baseQualifiers-preset');
  assert(presetSelect != null, '限定预设选择控件出现');
  const presetIds = collect(presetSelect, el => el.type === 'option').map(o => o.props.value);
  assert(presetIds.indexOf('qual-channel-app') >= 0, '预设含 channel-app');
  setTestId(mount.element, 'metrics-baseQualifiers-preset', 'qual-channel-app');
  // 字符串维度手输 '001'：不可被数字化
  firstByTestId(mount.element, 'metrics-baseQualifiers-add').props.onClick();
  const bareInputs = () => collect(firstByTestId(mount.element, 'metrics-baseQualifiers'),
    el => el.type === 'input' && !el.props.type);
  bareInputs()[2].props.onChange({target: {value: 'dim-channel'}});
  bareInputs()[3].props.onChange({target: {value: '001'}});
  // 布尔维度：值控件切换为 true/false 选择
  firstByTestId(mount.element, 'metrics-baseQualifiers-add').props.onClick();
  bareInputs()[4].props.onChange({target: {value: 'dim-is-app'}});
  const boolSelect = collect(firstByTestId(mount.element, 'metrics-baseQualifiers'),
    el => el.type === 'select')
    .filter(el => collect(el, o => o.type === 'option' && o.props.value === 'false').length > 0
      && collect(el, o => o.type === 'option' && o.props.value === 'true').length > 0)[0];
  assert(boolSelect != null, '布尔维度值控件为 true/false 选择');
  boolSelect.props.onChange({target: {value: 'false'}});
  // 基础字段
  setTestId(mount.element, 'metrics-form-name', '字典驱动指标');
  setTestId(mount.element, 'metrics-form-code', 'dict_driven_metric');
  setTestId(mount.element, 'metrics-form-owner', 'user-owner');
  setTestId(mount.element, 'metrics-form-domain', '交易');
  setTestId(mount.element, 'metrics-form-process', '支付');
  setTestId(mount.element, 'metrics-form-timerole', '支付时间');
  setTestId(mount.element, 'metrics-form-factgrain', '一笔订单一行');
  setTestId(mount.element, 'metrics-form-description', '字典类型化限定验证');
  const updatesBefore = state.updates;
  firstByTestId(mount.element, 'metrics-create-draft').props.onClick();
  mount.setProps({source: state.source});
  eq(state.updates, updatesBefore + 1, '创建草案一次 update');
  const store = coreApi.readMetricPlatform(state.source);
  const created = store.definitions.filter(d => d.code === 'dict_driven_metric')[0];
  assert(created != null, '定义真实创建');
  const draft = store.revisions.filter(r => r.definitionId === created.id
    && r.status === 'draft')[0];
  eq(created.scope, {kind: 'department', departmentId: 'ops'}, '部门来自字典选择');
  eq(draft.spec.unit, 'CNY', '单位来自字典选择');
  const qs = draft.spec.baseQualifiers;
  eq(qs[0], {dimensionId: 'dim-channel', op: 'eq', value: 'APP'}, '预设限定类型化填入');
  eq(qs[1].value, '001', '字符串维度 001 保持字符串');
  assert(typeof qs[1].value === 'string', '001 是 string 不是 number');
  eq(qs[2].value, false, '布尔维度 false 是布尔');
  assert(typeof qs[2].value === 'boolean', 'false 是 boolean');
});

test('DU4b 类型化拒绝：数值维度非数值保存被拦（零写入、错误定位）', () => {
  const {state, commandRunner} = makeWorld(buildDictProject());
  // 追加数值维度
  const r = coreApi.createDictionaryEntry(state.source, 'dimensions',
    {code: 'dim-level', name: '层级', valueType: 'number'});
  assert(r.ok, JSON.stringify(r.errors || []));
  state.source = r.source;
  const mount = synthetic.mountComponent(DefinitionSynthComp, {
    source: state.source, commandRunner, readOnly: false, focus: null,
    onDirtyChange: () => {},
  });
  firstByTestId(mount.element, 'metrics-new-atomic').props.onClick();
  setTestId(mount.element, 'metrics-form-name', '坏数值');
  setTestId(mount.element, 'metrics-form-code', 'bad_number_metric');
  setTestId(mount.element, 'metrics-form-owner', 'user-owner');
  setTestId(mount.element, 'metrics-form-unit-select', 'CNY');
  setTestId(mount.element, 'metrics-form-domain', '交易');
  setTestId(mount.element, 'metrics-form-process', '支付');
  setTestId(mount.element, 'metrics-form-timerole', '支付时间');
  setTestId(mount.element, 'metrics-form-factgrain', '一笔订单一行');
  firstByTestId(mount.element, 'metrics-baseQualifiers-add').props.onClick();
  const bareInputs = () => collect(firstByTestId(mount.element, 'metrics-baseQualifiers'),
    el => el.type === 'input' && !el.props.type);
  bareInputs()[0].props.onChange({target: {value: 'dim-level'}});
  bareInputs()[1].props.onChange({target: {value: 'high'}});
  const updatesBefore = state.updates;
  firstByTestId(mount.element, 'metrics-create-draft').props.onClick();
  eq(state.updates, updatesBefore, '类型化失败零写入');
  const html = render(mount.element);
  assertIncludes(html, 'spec.baseQualifiers[0].value', '错误 path 定位到具体行值');
});

test('DU5 派生编辑器：字典周期填窗 + 字符串维度类型化限定', () => {
  const {state, commandRunner} = makeWorld(buildDictProject());
  const mount = synthetic.mountComponent(DefinitionSynthComp, {
    source: state.source, commandRunner, readOnly: false, focus: null,
    onDirtyChange: () => {},
  });
  firstByTestId(mount.element, 'metrics-new-derived').props.onClick();
  setTestId(mount.element, 'metrics-form-atomic-rev', 'mrev-paid-amount-1');
  const preset = firstByTestId(mount.element, 'metrics-form-window-preset');
  assert(preset != null, '字典周期选择控件出现');
  setTestId(mount.element, 'metrics-form-window-preset', 'period-7d');
  eq(firstByTestId(mount.element, 'metrics-form-window-length').props.value, '7', '周期填入长度 7');
  eq(firstByTestId(mount.element, 'metrics-form-window-end').props.value, 'yesterday', '周期填入截止');
  eq(firstByTestId(mount.element, 'metrics-form-window-type').props.value, 'calendarDays', '周期填入类型');
  // 限定：dim-channel（原子声明 ∩ 字典字符串维度）；注意容器内第一个 select 是预设选择
  firstByTestId(mount.element, 'metrics-qualifiers-add').props.onClick();
  const dimSelect = collect(firstByTestId(mount.element, 'metrics-qualifiers'),
    el => el.type === 'select')
    .filter(el => collect(el, o => o.type === 'option'
      && o.props.value === 'dim-channel').length > 0)[0];
  assert(dimSelect != null, '维度选择控件存在');
  dimSelect.props.onChange({target: {value: 'dim-channel'}});
  const qualInputs = collect(firstByTestId(mount.element, 'metrics-qualifiers'),
    el => el.type === 'input' && !el.props.type);
  qualInputs[0].props.onChange({target: {value: '001'}});
  setTestId(mount.element, 'metrics-form-name', '字典周期派生');
  setTestId(mount.element, 'metrics-form-code', 'dict_period_derived');
  setTestId(mount.element, 'metrics-form-owner', 'user-owner');
  const updatesBefore = state.updates;
  firstByTestId(mount.element, 'metrics-create-draft').props.onClick();
  mount.setProps({source: state.source});
  eq(state.updates, updatesBefore + 1, '创建草案一次 update');
  const store = coreApi.readMetricPlatform(state.source);
  const created = store.definitions.filter(d => d.code === 'dict_period_derived')[0];
  const draft = store.revisions.filter(r => r.definitionId === created.id)[0];
  eq(draft.spec.window, {type: 'calendarDays', length: 7, end: 'yesterday',
    timezone: 'Asia/Shanghai'}, '窗口来自字典周期（快照值）');
  eq(draft.spec.qualifiers[0].value, '001', '派生限定 001 保持字符串');
  // 发布校验通过（窗口/限定真实有效）
  const pub = coreApi.publishMetricRevision(state.source, draft.id, {});
  assert(pub.ok, JSON.stringify(pub.errors || []).slice(0, 200));
});

test('DU6 旧项目兼容：无字典时保持自由输入，既有草案加载不误判脏', () => {
  // 无字典项目 + 已有草案
  let source = fixtures.baseProject();
  const draftCreate = coreApi.createMetricDraft(source, Object.assign(
    fixtures.paidAmountAtomic('metric-legacy'), {revisionId: 'mrev-legacy-1'}));
  assert(draftCreate.ok, JSON.stringify(draftCreate.errors || []));
  source = draftCreate.source;
  const {state, commandRunner} = makeWorld(source);
  const mount = synthetic.mountComponent(DefinitionSynthComp, {
    source: state.source, commandRunner, readOnly: false,
    focus: {definitionId: 'metric-legacy', revisionId: 'mrev-legacy-1', mode: 'edit',
      kind: null, nonce: 1},
    onDirtyChange: () => {},
  });
  assert(firstByTestId(mount.element, 'metrics-editor-page') != null, '进入草案编辑');
  // 无字典：单位/部门是普通输入，无字典选择控件
  const unitInput = firstByTestId(mount.element, 'metrics-form-unit');
  assert(unitInput != null && unitInput.type === 'input', '单位为自由输入');
  eq(firstByTestId(mount.element, 'metrics-form-unit-select'), null, '无字典单位选择');
  eq(firstByTestId(mount.element, 'metrics-form-window-preset'), null, '派生无周期预设（原子态不渲染）');
  // 保存按钮禁用 = 表单 pristine（旧定义兼容读取，不误判脏）
  eq(firstByTestId(mount.element, 'metrics-save-draft').props.disabled, true,
    '旧草案加载 pristine（启发式解析兼容旧数据）');
  // 手工输入渠道维度 + '001'：无字典 → M2 启发式（旧语义兼容，任务允许）
  firstByTestId(mount.element, 'metrics-baseQualifiers-add').props.onClick();
  const bareInputs = collect(firstByTestId(mount.element, 'metrics-baseQualifiers'),
    el => el.type === 'input' && !el.props.type);
  bareInputs[0].props.onChange({target: {value: 'dim-channel-manual'}});
  bareInputs[1].props.onChange({target: {value: '001'}});
  eq(firstByTestId(mount.element, 'metrics-save-draft').props.disabled, false, '手工值可编辑');
});

test('DU7 只读阻断：字典维护禁用，命令层 READ_ONLY 不伪造成功', () => {
  const {state, commandRunner} = makeWorld(buildDictProject());
  const mount = synthetic.mountComponent(DictionarySynthComp, {
    source: state.source, commandRunner, readOnly: true,
  });
  eq(firstByTestId(mount.element, 'metrics-dict-add').props.disabled, true, '新增禁用');
  firstByTestId(mount.element, 'metrics-dict-cat-units').props.onClick();
  const row = collect(mount.element, el => el.props
    && el.props['data-entry-id'] === 'unit-pct')[0];
  eq(collect(row, el => el.props
    && el.props['data-testid'] === 'metrics-dict-edit')[0].props.disabled, true, '编辑禁用');
  eq(collect(row, el => el.props
    && el.props['data-testid'] === 'metrics-dict-delete')[0].props.disabled, true, '删除禁用');
  eq(collect(row, el => el.props
    && el.props['data-testid'] === 'metrics-dict-toggle')[0].props.disabled, true, '停用禁用');
  // 命令层第二道防线
  const blocked = runReadOnlyCommand(commandRunner);
  eq(blocked.ok, false, '只读命令失败');
  eq(blocked.errors[0].code, 'READ_ONLY', 'READ_ONLY 错误码');
  eq(state.updates, 0, '只读零写入');
});

function runReadOnlyCommand(commandRunner) {
  return loadSynthReact('commands.js').runMetricCommand(
    Object.assign({}, commandRunner, {readOnly: true}),
    latest => coreApi.createDictionaryEntry(latest, 'units', {code: 'X9', name: 'x'}));
}

test('DU8 语言奇偶：metrics.dictionary zh/en 同构，组件引用键全覆盖', () => {
  const flat = (obj, prefix, out) => {
    Object.keys(obj || {}).forEach(k => {
      const v = obj[k];
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') flat(v, key, out);
      else out.push(key);
    });
    return out;
  };
  const zhKeys = flat(zhLang.metrics.dictionary, 'metrics.dictionary', []).sort();
  const enKeys = flat(enLang.metrics.dictionary, 'metrics.dictionary', []).sort();
  eq(zhKeys.filter(k => enKeys.indexOf(k) < 0), [], 'zh 独有键');
  eq(enKeys.filter(k => zhKeys.indexOf(k) < 0), [], 'en 独有键');
  // 组件引用的 metrics.*/metric.* 字面键全部存在（含新增 DictionaryPage）
  const used = new Set();
  const re = /['"`]((?:metrics|metric)\.[A-Za-z0-9_.]+)['"`]/g;
  const files = fs.readdirSync(metricsDir).filter(f => f.endsWith('.js'));
  files.forEach(f => {
    const src = fs.readFileSync(path.join(metricsDir, f), 'utf8');
    let m;
    while (m = re.exec(src)) used.add(m[1]);
  });
  // 动态拼出的键（ valueType.* / cat.* / dictionary.valueType ）
  ['string', 'number', 'boolean'].forEach(t => used.add(`metrics.dictionary.valueType.${t}`));
  ['concepts', 'departments', 'dimensions', 'qualifiers', 'periods', 'units']
    .forEach(c => used.add(`metrics.dictionary.cat.${c}`));
  const missing = [];
  used.forEach(k => {
    if (lookup(zhLang, k) == null || lookup(enLang, k) == null) missing.push(k);
  });
  eq(missing, [], '组件引用键缺失');
});

test('DU9 原生 select 真实渲染：字典页无 [object Object]，option 为本地化字符串', () => {
  const source = buildDictProject();
  const html = render(realReact.createElement(DictionaryReal, {
    source, commandRunner: null, readOnly: false,
  }));
  assert(!(html.indexOf('[object Object]') >= 0), '字典页渲染不得出现 [object Object]');
  assertIncludes(html, FormatMessageStub.string({id: 'metrics.dictionary.cat.units'}), '分类option文案');
  // 维度分类渲染值类型徽标（合成切换 → 真实 SSR）
  const mount = synthetic.mountComponent(DictionarySynthComp, {
    source, commandRunner: makeWorld(source).commandRunner, readOnly: false,
  });
  firstByTestId(mount.element, 'metrics-dict-cat-dimensions').props.onClick();
  const dimHtml = render(mount.element);
  assertIncludes(dimHtml, FormatMessageStub.string({id: 'metrics.dictionary.valueType.string'}),
    '值类型文案');
  assertIncludes(dimHtml, FormatMessageStub.string({id: 'metrics.dictionary.valueType.boolean'}),
    '布尔值类型文案');
  // 展开限定分类的编辑表单再渲染
  firstByTestId(mount.element, 'metrics-dict-cat-qualifiers').props.onClick();
  firstByTestId(mount.element, 'metrics-dict-add').props.onClick();
  const formHtml = render(mount.element);
  assert(!(formHtml.indexOf('[object Object]') >= 0), '限定表单无 [object Object]');
  assertIncludes(formHtml, FormatMessageStub.string({id: 'metrics.op.notIn'}), '操作符option字符串');
});

// ---------------------------------------------------------------- 汇总
console.log(`\n== 指标平台 M3A 字典测试 ==\n${passed}/${passed + failed} passed`);
if (failed > 0) {
  console.log(`失败：${failures.join(' | ')}`);
  process.exit(1);
}
