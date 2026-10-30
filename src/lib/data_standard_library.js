// Data standard library metadata: root references, full-name composition,
// exchange packages and dictionary import classification. Pure functions;
// callers persist results through the project dataSource.
import {validateWordRoots} from './field_recommendation';

const text = value => (value === undefined || value === null ? '' : String(value));
const normalized = value => text(value).normalize('NFKC').trim().toLocaleLowerCase();
export const CODE_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const isValidCode = value => CODE_PATTERN.test(text(value).trim());

// Full-name composition joins stored full names with '_' and keeps the
// original word spelling; every selected root must carry a full name and
// the joined value must stay a legal physical code. A stored full name may
// be a phrase ("Credit Card"): internal whitespace/hyphens are normalized
// to '_' for the generated code while the stored string stays untouched.
const phraseToken = value => text(value).trim()
  .replace(/[\s_-]+/g, '_').replace(/^_+|_+$/g, '');
export const composeFullName = (roots) => {
  if (!roots.length) return {value: '', valid: false, reason: 'empty'};
  const words = roots.map(root => text(root.fullName).trim());
  const missing = roots.filter((root, index) => !words[index]).map(root => root.defName);
  if (missing.length) return {value: '', valid: false, reason: 'missingFullName', missing};
  const value = words.map(phraseToken).filter(Boolean).join('_');
  if (!isValidCode(value)) return {value, valid: false, reason: 'invalidCode'};
  return {value, valid: true};
};

// Abbreviation preview for the combination editor (mirrors the default
// recommendation naming without importing UI state).
export const composeAbbreviation = roots => roots.map(root => text(root.defKey).trim()).join('_');

// A root referenced by any standard field cannot be deleted until the
// combination link is released; the confirmed field code stays untouched.
export const findRootReferences = (rootId, standardFields) => {
  const references = [];
  (standardFields || []).forEach((group) => {
    (group.fields || []).forEach((field) => {
      const refs = field.standardMeta?.wordRootRefs || [];
      if (refs.includes(rootId)) {
        references.push({groupId: group.id, groupKey: group.defKey, groupName: group.defName,
          fieldId: field.id, fieldKey: field.defKey, fieldName: field.defName});
      }
    });
  });
  return references;
};

const cleanStandardMeta = (meta, {keepRefs = true} = {}) => {
  if (!meta || typeof meta !== 'object') return undefined;
  const refs = keepRefs && Array.isArray(meta.wordRootRefs)
    ? meta.wordRootRefs.map(ref => text(ref).trim()).filter(Boolean) : undefined;
  const aliases = Array.isArray(meta.aliases)
    ? meta.aliases.map(alias => text(alias).trim()).filter(Boolean) : [];
  const source = meta.source && typeof meta.source === 'object' ? {
    name: text(meta.source.name).trim(), version: text(meta.source.version).trim(),
    sheet: text(meta.source.sheet).trim(), row: meta.source.row,
  } : {};
  const next = {};
  if (aliases.length) next.aliases = aliases;
  const scope = text(meta.scope).trim();
  if (scope) next.scope = scope;
  const industry = text(meta.industry).trim();
  if (industry) next.industry = industry;
  if (meta.frequent) next.frequent = true;
  if (refs) next.wordRootRefs = refs;
  const form = text(meta.namingForm).trim();
  if (form === 'abbreviation' || form === 'full') next.namingForm = form;
  if (Object.keys(source).some(key => source[key] !== '' && source[key] !== undefined)) {
    next.source = source;
  }
  return Object.keys(next).length ? next : undefined;
};

