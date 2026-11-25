// ErrorBoundary 兜底界面的纯逻辑:把任意抛出值转为可展示的单行摘要(UX-22)
const MAX_LENGTH = 200;
const DEFAULT_MESSAGE = 'Unknown error';

export const toErrorFallbackInfo = (error) => {
  let raw = '';
  try {
    if (typeof error === 'string') {
      raw = error;
    } else if (error && typeof error === 'object' && typeof error.message === 'string') {
      raw = error.message;
    }
  } catch (e) {
    raw = '';
  }
  // 折叠换行与连续空白,保证单行
  let message = raw.replace(/\s+/g, ' ').trim();
  if (!message) {
    message = DEFAULT_MESSAGE;
  }
  if (message.length > MAX_LENGTH) {
    message = `${message.slice(0, MAX_LENGTH)}...`;
  }
  return {message};
};

// componentDidCatch 写日志前的归一化(UX-22 补充):writeLog 会读取 err.stack,
// throw null / throw undefined 时直接传入会在边界内部再抛 TypeError,导致整树卸载白屏。
// 始终返回 Error 实例,本函数自身绝不抛出。
const describeThrown = (error) => {
  if (error === null || error === undefined) {
    return `${DEFAULT_MESSAGE}: ${String(error)}`;
  }
  if (typeof error === 'string') {
    return error || DEFAULT_MESSAGE;
  }
  if (typeof error === 'object') {
    if (typeof error.message === 'string' && error.message) {
      return error.message;
    }
    const json = JSON.stringify(error);
    if (json && json !== '{}') {
      return json;
    }
  }
  return String(error);
};

export const toLoggableError = (error) => {
  if (error instanceof Error) {
    return error;
  }
  let message = DEFAULT_MESSAGE;
  try {
    message = describeThrown(error) || DEFAULT_MESSAGE;
  } catch (e) {
    message = DEFAULT_MESSAGE;
  }
  return new Error(message);
};
