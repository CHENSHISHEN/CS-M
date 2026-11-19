// Shared AI orchestration — draft encapsulation (GATEWAY v1).
// Turns a model proposal ({summary, assumptions, operations} — nothing else)
// into a locally sealed OperationPlan: the application assigns planId, scope,
// baseVersion, readSet, contextDigest, expiresAt and planHash; any authority
// field the model tries to emit is rejected. Final closed validation reuses
// the CORE plan schema validator; JSON text with duplicate keys is rejected
// and non-JSON prose comes back as clarifying text (display only).
import {findDuplicateJsonKey} from '../planSchema.js';
import {findDangerousKey, hashJson, NULL_FINGERPRINT} from '../hash.js';
import {computePlanHash, computeContextDigest, verifyPlanBasics} from '../operationPlan.js';
import {collectReadSet} from '../executor.js';

// Fields only the local application may assign. Their presence in model
// output is a hard rejection — a model cannot self-authorize.
export const AUTHORITY_FIELDS = [
  'protocolVersion', 'planId', 'scope', 'baseVersion', 'readSet', 'contextDigest',
  'expiresAt', 'planHash', 'confirmationId', 'commandId', 'confirmation', 'receipt',
  'undo', 'persistence', 'afterVersion',
];

const DRAFT_KEYS = ['summary', 'assumptions', 'operations'];
const DRAWING_PAGE_COMMANDS = ['drawing.chen.patch', 'drawing.chen.createPage'];

// Limited fence stripping: one optional ```/```json pair around the payload.
// Anything more exotic stays unparsed and is treated as prose.
export const stripJsonFences = (text) => {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return match ? match[1] : trimmed;
};

// Drawing staleness fingerprints. Resources here are drawing-domain names the
// modeling core does not know; the gateway verifies them itself — they never
// enter the modeling verifyReadSet path.
//
// 'drawingDocuments'      — document catalog (id+name), for name uniqueness
// 'drawingDocument/<id>'  — one whole document plus the current selection
export const computeDrawingReadSet = ({documents, documentId, selection, operations}) => {
  const entries = [];
  const docs = Array.isArray(documents) ? documents : [];
  const wantsCatalog = (operations || [])
    .some(op => op?.command === 'drawing.chen.createDocument');
  if (wantsCatalog) {
    entries.push({resource: 'drawingDocuments',
      fingerprint: hashJson(docs.map(d => ({id: d.id, name: d.defName})))});
  }
  if (documentId) {
    const doc = docs.find(d => d && d.id === documentId) || null;
    entries.push({
      resource: `drawingDocument/${documentId}`,
      fingerprint: doc
        ? hashJson({document: doc, selection: Array.isArray(selection) ? selection : null})
        : NULL_FINGERPRINT,
    });
  }
  return entries;
};

export const verifyDrawingReadSet = ({documents, documentId, selection, operations}, readSet) => {
  const expected = new Map((readSet || []).map(entry => [entry.resource, entry.fingerprint]));
  const fresh = new Map(computeDrawingReadSet({documents, documentId, selection, operations})
    .map(entry => [entry.resource, entry.fingerprint]));
  const stale = [];
  expected.forEach((fingerprint, resource) => {
    const actual = fresh.get(resource);
    if (actual !== fingerprint) stale.push({resource, expected: fingerprint, actual});
  });
  return {ok: stale.length === 0, stale};
};

const invalid = (code, problems) => ({kind: 'invalid', code, problems});

// Transitive dependsOn closure (opIds, including the start op).
export const dependencyClosure = (operations, opId) => {
  const byId = new Map((operations || []).map(op => [op.opId, op]));
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    const op = byId.get(id);
    if (!op) return;
    seen.add(id);
    (op.dependsOn || []).forEach(visit);
  };
  visit(opId);
  return seen;
};