// Exchange package schemaVersion 1: roots plus standard fields. Import maps
// root IDs to fresh local IDs first, then rebuilds field references. Broken
// references are reported; callers decide to release them (keeping the
// confirmed field code) or abort. Existing items are never overwritten.
export const exportLibraryPackage = (roots, standardFields, source) => {
  const rootCheck = validateWordRoots(roots, source);
  if (rootCheck.error) return rootCheck;
  return {data: {
    schemaVersion: 1,
    // Export-time root IDs must travel in the package so the importer can
    // remap standard-field wordRootRefs to fresh local IDs.
    wordRoots: rootCheck.roots.map((root, index) => ({
      id: roots[index].id,
      defKey: root.defKey, defName: root.defName, len: root.len, scale: root.scale,
      baseTypeDefKey: source.dataTypeMapping?.mappings
        ?.find(item => item.id === root.baseType)?.defKey || '',
      ...(root.fullName ? {fullName: root.fullName} : {}),
      ...(root.referenceNames?.length ? {referenceNames: root.referenceNames} : {}),
      ...(root.standardMeta ? {standardMeta: root.standardMeta} : {}),
    })),
    standardFields: (standardFields || []).map(group => ({
      defKey: group.defKey, defName: group.defName,
      fields: (group.fields || []).map(field => ({
        defKey: field.defKey, defName: field.defName,
        ...(text(field.comment) ? {comment: field.comment} : {}),
        ...(field.defaultValue !== undefined && field.defaultValue !== '' ? {defaultValue: field.defaultValue} : {}),
        ...(field.baseType ? {baseTypeDefKey: source.dataTypeMapping?.mappings
          ?.find(item => item.id === field.baseType)?.defKey || ''} : {}),
        ...(field.len !== undefined && field.len !== '' ? {len: field.len} : {}),
        ...(field.scale !== undefined && field.scale !== '' ? {scale: field.scale} : {}),
        ...(field.standardMeta ? {standardMeta: {
          ...field.standardMeta,
          // Root references travel as export-time IDs; importer remaps them.
          ...(field.standardMeta.wordRootRefs?.length ? {wordRootRefs: field.standardMeta.wordRootRefs} : {}),
        }} : {}),
        ...(field.domain ? {domainDefKey: source.domains?.find(d => d.id === field.domain)?.defKey || ''} : {}),
      })),
    })),
  }};
};

