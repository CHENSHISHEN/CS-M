// CS-M 打包前置检查（最小实现，只读检查，不做任何构建）
// 用法：node bin/preflight.js [win|mac|mac-arm64|mac-x64|linux|web]
var path = require('path');
var fs = require('fs');
var cp = require('child_process');

var target = (process.argv[2] || '').toLowerCase();
var ok = true;
function pass(msg) { console.log('[OK]   ' + msg); }
function fail(msg) { ok = false; console.log('[FAIL] ' + msg); }
function info(msg) { console.log('[INFO] ' + msg); }

// 1. Node 版本与 OpenSSL legacy provider 支持（webpack 4 需要）
var major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 16) {
  fail('Node 版本过低: ' + process.version + '（需要 >= 16，建议 16/18/20 LTS，与 README 一致）');
} else {
  pass('Node ' + process.version);
  if (major >= 17) {
    try {
      cp.execFileSync(process.execPath, ['--openssl-legacy-provider', '-e',
        "require('crypto').createHash('md4')"], { stdio: 'pipe' });
      pass('--openssl-legacy-provider 可用（bin/build.js、bin/start.js 会自动携带）');
    } catch (e) {
      fail('当前 Node 不支持 --openssl-legacy-provider，webpack 4 无法构建，请改用官方 Node 16/18/20');
    }
  }
}

// 2. 依赖是否已安装（node_modules 可用）
try {
  require.resolve('webpack');
  require.resolve('electron-builder/package.json');
  pass('webpack / electron-builder 已安装');
} catch (e) {
  fail('依赖未安装，请先在仓库根目录执行 npm install');
}

// 3. 打包目标平台检查
if (target === 'win') {
  if (process.platform === 'darwin') {
    info('macOS 交叉构建 Windows NSIS x64：electron-builder 会自动下载 Wine 等兼容工具到缓存，无需全局安装');
    if (process.arch === 'arm64') {
      try {
        cp.execFileSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true'], {stdio: 'pipe'});
        pass('x86_64 构建工具可运行（Rosetta）');
      } catch (e) {
        fail('本机不能运行 x86_64 构建工具，请准备兼容环境或改用 Windows 原生 CI 构建');
      }
    }
    info('首次构建需联网下载 Electron win32-x64 与 NSIS 工具到 ~/Library/Caches/electron-builder');
  } else if (process.platform !== 'win32') {
    fail('本版本只验证 Windows 原生与 macOS 交叉构建，Linux 主机构建未纳入验证范围');
  } else {
    pass('Windows 原生构建环境');
  }
  var ico = path.resolve(__dirname, '../assets/branding/app.ico');
  (fs.existsSync(ico)) ? pass('Windows 图标存在: assets/branding/app.ico') : fail('缺少 assets/branding/app.ico');
}
if (target === 'mac' || target === 'mac-arm64' || target === 'mac-x64') {
  if (process.platform !== 'darwin') {
    fail('macOS 安装包（DMG）只能在 macOS 上构建');
  } else {
    pass('macOS 原生构建环境（' + process.arch + ' 主机，可分别产出 arm64/x64 包）');
  }
  var icns = path.resolve(__dirname, '../assets/branding/app.icns');
  (fs.existsSync(icns)) ? pass('macOS 图标存在: assets/branding/app.icns') : fail('缺少 assets/branding/app.icns');
}
if (target === 'win' || target === 'mac' || target === 'mac-arm64' || target === 'mac-x64' || target === 'linux') {
  info('本仓库未配置签名证书，产物为未签名包（不伪造签名）');
}

// 4. vendor 本地依赖
var xlsxTgz = path.resolve(__dirname, '../vendor/xlsx-0.20.3.tgz');
(fs.existsSync(xlsxTgz)) ? pass('vendor/xlsx-0.20.3.tgz 存在（xlsx 走本地 vendor，不依赖外网）')
  : fail('缺少 vendor/xlsx-0.20.3.tgz');

console.log(ok ? '\npreflight: 全部通过' : '\npreflight: 存在不满足项，见 [FAIL]');
process.exit(ok ? 0 : 1);
