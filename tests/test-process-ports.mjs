// 业务流程画布连接桩可见性测试(DRW-01):悬停显示、移出隐藏、默认隐藏态保持
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setNodePortsVisible} from '../src/app/business/processPorts.js';

let count = 0;
function ok(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}

const PATH = 'attrs/circle/style/visibility';

// 记录 setPortProp 调用的桩 node
const makeStub = (ids) => {
  const calls = [];
  return {
    calls,
    getPorts: () => ids.map((id) => ({id})),
    setPortProp: (id, path, value) => calls.push({id, path, value}),
  };
};

ok('visible=true 对每个 port 设置 visible', () => {
  const node = makeStub(['p1', 'p2', 'p3', 'p4']);
  setNodePortsVisible(node, true);
  assert.deepEqual(node.calls, ['p1', 'p2', 'p3', 'p4'].map((id) => ({id, path: PATH, value: 'visible'})));
});

ok('visible=false 对每个 port 设置 hidden', () => {
  const node = makeStub(['a', 'b']);
  setNodePortsVisible(node, false);
  assert.deepEqual(node.calls, ['a', 'b'].map((id) => ({id, path: PATH, value: 'hidden'})));
});

ok('getPorts() 返回空数组时不调用 setPortProp 也不抛错', () => {
  const node = makeStub([]);
  assert.doesNotThrow(() => setNodePortsVisible(node, true));
  assert.doesNotThrow(() => setNodePortsVisible(node, false));
  assert.equal(node.calls.length, 0);
});

// processShapes.js 顶层 import @antv/x6(纯 node 下会因缺少 navigator 失败),
// 故从源码中取出 PROCESS_PORTS 对象字面量求值,守住默认隐藏态
const shapesSrc = fs.readFileSync(new URL('../src/app/business/processShapes.js', import.meta.url), 'utf8');
const literal = shapesSrc.match(/export const PROCESS_PORTS = (\{[\s\S]*?\n\});/);
assert.ok(literal, '未在 processShapes.js 找到 PROCESS_PORTS 字面量');
const PROCESS_PORTS = new Function(`return ${literal[1]}`)();

ok('processShapes.js 仍再导出 setNodePortsVisible', () => {
  assert.match(shapesSrc, /export \{ setNodePortsVisible \}/);
});

ok('PROCESS_PORTS 默认态保持:4 个 items、各 group 默认 hidden', () => {
  assert.equal(PROCESS_PORTS.items.length, 4);
  const names = Object.keys(PROCESS_PORTS.groups);
  assert.deepEqual(names.sort(), ['bottom', 'left', 'right', 'top']);
  for (const name of names) {
    assert.equal(PROCESS_PORTS.groups[name].attrs.circle.style.visibility, 'hidden', `${name} 默认应为 hidden`);
  }
});

console.log(`${count} tests passed`);
