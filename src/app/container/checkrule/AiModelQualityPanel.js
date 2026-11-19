// AiModelQualityPanel — 声明式模型质量规则库与检查结果面板（QUALITY-UI）。
// 只读消费 src/lib/quality/modelRules（见 core-api.md §6）：列表/启停/运行/定位/
// 修复提案全部走纯函数合同；本组件不直接改模型、不调服务、不持久化任何数据，
// 不触发旧 programCode/new Function。挂载由 INTEGRATION 在旧检查规则旁完成，
// 文案为组件私有 zh/en 字典，可经 labels 注入正式 key 覆盖（不改主语言文件）。
import React, {useEffect, useMemo, useState} from 'react';
import {
  QUALITY_SCHEMA_VERSION,
  readQualityProfile,
  runModelQuality,
  validateQualityRule,
  validateQualityRuleSet,
} from '../../../lib/quality/modelRules';
import './style/ai-model-quality.less';

const text = (value) => {
  if (value === undefined || value === null) return '';
  return String(value);
};

// ---------- 纯函数助手（具名导出，供 INTEGRATION 与开发测试复用） ----------

// 基于提交瞬间的最新 source 合并单个 set.enabled：仅替换目标布尔，深保留其余
// 规则集 / dataRuleSets / profile 元数据。set 不存在返回 null，绝不猜 ID。
export const mergeRuleSetEnabled = (latestSource, ruleSetId, enabled) => {
  if (!latestSource || typeof latestSource !== 'object') return null;
  const profile = latestSource.profile || {};
  const quality = profile.quality || {};
  const sets = Array.isArray(quality.modelRuleSets) ? quality.modelRuleSets : [];
  const hit = sets.some((set) => set && set.id === ruleSetId);
  if (!hit) return null;
  const nextQuality = {
    ...quality,
    schemaVersion: quality.schemaVersion === undefined ? QUALITY_SCHEMA_VERSION : quality.schemaVersion,
    modelRuleSets: sets.map((set) => (set && set.id === ruleSetId ? {...set, enabled: !!enabled} : set)),
  };
  return {...latestSource, profile: {...profile, quality: nextQuality}};
};

// 启停提交路径（组件按钮与测试共用同一代码路径）。onUpdate 返回 false / throw /
// Promise reject 均视为失败，绝不显示成功。
export const submitRuleSetEnabled = ({latestSource, ruleSetId, enabled, onUpdate}) => {
  const nextSource = mergeRuleSetEnabled(latestSource, ruleSetId, enabled);
  if (!nextSource) return Promise.resolve({ok: false, code: 'RULE_SET_NOT_FOUND'});
  if (typeof onUpdate !== 'function') return Promise.resolve({ok: false, code: 'NO_UPDATE_HANDLER'});
  let outcome;
  try {
    outcome = onUpdate(nextSource);
  } catch (e) {
    return Promise.resolve({ok: false, code: 'UPDATE_FAILED'});
  }
  if (outcome && typeof outcome.then === 'function') {
    return outcome
      .then((value) => (value === false ? {ok: false, code: 'UPDATE_REJECTED'} : {ok: true, nextSource}))
      .catch(() => ({ok: false, code: 'UPDATE_FAILED'}));
  }
  return Promise.resolve(outcome === false ? {ok: false, code: 'UPDATE_REJECTED'} : {ok: true, nextSource});
};

// 修复提案只携带必要失败结果（status==='fail'）+ 去重对象引用 + 用户意图；
// error / notApplicable / pass 一律不发送，面板自身不做任何修复写操作。
export const collectFixProposal = (results) => {
  const failed = (results || []).filter((item) => item && item.status === 'fail');
  const seen = new Set();
  const refs = [];
  failed.forEach((item) => {
    const key = JSON.stringify([item.objectRef || null, item.fieldRef || null]);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({objectRef: item.objectRef || null, fieldRef: item.fieldRef || null});
  });
  return {results: failed, refs, intent: 'quality.fix.propose'};
};

