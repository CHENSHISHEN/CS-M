// Standard-library write candidates: standard.group.create,
// standard.root.create, standard.field.create. Reuse semantics follow the
// existing library pure functions: word-root identity is the (defName,
// defKey) pair; standard-field codes are globally unique (normalized);
// duplicates bind to the existing item and are reported as reuse, never
// silently overwritten or skipped.
import {
  isValidCode, composeFullName,
} from '../../data_standard_library.js';
import {validateWordRoots} from '../../field_recommendation.js';
import {text, normalized, blocking, warning} from './shared.js';

const wordRoots = source => source?.profile?.fieldRecommendation?.wordRoots || [];

// ---- standard.group.create ----
export const runGroupCreate = (args, ctx) => {
  const reads = ['standardFields'];
  ctx.readResource('standardFields');
  const defKey = text(args.defKey).trim();
  const defName = text(args.defName).trim();
  if (!defKey || !defName) {
    return {issues: [blocking('REQUIRED_INPUT_MISSING', 'group defKey/defName required')], reads};
  }
  if (!isValidCode(defKey)) {
    return {issues: [blocking('INVALID_CODE', `group defKey is not a legal code: ${defKey}`)], reads};
  }
  const groups = ctx.source.standardFields || [];
  const existing = groups.find(group => normalized(group.defKey) === normalized(defKey));
  if (existing) {
    // Explicit reuse: bind the local key to the existing group.
    ctx.bind(args.localKey, {collection: 'standardGroups', id: existing.id, reused: true});
    return {
      issues: [],
      warnings: [warning('REUSED_EXISTING',
        `standard group already exists: ${defKey}`, {existingId: existing.id})],
      reads,
      changes: [{
        opId: ctx.op.opId,
        kind: 'reuse',
        target: {collection: 'standardGroups', id: existing.id, localKey: args.localKey},
        after: {reused: true, defKey: existing.defKey, defName: existing.defName},
      }],
      undo: [],
      objects: [{opId: ctx.op.opId, collection: 'standardGroups', id: existing.id,
        localKey: args.localKey, reused: true}],
    };
  }
  const groupId = ctx.allocateId();
  const group = {id: groupId, defKey, defName, fields: []};
  ctx.replaceSource({
    ...ctx.source,
    standardFields: groups.concat([group]),
  });
  ctx.bind(args.localKey, {collection: 'standardGroups', id: groupId});
  ctx.writeResource(`standardFields/${groupId}`);
  return {
    issues: [],
    reads,
    changes: [{
      opId: ctx.op.opId,
      kind: 'create',
      target: {collection: 'standardGroups', id: groupId, localKey: args.localKey},
      after: {defKey, defName, fieldCount: 0},
    }],
    undo: [{type: 'removeStandardGroup', groupId}],
    objects: [{opId: ctx.op.opId, collection: 'standardGroups', id: groupId, localKey: args.localKey}],
  };
};

