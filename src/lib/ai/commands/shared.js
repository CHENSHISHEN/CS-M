// Shared helpers for modeling/standard/quality command handlers.
import {isValidCode} from '../../data_standard_library.js';

export const text = (value) => {
  if (value === undefined || value === null) return '';
  return String(value);
};
export const normalized = value => text(value).normalize('NFKC').trim().toLocaleLowerCase();

export const blocking = (code, message, detail) => ({level: 'blocking', code, message, detail});
export const warning = (code, message, detail) => ({level: 'warning', code, message, detail});

export const defaultDatabaseId = (source) => {
  const id = source?.profile?.default?.db || source?.profile?.dataTypeSupports?.[0]?.id;
  return id === undefined || id === null || id === '' ? null : id;
};

// A field type string must resolve to exactly one dataType mapping row for the
// given database support; unknown types block the command (no invented IDs).
export const resolveFieldType = (source, dbSupportId, rawType) => {
  const mappings = (source?.dataTypeMapping?.mappings || [])
    .filter(mapping => mapping && mapping.id);
  const key = normalized(rawType);
  const hits = mappings.filter(mapping => normalized(mapping[dbSupportId]) === key && key !== '');
  if (hits.length !== 1) return null;
  return hits[0];
};

// Standard physical column headers mirroring getEmptyEntity() defaults so the
// created entity renders without relying on fallbacks.
export const DEFAULT_ENTITY_HEADERS = [
  {freeze: false, refKey: 'hideInGraph', hideInGraph: true},
  {freeze: true, refKey: 'defKey', hideInGraph: false},
  {freeze: true, refKey: 'defName', hideInGraph: false},
  {freeze: false, refKey: 'primaryKey', hideInGraph: false},
  {freeze: false, refKey: 'notNull', hideInGraph: true},
  {freeze: false, refKey: 'autoIncrement', hideInGraph: true},
  {freeze: false, refKey: 'domain', hideInGraph: true},
  {freeze: false, refKey: 'type', hideInGraph: false},
  {freeze: false, refKey: 'len', hideInGraph: false},
  {freeze: false, refKey: 'scale', hideInGraph: false},
  {freeze: false, refKey: 'comment', hideInGraph: true},
  {freeze: false, refKey: 'refDict', hideInGraph: true},
  {freeze: false, refKey: 'defaultValue', hideInGraph: true},
  {freeze: false, refKey: 'isStandard', hideInGraph: false},
  {freeze: false, refKey: 'uiHint', hideInGraph: true},
  {freeze: false, refKey: 'extProps', hideInGraph: true},
];

export const buildEntityField = (draft, mapping, dbSupportId, allocateId) => ({
  id: allocateId(),
  defKey: text(draft.defKey).trim(),
  defName: text(draft.defName),
  comment: text(draft.comment),
  type: mapping ? text(mapping[dbSupportId]) : text(draft.type),
  len: draft.len === null || draft.len === undefined ? '' : draft.len,
  scale: draft.scale === null || draft.scale === undefined ? '' : draft.scale,
  primaryKey: draft.primaryKey === true,
  notNull: draft.notNull === true,
  autoIncrement: false,
  defaultValue: text(draft.defaultValue),
  hideInGraph: false,
  refDict: '',
  baseType: mapping ? mapping.id : '',
  domain: '',
  uiHint: '',
});

export const assertValidCode = (problems, code, label) => {
  if (!isValidCode(code)) {
    problems.push(blocking('INVALID_CODE', `${label} is not a legal code: ${code}`));
    return false;
  }
  return true;
};

export const projectField = (field) => ({
  defKey: field.defKey,
  defName: field.defName,
  type: field.type,
  len: field.len,
  scale: field.scale,
  primaryKey: field.primaryKey,
  notNull: field.notNull,
});
