/**
 * 业务建模核心数据模型与校验体系 (BIZ-01~09 / DEC-03 / DEC-04)
 *
 * 规范结构：
 * - roles: 角色列表 [{ id, name, description }]
 * - businessObjects: 业务对象列表 [{ id, name, businessKey, definition, properties: [{ id, name, type, memo }], states: string[] }]
 * - rules: 业务规则列表 [{ id, name, description, conditionText, resultText, enabled, scopeRefs: [{ type, id }] }]
 * - processes: 业务流程列表 [{ id, name, description, goal, trigger, ownerRoleId, lanes: [{ id, roleId, name, height }], elements: [{ id, type, name, laneId, inputObjectIds, outputObjectIds }], flows: [{ id, source, target, condition, isDefault }], presentation: { cells: [] } }]
 */

export const PROPERTY_TYPES = [
  { key: 'text', label: '文本' },
  { key: 'number', label: '数值' },
  { key: 'date', label: '日期时间' },
  { key: 'boolean', label: '布尔值' },
  { key: 'enum', label: '枚举' },
];

export const ELEMENT_TYPES = {
  START: 'start',
  END: 'end',
  ACTIVITY: 'activity',
  DECISION: 'decision',
};

/**
 * 创建默认内置业务模型数据包（以标准采购订单全链路为例）
 */
