// ChangeSetLedger — one record per applied changeset with narrow after-
// fingerprints and inverse actions. Undo replays inverses in reverse order
// only when every touched resource still matches its after-fingerprint, so a
// later manual change blocks the undo instead of being rolled over (C15).
import {removeCategoryMembers} from '../model_catalog.js';
import {resourceFingerprint} from './fingerprint.js';

export const createLedger = (initialRecords = []) => {
  let records = initialRecords.slice();
  return {
    record: (entry) => {
      records = records.filter(item => item.commandId !== entry.commandId).concat([entry]);
      return entry;
    },
    get: token => records.find(entry => entry.token === token) || null,
    getReceiptByCommandId: commandId => records.find(entry => entry.commandId === commandId)?.receipt || null,
    list: () => records.slice(),
    toJSON: () => records.slice(),
    fromJSON: (next) => {
      records = (next || []).slice();
    },
  };
};

const inverseActions = {
  removeObject: (source, action) => {
    let next = {
      ...source,
      [action.collection]: (source[action.collection] || [])
        .filter(item => item.id !== action.id),
    };
    if (action.categoryId) {
      next = removeCategoryMembers(next, action.categoryId, action.memberType, [action.id]);
    }
    return next;
  },
  restoreFields: (source, action) => ({
    ...source,
    entities: (source.entities || []).map(entity =>
      (entity.id === action.entityId ? {...entity, fields: action.fields} : entity)),
  }),
  restoreDiagramCells: (source, action) => ({
    ...source,
    diagrams: (source.diagrams || []).map(diagram => (diagram.id === action.diagramId
      ? {...diagram, canvasData: {...(diagram.canvasData || {}), cells: action.cells}}
      : diagram)),
  }),
  // Inverse of model.foreignKey.create's transactional correlation write:
  // restores the child entity's whole correlations array (the command only
  // appends, so the pre-op array is the exact rollback).
  restoreEntityCorrelations: (source, action) => ({
    ...source,
    entities: (source.entities || []).map(entity =>
      (entity.id === action.entityId ? {...entity, correlations: action.correlations} : entity)),
  }),
  removeStandardGroup: (source, action) => ({
    ...source,
    standardFields: (source.standardFields || []).filter(group => group.id !== action.groupId),
  }),
  restoreGroupFields: (source, action) => ({
    ...source,
    standardFields: (source.standardFields || []).map(group =>
      (group.id === action.groupId ? {...group, fields: action.fields} : group)),
  }),
  removeWordRoot: (source, action) => {
    const profile = source.profile || {};
    return {
      ...source,
      profile: {
        ...profile,
        fieldRecommendation: {
          ...(profile.fieldRecommendation || {}),
          wordRoots: (profile.fieldRecommendation?.wordRoots || [])
            .filter(root => root.id !== action.rootId),
        },
      },
    };
  },
  restoreQuality: (source, action) => {
    const profile = source.profile || {};
    if (action.quality === undefined) {
      const next = {...profile};
      delete next.quality;
      return {...source, profile: next};
    }
    return {...source, profile: {...profile, quality: action.quality}};
  },
};

// Undo one applied changeset. Post-conditions first: every recorded write
// resource must still carry its after-fingerprint.
export const undoChangeSet = (dataSource, ledger, token, options = {}) => {
  const fail = (code, message, extra) => ({ok: false, code, message, detail: extra, dataSource});
  const record = ledger.get(token);
  if (!record) return fail('UNDO_UNKNOWN', `no applied changeset for token ${token}`);
  const conflicts = [];
  (record.afterFingerprints || []).forEach((entry) => {
    if (entry.unknown) {
      // An unverifiable write resource can never prove the post-condition,
      // so undo refuses instead of silently rolling over it.
      conflicts.push({resource: entry.resource, unknown: true,
        expected: entry.fingerprint || null, actual: null});
      return;
    }
    const current = resourceFingerprint(dataSource, entry.resource);
    if (current !== entry.fingerprint) {
      conflicts.push({resource: entry.resource, expected: entry.fingerprint, actual: current});
    }
  });
  if (conflicts.length) {
    return fail('UNDO_CONFLICT',
      'resources changed after this changeset; undo would overwrite later edits', conflicts);
  }
  let source = dataSource;
  (record.inverse || []).slice().reverse().forEach((action) => {
    const handler = inverseActions[action.type];
    if (!handler) throw new Error(`UNKNOWN_INVERSE_ACTION_${action.type}`);
    source = handler(source, action);
  });
  const receipt = {
    commandId: record.commandId,
    planId: record.planId,
    planHash: record.planHash,
    state: 'undone',
    undoneToken: token,
    objects: record.receipt?.objects || [],
    persistence: {state: 'dirty'},
  };
  if (options.ledger !== false) {
    // keep the record for audit; undo itself is not undoable through v1
  }
  return {ok: true, dataSource: source, receipt};
};
