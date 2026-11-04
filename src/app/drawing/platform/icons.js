import React from 'react';
// CHEN-UI-008: 16px line icons for the Chen menu, right rail and format bar.
// Stroke inherits currentColor so the same icon works in light/dark themes.
const Svg = ({children, size = 16, viewBox = '0 0 16 16', ...props}) => (
  <svg width={size} height={size} viewBox={viewBox} fill='none' stroke='currentColor'
    strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' {...props}>
    {children}
  </svg>
);
const icon = children => props => <Svg {...props}>{children}</Svg>;

export const IconFile = icon(<><path d='M9 1.5H3.5v13h9V5z'/><path d='M9 1.5V5h3.5'/></>);
export const IconTemplate = icon(<><rect x='2' y='2.5' width='12' height='11' rx='1.5'/><path d='M2 6h12M5.5 6v7.5'/></>);
export const IconCopy = icon(<><rect x='5.5' y='5.5' width='8' height='8' rx='1.5'/><path d='M10.5 3.5h-7a1 1 0 0 0-1 1v7'/></>);
export const IconRename = icon(<><path d='M2.5 13.5l.9-3.2 6.9-6.9 2.3 2.3-6.9 6.9z'/><path d='M9.6 3.9l1.4-1.4 2.3 2.3-1.4 1.4'/></>);
export const IconImport = icon(<><path d='M8 1.5v8.5M5 7.5l3 3 3-3'/><path d='M2 12.5v2h12v-2'/></>);
export const IconExport = icon(<><path d='M8 10V1.5M5 4.5l3-3 3 3'/><path d='M2 12.5v2h12v-2'/></>);
export const IconSave = icon(<><path d='M2.5 2.5h9l2 2v9h-11z'/><path d='M5 2.5v3.5h5V2.5M5 13.5v-4h6v4'/></>);
export const IconUndo = icon(<><path d='M3 6.5h6.5a3.5 3.5 0 0 1 0 7H6'/><path d='M5.5 4L3 6.5 5.5 9'/></>);
export const IconRedo = icon(<><path d='M13 6.5H6.5a3.5 3.5 0 0 0 0 7H10'/><path d='M10.5 4L13 6.5 10.5 9'/></>);
export const IconBack = icon(<><path d='M10 3L5 8l5 5'/></>);
export const IconGrid = icon(<><path d='M2.5 2.5h11v11h-11z'/><path d='M6 2.5v11M10 2.5v11M2.5 6h11M2.5 10h11'/></>);
export const IconEye = icon(<><path d='M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z'/><circle cx='8' cy='8' r='2'/></>);
export const IconMagnet = icon(<><path d='M5 2.5v5a3 3 0 0 0 6 0v-5'/><path d='M5 2.5h2.5v3H5zM8.5 2.5H11v3H8.5z'/></>);
export const IconMap = icon(<><path d='M2 4l4-1.5L10 4l4-1.5v9.5L10 13.5 6 12l-4 1.5z'/><path d='M6 2.5v9.5M10 4v9.5'/></>);
export const IconTheme = icon(<><circle cx='8' cy='8' r='5.5'/><path d='M8 2.5a5.5 5.5 0 0 0 0 11z' fill='currentColor' stroke='none'/></>);
export const IconFit = icon(<><path d='M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3'/><rect x='5.5' y='5.5' width='5' height='5' rx='.5'/></>);
export const IconActual = icon(<><circle cx='8' cy='8' r='5.5'/><path d='M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2'/></>);
export const IconPanel = icon(<><rect x='2' y='2.5' width='12' height='11' rx='1.5'/><path d='M10 2.5v11'/></>);
export const IconLayers = icon(<><path d='M8 2l6 3-6 3-6-3z'/><path d='M2 8.5l6 3 6-3M2 11.5l6 3 6-3'/></>);
export const IconFull = icon(<><path d='M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4'/></>);
export const IconText = icon(<><path d='M3 3h10M8 3v10M6 13h4'/></>);
export const IconNote = icon(<><path d='M2.5 2.5h9l2 2v9h-11z'/><path d='M5 6h6M5 9h4'/></>);
export const IconImage = icon(<><rect x='2' y='2.5' width='12' height='11' rx='1.5'/><circle cx='5.5' cy='6' r='1.2'/><path d='M2.5 11.5l3.5-3 3 2.5 2.5-2 2 2'/></>);
export const IconLink = icon(<><path d='M6.5 9.5l3-3'/><path d='M9.5 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M6.5 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1'/></>);
export const IconReference = icon(<><rect x='2' y='2.5' width='12' height='11' rx='1.5'/><path d='M5 6h6M5 9h6M5 11.5h3'/></>);
export const IconStar = icon(<><path d='M8 1.5l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2l-3.9 2.1.9-4.3-3.3-3 4.4-.5z'/></>);
export const IconLibrary = icon(<><rect x='2' y='2.5' width='5' height='5' rx='1'/><rect x='9' y='2.5' width='5' height='5' rx='1'/><rect x='2' y='9' width='5' height='5' rx='1'/><rect x='9' y='9' width='5' height='5' rx='1'/></>);
export const IconComment = icon(<><path d='M2.5 3h11v7.5h-6L4 13.5v-3H2.5z'/></>);
export const IconHistory = icon(<><path d='M8 3.5V8l3 2'/><path d='M2.5 8a5.5 5.5 0 1 1 1.6 3.9M2.5 8V5M2.5 8h3'/></>);
export const IconSpark = icon(<><path d='M8 1.5v3.5M8 11v3.5M1.5 8h3.5M11 8h3.5M3.5 3.5l2.2 2.2M10.3 10.3l2.2 2.2M12.5 3.5l-2.2 2.2M5.7 10.3l-2.2 2.2'/></>);
export const IconSearch = icon(<><circle cx='6.5' cy='6.5' r='4'/><path d='M9.5 9.5L14 14'/></>);
export const IconMore = icon(<><circle cx='3' cy='8' r='1' fill='currentColor' stroke='none'/><circle cx='8' cy='8' r='1' fill='currentColor' stroke='none'/><circle cx='13' cy='8' r='1' fill='currentColor' stroke='none'/></>);
export const IconPlus = icon(<><path d='M8 3v10M3 8h10'/></>);
export const IconClose = icon(<><path d='M4 4l8 8M12 4l-8 8'/></>);
export const IconCheck = icon(<><path d='M3 8.5l3.3 3.3L13 5'/></>);
export const IconChevron = icon(<><path d='M6 3.5L10.5 8 6 12.5'/></>);
export const IconPointer = icon(<><path d='M3.5 2l9 6-4 .8 2.2 4.4-1.8.9-2.2-4.4L3.5 12z'/></>);
export const IconHand = icon(<><path d='M5 8V3.2a1.2 1.2 0 0 1 2.4 0V7m0-4.3a1.2 1.2 0 0 1 2.4 0V7m0-3a1.2 1.2 0 0 1 2.4 0v5.5c0 2.5-1.6 4-4 4s-4-1.5-4.6-3.6L3 7.8A1.2 1.2 0 0 1 5 6.8'/></>);
export const IconAlign = icon(<><path d='M2 3.5h12M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7'/></>);
export const IconFont = icon(<><path d='M2.5 12.5L6 3.5l3.5 9M3.8 9.7h4.4M10 12.5l1.2-3 .5-1.2.5 1.2 1.2 3'/></>);
export const IconSliders = icon(<><path d='M2.5 5h11M2.5 11h11'/><circle cx='6' cy='5' r='1.8' fill='var(--er-ui-surface, #fff)'/><circle cx='10.5' cy='11' r='1.8' fill='var(--er-ui-surface, #fff)'/></>);
export const IconDiamond = icon(<><path d='M8 2l5.5 6L8 14 2.5 8z'/></>);
export const IconDoc = icon(<><path d='M4 1.5h8v13H4z'/><path d='M6 5h4M6 8h4M6 11h2.5'/></>);
export const IconAlignLeft = icon(<><path d='M2.5 3.5h11M2.5 8h7M2.5 12.5h9'/></>);
export const IconAlignCenter = icon(<><path d='M2.5 3.5h11M4.5 8h7M3.5 12.5h9'/></>);
export const IconAlignRight = icon(<><path d='M2.5 3.5h11M6.5 8h7M4.5 12.5h9'/></>);
export const IconTrash = icon(<><><path d='M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4'/><path d='M6.5 6.5v5M9.5 6.5v5'/></></>);
export const IconLock = icon(<><rect x='3.5' y='7' width='9' height='6.5' rx='1.2'/><path d='M5.5 7V5a2.5 2.5 0 0 1 5 0v2'/></>);