export const createDefaultBusinessModel = () => {
  const roleBuyer = { id: 'role-buyer', name: '采购专员', description: '负责日常物料请购、录单与初步审核' };
  const roleManager = { id: 'role-manager', name: '部门主管', description: '负责大额资金支出与合规性审查' };
  const roleWarehouse = { id: 'role-wh', name: '仓库管理员', description: '负责物料入库检验与系统核销' };

  const boPurchaseOrder = {
    id: 'bo-po-01',
    name: '采购订单',
    businessKey: 'PURCHASE_ORDER',
    definition: '企业日常采购活动中向供应商发出的正式订货凭证，包含物资、价格与交付约定。',
    properties: [
      { id: 'prop-po-no', name: '采购单号', type: 'text', memo: 'PO开头业务唯一编号' },
      { id: 'prop-po-amount', name: '采购总额', type: 'number', memo: '含税总金额（元）' },
      { id: 'prop-po-supplier', name: '供应商名称', type: 'text', memo: '合格供应商全称' },
      { id: 'prop-po-date', name: '申请日期', type: 'date', memo: '提交申请业务时间' },
      { id: 'prop-po-urgent', name: '是否紧急', type: 'boolean', memo: '加急处理标记' },
    ],
    states: ['草稿', '待部门审批', '待入库', '已完成', '已作废'],
  };

  const boGoodsReceipt = {
    id: 'bo-gr-01',
    name: '入库验收单',
    businessKey: 'GOODS_RECEIPT',
    definition: '仓储部门核实物资到货规格、实收数量与合格状态的清点单据。',
    properties: [
      { id: 'prop-gr-no', name: '验收单号', type: 'text', memo: 'GR开头唯一单号' },
      { id: 'prop-gr-qty', name: '实收数量', type: 'number', memo: '物理清点合格件数' },
      { id: 'prop-gr-inspector', name: '检验人', type: 'text', memo: '仓库质检签字' },
    ],
    states: ['待检', '部分入库', '全额入库', '退货拒收'],
  };

  const ruleLimitApprove = {
    id: 'rule-amount-limit',
    name: '大额采购审批规则',
    description: '采购单总额超过 5 万元的，必须经过部门主管会签审批。',
    conditionText: '采购订单.采购总额 > 50000',
    resultText: '任务自动路由至部门主管审批泳道，阻断直接下单',
    enabled: true,
    scopeRefs: [
      { type: 'businessObject', id: 'bo-po-01' },
      { type: 'activity', id: 'act-manager-audit' },
    ],
  };

  const ruleQualityCheck = {
    id: 'rule-quality-pass',
    name: '入库合格检验规则',
    description: '所有入库物资必须附带合格证书且实收数量不小于采购总数。',
    conditionText: '入库验收单.实收数量 >= 采购订单.采购数量 && 检验合格 == true',
    resultText: '生成入库记录并更新采购订单状态为「已完成」',
    enabled: true,
    scopeRefs: [
      { type: 'businessObject', id: 'bo-gr-01' },
      { type: 'activity', id: 'act-inspect-stock' },
    ],
  };

  const sampleProcess = {
    id: 'proc-order-fulfillment',
    name: '物资采购与入库全流程',
    description: '从采购申请、主管审核到仓储验收的标准业务闭环流程',
    goal: '防范超额资金风险，保障入库物资质量与账实相符',
    trigger: '采购专员在系统中创建并提交新采购订单',
    ownerRoleId: roleBuyer.id,
    lanes: [
      { id: 'lane-buyer', roleId: roleBuyer.id, name: '采购专员', height: 180 },
      { id: 'lane-manager', roleId: roleManager.id, name: '部门主管', height: 180 },
      { id: 'lane-wh', roleId: roleWarehouse.id, name: '仓库管理员', height: 180 },
    ],
    elements: [
      { id: 'node-start', type: ELEMENT_TYPES.START, name: '提交采购单', laneId: 'lane-buyer' },
      {
        id: 'act-create-order',
        type: ELEMENT_TYPES.ACTIVITY,
        name: '录入订单明细',
        laneId: 'lane-buyer',
        inputObjectIds: [],
        outputObjectIds: ['bo-po-01'],
      },
      { id: 'dec-amount-check', type: ELEMENT_TYPES.DECISION, name: '金额是否>5万?', laneId: 'lane-buyer' },
      {
        id: 'act-manager-audit',
        type: ELEMENT_TYPES.ACTIVITY,
        name: '部门主管审批',
        laneId: 'lane-manager',
        inputObjectIds: ['bo-po-01'],
        outputObjectIds: ['bo-po-01'],
      },
      {
        id: 'act-inspect-stock',
        type: ELEMENT_TYPES.ACTIVITY,
        name: '验收入库与核销',
        laneId: 'lane-wh',
        inputObjectIds: ['bo-po-01'],
        outputObjectIds: ['bo-gr-01'],
      },
      { id: 'node-end', type: ELEMENT_TYPES.END, name: '流程结束', laneId: 'lane-wh' },
    ],
    flows: [
      { id: 'flow-1', source: 'node-start', target: 'act-create-order', condition: '' },
      { id: 'flow-2', source: 'act-create-order', target: 'dec-amount-check', condition: '' },
      { id: 'flow-3', source: 'dec-amount-check', target: 'act-manager-audit', condition: '是 (>5万)', isDefault: false },
      { id: 'flow-4', source: 'dec-amount-check', target: 'act-inspect-stock', condition: '否 (常规小额)', isDefault: true },
      { id: 'flow-5', source: 'act-manager-audit', target: 'act-inspect-stock', condition: '审批同意' },
      { id: 'flow-6', source: 'act-inspect-stock', target: 'node-end', condition: '验收合格' },
    ],
    presentation: {
      cells: [],
    },
  };

  return {
    roles: [roleBuyer, roleManager, roleWarehouse],
    businessObjects: [boPurchaseOrder, boGoodsReceipt],
    rules: [ruleLimitApprove, ruleQualityCheck],
    processes: [sampleProcess],
  };
};

/**
 * 流程语义检查器 (BIZ-04)
 * 检查缺开始/结束、孤立/不可达活动、判断缺分支条件或多个默认分支、缺职责等语义问题
 */