// ---- standard.root.create ----
export const runRootCreate = (args, ctx) => {
  const reads = ['wordRoots', 'dataTypeMappings'];
  ctx.readResource('wordRoots');
  ctx.readResource('dataTypeMappings');
  const defKey = text(args.defKey).trim();
  const defName = text(args.defName).trim();
  const fullName = text(args.fullName).trim();
  if (!defKey || !defName || !fullName) {
    return {issues: [blocking('REQUIRED_INPUT_MISSING', 'root defKey/defName/fullName required')], reads};
  }
  if (!isValidCode(defKey)) {
    return {issues: [blocking('INVALID_CODE', `root defKey is not a legal code: ${defKey}`)], reads};
  }
  let baseType = '';
  if (args.baseType !== undefined) {
    const resolved = ctx.resolveRef(args.baseType);
    if (!resolved.ok) return {issues: [blocking(resolved.code, resolved.message)], reads};
    if (resolved.binding.collection !== 'dataTypeMappings') {
      return {issues: [blocking('REFERENCE_UNRESOLVED', 'root baseType must reference a dataTypeMapping')], reads};
    }
    baseType = resolved.binding.id;
  }
  // Reuse follows importLibraryPackage semantics: same (name, code) pair.
  const existing = wordRoots(ctx.source)
    .find(root => normalized(root.defName) === normalized(defName)
      && normalized(root.defKey) === normalized(defKey));
  if (existing) {
    ctx.bind(args.localKey, {collection: 'wordRoots', id: existing.id, reused: true});
    const warnings = [warning('REUSED_EXISTING',
      `word root already exists: ${defName}(${defKey})`, {existingId: existing.id})];
    if (!text(existing.fullName).trim()) {
      warnings.push(warning('ROOT_FULL_NAME_PENDING',
        `existing root has no fullName; kept as stored`, {existingId: existing.id}));
    }
    return {
      issues: [],
      warnings,
      reads,
      changes: [{
        opId: ctx.op.opId,
        kind: 'reuse',
        target: {collection: 'wordRoots', id: existing.id, localKey: args.localKey},
        after: {reused: true, defKey: existing.defKey, defName: existing.defName},
      }],
      undo: [],
      objects: [{opId: ctx.op.opId, collection: 'wordRoots', id: existing.id,
        localKey: args.localKey, reused: true}],
    };
  }
  const rootId = ctx.allocateId();
  const root = {
    id: rootId,
    defKey,
    defName,
    fullName,
    baseType,
    len: '',
    scale: '',
  };
  const merged = wordRoots(ctx.source).concat([root]);
  const validated = validateWordRoots(merged, ctx.source);
  if (validated.error) {
    return {issues: [blocking('INVALID_WORD_ROOT', `word root validation failed: ${validated.error}`)], reads};
  }
  const composition = composeFullName([root]);
  if (!composition.valid) {
    return {issues: [blocking('INVALID_WORD_ROOT', `root fullName not usable for codes: ${fullName}`)], reads};
  }
  const profile = ctx.source.profile || {};
  const fieldRecommendation = {
    ...(profile.fieldRecommendation || {}),
    wordRoots: merged,
  };
  ctx.replaceSource({
    ...ctx.source,
    profile: {...profile, fieldRecommendation},
  });
  ctx.bind(args.localKey, {collection: 'wordRoots', id: rootId});
  ctx.writeResource('wordRoots');
  ctx.writeResource(`wordRoots/${rootId}`);
  return {
    issues: [],
    reads,
    changes: [{
      opId: ctx.op.opId,
      kind: 'create',
      target: {collection: 'wordRoots', id: rootId, localKey: args.localKey},
      after: {defKey, defName, fullName, baseType},
    }],
    undo: [{type: 'removeWordRoot', rootId}],
    objects: [{opId: ctx.op.opId, collection: 'wordRoots', id: rootId, localKey: args.localKey}],
  };
};

const findStandardFieldByKey = (source, defKey) => {
  const key = normalized(defKey);
  const groups = source.standardFields || [];
  for (const group of groups) {
    const field = (group.fields || []).find(item => normalized(item.defKey) === key);
    if (field) return {group, field};
  }
  return null;
};

