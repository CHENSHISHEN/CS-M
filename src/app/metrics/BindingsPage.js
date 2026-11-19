import React, {useMemo, useState} from 'react';
import {FormatMessage} from 'components';
import {metricApi} from './commands';
import {renderBindingStateTag, renderRoleTag} from './ModelMetricPanel';
import {renderKindBadge} from './parts';

// 指标平台 M4B：模型关联页（替换 M2 的 PendingPage）。
// - 目录按业务概念 → 具体定义版本展开；选中版本展示真实关联分组
//   （getMetricModels：直接来源/间接来源/物化输出/使用引用/语义映射），
//   同一指标跨多个模型只展示这一份定义与版本，不复制定义、不复制计数；
// - 提供真实 importDiagnostics 处理结果入口：重命名/映射（CODE_RENAMED /
//   ID_REASSIGNED 的 from→to）、冲突（UNKNOWN_KEY_CONFLICT 的 key 与来源值）、
//   未随导入与失效原因（ENDPOINT_UNRESOLVED / UNKNOWN_SCHEMA 的明细）；
//   诊断只来自 profile.metricPlatform.importDiagnostics 真实存储，无诊断即空态；
// - 端点精确打开：onOpenModel({collection, objectId, fieldDefKey}) 由宿主定位到
//   模型编辑器与字段；端点不在场时保留历史端点快照展示并说明原因。
// 与 src/lib/metrics 约定一致：不使用 ?? / ?.

const DIAG_KEYS = {
  METRIC_IMPORT_CODE_RENAMED: 'metrics.binding.diag.codeRenamed',
  METRIC_IMPORT_ID_REASSIGNED: 'metrics.binding.diag.idReassigned',
  METRIC_IMPORT_ENDPOINT_UNRESOLVED: 'metrics.binding.diag.endpointUnresolved',
  METRIC_IMPORT_UNKNOWN_KEY_CONFLICT: 'metrics.binding.diag.unknownKeyConflict',
  METRIC_IMPORT_NAMESPACE_ADOPTED: 'metrics.binding.diag.namespaceAdopted',
  METRIC_IMPORT_UNKNOWN_SCHEMA: 'metrics.binding.diag.unknownSchema',
};

const COLLECTION_LAYER_KEYS = {
  entities: 'metrics.model.physical',
  logicEntities: 'metrics.model.logical',
  conceptEntities: 'metrics.model.conceptual',
};

const GROUP_DEFS = [
  {key: 'sources', titleKey: 'metrics.binding.group.sources', testId: 'metrics-models-sources'},
  {key: 'indirectSources', titleKey: 'metrics.binding.group.indirectSources',
    testId: 'metrics-models-indirect'},
  {key: 'materializations', titleKey: 'metrics.binding.group.materializations',
    testId: 'metrics-models-materializations'},
  {key: 'consumers', titleKey: 'metrics.binding.group.consumers', testId: 'metrics-models-consumers'},
  {key: 'semantic', titleKey: 'metrics.binding.group.semantic', testId: 'metrics-models-semantic'},
];

const layerName = (source, ref, endpoint) => {
  if (endpoint && endpoint.object) return endpoint.object.defName
    || endpoint.object.defKey || ref.objectId;
  return ref.objectName || ref.objectKey || ref.objectId;
};

