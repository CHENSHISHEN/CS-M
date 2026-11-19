// 指标平台 M4A — 模型绑定核心与持久化测试（CommonJS + @babel/core 真实加载生产模块）。
// 复跑：node doc/developer/metric-platform-v1/binding-test.cjs（仓库根目录）
// 手法：真实 src/lib/metric_platform（含 metrics/binding.js、metrics/persistence.js）；
// 真实 src/lib/datasource_util.js 的 reduceProject 与 src/lib/utils.js 的 _mergeDataSource
// （外部依赖 lodash/moment/dot 真实 require；'components'/'./event_tool'/'./update' 为
// 无关 UI/worker/版本桥接的窄 stub）。合成数据，不读 template/真实模型/真实报告。
const path = require('path');
const fs = require('fs');
const babel = require('@babel/core');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// node 垫片：src/lib/cache.js 顶层引用浏览器全局 localStorage（真实源码不改），
// 测试环境以内存实现替代，仅满足模块加载
if (typeof global.localStorage === 'undefined') {
  const memory = new Map();
  global.localStorage = {
    getItem: key => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
    clear: () => memory.clear(),
  };
}
// subscribe.js 顶层挂载 window.notify（浏览器全局），同样以最小对象满足加载
if (typeof global.window === 'undefined') {
  global.window = {};
}

// ---- 窄加载器：Babel(commonjs) 编译 ES 模块；相对路径补 .js / /index.js / .json ----
const moduleCache = new Map();
const STUBS = {
  'components': {FormatMessage: {string: ({id}) => id}},
  './event_tool': {postWorkerFuc: () => Promise.resolve(null)}, // worker 桥，不在本测路径
  './update': {compareVersion: () => false}, // 版本比较桥，不在本测路径
};
function loadEsModule(file) {
  const key = path.resolve(file);
  if (moduleCache.has(key)) return moduleCache.get(key);
  const code = fs.readFileSync(key, 'utf8');
  const transformed = babel.transformSync(code, {
    filename: key,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    presets: [[require.resolve('@babel/preset-env'), {targets: {node: '18'}, modules: 'commonjs'}]],
  }).code;
  const moduleObject = {exports: {}};
  moduleCache.set(key, moduleObject);
  const localRequire = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(STUBS, specifier)) return STUBS[specifier];
    if (specifier.startsWith('.')) {
      const base = path.resolve(path.dirname(key), specifier);
      for (const suffix of ['.js', '/index.js', '', '.json']) {
        const candidate = base + suffix;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          if (candidate.endsWith('.json')) {
            return JSON.parse(fs.readFileSync(candidate, 'utf8'));
          }
          return loadEsModule(candidate).exports;
        }
      }
      throw new Error(`cannot resolve ${specifier} from ${key}`);
    }
    return require(specifier);
  };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', transformed);
  fn(moduleObject.exports, localRequire, moduleObject, key, path.dirname(key));
  return moduleObject;
}

const api = loadEsModule(path.join(PROJECT_ROOT, 'src', 'lib', 'metric_platform.js')).exports;
const datasourceUtil = loadEsModule(path.join(PROJECT_ROOT, 'src', 'lib', 'datasource_util.js')).exports;
const utilsModule = loadEsModule(path.join(PROJECT_ROOT, 'src', 'lib', 'utils.js')).exports;

let passed = 0;
let failed = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({name, error});
    console.log(`FAIL ${name}`);
    console.log(`     ${error && error.message ? error.message.split('\n')[0] : error}`);
  }
};
const codesOf = result => (result.errors || []).map(item => item.code);
const hasErr = (result, code) => codesOf(result).indexOf(code) >= 0;

// =====================================================================
// 合成项目：概念 / 逻辑 / 物理 三层 + DWS 落地 + ADS 消费 + 原子/派生/复合链
// =====================================================================
const dwdOrder = {
  id: 'entity-dwd-order', defKey: 'dwd_trade_order', defName: '交易订单事实', type: 'P',
  fields: [
    {id: 'f-order-id', defKey: 'order_id', defName: '订单号', type: 'VARCHAR'},
    {id: 'f-amount', defKey: 'paid_amount', defName: '支付金额', type: 'DECIMAL'},
    {id: 'f-paid-at', defKey: 'paid_at', defName: '支付时间', type: 'DATETIME'},
    {id: 'f-channel', defKey: 'channel', defName: '渠道', type: 'VARCHAR'},
    {id: 'f-status', defKey: 'status', defName: '订单状态', type: 'VARCHAR'},
  ],
};
const dwsMetric = {
  id: 'entity-dws-metric', defKey: 'dws_metric_trade', defName: '交易指标汇总', type: 'P',
  fields: [
    {id: 'f-stat-date', defKey: 'stat_date', defName: '统计日期', type: 'DATE'},
    {id: 'f-amount-7d', defKey: 'paid_amount_7d', defName: '近7日支付金额', type: 'DECIMAL'},
    {id: 'f-channel-dws', defKey: 'channel', defName: '渠道', type: 'VARCHAR'},
  ],
};
const adsBoard = {
  id: 'entity-ads-board', defKey: 'ads_operate_board', defName: '经营看板', type: 'P',
  fields: [{id: 'f-aov', defKey: 'aov_7d', defName: '近7日客单价', type: 'DECIMAL'}],
};
const dwdRefund = {
  id: 'entity-dwd-refund', defKey: 'dwd_trade_refund', defName: '退款事实', type: 'P',
  fields: [
    {id: 'f-refund-id', defKey: 'refund_id', defName: '退款号', type: 'VARCHAR'},
    {id: 'f-refund-amount', defKey: 'refund_amount', defName: '退款金额', type: 'DECIMAL'},
  ],
};
const logicOrder = {
  id: 'logic-order', defKey: 'order_logic', defName: '订单逻辑', type: 'L',
  fields: [{id: 'lf-amount', defKey: 'amount', defName: '金额', type: 'DECIMAL'}],
};
const conceptTrade = {
  id: 'concept-trade', defKey: 'trade_concept', defName: '交易', type: 'C', fields: [], headers: [],
};

const baseProject = () => ({
  profile: {
    default: {db: ''},
    dataTypeSupports: [],
    codeTemplates: [],
    uiHint: [],
    otherKeep: {a: 1},
  },
  entities: [dwdOrder, dwsMetric, adsBoard, dwdRefund],
  logicEntities: [logicOrder],
  conceptEntities: [conceptTrade],
  dicts: [],
  domains: [],
  viewGroups: [],
  diagrams: [{
    id: 'dg-1', defKey: 'dg_trade',
    canvasData: {cells: [{shape: 'erdRelation', id: 'rel-1',
      source: {cell: 'n-order', port: 'f-order-id%out'}, target: {cell: 'n-refund', port: 'f-refund-id%in'}}]},
  }],
  views: [],
  standardFields: [],
  dataTypeMapping: {mappings: []},
  dbConn: [],
});

// 指标链：原子 paid_amount → 派生 paid_amount_7d → 复合 aov_7d；另设语义来源原子
function buildMetricChain(source) {
  let next = source;
  const concept = api.createMetricConcept(next, {
    id: 'concept-pay', domain: '交易', name: '支付', owner: 'user-owner',
  });
  if (!concept.ok) throw new Error(JSON.stringify(concept.errors));
  next = concept.source;
  const mk = (input) => {
    const created = api.createMetricDraft(next, input);
    if (!created.ok) throw new Error(JSON.stringify(created.errors));
    const published = api.publishMetricRevision(created.source, created.revision.id, {publishedAt: '2026-10-28T00:00:00Z'});
    if (!published.ok) throw new Error(JSON.stringify(published.errors));
    next = published.source;
    return published.revision;
  };
  const atomic = mk({
    id: 'metric-paid-amount', revisionId: 'mrev-paid-1', code: 'paid_amount', name: '已支付成交金额',
    scope: {kind: 'public'}, ownerId: 'user-owner', conceptId: 'concept-pay',
    spec: {
      kind: 'atomic', name: '已支付成交金额', description: '订单支付成功后的成交金额',
      businessDomain: '交易', businessProcess: '支付',
      aggregation: 'SUM', source: {modelId: 'entity-dwd-order', fieldId: 'f-amount'},
      factGrain: {description: '订单粒度', uniqueKeyFieldIds: ['f-order-id']},
      timeRole: '支付时间', timezone: 'Asia/Shanghai',
      baseQualifiers: [{dimensionId: 'dim-status', op: 'eq', value: 'PAID'}],
      unit: 'CNY', dimensions: [{dimensionId: 'dim-channel', addable: 'additive'}],
    },
  });
  const derived = mk({
    id: 'metric-amount-7d', revisionId: 'mrev-7d-1', code: 'paid_amount_7d', name: '近7日支付金额',
    scope: {kind: 'public'}, ownerId: 'user-owner', conceptId: 'concept-pay',
    spec: {
      kind: 'derived', name: '近7日支付金额', atomicRevisionId: 'mrev-paid-1',
      window: {type: 'calendarDays', length: 7, end: 'yesterday', timezone: 'Asia/Shanghai'},
      qualifiers: [], outputGrain: ['dim-channel'],
    },
  });
  const ordersAtomic = mk({
    id: 'metric-paid-orders', revisionId: 'mrev-orders-1', code: 'paid_orders', name: '支付订单数',
    scope: {kind: 'public'}, ownerId: 'user-owner', conceptId: 'concept-pay',
    spec: {
      kind: 'atomic', name: '支付订单数', description: '支付成功订单行数',
      businessDomain: '交易', businessProcess: '支付',
      aggregation: 'COUNT', source: {modelId: 'entity-dwd-order'},
      factGrain: {description: '订单粒度', uniqueKeyFieldIds: ['f-order-id']},
      timeRole: '支付时间', timezone: 'Asia/Shanghai',
      baseQualifiers: [{dimensionId: 'dim-status', op: 'eq', value: 'PAID'}],
      unit: 'ORDER', dimensions: [{dimensionId: 'dim-channel', addable: 'additive'}],
    },
  });
  const ordersDerived = mk({
    id: 'metric-orders-7d', revisionId: 'mrev-orders-7d-1', code: 'paid_orders_7d', name: '近7日支付订单数',
    scope: {kind: 'public'}, ownerId: 'user-owner', conceptId: 'concept-pay',
    spec: {
      kind: 'derived', name: '近7日支付订单数', atomicRevisionId: 'mrev-orders-1',
      window: {type: 'calendarDays', length: 7, end: 'yesterday', timezone: 'Asia/Shanghai'},
      qualifiers: [], outputGrain: ['dim-channel'],
    },
  });
  const compound = mk({
    id: 'metric-aov', revisionId: 'mrev-aov-1', code: 'app_aov_7d', name: '近7日客单价',
    scope: {kind: 'public'}, ownerId: 'user-owner', conceptId: 'concept-pay',
    spec: {
      kind: 'compound', name: '近7日客单价', description: 'SAFE_DIVIDE(金额, 订单数)',
      expression: 'SAFE_DIVIDE({{amount}}, {{orders}})',
      refs: [
        {key: 'amount', revisionId: 'mrev-7d-1'},
        {key: 'orders', revisionId: 'mrev-orders-7d-1'},
      ],
    },
  });
  return {source: next, atomic, derived, ordersAtomic, ordersDerived, compound};
}

