// Shared AI orchestration — the one confirmation/guard engine both platforms
// call (GATEWAY v1). State machine: submitDraft → prepare → (updateSelection)
// → confirm → apply → undo / notePersistence / dispose.
//
// Host contract (dependency-injected, may be async):
//   getSession()          → {projectSessionId, epoch, readonly, baseVersion}
//   getSnapshot(domain)   → 'modeling-project': dataSource
//                           'drawing-document': {documents, documentId, selection}
//   commit(domain, payload) → MUST be idempotent by payload.commandId; returns
//                           {ok:true, ...} or {ok:false, code, message}; throwing
//                           is reported as APPLY_UNKNOWN (retry-safe).
//   undoDrawing?(commandId) → optional host-history undo for drawing receipts.
//
// Guarantees: preview/prepare never writes; apply re-fetches the real
// snapshot, readonly flag and session between confirmation and commit; the
// same commandId replays its receipt instead of writing again; a failed host
// commit leaves no "applied" receipt (retry keeps a true state); one host
// commit per apply; per-transaction-domain commits are mutually exclusive.
// All state is in-memory per gateway instance — nothing touches disk.
import chenModule from '../diagrams/chen.js';
import {previewPlan, applyPlan} from '../executor.js';
import {createLedger, undoChangeSet} from '../ledger.js';
import {selectOperations, topologicalOpOrder, isPlanExpired} from '../operationPlan.js';
import {encapsulateDraft, verifyDrawingReadSet, dependencyClosure} from './draft.js';

const {compileChenCommand} = chenModule;

const TRANSACTION_DOMAINS = {
  modeling: 'modeling-project',
  drawing: 'drawing-document',
};

const blockingIssue = (code, message, detail) => ({level: 'blocking', code, message, detail});

const summarizeCounts = (changes) => {
  const counts = {create: 0, update: 0, remove: 0, reuse: 0};
  (changes || []).forEach((change) => {
    if (counts[change.kind] !== undefined) counts[change.kind] += 1;
  });
  return counts;
};

// Deterministic allocator: ids depend only on the planHash and compile order,
// so preview and apply produce identical identities for the same plan.
const deterministicAllocator = (planHash) => {
  const seed = String(planHash || '').slice(0, 12);
  let counter = 0;
  return (prefix) => {
    counter += 1;
    return `${prefix || 'er'}_g${seed}_${counter}`;
  };
};

