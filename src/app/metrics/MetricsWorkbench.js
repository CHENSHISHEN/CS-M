import React, {useMemo, useRef, useState, useCallback, useEffect} from 'react';
import {FormatMessage, Modal} from 'components';
import {metricApi} from './commands';
import CatalogPage from './CatalogPage';
import DefinitionPage from './DefinitionPage';
import DictionaryPage from './DictionaryPage';
import DepartmentPage from './DepartmentPage';
import VersionsPage from './VersionsPage';
import BindingsPage from './BindingsPage';
import LineagePage from './LineagePage';

// 指标平台 M2/M3B/M4B/M5A 工作台外壳：208px 浅蓝二级导航 + 全宽页面区。
// - 与数据建模共享同一项目（module=data 身份不变），不建立第二份指标项目；
// - 目录/定义/语义字典（M3A）/部门口径/版本与变更（M3B）/模型关联（M4B）/
//   血缘与影响（M5A，只读投影）可用；
// - 未提交表单（定义/字典/部门建立）切页时先给保留/放弃确认；脏状态由当前挂载页
//   经 onDirtyChange 上报，同一时刻只有一个活动页在报告（切页即卸载）；
// - openRequest（宿主 main 的指标定位事件）：只接受指标目标——定义（含从字段
//   预填的原子草案）、模型关联详情或血缘焦点；切换走同一脏守卫，切回不丢已存状态。

import './style/index.less';

const NAV_GROUPS = [
  {
    groupKey: 'metrics.nav.assets',
    items: [
      {id: 'catalog', titleKey: 'metrics.nav.catalog', countKey: 'total'},
      {id: 'definition', titleKey: 'metrics.nav.definition'},
      {id: 'department', titleKey: 'metrics.nav.department', countKey: 'department'},
      {id: 'lineage', titleKey: 'metrics.nav.lineage'},
    ],
  },
  {
    groupKey: 'metrics.nav.governance',
    items: [
      {id: 'bindings', titleKey: 'metrics.nav.bindings', countKey: 'bindings'},
      {id: 'dictionary', titleKey: 'metrics.nav.dictionary'},
      {id: 'versions', titleKey: 'metrics.nav.versions', countKey: 'versions'},
    ],
  },
];