// =====================================================================
// A. 绑定领域核心
// =====================================================================
function buildBoundProject() {
  const chain = buildMetricChain(baseProject());
  let source = chain.source;
  const bind = (input) => {
    const created = api.createMetricBinding(source, {
      createdAt: '2026-10-28T01:00:00Z', createdBy: 'user-designer', ...input,
    });
    if (!created.ok) throw new Error(JSON.stringify(created.errors));
    source = created.source;
    return created.binding;
  };
  // 计算来源：DWD 字段 → 原子（mapping 含时间/过滤/维度/事实键端点）
  const sourceBinding = bind({
    id: 'bind-src-1', role: 'COMPUTES_FROM', revisionId: 'mrev-paid-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dwd-order', fieldId: 'f-amount'},
    mapping: {
      aggregate: 'SUM', timeFieldId: 'f-paid-at', qualifierFieldIds: ['f-status'],
      dimensionFieldIds: ['f-channel'], factKeyFieldIds: ['f-order-id'],
    },
    evidence: {kind: 'manual', confirmedBy: 'user-owner', note: '字段级确认'},
  });
  // 物化输出：派生 → DWS 字段
  const outputBinding = bind({
    id: 'bind-out-1', role: 'MATERIALIZES_INTO', revisionId: 'mrev-7d-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dws-metric', fieldId: 'f-amount-7d'},
    evidence: {kind: 'manual', confirmedBy: 'user-owner'},
  });
  // 消费引用：复合 → ADS 模型（模型级，无字段端点）
  const consumeBinding = bind({
    id: 'bind-use-1', role: 'CONSUMED_BY', revisionId: 'mrev-aov-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-ads-board'},
    mapping: {usage: '看板展示'},
    evidence: {kind: 'manual', confirmedBy: 'user-bi'},
  });
  // 语义映射：概念实体 ↔ 指标业务概念；逻辑属性 ↔ 定义（语义度量）
  const semanticConceptBinding = bind({
    id: 'bind-sem-1', role: 'SEMANTIC_MATCH', conceptId: 'concept-pay',
    modelRef: {collection: 'conceptEntities', objectId: 'concept-trade'},
    mapping: {description: '概念实体表达“支付”业务概念'},
    evidence: {kind: 'manual', confirmedBy: 'user-owner'},
  });
  const semanticLogicBinding = bind({
    id: 'bind-sem-2', role: 'SEMANTIC_MATCH', revisionId: 'mrev-paid-1',
    modelRef: {collection: 'logicEntities', objectId: 'logic-order', fieldId: 'lf-amount'},
    mapping: {description: '逻辑属性语义度量对应原子指标'},
    evidence: {kind: 'manual', confirmedBy: 'user-owner'},
  });
  return {source, chain, bindings: {
    sourceBinding, outputBinding, consumeBinding, semanticConceptBinding, semanticLogicBinding,
  }};
}

test('四角色绑定事实记录：稳定ID/端点快照/指纹/命名空间/证据/事件', () => {
  const {source, bindings} = buildBoundProject();
  const store = api.readMetricPlatform(source);
  const b = bindings.sourceBinding;
  assert(b.metricRevisionId === 'mrev-paid-1', '固定指标版本');
  assert(b.modelRef.objectId === 'entity-dwd-order' && b.modelRef.fieldId === 'f-amount', '稳定模型/字段ID');
  assert(b.modelRef.objectKey === 'dwd_trade_order' && b.modelRef.fieldKey === 'paid_amount', '端点快照业务键');
  assert(typeof b.modelRef.schemaFingerprint === 'string' && b.modelRef.schemaFingerprint.length > 0, 'schema指纹');
  assert(b.namespace === store.namespace, '绑定携带项目命名空间');
  assert(b.state === 'confirmed' && b.evidence.confirmedBy === 'user-owner', '证据与状态');
  assert(b.events.map(e => e.type).join(',') === 'created,confirmed', '事件历史');
  assert(bindings.semanticConceptBinding.metricRevisionId === null
    && bindings.semanticConceptBinding.metricConceptId === 'concept-pay', '语义映射可指向业务概念');
});

test('模型侧反查：时间/过滤/维度/事实键端点全部进入影响索引', () => {
  const {source} = buildBoundProject();
  ['f-amount', 'f-paid-at', 'f-status', 'f-channel', 'f-order-id'].forEach((fieldId) => {
    const hits = api.listModelMetricBindings(source, {
      collection: 'entities', objectId: 'entity-dwd-order', fieldId,
    });
    assert(hits.length === 1 && hits[0].binding.role === 'COMPUTES_FROM', `字段 ${fieldId} 反查命中`);
  });
  // 语义层反查
  const sem = api.listModelMetricBindings(source, {collection: 'conceptEntities', objectId: 'concept-trade'});
  assert(sem.length === 1 && sem[0].binding.role === 'SEMANTIC_MATCH', '概念实体语义映射反查');
  const logicField = api.listModelMetricBindings(source, {
    collection: 'logicEntities', objectId: 'logic-order', fieldId: 'lf-amount',
  });
  assert(logicField.length === 1, '逻辑属性语义度量反查');
});

test('指标反查模型：直接/间接来源、落地、消费、语义分组与计数', () => {
  const {source} = buildBoundProject();
  const groups = api.getMetricModels(source, 'mrev-aov-1');
  assert(groups.consumers.length === 1, '复合的消费引用');
  assert(groups.sources.length === 0 && groups.materializations.length === 0, '复合自身无直接来源/落地');
  assert(groups.indirectSources.length === 1
    && groups.indirectSources[0].binding.modelRef.objectId === 'entity-dwd-order', '经依赖链的间接来源');
  assert(groups.counts.directCount === 1 && groups.counts.transitiveCount === 1, '直接/传递计数分开');
  const derivedGroups = api.getMetricModels(source, 'mrev-7d-1');
  assert(derivedGroups.sources.length === 0, '派生自身无直接来源（来源在原子）');
  assert(derivedGroups.indirectSources.length === 1, '派生的间接来源=原子端点');
  assert(derivedGroups.materializations.length === 1
    && derivedGroups.materializations[0].binding.modelRef.objectId === 'entity-dws-metric', '派生物化输出');
  const atomicGroups = api.getMetricModels(source, 'mrev-paid-1');
  assert(atomicGroups.sources.length === 1 && atomicGroups.semantic.length === 1, '原子直接来源与语义映射');
});

test('同指标跨多模型；同表不同字段独立端点', () => {
  const chain = buildMetricChain(baseProject());
  let source = chain.source;
  const first = api.createMetricBinding(source, {
    role: 'COMPUTES_FROM', revisionId: 'mrev-paid-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dwd-order', fieldId: 'f-amount'},
    evidence: {confirmedBy: 'u'},
  });
  assert(first.ok, JSON.stringify(first.errors));
  const second = api.createMetricBinding(first.source, {
    role: 'COMPUTES_FROM', revisionId: 'mrev-paid-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dwd-refund', fieldId: 'f-refund-amount'},
    evidence: {confirmedBy: 'u'},
  });
  assert(second.ok, JSON.stringify(second.errors));
  source = second.source;
  const sameTable = api.createMetricBinding(source, {
    role: 'COMPUTES_FROM', revisionId: 'mrev-paid-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dwd-order', fieldId: 'f-order-id'},
    evidence: {confirmedBy: 'u'},
  });
  assert(sameTable.ok, '同表不同字段不判重复（独立端点）');
  source = sameTable.source;
  const models = api.getMetricModels(source, 'mrev-paid-1');
  assert(models.sources.length === 3, '同指标跨多模型（含同表第二端点）');
  const perField = api.listModelMetricBindings(source, {
    collection: 'entities', objectId: 'entity-dwd-order', fieldId: 'f-order-id',
  });
  assert(perField.length === 1, '字段端点独立命中');
});