export const checkProcessSemantics = (process) => {
  const issues = [];
  if (!process) return issues;

  const elements = process.elements || [];
  const flows = process.flows || [];
  const lanes = process.lanes || [];

  // 1. 检查开始节点
  const startNodes = elements.filter(e => e.type === ELEMENT_TYPES.START);
  if (startNodes.length === 0) {
    issues.push({
      level: 'error',
      code: 'MISSING_START',
      message: '流程缺少「开始」节点',
      elementId: null,
    });
  } else if (startNodes.length > 1) {
    issues.push({
      level: 'warn',
      code: 'MULTIPLE_START',
      message: '流程存在多个「开始」节点',
      elementId: startNodes[1].id,
    });
  }

  // 2. 检查结束节点
  const endNodes = elements.filter(e => e.type === ELEMENT_TYPES.END);
  if (endNodes.length === 0) {
    issues.push({
      level: 'error',
      code: 'MISSING_END',
      message: '流程缺少「结束」节点',
      elementId: null,
    });
  }

  // 3. 检查孤立与不可达节点
  const connectedNodeIds = new Set();
  flows.forEach((flow) => {
    if (flow.source) connectedNodeIds.add(flow.source);
    if (flow.target) connectedNodeIds.add(flow.target);
  });

  elements.forEach((el) => {
    if (!connectedNodeIds.has(el.id)) {
      issues.push({
        level: 'warn',
        code: el.type === ELEMENT_TYPES.ACTIVITY ? 'ISOLATED_ACTIVITY' : 'ISOLATED_NODE',
        message: `${el.type === ELEMENT_TYPES.ACTIVITY ? '活动' : '节点'}「${el.name || el.id}」孤立，未与任何连线相交`,
        elementId: el.id,
      });
    }

    // 检查活动职责归属
    if (el.type === ELEMENT_TYPES.ACTIVITY) {
      if (!el.laneId || !lanes.some(l => l.id === el.laneId)) {
        issues.push({
          level: 'warn',
          code: 'MISSING_ROLE',
          message: `活动「${el.name}」未归属职责泳道`,
          elementId: el.id,
        });
      }
    }

    // 检查判断分支条件
    if (el.type === ELEMENT_TYPES.DECISION) {
      const outgoingFlows = flows.filter(f => f.source === el.id);
      if (outgoingFlows.length < 2) {
        issues.push({
          level: 'warn',
          code: 'DECISION_BRANCH_COUNT',
          message: `判断节点「${el.name}」分支数量少于 2 个`,
          elementId: el.id,
        });
      }
      const defaultFlows = outgoingFlows.filter(f => f.isDefault);
      if (defaultFlows.length > 1) {
        issues.push({
          level: 'error',
          code: 'MULTIPLE_DEFAULT_BRANCHES',
          message: `判断节点「${el.name}」标记了多个默认分支`,
          elementId: el.id,
        });
      }
      const missingConditionFlows = outgoingFlows.filter(f => !f.isDefault && (!f.condition || !f.condition.trim()));
      if (outgoingFlows.length >= 2 && missingConditionFlows.length > 0) {
        issues.push({
          level: 'warn',
          code: 'DECISION_MISSING_CONDITION',
          message: `判断节点「${el.name}」存在未配置判定条件的分支`,
          elementId: el.id,
        });
      }
    }
  });

  return issues;
};

/**
 * 业务规则完整性检查器 (BIZ-09)
 * 检查必填项、启用状态与适用范围有效性
 */
export const checkRuleIntegrity = (rule, allBusinessObjects = [], allProcesses = []) => {
  const issues = [];
  if (!rule) return issues;

  if (!rule.name || !rule.name.trim()) {
    issues.push({ level: 'error', code: 'EMPTY_NAME', message: '规则名称不能为空' });
  }

  if (!rule.conditionText || !rule.conditionText.trim()) {
    issues.push({ level: 'warn', code: 'EMPTY_CONDITION', message: '条件描述未填写，规则将缺乏触发判定依据' });
  }

  if (!rule.resultText || !rule.resultText.trim()) {
    issues.push({ level: 'warn', code: 'EMPTY_RESULT', message: '结论描述未填写，规则缺乏明确业务动作' });
  }

  if (rule.enabled) {
    const scopeRefs = rule.scopeRefs || [];
    if (scopeRefs.length === 0) {
      issues.push({ level: 'warn', code: 'EMPTY_SCOPE', message: '规则已启用但未指定任何适用业务对象或流程活动' });
    } else {
      // 检查失效引用
      const boIds = new Set(allBusinessObjects.map(b => b.id));
      const activityIds = new Set(
        allProcesses.flatMap(p => (p.elements || []).filter(e => e.type === ELEMENT_TYPES.ACTIVITY).map(e => e.id))
      );

      scopeRefs.forEach((ref) => {
        if (ref.type === 'businessObject' && !boIds.has(ref.id)) {
          issues.push({ level: 'error', code: 'SCOPE_NOT_FOUND', message: `适用范围引用的业务对象已不存在 (ID: ${ref.id})` });
        }
        if (ref.type === 'activity' && !activityIds.has(ref.id)) {
          issues.push({ level: 'error', code: 'SCOPE_NOT_FOUND', message: `适用范围引用的流程活动已不存在 (ID: ${ref.id})` });
        }
      });
    }
  }

  return issues;
};
