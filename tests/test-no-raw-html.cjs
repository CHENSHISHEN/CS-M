// 防回归扫描(ARCH-01):src 下所有 dangerouslySetInnerHTML / `.innerHTML =` / `.innerHTML +=` / `.outerHTML =`
// 的非字面量内容,必须在同一语句内直接调用 sanitizeHtml( 或 renderMarkdownSafe( 。
// 违规时列出 文件:行号 并以非 0 退出;门禁本身带自检用例(SELF_CASES)。
//
// 已知局限:这是静态文本扫描,只检查“该语句内出现了清洗调用”,
// 不保证清洗调用包住了全部动态内容(例如 `x.innerHTML = a + sanitizeHtml(b)` 会通过),
// 需要靠代码评审补足。
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
// 清洗库本身会在注释里提到这些关键字,排除
const EXCLUDE = [path.join(srcDir, 'lib', 'safeHtml.js')];
const SAFE_CALL = /\b(sanitizeHtml|renderMarkdownSafe)\s*\(/;
const TOKEN = /dangerouslySetInnerHTML|\.(?:innerHTML|outerHTML)\s*\+?=(?!=)/g;

function walk(dir, out) {
  fs.readdirSync(dir, {withFileTypes: true}).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.js') && !EXCLUDE.includes(p)) out.push(p);
  });
  return out;
}

// 跳过从 i(引号位置)开始的字符串字面量,返回结束引号之后的下标;
// 单/双引号字符串遇到换行即结束(避免 JSX 文本里的撇号把后面整段吞掉),模板字符串里的 ${} 递归处理
function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === q) return j + 1;
    if (q !== '`' && c === '\n') return j;
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

// 把注释替换成等长空白(保留换行,行号不变)。只在字符串之外识别注释,
// 所以 "https://x" 这种字符串里的 // 不会被当成注释,注释里的关键字也不会被当成 sink
function blankComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(src, i);
      out += src.slice(i, end);
      i = end;
    } else if (c === '/' && src[i + 1] === '/') {
      let end = src.indexOf('\n', i);
      if (end < 0) end = src.length;
      out += ' '.repeat(end - i);
      i = end;
    } else if (c === '/' && src[i + 1] === '*') {
      let end = src.indexOf('*/', i + 2);
      end = end < 0 ? src.length : end + 2;
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const CONT_END = /[+\-*/%?:&|=<>.(,!~]$/; // 行尾是运算符:表达式在下一行继续
const CONT_START = /^[+\-*/%?:&|=<>.]/; // 下一行以运算符开头:表达式继续

// 从 i 开始读取“被注入的表达式”,在深度 0 的 ; , 或多余的右括号处,
// 以及不带续行运算符的换行处结束(无分号写法不会再吞到后面的语句)
function readExpression(src, i) {
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(src, j); continue; }
    if (c === '(') { j = skipBalanced(src, j, '(', ')'); continue; }
    if (c === '[') { j = skipBalanced(src, j, '[', ']'); continue; }
    if (c === '{') { j = skipBalanced(src, j, '{', '}'); continue; }
    if (c === ';' || c === ',' || c === ')' || c === ']' || c === '}') break;
    if (c === '\n') {
      const soFar = src.slice(i, j).trimEnd();
      const rest = src.slice(j).trimStart();
      if (soFar === '' || CONT_END.test(soFar) || CONT_START.test(rest)) { j += 1; continue; }
      break;
    }
    j += 1;
  }
  return src.slice(i, j);
}

// 返回 token 之后“被注入的表达式”文本
function getExpression(src, token, end) {
  let i = end;
  while (/\s/.test(src[i] || '')) i += 1;
  if (token === 'dangerouslySetInnerHTML') {
    if (src[i] === '=') {
      // JSX 属性: dangerouslySetInnerHTML={{__html: ...}} (或 ={obj})
      i += 1;
      while (/\s/.test(src[i] || '')) i += 1;
      if (src[i] === '{') return src.slice(i, skipBalanced(src, i, '{', '}'));
      return readExpression(src, i);
    }
    if (src[i] === ':') {
      // 对象属性: {dangerouslySetInnerHTML: expr}
      return readExpression(src, i + 1);
    }
    return readExpression(src, i);
  }
  // `.innerHTML = expr` / `+= expr`:token 已含等号
  return readExpression(src, end);
}