test('生命周期：suggested→confirm 需已发布；重复拒绝；解除不抹历史', () => {
  const chain = buildMetricChain(baseProject());
  // draft 不能 confirmed 绑定
  const draftCreated = api.createMetricDraft(chain.source, {
    id: 'metric-draft', revisionId: 'mrev-draft-1', code: 'draft_metric', name: '草案指标',
    scope: {kind: 'public'}, ownerId: 'u',
    spec: {kind: 'atomic', name: '草案指标', description: '草案描述', businessDomain: '交易',
      businessProcess: '支付', aggregation: 'SUM', timeRole: '支付时间', timezone: 'Asia/Shanghai',
      baseQualifiers: [], factGrain: {description: 'x', uniqueKeyFieldIds: []},
      unit: 'CNY', dimensions: []},
  });
  assert(draftCreated.ok, JSON.stringify(draftCreated.errors));
  const badConfirm = api.createMetricBinding(draftCreated.source, {
    role: 'CONSUMED_BY', revisionId: 'mrev-draft-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-ads-board'},
  });
  assert(!badConfirm.ok && hasErr(badConfirm, 'UNPUBLISHED_REFERENCE'), 'confirmed 绑定须已发布版本');
  const suggested = api.createMetricBinding(draftCreated.source, {
    role: 'CONSUMED_BY', revisionId: 'mrev-draft-1',
    modelRef: {collection: 'entities', objectId: 'entity-ads-board'},
  });
  assert(suggested.ok && suggested.binding.state === 'suggested', 'draft 可 suggested');
  // 重复（同角色同版本同端点且生效）→ 拒绝；released 后可重建
  const dup = api.createMetricBinding(suggested.source, {
    role: 'CONSUMED_BY', revisionId: 'mrev-draft-1',
    modelRef: {collection: 'entities', objectId: 'entity-ads-board'},
  });
  assert(!dup.ok && hasErr(dup, 'BINDING_EXISTS'), '生效重复拒绝');
  const released = api.releaseMetricBinding(suggested.source, suggested.binding.id, {
    reason: '看板下线', by: 'user-bi', at: '2026-10-28T02:00:00Z',
  });
  assert(released.ok && released.binding.state === 'released', '解除');
  const afterRelease = api.listMetricBindings(released.source, {bindingId: suggested.binding.id});
  assert(afterRelease.length === 0, '默认查询排除已解除');
  const history = api.listMetricBindings(released.source, {bindingId: suggested.binding.id, includeReleased: true});
  assert(history.length === 1, 'includeReleased 可见历史');
  assert(history[0].binding.modelRef.objectKey === 'ads_operate_board'
    && history[0].binding.releaseReason === '看板下线', '端点快照与解除原因保留');
  const recreate = api.createMetricBinding(released.source, {
    role: 'CONSUMED_BY', revisionId: 'mrev-draft-1',
    modelRef: {collection: 'entities', objectId: 'entity-ads-board'},
  });
  assert(recreate.ok, '解除后同端点可重建');
  const confirmTwice = api.confirmMetricBinding(released.source, suggested.binding.id, {});
  assert(!confirmTwice.ok && hasErr(confirmTwice, 'BINDING_STATE_INVALID'), 'released 不可再确认');
  // suggested → confirmed（发布版本）
  const suggestedOk = api.createMetricBinding(released.source, {
    role: 'CONSUMED_BY', revisionId: 'mrev-paid-1',
    modelRef: {collection: 'entities', objectId: 'entity-dwd-order'},
  });
  assert(suggestedOk.ok && suggestedOk.binding.state === 'suggested', '发布版可先 suggested');
  const confirmed = api.confirmMetricBinding(suggestedOk.source, suggestedOk.binding.id, {confirmedBy: 'u'});
  assert(confirmed.ok && confirmed.binding.state === 'confirmed', 'suggested 可确认');
});

test('真实自依赖：同版本同字段环拒绝；同表不同字段允许；跨版本共享端点环拒绝', () => {
  const chain = buildMetricChain(baseProject());
  let source = chain.source;
  // M2(派生 mrev-7d-1) 物化到 DWS.f-amount-7d；自身再从该字段取数 → 自环
  const out = api.createMetricBinding(source, {
    role: 'MATERIALIZES_INTO', revisionId: 'mrev-7d-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dws-metric', fieldId: 'f-amount-7d'},
    evidence: {confirmedBy: 'u'},
  });
  assert(out.ok, JSON.stringify(out.errors));
  source = out.source;
  const selfLoop = api.createMetricBinding(source, {
    role: 'COMPUTES_FROM', revisionId: 'mrev-7d-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dws-metric', fieldId: 'f-amount-7d'},
    evidence: {confirmedBy: 'u'},
  });
  assert(!selfLoop.ok && hasErr(selfLoop, 'BINDING_CYCLE'), '同版本同字段自环拒绝');
  // 同表不同字段取数 → 允许（不因同表误判字段环）
  const otherField = api.createMetricBinding(source, {
    role: 'COMPUTES_FROM', revisionId: 'mrev-7d-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dws-metric', fieldId: 'f-stat-date'},
    evidence: {confirmedBy: 'u'},
  });
  assert(otherField.ok, '同表不同字段不构成环');
  source = otherField.source;
  // 跨版本真实环：paid-1 物化到 F1；7d-1 从 F1 取数（边 paid-1→7d-1）；
  // 7d-1 物化到 F2；再让 paid-1 从 F2 取数（边 7d-1→paid-1）→ 闭环拒绝
  const m1 = api.createMetricBinding(source, {
    role: 'MATERIALIZES_INTO', revisionId: 'mrev-paid-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dws-metric', fieldId: 'f-channel-dws'},
    evidence: {confirmedBy: 'u'},
  });
  assert(m1.ok, JSON.stringify(m1.errors));
  const m2 = api.createMetricBinding(m1.source, {
    role: 'COMPUTES_FROM', revisionId: 'mrev-7d-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dws-metric', fieldId: 'f-channel-dws'},
    evidence: {confirmedBy: 'u'},
  });
  assert(m2.ok, JSON.stringify(m2.errors));
  const m3 = api.createMetricBinding(m2.source, {
    role: 'MATERIALIZES_INTO', revisionId: 'mrev-7d-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-ads-board', fieldId: 'f-aov'},
    evidence: {confirmedBy: 'u'},
  });
  assert(m3.ok, JSON.stringify(m3.errors));
  const closing = api.createMetricBinding(m3.source, {
    role: 'COMPUTES_FROM', revisionId: 'mrev-paid-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-ads-board', fieldId: 'f-aov'},
    evidence: {confirmedBy: 'u'},
  });
  assert(!closing.ok && hasErr(closing, 'BINDING_CYCLE'), '跨版本共享端点成环拒绝');
  // 无显式绑定时 ER 外键不自动产生血缘
  const fkOnly = api.listMetricBindings(m3.source, {collection: 'entities', objectId: 'entity-dwd-refund'});
  assert(fkOnly.length === 0, 'ER 外键不自动建血缘');
});

test('删除/改名：ID 保留；unresolved 与端点历史；不自动复活', () => {
  const built = buildBoundProject();
  let source = built.source;
  // 改名（defKey 变化）：ID 保留，指纹提示检查
  const renamed = {...source,
    entities: source.entities.map(e => (e.id === 'entity-dwd-order'
      ? {...e, defKey: 'dwd_trade_order_v2'} : e))};
  const renamedHits = api.listMetricBindings(renamed, {bindingId: 'bind-src-1'});
  assert(renamedHits.length === 1 && renamedHits[0].endpoint.present === true, '改名按 ID 保留关联');
  assert(renamedHits[0].fingerprintStatus === 'changed', 'defKey 变化提示指纹变化');
  const displayRenamed = {...source,
    entities: source.entities.map(e => (e.id === 'entity-dwd-order'
      ? {...e, defName: '交易订单事实(新)'} : e))};
  assert(api.listMetricBindings(displayRenamed, {bindingId: 'bind-src-1'})[0]
    .fingerprintStatus === 'match', '显示名变化指纹不变');
  // 删除端点字段（f-amount）→ 查询在场为假；同步后 unresolved
  const fieldDeleted = {...source,
    entities: source.entities.map(e => (e.id === 'entity-dwd-order'
      ? {...e, fields: e.fields.filter(f => f.id !== 'f-amount')} : e))};
  assert(api.listMetricBindings(fieldDeleted, {bindingId: 'bind-src-1'})[0]
    .endpoint.present === false, '端点字段缺失在场为假');
  const synced = api.syncMetricBindingStates(fieldDeleted, {at: '2026-10-28T03:00:00Z'});
  assert(synced.ok && synced.touched === 1, '同步失效');
  const unresolved = api.listMetricBindings(synced.source, {
    bindingId: 'bind-src-1', state: 'unresolved', includeReleased: true,
  })[0];
  assert(unresolved != null && unresolved.endpoint.present === false, 'unresolved 状态');
  assert(unresolved.binding.unresolved.reason === 'ENDPOINT_MISSING'
    && unresolved.binding.events.some(e => e.type === 'unresolved'), '失效原因与事件历史');
  assert(unresolved.binding.modelRef.objectKey === 'dwd_trade_order'
    && unresolved.binding.modelRef.fieldKey === 'paid_amount', '端点快照仍可读');
  // 字段回来（同 ID）：sync 不自动复活；显式 restore 恢复
  const again = api.syncMetricBindingStates(synced.source, {});
  assert(again.ok && again.touched === 0, 'sync 只降级不升级');
  const fieldRestored = {...synced.source,
    entities: synced.source.entities.map(e => (e.id === 'entity-dwd-order'
      ? {...e, fields: e.fields.concat([{id: 'f-amount', defKey: 'paid_amount', defName: '支付金额', type: 'DECIMAL'}])} : e))};
  const restore = api.restoreMetricBinding(fieldRestored, 'bind-src-1', {by: 'user-owner'});
  assert(restore.ok && restore.binding.state === 'suggested', '显式重连恢复');
  // mapping 角色字段删除（f-status 在 qualifierFieldIds）→ 按字段级查询命中并失效
  const marked = api.markMetricBindingsUnresolved(source, {
    collection: 'entities', objectId: 'entity-dwd-order', fieldId: 'f-status',
  }, {reason: 'FIELD_DELETED', by: 'user-owner', at: '2026-10-28T04:00:00Z'});
  assert(marked.ok && marked.touched === 1, 'mapping 字段删除命中绑定');
  const markedBinding = api.listMetricBindings(marked.source, {
    bindingId: 'bind-src-1', state: 'unresolved', includeReleased: true,
  })[0];
  assert(markedBinding != null && markedBinding.endpoint.present === true,
    'mapping 字段删除不误伤端点在场（端点字段仍在）');
});

