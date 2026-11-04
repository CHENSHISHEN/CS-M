import React, { useEffect, useRef, useState } from 'react';
import DrawingDocument from '../../../../public/drawing-document';
import { SHAPES, SHAPE_PACKS } from '../../../lib/drawing_platform';
import { t, titleOf, en } from './common';
import ShapeGlyph from './ShapeGlyph';
import { CHEN_LOOK_STYLES, CHEN_LOOK_THEMES } from './ChenAppearance';
import { OverlayPortal, calculateClampedPosition } from './DrawingOverlayHost';
import { IconCheck, IconChevron, IconLayers } from './icons';

// CHEN-UI-008 library rework: borderless compact grid, single-line search,
// grouped counts, one footer hint, and a combined style/theme flyout whose
// cards preview real Chen symbols (names on hover/focus only, check on select).
const KIND_DESC = {
  entity: ['矩形 · 强实体', 'Rectangle · strong entity'],
  weak: ['双线矩形 · 依赖所属实体', 'Double rectangle · dependent entity'],
  relationship: ['菱形 · 联系', 'Diamond · relationship'],
  identifying: ['双线菱形 · 标识联系', 'Double diamond · identifying relationship'],
  attribute: ['椭圆 · 属性', 'Ellipse · attribute'],
  composite: ['椭圆 · 可包含子属性', 'Ellipse · owns child attributes'],
  multi: ['双线椭圆 · 多值属性', 'Double ellipse · multivalued'],
  derived: ['虚线椭圆 · 派生属性', 'Dashed ellipse · derived'],
  key: ['椭圆 · 键属性', 'Ellipse · key attribute'],
  'partial-key': ['椭圆 · 部分键（弱实体）', 'Ellipse · partial key (weak entity)'],
  rect: ['矩形', 'Rectangle'], rounded: ['圆角矩形', 'Rounded rectangle'],
  ellipse: ['椭圆', 'Ellipse'], text: ['文本', 'Text'], note: ['便笺', 'Note'],
  container: ['分组容器', 'Group container'], image: ['图片', 'Image'],
};

// Module-scope tile (UAT-009 drag fix): a stable component identity keeps the
// tile's DOM mounted across library re-renders — focus/hover tip state changes
// re-render the library, and a ShapeTile defined inside the render produced a
// NEW component type every time, remounting every tile and destroying the very
// button the native HTML5 drag started from (dragstart 0, drop added nothing).
// Keep focus and the tooltip; only the component identity is stabilized here.
const ShapeTile = ({s, look, readOnly, desc, onAdd, onEnter, onLeave, onMenu}) => (
  <div className='pv-shape-tile'>
    <button
      type='button'
      className='shape'
      draggable={!readOnly}
      disabled={readOnly}
      data-name={s.name}
      data-kind={s.id.replace(/^chen-/, '')}
      onClick={() => onAdd(s)}
      onDragStart={e => {
        onLeave();
        e.dataTransfer.setData('application/pdmaner-shape', s.id);
      }}
      onContextMenu={e => onMenu(e, s)}
      onKeyDown={e => {
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
          onMenu(e, s);
        }
      }}
      onMouseEnter={e => onEnter(e, titleOf(s), desc, false)}
      onMouseLeave={onLeave}
      onFocus={e => onEnter(e, titleOf(s), desc, true)}
      onBlur={onLeave}
      aria-label={titleOf(s)}
    >
      <ShapeGlyph shape={s} look={look} />
    </button>
  </div>
);

