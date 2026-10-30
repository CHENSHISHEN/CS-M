// Node 17+ 需要 --openssl-legacy-provider 才能运行 webpack 4（md4 哈希），
// 以该参数重启自身，跨平台统一，无需手工设置环境变量。
if (!process.env.CSM_OPENSSL_LEGACY && parseInt(process.versions.node.split('.')[0], 10) >= 17) {
  // 透传原始 CLI 参数，保证 respawn 后行为一致
  const child = require('child_process')
    .spawn(process.execPath, ['--openssl-legacy-provider', __filename].concat(process.argv.slice(2)), { stdio: 'inherit', env: Object.assign({}, process.env, { CSM_OPENSSL_LEGACY: '1' }) });
  child.on('close', code => process.exit(code));
  child.on('error', err => { console.error(err); process.exit(1); });
  return;
}

process.env.CHINER_NODE_ENV = 'development';
var path = require('path');
var childProcess = require('child_process');
var webpack = require('webpack');
var config = require('../config/webpack.dev.config.js');
var profile = require('../profile');
var host = profile.host;
var port = profile.port;
var protocol = profile.protocol;
var WebpackDevServer = require('webpack-dev-server');

config.entry.app.unshift(`webpack-dev-server/client?${protocol}://${host}:${port}/`);

var compiler = webpack(config);

var devServer = new WebpackDevServer(compiler, {
    stats: { colors: true },
    contentBase: path.resolve(__dirname, '../public'),
});

devServer.listen(port, host, function () {
    // 启动electron
    childProcess.spawn('npm', ['run', 'electron'], { shell: true, env: process.env, stdio: 'inherit' })
      .on('close', code => process.exit(code))
      .on('error', spawnError => console.error(spawnError));
});
