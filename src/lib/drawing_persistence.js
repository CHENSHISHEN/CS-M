// Desktop bridge: optimistic UI never counts as a durable save acknowledgment.
let ipc;
try {ipc = require('electron').ipcRenderer;} catch (err) { /* Browser preview uses its own local recovery store. */ }
let file = '';let baseline = [];let pendingDrawings = null;let projectMeta = null;let state = {status: 'idle', seq: 0};let queue = Promise.resolve();let closeGuard = () => false;
let readyPromise = null;const openGenerations = new Map();
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
const isSessionError = error => typeof error?.message === 'string' && error.message.includes('SESSION_REQUIRED');
const settleInputs = async () => {window.dispatchEvent(new Event('pdmaner-drawing-flush'));document.activeElement?.blur();await new Promise(resolve => setTimeout(resolve, 0));};
const ensureOpen = async () => {
  // Never queued behind the serial queue: callers invoke this from inside a queued
  // attempt, and the main process serializes per-session work itself.
  // The unconfirmed draft is intentionally kept: it may only be cleared after the
  // retried command is acknowledged, never by the re-open itself. The baseline is
  // a full project frame (metadata + confirmed drawings), never a bare array.
  const drawings = baseline.length ? baseline : (pendingDrawings || []);
  const result = await invoke('open', {file:file || '',baseline:{...(projectMeta || {}),drawings}});
  file = result.file || '';baseline = result.drawings;publish(result);
  return result;
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
  // Serial session establishment for an untitled or just-opened project. The first
  // edit can never race ahead of open: change() awaits this promise.
  async open(nextFile, data, savedCopy=false) {
    if (!ipc?.invoke) return data;
    if (file && file !== nextFile && !savedCopy) await this.flush();
    const generation = (openGenerations.get(nextFile || '') || 0) + 1;
    openGenerations.set(nextFile || '', generation);
    readyPromise = serial(async () => {
      const result = await invoke('open', {file:nextFile || '',baseline:data});
      // A newer open for the same key superseded this one (project switch/save-as):
      // its result must not overwrite the state of the newer session.
      if (openGenerations.get(nextFile || '') !== generation) return result;
      // Retain project-level metadata (name, version, …) so an offline recovery
      // export is still a recognizable .pdma.json even when storage is unreachable.
      if (data && !Array.isArray(data)) {const {drawings, ...meta} = data;projectMeta = meta;}
      pendingDrawings = null;
      file = result.file || '';baseline = result.drawings;publish(result);
      return result;
    });
    return readyPromise.then(result => (openGenerations.get(nextFile || '') !== generation ? {...data, drawings: result.drawings} : {...data, drawings: result.drawings}));
  },
  change(drawings) {
    if (!ipc?.invoke) {publish({status: 'error', error: 'Desktop persistence unavailable'});return Promise.reject(new Error(state.error));}
    pendingDrawings = JSON.parse(JSON.stringify(drawings));publish({status: 'pending', error: ''});
    const attempt = current => serial(async () => {
      const before = new Map(baseline.map(d => [d.id, JSON.stringify(d)]));
      const after = new Set(drawings.map(d => d.id));
      const delta = {upsert: drawings.filter(d => before.get(d.id) !== JSON.stringify(d)), remove: baseline.filter(d => !after.has(d.id)).map(d => d.id), order: drawings.map(d => d.id)};
      delta.baseRevisions=Object.fromEntries(baseline.filter(d=>delta.remove.includes(d.id)||delta.upsert.some(n=>n.id===d.id)).map(d=>[d.id,d.revision == null ? null : d.revision]));
      const commandId = current || `cmd-${Date.now()}-${Math.random()}`;
      let result;
      try {result = await invoke('command', {command: {commandId, delta}});}
      catch (err) {
        if (isSessionError(err)) {
          // Controlled one-shot recovery on the original path/baseline, then retry
          // the same commandId — the journal deduplicates it.
          await ensureOpen();
          result = await invoke('command', {command: {commandId, delta}});
        } else throw err;
      }
      baseline = JSON.parse(JSON.stringify(drawings));if(JSON.stringify(pendingDrawings) === JSON.stringify(drawings))pendingDrawings = null;publish(pendingDrawings ? {...result,status:'pending'} : result);return result;
    });
    const run = readyPromise ? readyPromise.catch(() => {}).then(() => attempt()) : attempt();
    return run.catch(err => {publish({status: 'error', error: err.message});throw err;});
  },
  async flush() {if (!file && state.status === 'idle') return state;await settleSafe();await queue.catch(() => {});
    if(pendingDrawings)await this.change(pendingDrawings);
    try {const result = await serial(() => invoke('flush'));publish(result);return result;}
    catch (err) {
      if (isSessionError(err)) {await ensureOpen();const result = await serial(() => invoke('flush'));publish(result);return result;}
      throw err;
    }},
  async commit(nextFile, data) {
    if (!ipc?.invoke) return null;
    if (file !== nextFile) await this.open(nextFile, data);
    await queue.catch(() => {});if(pendingDrawings)await this.change(pendingDrawings);
    const result = await serial(() => invoke('flush', {candidate: data}));publish(result);return result.project;
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
