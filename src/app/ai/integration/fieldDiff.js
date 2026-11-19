// 候选条目真实字段差异行（UI-R2）：由 SqlImportPanel / ModelingAiPanel 共享。
// 独立成模块避免面板间互相 import——SqlImportPanel 传递依赖 node-sql-parser
// （sqlDdl），建模面板不需要也不应在测试环境背上这个裸依赖。
const fieldDiffRows = (change) => {
  const after = change.after || {};
  const before = change.before || null;
  const kind = change.kind === 'create' ? 'new' : change.kind === 'remove' ? 'deleted' : 'modified';
  const rows = [{
    attr: `${change.target?.collection || ''} · ${(after.defKey || after.defName)
      || (before && (before.defKey || before.defName))
      || change.target?.localKey || change.target?.id || ''}`,
    current: before ? (before.defKey || before.name || before.reused || '—') : '—',
    candidate: after ? ((after.defKey || after.defName || after.reused || '—')
      + (Array.isArray(after.fields) ? ` (${after.fields.length}字段)` : '')) : '—',
    kind,
  }];
  if (Array.isArray(after.fields)) {
    after.fields.forEach((f) => {
      const type = `${f.type || ''}${f.len != null ? `(${f.len}${f.scale != null ? `,${f.scale}` : ''})` : ''}`;
      rows.push({
        attr: `字段 · ${f.defKey || ''}${f.defName ? ` (${f.defName})` : ''}`,
        current: '—',
        candidate: `${type || '—'}${f.primaryKey ? ' · PK' : ''}${f.notNull ? ' · NOT NULL' : ''}`,
        kind: 'new',
      });
    });
  }
  if (after.addedEdge) {
    rows.push({
      attr: `外键 · ${after.addedEdge.name || ''}`,
      current: '—',
      candidate: `${after.addedEdge.source || ''} → ${after.addedEdge.target || ''}（${after.addedEdge.relation || ''}）`,
      kind: 'new',
    });
  }
  if (Array.isArray(after.tables) && after.tables.length) {
    rows.push({
      attr: '关系图包含表',
      current: '—',
      candidate: after.tables.join(', '),
      kind: 'new',
    });
  }
  if (before && Array.isArray(before.fields)) {
    before.fields.forEach((f) => {
      rows.push({
        attr: `字段 · ${f.defKey || ''}`,
        current: `${f.type || ''}${f.primaryKey ? ' · PK' : ''}`,
        candidate: '—',
        kind: 'deleted',
      });
    });
  }
  return rows;
};

export default fieldDiffRows;
