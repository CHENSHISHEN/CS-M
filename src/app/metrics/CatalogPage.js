import React, {useMemo, useState} from 'react';
import {FormatMessage, Message} from 'components';
import {metricApi, runMetricCommand, listSourceModels} from './commands';
import {renderKindBadge, renderScopeBadge, renderStatusBadge, renderMetricErrorText} from './parts';

// 指标平台 M2：指标目录页。
// - 统计/列表全部来自真实 profile.metricPlatform（缺失即空，不生成样例）；
// - 概念（业务域）维护走 createMetricConcept；目录支持 搜索/类型/scope/状态 过滤；
// - 行点击进入定义页查看具体定义与版本。
const CatalogPage = ({source, commandRunner, onOpenDefinition, onOpenLineage, readOnly}) => {
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [domainFilter, setDomainFilter] = useState('all');
  const [conceptFormOpen, setConceptFormOpen] = useState(false);
  const [conceptDomain, setConceptDomain] = useState('');
  const [conceptName, setConceptName] = useState('');
  const [conceptErrors, setConceptErrors] = useState([]);

  const store = useMemo(() => metricApi.readMetricPlatform(source), [source]);
  const concepts = store.concepts || [];
  const entries = useMemo(() => metricApi.listMetricDefinitions(source), [source]);

  // 概念域 → 定义数（真实 store 计数；未归属概念的定义单独成组）
  const domainStats = useMemo(() => {
    const conceptDomainById = {};
    concepts.forEach(c => {
      conceptDomainById[c.id] = c.domain;
    });
    const stats = {};
    entries.forEach(({definition}) => {
      const domain = definition.conceptId
        ? (conceptDomainById[definition.conceptId] || null) : null;
      const key = domain || '__none__';
      stats[key] = (stats[key] || 0) + 1;
    });
    return stats;
  }, [entries, concepts]);
  const domains = useMemo(() => {
    const set = [];
    concepts.forEach(c => {
      if (set.indexOf(c.domain) < 0) set.push(c.domain);
    });
    return set;
  }, [concepts]);

  // 统计卡：全量（不受筛选影响）真实计数
  const stats = useMemo(() => {
    const byKind = {atomic: 0, derived: 0, compound: 0};
    let publicCount = 0;
    let departmentCount = 0;
    entries.forEach(({definition}) => {
      if (byKind[definition.kind] != null) byKind[definition.kind] += 1;
      if (definition.scope && definition.scope.kind === 'department') departmentCount += 1;
      else publicCount += 1;
    });
    return {total: entries.length, ...byKind, publicCount, departmentCount};
  }, [entries]);

  // 筛选：kind/scope/status/search 交给领域查询，业务域在 UI 侧按概念归属过滤
  const filtered = useMemo(() => {
    const filter = {};
    if (kindFilter !== 'all') filter.kind = kindFilter;
    if (scopeFilter !== 'all') filter.scope = {kind: scopeFilter};
    if (statusFilter !== 'all') filter.status = statusFilter;
    if (search.trim() !== '') filter.search = search.trim();
    let rows = metricApi.listMetricDefinitions(source, filter);
    if (domainFilter !== 'all') {
      const conceptDomainById = {};
      concepts.forEach(c => {
        conceptDomainById[c.id] = c.domain;
      });
      rows = rows.filter(({definition}) => {
        const domain = definition.conceptId
          ? (conceptDomainById[definition.conceptId] || null) : null;
        return (domain || '__none__') === domainFilter;
      });
    }
    return rows;
  }, [source, kindFilter, scopeFilter, statusFilter, search, domainFilter, concepts]);

  // 存在废弃修订的定义（latestPublished 为空但历史发布已全部废弃时显示“已废弃”）
  const deprecatedDefinitionIds = useMemo(() => {
    const ids = [];
    (store.revisions || []).forEach((revision) => {
      if (revision.status === 'deprecated' && ids.indexOf(revision.definitionId) < 0) {
        ids.push(revision.definitionId);
      }
    });
    return ids;
  }, [store]);

  const modelCount = useMemo(() => listSourceModels(source).length, [source]);

  const submitConcept = () => {
    setConceptErrors([]);
    const result = runMetricCommand(commandRunner, latest =>
      metricApi.createMetricConcept(latest, {
        domain: conceptDomain.trim(),
        name: conceptName.trim(),
      }));
    if (result && result.ok) {
      setConceptDomain('');
      setConceptName('');
      setConceptFormOpen(false);
      Message.success({title: FormatMessage.string({id: 'metrics.concept.created'})});
    } else {
      setConceptErrors((result && result.errors) || []);
    }
  };

  const kindOptions = ['all', 'atomic', 'derived', 'compound'];

  return <section className='chiner-metrics-page' data-testid='metrics-catalog-page'>
    <header className='chiner-metrics-page-header'>
      <div>
        <h2 data-testid='metrics-catalog-title'><FormatMessage id='metrics.catalog.title'/></h2>
        <p className='chiner-metrics-page-sub'><FormatMessage id='metrics.catalog.subtitle'/></p>
      </div>
      <button
        type='button'
        className='chiner-metrics-btn chiner-metrics-btn-primary'
        data-testid='metrics-create-entry'
        disabled={readOnly}
        onClick={() => onOpenDefinition(null, 'create')}
        title={readOnly ? FormatMessage.string({id: 'workbench.versionDisabled'}) : undefined}
      >
        <FormatMessage id='metrics.catalog.create'/>
      </button>
    </header>

    <div className='chiner-metrics-stat-cards' role='group'>
      <div className='chiner-metrics-stat-card' data-testid='metrics-stat-total'>
        <span className='chiner-metrics-stat-num'>{stats.total}</span>
        <span className='chiner-metrics-stat-label'><FormatMessage id='metrics.stat.total'/></span>
        <span className='chiner-metrics-stat-sub'>
          <FormatMessage id='metrics.stat.totalSub'
            data={{pub: stats.publicCount, dept: stats.departmentCount}}/>
        </span>
      </div>
      {['atomic', 'derived', 'compound'].map(kind => <div
        key={kind}
        className='chiner-metrics-stat-card'
        data-testid={`metrics-stat-${kind}`}>
        <span className='chiner-metrics-stat-num'>{stats[kind]}</span>
        <span className='chiner-metrics-stat-label'><FormatMessage id={KIND_LABELS[kind]}/></span>
        <span className='chiner-metrics-stat-sub'><FormatMessage id={KIND_SUB_LABELS[kind]}/></span>
      </div>)}
    </div>

    <div className='chiner-metrics-catalog'>
      <aside className='chiner-metrics-catalog-domains'>
        <div className='chiner-metrics-catalog-domains-head'>
          <span><FormatMessage id='metrics.catalog.system'/></span>
          <button
            type='button'
            className='chiner-metrics-iconbtn'
            data-testid='metrics-concept-add-toggle'
            disabled={readOnly}
            onClick={() => {
              setConceptFormOpen(pre => !pre);
              setConceptErrors([]);
            }}
            title={FormatMessage.string({id: 'metrics.concept.add'})}
            aria-label={FormatMessage.string({id: 'metrics.concept.add'})}
          >+</button>
        </div>
        {conceptFormOpen && <div className='chiner-metrics-concept-form' data-testid='metrics-concept-form'>
          <input
            value={conceptDomain}
            onChange={e => setConceptDomain(e.target.value)}
            placeholder={FormatMessage.string({id: 'metrics.concept.domainPlaceholder'})}
            aria-label={FormatMessage.string({id: 'metrics.concept.domainPlaceholder'})}
            list='chiner-metrics-domain-list'
            disabled={readOnly}
          />
          <datalist id='chiner-metrics-domain-list'>
            {domains.map(d => <option key={d} value={d}/>)}
          </datalist>
          <input
            value={conceptName}
            onChange={e => setConceptName(e.target.value)}
            placeholder={FormatMessage.string({id: 'metrics.concept.namePlaceholder'})}
            aria-label={FormatMessage.string({id: 'metrics.concept.namePlaceholder'})}
            disabled={readOnly}
          />
          <button
            type='button'
            className='chiner-metrics-btn chiner-metrics-btn-primary'
            data-testid='metrics-concept-submit'
            disabled={readOnly}
            onClick={submitConcept}
          >
            <FormatMessage id='metrics.concept.submit'/>
          </button>
          {conceptErrors.length > 0 && <div className='chiner-metrics-field-errors'>
            {conceptErrors.map((error, i) => <div key={i}>{renderMetricErrorText(error)}</div>)}
          </div>}
        </div>}
        <button
          type='button'
          className={`chiner-metrics-domain-row${domainFilter === 'all' ? ' active' : ''}`}
          onClick={() => setDomainFilter('all')}
          data-testid='metrics-domain-all'
        >
          <span><FormatMessage id='metrics.catalog.allDomains'/></span>
          <span className='chiner-metrics-domain-count'>{stats.total}</span>
        </button>
        {domains.map(domain => <button
          key={domain}
          type='button'
          className={`chiner-metrics-domain-row${domainFilter === domain ? ' active' : ''}`}
          onClick={() => setDomainFilter(domain)}
        >
          <span>{domain}</span>
          <span className='chiner-metrics-domain-count'>{domainStats[domain] || 0}</span>
        </button>)}
        {domainStats.__none__ != null && <button
          type='button'
          className={`chiner-metrics-domain-row${domainFilter === '__none__' ? ' active' : ''}`}
          onClick={() => setDomainFilter('__none__')}
        >
          <span><FormatMessage id='metrics.catalog.noConcept'/></span>
          <span className='chiner-metrics-domain-count'>{domainStats.__none__}</span>
        </button>}
        {concepts.length === 0 && <p className='chiner-metrics-domains-empty'>
          <FormatMessage id='metrics.concept.empty'/>
        </p>}
        <div className='chiner-metrics-catalog-domains-note'>
          <FormatMessage id='metrics.catalog.domainNote' data={{models: modelCount}}/>
        </div>
      </aside>

      <div className='chiner-metrics-catalog-main'>
        <div className='chiner-metrics-catalog-filters'>
          <input
            className='chiner-metrics-search'
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={FormatMessage.string({id: 'metrics.catalog.searchPlaceholder'})}
            aria-label={FormatMessage.string({id: 'metrics.catalog.searchPlaceholder'})}
            data-testid='metrics-catalog-search'
          />
          <div className='chiner-metrics-seg' role='group'
            aria-label={FormatMessage.string({id: 'metrics.catalog.kindFilter'})}>
            {kindOptions.map(kind => <button
              key={kind}
              type='button'
              className={kindFilter === kind ? 'active' : ''}
              onClick={() => setKindFilter(kind)}
              data-testid={`metrics-kind-filter-${kind}`}
            >
              <FormatMessage id={kind === 'all' ? 'metrics.filter.all' : `metrics.kind.${kind}`}/>
            </button>)}
          </div>
          <select
            value={scopeFilter}
            onChange={e => setScopeFilter(e.target.value)}
            aria-label={FormatMessage.string({id: 'metrics.catalog.scopeFilter'})}
            data-testid='metrics-scope-filter'
          >
            <option value='all'>{FormatMessage.string({id: 'metrics.filter.allScope'})}</option>
            <option value='public'>{FormatMessage.string({id: 'metrics.scope.public'})}</option>
            <option value='department'>{FormatMessage.string({id: 'metrics.scope.department'})}</option>
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            aria-label={FormatMessage.string({id: 'metrics.catalog.statusFilter'})}
            data-testid='metrics-status-filter'
          >
            <option value='all'>{FormatMessage.string({id: 'metrics.filter.allStatus'})}</option>
            <option value='published'>{FormatMessage.string({id: 'metrics.status.published'})}</option>
            <option value='draft'>{FormatMessage.string({id: 'metrics.status.draft'})}</option>
            <option value='deprecated'>{FormatMessage.string({id: 'metrics.status.deprecated'})}</option>
          </select>
        </div>

        {filtered.length === 0 ? <div className='chiner-metrics-empty' data-testid='metrics-catalog-empty'>
          <div className='chiner-metrics-empty-icon' aria-hidden='true'>
            <svg width='36' height='36' viewBox='0 0 24 24' fill='none' stroke='currentColor'
              strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
              <path d='M4 19V5m0 14h16M7 14l3.5-4 3 2.5L18 7'/>
            </svg>
          </div>
          {entries.length === 0 ? <>
            <h3><FormatMessage id='metrics.catalog.emptyTitle'/></h3>
            <p><FormatMessage id='metrics.catalog.emptyDesc'/></p>
            <button
              type='button'
              className='chiner-metrics-btn chiner-metrics-btn-primary'
              data-testid='metrics-empty-create'
              disabled={readOnly}
              onClick={() => onOpenDefinition(null, 'create')}
            >
              <FormatMessage id='metrics.catalog.create'/>
            </button>
          </> : <>
            <h3><FormatMessage id='metrics.catalog.noMatch'/></h3>
            <p><FormatMessage id='metrics.catalog.noMatchDesc'/></p>
          </>}
        </div> : <div className='chiner-metrics-table-wrap'>
          <table className='chiner-metrics-table' data-testid='metrics-catalog-table'>
            <thead>
              <tr>
                <th><FormatMessage id='metrics.col.name'/></th>
                <th><FormatMessage id='metrics.col.kind'/></th>
                <th><FormatMessage id='metrics.col.scope'/></th>
                <th><FormatMessage id='metrics.col.version'/></th>
                <th><FormatMessage id='metrics.col.owner'/></th>
                <th><FormatMessage id='metrics.col.concept'/></th>
                <th><FormatMessage id='metrics.lineage.col.actions'/></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({definition, draft, latestPublished}) => {
                const concept = definition.conceptId
                  ? concepts.filter(c => c.id === definition.conceptId)[0] : null;
                // 有废弃修订且无更新发布 → 显示“已废弃”
                const allDeprecated = latestPublished == null
                  && deprecatedDefinitionIds.indexOf(definition.id) >= 0;
                return <tr
                  key={definition.id}
                  tabIndex={0}
                  data-testid='metrics-catalog-row'
                  data-definition-id={definition.id}
                  onClick={() => onOpenDefinition(definition.id, null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onOpenDefinition(definition.id, null);
                  }}
                >
                  <td>
                    <div className='chiner-metrics-cell-name'>
                      <strong>{definition.name}</strong>
                      <code>{definition.code}</code>
                    </div>
                  </td>
                  <td>{renderKindBadge(definition.kind)}</td>
                  <td>{renderScopeBadge(definition.scope)}</td>
                  <td>
                    {allDeprecated
                      ? renderStatusBadge('deprecated')
                      : latestPublished
                        ? <span className='chiner-metrics-version-cell'>
                          <code>v{latestPublished.version}</code>
                          {renderStatusBadge('published')}
                        </span>
                        : renderStatusBadge('draft')}
                    {draft ? <span className='chiner-metrics-tag chiner-metrics-tag-draft'>
                      <FormatMessage id='metrics.status.hasDraft'/>
                    </span> : null}
                  </td>
                  <td title={definition.ownerId}><code>{definition.ownerId}</code></td>
                  <td>{concept ? `${concept.domain} / ${concept.name}` : '—'}</td>
                  <td onClick={e => e.stopPropagation()}>
                    {latestPublished && onOpenLineage ? <button
                      type='button'
                      className='chiner-metrics-btn chiner-metrics-btn-mini'
                      data-testid='metrics-catalog-lineage'
                      title={`${definition.name} @ v${latestPublished.version}`}
                      onClick={() => onOpenLineage(definition.id, latestPublished.id)}>
                      <FormatMessage id='metrics.nav.lineage'/>
                    </button> : <span className='chiner-metrics-muted'>—</span>}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
          <p className='chiner-metrics-table-note'>
            <FormatMessage id='metrics.catalog.footerNote' data={{count: filtered.length}}/>
          </p>
        </div>}
      </div>
    </div>
  </section>;
};

const KIND_LABELS = {
  atomic: 'metrics.stat.atomic',
  derived: 'metrics.stat.derived',
  compound: 'metrics.stat.compound',
};
const KIND_SUB_LABELS = {
  atomic: 'metrics.stat.atomicSub',
  derived: 'metrics.stat.derivedSub',
  compound: 'metrics.stat.compoundSub',
};

export default React.memo(CatalogPage);
