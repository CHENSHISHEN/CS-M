// 指标存储审计（MET-03 / MET-22）：只读、纯函数、确定性顺序，从不修复或改写存储。
// auditMetricStore(source) → {ok, issues: [{code, path}]}，ok = issues 为空。
// issue 码：
// - HASH_MISMATCH：非草案修订 hash 与自身 {spec, resolvedSpec} 不符（verifyRevisionHash）；
//   合法的旧格式 h<8hex> 不报任何 issue；
// - DUPLICATE_VERSION：同一定义下多个修订共用一个版本号（只报后出现者；历史 MET-05 缺陷
//   可能留下两个 "1.0"，此处只报告不修复）；
// - DANGLING_REFERENCE：引用指向不存在的对象。覆盖：修订 definitionId → 定义；
//   修订 baseRevisionId / upgradedFromRevisionId / baseline.baseRevisionId /
//   spec.atomicRevisionId（派生）/ spec.refs[i].revisionId（复合）→ 修订；
//   baseline.definitionId → 定义；绑定 metricRevisionId → 修订、metricDefinitionId → 定义。
// path 格式：`<集合>[<对象 id>].<字段路径>`，例如 revisions[mrev-1].hash、
//   revisions[mrev-1].spec.refs[0].revisionId、bindings[bind-1].metricRevisionId；
//   对象缺 id 时以 `#<数组下标>` 代替 id（如 revisions[#3].hash）。
// 顺序：先按存储顺序逐个修订（hash → version → 各引用字段按上列顺序），再逐个绑定。
// 注：构建链不识别 ??，使用 == null 三元。

import {verifyRevisionHash} from './hash';
import {readMetricPlatform} from './store';

const keyOf = (item, index) => (item != null && item.id != null ? String(item.id) : `#${index}`);

export const auditMetricStore = (source) => {
  const data = readMetricPlatform(source);
  const revisions = Array.isArray(data.revisions) ? data.revisions : [];
  const definitions = Array.isArray(data.definitions) ? data.definitions : [];
  const bindings = Array.isArray(data.bindings) ? data.bindings : [];
  const definitionIds = new Set();
  definitions.forEach((item) => { if (item != null && item.id != null) definitionIds.add(item.id); });
  const revisionIds = new Set();
  revisions.forEach((item) => { if (item != null && item.id != null) revisionIds.add(item.id); });
  const hasDefinition = id => definitionIds.has(id);
  const hasRevision = id => revisionIds.has(id);

  const issues = [];
  const push = (code, path) => issues.push({code, path});
  const seenVersions = new Map(); // definitionId → Set(version)

  revisions.forEach((revision, index) => {
    if (revision == null) return;
    const base = `revisions[${keyOf(revision, index)}]`;
    if (!verifyRevisionHash(revision).ok) push('HASH_MISMATCH', `${base}.hash`);

    if (revision.version != null && revision.version !== '') {
      if (!seenVersions.has(revision.definitionId)) seenVersions.set(revision.definitionId, new Set());
      const versions = seenVersions.get(revision.definitionId);
      const versionKey = String(revision.version);
      if (versions.has(versionKey)) {
        push('DUPLICATE_VERSION', `${base}.version`);
      } else {
        versions.add(versionKey);
      }
    }

    const checkRevisionRef = (id, path) => {
      if (id != null && !hasRevision(id)) push('DANGLING_REFERENCE', `${base}.${path}`);
    };
    const checkDefinitionRef = (id, path) => {
      if (id != null && !hasDefinition(id)) push('DANGLING_REFERENCE', `${base}.${path}`);
    };
    if (revision.definitionId == null || !hasDefinition(revision.definitionId)) {
      push('DANGLING_REFERENCE', `${base}.definitionId`);
    }
    checkRevisionRef(revision.baseRevisionId, 'baseRevisionId');
    checkRevisionRef(revision.upgradedFromRevisionId, 'upgradedFromRevisionId');
    if (revision.baseline != null) {
      checkDefinitionRef(revision.baseline.definitionId, 'baseline.definitionId');
      checkRevisionRef(revision.baseline.baseRevisionId, 'baseline.baseRevisionId');
    }
    const spec = revision.spec;
    if (spec != null && spec.kind === 'derived') {
      checkRevisionRef(spec.atomicRevisionId, 'spec.atomicRevisionId');
    }
    if (spec != null && spec.kind === 'compound' && Array.isArray(spec.refs)) {
      spec.refs.forEach((ref, refIndex) => {
        if (ref != null) checkRevisionRef(ref.revisionId, `spec.refs[${refIndex}].revisionId`);
      });
    }
  });

  bindings.forEach((binding, index) => {
    if (binding == null) return;
    const base = `bindings[${keyOf(binding, index)}]`;
    if (binding.metricRevisionId != null && !hasRevision(binding.metricRevisionId)) {
      push('DANGLING_REFERENCE', `${base}.metricRevisionId`);
    }
    if (binding.metricDefinitionId != null && !hasDefinition(binding.metricDefinitionId)) {
      push('DANGLING_REFERENCE', `${base}.metricDefinitionId`);
    }
  });

  return {ok: issues.length === 0, issues};
};
