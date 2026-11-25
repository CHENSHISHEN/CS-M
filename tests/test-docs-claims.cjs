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

// 只对"当前口径"禁用: README 与 CHANGELOG 的未发布节。历史版本的模板数可能真实为 24
// (v0.3.0/v0.4.0: 画图 18 + 业务 3 + 数据 3),不能用今天的代码口径改写历史。
const BANNED_CURRENT = [
  [/(?<![\d.-])24\s*个?[^\n,，。;；]{0,8}模板/, '24 个模板'],
];
const unreleasedSection = () => {
  const start = CHANGELOG.search(/^## 未发布/m);
  assert(start >= 0, 'CHANGELOG 缺少未发布节');
  const rest = CHANGELOG.slice(start + 1);
  const next = rest.search(/^## /m);
  return next < 0 ? CHANGELOG.slice(start) : CHANGELOG.slice(start, start + 1 + next);
};

check('README 与 CHANGELOG 未发布节不含过时的模板数口径', () => {
  const current = {'README.md': README, 'CHANGELOG.md#未发布': unreleasedSection()};
  for (const [file, text] of Object.entries(current)) {
    for (const {line, no} of lines(text)) {
      for (const [re, label] of BANNED_CURRENT) assert(!re.test(line), `${file}:${no} 含过时口径「${label}」: ${line}`);
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

// ===== D.2: 基线/验收文档与第三方声明 =====
// 基线与验收文档的结构: 文首是"当前版本"节(版本号 = package.json version),0.1.0 的原始记录
// 保留在"## 历史记录（0.1.0）"标题之下,不得改写成当前口径。
const PKG = JSON.parse(read('package.json'));
const VERSIONED_DOCS = ['docs/BASELINE.md', 'docs/UAT.md', 'docs/ACCEPTANCE.md'];
const HISTORY_HEADING = /^## 历史记录[（(]0\.1\.0[)）]/m;
const currentSection = text => {
  const at = text.search(HISTORY_HEADING);
  return at < 0 ? text : text.slice(0, at);
};

check('BASELINE/UAT/ACCEPTANCE 文首版本号与 package.json 一致,0.1.0 记录保留为历史', () => {
  for (const file of VERSIONED_DOCS) {
    const text = read(file);
    const heading = text.split('\n').find(l => /^#{1,6} /.test(l) && /\d+\.\d+\.\d+/.test(l));
    assert(heading, `${file} 缺少带版本号的标题`);
    const version = heading.match(/\d+\.\d+\.\d+/)[0];
    assert.equal(version, PKG.version, `${file} 文首版本号 ${version} 应为 package.json 的 ${PKG.version}: ${heading}`);
    assert(HISTORY_HEADING.test(text), `${file} 应在「## 历史记录（0.1.0）」下保留 0.1.0 原始记录`);
  }
});

check('BASELINE 当前节保留兼容约束与许可归属', () => {
  const current = currentSection(read('docs/BASELINE.md'));
  ['.pdma.json', '.pdmaner-write-lock', 'importPDManer', 'pdmaner-java.jar', 'MulanPubL-2.0', 'NOTICE'].forEach(term =>
    assert(current.includes(term), `BASELINE 当前节缺少兼容约束「${term}」`));
});

check('ACCEPTANCE 当前节的测试数与 run-all TESTS 一致,并列出未验证边界', () => {
  const current = currentSection(read('docs/ACCEPTANCE.md'));
  const {TESTS} = require('./run-all.cjs');
  const nums = [...current.matchAll(/(\d+)\s*个测试文件/g)].map(m => Number(m[1]));
  assert(nums.length > 0, 'ACCEPTANCE 当前节应写明测试文件数');
  nums.forEach(x => assert.equal(x, TESTS.length, `ACCEPTANCE 写「${x} 个测试文件」,run-all TESTS 实为 ${TESTS.length}`));
  ['npm test', 'npm run build', '.github/workflows/test.yml', 'GUI', 'ARCH-02', 'ARCH-05', 'CSP'].forEach(term =>
    assert(current.includes(term), `ACCEPTANCE 当前节缺少「${term}」`));
});

check('基线/验收文档与第三方声明不含已知不实口径(含"100% 通过")', () => {
  for (const file of [...VERSIONED_DOCS, 'THIRD_PARTY_NOTICES.md']) {
    for (const {line, no} of lines(read(file))) {
      for (const [re, label] of BANNED) assert(!re.test(line), `${file}:${no} 含不实口径「${label}」: ${line}`);
    }
  }
});

// THIRD_PARTY_NOTICES: 表格每行首列为反引号包裹的包名,一行一个包: | `pkg` | 版本 | 许可证 | ...
// 范围: (1) package.json dependencies 的每个包都必须有一行;(2) 凡在 node_modules 中存在的行,
// 版本须等于已安装版本、许可证须等于该包 package.json 的 license 字段;(3) 不在 node_modules
// 的行(随仓库内置的资源,如 luckysheet)打印 SKIP 说明,不做比对。
check('THIRD_PARTY_NOTICES 覆盖直接依赖,版本与许可证以 node_modules 为准', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  const rows = new Map();
  for (const {line} of lines(notices)) {
    const m = line.match(/^\|\s*`([^`]+)`[^|]*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (m) rows.set(m[1], {version: m[2], license: m[3]});
  }
  ['node-sql-parser', 'ace-builds', 'luckysheet', 'dompurify'].forEach(name =>
    assert(rows.has(name), `THIRD_PARTY_NOTICES 缺少「${name}」`));
  Object.keys(PKG.dependencies).forEach(name =>
    assert(rows.has(name), `THIRD_PARTY_NOTICES 缺少 package.json 直接依赖「${name}」`));
  assert(/public\/jar/.test(notices) && /META-INF/.test(notices),
    'THIRD_PARTY_NOTICES 应说明 public/jar 内嵌 jar 的第三方许可证见其 META-INF');
  for (const [name, row] of rows) {
    const manifest = path.join(root, 'node_modules', name, 'package.json');
    if (!fs.existsSync(manifest)) {
      console.log(`SKIP 第三方声明比对「${name}」: node_modules 中不存在(内置资源,按声明文本保留)`);
      continue;
    }
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal(row.version, pkg.version, `THIRD_PARTY_NOTICES「${name}」版本 ${row.version} 与已安装 ${pkg.version} 不一致`);
    assert.equal(row.license, String(pkg.license), `THIRD_PARTY_NOTICES「${name}」许可证 ${row.license} 与 package.json license ${pkg.license} 不一致`);
  }
});
