// 指标平台 M1 合成夹具：小订单模型（仅合成数据，不读 template/真实模型）。
// 被 core-test.cjs 复用；结构对齐 PDManer 实体的 entities/fields 形状（id/defKey/defName/type）。

const orderEntity = {
  id: 'entity-trade-order',
  defKey: 'trade_order',
  defName: '交易订单',
  type: 'P',
  fields: [
    {id: 'field-order-id', defKey: 'order_id', defName: '订单号', type: 'VARCHAR'},
    {id: 'field-paid-amount', defKey: 'paid_amount', defName: '支付金额', type: 'DECIMAL'},
    {id: 'field-paid-at', defKey: 'paid_at', defName: '支付时间', type: 'DATETIME'},
    {id: 'field-channel', defKey: 'channel', defName: '渠道', type: 'VARCHAR'},
    {id: 'field-status', defKey: 'status', defName: '订单状态', type: 'VARCHAR'},
    {id: 'field-is-test', defKey: 'is_test', defName: '测试单', type: 'BOOLEAN'},
    {id: 'field-is-void', defKey: 'is_void', defName: '作废单', type: 'BOOLEAN'},
  ],
};

// 基础项目：含 profile 其他键、模型与图形资产，用于验证写入不破坏既有数据
const baseProject = () => ({
  profile: {
    default: {db: 'db1', javaHome: '/keep/me'},
    modelCatalog: {layers: [{id: 'layer-ods', defKey: 'ODS'}], categories: []},
  },
  entities: [orderEntity],
  logicEntities: [{id: 'logic-order', defKey: 'order_l', defName: '订单逻辑', fields: []}],
  conceptEntities: [{id: 'concept-trade', type: 'C', defName: '交易', fields: []}],
  diagrams: [{id: 'd1', canvasData: {cells: []}}],
  viewGroups: [{id: 'g1', defKey: 'TRADE', refEntities: ['entity-trade-order']}],
  dicts: [{id: 'dict-status', defKey: 'order_status'}],
});

const channelDim = {dimensionId: 'dim-channel', addable: 'additive'};
const regionDim = {dimensionId: 'dim-region', addable: 'additive'};

// 公共原子：已支付成交金额（SUM 支付金额）
const paidAmountAtomic = (id) => ({
  id,
  code: 'paid_amount',
  name: '已支付成交金额',
  kind: 'atomic',
  scope: {kind: 'public'},
  ownerId: 'user-owner',
  spec: {
    kind: 'atomic',
    name: '已支付成交金额',
    description: '订单支付成功后的成交金额',
    businessDomain: '交易',
    businessProcess: '支付',
    aggregation: 'SUM',
    source: {modelId: 'entity-trade-order', fieldId: 'field-paid-amount'},
    factGrain: {description: '一笔订单一行', uniqueKeyFieldIds: ['field-order-id']},
    timeRole: '支付时间',
    timezone: 'Asia/Shanghai',
    baseQualifiers: [
      {dimensionId: 'dim-status', op: 'eq', value: 'PAID'},
      {dimensionId: 'dim-is-test', op: 'eq', value: false},
      {dimensionId: 'dim-is-void', op: 'eq', value: false},
    ],
    unit: 'CNY',
    dimensions: [channelDim, regionDim],
  },
});

// 公共原子：支付订单数（COUNT 计行数，无度量字段）
// 主链与已支付金额同口径：同样排除测试单与作废单（R1 起补齐 is_void）
const paidOrdersAtomic = (id) => ({
  id,
  code: 'paid_orders',
  name: '支付订单数',
  kind: 'atomic',
  scope: {kind: 'public'},
  ownerId: 'user-owner',
  spec: {
    kind: 'atomic',
    name: '支付订单数',
    description: '支付成功的订单行数',
    businessDomain: '交易',
    businessProcess: '支付',
    aggregation: 'COUNT',
    source: {modelId: 'entity-trade-order'},
    factGrain: {description: '一笔订单一行', uniqueKeyFieldIds: ['field-order-id']},
    timeRole: '支付时间',
    timezone: 'Asia/Shanghai',
    baseQualifiers: [
      {dimensionId: 'dim-status', op: 'eq', value: 'PAID'},
      {dimensionId: 'dim-is-test', op: 'eq', value: false},
      {dimensionId: 'dim-is-void', op: 'eq', value: false},
    ],
    unit: 'ORDER',
    dimensions: [channelDim, regionDim],
  },
});

