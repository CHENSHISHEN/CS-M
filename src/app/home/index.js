import React, {useEffect, useState} from 'react';

import { Loading, Modal, FormatMessage, ToolBar } from 'components';
import './style/index.less';
import { fail, pageType, READING} from '../../lib/variable';
import Main from '../main';
import Home from './Home';
import {getPrefix} from '../../lib/prefixUtil';

export default React.memo(({prefix, open, create, rename, updateHistory, openTemplate,
                             ...restProps}) => {
  const { lang = 'zh' } = restProps?.config;
  const status = restProps?.common?.status;
  const type = restProps?.common?.type;
  const currentPrefix = getPrefix(prefix);
  // 判断是否是子窗口
  const childPath = window.location.search.split('path=')[1];
  // M5B 首页指标入口：一次性进入意图——只在指标卡发起的打开路径上携带；
  // 其他打开/新建/模板路径先清除，取消/失败不残留（Main 消费后回调清理）
  const [metricsEntry, setMetricsEntry] = useState(null);
  const clearMetricsEntry = () => {
    setMetricsEntry(null);
  };
  const _open = (path, mode) => {
    clearMetricsEntry();
    open(FormatMessage.string({id: 'readProject'}), path, null, false, mode);
  };
  // 指标卡入口：打开数据项目（path 为空时走系统文件选择），成功进入 Main 后
  // 由其消费 intent 切到指标工作台；项目类型不符时 Main 只提示不强改
  const _openMetricsProject = (path) => {
    setMetricsEntry({nonce: Date.now() + Math.random()});
    open(FormatMessage.string({id: 'readProject'}), path, null, false);
  };
  const _openTemplate = (data, t) => {
    clearMetricsEntry();
    openTemplate(data, t, FormatMessage.string({id: 'readProject'}));
  };
  const _create = (data, path) => {
    clearMetricsEntry();
    create(data, path, FormatMessage.string({id: 'createProject'}));
  };
  const _rename = (newData, oldData, dataInfo) => {
    rename(newData, oldData, FormatMessage.string({id: 'renameProject'}), dataInfo);
  };
  const _deleteProject = (h) => {
    restProps?.delete(h, FormatMessage.string({id: 'deleteProject'}));
  };
  if (status === fail) {
    Modal.error({title: FormatMessage.string({id: 'optFail'}), message: restProps?.common?.result.toString()});
  }
  useEffect(() => {
    if(childPath) {
      _open(decodeURI(childPath), READING);
    }
  }, []);
  return <Loading visible={restProps?.common.loading} title={restProps?.common.title}>
    <ToolBar
      mode={restProps?.mode}
      resizeable
      title={<FormatMessage id='system.title'/>}
      info={!(type === pageType[2]) ? '' : (restProps.projectInfo || <FormatMessage id='system.template'/>)}
    />
    {!(type === pageType[2]) ? <Home
      updateHistory={updateHistory}
      importProject={_open}
      createProject={_create}
      renameProject={_rename}
      deleteProject={_deleteProject}
      openTemplate={_openTemplate}
      openMetricsProject={_openMetricsProject}
      lang={lang}
      config={restProps?.config}
    /> : <Main
      {...restProps}
      isChildWindow={childPath}
      mode={restProps?.mode}
      openTemplate={_openTemplate}
      prefix={currentPrefix}
      open={open}
      metricsEntry={metricsEntry}
      onMetricsEntryConsumed={clearMetricsEntry}
    />}
  </Loading>;
});