test('影响分析：端点影响绑定与指标（含下游依赖者）', () => {
  const {source} = buildBoundProject();
  const impact = api.getBindingImpact(source, {
    collection: 'entities', objectId: 'entity-dwd-order', fieldId: 'f-amount',
  });
  assert(impact.bindings.length === 1 && impact.bindings[0].binding.role === 'COMPUTES_FROM', '端点绑定');
  assert(impact.metrics.length === 1
    && impact.metrics[0].metric.revision.id === 'mrev-paid-1', '受影响指标');
  const dependents = impact.metrics[0].dependents;
  assert(dependents.some(d => d.revisionId === 'mrev-7d-1' && d.roles.indexOf('ATOMIC_BASE') >= 0),
    '派生作为下游依赖者进入影响');
  // 落地端点影响：DWS 字段 → 派生指标，复合为其下游
  const dwsImpact = api.getBindingImpact(source, {
    collection: 'entities', objectId: 'entity-dws-metric', fieldId: 'f-amount-7d',
  });
  assert(dwsImpact.metrics.length === 1
    && dwsImpact.metrics[0].metric.revision.id === 'mrev-7d-1', '落地端点受影响指标');
  assert(dwsImpact.metrics[0].dependents.some(d => d.revisionId === 'mrev-aov-1'
    && d.roles.indexOf('OPERAND') >= 0), '复合依赖者进入影响');
});

// =====================================================================
// B. M1 来源就绪修正：概念/逻辑 = 语义设计，不是物理计算实现
// =====================================================================
test('就绪修正：逻辑/概念来源 → computeReady=false + sourceLayer；物理 → true', () => {
  let source = baseProject();
  const logicAtomic = api.createMetricDraft(source, {
    id: 'metric-logic-amount', revisionId: 'mrev-logic-1', code: 'logic_amount', name: '逻辑层金额',
    scope: {kind: 'public'}, ownerId: 'u',
    spec: {
      kind: 'atomic', name: '逻辑层金额', description: '逻辑层语义金额', businessDomain: '交易',
      businessProcess: '支付', aggregation: 'SUM', timeRole: '支付时间', timezone: 'Asia/Shanghai',
      source: {modelId: 'logic-order', fieldId: 'lf-amount'},
      baseQualifiers: [], factGrain: {description: 'x', uniqueKeyFieldIds: []}, unit: 'CNY', dimensions: [],
    },
  });
  assert(logicAtomic.ok, JSON.stringify(logicAtomic.errors));
  const logicPub = api.publishMetricRevision(logicAtomic.source, 'mrev-logic-1', {});
  assert(logicPub.ok, JSON.stringify(logicPub.errors));
  assert(logicPub.revision.resolvedSpec.computeReady === false, '逻辑来源不标计算就绪');
  assert(logicPub.revision.resolvedSpec.designOnly === true, '语义设计标记');
  assert(logicPub.revision.resolvedSpec.sourceLayer === 'logic', '来源分层=logic');
  const conceptAtomic = api.createMetricDraft(logicPub.source, {
    id: 'metric-concept-amount', revisionId: 'mrev-concept-1', code: 'concept_amount', name: '概念层计数',
    scope: {kind: 'public'}, ownerId: 'u',
    spec: {
      kind: 'atomic', name: '概念层计数', description: '概念层语义计数', businessDomain: '交易',
      businessProcess: '支付', aggregation: 'COUNT', timeRole: '支付时间', timezone: 'Asia/Shanghai',
      source: {modelId: 'concept-trade'},
      baseQualifiers: [], factGrain: {description: 'x', uniqueKeyFieldIds: []}, unit: 'ORDER', dimensions: [],
    },
  });
  const conceptPub = api.publishMetricRevision(conceptAtomic.source, 'mrev-concept-1', {});
  assert(conceptPub.ok && conceptPub.revision.resolvedSpec.computeReady === false
    && conceptPub.revision.resolvedSpec.sourceLayer === 'concept', '概念来源=语义设计');
  // 物理来源 → computeReady true（既有行为保持）
  const chain = buildMetricChain(conceptPub.source);
  assert(chain.atomic.resolvedSpec.computeReady === true
    && chain.atomic.resolvedSpec.sourceLayer === 'physical', '物理来源元数据就绪');
  // 派生自语义原子 → 未就绪传播（设计元数据就绪≠实际 SQL 执行）
  const semanticDerived = api.createMetricDraft(chain.source, {
    id: 'metric-logic-7d', revisionId: 'mrev-logic-7d-1', code: 'logic_amount_7d', name: '逻辑金额7日',
    scope: {kind: 'public'}, ownerId: 'u',
    spec: {kind: 'derived', name: '逻辑金额7日', atomicRevisionId: 'mrev-logic-1',
      window: {type: 'calendarDays', length: 7, end: 'yesterday', timezone: 'Asia/Shanghai'},
      qualifiers: [], outputGrain: []},
  });
  const derivedPub = api.publishMetricRevision(semanticDerived.source, 'mrev-logic-7d-1', {});
  assert(derivedPub.ok && derivedPub.revision.resolvedSpec.computeReady === false, '语义来源沿链传播未就绪');
  // 来源字段存在性校验保持如实
  const badField = api.createMetricDraft(derivedPub.source, {
    id: 'metric-bad-field', revisionId: 'mrev-bad-1', code: 'bad_field', name: '坏字段',
    scope: {kind: 'public'}, ownerId: 'u',
    spec: {kind: 'atomic', name: '坏字段', description: '坏字段描述', businessDomain: '交易',
      businessProcess: '支付', aggregation: 'SUM', timeRole: '支付时间', timezone: 'Asia/Shanghai',
      baseQualifiers: [],
      source: {modelId: 'entity-dwd-order', fieldId: 'f-not-exist'},
      factGrain: {description: 'x', uniqueKeyFieldIds: []}, unit: 'CNY', dimensions: []},
  });
  const badPub = api.publishMetricRevision(badField.source, 'mrev-bad-1', {});
  assert(!badPub.ok && (badPub.errors || []).some(e => e.code === 'UNKNOWN_REFERENCE'
    && e.path === 'spec.source.fieldId'), '来源字段校验如实');
});

// =====================================================================
// C. 持久化：真实 reduceProject / _mergeDataSource / 保存序列化
// =====================================================================
function buildPersistProject() {
  const chain = buildMetricChain(baseProject());
  let source = chain.source;
  const bind = (input) => {
    const created = api.createMetricBinding(source, input);
    if (!created.ok) throw new Error(JSON.stringify(created.errors));
    source = created.source;
    return created.binding;
  };
  bind({
    id: 'bind-persist-src', role: 'COMPUTES_FROM', revisionId: 'mrev-paid-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dwd-order', fieldId: 'f-amount'},
    mapping: {aggregate: 'SUM', timeFieldId: 'f-paid-at', qualifierFieldIds: ['f-status']},
    evidence: {confirmedBy: 'u'},
  });
  bind({
    id: 'bind-persist-sem', role: 'SEMANTIC_MATCH', conceptId: 'concept-pay',
    modelRef: {collection: 'conceptEntities', objectId: 'concept-trade'},
    evidence: {confirmedBy: 'u'},
  });
  bind({
    id: 'bind-persist-logic', role: 'SEMANTIC_MATCH', revisionId: 'mrev-paid-1',
    modelRef: {collection: 'logicEntities', objectId: 'logic-order', fieldId: 'lf-amount'},
    evidence: {confirmedBy: 'u'},
  });
  // 未知键保留验证
  const store = JSON.parse(JSON.stringify(source.profile.metricPlatform));
  store.futureKey = {keep: true};
  source = {...source, profile: {...source.profile, metricPlatform: store}};
  return source;
}

test('真实 reduceProject(old 模式)：指标引用与绑定端点按新 ID 重绑、指纹稳定、未知键保留', () => {
  const project = buildPersistProject();
  const reduced = datasourceUtil.reduceProject(project, 'old');
  const original = project.entities.filter(e => e.id === 'entity-dwd-order')[0];
  const newEntity = reduced.entities.filter(e => e.defKey === original.defKey)[0];
  assert(newEntity.id !== original.id, '实体换新 ID');
  const store = api.readMetricPlatform(reduced);
  const atomic = store.revisions.filter(r => r.id === 'mrev-paid-1')[0];
  assert(atomic.spec.source.modelId === newEntity.id, 'spec.source.modelId 重绑');
  const newAmountField = newEntity.fields.filter(f => f.defKey === 'paid_amount')[0];
  assert(atomic.spec.source.fieldId === newAmountField.id, 'spec.source.fieldId 重绑');
  assert(atomic.spec.factGrain.uniqueKeyFieldIds[0]
    === newEntity.fields.filter(f => f.defKey === 'order_id')[0].id, 'factGrain 字段重绑');
  assert(atomic.hash === api.hashValue({spec: atomic.spec, resolvedSpec: atomic.resolvedSpec}),
    '发布 hash 按重映射后内容重算一致');
  const srcBinding = store.bindings.filter(b => b.id === 'bind-persist-src')[0];
  assert(srcBinding.modelRef.objectId === newEntity.id
    && srcBinding.modelRef.fieldId === newAmountField.id, '绑定端点重绑');
  assert(srcBinding.mapping.timeFieldId
    === newEntity.fields.filter(f => f.defKey === 'paid_at')[0].id, 'mapping 时间字段重绑');
  assert(srcBinding.modelRef.schemaFingerprint
    === api.modelSchemaFingerprint(newEntity), '指纹（defKey/类型）导入后仍一致');
  assert(srcBinding.state === 'confirmed', '全量随导入不失效');
  const newConcept = reduced.conceptEntities.filter(c => c.defKey === 'trade_concept')[0];
  const semBinding = store.bindings.filter(b => b.id === 'bind-persist-sem')[0];
  assert(semBinding.modelRef.objectId === newConcept.id, '概念语义绑定重绑');
  const newLogic = reduced.logicEntities.filter(l => l.defKey === 'order_logic')[0];
  const logicBinding = store.bindings.filter(b => b.id === 'bind-persist-logic')[0];
  assert(logicBinding.modelRef.objectId === newLogic.id
    && logicBinding.modelRef.fieldId === newLogic.fields[0].id, '逻辑字段语义绑定重绑');
  assert(reduced.profile.metricPlatform.futureKey, '未知键保留');
  assert(store.namespace === project.profile.metricPlatform.namespace, '命名空间保留');
});

