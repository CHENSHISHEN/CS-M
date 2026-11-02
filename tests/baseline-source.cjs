// 首发基线边界检查；不读取用户工程或原项目目录。
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
  assert.equal(hash(file), 'a38c5966c037d401fc8b64a88897bb100ddd58cdb970ed2667bdfee4f066d662');
}
assert(/github\.com\/roberGroup\/PDManer/.test(read('README.md').toString()));
for (const retired of [
  'src/app/main/HeaderTool.js', 'src/app/ai', 'src/app/business', 'src/app/drawing', 'src/app/metrics', 'src/host',
  'src/lib/ai', 'src/lib/metrics',
  'src/lib/drawing_platform.js', 'src/lib/enterprise_home.js',
  'src/lib/concept_logical_links.js', 'src/lib/model_resource_overview.js',
]) {
  assert(!fs.existsSync(path.join(root, retired)), `基线外源码残留：${retired}`);
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
  assert(!/WB-\d|INTEGRATION-R\d|PLATFORM-\d/.test(text), `旧研发任务标识残留：${path.relative(root, file)}`);
}
assert(!pkg.dependencies['node-sql-parser'], '核心依赖完整性检查通过');
assert.deepStrictEqual(pkg.build.win.target[0].arch, ['x64']);
assert.equal(pkg.build.win.icon, 'assets/branding/app.ico');
assert.equal(pkg.build.mac.icon, 'assets/branding/app.icns');
console.log('PASS 首发品牌、锁文件、许可证、图二来源及平台图标配置');
