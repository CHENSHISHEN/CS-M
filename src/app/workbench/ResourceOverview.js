import React, {useEffect, useMemo, useState} from 'react';
import {FormatMessage} from 'components';
import {WbIcon} from './icons';
import {
  collectOverviewStats,
  overviewDrillItems,
  readVersionStats,
  overviewLinkCoverage,
  overviewLayerDistribution,
  overviewDatabaseDistribution,
} from '../../lib/model_resource_overview';
import './style/resource-overview.less';

const t = (key, data) => FormatMessage.string({id: `resourceOverview.${key}`, data});

// S3 资源总览（menuType 10）：独立左轨入口的真实统计面板。
// 全部计数经纯函数层取自当前有效模型（含未保存草稿的搜索快照），只读不 dirty；
// 版本走 getAllVersionFile 严格错误参数，loading/error/zero 三态明确；
// 不展示健康分/趋势等任何编造派生指标。
const ResourceOverview = ({source, projectInfo, readOnly, draftVersion,
                           onOpenItem, onOpenModule}) => {
  const stats = useMemo(() => collectOverviewStats(source),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, draftVersion]);
  // S3整改2：脉络覆盖/分层分布/物理库分布投影（同一有效模型快照，只读）
  const coverage = useMemo(() => overviewLinkCoverage(source),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, draftVersion]);
  const layerDist = useMemo(() => overviewLayerDistribution(source),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, draftVersion]);
  const dbDist = useMemo(() => overviewDatabaseDistribution(source),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, draftVersion]);
  const [version, setVersion] = useState({status: 'loading'});
  const [versionTick, setVersionTick] = useState(0);
  const [drill, setDrill] = useState(null);
  // projectInfo 实际是字符串路径（actions/core info:path）；兼容可选 {path} 对象
  const projectPath = typeof projectInfo === 'string' ? projectInfo : projectInfo?.path;
  useEffect(() => {
    let cancelled = false;
    setVersion({status: 'loading'});
    readVersionStats(projectPath, source).then((result) => {
      if (!cancelled) setVersion(result);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, source?.name, versionTick]);
  const toggleDrill = (key) => setDrill((pre) => (pre === key ? null : key));
  const drillItems = useMemo(() => (drill ? overviewDrillItems(source, drill) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, drill, draftVersion]);
  const renderCount = (value) => {
    if (value == null || !Number.isFinite(value)) return '-';
    return String(value);
  };
  // 指标卡：模型/关系图支持下钻列表；标准/规则/版本进入对应模块（一次点击可达）
  const cards = [
    {key: 'models', icon: 'model', count: stats.models.total,
      sub: t('cardModelsSub', {
        conceptual: stats.models.conceptual,
        logical: stats.models.logical,
        physical: stats.models.physical,
      }), drillable: true},
    {key: 'diagrams', icon: 'diagram', count: stats.diagrams.total,
      sub: t('cardDiagramsSub', {
        conceptual: stats.diagrams.conceptual,
        logical: stats.diagrams.logical,
        physical: stats.diagrams.physical,
        unclassified: stats.diagrams.unclassified,
      }), drillable: true},
    {key: 'standards', icon: 'standard', count: stats.standards.fields,
      sub: t('cardStandardsSub', {
        domains: stats.domains,
        dicts: stats.dicts,
      }), module: '6'},
    {key: 'rules', icon: 'check', count: stats.rules.configured,
      sub: t('cardRulesSub', {
        configured: stats.rules.configured,
        enabled: stats.rules.enabled,
      }), module: '5'},
  ];
  const onCardClick = (card) => {
    if (card.module) {
      onOpenModule && onOpenModule(card.module);
    } else if (card.drillable) {
      toggleDrill(card.key);
    }
  };
  // 标准与治理分区：标准字段/数据域/字典/视图分别列出（唯一 ID 计数）
  const governanceRows = [
    {key: 'fields', icon: 'standard', count: stats.standards.fields,
      sub: `${stats.standards.groups} ${t('govGroupsUnit')} · ${stats.standards.wordRoots} ${t('govRootsUnit')}`,
      module: '6'},
    {key: 'domains', icon: 'model', count: stats.domains, sub: t('govDomainsHint'), module: '1'},
    {key: 'dicts', icon: 'book', count: stats.dicts, sub: t('govDictsHint'), module: '1'},
    {key: 'views', icon: 'table', count: stats.views, sub: t('govViewsHint'), module: '1'},
  ];
  const versionBody = () => {
    if (version.status === 'loading') {
      return <span className='chiner-ro-card-loading' role='status'>
        {t('versionLoading')}
      </span>;
    }
    if (version.status === 'error') {
      return <span className='chiner-ro-card-error' role='alert'>
        {t('versionError', {message: version.message})}
        <button
          type='button'
          onClick={(e) => {
            // 卡片本体是 div[role=button]，重试不冒泡触发“进入版本模块”
            e.stopPropagation();
            setVersionTick((pre) => pre + 1);
          }}
        >
          {t('versionRetry')}
        </button>
      </span>;
    }
    if (version.status === 'unavailable') {
      return <span className='chiner-ro-card-zero'>{t('versionUnavailable')}</span>;
    }
    if (version.count === 0) {
      return <span className='chiner-ro-card-zero'>{t('versionZero')}</span>;
    }
    return renderCount(version.count);
  };
  return <div className='chiner-ro'>
    <header className='chiner-ro-hero'>
      <div className='chiner-ro-hero-main'>
        <h1>{source?.name}</h1>
        <p>
          {t('heroSummary', {
            models: stats.models.total,
            diagrams: stats.diagrams.total,
            standards: stats.standards.fields,
            rules: stats.rules.configured,
          })}
        </p>
        <p className='chiner-ro-hero-sub'>
          {t('heroStats', {
            layers: stats.layers,
            domains: stats.domains,
            dicts: stats.dicts,
            views: stats.views,
          })}
        </p>
      </div>
      <WbIcon name='gauge' size={30}/>
    </header>
    <section className='chiner-ro-cards' aria-label={t('cardsLabel')}>
      {cards.map((card) => <button
        key={card.key}
        type='button'
        className={`chiner-ro-card${drill === card.key ? ' chiner-ro-card-active' : ''}`}
        aria-pressed={card.drillable ? (drill === card.key ? 'true' : 'false') : undefined}
        onClick={() => onCardClick(card)}
      >
        <span className='chiner-ro-card-icon'><WbIcon name={card.icon} size={18}/></span>
        <strong>{renderCount(card.count)}</strong>
        <span className='chiner-ro-card-label'>{t(`card.${card.key}`)}</span>
        <span className='chiner-ro-card-sub'>{card.sub}</span>
      </button>)}
      {/* S3 修订：版本卡不使用嵌套 button——卡片本体是 div[role=button]，
          失败态“重试”是独立 button 且阻止冒泡，不触发进入版本模块 */}
      <div
        role='button'
        tabIndex={0}
        className='chiner-ro-card chiner-ro-card-versions'
        aria-label={`${t('card.versions')} ${t('cardVersionsSub')}`}
        onClick={() => onOpenModule && onOpenModule('4')}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onOpenModule && onOpenModule('4');
          }
        }}
      >
        <span className='chiner-ro-card-icon'><WbIcon name='versions' size={18}/></span>
        {versionBody()}
        <span className='chiner-ro-card-label'>{t('card.versions')}</span>
        <span className='chiner-ro-card-sub'>{t('cardVersionsSub')}</span>
      </div>
    </section>
    {/* S3整改2：hero/五卡之外的真实面板区——左栏（三层脉络 + 分层分布），
        右栏（数据库分布 + 标准治理）；窄屏自动单列，1280 不溢出 */}
    <div className='chiner-ro-columns'>
      <div className='chiner-ro-col'>
        <section className='chiner-ro-panel' aria-label={t('flowLabel')}>
          <div className='chiner-ro-section-title'>
            <span>{t('flowTitle')}</span>
            <small>{t('flowHint')}</small>
          </div>
          <div className='chiner-ro-flow'>
            {[['conceptual', stats.models.conceptual],
              ['logical', stats.models.logical],
              ['physical', stats.models.physical]].map(([level, count], i) => (
              <React.Fragment key={level}>
                {i > 0 && <span className='chiner-ro-flow-arrow' aria-hidden='true'>→</span>}
                <div className={`chiner-ro-flow-box chiner-ro-flow-${level}`}>
                  <small>{t(`flowNoun.${level}`)}</small>
                  <strong>{renderCount(count)}</strong>
                </div>
              </React.Fragment>
            ))}
          </div>
          {/* 概念-逻辑覆盖：真实有效边统计；零分母给引导，不给 0/0 */}
          <div className='chiner-ro-flow-coverage'>
            {coverage.totalLogicCount === 0
              ? <span className='chiner-ro-panel-guide'>{t('coverageEmpty')}</span>
              : <span>
                {t('coverageStrip', {
                  linked: coverage.linkedLogicCount,
                  total: coverage.totalLogicCount,
                })}
              </span>}
            {coverage.invalidLinkCount > 0 && <span className='chiner-ro-flow-invalid'>
              {t('invalidLinks', {count: coverage.invalidLinkCount})}
            </span>}
          </div>
        </section>
        <section className='chiner-ro-panel' aria-label={t('layerLabel')}>
          <div className='chiner-ro-section-title'>
            <span>{t('layerTitle')}</span>
            <small>{t('layerHint')}</small>
          </div>
          {layerDist.layers.length === 0 && layerDist.unassigned === 0
            ? <p className='chiner-ro-panel-guide'>{t('layerEmpty')}</p>
            : <div className='chiner-ro-bars'>
              {[...layerDist.layers.map(l => ({
                key: l.layerId, name: `${l.defKey}${l.defName && l.defName !== l.defKey ? ` ${l.defName}` : ''}`,
                count: l.count,
              })), ...(layerDist.unassigned > 0 ? [{
                key: '__unassigned', name: t('layerUnassigned'), count: layerDist.unassigned, muted: true,
              }] : [])].map((row) => {
                const max = Math.max(1, ...layerDist.layers.map(l => l.count), layerDist.unassigned);
                return <div key={row.key} className='chiner-ro-bar-row'>
                  <span className='chiner-ro-bar-name' title={row.name}>{row.name}</span>
                  <span className='chiner-ro-bar-track'>
                    <span
                      className={`chiner-ro-bar-fill${row.muted ? ' muted' : ''}`}
                      style={{width: `${Math.max(2, Math.round(row.count / max * 100))}%`}}
                    />
                  </span>
                  <strong>{renderCount(row.count)}</strong>
                </div>;
              })}
            </div>}
          <p className='chiner-ro-panel-note'>{t('layerScopeNote')}</p>
        </section>
      </div>
      <div className='chiner-ro-col'>
        <section className='chiner-ro-panel' aria-label={t('dbLabel')}>
          <div className='chiner-ro-section-title'>
            <span>{t('dbTitle')}</span>
            <small>{t('dbHint')}</small>
          </div>
          {/* S3整改：按真实表总量判空——兼容类型/未指定/失效归属也是真实物理表，
              三张旧表（合法类型1+未指定1+失效1）不得显示整块空态；无表时保留真实空态 */}
          {dbDist.total === 0
            ? <p className='chiner-ro-panel-guide'>{t('dbEmpty')}</p>
            : <>
              <div className='chiner-ro-db-total'>
                {/* 主计数 = 全部物理表总量；具名库容器归属表数单列真实展示（可为0） */}
                <strong>{renderCount(dbDist.total)}</strong>
                <span>{t('dbTotalUnit')}</span>
                <span>{t('dbDatabases', {count: dbDist.databases.length})}</span>
                <span>{t('dbAssignedTables', {count: dbDist.assignedTotal})}</span>
              </div>
              <div
                className='chiner-ro-db-stack'
                role='img'
                aria-label={dbDist.types.map(x => `${x.name || t(x.key === '__unspecified' ? 'dbUnspecified' : 'dbUnknown')}:${x.count}`).join(' ')}>
                {dbDist.types.map((x, i) => (
                  <span
                    key={x.key}
                    className={`chiner-ro-db-seg seg-${i % 5}`}
                    style={{flexGrow: x.count}}
                    title={`${x.name || t(x.key === '__unspecified' ? 'dbUnspecified' : 'dbUnknown')} ${x.count}`}
                  />
                ))}
              </div>
              <div className='chiner-ro-db-legend'>
                {dbDist.types.map((x, i) => <span key={x.key} className='chiner-ro-db-legend-item'>
                  <i className={`seg-${i % 5}`}/>
                  {x.name || t(x.key === '__unspecified' ? 'dbUnspecified' : 'dbUnknown')}
                  <strong>{renderCount(x.count)}</strong>
                </span>)}
              </div>
            </>}
        </section>
        <section className='chiner-ro-governance' aria-label={t('governanceLabel')}>
          <div className='chiner-ro-section-title'>{t('governanceTitle')}</div>
          {governanceRows.map((row) => <button
            key={row.key}
            type='button'
            className='chiner-ro-governance-row'
            onClick={() => onOpenModule && onOpenModule(row.module)}
          >
            <span className='chiner-ro-card-icon'><WbIcon name={row.icon} size={14}/></span>
            <span className='chiner-ro-governance-name'>{t(`gov.${row.key}`)}</span>
            <span className='chiner-ro-governance-sub'>{row.sub}</span>
            <strong>{renderCount(row.count)}</strong>
          </button>)}
          <div className='chiner-ro-governance-foot'>
            <span>{t('govRulesFoot')}</span>
            <span>{renderCount(stats.rules.configured)}</span>
            <span className='chiner-ro-tag'>{t('govRulesEnabled', {count: stats.rules.enabled})}</span>
          </div>
        </section>
      </div>
    </div>
    {drill && <section className='chiner-ro-drill' aria-label={t('drillLabel')}>
      <div className='chiner-ro-drill-title'>
        <span>{t(`card.${drill}`)}</span>
        <button type='button' onClick={() => setDrill(null)} aria-label={t('drillClose')}>
          <WbIcon name='close' size={12}/>
        </button>
      </div>
      <div className='chiner-ro-drill-list'>
        {drillItems.length === 0 && <p className='chiner-ro-drill-empty'>
          {t('drillEmpty')}
        </p>}
        {drillItems.map((item) => <button
          key={`${item.collection}:${item.id}`}
          type='button'
          className='chiner-ro-drill-item'
          onClick={() => onOpenItem && onOpenItem(item)}
          title={`${item.defKey || ''} ${item.defName || ''}`}
        >
          <WbIcon name={item.type === 'diagram' ? 'diagram' : 'table'} size={13}/>
          <span className='chiner-ro-mono'>{item.defKey}</span>
          {item.defName && item.defName !== item.defKey
            && <span>{item.defName}</span>}
          <span className='chiner-ro-tag'>{t(`level.${item.level || 'unclassified'}`)}</span>
        </button>)}
      </div>
    </section>}
  </div>;
};

export default React.memo(ResourceOverview);