test('真实 reduceProject(defKey 模式)：经源集合 defKey 回退命中', () => {
  const project = buildPersistProject();
  const reduced = datasourceUtil.reduceProject(project, 'defKey');
  const store = api.readMetricPlatform(reduced);
  const newEntity = reduced.entities.filter(e => e.defKey === 'dwd_trade_order')[0];
  const atomic = store.revisions.filter(r => r.id === 'mrev-paid-1')[0];
  assert(atomic.spec.source.modelId === newEntity.id, 'defKey 回退对象命中');
  assert(atomic.spec.source.fieldId === newEntity.fields.filter(f => f.defKey === 'paid_amount')[0].id,
    'defKey 回退字段命中');
  const srcBinding = store.bindings.filter(b => b.id === 'bind-persist-src')[0];
  assert(srcBinding.modelRef.objectId === newEntity.id, '绑定端点 defKey 回退命中');
});

test('真实 _mergeDataSource：导入指标不丢、冲突显式、未选实体 unresolved、目标草稿不动', () => {
  // 目标项目：自有指标 + 未提交草案 + 未知 profile 键
  const targetChain = buildMetricChain(baseProject());
  let target = targetChain.source;
  const targetDraft = api.createMetricDraft(target, {
    id: 'metric-target-draft', revisionId: 'mrev-target-draft', code: 'target_draft', name: '目标草案',
    scope: {kind: 'public'}, ownerId: 'u-owner',
    spec: {kind: 'atomic', name: '目标草案', description: '目标草案描述', businessDomain: '交易',
      businessProcess: '支付', aggregation: 'COUNT', timeRole: '支付时间', timezone: 'Asia/Shanghai',
      baseQualifiers: [], factGrain: {description: 'x', uniqueKeyFieldIds: []},
      unit: 'ORDER', dimensions: []},
  });
  assert(targetDraft.ok, JSON.stringify(targetDraft.errors));
  target = {...targetDraft.source, profile: {...targetDraft.source.profile, unknownProfileKey: 'keep'}};
  // 导入项目：与目标同 code 的定义（冲突）+ 引用真实 revision id 撞目标（mrev-paid-1）
  const importProject = buildPersistProject();
  const selected = importProject.entities.filter(e => e.id !== 'entity-ads-board'
    && e.id !== 'entity-dwd-refund'); // 选中 dwd-order（defKey 匹配目标同名实体）+ dws-metric（新增）
  const merged = utilsModule._mergeDataSource(target, importProject, selected, true);
  const store = api.readMetricPlatform(merged);
  // 目标侧不动
  const targetDraftKept = store.revisions.filter(r => r.id === 'mrev-target-draft')[0];
  assert(targetDraftKept != null && targetDraftKept.status === 'draft', '目标未提交草案不被覆盖');
  assert(store.revisions.filter(r => r.id === 'mrev-paid-1' && r.definitionId === 'metric-paid-amount').length === 1,
    '目标既有版本原样');
  assert(merged.profile.unknownProfileKey === 'keep', '目标未知 profile 键保留');
  // 导入指标并入：定义 code 冲突 → 后缀 + 诊断
  const importedDef = store.definitions.filter(d => d.code === 'paid_amount_imp')[0];
  assert(importedDef != null, 'code 冲突显式换后缀并入');
  const diagnostics = store.importDiagnostics || [];
  assert(diagnostics.some(d => d.code === 'METRIC_IMPORT_CODE_RENAMED' && d.from === 'paid_amount'),
    'code 冲突诊断');
  // revision id 撞目标 → 换新 id 且内部引用跟随
  const remapped = diagnostics.filter(d => d.code === 'METRIC_IMPORT_ID_REASSIGNED' && d.kind === 'revision');
  assert(remapped.length > 0, 'revision id 撞号换新');
  const targetRevisionIds = {};
  (target.profile.metricPlatform.revisions || []).forEach(r => { targetRevisionIds[r.id] = true; });
  const importedRevisions = store.revisions.filter(r => !targetRevisionIds[r.id]);
  assert(importedRevisions.length === 5, '导入原子×2/派生×2/复合链完整并入');
  const importedIds = {};
  importedRevisions.forEach(r => { importedIds[r.id] = true; });
  importedRevisions.forEach((r) => {
    if (r.spec.kind === 'derived') {
      assert(importedIds[r.spec.atomicRevisionId], '派生引用跟随重映射/保留');
    }
    if (r.spec.kind === 'compound') {
      r.spec.refs.forEach(ref => assert(importedIds[ref.revisionId], '复合操作数引用完整'));
    }
  });
  // 绑定端点：defKey 匹配 → 目标实体；未随导入（dws 选择性验证见下）
  const targetOrder = merged.entities.filter(e => e.defKey === 'dwd_trade_order')[0];
  const importedSrcBinding = store.bindings.filter(b => b.id === 'bind-persist-src')[0];
  assert(importedSrcBinding.modelRef.objectId === targetOrder.id, '匹配实体绑定指向目标对象');
  assert(importedSrcBinding.state === 'confirmed', '匹配端点不失效');
  const importedNewField = targetOrder.fields.filter(f => f.defKey === 'paid_amount')[0];
  assert(importedSrcBinding.modelRef.fieldId === importedNewField.id, '字段按 defKey 对齐目标字段');
  // 概念/逻辑语义绑定：逻辑实体 defKey 匹配目标 → 目标 id
  const targetLogic = merged.logicEntities.filter(l => l.defKey === 'order_logic')[0];
  const logicBinding = store.bindings.filter(b => b.id === 'bind-persist-logic')[0];
  assert(logicBinding.modelRef.objectId === targetLogic.id, '逻辑语义绑定并入并指向目标逻辑实体');
});

test('真实 _mergeDataSource：同号对象不复活目标失效绑定；未选实体绑定 unresolved', () => {
  // 目标：绑定在 dwd-order 上，端点整体移除后 → unresolved（保留原端点身份）
  const chain = buildMetricChain(baseProject());
  const bound = api.createMetricBinding(chain.source, {
    id: 'bind-target-1', role: 'COMPUTES_FROM', revisionId: 'mrev-paid-1', state: 'confirmed',
    modelRef: {collection: 'entities', objectId: 'entity-dwd-order', fieldId: 'f-amount'},
    evidence: {confirmedBy: 'u'},
  });
  assert(bound.ok, JSON.stringify(bound.errors));
  const emptied = {...bound.source, entities: bound.source.entities
    .filter(e => e.id !== 'entity-dwd-order')};
  const synced = api.syncMetricBindingStates(emptied, {});
  const target = synced.source;
  const targetBinding = api.readMetricPlatform(target).bindings
    .filter(b => b.id === 'bind-target-1')[0];
  assert(targetBinding.state === 'unresolved'
    && targetBinding.modelRef.objectId === 'entity-dwd-order', '目标绑定失效保留原端点');
  // 导入项目：含 id 恰为 entity-dwd-order 的对象（不同 defKey → 并入/追加均不应复活目标绑定）
  const importProject = buildPersistProject();
  const collide = JSON.parse(JSON.stringify(importProject));
  collide.entities = collide.entities.map(e => (e.defKey === 'dwd_trade_refund'
    ? {...e, id: 'entity-dwd-order'} : e));
  // 只选碰撞对象与 dws；ads/refund 原对象未选 → 其上的导入绑定不因“未选”失效（无绑定），
  // dws 被选 → 保留；碰撞对象绑定指向合并结果
  const selected = collide.entities.filter(e => ['dwd_trade_refund', 'dws_metric_trade']
    .indexOf(e.defKey) >= 0);
  const merged = utilsModule._mergeDataSource(target, collide, selected, true);
  const store = api.readMetricPlatform(merged);
  const stillUnresolved = store.bindings.filter(b => b.id === 'bind-target-1')[0];
  assert(stillUnresolved.state === 'unresolved', '同号导入不复活目标失效绑定');
  // 未选择实体上的导入绑定 → unresolved（不误绑目标同号对象），端点快照保留
  const importBinding = store.bindings.filter(b => b.id === 'bind-persist-src'
    || (b.metricDefinitionId === 'metric-paid-amount' && b.role === 'COMPUTES_FROM'))[0];
  assert(importBinding != null && importBinding.state === 'unresolved',
    '未随导入端点 unresolved');
  assert(importBinding.modelRef.objectKey === 'dwd_trade_order', '导入绑定端点快照保留');
  const importDiag = store.importDiagnostics || [];
  assert(importDiag.some(d => d.code === 'METRIC_IMPORT_ENDPOINT_UNRESOLVED'), '导入端点诊断');
});