// Encapsulate a model proposal into a sealed plan. options:
//   modelOutput  — string (possibly fenced) or the constrained proposal tool's
//                  already-parsed {summary, assumptions, operations} object
//   scope        — {platform, projectSessionId, documentId?} from the host session
//   baseVersion  — host snapshot version marker (required)
//   dataSource   — modeling snapshot (modeling plans; readSet via CORE)
//   drawing      — {documents, selection} (drawing plans; readSet via fingerprints)
//   ttlMs/now/nextId — injection for tests
export const encapsulateDraft = (options) => {
  const settings = options || {};
  const scope = settings.scope || {};
  if (!['modeling', 'drawing'].includes(scope.platform)) {
    return invalid('CAPABILITY_UNAVAILABLE',
      [{code: 'CAPABILITY_UNAVAILABLE', message: 'scope.platform 必须是 modeling 或 drawing'}]);
  }
  if (!scope.projectSessionId) {
    return invalid('REQUIRED_INPUT_MISSING',
      [{code: 'REQUIRED_INPUT_MISSING', message: '缺少 projectSessionId（宿主会话）'}]);
  }
  if (!settings.baseVersion) {
    return invalid('REQUIRED_INPUT_MISSING',
      [{code: 'REQUIRED_INPUT_MISSING', message: '缺少 baseVersion（宿主快照版本）'}]);
  }

  // 1. obtain the candidate object (parse text strictly; prose → clarifying)
  let candidate = settings.modelOutput;
  if (typeof candidate === 'string') {
    const stripped = stripJsonFences(candidate).trim();
    if (!stripped.startsWith('{')) {
      return {kind: 'clarifying', text: stripped.slice(0, 4000)};
    }
    let parsed;
    try {
      parsed = JSON.parse(stripped);
    } catch (error) {
      return invalid('OUTPUT_SCHEMA_INVALID',
        [{code: 'OUTPUT_SCHEMA_INVALID', message: `候选不是合法 JSON：${error.message}`}]);
    }
    const duplicate = findDuplicateJsonKey(stripped);
    if (duplicate) {
      return invalid('OUTPUT_SCHEMA_INVALID',
        [{code: 'OUTPUT_SCHEMA_INVALID', path: duplicate.key,
          message: `重复 JSON 键被拒绝：${duplicate.key}`}]);
    }
    candidate = parsed;
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return invalid('OUTPUT_SCHEMA_INVALID',
      [{code: 'OUTPUT_SCHEMA_INVALID', message: '候选必须是对象'}]);
  }
  const dangerous = findDangerousKey(candidate, 'draft');
  if (dangerous) {
    return invalid('OUTPUT_SCHEMA_INVALID',
      [{code: 'OUTPUT_SCHEMA_INVALID', path: dangerous,
        message: `候选含危险键被拒绝：${dangerous}`}]);
  }

  // 2. closed top-level shape: exactly {summary, assumptions, operations}
  const keys = Object.keys(candidate);
  const authority = keys.filter(key => AUTHORITY_FIELDS.includes(key));
  if (authority.length) {
    return invalid('MODEL_AUTHORITY_FIELD', authority.map(field => ({
      code: 'MODEL_AUTHORITY_FIELD', field,
      message: `模型输出不得包含本地权威字段：${field}（planId/确认/保存状态等由本地分配）`,
    })));
  }
  const unknown = keys.filter(key => !DRAFT_KEYS.includes(key));
  if (unknown.length) {
    return invalid('OUTPUT_SCHEMA_INVALID', unknown.map(field => ({
      code: 'OUTPUT_SCHEMA_INVALID', path: field,
      message: `候选出现未知顶层字段：${field}（只允许 summary/assumptions/operations）`,
    })));
  }
  const missing = DRAFT_KEYS.filter(key => !Object.prototype.hasOwnProperty.call(candidate, key));
  if (missing.length) {
    return invalid('OUTPUT_SCHEMA_INVALID', missing.map(field => ({
      code: 'OUTPUT_SCHEMA_INVALID', path: field, message: `候选缺少字段：${field}`,
    })));
  }
  if (typeof candidate.summary !== 'string' || !candidate.summary.trim()) {
    return invalid('OUTPUT_SCHEMA_INVALID',
      [{code: 'OUTPUT_SCHEMA_INVALID', path: 'summary', message: 'summary 必须是非空字符串'}]);
  }
  if (!Array.isArray(candidate.assumptions)
      || candidate.assumptions.some(item => typeof item !== 'string')) {
    return invalid('OUTPUT_SCHEMA_INVALID',
      [{code: 'OUTPUT_SCHEMA_INVALID', path: 'assumptions', message: 'assumptions 必须是字符串数组'}]);
  }
  if (!Array.isArray(candidate.operations) || !candidate.operations.length) {
    return invalid('OUTPUT_SCHEMA_INVALID',
      [{code: 'OUTPUT_SCHEMA_INVALID', path: 'operations', message: 'operations 必须是非空数组'}]);
  }
  const opShape = candidate.operations.find(op => !op || typeof op !== 'object'
    || typeof op.opId !== 'string' || typeof op.command !== 'string'
    || !Array.isArray(op.dependsOn) || !op.args || typeof op.args !== 'object');
  if (opShape) {
    return invalid('OUTPUT_SCHEMA_INVALID',
      [{code: 'OUTPUT_SCHEMA_INVALID', path: 'operations',
        message: '每个操作必须形如 {opId, command, dependsOn, args}（dependsOn 必填，可为空数组）'}]);
  }
  const platformPrefix = scope.platform === 'drawing' ? 'drawing.' : null;
  const wrongPlatform = platformPrefix
    ? candidate.operations.filter(op => !op.command.startsWith('drawing.'))
    : candidate.operations.filter(op => op.command.startsWith('drawing.'));
  if (wrongPlatform.length) {
    return invalid('OUTPUT_SCHEMA_INVALID',
      [{code: 'OUTPUT_SCHEMA_INVALID', path: 'operations',
        message: `${scope.platform} 平台方案不能包含其他平台命令：${wrongPlatform.map(op => op.command).join(', ')}`}]);
  }
  // An explicit or default-resolved scope.documentId must point at a document
  // that really exists in the injected drawing snapshot — a stale/guessed id
  // is rejected at seal time, not discovered at prepare (GATEWAY-R1).
  if (scope.platform === 'drawing' && scope.documentId) {
    const docs = settings.drawing && Array.isArray(settings.drawing.documents)
      ? settings.drawing.documents : [];
    if (!docs.some(doc => doc && doc.id === scope.documentId)) {
      return invalid('UNKNOWN_RESOURCE',
        [{code: 'UNKNOWN_RESOURCE', path: 'scope.documentId',
          message: `scope.documentId 不在当前绘图文档中：${scope.documentId}`}]);
    }
  }
  // patch/createPage target an existing document — unless this plan itself
  // creates the document they belong to (single new-document transaction,
  // no fabricated pre-existing id needed).
  const hasCreateDocument = candidate.operations
    .some(op => op.command === 'drawing.chen.createDocument');
  const needsDocument = candidate.operations.some(op => DRAWING_PAGE_COMMANDS.includes(op.command));
  if (needsDocument && !hasCreateDocument && !scope.documentId) {
    return invalid('REQUIRED_INPUT_MISSING',
      [{code: 'REQUIRED_INPUT_MISSING', path: 'scope.documentId',
        message: 'patch/createPage 需要当前文档 scope.documentId'}]);
  }
  // single-document rule: with a createDocument op, every other op must
  // transitively depend ON it (no mixing a brand-new doc with another doc).
  // Direction matters: we check each other op's ancestor closure contains the
  // createDocument op — parallel no-dependency ops are rejected (GATEWAY-R1).
  const createOp = candidate.operations.find(op => op.command === 'drawing.chen.createDocument');
  if (createOp) {
    const orphans = candidate.operations.filter(op => op.opId !== createOp.opId
      && !dependencyClosure(candidate.operations, op.opId).has(createOp.opId));
    if (orphans.length) {
      return invalid('DEPENDENCY_MISSING', orphans.map(op => ({
        code: 'DEPENDENCY_MISSING', opId: op.opId,
        message: `方案含 createDocument 时其他操作必须依赖它（单文档事务域）：${op.opId}`,
      })));
    }
  }

  // 3. locally assign every sealed field
  const now = settings.now === undefined ? Date.now() : settings.now;
  const ttlMs = settings.ttlMs === undefined ? 600000 : settings.ttlMs;
  const nextId = typeof settings.nextId === 'function'
    ? settings.nextId : (() => {
      let counter = 0;
      return () => `s${(counter += 1)}_${now.toString(36)}`;
    })();
  let readSet;
  if (scope.platform === 'modeling') {
    if (!settings.dataSource) {
      return invalid('REQUIRED_INPUT_MISSING',
        [{code: 'REQUIRED_INPUT_MISSING', message: '建模方案需要 dataSource 快照'}]);
    }
    readSet = collectReadSet(settings.dataSource, {operations: candidate.operations});
  } else {
    readSet = computeDrawingReadSet({
      documents: settings.drawing ? settings.drawing.documents : [],
      documentId: scope.documentId,
      selection: settings.drawing ? settings.drawing.selection : null,
      operations: candidate.operations,
    });
  }
  const unknownRead = readSet.filter(entry => entry.unknown);
  if (unknownRead.length) {
    return invalid('UNKNOWN_RESOURCE', unknownRead.map(entry => ({
      code: 'UNKNOWN_RESOURCE', resource: entry.resource,
      message: `readSet 资源无法计算指纹：${entry.resource}`,
    })));
  }
  const plan = {
    protocolVersion: '1.0',
    planId: `plan_${nextId()}`,
    scope: scope.documentId
      ? {platform: scope.platform, projectSessionId: scope.projectSessionId, documentId: scope.documentId}
      : {platform: scope.platform, projectSessionId: scope.projectSessionId},
    baseVersion: settings.baseVersion,
    contextDigest: computeContextDigest(readSet),
    readSet,
    expiresAt: new Date(now + ttlMs).toISOString(),
    summary: candidate.summary,
    assumptions: candidate.assumptions.slice(0, 30),
    operations: candidate.operations,
  };
  plan.planHash = computePlanHash(plan);

  // 4. final closed validation via CORE (structure, DAG, localKeys, digests)
  const basics = verifyPlanBasics(plan);
  if (!basics.ok) {
    return invalid('OUTPUT_SCHEMA_INVALID', basics.problems);
  }
  return {kind: 'plan', plan};
};
