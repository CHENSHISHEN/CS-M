// 指标平台 M5B-R1：真实删除前指标影响提醒（只读窄接缝辅助）。
// - summarizeMetricDeleteImpact：对若干模型端点（对象或精确字段）复用 getLineageImpact
//   只读查询，直接/传递均按 revisionId 全局去重（直接命中优先，批量对象合并去重）；
// - MetricDeleteImpactBody：Modal message 窄组件（名称+编码+版本展示，ModelCatalog 等
//   JSX 消息调用处使用）；metricDeleteImpactLines：纯文本行（contextMenuUtil 拼接用）；
// - makeFieldsDeleteCheck：共享字段表删除接缝工厂——有影响先确认再执行原删除回调，
//   无指标元数据/无影响直接放行（不增加阻扰），取消零变更；
// - 有指标影响或将有绑定失效时先确认；确认后执行原删除，并以一次 updateSource 落
//   applyDeleteImpact（命中绑定 → unresolved，MET-12）；不改动固定指标版本，无命中不写。
// 约定：与 src/lib/metrics 一致，不使用 ?? / ?.。
import React from 'react';
import {FormatMessage, Modal} from 'components';
import {metricApi} from './commands';

const entryLabel = (entry) => {
  const name = entry.name == null || entry.name === '' ? entry.revisionId : entry.name;
  const code = entry.code == null || entry.code === '' ? '-' : entry.code;
  return `${name}（${code}）v${entry.version == null ? '?' : entry.version}`;
};

export const summarizeMetricDeleteImpact = (source, endpoints) => {
  const directById = {};
  const transitiveById = {};
  const direct = [];
  const transitive = [];
  let queried = false;
  (endpoints || []).forEach((endpoint) => {
    if (!endpoint || !endpoint.collection || !endpoint.objectId) return;
    queried = true;
    const impact = metricApi.getLineageImpact(source, {
      collection: endpoint.collection,
      objectId: endpoint.objectId,
      ...(endpoint.fieldId == null ? {} : {fieldId: endpoint.fieldId}),
    });
    if (!impact || !impact.ok) return;
    (impact.direct.metrics || []).forEach((entry) => {
      if (directById[entry.revisionId]) return;
      directById[entry.revisionId] = true;
      direct.push(entry);
    });
    (impact.transitive.metrics || []).forEach((entry) => {
      if (directById[entry.revisionId] || transitiveById[entry.revisionId]) return;
      transitiveById[entry.revisionId] = true;
      transitive.push(entry);
    });
  });
  // 批量顺序边界：端点 A 先把 X 计入传递、端点 B 随后把 X 列为直接时，
  // 以最终直接集合为准统一剔除传递段（不能只靠入栈时判断导致两段重复）
  const finalTransitive = transitive.filter(entry => !directById[entry.revisionId]);
  return {queried, direct, transitive: finalTransitive,
    count: direct.length + finalTransitive.length};
};

// 纯文本影响行（供非 JSX 的确认消息拼接）：直接/传递两段，每段 名称（编码）v版本
export const metricDeleteImpactLines = (summary) => {
  if (!summary || summary.count === 0) return [];
  const lines = [];
  if (summary.direct.length > 0) {
    lines.push(`${FormatMessage.string({id: 'metrics.lineage.impact.direct'})}：${summary.direct.map(entryLabel).join('、')}`);
  }
  if (summary.transitive.length > 0) {
    lines.push(`${FormatMessage.string({id: 'metrics.lineage.impact.transitive'})}：${summary.transitive.map(entryLabel).join('、')}`);
  }
  return lines;
};

// Modal message 窄组件：直接/传递分段 + 去重口径与失效语义说明
export const MetricDeleteImpactBody = ({summary}) => {
  if (!summary || summary.count === 0) return null;
  return <div className='chiner-metrics-delete-impact' data-testid='metrics-delete-impact'>
    <p className='chiner-metrics-delete-impact-title'
      data-testid='metrics-delete-impact-title'>
      <FormatMessage id='metrics.deleteImpact.title' data={{count: summary.count}}/>
    </p>
    {summary.direct.length > 0 ? <p
      className='chiner-metrics-delete-impact-seg'
      data-testid='metrics-delete-impact-direct'>
      <span>{FormatMessage.string({id: 'metrics.lineage.impact.direct'})}</span>
      {summary.direct.map(entryLabel).join('、')}
    </p> : null}
    {summary.transitive.length > 0 ? <p
      className='chiner-metrics-delete-impact-seg'
      data-testid='metrics-delete-impact-transitive'>
      <span>{FormatMessage.string({id: 'metrics.lineage.impact.transitive'})}</span>
      {summary.transitive.map(entryLabel).join('、')}
    </p> : null}
    <p className='chiner-metrics-delete-impact-note'>
      <FormatMessage id='metrics.deleteImpact.note'/>
    </p>
  </div>;
};

// 字段删除检查工厂（共享字段表最小接缝）：
// 返回 check(deletedFields, proceed)——有指标影响或将有绑定失效时弹确认并接管（返回 true），
// 确认后才执行 proceed（原删除逻辑原样）；取消零变更；两者皆无返回 false 由调用方直接删除。
// updateSource 给出时先预演 applyDeleteImpact 计算将失效的绑定数（概念级语义绑定不进
// 影响摘要，也要先提示）；确认后基于最新 source 重新计算，有变化才调用一次 updateSource。
export const makeFieldsDeleteCheck = (getSource, collection, objectId, updateSource) => {
  if (collection == null || objectId == null || objectId === '') return null;
  const latest = () => (typeof getSource === 'function' ? getSource() : getSource);
  return (deletedFields, proceed) => {
    const endpoints = (deletedFields || [])
      .filter(f => f != null && f.id != null && f.id !== '')
      .map(f => ({collection, objectId, fieldId: f.id}));
    if (endpoints.length === 0) return false;
    const canWrite = typeof updateSource === 'function';
    const impactOf = source => metricApi.applyDeleteImpact(source,
      {collection, objectId, fieldIds: endpoints.map(e => e.fieldId)});
    const current = latest();
    const summary = summarizeMetricDeleteImpact(current, endpoints);
    const preview = canWrite ? impactOf(current) : current;
    const invalidated = preview === current ? 0
      : metricApi.countActiveMetricBindings(current) - metricApi.countActiveMetricBindings(preview);
    if (summary.count === 0 && preview === current) return false;
    const commit = () => {
      proceed && proceed();
      if (!canWrite) return;
      const base = latest();
      const next = impactOf(base);
      if (next !== base) updateSource(next);
    };
    Modal.confirm({
      title: FormatMessage.string({id: 'metrics.deleteImpact.confirmTitle'}),
      message: <div>
        <MetricDeleteImpactBody summary={summary}/>
        {invalidated > 0 ? <p
          className='chiner-metrics-delete-impact-note'
          data-testid='metrics-delete-impact-bindings'>
          <FormatMessage id='metrics.deleteImpact.bindingsInvalidated' data={{count: invalidated}}/>
        </p> : null}
      </div>,
      onOk: commit,
    });
    return true;
  };
};
