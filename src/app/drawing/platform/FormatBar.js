import React, { useRef, useState } from 'react';
import { en } from './common';
import { CLASS_TEXT_ATTRS, relayoutClassNode } from './ClassMembers';
import { OverlayPortal, calculateClampedPosition } from './DrawingOverlayHost';
import { IconUndo, IconRedo, IconPointer, IconHand, IconLink, IconMore,
  IconAlignLeft, IconAlignCenter, IconAlignRight, IconCheck } from './icons';

// CHEN-UI-008: shared color popover — theme swatches, common colors, HEX and
// opacity in one panel; replaces the native color input for Chen pages.
const COMMON_COLORS = ['#252B3C', '#5265D9', '#71798D', '#E7EAF1', '#258170', '#A46524', '#7854BE', '#3566AF',
  '#63A6E8', '#8FC9B0', '#F2C078', '#F2A2A2', '#2C4470', '#EDF0FF', '#FAEEDE', '#FFFFFF'];
const CHEN_THEME_COLORS = {
  default: ['#ffffff', '#3566af', '#eef2f8', '#64748b', '#f4f6fa', '#8ea2c4', '#ffffff', '#3566af'],
  fresh: ['#e5f0fb', '#3566af', '#eee6fa', '#7854be', '#faeede', '#a46524', '#e6f2f0', '#2f7d78'],
  dopamine: ['#fdeae6', '#b0552f', '#fdf3cf', '#8a6116', '#e5f7e8', '#257a45', '#e3eefb', '#3566af'],
  dusk: ['#e4e9f2', '#2c4470', '#e3def0', '#5b4a86', '#e2ebe4', '#3f6b52', '#efece6', '#7a7265'],
};

