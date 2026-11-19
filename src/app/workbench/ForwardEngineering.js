import React, {useMemo, useState} from 'react';
import * as _ from 'lodash/object';

import {
  Button, Checkbox, CodeHighlight, FormatMessage, Input, Message, Select,
} from 'components';
import {getEmptyEntity} from '../../lib/datasource_util';
import {
  getCatalogCategories, categoryObjects, physicalDbSupports, readPhysicalDatabases,
} from '../../lib/model_catalog';
import {
  buildForwardCommit, planForwardGeneration, resolveFieldMapping, stripLogicPrefix,
  validateDDLTemplate,
} from '../../lib/model_forward_engineering';
// 整改F6：预览与提交统一使用可抛错的严格渲染，不再用吞异常的旧 wrapper
import {renderCreateTableDDLStrict} from '../../lib/json2code_util';

/* eslint-disable jsx-a11y/label-has-for, jsx-a11y/label-has-associated-control */
// 向导内 label 为行布局容器（内嵌自定义 Input/Select/Checkbox 组件，
// 无法满足原生控件关联断言），与 ModelCatalog 表单同口径整体豁免
const t = (key, data) => FormatMessage.string({id: `forward.${key}`, data});
const errText = code => t(`err.${code}`);
const norm = v => String(v == null ? '' : v).trim().toLowerCase();