export default ({
  readOnly,
  enabled,
  look,
  onLookChange,
  selectionCount = 0,
  onApplySelected,
  onApplyCanvas,
  onLayers,
  onAdd,
  favorites,
  onFavorite,
  favoriteComponents,
  onRemoveComponent,
  customShapes,
  columns
}) => {
  const [tab, setTab] = useState('library');
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState(null);
  const [lookPopover, setLookPopover] = useState(false);
  const [applyMenu, setApplyMenu] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ left: 260, top: 110 });
  const [tip, setTip] = useState(null);

  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const tipTimer = useRef(null);

  const text = (zh, english) => en() ? english : zh;
  const kindDesc = shape => {
    const kind = shape.id.replace(/^chen-/, '');
    return KIND_DESC[kind] ? text(KIND_DESC[kind][0], KIND_DESC[kind][1]) : '';
  };
  const dragHint = shape =>
    ['attribute', 'composite', 'multi', 'derived', 'key', 'partial-key'].includes(shape.id.replace(/^chen-/, ''))
      ? text('拖到所属实体、联系或复合属性', 'Drag onto an owner')
      : '';

  const hideTip = () => {
    if (tipTimer.current) {
      clearTimeout(tipTimer.current);
      tipTimer.current = null;
    }
    setTip(null);
  };

  // Tooltip shows the glyph name plus a one-line semantic description; focus
  // reveals it immediately, hover after ~400ms. Never a native title duplicate.
  // Popover cards (style/theme) pass allowPopover so their light name tip still
  // appears while the flyout is open — layered above the popover itself.
  const showTip = (e, label, desc, immediate, allowPopover) => {
    if (menu || (lookPopover && !allowPopover)) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (tipTimer.current) clearTimeout(tipTimer.current);
    const reveal = () => setTip({
      name: label,
      desc,
      left: Math.max(8, Math.min(r.left, window.innerWidth - 200)),
      top: Math.min(r.bottom + 8, window.innerHeight - 56),
      z: allowPopover ? 300 : 100
    });
    if (immediate) reveal();
    else tipTimer.current = setTimeout(reveal, 400);
  };

  const toggleLookPopover = () => {
    hideTip();
    if (!lookPopover && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const pos = calculateClampedPosition({
        anchorRect: rect,
        overlayWidth: 366,
        overlayHeight: 430,
        placement: 'right-start'
      });
      setPopoverPos(pos);
    }
    setApplyMenu(false);
    setLookPopover(!lookPopover);
  };

  const openMenu = (event, shape) => {
    event.preventDefault();
    hideTip();
    const isKeyboard = !event.clientX && !event.clientY;
    const rect = event.currentTarget.getBoundingClientRect();
    const source = event.currentTarget;
    const pos = isKeyboard
      ? calculateClampedPosition({anchorRect: rect, overlayWidth: 190, overlayHeight: 130, placement: 'bottom-start'})
      : calculateClampedPosition({pointer: {x: event.clientX, y: event.clientY}, overlayWidth: 190, overlayHeight: 130, placement: 'pointer'});
    setMenu({x: pos.left, y: pos.top, shape, source});
  };

  useEffect(() => {
    if (menu) menuRef.current?.querySelector('button')?.focus();
  }, [menu && menu.shape.id, tab]);

  const closeMenu = restoreFocus => {
    const source = menu?.source;
    setMenu(null);
    if (restoreFocus && source?.focus) {
      requestAnimationFrame(() => source.focus());
    }
  };

  const packs = SHAPE_PACKS.filter(p => enabled.includes(p.id));
  const filter = list =>
    list.filter(s => `${s.name} ${s.en}`.toLowerCase().includes(search.trim().toLowerCase()));
  const favoriteShapes = filter(SHAPES.filter(s => favorites.includes(s.id)));

  const activeStyle = CHEN_LOOK_STYLES.find(s => s.id === look.styleId) || CHEN_LOOK_STYLES[0];
  const activeTheme = CHEN_LOOK_THEMES.find(th => th.id === look.themeId) || CHEN_LOOK_THEMES[0];
  const themeDetails = DrawingDocument.chenThemes[look.themeId] || DrawingDocument.chenThemes.default;

  const styleCardProps = (item, field, cardClass) => ({
    type: 'button',
    role: 'radio',
    'aria-checked': look[field] === item.id,
    className: `${cardClass}${look[field] === item.id ? ' selected' : ''}`,
    'aria-label': text(item.zh, item.en),
    disabled: readOnly,
    onClick: () => onLookChange({...look, [field]: item.id}),
    onMouseEnter: e => showTip(e, text(item.zh, item.en), field === 'styleId' ? text('线条风格', 'Line style') : text('角色配色', 'Role palette'), false, true),
    onMouseLeave: hideTip,
    onFocus: e => showTip(e, text(item.zh, item.en), field === 'styleId' ? text('线条风格', 'Line style') : text('角色配色', 'Role palette'), true, true),
    onBlur: hideTip,
  });

  // Roving arrow keys inside a radiogroup: arrows move focus and select.
  const onGroupKeyDown = (event, items, field) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
    const index = items.findIndex(i => i.id === look[field]);
    const next = items[(index + delta + items.length) % items.length];
    if (next) onLookChange({...look, [field]: next.id});
  };

  return (
    <div className='pv-chen-library'>
      {/* Tabs */}
      <div className='pv-library-tabs libtabs' role='tablist'>
        {[
          ['library', t('shapeLibrary')],
          ['mine', text('我的图形', 'My shapes')]
        ].map(([key, label]) => (
          <button
            type='button'
            key={key}
            role='tab'
            className={tab === key ? 'active' : ''}
            aria-selected={tab === key}
            aria-pressed={tab === key}
            onClick={() => {
              hideTip();
              setTab(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Combined Style & Theme Trigger (V5-R3 Result 2): single 36px row BEFORE
          the shape list — text first, color dots after, edges aligned with the
          search box. Names are read out on hover/focus only (aria-label). */}
      <div className='pv-chen-look'>
        <button
          ref={triggerRef}
          type='button'
          className={`pv-chen-look-trigger${lookPopover ? ' active' : ''}`}
          onClick={toggleLookPopover}
          aria-haspopup='dialog'
          aria-expanded={lookPopover}
          aria-label={text(
            `风格与配色。当前风格：${activeStyle.zh}，配色：${activeTheme.zh}`,
            `Style & theme. Style: ${activeStyle.en}, theme: ${activeTheme.en}`
          )}
        >
          <span className='pv-look-label'>
            <strong>{text('风格与配色', 'Style & theme')}</strong>
          </span>
          <span className='pv-theme-dots'>
            <i style={{background: themeDetails.entity?.fill || '#ffffff', borderColor: themeDetails.entity?.stroke || '#3566af'}} />
            <i style={{background: themeDetails.relationship?.fill || '#eee6fa', borderColor: themeDetails.relationship?.stroke || '#7854be'}} />
            <i style={{background: themeDetails.attribute?.fill || '#faeede', borderColor: themeDetails.attribute?.stroke || '#a46524'}} />
          </span>
          <span className='pv-look-arrow'><IconChevron size={12} /></span>
        </button>
      </div>

      {/* Search: icon + input on one row */}
      <label className='search pv-shape-search-wrap'>
        <svg viewBox='0 0 16 16' width='14' height='14' fill='none' stroke='currentColor'>
          <circle cx='6.5' cy='6.5' r='4' strokeWidth='1.3' />
          <path d='M9.5 9.5L14 14' strokeWidth='1.3' strokeLinecap='round' />
        </svg>
        <input
          className='pv-shape-search'
          aria-label={t('searchShapes')}
          placeholder={t('searchShapes')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </label>

      {/* Style & Theme flyout */}
      {lookPopover && (
        <OverlayPortal onClose={() => {setApplyMenu(false); setLookPopover(false);}}>
          <div className='pv-menu-backdrop' onClick={() => {setApplyMenu(false); setLookPopover(false);}} />
          <div
            className='pv-chen-look-popover popover'
            role='dialog'
            aria-label={text('风格与主题', 'Style & Theme')}
            style={{position: 'fixed', left: popoverPos.left, top: popoverPos.top, width: 366, zIndex: 200}}
          >
            <header className='pv-popover-header'>
              <strong>{text('风格与主题', 'Style & Theme')}</strong>
              <button type='button' className='pv-button pv-icon-btn' aria-label={text('关闭', 'Close')} onClick={() => setLookPopover(false)}>×</button>
            </header>

            <section className='pv-popover-section'>
              <div className='pv-popover-label-row'>
                <label className='pv-popover-label'>{text('线条风格', 'Line style')}</label>
                <small>{text('悬停查看名称', 'Hover for names')}</small>
              </div>
              <div
                className='pv-look-style-grid'
                role='radiogroup'
                aria-label={text('线条风格', 'Line style')}
                onKeyDown={e => onGroupKeyDown(e, CHEN_LOOK_STYLES, 'styleId')}
              >
                {CHEN_LOOK_STYLES.map(s => (
                  <button key={s.id} {...styleCardProps(s, 'styleId', 'pv-style-card')}>
                    <span className='pv-card-check' aria-hidden='true'><IconCheck size={11} /></span>
                    <span className='pv-style-glyph-preview'>
                      <ShapeGlyph shape={{ id: 'chen-weak', pack: 'chen' }} look={{ styleId: s.id, themeId: look.themeId }} />
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className='pv-popover-section'>
              <div className='pv-popover-label-row'>
                <label className='pv-popover-label'>{text('角色配色', 'Role palette')}</label>
                <small>{text('实体 · 联系 · 属性', 'Entity · Relationship · Attribute')}</small>
              </div>
              <div
                className='pv-look-theme-grid'
                role='radiogroup'
                aria-label={text('颜色主题', 'Color theme')}
                onKeyDown={e => onGroupKeyDown(e, CHEN_LOOK_THEMES, 'themeId')}
              >
                {CHEN_LOOK_THEMES.map(th => {
                  const details = DrawingDocument.chenThemes[th.id] || DrawingDocument.chenThemes.default;
                  return (
                    <button key={th.id} {...styleCardProps(th, 'themeId', 'pv-theme-card')}>
                      <span className='pv-card-check' aria-hidden='true'><IconCheck size={11} /></span>
                      <svg className='pv-theme-mini' viewBox='0 0 132 40' aria-hidden='true'>
                        <line x1='34' y1='20' x2='54' y2='20' stroke={details.edge} strokeWidth='1.2' />
                        <line x1='82' y1='20' x2='98' y2='20' stroke={details.edge} strokeWidth='1.2' />
                        <rect x='4' y='9' width='30' height='22' rx='1.5' fill={details.entity.fill} stroke={details.entity.stroke} strokeWidth='1.3' />
                        <polygon points='68,8 82,20 68,32 54,20' fill={details.relationship.fill} stroke={details.relationship.stroke} strokeWidth='1.3' />
                        <ellipse cx='115' cy='20' rx='15' ry='11' fill={details.attribute.fill} stroke={details.attribute.stroke} strokeWidth='1.3' />
                      </svg>
                      <span className='pv-theme-swatch-bar'>
                        <i style={{background: details.entity.fill, borderColor: details.entity.stroke}} />
                        <i style={{background: details.relationship.fill, borderColor: details.relationship.stroke}} />
                        <i style={{background: details.attribute.fill, borderColor: details.attribute.stroke}} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <p className='pv-look-note'>{text('选择风格或配色即更新后续新图形默认；已有对象保持不变。', 'Picking updates defaults for new shapes; existing objects keep their look.')}</p>

            <footer className='pv-popover-footer'>
              <button
                type='button'
                className='pv-button'
                id='resetlook'
                disabled={readOnly}
                onClick={() => onLookChange({ version: 1, styleId: 'standard', themeId: 'default' })}
              >
                {text('恢复默认', 'Restore defaults')}
              </button>
              <span className='pv-apply-split'>
                <button
                  type='button'
                  className='pv-button primary'
                  disabled={readOnly || !selectionCount}
                  title={selectionCount ? text(`应用到选中的 ${selectionCount} 个对象`, `Apply to ${selectionCount} selected`) : text('无选中对象；选择图形后可显式应用', 'No selection; select shapes to apply')}
                  onClick={() => {
                    setLookPopover(false);
                    onApplySelected?.();
                  }}
                >
                  {text(`应用到选中对象${selectionCount ? `（${selectionCount}）` : ''}`, `Apply to selected${selectionCount ? ` (${selectionCount})` : ''}`)}
                </button>
                <button
                  type='button'
                  className='pv-button pv-apply-caret'
                  aria-label={text('更多应用范围', 'More apply scopes')}
                  disabled={readOnly}
                  onClick={() => setApplyMenu(v => !v)}
                ><IconChevron size={12} /></button>
                {applyMenu && (
                  <span className='pv-apply-menu' role='menu'>
                    <button type='button' role='menuitem' disabled={readOnly} onClick={() => {setApplyMenu(false);setLookPopover(false);onApplyCanvas?.();}}>
                      {text('应用到当前画布…', 'Apply to canvas…')}
                    </button>
                  </span>
                )}
              </span>
            </footer>
          </div>
        </OverlayPortal>
      )}

      {/* Shape Packs: group head = name left, count right; borderless tiles */}
      {tab === 'library' ? (
        packs.map(p => (
          <section className='pv-shape-pack group' key={p.id}>
            <div className='grouphead'>
              <span className='groupname'>{titleOf(p)}</span>
              <span className='groupcount'>{filter(SHAPES.filter(s => s.pack === p.id)).length}</span>
            </div>
            <div className={`pv-shapes pv-chen-shapes shapes cols-${columns}`}>
              {filter(SHAPES.filter(s => s.pack === p.id)).map(s => <ShapeTile key={s.id} s={s} look={look} readOnly={readOnly} desc={kindDesc(s)} onAdd={onAdd} onEnter={showTip} onLeave={hideTip} onMenu={openMenu} />)}
            </div>
          </section>
        ))
      ) : (
        <section className='pv-shape-pack group'>
          <div className='grouphead'>
            <span className='groupname'>{text('收藏图形', 'Favorite shapes')}</span>
            <span className='groupcount'>{favoriteShapes.length}</span>
          </div>
          <div className={`pv-shapes pv-chen-shapes shapes cols-${columns}`}>
            {favoriteShapes.map(s => <ShapeTile key={s.id} s={s} look={look} readOnly={readOnly} desc={kindDesc(s)} onAdd={onAdd} onEnter={showTip} onLeave={hideTip} onMenu={openMenu} />)}
            {!favoriteShapes.length && (
              <p className='pv-note'>{text('在图形库中右键图形可加入我的图形。', 'Right-click a shape in the library to favorite it.')}</p>
            )}
          </div>
          {favoriteComponents.length > 0 && (
            <>
              <h3>{text('收藏组合', 'Favorite groups')}</h3>
              {favoriteComponents.map(component => (
                <div className='pv-chen-mine-row' key={component.id}>
                  <button type='button' className='pv-button' disabled={readOnly} onClick={() => onAdd({ group: component })}>{component.name}</button>
                  <button type='button' className='pv-icon-btn' aria-label={text('移出收藏 ' + component.name, 'Remove favorite ' + component.name)} onClick={() => onRemoveComponent(component.id)}>×</button>
                </div>
              ))}
            </>
          )}
          <h3>{t('myShapes')}</h3>
          {customShapes.map(s => (
            <div className='pv-chen-mine-row' key={s.id}>
              <button type='button' className='pv-button' disabled={readOnly} onClick={() => onAdd({ group: s })}>{s.name}</button>
            </div>
          ))}
          {!customShapes.length && (
            <p className='pv-note'>{text('此项目尚无组件；在画布中选中图形后可保存为项目组件。', 'No project components yet. Select shapes on a canvas to save one.')}</p>
          )}
        </section>
      )}

      {/* V5-R3 Result 2: layers entry at the library bottom (显隐/锁定/排序 live
          in the same drawer the menus open). */}
      <div className='pv-chen-lib-bottom'>
        <button type='button' className='pv-chen-lib-layers' onClick={onLayers} aria-label={text('图层', 'Layers')} title={text('图层：显隐、锁定、排序', 'Layers: visibility, lock, order')}>
          <IconLayers size={14}/>{text('图层', 'Layers')}
        </button>
      </div>

      {/* Single footer hint */}
      <div className='libraryfoot'>
        <p>{text('拖到画布以添加图形', 'Drag to canvas to add shapes')}</p>
        <p><span className='lib-foot-key'>{text('空格', 'Space')}</span>{text(' 平移画布 · 右键管理收藏', ' pan canvas · right click to favorite')}</p>
      </div>

      {/* Lightweight tooltip: name + one-line description. Card tips stay visible
          while the look popover is open, layered above it (z 300 > popover 200). */}
      {tip && !menu && (
        <OverlayPortal>
          <div
            className='er-tooltip lighttip js-tip'
            style={{position: 'fixed', left: tip.left, top: tip.top, pointerEvents: 'none', zIndex: tip.z || 100}}
          >
            <strong>{tip.name}</strong>
            {tip.desc && <small>{tip.desc}</small>}
          </div>
        </OverlayPortal>
      )}

      {/* Context Menu */}
      {menu && (
        <OverlayPortal onClose={closeMenu}>
          <div
            className='pv-menu-backdrop'
            onClick={() => closeMenu(false)}
            onContextMenu={e => {
              e.preventDefault();
              closeMenu(false);
            }}
          />
          <div
            className='pv-chen-context er-context popover'
            role='menu'
            ref={menuRef}
            style={{position: 'fixed', left: menu.x, top: menu.y, zIndex: 200, minWidth: 190}}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeMenu(true);
              } else if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
                e.preventDefault();
                const items = Array.from(menuRef.current.querySelectorAll('button'));
                const index = items.indexOf(document.activeElement);
                items[(index + (e.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length].focus();
              }
            }}
          >
            <strong className='pv-ctx-title'>{titleOf(menu.shape)}</strong>
            {kindDesc(menu.shape) && <small className='pv-ctx-desc'>{kindDesc(menu.shape)}</small>}
            <div className='pv-menu-divider' />
            <button type='button' role='menuitem' onClick={() => {onAdd(menu.shape);closeMenu(true);}}>
              {text('插入到画布', 'Insert to canvas')}
            </button>
            <button type='button' role='menuitem' onClick={() => {onFavorite(menu.shape.id);closeMenu(true);}}>
              {favorites.includes(menu.shape.id) ? text('移出我的图形', 'Remove from my shapes') : text('加入我的图形', 'Add to my shapes')}
            </button>
          </div>
        </OverlayPortal>
      )}
    </div>
  );
};
