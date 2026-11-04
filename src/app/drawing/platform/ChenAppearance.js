import DrawingDocument from '../../../../public/drawing-document';
// Chen look-and-feel: fixed style/theme registry (shared source with projection),
// sidebar option lists, and one-step page application used by "apply to selection
// / canvas". Colors resolve per semantic role; semantic outlines are never restyled
// into plain rectangles.
export const CHEN_LOOK_STYLES = [
  {id: 'standard', zh: '标准', en: 'Standard'},
  {id: 'sketch', zh: '手绘', en: 'Sketch'},
  {id: 'oil', zh: '油画质感', en: 'Oil paint'},
];
export const CHEN_LOOK_THEMES = Object.entries(DrawingDocument.chenThemes).map(([id, theme]) => ({id, zh: theme.label, en: theme.en}));
export const chenLook = page => DrawingDocument.chenAppearanceOf(page);
export const roleColors = (kind, themeId) => {
  const themes = DrawingDocument.chenThemes;const theme = themes[themeId] || themes.default;
  return theme[DrawingDocument.chenRoleOf(kind)] || theme.basic;
};
export const basicColors = themeId => {
  const themes = DrawingDocument.chenThemes;return (themes[themeId] || themes.default).basic;
};
export const lookColors = (kind, look) => roleColors(kind, look.themeId);
// Style defaults used when creating a new semantic node on the current look.
export const styleForNewNode = (kind, look, defaults = {}) => ({
  'body/fill': defaults['body/fill'] || roleColors(kind, look.themeId).fill,
  'body/stroke': defaults['body/stroke'] || roleColors(kind, look.themeId).stroke,
  renderStyle: look.styleId !== 'standard' ? look.styleId : undefined,
});
// Apply concrete colors + renderStyle in one edit step. semanticIds null means the
// whole canvas; auxIds recolors auxiliary basic shapes to the theme's basic role.
export const applyLookToPage = (page, look, {semanticIds = null, auxIds = null} = {}) => {
  const theme = DrawingDocument.chenThemes[look.themeId] || DrawingDocument.chenThemes.default;
  DrawingDocument.semantic(page).forEach(node => {
    if (semanticIds && !semanticIds.includes(node.id)) return;
    const kind = DrawingDocument.kindOf(page, node);
    const style = page.scene.nodes[node.id].style || (page.scene.nodes[node.id].style = {});
    style.fill = theme[DrawingDocument.chenRoleOf(kind)].fill;
    style.stroke = theme[DrawingDocument.chenRoleOf(kind)].stroke;
    if (look.styleId === 'standard') delete style.renderStyle;else style.renderStyle = look.styleId;
  });
  if (!semanticIds || auxIds) {
    (page.scene.annotations || []).forEach(cell => {
      if (cell.shape === 'edge' || cell.data?.chen) return;
      if (auxIds && !auxIds.includes(cell.id)) return;
      cell.attrs = {...cell.attrs, body: {...cell.attrs?.body, fill: theme.basic.fill, stroke: theme.basic.stroke}};
    });
  }
  return page;
};
