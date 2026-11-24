// i18n 对齐测试(ARCH-17 / UX-26):
//  1) zh 与 en 的键集合(叶子路径)完全一致;
//  2) en 的值不含汉字(白名单见 CJK_ALLOWLIST);
//  3) 源码中以字面量引用的 message id 在两种语言里都存在;
//  4) AI 面板另有独立词包 src/app/ai/messages.js(MESSAGE_PACKS,t(key) 缺键时会直接显示键名),
//     对其 zh/en 键集合、en 汉字、以及 src/app/ai 内 t('字面量') 引用做同样检查。
// 运行: node --import ./tests/esm-loader.mjs tests/test-i18n-parity.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zh from '../src/lang/zh.js';
import en from '../src/lang/en.js';
import {MESSAGE_PACKS} from '../src/app/ai/messages.js';

const started = Date.now();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 把嵌套对象拍平为 点路径 -> 叶子值(数组视为叶子),与运行时 _.get(langData, id) 的取值方式一致。
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out);
    else out[p] = v;
  }
  return out;
}
const flatZh = flatten(zh);
const flatEn = flatten(en);

const show = (title, list) => {
  const sorted = [...list].sort();
  return `${title}: ${sorted.length} 个\n  ${sorted.slice(0, 20).join('\n  ')}${sorted.length > 20 ? '\n  ...' : ''}`;
};

// en 值允许出现汉字的键。每一项必须注明原因;默认为空。
const CJK_ALLOWLIST = {
  // 词典 Excel 的工作表名 '4-词根库' / '3-常用词库' 是 src/lib/dictionary_excel.js 中写死的字面量,
  // 英文提示必须原样列出这些中文工作表名,用户才能据此改名;翻译会误导。
  'dataStandard.dictMissingSheets': '提示文案需原样列出必须存在的中文工作表名',
};
const CJK = /[一-鿿]/;

// ---- 源码扫描 ----
function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) walk(full, files);
    else if (name.name.endsWith('.js')) files.push(full);
  }
  return files;
}
// 字面量 id 允许的形态: 字母数字/下划线/连字符,以点分隔(不含模板插值、空格)。
const ID = '[A-Za-z_][\\w-]*(?:\\.[\\w-]+)*';
const PATTERNS = [
  // <FormatMessage id='x' /> / id="x" / id={'x'}: 只在 <FormatMessage 标签起点之后的同一标签片段内找 id
  {name: 'jsx-id', re: new RegExp(`<FormatMessage\\b[^]*?\\sid=\\{?\\s*(['"])(${ID})\\1`, 'g'), group: 2, jsx: true},
  // FormatMessage.string({id: 'x' ...}) / FormatMessage.string({ data, id: "x" })
  {name: 'string-id', re: new RegExp(`FormatMessage\\.string\\(\\s*\\{[^{}]*?\\bid:\\s*(['"])(${ID})\\1`, 'g'), group: 2},
  // 注册表等传给 FormatMessage 的 *Key: 'a.b' 属性(必须是带点的字面量)
  {name: 'xxxKey', re: new RegExp(`\\b(?:message|name|desc|sub|action|label|title)Key:\\s*(['"])(${ID})\\1`, 'g'), group: 2, dotted: true},
];

function scanSources() {
  const refs = new Map(); // id -> Set(位置)
  let total = 0;
  for (const file of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, 'utf8');
    for (const p of PATTERNS) {
      for (const m of text.matchAll(p.re)) {
        const id = m[p.group];
        if (p.dotted && !id.includes('.')) continue;
        if (p.jsx) {
          // 非贪婪匹配可能跨越到后面的 <FormatMessage 之前的其他标签: 片段内若出现另一个 <FormatMessage 则丢弃
          const body = m[0].slice('<FormatMessage'.length);
          if (body.includes('<FormatMessage') || /\/>|<\/FormatMessage>/.test(body)) continue;
        }
        total += 1;
        if (!refs.has(id)) refs.set(id, new Set());
        refs.get(id).add(`${rel}:${text.slice(0, m.index).split('\n').length}`);
      }
    }
  }
  return {refs, total};
}

const failures = [];

// (1) 键集合一致
const zhKeys = new Set(Object.keys(flatZh));
const enKeys = new Set(Object.keys(flatEn));
const missInEn = [...zhKeys].filter(k => !enKeys.has(k));
const missInZh = [...enKeys].filter(k => !zhKeys.has(k));
if (missInEn.length) failures.push(show('zh 有而 en 缺', missInEn));
if (missInZh.length) failures.push(show('en 有而 zh 缺', missInZh));

// (2) en 值不含汉字
const cjkInEn = Object.entries(flatEn)
  .filter(([k, v]) => typeof v === 'string' && CJK.test(v) && !(k in CJK_ALLOWLIST))
  .map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
if (cjkInEn.length) failures.push(show('en 值含汉字', cjkInEn));

