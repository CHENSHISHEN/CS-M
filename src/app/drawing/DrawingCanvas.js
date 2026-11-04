import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Graph, DataUri } from '@antv/x6';
import { Button, Icon, Modal, FormatMessage, DropDown } from 'components';
import { registerDrawingShapes, DRAWING_SHAPES, STANDARD_PORTS } from './drawingShapes';

export default ({
  documentData,
  onDataChange,
  readOnly = false,
  selectedCell,
  onSelectCell,
  currentPrefix = 'chiner',
}) => {
  const containerRef = useRef(null);
  const graphRef = useRef(null);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [selectedCount, setSelectedCount] = useState(0);
  const [nodeCount, setNodeCount] = useState(0);
  const [activeTool, setActiveTool] = useState('select'); // 'select' | 'connect'

  // 确保图形定义已注册
  registerDrawingShapes();

  // 初始化画布
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
          color: '#d9d9d9',
          thickness: 1,
        },
      },
      scroller: {
        enabled: true,
        pageVisible: false,
        pageBreak: false,
        pannable: true,
      },
      mousewheel: {
        enabled: true,
        modifiers: ['ctrl', 'meta'],
        minScale: 0.2,
        maxScale: 3,
      },
      selecting: {
        enabled: !readOnly,
        rubberband: true,
        showNodeSelectionBox: true,
        className: 'drawing-selection-box',
      },
      snapline: {
        enabled: true,
        sharp: true,
      },
      resizing: {
        enabled: !readOnly,
        minWidth: 30,
        minHeight: 20,
      },
      history: {
        enabled: true,
      },
      connecting: {
        snap: true,
        allowBlank: false,
        highlight: true,
        router: 'manhattan',
        connector: 'rounded',
        createEdge() {
          return graph.createEdge({
            shape: 'edge',
            attrs: {
              line: {
                stroke: '#595959',
                strokeWidth: 1.5,
                targetMarker: {
                  name: 'classic',
                  size: 7,
                },
              },
            },
            router: {
              name: 'manhattan',
            },
          });
        },
        validateConnection({ targetMagnet }) {
          return Boolean(targetMagnet);
        },
      },
      interacting: !readOnly,
    });

    graphRef.current = graph;

    // 载入已有图元数据
    if (documentData?.canvasData?.cells) {
      try {
        graph.fromJSON(documentData.canvasData);
      } catch (err) {
        console.warn('加载图形数据失败，采用空画布:', err);
      }
    }

    const updateCounts = () => {
      setNodeCount(graph.getNodes().length);
      setSelectedCount(graph.getSelectedCells().length);
    };

    updateCounts();

    // 选中事件监听
    graph.on('cell:selected', ({ cell }) => {
      setSelectedCount(graph.getSelectedCells().length);
      onSelectCell && onSelectCell(cell);
    });

    graph.on('cell:unselected', () => {
      const selected = graph.getSelectedCells();
      setSelectedCount(selected.length);
      onSelectCell && onSelectCell(selected.length > 0 ? selected[0] : null);
    });

    // 鼠标悬停显示端口锚点
    graph.on('node:mouseenter', ({ node }) => {
      if (readOnly) return;
      const ports = node.getPorts();
      ports.forEach((p) => {
        node.portProp(p.id, 'attrs/circle/style/visibility', 'visible');
      });
    });

    graph.on('node:mouseleave', ({ node }) => {
      const ports = node.getPorts();
      ports.forEach((p) => {
        node.portProp(p.id, 'attrs/circle/style/visibility', 'hidden');
      });
    });

    // 双击修改节点文本
    graph.on('node:dblclick', ({ node }) => {
      if (readOnly) return;
      const currentText = node.attr('label/text') || '';
      Modal.prompt({
        title: '编辑图形文本',
        value: currentText,
        onOk: (newVal) => {
          node.attr('label/text', newVal || '');
          triggerDataChange();
        },
      });
    });

    // 画布变动回调
    const triggerDataChange = () => {
      if (readOnly) return;
      const json = graph.toJSON();
      updateCounts();
      onDataChange && onDataChange({
        ...documentData,
        canvasData: json,
      });
    };

    graph.on('cell:added', triggerDataChange);
    graph.on('cell:removed', triggerDataChange);
    graph.on('cell:change:*', triggerDataChange);

    // 快捷键支持
    if (!readOnly) {
      graph.bindKey(['backspace', 'delete'], () => {
        const cells = graph.getSelectedCells();
        if (cells.length > 0) {
          graph.removeCells(cells);
        }
      });

      graph.bindKey(['ctrl+z', 'meta+z'], () => {
        if (graph.canUndo()) graph.undo();
      });

      graph.bindKey(['ctrl+shift+z', 'meta+shift+z', 'ctrl+y', 'meta+y'], () => {
        if (graph.canRedo()) graph.redo();
      });
    }

    return () => {
      graph.dispose();
      graphRef.current = null;
    };
  }, []);

  // 暴露向画布添加图形的方法
  const addShapeToCanvas = useCallback((shapeType, position = null) => {
    const graph = graphRef.current;
    if (!graph || readOnly) return;

    const shapeConfig = DRAWING_SHAPES.find(s => s.type === shapeType) || DRAWING_SHAPES[0];
    const center = position || graph.getGraphArea().getCenter();

    const node = graph.createNode({
      shape: shapeConfig.shape,
      x: position ? position.x - shapeConfig.defaultWidth / 2 : center.x - shapeConfig.defaultWidth / 2,
      y: position ? position.y - shapeConfig.defaultHeight / 2 : center.y - shapeConfig.defaultHeight / 2,
      width: shapeConfig.defaultWidth,
      height: shapeConfig.defaultHeight,
      attrs: {
        body: {
          fill: shapeConfig.fill,
          stroke: shapeConfig.stroke,
          strokeWidth: shapeConfig.strokeWidth,
          rx: shapeConfig.rx || 0,
          ry: shapeConfig.ry || 0,
        },
        label: {
          text: shapeConfig.defaultLabel,
          fontSize: shapeConfig.fontSize || 12,
        },
      },
      ports: { ...STANDARD_PORTS },
    });

    graph.addNode(node);
    graph.resetSelection(node);
    onSelectCell && onSelectCell(node);
  }, [readOnly, onSelectCell]);

  // 绑定全局拖放添加事件
  useEffect(() => {
    const dom = containerRef.current;
    if (!dom || readOnly) return undefined;

    const handleDragOver = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };

    const handleDrop = (e) => {
      e.preventDefault();
      const shapeType = e.dataTransfer.getData('drawing-shape-type');
      if (shapeType && graphRef.current) {
        const rect = dom.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;
        const pos = graphRef.current.clientToLocal(e.clientX, e.clientY);
        addShapeToCanvas(shapeType, pos);
      }
    };

    const handleAddShapeEvent = (e) => {
      const shapeType = e.detail?.shapeType;
      if (shapeType) {
        addShapeToCanvas(shapeType);
      }
    };

    dom.addEventListener('dragover', handleDragOver);
    dom.addEventListener('drop', handleDrop);
    window.addEventListener('add-drawing-shape', handleAddShapeEvent);

    return () => {
      dom.removeEventListener('dragover', handleDragOver);
      dom.removeEventListener('drop', handleDrop);
      window.removeEventListener('add-drawing-shape', handleAddShapeEvent);
    };
  }, [addShapeToCanvas, readOnly]);

  // 导出相关方法 (DRAW-07)
  const handleExportPNG = () => {
    const graph = graphRef.current;
    if (!graph) return;
    DataUri.toPNG(graph, {
      backgroundColor: '#ffffff',
      padding: 24,
      quality: 1,
    }, (err, dataUri) => {
      if (err) {
        Modal.error({ title: '导出失败', message: err.message });
        return;
      }
      const link = document.createElement('a');
      link.download = `${documentData?.defName || 'drawing'}.png`;
      link.href = dataUri;
      link.click();
    });
  };

  const handleExportSVG = () => {
    const graph = graphRef.current;
    if (!graph) return;
    DataUri.toSVG(graph, {
      preserveDimensions: true,
    }, (err, svgString) => {
      if (err) {
        Modal.error({ title: '导出失败', message: err.message });
        return;
      }
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `${documentData?.defName || 'drawing'}.svg`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    });
  };

  const handleExportJSON = () => {
    const graph = graphRef.current;
    if (!graph) return;
    const jsonStr = JSON.stringify({
      ...documentData,
      canvasData: graph.toJSON(),
    }, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${documentData?.defName || 'drawing'}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 对齐与排列 (DRAW-04)
  const alignSelected = (direction) => {
    const graph = graphRef.current;
    if (!graph || readOnly) return;
    const selectedNodes = graph.getSelectedCells().filter(c => c.isNode());
    if (selectedNodes.length < 2) {
      Modal.info({ title: '对齐操作', message: '请至少选中 2 个图形进行对齐。' });
      return;
    }

    const bBoxes = selectedNodes.map(n => n.getBBox());
    const minX = Math.min(...bBoxes.map(b => b.x));
    const maxX = Math.max(...bBoxes.map(b => b.x + b.width));
    const minY = Math.min(...bBoxes.map(b => b.y));
    const maxY = Math.max(...bBoxes.map(b => b.y + b.height));

    selectedNodes.forEach((node) => {
      const b = node.getBBox();
      if (direction === 'left') node.position(minX, b.y);
      else if (direction === 'center') node.position(minX + (maxX - minX) / 2 - b.width / 2, b.y);
      else if (direction === 'right') node.position(maxX - b.width, b.y);
      else if (direction === 'top') node.position(b.x, minY);
      else if (direction === 'middle') node.position(b.x, minY + (maxY - minY) / 2 - b.height / 2);
      else if (direction === 'bottom') node.position(b.x, maxY - b.height);
    });
  };

  // 缩放控制
  const handleZoom = (type) => {
    const graph = graphRef.current;
    if (!graph) return;
    if (type === 'in') graph.zoom(0.1);
    else if (type === 'out') graph.zoom(-0.1);
    else if (type === 'fit') {
      graph.zoomToFit({ padding: 40 });
    } else if (type === 'reset') {
      graph.zoomTo(1);
      graph.centerContent();
    }
    setZoomLevel(Math.round(graph.zoom() * 100));
  };

  return (
    <div className='drawing-canvas-shell'>
      {/* 1. 画布顶栏：标题与导出按钮 */}
      <div className='drawing-canvas-topbar'>
        <div className='canvas-header-left'>
          <div className='canvas-breadcrumb'>
            <span>画图平台</span>
            <span className='sep'>/</span>
            <span className='active'>{documentData?.defName || '业务应用架构'}</span>
          </div>
          <div className='canvas-title-group'>
            <h2 className='canvas-title'>{documentData?.defName || '业务应用架构'}</h2>
            <span className='canvas-subtitle'>
              {documentData?.describe || '通用架构图 · 只表达系统和组件关系'}
            </span>
          </div>
        </div>
        <div className='canvas-header-right'>
          <div className='export-dropdown-wrapper'>
            <Button
              icon='fa-download'
              onClick={() => {
                Modal.confirm({
                  title: '导出图形',
                  message: '请选择导出的格式：',
                  buttons: [
                    <Button key='png' type='primary' onClick={handleExportPNG}>导出为 PNG 图片</Button>,
                    <Button key='svg' onClick={handleExportSVG}>导出为 SVG 矢量图</Button>,
                    <Button key='json' onClick={handleExportJSON}>导出为 原生 JSON</Button>,
                  ],
                });
              }}
            >
              导出
            </Button>
          </div>
        </div>
      </div>

      {/* 2. 画布操作条 (UI-P06: 选择、连接、排列、组合、样式) */}
      <div className='drawing-canvas-toolbar'>
        <div className='tool-group'>
          <button
            type='button'
            className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`}
            onClick={() => {
              setActiveTool('select');
              graphRef.current?.enableRubberband();
            }}
          >
            <Icon type='fa-mouse-pointer' style={{ marginRight: 4 }} />
            选择
          </button>
          <button
            type='button'
            className={`tool-btn ${activeTool === 'connect' ? 'active' : ''}`}
            onClick={() => {
              setActiveTool('connect');
            }}
          >
            <Icon type='fa-share-alt' style={{ marginRight: 4 }} />
            连接
          </button>
        </div>

        <div className='tool-divider' />

        {/* 排列菜单 */}
        <div className='tool-group'>
          <button
            type='button'
            className='tool-btn'
            onClick={() => {
              Modal.confirm({
                title: '对齐排列',
                message: '选择对齐方式：',
                buttons: [
                  <Button key='l' onClick={() => alignSelected('left')}>左对齐</Button>,
                  <Button key='c' onClick={() => alignSelected('center')}>水平居中</Button>,
                  <Button key='r' onClick={() => alignSelected('right')}>右对齐</Button>,
                  <Button key='t' onClick={() => alignSelected('top')}>顶对齐</Button>,
                  <Button key='m' onClick={() => alignSelected('middle')}>垂直居中</Button>,
                  <Button key='b' onClick={() => alignSelected('bottom')}>底对齐</Button>,
                ],
              });
            }}
          >
            <Icon type='fa-align-center' style={{ marginRight: 4 }} />
            排列
          </button>

          <button
            type='button'
            className='tool-btn'
            onClick={() => {
              const graph = graphRef.current;
              if (graph && graph.canUndo()) graph.undo();
            }}
            title='撤销 (Ctrl+Z)'
          >
            <Icon type='fa-undo' style={{ marginRight: 4 }} />
            撤销
          </button>

          <button
            type='button'
            className='tool-btn'
            onClick={() => {
              const graph = graphRef.current;
              if (graph && graph.canRedo()) graph.redo();
            }}
            title='重做 (Ctrl+Y)'
          >
            <Icon type='fa-repeat' style={{ marginRight: 4 }} />
            重做
          </button>
        </div>

        <div className='tool-divider' />

        {/* 缩放控制器 */}
        <div className='tool-group zoom-group'>
          <button type='button' className='icon-tool-btn' onClick={() => handleZoom('out')} title='缩小'>
            <Icon type='fa-search-minus' />
          </button>
          <span className='zoom-text' onClick={() => handleZoom('reset')} title='重置为 100%'>
            {zoomLevel}%
          </span>
          <button type='button' className='icon-tool-btn' onClick={() => handleZoom('in')} title='放大'>
            <Icon type='fa-search-plus' />
          </button>
          <button type='button' className='icon-tool-btn' onClick={() => handleZoom('fit')} title='适应画布'>
            <Icon type='fa-arrows-alt' />
          </button>
        </div>
      </div>

      {/* 3. 画布宿主容器 */}
      <div className='drawing-canvas-viewport' ref={containerRef} />

      {/* 4. 底部状态指示 (UI-P06) */}
      <div className='drawing-canvas-statusbar'>
        <span>6 个基础图形工具 · {nodeCount} 个图形 · 当前选中 {selectedCount} 个</span>
      </div>
    </div>
  );
};
