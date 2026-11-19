// Modeling-domain write candidates: model.table.create, model.field.add,
// model.foreignKey.create, model.diagram.create. Handlers are pure with
// respect to the passed context: they read ctx.source, publish an updated
// source via ctx.replaceSource, and report changes/undo/read-write resources.
import {appendObjectWithOptionalCategory} from '../../model_catalog.js';
import {
  text, normalized, blocking, warning, defaultDatabaseId, resolveFieldType,
  DEFAULT_ENTITY_HEADERS, buildEntityField, projectField,
} from './shared.js';

const ENTITY_COLLECTION = 'entities';

const findEntity = (source, id) => (source.entities || []).find(item => item.id === id) || null;

// ---- model.table.create ----
export const runTableCreate = (args, ctx) => {
  const problems = [];
  const reads = ['entities', 'dataTypeSupports', 'dataTypeMappings'];
  const dbTypeRef = ctx.resolveRef(args.dbType);
  if (!dbTypeRef.ok) return {issues: [blocking(dbTypeRef.code, dbTypeRef.message)], reads};
  const dbSupportId = dbTypeRef.binding.id;
  ctx.readResource('dataTypeSupports');
  ctx.readResource('dataTypeMappings');
  ctx.readResource('entities');

  let databaseId = null;
  let databaseTypeId = null;
  if (args.database !== undefined) {
    const databaseRef = ctx.resolveRef(args.database);
    if (!databaseRef.ok) {
      return {issues: [blocking(databaseRef.code, databaseRef.message)], reads};
    }
    databaseId = databaseRef.binding.id;
    // The selected physical database owns the effective db type: a mismatched
    // args.dbType is refused, never silently coerced.
    databaseTypeId = databaseRef.object?.dbTypeId || null;
    if (!databaseTypeId) {
      return {issues: [blocking('UNKNOWN_TYPE',
        `selected physical database has no valid type: ${databaseId}`)], reads};
    }
    if (databaseTypeId !== dbSupportId) {
      return {issues: [blocking('TYPE_MISMATCH',
        `args.dbType ${dbSupportId} does not match selected physical database type ${databaseTypeId}`)], reads};
    }
    ctx.readResource('modelDatabases');
    reads.push('modelDatabases');
  }
  let categoryId = null;
  if (args.category !== undefined) {
    const categoryRef = ctx.resolveRef(args.category);
    if (!categoryRef.ok) {
      return {issues: [blocking(categoryRef.code, categoryRef.message)], reads};
    }
    categoryId = categoryRef.binding.id;
    ctx.readResource('catalogCategories');
    ctx.readResource(`catalogCategory/${categoryId}/members`);
    reads.push('catalogCategories', `catalogCategory/${categoryId}/members`);
  }

  const defKey = text(args.defKey).trim();
  const defName = text(args.defName).trim();
  if (!defKey) problems.push(blocking('REQUIRED_INPUT_MISSING', 'table defKey is empty'));
  if (!defName) problems.push(blocking('REQUIRED_INPUT_MISSING', 'table defName is empty'));
  // Global entity code uniqueness (case-insensitive) is a platform invariant.
  const clash = (ctx.source.entities || [])
    .find(entity => normalized(entity.defKey) === normalized(defKey) && defKey !== '');
  if (clash) {
    problems.push(blocking('DUPLICATE_CODE',
      `entity defKey already exists: ${defKey}`, {existingId: clash.id}));
  }
  if (problems.length) return {issues: problems, reads};

  const seenFieldKeys = new Set();
  const fields = [];
  const fieldDraftProblems = [];
  (args.fields || []).forEach((draft) => {
    const key = normalized(draft.defKey);
    if (!key) {
      fieldDraftProblems.push(blocking('REQUIRED_INPUT_MISSING', 'field defKey is empty'));
      return;
    }
    if (seenFieldKeys.has(key)) {
      fieldDraftProblems.push(blocking('DUPLICATE_CODE', `duplicate field defKey in table: ${draft.defKey}`));
      return;
    }
    seenFieldKeys.add(key);
    const mapping = resolveFieldType(ctx.source, dbSupportId, draft.type);
    if (!mapping) {
      fieldDraftProblems.push(blocking('UNKNOWN_TYPE',
        `field type not defined for database ${dbSupportId}: ${draft.defKey} ${draft.type}`));
      return;
    }
    fields.push(buildEntityField(draft, mapping, dbSupportId, ctx.allocateId));
  });
  if (fieldDraftProblems.length) return {issues: fieldDraftProblems, reads};

  const warnings = [];
  if (fields.some(field => field.primaryKey && !field.notNull)) {
    warnings.push(warning('PK_NOT_NULL',
      'primary key field declared without notNull; stored as declared'));
  }

  const entityId = ctx.allocateId();
  const entity = {
    id: entityId,
    env: {base: {nameSpace: '', codeRoot: ''}},
    defKey,
    defName,
    comment: text(args.comment),
    properties: {},
    sysProps: {nameTemplate: '{defKey}[{defName}]'},
    notes: {},
    headers: DEFAULT_ENTITY_HEADERS,
    fields,
    correlations: [],
    indexes: [],
    type: 'P',
    // Persist the effective physical ownership: container id when a database
    // was selected, always the concrete type for later field resolution.
    physicalDbTypeId: dbSupportId,
    ...(databaseId ? {physicalDatabaseId: databaseId} : {}),
  };
  ctx.replaceSource(appendObjectWithOptionalCategory(ctx.source, 'entity', entity, categoryId));
  ctx.bind(args.localKey, {collection: ENTITY_COLLECTION, id: entityId});
  fields.forEach((field, index) => {
    ctx.bind(args.fields[index].localKey, {
      collection: 'fields',
      owner: {collection: ENTITY_COLLECTION, id: entityId},
      id: field.id,
      fieldKey: field.defKey,
    });
  });
  ctx.writeResource(`entities/${entityId}`);
  if (categoryId) ctx.writeResource(`catalogCategory/${categoryId}/members`);

  return {
    issues: [],
    warnings,
    reads,
    changes: [{
      opId: ctx.op.opId,
      kind: 'create',
      target: {collection: ENTITY_COLLECTION, id: entityId, localKey: args.localKey},
      after: {
        defKey, defName, comment: text(args.comment),
        database: databaseId, category: categoryId,
        fieldCount: fields.length,
        fields: fields.map(projectField),
      },
    }],
    undo: [{type: 'removeObject', collection: ENTITY_COLLECTION, id: entityId,
      memberType: 'entity', categoryId}],
    objects: [{opId: ctx.op.opId, collection: ENTITY_COLLECTION, id: entityId, localKey: args.localKey}],
  };
};