// ---- standard.field.create ----
export const runStandardFieldCreate = (args, ctx) => {
  const reads = ['standardFields', 'wordRoots', 'dataTypeMappings'];
  ctx.readResource('standardFields');
  ctx.readResource('wordRoots');
  ctx.readResource('dataTypeMappings');
  const groupRef = ctx.resolveRef(args.group);
  if (!groupRef.ok) return {issues: [blocking(groupRef.code, groupRef.message)], reads};
  if (groupRef.binding.collection !== 'standardGroups') {
    return {issues: [blocking('REFERENCE_UNRESOLVED', 'standard field group ref must target standardGroups')], reads};
  }
  const baseTypeRef = ctx.resolveRef(args.baseType);
  if (!baseTypeRef.ok) return {issues: [blocking(baseTypeRef.code, baseTypeRef.message)], reads};
  if (baseTypeRef.binding.collection !== 'dataTypeMappings') {
    return {issues: [blocking('REFERENCE_UNRESOLVED', 'standard field baseType must reference a dataTypeMapping')], reads};
  }
  const defKey = text(args.defKey).trim();
  const defName = text(args.defName).trim();
  if (!defKey || !defName) {
    return {issues: [blocking('REQUIRED_INPUT_MISSING', 'field defKey/defName required')], reads};
  }
  if (!isValidCode(defKey)) {
    return {issues: [blocking('INVALID_CODE', `standard field defKey is not a legal code: ${defKey}`)], reads};
  }
  const rootIds = [];
  const rootObjects = [];
  const problems = [];
  (args.wordRoots || []).forEach((ref) => {
    const resolved = ctx.resolveRef(ref);
    if (!resolved.ok) {
      problems.push(blocking(resolved.code, resolved.message));
      return;
    }
    if (resolved.binding.collection !== 'wordRoots') {
      problems.push(blocking('REFERENCE_UNRESOLVED', 'wordRoots entries must reference word roots'));
      return;
    }
    const root = wordRoots(ctx.source).find(item => item.id === resolved.binding.id);
    if (!root) {
      problems.push(blocking('REFERENCE_UNRESOLVED', `word root missing: ${resolved.binding.id}`));
      return;
    }
    rootIds.push(root.id);
    rootObjects.push(root);
  });
  if (problems.length) return {issues: problems, reads};

  // Global code uniqueness across the whole library (importLibraryPackage
  // semantics); duplicates are explicit reuse, not overwrites.
  const existing = findStandardFieldByKey(ctx.source, defKey);
  if (existing) {
    ctx.bind(args.localKey, {collection: 'standardFields', id: existing.field.id, reused: true});
    return {
      issues: [],
      warnings: [warning('REUSED_EXISTING',
        `standard field code already exists: ${defKey}`,
        {existingId: existing.field.id, group: existing.group.defKey})],
      reads,
      changes: [{
        opId: ctx.op.opId,
        kind: 'reuse',
        target: {collection: 'standardFields', id: existing.field.id, localKey: args.localKey},
        after: {reused: true, defKey: existing.field.defKey, defName: existing.field.defName},
      }],
      undo: [],
      objects: [{opId: ctx.op.opId, collection: 'standardFields', id: existing.field.id,
        localKey: args.localKey, reused: true}],
    };
  }

  const composition = composeFullName(rootObjects);
  if (!composition.valid) {
    return {
      issues: [blocking('INVALID_WORD_ROOT',
        `word roots cannot compose a code (${composition.reason})`)],
      reads,
    };
  }
  const warnings = [];
  if (normalized(composition.value) !== normalized(defKey)) {
    warnings.push(warning('COMPOSITION_DIFFERS',
      `composed code ${composition.value} differs from declared ${defKey}; declared code is stored`));
  }

  const groupId = groupRef.binding.id;
  const groups = (ctx.source.standardFields || []).map(group => ({...group}));
  const group = groups.find(item => item.id === groupId);
  if (!group) {
    return {issues: [blocking('REFERENCE_UNRESOLVED', `standard group missing: ${groupId}`)], reads};
  }
  const fieldId = ctx.allocateId();
  const field = {
    id: fieldId,
    defKey,
    defName,
    baseType: baseTypeRef.binding.id,
    len: args.len === null || args.len === undefined ? '' : args.len,
    scale: args.scale === null || args.scale === undefined ? '' : args.scale,
    ...(text(args.comment) ? {comment: text(args.comment)} : {}),
    standardMeta: {wordRootRefs: rootIds},
  };
  const beforeFields = group.fields || [];
  group.fields = beforeFields.concat([field]);
  ctx.replaceSource({...ctx.source, standardFields: groups});
  ctx.bind(args.localKey, {collection: 'standardFields', id: fieldId});
  ctx.writeResource(`standardFields/${groupId}`);

  return {
    issues: [],
    warnings,
    reads,
    changes: [{
      opId: ctx.op.opId,
      kind: 'create',
      target: {collection: 'standardFields', id: fieldId, localKey: args.localKey},
      after: {
        group: group.defKey,
        defKey,
        defName,
        baseType: baseTypeRef.binding.id,
        wordRoots: rootObjects.map(root => `${root.defName}(${root.defKey})`),
      },
    }],
    undo: [{type: 'restoreGroupFields', groupId, fields: beforeFields}],
    objects: [{opId: ctx.op.opId, collection: 'standardFields', id: fieldId, localKey: args.localKey}],
  };
};
