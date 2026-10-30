import React from 'react';

// 线性 SVG 图标：path 数据取自已验收原型 demo/workbench-redesign/icons.js，
// 以 React 组件形式复刻（stroke=currentColor，可随文字颜色着色）
const WB_ICON_PATHS = {
  moon: 'M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z',
  model: 'M3 4h7v6H3zM14 14h7v6h-7zM14 4h7v6h-7zM6.5 10v7h7.5M10 7h4',
  standard: 'm4 6 8-3 8 3-8 3-8-3ZM4 11l8 3 8-3M4 16l8 3 8-3',
  delivery: 'M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5',
  versions: 'M7 5a3 3 0 1 0 0 .1M7 8v9m0 0a3 3 0 1 0 0 .1M17 8a3 3 0 1 0 0-.1M17 11v2c0 3-2 4-7 4',
  extensions: 'M4 4h6v3a2 2 0 1 0 4 0V4h6v6h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H4v-6h3a2 2 0 1 0 0-4H4Z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
  search: 'm21 21-5-5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z',
  save: 'M4 3h13l4 4v14H3V3Zm3 0v7h9V3M7 21v-7h10v7',
  chevron: 'm9 5 7 7-7 7',
  table: 'M3 4h18v16H3zM3 9h18M8 9v11',
  diagram: 'M3 3h6v6H3zM15 15h6v6h-6zM15 3h6v6h-6zM6 9v9h9M9 6h6',
  close: 'm6 6 12 12M6 18 18 6',
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  panel: 'M3 4h18v16H3zM15 4v16',
  minus: 'M5 12h14',
  key: 'M14 9a5 5 0 1 0-3 5l3-3h4v-4h3V3h-4l-3 3Z',
  arrow: 'M4 12h16m-5-5 5 5-5 5',
  crosshair: 'M12 3v5m0 8v5M3 12h5m8 0h5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  book: 'M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2V5Zm3-2v18M4 19h2',
  sparkles: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4',
  info: 'M12 11v6m0-10v.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-5 2 2-16',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10-2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  eyeSlash: 'M4 4l16 16M10.6 5.2A9.8 9.8 0 0 1 12 5c6.5 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.6 6.6A16.6 16.6 0 0 0 2 11s3.5 6 10 6c1.4 0 2.6-.3 3.7-.7M9.9 9.9a2.5 2.5 0 0 0 3.5 3.5',
  // 顶栏命令组图标
  import: 'M12 3v10m-4-4 4 4 4-4M4 15v5h16v-5',
  export: 'M12 13V3M8 7l4-4 4 4M4 15v5h16v-5',
  databaseIcon: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  shapes: 'M4 4h7v7H4zM15.5 13a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM4 20h7v-4H4z',
  align: 'M4 4v16M8 7h9M8 12h6M8 17h9',
  undo: 'M4 9h9a5 5 0 1 1 0 10H8M4 9l4-4M4 9l4 4',
  // 图上下文工具栏图标
  columns: 'M4 4h16v16H4zM9.5 4v16M15 4v16',
  group: 'M4 4h7v7H4zM13 13h7v7h-7zM11 7.5h2M7.5 11v2',
  mind: 'M3 12h3m6 0h3M6 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM15 12l4-5m-4 11 4-5M19 6h2M19 12h2M19 18h2',
  flow: 'M4 4h6v6H4zM14 14h6v6h-6zM7 10v4h7M14 7h3v7',
  briefcase: 'M4 7h16v13H4zM9 7V4h6v3',
  // 规则（勾选旗）
  check: 'm5 13 4 4L19 7',
};

export const WbIcon = React.memo(({name, size = 14, className}) => {
  const d = WB_ICON_PATHS[name] || WB_ICON_PATHS.info;
  return <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d}/>
  </svg>;
});

WbIcon.defaultProps = {
  size: 14,
};

export default WbIcon;
