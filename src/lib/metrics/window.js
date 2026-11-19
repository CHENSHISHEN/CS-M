// 指标平台 M1：派生指标时间窗口语义（纯函数，不做真实时区换算）。
// 窗口声明：{type:'calendarDays', length:N, end:'yesterday'|'today', timezone:'Asia/Shanghai'}
//   或 {type:'rollingHours', length:N, end:'today', timezone}。
// 边界语义（SPEC 4.2）：以截止日 D 计，N 自然日 = [D-(N-1)日 00:00, D+1日 00:00)，
//   窗口不包含 D+1 日；timezone 记录为业务时区元数据，边界按该时区语义计算。
// 注：构建链不识别 ??，使用 == null 三元。

import {invalidValueError, missingFieldError} from './errors';

export const WINDOW_TYPES = ['calendarDays', 'rollingHours'];
export const WINDOW_ENDS = ['yesterday', 'today'];

export const validateWindow = (window, path) => {
  const errors = [];
  const at = (key) => `${path}.${key}`;
  if (window == null || typeof window !== 'object') {
    errors.push(missingFieldError(path, 'window'));
    return errors;
  }
  if (window.type == null) errors.push(missingFieldError(path, 'window.type'));
  else if (WINDOW_TYPES.indexOf(window.type) < 0) {
    errors.push(invalidValueError(at('type'), `window.type must be one of ${WINDOW_TYPES.join('/')}`));
  }
  if (window.length == null) errors.push(missingFieldError(path, 'window.length'));
  else if (!Number.isInteger(window.length) || window.length <= 0) {
    errors.push(invalidValueError(at('length'), 'window.length must be a positive integer'));
  }
  if (window.end == null) errors.push(missingFieldError(path, 'window.end'));
  else if (WINDOW_ENDS.indexOf(window.end) < 0) {
    errors.push(invalidValueError(at('end'), `window.end must be one of ${WINDOW_ENDS.join('/')}`));
  }
  if (window.timezone == null || window.timezone === '') {
    errors.push(missingFieldError(path, 'window.timezone'));
  }
  return errors;
};

const dayText = (date) => date.toISOString().slice(0, 10);

// 纯日期运算（UTC 日界，代表所记录业务时区内的自然日语义）
const shiftDays = (dayTextValue, delta) => {
  const date = new Date(`${dayTextValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return dayText(date);
};

const shiftHours = (isoText, delta) => new Date(new Date(isoText).getTime() + delta * 3600000).toISOString();

const asOfDay = (asOf) => {
  const text = String(asOf == null || asOf === '' ? new Date().toISOString().slice(0, 10) : asOf);
  return text.length > 10 ? text.slice(0, 10) : text;
};

// 截止日 D：end='yesterday' → asOf 前一日；end='today' → asOf 当日（窗口不包含次日）
export const windowEndDate = (window, asOf) =>
  shiftDays(asOfDay(asOf), window.end === 'yesterday' ? -1 : 0);

// 计算窗口范围：calendarDays → 日界半开区间；rollingHours → 小时级 ISO 区间。
// 仅语义推导，不代表任何真实执行。
export const computeWindowRange = (window, asOf) => {
  const endDay = windowEndDate(window, asOfDay(asOf));
  if (window.type === 'rollingHours') {
    const endExclusive = shiftHours(`${endDay}T00:00:00.000Z`, 24);
    return {
      type: window.type,
      length: window.length,
      endExclusive,
      startInclusive: shiftHours(endExclusive, -window.length),
      timezone: window.timezone,
    };
  }
  return {
    type: 'calendarDays',
    length: window.length,
    startInclusive: `${shiftDays(endDay, -(window.length - 1))}T00:00:00`,
    endExclusive: `${shiftDays(endDay, 1)}T00:00:00`,
    timezone: window.timezone,
  };
};

// 窗口兼容（复合指标用）：类型/长度/截止/时区全等才兼容，不隐式扩展窗口
export const isWindowCompatible = (left, right) =>
  left != null && right != null && left.type === right.type && left.length === right.length
    && left.end === right.end && left.timezone === right.timezone;
