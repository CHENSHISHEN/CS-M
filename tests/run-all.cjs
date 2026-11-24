#!/usr/bin/env node
// 统一测试入口: 每个测试文件在独立子进程运行,汇总 PASS/FAIL/SKIP。
// 任一 FAIL 则退出码 1。用法: node tests/run-all.cjs   (npm test 同)
//
// 约定: 新增测试文件时,请追加到下方 TESTS 数组(不要用 glob)。不要重复列出已被其他测试内部
// spawn 的文件:test-metric-platform.cjs 会运行 tests/metrics/ 下的 core-test、dictionary-test、
// binding-test、lineage-test 这 4 个,它们不得再列出;tests/metrics/ 下其余(后来新增的)测试需在此显式列出。
const {spawnSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TIMEOUT_MS = 300 * 1000;
const TAIL_LINES = 30;

// ===== TESTS: 在此追加新测试文件 =====
// file: 相对仓库根目录的路径;.mjs 自动带 --import ./tests/esm-loader.mjs
// requires: 可选,返回 null 表示可运行,返回字符串则 SKIP 并以该字符串为原因
const javaAvailable = () => {
  const r = spawnSync('java', ['-version'], {cwd: ROOT, stdio: 'ignore'});
  return r.error || r.status !== 0 ? 'java 不可用' : null;
};
const TESTS = [
  {file: 'tests/baseline-source.cjs'},
  {file: 'tests/project-safety.cjs'},
  {file: 'tests/save-state.cjs'},
  {file: 'tests/standard-regression.cjs'},
  {file: 'tests/workbook-branding.cjs', requires: javaAvailable},
  {file: 'tests/test-drawing-platform.cjs'},
  {file: 'tests/test-file-guard.cjs'},
  {file: 'tests/test-chen-core.cjs'},
  {file: 'tests/test-chen-geometry.cjs'},
  {file: 'tests/test-chen-persistence.cjs'},
  {file: 'tests/test-chen-recovery.cjs'},
  {file: 'tests/test-enterprise-modeling.mjs'},
  {file: 'tests/test-platform-ai.mjs'},
  {file: 'tests/test-platform-host.cjs'},
  {file: 'tests/test-metric-platform.cjs'}, // 内部会 spawn tests/metrics/ 的 core/dictionary/binding/lineage 4 个测试
  {file: 'tests/test-canvas.cjs'},
  {file: 'tests/test-catalog.mjs'},
  {file: 'tests/test-catalog-data.cjs'},
  {file: 'tests/test-catalog-ui.cjs'},
  {file: 'tests/test-safe-html.mjs'},
  {file: 'tests/test-safe-external.mjs'},
  {file: 'tests/test-ux-p1.mjs'},
  {file: 'tests/test-tier1-tail.mjs'},
  {file: 'tests/test-no-raw-html.cjs'},
  {file: 'tests/test-process-ports.mjs'},
  {file: 'tests/test-i18n-parity.mjs'},
  {file: 'tests/metrics/version-test.cjs'},
  {file: 'tests/metrics/fork-test.cjs'},
  {file: 'tests/metrics/audit-test.cjs'},
  {file: 'tests/metrics/dict-link-test.cjs'},
  {file: 'tests/test-navigation-guard.cjs'},
  // gui-smoke.cjs 不纳入: 需要 playwright + Electron
];
// ===== /TESTS =====

const tail = (text) => text.split('\n').slice(-TAIL_LINES).join('\n');

// 运行单个测试,返回 {status: 'PASS'|'FAIL'|'SKIP', reason?, output?, seconds}
function runOne(test) {
  const started = Date.now();
  const seconds = () => ((Date.now() - started) / 1000).toFixed(1);
  if (!fs.existsSync(path.join(ROOT, test.file))) {
    return {status: 'FAIL', output: `测试文件不存在: ${test.file}`, seconds: seconds()};
  }
  const skipReason = test.requires ? test.requires() : null;
  if (skipReason) return {status: 'SKIP', reason: skipReason, seconds: seconds()};
  const args = test.file.endsWith('.mjs')
    ? ['--import', './tests/esm-loader.mjs', test.file] : [test.file];
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.error) {
    const why = r.error.code === 'ETIMEDOUT' ? `超时(>${TIMEOUT_MS / 1000}s)` : String(r.error);
    return {status: 'FAIL', output: `${output}\n${why}`, seconds: seconds()};
  }
  if (r.status !== 0) {
    return {status: 'FAIL', output: `${output}\n退出码 ${r.status}${r.signal ? ` 信号 ${r.signal}` : ''}`, seconds: seconds()};
  }
  return {status: 'PASS', seconds: seconds()};
}

function runAll(tests) {
  const counts = {PASS: 0, FAIL: 0, SKIP: 0};
  tests.forEach((test) => {
    const result = runOne(test);
    counts[result.status] += 1;
    const reason = result.reason ? ` [${result.reason}]` : '';
    console.log(`${result.status} ${test.file} (${result.seconds}s)${reason}`);
    if (result.status === 'FAIL') {
      console.log(tail(result.output).replace(/^/gm, '    '));
    }
  });
  console.log(`\n${counts.PASS} pass, ${counts.FAIL} fail, ${counts.SKIP} skip`);
  return counts;
}

module.exports = {TESTS, runOne, runAll};

if (require.main === module) {
  process.exit(runAll(TESTS).FAIL > 0 ? 1 : 0);
}