// Compile one drawing plan against a snapshot: dependency order, single
// document, bindings restricted to each op's dependency closure, patch pageId
// resolvable through plan-local page bindings. Pure — input untouched.
const compileDrawingPlan = (plan, snapshot) => {
  const documents = (snapshot && snapshot.documents) || [];
  const operations = plan.operations || [];
  const issues = [];
  const warnings = [];
  const changes = [];
  const dag = topologicalOpOrder(operations);
  if (!dag.ok) {
    return {ok: false, issues: dag.problems.map(p => blockingIssue(p.code, JSON.stringify(p))),
      warnings, changes: [], bindings: [], objects: [], affectedPages: []};
  }
  const byId = new Map(operations.map(op => [op.opId, op]));
  const createOps = operations.filter(op => op.command === 'drawing.chen.createDocument');
  if (createOps.length > 1) {
    issues.push(blockingIssue('DEPENDENCY_MISSING', '一个方案至多一个 drawing.chen.createDocument'));
  }
  const hasCreate = createOps.length === 1;
  operations.forEach((op) => {
    // Direction (GATEWAY-R1): each other op's ancestor closure must CONTAIN
    // the createDocument op, i.e. every op descends from the new document.
    // Parallel no-dependency ops and ops reaching another existing document
    // are rejected here or by closure-restricted bindings below.
    if (hasCreate && op.opId !== createOps[0].opId
      && !dependencyClosure(operations, op.opId).has(createOps[0].opId)) {
      issues.push(blockingIssue('DEPENDENCY_MISSING',
        `操作 ${op.opId} 未依赖 createDocument，不能混合新文档与现有文档`));
    }
  });
  if (!hasCreate && !plan.scope.documentId) {
    issues.push(blockingIssue('REQUIRED_INPUT_MISSING', '现有文档操作需要 scope.documentId'));
  }
  let current = hasCreate ? null
    : documents.find(doc => doc && doc.id === plan.scope.documentId) || null;
  if (!hasCreate && !current) {
    issues.push(blockingIssue('PLAN_STALE', `文档不存在或已切换：${plan.scope.documentId}`));
  }
  if (issues.length) {
    return {ok: false, issues, warnings, changes: [], bindings: [], objects: [], affectedPages: []};
  }
  const originalDocument = current;
  const bindingsByOp = new Map(); // opId → [{key, id, type}]
  const affectedPages = [];
  const objects = [];
  const allocateId = deterministicAllocator(plan.planHash);
  let isNewDocument = false;
  for (const opId of dag.order) {
    const op = byId.get(opId);
    const allowed = {};
    dependencyClosure(operations, opId).forEach((depId) => {
      if (depId === opId) return;
      (bindingsByOp.get(depId) || []).forEach((binding) => {
        allowed[binding.key] = {id: binding.id, type: binding.type};
      });
    });
    let args = op.args;
    if (op.command === 'drawing.chen.patch' && allowed[args.pageId]
        && allowed[args.pageId].type === 'page') {
      args = {...args, pageId: allowed[args.pageId].id};
    }
    // ops inside a new-document transaction operate on the new document —
    // never on the host's original selection (GATEWAY-R1: a brand-new
    // document must not be mistaken for the old selection scope).
    const onOriginal = !hasCreate;
    const result = compileChenCommand({
      command: op.command,
      args,
      document: current,
      source: {documents},
      scope: {
        platform: 'drawing',
        documentId: current ? current.id : undefined,
        selection: onOriginal && snapshot.selection ? snapshot.selection : undefined,
      },
      allocateId,
      bindings: allowed,
    });
    if (!result.ok) {
      // candidate fails → original document untouched (compile is pure)
      return {ok: false, issues: result.issues, warnings, changes: [], bindings: [],
        objects: [], affectedPages: []};
    }
    current = result.document;
    if (op.command === 'drawing.chen.createDocument') isNewDocument = true;
    if (result.page && !affectedPages.includes(result.page.id)) affectedPages.push(result.page.id);
    const produced = [];
    Object.keys(result.idMap || {}).forEach((key) => {
      const entry = result.idMap[key];
      if (!entry || !entry.id) return;
      produced.push({key, id: entry.id, type: entry.type});
      objects.push({opId, collection: entry.type === 'page' ? 'drawingPages'
        : entry.type === 'document' ? 'drawingDocuments' : 'drawingSemantic',
      id: entry.id, localKey: key});
    });
    bindingsByOp.set(opId, produced);
    (result.changes || []).forEach((change, index) => {
      changes.push({...change, opId, changeIndex: index});
    });
    (result.warnings || []).forEach(w => warnings.push({...w, opId}));
  }
  return {
    ok: true,
    document: current,
    originalDocument,
    isNewDocument,
    affectedPages,
    changes,
    warnings,
    bindings: [...bindingsByOp.values()].reduce((all, list) => all.concat(list), []),
    objects,
  };
};