const ColorPopover = ({title, value, onChange, onOpacity, opacity, allowNone, readOnly, onClose, anchor, theme}) => {  const text = (a, b) => en() ? b : a;
  const [hex, setHex] = useState(/^#[0-9a-f]{6}$/i.test(value) ? value : '');
  const themeColors = CHEN_THEME_COLORS[theme] || CHEN_THEME_COLORS.default;
  const commitHex = () => {
    const raw = hex.trim();
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) onChange(raw.length === 4 ? `#${raw.slice(1).split('').map(c => c + c).join('')}` : raw);
    else setHex(/^#[0-9a-f]{6}$/i.test(value) ? value : '');
  };
  return <OverlayPortal onClose={onClose}>
    <div className='pv-menu-backdrop' onMouseDown={onClose} />
    <div className='pv-color-popover' role='dialog' aria-label={title}
      style={calculateClampedPosition({anchorRect: anchor, overlayWidth: 244, overlayHeight: 320, placement: 'bottom-start'})}>
      <header><strong>{title}</strong><button type='button' aria-label={text('关闭', 'Close')} onClick={onClose}>×</button></header>
      <section>
        <label>{text('当前主题', 'Theme colors')}</label>
        <div className='pv-swatch-grid'>
          {themeColors.map(c => <button key={c} type='button' disabled={readOnly} aria-label={c}
            className={value?.toLowerCase() === c ? 'current' : ''} style={{background: c}} onClick={() => onChange(c)}>{value?.toLowerCase() === c && <IconCheck size={11} />}</button>)}
        </div>
      </section>
      <section>
        <label>{text('常用颜色', 'Common colors')}</label>
        <div className='pv-swatch-grid'>
          {COMMON_COLORS.map(c => <button key={c} type='button' disabled={readOnly} aria-label={c}
            className={value?.toLowerCase() === c ? 'current' : ''} style={{background: c}} onClick={() => onChange(c)}>{value?.toLowerCase() === c && <IconCheck size={11} />}</button>)}
        </div>
      </section>
      <div className='pv-color-fields'>
        <label className='pv-hex-field'>HEX
          <input value={hex} disabled={readOnly} aria-label='HEX' onChange={e => setHex(e.target.value)} onBlur={commitHex} onKeyDown={e => {if (e.key === 'Enter') {e.preventDefault();commitHex();} if (e.key === 'Escape') {e.preventDefault();onClose();}}}/>
        </label>
        {onOpacity && <label className='pv-opacity-field'>{text('不透明度', 'Opacity')}
          <input type='range' min='0' max='100' step='5' disabled={readOnly} aria-label={text('不透明度', 'Opacity')}
            value={Math.round((opacity == null ? 1 : opacity) * 100)} onChange={e => onOpacity(Number(e.target.value) / 100)}/>
          <span>{Math.round((opacity == null ? 1 : opacity) * 100)}%</span>
        </label>}
      </div>
      {allowNone && <div className='pv-none-row'>
        <button type='button' className={`pv-none-btn${value === 'transparent' || value === 'none' ? ' current' : ''}`} disabled={readOnly}
          onClick={() => onChange('transparent')}><span className='pv-checker'/>{text('透明填充', 'No fill')}</button>
      </div>}
    </div>
  </OverlayPortal>;
};

export default ({selection, mutate, readOnly, onDefault, defaults, textOnly, scopeLabel, kindLabel, onRanges, connectionMode, onConnectionMode, chen, tools, theme}) => {
  const nodes = selection.filter(v => v.isNode());
  const node = nodes[0];
  const edgeOnly = selection.length > 0 && !nodes.length;
  readOnly = readOnly || edgeOnly;
  const text = (a, b) => en() ? b : a;

  const [fontSizeInput, setFontSizeInput] = useState(null);
  const [strokeWidthInput, setStrokeWidthInput] = useState(null);
  const [colorPanel, setColorPanel] = useState(null); // {kind, anchor}
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const [lineHeightInput, setLineHeightInput] = useState(null);

  const set = (key, value) => {
    if (nodes.length) mutate(() => nodes.forEach(n => {
      n.attr(key, value);
      const attr = key.split('/')[1];
      if (key.startsWith('label/') && n.shape === 'pv-class' && CLASS_TEXT_ATTRS.includes(attr)) {
        ['fields', 'methods'].forEach(s => n.attr(`${s}/${attr}`, value));
        relayoutClassNode(n);
      }
      if (key === 'label/textAnchor') {
        n.attr('label/refX', value === 'start' ? 12 : value === 'end' ? '100%' : '50%');
        n.attr('label/refX2', value === 'end' ? -12 : 0);
      }
      // Vertical alignment needs the ref pair too: X6's textVerticalAnchor only
      // picks which edge of the text block lands on the element's y (a dy on the
      // first tspan) — the y itself still comes from refY/refY2. Without moving
      // refY off 50%, top/bottom were just offsets around the shape center.
      if (key === 'label/textVerticalAnchor') {
        n.attr('label/refY', value === 'top' ? '0%' : value === 'bottom' ? '100%' : '50%');
        n.attr('label/refY2', value === 'top' ? 6 : value === 'bottom' ? -6 : 0);
      }
    }));
    else {
      // New-shape defaults carry the same ref pair (onDefault accumulates via
      // functional setState, so the three writes all land).
      if (key === 'label/textVerticalAnchor') {
        onDefault('label/refY', value === 'top' ? '0%' : value === 'bottom' ? '100%' : '50%');
        onDefault('label/refY2', value === 'top' ? 6 : value === 'bottom' ? -6 : 0);
      }
      onDefault(key, value);
    }
  };

  const get = (key, fallback) => node?.attr(key) || defaults[key] || fallback;
  // UAT-009 mixed multi-select: a control only shows a value when every selected
  // node agrees on it; a mixed state renders neutral (empty/placeholder) instead
  // of silently displaying the first node's value.
  // Explicit null/undefined checks (no nullish coalescing): this project's
  // babel chain leaves that operator untransformed for its browser targets and
  // webpack4 cannot parse it; 0/'' are meaningful values here — only
  // null/undefined fall through.
  const shared = (key, fallback) => {
    if (nodes.length <= 1) return get(key, fallback);
    const vals = [...new Set(nodes.map(n => n.attr(key)))];
    if (vals.length !== 1) return undefined;
    return vals[0] != null ? vals[0] : defaults[key] != null ? defaults[key] : fallback;
  };
  const mixedColor = '#8a93a6';
  const fillShared = shared('body/fill', '#ffffff');
  const strokeShared = shared('body/stroke', '#3566af');
  const textColor = (() => {const v = shared('label/fill', '#303746');return /^#[0-9a-f]{6}$/i.test(v || '') ? v : v == null ? mixedColor : '#303746';})();
  const fillColor = fillShared == null ? mixedColor : fillShared;
  const strokeColor = strokeShared == null ? mixedColor : strokeShared;
  const isTransparent = v => v === 'transparent' || v === 'none';

  const handleFontSizeCommit = val => {
    const parsed = parseInt(val, 10);
    if (val.trim() === '') { setFontSizeInput(null); return; }
    const valid = !isNaN(parsed) ? Math.max(8, Math.min(96, parsed)) : null;
    if (valid == null) { setFontSizeInput(null); return; }
    set('label/fontSize', valid);
    setFontSizeInput(null);
  };

  const handleStrokeWidthCommit = val => {
    if (val.trim() === '') { setStrokeWidthInput(null); return; }
    const parsed = parseFloat(val);
    if (isNaN(parsed)) { setStrokeWidthInput(null); return; }
    set('body/strokeWidth', Math.max(0.5, Math.min(10, +(parsed.toFixed(1)))));
    setStrokeWidthInput(null);
  };

  const handleLineHeightCommit = val => {
    if (val.trim() === '') { setLineHeightInput(null); return; }
    const parsed = parseFloat(val);
    if (isNaN(parsed)) { setLineHeightInput(null); return; }
    set('label/lineHeight', `${Math.max(1, Math.min(3, parsed))}em`);
    setLineHeightInput(null);
  };

  const [letterSpacingInput, setLetterSpacingInput] = useState(null);
  const handleLetterSpacingCommit = val => {
    if (val.trim() === '') { setLetterSpacingInput(null); return; }
    const parsed = parseFloat(val);
    if (isNaN(parsed)) { setLetterSpacingInput(null); return; }
    set('label/letterSpacing', Math.max(-2, Math.min(12, +(parsed.toFixed(1)))));
    setLetterSpacingInput(null);
  };

  // Line style: Chen semantic outlines (strong/weak double lines, identifying
  // diamonds, dashed derived ellipses, key underlines) are protected — the
  // control is disabled with an explanation when only Chen symbols are selected;
  // auxiliary shapes edit their dash pattern normally.
  const chenSelected = nodes.filter(n => n.getData()?.chen);
  const auxSelected = nodes.filter(n => !n.getData()?.chen);
  const lineStyleLocked = Boolean(chenSelected.length) && !auxSelected.length;
  const lineStyleHint = text('陈氏图形的实线/双线/虚线/下划线表达语义类型，不可更改；辅助图形可编辑线型。', 'Chen outlines encode semantic types (solid/double/dashed/underline) and stay protected; auxiliary shapes can edit line style.');
  const linePattern = (() => {
    const read = auxSelected.length ? auxSelected : nodes;
    if (!read.length) return defaults['body/strokeDasharray'] ? 'dashed' : 'solid';
    const vals = [...new Set(read.map(n => (n.attr('body/strokeDasharray') || '') ? 'dashed' : 'solid'))];
    return vals.length === 1 ? vals[0] : '';
  })();
  const setLinePattern = v => {
    if (auxSelected.length) mutate(() => auxSelected.forEach(n => n.attr('body/strokeDasharray', v === 'dashed' ? '5 4' : '')));
    else if (!nodes.length) onDefault('body/strokeDasharray', v === 'dashed' ? '5 4' : '');
  };

  const openColor = (kind, e) => setColorPanel({kind, anchor: e.currentTarget.getBoundingClientRect()});
  const colorProps = kind => ({
    value: kind === 'text' ? textColor : kind === 'fill' ? fillColor : strokeColor,
    onChange: v => { set(kind === 'text' ? 'label/fill' : kind === 'fill' ? 'body/fill' : 'body/stroke', v); setColorPanel(null); },
    onOpacity: kind === 'text' ? null : v => set('body/opacity', v),
    opacity: node?.attr('body/opacity') == null ? 1 : node.attr('body/opacity'),
    allowNone: kind === 'fill',
    readOnly,
    onClose: () => setColorPanel(null),
    theme,
  });

  // ===== Chen compact format bar (CHEN-UI-008, PNG 05) =====
  if (chen) {
    const scopeText = edgeOnly
      ? text('连线样式见属性栏', 'Connection style: inspector')
      : scopeLabel || (nodes.length ? text(`选中 ${nodes.length} 项`, `${nodes.length} selected`) : text('新图形默认', 'New shape defaults'));
    return <div className='pv-formatbar pv-chen-formatbar' role='toolbar' aria-label={text('格式', 'Formatting')}>
      {tools && <>
        <div className='pv-format-group pv-group-tools'>
          <button type='button' className='pv-tool-btn' disabled={!tools.canUndo} title={text('撤销', 'Undo')} aria-label={text('撤销', 'Undo')} onClick={tools.undo}><IconUndo/></button>
          <button type='button' className='pv-tool-btn' disabled={!tools.canRedo} title={text('重做', 'Redo')} aria-label={text('重做', 'Redo')} onClick={tools.redo}><IconRedo/></button>
        </div>
        <div className='pv-format-group pv-group-tools pv-tool-seg'>
          <button type='button' className={`pv-tool-btn${tools.tool === 'select' ? ' active' : ''}`} title={text('选择', 'Select')} aria-pressed={tools.tool === 'select'} aria-label={text('选择工具', 'Select tool')} onClick={() => tools.setTool('select')}><IconPointer/></button>
          <button type='button' className={`pv-tool-btn${tools.tool === 'hand' ? ' active' : ''}`} title={text('手形（平移）', 'Hand (pan)')} aria-pressed={tools.tool === 'hand'} aria-label={text('手形工具', 'Hand tool')} onClick={() => tools.setTool('hand')}><IconHand/></button>
          <button type='button' className={`pv-tool-btn${connectionMode === 'auxiliary' ? ' active' : ''}`} title={text('辅助连线模式', 'Auxiliary connection mode')} aria-pressed={connectionMode === 'auxiliary'} aria-label={text('辅助连线', 'Auxiliary connection')} onClick={() => onConnectionMode?.(connectionMode === 'auxiliary' ? 'semantic' : 'auxiliary')}><IconLink/></button>
        </div>
        <div className='pv-format-divider'/>
      </>}
      {kindLabel && <span className='pv-kind-chip' title={kindLabel.full || kindLabel.text}>{kindLabel.text}</span>}
      <div className='pv-format-group pv-group-font'>
        <select
          className='pv-font-select'
          aria-label={text('字体', 'Font family')}
          disabled={readOnly}
          value={shared('label/fontFamily', '-apple-system, PingFang SC, sans-serif')}
          onChange={e => set('label/fontFamily', e.target.value)}
        >
          <option value='' hidden>{text('混合', 'Mixed')}</option>
          {[
            ['-apple-system, PingFang SC, sans-serif', text('系统字体', 'System')],
            ['Arial, sans-serif', 'Arial'],
            ['Georgia, serif', 'Georgia'],
            ['Menlo, monospace', 'Menlo']
          ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input
          type='text' inputMode='numeric'
          className='pv-compact-input pv-size-input'
          aria-label={text('字号', 'Font size')}
          title={text('字号（8–96，回车确认）', 'Font size (8–96, Enter to apply)')}
          placeholder={text('混合', 'Mixed')}
          disabled={readOnly}
          value={fontSizeInput !== null ? fontSizeInput : shared('label/fontSize', 14) == null ? '' : shared('label/fontSize', 14)}
          onChange={e => setFontSizeInput(e.target.value)}
          onBlur={e => handleFontSizeCommit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); handleFontSizeCommit(e.target.value); }
            else if (e.key === 'Escape') { e.preventDefault(); setFontSizeInput(null); e.currentTarget.blur(); }
          }}
        />
      </div>
      <div className='pv-format-divider'/>
      <div className='pv-format-group pv-group-segmented'>
        {[
          ['B', 'label/fontWeight', 700, 400, text('加粗', 'Bold')],
          ['I', 'label/fontStyle', 'italic', 'normal', text('斜体', 'Italic')],
          ['U', 'label/textDecoration', 'underline', 'none', text('下划线', 'Underline')],
        ].map(([label, key, a, b, title]) => (
          <button
            type='button'
            key={label}
            className={`pv-btn-toggle${shared(key, b) === a ? ' active' : ''}`}
            disabled={readOnly}
            title={title}
            aria-pressed={shared(key, b) === a}
            onMouseDown={e => e.preventDefault()}
            onClick={() => set(key, shared(key, b) === a ? b : a)}
          >{label}</button>
        ))}
        <button type='button' className={`pv-btn-toggle pv-text-color-btn${colorPanel?.kind === 'text' ? ' active' : ''}`} disabled={readOnly}
          title={text('文字颜色', 'Text color')} aria-label={text('文字颜色', 'Text color')} aria-haspopup='dialog'
          onMouseDown={e => e.preventDefault()} onClick={e => openColor('text', e)}>
          <span className='pv-color-text-icon' style={{color: textColor}}>A</span>
          <span className='pv-color-swatch-bar' style={{background: textColor}}/>
        </button>
      </div>
      {!textOnly && <>
        <div className='pv-format-divider'/>
        <div className='pv-format-group pv-group-colors'>
          <button type='button' className={`pv-color-pill${colorPanel?.kind === 'fill' ? ' active' : ''}`} disabled={readOnly}
            title={text('填充颜色', 'Fill color')} aria-label={text('填充颜色', 'Fill color')} aria-haspopup='dialog'
            onMouseDown={e => e.preventDefault()} onClick={e => openColor('fill', e)}>
            <span className={`pv-color-dot${isTransparent(fillColor) ? ' pv-checker-bg' : ''}`} style={isTransparent(fillColor) ? undefined : {background: fillColor}}/>
            <span className='pv-color-tag'>{text('填充', 'Fill')}</span>
          </button>
          <button type='button' className={`pv-color-pill${colorPanel?.kind === 'stroke' ? ' active' : ''}`} disabled={readOnly}
            title={text('边框颜色', 'Stroke color')} aria-label={text('边框颜色', 'Stroke color')} aria-haspopup='dialog'
            onMouseDown={e => e.preventDefault()} onClick={e => openColor('stroke', e)}>
            <span className='pv-color-dot' style={{background: strokeColor}}/>
            <span className='pv-color-tag'>{text('边框', 'Stroke')}</span>
          </button>
          <input
            type='text' inputMode='decimal'
            className='pv-compact-input pv-width-input'
            aria-label={text('线宽', 'Stroke width')}
            title={text('线宽（0.5–10，回车确认）', 'Stroke width (0.5–10, Enter to apply)')}
            placeholder={text('混合', 'Mixed')}
            disabled={readOnly}
            value={strokeWidthInput !== null ? strokeWidthInput : shared('body/strokeWidth', 1.5) == null ? '' : shared('body/strokeWidth', 1.5)}
            onChange={e => setStrokeWidthInput(e.target.value)}
            onBlur={e => handleStrokeWidthCommit(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleStrokeWidthCommit(e.target.value); }
              else if (e.key === 'Escape') { e.preventDefault(); setStrokeWidthInput(null); e.currentTarget.blur(); }
            }}
          />
        </div>
      </>}
      <div className='pv-format-divider'/>
      <div className='pv-format-group pv-group-align'>
        <div className='pv-group-segmented pv-align-seg' role='radiogroup' aria-label={text('文字对齐方式', 'Alignment')}>
          {[
            ['start', text('左对齐', 'Left'), <IconAlignLeft key='l' size={13}/>],
            ['middle', text('居中', 'Center'), <IconAlignCenter key='c' size={13}/>],
            ['end', text('右对齐', 'Right'), <IconAlignRight key='r' size={13}/>],
          ].map(([val, label, icon]) => (
            <button type='button' key={val} className={`pv-btn-toggle${shared('label/textAnchor', 'middle') === val ? ' active' : ''}`}
              disabled={readOnly} title={label} aria-checked={shared('label/textAnchor', 'middle') === val}
              onMouseDown={e => e.preventDefault()} onClick={() => set('label/textAnchor', val)}>{icon}</button>
          ))}
        </div>
      </div>
      <div className='pv-format-group pv-group-end'>
        <div className='pv-more-anchor' ref={moreRef}>
          <button type='button' className={`pv-tool-btn pv-typo-btn${moreOpen ? ' active' : ''}`} disabled={readOnly}
            title={text('排版：对齐、行高、字距、删除线、线型', 'Typography: alignment, line height, spacing, strikethrough, line style')}
            aria-label={text('排版', 'Typography')} aria-haspopup='menu' aria-expanded={moreOpen}
            onClick={() => setMoreOpen(v => !v)}><IconMore/><span className='pv-typo-label'>{text('排版', 'Type')}</span></button>
          {moreOpen && <OverlayPortal onClose={() => setMoreOpen(false)}>
            <div className='pv-menu-backdrop' onMouseDown={() => setMoreOpen(false)}/>
            <div className='pv-more-menu' role='menu'
              style={calculateClampedPosition({anchorRect: moreRef.current?.getBoundingClientRect(), overlayWidth: 236, overlayHeight: 348, placement: 'bottom-start'})}>
              <label className='pv-more-row pv-row-font'>{text('字体', 'Font family')}
                <select
                  className='pv-font-select'
                  aria-label={text('字体', 'Font family')}
                  disabled={readOnly}
                  value={shared('label/fontFamily', '-apple-system, PingFang SC, sans-serif')}
                  onChange={e => set('label/fontFamily', e.target.value)}
                >
                  <option value='' hidden>{text('混合', 'Mixed')}</option>
                  {[
                    ['-apple-system, PingFang SC, sans-serif', text('系统字体', 'System')],
                    ['Arial, sans-serif', 'Arial'],
                    ['Georgia, serif', 'Georgia'],
                    ['Menlo, monospace', 'Menlo']
                  ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className='pv-more-row pv-row-align'>{text('水平对齐', 'Horizontal')}
                <span className='pv-align-seg' role='radiogroup' aria-label={text('文字对齐方式', 'Alignment')}>
                  {[
                    ['start', text('左对齐', 'Left'), <IconAlignLeft key='l' size={13}/>],
                    ['middle', text('居中', 'Center'), <IconAlignCenter key='c' size={13}/>],
                    ['end', text('右对齐', 'Right'), <IconAlignRight key='r' size={13}/>],
                  ].map(([val, label, icon]) => (
                    <button type='button' key={val} className={`pv-btn-toggle${shared('label/textAnchor', 'middle') === val ? ' active' : ''}`}
                      disabled={readOnly} title={label} aria-checked={shared('label/textAnchor', 'middle') === val}
                      onMouseDown={e => e.preventDefault()} onClick={() => set('label/textAnchor', val)}>{icon}</button>
                  ))}
                </span>
              </label>
              <label className='pv-more-row pv-row-valign'>{text('垂直对齐', 'Vertical')}
                <span className='pv-align-seg' role='radiogroup' aria-label={text('垂直对齐', 'Vertical alignment')}>
                  {[['top', text('顶部', 'Top'), text('顶', 'T')], ['middle', text('居中', 'Middle'), text('中', 'M')], ['bottom', text('底部', 'Bottom'), text('底', 'B')]].map(([val, title, glyph]) => (
                    <button type='button' key={val} className={`pv-btn-toggle${shared('label/textVerticalAnchor', 'middle') === val ? ' active' : ''}`}
                      disabled={readOnly} title={title} aria-checked={shared('label/textVerticalAnchor', 'middle') === val}
                      onMouseDown={e => e.preventDefault()} onClick={() => set('label/textVerticalAnchor', val)}>{glyph}</button>
                  ))}
                </span>
              </label>
              <label className='pv-more-row'>{text('删除线', 'Strikethrough')}
                <button type='button' role='menuitemcheckbox' aria-checked={shared('label/textDecoration') === 'line-through'}
                  className={`pv-btn-toggle${shared('label/textDecoration') === 'line-through' ? ' active' : ''}`} disabled={readOnly}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => set('label/textDecoration', shared('label/textDecoration') === 'line-through' ? 'none' : 'line-through')}>S</button>
              </label>
              <label className='pv-more-row'>{text('行高', 'Line height')}
                <input type='text' inputMode='decimal' className='pv-compact-input' disabled={readOnly}
                  aria-label={text('行高', 'Line height')} placeholder={text('混合', 'Mixed')}
                  value={lineHeightInput !== null ? lineHeightInput : shared('label/lineHeight', 1.2) != null ? (parseFloat(shared('label/lineHeight', 1.2)) || 1.2) : ''}
                  onChange={e => setLineHeightInput(e.target.value)}
                  onBlur={e => handleLineHeightCommit(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLineHeightCommit(e.target.value); } if (e.key === 'Escape') { e.preventDefault(); setLineHeightInput(null); } }}/>
              </label>
              <label className='pv-more-row'>{text('字距', 'Letter spacing')}
                <input type='text' inputMode='decimal' className='pv-compact-input' disabled={readOnly}
                  aria-label={text('字距', 'Letter spacing')} placeholder={text('混合', 'Mixed')}
                  value={letterSpacingInput !== null ? letterSpacingInput : shared('label/letterSpacing', 0) != null ? (parseFloat(shared('label/letterSpacing', 0)) || 0) : ''}
                  onChange={e => setLetterSpacingInput(e.target.value)}
                  onBlur={e => handleLetterSpacingCommit(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLetterSpacingCommit(e.target.value); } if (e.key === 'Escape') { e.preventDefault(); setLetterSpacingInput(null); } }}/>
              </label>
              <label className='pv-more-row pv-row-line' title={lineStyleLocked ? lineStyleHint : undefined}>{text('线型', 'Line style')}
                <select aria-label={text('线型', 'Line style')} title={lineStyleLocked ? lineStyleHint : undefined}
                  disabled={readOnly || lineStyleLocked} value={linePattern}
                  onChange={e => setLinePattern(e.target.value)}>
                  <option value='' hidden>{text('混合', 'Mixed')}</option>
                  <option value='solid'>{text('实线', 'Solid')}</option>
                  <option value='dashed'>{text('虚线', 'Dashed')}</option>
                </select>
              </label>
              {lineStyleLocked && <p className='pv-more-note'>{lineStyleHint}</p>}
              {onRanges && <button type='button' role='menuitem' className='pv-more-action' disabled={readOnly || nodes.length !== 1} onClick={() => {setMoreOpen(false);onRanges();}}>{text('局部文字格式…', 'Text ranges…')}</button>}
            </div>
          </OverlayPortal>}
        </div>
        <span className='pv-format-scope'>{scopeText}</span>
      </div>
      {colorPanel && <ColorPopover
        title={colorPanel.kind === 'text' ? text('文字颜色', 'Text color') : colorPanel.kind === 'fill' ? text('填充', 'Fill') : text('边框', 'Stroke')}
        anchor={colorPanel.anchor} {...colorProps(colorPanel.kind)}/>}
    </div>;
  }

  // ===== Legacy bar for non-Chen canvases (unchanged behavior) =====
  return <div className='pv-formatbar' role='toolbar' title={edgeOnly ? text('连线样式请在右侧属性栏设置。', 'Edit connection styling in the inspector.') : undefined} aria-label={text('通用格式', 'Formatting')}>
    <div className='pv-format-group pv-group-font'>
      <select
        className='pv-font-select'
        aria-label={text('字体', 'Font family')}
        disabled={readOnly}
        value={get('label/fontFamily', '-apple-system, PingFang SC, sans-serif')}
        onChange={e => set('label/fontFamily', e.target.value)}
      >
        {[
          ['-apple-system, PingFang SC, sans-serif', text('系统字体', 'System')],
          ['Arial, sans-serif', 'Arial'],
          ['Georgia, serif', 'Georgia'],
          ['Menlo, monospace', 'Menlo']
        ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>

      <div className='pv-number-pill' title={text('字号', 'Font size')}>
        <button
          type='button'
          className='pv-step-btn'
          disabled={readOnly}
          onMouseDown={e => e.preventDefault()}
          onClick={() => {
            const current = Number(get('label/fontSize', 14));
            set('label/fontSize', Math.max(8, current - 1));
            setFontSizeInput(null);
          }}
          title={text('缩小字号', 'Decrease font size')}
        >−</button>
        <input
          type='number'
          aria-label={text('字号', 'Font size')}
          min='8'
          max='96'
          value={fontSizeInput !== null ? fontSizeInput : get('label/fontSize', 14)}
          disabled={readOnly}
          onChange={e => setFontSizeInput(e.target.value)}
          onBlur={e => handleFontSizeCommit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleFontSizeCommit(e.target.value);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setFontSizeInput(null);
            }
          }}
        />
        <button
          type='button'
          className='pv-step-btn'
          disabled={readOnly}
          onMouseDown={e => e.preventDefault()}
          onClick={() => {
            const current = Number(get('label/fontSize', 14));
            set('label/fontSize', Math.min(96, current + 1));
            setFontSizeInput(null);
          }}
          title={text('放大字号', 'Increase font size')}
        >＋</button>
        <span className='pv-unit'>px</span>
      </div>
    </div>

    <div className='pv-format-divider' />

    <div className='pv-format-group pv-group-segmented'>
      {[
        ['B', 'label/fontWeight', 700, 400, text('加粗', 'Bold')],
        ['I', 'label/fontStyle', 'italic', 'normal', text('斜体', 'Italic')],
        ['U', 'label/textDecoration', 'underline', 'none', text('下划线', 'Underline')],
        ['S', 'label/textDecoration', 'line-through', 'none', text('删除线', 'Strikethrough')]
      ].map(([label, key, a, b, title]) => (
        <button
          type='button'
          key={label}
          className={`pv-btn-toggle${get(key, b) === a ? ' active' : ''}`}
          disabled={readOnly}
          title={title}
          aria-pressed={get(key, b) === a}
          onMouseDown={e => e.preventDefault()}
          onClick={() => set(key, get(key, b) === a ? b : a)}
        >
          {label}
        </button>
      ))}
    </div>

    <div className='pv-format-divider' />

    <div className='pv-format-group pv-group-colors'>
      <label className='pv-color-pill' title={text('文字颜色', 'Text color')}>
        <span className='pv-color-text-icon' style={{color: textColor}}>A</span>
        <span className='pv-color-swatch-bar' style={{background: textColor}} />
        <input
          type='color'
          aria-label={text('文字颜色', 'Text color')}
          disabled={readOnly}
          value={textColor}
          onChange={e => set('label/fill', e.target.value)}
        />
      </label>

      {!textOnly && <>
        <label className='pv-color-pill' title={text('填充颜色', 'Fill color')}>
          <span className='pv-color-tag'>{text('填充', 'Fill')}</span>
          <span className='pv-color-dot' style={{background: fillColor}} />
          <input
            type='color'
            aria-label={text('填充', 'Fill')}
            disabled={readOnly}
            value={/^#[0-9a-f]{6}$/i.test(fillColor) ? fillColor : '#ffffff'}
            onChange={e => set('body/fill', e.target.value)}
          />
        </label>

        <label className='pv-color-pill' title={text('线条颜色', 'Stroke color')}>
          <span className='pv-color-tag'>{text('线条', 'Stroke')}</span>
          <span className='pv-color-dot' style={{background: strokeColor}} />
          <input
            type='color'
            aria-label={text('线条', 'Stroke')}
            disabled={readOnly}
            value={strokeColor}
            onChange={e => set('body/stroke', e.target.value)}
          />
        </label>

        <div className='pv-number-pill' title={text('边框粗细', 'Stroke width')}>
          <button
            type='button'
            className='pv-step-btn'
            disabled={readOnly}
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              const current = Number(get('body/strokeWidth', 1.5));
              set('body/strokeWidth', Math.max(0.5, +(current - 0.5).toFixed(1)));
              setStrokeWidthInput(null);
            }}
            title={text('减细线条', 'Decrease stroke width')}
          >−</button>
          <input
            type='number'
            aria-label={text('线宽', 'Stroke width')}
            disabled={readOnly}
            min='.5'
            max='10'
            step='.5'
            value={strokeWidthInput !== null ? strokeWidthInput : get('body/strokeWidth', 1.5)}
            onChange={e => setStrokeWidthInput(e.target.value)}
            onBlur={e => handleStrokeWidthCommit(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleStrokeWidthCommit(e.target.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setStrokeWidthInput(null);
              }
            }}
          />
          <button
            type='button'
            className='pv-step-btn'
            disabled={readOnly}
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              const current = Number(get('body/strokeWidth', 1.5));
              set('body/strokeWidth', Math.min(10, +(current + 0.5).toFixed(1)));
              setStrokeWidthInput(null);
            }}
            title={text('加粗线条', 'Increase stroke width')}
          >＋</button>
          <span className='pv-unit'>w</span>
        </div>
      </>}
    </div>

    <div className='pv-format-divider' />

    <div className='pv-format-group pv-group-align'>
      <div className='pv-group-segmented' role='radiogroup' aria-label={text('文字对齐方式', 'Alignment')}>
        {[
          ['start', text('左对齐', 'Left'), '⇤'],
          ['middle', text('居中', 'Center'), '≡'],
          ['end', text('右对齐', 'Right'), '⇥']
        ].map(([val, label, icon]) => (
          <button
            type='button'
            key={val}
            className={`pv-btn-toggle${get('label/textAnchor', 'middle') === val ? ' active' : ''}`}
            disabled={readOnly}
            title={label}
            aria-checked={get('label/textAnchor', 'middle') === val}
            onMouseDown={e => e.preventDefault()}
            onClick={() => set('label/textAnchor', val)}
          >
            {icon}
          </button>
        ))}
      </div>

      <select
        className='pv-align-select'
        aria-label={text('文字对齐', 'Text alignment')}
        disabled={readOnly}
        style={{position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none'}}
        value={get('label/textAnchor', 'middle')}
        onChange={e => set('label/textAnchor', e.target.value)}
      >
        <option value='start'>{text('左对齐', 'Left')}</option>
        <option value='middle'>{text('居中', 'Center')}</option>
        <option value='end'>{text('右对齐', 'Right')}</option>
      </select>

      <div className='pv-number-pill' title={text('行距倍数', 'Line height')}>
        <button
          type='button'
          className='pv-step-btn'
          disabled={readOnly}
          onClick={() => set('label/lineHeight', `${Math.max(1, +(parseFloat(get('label/lineHeight', 1.2)) - 0.1).toFixed(1))}em`)}
          title={text('减小行距', 'Decrease line height')}
        >−</button>
        <input
          type='number'
          aria-label={text('行距', 'Line height')}
          min='1'
          max='3'
          step='.1'
          disabled={readOnly}
          value={parseFloat(get('label/lineHeight', 1.2)) || 1.2}
          onChange={e => set('label/lineHeight', `${Math.max(1, Math.min(3, Number(e.target.value) || 1.2))}em`)}
        />
        <button
          type='button'
          className='pv-step-btn'
          disabled={readOnly}
          onClick={() => set('label/lineHeight', `${Math.min(3, +(parseFloat(get('label/lineHeight', 1.2)) + 0.1).toFixed(1))}em`)}
          title={text('增大行距', 'Increase line height')}
        >＋</button>
        <span className='pv-unit'>lh</span>
      </div>

      {connectionMode && (
        <select
          className='pv-conn-select'
          aria-label={text('连线模式', 'Connection mode')}
          value={connectionMode}
          disabled={readOnly}
          onChange={e => onConnectionMode(e.target.value)}
        >
          <option value='semantic'>{text('语义连线', 'Semantic connection')}</option>
          <option value='auxiliary'>{text('辅助连线', 'Auxiliary connection')}</option>
        </select>
      )}
    </div>

    <div className='pv-format-group pv-group-end'>
      {onRanges && (
        <button
          type='button'
          className='pv-ranges-btn'
          disabled={readOnly || nodes.length !== 1}
          onClick={onRanges}
        >
          {text('局部格式', 'Text ranges')}
        </button>
      )}

      <span className='pv-format-scope'>
        {edgeOnly
          ? text('连线样式见属性栏', 'Connection style: inspector')
          : scopeLabel || (nodes.length ? `${text('选中', 'Selected')} ${nodes.length}` : text('新图形默认样式', 'New shape defaults'))}
      </span>
    </div>
  </div>;
};

export { ColorPopover };
