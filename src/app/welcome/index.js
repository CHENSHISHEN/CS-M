import React, { useState, useEffect, useLayoutEffect } from 'react';
import { connect } from 'react-redux';

import {Progressbar, Modal, FormatMessage} from 'components';
import { fail, success, pageType, CONFIG } from '../../lib/variable';
import './style/index.less';
import {
  getUserConfigData,
  removeHistory,
  saveUserConfigSome,
} from '../../actions/config';
import Home from '../home';
import {setMemoryCache} from '../../lib/cache';
import {
  openProject,
  updateProject,
  closeProject,
  createProject,
  renameProject,
  removeProject,
  saveProject,
  autoSaveProject,
  openDemoProject,
} from '../../actions/core';
import { openLoading, closeLoading } from '../../actions/common';
import {ConfigContent} from '../../lib/context';
import {getPrefix} from '../../lib/prefixUtil';

const Welcome = React.memo(({ prefix, getUserData, config, ...restProps }) => {
  const [percent, updatePercent] = useState(50);
  // 由于显示该标题时还无法获取到用户数据，无法支持国际化
  const [title, updateTitle] = useState('获取配置数据...');
  const [loadingTitle] = useState('加载中');
  useEffect(() => {
    // 第一个页面打开 读取各个配置文件
    getUserData();
  }, []);
  useEffect(() => {
    if (config.result === success) {
      // 读取配置信息成功（CS-M 不提供在线更新服务，无版本检查）
      updatePercent(100);
      setMemoryCache(CONFIG, config);
    } else if (config.result === fail) {
      // 读取配置信息失败
      Modal.error({title: config?.data.toString()});
    }
  }, [config.result]);
  // 经典布局剥离：新工作台是唯一布局，data-ui=workbench 无条件生效；
  // 旧布局偏好/布局切换事件已随经典布局一并移除，卸载时仍清理 body 标记
  useLayoutEffect(() => {
    document.body.setAttribute('data-ui', 'workbench');
    return () => {
      document.body.removeAttribute('data-ui');
    };
  }, []);
  const currentPrefix = getPrefix(prefix);
  if (percent === 100) {
    return <ConfigContent.Provider value={config}>
      <Home config={config} {...restProps}/>
    </ConfigContent.Provider>;
  }
  return <div className={`${currentPrefix}-welcome`}
  >
    <div className={`${currentPrefix}-welcome-header`}>
      <div className={`${currentPrefix}-welcome-header-logo`}>{}</div>
      <div className={`${currentPrefix}-welcome-header-name`}>
        <div>CS-M 建模</div>
        <div>CS-M</div>
      </div>
    </div>
    <div className={`${currentPrefix}-welcome-body`}>
      <div className={`${currentPrefix}-welcome-body-left`}>
        <div className={`${currentPrefix}-welcome-body-left-bg`}>
          {}
        </div>
      </div>
      <div className={`${currentPrefix}-welcome-body-right`}>
        <div className={`${currentPrefix}-welcome-body-right-circle`}>
          {}
        </div>
        <div className={`${currentPrefix}-welcome-body-right-icon`}>
          {}
        </div>
        <div className={`${currentPrefix}-welcome-body-right-loading`}>
          <span>{loadingTitle}</span>
          <span className={`${currentPrefix}-welcome-body-right-loading-block`}>{}</span>
          <span className={`${currentPrefix}-welcome-body-right-loading-block`}>{}</span>
          <span className={`${currentPrefix}-welcome-body-right-loading-block`}>{}</span>
        </div>
        <div className={`${currentPrefix}-welcome-body-right-progress`}>
          <Progressbar title={title} percent={percent} className={`${currentPrefix}-welcome-progressbar`} showPercent/>
        </div>
        <div className={`${currentPrefix}-welcome-body-right-copy`}>
          CS-M · Database table design tool
        </div>
      </div>
    </div>
    {/* eslint-disable-next-line max-len */}
    {/*<Progressbar title={title} percent={percent} className={`${currentPrefix}-welcome-progressbar`} showPercent/>*/}
  </div>;
});

const mapStateToProps = (state) => {
  return {
    projectInfo: state.core.info,
    dataSource: state.core.data,
    config: state.config,
    common: state.common,
    mode: state.core.mode,
  };
};
const mapDispatchToProps = (dispatch) => {
  return {
    getUserData: (title) => {
      dispatch(getUserConfigData(title));
    },
    saveUserData: (data) => {
      dispatch(saveUserConfigSome(data));
    },
    openTemplate: (h, t, title) => {
      dispatch(openDemoProject(h, t, title, pageType[2]));
    },
    open: (title, path, suffix, isDemoProject, mode) => {
      dispatch(openProject(title, pageType[2], path, suffix, isDemoProject, mode));
    },
    close: () => {
      dispatch(closeProject(pageType[1]));
    },
    update: (data) => {
      dispatch(updateProject(data));
    },
    rename: (newData, oldData, title, dataInfo) => {
      dispatch(renameProject(newData, oldData, title, dataInfo));
    },
    delete: (data, title) => {
      dispatch(removeProject(data, title));
    },
    save: (data, title, saveAs, callback) => {
      dispatch(saveProject(data, title, saveAs, callback));
    },
    autoSave: (data) => {
      // 静悄悄保存 无需任何提示
      dispatch(autoSaveProject(data));
    },
    create: (data, path, title) => {
      dispatch(createProject(data, path, title, pageType[2]));
    },
    openLoading: (title) => {
      dispatch(openLoading(title));
    },
    closeLoading: () => {
      dispatch(closeLoading());
    },
    updateHistory: (opt, ...data) => {
      switch (opt) {
        case 'remove': dispatch(removeHistory(...data));break;
        default: break;
      }
    },
  };
};

export default connect(mapStateToProps, mapDispatchToProps)(Welcome);
