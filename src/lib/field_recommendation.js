// Pure recommendation rules; project/UI state is supplied by the caller.
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = value => (value === undefined || value === null ? '' : String(value));
const normalized = value => text(value).normalize('NFKC').trim().toLocaleLowerCase();
const phraseKey = value => normalized(value).replace(/[\s_-]+/g, '');
const mappings = source => source.dataTypeMapping?.mappings || [];
const database = source => source.profile?.default?.db || source.profile?.dataTypeSupports?.[0]?.id;
// Full-name phrases keep their stored spelling; matching normalizes separators only.
const rootMatchKeys = (root, column) => {
  if (column === 'defKey') {
    const keys = [phraseKey(root.defKey)];
    const fullName = phraseKey(root.fullName);
    if (fullName && fullName !== keys[0]) keys.push(fullName);
    return keys.filter(Boolean);
  }
  // Chinese terms match with the same internal-whitespace stripping rule the
  // input uses, so "客户 名称" still matches a stored "客户 名称".
  const key = normalized(root.defName).replace(/\s/g, '');
  return key ? [key] : [];
};

export const recommendationDefaults = {
  standard: true, similar: true, roots: true, style: 'snake', case: 'lower',
};

export const recommendationSource = (source, tabs = {}, entityId, fields) => {
  const edited = new Map();
  Object.values(tabs).forEach((tab) => {
    if (tab.type === 'entity' && tab.data && !tab.isInit) edited.set(tab.data.id, tab.data);
  });
  return {
    ...source,
    entities: (source.entities || []).map((entity) => {
      const current = edited.get(entity.id) || entity;
      return entity.id === entityId ? {...current, fields} : current;
    }),
  };
};

export const createRecommendationIndex = source => ({
  standard: (source.standardFields || []).reduce((items, group) => items.concat(
    (group.fields || []).map(field => ({
      key: `standard:${group.id}:${field.id}`, kind: 'standard', field,
      group: group.defName || group.defKey,
      // Alias matching entry: normalized once here, not per keystroke.
      aliases: (field.standardMeta?.aliases || [])
        .map(alias => normalized(alias)).filter(Boolean),
    })),
  ), []),
  similar: (source.entities || []).reduce((items, entity) => items.concat(
    (entity.fields || []).map(field => ({
      key: `similar:${entity.id}:${field.id}`, kind: 'similar', field,
      entityId: entity.id, entityKey: entity.defKey, entityName: entity.defName,
    })),
  ), []),
  roots: source.profile?.fieldRecommendation?.wordRoots || [],
});

// Order: primary exact > alias exact > primary prefix > alias prefix
// > primary contains > alias contains. Inside the primary tiers the column
// being edited wins before the other one; alias tiers keep declaration order.
// rank = tier * 3 + slot, tier: exact 0 / prefix 1 / contains 2,
// slot: edited column 0 / other column 1 / alias 2.
const rank = (candidate, query, column) => {
  const other = column === 'defKey' ? 'defName' : 'defKey';
  const slots = [candidate.field[column], candidate.field[other]];
  let result = 10;
  const consider = (value, slot) => {
    if (!value) return;
    const key = normalized(value);
    if (!key) return;
    const tier = key === query ? 0 : (key.startsWith(query) ? 1 : (key.includes(query) ? 2 : -1));
    if (tier >= 0) result = Math.min(result, tier * 3 + slot);
  };
  consider(slots[0], 0);
  consider(slots[1], 1);
  (candidate.aliases || []).forEach(alias => consider(alias, 2));
  return result;
};

export const searchRecommendations = (index, value, column, rowId) => {
  const query = normalized(value);
  const search = items => items.map((item, order) => ({item, order, rank: rank(item, query, column)}))
    .filter(item => item.rank < 10)
    .sort((a, b) => a.rank - b.rank || a.order - b.order).map(item => item.item);
  return {
    standard: query ? search(index.standard) : index.standard,
    similar: query ? search(index.similar.filter(item => item.field.id !== rowId)) : [],
  };
};

const rootKey = (value, column) => normalized(value).replace(
  column === 'defKey' ? /[\s_-]/g : /\s/g, '',
);
// Match entries per root: defKey column accepts abbreviation and full name,
// defName column keeps the Chinese term. Reference names never auto-match.
const keyCache = new WeakMap();
const rootKeys = (roots, column) => {
  let cache = keyCache.get(roots);
  if (!cache || cache.column !== column) {
    cache = {column, keys: roots.map(root => rootMatchKeys(root, column))};
    keyCache.set(roots, cache);
  }
  return cache.keys;
};

