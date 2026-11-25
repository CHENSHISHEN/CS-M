// 统一的 HTML / Markdown 清洗库(ARCH-01)
// 所有 dangerouslySetInnerHTML、innerHTML 的内容必须先经过这里,
// 避免 XSS(渲染进程开启了 nodeIntegration,XSS 会升级为 RCE)。
import createDOMPurify from 'dompurify';
import marked from 'marked';

// 禁止的标签:样式/表单/嵌入类内容在笔记渲染中没有合法用途
const FORBID_TAGS = ['style', 'form', 'iframe', 'object', 'embed', 'script'];

/**
 * 基于给定 window 创建清洗器(测试里传 jsdom 的 window,渲染进程传全局 window)。
 * @param {Window} win
 * @returns {{sanitizeHtml: function(string): string, renderMarkdownSafe: function(string, {breaks?: boolean, renderer?: object}=): string}}
 */
export function createSafeHtml(win) {
  if (!win || !win.document) {
    throw new Error('safeHtml: 需要提供带 document 的 window');
  }
  const purify = createDOMPurify(win);

  // 带 target 的链接补 rel,防止 window.opener 劫持
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('target')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  function sanitizeHtml(html) {
    return purify.sanitize(html == null ? '' : String(html), {
      FORBID_TAGS,
      ADD_ATTR: ['target'],
    });
  }

  function renderMarkdownSafe(md, opts = {}) {
    const {breaks, renderer} = opts;
    const markedOpts = {};
    if (breaks !== undefined) markedOpts.breaks = breaks;
    if (renderer) {
      // 直接通过本次调用的选项传入 renderer,不调用 marked.use,避免污染全局 marked 实例;
      // 允许只覆盖部分方法的普通对象,缺失的方法回退到默认 Renderer
      markedOpts.renderer =
        renderer instanceof marked.Renderer
          ? renderer
          : Object.assign(new marked.Renderer(), renderer);
    }
    return sanitizeHtml(marked(md == null ? '' : String(md), markedOpts));
  }

  return {sanitizeHtml, renderMarkdownSafe};
}

// 默认导出:调用时才绑定全局 window;没有 window 时直接抛错,绝不返回未清洗的原文
let defaultInstance = null;
function getDefault() {
  if (typeof window === 'undefined') {
    throw new Error('safeHtml: 当前环境没有 window,无法清洗 HTML');
  }
  if (!defaultInstance || defaultInstance.win !== window) {
    defaultInstance = {win: window, api: createSafeHtml(window)};
  }
  return defaultInstance.api;
}

export function sanitizeHtml(html) {
  return getDefault().sanitizeHtml(html);
}

export function renderMarkdownSafe(md, opts) {
  return getDefault().renderMarkdownSafe(md, opts);
}

export default {sanitizeHtml, renderMarkdownSafe};