export const importLibraryPackage = (data, source, makeId, {releaseUnresolved = false} = {}) => {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.wordRoots)
    || !Array.isArray(data.standardFields)) return {error: 'invalidPackage'};
  const currentRoots = source.profile?.fieldRecommendation?.wordRoots || [];
  const mappingsList = source.dataTypeMapping?.mappings || [];
  // A package base type must resolve to exactly one local mapping; unknown or
  // ambiguous bindings reject the whole import instead of silently clearing.
  const resolveType = (defKey) => {
    const hits = mappingsList.filter(item => item.defKey === defKey);
    return hits.length === 1 ? hits[0].id : null;
  };
  // Stage 1: roots. Reuse existing items when name+code already match.
  const idMap = new Map();
  const mergedRoots = currentRoots.map(root => ({...root}));
  for (const row of data.wordRoots) {
    const match = mergedRoots.find(item => normalized(item.defName) === normalized(row.defName)
      && normalized(item.defKey) === normalized(row.defKey));
    const localId = makeId();
    if (row.id) idMap.set(row.id, match ? match.id : localId);
    if (match) continue;
    if (row.baseTypeDefKey) {
      const resolved = resolveType(row.baseTypeDefKey);
      if (!resolved) return {error: 'unknownType', typeDefKey: row.baseTypeDefKey};
      mergedRoots.push({...row, id: localId, baseType: resolved});
    } else {
      mergedRoots.push({...row, id: localId, baseType: ''});
    }
  }
  const rootCheck = validateWordRoots(mergedRoots, source);
  if (rootCheck.error) return {error: rootCheck.error};
  // Stage 2: standard fields with remapped references.
  const currentFields = source.standardFields || [];
  const mergedFields = currentFields.map(group => ({...group, fields: (group.fields || []).map(f => ({...f}))}));
  const unresolved = [];
  const newGroups = [];
  // Code uniqueness spans the whole library, including groups staged by this
  // import; the first occurrence wins and later duplicates are skipped.
  const seenCodes = new Set(mergedFields.reduce((codes, group) =>
    codes.concat((group.fields || []).map(f => normalized(f.defKey))), []));
  for (const group of data.standardFields) {
    const target = mergedFields.find(item => normalized(item.defKey) === normalized(group.defKey));
    const container = target || {id: makeId(), defKey: group.defKey, defName: group.defName, fields: []};
    if (!target) newGroups.push(container);
    for (const field of (group.fields || [])) {
      const fieldCode = normalized(field.defKey);
      if (seenCodes.has(fieldCode)) continue; // default keeps the existing item, never overwrites
      let baseType = '';
      if (field.baseTypeDefKey) {
        baseType = resolveType(field.baseTypeDefKey);
        if (!baseType) return {error: 'unknownType', typeDefKey: field.baseTypeDefKey};
      }
      let domainId = '';
      if (field.domainDefKey) {
        const domain = source.domains?.find(d => d.defKey === field.domainDefKey);
        if (!domain) return {error: 'unknownDomain', domainDefKey: field.domainDefKey};
        domainId = domain.id;
      }
      seenCodes.add(fieldCode);
      const meta = field.standardMeta ? {...field.standardMeta} : {};
      if (Array.isArray(meta.wordRootRefs)) {
        const mapped = [];
        const broken = [];
        meta.wordRootRefs.forEach((ref) => {
          const local = idMap.get(ref) || mergedRoots.find(root => root.id === ref)?.id;
          if (local) mapped.push(local);
          else broken.push(ref);
        });
        if (broken.length) {
          unresolved.push({fieldKey: field.defKey, fieldName: field.defName, rootIds: broken});
          if (releaseUnresolved) {
            if (mapped.length) meta.wordRootRefs = mapped;
            else delete meta.wordRootRefs;
          }
        } else if (mapped.length) meta.wordRootRefs = mapped;
        else delete meta.wordRootRefs;
      }
      const cleanMeta = cleanStandardMeta(meta);
      container.fields.push({
        id: makeId(),
        defKey: field.defKey, defName: field.defName,
        ...(text(field.comment) ? {comment: field.comment} : {}),
        ...(field.defaultValue !== undefined && field.defaultValue !== '' ? {defaultValue: field.defaultValue} : {}),
        ...(baseType ? {baseType} : {}),
        ...(field.len !== undefined && field.len !== '' ? {len: field.len} : {}),
        ...(field.scale !== undefined && field.scale !== '' ? {scale: field.scale} : {}),
        ...(domainId ? {domain: domainId} : {}),
        ...(cleanMeta ? {standardMeta: cleanMeta} : {}),
      });
    }
  }
  if (unresolved.length && !releaseUnresolved) {
    return {error: 'unresolvedRefs', unresolved};
  }
  return {
    roots: rootCheck.roots,
    standardFields: mergedFields.concat(newGroups),
    unresolved: releaseUnresolved ? unresolved : [],
  };
};