// S2 R3：逻辑 → 物理正向生成向导（三步：源选择 / 目标与映射 / 预览与生成）
// 读取最新有效草稿（getDraftSource 复用搜索快照入口，含未保存 tab 草稿）；
// 预览不写源；提交以已保存源为合并基底、最新有效草稿为规划输入，原子合并，冲突回预览。
export default React.memo(({getDraftSource, getSource, onCommit, onClose, preselect}) => {
  // 审阅10：目标相关 state 初值与首帧视觉默认同步（无库=新建模式+首个有效类型；
  // 有库=既有模式+首库），后续路径（下一步/返回）经 effective 兜底保持一致
  const initDraft = getDraftSource();
  const initDatabases = readPhysicalDatabases(initDraft);
  const initSupports = physicalDbSupports(initDraft);
  const [step, setStep] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set(preselect || []));
  const [targetMode, setTargetMode] = useState(initDatabases.length > 0 ? 'existing' : 'new');
  const [databaseId, setDatabaseId] = useState(initDatabases[0] ? initDatabases[0].id : '');
  const [newDbDefKey, setNewDbDefKey] = useState('');
  const [newDbTypeId, setNewDbTypeId] = useState(initSupports[0] ? initSupports[0].id : '');
  const [newDbCategory, setNewDbCategory] = useState('');
  const [tablePrefix, setTablePrefix] = useState('');
  const [tableNames, setTableNames] = useState({});
  const [overrides, setOverrides] = useState({});
  const [skipOutScope, setSkipOutScope] = useState(false);
  const [conflict, setConflict] = useState('');
  const [mapEntity, setMapEntity] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [previewSig, setPreviewSig] = useState('');
  const [ddlFailures, setDdlFailures] = useState([]);
  const draft = getDraftSource();
  const supports = physicalDbSupports(draft);
  const databases = readPhysicalDatabases(draft);
  const categories = getCatalogCategories(draft);
  const logicEntities = draft.logicEntities || [];
  const entityTemplate = useMemo(() => {
    const template = getEmptyEntity();
    return {..._.omit(template, ['id', 'fields', 'indexes', 'correlations'])};
  }, []);

  // 审阅10：draft 期间变化时 state 可能失效（所选库被删/无库仍停留既有模式），
  // 一律以 effective 值参与规划与显示，Select 用 key 强制重挂载同步初值
  const firstDatabaseId = databases[0] ? databases[0].id : '';
  const firstSupportId = supports[0] ? supports[0].id : '';
  const effectiveTargetMode = databases.length > 0 ? targetMode : 'new';
  const effectiveDatabaseId = databases.some(d => d.id === databaseId)
    ? databaseId : firstDatabaseId;
  const effectiveNewDbTypeId = supports.some(s => s.id === newDbTypeId)
    ? newDbTypeId : firstSupportId;
  const effectiveMapEntity = selected.has(mapEntity) ? mapEntity : [...selected][0];

  const buildOptions = () => {
    const target = effectiveTargetMode === 'new'
      ? {
        mode: 'new',
        newDatabase: {
          defKey: newDbDefKey,
          defName: '',
          dbTypeId: newDbTypeId,
          categoryId: newDbCategory === '' ? null : newDbCategory,
        },
      }
      : {mode: 'existing', databaseId: effectiveDatabaseId};
    return {
      entityIds: [...selected],
      target,
      tableNames,
      tablePrefix,
      overrides,
      skipOutScopeRelations: skipOutScope,
      entityTemplate,
    };
  };

  // 审阅9：预览输入签名——进入预览时记录，提交前重读比对；变化则回目标与映射
  // 重新确认，不自动接受未预览内容。签名只含确定性输入（选择/表名/目标/覆盖/
  // 跳过/前缀）与规划相关的源数据摘要，不含每渲染重建的随机 UUID
  const previewInputs = (source, options) => {
    const targetDbRow = readPhysicalDatabases(source)
      .filter(d => d.id === options.target.databaseId)[0];
    const supportId = options.target.mode === 'new'
      ? options.target.newDatabase.dbTypeId
      : ((targetDbRow || {}).dbTypeId || '');
    const logicById = new Map((source.logicEntities || []).map(l => [l.id, l]));
    return JSON.stringify({
      options,
      logics: options.entityIds.map(id => logicById.get(id)).filter(Boolean).map(l => ({
        id: l.id,
        defKey: l.defKey,
        fields: (l.fields || []).map(f => ({
          id: f.id,
          defKey: f.defKey,
          domain: f.domain || '',
          baseType: f.baseType || '',
          type: f.type || '',
        })),
        indexes: l.indexes || [],
        correlations: l.correlations || [],
      })),
      domains: (source.domains || []).map(d => ({
        id: d.id,
        applyFor: d.applyFor,
        len: d.len,
        scale: d.scale,
      })),
      mappings: source.dataTypeMapping || {},
      templates: ((source.profile && source.profile.codeTemplates) || [])
        .filter(c => c.applyFor === supportId),
    });
  };

  // 计划为纯计算：每渲染按当前选择重建（含错误定位），不写源
  const planResult = planForwardGeneration(draft, buildOptions());
  const plan = planResult.status === 'ok' ? planResult.plan : null;
  const errors = planResult.errors || [];
  const outScopeError = errors.filter(e => e.code === 'outOfScopeRelations')[0];
  const blockingErrors = errors.filter(e => e.code !== 'outOfScopeRelations');
  const warnings = planResult.warnings || [];

  const existingCount = logicId => (draft.entities || [])
    .filter(p => p.logicalEntityId === logicId).length;

  const toggle = (id, checked) => {
    setSelected((old) => {
      const next = new Set(old);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const defaultTableName = logic => tablePrefix + stripLogicPrefix(logic.defKey);

  // 映射状态：按实体统计可映射字段（手动覆盖计入可映射并标“手动指定”）
  const entityFieldStats = (logic, targetSupportId) => {
    let ok = 0;
    let manual = 0;
    const rows = (logic.fields || []).map((f) => {
      const override = overrides[`${logic.id}:${f.id}`];
      const res = resolveFieldMapping(f, draft, targetSupportId,
        override != null && String(override).trim() !== '' ? override : undefined);
      if (res.status === 'ok') ok += 1;
      if (res.status === 'manual') { ok += 1; manual += 1; }
      return {f, res, manual: res.status === 'manual'};
    });
    return {rows, ok, manual, total: (logic.fields || []).length};
  };

  let targetSupportId = '';
  if (plan) {
    targetSupportId = plan.targetSupportId;
  } else if (effectiveTargetMode === 'new') {
    targetSupportId = effectiveNewDbTypeId;
  } else {
    const dbRow = databases.filter(d => d.id === effectiveDatabaseId)[0];
    targetSupportId = (dbRow || {}).dbTypeId || '';
  }
  const templateCheck = targetSupportId
    ? validateDDLTemplate(draft, targetSupportId) : {status: 'error', code: 'templateMissing'};

  const stepTitles = ['step1', 'step2', 'step3'];
  const goStep = (next) => {
    if (next === 2 && selected.size === 0) {
      Message.warring({title: t('noSourceSelected')});
      return;
    }
    if (next === 2) {
      setMapEntity([...selected][0]);
    }
    if (next === 3) {
      if (blockingErrors.length || outScopeError) {
        Message.error({title: t('blockHint')});
        return;
      }
      setConflict('');
      setDdlFailures([]);
      const first = [...selected][0];
      setMapEntity(first);
      setPreviewId(first);
      setPreviewSig(previewInputs(draft, buildOptions()));
    }
    setStep(next);
  };

  // 审阅8：全部产物提交前 DDL 校验——以“当前有效模型 + 全部新生成表”为渲染
  // 上下文（FK 指向新物理表），逐表渲染建表模板，任一空产物/模板异常即阻止生成
  const validateAllDDL = (planEntities, supportId) => {
    const renderSource = {...draft, entities: [...(draft.entities || []), ...planEntities]};
    return planEntities.map((e) => {
      try {
        const ddl = renderCreateTableDDLStrict(renderSource, [], e, supportId);
        if (ddl != null && String(ddl).trim() !== '') return null;
        return {defKey: e.defKey, message: ''};
      } catch (err) {
        return {defKey: e.defKey, message: err.message};
      }
    }).filter(Boolean);
  };

  const doCommit = () => {
    // 审阅9：预览后输入（选择/表名/目标/映射/模板/源字段）变化 → 不自动接受
    const latestDraft = getDraftSource();
    if (previewSig !== previewInputs(latestDraft, buildOptions())) {
      setConflict(t('previewStale'));
      setStep(2);
      Message.error({title: t('previewStale')});
      return;
    }
    // 审阅7：已保存源为合并基底、最新有效草稿为规划输入；产物只原子并入基底
    const commit = buildForwardCommit(getSource(), buildOptions(), latestDraft);
    if (commit.status !== 'ok') {
      // 期间源/目标/模板/名称冲突：回目标与映射一步提示重新检查
      setConflict(t('commitConflict'));
      setStep(2);
      Message.error({title: t('commitConflict')});
      return;
    }
    const failures = validateAllDDL(commit.plan.entities, commit.plan.targetSupportId);
    if (failures.length > 0) {
      setDdlFailures(failures);
      setConflict(t('ddlValidateFailed'));
      Message.error({title: t('ddlValidateFailed')});
      return;
    }
    onCommit(commit.nextSource);
    Message.success({title: FormatMessage.string({id: 'optSuccess'})});
    onClose();
  };

  const renderStep1 = () => {
    const keyword = norm(search);
    const rows = logicEntities.filter(l => !keyword
      || norm(l.defKey).indexOf(keyword) > -1 || norm(l.defName).indexOf(keyword) > -1);
    const categoryNames = {};
    categories.forEach((c) => {
      categoryObjects(draft, c).logicEntity.forEach((o) => {
        categoryNames[o.id] = categoryNames[o.id] == null
          ? c.defKey : `${categoryNames[o.id]} / ${c.defKey}`;
      });
    });
    return <div className='chiner-forward-card'>
      <div className='chiner-forward-card-head'>
        <span>{t('sourceCard')}</span>
        <small>{t('sourceHint')}</small>
        <Input
          style={{width: 220, marginLeft: 'auto'}}
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}/>
      </div>
      <div className='chiner-forward-list'>
        {rows.length === 0 && <div className='chiner-forward-empty'>{t('noLogic')}</div>}
        {rows.map(l => (
          <label key={l.id} className='chiner-forward-source-row'>
            <Checkbox
              checked={selected.has(l.id)}
              onChange={e => toggle(l.id, e.target.checked)}/>
            <span className='chiner-forward-source-name'>
              {l.defKey}{l.defName ? ` [${l.defName}]` : ''}
            </span>
            <small>{(l.fields || []).length}{t('fieldsUnit')}</small>
            <small>{categoryNames[l.id] || t('uncategorized')}</small>
            {existingCount(l.id) > 0
              && <small className='chiner-forward-badge'>{t('existingArtifactCount', {count: existingCount(l.id)})}</small>}
          </label>
        ))}
      </div>
    </div>;
  };

  const renderStep2 = () => {
    const selectedLogics = logicEntities.filter(l => selected.has(l.id));
    const dbOptions = databases.map((d) => {
      const typeDef = supports.filter(s => s.id === d.dbTypeId)[0];
      const label = `${d.defKey}${d.defName ? ` · ${d.defName}` : ''}`
        + ` [${typeDef ? typeDef.defKey : d.dbTypeId}]`;
      return {id: d.id, name: label};
    });
    const showNewDb = effectiveTargetMode === 'new';
    // 整改F5：第二步 = 主区（源表 + 字段映射 [+ 范围外关联]，第1列）+ 右侧约300px
    // 目标区（side，第2列）；布局位在 less 中仅以单值 grid-column/grid-row 声明于
    // 直接子元素，不再使用会被 Less 当算术的裸斜杠值（原 1 / -1 会算出 -1 产生隐式第三列）
    return <div className='chiner-forward-grid chiner-forward-grid-step2'>
      <div className='chiner-forward-card'>
        <div className='chiner-forward-card-head'>
          <span>{t('sourceCard')}</span>
          <small>{t('sourceHint')}</small>
        </div>
        <div className='chiner-forward-table chiner-forward-entity-table'>
          <div className='chiner-forward-tr chiner-forward-th'>
            <span>{t('logicEntity')}</span><span>{t('fieldsColumn')}</span>
            <span>{t('mappingStatus')}</span><span>{t('targetTable')}</span>
          </div>
          {selectedLogics.map((l) => {
            const stats = entityFieldStats(l, targetSupportId);
            const full = stats.ok === stats.total && stats.total > 0;
            // 手动覆盖数计入完整徽标文案（避免 JSX 嵌套三元）
            let badgeText = t('mappingError', {ok: stats.ok, total: stats.total});
            if (full) {
              badgeText = stats.manual
                ? t('mappingFullManual', {manual: stats.manual}) : t('mappingFull');
            }
            return <div key={l.id} className='chiner-forward-tr'>
              <span title={l.defKey}>{l.defKey}{l.defName ? ` [${l.defName}]` : ''}</span>
              <span>{stats.total}</span>
              <span className={`chiner-forward-badge ${full ? '' : 'is-error'}`}>
                {badgeText}
              </span>
              <span>
                <Input
                  style={{width: '100%'}}
                  value={tableNames[l.id] === undefined ? defaultTableName(l) : tableNames[l.id]}
                  placeholder={defaultTableName(l)}
                  onChange={e => setTableNames(old => ({...old, [l.id]: e.target.value}))}/>
              </span>
            </div>;
          })}
        </div>
        {blockingErrors.filter(e => e.level === 'name').map((e, i) => (
          <div key={`name-${i}`} className='chiner-forward-error-item'>
            <span>{e.defKey || e.entityId}</span>
            <span>{e.code === 'emptyDefKey' ? t('err.emptyDefKey')
              : t('err.duplicateDefKey', {owner: e.owner || ''})}</span>
          </div>
        ))}
      </div>
      <div className='chiner-forward-side'>
        <div className='chiner-forward-card'>
          <div className='chiner-forward-card-head'><span>{t('targetCard')}</span></div>
          <label className='chiner-forward-form-item'>
            <span>{t('database')}</span>
            <Select
              key={`db-${effectiveTargetMode}-${effectiveDatabaseId}`}
              defaultValue={effectiveTargetMode === 'new' ? '__new__'
                : effectiveDatabaseId}
              onChange={(e) => {
                const v = e.target.value;
                setConflict('');
                if (v === '__new__') {
                  setTargetMode('new');
                  const firstSupport = supports[0];
                  setNewDbTypeId(firstSupport ? firstSupport.id : '');
                } else {
                  setTargetMode('existing');
                  setDatabaseId(v);
                }
              }}>
              {/* 整改F1：Select/MultipleSelect 只消费平坦 Option 数组，
                  map 结果与静态项必须并入同一数组表达式（含空集合） */}
              {dbOptions.map(d => <Select.Option key={d.id} value={d.id}>{d.name}</Select.Option>)
                .concat(<Select.Option key='__new__' value='__new__'>{t('newDatabaseOption')}</Select.Option>)}
            </Select>
          </label>
          {showNewDb && [
            <label key='defKey' className='chiner-forward-form-item'>
              <span>{t('databaseName')}</span>
              <Input value={newDbDefKey} onChange={e => setNewDbDefKey(e.target.value)}/>
            </label>,
            <label key='category' className='chiner-forward-form-item'>
              <span>{t('category')}</span>
              <Select
                key={`cat-${newDbCategory}`}
                defaultValue={newDbCategory}
                onChange={e => setNewDbCategory(e.target.value)}>
                {/* 整改F1：静态“未分类”项与分类 map 并入同一平坦数组表达式 */}
                {[<Select.Option key='__none__' value=''>{t('uncategorized')}</Select.Option>]
                  .concat(categories.map(c => <Select.Option key={c.id} value={c.id}>
                    {c.defKey}{c.defName ? ` / ${c.defName}` : ''}
                  </Select.Option>))}
              </Select>
            </label>,
            <label key='type' className='chiner-forward-form-item'>
              <span>{t('dbType')}</span>
              <Select
                key={`type-${effectiveNewDbTypeId}`}
                defaultValue={effectiveNewDbTypeId}
                onChange={e => setNewDbTypeId(e.target.value)}>
                {supports.map(s => <Select.Option key={s.id} value={s.id}>
                  {s.defName || s.defKey}
                </Select.Option>)}
              </Select>
            </label>,
          ]}
          {!showNewDb && targetSupportId && <div className='chiner-forward-form-static'>
            <span>{t('dbType')}</span>
            <span>{(supports.filter(s => s.id === targetSupportId)[0] || {}).defKey
              || targetSupportId}</span>
          </div>}
          <div className='chiner-forward-form-static'>
            <span>{t('ddlTemplate')}</span>
            {templateCheck.status === 'ok'
              ? <span>{t('templateCurrent')}</span>
              : <span className='is-error'>{t(`err.${templateCheck.code}`)}</span>}
          </div>
          <label className='chiner-forward-form-item'>
            <span>{t('prefix')}</span>
            <Input value={tablePrefix} onChange={e => setTablePrefix(e.target.value)}/>
          </label>
          <div className='chiner-forward-note'>{t('info')}</div>
          <div className='chiner-forward-summary'>
            {t('count', {entities: selected.size, tables: plan ? plan.entities.length : 0})}
          </div>
        </div>
      </div>
      <div className='chiner-forward-card'>
        <div className='chiner-forward-card-head'>
          <span>{t('mappingCard')}</span>
          {selectedLogics.length > 0 && <Select
            style={{width: 240, marginLeft: 'auto'}}
            key={`map-${effectiveMapEntity}`}
            defaultValue={effectiveMapEntity}
            onChange={e => setMapEntity(e.target.value)}>
            {selectedLogics.map(l => <Select.Option key={l.id} value={l.id}>
              {l.defKey}{l.defName ? ` [${l.defName}]` : ''}
            </Select.Option>)}
          </Select>}
        </div>
        {(() => {
          const logic = logicEntities.filter(l => l.id === effectiveMapEntity)[0];
          if (!logic) return <div className='chiner-forward-empty'>{t('noLogic')}</div>;
          const {rows, ok, total, manual} = entityFieldStats(logic, targetSupportId);
          return <div>
            <div className='chiner-forward-table chiner-forward-field-table'>
              <div className='chiner-forward-tr chiner-forward-th'>
                <span>{t('fieldColumn')}</span><span>{t('logicType')}</span>
                <span>{t('targetType')}</span><span>{t('lenScale')}</span>
                <span>{t('constraints')}</span><span>{t('overrideColumn')}</span>
              </div>
              {rows.map(({f, res, manual: isManual}) => {
                const domain = (draft.domains || []).filter(d => d.id === f.domain)[0];
                const mappingRow = f.baseType
                  ? ((draft.dataTypeMapping || {}).mappings || [])
                    .filter(m => m.id === f.baseType)[0] : null;
                let logicType = f.baseType || f.type || '';
                if (domain) {
                  logicType = domain.defName || domain.defKey;
                } else if (mappingRow) {
                  logicType = mappingRow.defName || mappingRow.defKey;
                }
                return <div key={f.id} className='chiner-forward-tr'>
                  <span title={f.defKey}>{f.defKey}{f.defName ? ` [${f.defName}]` : ''}</span>
                  <span>{logicType}{res.how === 'reverse' ? `（${t('reverseLookup')}）` : ''}</span>
                  <span className={res.status === 'error' ? 'is-error-text' : ''}>
                    {res.status === 'error' ? errText(res.code)
                      : <span>{res.realType}{isManual ? `（${t('manualFlag')}）` : ''}</span>}
                  </span>
                  <span>{res.len == null ? '' : res.len}{res.scale ? `,${res.scale}` : ''}</span>
                  <span>
                    {f.primaryKey ? 'PK ' : ''}{f.notNull ? 'NN ' : ''}{f.autoIncrement ? 'AI' : ''}
                  </span>
                  <span className='chiner-forward-override'>
                    <Input
                      placeholder={res.status === 'error' ? t('manualPlaceholder') : ''}
                      defaultValue={overrides[`${logic.id}:${f.id}`] || ''}
                      onChange={e => setOverrides(old => ({
                        ...old, [`${logic.id}:${f.id}`]: e.target.value}))}/>
                  </span>
                </div>;
              })}
            </div>
            <div className='chiner-forward-mapbar'>
              {t('mappingCount', {ok, total})}
              {manual > 0 ? t('manualCount', {manual}) : ''}
            </div>
          </div>;
        })()}
      </div>
      {(outScopeError || (plan && plan.outOfScope.length > 0)) && <div className='chiner-forward-card'>
        <div className='chiner-forward-card-head'><span>{t('outScopeTitle')}</span></div>
        <div className='chiner-forward-note'>{t('outScopeBlocked')}</div>
        <div className='chiner-forward-list'>
          {(outScopeError && outScopeError.items) || (plan ? plan.outOfScope : [])
            .map((item, i) => (
              <div key={i} className='chiner-forward-source-row'>
                <span>{item.from} → {item.to}{item.field ? ` (${item.field})` : ''}</span>
              </div>
            ))}
        </div>
        <label className='chiner-forward-source-row'>
          <Checkbox
            checked={skipOutScope}
            onChange={e => setSkipOutScope(e.target.checked)}/>
          <span>{t('outScopeSkip')}</span>
        </label>
      </div>}
    </div>;
  };

  const renderStep3 = () => {
    if (!plan) return null;
    const logics = logicEntities.filter(l => selected.has(l.id));
    const firstLogicId = logics[0] ? logics[0].id : '';
    const effectivePreviewId = logics.some(l => l.id === previewId)
      ? previewId : firstLogicId;
    const previewLogic = logics.filter(l => l.id === effectivePreviewId)[0] || logics[0];
    const previewEntity = plan.entities
      .filter(e => previewLogic && e.logicalEntityId === previewLogic.id)[0] || plan.entities[0];
    let ddl = '';
    let ddlError = '';
    if (previewEntity) {
      try {
        // 整改F6：预览与提交使用相同的严格上下文（draft 既有表 + 全部新物理表），
        // 切换选中表仅切换预览对象，不丢其他产物上下文（FK 可解析新端点）；
        // 异常在向导内可恢复展示，不再使用吞异常的旧 wrapper
        const renderSource = {...draft,
          entities: [...(draft.entities || []), ...plan.entities]};
        ddl = renderCreateTableDDLStrict(renderSource, [], previewEntity,
          plan.targetSupportId);
        if (ddl == null || String(ddl).trim() === '') ddlError = t('ddlError');
      } catch (e) {
        ddlError = `${t('ddlError')}: ${e.message}`;
      }
    }
    // 整改F5：第三步 = 产物列表（第1列）+ 较宽 DDL 预览（第2列），
    // 两卡片为 grid 仅有的直接子元素，杜绝隐式第三列
    return <div className='chiner-forward-grid chiner-forward-grid-step3'>
      <div className='chiner-forward-card'>
        <div className='chiner-forward-card-head'><span>{t('previewCard')}</span></div>
        <div className='chiner-forward-table chiner-forward-preview-table'>
          <div className='chiner-forward-tr chiner-forward-th'>
            <span>{t('targetTable')}</span><span>{t('fieldsColumn')}</span>
            <span>{t('relationColumn')}</span><span>{t('sourceColumn')}</span>
          </div>
          {plan.entities.map(e => (
            <div
              key={e.id}
              className={`chiner-forward-tr${previewEntity && e.id === previewEntity.id ? ' is-active' : ''}`}>
              <span>{e.defKey}{e.defName ? ` [${e.defName}]` : ''}</span>
              <span>{(e.fields || []).length}</span>
              <span>{(e.correlations || []).length}</span>
              <span>{(logicEntities.filter(l => l.id === e.logicalEntityId)[0] || {}).defKey || ''}</span>
            </div>
          ))}
        </div>
        {warnings.filter(w => w.code === 'existingArtifact').length > 0 && <div className='chiner-forward-note'>
          {t('existingArtifactHint')}
          {warnings.filter(w => w.code === 'existingArtifact')
            .map(w => w.defKey).join('、')}
        </div>}
        {plan.dropped.length > 0 && <div className='chiner-forward-note'>
          {t('droppedHint')}
          {plan.dropped.map(d => `${d.from} → ${d.to}`).join('；')}
        </div>}
      </div>
      <div className='chiner-forward-card chiner-forward-ddl'>
        <div className='chiner-forward-card-head'>
          <span>{t('ddlPreview')}</span>
          {logics.length > 0 && <Select
            style={{width: 240, marginLeft: 'auto'}}
            key={`preview-${effectivePreviewId}`}
            defaultValue={effectivePreviewId}
            onChange={e => setPreviewId(e.target.value)}>
            {logics.map(l => <Select.Option key={l.id} value={l.id}>
              {l.defKey}{l.defName ? ` [${l.defName}]` : ''}
            </Select.Option>)}
          </Select>}
        </div>
        {ddlFailures.length > 0 && <div className='chiner-forward-error-item is-error-text'>
          {t('ddlValidateFailed')}
          {ddlFailures.map(f => ` ${f.defKey}${f.message ? `: ${f.message}` : ''}`).join('；')}
        </div>}
        {ddlError
          ? <div className='chiner-forward-empty is-error'>{ddlError}</div>
          : <CodeHighlight mode='mysql' data={() => ddl || ''}/>}
      </div>
    </div>;
  };

  return <div className='chiner-forward'>
    <div className='chiner-forward-steps'>
      {stepTitles.map((key, i) => (
        <span key={key} className={`chiner-forward-step${step === i + 1 ? ' is-current' : ''}`}>
          <em>{i + 1}</em>{t(key)}
        </span>
      ))}
    </div>
    <div className='chiner-forward-body'>
      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
    </div>
    <div className='chiner-forward-footer'>
      <span className='chiner-forward-block-hint'>{step < 3 ? t('blockHint') : ''}</span>
      {conflict && <span className='is-error-text'>{conflict}</span>}
      <Button key='cancel' onClick={onClose}>{FormatMessage.string({id: 'button.cancel'})}</Button>
      {step > 1 && <Button key='prev' onClick={() => setStep(step - 1)}>{t('prev')}</Button>}
      {step < 3 && <Button key='next' type='primary' onClick={() => goStep(step + 1)}>{t('next')}</Button>}
      {step === 3 && <Button key='commit' type='primary' onClick={doCommit}>{t('generate')}</Button>}
    </div>
  </div>;
});
