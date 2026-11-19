// CS-M 指标平台综合测试套件
const cp = require('child_process');
const path = require('path');

const tests = [
  'tests/metrics/core-test.cjs',
  'tests/metrics/dictionary-test.cjs',
  'tests/metrics/binding-test.cjs',
  'tests/metrics/lineage-test.cjs',
];

console.log('Running Metric Platform test suite (98 checks across core, dictionary, binding, and lineage)...');
for (const testFile of tests) {
  console.log(`\n=== Running ${testFile} ===`);
  cp.execFileSync(process.execPath, [path.resolve(__dirname, '..', testFile)], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });
}
console.log('\nALL 98 Metric Platform tests PASSED successfully!');