const MetricsWorkbench = React.forwardRef(({source, getDataSource, updateDataSource,
                                             readOnly, projectDirty, openRequest,
                                             onOpenModel}, _ref) => {
  const [page, setPage] = useState('catalog');
  const [focus, setFocus] = useState(null); // {definitionId,revisionId,mode,kind,prefill,nonce}
  const [bindingFocus, setBindingFocus] = useState(null); // {definitionId,revisionId,nonce}
  const [lineageFocus, setLineageFocus] = useState(null); // {definitionId,revisionId,nonce}
  const dirtyRef = useRef(false);
  const pageRef = useRef(page);
  pageRef.current = page;

  const commandRunner = useMemo(() => ({
    getSource: () => (getDataSource ? getDataSource() : source),
    updateDataSource,
    readOnly,
  }), [source, getDataSource, updateDataSource, readOnly]);

  const store = useMemo(() => metricApi.readMetricPlatform(source), [source]);
  const navCounts = useMemo(() => ({
    total: (store.definitions || []).length,
    department: (store.definitions || [])
      .filter(d => d.scope && d.scope.kind === 'department').length,
    versions: (store.revisions || []).length,
    // 只计生效/建议绑定：released 属历史，unresolved 已失效（MET-12）
    bindings: metricApi.countActiveMetricBindings(source),
  }), [store, source]);

  // 活动页脏上报（M3B 泛化）：定义/字典/部门建立表单都经同一 onDirtyChange 写入
  // dirtyRef；同一时刻只有当前挂载页在报告，切页即卸载、不再重复上报
  const onPageDirtyChange = useCallback((dirty) => {
    dirtyRef.current = dirty;
  }, []);

  // 切页守卫：未提交表单先确认（保留=取消，放弃=确定后离开）；
  // 确认离开时同步清理脏标记——页面随后卸载不再上报，避免残留导致反复确认
  const switchPage = (nextPage) => {
    if (nextPage === pageRef.current) return;
    const apply = () => {
      dirtyRef.current = false;
      setPage(nextPage);
    };
    if (dirtyRef.current) {
      Modal.confirm({
        title: FormatMessage.string({id: 'metrics.dirty.title'}),
        message: FormatMessage.string({id: 'metrics.dirty.message'}),
        onOk: apply,
      });
    } else {
      apply();
    }
  };

  const openDefinition = (definitionId, mode, kind, revisionId) => {
    const apply = () => {
      dirtyRef.current = false;
      setFocus({definitionId, revisionId: revisionId || null, mode: mode || 'view',
        kind: kind || null, nonce: Date.now() + Math.random()});
      setPage('definition');
    };
    if (dirtyRef.current) {
      Modal.confirm({
        title: FormatMessage.string({id: 'metrics.dirty.title'}),
        message: FormatMessage.string({id: 'metrics.dirty.message'}),
        onOk: apply,
      });
    } else {
      apply();
    }
  };

  // 指标内互跳（M5A）：目录/关联页/血缘节点 → 血缘页焦点（具体发布版本）
  const openLineage = (definitionId, revisionId) => {
    const apply = () => {
      dirtyRef.current = false;
      setLineageFocus({definitionId, revisionId: revisionId || null,
        nonce: Date.now() + Math.random()});
      setPage('lineage');
    };
    if (dirtyRef.current) {
      Modal.confirm({
        title: FormatMessage.string({id: 'metrics.dirty.title'}),
        message: FormatMessage.string({id: 'metrics.dirty.message'}),
        onOk: apply,
      });
    } else {
      apply();
    }
  };

  // 血缘节点 → 模型关联详情（同一指标版本）
  const openBindings = (definitionId, revisionId) => {
    const apply = () => {
      dirtyRef.current = false;
      setBindingFocus({definitionId, revisionId, nonce: Date.now() + Math.random()});
      setPage('bindings');
    };
    if (dirtyRef.current) {
      Modal.confirm({
        title: FormatMessage.string({id: 'metrics.dirty.title'}),
        message: FormatMessage.string({id: 'metrics.dirty.message'}),
        onOk: apply,
      });
    } else {
      apply();
    }
  };

  // 宿主指标定位事件（main 指标目标专用）：
  // - {module:'definition', mode:'create', kind, prefill} 从模型字段发起原子草案；
  // - {module:'definition', definitionId, revisionId, mode:'view'} 打开指标定义；
  // - {module:'bindings', definitionId, revisionId} 打开模型关联详情（反向查看）；
  // - {module:'lineage', definitionId, revisionId} 打开血缘与影响页焦点。
  // 只接指标目标；脏表单走同一保留/放弃确认。
  const requestRef = useRef(null);
  useEffect(() => {
    if (!openRequest || !openRequest.nonce) return;
    if (requestRef.current === openRequest.nonce) return;
    requestRef.current = openRequest.nonce;
    const apply = () => {
      dirtyRef.current = false;
      if (openRequest.module === 'bindings') {
        setBindingFocus({
          definitionId: openRequest.definitionId || null,
          revisionId: openRequest.revisionId || null,
          nonce: openRequest.nonce,
        });
        setPage('bindings');
        return;
      }
      if (openRequest.module === 'lineage') {
        setLineageFocus({
          definitionId: openRequest.definitionId || null,
          revisionId: openRequest.revisionId || null,
          nonce: openRequest.nonce,
        });
        setPage('lineage');
        return;
      }
      setFocus({
        definitionId: openRequest.definitionId == null ? null : openRequest.definitionId,
        revisionId: openRequest.revisionId == null ? null : openRequest.revisionId,
        mode: openRequest.mode || 'view',
        kind: openRequest.kind || null,
        prefill: openRequest.prefill || null,
        nonce: openRequest.nonce,
      });
      setPage('definition');
    };
    if (dirtyRef.current) {
      Modal.confirm({
        title: FormatMessage.string({id: 'metrics.dirty.title'}),
        message: FormatMessage.string({id: 'metrics.dirty.message'}),
        onOk: apply,
      });
    } else {
      apply();
    }
  }, [openRequest && openRequest.nonce]);

  // 暴露给宿主：未提交表单脏检查 + 关闭/卸载前的保留/放弃确认
  React.useImperativeHandle(_ref, () => ({
    isDirty: () => dirtyRef.current,
    checkLeave: (next) => {
      if (!dirtyRef.current) {
        next();
        return;
      }
      Modal.confirm({
        title: FormatMessage.string({id: 'metrics.dirty.title'}),
        message: FormatMessage.string({id: 'metrics.dirty.message'}),
        onOk: next,
      });
    },
  }), []);

  return <div className='chiner-metrics-shell' data-testid='metrics-workbench'>
    <nav className='chiner-metrics-nav' aria-label={FormatMessage.string({id: 'metrics.nav.label'})}>
      <div className='chiner-metrics-nav-title'>
        <FormatMessage id='metrics.nav.title'/>
      </div>
      {NAV_GROUPS.map(group => <div key={group.groupKey} className='chiner-metrics-nav-group'>
        <div className='chiner-metrics-nav-group-label'>
          <FormatMessage id={group.groupKey}/>
        </div>
        {group.items.map(item => <button
          key={item.id}
          type='button'
          className={`chiner-metrics-nav-item${page === item.id ? ' active' : ''}`}
          onClick={() => switchPage(item.id)}
          aria-current={page === item.id ? 'page' : undefined}
          data-testid={`metrics-nav-${item.id}`}
        >
          <span><FormatMessage id={item.titleKey}/></span>
          {item.countKey && navCounts[item.countKey] > 0
            ? <span className='chiner-metrics-nav-count'>{navCounts[item.countKey]}</span> : null}
          {item.pending ? <span className='chiner-metrics-nav-pending'
            title={FormatMessage.string({id: 'metrics.pending.badge'})}>{item.pending}</span> : null}
        </button>)}
      </div>)}
      <div className='chiner-metrics-nav-foot'>
        <div className='chiner-metrics-nav-foot-lines'>
          <span><FormatMessage id='metrics.nav.sharedMeta1'/></span>
          <span><FormatMessage id='metrics.nav.sharedMeta2'/></span>
        </div>
        <span className='chiner-metrics-nav-foot-tag'>
          <FormatMessage id='metrics.nav.moduleTag'/>
        </span>
      </div>
    </nav>
    <div className='chiner-metrics-body'>
      <div className='chiner-metrics-dirtybar' role='status'
        data-testid='metrics-project-dirty'
        style={{display: projectDirty ? '' : 'none'}}>
        <FormatMessage id='metrics.projectDirty'/>
      </div>
      {page === 'catalog' && <CatalogPage
        source={source}
        commandRunner={commandRunner}
        onOpenDefinition={openDefinition}
        onOpenLineage={openLineage}
        readOnly={readOnly}
      />}
      {page === 'definition' && <DefinitionPage
        source={source}
        commandRunner={commandRunner}
        readOnly={readOnly}
        focus={focus}
        onDirtyChange={onPageDirtyChange}
      />}
      {page === 'department' && <DepartmentPage
        source={source}
        commandRunner={commandRunner}
        readOnly={readOnly}
        onOpenDefinition={openDefinition}
        onDirtyChange={onPageDirtyChange}
      />}
      {page === 'versions' && <VersionsPage
        source={source}
        commandRunner={commandRunner}
        readOnly={readOnly}
        onOpenDefinition={openDefinition}
      />}
      {page === 'dictionary' && <DictionaryPage
        source={source}
        commandRunner={commandRunner}
        readOnly={readOnly}
        onDirtyChange={onPageDirtyChange}
      />}
      {page === 'bindings' && <BindingsPage
        source={source}
        commandRunner={commandRunner}
        onOpenDefinition={openDefinition}
        onOpenLineage={openLineage}
        onOpenModel={onOpenModel}
        readOnly={readOnly}
        focus={bindingFocus}
      />}
      {page === 'lineage' && <LineagePage
        source={source}
        readOnly={readOnly}
        focus={lineageFocus}
        onOpenDefinition={openDefinition}
        onOpenBindings={openBindings}
        onOpenModel={onOpenModel}
      />}
    </div>
  </div>;
});

export default MetricsWorkbench;
