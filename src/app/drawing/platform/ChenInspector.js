import React, { useEffect, useRef, useState } from 'react';
import { t, en } from './common';
import ShapeGlyph from './ShapeGlyph';
import ChenProperties from './ChenProperties';
import FormatBar, { ColorPopover } from './FormatBar';
import { IconAlignLeft, IconAlignCenter, IconAlignRight } from './icons';

// CHEN-UI-008 docked right inspector for Chen canvases (PNG 01/03): tabs
// 图形/文字, object header, 基本信息/外观/位置与尺寸 sections, semantics kept
// from ChenProperties. The panel is laid out in normal flow so it never floats
// over the canvas; the name field stays in sync with the canvas label because
// both write the same node attr through `mutate`.
const CHEN_KIND_LABEL = {
  entity: ['实体', 'Entity'], weak: ['弱实体', 'Weak entity'],
  relationship: ['联系', 'Relationship'], identifying: ['标识联系', 'Identifying relationship'],
  attribute: ['属性', 'Attribute'], composite: ['复合属性', 'Composite attribute'],
  multi: ['多值属性', 'Multivalued attribute'], derived: ['派生属性', 'Derived attribute'],
  key: ['键属性', 'Key attribute'], 'partial-key': ['部分键', 'Partial key'],
  rect: ['矩形', 'Rectangle'], rounded: ['圆角矩形', 'Rounded'], ellipse: ['椭圆', 'Ellipse'],
  text: ['文本', 'Text'], note: ['便笺', 'Note'], container: ['分组', 'Group'], image: ['图片', 'Image'],
};
export { CHEN_KIND_LABEL };
const hexOf = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback;

const ColorField = ({label, value, fallback, onChange, readOnly, theme}) => {
  const [panel, setPanel] = useState(null);
  const ref = useRef(null);
  const text = (a, b) => en() ? b : a;
  const safe = hexOf(value, fallback);
  return <div className='pv-insp-color'>
    <span className='pv-insp-label'>{label}</span>
    <button type='button' className='pv-insp-swatch-btn' disabled={readOnly} aria-label={`${label} ${text('选择颜色', 'pick color')}`} onClick={() => setPanel({anchor: ref.current.getBoundingClientRect()})} ref={ref}>
      <span className='pv-color-dot' style={{background: safe}}/>
      <code>{safe}</code>
    </button>
    {panel && <ColorPopover title={label} value={safe} theme={theme} readOnly={readOnly} allowNone={false}
      anchor={panel.anchor} onClose={() => setPanel(null)} onChange={v => {onChange(v);setPanel(null);}}/>}
  </div>;
};

const NumberField = ({label, value, min, max, step, unit, disabled, onCommit, title}) => {
  const [draft, setDraft] = useState(null);
  const text = (a, b) => en() ? b : a;
  const commit = raw => {
    if (draft === null) return;
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) onCommit(Math.max(min, Math.min(max, parsed)));
    setDraft(null);
  };
  return <label className='pv-insp-num' title={title}>
    <span className='pv-insp-label'>{label}</span>
    <span className='pv-insp-numbox'>
      <input type='text' inputMode='decimal' disabled={disabled} aria-label={label}
        value={draft !== null ? draft : value}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(e.target.value); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); e.currentTarget.blur(); }
        }}/>
      {unit && <small>{unit}</small>}
    </span>
  </label>;
};

