# CS-M 0.1.0 首发候选验收记录

日期：2026-10-30。状态：**实现与技术验收完成，待 chen UAT；已获授权将首发源码提交并推送至 GitHub PR，安装包尚未正式发布。**

## 本地候选

| 系统 | 本地安装包 | 构建与验证 |
| --- | --- | --- |
| Windows x64 | `dist/CS-M-win_x64_v0.1.0.exe` | NSIS 实际构建成功；应用 PE 为 x64；版本、产品身份及多尺寸图标通过；未在 Windows 系统安装运行 |
| macOS Apple Silicon | `dist/CS-M-mac_arm64_v0.1.0.dmg` | DMG 完整性通过；实际包内 App 启动并通过 8 项 GUI 冒烟 |
| macOS Intel | `dist/CS-M-mac_x64_v0.1.0.dmg` | DMG 完整性通过；x64 App 在 Apple Silicon 主机经 Rosetta 启动并通过相同 8 项；未在 Intel 物理设备单独验证 |

可直接打开的本地应用：`dist/mac-arm64/CS-M.app` 或 `dist/mac/CS-M.app`。安装包均未使用发布者证书签名，也未做 Apple 公证。

产物大小、SHA-256 和对应源码指纹在本地 `dist/ARTIFACTS.json`；安装包校验列表为 `dist/SHA256SUMS.txt`。这些本地构建产物被 Git 忽略，不会随首次源码提交上传，正式下载入口待 UAT 后发布。

## 基线与品牌审查

- 新工作台为唯一布局，经典头部和布局切换已从源码剥离。后期独立概念目录、企业首页/总览、业务/画图/AI/指标模块已排除。
- 产品界面、元数据、Logo、安装包、外置 Excel 模板表头与动态 Excel 产品表头已采用 CS-M；代码模板生成的 C# 命名空间为合法标识符 `CSM.Application`。
- 图二原图 SHA-256：`602fa59bc1cafe0b4cd945a1f52b7cc123eb1a45c98052148df4638653a4493e`。README 与图标均由该原图提供，未重新绘制 Logo。
- macOS 的两个 App 内 `.icns` 与项目图标一致；Windows PE 的图标资源包含 `.ico` 中的全部尺寸。
- 上游 LICENSE 字节保持不变，SHA-256 为 `7c91afc2c15fc478de3fc38f2678e560906859da6932f2c03b6bc9076d592d18`。三个候选包均包含相同的 LICENSE、NOTICE、第三方声明与本项目源码入口。
- 必须保留的上游归属和兼容技术字符串见 [BASELINE.md](./BASELINE.md) 白名单；未将这些必要信息伪装成自己的原创。
- 原 PDManer 的 627 个源码/资产指纹复核零改动。CS-M 已使用独立依赖目录，不依赖原 PDManer 的 `node_modules`。
- CS-M 首发源码以原有 README 初始提交为父提交，通过独立分支和 PR 提交，不改写既有历史；构建产物与本地数据不进入源码提交。

本候选产品源码指纹（486 个源码、资产、构建/依赖/许可文件）：

`87dd7dfa1974ade7397a5c753d947c8e4ab664afcfdea0ff0ca491d928e78bbe`

逐文件清单在本地 `dist/acceptance/source-manifest.json`。这是本地候选包对应的产品源码树指纹，不能将既有 README 初始提交当作本次产品源码版本；文档与忽略规则不在该产品指纹范围内。

## 已完成验证

环境：macOS 15.7.5 / arm64，Node 24.11.1，npm 11.6.2，OpenJDK 25.0.1；Electron 13.1.7，electron-builder 23.3.3。

1. 独立临时目录的锁文件安装通过，依赖安装脚本通过；根依赖和 app 运行时依赖随后独立落到 CS-M 目录。
2. 生产 webpack 构建通过；Windows NSIS x64 与 macOS 两套 DMG 实际构建通过。
3. 字段推荐/标准应用/词元交换 6 项、工程外部冲突与并发锁 3 项、保存状态与异步编辑保护 6 组通过。
4. 动态 Excel：实际 Java 生成 → 品牌表头适配 → ZIP 非目标条目逐字节保持 → SheetJS 回读 → Java 重导入，实体、字段、用户备注均保留，Java 工具本身未改动。
5. 最终两个 Mac App 分别通过 8 项 GUI：品牌与 Logo 尺寸；空项目创建落盘；兼容工程直接进入新工作台；属性/状态栏几何位置；基线模块往返；编辑与保存退脏；真实 ER 节点/连线；1280/1440 窗口适配。各报告均无 renderer 异常。
6. 最终 Mac DMG 校验通过；NSIS 容器可读且文件测试无解压错误（7-Zip 有 NSIS 尾随数据提示，不将其当作 Windows 运行验证）。

本地 GUI 证据：`dist/acceptance-mac-arm64/`、`dist/acceptance-mac-x64/`。截图是通用样例和临时合成项目，未使用真实业务工程。

## 待 UAT 与验证边界

- Windows 实机安装、启动、卸载与文件操作；Intel Mac 物理设备验证。
- 使用存量工程副本进行业务验收；真实数据库连接/逆向需测试连接环境。
- 冒烟和合成测试不代表逐一验过全部数据库方言、全部导出类型和所有边界输入。
- 未升级上游 Electron/React 等依赖大版本；安全升级和公开签名/公证不在本次基线提取范围。

UAT 按 [UAT.md](./UAT.md) 执行。源码 PR 已获 chen 授权，安装包正式发布仍待 UAT 通过及发布授权。
