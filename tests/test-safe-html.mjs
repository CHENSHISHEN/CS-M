// safeHtml 清洗库断言测试(ARCH-01)
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import marked from 'marked';
import {createSafeHtml} from '../src/lib/safeHtml.js';

const win = new JSDOM('<!doctype html><html><body></body></html>').window;
const {sanitizeHtml, renderMarkdownSafe} = createSafeHtml(win);

let count = 0;
function ok(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}

// ---- 危险内容必须被清除 ----
ok('img onerror 被移除', () => {
  const out = renderMarkdownSafe('<img src=x onerror="alert(1)">');
  assert.ok(!out.includes('onerror'), out);
});
ok('script 标签被移除', () => {
  const out = renderMarkdownSafe('<script>alert(1)</script>');
  assert.ok(!/<script/i.test(out), out);
});
ok('svg onload 事件属性被移除', () => {
  const out = renderMarkdownSafe('<svg onload=alert(1)>');
  assert.ok(!out.includes('onload') && !out.includes('alert'), out);
});
ok('iframe 被移除', () => {
  const out = renderMarkdownSafe('<iframe src="javascript:1"></iframe>');
  assert.ok(!/<iframe/i.test(out), out);
});
ok('style 被移除', () => {
  const out = renderMarkdownSafe('<style>body{display:none}</style>x');
  assert.ok(!/<style/i.test(out), out);
});
ok('javascript: 链接被清除', () => {
  const out = renderMarkdownSafe('[x](javascript:alert(1))');
  assert.ok(!/javascript:/i.test(out), out);
});

// ---- 正常 Markdown 必须保留 ----
ok('加粗', () => {
  assert.ok(renderMarkdownSafe('**b**').includes('<strong>'));
});
ok('https 链接', () => {
  assert.ok(renderMarkdownSafe('[l](https://a.b)').includes('href="https://a.b"'));
});
ok('三列表格', () => {
  const md = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n';
  assert.ok(renderMarkdownSafe(md).includes('<table'));
});
ok('围栏代码块', () => {
  assert.ok(renderMarkdownSafe('```js\nconst a = 1;\n```').includes('<code'));
});
ok('data:image 图片', () => {
  const out = renderMarkdownSafe('![i](data:image/png;base64,AAAA)');
  assert.ok(out.includes('<img'), out);
  assert.match(out, /src="data:image\/png/);
});
ok('breaks:true 单换行转 <br', () => {
  assert.ok(renderMarkdownSafe('a\nb', {breaks: true}).includes('<br'));
});
ok('sanitizeHtml 保留 class(搜索高亮)', () => {
  assert.equal(sanitizeHtml('<span class="hl">a</span>'), '<span class="hl">a</span>');
});
ok('target=_blank 自动补 rel', () => {
  const out = sanitizeHtml('<a href="https://a.b" target="_blank">x</a>');
  assert.ok(out.includes('target="_blank"'), out);
  assert.ok(out.includes('rel="noopener noreferrer"'), out);
});
ok('自定义 renderer 生效且不污染全局 marked', () => {
  const before = marked.defaults.renderer;
  const renderer = new marked.Renderer();
  renderer.link = (href, title, text) => `<a href="${href}" target="_blank">${text}</a>`;
  const out = renderMarkdownSafe('[l](https://a.b)', {renderer});
  assert.ok(out.includes('target="_blank"') && out.includes('rel="noopener noreferrer"'), out);
  assert.equal(marked.defaults.renderer, before);
});
ok('自定义 renderer 中的脚本仍被清洗', () => {
  const renderer = new marked.Renderer();
  renderer.link = (href, title, text) => `<a href="${href}" onclick="alert(1)">${text}</a>`;
  const out = renderMarkdownSafe('[l](https://a.b)', {renderer});
  assert.ok(!out.includes('onclick'), out);
});
ok('空输入返回空串', () => {
  assert.equal(sanitizeHtml(''), '');
  assert.equal(renderMarkdownSafe(''), '');
});
const mod = await import('../src/lib/safeHtml.js');
assert.equal(typeof globalThis.window, 'undefined');
assert.throws(() => mod.sanitizeHtml('<b>x</b>'));
assert.throws(() => mod.renderMarkdownSafe('**x**'));
count += 1;
console.log('ok - 无 window 时默认导出抛错');

console.log(`\n${count} 项通过`);