export default ({node, edge, selection, chenPage, readOnly, mutate, onChenEdit, pageLayers, currentLook, editingId, onAlign, onDistribute, width, onClose, onRanges, defaults, onDefault}) => {
  const text = (a, b) => en() ? b : a;
  const data = node?.getData() || {};
  const chenData = data.chen ? data : null;
  const kind = chenData ? chenData.chenKind : data.kind;
  const kindLabel = CHEN_KIND_LABEL[kind] ? text(CHEN_KIND_LABEL[kind][0], CHEN_KIND_LABEL[kind][1]) : node ? text('图形', 'Shape') : '';
  const [tab, setTab] = useState('shape');
  const [look, setLook] = useState('frame');
  useEffect(() => { if (editingId) setTab('text'); }, [editingId]);

  const attr = (key, fallback) => {const v = node?.attr(key);return v == null ? fallback : v;};
  const setAttr = (key, value) => mutate(() => node.attr(key, value));
  const label = attr('label/text', '');

  return <aside className='pv-chen-inspector' style={width ? {width, boxSizing: 'border-box'} : undefined} aria-label={text('属性', 'Properties')}>
    <header className='pv-insp-tabs'>
      <div className='pv-insp-tabbar' role='tablist'>
        {[['shape', text('图形', 'Shape')], ['text', text('文字', 'Text')]].map(([key, l]) => (
          <button type='button' key={key} role='tab' aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{l}</button>
        ))}
      </div>
      {/* V5-R3: explicit close (Result 1 — 关闭后记住用户选择) */}
      {onClose && <button type='button' className='pv-insp-close' aria-label={text('关闭属性栏', 'Close inspector')} title={text('关闭属性栏', 'Close inspector')} onClick={onClose}>×</button>}
    </header>

    {!node && !edge && selection.length > 1 && <>
      <div className='pv-insp-head'>
        <strong>{text(`选中 ${selection.length} 项`, `${selection.length} selected`)}</strong>
        <small>{text('批量对齐与分布', 'Align & distribute')}</small>
      </div>
      <section className='pv-insp-section'>
        <h4>{text('对齐', 'Align')}</h4>
        <div className='pv-insp-alignrow'>
          {[['left', <IconAlignLeft key='l' size={14}/>, text('左对齐', 'Left')], ['center', <IconAlignCenter key='c' size={14}/>, text('水平居中', 'Center')], ['right', <IconAlignRight key='r' size={14}/>, text('右对齐', 'Right')],
            ['top', <IconAlignLeft key='t' size={14}/>, text('顶对齐', 'Top')], ['middle', <IconAlignCenter key='m' size={14}/>, text('垂直居中', 'Middle')], ['bottom', <IconAlignRight key='b' size={14}/>, text('底对齐', 'Bottom')]].map(([k, icon, title]) => (
            <button type='button' key={k} title={title} aria-label={title} disabled={readOnly} onClick={() => onAlign(k)}>{icon}</button>
          ))}
        </div>
        <div className='pv-insp-actions'>
          <button type='button' className='pv-button' disabled={readOnly || selection.length < 3} onClick={onDistribute}>{text('水平分布', 'Distribute')}</button>
          <button type='button' className='pv-button' disabled={readOnly || selection.length < 3} onClick={() => onDistribute(true)}>{text('垂直分布', 'Distribute vertically')}</button>
        </div>
      </section>
      {/* V5-R3 R3 rectification 4: mixed-value formatting for a multi
          selection — the SAME compact Chen format bar that used to live in
          the removed top bar (font/size/weight/color/fill/stroke/width/
          alignment/typography). Its shared() logic renders neutral controls
          when the selection disagrees, and Chen semantic outlines stay
          protected inside FormatBar itself. Only migrated, nothing new. */}
      {defaults && onDefault && selection.some(c => c.isNode()) && <section className='pv-insp-section'>
        <h4>{text('文字与外观', 'Text & appearance')}</h4>
        <div className='pv-insp-formatwrap'>
          <FormatBar chen selection={selection} mutate={mutate} readOnly={readOnly} defaults={defaults} onDefault={onDefault} theme={currentLook?.themeId} scopeLabel={text(`已选 ${selection.filter(c => c.isNode()).length} 个图形`, `${selection.filter(c => c.isNode()).length} shapes`)}/>
        </div>
      </section>}
    </>}

    {!node && !edge && selection.length === 0 && <>
      <div className='pv-insp-head'>
        <strong>{t('pageProperties')}</strong>
        <small>{chenPage ? text('陈氏 ER · 页面', 'Chen ER · page') : ''}</small>
      </div>
      {/* V5-R3 R3 rectification 4: the discoverable new-shape defaults entry
          that was lost with the permanent top format bar — font, weight,
          color, alignment, line height, spacing and vertical alignment set
          here pre-populate every shape added afterwards (addSemantic /
          decorate consume the same defaults map as before). */}
      {defaults && onDefault && <section className='pv-insp-section'>
        <h4>{text('新图形默认', 'New shape defaults')}</h4>
        <div className='pv-insp-formatwrap'>
          <FormatBar chen selection={[]} mutate={mutate} readOnly={readOnly} defaults={defaults} onDefault={onDefault} theme={currentLook?.themeId}/>
        </div>
        <p className='pv-note'>{text('之后新增的图形使用这些默认值。', 'Shapes added afterwards use these defaults.')}</p>
      </section>}
      <section className='pv-insp-section'>
        <h4>{text('画布', 'Canvas')}</h4>
        <p className='pv-note'>{text('在画布空白处点击可取消选择；选中图形后此处显示其属性。', 'Click empty canvas to deselect; select a shape to inspect it.')}</p>
      </section>
    </>}

    {edge && chenPage && edge.getData()?.chen && <>
      <div className='pv-insp-head'>
        <span className='pv-insp-glyph'><ShapeGlyph shape={{id: 'chen-relationship', pack: 'chen'}} look={currentLook}/></span>
        <div><strong>{edge.id.startsWith('role:') ? text('参与角色', 'Relationship role') : text('属性所属连线', 'Attribute ownership')}</strong>
        <small>{text('陈氏 ER · 连线', 'Chen ER · connection')}</small></div>
      </div>
      {edge.id.startsWith('role:')
        ? <ChenProperties page={chenPage} selectedId={chenPage.erModel.relationships.find(r => r.roles.some(v => `role:${v.id}` === edge.id))?.id} readOnly={readOnly} onEdit={onChenEdit}/>
        : <section className='pv-insp-section'><p className='pv-note'>{text('此连线表示属性所属关系。请选中属性修改所属对象。', 'This line represents attribute ownership. Select the attribute to change its owner.')}</p></section>}
    </>}

    {edge && !(chenPage && edge.getData()?.chen) && <>
      <div className='pv-insp-head'>
        <span className='pv-insp-glyph'><ShapeGlyph shape={{id: 'rect', pack: 'basic'}} look={currentLook}/></span>
        <div><strong>{text('辅助连线', 'Auxiliary connection')}</strong>
        <small>{chenPage ? text('陈氏 ER · 辅助', 'Chen ER · auxiliary') : ''}</small></div>
      </div>
      <section className='pv-insp-section'>
        <ColorField label={text('线条', 'Line')} value={edge.attr('line/stroke')} fallback='#7d90ab' theme={currentLook?.themeId}
          readOnly={readOnly} onChange={v => mutate(() => edge.attr('line/stroke', v))}/>
        <label className='pv-insp-field'><span className='pv-insp-label'>{text('线型', 'Pattern')}</span>
          <select disabled={readOnly} value={edge.attr('line/strokeDasharray') ? 'dashed' : 'solid'}
            onChange={e => mutate(() => edge.attr('line/strokeDasharray', e.target.value === 'dashed' ? '5 4' : ''))}>
            <option value='solid'>{text('实线', 'Solid')}</option>
            <option value='dashed'>{text('虚线', 'Dashed')}</option>
          </select>
        </label>
      </section>
    </>}

    {node && tab === 'shape' && <>
      <div className='pv-insp-head'>
        <span className='pv-insp-glyph'><ShapeGlyph shape={{id: chenData ? `chen-${kind}` : 'rect', pack: chenData ? 'chen' : 'basic'}} look={currentLook}/></span>
        <div>
          <strong title={label}>{label || text('未命名', 'Unnamed')}</strong>
          <small>{kindLabel}{chenData ? ` · ${text('陈氏 ER', 'Chen ER')}` : ''}</small>
        </div>
      </div>

      <section className='pv-insp-section'>
        <h4>{text('基本信息', 'Basics')}</h4>
        <label className='pv-insp-field'><span className='pv-insp-label'>{t('name')}</span>
          <textarea rows={1} disabled={readOnly || Boolean(data.assetRef)} value={label}
            onChange={e => setAttr('label/text', e.target.value)} aria-label={t('name')}/>
        </label>
        {pageLayers && pageLayers.length > 1 && chenData && <label className='pv-insp-field'><span className='pv-insp-label'>{text('所属图层', 'Layer')}</span>
          <select disabled={readOnly} value={data.layer || pageLayers[0].id} onChange={e => mutate(() => node.setData({...data, layer: e.target.value}, {overwrite: true}))}>
            {pageLayers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>}
      </section>

      {chenData && <section className='pv-insp-section pv-insp-semantics'>
        <ChenProperties page={chenPage} selectedId={node.id} readOnly={readOnly} onEdit={onChenEdit}/>
      </section>}

      <section className='pv-insp-section'>
        <h4>{text('外观', 'Appearance')}</h4>
        <div className='pv-insp-seg' role='tablist'>
          <button type='button' role='tab' aria-selected={look === 'frame'} className={look === 'frame' ? 'active' : ''} onClick={() => setLook('frame')}>{text('填充与边框', 'Fill & stroke')}</button>
          <button type='button' role='tab' aria-selected={look === 'text'} className={look === 'text' ? 'active' : ''} onClick={() => {setLook('text');setTab('text');}}>{text('文字', 'Text')}</button>
        </div>
        {look === 'frame' && <>
          <ColorField label={text('填充', 'Fill')} value={attr('body/fill')} fallback='#ffffff' theme={currentLook?.themeId}
            readOnly={readOnly || chenData} onChange={v => setAttr('body/fill', v)}/>
          <ColorField label={text('边框', 'Stroke')} value={attr('body/stroke')} fallback='#3566af' theme={currentLook?.themeId}
            readOnly={readOnly || chenData} onChange={v => setAttr('body/stroke', v)}/>
          <div className='pv-insp-grid2'>
            <NumberField label={text('线宽', 'Stroke')} value={attr('body/strokeWidth', 1.5)} min={0.5} max={10} step={0.5} unit='px' disabled={readOnly}
              title={chenData ? text('陈氏图形保留语义线型', 'Chen symbols keep semantic outlines') : undefined}
              onCommit={v => setAttr('body/strokeWidth', v)}/>
            <NumberField label={text('不透明度', 'Opacity')} value={Math.round((attr('body/opacity') == null ? 1 : attr('body/opacity')) * 100)} min={0} max={100} step={5} unit='%'
              disabled={readOnly} onCommit={v => setAttr('body/opacity', v / 100)}/>
          </div>
          {chenData && <p className='pv-note'>{text('轮廓表达实体类型；语义信息在模型中保留。', 'Outlines encode entity types; semantics live in the model.')}</p>}
        </>}
      </section>

      <section className='pv-insp-section'>
        <h4>{text('位置与尺寸', 'Position & size')}</h4>
        <div className='pv-insp-grid2'>
          <NumberField label='X' value={Math.round(node.position().x)} min={-9999} max={9999} disabled={readOnly} onCommit={v => mutate(() => node.position(v, node.position().y))}/>
          <NumberField label='Y' value={Math.round(node.position().y)} min={-9999} max={9999} disabled={readOnly} onCommit={v => mutate(() => node.position(node.position().x, v))}/>
          <NumberField label='W' value={Math.round(node.size().width)} min={30} max={4000} disabled={readOnly || chenData}
            title={chenData ? text('陈氏图形尺寸由语义类型决定', 'Chen symbol sizes follow their semantic type') : undefined}
            onCommit={v => mutate(() => node.resize(v, node.size().height))}/>
          <NumberField label='H' value={Math.round(node.size().height)} min={24} max={4000} disabled={readOnly || chenData}
            title={chenData ? text('陈氏图形尺寸由语义类型决定', 'Chen symbol sizes follow their semantic type') : undefined}
            onCommit={v => mutate(() => node.resize(node.size().width, v))}/>
        </div>
        {chenData && <p className='pv-note'>{text('轮廓表达实体类型；语义信息在模型中保留。', 'Outlines encode entity types; semantics live in the model.')}</p>}
      </section>

      {!readOnly && <section className='pv-insp-section pv-insp-actions'>
        <button type='button' className='pv-button' disabled={readOnly} onClick={() => mutate(() => node.toFront())}>{t('bringFront')}</button>
        <button type='button' className='pv-button' disabled={readOnly} onClick={() => mutate(() => node.toBack())}>{t('sendBack')}</button>
        <button type='button' className='pv-button' disabled={readOnly} onClick={() => mutate(() => node.setData({...data, locked: !data.locked}, {overwrite: true}))}>{t(data.locked ? 'unlock' : 'lock')}</button>
      </section>}
    </>}

    {node && tab === 'text' && <>
      <div className='pv-insp-head'>
        <span className='pv-insp-glyph'><ShapeGlyph shape={{id: chenData ? `chen-${kind}` : 'text', pack: chenData ? 'chen' : 'basic'}} look={currentLook}/></span>
        <div>
          <strong title={label}>{label || text('未命名', 'Unnamed')}</strong>
          <small>{kindLabel}{chenData ? ` · ${text('陈氏 ER', 'Chen ER')}` : ''}</small>
        </div>
      </div>
      <section className='pv-insp-section'>
        <h4>{text('字体', 'Font')}</h4>
        <label className='pv-insp-field'><span className='pv-insp-label'>{text('字体', 'Font family')}</span>
          <select disabled={readOnly} value={attr('label/fontFamily', '-apple-system, PingFang SC, sans-serif')} onChange={e => setAttr('label/fontFamily', e.target.value)}>
            {[['-apple-system, PingFang SC, sans-serif', text('系统字体', 'System')], ['Arial, sans-serif', 'Arial'], ['Georgia, serif', 'Georgia'], ['Menlo, monospace', 'Menlo']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div className='pv-insp-grid2'>
          <NumberField label={text('字号', 'Size')} value={attr('label/fontSize', 14)} min={8} max={96} unit='px' disabled={readOnly} onCommit={v => setAttr('label/fontSize', v)}/>
          <label className='pv-insp-field'><span className='pv-insp-label'>{text('字重', 'Weight')}</span>
            <select disabled={readOnly} value={attr('label/fontWeight', 400)} onChange={e => setAttr('label/fontWeight', Number(e.target.value))}>
              <option value={400}>{text('常规', 'Regular')}</option><option value={600}>{text('中等', 'Medium')}</option><option value={700}>{text('加粗', 'Bold')}</option>
            </select>
          </label>
        </div>
        <ColorField label={text('文字颜色', 'Text color')} value={attr('label/fill')} fallback='#303746' theme={currentLook?.themeId} readOnly={readOnly} onChange={v => setAttr('label/fill', v)}/>
      </section>
      <section className='pv-insp-section'>
        <h4>{text('段落', 'Paragraph')}</h4>
        <div className='pv-insp-alignrow' role='radiogroup' aria-label={text('对齐', 'Alignment')}>
          {[['start', <IconAlignLeft key='l' size={14}/>, text('左对齐', 'Left')], ['middle', <IconAlignCenter key='c' size={14}/>, text('居中', 'Center')], ['end', <IconAlignRight key='r' size={14}/>, text('右对齐', 'Right')]].map(([v, icon, title]) => (
            <button type='button' key={v} title={title} aria-label={title} aria-checked={attr('label/textAnchor', 'middle') === v}
              className={attr('label/textAnchor', 'middle') === v ? 'active' : ''} disabled={readOnly}
              onClick={() => mutate(() => {node.attr('label/textAnchor', v);node.attr('label/refX', v === 'start' ? 12 : v === 'end' ? '100%' : '50%');node.attr('label/refX2', v === 'end' ? -12 : 0);})}>{icon}</button>
          ))}
        </div>
        <div className='pv-insp-grid2'>
          <NumberField label={text('行高', 'Line height')} value={parseFloat(attr('label/lineHeight', 1.2)) || 1.2} min={1} max={3} step={0.1} unit={text('倍', '×')} disabled={readOnly} onCommit={v => setAttr('label/lineHeight', `${v}em`)}/>
          <NumberField label={text('字距', 'Spacing')} value={parseFloat(attr('label/letterSpacing', 0)) || 0} min={-2} max={12} step={0.5} unit='px' disabled={readOnly} onCommit={v => setAttr('label/letterSpacing', v)}/>
        </div>
        <label className='pv-insp-field'><span className='pv-insp-label'>{text('垂直对齐', 'Vertical align')}</span>
          <span className='pv-insp-alignrow pv-insp-valign' role='radiogroup' aria-label={text('垂直对齐', 'Vertical align')}>
            {[['top', text('顶部', 'Top'), text('顶', 'T')], ['middle', text('居中', 'Middle'), text('中', 'M')], ['bottom', text('底部', 'Bottom'), text('底', 'B')]].map(([v, title, glyph]) => (
              <button type='button' key={v} title={title} aria-label={title} aria-checked={attr('label/textVerticalAnchor', 'middle') === v}
                className={attr('label/textVerticalAnchor', 'middle') === v ? 'active' : ''} disabled={readOnly}
                onClick={() => mutate(() => {node.attr('label/textVerticalAnchor', v);node.attr('label/refY', v === 'top' ? '0%' : v === 'bottom' ? '100%' : '50%');node.attr('label/refY2', v === 'top' ? 6 : v === 'bottom' ? -6 : 0);})}>{glyph}</button>
            ))}
          </span>
        </label>
        <div className='pv-insp-actions'>
          <button type='button' className={`pv-button${attr('label/textDecoration') === 'underline' ? ' primary' : ''}`} disabled={readOnly}
            aria-pressed={attr('label/textDecoration') === 'underline'}
            onClick={() => setAttr('label/textDecoration', attr('label/textDecoration') === 'underline' ? 'none' : 'underline')}>{text('下划线', 'Underline')}</button>
          <button type='button' className={`pv-button${attr('label/textDecoration') === 'line-through' ? ' primary' : ''}`} disabled={readOnly}
            aria-pressed={attr('label/textDecoration') === 'line-through'}
            onClick={() => setAttr('label/textDecoration', attr('label/textDecoration') === 'line-through' ? 'none' : 'line-through')}>{text('删除线', 'Strikethrough')}</button>
          {/* V5-R3: 局部文字格式 moved here from the removed top format bar */}
          {onRanges && <button type='button' className='pv-button' disabled={readOnly} onClick={onRanges}>{text('局部文字格式…', 'Text ranges…')}</button>}
        </div>
      </section>
      {editingId === node.id && <p className='pv-note pv-insp-editnote'>{text('正在编辑名称；Enter 完成，Shift+Enter 换行。其他图形保持原样。', 'Editing the label; Enter finishes, Shift+Enter adds a line. Other shapes stay untouched.')}</p>}
    </>}
  </aside>;
};
