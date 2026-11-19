// quality.modelRuleSet.create — writes profile.quality.modelRuleSets (schema
// version 1, ARCHITECTURE §8). Definitions are declarative only: enabled
// state travels explicitly, programCode/new Function never appear, and the
// namingRules legacy data is left untouched.
import {validateQualityRuleSet} from '../../quality/modelRules.js';
import {text, normalized, blocking} from './shared.js';

const collectionForRuleTarget = {
  physicalTable: 'entities',
  logicalEntity: 'logicEntities',
  conceptEntity: 'conceptEntities',
  field: 'fields',
};

export const runQualityRuleSetCreate = (args, ctx) => {
  const reads = ['profile.quality'];
  ctx.readResource('profile.quality');
  const problems = [];
  const scope = [];
  (args.targets || []).forEach((ref) => {
    const resolved = ctx.resolveRef(ref);
    if (!resolved.ok) {
      problems.push(blocking(resolved.code, resolved.message));
      return;
    }
    scope.push({collection: resolved.binding.collection, id: resolved.binding.id});
    ctx.readResource(resolved.binding.collection === 'fields'
      ? `${resolved.binding.owner.collection}/${resolved.binding.owner.id}/fields`
      : resolved.binding.collection);
    if (resolved.binding.collection === 'fields') {
      reads.push(`${resolved.binding.owner.collection}/${resolved.binding.owner.id}/fields`);
    } else {
      reads.push(resolved.binding.collection);
    }
  });
  if (problems.length) return {issues: problems, reads};

  // Every target's collection must match the rule targets it will be checked
  // against, so an enabled rule set cannot carry a scope it can never use.
  const targetCollections = new Set(scope.map(entry => entry.collection));
  (args.rules || []).forEach((rule) => {
    const expected = collectionForRuleTarget[rule.target];
    if (!targetCollections.has(expected)) {
      problems.push(blocking('INVALID_RULE_SET',
        `rule target ${rule.target} needs a ${expected} target in scope`));
    }
  });
  if (problems.length) return {issues: problems, reads};

  const draftRules = (args.rules || []).map(rule => ({
    id: rule.localKey,
    name: text(rule.name).trim(),
    severity: rule.severity,
    target: rule.target,
    predicate: rule.predicate,
  }));
  const draft = {
    name: text(args.name).trim(),
    enabled: args.enabled,
    scope,
    rules: draftRules,
  };
  const validation = validateQualityRuleSet(draft);
  if (validation.length) {
    return {issues: validation.map(problem => blocking('INVALID_RULE_SET', problem.message)), reads};
  }
  // standardMatch references must resolve now — unresolved bindings block
  // creation rather than failing later at run time (Q07).
  (args.rules || []).forEach((rule) => {
    if (rule.predicate?.op !== 'standardMatch') return;
    (rule.predicate.standardRefs || []).forEach((ref) => {
      const resolved = ctx.resolveRef(ref);
      if (!resolved.ok) {
        problems.push(blocking(resolved.code,
          `standardMatch reference failed: ${resolved.message}`));
        return;
      }
      // Collect what was actually read: standardMatch evaluation reads the
      // referenced standard/word-root collections at run time.
      const resource = resolved.binding.collection === 'fields'
        ? `${resolved.binding.owner.collection}/${resolved.binding.owner.id}/fields`
        : (resolved.binding.collection === 'standardGroups' ? 'standardFields'
          : resolved.binding.collection);
      ctx.readResource(resource);
      if (!reads.includes(resource)) reads.push(resource);
    });
  });
  if (problems.length) return {issues: problems, reads};

  const existing = ctx.source.profile?.quality?.modelRuleSets || [];
  if (existing.some(ruleSet => normalized(ruleSet.name) === normalized(draft.name))) {
    return {issues: [blocking('DUPLICATE_CODE',
      `model rule set name already exists: ${draft.name}`)], reads};
  }

  const ruleSetId = ctx.allocateId();
  const ruleSet = {
    id: ruleSetId,
    name: draft.name,
    enabled: draft.enabled,
    scope,
    rules: draft.rules.map(rule => ({...rule, id: ctx.allocateId()})),
  };
  const profile = ctx.source.profile || {};
  const quality = profile.quality && profile.quality.schemaVersion === 1
    ? {...profile.quality} : {schemaVersion: 1, modelRuleSets: [], dataRuleSets: []};
  quality.modelRuleSets = (quality.modelRuleSets || []).concat([ruleSet]);
  ctx.replaceSource({
    ...ctx.source,
    profile: {...profile, quality},
  });
  ctx.bind(args.localKey, {collection: 'modelRuleSets', id: ruleSetId});
  ctx.writeResource('profile.quality');

  return {
    issues: [],
    reads,
    changes: [{
      opId: ctx.op.opId,
      kind: 'create',
      target: {collection: 'modelRuleSets', id: ruleSetId, localKey: args.localKey},
      after: {
        name: ruleSet.name,
        enabled: ruleSet.enabled,
        targetCount: scope.length,
        ruleCount: ruleSet.rules.length,
        rules: ruleSet.rules.map(rule => ({
          name: rule.name, severity: rule.severity, target: rule.target, predicate: rule.predicate,
        })),
      },
    }],
    undo: [{type: 'restoreQuality', quality: profile.quality === undefined ? undefined : profile.quality}],
    objects: [{opId: ctx.op.opId, collection: 'modelRuleSets', id: ruleSetId, localKey: args.localKey}],
  };
};
