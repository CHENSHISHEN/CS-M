// Local sealed AI operation-plan core: deterministic hashing helpers.
// Pure ES module; the digest delegates to the standard crypto module the
// project already declares (Node builtin, webpack-adapted — same approach as
// src/lib/workspaceStorage.js). No hand-rolled cryptography. No `??` operator
// (webpack4/acorn6 build chain); use `== null ? a : b` instead.
import crypto from 'crypto';

// SHA-256 (FIPS 180-4) over a UTF-8 string or byte sequence, lowercase hex.
export const sha256Hex = (message) => {
  const hash = crypto.createHash('sha256');
  if (typeof message === 'string') {
    hash.update(message, 'utf8');
  } else if (Array.isArray(message) || message instanceof Uint8Array) {
    hash.update(Buffer.from(message));
  } else {
    throw new Error('sha256Hex expects a string or byte sequence');
  }
  return hash.digest('hex');
};

// Deterministic serialization: object keys sorted recursively (arrays keep
// order), then JSON.stringify. Numbers must be finite; NaN/Infinity are
// rejected because JSON cannot represent them deterministically.
const isPlainObject = (value) => {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
export const canonicalJson = (value) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_SERIALIZABLE_NUMBER');
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter(key => key !== '__proto__' && key !== 'constructor' && key !== 'prototype')
      .sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error(`NON_SERIALIZABLE_TYPE_${typeof value}`);
};

export const hashJson = (value) => sha256Hex(canonicalJson(value));

export const NULL_FINGERPRINT = hashJson({absent: true});

// Keys that must never appear inside a plan, at any depth.
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const findDangerousKey = (value, path = '') => {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findDangerousKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (!isPlainObject(value)) return null;
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) return `${path}.${key}`;
  }
  for (const key of Object.keys(value)) {
    const hit = findDangerousKey(value[key], `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
};
