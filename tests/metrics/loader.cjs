// 指标测试共用加载器：经 Babel(commonjs) 编译并求值 ES 模块，相对路径补 .js / /index.js。
// 用法：const {loadEsModule, loadMetricApi, PROJECT_ROOT} = require('./loader.cjs');
const path = require('path');
const fs = require('fs');
const babel = require('@babel/core');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const moduleCache = new Map();
function loadEsModule(file) {
  const key = path.resolve(file);
  if (moduleCache.has(key)) return moduleCache.get(key);
  const code = fs.readFileSync(key, 'utf8');
  const transformed = babel.transformSync(code, {
    filename: key,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    presets: [[require.resolve('@babel/preset-env'), {targets: {node: '18'}, modules: 'commonjs'}]],
  }).code;
  const moduleObject = {exports: {}};
  moduleCache.set(key, moduleObject);
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const base = path.resolve(path.dirname(key), specifier);
      for (const suffix of ['.js', '/index.js', '']) {
        const candidate = base + suffix;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return loadEsModule(candidate).exports;
        }
      }
      throw new Error(`cannot resolve ${specifier} from ${key}`);
    }
    return require(specifier);
  };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', transformed);
  fn(moduleObject.exports, localRequire, moduleObject, key, path.dirname(key));
  return moduleObject;
}

// 真实加载 src/lib/metric_platform.js 的导出（合成数据测试直接调用真实 API）
const loadMetricApi = () =>
  loadEsModule(path.join(PROJECT_ROOT, 'src', 'lib', 'metric_platform.js')).exports;

module.exports = {PROJECT_ROOT, loadEsModule, loadMetricApi};