// Create the shared gateway instance. One instance per product session; the
// drawing and modeling domains share the confirmation/receipt discipline.
export const createGateway = ({host}) => {
  if (!host || typeof host.getSession !== 'function'
      || typeof host.getSnapshot !== 'function' || typeof host.commit !== 'function') {
    throw new Error('createGateway 需要 host {getSession, getSnapshot, commit}');
  }
  const plans = new Map();        // planId → {plan, prepared, epoch, createdAt}
  const confirmations = new Map();// confirmationId → record
  const receipts = new Map();     // commandId → {receipt, domain, kind}
  const ledger = createLedger();
  const mutex = new Set();        // busy transaction domains
  let idCounter = 0;
  let generation = 0;             // bumped by dispose(); in-flight writes abort

  const now = () => (typeof host.now === 'function' ? host.now() : Date.now());
  const nextId = () => {
    idCounter += 1;
    return `${now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  };
  const fail = (code, message, detail) => (detail === undefined
    ? {ok: false, code, message} : {ok: false, code, message, detail});
  const domainOf = plan => TRANSACTION_DOMAINS[plan.scope.platform];
  const voidConfirmations = (predicate, reason) => {
    confirmations.forEach((record) => {
      if (!record.consumed && !record.void && predicate(record)) {
        record.void = true;
        record.voidReason = reason;
      }
    });
  };
  // Write-boundary re-validation (GATEWAY-R1 addendum): between the session
  // check and the host commit we await async snapshots, during which the host
  // may flip readonly/epoch/session or the whole gateway may be disposed. A
  // stale apply/undo must abort HERE — never reach host.commit/undoDrawing.
  // `origin` carries the session values the guards already approved plus the
  // gateway generation; the same values ride the commit payload as
  // `expected` so the host can re-check inside its own synchronous write.
  const revalidateForWrite = async (origin) => {
    if (generation !== origin.generation) {
      return {ok: false, code: 'PLAN_NOT_FOUND',
        message: '网关会话已清理（dispose），提交中止'};
    }
    const fresh = await host.getSession();
    if (fresh.projectSessionId !== origin.projectSessionId) {
      return {ok: false, code: 'PROJECT_CHANGED',
        message: '宿主写入边界前项目会话已切换，中止提交'};
    }
    if (String(fresh.epoch) !== String(origin.epoch)) {
      return {ok: false, code: 'PROJECT_CHANGED',
        message: '宿主写入边界前会话 epoch 已变化，中止提交'};
    }
    if (fresh.readonly) {
      return {ok: false, code: 'READ_ONLY',
        message: '宿主写入边界前转只读，中止提交'};
    }
    return {ok: true, expected: {
      projectSessionId: origin.projectSessionId, epoch: origin.epoch,
      baseVersion: origin.baseVersion,
    }};
  };

  // ---- draft intake: local sealing only, nothing written ----
  const submitDraft = async (options) => {
    let settings = options || {};
    const session = await host.getSession();
    const snapshotDomain = settings.platform === 'drawing'
      ? 'drawing-document' : 'modeling-project';
    const snapshot = await host.getSnapshot(snapshotDomain);
    // Resolve the effective documentId BEFORE building the sealed scope: an
    // implicit default (current host document) must reach encapsulateDraft,
    // otherwise createPage-only drafts fail REQUIRED_INPUT_MISSING even when
    // the host snapshot has a valid current document (GATEWAY-R1). Explicit
    // ids win over the default; invalid ids are rejected during sealing.
    if (settings.platform === 'drawing' && !settings.documentId && snapshot.documentId) {
      settings = {...settings, documentId: snapshot.documentId};
    }
    const scope = {
      platform: settings.platform,
      projectSessionId: session.projectSessionId,
    };
    if (settings.documentId) scope.documentId = settings.documentId;
    const drawingInput = settings.platform === 'drawing'
      ? {documents: snapshot.documents, selection: snapshot.selection} : undefined;
    const result = encapsulateDraft({
      modelOutput: settings.modelOutput,
      scope,
      baseVersion: settings.baseVersion || session.baseVersion,
      dataSource: settings.platform === 'drawing' ? undefined : snapshot,
      drawing: drawingInput,
      ttlMs: settings.ttlMs,
      now: now(),
      nextId,
    });
    if (result.kind === 'plan') {
      plans.set(result.plan.planId, {plan: result.plan, prepared: null,
        epoch: session.epoch, createdAt: now()});
      // a new draft voids pending confirmations on the same platform+session
      voidConfirmations(record => record.projectSessionId === session.projectSessionId
        && record.platform === settings.platform, 'new-draft');
    }
    return result;
  };

  // ---- stage A: preview. Read-only; never mutates the snapshot. Preview
  // stays available across session/epoch switches (read-only explanation),
  // but the guard result is reported so confirm/apply can refuse it. ----
  const sessionGuardOf = async (plan, entry) => {
    const session = await host.getSession();
    if (session.projectSessionId !== plan.scope.projectSessionId) {
      return {ok: false, code: 'PROJECT_CHANGED',
        message: '草案属于另一个项目会话：仅可只读预演，不能确认或提交'};
    }
    if (String(entry.epoch) !== String(session.epoch)) {
      return {ok: false, code: 'PROJECT_CHANGED',
        message: '草案属于旧会话 epoch（切项目/另存后）：仅可只读预演，不能确认或提交'};
    }
    return {ok: true};
  };
  const prepare = async (planId) => {
    const entry = plans.get(planId);
    if (!entry) return fail('PLAN_NOT_FOUND', `方案不存在：${planId}`);
    const plan = entry.plan;
    if (isPlanExpired(plan, now())) return fail('PLAN_STALE', '方案已过期，请重新生成');
    const sessionGuard = await sessionGuardOf(plan, entry);
    if (plan.scope.platform === 'modeling') {
      const snapshot = await host.getSnapshot('modeling-project');
      // pure preview with the SAME planHash-derived allocator apply uses, so
      // candidate identities (bindings/dataSource) match the committed ones;
      // includeDataSource is explicit — the candidate carries the computed
      // next snapshot for rendering, never the stale input, and no host
      // commit / fake confirmation is involved (GATEWAY-R1).
      const candidate = previewPlan(snapshot, plan, {
        idAllocator: deterministicAllocator(plan.planHash),
        includeDataSource: true,
      });
      entry.prepared = {domain: 'modeling-project', candidate, preparedAt: now()};
      return {ok: true, domain: 'modeling-project', candidate, sessionGuard};
    }
    const snapshot = await host.getSnapshot('drawing-document');
    const compiled = compileDrawingPlan(plan, snapshot);
    const candidate = {
      planId: plan.planId,
      planHash: plan.planHash,
      transactionDomain: 'drawing-document',
      persistenceMode: 'drawing-autosave',
      document: compiled.ok ? compiled.document : null, // real candidate for rendering
      isNewDocument: compiled.isNewDocument === true,
      documentId: compiled.ok && compiled.document ? compiled.document.id : plan.scope.documentId,
      affectedPages: compiled.affectedPages || [],
      changes: compiled.changes || [],
      dependencies: (plan.operations || []).reduce((all, op) =>
        all.concat((op.dependsOn || []).map(dep => ({from: op.opId, to: dep, reason: 'dependsOn'}))), []),
      blockingIssues: compiled.issues || [],
      warnings: compiled.warnings || [],
      counts: summarizeCounts(compiled.changes),
      bindings: compiled.bindings || [],
    };
    entry.prepared = {domain: 'drawing-document', candidate, preparedAt: now()};
    return {ok: true, domain: 'drawing-document', candidate, sessionGuard};
  };

  // ---- partial selection: CORE closure + fresh planHash; old confirmations die ----
  const updateSelection = (planId, selectedOpIds) => {
    const entry = plans.get(planId);
    if (!entry) return fail('PLAN_NOT_FOUND', `方案不存在：${planId}`);
    const result = selectOperations(entry.plan, selectedOpIds);
    if (!result.ok) return fail(result.code, '部分选择失败', result);
    entry.plan = result.plan;
    entry.prepared = null;
    voidConfirmations(record => record.planId === planId, 'selection-changed');
    return {ok: true, plan: entry.plan};
  };

  // ---- host-local confirmation bound to session/epoch/planHash/scope/ttl ----
  const confirm = async (planId, {planHash} = {}) => {
    const entry = plans.get(planId);
    if (!entry) return fail('PLAN_NOT_FOUND', `方案不存在：${planId}`);
    const plan = entry.plan;
    if (planHash !== plan.planHash) {
      return fail('PLAN_STALE', 'planHash 与当前方案不一致（方案已变化，请重新审阅确认）');
    }
    if (isPlanExpired(plan, now())) return fail('PLAN_STALE', '方案已过期');
    const session = await host.getSession();
    if (session.projectSessionId !== plan.scope.projectSessionId) {
      return fail('PROJECT_CHANGED', '方案属于另一个项目会话');
    }
    // a new epoch must not re-certify an old-epoch draft (GATEWAY-R1):
    // the confirmation binds the draft's own epoch, and it can only be issued
    // while the host is still in exactly that session+epoch.
    if (String(entry.epoch) !== String(session.epoch)) {
      return fail('PROJECT_CHANGED',
        '草案属于旧会话 epoch（切项目/另存后），请重新生成并确认；只读预演仍可用');
    }
    voidConfirmations(record => record.planId === planId, 'superseded');
    const confirmationId = `cfm_${nextId()}`;
    const record = {
      confirmationId,
      planId,
      planHash: plan.planHash,
      platform: plan.scope.platform,
      documentId: plan.scope.documentId,
      projectSessionId: session.projectSessionId,
      epoch: entry.epoch,
      expiresAt: plan.expiresAt,
      createdAt: now(),
      consumed: false,
      void: false,
    };
    confirmations.set(confirmationId, record);
    return {ok: true, confirmationId, expiresAt: record.expiresAt};
  };

  // ---- stage B: guarded, atomic, idempotent apply ----
  const apply = async ({planId, confirmationId, commandId}) => {
    const startGeneration = generation; // captured before ANY await
    const entry = plans.get(planId);
    if (!entry) return fail('PLAN_NOT_FOUND', `方案不存在：${planId}`);
    const plan = entry.plan;
    const cmd = commandId || `cmd_${nextId()}`;
    const domain = domainOf(plan);
    // idempotent replay FIRST: same commandId returns the committed receipt
    // even though its confirmation was already consumed by that commit.
    const committed = receipts.get(cmd);
    if (committed) {
      if (committed.receipt.planId !== planId || committed.receipt.planHash !== plan.planHash) {
        return fail('PLAN_STALE', '该 commandId 已绑定另一个方案；重新确认后再提交', {commandId: cmd});
      }
      // a command that has since been undone must not replay as "applied"
      // (GATEWAY-R1) — the commit is no longer in effect on the host.
      if (committed.receipt.state === 'undone') {
        return fail('COMMAND_UNDONE',
          '该命令已被撤销，不能按已应用重放；如需再次应用请重新确认并使用新 commandId',
          {commandId: cmd});
      }
      return {ok: true, replayed: true, commandId: cmd, receipt: committed.receipt};
    }
    const confirmation = confirmations.get(confirmationId);
    if (!confirmation || confirmation.void) {
      return fail('CONFIRMATION_REQUIRED',
        '缺少有效确认记录：请基于当前方案重新确认（本机确认，不能由模型提供）', {commandId: cmd});
    }
    if (confirmation.consumed) {
      return fail('CONFIRMATION_REQUIRED', '该确认已用于一次提交', {commandId: cmd});
    }
    if (confirmation.planId !== planId || confirmation.planHash !== plan.planHash) {
      return fail('CONFIRMATION_REQUIRED',
        '确认与当前方案不一致（勾选/映射/内容已变化，需重新确认）', {commandId: cmd});
    }
    // re-fetch real session between confirmation and commit
    const session = await host.getSession();
    if (confirmation.projectSessionId !== session.projectSessionId) {
      return fail('PROJECT_CHANGED', '项目会话已切换', {commandId: cmd});
    }
    if (String(confirmation.epoch) !== String(session.epoch)) {
      return fail('PROJECT_CHANGED', '会话 epoch 已变化（切项目/另存等），旧确认失效', {commandId: cmd});
    }
    // the draft itself must still belong to the current session+epoch —
    // an old-epoch plan cannot be applied through any confirmation (R1).
    if (String(entry.epoch) !== String(session.epoch)) {
      return fail('PROJECT_CHANGED', '草案属于旧会话 epoch，不能提交', {commandId: cmd});
    }
    if (session.readonly) {
      return fail('READ_ONLY', '当前只读，仅可预览', {commandId: cmd});
    }
    if (isPlanExpired(plan, now())) {
      return fail('PLAN_STALE', '方案已过期', {commandId: cmd});
    }
    if (mutex.has(domain)) {
      return fail('APPLY_IN_PROGRESS', `事务域 ${domain} 已有提交进行中`, {commandId: cmd});
    }
    mutex.add(domain);
    try {
      // origin session for the write-boundary re-validation + host `expected`;
      // the generation is the one captured at apply entry, so a dispose that
      // happens anywhere during the async flow aborts at the write boundary.
      const origin = {generation: startGeneration,
        projectSessionId: session.projectSessionId,
        epoch: session.epoch, baseVersion: session.baseVersion};
      if (domain === 'modeling-project') {
        const snapshot = await host.getSnapshot('modeling-project');
        const scratch = createLedger();
        // same planHash-derived allocator as prepare: retry after an unknown
        // commit state re-derives the identical candidate identity (R1)
        const applied = applyPlan(snapshot, plan, {
          commandId: cmd,
          confirmationId,
          idAllocator: deterministicAllocator(plan.planHash),
          ledger: scratch,
          context: {
            projectSessionId: session.projectSessionId,
            baseVersion: session.baseVersion,
            readonly: session.readonly,
            now: now(),
          },
        });
        if (!applied.ok) {
          // surface the underlying staleness code CORE wraps in APPLY_FAILED
          const firstBlocking = (applied.issues || []).find(i => i.level === 'blocking');
          const surfaced = applied.code === 'APPLY_FAILED' && firstBlocking
            && ['PLAN_STALE', 'UNKNOWN_RESOURCE', 'PROJECT_CHANGED'].includes(firstBlocking.code)
            ? firstBlocking.code : applied.code;
          return fail(surfaced, applied.message, {issues: applied.issues, commandId: cmd});
        }
        const [record] = scratch.list();
        const boundary = await revalidateForWrite(origin);
        if (!boundary.ok) {
          return fail(boundary.code, boundary.message, {commandId: cmd});
        }
        let commit;
        try {
          commit = await host.commit('modeling-project', {
            kind: 'modeling-apply',
            commandId: cmd,
            planHash: plan.planHash,
            dataSource: applied.dataSource, // next snapshot built from the FRESH one
            receipt: applied.receipt,
            expected: boundary.expected, // host re-checks session/epoch/baseVersion at its write boundary
          });
        } catch (error) {
          return fail('APPLY_UNKNOWN', `宿主提交状态未知：${error && error.message}`,
            {retryable: true, commandId: cmd});
        }
        if (!commit || commit.ok !== true) {
          // no receipt, no ledger entry — retry keeps a true state
          return fail((commit && commit.code) || 'COMMIT_FAILED',
            '宿主提交失败，可使用同一 commandId 重试',
            {retryable: true, commandId: cmd});
        }
        if (record) ledger.record(record);
        receipts.set(cmd, {receipt: applied.receipt, domain, kind: 'modeling-apply',
          projectSessionId: session.projectSessionId, epoch: session.epoch});
        confirmation.consumed = true;
        voidConfirmations(rec => rec.platform === plan.scope.platform
          && rec.projectSessionId === session.projectSessionId, 'applied');
        return {ok: true, commandId: cmd, receipt: applied.receipt};
      }
      // drawing-document domain
      const snapshot = await host.getSnapshot('drawing-document');
      const verification = verifyDrawingReadSet({
        documents: snapshot.documents,
        documentId: plan.scope.documentId,
        selection: snapshot.selection,
        operations: plan.operations,
      }, plan.readSet);
      if (!verification.ok) {
        return fail('PLAN_STALE', '绘图文档/选区自规划后已变化', {
          stale: verification.stale, commandId: cmd});
      }
      const compiled = compileDrawingPlan(plan, snapshot);
      if (!compiled.ok || (compiled.issues || []).length) {
        return fail('APPLY_FAILED', '绘图候选编译失败（原文档不变）', {
          issues: compiled.issues, commandId: cmd});
      }
      let commit;
      const boundary = await revalidateForWrite(origin);
      if (!boundary.ok) {
        return fail(boundary.code, boundary.message, {commandId: cmd});
      }
      try {
        commit = await host.commit('drawing-document', {
          kind: 'drawing-apply',
          commandId: cmd,
          planHash: plan.planHash,
          document: compiled.document,      // one complete candidate document
          historyParams: {                  // host performs exactly one history.apply
            commandId: cmd,
            label: plan.summary.slice(0, 120),
            documentId: compiled.document.id,
            isNewDocument: compiled.isNewDocument,
            affectedPages: compiled.affectedPages,
          },
          expected: Object.assign({}, boundary.expected,
            plan.scope.documentId ? {documentId: plan.scope.documentId} : {}),
          objects: compiled.objects,
          changes: compiled.changes,
        });
      } catch (error) {
        return fail('APPLY_UNKNOWN', `宿主提交状态未知：${error && error.message}`,
          {retryable: true, commandId: cmd});
      }
      if (!commit || commit.ok !== true) {
        return fail((commit && commit.code) || 'COMMIT_FAILED',
          '宿主提交失败，可使用同一 commandId 重试',
          {retryable: true, commandId: cmd});
      }
      const receipt = {
        commandId: cmd,
        planId: plan.planId,
        planHash: plan.planHash,
        state: 'applied', // document draft applied; saving is the host's separate ack
        objects: compiled.objects,
        projectSessionId: plan.scope.projectSessionId,
        afterVersion: `${plan.baseVersion}+${cmd}`,
        undo: typeof host.undoDrawing === 'function'
          ? {available: true, mode: 'host-history', token: cmd}
          : {available: false, reason: '宿主未注册绘图 history 撤销入口'},
        persistence: {state: 'dirty'},
      };
      receipts.set(cmd, {receipt, domain, kind: 'drawing-apply',
        projectSessionId: session.projectSessionId, epoch: session.epoch});
      confirmation.consumed = true;
      voidConfirmations(rec => rec.platform === 'drawing'
        && rec.projectSessionId === session.projectSessionId, 'applied');
      return {ok: true, commandId: cmd, receipt};
    } finally {
      mutex.delete(domain);
    }
  };

  // ---- undo: modeling via CORE inverse+postcheck then ONE commit; drawing
  // delegates to the host history (no second drawing history here). Before
  // ANY host write the current session/epoch/readonly flag and the receipt's
  // owning session are verified; after a successful undo the original receipt
  // flips to 'undone' (undo unavailable) and a repeated undo replays the
  // original undo receipt instead of writing again (GATEWAY-R1). ----
  const undo = async ({commandId}) => {
    const startGeneration = generation; // captured before ANY await
    const stored = receipts.get(commandId);
    if (!stored) return fail('UNDO_UNKNOWN', `没有该命令的应用回执：${commandId}`);
    if (!String(stored.kind).endsWith('-apply')) {
      return fail('UNDO_UNKNOWN', `该回执不是可撤销的应用回执：${commandId}`);
    }
    const undoCommandId = `undo_${commandId}`;
    if (stored.receipt.state === 'undone') {
      const prior = receipts.get(undoCommandId);
      if (prior) return {ok: true, replayed: true, commandId: undoCommandId, receipt: prior.receipt};
      return fail('UNDO_UNKNOWN', `该命令已撤销：${commandId}`);
    }
    // guards BEFORE any host write / ledger inverse replay
    const session = await host.getSession();
    if (session.readonly) {
      return fail('READ_ONLY', '当前只读，不能撤销（仅可预览）', {commandId});
    }
    if (stored.projectSessionId !== undefined
        && stored.projectSessionId !== session.projectSessionId) {
      return fail('PROJECT_CHANGED', '回执属于另一个项目会话，不能在此撤销', {commandId});
    }
    if (stored.epoch !== undefined && String(stored.epoch) !== String(session.epoch)) {
      return fail('PROJECT_CHANGED', '会话 epoch 已变化（切项目/另存/同ID新项目），原回执不能撤销',
        {commandId});
    }
    // origin for the write-boundary re-validation; undo receipts carry the
    // owning session of the ORIGINAL apply, so expected reflects that.
    const origin = {generation: startGeneration,
      projectSessionId: session.projectSessionId,
      epoch: session.epoch, baseVersion: session.baseVersion};
    // dispose during the async guard already invalidated this gateway (and
    // its ledger) — abort before touching the ledger/host at all.
    if (generation !== startGeneration) {
      return fail('PLAN_NOT_FOUND', '网关会话已清理（dispose），撤销中止', {commandId});
    }
    if (stored.domain === 'drawing-document') {
      if (typeof host.undoDrawing !== 'function') {
        return fail('CAPABILITY_UNAVAILABLE', '绘图撤销由宿主 history undo/redo 提供');
      }
      const boundary = await revalidateForWrite(origin);
      if (!boundary.ok) {
        return fail(boundary.code, boundary.message, {commandId});
      }
      let result;
      try {
        result = await host.undoDrawing(commandId);
      } catch (error) {
        return fail('APPLY_UNKNOWN', `宿主撤销状态未知：${error && error.message}`,
          {retryable: true, commandId: undoCommandId});
      }
      if (!result || result.ok !== true) {
        return fail((result && result.code) || 'COMMIT_FAILED',
          '宿主绘图撤销失败，回执未变更', {retryable: true, commandId: undoCommandId});
      }
      stored.receipt.state = 'undone';
      stored.receipt.undo = {available: false, reason: '已撤销'};
      const undoReceipt = result.receipt || {
        commandId: undoCommandId,
        sourceCommandId: commandId,
        planId: stored.receipt.planId,
        planHash: stored.receipt.planHash,
        state: 'undone',
        mode: 'host-history',
      };
      receipts.set(undoCommandId, {receipt: undoReceipt, domain: 'drawing-document',
        kind: 'drawing-undo', projectSessionId: session.projectSessionId, epoch: session.epoch});
      return {ok: true, mode: 'host-history', commandId: undoCommandId, receipt: undoReceipt};
    }
    if (mutex.has('modeling-project')) {
      return fail('APPLY_IN_PROGRESS', '事务域 modeling-project 已有提交进行中');
    }
    mutex.add('modeling-project');
    try {
      const snapshot = await host.getSnapshot('modeling-project');
      // post-fingerprint check + inverse replay; ledger untouched on failure
      const undone = undoChangeSet(snapshot, ledger, commandId);
      if (!undone.ok) {
        return fail(undone.code, undone.message, undone.detail);
      }
      const boundary = await revalidateForWrite(origin);
      if (!boundary.ok) {
        return fail(boundary.code, boundary.message, {commandId});
      }
      let commit;
      try {
        commit = await host.commit('modeling-project', {
          kind: 'modeling-undo',
          commandId: undoCommandId,
          sourceCommandId: commandId,
          dataSource: undone.dataSource,
          receipt: undone.receipt,
          expected: boundary.expected,
        });
      } catch (error) {
        return fail('APPLY_UNKNOWN', `宿主提交状态未知：${error && error.message}`,
          {retryable: true, commandId: undoCommandId});
      }
      if (!commit || commit.ok !== true) {
        return fail((commit && commit.code) || 'COMMIT_FAILED',
          '撤销提交失败，台账未变更', {retryable: true, commandId: undoCommandId});
      }
      stored.receipt.state = 'undone';
      stored.receipt.undo = {available: false, reason: '已撤销'};
      receipts.set(undoCommandId, {receipt: undone.receipt,
        domain: 'modeling-project', kind: 'modeling-undo',
        projectSessionId: session.projectSessionId, epoch: session.epoch});
      return {ok: true, commandId: undoCommandId, receipt: undone.receipt};
    } finally {
      mutex.delete('modeling-project');
    }
  };

  // ---- applied ≠ saved: only the host's real save ack may move this ----
  const notePersistence = ({commandId, state, revision, errorCode}) => {
    const stored = receipts.get(commandId);
    if (!stored) return fail('UNDO_UNKNOWN', `没有该命令的回执：${commandId}`);
    if (!['dirty', 'saving', 'saved', 'error'].includes(state)) {
      return fail('OUTPUT_SCHEMA_INVALID', `未知持久化状态：${state}`);
    }
    stored.receipt.persistence = errorCode === undefined
      ? {state, ...(revision === undefined ? {} : {revision})}
      : {state, errorCode};
    return {ok: true, persistence: stored.receipt.persistence};
  };

  const discard = (planId) => {
    const entry = plans.get(planId);
    if (!entry) return fail('PLAN_NOT_FOUND', `方案不存在：${planId}`);
    plans.delete(planId);
    voidConfirmations(record => record.planId === planId, 'discarded');
    return {ok: true}; // prepare was pure: no real asset ever existed
  };

  // read-only accessors for the UI/integration layer
  const getPlan = planId => (plans.has(planId)
    ? {ok: true, plan: plans.get(planId).plan} : fail('PLAN_NOT_FOUND', `方案不存在：${planId}`));
  const getCandidate = (planId) => {
    const entry = plans.get(planId);
    if (!entry) return fail('PLAN_NOT_FOUND', `方案不存在：${planId}`);
    if (!entry.prepared) return fail('PLAN_STALE', '尚未预演，先调用 prepare');
    return {ok: true, domain: entry.prepared.domain, candidate: entry.prepared.candidate};
  };
  const getReceipt = commandId => (receipts.has(commandId)
    ? {ok: true, receipt: receipts.get(commandId).receipt}
    : fail('UNDO_UNKNOWN', `没有该命令的回执：${commandId}`));
  const listReceipts = () => [...receipts.entries()].map(([commandId, stored]) => ({
    commandId, planId: stored.receipt.planId, planHash: stored.receipt.planHash,
    state: stored.receipt.state, domain: stored.domain, kind: stored.kind,
    persistence: stored.receipt.persistence,
  }));

  // session teardown: clear conversations-equivalents; ledger metadata only.
  // Bumping the generation aborts in-flight applies/undos at their write
  // boundary — a disposed gateway never reaches host.commit.
  const dispose = () => {
    generation += 1;
    plans.clear();
    confirmations.clear();
    receipts.clear();
    ledger.fromJSON([]);
    mutex.clear();
    return {ok: true};
  };

  return {
    submitDraft, prepare, updateSelection, confirm, apply, undo,
    notePersistence, discard, getPlan, getCandidate, getReceipt,
    listReceipts, dispose,
    // exposed for narrow host-side checks; not part of the model contract
    _ledger: ledger,
  };
};
