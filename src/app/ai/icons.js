import React from 'react';

// AI 面板自用线性图标（stroke=currentColor），不依赖外部图标库；
// 仅在 src/app/ai 作用域内使用，不注册全局。
const AI_ICON_PATHS = {
  spark: 'm10 1 2.5 6.5L19 10l-6.5 2.5L10 19l-2.5-6.5L1 10l6.5-2.5L10 1Z',
  send: 'M10 17V3m-5 5 5-5 5 5',
  stop: 'M6 6h8v8H6z',
  plus: 'M10 3v14M3 10h14',
  close: 'm5 5 10 10M15 5 5 15',
  check: 'm3 10 4 4 10-10',
  file: 'M4 2h8l4 4v12H4zM12 2v5h4M7 10h6M7 13h6',
  settings: 'M6 2h8v3l3 2-1 4 1 2-3 2v3H6v-3l-3-2 1-4-1-2 3-2zM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  paperclip: 'm7 11 6-6c4-4 8 0 4 4l-8 8c-5 5-11-1-6-6l8-8',
  chevron: 'm7 4 5 6-5 6',
  warn: 'M10 2 1 18h18L10 2Zm0 6v4m0 3h.01',
  history: 'M3 5V1M3 5h4M3 5a8 8 0 1 1-1 9M10 6v5l3 2',
  more: 'M3 10h.1M10 10h.1M17 10h.1',
  scope: 'M10 1v4m0 10v4M1 10h4m10 0h4M15 10a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  key: 'M13 8a5 5 0 1 0-3 5l3-3h3v-3h3V3h-4l-2 3Z',
  layers: 'm10 2 8 4-8 4-8-4zM2 10l8 4 8-4M2 14l8 4 8-4',
  diagram: 'M2 2h5v4H2zM13 13h5v5h-5zM15 2h3v3h-3zM7 4h4v11h2M11 4h4',
};

export const AiIcon = React.memo(({name, size = 16, title}) => {
  const d = AI_ICON_PATHS[name] || AI_ICON_PATHS.file;
  return (
    <svg
      className="chiner-ai-icon"
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      focusable="false"
    >
      <path d={d}/>
    </svg>
  );
});
AiIcon.displayName = 'AiIcon';

export default AiIcon;
