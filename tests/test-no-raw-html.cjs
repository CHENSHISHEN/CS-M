// 防回归扫描(ARCH-01):src 下所有 dangerouslySetInnerHTML / `.innerHTML =` 的非字面量内容,
// 必须在同一语句内直接调用 sanitizeHtml( 或 renderMarkdownSafe( 。
// 违规时列出 文件:行号 并以非 0 退出。
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
// 清洗库本身会在注释里提到这些关键字,排除
const EXCLUDE = [path.join(srcDir, 'lib', 'safeHtml.js')];
const SAFE_CALL = /\b(sanitizeHtml|renderMarkdownSafe)\s*\(/;
const TOKEN = /dangerouslySetInnerHTML|\.innerHTML\s*=(?!=)/g;

function walk(dir, out) {
  fs.readdirSync(dir, {withFileTypes: true}).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.js') && !EXCLUDE.includes(p)) out.push(p);
  });
  return out;
}

// 跳过从 i(引号位置)开始的字符串字面量,返回结束引号之后的下标;模板字符串里的 ${} 递归处理
function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === q) return j + 1;
    if (q === '`' && c === '$' && src[j + 1] === '{') {
      j = skipBalanced(src, j + 1, '{', '}');
      continue;
    }
    j += 1;
  }
  return j;
}

// 从 i(open 位置)开始找到配对的 close,返回 close 之后的下标
function skipBalanced(src, i, open, close) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(src, j); continue; }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
    j += 1;
  }
  return j;
}

// 返回 token 之后“被注入的表达式”的文本范围
function getExpression(src, token, end) {
  if (token === 'dangerouslySetInnerHTML') {
    const open = src.indexOf('{', end);
    return src.slice(end, open < 0 ? end : skipBalanced(src, open, '{', '}'));
  }
  // `.innerHTML = <expr>;` 取到深度 0 的分号为止
  let j = end;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(src, j); continue; }
    if (c === '(' ) { j = skipBalanced(src, j, '(', ')'); continue; }
    if (c === '[') { j = skipBalanced(src, j, '[', ']'); continue; }
    if (c === '{') { j = skipBalanced(src, j, '{', '}'); continue; }
    if (c === ';') break;
    j += 1;
  }
  return src.slice(end, j);
}

// 纯字符串字面量(不含 ${})豁免
function isPureLiteral(expr) {
  const s = expr.trim();
  return /^'(?:[^'\\]|\\.)*'$/.test(s) || /^"(?:[^"\\]|\\.)*"$/.test(s) || /^`(?:[^`\\$]|\\.)*`$/.test(s);
}

const violations = [];
let checked = 0;
walk(srcDir, []).forEach((file) => {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const prefix = src.slice(lineStart, m.index);
    // 注释行里的提及不算
    if (/^\s*(\/\/|\/\*|\*)/.test(prefix) || prefix.includes('//')) continue;
    const token = m[0].startsWith('dangerous') ? 'dangerouslySetInnerHTML' : '.innerHTML =';
    const expr = getExpression(src, token === '.innerHTML =' ? '.innerHTML' : token, m.index + m[0].length);
    if (token === '.innerHTML =' && isPureLiteral(expr)) continue;
    checked += 1;
    if (!SAFE_CALL.test(expr)) {
      const line = src.slice(0, m.index).split('\n').length;
      violations.push(`${path.relative(path.join(__dirname, '..'), file)}:${line}  ${token}`);
    }
  }
});

if (violations.length) {
  console.error(`FAIL: 发现 ${violations.length} 处未经 sanitizeHtml/renderMarkdownSafe 的 HTML 注入点:`);
  violations.forEach(v => console.error(`  ${v}`));
  process.exit(1);
}
console.log(`PASS: ${checked} 处 HTML 注入点均已直接经过 sanitizeHtml/renderMarkdownSafe`);