// (3) 源码字面量 id 两端都存在
const {refs, total} = scanSources();
const missingInSource = [];
for (const [id, locs] of refs) {
  const where = [...locs].slice(0, 2).join(', ');
  const lack = [];
  if (!(id in flatZh)) lack.push('zh');
  if (!(id in flatEn)) lack.push('en');
  if (lack.length) missingInSource.push(`${id} (缺 ${lack.join('+')}) @ ${where}`);
}
if (missingInSource.length) failures.push(show('源码引用但语言包缺失', missingInSource));

// (4) AI 面板独立词包(createMessages 的 t(key);缺键时回退为键名本身,界面会直接显示键名)
const aiZh = MESSAGE_PACKS.zh;
const aiEn = MESSAGE_PACKS.en;
const aiMissInEn = Object.keys(aiZh).filter(k => !(k in aiEn));
const aiMissInZh = Object.keys(aiEn).filter(k => !(k in aiZh));
if (aiMissInEn.length) failures.push(show('AI 词包 zh 有而 en 缺', aiMissInEn));
if (aiMissInZh.length) failures.push(show('AI 词包 en 有而 zh 缺', aiMissInZh));
const aiCjk = Object.entries(aiEn).filter(([, v]) => CJK.test(String(v))).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
if (aiCjk.length) failures.push(show('AI 词包 en 值含汉字', aiCjk));
// 仅扫描调用了 createMessages(...) 的文件(含经 '../index' 再导出的引用),避免把别处同名的局部 t() 误判;含插值的模板字符串不匹配(R6)。
let aiRefTotal = 0;
const aiMissingSource = [];
for (const file of walk(path.join(ROOT, 'src/app/ai'))) {
  const text = fs.readFileSync(file, 'utf8');
  if (!/\bcreateMessages\(/.test(text) || /export const createMessages/.test(text)) continue;
  const rel = path.relative(ROOT, file);
  for (const m of text.matchAll(/(?<![\w.$])t\(\s*(['"])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g)) {
    aiRefTotal += 1;
    const lack = [];
    if (!(m[2] in aiZh)) lack.push('zh');
    if (!(m[2] in aiEn)) lack.push('en');
    if (lack.length) aiMissingSource.push(`${m[2]} (缺 ${lack.join('+')}) @ ${rel}:${text.slice(0, m.index).split('\n').length}`);
  }
}
if (aiMissingSource.length) failures.push(show('AI 面板引用但词包缺失', aiMissingSource));

// (5) 局部命名空间包装函数: const t = (key, data) => FormatMessage.string({id: `ns.${key}`, data})
//     对定义它的文件(以及从 drawing/platform/common 导入 t 的文件)里的 t('字面量') 补全前缀后检查。
const WRAPPER = /(?:export\s+)?const\s+(\w+)\s*=\s*\(?\s*(\w+)[^)=]*\)?\s*=>\s*FormatMessage\.string\(\{\s*id:\s*`([\w.]+)\.\$\{\2\}`/g;
const appFiles = [...walk(path.join(ROOT, 'src/app')), ...walk(path.join(ROOT, 'src/components'))];
const commonSrc = fs.readFileSync(path.join(ROOT, 'src/app/drawing/platform/common.js'), 'utf8');
const commonDef = [...commonSrc.matchAll(WRAPPER)].find(m => m[1] === 't');
let wrapperTotal = 0;
const wrapperMissing = [];
for (const file of appFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const defs = [...text.matchAll(WRAPPER)].map(m => ({fn: m[1], ns: m[3]}));
  if (commonDef && /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*'\.\/common'/.test(text)) defs.push({fn: 't', ns: commonDef[3]});
  for (const {fn, ns} of defs) {
    for (const m of text.matchAll(new RegExp(`(?<![\\w.$])${fn}\\(\\s*(['"])(${ID})\\1`, 'g'))) {
      wrapperTotal += 1;
      const id = `${ns}.${m[2]}`;
      const lack = [];
      if (!(id in flatZh)) lack.push('zh');
      if (!(id in flatEn)) lack.push('en');
      if (lack.length) wrapperMissing.push(`${id} (缺 ${lack.join('+')}) @ ${rel}:${text.slice(0, m.index).split('\n').length}`);
    }
  }
}
if (wrapperMissing.length) failures.push(show('命名空间包装函数引用但语言包缺失', wrapperMissing));

const elapsed = Date.now() - started;
console.log(`zh 键 ${zhKeys.size} 个, en 键 ${enKeys.size} 个; 源码字面量引用 ${total} 处, 去重 ${refs.size} 个 id; AI 词包引用 ${aiRefTotal} 处; 命名空间包装函数引用 ${wrapperTotal} 处; 耗时 ${elapsed}ms`);
if (failures.length) {
  console.error(`FAIL\n${failures.join('\n')}`);
  process.exit(1);
}
assert.ok(elapsed < 2000, `测试耗时过长: ${elapsed}ms`);
console.log('ok - i18n parity');
