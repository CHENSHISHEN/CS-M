// Plan executor: preview (dry-run on the current snapshot) and apply
// (guarded, atomic, idempotent). All handlers are pure, so "apply" reruns the
// identical pipeline after guards pass — a failing operation discards the
// whole group and the caller's dataSource object is never partially mutated.
import {verifyPlanBasics, isPlanExpired} from './operationPlan.js';
import {verifyReadSet, fingerprintEntries, isKnownResource, normalizeResource} from './fingerprint.js';
import {createResolver} from './objectRef.js';
import {getCommand} from './registry.js';
import {blocking} from './commands/shared.js';

const DEFAULT_ID_ALLOCATOR = () => `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export const createSequentialIdAllocator = (prefix = 'seq') => {
  let counter = 0;
  return () => `${prefix}_${(counter += 1)}`;
};

// Per-op execution context handed to command handlers.
const createOpContext = (execution, op, reachableOps) => {
  const reachableLocalKeys = new Set();
  reachableOps.forEach((dep) => {
    const args = dep.op?.args;
    if (args?.localKey) reachableLocalKeys.add(args.localKey);
    if (Array.isArray(args?.fields)) args.fields.forEach(field => reachableLocalKeys.add(field?.localKey));
    if (Array.isArray(args?.rules)) args.rules.forEach(rule => reachableLocalKeys.add(rule?.localKey));
  });
  const {resolve} = createResolver(execution.source, execution.bindings, reachableLocalKeys);
  return {
    op,
    get source() {
      return execution.source;
    },
    replaceSource: (next) => {
      execution.source = next;
    },
    allocateId: execution.allocateId,
    bind: (key, binding) => {
      if (key) execution.bindings.set(key, binding);
    },
    bindingOf: key => execution.bindings.get(key) || null,
    resolveRef: ref => resolve(ref),
    readResource: resource => execution.readResources.add(resource),
    writeResource: resource => execution.writeResources.add(resource),
    opClosure: () => reachableOps.filter(dep => dep.op && dep.op !== op),
  };
};

// Transitive dependsOn closure of an operation (including itself).
const closureOf = (operations, opId) => {
  const byId = new Map(operations.map(op => [op.opId, op]));
  const seen = new Map();
  const visit = (id) => {
    if (seen.has(id)) return;
    const op = byId.get(id);
    if (!op) return;
    seen.set(id, op);
    (op.dependsOn || []).forEach(visit);
  };
  visit(opId);
  return [...seen.values()].map(op => ({op}));
};

// Deterministic local read dependencies per command, derived from the plan
// itself (command name + statically visible existing refs). The AI never
// supplies the readSet: collectReadSet computes it from these rules so a
// later change to a related library type / catalog / same-name standard
// expires the plan, while untouched project content stays mergeable.
const COLLECTION_RESOURCES = {
  entities: ['entities'],
  logicEntities: ['logicEntities'],
  conceptEntities: ['conceptEntities'],
  views: ['views'],
  dicts: ['dicts'],
  wordRoots: ['wordRoots'],
  standardGroups: ['standardFields'],
  standardFields: ['standardFields'],
  dataTypeMappings: ['dataTypeMappings'],
  dataTypeSupports: ['dataTypeSupports'],
  modelDatabases: ['modelDatabases'],
};

const resourcesOfExistingRef = (ref) => {
  if (!ref || ref.kind !== 'existing') return [];
  if (ref.collection === 'fields' && ref.owner) {
    return [`${ref.owner.collection}/${ref.owner.id}/fields`];
  }
  if (ref.collection === 'catalogCategories') {
    return ['catalogCategories', `catalogCategory/${ref.id}/members`];
  }
  return COLLECTION_RESOURCES[ref.collection] || [];
};

const refsOfCommand = (command, args) => {
  switch (command) {
    case 'model.table.create':
      return [args.dbType, args.database, args.category];
    case 'model.field.add':
      return [args.table];
    case 'model.foreignKey.create':
      return [args.sourceTable, args.targetTable]
        .concat(args.sourceFields || []).concat(args.targetFields || []);
    case 'model.diagram.create':
      return args.tables || [];
    case 'standard.root.create':
      return [args.baseType];
    case 'standard.field.create':
      return [args.group, args.baseType].concat(args.wordRoots || []);
    case 'quality.modelRuleSet.create':
      return (args.targets || []).concat(
        (args.rules || []).reduce((refs, rule) => refs.concat(rule.predicate?.standardRefs || []), []));
    default:
      return [];
  }
};

const collectReadResources = (plan) => {
  const resources = new Set();
  (plan.operations || []).forEach((op) => {
    if (!getCommand(op.command)) return;
    resources.add('entities');
    resources.add('dataTypeSupports');
    resources.add('dataTypeMappings');
    if (op.command === 'standard.group.create') resources.add('standardFields');
    if (op.command === 'standard.root.create' || op.command === 'standard.field.create') {
      resources.add('standardFields');
      resources.add('wordRoots');
    }
    if (op.command === 'model.diagram.create' || op.command === 'model.foreignKey.create') {
      resources.add('diagrams');
    }
    if (op.command === 'quality.modelRuleSet.create') resources.add('profile.quality');
    // Every statically visible existing ref widens the dependency to the
    // collection(s) actually read at execution time.
    refsOfCommand(op.command, op.args || {}).forEach((ref) => {
      resourcesOfExistingRef(ref).forEach(resource => resources.add(resource));
    });
  });
  return [...resources];
};

// Host helper: build the readSet a plan needs against the current snapshot.
export const collectReadSet = (dataSource, plan) =>
  fingerprintEntries(dataSource, collectReadResources(plan));

const execute = (dataSource, plan, options) => {
  const execution = {
    source: dataSource,
    bindings: new Map(),
    readResources: new Set(),
    writeResources: new Set(),
    allocateId: options?.idAllocator || DEFAULT_ID_ALLOCATOR,
  };
  const basics = verifyPlanBasics(plan);
  const issues = [];
  if (!basics.ok) {
    return {ok: false, issues: basics.problems.map(problem => blocking(
      problem.code || 'OUTPUT_SCHEMA_INVALID', JSON.stringify(problem)))};
  }
  // Only modeling-platform commands are registered in this core.
  const drawingOps = (plan.operations || []).filter(op => op.command.startsWith('drawing.'));
  if (plan.scope.platform !== 'modeling' || drawingOps.length) {
    issues.push(blocking('CAPABILITY_UNAVAILABLE',
      'drawing-platform plans are not executable in the modeling core'));
    return {ok: false, issues};
  }
  const unknownOps = (plan.operations || []).filter(op => !getCommand(op.command));
  if (unknownOps.length) {
    return {ok: false, issues: [blocking('UNKNOWN_COMMAND',
      `unknown command: ${unknownOps.map(op => op.command).join(', ')}`)]};
  }
  // readSet staleness: fingerprints must match the current snapshot.
  if (options?.checkReadSet !== false) {
    const verification = verifyReadSet(dataSource, plan.readSet);
    verification.stale.forEach(entry => issues.push(blocking('PLAN_STALE',
      `read resource changed since planning: ${entry.resource}`)));
    verification.unknown.forEach(resource => issues.push(blocking('UNKNOWN_RESOURCE',
      `readSet resource not understood: ${resource}`)));
    if (issues.length) return {ok: false, issues};
  }
  const warnings = [];
  const changes = [];
  const undo = [];
  const objects = [];
  const dependencies = [];
  const byId = new Map(plan.operations.map(op => [op.opId, op]));
  for (const opId of basics.order) {
    const op = byId.get(opId);
    const command = getCommand(op.command);
    const ctx = createOpContext(execution, op, closureOf(plan.operations, opId));
    (op.dependsOn || []).forEach(dep => dependencies.push({
      from: op.opId, to: dep, reason: 'dependsOn',
    }));
    const result = command.run(op.args, ctx);
    (result.issues || []).forEach(problem => issues.push(problem));
    (result.warnings || []).forEach(problem => warnings.push(problem));
    (result.changes || []).forEach(change => changes.push(change));
    (result.undo || []).forEach(action => undo.push(action));
    (result.objects || []).forEach(object => objects.push(object));
    if (result.issues && result.issues.some(problem => problem.level === 'blocking')) {
      return {ok: false, issues, warnings};
    }
  }
  // Guard: every written resource must be a known, fingerprintable slice.
  // An unknown write resource can never be verified by undo post-conditions,
  // so the whole execution refuses instead of silently skipping protection.
  execution.writeResources.forEach((resource) => {
    if (!isKnownResource(normalizeResource(resource))) {
      issues.push(blocking('UNKNOWN_RESOURCE',
        `writeSet resource not understood: ${resource}`));
    }
  });
  if (issues.length) return {ok: false, issues, warnings};
  return {
    ok: true,
    issues,
    warnings,
    changes,
    undo,
    objects,
    dependencies,
    bindings: [...execution.bindings.entries()].map(([key, binding]) => ({key, ...binding})),
    nextSource: execution.source,
    readResources: [...execution.readResources],
    writeResources: [...execution.writeResources],
  };
};

const summarizeCounts = (changes) => {
  const counts = {create: 0, update: 0, remove: 0, reuse: 0};
  changes.forEach((change) => {
    if (counts[change.kind] !== undefined) counts[change.kind] += 1;
  });
  return counts;
};

// Stage A — preview: run everything on the given snapshot and return the
// reviewable diff. Never mutates the caller's dataSource.
// options: {idAllocator, checkReadSet?, includeDataSource?} — idAllocator and
// checkReadSet flow into execute; includeDataSource (GATEWAY-R1) additionally
// exposes the computed next snapshot as candidate `dataSource` so callers can
// render the real result without any host commit. Default output is unchanged.
export const previewPlan = (dataSource, plan, options) => {
  const run = execute(dataSource, plan, options);
  if (!run.ok) {
    return {
      planId: plan?.planId,
      planHash: plan?.planHash,
      transactionDomain: 'modeling-project',
      changes: [],
      dependencies: [],
      blockingIssues: run.issues,
      warnings: run.warnings || [],
      counts: summarizeCounts([]),
      persistenceMode: 'project-manual-save',
      bindings: [],
    };
  }
  return {
    planId: plan.planId,
    planHash: plan.planHash,
    transactionDomain: 'modeling-project',
    changes: run.changes,
    dependencies: run.dependencies,
    blockingIssues: run.issues,
    warnings: run.warnings,
    counts: summarizeCounts(run.changes),
    persistenceMode: 'project-manual-save',
    bindings: run.bindings,
    ...(options?.includeDataSource === true ? {dataSource: run.nextSource} : {}),
  };
};

// Stage B — apply. Guards run in order; only then the pure pipeline executes.
// Idempotent by commandId: a replay returns the original receipt without
// touching the dataSource again.
export const applyPlan = (dataSource, plan, options = {}) => {
  const context = options.context || {};
  const fail = (code, message, extra) => ({
    ok: false, code, message, issues: extra || [], dataSource,
  });
  if (!options.confirmationId) {
    return fail('CONFIRMATION_REQUIRED', 'apply needs a host-issued confirmationId');
  }
  if (context.readonly) {
    return fail('READ_ONLY', 'project is read-only; preview stays available');
  }
  if (context.projectSessionId && plan.scope.projectSessionId
    && context.projectSessionId !== plan.scope.projectSessionId) {
    return fail('PROJECT_CHANGED', 'plan was built for another project session');
  }
  if (context.baseVersion && plan.baseVersion && context.baseVersion !== plan.baseVersion) {
    return fail('PLAN_STALE', `baseVersion changed: plan ${plan.baseVersion}, current ${context.baseVersion}`);
  }
  const now = context.now === undefined ? Date.now() : context.now;
  if (isPlanExpired(plan, now)) {
    return fail('PLAN_STALE', `plan expired at ${plan.expiresAt}`);
  }
  const ledger = options.ledger;
  const commandId = options.commandId;
  if (!commandId) return fail('CONFIRMATION_REQUIRED', 'apply needs a commandId');
  if (ledger) {
    const existing = ledger.getReceiptByCommandId(commandId);
    if (existing) {
      if (existing.planHash !== plan.planHash) {
        return fail('PLAN_STALE',
          'this commandId already applied a different plan; re-confirm the new plan');
      }
      return {ok: true, replayed: true, dataSource, receipt: existing};
    }
  }
  const run = execute(dataSource, plan, options);
  if (!run.ok) {
    return fail('APPLY_FAILED', 'plan validation failed', run.issues);
  }
  const receipt = {
    commandId,
    planId: plan.planId,
    planHash: plan.planHash,
    state: 'applied',
    objects: run.objects,
    projectSessionId: plan.scope.projectSessionId,
    afterVersion: `${plan.baseVersion}+${commandId}`,
    undo: {available: true, token: commandId},
    persistence: {state: 'dirty'},
  };
  if (ledger) {
    ledger.record({
      token: commandId,
      commandId,
      planId: plan.planId,
      planHash: plan.planHash,
      appliedAt: new Date(now).toISOString(),
      writeResources: run.writeResources,
      afterFingerprints: fingerprintEntries(run.nextSource, run.writeResources),
      inverse: run.undo,
      receipt,
    });
  }
  return {ok: true, dataSource: run.nextSource, receipt, preview: {
    changes: run.changes,
    warnings: run.warnings,
    bindings: run.bindings,
  }};
};