test('真实 _mergeDataSource：schemaVersion 未知源 → 不执行、显式诊断、目标原样', () => {
  const targetChain = buildMetricChain(baseProject());
  const target = targetChain.source;
  const source = {...baseProject(), profile: {...baseProject().profile,
    metricPlatform: {schemaVersion: 99, namespace: 'x', definitions: [{id: 'd1'}]}}};
  const merged = utilsModule._mergeDataSource(target, source, [], true);
  const store = api.readMetricPlatform(merged);
  const diagnostics = merged.profile.metricPlatform.importDiagnostics || [];
  assert(diagnostics.some(d => d.code === 'METRIC_IMPORT_UNKNOWN_SCHEMA'), '未知 schema 诊断');
  assert(merged.profile.metricPlatform.definitions.length
    === target.profile.metricPlatform.definitions.length, '目标定义不被覆盖');
  assert(!store.definitions.some(d => d.id === 'd1'), '未知结构不导入');
});

test('真实 _mergeDataSource：目标无指标存储 → 沿用源命名空间并入', () => {
  const target = baseProject(); // 无 metricPlatform
  const importProject = buildPersistProject();
  const selected = importProject.entities;
  const merged = utilsModule._mergeDataSource(target, importProject, selected, true);
  const store = api.readMetricPlatform(merged);
  assert(store.namespace === importProject.profile.metricPlatform.namespace, '沿用源命名空间');
  assert(store.definitions.length === 5, '定义并入');
  assert(store.bindings.length === 3, '绑定并入');
  const newOrder = merged.entities.filter(e => e.defKey === 'dwd_trade_order')[0];
  const srcBinding = store.bindings.filter(b => b.id === 'bind-persist-src')[0];
  assert(srcBinding.modelRef.objectId === newOrder.id, '端点重绑到合并后实体');
  assert((store.importDiagnostics || []).some(d => d.code === 'METRIC_IMPORT_NAMESPACE_ADOPTED'),
    '命名空间沿用诊断');
});

test('保存/版本快照序列化：绑定随整项目 JSON 落盘重读一致（saveProjectVersion 同构路径）', () => {
  const project = buildPersistProject();
  // saveProjectVersion/saveJsonPromise 对整项目 JSON.stringify 落盘；此处同构往返
  const saved = JSON.parse(JSON.stringify(project));
  const store = api.readMetricPlatform(saved);
  assert(store.bindings.length === 3, '绑定随整项目序列化保留');
  assert(store.namespace === project.profile.metricPlatform.namespace, '命名空间不丢');
  assert(saved.profile.metricPlatform.futureKey, '未知键随保存保留');
  assert(saved.profile.otherKeep, 'profile 其他键随保存保留');
  const binding = api.listMetricBindings(saved, {bindingId: 'bind-persist-src'})[0];
  assert(binding.endpoint.present === true && binding.fingerprintStatus === 'match', '重读后端点/指纹有效');
});

test('字典随导入合并：同 code 不同内容换后缀 + 诊断；内容相同去重', () => {
  const targetChain = buildMetricChain(baseProject());
  let target = targetChain.source;
  const dimCreated = api.createDictionaryEntry(target, 'dimensions',
    {id: 'dim-channel', code: 'dim-channel', name: '渠道', valueType: 'string'});
  assert(dimCreated.ok, JSON.stringify(dimCreated.errors));
  target = dimCreated.source;
  const source = {...baseProject(), profile: {...baseProject().profile,
    metricPlatform: {schemaVersion: 1, namespace: 'mns-src',
      dictionary: {dimensions: [
        {id: 'dim-x1', code: 'dim-channel', name: '渠道(源)', valueType: 'string', status: 'active'},
        {id: 'dim-x2', code: 'dim-region', name: '地区', valueType: 'string', status: 'active'},
      ]}}}};
  const merged = utilsModule._mergeDataSource(target, source, [], true);
  const dims = api.readMetricPlatform(merged).dictionary.dimensions;
  assert(dims.filter(d => d.code === 'dim-channel').length === 1
    && dims.filter(d => d.code === 'dim-channel')[0].name === '渠道', '目标 code 保持');
  assert(dims.filter(d => d.code === 'dim-channel_imp').length === 1, '冲突条目换后缀保留');
  assert(dims.filter(d => d.code === 'dim-region').length === 1, '新条目并入');
  const diagnostics = api.readMetricPlatform(merged).importDiagnostics || [];
  assert(diagnostics.some(d => d.code === 'METRIC_IMPORT_CODE_RENAMED' && d.category === 'dimensions'),
    '字典冲突诊断');
});

// =====================================================================
// D. M4A-R1：导入身份与内容一致性（字典级联/hash重算/模型来源/前向引用/未知键）
// =====================================================================

// 两个设计态原子：a1 挂 dwd-order（随导入）、a2 挂 ads-board（不选 → 未随导入）
function buildTwoAtomicProject() {
  let source = baseProject();
  const mk = (input) => {
    const created = api.createMetricDraft(source, input);
    if (!created.ok) throw new Error(JSON.stringify(created.errors));
    const published = api.publishMetricRevision(created.source, created.revision.id, {publishedAt: '2026-10-29T00:00:00Z'});
    if (!published.ok) throw new Error(JSON.stringify(published.errors));
    source = published.source;
    return published.revision;
  };
  const a1 = mk({
    id: 'metric-a1', revisionId: 'mrev-a1', code: 'a1_amount', name: '订单金额A1',
    scope: {kind: 'public'}, ownerId: 'u',
    spec: {
      kind: 'atomic', name: '订单金额A1', description: 'A1描述', businessDomain: '交易',
      businessProcess: '支付', aggregation: 'SUM', timeRole: '支付时间', timezone: 'Asia/Shanghai',
      source: {modelId: 'entity-dwd-order', fieldId: 'f-amount'},
      factGrain: {description: '订单粒度', uniqueKeyFieldIds: ['f-order-id']},
      baseQualifiers: [], unit: 'CNY', dimensions: [],
    },
  });
  const a2 = mk({
    id: 'metric-a2', revisionId: 'mrev-a2', code: 'a2_amount', name: '客单价A2',
    scope: {kind: 'public'}, ownerId: 'u',
    spec: {
      kind: 'atomic', name: '客单价A2', description: 'A2描述', businessDomain: '交易',
      businessProcess: '支付', aggregation: 'AVG', timeRole: '支付时间', timezone: 'Asia/Shanghai',
      source: {modelId: 'entity-ads-board', fieldId: 'f-aov'},
      factGrain: {description: '订单粒度', uniqueKeyFieldIds: []},
      baseQualifiers: [], unit: 'CNY', dimensions: [],
    },
  });
  return {source, a1, a2};
}

test('M4A-R1 真实reduce→merge：原子spec来源/事实键沿合并集合重绑；未随导入保留失效证据且不再声称就绪', () => {
  const target = buildMetricChain(baseProject()).source;
  const importProject = buildTwoAtomicProject().source;
  const reduced = datasourceUtil.reduceProject(importProject, 'old');
  const reducedOrder = reduced.entities.filter(e => e.defKey === 'dwd_trade_order')[0];
  const reducedAds = reduced.entities.filter(e => e.defKey === 'ads_operate_board')[0];
  // 只选 dwd-order（defKey 命中目标）；ads-board 未选 → 未随导入
  const selected = reduced.entities.filter(e => e.id === reducedOrder.id);
  const merged = utilsModule._mergeDataSource(target, reduced, selected, true);
  const store = api.readMetricPlatform(merged);
  const targetOrder = merged.entities.filter(e => e.defKey === 'dwd_trade_order')[0];
  assert(targetOrder.id === 'entity-dwd-order' && targetOrder.id !== reducedOrder.id, '目标同名实体沿用目标 id');
  // a1：spec.source 沿 old 标记重绑到目标实体，字段/事实键按 defKey 对齐
  const importedA1 = store.revisions.filter(r => r.id === 'mrev-a1')[0];
  assert(importedA1 != null && importedA1.spec.source.modelId === targetOrder.id, 'spec.source.modelId 重绑到目标实体 id');
  assert(importedA1.spec.source.fieldId === targetOrder.fields.filter(f => f.defKey === 'paid_amount')[0].id,
    'spec.source.fieldId 按 defKey 对齐目标字段');
  assert(importedA1.spec.factGrain.uniqueKeyFieldIds[0]
    === targetOrder.fields.filter(f => f.defKey === 'order_id')[0].id, '事实键对齐目标字段');
  assert(importedA1.resolvedSpec.computeReady === true, '物理来源重绑后保持就绪');
  assert(importedA1.hash === api.hashValue({spec: importedA1.spec, resolvedSpec: importedA1.resolvedSpec}),
    '发布 hash 按转换后内容一致');
  // a2：模型未随导入——保留原端点 + unresolved 证据 + 诊断，不误绑目标同 defKey 对象
  const importedA2 = store.revisions.filter(r => r.id === 'mrev-a2')[0];
  assert(importedA2 != null && importedA2.spec.source.modelId === reducedAds.id, '未随导入保留原（reduce 后）端点身份');
  assert(importedA2.spec.source.modelId !== 'entity-ads-board', '不误绑目标同号/同defKey对象');
  assert(importedA2.spec.source.unresolved === true, '失效证据 unresolved 标记');
  assert(importedA2.resolvedSpec.computeReady === false
    && importedA2.resolvedSpec.designOnly === true, '导入副本不再声称计算就绪');
  assert(importedA2.hash === api.hashValue({spec: importedA2.spec, resolvedSpec: importedA2.resolvedSpec}),
    '未就绪副本 hash 同步重算');
  const diagnostics = store.importDiagnostics || [];
  assert(diagnostics.some(d => d.code === 'METRIC_IMPORT_ENDPOINT_UNRESOLVED'
    && d.kind === 'spec.source' && d.objectId === reducedAds.id), '原子来源未随导入诊断');
});

