import React from 'react';
import ReactDOM from 'react-dom';
import { createStore, applyMiddleware } from 'redux';
import { Provider } from 'react-redux';
import thunkMiddleware from 'redux-thunk';
import { logger } from 'redux-logger';
import { Modal, FormatMessage } from 'components';
import Welcome from './app/welcome';
import reducers from './reducers';
import './style/detault.less';
import { writeLog, showErrorLogFolder } from './lib/middle';
import { toErrorFallbackInfo, toLoggableError } from './lib/errorBoundaryState';
//import { sendMessage } from './lib/electron-window-opt';

const store = createStore(reducers,
  {},
  applyMiddleware(
    thunkMiddleware,
    logger,
() => {
      return next => (action) => {
        // 发送上一次的数据
        //const preData = getState();
        next(action);
        //const nextData = getState();
        // 发送当前的数据
        //sendMessage(preData, nextData);
      };
    },
  ));

// 兜底界面文案:语言配置可能尚未初始化,取不到时使用默认中文
const t = (id, defaultText) => {
  try {
    const text = FormatMessage.string({id});
    return text && text !== id ? text : defaultText;
  } catch (e) {
    return defaultText;
  }
};

class Container extends React.Component{
  constructor(props) {
    super(props);
    this.state = {error: null, logFile: ''};
  }
  static getDerivedStateFromError(error) {
    // React 16 渲染异常会卸载整棵树,这里切换到兜底界面避免白屏
    return {error: toErrorFallbackInfo(error)};
  }
  componentDidCatch(error) {
    // 边界自身绝不能再抛错(否则 React 16 继续上抛、整树卸载白屏):
    // 先把 throw null/undefined/字符串等归一为 Error,同步异常与写日志失败都吞掉,兜底界面照常显示
    try {
      writeLog(toLoggableError(error)).then((file) => {
        this.setState({logFile: file});
        Modal.error({
          title: '出错了',
          message: <span>
            程序出现异常，请前往日志文件查看出错日志：<a onClick={() => showErrorLogFolder(file)}>{file}</a>
          </span>,
        });
      }).catch(() => {});
    } catch (e) {
      // 写日志同步失败:忽略,兜底界面已由 getDerivedStateFromError 切换
    }
  }
  render() {
    const { error, logFile } = this.state;
    if (error) {
      return <div style={{padding: 40, fontFamily: 'sans-serif'}}>
        <h2>{t('system.errorBoundary.title', '程序出现异常')}</h2>
        <p style={{wordBreak: 'break-all'}}>{error.message}</p>
        {logFile && <p style={{wordBreak: 'break-all'}}>
          {t('system.errorBoundary.logPath', '日志文件：')}
          <a onClick={() => showErrorLogFolder(logFile)}>{logFile}</a>
        </p>}
        <button type='button' onClick={() => window.location.reload()}>
          {t('system.errorBoundary.reload', '重新加载')}
        </button>
      </div>;
    }
    return <Welcome store={store}/>;
  }
}

function initComponent() {
  ReactDOM.render(<Provider store={store}>
    <Container/>
  </Provider>, document.getElementById('app'));
}

initComponent();
