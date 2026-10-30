// Node 17+ 移除了 OpenSSL legacy provider 默认支持，webpack 4 的 md4 哈希会抛
// error:0308010C。通过以 --openssl-legacy-provider 重启自身解决，
// 各平台（Windows/macOS/Linux）统一，无需用户手工设置环境变量。
if (!process.env.CSM_OPENSSL_LEGACY && parseInt(process.versions.node.split('.')[0], 10) >= 17) {
  // 透传原始 CLI 参数（如 --web），否则 respawn 后丢失，package-web 会退化为桌面 json 构建
  const child = require('child_process')
    .spawn(process.execPath, ['--openssl-legacy-provider', __filename].concat(process.argv.slice(2)), { stdio: 'inherit', env: Object.assign({}, process.env, { CSM_OPENSSL_LEGACY: '1' }) });
  child.on('close', code => process.exit(code));
  child.on('error', err => { console.error(err); process.exit(1); });
  return;
}

process.env.CHINER_NODE_ENV = 'production';
var fs = require('fs');
var path = require('path');
var webpack = require('webpack');
var config = require('../config/webpack.pro.config.js');

// 清理上次构建产物，避免 chunkhash 文件累积；仅清理本仓库 app/build
var appBuildDir = path.resolve(__dirname, '../app/build');
if (fs.existsSync(appBuildDir)) {
  fs.rmSync(appBuildDir, { recursive: true, force: true });
}

webpack(config).run((err, stats) => {
    if (err) {
        console.log('Failed to compile.', [err]);
        process.exit(1);
    }

    if (stats.compilation.errors.length) {
        console.log('Failed to compile.', stats.compilation.errors);
        process.exit(1);
    }

    console.log('build success');
});