export const matchWordRoots = (value, column, roots) => {
  const keys = rootKeys(roots, column);
  let remaining = rootKey(value, column);
  const selected = [];
  // Longest consumed input first; the same root reached through abbreviation
  // and full name counts once; ties between different roots need a choice.
  while (remaining) {
    let length = 0;
    let winner = null;
    roots.forEach((root, index) => {
      keys[index].forEach((key) => {
        if (remaining.startsWith(key) && key.length > length) {
          length = key.length;
          winner = root;
        }
      });
    });
    if (!winner) break;
    const tied = new Set();
    roots.forEach((root, index) => {
      if (keys[index].some(key => key.length === length && remaining.startsWith(key))) {
        tied.add(root.id);
      }
    });
    if (tied.size !== 1) break;
    // The input is consumed either way, but a root already selected through
    // its other entry (abbreviation/full name) is not selected twice.
    if (!selected.some(root => root.id === winner.id)) selected.push(winner);
    remaining = remaining.slice(length);
  }
  const candidates = [];
  const seen = new Set();
  roots.forEach((root, index) => {
    if (seen.has(root.id)) return;
    const hit = !remaining || keys[index].some(key => key.includes(remaining)
      || remaining.startsWith(key));
    if (hit) {
      seen.add(root.id);
      candidates.push(root);
    }
  });
  return {selected, remaining, candidates};
};

