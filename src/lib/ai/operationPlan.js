// Operation-plan helpers: canonical plan hash, readSet digest, dependency DAG
// validation/ordering and partial selection with dependency closure.
import {hashJson, canonicalJson} from './hash.js';
import {validatePlanStructure} from './planSchema.js';

// planHash binds the exact content the user reviewed: the whole plan with the
// planHash property removed, canonically serialized (recursive key sort,
// array order preserved), SHA-256 lowercase hex.
export const computePlanHash = (plan) => {
  const {planHash, ...rest} = plan || {};
  return hashJson(rest);
};

// contextDigest is a digest of the readSet only (not a permission token).
export const computeContextDigest = (readSet) => {
  const entries = (readSet || [])
    .slice()
    .sort((a, b) => (a.resource < b.resource ? -1 : (a.resource > b.resource ? 1 : 0)))
    .map(entry => ({resource: entry.resource, fingerprint: entry.fingerprint}));
  return hashJson({readSet: entries});
};

// Returns {ok, order: [opId...]} — stable topological order (operations keep
// declaration order among ready nodes). Rejects unknown dependencies and cycles.
export const topologicalOpOrder = (operations) => {
  const byId = new Map((operations || []).map(op => [op.opId, op]));
  const problems = [];
  (operations || []).forEach((op) => {
    (op.dependsOn || []).forEach((dep) => {
      if (!byId.has(dep)) {
        problems.push({code: 'DEPENDENCY_UNKNOWN', opId: op.opId, dependency: dep});
      }
    });
  });
  if (problems.length) return {ok: false, problems};
  const order = [];
  const state = new Map(); // opId -> 'visiting' | 'done'
  const visit = (op, chain) => {
    const marked = state.get(op.opId);
    if (marked === 'done') return null;
    if (marked === 'visiting') {
      return {code: 'DEPENDENCY_CYCLE', chain: chain.concat(op.opId)};
    }
    state.set(op.opId, 'visiting');
    for (const dep of op.dependsOn || []) {
      const cycle = visit(byId.get(dep), chain.concat(op.opId));
      if (cycle) return cycle;
    }
    state.set(op.opId, 'done');
    order.push(op.opId);
    return null;
  };
  for (const op of operations || []) {
    const cycle = visit(op, []);
    if (cycle) return {ok: false, problems: [cycle]};
  }
  return {ok: true, order};
};

// All localKeys declared anywhere in the plan must be globally unique: op
// localKeys, field drafts, quality rules. Returns {ok, problems, keys: Set}.
export const collectPlanLocalKeys = (plan) => {
  const problems = [];
  const keys = new Set();
  const add = (key, where) => {
    if (!key || typeof key !== 'string') return;
    if (keys.has(key)) {
      problems.push({code: 'LOCAL_KEY_DUPLICATE', key, where});
      return;
    }
    keys.add(key);
  };
  (plan.operations || []).forEach((op) => {
    const args = op.args || {};
    if (args.localKey) add(args.localKey, op.opId);
    if (Array.isArray(args.fields)) args.fields.forEach(f => add(f?.localKey, op.opId));
    if (Array.isArray(args.rules)) args.rules.forEach(r => add(r?.localKey, op.opId));
  });
  return {ok: problems.length === 0, problems, keys};
};

// Partial selection: keep the chosen operations plus every transitive
// dependency. Produces a new plan with a fresh planHash; the old confirmation
// is void because the reviewed content changed.
export const selectOperations = (plan, selectedOpIds) => {
  const selection = new Set(selectedOpIds || []);
  const byId = new Map((plan.operations || []).map(op => [op.opId, op]));
  const keep = new Set();
  const visit = (opId) => {
    if (keep.has(opId)) return;
    keep.add(opId);
    (byId.get(opId)?.dependsOn || []).forEach(visit);
  };
  const unknown = [];
  selection.forEach((opId) => {
    if (!byId.has(opId)) unknown.push(opId);
    else visit(opId);
  });
  if (unknown.length) {
    return {ok: false, code: 'OPERATION_UNKNOWN', unknown};
  }
  const operations = (plan.operations || []).filter(op => keep.has(op.opId));
  if (!operations.length) {
    return {ok: false, code: 'SELECTION_EMPTY'};
  }
  const nextPlan = {...plan, operations};
  const structure = validatePlanStructure(nextPlan);
  if (!structure.ok) {
    return {ok: false, code: 'OUTPUT_SCHEMA_INVALID', problems: structure.problems};
  }
  return {ok: true, plan: {...nextPlan, planHash: computePlanHash(nextPlan)}};
};

// Full plan verification used by preview/apply entry: structure, DAG and
// local-key uniqueness. Structural problems carry OUTPUT_SCHEMA_INVALID.
export const verifyPlanBasics = (plan) => {
  const structure = validatePlanStructure(plan);
  if (!structure.ok) return {ok: false, problems: structure.problems};
  const dag = topologicalOpOrder(plan.operations);
  if (!dag.ok) return {ok: false, problems: dag.problems.map(p => ({code: p.code, ...p}))};
  const localKeys = collectPlanLocalKeys(plan);
  if (!localKeys.ok) return {ok: false, problems: localKeys.problems};
  const digest = computeContextDigest(plan.readSet);
  const problems = [];
  if (digest !== plan.contextDigest) {
    problems.push({code: 'CONTEXT_DIGEST_MISMATCH', expected: plan.contextDigest, actual: digest});
  }
  const hash = computePlanHash(plan);
  if (hash !== plan.planHash) {
    problems.push({code: 'PLAN_HASH_MISMATCH', expected: plan.planHash, actual: hash});
  }
  if (problems.length) return {ok: false, problems};
  return {ok: true, order: dag.order, localKeys: localKeys.keys};
};

export const isPlanExpired = (plan, now) => {
  const time = now === undefined ? Date.now() : now;
  const parsed = Date.parse(plan?.expiresAt);
  if (Number.isNaN(parsed)) return true;
  return parsed < time;
};

export const canonicalPlanText = (plan) => canonicalJson(plan);