// ---- Dictionary (Excel) import classification ----
// Rows come from the read-only workbook adapter; no inference of full names
// or types happens here. Categories drive the preview and atomic commit.
// Word-root uniqueness is the defName+defKey pair; a code shared by different
// Chinese terms is a legal candidate (English-match ambiguity), never a hard
// conflict. Standard-field codes stay globally unique.
export const classifyDictionaryRows = (rootRows, commonRows, currentRoots, currentFields) => {
  const valid = [];
  const pendingFullName = [];
  const invalid = [];
  const duplicates = [];
  const ambiguous = [];
  const seen = new Map();
  const byCode = new Map();
  currentRoots.forEach((root) => {
    seen.set(`${normalized(root.defName)}\0${normalized(root.defKey)}`, {kind: 'existing', root});
    const key = normalized(root.defKey);
    if (!byCode.has(key)) byCode.set(key, []);
    byCode.get(key).push({defName: root.defName, kind: 'existing'});
  });
  // Pre-indexed batch lookups keep classification linear for 4k dictionaries.
  const sameBatch = new Map();
  const namesInBatch = new Map();
  const prepared = (rootRows || []).map(row => ({
    row,
    defName: normalized(row.defName),
    defKey: normalized(row.defKey),
  }));
  prepared.forEach((item) => {
    if (!namesInBatch.has(item.defName)) namesInBatch.set(item.defName, new Set());
    namesInBatch.get(item.defName).add(item.defKey);
  });
  for (const {row, defName: nameKey, defKey: codeSelf} of prepared) {
    const entry = {
      defName: text(row.defName).trim(),
      defKey: text(row.defKey).trim(),
      fullName: text(row.fullName).trim(),
      referenceNames: (row.referenceNames || []).filter(item => item.fullName || item.defKey),
      origin: row.origin,
    };
    const pairKey = `${nameKey}\0${codeSelf}`;
    if (sameBatch.has(pairKey)) {
      duplicates.push({...entry, reason: 'duplicateInFile'});
      continue;
    }
    sameBatch.set(pairKey, entry);
    const existing = seen.get(pairKey);
    if (existing) {
      duplicates.push({...entry, reason: 'duplicateExisting', existingId: existing.root.id,
        canFill: !existing.root.fullName && !!entry.fullName});
      continue;
    }
    if (!entry.defName || !isValidCode(entry.defKey)) {
      invalid.push(entry);
      continue;
    }
    // Same Chinese name with different codes stays separate candidates.
    const siblings = [...namesInBatch.get(nameKey)].filter(code => code !== codeSelf);
    if (siblings.length) entry.ambiguousWith = siblings;
    // Same code under a different Chinese name is allowed (pair uniqueness);
    // surface it as English-match ambiguity instead of excluding the row.
    const codeHosts = (byCode.get(codeSelf) || [])
      .filter(host => normalized(host.defName) !== nameKey);
    if (codeHosts.length) entry.codeSharedWith = codeHosts.map(host => host.defName);
    if (!byCode.has(codeSelf)) byCode.set(codeSelf, []);
    byCode.get(codeSelf).push({defName: entry.defName, kind: 'import'});
    if (entry.ambiguousWith?.length || entry.codeSharedWith?.length) ambiguous.push(entry);
    else if (!entry.fullName) pendingFullName.push(entry);
    else valid.push(entry);
  }
  // Common word rows become standard fields with an empty root chain unless
  // a reliable link exists; identical normalized codes with different names
  // need a per-group alias/conflict decision.
  const commonValid = [];
  const commonAliasGroups = [];
  const commonInvalid = [];
  const commonConflicts = [];
  const commonByCode = new Map();
  const existingByCode = new Map();
  (currentFields || []).forEach(group => (group.fields || []).forEach((f) => {
    const key = normalized(f.defKey);
    if (!existingByCode.has(key)) existingByCode.set(key, []);
    existingByCode.get(key).push(f);
  }));
  commonRows.forEach((row) => {
    const defName = text(row.defName).trim();
    const defKey = text(row.defKey).trim();
    const entry = {defName, defKey, origin: row.origin};
    if (!defName || !isValidCode(defKey)) {
      commonInvalid.push(entry);
      return;
    }
    const codeKey = normalized(defKey);
    // A code already used by an existing standard with a different Chinese
    // name must stay visible: keep-existing / merge-alias decision required.
    const hosts = existingByCode.get(codeKey) || [];
    if (hosts.length) {
      if (!hosts.some(host => normalized(host.defName) === normalized(defName))) {
        commonConflicts.push({...entry,
          existingNames: hosts.map(host => host.defName), decision: ''});
      }
      return; // same name+code already exists; differing names need a decision
    }
    if (!commonByCode.has(codeKey)) commonByCode.set(codeKey, []);
    commonByCode.get(codeKey).push(entry);
  });
  commonByCode.forEach((entries, codeKey) => {
    if (existingByCode.has(codeKey)) return; // existing standard code wins
    if (entries.length === 1) {
      commonValid.push({...entries[0], aliases: []});
      return;
    }
    const names = [...new Set(entries.map(item => item.defName))];
    commonAliasGroups.push({defKey: entries[0].defKey, defName: names[0],
      aliasOptions: names, aliases: names.slice(1), conflict: false, entries});
  });
  // Root codes are never hard conflicts (pair uniqueness only); the key stays
  // reserved so older callers keep working.
  return {valid, pendingFullName, invalid, duplicates, ambiguous, codeConflicts: [],
    commonValid, commonAliasGroups, commonInvalid, commonConflicts};
};

