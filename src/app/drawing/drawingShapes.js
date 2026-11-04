/**
 * 通用绘图图元库定义 (DRAW-01 / DRAW-02 / UI-P06)
 *
 * 覆盖 6 基础图形：矩形、圆角矩形、椭圆、菱形、文字、备注便签
 * 统一提供 4 自由连接锚点 (top/bottom/left/right) 与视觉控制
 */

import { Graph } from '@antv/x6';

export const STANDARD_PORTS = {
  groups: {
    top: {
      position: 'top',
      attrs: {
        circle: {
          r: 4,
          magnet: true,
          stroke: '#fa8c16',
          strokeWidth: 1.5,
          fill: '#ffffff',
          style: { visibility: 'hidden' },
        },
      },
    },
    bottom: {
      position: 'bottom',
      attrs: {
        circle: {
          r: 4,
          magnet: true,
          stroke: '#fa8c16',
          strokeWidth: 1.5,
          fill: '#ffffff',
          style: { visibility: 'hidden' },
        },
      },
    },
    left: {
      position: 'left',
      attrs: {
        circle: {
          r: 4,
          magnet: true,
          stroke: '#fa8c16',
          strokeWidth: 1.5,
          fill: '#ffffff',
          style: { visibility: 'hidden' },
        },
      },
    },
    right: {
      position: 'right',
      attrs: {
        circle: {
          r: 4,
          magnet: true,
          stroke: '#fa8c16',
          strokeWidth: 1.5,
          fill: '#ffffff',
          style: { visibility: 'hidden' },
        },
      },
    },
  },
  items: [
    { group: 'top', id: 'port-top' },
    { group: 'bottom', id: 'port-bottom' },
    { group: 'left', id: 'port-left' },
    { group: 'right', id: 'port-right' },
  ],
};

// 预设外观颜色色板 (UI-P06)
export const PRESET_COLORS = [
  { label: '纯白', value: '#ffffff', border: '#d9d9d9' },
  { label: '柔蓝', value: '#e6f7ff', border: '#91d5ff' },
  { label: '轻绿', value: '#e6fffb', border: '#87e8de' },
  { label: '暖黄', value: '#fff7e6', border: '#ffd591' },
  { label: '淡红', value: '#fff1f0', border: '#ffa39e' },
];

// 六大基础图元配置字典
export const DRAWING_SHAPES = [
  {
    type: 'rect',
    name: '矩形',
    shape: 'drawing-rect',
    defaultWidth: 120,
    defaultHeight: 60,
    defaultLabel: '矩形',
    rx: 0,
    ry: 0,
    fill: '#ffffff',
    stroke: '#595959',
    strokeWidth: 1.5,
    fontSize: 12,
    align: 'center',
  },
  {
    type: 'rounded-rect',
    name: '圆角矩形',
    shape: 'drawing-rounded-rect',
    defaultWidth: 120,
    defaultHeight: 60,
    defaultLabel: '圆角矩形',
    rx: 8,
    ry: 8,
    fill: '#ffffff',
    stroke: '#595959',
    strokeWidth: 1.5,
    fontSize: 12,
    align: 'center',
  },
  {
    type: 'ellipse',
    name: '椭圆',
    shape: 'drawing-ellipse',
    defaultWidth: 110,
    defaultHeight: 60,
    defaultLabel: '椭圆',
    fill: '#ffffff',
    stroke: '#595959',
    strokeWidth: 1.5,
    fontSize: 12,
    align: 'center',
  },
  {
    type: 'diamond',
    name: '菱形',
    shape: 'drawing-diamond',
    defaultWidth: 90,
    defaultHeight: 80,
    defaultLabel: '判断',
    fill: '#ffffff',
    stroke: '#595959',
    strokeWidth: 1.5,
    fontSize: 12,
    align: 'center',
  },
  {
    type: 'text',
    name: '文字',
    shape: 'drawing-text',
    defaultWidth: 120,
    defaultHeight: 36,
    defaultLabel: '文字内容',
    fill: 'transparent',
    stroke: 'transparent',
    strokeWidth: 0,
    fontSize: 14,
    align: 'center',
  },
  {
    type: 'note',
    name: '备注',
    shape: 'drawing-note',
    defaultWidth: 120,
    defaultHeight: 80,
    defaultLabel: '便签备注',
    fill: '#fffbe6',
    stroke: '#ffe58f',
    strokeWidth: 1.5,
    rx: 2,
    ry: 2,
    fontSize: 12,
    align: 'left',
  },
];

let shapesRegistered = false;

/**
 * 注册画图平台 X6 专用图形节点
 */
export const registerDrawingShapes = () => {
  if (shapesRegistered) return;
  shapesRegistered = true;

  // 1. 矩形
  Graph.registerNode('drawing-rect', {
    inherit: 'rect',
    attrs: {
      body: {
        fill: '#ffffff',
        stroke: '#595959',
        strokeWidth: 1.5,
        rx: 0,
        ry: 0,
      },
      label: {
        text: '矩形',
        fontSize: 12,
        fill: '#262626',
        textAnchor: 'middle',
        textVerticalAnchor: 'middle',
      },
    },
    ports: { ...STANDARD_PORTS },
  });

  // 2. 圆角矩形
  Graph.registerNode('drawing-rounded-rect', {
    inherit: 'rect',
    attrs: {
      body: {
        fill: '#ffffff',
        stroke: '#595959',
        strokeWidth: 1.5,
        rx: 8,
        ry: 8,
      },
      label: {
        text: '圆角矩形',
        fontSize: 12,
        fill: '#262626',
        textAnchor: 'middle',
        textVerticalAnchor: 'middle',
      },
    },
    ports: { ...STANDARD_PORTS },
  });

  // 3. 椭圆
  Graph.registerNode('drawing-ellipse', {
    inherit: 'ellipse',
    attrs: {
      body: {
        fill: '#ffffff',
        stroke: '#595959',
        strokeWidth: 1.5,
      },
      label: {
        text: '椭圆',
        fontSize: 12,
        fill: '#262626',
        textAnchor: 'middle',
        textVerticalAnchor: 'middle',
      },
    },
    ports: { ...STANDARD_PORTS },
  });

  // 4. 菱形
  Graph.registerNode('drawing-diamond', {
    inherit: 'polygon',
    attrs: {
      body: {
        fill: '#ffffff',
        stroke: '#595959',
        strokeWidth: 1.5,
        refPoints: '0,10 10,0 20,10 10,20',
      },
      label: {
        text: '判断',
        fontSize: 12,
        fill: '#262626',
        textAnchor: 'middle',
        textVerticalAnchor: 'middle',
      },
    },
    ports: { ...STANDARD_PORTS },
  });

  // 5. 文字
  Graph.registerNode('drawing-text', {
    inherit: 'rect',
    attrs: {
      body: {
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
      },
      label: {
        text: '文字内容',
        fontSize: 14,
        fill: '#262626',
        textAnchor: 'middle',
        textVerticalAnchor: 'middle',
      },
    },
    ports: { ...STANDARD_PORTS },
  });

  // 6. 便签备注
  Graph.registerNode('drawing-note', {
    inherit: 'rect',
    attrs: {
      body: {
        fill: '#fffbe6',
        stroke: '#ffe58f',
        strokeWidth: 1.5,
        rx: 2,
        ry: 2,
      },
      label: {
        text: '便签备注',
        fontSize: 12,
        fill: '#595959',
        textAnchor: 'start',
        textVerticalAnchor: 'top',
        refX: 10,
        refY: 10,
      },
    },
    ports: { ...STANDARD_PORTS },
  });
};
