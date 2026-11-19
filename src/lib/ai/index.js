// Public ES-module API of the local sealed AI core (modeling platform).
// Everything takes and returns plain serializable data; no network, no
// filesystem, no eval. Signatures are documented in
// doc/developer/platform-ai-v1/implementation/core-api.md.

export {
  sha256Hex, canonicalJson, hashJson,
} from './hash.js';

export {
  resourceFingerprint, fingerprintEntries, verifyReadSet, isKnownResource,
} from './fingerprint.js';

export {
  parsePlanText, validatePlanStructure,
} from './planSchema.js';

export {
  computePlanHash, computeContextDigest, selectOperations, verifyPlanBasics,
  topologicalOpOrder, isPlanExpired,
} from './operationPlan.js';

export {
  listCommands, describeCommand, getCommand,
} from './registry.js';

export {
  previewPlan, applyPlan, collectReadSet, createSequentialIdAllocator,
} from './executor.js';

export {
  createLedger, undoChangeSet,
} from './ledger.js';

export {
  parseDdlScript, draftTableOpsFromDdl, SQL_DIALECTS, findKeywordOutsideQuotes,
} from './sqlDdl.js';