// Menu icon mapping: one icon per command key used by the Chen menus.
export const MENU_ICONS = {
  newDocument: IconFile, fromTemplate: IconTemplate, importDocument: IconImport, duplicateDocument: IconCopy,
  back: IconBack, upgrade: IconSpark, documentRename: IconRename, save: IconSave, native: IconExport,
  exportPages: IconDoc, svg: IconExport, png: IconExport, exportCanvas: IconExport,
  undo: IconUndo, redo: IconRedo, copy: IconCopy, cut: IconTrash, paste: IconDoc, duplicate: IconCopy,
  remove: IconTrash, selectAll: IconPanel, find: IconSearch,
  grid: IconGrid, snap: IconMagnet, minimap: IconMap, theme: IconTheme, fit: IconFit, actualSize: IconActual,
  properties: IconPanel, layers: IconLayers, fullScreen: IconFull,
  insertText: IconText, insertNote: IconNote, image: IconImage, link: IconLink, openLink: IconLink,
  insertReference: IconReference, saveShape: IconStar, favoriteSelection: IconStar, libraries: IconLibrary,
  comments: IconComment, saveRestore: IconHistory, history: IconHistory, ai: IconSpark,
  newPage: IconPlus, pageRename: IconRename, copyPage: IconCopy, left: IconUndo, right: IconRedo, deletePage: IconTrash,
  'align:left': IconAlignLeft, 'align:center': IconAlignCenter, 'align:right': IconAlignRight,
  'align:top': IconAlignLeft, 'align:middle': IconAlignCenter, 'align:bottom': IconAlignRight,
  distribute: IconAlign, distributeVertical: IconAlign, equalWidth: IconAlign, equalHeight: IconAlign,
  group: IconPanel, ungroup: IconPanel, front: IconLayers, back: IconLayers, lock: IconLock,
  copyStyle: IconCopy, pasteStyle: IconCopy, applyPaletteAll: IconTheme,
};
