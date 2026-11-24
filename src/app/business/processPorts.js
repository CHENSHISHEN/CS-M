/**
 * 显示/隐藏节点的全部连接桩(DRW-01)。
 * PROCESS_PORTS(processShapes.js)默认 visibility:'hidden',悬停时由画布调用本函数显示,移出时再隐藏。
 * 无连接桩的节点(如泳道)getPorts() 为空数组,调用为无操作。
 * 独立成无依赖文件:processShapes.js 顶层 import @antv/x6,在纯 node 下会因 navigator 缺失而失败。
 */
export const setNodePortsVisible = (node, visible) => {
  node.getPorts().forEach((port) => {
    node.setPortProp(port.id, 'attrs/circle/style/visibility', visible ? 'visible' : 'hidden');
  });
};
