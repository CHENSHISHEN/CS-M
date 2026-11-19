import React, {useMemo, useState} from 'react';
import {FormatMessage, Message, Modal} from 'components';
import {metricApi, runMetricCommand} from './commands';
import {renderErrorList, renderKindBadge, renderScopeBadge, renderStatusBadge} from './parts';

// 指标平台 M3B：版本与变更页（替换 PendingPage）。
// - 全部定义的真实版本记录（草案/已发布/已废弃），来源标注（新定义/修订/部门基线/升级/分叉）；
// - 已发布历史 hash 只读展示（发布时固化，不可变）；
// - 从版本修订 = createRevisionDraft（新草案，不改动旧版本）；废弃为定义级，确认时给出
//   下游引用影响提示（listRevisionDependents，含部门基线/复合操作数/派生原子基）；
// - 本页不渲染假数据、不做服务端审批；本地确认发布不等于审核通过。

const STATUS_FILTERS = ['all', 'draft', 'published', 'deprecated'];

const shortHash = hash => (hash == null ? '—' : String(hash).slice(0, 12));

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
      message: FormatMessage.string({id: 'metrics.publish.message'}),
      onOk: () => {
        runVersion(latest => metricApi.createRevisionDraft(latest,
          row.definition.id, {baseRevisionId: row.revision.id}), (result) => {
          Message.success({title: FormatMessage.string({id: 'metrics.versions.revised'})});
          onOpenDefinition && onOpenDefinition(row.definition.id);
        });
      },
    });
  };

  const deprecate = (row) => {
    const dependents = metricApi.listRevisionDependents(source, row.revision.id);
    Modal.confirm({
      title: FormatMessage.string({id: 'metrics.versions.deprecateTitle'}),
      message: FormatMessage.string({id: 'metrics.versions.deprecateMessage',
        data: {count: dependents.length}}),
      onOk: () => {
        runVersion(latest => metricApi.deprecateMetricDefinition(latest, row.definition.id));
      },
    });
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
    </header>
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
              {shortHash(row.revision.hash)}
            </code></td>
            <td>{row.revision.publishedAt || '—'}</td>
            <td><span className='chiner-metrics-muted'>{sourceLabel(row.revision)}</span></td>
            <td>
              <div className='chiner-metrics-cell-actions'>
                {row.revision.status === 'published' && <>
                  <button
                    type='button'
                    className='chiner-metrics-btn'
                    data-testid='metrics-version-revise'
                    disabled={readOnly}
                    onClick={() => reviseFrom(row)}
                  >
                    <FormatMessage id='metrics.versions.revise'/>
                  </button>
                  <button
                    type='button'
                    className='chiner-metrics-btn chiner-metrics-btn-danger'
                    data-testid='metrics-version-deprecate'
                    disabled={readOnly}
                    onClick={() => deprecate(row)}
                  >
                    <FormatMessage id='metrics.versions.deprecate'/>
                  </button>
                </>}
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
