// SQL DDL 导入（INTEGRATION A4）：用户粘贴 DDL → 本地 node-sql-parser 方言解析
// （parseDdlScript，确定性路径，不经模型）→ 诊断式草稿（draftTableOpsFromDdl）。
// 混合脚本未确认时阻断（SQL_PARTIAL_PARSE），确认后仅导入可表达子集并显示
// 损失/未支持语句定位；外部 FK/同名歧义保持待处理，不静默丢失。生成的
// operations 仍走共享 GATEWAY（submitDraft→prepare→ChangeReview→confirm→apply），
// 不拿解析结果直接写库。
// UI-R2：目标必须落到真实本地物理模型库/目录（profile.modelCatalog
// .physicalDatabases / catalogCategories），选择库即决定目标类型并明示；
// 不选时明示“未归类”，不冒称当前库，也不提供库新建。SQL 文本/方言/类型/
// 目标任一变化都会作废已解析草稿与已审阅方案，旧文本不可能被应用。
import React, {useMemo, useState, useCallback, useEffect} from 'react';
import {ChangeReview, createMessages} from '../index';
import {describeError} from './aiRuntime';
import {parseDdlScript, draftTableOpsFromDdl} from '../../../lib/ai/sqlDdl';
import {deriveApplyState} from '../stateAdapter';
import {PLAN_STATUS} from '../stateAdapter';
import {getCatalogCategories} from '../../../lib/model_catalog';
// 真实字段差异行与建模面板共享（独立模块，不把 node-sql-parser 传给建模面板）
import fieldDiffRows from './fieldDiff';

export {fieldDiffRows};

const DIALECTS = [{value: 'mysql', label: 'MySQL'}, {value: 'postgresql', label: 'PostgreSQL'}];

const opLabel = (op) => ({
  'model.table.create': '新建表', 'model.field.add': '新增字段',
  'model.foreignKey.create': '新建外键', 'model.diagram.create': '新建关系图',
}[op.command] || op.command);

