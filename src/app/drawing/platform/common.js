import React, { useEffect, useRef, useState } from 'react';
import { FormatMessage } from 'components';
import { clone, validateDrawing } from '../../../lib/drawing_platform';

export const t = (key, data) => FormatMessage.string({id: `platformV3.${key}`, data});
export const en = () => t('locale') === 'en';
export const titleOf = item => en() ? item.en || item.name || item.defName : item.name || item.defName || item.en;
export const humanError = error => {
  const message=typeof error==='string'?error:error?.message || String(error);
  const labels={
    'unsafe-content':['绘图文件含不支持的可执行内容。','The drawing contains unsupported executable content.'],
    'invalid-image':['图片必须是内嵌的 PNG、JPEG 或 WebP。','Images must be embedded PNG, JPEG or WebP.'],
    'invalid-link':['仅支持 http、https 或 mailto 链接。','Only HTTP, HTTPS or mailto links are supported.'],
    REVISION_CONFLICT:['绘图基线已变化，请重新打开最新副本。','The drawing baseline changed. Reopen the latest copy.'],
    'missing-owner':['请为属性选择有效的所属对象。','Choose a valid owner for the attribute.'],
    'owner-cycle':['复合属性不能互相包含。','Composite attributes cannot contain each other.'],
    'non-composite-owner':['只有复合属性可以包含子属性。','Only composite attributes can own child attributes.'],
    'invalid-key':['此属性类型或所属对象不支持该键定义。','This attribute kind or owner cannot use this key definition.'],
    'weak-participation':['标识联系中的弱实体须设置为完全参与。','A weak entity must participate totally in its identifying relationship.'],
    'entity-relationship-only':['陈氏语义连线只能连接实体与联系。','Chen semantic connections must join an entity and a relationship.'],
    'page-name':['画布名称不能为空、超过80字或与其他画布重名。','Canvas names must be unique, nonempty and at most 80 characters.'],
    PROJECT_CONFLICT:['项目文件已被外部修改，已停止覆盖；请导出恢复副本。','External project changes detected. Export a recovery copy.'],
    PROJECT_BUSY:['另一个程序（如旧版 CS-M/PDManer 或其他工具）正持有该项目的写锁，请稍后重试。','Another program (such as an older CS-M/PDManer or another tool) holds the write lock on this project. Try again shortly.'],
    PROJECT_FILE_MISSING:['工程文件已被删除或移走：绘图编辑仍保存在本机恢复区。请“另存为”到新位置、导出恢复副本，或把文件放回原位置后重试。','The project file was deleted or moved; drawing edits are kept in local recovery. Use Save As to a new location, export a recovery copy, or put the file back and retry.'],
    SESSION_REQUIRED:['保存连接尚未就绪或已中断，正在尝试恢复；请稍候或导出恢复副本。','The save connection is not ready or was interrupted. Recovery is being attempted; wait or export a recovery copy.'],
    SESSION_STALE:['保存连接已切换到新的会话，正在重新连接；请稍候或导出恢复副本。','The save connection moved to a newer session and is reconnecting. Wait or export a recovery copy.'],
    'weak-entity-key':['部分键只能添加在弱实体上。','A partial key can only be added to a weak entity.'],
    NAMED_VERSION_LIMIT:['命名版本已达20个，请先导出或删除旧版本。','Twenty named versions are retained. Export or delete an older version first.'],
    DUPLICATE_VERSION_NAME:['此版本名称已存在。','A named version already uses this name.'],
  };
  return message.split(', ').map(code=>labels[code]?.[en()?1:0] || code).join(' ');
};
export const editableTarget = target => Boolean(target?.closest?.('input,textarea,select,[contenteditable="true"]'));

export const useDocumentHistory = (doc, onChange, readOnly) => {
  const latest = useRef(doc); latest.current = doc;
  const history = useRef({past: [], future: []}); const [, redraw] = useState(0);
  const apply = (fn) => {
    if (readOnly) return;
    const next = typeof fn === 'function' ? fn(clone(latest.current)) : fn;
    if (validateDrawing(next).length) throw new Error(t('invalidStructure'));
    if (JSON.stringify(next) === JSON.stringify(latest.current)) return;
    history.current.past.push(clone(latest.current)); history.current.past = history.current.past.slice(-100);
    history.current.future = [];const previous = latest.current;latest.current = next;if (onChange(next) === false) {history.current.past.pop();latest.current = previous;}redraw(n => n + 1);
  };
  const travel = backwards => {
    if (readOnly) return;
    const from = history.current[backwards ? 'past' : 'future']; const to = history.current[backwards ? 'future' : 'past'];
    if (!from.length) return;
    const previous = latest.current;to.push(clone(previous));const next = from.pop();latest.current = next;if (onChange(next) === false) {to.pop();from.push(next);latest.current = previous;}redraw(n => n + 1);
  };
  const keyDown = e => {
    if (editableTarget(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); travel(!e.shiftKey); }
  };
  return {apply, undo: () => travel(true), redo: () => travel(false), keyDown,
    canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0};
};

