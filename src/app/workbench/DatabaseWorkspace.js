import React, {useMemo, useState} from 'react';
import {Button, FormatMessage, Icon, Message} from 'components';
import DbConnect from '../container/dbconnect';
import {WbIcon} from './icons';
import {
  readDbConnDraftBaseline, accumulateDbConnDraft, applyDbConnDraft,
  discardDbConnDraft, dbConnDraftDirty, validateDbConnDraft,
} from './dbconnDraft';

const t = (key) => FormatMessage.string({id: `dbWorkspace.${key}`});

// DATA-WB-FEAT-001 整改 F1：数据库管理工作区（左轨“数据库”进入，替代顶栏入口）。
// 连接编辑改为本地草稿事务：DbConnect 的全部连续回调（新增/复制/删除/改名/切默认）
// 只积累进草稿、不写项目源；点“保存连接配置”时经 validateDbConnDraft 校验
// （名称完整唯一、非空默认连接属于列表）后由 applyDbConnDraft 将 dbConn 与
// profile.default.dbConn 作为同一有效配置一次性原子合并进最新有效模型
// （getDataSource live 读取，不覆盖模型对象/其他 profile 键）；“取消更改”丢弃草稿
// 并重挂载表单回退到当前项目配置。未保存草稿与无效草稿都不污染项目源。
// 数据库类型/映射/模板管理跳类型设置页；本页面不自动执行任何连接、比较、导入。
const DatabaseWorkspace = ({dataSource, getDataSource, updateDataSource, config, lang, prefix, readOnly,
                            onQuickCompareDb, onImportFromDb, onImportDDL, onOpenTypeSettings}) => {
  // 草稿基线：自当前有效模型读取；保存成功后重读刷新基线
  const baseline = useMemo(() => readDbConnDraftBaseline(
    getDataSource ? getDataSource() : dataSource),
    // 基线只在挂载与保存成功后重算（remountKey 变化触发重挂载时同步刷新）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataSource?.dbConn, dataSource?.profile?.default?.dbConn]);
  const [draft, setDraft] = useState(null);
  const [formResetKey, setFormResetKey] = useState(0);
  const dirty = dbConnDraftDirty(draft, baseline);
  // DbConnect 的连续回调只进草稿（函数式逐次积累，不读 render 闭包，不做单回调校验阻断）
  const dataChange = (value, fieldName) => {
    setDraft(prev => accumulateDbConnDraft(prev, value, fieldName, baseline, readOnly));
  };
  const saveDraft = () => {
    if (readOnly || !dirty) return;
    const error = validateDbConnDraft(draft);
    if (error) {
      Message.error({title: FormatMessage.string({id: 'optFail'}),
        message: FormatMessage.string({id: error})});
      return;
    }
    try {
      const next = applyDbConnDraft(getDataSource ? getDataSource() : dataSource, draft);
      updateDataSource && updateDataSource(next);
      setDraft(discardDbConnDraft());
      Message.success({title: FormatMessage.string({id: 'dbWorkspace.saveOk'})});
    } catch (e) {
      Message.error({title: FormatMessage.string({id: 'optFail'}),
        message: FormatMessage.string({id: e.message})});
    }
  };
  const cancelDraft = () => {
    setDraft(discardDbConnDraft());
    // 重挂载 DbConnect：其内部 state 回退到当前项目配置
    setFormResetKey(k => k + 1);
  };
  const entries = [
    {key: 'compare', icon: 'fa-exchange', run: onQuickCompareDb},
    {key: 'reverse', icon: 'fa-download', run: onImportFromDb},
    {key: 'ddl', icon: 'fa-file-code-o', run: onImportDDL},
    {key: 'typeSettings', icon: 'fa-cube', run: onOpenTypeSettings},
  ].filter(e => e.run);
  return <div className='chiner-db-workspace'>
    <header className='chiner-dbw-header'>
      <h2><WbIcon name='databaseIcon' size={16}/><span>{t('title')}</span></h2>
      <p><FormatMessage id='dbWorkspace.subtitle'/></p>
      {entries.length > 0 && <div className='chiner-dbw-entries' role='toolbar' aria-label={t('entriesLabel')}>
        {entries.map(e => <button type='button' key={e.key} onClick={e.run} title={t(e.key)}>
          <Icon type={e.icon}/>
          <span>{t(e.key)}</span>
        </button>)}
      </div>}
    </header>
    <div className='chiner-dbw-draftbar' role='group' aria-label={t('draftBarLabel')}>
      <span className={`chiner-dbw-draft-state${dirty ? ' dirty' : ''}`}>
        <FormatMessage id={dirty ? 'dbWorkspace.draftDirty' : 'dbWorkspace.draftClean'}/>
      </span>
      <span className='chiner-dbw-draft-actions'>
        <Button type='primary' disable={readOnly || !dirty} onClick={saveDraft}>
          <FormatMessage id='dbWorkspace.saveDraft'/>
        </Button>
        <Button disable={readOnly || !dirty} onClick={cancelDraft}>
          <FormatMessage id='dbWorkspace.cancelDraft'/>
        </Button>
      </span>
    </div>
    <div className='chiner-dbw-body'>
      <DbConnect
        key={formResetKey}
        prefix={prefix}
        dataSource={dataSource}
        config={config}
        lang={lang}
        readOnly={readOnly}
        dataChange={dataChange}
      />
    </div>
  </div>;
};

export default React.memo(DatabaseWorkspace);
