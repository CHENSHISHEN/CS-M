import React, {useMemo, useState} from 'react';
import {FormatMessage, Message, Modal} from 'components';
import {metricApi, runMetricCommand} from './commands';
import {renderErrorList, renderKindBadge, renderScopeBadge, renderStatusBadge} from './parts';
import {shortHashLabel} from '../../lib/metrics/hash';

// 指标平台 M3B：版本与变更页（替换 PendingPage）。
// - 全部定义的真实版本记录（草案/已发布/已废弃），来源标注（新定义/修订/部门基线/升级/分叉）；
// - 已发布历史 hash 只读展示（发布时固化，不可变）；
// - 从版本修订 = createRevisionDraft（新草案，不改动旧版本）；已废弃版本也可修订（决策 D2：
//   修订发布后定义级废弃自动解除）；废弃为定义级，确认时列出该定义全部版本的下游引用
//   （listDefinitionDependents，含部门基线/复合操作数/派生原子基）；
// - 本页不渲染假数据、不做服务端审批；本地确认发布不等于审核通过。

const STATUS_FILTERS = ['all', 'draft', 'published', 'deprecated'];

// 审计 issue 码（auditMetricStore）；未知码回落到 other 文案
const AUDIT_CODES = ['HASH_MISMATCH', 'LEGACY_HASH', 'DUPLICATE_VERSION', 'DANGLING_REFERENCE',
  'STORE_CORRUPT'];

// M5B 引用角色业务化：英文枚举 → 中文角色（原始码留 title 次级信息）
const ROLE_LABEL_KEYS = {
  ATOMIC_BASE: 'metrics.lineage.role.atomicBase',
  OPERAND: 'metrics.lineage.role.operand',
  BASELINE: 'metrics.lineage.role.baseline',
};

