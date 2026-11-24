import React from 'react';
import {FormatMessage} from 'components';
import {KIND_KEYS, STATUS_KEYS} from './commands';

// 指标平台 M2：页面级共享渲染助手（纯渲染函数，无 hooks——直接调用渲染，
// 与组件写法在真实 React 下等价，同时便于无渲染器的合成测试逐层执行）。

// M1 结构化错误 → 本地化文案（messageKey + params），附定位 path
export const renderMetricErrorText = (error) => {
  if (error == null) return null;
  return <span className='chiner-metrics-err-text'>
    <FormatMessage id={error.messageKey || 'metric.error.invalidValue'} data={error.params}/>
    {error.path ? <code className='chiner-metrics-err-path'>{error.path}</code> : null}
  </span>;
};

// M5B 错误业务化：按错误码类别给出“业务影响 + 下一步”摘要（真实失败不被隐藏，
// 不伪造成功）；错误码 / 开发期 message 留在可展开技术详情中
const ERROR_GUIDANCE_STATE = ['REVISION_CONFLICT', 'ACTIVE_DRAFT_EXISTS', 'IMMUTABLE_PUBLISHED',
  'DUPLICATE_CODE', 'DUPLICATE_ID', 'SCHEMA_VERSION_UNSUPPORTED', 'STORE_CORRUPT'];
const guidanceOf = (code) => {
  if (code === 'READ_ONLY') {
    return {impactKey: 'metrics.err.impactReadonly', nextKey: 'metrics.err.nextReadonly'};
  }
  if (code && ERROR_GUIDANCE_STATE.indexOf(code) >= 0) {
    return {impactKey: 'metrics.err.impactState', nextKey: 'metrics.err.nextState'};
  }
  return {impactKey: 'metrics.err.impactValidation', nextKey: 'metrics.err.nextValidation'};
};

// 错误清单：点击项滚动并聚焦到对应表单控件（data-error-path 与 M1 path 对齐）
export const renderErrorList = ({errors, onLocate, testId}) => {
  if (!errors || !errors.length) return null;
  return <ul className='chiner-metrics-errors' data-testid={testId || 'metrics-error-list'}>
    {errors.map((error, index) => {
      const guidance = guidanceOf(error && error.code);
      return <li
        key={`${error.code}-${error.path}-${index}`}
        className='chiner-metrics-errors-item'
      >
        <button
          type='button'
          onClick={() => {
            if (!error.path || !onLocate) return;
            const target = onLocate(error.path);
            if (target && target.focus && target.scrollIntoView) {
              target.scrollIntoView({block: 'center'});
              target.focus();
            }
          }}
        >
          <span className='chiner-metrics-errors-code'>{error.code}</span>
          {renderMetricErrorText(error)}
          <span className='chiner-metrics-errors-guide' data-testid='metrics-error-guide'>
            <FormatMessage id={guidance.impactKey}/>
            <FormatMessage id={guidance.nextKey}/>
          </span>
        </button>
        {error.message ? <details className='chiner-metrics-errors-tech'
          data-testid='metrics-error-tech'>
          <summary><FormatMessage id='metrics.err.techTitle'/></summary>
          <span className='chiner-metrics-errors-code'>{error.code}</span>
          <code className='chiner-metrics-err-path'>{error.message}</code>
        </details> : null}
      </li>;
    })}
  </ul>;
};

export const renderKindBadge = kind => <span
  className={`chiner-metrics-tag chiner-metrics-tag-kind-${kind}`}
  data-testid={`metrics-kind-${kind}`}>
  <FormatMessage id={KIND_KEYS[kind] || 'metrics.kind.atomic'}/>
</span>;

export const renderScopeBadge = scope => {
  const isDept = scope && scope.kind === 'department';
  return <span
    className={`chiner-metrics-tag ${isDept ? 'chiner-metrics-tag-dept' : 'chiner-metrics-tag-public'}`}>
    {isDept
      ? <FormatMessage id='metrics.scope.departmentNamed' data={{dept: scope.departmentId}}/>
      : <FormatMessage id='metrics.scope.public'/>}
  </span>;
};

export const renderStatusBadge = status => <span
  className={`chiner-metrics-tag chiner-metrics-tag-status-${status}`}>
  <FormatMessage id={STATUS_KEYS[status] || 'metrics.status.draft'}/>
</span>;

// 表单字段行：label + 控件插槽 + 校验定位锚点（data-error-path 对齐 M1 错误 path）
export const renderFieldRow = ({labelKey, errorPath, hint, span, children}) => <div
  className={`chiner-metrics-field${span ? ' chiner-metrics-field-span' : ''}`}
  data-error-path={errorPath}>
  <label className='chiner-metrics-field-label'>
    <FormatMessage id={labelKey}/>
  </label>
  <div className='chiner-metrics-field-control'>{children}</div>
  {hint ? <p className='chiner-metrics-field-hint'><FormatMessage id={hint}/></p> : null}
</div>;
