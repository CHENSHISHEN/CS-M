// Desktop bridge: optimistic UI never counts as a durable save acknowledgment.
let ipc;
try {ipc = require('electron').ipcRenderer;} catch (err) { /* Browser preview uses its own local recovery store. */ }
let file = '';let baseline = [];let pendingDrawings = null;let projectMeta = null;let state = {status: 'idle', seq: 0};let queue = Promise.resolve();let closeGuard = () => false;
// sessionId: journal id of the session the last open/re-open established; every
// command carries it so the main process rejects writes aimed at another session.
// readyPromise/readyTarget: the latest open() while still in flight; change() calls
// issued meanwhile are bound to it (they belong to the project being opened).
let sessionId = '';let readyPromise = null;let readyTarget = '';
// Draft ownership by identity token (never by path spelling): openToken = the latest
// open() call (the project new edits are for), sessionToken = the open whose session
// is live, draftToken = the open pendingDrawings were issued for. A draft is only
// ever written into the session whose token it carries.
let openToken = {};let sessionToken = openToken;let draftToken = openToken;
const listeners = new Set();
const publish = next => {state = {...state, ...next};listeners.forEach(fn => fn(state));};
const serial = fn => {const p = queue.catch(() => {}).then(fn);queue = p;return p;};
const invoke = async (method, data = {}) => {
  if (!ipc?.invoke) throw new Error('Drawing persistence requires the desktop application');
  const result = await ipc.invoke('drawing-persistence', {method, file, ...data});
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
// A missing session (renderer reload, created project without open, or a crashed
// store) is recoverable: re-open the original file/owner/baseline once and retry
// the same commandId. The main process deduplicates commandIds, so the retry is
// idempotent and never double-applies. Session errors on other operations are
// reported to the user instead of being swallowed into fake saves.
// SESSION_STALE (the command named an older session of this path) is recovered the
// same way: re-open, adopt the current sessionId, retry the same commandId.
const isSessionError = error => typeof error?.message === 'string' && /SESSION_REQUIRED|SESSION_STALE/.test(error.message);
// 主进程对“工程文件缺失”等可恢复故障不再抛错,而是返回 status:'error' 的状态(会话与日志保持)。
// 它不是 SESSION_* 会话错误,不能触发重开;也绝不能被当成“已落盘”:发布错误状态后抛出,
// 关闭屏障、返回项目、保存等依赖 flush/commit 抛错的调用方就仍把它视为“未保存”。
const assertDurable = result => {
  if (result?.status === 'error') {publish(result);throw new Error(result.error || 'Drawing persistence error');}
  return result;
};
const adopt = result => {file = result.file || '';baseline = result.drawings;sessionId = result.sessionId || '';publish(result);};
const invokeCommand = (commandId, delta) => invoke('command', {command: {commandId, delta, ...(sessionId ? {sessionId} : {})}});
const settleInputs = async () => {window.dispatchEvent(new Event('pdmaner-drawing-flush'));document.activeElement?.blur();await new Promise(resolve => setTimeout(resolve, 0));};
const ensureOpen = async () => {
  // Never queued behind the serial queue: callers invoke this from inside a queued
  // attempt, and the main process serializes per-session work itself.
  // The unconfirmed draft is intentionally kept: it may only be cleared after the
  // retried command is acknowledged, never by the re-open itself. The baseline is
  // a full project frame (metadata + confirmed drawings), never a bare array.
  const drawings = baseline.length ? baseline : (pendingDrawings && draftToken === sessionToken ? pendingDrawings : []);
  const result = await invoke('open', {file:file || '',baseline:{...(projectMeta || {}),drawings}});
  adopt(result);
  return result;
};
// Queued work only (callers already run inside serial): write a full drawing list
// as a delta against the confirmed baseline of the session current at execution.
const writeDrawings = async drawings => {
  const before = new Map(baseline.map(d => [d.id, JSON.stringify(d)]));
  const after = new Set(drawings.map(d => d.id));
  const delta = {upsert: drawings.filter(d => before.get(d.id) !== JSON.stringify(d)), remove: baseline.filter(d => !after.has(d.id)).map(d => d.id), order: drawings.map(d => d.id)};
  delta.baseRevisions=Object.fromEntries(baseline.filter(d=>delta.remove.includes(d.id)||delta.upsert.some(n=>n.id===d.id)).map(d=>[d.id,d.revision == null ? null : d.revision]));
  const commandId = `cmd-${Date.now()}-${Math.random()}`;
  let result;
  try {result = await invokeCommand(commandId, delta);}
  catch (err) {
    if (isSessionError(err)) {
      // Controlled one-shot recovery on the original path/baseline, then retry
      // the same commandId (with the re-opened sessionId) — the journal deduplicates it.
      await ensureOpen();
      result = await invokeCommand(commandId, delta);
    } else throw err;
  }
  baseline = JSON.parse(JSON.stringify(drawings));if(JSON.stringify(pendingDrawings) === JSON.stringify(drawings))pendingDrawings = null;publish(pendingDrawings ? {...result,status:'pending'} : result);return result;
};
// Queued work only: leave the current project — write its detached draft (unless
// already confirmed) and checkpoint it, before the next project's session opens.
const leaveSession = async draft => {
  if (draft && JSON.stringify(draft) !== JSON.stringify(baseline)) await writeDrawings(draft);
  let result;
  try {result = await invoke('flush');}
  catch (err) {if (!isSessionError(err)) throw err;await ensureOpen();result = await invoke('flush');}
  assertDurable(result);publish(result);
};
if (ipc?.on) {
  ipc.on('drawing-save-state', (event, next) => {if (next.file === file) publish(pendingDrawings && ['saved','local'].includes(next.status) ? {...next,status:'pending'} : next);});
  ipc.on('drawing-before-close', async (event, requestId) => {
    try {await settleInputs();await drawingPersistence.flush();ipc.send('drawing-close-ready', {requestId, ok: true, legacyDirty: Boolean(closeGuard())});}
    catch (err) {publish({status: 'error', error: err.message});ipc.send('drawing-close-ready', {requestId, ok: false, error: err.message, legacyDirty:Boolean(closeGuard()), recoveryAvailable: !pendingDrawings && state.seq > 0 && ['conflict','error'].includes(state.status)});}
  });
}
export const drawingPersistence = {
  available: Boolean(ipc?.invoke),
  subscribe: fn => {listeners.add(fn);fn(state);return () => listeners.delete(fn);},
  getState: () => state,
  setCloseGuard: fn => {closeGuard = fn || (() => false);},
  // Serial session establishment for an untitled or just-opened project. Everything
  // up to the queued step runs synchronously (no await before serial): the fence
  // exists before the caller's next statement, so a same-tick change() is queued
  // behind this open and applies to the NEW session. Leaving the previous project
  // (write its draft + flush) happens inside the queue, ahead of the new open.
  // Opens run strictly in call order, so each one adopts its own result: commands
  // queued between two opens belong to the earlier one and must see its session.
  async open(nextFile, data, savedCopy=false) {
    if (!ipc?.invoke) return data;
    const target = nextFile || '';
    // Editors finish in-progress drafts synchronously, so their change() calls are
    // queued for the project being left, ahead of this open.
    if (file && file !== target && !savedCopy && typeof window !== 'undefined') {window.dispatchEvent(new Event('pdmaner-drawing-flush'));document.activeElement?.blur();}
    // Drafts issued before this call belong to the project being left; detach them
    // now so edits issued after it (the new project's) are never wiped or misrouted.
    // A detached draft may belong to an earlier open still in flight (not to the
    // project actually left): its token decides whether leaving may write it.
    const leavingDraft = pendingDrawings, leavingToken = draftToken, token = {};
    pendingDrawings = null;openToken = token;
    const ready = serial(async () => {
      const crossing = file !== target;
      try {
        if (file && crossing && !savedCopy) await leaveSession(leavingToken === sessionToken ? leavingDraft : null);
        const result = await invoke('open', {file:target,baseline:data});
        // Retain project-level metadata (name, version, …) so an offline recovery
        // export is still a recognizable .pdma.json even when storage is unreachable.
        if (data && !Array.isArray(data)) {const {drawings, ...meta} = data;projectMeta = meta;}
        adopt(result);sessionToken = token;
        return result;
      } catch (err) {
        // Only an open no newer call superseded may touch the draft slot (a newer
        // open already owns it). Then the live session stays the target of new
        // edits: crossing, its own unconfirmed draft is restored and the edits
        // issued for the project that failed to open are dropped (their queued
        // writes are rejected) so they can never land in it.
        if (openToken === token) {
          if (crossing) pendingDrawings = leavingToken === sessionToken && leavingDraft && JSON.stringify(leavingDraft) !== JSON.stringify(baseline) ? leavingDraft : null;
          openToken = sessionToken;draftToken = sessionToken;
        }
        throw err;
      } finally {if (readyPromise === ready) readyPromise = null;}
    });
    readyPromise = ready;readyTarget = target;
    const result = await ready;
    return {...data, drawings: result.drawings};
  },
  change(drawings) {
    if (!ipc?.invoke) {publish({status: 'error', error: 'Desktop persistence unavailable'});return Promise.reject(new Error(state.error));}
    pendingDrawings = JSON.parse(JSON.stringify(drawings));draftToken = openToken;publish({status: 'pending', error: ''});
    // Queued synchronously, so writes keep call order relative to open(): an edit
    // issued while an open is in flight runs after it, against the new session.
    const bound = readyPromise ? {promise: readyPromise, target: readyTarget} : null;
    const run = serial(async () => {
      // The open this edit was issued for failed: unless it re-targeted the very
      // project still in session, the edit is rejected rather than written into
      // the previous project.
      if (bound) {try {await bound.promise;} catch (err) {if (bound.target !== file) throw err;}}
      return writeDrawings(drawings);
    });
    return run.catch(err => {publish({status: 'error', error: err.message});throw err;});
  },
  async flush() {if (!file && state.status === 'idle') return state;await settleSafe();await queue.catch(() => {});
    if(pendingDrawings)await this.change(pendingDrawings);
    try {const result = assertDurable(await serial(() => invoke('flush')));publish(result);return result;}
    catch (err) {
      if (isSessionError(err)) {await ensureOpen();const result = assertDurable(await serial(() => invoke('flush')));publish(result);return result;}
      throw err;
    }},
  async commit(nextFile, data) {
    if (!ipc?.invoke) return null;
    if (file !== nextFile) await this.open(nextFile, data);
    await queue.catch(() => {});if(pendingDrawings)await this.change(pendingDrawings);
    const result = assertDurable(await serial(() => invoke('flush', {candidate: data})));publish(result);return result.project;
  },
  // Explicit damaged-journal recovery: settle current inputs, capture the latest
  // complete snapshot (the unconfirmed draft wins over the last confirmed
  // baseline) and let the main process back up the evidence and rebuild the
  // journal. The doomed command/flush is never attempted first, no arbitrary
  // file path crosses the bridge, and the draft survives every failed step —
  // it is cleared only after repair is acknowledged.
  async repair() {
    if (!ipc?.invoke) throw new Error(state.error || 'Drawing persistence requires the desktop application');
    await settleSafe();await queue.catch(() => {});
    const snapshotDrawings = JSON.parse(JSON.stringify(pendingDrawings || baseline));
    const snapshot = {...(projectMeta || {}), drawings: snapshotDrawings};
    const result = await serial(async () => {
      try {return await invoke('repair', {snapshot});}
      catch (err) {
        if (isSessionError(err)) {await ensureOpen();return invoke('repair', {snapshot});}
        throw err;
      }
    });
    baseline = JSON.parse(JSON.stringify(result.drawings));
    // Repair rebuilds the journal under a new id: later commands must carry it.
    sessionId = result.sessionId || sessionId;
    // Only the exact draft version that repair acknowledged may be cleared.
    // Edits that arrived while repair was in flight stay pending and are
    // written in order right away — a repair acknowledgment never discards
    // newer unconfirmed work.
    if (JSON.stringify(pendingDrawings) === JSON.stringify(snapshotDrawings)) pendingDrawings = null;
    // The journal is healthy again, but a newer unconfirmed draft must not be
    // reported as a brief fake "saved": pending work publishes as pending.
    publish(pendingDrawings ? {...result, status: 'pending'} : result);
    if (pendingDrawings) await this.change(pendingDrawings);
    return result;
  },
  recovery: async () => {await queue.catch(() => {});
    try {const project=await serial(() => invoke('recovery'));return pendingDrawings ? {...project,drawings:pendingDrawings} : project;}
    catch (err) {
      if (isSessionError(err)) {
        try {await ensureOpen();const project=await serial(() => invoke('recovery'));return pendingDrawings ? {...project,drawings:pendingDrawings} : project;}
        catch (retryErr) {if (pendingDrawings) return {...(projectMeta || {}),offlineDraft: true, drawings: pendingDrawings, error: retryErr.message};throw retryErr;}
      }
      // Storage unreachable: the unconfirmed draft is still exportable locally —
      // a failed connection must never mean data loss or a fake "saved".
      if (pendingDrawings) return {...(projectMeta || {}),offlineDraft: true, drawings: pendingDrawings, error: err.message};
      throw err;
    }},
  versions: () => invoke('versions'),
  version: name => invoke('version', {name}),
  async saveVersion(name) {await queue.catch(() => {});if(pendingDrawings)await this.change(pendingDrawings);return invoke('saveVersion',{name});},
  deleteVersion: name => invoke('deleteVersion',{name}),
  isSaved: drawings => ['saved', 'local'].includes(state.status) && JSON.stringify(drawings || []) === JSON.stringify(baseline),
};
// No recursion through flush's input event: registered editors synchronously finish drafts.
async function settleSafe() {if (typeof window !== 'undefined') {window.dispatchEvent(new Event('pdmaner-drawing-flush'));document.activeElement?.blur();await new Promise(resolve => setTimeout(resolve, 0));}}