const BindingsPage = ({source, onOpenDefinition, onOpenLineage, onOpenModel, readOnly, focus}) => {
  const [selected, setSelected] = useState(null); // {definitionId, revisionId}
  const [nonce, setNonce] = useState(0);
  // focus 定位请求只消费一次：未消费时优先定位目标；用户手动选择版本后以本地
  // 选择为准（不再被老 focus 覆盖）；新的 nonce 仍可再次定位。
  const [consumedNonce, setConsumedNonce] = useState(null);

  const store = useMemo(() => metricApi.readMetricPlatform(source), [source, nonce]);
  const concepts = store.concepts || [];
  const definitions = store.definitions || [];
  const revisions = store.revisions || [];
  const diagnostics = store.importDiagnostics || [];

  // 目录树：业务概念 → 定义 → 已发布版本（真实存储；未归属概念单独成组）
  const tree = useMemo(() => {
    const defsByConcept = {};
    const loose = [];
    definitions.forEach((definition) => {
      if (definition.conceptId
        && concepts.some(concept => concept.id === definition.conceptId)) {
        (defsByConcept[definition.conceptId] = defsByConcept[definition.conceptId] || [])
          .push(definition);
      } else {
        loose.push(definition);
      }
    });
    const publishedOf = (definitionId) => revisions
      .filter(revision => revision.definitionId === definitionId
        && revision.status === 'published');
    const conceptNodes = concepts
      .filter(concept => (defsByConcept[concept.id] || []).length > 0)
      .map(concept => ({
        key: concept.id,
        domain: concept.domain,
        name: concept.name,
        definitions: (defsByConcept[concept.id] || []).map(definition => ({
          definition,
          versions: publishedOf(definition.id),
        })),
      }));
    const looseNode = loose.length ? {
      key: '__none__',
      domain: null,
      name: null,
      definitions: loose.map(definition => ({
        definition,
        versions: publishedOf(definition.id),
      })),
    } : null;
    return conceptNodes.concat(looseNode ? [looseNode] : []);
  }, [definitions, revisions, concepts]);

  // focus（从模型编辑器“查看血缘”进入）：定位到具体定义版本（nonce 只消费一次）
  const effectiveSelected = useMemo(() => {
    if (focus && focus.nonce && focus.definitionId && focus.nonce !== consumedNonce) {
      const definition = definitions.filter(d => d.id === focus.definitionId)[0];
      if (!definition) return selected;
      let revisionId = focus.revisionId;
      if (revisionId == null) {
        const published = revisions.filter(r => r.definitionId === definition.id
          && r.status === 'published');
        revisionId = published.length ? published[published.length - 1].id : null;
      }
      return revisionId == null ? null : {definitionId: definition.id, revisionId};
    }
    return selected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus && focus.nonce, focus && focus.definitionId, focus && focus.revisionId,
    consumedNonce, definitions, revisions, selected]);

  const revision = effectiveSelected
    ? revisions.filter(r => r.id === effectiveSelected.revisionId)[0] : null;
  const definition = effectiveSelected
    ? definitions.filter(d => d.id === effectiveSelected.definitionId)[0] : null;

  const metricModels = useMemo(() => {
    if (revision == null) return null;
    return metricApi.getMetricModels(source, revision.id, {includeReleased: false});
  }, [source, revision, nonce]);

  // M4B 定义声明来源投影（只读）：目标版本及依赖闭包内原子的 spec.source 端点；
  // 已被同端点生效绑定覆盖的去掉（绑定优先，不重复计数），不计入 direct/transitive
  const declared = useMemo(() => {
    if (revision == null) return [];
    const all = metricApi.getDeclaredSpecSources(source, revision.id);
    const bindings = (store.bindings || []);
    return all.filter(entry => !metricApi.declaredCoveredByBinding(source, entry, bindings));
  }, [source, revision, store, nonce]);

  const bindingCount = (store.bindings || [])
    .filter(binding => binding.state !== 'released').length;

  const renderEndpointRow = (item, groupKey) => {
    const binding = item.binding;
    const ref = binding.modelRef;
    const field = item.endpoint && item.endpoint.field
      ? item.endpoint.field : (ref.fieldKey
        ? {defKey: ref.fieldKey, defName: ref.fieldName} : null);
    const open = item.endpoint && item.endpoint.present && onOpenModel;
    return <div
      key={binding.id + (item.viaRevisionId || '')}
      className={`chiner-metrics-binding-row${item.endpoint && item.endpoint.present
        ? '' : ' chiner-metrics-binding-row-missing'}`}
      data-testid='metrics-model-row'
      data-role={binding.role}
      data-state={binding.state}>
      <div className='chiner-metrics-binding-row-main'>
        <div className='chiner-metrics-binding-row-title'>
          <strong>{layerName(source, ref, item.endpoint)}</strong>
          <code>{ref.objectKey || ref.objectId}</code>
          <span className='chiner-metrics-tag'>
            <FormatMessage id={COLLECTION_LAYER_KEYS[ref.collection]
              || 'metrics.model.physical'}/>
          </span>
          {renderRoleTag(binding.role)}
          {renderBindingStateTag(binding.state)}
          {groupKey === 'indirectSources' && item.viaRevisionId
            ? <span className='chiner-metrics-tag chiner-metrics-tag-draft'
              data-testid='metrics-model-via'>
              <FormatMessage id='metrics.binding.viaRevision'
                data={{version: viaVersionOf(revisions, item.viaRevisionId)}}/>
            </span> : null}
        </div>
        <div className='chiner-metrics-binding-row-meta'>
          {field && <span className='chiner-metrics-binding-field'>
            <FormatMessage id='metrics.binding.endpointField'/>
            {field.defKey || field.defName}
          </span>}
          {binding.evidence && binding.evidence.note
            ? <span title={binding.evidence.note}>{binding.evidence.note}</span> : null}
          {binding.state === 'unresolved' && binding.unresolved
            ? <span className='chiner-metrics-binding-unresolved-reason'>
              <FormatMessage id='metrics.binding.unresolvedWhy'/>
              {binding.unresolved.reason}
            </span> : null}
        </div>
      </div>
      <div className='chiner-metrics-binding-row-actions'>
        {open && <button
          type='button'
          className='chiner-metrics-btn chiner-metrics-btn-mini'
          data-testid='metrics-model-open'
          onClick={() => onOpenModel({
            collection: ref.collection,
            objectId: ref.objectId,
            fieldDefKey: field ? (field.defKey || null) : null,
          })}>
          <FormatMessage id='metrics.binding.openModel'/>
        </button>}
        {!item.endpoint.present
          ? <span className='chiner-metrics-tag chiner-metrics-tag-warn'
            data-testid='metrics-model-endpoint-missing'>
            <FormatMessage id='metrics.binding.endpointMissing'/>
          </span> : null}
      </div>
    </div>;
  };

  const diagCount = diagnostics.length;

  // M5B 业务化布局：有内容的分组优先可见（定义声明来源同样优先），空分组不再
  // 各占一块把真实来源挤出首屏，收敛为一条紧凑说明（分组名保留，建立后自动展示）
  const groupsWithItems = [];
  const emptyGroupNames = [];
  GROUP_DEFS.forEach((group) => {
    const items = metricModels ? (metricModels[group.key] || []) : [];
    if (items.length > 0) groupsWithItems.push({group, items});
    else emptyGroupNames.push(FormatMessage.string({id: group.titleKey}));
  });

  return <section className='chiner-metrics-page' data-testid='metrics-bindings-page'>
    <header className='chiner-metrics-page-header'>
      <div>
        <h2 data-testid='metrics-bindings-title'>
          <FormatMessage id='metrics.binding.pageTitle'/>
        </h2>
        <p className='chiner-metrics-page-sub'>
          <FormatMessage id='metrics.binding.pageSub' data={{count: bindingCount}}/>
        </p>
      </div>
    </header>

    <div
      className={`chiner-metrics-importdiag${diagCount ? '' : ' chiner-metrics-importdiag-empty'}`}
      data-testid='metrics-importdiag'>
      {diagCount === 0 ? <p className='chiner-metrics-importdiag-empty-text'>
        <FormatMessage id='metrics.binding.diag.empty'/>
      </p> : <>
        <div className='chiner-metrics-importdiag-head'>
          <h3><FormatMessage id='metrics.binding.diag.title'/></h3>
          <span className='chiner-metrics-tag' data-testid='metrics-importdiag-count'>
            <FormatMessage id='metrics.binding.diag.count' data={{count: diagCount}}/>
          </span>
        </div>
        <ul className='chiner-metrics-importdiag-list'>
          {diagnostics.map((diag, index) => <li
            key={`${diag.code}-${index}`}
            data-testid='metrics-importdiag-item'
            data-code={diag.code}>
            <span
              className='chiner-metrics-tag chiner-metrics-tag-warn'
              data-testid='metrics-importdiag-code'>
              <FormatMessage id={DIAG_KEYS[diag.code] || 'metrics.binding.diag.other'}/>
            </span>
            <span className='chiner-metrics-importdiag-detail'>
              {diag.from != null && diag.to != null
                ? <code data-testid='metrics-importdiag-remap'>
                  {`${diag.from} → ${diag.to}`}
                </code> : null}
              {diag.key != null
                ? <code data-testid='metrics-importdiag-key'>{diag.key}</code> : null}
              {diag.collection != null
                ? <code data-testid='metrics-importdiag-endpoint'>
                  {`${diag.collection}/${diag.objectId || ''}${diag.fieldId
                    ? '.' + diag.fieldId : ''}`}
                </code> : null}
              {diag.schemaVersion != null
                ? <code data-testid='metrics-importdiag-schema'>
                  {`schemaVersion=${diag.schemaVersion}`}
                </code> : null}
              {diag.message ? <span className='chiner-metrics-importdiag-message'>
                {diag.message}
              </span> : null}
            </span>
          </li>)}
        </ul>
        <p className='chiner-metrics-table-note'>
          <FormatMessage id='metrics.binding.diag.note'/>
        </p>
      </>}
    </div>

    <div className='chiner-metrics-catalog'>
      <aside className='chiner-metrics-catalog-domains'>
        <div className='chiner-metrics-catalog-domains-head'>
          <span><FormatMessage id='metrics.binding.treeTitle'/></span>
        </div>
        {tree.length === 0 ? <p className='chiner-metrics-domains-empty'>
          <FormatMessage id='metrics.binding.treeEmpty'/>
        </p> : tree.map(node => <div
          key={node.key}
          className='chiner-metrics-binding-tree-node'
          data-testid='metrics-binding-tree-concept'>
          <div className='chiner-metrics-binding-tree-concept-name'>
            {node.domain
              ? <span>{node.domain}{' / '}{node.name}</span>
              : <span><FormatMessage id='metrics.catalog.noConcept'/></span>}
            <span className='chiner-metrics-domain-count'>
              {node.definitions.length}</span>
          </div>
          {node.definitions.map(({definition: def, versions}) => <div
            key={def.id}
            className='chiner-metrics-binding-tree-def'>
            <div className='chiner-metrics-binding-tree-def-name' title={def.code}>
              {renderKindBadge(def.kind)}
              <span>{def.name}</span>
            </div>
            {versions.length === 0 ? <span
              className='chiner-metrics-binding-tree-version chiner-metrics-binding-tree-version-none'>
              <FormatMessage id='metrics.binding.noPublished'/>
            </span> : versions.map(version => {
              const activeSel = effectiveSelected
                && effectiveSelected.revisionId === version.id;
              return <button
                key={version.id}
                type='button'
                className={`chiner-metrics-binding-tree-version${activeSel ? ' active' : ''}`}
                data-testid='metrics-binding-tree-version'
                data-revision-id={version.id}
                onClick={() => {
                  setSelected({definitionId: def.id, revisionId: version.id});
                  if (focus && focus.nonce && focus.nonce !== consumedNonce) {
                    setConsumedNonce(focus.nonce); // 定位请求就此消费，手动选择生效
                  }
                  setNonce(n => n + 1);
                }}>
                <code>v{version.version}</code>
                <span>{bindingCountOf(store, version.id)}</span>
              </button>;
            })}
          </div>)}
        </div>)}
        <div className='chiner-metrics-catalog-domains-note'>
          <FormatMessage id='metrics.binding.treeNote'/>
        </div>
      </aside>

      <div className='chiner-metrics-catalog-main'>
        {revision == null || definition == null ? <div
          className='chiner-metrics-empty'
          data-testid='metrics-models-empty'>
          <h3><FormatMessage id='metrics.binding.detailEmptyTitle'/></h3>
          <p><FormatMessage id='metrics.binding.detailEmptyDesc'/></p>
        </div> : <div className='chiner-metrics-models-detail'
          data-testid='metrics-models-detail'
          data-revision-id={revision.id}>
          <header className='chiner-metrics-models-detail-head'>
            <div>
              <h3>
                {definition.name}
                <code>v{revision.version}</code>
                {renderKindBadge(definition.kind)}
              </h3>
              <p className='chiner-metrics-page-sub'>
                <FormatMessage id='metrics.binding.detailSub'
                  data={{direct: metricModels ? metricModels.counts.directCount : 0,
                    transitive: metricModels ? metricModels.counts.transitiveCount : 0}}/>
              </p>
            </div>
            <div className='chiner-metrics-models-detail-actions'>
              {onOpenDefinition && <button
                type='button'
                className='chiner-metrics-btn'
                data-testid='metrics-models-open-definition'
                onClick={() => onOpenDefinition(definition.id, 'view')}>
                <FormatMessage id='metrics.binding.openDefinition'/>
              </button>}
              {onOpenLineage && <button
                type='button'
                className='chiner-metrics-btn'
                data-testid='metrics-models-open-lineage'
                onClick={() => onOpenLineage(definition.id, revision.id)}>
                <FormatMessage id='metrics.nav.lineage'/>
              </button>}
            </div>
          </header>
          {groupsWithItems.map(({group, items}) => <div
            key={group.key}
            className='chiner-metrics-binding-group'
            data-testid={group.testId}>
            <div className='chiner-metrics-binding-group-head'>
              <span className='chiner-metrics-binding-group-title'>
                <FormatMessage id={group.titleKey}/>
              </span>
              <span className='chiner-metrics-binding-group-count'>{items.length}</span>
            </div>
            <div className='chiner-metrics-binding-rows'>
              {items.map(item => renderEndpointRow(item, group.key))}
            </div>
          </div>)}
          {emptyGroupNames.length > 0 && <p
            className='chiner-metrics-binding-group-compact'
            data-testid='metrics-binding-groups-empty'>
            <FormatMessage id='metrics.binding.groupCompact'
              data={{names: emptyGroupNames.join('、')}}/>
          </p>}
          <div
            className={`chiner-metrics-binding-group chiner-metrics-declared-group${declared.length ? '' : ' chiner-metrics-binding-group-collapsed'}`}
            data-testid='metrics-models-declared'>
            <div className='chiner-metrics-binding-group-head'>
              <span className='chiner-metrics-binding-group-title'>
                <FormatMessage id='metrics.binding.declared.title'/>
              </span>
              <span className='chiner-metrics-binding-group-count'>{declared.length}</span>
              <span className='chiner-metrics-tag chiner-metrics-binding-role-DECLARED'>
                <FormatMessage id='metrics.binding.declared.tag'/>
              </span>
            </div>
            {declared.length ? <>
              <p className='chiner-metrics-binding-group-empty chiner-metrics-declared-note'>
                <FormatMessage id='metrics.binding.declared.note'/>
              </p>
              <div className='chiner-metrics-binding-rows'>
                {declared.map(entry => {
                  const field = entry.endpoint.field;
                  const open = entry.endpoint.present && onOpenModel;
                  return <div
                    key={'declared-' + entry.ownerId}
                    className='chiner-metrics-binding-row chiner-metrics-declared-row'
                    data-testid='metrics-declared-row'
                    data-revision-id={entry.ownerId}>
                    <div className='chiner-metrics-binding-row-main'>
                      <div className='chiner-metrics-binding-row-title'>
                        <strong>{entry.endpoint.present
                          ? (entry.endpoint.object.defName
                            || entry.endpoint.object.defKey || entry.specSource.modelId)
                          : entry.specSource.modelId}</strong>
                        {entry.endpoint.present
                          && <code>{entry.endpoint.object.defKey || entry.specSource.modelId}</code>}
                        {entry.endpoint.present && <span className='chiner-metrics-tag'>
                          <FormatMessage id={COLLECTION_LAYER_KEYS[entry.endpoint.collection]
                            || 'metrics.model.physical'}/>
                        </span>}
                        <span className='chiner-metrics-tag chiner-metrics-binding-role-DECLARED'>
                          <FormatMessage id='metrics.binding.declared.tag'/>
                        </span>
                        {entry.designOnly && <span className='chiner-metrics-tag chiner-metrics-tag-warn'>
                          <FormatMessage id='metrics.binding.declared.designOnly'/>
                        </span>}
                        {!entry.direct && <span className='chiner-metrics-tag chiner-metrics-tag-draft'>
                          <FormatMessage id='metrics.binding.declared.via'
                            data={{version: entry.revision.version}}/>
                        </span>}
                      </div>
                      <div className='chiner-metrics-binding-row-meta'>
                        {entry.definition && <span><code>{entry.definition.code}</code></span>}
                        <span className='chiner-metrics-binding-field'>
                          {field
                            ? <><FormatMessage id='metrics.binding.endpointField'/>
                              {field.defKey || field.id}</>
                            : <FormatMessage id='metrics.binding.declared.modelLevel'/>}
                        </span>
                      </div>
                    </div>
                    <div className='chiner-metrics-binding-row-actions'>
                      {open && <button
                        type='button'
                        className='chiner-metrics-btn chiner-metrics-btn-mini'
                        data-testid='metrics-model-open'
                        onClick={() => onOpenModel({
                          collection: entry.endpoint.collection,
                          objectId: entry.specSource.modelId,
                          fieldDefKey: field ? (field.defKey || null) : null,
                        })}>
                        <FormatMessage id='metrics.binding.openModel'/>
                      </button>}
                      {!entry.endpoint.present
                        ? <span className='chiner-metrics-tag chiner-metrics-tag-warn'>
                          <FormatMessage id='metrics.binding.endpointMissing'/>
                        </span> : null}
                    </div>
                  </div>;
                })}
              </div>
            </> : null}
          </div>
        </div>}
      </div>
    </div>
  </section>;
};

const viaVersionOf = (revisions, revisionId) => {
  const hit = (revisions || []).filter(r => r.id === revisionId)[0];
  return hit ? hit.version : '?';
};

const bindingCountOf = (store, revisionId) => (store.bindings || [])
  .filter(binding => binding.metricRevisionId === revisionId
    && binding.state !== 'released').length;

export default React.memo(BindingsPage);
