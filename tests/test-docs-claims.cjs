// D.1 文档口径守卫: README.md 与 CHANGELOG.md 只能描述已实现的能力,数字以代码为准。
// - 反向: 不得出现已知不成立的宣称(图种/模板数量口径、职责矩阵、流式 SSE、本地安全代理、
//   "98+ 项端到端"、未限定的哈希校验)。CHANGELOG 历史条目采取"原位更正 + 更正说明"策略,
//   因此整份 CHANGELOG 都受检;路线图类词汇只允许出现在带"未实现/尚未/暂不"等标记的行内。
// - 正向: 图类型数、模板数(按模块拆分)、npm test 测试文件数均由代码计算后与 README 比对。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '..');
const cache = new Map();

// 与 test-drawing-platform.cjs 相同的最小 ESM 加载器(babel 转 CJS 后在 vm 中执行)
function load(file) {
  const p = path.resolve(file);
  if (cache.has(p)) return cache.get(p).exports;
  const m = {exports: {}};
  cache.set(p, m);
  const code = babel.transformSync(fs.readFileSync(p, 'utf8'), {
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-env', {targets: {node: 'current'}}]],
    plugins: ['@babel/plugin-proposal-optional-chaining'],
  }).code;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', {filename: p})(
    s => (s.startsWith('.') ? load(path.resolve(path.dirname(p), s.endsWith('.js') ? s : s + '.js')) : require(s)),
    m,
    m.exports
  );
  return m.exports;
}

const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const README = read('README.md');
const CHANGELOG = read('CHANGELOG.md');
const DOCS = {'README.md': README, 'CHANGELOG.md': CHANGELOG};

let n = 0;
const check = (name, fn) => {
  fn();
  console.log('PASS', ++n, name);
};

// 在任何位置都不允许出现的不实口径
const BANNED = [
  [/9\s*大(专业)?图种/, '9 大图种'],
  [/(?<![\d.-])24\s*个?[^\n,，。;；]{0,8}模板/, '24 个模板'],
  [/(?<![\d.-])98\s*\+/, '98+'],
  [/(?<![\d.-])98\s*项[^\n]{0,8}端到端/, '98 项端到端'],
  [/端到端[^\n]{0,4}测试/, '端到端测试'],
  [/100%\s*通过/, '100% 通过'],
];
// 未实现的能力: 只允许出现在显式标注为未实现/路线图的行内
const NOT_IMPLEMENTED_TERMS = ['职责矩阵', 'SSE', '流式', '本地安全代理', '网络拓扑', '自由白板', '部署拓扑', '业务域卡片', 'KPI 指标卡片'];
const NOT_IMPLEMENTED_MARK = /未实现|尚未|暂不|ROADMAP/;

const lines = text => text.split('\n').map((line, i) => ({line, no: i + 1}));

check('README/CHANGELOG 不含已知不实口径', () => {
  for (const [file, text] of Object.entries(DOCS)) {
    for (const {line, no} of lines(text)) {
      for (const [re, label] of BANNED) assert(!re.test(line), `${file}:${no} 含不实口径「${label}」: ${line}`);
    }
  }
});

check('未实现能力只出现在标注"未实现/尚未/暂不/ROADMAP"的行内', () => {
  for (const [file, text] of Object.entries(DOCS)) {
    for (const {line, no} of lines(text)) {
      for (const term of NOT_IMPLEMENTED_TERMS) {
        if (line.includes(term)) assert(NOT_IMPLEMENTED_MARK.test(line), `${file}:${no} 把「${term}」写成已实现: ${line}`);
      }
    }
  }
});

check('哈希只能以"完整性校验、非防篡改/不证明来源"的限定口径出现', () => {
  for (const [file, text] of Object.entries(DOCS)) {
    for (const {line, no} of lines(text)) {
      if (!line.includes('哈希')) continue;
      assert(line.includes('完整性') && /非防篡改|不防篡改|不证明来源/.test(line),
        `${file}:${no} 哈希未限定为完整性校验(非防篡改): ${line}`);
    }
  }
});

const platform = load(path.join(root, 'src/lib/drawing_platform.js'));

check('README 图类型数与清单以 DRAWING_TYPES 为准', () => {
  const kinds = platform.DRAWING_TYPES.length;
  assert(README.includes(`${kinds} 种图类型`), `README 应写明「${kinds} 种图类型」`);
  platform.DRAWING_TYPES.forEach(t => assert(README.includes(t.name), `README 图类型清单缺少「${t.name}」`));
});

check('README 模板数以 PLATFORM_TEMPLATES 为准并按模块拆分', () => {
  const by = module => platform.PLATFORM_TEMPLATES.filter(t => t.module === module).length;
  const total = platform.PLATFORM_TEMPLATES.length;
  assert.equal(by('drawing') + by('business') + by('data'), total, '模板只应来自 drawing/business/data 三个模块');
  const phrase = `${total} 个起始模板（画图 ${by('drawing')} + 业务建模包 ${by('business')} + 数据建模包 ${by('data')}）`;
  assert(README.includes(phrase), `README 应写明「${phrase}」`);
});

check('README 测试数量口径与 npm test(run-all TESTS)一致', () => {
  const {TESTS} = require('./run-all.cjs');
  const phrase = `${TESTS.length} 个测试文件`;
  assert(README.includes(phrase), `README 应写明「${phrase}」`);
  assert(README.includes('单元/契约测试'), 'README 应注明测试为单元/契约测试');
});

check('CHANGELOG 首节为未发布(Unreleased),历史条目带更正说明', () => {
  const first = CHANGELOG.split('\n').find(l => l.startsWith('## '));
  assert(/^## 未发布[（(]Unreleased[)）]/.test(first), `CHANGELOG 第一节应为未发布(Unreleased): ${first}`);
  assert(CHANGELOG.includes('更正'), 'CHANGELOG 原位改写的历史条目须带「更正」说明');
});

check('docs/ROADMAP.md 存在、列出未实现项且 README 指向它', () => {
  const roadmap = read('docs/ROADMAP.md');
  ['网络拓扑', '自由白板', '部署拓扑', '职责矩阵', '流式'].forEach(term =>
    assert(roadmap.includes(term), `ROADMAP 缺少未实现项「${term}」`));
  assert(README.includes('docs/ROADMAP.md'), 'README 应链接 docs/ROADMAP.md');
});