const VersionsPage = ({source, commandRunner, readOnly, onOpenDefinition}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [commandErrors, setCommandErrors] = useState([]);
  const [refsFor, setRefsFor] = useState(null); // {revisionId, code, version}
  const [auditReport, setAuditReport] = useState(null); // {ok, issues} | null（未检查）

  const definitionById = useMemo(() => {
    const map = {};
    (metricApi.readMetricPlatform(source).definitions || []).forEach((definition) => {
      map[definition.id] = definition;
    });
    return map;
  }, [source]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (metricApi.readMetricPlatform(source).revisions || [])
      .map((revision, index) => ({
        revision,
        order: index,
        definition: definitionById[revision.definitionId]
          || {id: revision.definitionId, code: revision.definitionId,
            name: revision.definitionId, kind: '—', scope: null},
      }))
      .filter(row => statusFilter === 'all' || row.revision.status === statusFilter)
      .filter(row => needle === ''
        || row.definition.code.toLowerCase().indexOf(needle) >= 0
        || row.definition.name.toLowerCase().indexOf(needle) >= 0)
      .reverse();
  }, [source, definitionById, search, statusFilter]);

  const runVersion = (run, afterOk) => {
    setCommandErrors([]);
    const result = runMetricCommand(commandRunner, run);
    if (result && result.ok) {
      afterOk && afterOk(result);
    } else {
      setCommandErrors((result && result.errors) || []);
    }
    return result;
  };

  const reviseFrom = (row) => {
    Modal.confirm({
      title: FormatMessage.string({id: 'metrics.versions.revise'}),
      message: FormatMessage.string({id: row.revision.status === 'deprecated'
        ? 'metrics.versions.reviseDeprecatedConfirm' : 'metrics.versions.reviseConfirm'}),
      onOk: () => {
        runVersion(latest => metricApi.createRevisionDraft(latest,
          row.definition.id, {baseRevisionId: row.revision.id}), (result) => {
          Message.success({title: FormatMessage.string({id: 'metrics.versions.revised'})});
          onOpenDefinition && onOpenDefinition(row.definition.id);
        });
      },
    });
  };

  // 废弃是定义级：确认框汇总该定义全部版本的下游引用并逐条列出（而非只看当前行版本）
  const deprecate = (row) => {
    const dependents = metricApi.listDefinitionDependents(source, row.definition.id);
    const draftLabel = FormatMessage.string({id: 'metrics.status.draft'});
    Modal.confirm({
      title: FormatMessage.string({id: 'metrics.versions.deprecateTitle'}),
      message: <div data-testid='metrics-version-deprecate-confirm'>
        <p>{FormatMessage.string({id: 'metrics.versions.deprecateMessage',
          data: {count: dependents.length}})}</p>
        {dependents.length > 0 && <ul className='chiner-metrics-deplist'>
          {dependents.map(dep => <li key={dep.revisionId}>
            {FormatMessage.string({
              id: 'metrics.versions.deprecateDependent',
              data: {
                name: dep.definitionName,
                code: dep.definitionCode,
                version: dep.version ? `v${dep.version}` : draftLabel,
                targets: dep.targetVersions.map(v => (v ? `v${v}` : draftLabel)).join(', '),
              },
            })}
          </li>)}
        </ul>}
      </div>,
      onOk: () => {
        runVersion(latest => metricApi.deprecateMetricDefinition(latest, row.definition.id));
      },
    });
  };

  // 完整性检查：只读，损坏存储不抛错（auditMetricStore 以 STORE_CORRUPT 诊断返回）
  const runAudit = () => {
    try {
      setAuditReport(metricApi.auditMetricStore(source));
    } catch (error) {
      setAuditReport({ok: false,
        issues: [{code: 'STORE_CORRUPT', path: String(error && error.message ? error.message : error)}]});
    }
  };

  const refsList = refsFor == null ? []
    : metricApi.listRevisionDependents(source, refsFor.revisionId);

  const sourceLabel = (revision) => {
    if (revision.upgradedFromRevisionId != null) {
      const from = metricApi.getMetricRevision(source, revision.upgradedFromRevisionId);
      return FormatMessage.string({id: 'metrics.versions.sourceUpgrade'},
        {version: from && from.version ? `v${from.version}` : '—'});
    }
    if (revision.baseline != null) {
      const base = metricApi.getMetricRevision(source, revision.baseline.baseRevisionId);
      return FormatMessage.string({id: 'metrics.versions.sourceBaseline'},
        {version: base && base.version ? `v${base.version}` : '—'});
    }
    if (revision.baseRevisionId != null) {
      const base = metricApi.getMetricRevision(source, revision.baseRevisionId);
      return FormatMessage.string({id: 'metrics.versions.sourceRevise'},
        {version: base && base.version ? `v${base.version}` : '—'});
    }
    if (revision.fork === true || revision.forkNote != null) {
      return FormatMessage.string({id: 'metrics.versions.sourceFork'});
    }
    return FormatMessage.string({id: revision.version == null
      ? 'metrics.versions.sourceDraft' : 'metrics.versions.sourceNew'});
  };

  return <section className='chiner-metrics-page' data-testid='metrics-versions-page'>
    <header className='chiner-metrics-page-header'>
      <div>
        <h2 data-testid='metrics-versions-title'>
          <FormatMessage id='metrics.versions.title'/>
        </h2>
        <p className='chiner-metrics-page-sub'><FormatMessage id='metrics.versions.subtitle'/></p>
      </div>
      <button
        type='button'
        className='chiner-metrics-btn'
        data-testid='metrics-versions-audit'
        onClick={runAudit}
      >
        <FormatMessage id='metrics.versions.audit.button'/>
      </button>
    </header>

    {auditReport != null && <div className='chiner-metrics-side-card' data-testid='metrics-versions-audit-result'>
      <h3><FormatMessage id='metrics.versions.audit.title'/></h3>
      {auditReport.issues.length === 0 ? <p className='chiner-metrics-muted'
        data-testid='metrics-versions-audit-clean'>
        <FormatMessage id='metrics.versions.audit.clean'/>
      </p> : <>
        <p><FormatMessage id='metrics.versions.audit.count' data={{count: auditReport.issues.length}}/></p>
        <ul className='chiner-metrics-deplist'>
          {auditReport.issues.map((issue, index) => <li
            key={`${issue.code}-${issue.path}-${index}`}
            data-testid='metrics-versions-audit-issue'
            data-code={issue.code}>
            <span className='chiner-metrics-tag chiner-metrics-tag-warn'>{issue.code}</span>
            <span>
              <FormatMessage id={AUDIT_CODES.indexOf(issue.code) >= 0
                ? `metrics.versions.audit.code.${issue.code}` : 'metrics.versions.audit.code.other'}/>
            </span>
            <code className='chiner-metrics-mono'>{issue.path}</code>
          </li>)}
        </ul>
      </>}
      <p className='chiner-metrics-table-note'><FormatMessage id='metrics.versions.audit.note'/></p>
      <button
        type='button'
        className='chiner-metrics-btn chiner-metrics-btn-ghost'
        data-testid='metrics-versions-audit-close'
        onClick={() => setAuditReport(null)}
      >
        <FormatMessage id='metrics.versions.audit.close'/>
      </button>
    </div>}
    <div className='chiner-metrics-catalog-filters'>
      <input
        className='chiner-metrics-search'
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={FormatMessage.string({id: 'metrics.versions.searchPlaceholder'})}
        aria-label={FormatMessage.string({id: 'metrics.versions.searchPlaceholder'})}
        data-testid='metrics-versions-search'
      />
      <select
        value={statusFilter}
        onChange={e => setStatusFilter(e.target.value)}
        aria-label={FormatMessage.string({id: 'metrics.versions.statusFilter'})}
        data-testid='metrics-versions-status-filter'
      >
        {STATUS_FILTERS.map(status => <option key={status} value={status}>
          {FormatMessage.string({id: status === 'all'
            ? 'metrics.filter.allStatus' : `metrics.status.${status}`})}
        </option>)}
      </select>
    </div>

    {commandErrors.length > 0 && <div className='chiner-metrics-field-errors'>
      {renderErrorList({errors: commandErrors, testId: 'metrics-versions-errors'})}
    </div>}

    {rows.length === 0 ? <div className='chiner-metrics-empty' data-testid='metrics-versions-empty'>
      <h3><FormatMessage id='metrics.versions.emptyTitle'/></h3>
      <p><FormatMessage id='metrics.versions.emptyDesc'/></p>
    </div> : <div className='chiner-metrics-table-wrap'>
      <table className='chiner-metrics-table' data-testid='metrics-versions-table'>
        <thead>
          <tr>
            <th><FormatMessage id='metrics.versions.col.definition'/></th>
            <th><FormatMessage id='metrics.versions.col.kind'/></th>
            <th><FormatMessage id='metrics.versions.col.scope'/></th>
            <th><FormatMessage id='metrics.versions.col.version'/></th>
            <th><FormatMessage id='metrics.versions.col.status'/></th>
            <th><FormatMessage id='metrics.versions.col.hash'/></th>
            <th><FormatMessage id='metrics.versions.col.time'/></th>
            <th><FormatMessage id='metrics.versions.col.source'/></th>
            <th><FormatMessage id='metrics.versions.col.actions'/></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <tr
            key={row.revision.id}
            data-testid='metrics-versions-row'
            data-revision-id={row.revision.id}
          >
            <td>
              <strong>{row.definition.name}</strong>
              <code className='chiner-metrics-mono'>{row.definition.code}</code>
            </td>
            <td>{row.definition.kind !== '—' ? renderKindBadge(row.definition.kind)
              : <span>—</span>}</td>
            <td>{row.definition.scope ? renderScopeBadge(row.definition.scope) : '—'}</td>
            <td>{row.revision.version
              ? <span className='chiner-metrics-tag'>v{row.revision.version}</span>
              : <span className='chiner-metrics-muted'>
                <FormatMessage id='metrics.versions.unpublished'/>
              </span>}</td>
            <td>{renderStatusBadge(row.revision.status)}</td>
            <td><code className='chiner-metrics-mono'
              title={FormatMessage.string({id: 'metrics.versions.hashImmutable'})}
              data-testid='metrics-versions-hash'>
              {shortHashLabel(row.revision.hash)}
            </code></td>
            <td>{row.revision.publishedAt || '—'}</td>
            <td><span className='chiner-metrics-muted'>{sourceLabel(row.revision)}</span></td>
            <td>
              <div className='chiner-metrics-cell-actions'>
                {(row.revision.status === 'published' || row.revision.status === 'deprecated') && <button
                  type='button'
                  className='chiner-metrics-btn'
                  data-testid='metrics-version-revise'
                  disabled={readOnly}
                  onClick={() => reviseFrom(row)}
                >
                  <FormatMessage id='metrics.versions.revise'/>
                </button>}
                {row.revision.status === 'published' && <button
                  type='button'
                  className='chiner-metrics-btn chiner-metrics-btn-danger'
                  data-testid='metrics-version-deprecate'
                  disabled={readOnly}
                  onClick={() => deprecate(row)}
                >
                  <FormatMessage id='metrics.versions.deprecate'/>
                </button>}
                {row.revision.status === 'draft' && <button
                  type='button'
                  className='chiner-metrics-btn'
                  data-testid='metrics-version-open-draft'
                  onClick={() => onOpenDefinition && onOpenDefinition(row.definition.id)}
                >
                  <FormatMessage id='metrics.versions.draftOpen'/>
                </button>}
                {row.revision.status !== 'draft' && <button
                  type='button'
                  className='chiner-metrics-btn chiner-metrics-btn-ghost'
                  data-testid='metrics-version-refs'
                  onClick={() => setRefsFor(refsFor && refsFor.revisionId === row.revision.id
                    ? null : {revisionId: row.revision.id, code: row.definition.code,
                    version: row.revision.version})}
                >
                  <FormatMessage id='metrics.versions.refs'/>
                </button>}
              </div>
            </td>
          </tr>)}
        </tbody>
      </table>
      <p className='chiner-metrics-table-note'>
        <FormatMessage id='metrics.versions.hashImmutable'/>
      </p>
    </div>}

    {refsFor != null && <div className='chiner-metrics-side-card' data-testid='metrics-version-ref-list'>
      <h3><FormatMessage id='metrics.versions.refsTitle' data={
        {code: refsFor.code, version: refsFor.version || '—'}}/></h3>
      {refsList.length === 0 ? <p className='chiner-metrics-muted'>
        <FormatMessage id='metrics.versions.refsEmpty'/>
      </p> : <ul className='chiner-metrics-deplist'>
        {refsList.map(ref => <li key={ref.revisionId}>
          <strong>{ref.definitionName}</strong>
          <code>{ref.definitionCode}</code>
          {ref.version ? <span className='chiner-metrics-tag'>v{ref.version}</span> : null}
          {renderStatusBadge(ref.status)}
          <span className='chiner-metrics-fact-list'>
            {ref.roles.map(role => ROLE_LABEL_KEYS[role]
              ? <span key={role} className='chiner-metrics-tag' title={role}>
                <FormatMessage id={ROLE_LABEL_KEYS[role]}/>
              </span>
              : <code key={role} className='chiner-metrics-mono'>{role}</code>)}
          </span>
        </li>)}
      </ul>}
      <p className='chiner-metrics-table-note'>
        <FormatMessage id='metrics.versions.refsNote'/>
      </p>
    </div>}
  </section>;
};

export default React.memo(VersionsPage);