test('M4A-R1 字典冲突code级联：scope/限定/维度/粒度/单位/patch/字典qualifier/resolvedSpec 全量重映射', () => {
  // 目标：部门 ops=销售部、维度 dim-channel=渠道、单位 CNY，自有部门定义不动
  let target = buildMetricChain(baseProject()).source;
  const addTargetDict = (category, input) => {
    const created = api.createDictionaryEntry(target, category, input);
    if (!created.ok) throw new Error(JSON.stringify(created.errors));
    target = created.source;
  };
  addTargetDict('departments', {id: 'mdept-ops', code: 'ops', name: '销售部'});
  addTargetDict('dimensions', {id: 'mdim-channel', code: 'dim-channel', name: '渠道', valueType: 'string'});
  addTargetDict('units', {id: 'munit-cny', code: 'CNY', name: '元'});
  addTargetDict('qualifiers', {id: 'mqual-target', code: 'q-target', name: '目标限定',
    dimensionId: 'dim-channel', op: 'eq', value: 'PAID'});
  const targetDep = api.createMetricDraft(target, {
    id: 'metric-target-ops', revisionId: 'mrev-target-ops', code: 'target_ops_amount', name: '目标部门口径',
    scope: {kind: 'department', departmentId: 'ops'}, ownerId: 'u',
    spec: {kind: 'atomic', name: '目标部门口径', description: 'x', businessDomain: '交易',
      businessProcess: '支付', aggregation: 'SUM', timeRole: '支付时间', timezone: 'Asia/Shanghai',
      baseQualifiers: [{dimensionId: 'dim-channel', op: 'eq', value: 'PAID'}],
      factGrain: {description: 'x', uniqueKeyFieldIds: []}, unit: 'CNY',
      dimensions: [{dimensionId: 'dim-channel', addable: 'additive'}]},
  });
  assert(targetDep.ok, JSON.stringify(targetDep.errors));
  target = targetDep.source;
  // 来源：同 code 不同语义（ops=运营部、dim-channel=渠道(源)、CNY=人民币元）+ 引用这些 code 的指标
  let source = baseProject();
  const addSourceDict = (category, input) => {
    const created = api.createDictionaryEntry(source, category, input);
    if (!created.ok) throw new Error(JSON.stringify(created.errors));
    source = created.source;
  };
  addSourceDict('departments', {id: 'mdept-ops', code: 'ops', name: '运营部'}); // id 与目标撞号
  addSourceDict('dimensions', {id: 'mdim-src-channel', code: 'dim-channel', name: '渠道(源)', valueType: 'string'});
  addSourceDict('dimensions', {id: 'mdim-region', code: 'dim-region', name: '渠道', valueType: 'string'}); // 显示名撞、code 不撞
  addSourceDict('units', {id: 'munit-src-cny', code: 'CNY', name: '人民币元'});
  addSourceDict('qualifiers', {id: 'mqual-src', code: 'q-src', name: '已支付限定',
    dimensionId: 'dim-channel', op: 'eq', value: 'PAID'});
  const pub = api.createMetricDraft(source, {
    id: 'metric-src-pub', revisionId: 'mrev-src-pub', code: 'src_public_amount', name: '来源公共口径',
    scope: {kind: 'public'}, ownerId: 'u',
    spec: {kind: 'atomic', name: '来源公共口径', description: 'x', businessDomain: '交易',
      businessProcess: '支付', aggregation: 'SUM', timeRole: '支付时间', timezone: 'Asia/Shanghai',
      baseQualifiers: [{dimensionId: 'dim-channel', op: 'eq', value: 'PAID'}],
      factGrain: {description: 'x', uniqueKeyFieldIds: []}, unit: 'CNY',
      dimensions: [{dimensionId: 'dim-channel', addable: 'additive'}]},
  });
  assert(pub.ok, JSON.stringify(pub.errors));
  const pubPublished = api.publishMetricRevision(pub.source, 'mrev-src-pub', {});
  assert(pubPublished.ok, JSON.stringify(pubPublished.errors));
  source = pubPublished.source;
  const dep = api.createDepartmentMetricDraft(source, {
    id: 'metric-src-dep', revisionId: 'mrev-src-dep', code: 'src_ops_amount', name: '来源部门口径',
    baseRevisionId: 'mrev-src-pub', departmentId: 'ops', ownerId: 'u',
    patch: {addBaseQualifiers: [{dimensionId: 'dim-channel', op: 'eq', value: 'REFUND'}]},
  });
  assert(dep.ok, JSON.stringify(dep.errors));
  source = dep.source; // 部门口径保持 draft（覆盖 patch/etag 级联）
  const merged = utilsModule._mergeDataSource(target, source, [], true);
  const store = api.readMetricPlatform(merged);
  // 字典结果：冲突换后缀保留、分类 ID 撞号换新、显示名相同不反查合并
  const departments = store.dictionary.departments;
  assert(departments.filter(d => d.code === 'ops')[0].name === '销售部', '目标部门保持');
  const importedDept = departments.filter(d => d.code === 'ops_imp')[0];
  assert(importedDept != null && importedDept.name === '运营部', '来源部门换后缀保留');
  assert(importedDept.id !== 'mdept-ops', '分类条目 ID 撞号换新');
  const dims = store.dictionary.dimensions;
  assert(dims.filter(d => d.code === 'dim-channel_imp').length === 1, '来源维度换后缀保留');
  assert(dims.filter(d => d.code === 'dim-region').length === 1
    && dims.filter(d => d.code === 'dim-region')[0].name === '渠道', '显示名相同不反查身份，各自保留');
  assert(store.dictionary.units.filter(d => d.code === 'CNY_imp').length === 1, '来源单位换后缀保留');
  const importedQualifier = store.dictionary.qualifiers.filter(d => d.id === 'mqual-src')[0];
  assert(importedQualifier != null && importedQualifier.dimensionId === 'dim-channel_imp',
    '字典 qualifier.dimensionId 级联');
  assert(store.dictionary.qualifiers.filter(d => d.id === 'mqual-target')[0].dimensionId === 'dim-channel',
    '目标字典 qualifier 引用不被级联改写');
  // 指标引用级联（只作用来源副本）
  const importedPublic = store.revisions.filter(r => r.id === 'mrev-src-pub')[0];
  assert(importedPublic.spec.baseQualifiers[0].dimensionId === 'dim-channel_imp', 'spec.baseQualifiers 级联');
  assert(importedPublic.spec.dimensions[0].dimensionId === 'dim-channel_imp', 'spec.dimensions 级联');
  assert(importedPublic.spec.unit === 'CNY_imp', 'spec.unit 级联');
  assert(importedPublic.resolvedSpec.unit === 'CNY_imp'
    && importedPublic.resolvedSpec.grain[0] === 'dim-channel_imp'
    && importedPublic.resolvedSpec.baseQualifiers[0].dimensionId === 'dim-channel_imp',
    'resolvedSpec 单位/粒度/基础限定级联');
  assert(importedPublic.hash === api.hashValue({spec: importedPublic.spec, resolvedSpec: importedPublic.resolvedSpec}),
    '级联后 hash 重算一致');
  const importedDep = store.revisions.filter(r => r.id === 'mrev-src-dep')[0];
  assert(importedDep.definitionId === 'metric-src-dep'
    && store.definitions.filter(d => d.id === 'metric-src-dep')[0].scope.departmentId === 'ops_imp',
    '定义 scope.departmentId 级联到来源对应部门');
  assert(importedDep.patch.addBaseQualifiers[0].dimensionId === 'dim-channel_imp', '部门 patch 限定级联');
  assert(importedDep.spec.baseQualifiers.every(q => q.dimensionId === 'dim-channel_imp'), '部门 spec 限定级联');
  assert(importedDep.etag === api.draftEtag(importedDep), '级联后 draft etag 重算一致');
  // 目标自身引用不级联
  const targetDepKept = store.definitions.filter(d => d.id === 'metric-target-ops')[0];
  assert(targetDepKept.scope.departmentId === 'ops', '目标定义 scope 不被级联改写');
  assert(store.revisions.filter(r => r.id === 'mrev-target-ops')[0].spec.unit === 'CNY', '目标 spec 引用不被级联改写');
  const diagnostics = store.importDiagnostics || [];
  assert(diagnostics.some(d => d.code === 'METRIC_IMPORT_CODE_RENAMED' && d.category === 'departments'
    && d.from === 'ops' && d.to === 'ops_imp'), '部门 code 冲突诊断');
  assert(diagnostics.some(d => d.code === 'METRIC_IMPORT_ID_REASSIGNED'
    && d.kind === 'dictionaryEntry' && d.category === 'departments'), '分类 ID 撞号诊断');
});

test('M4A-R1 发布hash/etag重算：导入副本全部一致，目标既有与来源原文件快照不动', () => {
  const target = buildMetricChain(baseProject()).source;
  const targetBefore = JSON.stringify(target.profile.metricPlatform);
  let importProject = buildPersistProject();
  const draftAdded = api.createMetricDraft(importProject, {
    id: 'metric-imp-draft', revisionId: 'mrev-imp-draft', code: 'imp_draft_metric', name: '导入草案',
    scope: {kind: 'public'}, ownerId: 'u',
    spec: {kind: 'atomic', name: '导入草案', description: 'x', businessDomain: '交易',
      businessProcess: '支付', aggregation: 'COUNT', timeRole: '支付时间', timezone: 'Asia/Shanghai',
      baseQualifiers: [], factGrain: {description: 'x', uniqueKeyFieldIds: []},
      unit: 'ORDER', dimensions: []},
  });
  assert(draftAdded.ok, JSON.stringify(draftAdded.errors));
  importProject = draftAdded.source;
  const importBefore = JSON.stringify(importProject.profile.metricPlatform);
  const selected = importProject.entities.filter(e => ['dwd_trade_order', 'dws_metric_trade']
    .indexOf(e.defKey) >= 0);
  const merged = utilsModule._mergeDataSource(target, importProject, selected, true);
  const store = api.readMetricPlatform(merged);
  const targetRevisionIds = {};
  (target.profile.metricPlatform.revisions || []).forEach(r => { targetRevisionIds[r.id] = true; });
  const importedRevisions = store.revisions.filter(r => !targetRevisionIds[r.id]);
  assert(importedRevisions.length === 6, '原子×2/派生×2/复合/草案完整并入');
  const importedIds = {};
  importedRevisions.forEach(r => { importedIds[r.id] = true; });
  importedRevisions.forEach((revision) => {
    if (revision.status === 'draft') {
      assert(revision.etag === api.draftEtag(revision), `导入草案 etag 重算一致 (${revision.id})`);
    } else {
      assert(revision.hash === api.hashValue({spec: revision.spec, resolvedSpec: revision.resolvedSpec}),
        `导入发布 hash 重算一致 (${revision.id})`);
    }
    if (revision.spec.kind === 'derived') {
      assert(importedIds[revision.spec.atomicRevisionId], '派生前向引用指向导入集合');
    }
    if (revision.spec.kind === 'compound') {
      revision.spec.refs.forEach(ref => assert(importedIds[ref.revisionId], '复合操作数指向导入集合'));
    }
  });
  // 目标既有快照不动
  const targetKept = store.revisions.filter(r => targetRevisionIds[r.id]);
  targetKept.forEach((revision) => {
    const before = JSON.parse(targetBefore).revisions.filter(r => r.id === revision.id)[0];
    assert(revision.hash === before.hash && revision.etag === before.etag, `目标既有快照不动 (${revision.id})`);
  });
  // 来源原文件不动
  assert(JSON.stringify(importProject.profile.metricPlatform) === importBefore, '来源输入平台快照不被修改');
});

