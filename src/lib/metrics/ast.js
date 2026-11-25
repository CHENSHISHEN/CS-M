// 指标平台 M1：复合指标受限表达式 AST（无 eval）。
// 文法：expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)* ;
//       factor := NUMBER | '{{refKey}}' | '(' expr ')' | SAFE_DIVIDE '(' expr ',' expr ')'
// AST：{type:'number', value} | {type:'ref', key} |
//      {type:'binary', op:'+'|'-'|'*'|'/', left, right} | {type:'safe_divide', numerator, denominator}
// 除法语义：SAFE_DIVIDE 零/空分母 → NULL；普通 '/' 零分母 → NaN（由上层阻止或提示）。
// 注：构建链不识别 ??，使用 == null 三元。

import {invalidValueError, metricError} from './errors';

// 复杂度上限（MET-08）：先量长度再分词，递归下降带嵌套计数，防止超长/超深表达式拖垮解析与递归求值
export const MAX_EXPRESSION_LENGTH = 2000;
export const MAX_EXPRESSION_DEPTH = 64;

const tooComplexError = (path, message, limit) =>
  metricError('INVALID_VALUE', path, 'metric.error.expressionTooComplex', message, {limit});

const isRefKey = (text) => /^[A-Za-z0-9_]+$/.test(text);

// ---- 词法 ----
const tokenize = (expression, path) => {
  const tokens = [];
  let index = 0;
  const text = String(expression == null ? '' : expression);
  if (text.length > MAX_EXPRESSION_LENGTH) {
    throw tooComplexError(path, `expression longer than ${MAX_EXPRESSION_LENGTH} characters`, MAX_EXPRESSION_LENGTH);
  }
  while (index < text.length) {
    const char = text[index];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }
    if ('+-*/(),'.indexOf(char) >= 0) {
      tokens.push({type: 'op', value: char});
      index += 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      let numberText = '';
      while (index < text.length && /[0-9.]/.test(text[index])) {
        numberText += text[index];
        index += 1;
      }
      if (!/^\d+(\.\d+)?$/.test(numberText)) {
        throw metricError('INVALID_VALUE', path, 'metric.error.invalidExpression',
          `malformed number in expression: ${numberText}`);
      }
      const numberValue = Number(numberText);
      if (!Number.isFinite(numberValue)) {
        throw metricError('INVALID_VALUE', path, 'metric.error.invalidExpression',
          'number literal out of range in expression');
      }
      tokens.push({type: 'number', value: numberValue});
      continue;
    }
    if (char === '{' && text[index + 1] === '{') {
      const close = text.indexOf('}}', index + 2);
      if (close < 0) {
        throw metricError('INVALID_VALUE', path, 'metric.error.invalidExpression',
          'unterminated reference token {{');
      }
      const key = text.slice(index + 2, close);
      if (!isRefKey(key)) {
        throw metricError('INVALID_VALUE', path, 'metric.error.invalidExpression',
          `invalid reference key: ${key}`);
      }
      tokens.push({type: 'ref', value: key});
      index = close + 2;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let name = '';
      while (index < text.length && /[A-Za-z0-9_]/.test(text[index])) {
        name += text[index];
        index += 1;
      }
      if (name !== 'SAFE_DIVIDE') {
        throw metricError('INVALID_VALUE', path, 'metric.error.invalidExpression',
          `unknown function or identifier: ${name}（仅允许 SAFE_DIVIDE）`);
      }
      tokens.push({type: 'func', value: name});
      continue;
    }
    throw metricError('INVALID_VALUE', path, 'metric.error.invalidExpression',
      `unexpected character in expression: ${char}`);
  }
  return tokens;
};

// ---- 语法（递归下降） ----
const parseTokens = (tokens, path) => {
  let position = 0;
  let depth = 0;
  const enter = () => {
    depth += 1;
    if (depth > MAX_EXPRESSION_DEPTH) {
      throw tooComplexError(path, `expression nested deeper than ${MAX_EXPRESSION_DEPTH} levels`, MAX_EXPRESSION_DEPTH);
    }
  };
  const peek = () => tokens[position];
  const eat = (value) => {
    const token = tokens[position];
    if (token == null || token.value !== value) {
      throw metricError('INVALID_VALUE', path, 'metric.error.invalidExpression',
        `expected "${value}"`);
    }
    position += 1;
    return token;
  };
  const parseExpr = () => {
    let node = parseTerm();
    while (peek() != null && (peek().value === '+' || peek().value === '-')) {
      const op = tokens[position].value;
      position += 1;
      node = {type: 'binary', op, left: node, right: parseTerm()};
    }
    return node;
  };
  const parseTerm = () => {
    let node = parseFactor();
    while (peek() != null && (peek().value === '*' || peek().value === '/')) {
      const op = tokens[position].value;
      position += 1;
      node = {type: 'binary', op, left: node, right: parseFactor()};
    }
    return node;
  };
  const parseFactor = () => {
    const token = peek();
    if (token == null) {
      throw metricError('INVALID_VALUE', path, 'metric.error.invalidExpression', 'unexpected end of expression');
    }
    if (token.type === 'number') {
      position += 1;
      return {type: 'number', value: token.value};
    }
    if (token.type === 'ref') {
      position += 1;
      return {type: 'ref', key: token.value};
    }
    if (token.value === '(') {
      position += 1;
      enter();
      const inner = parseExpr();
      eat(')');
      depth -= 1;
      return inner;
    }
    if (token.type === 'func' && token.value === 'SAFE_DIVIDE') {
      position += 1;
      eat('(');
      enter();
      const numerator = parseExpr();
      eat(',');
      const denominator = parseExpr();
      eat(')');
      depth -= 1;
      return {type: 'safe_divide', numerator, denominator};
    }
    throw metricError('INVALID_VALUE', path, 'metric.error.invalidExpression',
      `unexpected token: ${token.value}`);
  };
  const ast = parseExpr();
  if (position < tokens.length) {
    throw metricError('INVALID_VALUE', path, 'metric.error.invalidExpression',
      `unexpected trailing token: ${tokens[position].value}`);
  }
  return ast;
};