// ---- model.field.add ----
export const runFieldAdd = (args, ctx) => {
  const problems = [];
  const tableRef = ctx.resolveRef(args.table);
  if (!tableRef.ok) return {issues: [blocking(tableRef.code, tableRef.message)], reads: ['entities']};
  if (tableRef.binding.collection !== ENTITY_COLLECTION) {
    return {
      issues: [blocking('REFERENCE_UNRESOLVED',
        `model.field.add targets physical entities, got ${tableRef.binding.collection}`)],
      reads: [tableRef.binding.collection],
    };
  }
  ctx.readResource('entities');
  ctx.readResource(`entities/${tableRef.binding.id}/fields`);
  ctx.readResource('dataTypeSupports');
  ctx.readResource('dataTypeMappings');
  const reads = ['entities', `entities/${tableRef.binding.id}/fields`,
    'dataTypeSupports', 'dataTypeMappings'];
  const entity = findEntity(ctx.source, tableRef.binding.id);
  if (!entity) {
    return {issues: [blocking('REFERENCE_UNRESOLVED', `table not found: ${tableRef.binding.id}`)], reads};
  }
  // Effective db type for the target table: declared physicalDbTypeId wins,
  // a historical physicalDatabaseId resolves through the real model database
  // (unknown/dangling/conflicting containers block — no invented defaults),
  // and only tables without any physical ownership fall back to the default db.
  const declaredDbTypeId = entity.physicalDbTypeId || null;
  const containerId = entity.physicalDatabaseId || null;
  let dbSupportId = null;
  if (declaredDbTypeId && containerId) {
    ctx.readResource('modelDatabases');
    reads.push('modelDatabases');
    const container = (ctx.source.profile?.modelCatalog?.physicalDatabases || [])
      .find(database => database.id === containerId);
    if (container && container.dbTypeId !== declaredDbTypeId) {
      return {issues: [blocking('TYPE_MISMATCH',
        `table ${entity.defKey} declares type ${declaredDbTypeId} but its database `
        + `${containerId} has type ${container.dbTypeId}`)], reads};
    }
    dbSupportId = declaredDbTypeId;
  }
  if (!dbSupportId && containerId) {
    ctx.readResource('modelDatabases');
    reads.push('modelDatabases');
    const container = (ctx.source.profile?.modelCatalog?.physicalDatabases || [])
      .find(database => database.id === containerId);
    if (!container) {
      return {issues: [blocking('UNKNOWN_TYPE',
        `physical database not found for table ${entity.defKey}: ${containerId}`)], reads};
    }
    if (!container.dbTypeId) {
      return {issues: [blocking('UNKNOWN_TYPE',
        `physical database ${containerId} has no valid type`)], reads};
    }
    dbSupportId = container.dbTypeId;
  }
  if (!dbSupportId && declaredDbTypeId) dbSupportId = declaredDbTypeId;
  if (!dbSupportId) dbSupportId = defaultDatabaseId(ctx.source);
  if (!dbSupportId) {
    return {issues: [blocking('UNKNOWN_TYPE', 'no database support available for type resolution')], reads};
  }
  const existingKeys = new Set((entity.fields || []).map(field => normalized(field.defKey)));
  const newFields = [];
  const fieldProblems = [];
  (args.fields || []).forEach((draft) => {
    const key = normalized(draft.defKey);
    if (!key) {
      fieldProblems.push(blocking('REQUIRED_INPUT_MISSING', 'field defKey is empty'));
      return;
    }
    if (existingKeys.has(key)) {
      fieldProblems.push(blocking('DUPLICATE_CODE',
        `field defKey already exists on ${entity.defKey}: ${draft.defKey}`));
      return;
    }
    const mapping = resolveFieldType(ctx.source, dbSupportId, draft.type);
    if (!mapping) {
      fieldProblems.push(blocking('UNKNOWN_TYPE',
        `field type not defined for database ${dbSupportId}: ${draft.defKey} ${draft.type}`));
      return;
    }
    existingKeys.add(key);
    newFields.push(buildEntityField(draft, mapping, dbSupportId, ctx.allocateId));
  });
  if (fieldProblems.length) return {issues: fieldProblems, reads};

  const beforeFields = entity.fields || [];
  const nextEntity = {...entity, fields: beforeFields.concat(newFields)};
  ctx.replaceSource({
    ...ctx.source,
    entities: (ctx.source.entities || []).map(item => (item.id === entity.id ? nextEntity : item)),
  });
  newFields.forEach((field, index) => {
    ctx.bind(args.fields[index].localKey, {
      collection: 'fields',
      owner: {collection: ENTITY_COLLECTION, id: entity.id},
      id: field.id,
      fieldKey: field.defKey,
    });
  });
  ctx.writeResource(`entities/${entity.id}/fields`);

  return {
    issues: [],
    reads,
    changes: [{
      opId: ctx.op.opId,
      kind: 'update',
      target: {collection: ENTITY_COLLECTION, id: entity.id},
      before: {fieldCount: beforeFields.length, fieldKeys: beforeFields.map(field => field.defKey)},
      after: {
        fieldCount: nextEntity.fields.length,
        addedFields: newFields.map(projectField),
      },
    }],
    undo: [{type: 'restoreFields', entityId: entity.id, fields: beforeFields}],
    objects: newFields.map((field, index) => ({
      opId: ctx.op.opId,
      collection: 'fields',
      id: field.id,
      localKey: args.fields[index].localKey,
      owner: {collection: ENTITY_COLLECTION, id: entity.id},
    })),
  };
};

