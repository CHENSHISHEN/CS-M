import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Graph } from '@antv/x6';
import { Button, Icon, Modal } from 'components';
import {
  registerProcessShapes,
  PROCESS_PORTS,
  setNodePortsVisible,
  PROCESS_ELEMENT_CONFIGS,
} from './processShapes';
import {clone} from '../../lib/drawing_platform';
import { checkProcessSemantics, ELEMENT_TYPES } from '../../lib/businessStorage';

export default ({
  processData,
  roles = [],
  businessObjects = [],
  rules = [],
  onProcessChange,
  selectedElementId,
  onSelectElement,
  readOnly = false,
}) => {
  const containerRef = useRef(null);
  const graphRef = useRef(null);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [activeMode, setActiveMode] = useState('select'); // 'select' | 'connect'
  const [checkResult, setCheckResult] = useState(null); // array of issues
  const [showCheckPanel, setShowCheckPanel] = useState(false);

  const latest = useRef({processData, onProcessChange, onSelectElement});
  latest.current = {processData, onProcessChange, onSelectElement};
  const loadingGraph = useRef(false);

  registerProcessShapes();

  // 1. 初始化 X6 画布
  useEffect(() => {
    if (!containerRef.current) return undefined;

    const graph = new Graph({
      container: containerRef.current,
      autoResize: true,
      grid: {
        size: 10,
        visible: true,
        type: 'dot',
        args: {
          color: '#e5e7eb',
          thickness: 1,
        },
      },
      scroller: {
        enabled: true,
        pageVisible: false,
        pannable: true,
      },
      mousewheel: {
        enabled: true,
        modifiers: ['ctrl', 'meta'],
        minScale: 0.2,
        maxScale: 3,
      },
      interacting: !readOnly,
      selecting: {
        enabled: true,
        rubberband: !readOnly,
        showNodeSelectionBox: true,
        className: 'process-selection-box',
      },
      connecting: {
        snap: true,
        allowBlank: false,
        allowLoop: false,
        highlight: true,
        connector: 'rounded',
        router: {
          name: 'manhattan',
          args: {
            padding: 12,
          },
        },
        createEdge() {
          return graph.createEdge({
            shape: 'edge',
            attrs: {
              line: {
                stroke: '#1890ff',
                strokeWidth: 1.5,
                targetMarker: {
                  name: 'block',
                  width: 8,
                  height: 6,
                },
              },
            },
          });
        },
      },
    });

    graphRef.current = graph;

    // 选中事件
    graph.on('cell:selected', ({ cell }) => {
      latest.current.onSelectElement && latest.current.onSelectElement(cell.id, cell.shape === 'process-lane' ? 'lane' : cell.isNode() ? 'element' : 'flow');
    });

    graph.on('blank:click', () => {
      latest.current.onSelectElement && latest.current.onSelectElement(null, null);
    });

    // 悬停显示连接桩、移出隐藏(DRW-01)。只读模式不注册:只读画布 interacting=false,
    // 不允许拖线,显示连接桩只会误导用户。泳道无连接桩,调用为无操作。
    if (!readOnly) {
      graph.on('node:mouseenter', ({ node }) => setNodePortsVisible(node, true));
      graph.on('node:mouseleave', ({ node }) => setNodePortsVisible(node, false));
    }

    // 连线建立
    graph.on('edge:connected', ({ edge }) => {
      const source = edge.getSourceCellId();
      const target = edge.getTargetCellId();
      if (!source || !target) return;

      const newFlow = {
        id: edge.id,
        source,
        target,
        condition: '',
        isDefault: false,
      };

      const updatedFlows = [...(latest.current.processData?.flows || []).filter(f => f.id !== edge.id), newFlow];
      if (!readOnly && !loadingGraph.current && latest.current.onProcessChange && latest.current.processData) {
        latest.current.onProcessChange({
          ...latest.current.processData,
          flows: updatedFlows,
        });
      }
    });

    // 节点双击编辑名称
    graph.on('node:dblclick', ({ node }) => {
      if (readOnly) return;
      const currentName = node.attr('label/text') || '';
      Modal.prompt({
        title: '修改节点名称',
        defaultValue: currentName,
        onOk: (name) => {
          if (!name || !name.trim()) return;
          node.attr('label/text', name.trim());
          const updatedElements = (latest.current.processData?.elements || []).map(el => (el.id === node.id ? { ...el, name: name.trim() } : el));
          latest.current.onProcessChange && latest.current.onProcessChange({
            ...latest.current.processData,
            elements: updatedElements,
          });
        },
      });
    });

    // 节点位置变动
    graph.on('node:moved', () => {
      // 触发布局草稿保存
      const cells = clone(graph.toJSON().cells || []);
      if (!readOnly && !loadingGraph.current && latest.current.onProcessChange && latest.current.processData) {
        latest.current.onProcessChange({
          ...latest.current.processData,
          presentation: { cells },
        });
      }
    });

    // 缩放变动
    graph.on('scale', () => {
      setZoomLevel(Math.round(graph.zoom() * 100));
    });

    return () => {
      graph.dispose();
    };
  }, [readOnly]);

  // 2. 加载流程图元数据与泳道
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !processData) return;

    loadingGraph.current = true;
    graph.clearCells();

    const lanes = processData.lanes || [];
    const elements = processData.elements || [];
    const flows = processData.flows || [];
    const presentationCells = processData.presentation?.cells || [];

    // 布局计算：泳道横向铺设
    let currentY = 40;
    const laneNodes = [];
    lanes.forEach((lane) => {
      const role = roles.find(r => r.id === lane.roleId);
      const savedLane = presentationCells.find(c => c.id === lane.id);
      const laneNode = graph.createNode({
        id: lane.id,
        shape: 'process-lane',
        x: savedLane?.position?.x || 40,
        y: savedLane?.position?.y || currentY,
        width: 860,
        height: lane.height || 180,
        attrs: {
          label: {
            text: `【泳道】${lane.name || role?.name || '职责角色'}`,
          },
        },
        zIndex: 1,
      });
      laneNodes.push(laneNode);
      currentY += (lane.height || 180) + 20;
    });

    // 节点绘制
    const elementNodes = [];
    elements.forEach((el, index) => {
      const cfg = PROCESS_ELEMENT_CONFIGS.find(c => c.type === el.type) || PROCESS_ELEMENT_CONFIGS[1];
      const savedCell = presentationCells.find(c => c.id === el.id);

      // 计算默认初始位置：如果属于泳道，则落入泳道中
      let initialX = savedCell ? savedCell.position?.x : 100 + (index % 4) * 180;
      let initialY = savedCell ? savedCell.position?.y : 80 + Math.floor(index / 4) * 120;

      if (!savedCell && el.laneId) {
        const laneIndex = lanes.findIndex(l => l.id === el.laneId);
        if (laneIndex >= 0) {
          initialY = 40 + laneIndex * 200 + 50;
        }
      }

      const node = graph.createNode({
        id: el.id,
        shape: cfg.shape,
        x: initialX,
        y: initialY,
        width: cfg.width,
        height: cfg.height,
        attrs: {
          label: {
            text: el.name || cfg.defaultLabel,
          },
        },
        zIndex: 10,
        ports: { ...PROCESS_PORTS },
      });
      elementNodes.push(node);
    });

    // 连线绘制
    const edgeCells = [];
    flows.forEach((flow) => {
      const edge = graph.createEdge({
        id: flow.id,
        shape: 'edge',
        source: flow.source,
        target: flow.target,
        labels: flow.condition ? [{
          attrs: {
            text: {
              text: flow.condition,
              fill: '#595959',
              fontSize: 11,
            },
            rect: {
              fill: '#ffffff',
              stroke: '#d9d9d9',
              rx: 2,
              ry: 2,
            },
          },
        }] : [],
        attrs: {
          line: {
            stroke: flow.isDefault ? '#faad14' : '#1890ff',
            strokeWidth: flow.isDefault ? 2 : 1.5,
            strokeDasharray: flow.isDefault ? '4 2' : '',
            targetMarker: {
              name: 'block',
              width: 8,
              height: 6,
            },
          },
        },
      });
      edgeCells.push(edge);
    });

    graph.resetCells([...laneNodes, ...elementNodes, ...edgeCells]);
    elements.forEach(el => {const parent = graph.getCellById(el.laneId);const node = graph.getCellById(el.id);if (parent && node) parent.addChild(node);});
    if (selectedElementId && graph.getCellById(selectedElementId)) graph.resetSelection([graph.getCellById(selectedElementId)]);
    loadingGraph.current = false;
  }, [processData, roles, readOnly]);

  useEffect(() => {const g = graphRef.current;const cell = g?.getCellById(selectedElementId);if (cell) {g.resetSelection([cell]);g.centerCell(cell);}}, [selectedElementId]);

  const deleteSelection = () => {if (readOnly) return;const p = latest.current.processData;const ids = new Set((graphRef.current?.getSelectedCells() || []).map(c => c.id));if (!ids.size) return;
    const elements = (p.elements || []).filter(e => !ids.has(e.id)).map(e => ids.has(e.laneId) ? {...e, laneId: null} : e);const remaining = new Set(elements.map(e => e.id));const next = {...p, lanes: (p.lanes || []).filter(l => !ids.has(l.id)), elements, flows: (p.flows || []).filter(f => !ids.has(f.id) && remaining.has(f.source) && remaining.has(f.target)), presentation: {cells: (p.presentation?.cells || []).filter(c => !ids.has(c.id))}};latest.current.onProcessChange(next);latest.current.onSelectElement(null, null);
  };

  // 3. 执行流程语义检查 (BIZ-04)
  const handleCheckSemantics = useCallback(() => {
    const issues = checkProcessSemantics(processData);
    setCheckResult(issues);
    setShowCheckPanel(true);
  }, [processData]);

  // 4. 定位问题节点
  const handleLocateIssue = (elementId) => {
    if (!elementId) return;
    const graph = graphRef.current;
    if (!graph) return;
    const cell = graph.getCellById(elementId);
    if (cell) {
      graph.cleanSelection();
      graph.select(cell);
      graph.centerCell(cell);
      onSelectElement && onSelectElement(elementId, cell.isNode() ? 'element' : 'flow');
    }
  };

  // 5. 缩放控制
  const handleZoom = (type) => {
    const graph = graphRef.current;
    if (!graph) return;
    if (type === 'in') graph.zoom(0.1);
    else if (type === 'out') graph.zoom(-0.1);
    else if (type === 'fit') graph.zoomToFit({ padding: 30 });
    else graph.zoom(1 - graph.zoom());
  };

  // 6. 添加新流程图元
  const handleAddElement = (type) => {
    if (readOnly || !processData) return;
    const cfg = PROCESS_ELEMENT_CONFIGS.find(c => c.type === type) || PROCESS_ELEMENT_CONFIGS[1];
    const newId = `el-${type}-${Date.now().toString(36)}`;
    const newElement = {
      id: newId,
      type,
      name: `新${cfg.name}`,
      laneId: processData.lanes?.[0]?.id || null,
      inputObjectIds: [],
      outputObjectIds: [],
    };

    const nextElements = [...(processData.elements || []), newElement];
    onProcessChange && onProcessChange({
      ...processData,
      elements: nextElements,
    });
  };

  return (
    <div className='process-canvas-shell' tabIndex={0} onKeyDown={e => {if (!readOnly && !e.target.closest('input,textarea,select') && ['Delete', 'Backspace'].includes(e.key)) {e.preventDefault();e.stopPropagation();deleteSelection();}}}>
      {/* 1. 画布工具条 (UI-P02) */}
      <div className='process-canvas-toolbar'>
        <div className='toolbar-left'>
          <span className='process-title'>
            <Icon type='fa-sitemap' style={{ color: '#1890ff', marginRight: 6 }} />
            {processData?.name || '业务流程'}
          </span>
          <span className='process-desc'>{processData?.description || '业务流程与职责泳道'}</span>
        </div>

        <div className='toolbar-actions'>
          {/* 添加节点快捷按钮组 */}
          {!readOnly && (
            <div className='action-btn-group'>
              <Button size='small' onClick={() => handleAddElement('start')}>+ 开始</Button>
              <Button size='small' type='primary' onClick={() => handleAddElement('activity')}>+ 活动</Button>
              <Button size='small' onClick={() => handleAddElement('decision')}>+ 判断</Button>
              <Button size='small' onClick={() => handleAddElement('end')}>+ 结束</Button><Button size='small' onClick={deleteSelection}>删除选中</Button>
            </div>
          )}

          <div className='toolbar-divider' />

          {/* 流程检查按钮 (BIZ-04) */}
          <button
            type='button'
            className='check-process-btn'
            onClick={handleCheckSemantics}
            title='检查流程完整性（缺开始/结束、孤立活动、分支条件缺失）'
          >
            <Icon type='fa-check-circle-o' style={{ color: '#52c41a', marginRight: 4 }} />
            检查流程
          </button>

          <div className='toolbar-divider' />

          {/* 缩放控制器 */}
          <div className='zoom-controller'>
            <button type='button' className='icon-btn' onClick={() => handleZoom('out')} title='缩小'>
              <Icon type='fa-search-minus' />
            </button>
            <span className='zoom-value'>{zoomLevel}%</span>
            <button type='button' className='icon-btn' onClick={() => handleZoom('in')} title='放大'>
              <Icon type='fa-search-plus' />
            </button>
            <button type='button' className='icon-btn' onClick={() => handleZoom('fit')} title='适配合理尺寸'>
              <Icon type='fa-arrows-alt' />
            </button>
          </div>

          <Button
            size='small'
            icon='fa-download'
            onClick={() => {
              if (graphRef.current) {
                graphRef.current.toPNG(dataUri => {const a = document.createElement('a');a.href = dataUri;a.download = `${latest.current.processData?.name || '业务流程'}.png`;a.click();}, {padding: 20, backgroundColor: '#fff'});
              }
            }}
          >
            导出图片
          </Button>
        </div>
      </div>

      {/* 2. X6 画布视口 */}
      <div className='process-canvas-viewport' ref={containerRef} />

      {/* 3. 底部语义检查结果面板 (BIZ-04 / UI-P02) */}
      {showCheckPanel && checkResult && (
        <div className='process-check-panel'>
          <div className='check-panel-header'>
            <div className='header-info'>
              <Icon
                type={checkResult.length === 0 ? 'fa-check-circle' : 'fa-exclamation-triangle'}
                style={{ color: checkResult.length === 0 ? '#52c41a' : '#faad14', marginRight: 6 }}
              />
              <span className='title'>流程语义检查报告</span>
              <span className='badge'>
                {checkResult.length === 0 ? '未发现语义异常，流程规范良好' : `发现 ${checkResult.length} 处需关注的问题`}
              </span>
            </div>
            <button type='button' className='close-btn' onClick={() => setShowCheckPanel(false)}>
              <Icon type='fa-times' />
            </button>
          </div>

          {checkResult.length > 0 && (
            <div className='check-issues-list'>
              {checkResult.map((issue, idx) => (
                <div
                  key={idx}
                  className={`issue-item ${issue.level}`}
                  onClick={() => handleLocateIssue(issue.elementId)}
                  title='点击在画布中定位此节点'
                >
                  <span className={`issue-tag ${issue.level}`}>
                    {issue.level === 'error' ? '错误' : '警告'}
                  </span>
                  <span className='issue-msg'>{issue.message}</span>
                  {issue.elementId && (
                    <span className='locate-link'>
                      <Icon type='fa-crosshairs' style={{ marginRight: 4 }} />
                      定位元素
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