export const submitFixProposal = ({results, onProposeFix}) => {
  const proposal = collectFixProposal(results);
  if (!proposal.results.length) return {ok: false, code: 'NO_FAILURES', proposal};
  if (typeof onProposeFix !== 'function') return {ok: false, code: 'NO_HANDLER', proposal};
  try {
    onProposeFix(proposal);
    return {ok: true, proposal};
  } catch (e) {
    return {ok: false, code: 'FAILED', proposal};
  }
};

// 定位参数：objectRef/fieldRef 原样来自引擎结果，绝不用同名猜 ID。
export const resultLocateArgs = (result) => {
  const ref = result && result.objectRef;
  if (!ref || typeof ref !== 'object' || ref.id === undefined || ref.id === null) return null;
  const fieldRef = result.fieldRef;
  if (fieldRef && typeof fieldRef === 'object' && fieldRef.id !== undefined && fieldRef.id !== null) {
    return [ref, fieldRef];
  }
  return [ref];
};

// 失败结果稳定身份：规则集 id + 规则 id + 对象/字段引用（绝不使用筛选后数组序号）。
// 切筛选/结果重排/重跑后同一失败对象保持同一身份，旧选择不会映射到别的对象。
export const resultIdentityKey = (setEntry, ruleEntry, item) => JSON.stringify([
  text(setEntry && setEntry.id) || null,
  text(ruleEntry && ruleEntry.ruleId) || text(ruleEntry && ruleEntry.id) || null,
  (item && item.objectRef) || null,
  (item && item.fieldRef) || null,
]);

const displayName = (object) => {
  const name = text(object && object.defName).trim();
  const key = text(object && object.defKey).trim();
  if (name && key && name !== key) return `${name}(${key})`;
  return name || key || text(object && object.id);
};

const OWNER_COLLECTIONS = ['entities', 'logicEntities', 'conceptEntities'];

// 显示名解析（display-only）：按 id 查当前快照；解析不到回 collection:id，不影响定位。
export const resolveObjectLabel = (dataSource, objectRef, fieldRef) => {
  const fallback = (ref) => (ref ? `${text(ref.collection) || '?'}:${ref.id == null ? '?' : ref.id}` : '');
  if (fieldRef && fieldRef.id != null) {
    const ownerRef = fieldRef.owner;
    if (ownerRef && OWNER_COLLECTIONS.includes(ownerRef.collection)) {
      const owner = ((dataSource && dataSource[ownerRef.collection]) || [])
        .find((item) => item.id === ownerRef.id);
      const field = owner && (owner.fields || []).find((item) => item.id === fieldRef.id);
      if (owner && field) return `${displayName(owner)} / ${displayName(field)}`;
      return `${fallback(ownerRef)} / fields:${fieldRef.id}`;
    }
    return `${fallback(ownerRef)} / fields:${fieldRef.id}`;
  }
  if (objectRef && OWNER_COLLECTIONS.includes(objectRef.collection)) {
    const object = ((dataSource && dataSource[objectRef.collection]) || [])
      .find((item) => item.id === objectRef.id);
    if (object) return displayName(object);
  }
  return fallback(objectRef);
};

// runModelQuality 输出归一：预算标记兼容根字段与 summary 两处，四态永不互混。
export const summarizeReport = (report) => {
  const summary = (report && report.summary) || {};
  const count = (value) => (typeof value === 'number' && value > 0 ? value : 0);
  const pass = count(summary.pass);
  const fail = count(summary.fail);
  const error = count(summary.error);
  const notApplicable = count(summary.notApplicable);
  return {
    pass,
    fail,
    error,
    notApplicable,
    total: pass + fail + error + notApplicable,
    budgetExceeded: (report && report.budgetExceeded === true) || summary.budgetExceeded === true,
  };
};

export const filterResults = (results, status) => {
  const list = results || [];
  if (!status || status === 'all') return list;
  return list.filter((item) => item && item.status === status);
};

// ---------- 私有双语文案（不改主语言文件；labels 注入覆盖） ----------

