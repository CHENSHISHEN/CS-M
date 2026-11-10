// Strict path policy for persistence-session binding, shared by every project
// read/write helper. Lifecycle steps (create / open / rename / save-as) may bind
// or rebind the session, and a lifecycle save resolves only once the new session
// is ready. Non-lifecycle writes — backups, exports, version snapshots, previews —
// never touch the session regardless of state; the only exception is a write of
// the project's own active path while the session is idle/error, which recovers it.
export const shouldEnsureDrawingSession = (current, tempFilePath, lifecycle = false) => {
  if (lifecycle) return true;
  if (!current || !current.file) return true;
  if (current.file === tempFilePath) return current.status === 'error' || current.status === 'idle';
  return false;
};
