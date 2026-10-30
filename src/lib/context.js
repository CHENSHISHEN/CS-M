import React from 'react';

// 主题 语言 等内容的支持
const defaultConfig = {
  lang: 'zh' // 默认为中文
};

export const ConfigContent = React.createContext(defaultConfig);

export const TableContent = React.createContext({});

// 表编辑器中的推荐浮层复用主窗口字段库，不依赖全局事件或切换文档。
export const StandardFieldLibraryContext = React.createContext(null);