const LABELS_ZH = {
  title: '模型质量规则',
  desc: '查看已生成的声明式规则集，运行只读检查并定位问题对象',
  runCheck: '运行检查',
  running: '检查中…',
  readOnlyHint: '只读模式：可运行检查，不能启停规则集或提交修复请求。',
  noSource: '未获取到有效模型数据源。',
  emptyNoSets: '暂无模型规则集。AI 助手生成规则后，可在此查看和运行。',
  emptyAllDisabled: '所有规则集均未启用，运行检查不会产生结果；请先启用至少一个规则集。',
  emptyRunNothing: '启用的规则集没有可检查对象（scope 为空或对象已不存在）。',
  notRun: '尚未运行检查。点击“运行检查”查看当前模型快照的检查结果。',
  ruleCount: '规则',
  scopeLabel: '作用对象',
  scopeObjects: '{n} 个对象',
  enabledText: '已启用',
  disabledText: '已停用',
  enable: '启用',
  disable: '停用',
  updating: '提交中…',
  updateOk: '已生效',
  updateFailed: '提交失败，未生效',
  rulesDetails: '规则详情',
  severity: '严重度',
  target: '目标',
  predicate: '谓词',
  params: '参数',
  sevWarning: '警告',
  sevError: '错误',
  unknownPredicate: '未知或无效谓词',
  validationProblems: '校验问题',
  stTotal: '全部',
  stPass: '通过',
  stFail: '失败',
  stError: '错误',
  stNa: '不适用',
  budgetExceeded: '检查预算超限：超出部分按错误计，绝不计为通过。',
  staleReport: '规则集启用状态已变更，以下结果可能过期，请重新运行。',
  runError: '运行失败：{msg}',
  locate: '定位',
  actual: '实际',
  expected: '期望',
  remark: '说明',
  fixPick: '生成修复方案',
  fixSelected: '已选 {n} 项失败',
  fixSendAllHint: '未勾选时提交全部失败项。',
  fixSent: '修复请求已提交父层，等待生成与审阅候选；模型未被修改。',
  fixFailed: '修复请求提交失败。',
  fixNone: '当前结果中没有可修复的失败项。',
  fixReadOnly: '只读模式：修复请求已禁用。',
  pickAllFailed: '全选失败项',
  resultsTitle: '检查结果',
  ruleSetProblems: '规则集校验未通过，按错误计：',
};

const LABELS_EN = {
  title: 'Model Quality Rules',
  desc: 'Inspect generated declarative rule sets, run read-only checks and locate objects',
  runCheck: 'Run checks',
  running: 'Running…',
  readOnlyHint: 'Read-only: checks can run; enabling rule sets and fix requests are disabled.',
  noSource: 'No valid model data source available.',
  emptyNoSets: 'No model rule sets yet. Once the AI assistant generates rules, view and run them here.',
  emptyAllDisabled: 'All rule sets are disabled; running checks produces nothing. Enable at least one set first.',
  emptyRunNothing: 'Enabled rule sets have no checkable objects (scope empty or objects missing).',
  notRun: 'Checks not run yet. Click "Run checks" against the current model snapshot.',
  ruleCount: 'rules',
  scopeLabel: 'Scope',
  scopeObjects: '{n} objects',
  enabledText: 'Enabled',
  disabledText: 'Disabled',
  enable: 'Enable',
  disable: 'Disable',
  updating: 'Saving…',
  updateOk: 'Applied',
  updateFailed: 'Update failed, not applied',
  rulesDetails: 'Rule details',
  severity: 'Severity',
  target: 'Target',
  predicate: 'Predicate',
  params: 'Params',
  sevWarning: 'Warning',
  sevError: 'Error',
  unknownPredicate: 'Unknown or invalid predicate',
  validationProblems: 'Validation problems',
  stTotal: 'All',
  stPass: 'Pass',
  stFail: 'Fail',
  stError: 'Error',
  stNa: 'N/A',
  budgetExceeded: 'Check budget exceeded: overrun entries count as errors, never as passes.',
  staleReport: 'Rule set enablement changed; results below may be stale, re-run checks.',
  runError: 'Run failed: {msg}',
  locate: 'Locate',
  actual: 'Actual',
  expected: 'Expected',
  remark: 'Note',
  fixPick: 'Propose fix',
  fixSelected: '{n} failures selected',
  fixSendAllHint: 'Sends all failures when none selected.',
  fixSent: 'Fix request sent to the host for candidate review; the model is unchanged.',
  fixFailed: 'Failed to send the fix request.',
  fixNone: 'No fixable failures in current results.',
  fixReadOnly: 'Read-only: fix requests are disabled.',
  pickAllFailed: 'Select all failures',
  resultsTitle: 'Check results',
  ruleSetProblems: 'Rule set validation failed, counted as errors:',
};

