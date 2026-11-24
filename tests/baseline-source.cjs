// CS-M 基线边界检查；不读取用户工程或原项目目录。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const hash = name => crypto.createHash('sha256').update(read(name)).digest('hex');
const pkg = JSON.parse(read('package.json'));
const appPkg = JSON.parse(read('app/package.json'));
const locked = JSON.parse(read('package-lock.json'));
assert.equal(pkg.name, 'cs-m');
assert.equal(pkg.build.productName, 'CS-M');
assert.equal(appPkg.version, pkg.version);
assert.equal(appPkg.productName, 'CS-M');
assert.equal(locked.version, pkg.version);
assert.deepStrictEqual(locked.packages[''].dependencies, pkg.dependencies);
assert.deepStrictEqual(locked.packages[''].devDependencies, pkg.devDependencies);
assert.equal(hash('LICENSE'), '7c91afc2c15fc478de3fc38f2678e560906859da6932f2c03b6bc9076d592d18');
for (const file of ['assets/branding/logo.png', 'public/branding/logo.png']) {
  assert.equal(hash(file), '0a999e98e0a5fd4d3811f8481f8949038202b25c0ca6f3b06b149c42f9ce4d94');
}
assert(/github\.com\/roberGroup\/PDManer/.test(read('README.md').toString()));

for (const required of [
  'public/drawing-document.js', 'public/drawing-persistence.js',
  'src/lib/drawing_session_policy.js', 'src/lib/drawing_persistence.js',
  'src/app/main/HeaderTool.js', 'src/app/ai', 'src/app/metrics', 'src/host',
  'src/lib/ai', 'src/lib/metrics', 'src/lib/quality',
  'src/lib/enterprise_home.js',
  'src/lib/concept_logical_links.js', 'src/lib/model_resource_overview.js',
  'src/lib/model_forward_engineering.js', 'src/lib/metric_platform.js',
]) {
  assert(fs.existsSync(path.join(root, required)), `v0.5.0 核心功能与架构源码缺失：${required}`);
}

const files = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) walk(file);
    else if (/\.(js|jsx|less|json|html)$/.test(name)) files.push(file);
  }
}
walk(path.join(root, 'src'));
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  assert(!/\/Users\/chencc\/|\/private\/tmp\//.test(text), `开发机路径残留：${path.relative(root, file)}`);
  assert(!/namespace PDManer\./.test(text), `代码模板仍生成旧产品命名空间：${path.relative(root, file)}`);
  assert(!/https?:\/\/www\.yuque\.com\/pdmaner|https?:\/\/pdmaas\.pdmaner\.com/.test(text), `外链泄露：${path.relative(root, file)}`);
}
// 隐私/安全：桌面窗口启用 nodeIntegration，入口 HTML 不得引入统计或任何远程脚本。
for (const htmlFile of ['public/index.html', 'app/build/index.html']) {
  if (!fs.existsSync(path.join(root, htmlFile))) continue;
  const html = read(htmlFile).toString();
  assert(!/hm\.baidu\.com/i.test(html), `入口 HTML 含百度统计脚本：${htmlFile}`);
  assert(!/<script\b[^>]*\bsrc\s*=\s*["']?\s*(https?:)?\/\//i.test(html), `入口 HTML 含远程 <script src>：${htmlFile}`);
  assert(!/createElement\(\s*['"]script['"]\s*\)/i.test(html), `入口 HTML 动态创建 script 标签：${htmlFile}`);
}
assert(pkg.dependencies['node-sql-parser'], 'node-sql-parser 核心依赖必须安装');
assert.deepStrictEqual(pkg.build.win.target[0].arch, ['x64']);
assert.equal(pkg.build.win.icon, 'assets/branding/app.ico');
assert.equal(pkg.build.mac.icon, 'assets/branding/app.icns');
console.log('PASS v0.5.0 基线品牌、锁文件、许可证、图二来源、新架构及平台图标配置');