// ---- model.diagram.create ----
const DIAGRAM_COLUMNS = 4;
const DIAGRAM_CELL_WIDTH = 280;
const DIAGRAM_CELL_HEIGHT = 220;
const DIAGRAM_ORIGIN = 60;

export const runDiagramCreate = (args, ctx) => {
  const problems = [];
  ctx.readResource('entities');
  ctx.readResource('diagrams');
  const reads = ['entities', 'diagrams'];
  const tableIds = [];
  const tableKeys = [];
  (args.tables || []).forEach((ref) => {
    const resolved = ctx.resolveRef(ref);
    if (!resolved.ok) {
      problems.push(blocking(resolved.code, resolved.message));
      return;
    }
    if (resolved.binding.collection !== ENTITY_COLLECTION) {
      problems.push(blocking('REFERENCE_UNRESOLVED',
        `physical diagram tables must be entities, got ${resolved.binding.collection}`));
      return;
    }
    if (!tableIds.includes(resolved.binding.id)) {
      tableIds.push(resolved.binding.id);
      const entity = findEntity(ctx.source, resolved.binding.id);
      tableKeys.push(entity ? entity.defKey : resolved.binding.id);
    }
  });
  if (problems.length) return {issues: problems, reads};
  const defKey = text(args.defKey).trim();
  const defName = text(args.defName).trim();
  if (!defKey) return {issues: [blocking('REQUIRED_INPUT_MISSING', 'diagram defKey is empty')], reads};
  if (!defName) return {issues: [blocking('REQUIRED_INPUT_MISSING', 'diagram defName is empty')], reads};
  const clash = (ctx.source.diagrams || [])
    .find(diagram => normalized(diagram.defKey) === normalized(defKey) && defKey !== '');
  if (clash) {
    return {issues: [blocking('DUPLICATE_CODE',
      `diagram defKey already exists: ${defKey}`, {existingId: clash.id})], reads};
  }
  // Deterministic local layout: grid by declaration order; the renderer
  // recomputes node size/ports from the model snapshot.
  const cells = tableIds.map((entityId, index) => ({
    id: ctx.allocateId(),
    shape: 'table',
    originKey: entityId,
    type: 'P',
    position: {
      x: DIAGRAM_ORIGIN + (index % DIAGRAM_COLUMNS) * DIAGRAM_CELL_WIDTH,
      y: DIAGRAM_ORIGIN + Math.floor(index / DIAGRAM_COLUMNS) * DIAGRAM_CELL_HEIGHT,
    },
  }));
  const diagramId = ctx.allocateId();
  const diagram = {
    id: diagramId,
    defKey,
    defName,
    comment: '',
    relationType: 'field',
    canvasData: {cells},
  };
  ctx.replaceSource(appendObjectWithOptionalCategory(ctx.source, 'diagram', diagram, null));
  ctx.bind(args.localKey, {collection: 'diagrams', id: diagramId});
  ctx.writeResource(`diagrams/${diagramId}`);

  return {
    issues: [],
    reads,
    changes: [{
      opId: ctx.op.opId,
      kind: 'create',
      target: {collection: 'diagrams', id: diagramId, localKey: args.localKey},
      after: {defKey, defName, tableCount: tableIds.length, tables: tableKeys},
    }],
    undo: [{type: 'removeObject', collection: 'diagrams', id: diagramId, memberType: 'diagram'}],
    objects: [{opId: ctx.op.opId, collection: 'diagrams', id: diagramId, localKey: args.localKey}],
  };
};

