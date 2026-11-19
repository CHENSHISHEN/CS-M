// ObjectRef resolution against the working source and plan-local bindings.
// Local keys resolve only through bindings published by operations the current
// op explicitly (transitively) depends on — never by accident of ordering.
import {getCatalogCategories} from '../model_catalog.js';

const OWNER_COLLECTIONS = ['entities', 'logicEntities', 'conceptEntities'];
const ENTITY_COLLECTIONS = OWNER_COLLECTIONS;

export const refLabel = (ref) => {
  if (!ref || typeof ref !== 'object') return 'invalid-ref';
  if (ref.kind === 'local') return `local:${ref.key}`;
  if (ref.collection === 'fields') return `fields:${ref.owner?.collection}/${ref.owner?.id}:${ref.id}`;
  return `existing:${ref.collection}/${ref.id}`;
};

const lookupExisting = (dataSource, collection, id) => {
  switch (collection) {
    case 'entities':
    case 'logicEntities':
    case 'conceptEntities':
    case 'views':
    case 'dicts':
      return (dataSource?.[collection] || []).find(item => item.id === id) || null;
    case 'wordRoots':
      return (dataSource?.profile?.fieldRecommendation?.wordRoots || [])
        .find(item => item.id === id) || null;
    case 'standardGroups':
      return (dataSource?.standardFields || []).find(group => group.id === id) || null;
    case 'standardFields': {
      const groups = dataSource?.standardFields || [];
      for (const group of groups) {
        const field = (group.fields || []).find(item => item.id === id);
        if (field) return {field, group};
      }
      return null;
    }
    case 'dataTypeMappings':
      return (dataSource?.dataTypeMapping?.mappings || []).find(item => item.id === id) || null;
    case 'dataTypeSupports':
      return (dataSource?.profile?.dataTypeSupports || []).find(item => item.id === id) || null;
    case 'modelDatabases':
      return (dataSource?.profile?.modelCatalog?.physicalDatabases || [])
        .find(item => item.id === id) || null;
    case 'catalogCategories':
      return getCatalogCategories(dataSource).find(item => item.id === id) || null;
    default:
      return null; // drawingSemantic/drawingPages belong to the drawing domain
  }
};

// Execution context shared by command handlers. `bindings` maps localKey to
// {collection, id, reused?, owner?}; `reachableLocalKeys` is the transitive
// dependsOn closure of the current operation.
export const createResolver = (dataSource, bindings, reachableLocalKeys) => {
  const resolve = (ref) => {
    if (!ref || typeof ref !== 'object') {
      return {ok: false, code: 'REFERENCE_UNRESOLVED', message: 'invalid reference'};
    }
    if (ref.kind === 'local') {
      const binding = bindings.get(ref.key);
      if (!binding) {
        return {ok: false, code: 'REFERENCE_UNRESOLVED',
          message: `local key not produced in this plan: ${ref.key}`};
      }
      if (reachableLocalKeys && !reachableLocalKeys.has(ref.key)) {
        return {ok: false, code: 'DEPENDENCY_MISSING',
          message: `local key ${ref.key} is used without depending on its producing operation`};
      }
      return {ok: true, binding};
    }
    if (ref.kind === 'existing' && ref.collection === 'fields') {
      if (!OWNER_COLLECTIONS.includes(ref.owner?.collection)) {
        return {ok: false, code: 'REFERENCE_UNRESOLVED', message: 'field owner collection invalid'};
      }
      let entity = lookupExisting(dataSource, ref.owner.collection, ref.owner.id);
      if (!entity) {
        // The owner may be a plan-local entity; resolve via its binding.
        let ownerLocalId = null;
        bindings.forEach((binding, key) => {
          if (binding.collection === ref.owner.collection && binding.id === ref.owner.id) {
            ownerLocalId = key;
          }
        });
        if (ownerLocalId !== null && reachableLocalKeys && !reachableLocalKeys.has(ownerLocalId)) {
          return {ok: false, code: 'DEPENDENCY_MISSING',
            message: 'field owner is plan-local but not in dependency closure'};
        }
        if (ownerLocalId !== null) {
          entity = (dataSource[ref.owner.collection] || []).find(item => item.id === ref.owner.id) || null;
        }
      }
      if (!entity) {
        return {ok: false, code: 'REFERENCE_UNRESOLVED',
          message: `field owner not found: ${ref.owner.collection}/${ref.owner.id}`};
      }
      const field = (entity.fields || []).find(item => item.id === ref.id);
      if (!field) {
        return {ok: false, code: 'REFERENCE_UNRESOLVED',
          message: `field ${ref.id} not found on ${ref.owner.collection}/${ref.owner.id}`};
      }
      return {ok: true, binding: {
        collection: 'fields',
        owner: {collection: ref.owner.collection, id: ref.owner.id},
        id: ref.id,
      }, object: field, ownerObject: entity};
    }
    if (ref.kind === 'existing') {
      if (ref.collection === 'drawingSemantic' || ref.collection === 'drawingPages') {
        return {ok: false, code: 'CAPABILITY_UNAVAILABLE',
          message: 'drawing references are outside the modeling core'};
      }
      if (ENTITY_COLLECTIONS.includes(ref.collection)) {
        let object = lookupExisting(dataSource, ref.collection, ref.id);
        if (!object) {
          let localKey = null;
          bindings.forEach((binding, key) => {
            if (binding.collection === ref.collection && binding.id === ref.id) localKey = key;
          });
          if (localKey !== null) {
            if (reachableLocalKeys && !reachableLocalKeys.has(localKey)) {
              return {ok: false, code: 'DEPENDENCY_MISSING',
                message: `${ref.collection}/${ref.id} is plan-local but not in dependency closure`};
            }
            object = (dataSource[ref.collection] || []).find(item => item.id === ref.id) || null;
          }
        }
        if (!object) {
          return {ok: false, code: 'REFERENCE_UNRESOLVED',
            message: `${ref.collection}/${ref.id} not found`};
        }
        return {ok: true, binding: {collection: ref.collection, id: ref.id}, object};
      }
      const object = lookupExisting(dataSource, ref.collection, ref.id);
      if (!object) {
        return {ok: false, code: 'REFERENCE_UNRESOLVED',
          message: `${ref.collection}/${ref.id} not found`};
      }
      if (ref.collection === 'standardFields') {
        return {ok: true, binding: {collection: 'standardFields', id: ref.id}, object};
      }
      return {ok: true, binding: {collection: ref.collection, id: ref.id}, object};
    }
    return {ok: false, code: 'REFERENCE_UNRESOLVED', message: 'unknown reference kind'};
  };
  return {resolve};
};

export const ENTITY_COLLECTION_LIST = ENTITY_COLLECTIONS;
