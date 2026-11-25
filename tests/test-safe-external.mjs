// safeExternal 断言测试(ARCH-06):openExternal 仅放行 http/https/mailto
import assert from 'node:assert/strict';
import {isSafeExternalUrl, safeOpenExternal} from '../src/lib/safeExternal.js';

let count = 0;
async function ok(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

// ---- isSafeExternalUrl:任务书给定的输入表 ----
const table = [
  ['https://a.b', true],
  ['http://a.b', true],
  ['mailto:x@y.z', true],
  ['file:///etc/passwd', false],
  ['javascript:alert(1)', false],
  ['data:text/html,x', false],
  ['smb://h/s', false],
  ['', false],
  [null, false],
  [123, false],
  ['  https://a.b', false], // 前导空白不 trim
  ['HTTPS://A.B', true], // 协议大小写不敏感
];
for (const [input, expected] of table) {
  await ok(`isSafeExternalUrl(${JSON.stringify(input)}) === ${expected}`, () => {
    assert.equal(isSafeExternalUrl(input), expected);
  });
}
await ok('isSafeExternalUrl(undefined) 为 false', () => {
  assert.equal(isSafeExternalUrl(undefined), false);
});

// ---- safeOpenExternal ----
await ok('不安全 URL 返回 false 且不调用 opener(也不加载 electron)', async () => {
  let called = 0;
  const r = await safeOpenExternal('file:///etc/passwd', () => { called += 1; });
  assert.equal(r, false);
  assert.equal(called, 0);
});
await ok('不传 opener 时,不安全 URL 在 node 下也不抛错(不加载 electron)', async () => {
  assert.equal(await safeOpenExternal('file:///etc/passwd'), false);
  assert.equal(await safeOpenExternal(null), false);
});
await ok('安全 URL 调用 opener 并返回 true', async () => {
  const seen = [];
  const r = await safeOpenExternal('https://a.b/x', (u) => { seen.push(u); return Promise.resolve(); });
  assert.equal(r, true);
  assert.deepEqual(seen, ['https://a.b/x']);
});
await ok('opener 异步 reject 时返回 false 而不抛出', async () => {
  const r = await safeOpenExternal('https://a.b', () => Promise.reject(new Error('boom')));
  assert.equal(r, false);
});
await ok('opener 同步抛错时返回 false 而不抛出', async () => {
  const r = await safeOpenExternal('https://a.b', () => { throw new Error('boom'); });
  assert.equal(r, false);
});

console.log(`${count} tests passed`);