// ---- model.foreignKey.create ----
const PORT_OUT = id => `${id}%out`;
const PORT_IN = id => `${id}%in`;

const diagramContainsBoth = (diagram, sourceId, targetId) => {
  const cells = diagram?.canvasData?.cells || [];
  const keys = cells.filter(cell => cell.shape === 'table').map(cell => cell.originKey);
  return keys.includes(sourceId) && keys.includes(targetId);
};

const tableCellOf = (diagram, entityId) =>
  (diagram?.canvasData?.cells || []).find(cell => cell.shape === 'table' && cell.originKey === entityId)
   || null;

const edgeExists = (diagram, sourcePort, targetPort) =>
  (diagram?.canvasData?.cells || []).some((cell) => {
    if (cell.shape !== 'erdRelation') return false;
    const a = cell.source || {};
    const b = cell.target || {};
    return (a.port === sourcePort && b.port === targetPort)
      || (a.port === targetPort && b.port === sourcePort);
  });

const resolveFieldList = (ctx, refs, entity, entityLabel, problems) => refs.map((ref) => {
  const resolved = ctx.resolveRef(ref);
  if (!resolved.ok) {
    problems.push(blocking(resolved.code, resolved.message));
    return null;
  }
  if (resolved.binding.collection !== 'fields') {
    problems.push(blocking('REFERENCE_UNRESOLVED', `${entityLabel} field ref must target a field`));
    return null;
  }
  if (resolved.binding.owner.id !== entity.id) {
    problems.push(blocking('OWNER_COLLISION',
      `field ${resolved.binding.fieldKey || resolved.binding.id} belongs to ${resolved.binding.owner.collection}/${resolved.binding.owner.id}, not ${entityLabel}`));
    return null;
  }
  const field = (entity.fields || []).find(item => item.id === resolved.binding.id);
  if (!field) {
    problems.push(blocking('REFERENCE_UNRESOLVED',
      `field ${resolved.binding.id} not found on ${entityLabel}`));
    return null;
  }
  return field;
});