const SqlImportPanel = ({runtime, locale = 'zh', labels, dataSource, readOnly = false,
                          onCandidateChange, onSaveProject}) => {
  const t = useMemo(() => createMessages(locale, labels), [locale, labels]);
  const dbSupports = (dataSource?.profile?.dataTypeSupports || []);
  const databases = (dataSource?.profile?.modelCatalog?.physicalDatabases || []);
  const categories = useMemo(() => getCatalogCategories(dataSource) || [], [dataSource]);
  const [dialect, setDialect] = useState('mysql');
  const [databaseId, setDatabaseId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dbSupportId, setDbSupportId] = useState(dbSupports[0]?.id || '');
  const [sqlText, setSqlText] = useState('');
  const [parsed, setParsed] = useState(null);        // parseDdlScript 结果
  const [drafted, setDrafted] = useState(null);      // draftTableOpsFromDdl 结果
  const [acknowledged, setAcknowledged] = useState(false);
  const [parseError, setParseError] = useState('');
  const [invalidated, setInvalidated] = useState(false); // UI-R2：目标/文本变化作废提示
  const [review, setReview] = useState(null);        // {planId, plan, candidate, selectedOpIds}
  const [reviewVisible, setReviewVisible] = useState(true);
  const [applying, setApplying] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [appliedError, setAppliedError] = useState('');

  useEffect(() => {
    if (!dbSupportId && dbSupports.length) setDbSupportId(dbSupports[0].id);
  }, [dbSupports, dbSupportId]);

  const selectedDatabase = databases.find(d => d.id === databaseId) || null;
  const dbTypeName = (id) => {
    const support = dbSupports.find(d => d.id === id);
    return support ? (support.defName || support.defKey) : (id || '—');
  };

  // UI-R2：SQL 文本/方言/类型/目标库/目录任一变化 → 已解析草稿与已审阅方案全部
  // 作废（含已选候选 tab 下线），不允许回头应用旧文本生成的方案。
  const invalidate = useCallback(() => {
    if (parsed || drafted || review) {
      setInvalidated(true);
      if (onCandidateChange) onCandidateChange(null, 'sql');
    }
    setParsed(null);
    setDrafted(null);
    setAcknowledged(false);
    setReview(null);
    setReceipt(null);
    setAppliedError('');
    setParseError('');
  }, [parsed, drafted, review, onCandidateChange]);

  const doParse = useCallback(() => {
    setParseError('');
    setReview(null);
    setReceipt(null);
    setAcknowledged(false);
    setAppliedError('');
    setInvalidated(false);
    if (!sqlText.trim()) {
      setParsed(null);
      setDrafted(null);
      return;
    }
    const result = parseDdlScript(sqlText, {dialect});
    setParsed(result);
    setDrafted(draftTableOpsFromDdl(result, {acknowledgeUnsupported: false}));
  }, [sqlText, dialect]);

  const acknowledge = useCallback(() => {
    if (!parsed) return;
    setAcknowledged(true);
    setDrafted(draftTableOpsFromDdl(parsed, {acknowledgeUnsupported: true}));
  }, [parsed]);

  // ---- 提交：operations + 宿主选择的 dbType/database/category → GATEWAY 封装/预演 ----
  const submit = useCallback(async () => {
    if (!runtime || !drafted || drafted.blocked) return;
    // UI-R2（msg_9953b85cd37c）：脚本内 FK 需要同时包含两端的物理关系图宿主
    // （CORE 的 FK_NO_HOST_DIAGRAM 守卫不放松）——有 FK 时组装可审阅的
    // model.diagram.create（含全部导入表，FK 依赖它）；重复导入按既有
    // diagrams defKey 扫描加后缀，绝不撞 DUPLICATE_CODE。
    const tableOps = drafted.operations.filter(o => o.command === 'model.table.create');
    const fkOps = drafted.operations.filter(o => o.command === 'model.foreignKey.create');
    const uniqueBy = (base, used, sep = '_') => {
      let candidate = base;
      let n = 2;
      while (used.has(candidate)) {
        candidate = `${base}${sep}${n}`;
        n += 1;
      }
      return candidate;
    };
    let diagramOp = null;
    if (tableOps.length > 0 && fkOps.length > 0) {
      const usedDefKeys = new Set((dataSource?.diagrams || [])
        .map(d => String(d.defKey || '').toLowerCase()));
      const usedLocalKeys = new Set(drafted.operations
        .map(o => o.args && o.args.localKey).filter(Boolean));
      const usedOpIds = new Set(drafted.operations.map(o => o.opId));
      const defKey = uniqueBy('ddl_import', usedDefKeys);
      diagramOp = {
        opId: uniqueBy('op-diagram-ddl-import', usedOpIds, '-'),
        command: 'model.diagram.create',
        dependsOn: tableOps.map(o => o.opId),
        args: {
          localKey: uniqueBy('ddl_import_diagram', usedLocalKeys),
          defKey,
          defName: t('sql.autoDiagramDefName'),
          // 命令合同：物理图 level 必须显式为 physical（OUTPUT_SCHEMA_INVALID）
          level: 'physical',
          tables: tableOps.map(o => ({kind: 'local', key: o.args.localKey})),
        },
      };
    }
    const operations = [
      ...tableOps.map((op) => ({
        ...op,
        args: {...op.args,
          dbType: {kind: 'existing', collection: 'dataTypeSupports', id: dbSupportId},
          // UI-R2：按命令合同传稳定引用（modelDatabases/catalogCategories）；
          // 未选择时不传该键（表保持未归类），绝不冒称某个“当前库”
          ...(databaseId ? {database: {kind: 'existing', collection: 'modelDatabases', id: databaseId}} : {}),
          ...(categoryId ? {category: {kind: 'existing', collection: 'catalogCategories', id: categoryId}} : {}),
        },
      })),
      ...(diagramOp ? [diagramOp] : []),
      ...drafted.operations
        .filter(o => o.command !== 'model.table.create')
        .map(op => (diagramOp && op.command === 'model.foreignKey.create'
          ? {...op, dependsOn: [...op.dependsOn, diagramOp.opId]}
          : op)),
    ];
    const targetLabel = selectedDatabase
      ? `${selectedDatabase.defName || selectedDatabase.defKey} · ${dbTypeName(selectedDatabase.dbTypeId)}`
      : t('sql.targetDatabaseNone');
    const modelOutput = {
      summary: `DDL 导入（${dialect}）：${operations.filter(o => o.command === 'model.table.create').length} 张表 → ${targetLabel}`,
      assumptions: drafted.losses.map(l => ({kind: 'assume', text: `${l.kind}: ${l.table || ''}${l.name ? `.${l.name}` : ''}（第 ${l.line} 行）`})),
      operations,
    };
    const submitted = await runtime.gateway.submitDraft({platform: 'modeling', modelOutput});
    if (submitted.kind !== 'plan') {
      const err = describeError(submitted);
      setAppliedError(`${err.code}: ${err.message}`);
      return;
    }
    const prepared = await runtime.gateway.prepare(submitted.plan.planId);
    if (!prepared.ok) {
      setAppliedError(`${prepared.code}: ${prepared.message}`);
      return;
    }
    const selected = new Set(submitted.plan.operations.map(op => op.opId));
    setReview({planId: submitted.plan.planId, plan: submitted.plan,
      candidate: prepared.candidate, selectedOpIds: selected});
    setReviewVisible(true);
    if (onCandidateChange) onCandidateChange({
      planId: submitted.plan.planId, plan: submitted.plan,
      candidate: prepared.candidate, selectedOpIds: [...selected],
    }, 'sql');
  }, [runtime, drafted, dialect, dbSupportId, databaseId, categoryId,
    selectedDatabase, dataSource, onCandidateChange, t]);

  const reviewItems = useMemo(() => {
    if (!review) return [];
    const blockedOps = new Set((review.candidate.blockingIssues || []).map(i => i.opId).filter(Boolean));
    return (review.plan.operations || []).map((op) => {
      const changes = (review.candidate.changes || []).filter(c => c.opId === op.opId);
      return {
        id: op.opId,
        category: opLabel(op),
        label: changes[0] ? (changes[0].after?.defKey || changes[0].target?.localKey || op.opId) : opLabel(op),
        path: changes[0]?.target?.collection,
        selected: review.selectedOpIds.has(op.opId),
        deps: op.dependsOn || [],
        blocked: blockedOps.has(op.opId) || !changes.length,
        warn: false,
        // UI-R2：能按 opId 定位的阻断 issue 挂到条目（审阅中显示真实 code/message）
        issues: (review.candidate.blockingIssues || []).filter(i => i.opId === op.opId),
      };
    });
  }, [review]);

  const getDiff = useCallback((itemId) => {
    if (!review) return {fieldRows: [], dependencyChips: []};
    const op = (review.plan.operations || []).find(o => o.opId === itemId) || {};
    const rows = (review.candidate.changes || []).filter(c => c.opId === itemId)
      .reduce((all, change) => all.concat(fieldDiffRows(change)), []);
    return {fieldRows: rows, dependencyChips: op.dependsOn || []};
  }, [review]);

  const toggleItem = useCallback(async (itemId, selected) => {
    if (!review || !runtime) return;
    const next = new Set(review.selectedOpIds);
    if (selected) next.add(itemId); else next.delete(itemId);
    const update = runtime.gateway.updateSelection(review.planId, [...next]);
    if (!update.ok) return;
    const prepared = await runtime.gateway.prepare(review.planId);
    if (!prepared.ok) return;
    setReview({planId: review.planId, plan: update.plan,
      candidate: prepared.candidate, selectedOpIds: next});
  }, [review, runtime]);

  const applyCandidate = useCallback(async () => {
    if (!review || !runtime) return;
    const confirmed = await runtime.gateway.confirm(review.planId, {planHash: review.plan.planHash});
    if (!confirmed.ok) {
      setAppliedError(`${confirmed.code}: ${confirmed.message}`);
      return;
    }
    setApplying(true);
    const applied = await runtime.gateway.apply({planId: review.planId,
      confirmationId: confirmed.confirmationId});
    setApplying(false);
    if (!applied.ok) {
      setAppliedError(`${applied.code}: ${applied.message}`);
      return;
    }
    setReceipt(applied.receipt);
    setSaveState('dirty');
    setReviewVisible(false);
    if (onCandidateChange) onCandidateChange(null, 'sql');
  }, [review, runtime, onCandidateChange]);

  const saveNow = useCallback(() => {
    if (!onSaveProject) return;
    setSaveState('saving');
    onSaveProject((failed) => {
      if (failed) setSaveState('error');
      else {
        setSaveState('saved');
        if (receipt && runtime) {
          runtime.gateway.notePersistence({commandId: receipt.commandId, state: 'saved'});
        }
      }
    });
  }, [onSaveProject, receipt, runtime]);

  const blocked = drafted && drafted.blocked === 'SQL_PARTIAL_PARSE';
  const pendingFks = (drafted && !drafted.blocked && drafted.pendingForeignKeys) || [];
  const applyState = deriveApplyState({
    plan: review ? {status: review && receipt ? PLAN_STATUS.APPLIED : PLAN_STATUS.PENDING, planHash: review.plan.planHash} : null,
    items: reviewItems, mappings: [], applying, generating: false,
  });

  return <div className='chiner-ai-sql-panel'>
    <div className='chiner-ai-sql-controls'>
      <label>
        <span>{t('sql.dialect')}</span>
        <select value={dialect} onChange={e => {setDialect(e.target.value); invalidate();}}>
          {DIALECTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </label>
      <label>
        <span>{t('sql.targetDatabase')}</span>
        <select value={databaseId} onChange={e => {
          const next = e.target.value;
          setDatabaseId(next);
          // 选择库决定类型：目标类型随所选物理库的 dbTypeId 锁定
          const db = databases.find(d => d.id === next);
          if (db && db.dbTypeId) setDbSupportId(db.dbTypeId);
          invalidate();
        }} aria-label={t('sql.targetDatabase')}>
          <option value=''>{databases.length
            ? t('sql.targetDatabaseNone')
            : `${t('sql.targetDatabaseNone')}${t('sql.noDatabases')}`}</option>
          {databases.map(d => <option key={d.id} value={d.id}>
            {d.defName || d.defKey} · {dbTypeName(d.dbTypeId)}
          </option>)}
        </select>
      </label>
      <label>
        <span>{t('sql.targetType')}</span>
        <select value={dbSupportId}
          disabled={Boolean(selectedDatabase)}
          title={selectedDatabase ? t('sql.typeFollowsDatabase', {type: dbTypeName(selectedDatabase.dbTypeId)}) : undefined}
          onChange={e => {setDbSupportId(e.target.value); invalidate();}}>
          {dbSupports.map(d => <option key={d.id} value={d.id}>{d.defName || d.defKey}</option>)}
        </select>
      </label>
      <label>
        <span>{t('sql.targetCategory')}</span>
        <select value={categoryId} onChange={e => {setCategoryId(e.target.value); invalidate();}}
          aria-label={t('sql.targetCategory')}>
          <option value=''>{t('sql.targetCategoryNone')}</option>
          {categories.map(c => <option key={c.id} value={c.id}>
            {c.defName || c.defKey}
          </option>)}
        </select>
      </label>
      <button type='button' className='chiner-ai-minibtn' disabled={!sqlText.trim()} onClick={doParse}>
        {t('sql.parse')}
      </button>
    </div>
    {selectedDatabase
      ? <p className='chiner-ai-sql-note'>{t('sql.typeFollowsDatabase', {type: dbTypeName(selectedDatabase.dbTypeId)})}</p>
      : <p className='chiner-ai-sql-note'>{t('sql.noDatabaseNote')}</p>}
    <textarea className='chiner-ai-sql-input' aria-label={t('sql.inputLabel')}
      placeholder={t('sql.placeholder')} value={sqlText}
      onChange={e => {setSqlText(e.target.value); invalidate();}} disabled={readOnly}/>
    {invalidated && <p className='chiner-ai-sql-note' role='status'>{t('sql.invalidated')}</p>}
    {parseError && <p className='chiner-ai-sql-error' role='alert'>{parseError}</p>}
    {appliedError && <p className='chiner-ai-sql-error' role='alert'>{appliedError}</p>}
    {blocked && <div className='chiner-ai-sql-blocked' role='alert'>
      <strong>{t('sql.blockedTitle')}</strong>
      <ul>
        {(drafted.unsupported || []).map((u, i) => <li key={`u${i}`}>
          {t('sql.unsupported')} · {u.statementType} · {t('sql.line')}{u.line}（{u.start}–{u.end}）</li>)}
        {(drafted.losses || []).map((l, i) => <li key={`l${i}`}>
          {t('sql.loss')} · {l.kind} · {l.table || ''}{l.name ? `.${l.name}` : ''} · {t('sql.line')}{l.line}</li>)}
      </ul>
      <button type='button' className='chiner-ai-minibtn chiner-ai-primary' disabled={readOnly} onClick={acknowledge}>
        {t('sql.acknowledge')}
      </button>
    </div>}
    {drafted && !drafted.blocked && !review && <div className='chiner-ai-sql-result'>
      <p>{t('sql.parsed', {tables: drafted.operations.filter(o => o.command === 'model.table.create').length,
        fks: drafted.operations.filter(o => o.command === 'model.foreignKey.create').length})}</p>
      {drafted.operations.some(o => o.command === 'model.foreignKey.create')
        && <p className='chiner-ai-sql-note' role='status'>{t('sql.autoDiagramNote')}</p>}
      {(drafted.losses || []).length > 0 && <p className='chiner-ai-sql-warn'>
        {t('sql.lossesNote', {count: drafted.losses.length})}</p>}
      {pendingFks.length > 0 && <div className='chiner-ai-sql-pending'>
        <strong>{t('sql.pendingFks')}</strong>
        <ul>{pendingFks.map((fk, i) => <li key={i}>
          {fk.table} → {fk.refTable}（{fk.reason === 'external' ? t('sql.fkExternal') : t('sql.fkAmbiguous')}）</li>)}</ul>
        <p className='chiner-ai-sql-note'>{t('sql.pendingNote')}</p>
      </div>}
      <button type='button' className='chiner-ai-blockbtn chiner-ai-primary'
        disabled={readOnly || !drafted.operations.length || !dbSupportId} onClick={submit}>
        {t('sql.toReview')}
      </button>
    </div>}
    {receipt && <div className='chiner-ai-appliedbar'>
      <span>{saveState === 'saved' ? t('assistant.savedDone')
        : saveState === 'error' ? t('assistant.taskSaveFailed')
          : saveState === 'saving' ? t('assistant.saving') : t('assistant.appliedDirty')}</span>
      {saveState !== 'saved' && <button type='button' className='chiner-ai-minibtn chiner-ai-primary'
        disabled={readOnly || saveState === 'saving' || !onSaveProject} onClick={saveNow}>
        {t('assistant.saveProject')}</button>}
    </div>}
    {review && <ChangeReview
      locale={locale}
      labels={labels}
      visible={reviewVisible}
      onClose={() => setReviewVisible(false)}
      onBackToChat={() => setReviewVisible(false)}
      plan={{
        title: review.plan.summary,
        counts: review.candidate.counts || {},
        status: receipt ? 'applied' : 'pending_review',
        saveMode: 'project-draft',
        scopeRows: [[t('review.scopePlanHash'), review.plan.planHash.slice(0, 16)],
          [t('review.scopeOps'), String(review.plan.operations.length)]],
      }}
      items={reviewItems}
      onToggleItem={toggleItem}
      getDiff={getDiff}
      mappings={[]}
      blockingIssues={(review.candidate.blockingIssues || [])}
      applying={applying}
      generating={false}
      onApply={applyCandidate}
    />}
  </div>;
};

export default React.memo(SqlImportPanel);
