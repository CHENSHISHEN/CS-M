import React, { useState } from 'react';
import { Icon, SearchInput, Button, Modal, FormatMessage } from 'components';
import { DRAWING_SHAPES } from './drawingShapes';

// 6 基础图形微缩矢量预览组件 (UI-P06)
const ShapeMiniPreview = ({ type }) => {
  switch (type) {
    case 'rect':
      return (
        <svg width='36' height='24' viewBox='0 0 36 24'>
          <rect x='3' y='3' width='30' height='18' rx='0' fill='#ffffff' stroke='#595959' strokeWidth='1.5' />
        </svg>
      );
    case 'rounded-rect':
      return (
        <svg width='36' height='24' viewBox='0 0 36 24'>
          <rect x='3' y='3' width='30' height='18' rx='4' fill='#ffffff' stroke='#595959' strokeWidth='1.5' />
        </svg>
      );
    case 'ellipse':
      return (
        <svg width='36' height='24' viewBox='0 0 36 24'>
          <ellipse cx='18' cy='12' rx='15' ry='9' fill='#ffffff' stroke='#595959' strokeWidth='1.5' />
        </svg>
      );
    case 'diamond':
      return (
        <svg width='36' height='24' viewBox='0 0 36 24'>
          <polygon points='18,2 34,12 18,22 2,12' fill='#ffffff' stroke='#595959' strokeWidth='1.5' />
        </svg>
      );
    case 'text':
      return (
        <svg width='36' height='24' viewBox='0 0 36 24'>
          <text x='18' y='16' textAnchor='middle' fontSize='14' fontWeight='bold' fill='#595959' fontFamily='sans-serif'>T</text>
        </svg>
      );
    case 'note':
      return (
        <svg width='36' height='24' viewBox='0 0 36 24'>
          <rect x='3' y='3' width='30' height='18' rx='1' fill='#fffbe6' stroke='#ffe58f' strokeWidth='1.5' />
          <line x1='8' y1='8' x2='22' y2='8' stroke='#d4b106' strokeWidth='1' />
          <line x1='8' y1='13' x2='28' y2='13' stroke='#d4b106' strokeWidth='1' />
        </svg>
      );
    default:
      return null;
  }
};

export default ({
  drawingDocuments = [],
  activeDocId,
  onSelectDocument,
  onCreateDocument,
  onDeleteDocument,
  onAddShape,
  readOnly = false,
}) => {
  const [searchKey, setSearchKey] = useState('');

  const filteredDocs = drawingDocuments.filter(d =>
    (d.defName || d.name || '').toLowerCase().includes(searchKey.toLowerCase())
  );

  const handleDragStart = (e, shapeType) => {
    e.dataTransfer.setData('drawing-shape-type', shapeType);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleCreateClick = () => {
    if (readOnly) return;
    Modal.prompt({
      title: '新建图形文档',
      placeholder: '请输入图形文档名称',
      onOk: (name) => {
        if (!name || !name.trim()) return;
        onCreateDocument && onCreateDocument(name.trim());
      },
    });
  };

  return (
    <div className='drawing-sidebar-container'>
      {/* 头部标题与新建按钮 */}
      <div className='drawing-sidebar-header'>
        <span className='header-title'>画图资源</span>
        <div className='header-actions'>
          <button
            type='button'
            className='action-icon-btn'
            onClick={handleCreateClick}
            title='新建图形文档'
            disabled={readOnly}
          >
            <Icon type='fa-plus' />
          </button>
        </div>
      </div>

      {/* 搜索过滤框 */}
      <div className='drawing-sidebar-search'>
        <SearchInput
          placeholder='搜索图形文档'
          value={searchKey}
          onChange={e => setSearchKey(e.target.value)}
        />
      </div>

      {/* 第一区：图形文档列表 */}
      <div className='drawing-sidebar-section'>
        <div className='section-header'>
          <span className='section-label'>
            <Icon type='fa-folder-o' style={{ marginRight: 6 }} />
            图形文档
          </span>
          <span className='section-badge'>{drawingDocuments.length}</span>
        </div>

        <div className='drawing-doc-list'>
          {filteredDocs.map((doc) => {
            const isActive = doc.id === activeDocId;
            return (
              <div
                key={doc.id}
                className={`drawing-doc-item ${isActive ? 'active' : ''}`}
                onClick={() => onSelectDocument && onSelectDocument(doc.id)}
              >
                <Icon type='fa-sitemap' className='doc-icon' />
                <span className='doc-name' title={doc.defName || doc.name}>
                  {doc.defName || doc.name}
                </span>
                {!readOnly && drawingDocuments.length > 1 && (
                  <button
                    type='button'
                    className='doc-delete-btn'
                    title='删除文档'
                    onClick={(e) => {
                      e.stopPropagation();
                      Modal.confirm({
                        title: '删除确认',
                        message: `确定要删除图形文档「${doc.defName || doc.name}」吗？`,
                        onOk: () => onDeleteDocument && onDeleteDocument(doc.id),
                      });
                    }}
                  >
                    <Icon type='fa-trash-o' />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 第二区：基础图形工具箱 (UI-P06) */}
      <div className='drawing-sidebar-section shapes-section'>
        <div className='section-header'>
          <span className='section-label'>
            <Icon type='fa-th-large' style={{ marginRight: 6 }} />
            基础图形
          </span>
        </div>

        <div className='shapes-grid'>
          {DRAWING_SHAPES.map((shape) => (
            <div
              key={shape.type}
              className='shape-card'
              draggable={!readOnly}
              onDragStart={e => handleDragStart(e, shape.type)}
              onClick={() => onAddShape && onAddShape(shape.type)}
              title={`点击或拖拽添加【${shape.name}】`}
            >
              <div className='shape-preview-box'>
                <ShapeMiniPreview type={shape.type} />
              </div>
              <span className='shape-name'>{shape.name}</span>
            </div>
          ))}
        </div>

        <div className='shapes-helper-tip'>
          <p>拖入图形，连接并编辑样式。</p>
          <p>通用图形默认不具有业务含义。</p>
        </div>
      </div>
    </div>
  );
};
