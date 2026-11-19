// 指标平台 M1：依赖派生与循环检查。
// 依赖由 spec/AST 派生（derived.atomicRevisionId、compound.refs），不双写存储；
// 血缘投影按查询即时生成。模型绑定（计算来源/物化输出）属 M4，本层只留类型合同。
// 注：构建链不识别 ??，使用 == null 三元。

import {metricError} from './errors';
import {astContainsDivision, astRefKeys, parseExpression} from './ast';

// 单个 spec 的上游引用（固定 revision ID + 角色与定位路径）
export const specReferences = (spec) => {
  if (spec == null) return [];
  if (spec.kind === 'derived') {
    return spec.atomicRevisionId == null ? []
      : [{revisionId: spec.atomicRevisionId, role: 'ATOMIC_BASE', path: 'spec.atomicRevisionId'}];
  }
  if (spec.kind === 'compound') {
    return (spec.refs == null ? [] : spec.refs).map((ref, index) => ({
      revisionId: ref.revisionId,
      role: 'OPERAND',
      path: `spec.refs[${index}]`,
      key: ref.key,
    }));
  }
  return [];
};

const revisionSpec = (data, revisionId) => {
  const revision = (data.revisions || []).filter(item => item.id === revisionId)[0];
  return revision == null ? null : revision;
};

// 从起点出发沿上游遍历找环。环按“定义级”判定（SPEC M14：复合指标互相引用）：
// 发布依赖必须已发布且发布版不可变，revision 级环不可能出现，互相引用必然表现为
// 同一定义经由其他定义回到自身（版本链回环），在此检出并报告路径。
// candidateSpec/startDefinitionId 允许传入候选草案参与检查（发布前校验用）。
// 返回 null 或 {cycleRevisionIds:[...]}（路径含起点重复项）
export const findDependencyCycle = (data, startRevisionId, candidateSpec, startDefinitionId) => {
  const recordOf = (revisionId) => {
    if (revisionId === startRevisionId && candidateSpec != null) {
      return {definitionId: startDefinitionId};
    }
    return revisionSpec(data, revisionId);
  };
  const visiting = [];
  const visited = {};
  const walk = (revisionId) => {
    const record = recordOf(revisionId);
    const definitionId = record == null ? null : record.definitionId;
    if (definitionId != null) {
      const index = visiting.map(item => item.definitionId).indexOf(definitionId);
      if (index >= 0) {
        return {
          cycleRevisionIds: visiting.slice(index).map(item => item.revisionId).concat([revisionId]),
        };
      }
    }
    if (visited[revisionId]) return null;
    visited[revisionId] = true;
    const spec = (revisionId === startRevisionId && candidateSpec != null)
      ? candidateSpec : (record == null ? null : record.spec);
    if (spec == null) return null;
    visiting.push({revisionId, definitionId});
    const refs = specReferences(spec);
    for (let i = 0; i < refs.length; i += 1) {
      const cycle = walk(refs[i].revisionId);
      if (cycle != null) return cycle;
    }
    visiting.pop();
    return null;
  };
  const cycle = walk(startRevisionId);
  return cycle == null ? null : cycle;
};

// 依赖列表（含端点有效性信息，供血缘/影响查询）
export const metricDependencies = (data, revisionId) => {
  const revision = revisionSpec(data, revisionId);
  if (revision == null) return null;
  return specReferences(revision.spec).map((reference) => {
    const target = revisionSpec(data, reference.revisionId);
    return {
      ...reference,
      upstreamRevisionId: reference.revisionId,
      exists: target != null,
      upstreamStatus: target == null ? null : target.status,
    };
  });
};

export const dependencyCycleError = (cycleRevisionIds) =>
  metricError('CYCLE_DEPENDENCY', 'spec', 'metric.error.cycleDependency',
    `metric dependency cycle: ${cycleRevisionIds.join(' -> ')}`, {path: cycleRevisionIds});

// 原子可再聚合性：SUM/COUNT 可加；AVG/COUNT_DISTINCT/MIN/MAX 输出不可直接再 SUM
export const atomicReAggregable = (spec) =>
  spec != null && (spec.aggregation === 'SUM' || spec.aggregation === 'COUNT');

// 派生：继承原子；复合：任一 operand 不可加或表达式含除法（ratio）→ 不可再聚合
export const compoundReAggregable = (spec, operandReAggregableOf) => {
  let ast;
  try {
    ast = parseExpression(spec.expression, 'spec.expression');
  } catch (error) {
    return {reAggregable: false, reason: 'EXPRESSION_INVALID'};
  }
  const keys = astRefKeys(ast);
  if (keys.some(key => operandReAggregableOf(key) === false)) {
    return {reAggregable: false, reason: 'OPERAND_NOT_REAGGREGABLE'};
  }
  if (astContainsDivision(ast)) {
    return {reAggregable: false, reason: 'RATIO_NOT_SUMMABLE'};
  }
  return {reAggregable: true};
};