export const getLabels = (locale, override) => {
  const base = locale === 'en' ? LABELS_EN : LABELS_ZH;
  return {...base, ...(override || {})};
};

const makeT = (locale, labels) => {
  const dict = getLabels(locale, labels);
  return (key, data) => {
    let value = dict[key] || key;
    Object.keys(data || {}).forEach((name) => {
      value = value.split(`{${name}}`).join(String(data[name]));
    });
    return value;
  };
};

const COLLECTION_LABEL_KEYS = {
  entities: 'colEntities',
  logicEntities: 'colLogicEntities',
  conceptEntities: 'colConceptEntities',
  fields: 'colFields',
};
LABELS_ZH.colEntities = '物理表';
LABELS_ZH.colLogicEntities = '逻辑实体';
LABELS_ZH.colConceptEntities = '概念实体';
LABELS_ZH.colFields = '字段';
LABELS_EN.colEntities = 'Physical tables';
LABELS_EN.colLogicEntities = 'Logical entities';
LABELS_EN.colConceptEntities = 'Concept entities';
LABELS_EN.colFields = 'Fields';

const TARGET_LABEL_KEYS = {
  physicalTable: 'colEntities',
  logicalEntity: 'colLogicEntities',
  conceptEntity: 'colConceptEntities',
  field: 'colFields',
};

const STATUS_LABEL_KEYS = {
  pass: 'stPass',
  fail: 'stFail',
  error: 'stError',
  notApplicable: 'stNa',
};

const predicateParams = (predicate) => {
  const keys = Object.keys(predicate || {}).filter((key) => key !== 'op');
  if (!keys.length) return '';
  return keys.map((key) => `${key}=${JSON.stringify(predicate[key])}`).join(' ');
};

// ---------- 结果区子组件：四态统计/筛选/定位/修复提案 ----------

