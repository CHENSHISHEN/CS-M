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