export const runForeignKeyCreate = (args, ctx) => {
  const problems = [];
  const warnings = [];
  const readSet = new Set(['entities', 'diagrams']);
  ctx.readResource('entities');
  const sourceRef = ctx.resolveRef(args.sourceTable);
  const targetRef = ctx.resolveRef(args.targetTable);
  if (!sourceRef.ok) return {issues: [blocking(sourceRef.code, sourceRef.message)], reads: [...readSet]};
  if (!targetRef.ok) return {issues: [blocking(targetRef.code, targetRef.message)], reads: [...readSet]};
  if (sourceRef.binding.collection !== ENTITY_COLLECTION
    || targetRef.binding.collection !== ENTITY_COLLECTION) {
    return {
      issues: [blocking('REFERENCE_UNRESOLVED', 'foreign keys connect physical entities')],
      reads: [...readSet],
    };
  }
  const sourceEntity = findEntity(ctx.source, sourceRef.binding.id);
  const targetEntity = findEntity(ctx.source, targetRef.binding.id);
  if (!sourceEntity || !targetEntity) {
    return {issues: [blocking('REFERENCE_UNRESOLVED', 'FK endpoint entity missing')], reads: [...readSet]};
  }
  const sourceFields = resolveFieldList(ctx, args.sourceFields, sourceEntity,
    `source ${sourceEntity.defKey}`, problems);
  const targetFields = resolveFieldList(ctx, args.targetFields, targetEntity,
    `target ${targetEntity.defKey}`, problems);
  if (problems.length) return {issues: problems, reads: [...readSet]};
  if (sourceFields.some(field => field === null) || targetFields.some(field => field === null)) {
    return {issues: [blocking('REFERENCE_UNRESOLVED', 'FK field resolution failed')], reads: [...readSet]};
  }
  if (sourceFields.length !== targetFields.length) {
    return {
      issues: [blocking('REQUIRED_INPUT_MISSING',
        'sourceFields and targetFields must have equal length')],
      reads: [...readSet],
    };
  }
  if (sourceFields.length === 0) {
    return {
      issues: [blocking('REQUIRED_INPUT_MISSING',
        'sourceFields/targetFields must reference at least one field pair')],
      reads: [...readSet],
    };
  }
  // Composite FKs are blocked, not silently degraded: the native correlation
  // contract (calcCorrelations / json2code DDL rendering) expresses exactly one
  // myField/refField pair per relation edge, so extra pairs could not be saved
  // faithfully — neither as one entry nor as several (several entries would
  // diverge from the single edge the diagram derives and render N independent
  // single-column FKs).
  if (sourceFields.length > 1) {
    return {
      issues: [blocking('COMPOSITE_FK_UNSUPPORTED',
        `composite foreign keys are not expressible in the native correlation `
        + `contract (one field pair per relation edge); got ${sourceFields.length} field pairs`)],
      reads: [...readSet],
    };
  }
  for (let i = 0; i < sourceFields.length; i += 1) {
    const fromField = sourceFields[i];
    const toField = targetFields[i];
    if (normalized(fromField.type) !== normalized(toField.type)) {
      problems.push(blocking('TYPE_MISMATCH',
        `FK type mismatch: ${sourceEntity.defKey}.${fromField.defKey} (${fromField.type}) `
        + `vs ${targetEntity.defKey}.${toField.defKey} (${toField.type})`));
    } else if (String(fromField.len) !== String(toField.len)
      || String(fromField.scale) !== String(toField.scale)) {
      warnings.push(warning('LENGTH_MISMATCH',
        `FK length differs: ${fromField.defKey}(${fromField.len},${fromField.scale}) `
        + `vs ${toField.defKey}(${toField.len},${toField.scale})`));
    }
  }
  if (problems.length) return {issues: problems, warnings, reads: [...readSet]};

  // Host diagram: a diagram created earlier in this plan that the FK op
  // explicitly depends on, otherwise the unique existing diagram containing
  // both endpoint tables. Ambiguity or absence blocks — never a ghost diagram.
  let hostDiagram = null;
  const planHosts = [];
  ctx.opClosure().forEach((dep) => {
    if (dep.op.command !== 'model.diagram.create') return;
    const binding = ctx.bindingOf(dep.op.args?.localKey);
    if (!binding || binding.collection !== 'diagrams') return;
    const diagram = (ctx.source.diagrams || []).find(item => item.id === binding.id);
    if (diagram && diagramContainsBoth(diagram, sourceEntity.id, targetEntity.id)) {
      planHosts.push(diagram);
    }
  });
  if (planHosts.length > 1) {
    return {
      issues: [blocking('CONTEXT_AMBIGUOUS',
        'multiple dependency diagrams host both endpoints; pick one explicitly')],
      reads: [...readSet],
    };
  }
  if (planHosts.length === 1) {
    hostDiagram = planHosts[0];
  } else {
    const hosts = (ctx.source.diagrams || [])
      .filter(diagram => diagramContainsBoth(diagram, sourceEntity.id, targetEntity.id));
    if (hosts.length === 0) {
      return {
        issues: [blocking('FK_NO_HOST_DIAGRAM',
          'no diagram contains both endpoint tables; compose model.diagram.create first or open an existing diagram')],
        reads: [...readSet],
      };
    }
    if (hosts.length > 1) {
      return {
        issues: [blocking('CONTEXT_AMBIGUOUS',
          'multiple diagrams host both endpoints; FK needs a unique host',
          {candidates: hosts.map(diagram => ({id: diagram.id, defKey: diagram.defKey}))})],
        reads: [...readSet],
      };
    }
    hostDiagram = hosts[0];
  }
  ctx.readResource(`diagrams/${hostDiagram.id}/canvasData`);
  readSet.add(`diagrams/${hostDiagram.id}/canvasData`);

  const sourceCell = tableCellOf(hostDiagram, sourceEntity.id);
  const targetCell = tableCellOf(hostDiagram, targetEntity.id);
  if (!sourceCell || !targetCell) {
    return {issues: [blocking('FK_NO_HOST_DIAGRAM', 'host diagram lacks table cells for endpoints')], reads: [...readSet]};
  }
  // One edge per endpoint pair. Edge direction is 子表→父表 (source=child OUT
  // port, target=parent IN port) with relation 'n:1': datasource_util
  // .calcCorrelations resolves relation[0]/source into myEntity/myRows
  // （子表 n 行引用父表 1 行）, matching the platform's existing FK
  // correlation convention (C9).
  const childPort = PORT_OUT(sourceFields[0].id);
  const parentPort = PORT_IN(targetFields[0].id);
  // Host-native correlation for this FK, written in the same pure transaction
  // as the edge: updateAllData only derives correlations from diagram tabs
  // (flag=true); with no tab open it persists the candidate verbatim, so the
  // candidate itself must carry the metadata the host natively needs. Fields
  // mirror the calcCorrelations contract exactly (myField/refField are field
  // ids from the ports, innerType always '') so a later tab-derived save
  // reproduces the identical entry.
  const correlationEntry = {
    myField: sourceFields[0].id,
    refEntity: targetEntity.id,
    refField: targetFields[0].id,
    myRows: 'n',
    refRows: '1',
    innerType: '',
  };
  const sameCorrelation = entry => !!entry
    && entry.myField === correlationEntry.myField
    && entry.refEntity === correlationEntry.refEntity
    && entry.refField === correlationEntry.refField
    && String(entry.myRows) === correlationEntry.myRows
    && String(entry.refRows) === correlationEntry.refRows;
  const beforeCorrelations = sourceEntity.correlations || [];
  const alreadyCorrelated = beforeCorrelations.some(sameCorrelation);
  const withChildCorrelation = (source) => {
    if (alreadyCorrelated) return source;
    return {
      ...source,
      entities: (source.entities || []).map(item => (item.id === sourceEntity.id
        ? {...item, correlations: (item.correlations || []).concat([correlationEntry])}
        : item)),
    };
  };
  const correlationChange = () => ({
    opId: ctx.op.opId,
    kind: 'update',
    target: {collection: ENTITY_COLLECTION, id: sourceEntity.id, path: 'correlations'},
    before: {correlationCount: beforeCorrelations.length},
    after: {
      correlationCount: beforeCorrelations.length + 1,
      addedCorrelation: {
        myField: sourceFields[0].defKey,
        refEntity: targetEntity.defKey,
        refField: targetFields[0].defKey,
        myRows: correlationEntry.myRows,
        refRows: correlationEntry.refRows,
      },
    },
  });
  const correlationUndo = () => (alreadyCorrelated ? [] : [{
    type: 'restoreEntityCorrelations',
    entityId: sourceEntity.id,
    correlations: beforeCorrelations,
  }]);

  if (edgeExists(hostDiagram, childPort, parentPort)) {
    ctx.bind(args.localKey, {
      collection: 'diagramEdge', id: null, reused: true,
      diagramId: hostDiagram.id,
    });
    const changes = [{
      opId: ctx.op.opId,
      kind: 'reuse',
      target: {collection: 'diagrams', id: hostDiagram.id},
      after: {reused: true, message: 'identical FK edge already present'},
    }];
    let undo = [];
    if (alreadyCorrelated) {
      return {
        issues: [],
        warnings,
        reads: [...readSet],
        changes,
        undo,
        objects: [{opId: ctx.op.opId, collection: 'diagramEdge', id: null,
          localKey: args.localKey, reused: true, diagramId: hostDiagram.id}],
      };
    }
    // Edge already present but the child entity lacks the correlation (e.g. a
    // project saved before correlations were written transactionally): heal
    // the metadata instead of reporting a reuse that would keep the file
    // non-functional for DDL generation.
    ctx.replaceSource(withChildCorrelation(ctx.source));
    ctx.writeResource(`entities/${sourceEntity.id}`);
    changes.push(correlationChange());
    undo = correlationUndo();
    return {
      issues: [],
      warnings,
      reads: [...readSet],
      changes,
      undo,
      objects: [{opId: ctx.op.opId, collection: 'diagramEdge', id: null,
        localKey: args.localKey, reused: true, diagramId: hostDiagram.id}],
    };
  }

  const edgeId = ctx.allocateId();
  const edge = {
    id: edgeId,
    shape: 'erdRelation',
    relation: 'n:1',
    defName: text(args.name),
    source: {cell: sourceCell.id, port: childPort},
    target: {cell: targetCell.id, port: parentPort},
  };
  const beforeCells = hostDiagram.canvasData?.cells || [];
  const nextDiagram = {
    ...hostDiagram,
    canvasData: {...hostDiagram.canvasData, cells: beforeCells.concat([edge])},
  };
  ctx.replaceSource(withChildCorrelation({
    ...ctx.source,
    diagrams: (ctx.source.diagrams || []).map(item => (item.id === hostDiagram.id ? nextDiagram : item)),
  }));
  ctx.bind(args.localKey, {collection: 'diagramEdge', id: edgeId, diagramId: hostDiagram.id});
  ctx.writeResource(`diagrams/${hostDiagram.id}/canvasData`);
  if (!alreadyCorrelated) ctx.writeResource(`entities/${sourceEntity.id}`);

  return {
    issues: [],
    warnings,
    reads: [...readSet],
    changes: [{
      opId: ctx.op.opId,
      kind: 'update',
      target: {collection: 'diagrams', id: hostDiagram.id, path: 'canvasData'},
      before: {cellCount: beforeCells.length},
      after: {
        cellCount: beforeCells.length + 1,
        addedEdge: {
          id: edgeId,
          name: edge.defName,
          relation: edge.relation,
          source: `${sourceEntity.defKey}.${sourceFields[0].defKey}`,
          target: `${targetEntity.defKey}.${targetFields[0].defKey}`,
          columns: sourceFields.map((field, i) => ({
            source: field.defKey, target: targetFields[i].defKey,
          })),
        },
      },
    }].concat(alreadyCorrelated ? [] : [correlationChange()]),
    undo: [{type: 'restoreDiagramCells', diagramId: hostDiagram.id, cells: beforeCells}]
      .concat(correlationUndo()),
    objects: [{opId: ctx.op.opId, collection: 'diagramEdge', id: edgeId,
      localKey: args.localKey, diagramId: hostDiagram.id}],
  };
};