export const AiModelQualityResults = ({
  report, dataSource, locale, labels, readOnly, onLocate, onProposeFix,
}) => {
  const t = useMemo(() => makeT(locale, labels), [locale, labels]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [picks, setPicks] = useState({});
  const [fixState, setFixState] = useState(null);
  const summary = summarizeReport(report);
  const sets = (report && report.ruleSets) || [];
  // 全部失败项按稳定身份登记（不经筛选）：picks 只认这些身份，
  // 切筛选/结果重排后同一对象仍是同一身份，绝不按可见序号映射。
  const failedAll = useMemo(() => {
    const out = [];
    sets.forEach((setEntry) => {
      ((setEntry && setEntry.rules) || []).forEach((ruleEntry) => {
        ((ruleEntry && ruleEntry.results) || []).forEach((item) => {
          if (item && item.status === 'fail') {
            out.push({item, key: resultIdentityKey(setEntry, ruleEntry, item)});
          }
        });
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);
  // 新报告对账：仅保留仍存在的失败项身份，消失对象的选择直接清掉，
  // 绝不把旧选择转到其他对象；真实选中计数同样只统计仍存在身份。
  useEffect(() => {
    setPicks((prev) => {
      const alive = {};
      let kept = 0;
      failedAll.forEach(({key}) => {
        if (prev[key]) {
          alive[key] = true;
          kept += 1;
        }
      });
      return kept === Object.keys(prev).length ? prev : alive;
    });
  }, [failedAll]);
  const pickCount = failedAll.filter(({key}) => picks[key]).length;
  const allPicked = failedAll.length > 0 && pickCount === failedAll.length;
  const canFix = !readOnly && typeof onProposeFix === 'function' && failedAll.length > 0;
  const sendFix = () => {
    // 只从当前报告真实选中的失败对象集取值；选中项被筛选隐藏时仍按选中集
    // 发送，不改发全量；未勾选时才按提示提交当前报告全部失败项。
    const selected = (pickCount ? failedAll.filter(({key}) => picks[key]) : failedAll)
      .map(({item}) => item);
    const outcome = submitFixProposal({results: selected, onProposeFix});
    setFixState(outcome.ok ? 'sent' : outcome.code === 'NO_FAILURES' ? 'none' : 'failed');
  };
  const rowsBySet = sets.map((setEntry, setIndex) => {
    const rules = (setEntry && setEntry.rules) || [];
    const rows = rules.map((ruleEntry) => {
      const results = filterResults(ruleEntry && ruleEntry.results, statusFilter);
      return {ruleEntry, results};
    });
    return {setEntry, rows};
  });
  const statusCounts = [
    ['all', t('stTotal'), summary.total],
    ['pass', t('stPass'), summary.pass],
    ['fail', t('stFail'), summary.fail],
    ['error', t('stError'), summary.error],
    ['notApplicable', t('stNa'), summary.notApplicable],
  ];
  return (
    <div className="aiq-results" data-aiq="results">
      <div className="aiq-results-head">
        <span className="aiq-results-title">{t('resultsTitle')}</span>
        <div className="aiq-filter">
          {statusCounts.map(([value, name, count]) => (
            <button
              key={value}
              type="button"
              className={`aiq-chip-btn${statusFilter === value ? ' aiq-chip-btn-active' : ''}`}
              data-aiq="filter-btn"
              data-status={value}
              onClick={() => setStatusFilter(value)}
            >{name} {count}</button>
          ))}
        </div>
      </div>
      {summary.budgetExceeded && (
        <div className="aiq-strip aiq-strip-warn" data-aiq="budget-warn">{t('budgetExceeded')}</div>
      )}
      {canFix && (
        <div className="aiq-fixbar" data-aiq="fixbar">
          <label className="aiq-check">
            <input
              type="checkbox"
              data-aiq="fix-pick-all"
              checked={allPicked}
              onChange={(e) => {
                // “全选失败项”明确作用于当前报告的全部失败对象（不限当前筛选可见）。
                const next = {};
                if (e.target.checked) {
                  failedAll.forEach(({key}) => {
                    next[key] = true;
                  });
                }
                setPicks(next);
              }}
            />{t('pickAllFailed')}
          </label>
          <span className="aiq-fixbar-info">{t('fixSelected', {n: pickCount})}　{t('fixSendAllHint')}</span>
          <button type="button" className="aiq-btn aiq-btn-primary" data-aiq="fix-btn" onClick={sendFix}>
            {t('fixPick')}
          </button>
          {fixState === 'sent' && <span className="aiq-ok">{t('fixSent')}</span>}
          {fixState === 'failed' && <span className="aiq-err">{t('fixFailed')}</span>}
          {fixState === 'none' && <span className="aiq-muted">{t('fixNone')}</span>}
        </div>
      )}
      {readOnly && failedAll.length > 0 && (
        <div className="aiq-strip" data-aiq="fix-readonly">{t('fixReadOnly')}</div>
      )}
      {rowsBySet.map(({setEntry, rows}, setIndex) => (
        <div className="aiq-result-set" key={setIndex} data-aiq="result-set">
          <div className="aiq-result-set-name">
            {text(setEntry && setEntry.name) || text(setEntry && setEntry.id)}
          </div>
          {setEntry && Array.isArray(setEntry.problems) && setEntry.problems.length > 0 && (
            <div className="aiq-strip aiq-strip-warn" data-aiq="set-problems">
              {t('ruleSetProblems')}
              {setEntry.problems.map((problem, index) => (
                <span key={index} className="aiq-problem-line">
                  {problem && problem.code ? `[${problem.code}] ` : ''}{text(problem && problem.message)}
                </span>
              ))}
            </div>
          )}
          {rows.map(({ruleEntry, results}, ruleIndex) => (
            <div className="aiq-result-rule" key={ruleIndex} data-aiq="result-rule">
              <div className="aiq-result-rule-name">
                {text(ruleEntry && ruleEntry.name) || text(ruleEntry && ruleEntry.ruleId) || '-'}
              </div>
              {results.length === 0 && (
                <div className="aiq-muted" data-aiq="rule-empty">—</div>
              )}
              {results.map((item, resultIndex) => {
                const idKey = resultIdentityKey(setEntry, ruleEntry, item);
                const locateArgs = typeof onLocate === 'function' ? resultLocateArgs(item) : null;
                const canPick = item.status === 'fail' && canFix;
                return (
                  <div className="aiq-result" key={`${idKey}#${resultIndex}`} data-aiq="result-row" data-status={item.status}>
                    {canPick && (
                      <label className="aiq-check">
                        <input
                          type="checkbox"
                          data-aiq="fix-pick"
                          checked={!!picks[idKey]}
                          onChange={(e) => setPicks((prev) => {
                            if (!e.target.checked) {
                              if (!prev[idKey]) return prev;
                              const next = {...prev};
                              delete next[idKey];
                              return next;
                            }
                            return {...prev, [idKey]: true};
                          })}
                        />
                      </label>
                    )}
                    <span className={`aiq-badge aiq-badge-${item.status}`}>
                      {t(STATUS_LABEL_KEYS[item.status] || 'stTotal')}
                    </span>
                    <span className="aiq-result-object">
                      {resolveObjectLabel(dataSource, item.objectRef, item.fieldRef)}
                    </span>
                    {item.actual !== undefined && item.actual !== null && item.actual !== '' && (
                      <span className="aiq-result-ae">{t('actual')}: {text(item.actual)}</span>
                    )}
                    {item.expected !== undefined && item.expected !== null && item.expected !== '' && (
                      <span className="aiq-result-ae">{t('expected')}: {text(item.expected)}</span>
                    )}
                    {text(item.message) && <span className="aiq-result-msg">{text(item.message)}</span>}
                    {locateArgs && (
                      <button
                        type="button"
                        className="aiq-btn aiq-btn-mini"
                        data-aiq="locate-btn"
                        onClick={() => onLocate.apply(null, locateArgs)}
                      >{t('locate')}</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

// ---------- 规则集卡片 ----------

const RuleSetCard = ({set, index, locale, labels, readOnly, canUpdate, pending, message, onToggle}) => {
  const t = useMemo(() => makeT(locale, labels), [locale, labels]);
  const problems = useMemo(() => validateQualityRuleSet(set), [set]);
  const scope = Array.isArray(set && set.scope) ? set.scope : [];
  const collectionCounts = {};
  scope.forEach((entry) => {
    const name = (entry && entry.collection) || '?';
    collectionCounts[name] = (collectionCounts[name] || 0) + 1;
  });
  const scopeText = [
    t('scopeObjects', {n: scope.length}),
    ...Object.keys(collectionCounts).map((name) => (
      `${t(COLLECTION_LABEL_KEYS[name] || 'colFields')}×${collectionCounts[name]}`
    )),
  ].join('：');
  const enabled = set && set.enabled === true;
  return (
    <div className={`aiq-card${enabled ? ' aiq-card-on' : ''}`} data-aiq="set-card" data-set-id={set && set.id}>
      <div className="aiq-card-head">
        <span className="aiq-set-index">{index + 1}</span>
        <span className="aiq-set-name">{text(set && set.name) || text(set && set.id)}</span>
        <span className={`aiq-badge ${enabled ? 'aiq-badge-on' : 'aiq-badge-off'}`}>
          {enabled ? t('enabledText') : t('disabledText')}
        </span>
        <span className="aiq-set-meta">
          {(set && Array.isArray(set.rules) ? set.rules.length : 0)} {t('ruleCount')}
        </span>
        {(canUpdate || readOnly) && (
          <button
            type="button"
            className={`aiq-btn${enabled ? '' : ' aiq-btn-primary'}`}
            data-aiq="toggle-btn"
            data-next={enabled ? 'false' : 'true'}
            disabled={readOnly || !canUpdate || !!pending}
            onClick={() => onToggle(set, !enabled)}
          >{pending ? t('updating') : (enabled ? t('disable') : t('enable'))}</button>
        )}
        <span className={`aiq-msg ${message ? '' : 'aiq-hidden'}`}
          data-aiq="set-message" data-kind={message ? message.kind : ''}>
          {message ? (message.kind === 'ok' ? t('updateOk') : t('updateFailed')) : ''}
        </span>
      </div>
      <div className="aiq-card-scope">{t('scopeLabel')}：{scopeText || '-'}</div>
      {problems.length > 0 && (
        <div className="aiq-strip aiq-strip-warn" data-aiq="set-validation">
          <span className="aiq-warn-title">{t('validationProblems')}：</span>
          {problems.map((problem, i) => (
            <span key={i} className="aiq-problem-line">
              {problem && problem.code ? `[${problem.code}] ` : ''}{text(problem && problem.message)}
            </span>
          ))}
        </div>
      )}
      <details className="aiq-rules-details">
        <summary>{t('rulesDetails')}</summary>
        <div className="aiq-rules">
          {(set && Array.isArray(set.rules) ? set.rules : []).map((rule, i) => {
            const ruleProblems = validateQualityRule(rule);
            const predicate = (rule && rule.predicate) || {};
            const unknown = text(predicate.op) === '' || !ruleProblems.every((p) => p.code !== 'UNSUPPORTED_PREDICATE' && p.code !== 'INVALID_PREDICATE');
            return (
              <div className="aiq-rule" key={i} data-aiq="rule-row">
                <div className="aiq-rule-line">
                  <span className="aiq-rule-name">{text(rule && rule.name) || text(rule && rule.id) || '-'}</span>
                  <span className={`aiq-badge ${rule && rule.severity === 'error' ? 'aiq-badge-fail' : 'aiq-badge-na'}`}>
                    {rule && rule.severity === 'error' ? t('sevError') : t('sevWarning')}
                  </span>
                  <span className="aiq-rule-tag">{t(TARGET_LABEL_KEYS[rule && rule.target] || 'colFields')}</span>
                </div>
                <div className="aiq-rule-line aiq-rule-predicate">
                  <span className="aiq-rule-tag">{t('predicate')}: {text(predicate.op) || '-'}</span>
                  {predicateParams(predicate) && (
                    <span className="aiq-rule-tag">{t('params')}: {predicateParams(predicate)}</span>
                  )}
                  {unknown && (
                    <span className="aiq-badge aiq-badge-err" data-aiq="unknown-predicate">{t('unknownPredicate')}</span>
                  )}
                </div>
                {ruleProblems.length > 0 && (
                  <div className="aiq-rule-line">
                    {ruleProblems.map((problem, j) => (
                      <span key={j} className="aiq-problem-line">
                        {problem && problem.code ? `[${problem.code}] ` : ''}{text(problem && problem.message)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
};

// ---------- 面板 ----------

const AiModelQualityPanel = ({
  dataSource,
  getDataSource,
  readOnly,
  onUpdate,
  onLocate,
  onProposeFix,
  locale,
  labels,
}) => {
  const t = useMemo(() => makeT(locale, labels), [locale, labels]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);
  const [reportStale, setReportStale] = useState(false);
  const [runError, setRunError] = useState('');
  const [pendingSet, setPendingSet] = useState(null);
  const [setMessages, setSetMessages] = useState({});
  const listSource = dataSource !== undefined && dataSource !== null
    ? dataSource
    : (typeof getDataSource === 'function' ? getDataSource() : null);
  const readLatest = () => (typeof getDataSource === 'function'
    ? getDataSource()
    : (dataSource !== undefined ? dataSource : null));
  const profile = useMemo(() => readQualityProfile(listSource),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listSource]);
  const ruleSets = profile.modelRuleSets || [];
  const enabledCount = ruleSets.filter((set) => set && set.enabled === true).length;
  const canUpdate = !readOnly && typeof onUpdate === 'function';

  const onToggle = (set, next) => {
    if (!set || pendingSet) return;
    setPendingSet(set.id);
    setSetMessages((prev) => ({...prev, [set.id]: null}));
    submitRuleSetEnabled({latestSource: readLatest(), ruleSetId: set.id, enabled: next, onUpdate})
      .then((outcome) => {
        setSetMessages((prev) => ({...prev, [set.id]: {kind: outcome.ok ? 'ok' : 'error'}}));
        if (outcome.ok) setReportStale(true);
      })
      .then(() => setPendingSet(null));
  };

  const runChecks = () => {
    const latest = readLatest();
    if (!latest || running) {
      if (!latest) setRunError(t('noSource'));
      return;
    }
    setRunning(true);
    setRunError('');
    try {
      const nextReport = runModelQuality(latest);
      setReport(nextReport);
      setReportStale(false);
    } catch (e) {
      setRunError(t('runError', {msg: text(e && e.message) || 'unknown'}));
    } finally {
      setRunning(false);
    }
  };

  if (!listSource) {
    return (
      <div className="aiq-panel" data-aiq="panel">
        <div className="aiq-strip" data-aiq="no-source">{t('noSource')}</div>
      </div>
    );
  }
  return (
    <div className="aiq-panel" data-aiq="panel" data-locale={locale === 'en' ? 'en' : 'zh'}>
      <div className="aiq-header">
        <div className="aiq-header-text">
          <div className="aiq-title">{t('title')}</div>
          <div className="aiq-desc">{t('desc')}</div>
        </div>
        <button
          type="button"
          className="aiq-btn aiq-btn-primary"
          data-aiq="run-btn"
          disabled={running}
          onClick={runChecks}
        >{running ? t('running') : t('runCheck')}</button>
      </div>
      {readOnly && <div className="aiq-strip" data-aiq="readonly-hint">{t('readOnlyHint')}</div>}
      {ruleSets.length === 0 && (
        <div className="aiq-empty" data-aiq="empty-no-sets">{t('emptyNoSets')}</div>
      )}
      {ruleSets.length > 0 && enabledCount === 0 && (
        <div className="aiq-strip aiq-strip-warn" data-aiq="all-disabled">{t('emptyAllDisabled')}</div>
      )}
      <div className="aiq-body">
        {ruleSets.map((set, index) => (
          <RuleSetCard
            key={set && set.id !== undefined ? set.id : index}
            set={set}
            index={index}
            locale={locale}
            labels={labels}
            readOnly={readOnly}
            canUpdate={canUpdate}
            pending={pendingSet === (set && set.id)}
            message={setMessages[set && set.id]}
            onToggle={onToggle}
          />
        ))}
      </div>
      <div className="aiq-report">
        {runError && <div className="aiq-strip aiq-strip-err" data-aiq="run-error">{runError}</div>}
        {reportStale && report && (
          <div className="aiq-strip aiq-strip-warn" data-aiq="stale">{t('staleReport')}</div>
        )}
        {report ? (
          summarizeReport(report).total === 0 ? (
            <div className="aiq-empty" data-aiq="empty-run">
              {enabledCount === 0 ? t('emptyAllDisabled') : t('emptyRunNothing')}
            </div>
          ) : (
            <AiModelQualityResults
              report={report}
              dataSource={listSource}
              locale={locale}
              labels={labels}
              readOnly={readOnly}
              onLocate={onLocate}
              onProposeFix={onProposeFix}
            />
          )
        ) : (
          !runError && <div className="aiq-empty" data-aiq="not-run">{t('notRun')}</div>
        )}
      </div>
    </div>
  );
};

export default AiModelQualityPanel;
