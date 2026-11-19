import React, { useState, forwardRef, useImperativeHandle } from 'react';

// S3 经典布局剥离：HeaderTool 的可视旧头部（工具组/搜索/布局切换按钮）已删除，
// 命令入口全部由 WorkbenchTopbar/WorkbenchEditorToolbar 承载。
// 本组件保留为无 UI 控制器：selectionChanged 经 ref 调用 setIsCellSelected，
// 是图编辑器选区状态的共用 imperative 接缝，不得丢失（见协调者授权澄清）。
const HeaderTool = forwardRef((_, ref) => {
  const [isCellSelected, setIsCellSelected] = useState([]);
  useImperativeHandle(ref, () => {
    return {
      setIsCellSelected,
    };
  }, []);
  return null;
});

export default React.memo(HeaderTool);
