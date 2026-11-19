// Resource fingerprints for the AI operation-plan staleness protocol.
// A "resource" names a bounded slice of the project dataSource (a collection,
// one object, or one object slice). Fingerprints are sha256 over canonicalJson
// of the projection; absent slices hash to a stable sentinel. Pure functions.
import {getCatalogCategories} from '../model_catalog.js';
import {hashJson, NULL_FINGERPRINT} from './hash.js';

const text = value => (value === undefined || value === null ? '' : String(value));

const findById = (list, id) => (list || []).find(item => item && item.id === id) || null;

// Mirror of model_catalog's private viewGroup ref keys: a legacy category
// (synthesized from viewGroups) stores its real membership in the group's
// ref* arrays, never in the virtual empty `members` object.
const VIEW_GROUP_REF_KEYS = {
  conceptEntity: 'refConceptEntities',
  logicEntity: 'refLogicEntities',
  entity: 'refEntities',
  diagram: 'refDiagrams',
  view: 'refViews',
  dict: 'refDicts',
};

export const RESOURCE_PATTERN = /^(entities|logicEntities|conceptEntities|views|diagrams|dicts|wordRoots|standardFields|dataTypeSupports|dataTypeMappings|modelDatabases|catalogCategories|profile\.quality)(\/[A-Za-z0-9_.:-]+)?(\/(fields|canvasData|members))?$/;

// 'catalogCategory/<id>/members' is the per-category membership slice written
// by catalog membership changes (singular base; the category itself lives in
// the catalogCategories collection).
const CATEGORY_MEMBERS_PATTERN = /^catalogCategory\/[A-Za-z0-9_.:-]+\/members$/;

export const isKnownResource = (resource) => {
  if (!resource || typeof resource !== 'string') return false;
  if (resource === 'catalogCategories') return true;
  if (CATEGORY_MEMBERS_PATTERN.test(resource)) return true;
  const m = RESOURCE_PATTERN.exec(resource);
  if (!m) return false;
  const [base, id, tail] = [m[1], m[2], m[4]];
  if (!id) return tail === undefined;
  if (tail && !['fields', 'canvasData', 'members'].includes(tail)) return false;
  if (base === 'wordRoots') return tail === undefined;
  if (base === 'dataTypeSupports' || base === 'dataTypeMappings'
    || base === 'modelDatabases' || base === 'profile.quality') return id === undefined && tail === undefined;
  if (base === 'standardFields') return tail === undefined;
  return true;
};

// 'catalogCategory/<id>/members' is written by catalog membership changes.
export const normalizeResource = (resource) => {
  if (resource && resource.startsWith('catalogCategory/') && resource.endsWith('/members')) {
    return resource;
  }
  return resource;
};

const projection = (dataSource, resource) => {
  if (resource === 'catalogCategories') return getCatalogCategories(dataSource);
  if (resource.startsWith('catalogCategory/') && resource.endsWith('/members')) {
    const id = resource.slice('catalogCategory/'.length, -'/members'.length);
    const category = getCatalogCategories(dataSource).find(item => item.id === id);
    if (!category) return null;
    if (category.legacyGroupId) {
      // Legacy category: hash the real viewGroup refs — never the virtual
      // empty members the synthesizer puts on the category object.
      const group = findById(dataSource?.viewGroups, category.legacyGroupId);
      const members = {};
      Object.keys(VIEW_GROUP_REF_KEYS).forEach((type) => {
        members[type] = [...new Set(group?.[VIEW_GROUP_REF_KEYS[type]] || [])];
      });
      return {id: category.id, members};
    }
    return {id: category.id, members: category.members || {}};
  }
  const parts = resource.split('/');
  const base = parts[0];
  const id = parts.length > 1 ? parts[1] : null;
  const tail = parts.length > 2 ? parts[2] : null;
  if (base === 'profile.quality') return dataSource?.profile?.quality === undefined ? null : dataSource.profile.quality;
  if (base === 'dataTypeSupports') return dataSource?.profile?.dataTypeSupports || [];
  if (base === 'dataTypeMappings') return dataSource?.dataTypeMapping?.mappings || [];
  if (base === 'modelDatabases') return dataSource?.profile?.modelCatalog?.physicalDatabases || [];
  if (base === 'wordRoots') {
    const roots = dataSource?.profile?.fieldRecommendation?.wordRoots || [];
    if (!id) return roots;
    return findById(roots, id);
  }
  if (base === 'standardFields') {
    const groups = dataSource?.standardFields || [];
    if (!id) return groups;
    return findById(groups, id);
  }
  const collection = dataSource ? dataSource[base] : null;
  if (!id) return collection || [];
  const object = findById(collection, id);
  if (!object) return null;
  if (!tail) return object;
  if (tail === 'fields') return object.fields || [];
  if (tail === 'canvasData') return object.canvasData || {};
  if (tail === 'members') return object.members || {};
  return object;
};

export const resourceFingerprint = (dataSource, resource) => {
  const normalized = normalizeResource(resource);
  if (!isKnownResource(normalized)) return null; // caller decides how to report
  const value = projection(dataSource, normalized);
  if (value === null || value === undefined) return NULL_FINGERPRINT;
  return hashJson(value);
};

export const fingerprintEntries = (dataSource, resources) => {
  const seen = new Set();
  const entries = [];
  (resources || []).forEach((resource) => {
    if (seen.has(resource)) return;
    seen.add(resource);
    const fingerprint = resourceFingerprint(dataSource, resource);
    entries.push(fingerprint === null
      ? {resource, unknown: true}
      : {resource, fingerprint});
  });
  return entries;
};

// Compare a plan readSet against the current dataSource. Returns:
// {ok, stale: [{resource, expected, actual}], unknown: [resource], missing: [resource]}
export const verifyReadSet = (dataSource, readSet) => {
  const expected = new Map((readSet || []).map(entry => [entry.resource, entry.fingerprint]));
  const stale = [];
  const unknown = [];
  (readSet || []).forEach((entry) => {
    if (!isKnownResource(normalizeResource(entry.resource))) {
      unknown.push(entry.resource);
      return;
    }
    const actual = resourceFingerprint(dataSource, entry.resource);
    if (actual !== entry.fingerprint) {
      stale.push({resource: entry.resource, expected: entry.fingerprint, actual});
    }
  });
  return {
    ok: stale.length === 0 && unknown.length === 0,
    stale,
    unknown,
    missing: [],
    size: expected.size,
  };
};

export const textId = id => text(id).trim();