// 不一致样例原子：计数不排除作废订单（与金额原子基础限定不同 → 复合须 QUALIFIER_CONFLICT 拒绝）
const paidOrdersWithVoidAtomic = (id) => ({
  id,
  code: 'paid_orders_with_void',
  name: '支付订单数(含作废)',
  kind: 'atomic',
  scope: {kind: 'public'},
  ownerId: 'user-owner',
  spec: {
    kind: 'atomic',
    name: '支付订单数(含作废)',
    description: '支付成功的订单行数，不排除作废单',
    businessDomain: '交易',
    businessProcess: '支付',
    aggregation: 'COUNT',
    source: {modelId: 'entity-trade-order'},
    factGrain: {description: '一笔订单一行', uniqueKeyFieldIds: ['field-order-id']},
    timeRole: '支付时间',
    timezone: 'Asia/Shanghai',
    baseQualifiers: [
      {dimensionId: 'dim-status', op: 'eq', value: 'PAID'},
      {dimensionId: 'dim-is-test', op: 'eq', value: false},
    ],
    unit: 'ORDER',
    dimensions: [channelDim, regionDim],
  },
});

// 时间轴不一致样例原子：以下单时间为轴的金额（同窗口不同时间角色 → TIME_ROLE_CONFLICT）
const paidAmountOrderedAtAtomic = (id) => ({
  id,
  code: 'ordered_amount',
  name: '下单金额',
  kind: 'atomic',
  scope: {kind: 'public'},
  ownerId: 'user-owner',
  spec: {
    kind: 'atomic',
    name: '下单金额',
    description: '按下单时间轴统计的成交金额',
    businessDomain: '交易',
    businessProcess: '下单',
    aggregation: 'SUM',
    source: {modelId: 'entity-trade-order', fieldId: 'field-paid-amount'},
    factGrain: {description: '一笔订单一行', uniqueKeyFieldIds: ['field-order-id']},
    timeRole: '下单时间',
    timezone: 'Asia/Shanghai',
    baseQualifiers: [
      {dimensionId: 'dim-status', op: 'eq', value: 'PAID'},
      {dimensionId: 'dim-is-test', op: 'eq', value: false},
      {dimensionId: 'dim-is-void', op: 'eq', value: false},
    ],
    unit: 'CNY',
    dimensions: [channelDim, regionDim],
  },
});

const window7d = {type: 'calendarDays', length: 7, end: 'yesterday', timezone: 'Asia/Shanghai'};
const windowToday = {type: 'calendarDays', length: 1, end: 'today', timezone: 'Asia/Shanghai'};

// 公共派生：截至昨日 7 自然日已支付金额
const paidAmount7dDerived = (id, atomicRevisionId) => ({
  id,
  code: 'paid_amount_7d',
  name: '近7日已支付金额',
  kind: 'derived',
  scope: {kind: 'public'},
  ownerId: 'user-owner',
  spec: {
    kind: 'derived',
    name: '近7日已支付金额',
    description: '截至昨日 7 个自然日（上海时区）',
    atomicRevisionId,
    window: window7d,
    qualifiers: [],
    outputGrain: ['dim-channel', 'dim-region'],
  },
});

const paidOrders7dDerived = (id, atomicRevisionId) => ({
  id,
  code: 'paid_orders_7d',
  name: '近7日支付订单数',
  kind: 'derived',
  scope: {kind: 'public'},
  ownerId: 'user-owner',
  spec: {
    kind: 'derived',
    name: '近7日支付订单数',
    atomicRevisionId,
    window: window7d,
    qualifiers: [],
    outputGrain: ['dim-channel', 'dim-region'],
  },
});

// 部门派生（示例：运营 APP 渠道）
const opsPatch = () => ({addQualifiers: [{dimensionId: 'dim-channel', op: 'eq', value: 'APP'}]});

// 复合：客单价 SAFE_DIVIDE(金额, 订单数)，零分母 NULL
const aovCompound = (id, amountKey, ordersKey, amountRev, ordersRev) => ({
  id,
  code: 'app_aov_7d',
  name: '近7日客单价',
  kind: 'compound',
  scope: {kind: 'public'},
  ownerId: 'user-owner',
  spec: {
    kind: 'compound',
    name: '近7日客单价',
    description: 'SAFE_DIVIDE(金额, 订单数)；零分母 NULL',
    expression: `SAFE_DIVIDE({{${amountKey}}}, {{${ordersKey}}})`,
    refs: [
      {key: amountKey, revisionId: amountRev},
      {key: ordersKey, revisionId: ordersRev},
    ],
  },
});

module.exports = {
  orderEntity,
  baseProject,
  window7d,
  windowToday,
  paidAmountAtomic,
  paidOrdersAtomic,
  paidOrdersWithVoidAtomic,
  paidAmountOrderedAtAtomic,
  paidAmount7dDerived,
  paidOrders7dDerived,
  opsPatch,
  aovCompound,
};