export const download = (name, content, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const exportVector = (svg, name, png = false) => new Promise((resolve, reject) => {
  if (!svg) { reject(new Error(t('exportFailed'))); return; }
  const element = svg.cloneNode(true);
  element.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const box = element.viewBox.baseVal;
  element.setAttribute('width', box.width || svg.clientWidth || parseFloat(svg.getAttribute('width')) || 1200); element.setAttribute('height', box.height || svg.clientHeight || parseFloat(svg.getAttribute('height')) || 800);
  if (svg.isConnected) {const source=svg.querySelectorAll('text');element.querySelectorAll('text').forEach((node,index)=>{const style=getComputedStyle(source[index]);['font-family','font-size','font-weight','font-style','fill','text-decoration'].forEach(key=>node.setAttribute(key,style.getPropertyValue(key)));});}
  const content = new XMLSerializer().serializeToString(element);
  if (!png) { download(`${name}.svg`, content, 'image/svg+xml;charset=utf-8'); resolve(); return; }
  const image = new Image();
  const url = URL.createObjectURL(new Blob([content], {type: 'image/svg+xml'}));
  image.onload = () => {
    try {
      const canvas = document.createElement('canvas'); canvas.width = image.width * 2; canvas.height = image.height * 2;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => { URL.revokeObjectURL(url); if (!blob) { reject(new Error(t('exportFailed'))); return; }
        const link = document.createElement('a'); const pngUrl = URL.createObjectURL(blob); link.href = pngUrl; link.download = `${name}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(pngUrl), 1000); resolve(); });
    } catch (err) { URL.revokeObjectURL(url); reject(err); }
  };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('exportFailed'))); }; image.src = url;
});

export const Field = ({label, children}) => <label className='pv-field'><span>{label}</span>{children}</label>;
export const Action = ({children, primary, ...props}) => <button type='button' className={`pv-button${primary ? ' primary' : ''}`} {...props}>{children}</button>;
export const Dialog = ({title, children, onClose, className = ''}) => {
  const ref = useRef(null);
  useEffect(() => {const previous = document.activeElement;const first = ref.current.querySelector('input:not(:disabled),button:not(:disabled),select,textarea');first?.focus();return () => previous?.isConnected && previous.focus();}, []);
  return <div className='pv-backdrop' role='presentation' onKeyDown={e => {
    e.stopPropagation();if (e.key === 'Escape') onClose();
    if (e.key === 'Tab') {const controls = Array.from(ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(n => n.offsetParent);
      const first = controls[0];const last = controls[controls.length - 1];if (e.shiftKey && document.activeElement === first) {e.preventDefault();last?.focus();} else if (!e.shiftKey && document.activeElement === last) {e.preventDefault();first?.focus();}}
  }}><section ref={ref} role='dialog' aria-modal='true' aria-label={title} className={`pv-dialog ${className}`}><header><h2>{title}</h2><Action onClick={onClose} aria-label={t('close')}>×</Action></header>{children}</section></div>;
};
export const ExportActions = ({doc, svgRef, onError}) => <span className='pv-export'>
  <Action onClick={() => exportVector(svgRef.current, doc.defName).catch(onError)}>SVG</Action>
  <Action onClick={() => exportVector(svgRef.current, doc.defName, true).catch(onError)}>PNG</Action>
  <Action onClick={() => download(`${doc.defName}.json`, JSON.stringify({format: 'pdmaner-drawing', version: 1, document: doc}, null, 2))}>JSON</Action>
</span>;
export const usePanelWidth = (key, fallback = 288) => {
  const clamp = value => Math.max(key==='drawing-library'?200:260, Math.min(value, Math.min(key==='drawing-library'?320:440, window.innerWidth * .4)));
  const [width, setWidth] = useState(() => {try {const value = Number(localStorage.getItem(`pdmaner.platform.panel.${key}`));return value ? clamp(value) : fallback;} catch (err) {return fallback;}});
  return [width, value => {const next = clamp(value);setWidth(next);try {localStorage.setItem(`pdmaner.platform.panel.${key}`, String(next));} catch (err) { /* Preferences do not block editing. */ }}];
};
export const ResizeHandle = ({onWidth, startWidth, side = 'left'}) => <div className='pv-splitter' role='separator' aria-orientation='vertical' tabIndex={0}
  onDoubleClick={() => onWidth(side === 'left' ? 248 : 288)}
  onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onWidth(startWidth + (e.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1)); } }}
  onMouseDown={e => {e.preventDefault(); const x = e.clientX; const move = event => onWidth(startWidth + (event.clientX - x) * (side === 'left' ? 1 : -1));
    const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop);}} />;
