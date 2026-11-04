/**
 * 业务流程专用图元与泳道定义 (BIZ-02 / BIZ-03 / UI-P02)
 *
 * 图元：
 * - process-start: 绿色圆形开始事件
 * - process-end: 红色双圈结束事件
 * - process-activity: 蓝色圆角矩形业务活动（含角色与名称）
 * - process-decision: 金色菱形判断网关
 * - process-lane: 横向职责泳道
 */

import { Graph } from '@antv/x6';

export const PROCESS_PORTS = {
  groups: {
    top: {
      position: 'top',
      attrs: {
        circle: {
          r: 4,
          magnet: true,
          stroke: '#1890ff',
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
          stroke: '#1890ff',
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
          stroke: '#1890ff',
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
          stroke: '#1890ff',
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

export const PROCESS_ELEMENT_CONFIGS = [
  {
    type: 'start',
    shape: 'process-start',
    name: '开始事件',
    defaultLabel: '开始',
    width: 44,
    height: 44,
    icon: 'play-circle',
    color: '#52c41a',
  },
  {
    type: 'activity',
    shape: 'process-activity',
    name: '业务活动',
    defaultLabel: '新活动',
    width: 140,
    height: 60,
    icon: 'square',
    color: '#1890ff',
  },
  {
    type: 'decision',
    shape: 'process-decision',
    name: '判断分支',
    defaultLabel: '条件判断',
    width: 90,
    height: 60,
    icon: 'diamond',
    color: '#fa8c16',
  },
  {
    type: 'end',
    shape: 'process-end',
    name: '结束事件',
    defaultLabel: '结束',
    width: 44,
    height: 44,
    icon: 'stop-circle',
    color: '#ff4d4f',
  },
  {
    type: 'lane',
    shape: 'process-lane',
    name: '职责泳道',
    defaultLabel: '职责角色',
    width: 800,
    height: 180,
    icon: 'columns',
    color: '#722ed1',
  },
];

let shapesRegistered = false;

export const registerProcessShapes = () => {
  if (shapesRegistered || typeof window === 'undefined') return;

  // 1. 开始事件：绿色单圈
  Graph.registerNode('process-start', {
    inherit: 'circle',
    width: 44,
    height: 44,
    attrs: {
      body: {
        fill: '#f6ffed',
        stroke: '#52c41a',
        strokeWidth: 2,
      },
      label: {
        text: '开始',
        fill: '#237804',
        fontSize: 12,
        fontWeight: 'bold',
      },
    },
    ports: { ...PROCESS_PORTS },
  }, true);

  // 2. 结束事件：红色双圈
  Graph.registerNode('process-end', {
    inherit: 'circle',
    width: 44,
    height: 44,
    attrs: {
      body: {
        fill: '#fff1f0',
        stroke: '#ff4d4f',
        strokeWidth: 3,
      },
      label: {
        text: '结束',
        fill: '#a8071a',
        fontSize: 12,
        fontWeight: 'bold',
      },
    },
    ports: { ...PROCESS_PORTS },
  }, true);

  // 3. 业务活动：圆角矩形，含角色徽标与名称
  Graph.registerNode('process-activity', {
    inherit: 'rect',
    width: 140,
    height: 60,
    attrs: {
      body: {
        fill: '#f0f5ff',
        stroke: '#1890ff',
        strokeWidth: 1.5,
        rx: 6,
        ry: 6,
      },
      label: {
        text: '新活动',
        fill: '#1d39c4',
        fontSize: 12,
        fontWeight: 500,
        textWrap: {
          width: 120,
          ellipsis: true,
        },
      },
    },
    ports: { ...PROCESS_PORTS },
  }, true);

  // 4. 判断分支：菱形网关
  Graph.registerNode('process-decision', {
    inherit: 'polygon',
    width: 90,
    height: 60,
    attrs: {
      body: {
        fill: '#fffbe6',
        stroke: '#faad14',
        strokeWidth: 1.5,
        refPoints: '0,10 10,0 20,10 10,20',
      },
      label: {
        text: '判断',
        fill: '#d46b08',
        fontSize: 11,
      },
    },
    ports: { ...PROCESS_PORTS },
  }, true);

  // 5. 职责泳道：横向容器矩形
  Graph.registerNode('process-lane', {
    inherit: 'rect',
    width: 800,
    height: 180,
    attrs: {
      body: {
        fill: '#fafafa',
        stroke: '#d9d9d9',
        strokeWidth: 1,
        strokeDasharray: '4 4',
      },
      label: {
        text: '职责泳道',
        fill: '#595959',
        fontSize: 13,
        fontWeight: 'bold',
        refX: 20,
        refY: 20,
        textAnchor: 'start',
      },
    },
    zIndex: 1,
  }, true);

  shapesRegistered = true;
};