// Atomic commit of the preview selection. Conflict decisions are resolved
// by the caller; anything unresolved is skipped, never silently merged.
export const applyDictionaryImport = ({rootEntries, commonEntries, aliasGroups,
  commonConflicts}, source, makeId) => {
  const roots = (source.profile?.fieldRecommendation?.wordRoots || []).map(root => ({...root}));
  const filled = [];
  rootEntries.forEach((entry) => {
    const existing = entry.existingId
      ? roots.find(root => root.id === entry.existingId) : null;
    if (existing) {
      if (entry.canFill && entry.fullName && !existing.fullName) {
        existing.fullName = entry.fullName;
        filled.push(existing.id);
      }
      return;
    }
    roots.push({
      id: makeId(),
      defName: entry.defName,
      defKey: entry.defKey,
      ...(entry.fullName ? {fullName: entry.fullName} : {}),
      ...(entry.referenceNames?.length ? {referenceNames: entry.referenceNames} : {}),
      baseType: '', len: '', scale: '',
      ...(entry.origin ? {standardMeta: {scope: 'project', source: entry.origin}} : {}),
    });
  });
  const standardFields = (source.standardFields || []).map(group => ({...group, fields: [...(group.fields || [])]}));
  const codes = new Set(standardFields.reduce((codes_, group) =>
    group.fields.concat(codes_), []).map(field => normalized(field.defKey)));
  // Existing-code conflicts default to keeping the confirmed standard; an
  // explicit 'alias' decision merges the new Chinese name as an alias.
  (commonConflicts || []).forEach((entry) => {
    if (entry.decision !== 'alias') return;
    standardFields.forEach((group, groupIndex) => {
      (group.fields || []).forEach((field, fieldIndex) => {
        if (normalized(field.defKey) !== normalized(entry.defKey)) return;
        const aliases = [...new Set([...(field.standardMeta?.aliases || []), entry.defName])];
        standardFields[groupIndex] = {...group,
          fields: group.fields.map((item, index) => (index === fieldIndex ? {...item,
            standardMeta: {...(item.standardMeta || {}), aliases}} : item))};
      });
    });
  });
  let defaultGroup = standardFields[0];
  const addCommon = (entry) => {
    if (codes.has(normalized(entry.defKey))) return;
    codes.add(normalized(entry.defKey));
    if (!defaultGroup) {
      defaultGroup = {id: makeId(), defKey: 'IMPORT', defName: '导入', fields: []};
      standardFields.push(defaultGroup);
    }
    defaultGroup.fields.push({
      id: makeId(),
      defKey: entry.defKey,
      defName: entry.defName,
      ...(entry.origin || entry.aliases?.length ? {standardMeta: {
        ...(entry.aliases?.length ? {aliases: entry.aliases} : {}),
        ...(entry.origin ? {source: entry.origin, wordRootRefs: []} : {}),
      }} : {}),
    });
  };
  commonEntries.forEach(addCommon);
  (aliasGroups || []).forEach((group) => {
    if (group.conflict || group.decision !== 'alias'
      || !(group.aliasOptions || []).includes(group.defName)) return;
    addCommon({defKey: group.defKey, defName: group.defName, aliases: group.aliases,
      origin: group.entries?.[0]?.origin});
  });
  return {roots, standardFields, filledIds: filled};
};
