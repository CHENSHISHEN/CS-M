// Public API of the shared AI orchestration layer (GATEWAY v1).
// Single confirmation/guard engine for both transaction domains; consumed by
// the integration owner — workbench/canvas must not re-implement these rules.
// Pure modules: no UI, no network, no filesystem. Host effects enter only
// through the injected {getSession, getSnapshot, commit} contract.
export {
  CONTEXT_LIMITS, redactSensitiveText, describeObject,
  composeModelingContext, composeDrawingContext,
  describeAiCapabilities, AUTHORITY_RULES, READ_TOOLS_V1,
} from './context.js';

export {
  AUTHORITY_FIELDS, stripJsonFences, encapsulateDraft,
  computeDrawingReadSet, verifyDrawingReadSet, dependencyClosure,
} from './draft.js';

export {createGateway} from './gateway.js';