test('M4A-R1 版本数组倒序：baseline 前向引用全字段同步到换新后的导入版本', () => {
  const target = buildMetricChain(baseProject()).source;
  const chain = buildMetricChain(baseProject());
  const dep = api.createDepartmentMetricDraft(chain.source, {
    id: 'metric-dep-1', revisionId: 'mrev-dep-1', code: 'paid_amount_ops', name: '部门支付口径',
    baseRevisionId: 'mrev-paid-1', departmentId: 'dept-ops', ownerId: 'u',
    patch: {addBaseQualifiers: [{dimensionId: 'dim-channel', op: 'eq', value: 'REFUND'}]},
  });
  assert(dep.ok, JSON.stringify(dep.errors));
  const depPublished = api.publishMetricRevision(dep.source, 'mrev-dep-1', {publishedAt: '2026-10-29T00:00:00Z'});
  assert(depPublished.ok, JSON.stringify(depPublished.errors));
  // 倒序：部门版本排在公共版本之前（前向引用）
  const platform = depPublished.source.profile.metricPlatform;
  const reversed = {...depPublished.source, profile: {...depPublished.source.profile,
    metricPlatform: {...platform, revisions: platform.revisions.slice().reverse()}}};
  const merged = utilsModule._mergeDataSource(target, reversed, [], true);
  const store = api.readMetricPlatform(merged);
  const diagnostics = store.importDiagnostics || [];
  const remappedCommon = diagnostics.filter(d => d.code === 'METRIC_IMPORT_ID_REASSIGNED'
    && d.kind === 'revision' && d.from === 'mrev-paid-1')[0];
  assert(remappedCommon != null, '公共版本撞目标同号换新');
  const remappedDef = diagnostics.filter(d => d.code === 'METRIC_IMPORT_ID_REASSIGNED'
    && d.kind === 'definition' && d.from === 'metric-paid-amount')[0];
  assert(remappedDef != null, '公共定义撞目标同号换新');
  const importedDep = store.revisions.filter(r => r.id === 'mrev-dep-1')[0];
  assert(importedDep != null, '部门版本并入');
  assert(importedDep.baseline.baseRevisionId === remappedCommon.to
    && importedDep.baseline.revisionId === remappedCommon.to, 'baseline.baseRevisionId/revisionId 同步到导入公共版本');
  assert(importedDep.baseline.definitionId === remappedDef.to, 'baseline.definitionId 同步到导入定义');
  assert(importedDep.resolvedSpec.baseline.baseRevisionId === remappedCommon.to, 'resolvedSpec.baseline 同步');
  assert(importedDep.definitionId === 'metric-dep-1'
    && store.definitions.filter(d => d.id === 'metric-dep-1')[0].baseline == null, '部门定义自身并入');
  assert(importedDep.hash === api.hashValue({spec: importedDep.spec, resolvedSpec: importedDep.resolvedSpec}),
    'baseline 同步后 hash 重算一致');
});

test('M4A-R1 恰好一次映射：冲突换新ID不抢占来源原ID，前向引用只转换一次', () => {
  const targetProfile = {metricPlatform: {schemaVersion: 1, namespace: 'mns-t',
    definitions: [{id: 'def-common', namespace: 'mns-t', code: 'common', name: '公共',
      kind: 'atomic', scope: {kind: 'public'}, ownerId: 'u'}],
    revisions: [{id: 'rev-a', definitionId: 'def-common', version: '1.0', status: 'published',
      spec: {kind: 'atomic', name: '公共', unit: 'CNY', baseQualifiers: [], dimensions: []},
      resolvedSpec: {kind: 'atomic', unit: 'CNY', grain: [], qualifiers: [], computeReady: false},
      hash: 'h00000000'}]}};
  const sourceProfile = {metricPlatform: {schemaVersion: 1, namespace: 'mns-s',
    definitions: [
      {id: 'def-a', namespace: 'mns-s', code: 'a', name: 'A', kind: 'atomic',
        scope: {kind: 'public'}, ownerId: 'u'},
      {id: 'def-b', namespace: 'mns-s', code: 'b', name: 'B', kind: 'derived',
        scope: {kind: 'public'}, ownerId: 'u'},
    ],
    revisions: [
      {id: 'rev-a', definitionId: 'def-a', version: '1.0', status: 'published',
        spec: {kind: 'atomic', name: 'A', unit: 'CNY', baseQualifiers: [], dimensions: []},
        resolvedSpec: {kind: 'atomic', unit: 'CNY', grain: [], qualifiers: [], computeReady: false},
        hash: 'haaaaaaaa'},
      {id: 'rev-b', definitionId: 'def-b', version: '1.0', status: 'published',
        spec: {kind: 'derived', name: 'B', atomicRevisionId: 'rev-a',
          window: {type: 'calendarDays', length: 7, end: 'yesterday'}, qualifiers: [], outputGrain: []},
        resolvedSpec: {kind: 'derived', unit: 'CNY', grain: [], qualifiers: [], computeReady: false},
        hash: 'hbbbbbbbb'},
    ]}};
  // 第一次提议 rev-b（已被来源 rev-b 原ID占用）→ 必须换 rev-c
  const proposals = ['rev-b', 'rev-c'];
  let cursor = 0;
  const result = api.mergeMetricPlatformForImport({targetProfile, sourceProfile,
    merged: {entities: [], logicEntities: [], conceptEntities: []},
    sources: {entities: [], logicEntities: [], conceptEntities: []},
    makeId: () => proposals[cursor++],
  });
  const importedA = result.revisions.filter(r => r.definitionId === 'def-a')[0];
  const importedB = result.revisions.filter(r => r.definitionId === 'def-b')[0];
  assert(importedA.id === 'rev-c', '冲突换新不抢占来源原ID（rev-b 被来源占用 → rev-c）');
  assert(importedB.id === 'rev-b', '来源无冲突版本保留原ID');
  assert(importedB.spec.atomicRevisionId === 'rev-c', '前向引用恰好一次转换到换新后的ID');
  assert(result.revisions.filter(r => r.id === 'rev-a').length === 1, '目标同号版本原样唯一');
  [importedA, importedB].forEach(revision =>
    assert(revision.hash === api.hashValue({spec: revision.spec, resolvedSpec: revision.resolvedSpec}),
      `hash 按转换后内容重算 (${revision.id})`));
});

test('M4A-R1 来源unknown键保留：平台级/字典级来源独有并入、同名冲突显式诊断、输入不可变', () => {
  const targetChain = buildMetricChain(baseProject());
  const target = {...targetChain.source, profile: {...targetChain.source.profile,
    metricPlatform: {...targetChain.source.profile.metricPlatform,
      futureTarget: {keep: 1}, futureKey: {owner: 'target'}}}};
  const source = JSON.parse(JSON.stringify(buildPersistProject()));
  source.profile.metricPlatform.futureOnlySource = {preserve: 'source-extension'};
  source.profile.metricPlatform.futureKey = {keep: true}; // 与目标同名不同值
  source.profile.metricPlatform.dictionary = {futureDictKey: {a: 1}}; // 字典级来源独有未知键
  const targetBefore = JSON.stringify(target);
  const sourceBefore = JSON.stringify(source);
  const selected = source.entities;
  const merged = utilsModule._mergeDataSource(target, source, selected, true);
  const platform = merged.profile.metricPlatform;
  assert(JSON.stringify(platform.futureOnlySource) === JSON.stringify({preserve: 'source-extension'}),
    '来源独有平台未知键保留');
  assert(JSON.stringify(platform.futureKey) === JSON.stringify({owner: 'target'}),
    '同名冲突保留目标值');
  assert(platform.futureTarget != null && platform.futureTarget.keep === 1, '目标未知键不动');
  assert(platform.dictionary != null && platform.dictionary.futureDictKey != null
    && platform.dictionary.futureDictKey.a === 1, '字典级来源独有未知键保留');
  const diagnostics = platform.importDiagnostics || [];
  assert(diagnostics.some(d => d.code === 'METRIC_IMPORT_UNKNOWN_KEY_CONFLICT'
    && d.key === 'futureKey' && d.sourceValue != null && d.sourceValue.keep === true),
    '同名未知键冲突显式诊断并记录来源值');
  assert(JSON.stringify(target) === targetBefore && JSON.stringify(source) === sourceBefore,
    '合并不修改源/目标输入');
});

// =====================================================================
function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach(({name, error}) => {
    console.log(`--- ${name}`);
    console.log(error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n') : error);
  });
  process.exit(1);
}
