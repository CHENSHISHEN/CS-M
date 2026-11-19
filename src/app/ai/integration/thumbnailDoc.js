// PREVIEW-FINAL：AI 侧卡/候选 tab 缩略图目标页投影（纯函数，两处共用）。
// GraphThumbnail 固定渲染 document.pages[0]，createPage 把内容放第二页时侧卡
// 缩略图为空；与 DocumentEditor 受影响页选择同约定——取 affectedPages 命中页，
// 找不到回落首页。只读投影（pages 收敛为目标单页），不改原 candidate.document
// 与其 pages 数组/顺序。
export const deriveThumbnailDoc = (candidate) => {
  const doc = candidate && candidate.document;
  if (!doc || !Array.isArray(doc.pages) || doc.pages.length === 0) return doc || null;
  const affected = Array.isArray(candidate.affectedPages) ? candidate.affectedPages : [];
  const page = affected.length
    ? doc.pages.find(p => p && affected.includes(p.id)) : null;
  if (!page || page === doc.pages[0]) return doc;
  return {...doc, pages: [page]};
};
