// A safe, derived preview. The referenced managed model remains the sole editable source.
const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]));
export default (source, diagram) => {
  const nodes = (diagram.canvasData?.cells || []).filter(c => c.originKey).map(c => {
    const collection = c.type === 'C' ? 'conceptEntities' : c.type === 'L' ? 'logicEntities' : 'entities';
    const object = (source[collection] || []).find(o => o.id === c.originKey);
    return {...c, x: (c.position?.x != null ? c.position.x : c.x || 0), y: (c.position?.y != null ? c.position.y : c.y || 0), object};
  }).filter(n => n.object);
  if (!nodes.length) return '';
  const minX = Math.min(...nodes.map(n => n.x)) - 20;const minY = Math.min(...nodes.map(n => n.y)) - 20;
  const maxX = Math.max(...nodes.map(n => n.x + 230)) + 20;const maxY = Math.max(...nodes.map(n => n.y + 150)) + 20;
  const edges = (diagram.canvasData?.cells || []).filter(c => c.source && c.target).map(e => {
    const a = nodes.find(n => n.id === (e.source.cell || e.source));const b = nodes.find(n => n.id === (e.target.cell || e.target));
    return a && b ? `<path d="M${a.x + 230} ${a.y + 60} H${(a.x + b.x + 230) / 2} V${b.y + 60} H${b.x}" stroke="#7d90ab" fill="none"/>` : '';
  }).join('');
  const cards = nodes.map(n => `<g transform="translate(${n.x},${n.y})"><rect width="230" height="150" rx="5" fill="#fff" stroke="#8d9db6"/><path d="M0 36 H230" stroke="#dce3ee"/><text x="12" y="23" fill="#26354b" font-size="13" font-weight="600">${escape((n.object.defName || n.object.defKey).slice(0, 20))}</text>${(n.object.fields || []).slice(0, 5).map((f, i) => `<text x="12" y="${56 + i * 18}" fill="#586b83" font-size="10">${escape((f.defKey || f.defName || '').slice(0, 25))}</text>`).join('')}</g>`).join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" font-family="sans-serif"><rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="#f8f9fb"/>${edges}${cards}</svg>`)}`;
};