export const parseExpression = (expression, path) => parseTokens(tokenize(expression, path), path);

// AST 引用键集合（校验 refs 声明与实际使用一致）
export const astRefKeys = (ast, found) => {
  const keys = found == null ? [] : found;
  if (ast == null) return keys;
  if (ast.type === 'ref') {
    if (keys.indexOf(ast.key) < 0) keys.push(ast.key);
    return keys;
  }
  if (ast.type === 'safe_divide') {
    astRefKeys(ast.numerator, keys);
    astRefKeys(ast.denominator, keys);
    return keys;
  }
  if (ast.type === 'binary') {
    astRefKeys(ast.left, keys);
    astRefKeys(ast.right, keys);
  }
  return keys;
};

// ---- 求值（设计示例/预览用；不代表真实计算执行） ----
export const evaluateExpression = (ast, values) => {
  if (ast == null) return null;
  if (ast.type === 'number') return ast.value;
  if (ast.type === 'ref') {
    const value = (values == null ? {} : values)[ast.key];
    return value == null ? null : value;
  }
  if (ast.type === 'safe_divide') {
    const numerator = evaluateExpression(ast.numerator, values);
    const denominator = evaluateExpression(ast.denominator, values);
    if (numerator == null || denominator == null || denominator === 0) return null;
    return numerator / denominator;
  }
  const left = evaluateExpression(ast.left, values);
  const right = evaluateExpression(ast.right, values);
  if (left == null || right == null) return null;
  if (ast.op === '+') return left + right;
  if (ast.op === '-') return left - right;
  if (ast.op === '*') return left * right;
  if (right === 0) return NaN; // 普通 '/' 零分母不静默，由上层策略处理
  return left / right;
};

// ---- 单位推导（除法/同单位相除得 ratio） ----
const combineUnit = (op, left, right, path) => {
  if (left == null || right == null) {
    throw invalidValueError(path, 'unit missing for operand');
  }
  if (op === '+' || op === '-') {
    if (left !== right) {
      throw metricError('UNIT_CONFLICT', path, 'metric.error.unitConflict',
        `cannot ${op === '+' ? 'add' : 'subtract'} units ${left} and ${right}`, {leftUnit: left, rightUnit: right});
    }
    return left;
  }
  if (op === '*') {
    if (left === '' ) return right;
    if (right === '') return left;
    if (left === right) return `${left}^2`;
    return `${left}*${right}`;
  }
  if (left === right) return 'RATIO';
  if (left === '') return `1/${right}`;
  if (right === '') return left;
  return `${left}/${right}`;
};

// unitOf: (key) => 单位字符串（'' 表示无量纲）；返回 {unit} 或抛结构化单位冲突
export const deriveAstUnit = (ast, unitOf, path) => {
  if (ast.type === 'number') return {unit: ''};
  if (ast.type === 'ref') {
    const unit = unitOf(ast.key);
    if (unit == null) {
      throw metricError('UNIT_CONFLICT', `${path}`, 'metric.error.unitConflict', `unit unknown for operand ${ast.key}`);
    }
    return {unit};
  }
  if (ast.type === 'safe_divide') {
    const left = deriveAstUnit(ast.numerator, unitOf, path);
    const right = deriveAstUnit(ast.denominator, unitOf, path);
    return {unit: combineUnit('/', left.unit, right.unit, path)};
  }
  const left = deriveAstUnit(ast.left, unitOf, path);
  const right = deriveAstUnit(ast.right, unitOf, path);
  return {unit: combineUnit(ast.op, left.unit, right.unit, path)};
};

// 是否含除法（ratio 类，默认不可再 SUM）
export const astContainsDivision = (ast) => {
  if (ast == null) return false;
  if (ast.type === 'safe_divide') return true;
  if (ast.type === 'binary') {
    return ast.op === '/' || astContainsDivision(ast.left) || astContainsDivision(ast.right);
  }
  return false;
};

// 渲染为展示文本（公式文本化，不执行）
export const astToText = (ast) => {
  if (ast == null) return '';
  if (ast.type === 'number') return String(ast.value);
  if (ast.type === 'ref') return `{{${ast.key}}}`;
  if (ast.type === 'safe_divide') {
    return `SAFE_DIVIDE(${astToText(ast.numerator)}, ${astToText(ast.denominator)})`;
  }
  return `(${astToText(ast.left)} ${ast.op} ${astToText(ast.right)})`;
};
