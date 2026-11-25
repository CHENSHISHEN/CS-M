// UX P1 快速项测试(UX-01 品牌 / UX-03 新建项目类型 / UX-19 窗口最小尺寸 / UX-22 ErrorBoundary 纯逻辑)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {moduleRegistry} from '../src/lib/moduleRegistry.js';
import {toErrorFallbackInfo, toLoggableError} from '../src/lib/errorBoundaryState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let count = 0;
function ok(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}

// ---- UX-03:新建项目只列出可独立创建项目的模块 ----
ok('getProjectCreatableModules 恰为 data/business/drawing 且保持注册顺序', () => {
  assert.deepEqual(
    moduleRegistry.getProjectCreatableModules().map(m => m.id),
    ['data-modeling', 'business-modeling', 'drawing-platform'],
  );
});
ok('getModules 仍包含 metric-platform(首页不受影响)', () => {
  assert.ok(moduleRegistry.getModules().some(m => m.id === 'metric-platform'));
});
ok('CreateProjectModal 使用 getProjectCreatableModules 且 initialMode 回退', () => {
  const src = read('src/app/home/CreateProjectModal.js');
  assert.ok(src.includes('getProjectCreatableModules()'));
  assert.ok(!src.includes('moduleRegistry.getModules()'));
});

// ---- UX-22:toErrorFallbackInfo ----
ok('Error -> message', () => assert.equal(toErrorFallbackInfo(new Error('x')).message, 'x'));
ok('字符串', () => assert.equal(toErrorFallbackInfo('boom').message, 'boom'));
ok('null/undefined -> 非空默认文案', () => {
  assert.ok(toErrorFallbackInfo(null).message.length > 0);
  assert.ok(toErrorFallbackInfo(undefined).message.length > 0);
});
ok('无 message 的对象不抛错且非空', () => {
  assert.ok(toErrorFallbackInfo({}).message.length > 0);
  assert.ok(toErrorFallbackInfo(42).message.length > 0);
});
ok('多行 message 折叠为单行', () => {
  const {message} = toErrorFallbackInfo(new Error('a\nb\r\n  c'));
  assert.ok(!/[\r\n]/.test(message));
  assert.equal(message, 'a b c');
});
ok('超长 message 截断 <=203 字符并带省略号', () => {
  const {message} = toErrorFallbackInfo(new Error('x'.repeat(5000)));
  assert.ok(message.length <= 203);
  assert.ok(message.endsWith('...'));
});
ok('message getter 抛错时不抛出', () => {
  const evil = {get message() { throw new Error('getter'); }};
  assert.ok(toErrorFallbackInfo(evil).message.length > 0);
});

// ---- UX-22:toLoggableError(componentDidCatch 写日志前归一化,throw null 等不得让边界自身抛错) ----
ok('toLoggableError: Error 原样返回', () => {
  const e = new Error('x');
  assert.equal(toLoggableError(e), e);
});
ok('toLoggableError: null/undefined -> Error 且 message 非空', () => {
  for (const v of [null, undefined]) {
    const e = toLoggableError(v);
    assert.ok(e instanceof Error);
    assert.ok(e.message.includes(String(v)), e.message);
    assert.equal(typeof e.stack, 'string');
  }
});
ok('toLoggableError: 字符串 -> 以该字符串为 message', () => {
  const e = toLoggableError('boom');
  assert.ok(e instanceof Error);
  assert.equal(e.message, 'boom');
});
ok('toLoggableError: 普通对象 -> Error,优先取 message,否则 JSON', () => {
  assert.equal(toLoggableError({message: 'm1'}).message, 'm1');
  const e = toLoggableError({a: 1});
  assert.ok(e instanceof Error);
  assert.equal(e.message, '{"a":1}');
  assert.ok(toLoggableError(42).message.includes('42'));
});
ok('toLoggableError: 恶意对象(getter 抛错/循环引用/toString 抛错)不抛出', () => {
  const evil = {get message() { throw new Error('getter'); }, toString() { throw new Error('ts'); }};
  const cyc = {}; cyc.self = cyc;
  for (const v of [evil, cyc, Object.create(null)]) {
    const e = toLoggableError(v);
    assert.ok(e instanceof Error);
    assert.ok(e.message.length > 0);
  }
});
ok('index.js componentDidCatch 写日志经 toLoggableError 且吞掉失败', () => {
  const src = read('src/index.js');
  assert.ok(src.includes('writeLog(toLoggableError(error))'));
  assert.ok(/\.catch\(\(\) => \{/.test(src));
});

// ---- UX-01:顶栏品牌(源码断言) ----
ok('WorkbenchShell 顶栏品牌为 CS-M 且走 i18n', () => {
  const lines = read('src/app/workbench/WorkbenchShell.js').split('\n');
  const nameLine = lines.find(l => l.includes('wb-topbar-name`'));
  assert.ok(nameLine, '未找到 wb-topbar-name 行');
  assert.ok(!nameLine.includes('PDManer'));
  assert.ok(nameLine.includes('workbench.brandName'));
  const logoLine = lines.find(l => l.includes('wb-topbar-logo'));
  assert.ok(logoLine, '未找到 wb-topbar-logo 行');
  assert.ok(!/>\s*P\s*</.test(logoLine));
  assert.ok(/>\s*C\s*</.test(logoLine));
});
ok('workbench.brandName 在 zh/en 均为 CS-M', () => {
  for (const f of ['src/lang/zh.js', 'src/lang/en.js']) {
    assert.ok(/brandName:\s*'CS-M'/.test(read(f)), f);
  }
});

// ---- UX-19:窗口最小尺寸(源码断言) ----
ok('main.js 最小尺寸为 1024x600', () => {
  const src = read('src/main.js');
  assert.ok(src.includes('minWidth: 1024'));
  assert.ok(src.includes('minHeight: 600'));
  assert.ok(!src.includes('minWidth: 300'));
});
ok('electron-window-opt 不再设置 300x100 最小尺寸', () => {
  assert.ok(!read('src/lib/electron-window-opt.js').includes('setMinimumSize(300, 100)'));
});

console.log(`\n${count} tests passed`);