export const composeWordRoots = (roots, settings) => {
  const words = roots.reduce((items, root) => items.concat(text(root.defKey)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2').split(/[_\s-]+/).filter(Boolean)), []);
  let defKey;
  if (settings.style === 'camel') {
    defKey = words.map((word, i) => {
      const lower = word.toLocaleLowerCase();
      return i === 0 ? lower : lower[0].toLocaleUpperCase() + lower.slice(1);
    }).join('');
  } else {
    defKey = roots.map(root => text(root.defKey)).join('_');
    if (settings.case === 'upper') defKey = defKey.toLocaleUpperCase();
    if (settings.case === 'lower') defKey = defKey.toLocaleLowerCase();
  }
  const typed = roots.slice().reverse().find(root => root.baseType);
  return {
    key: 'root-combination', kind: 'roots',
    field: {
      defKey, defName: roots.map(root => root.defName).join(''),
      ...(typed ? {baseType: typed.baseType, len: typed.len, scale: typed.scale} : {}),
    },
  };
};

export const fieldTypeLabel = (field, source) => {
  const domain = (source.domains || []).find(item => item.id === field.domain);
  const base = mappings(source).find(item => item.id === (domain?.applyFor || field.baseType));
  const type = base?.[database(source)] || field.type || base?.defName || '';
  const len = domain ? domain.len : field.len;
  const scale = domain ? domain.scale : field.scale;
  if (len === undefined || len === null || len === '') return type;
  return `${type}(${len}${scale === undefined || scale === null || scale === '' ? '' : `,${scale}`})`;
};

export const applyFieldRecommendation = (current, candidate, fields, source) => {
  const input = candidate.field;
  if (!text(input.defKey).trim()) return {error: 'emptyCode'};
  if (fields.some(field => field.id !== current.id
    && normalized(field.defKey) === normalized(input.defKey))) return {error: 'duplicateCode'};
  const next = {...current};
  ['defKey', 'defName', 'comment', 'defaultValue', 'refDict', 'uiHint'].forEach((key) => {
    if (own(input, key) && input[key] !== undefined) next[key] = input[key];
  });
  const hasType = ['domain', 'baseType', 'type', 'len', 'scale'].some(key =>
    input[key] !== undefined && input[key] !== null && input[key] !== '');
  if (hasType) {
    const domain = (source.domains || []).find(item => item.id === input.domain);
    if (input.domain && !domain) return {error: 'unknownDomain'};
    if (domain) {
      if (!mappings(source).some(item => item.id === domain.applyFor && item[database(source)])) {
        return {error: 'unknownType'};
      }
      Object.assign(next, {domain: domain.id, baseType: domain.applyFor, type: '', len: '', scale: ''});
    } else {
      const base = input.baseType ? mappings(source).find(item => item.id === input.baseType)
        : input.type && mappings(source).find(item => normalized(item[database(source)]) === normalized(input.type));
      if (input.baseType && (!base || !base[database(source)])) return {error: 'unknownType'};
      const oldDomain = (source.domains || []).find(item => item.id === current.domain);
      if (oldDomain) Object.assign(next, {
        baseType: oldDomain.applyFor,
        type: mappings(source).find(item => item.id === oldDomain.applyFor)?.[database(source)] || current.type,
        len: oldDomain.len, scale: oldDomain.scale,
      });
      next.domain = '';
      if (base) Object.assign(next, {baseType: base.id, type: base[database(source)]});
      else if (input.type) Object.assign(next, {baseType: '', type: input.type});
      ['len', 'scale'].forEach((key) => {
        if (own(input, key) && input[key] !== undefined) next[key] = input[key];
      });
    }
  }
  next.isStandard = candidate.kind === 'standard';
  if (candidate.kind === 'standard') next.refStandard = input.id;
  else delete next.refStandard;
  return {field: next};
};

export const validateWordRoots = (roots, source) => {
  if (!Array.isArray(roots)) return {error: 'invalidRoots'};
  const pairs = new Set();
  const cleaned = [];
  for (const root of roots) {
    if (!root || typeof root !== 'object') return {error: 'invalidRoots'};
    const defKey = text(root.defKey).trim();
    const defName = text(root.defName).trim();
    if (!defName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(defKey)) return {error: 'invalidRootName'};
    const pair = `${normalized(defName)}\0${normalized(defKey)}`;
    if (pairs.has(pair)) return {error: 'duplicateRoot'};
    pairs.add(pair);
    if (root.baseType && !mappings(source).some(item => item.id === root.baseType)) return {error: 'unknownType'};
    for (const key of ['len', 'scale']) {
      if (root[key] !== undefined && root[key] !== ''
        && !/^\d+$/.test(text(root[key]))) return {error: 'invalidSize'};
    }
    // Full names may be pending; keep stored spelling. Reference names keep
    // their raw pairing evidence even when one side is empty.
    const fullName = text(root.fullName).trim();
    const referenceNames = Array.isArray(root.referenceNames)
      ? root.referenceNames
        .map(item => (item && typeof item === 'object' ? {
          fullName: text(item.fullName).trim(), defKey: text(item.defKey).trim(),
        } : null))
        .filter(item => item && (item.fullName || item.defKey))
      : [];
    const standardMeta = root.standardMeta && typeof root.standardMeta === 'object'
      ? {
        scope: text(root.standardMeta.scope).trim() || 'project',
        industry: text(root.standardMeta.industry).trim(),
        source: root.standardMeta.source && typeof root.standardMeta.source === 'object' ? {
          name: text(root.standardMeta.source.name).trim(),
          version: text(root.standardMeta.source.version).trim(),
          sheet: text(root.standardMeta.source.sheet).trim(),
          row: root.standardMeta.source.row,
        } : {},
      } : undefined;
    cleaned.push({id: root.id, defKey, defName, baseType: root.baseType || '',
      len: root.len === undefined ? '' : root.len, scale: root.scale === undefined ? '' : root.scale,
      ...(fullName ? {fullName} : {}),
      ...(referenceNames.length ? {referenceNames} : {}),
      ...(standardMeta ? {standardMeta} : {})});
  }
  return {roots: cleaned};
};

export const exportWordRoots = (roots, source) => {
  const validated = validateWordRoots(roots, source);
  if (validated.error) return validated;
  return {data: {version: 2, wordRoots: validated.roots.map(root => ({
    defKey: root.defKey, defName: root.defName, len: root.len, scale: root.scale,
    baseTypeDefKey: mappings(source).find(item => item.id === root.baseType)?.defKey || '',
    ...(root.fullName ? {fullName: root.fullName} : {}),
    ...(root.referenceNames?.length ? {referenceNames: root.referenceNames} : {}),
    ...(root.standardMeta ? {standardMeta: root.standardMeta} : {}),
  }))}};
};

export const importWordRoots = (data, current, source, makeId) => {
  // Version 1 packages (abbreviation-only) stay readable; version 2 adds
  // full names, reference names and metadata; anything else is rejected.
  if (!data || (data.version !== 1 && data.version !== 2)
    || !Array.isArray(data.wordRoots)) return {error: 'invalidRoots'};
  const imported = [];
  for (const row of data.wordRoots) {
    if (!row || typeof row !== 'object') return {error: 'invalidRoots'};
    const types = row.baseTypeDefKey
      ? mappings(source).filter(item => item.defKey === row.baseTypeDefKey) : [];
    if (row.baseTypeDefKey && types.length !== 1) return {error: 'unknownType'};
    imported.push({...row, id: makeId(), baseType: types[0]?.id || ''});
  }
  const valid = validateWordRoots(imported, source);
  if (valid.error) return valid;
  const merged = current.slice();
  valid.roots.forEach((root) => {
    if (!merged.some(item => normalized(item.defName) === normalized(root.defName)
      && normalized(item.defKey) === normalized(root.defKey))) merged.push(root);
  });
  return validateWordRoots(merged, source);
};