// 纯字符串字面量(不含 ${})豁免
function isPureLiteral(expr) {
  const s = expr.trim();
  return /^'(?:[^'\\]|\\.)*'$/.test(s) || /^"(?:[^"\\]|\\.)*"$/.test(s) || /^`(?:[^`\\$]|\\.)*`$/.test(s);
}

// 扫描单个文件内容,返回违规列表 [{line, token}]
function scanSource(rawSrc) {
  const src = blankComments(rawSrc);
  const found = [];
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    const token = m[0].startsWith('dangerous') ? 'dangerouslySetInnerHTML' : m[0].replace(/\s+/g, '');
    const expr = getExpression(src, token, m.index + m[0].length);
    if (token !== 'dangerouslySetInnerHTML' && isPureLiteral(expr)) continue;
    if (!SAFE_CALL.test(expr)) {
      found.push({line: src.slice(0, m.index).split('\n').length, token});
    }
  }
  return found;
}

// 自检:门禁自身也要被测试(每条 [名称, 代码, 是否应报违规])
const SELF_CASES = [
  ['绕过1 同行前面出现 //', '<a href="https://x.com" dangerouslySetInnerHTML={{__html: userInput}} />;', true],
  ['绕过2 innerHTML +=', 'el.innerHTML += userInput;', true],
  ['绕过3 无分号后接 sanitizeHtml', 'el.innerHTML = userInput\nfoo(sanitizeHtml(y));', true],
  ['绕过4 对象属性写法', 'const p = {dangerouslySetInnerHTML: html};\nfunction f() { return sanitizeHtml(y); }', true],
  ['违规 outerHTML =', 'el.outerHTML = userInput;', true],
  ['违规 __html 为变量', '<pre dangerouslySetInnerHTML={{__html: html}} />', true],
  ['合规 sanitizeHtml', 'el.innerHTML = sanitizeHtml(x);', false],
  ['合规 空字符串字面量', "el.innerHTML = '';", false],
  ['合规 JSX 同行含 //', '<a href="https://x.com" dangerouslySetInnerHTML={{__html: sanitizeHtml(x)}} />;', false],
  ['合规 多行续行表达式', 'el.innerHTML = cond ?\n  sanitizeHtml(a) : sanitizeHtml(b);', false],
  ['合规 注释里的提及', '// el.innerHTML = userInput\n/* dangerouslySetInnerHTML */', false],
];
let selfFail = 0;
SELF_CASES.forEach(([name, code, shouldFail]) => {
  const bad = scanSource(code).length > 0;
  if (bad === shouldFail) console.log(`ok - 自检: ${name}`);
  else {
    selfFail += 1;
    console.error(`FAIL - 自检: ${name}(期望${shouldFail ? '违规' : '通过'},实际${bad ? '违规' : '通过'})`);
  }
});
if (selfFail) {
  console.error(`FAIL: 门禁自检 ${selfFail} 项失败`);
  process.exit(1);
}

const violations = [];
let checked = 0;
walk(srcDir, []).forEach((file) => {
  const rawSrc = fs.readFileSync(file, 'utf8');
  const found = scanSource(rawSrc);
  // 统计已合规的注入点数量(仅用于输出)
  const total = (blankComments(rawSrc).match(TOKEN) || []).length;
  checked += total;
  found.forEach(v => violations.push(`${path.relative(path.join(__dirname, '..'), file)}:${v.line}  ${v.token}`));
});

if (violations.length) {
  console.error(`FAIL: 发现 ${violations.length} 处未经 sanitizeHtml/renderMarkdownSafe 的 HTML 注入点:`);
  violations.forEach(v => console.error(`  ${v}`));
  process.exit(1);
}
console.log(`PASS: ${checked} 处 HTML 注入点(含纯字面量豁免)均已直接经过 sanitizeHtml/renderMarkdownSafe 或为字面量`);
