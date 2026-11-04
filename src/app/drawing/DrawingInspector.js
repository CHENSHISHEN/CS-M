import React, { useState, useEffect } from 'react';
import { Icon, Button, Modal, Input } from 'components';
import { PRESET_COLORS, DRAWING_SHAPES } from './drawingShapes';

export default ({
  selectedCell,
  onClose,
  readOnly = false,
}) => {
  const [activeTab, setActiveTab] = useState('prop'); // 'prop' | 'rel' | 'check'

  // 属性状态
  const [text, setText] = useState('');
  const [fillColor, setFillColor] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(1.5);
  const [rx, setRx] = useState(0);
  const [fontSize, setFontSize] = useState(12);
  const [align, setAlign] = useState('center');

  // 几何状态
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [w, setW] = useState(120);
  const [h, setH] = useState(60);

  // 业务绑定状态 (Phase 4 扩展接缝)
  const [boundObject, setBoundObject] = useState(null);

  // 同步当前选中节点的属性
  useEffect(() => {
    if (!selectedCell || !selectedCell.isNode()) {
      setText('');
      setBoundObject(null);
      return;
    }

    const node = selectedCell;
    const bbox = node.getBBox();
    setX(Math.round(bbox.x));
    setY(Math.round(bbox.y));
    setW(Math.round(bbox.width));
    setH(Math.round(bbox.height));

    const currentText = node.attr('label/text') || '';
    setText(currentText);

    const currentFill = node.attr('body/fill') || '#ffffff';
    setFillColor(currentFill);

    const currentStrokeWidth = parseFloat(node.attr('body/strokeWidth')) || 1.5;
    setStrokeWidth(currentStrokeWidth);

    const currentRx = parseFloat(node.attr('body/rx')) || 0;
    setRx(currentRx);

    const currentFontSize = parseFloat(node.attr('label/fontSize')) || 12;
    setFontSize(currentFontSize);

    const currentAnchor = node.attr('label/textAnchor') || 'middle';
    setAlign(currentAnchor === 'start' ? 'left' : currentAnchor === 'end' ? 'right' : 'center');

    const bound = node.getData()?.boundObject || null;
    setBoundObject(bound);
  }, [selectedCell]);

  if (!selectedCell || !selectedCell.isNode()) {
    return (
      <div className='drawing-inspector-container empty'>
        <div className='inspector-tabs'>
          <span className='tab-item active'>属性</span>
          <span className='tab-item'>关联</span>
          <span className='tab-item'>检查</span>
          <button type='button' className='close-btn' onClick={onClose}>
            <Icon type='fa-times' />
          </button>
        </div>
        <div className='empty-tip'>
          <Icon type='fa-mouse-pointer' style={{ fontSize: 28, color: '#bfbfbf', marginBottom: 12 }} />
          <p>请在画布中选中一个图形</p>
          <p className='sub'>查看和编辑其外观样式、几何位置与业务关联</p>
        </div>
      </div>
    );
  }

  const node = selectedCell;
  const shapeShape = node.shape;
  const matchedShape = DRAWING_SHAPES.find(s => s.shape === shapeShape) || { name: '通用图形' };

  // 更新文本
  const handleTextChange = (val) => {
    setText(val);
    node.attr('label/text', val);
  };

  // 更新填充色
  const handleColorChange = (color) => {
    setFillColor(color);
    node.attr('body/fill', color);
  };

  // 更新边框粗细
  const handleStrokeWidthChange = (val) => {
    const num = parseFloat(val) || 0;
    setStrokeWidth(num);
    node.attr('body/strokeWidth', num);
  };

  // 更新圆角
  const handleRxChange = (val) => {
    const num = parseFloat(val) || 0;
    setRx(num);
    node.attr('body/rx', num);
    node.attr('body/ry', num);
  };

  // 更新字号
  const handleFontSizeChange = (val) => {
    const num = parseFloat(val) || 12;
    setFontSize(num);
    node.attr('label/fontSize', num);
  };

  // 更新对齐
  const handleAlignChange = (val) => {
    setAlign(val);
    const anchor = val === 'left' ? 'start' : val === 'right' ? 'end' : 'middle';
    node.attr('label/textAnchor', anchor);
  };

  // 更新坐标与宽高
  const handlePosChange = (newX, newY) => {
    setX(newX);
    setY(newY);
    node.position(newX, newY);
  };

  const handleSizeChange = (newW, newH) => {
    setW(newW);
    setH(newH);
    node.resize(newW, newH);
  };

  // 绑定业务对象 (Phase 4 预留良好接缝)
  const handleBindObjectClick = () => {
    Modal.prompt({
      title: '绑定已有业务对象',
      placeholder: '请输入业务对象名称（如：订单 / 客户）',
      onOk: (name) => {
        if (!name || !name.trim()) return;
        const bound = {
          name: name.trim(),
          boundAt: new Date().toISOString(),
        };
        setBoundObject(bound);
        node.setData({ boundObject: bound });
      },
    });
  };

  return (
    <div className='drawing-inspector-container'>
      {/* 顶部标签页 */}
      <div className='inspector-tabs'>
        <span
          className={`tab-item ${activeTab === 'prop' ? 'active' : ''}`}
          onClick={() => setActiveTab('prop')}
        >
          属性
        </span>
        <span
          className={`tab-item ${activeTab === 'rel' ? 'active' : ''}`}
          onClick={() => setActiveTab('rel')}
        >
          关联
        </span>
        <span
          className={`tab-item ${activeTab === 'check' ? 'active' : ''}`}
          onClick={() => setActiveTab('check')}
        >
          检查
        </span>
        <button type='button' className='close-btn' onClick={onClose} title='收起面板'>
          <Icon type='fa-times' />
        </button>
      </div>

      <div className='inspector-body'>
        {/* 图元摘要卡片 (UI-P06) */}
        <div className='element-header-card'>
          <div className='element-icon-box'>
            <Icon type='fa-th-large' />
          </div>
          <div className='element-info'>
            <div className='element-name' title={text || matchedShape.name}>
              {text || matchedShape.name}
            </div>
            <div className='element-type'>
              通用图形 · {matchedShape.name}
            </div>
          </div>
        </div>

        {/* 1. 外观属性分区 (Appearance) */}
        <div className='inspector-section'>
          <div className='section-title'>外观</div>

          <div className='form-item'>
            <label>图形文字</label>
            <input
              type='text'
              className='form-input'
              value={text}
              disabled={readOnly}
              onChange={e => handleTextChange(e.target.value)}
              placeholder='输入图元显示文本'
            />
          </div>

          <div className='form-item'>
            <label>填充颜色</label>
            <div className='color-picker-row'>
              {PRESET_COLORS.map(c => (
                <div
                  key={c.value}
                  className={`color-swatch ${fillColor === c.value ? 'selected' : ''}`}
                  style={{ background: c.value, borderColor: c.border }}
                  onClick={() => !readOnly && handleColorChange(c.value)}
                  title={c.label}
                />
              ))}
              <input
                type='color'
                className='color-native-input'
                value={fillColor.startsWith('#') && fillColor.length === 7 ? fillColor : '#ffffff'}
                disabled={readOnly}
                onChange={e => handleColorChange(e.target.value)}
                title='自定义颜色'
              />
            </div>
          </div>

          <div className='form-row'>
            <div className='form-item col-2'>
              <label>边框宽度</label>
              <div className='unit-input-wrap'>
                <input
                  type='number'
                  step='0.5'
                  min='0'
                  max='10'
                  className='form-input'
                  value={strokeWidth}
                  disabled={readOnly}
                  onChange={e => handleStrokeWidthChange(e.target.value)}
                />
                <span className='unit'>px</span>
              </div>
            </div>

            <div className='form-item col-2'>
              <label>圆角</label>
              <div className='unit-input-wrap'>
                <input
                  type='number'
                  min='0'
                  max='50'
                  className='form-input'
                  value={rx}
                  disabled={readOnly}
                  onChange={e => handleRxChange(e.target.value)}
                />
                <span className='unit'>px</span>
              </div>
            </div>
          </div>

          <div className='form-row'>
            <div className='form-item col-2'>
              <label>字体大小</label>
              <div className='unit-input-wrap'>
                <input
                  type='number'
                  min='9'
                  max='36'
                  className='form-input'
                  value={fontSize}
                  disabled={readOnly}
                  onChange={e => handleFontSizeChange(e.target.value)}
                />
                <span className='unit'>px</span>
              </div>
            </div>

            <div className='form-item col-2'>
              <label>对齐</label>
              <select
                className='form-select'
                value={align}
                disabled={readOnly}
                onChange={e => handleAlignChange(e.target.value)}
              >
                <option value='left'>靠左</option>
                <option value='center'>居中</option>
                <option value='right'>靠右</option>
              </select>
            </div>
          </div>
        </div>

        {/* 2. 位置与尺寸分区 (Geometry) */}
        <div className='inspector-section'>
          <div className='section-title'>位置与尺寸</div>

          <div className='geometry-grid'>
            <div className='geom-field'>
              <span className='geom-label'>X</span>
              <input
                type='number'
                className='geom-input'
                value={x}
                disabled={readOnly}
                onChange={e => handlePosChange(parseInt(e.target.value, 10) || 0, y)}
              />
            </div>

            <div className='geom-field'>
              <span className='geom-label'>Y</span>
              <input
                type='number'
                className='geom-input'
                value={y}
                disabled={readOnly}
                onChange={e => handlePosChange(x, parseInt(e.target.value, 10) || 0)}
              />
            </div>

            <div className='geom-field'>
              <span className='geom-label'>W</span>
              <input
                type='number'
                min='20'
                className='geom-input'
                value={w}
                disabled={readOnly}
                onChange={e => handleSizeChange(parseInt(e.target.value, 10) || 20, h)}
              />
            </div>

            <div className='geom-field'>
              <span className='geom-label'>H</span>
              <input
                type='number'
                min='20'
                className='geom-input'
                value={h}
                disabled={readOnly}
                onChange={e => handleSizeChange(w, parseInt(e.target.value, 10) || 20)}
              />
            </div>
          </div>
        </div>

        {/* 3. 业务对象绑定分区 (UI-P06) */}
        <div className='inspector-section binding-section'>
          <div className='section-title'>业务映射</div>
          {boundObject ? (
            <div className='bound-object-box'>
              <div className='bound-header'>
                <Icon type='fa-link' style={{ color: '#13c2c2', marginRight: 6 }} />
                <span className='bound-title'>已绑定业务对象</span>
              </div>
              <div className='bound-name'>{boundObject.name}</div>
              {!readOnly && (
                <button
                  type='button'
                  className='unbind-btn'
                  onClick={() => {
                    setBoundObject(null);
                    node.setData({ boundObject: null });
                  }}
                >
                  解除绑定
                </button>
              )}
            </div>
          ) : (
            <button
              type='button'
              className='bind-button'
              onClick={handleBindObjectClick}
              disabled={readOnly}
            >
              <Icon type='fa-plus' style={{ marginRight: 6 }} />
              绑定已有业务对象
            </button>
          )}
          <div className='binding-helper-text'>
            绑定后才参与业务关联，不会生成数据表。
          </div>
        </div>
      </div>
    </div>
  );
};
