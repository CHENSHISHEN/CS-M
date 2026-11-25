// 第一梯队收尾项测试:首页按钮对比度 / redux-logger 仅开发环境 / 版本页修订确认文案
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {moduleRegistry} from '../src/lib/moduleRegistry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let count = 0;
function ok(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}

const luminance = (hex) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrastWithWhite = hex => 1.05 / (luminance(hex) + 0.05);

ok('首页卡片按钮底色(buttonColor||accentColor)与白字对比度 ≥ 4.5:1', () => {
  moduleRegistry.getModules().forEach((m) => {
    const bg = m.buttonColor || m.accentColor;
    assert.ok(contrastWithWhite(bg) >= 4.5, `${m.id} ${bg} 对比度 ${contrastWithWhite(bg).toFixed(2)}`);
  });
});

ok('Home.js 按钮与徽标使用 buttonColor', () => {
  const src = read('src/app/home/Home.js');
  assert.ok(!/background: m\.accentColor/.test(src), 'Home.js 仍直接用 accentColor 作白字底色');
});

ok('redux-logger 仅在非 production 时挂入 middleware', () => {
  const src = read('src/index.js');
  assert.match(src, /process\.env\.NODE_ENV !== 'production' \? \[logger\] : \[\]/);
  assert.ok(!/^\s*logger,\s*$/m.test(src), 'logger 不应无条件出现在 applyMiddleware 中');
});

ok('版本页"修订"确认框使用修订专属文案而非发布文案,中英文均已定义', () => {
  const src = read('src/app/metrics/VersionsPage.js');
  const m = src.match(/const reviseFrom[\s\S]*?Modal\.confirm\(\{[\s\S]*?\}\);/);
  assert.ok(m, '找不到 reviseFrom 的确认框');
  assert.ok(!m[0].includes('metrics.publish.message'), '修订确认框不应复用发布文案');
  assert.ok(m[0].includes('metrics.versions.reviseConfirm'));
  assert.match(read('src/lang/zh.js'), /reviseConfirm:/);
  assert.match(read('src/lang/en.js'), /reviseConfirm:/);
});

console.log(`${count} passed`);
