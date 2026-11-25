# CS-M 0.5.0 验收记录

> 当前版本以 `package.json` 的 `version` 为准：**0.5.0**。本记录的验收对象是 `main` 源码（v0.5.0 加上 [CHANGELOG](../CHANGELOG.md)“未发布（Unreleased）”节所列、尚未发布的修改）。下方“历史记录（0.1.0）”保留首发时的原始验收记录，不代表当前状态。

日期：2026-11-24。状态：**本环境内自动化测试与生产构建通过；未做任何 GUI/Electron 验证；本次未打包安装包。**

环境：Linux x86_64（内核 6.12），Node 24.22.1，npm 11.19.1，未安装 Java。

## 验收依据

1. **`npm test`**（即 `node tests/run-all.cjs`）：按 `TESTS` 清单逐个运行 40 个测试文件，每个文件在独立子进程中运行并汇总 PASS/FAIL/SKIP，任一 FAIL 则退出码非零。这些都是 Node 脚本形式的**单元测试、契约测试与源码静态断言**，不启动 Electron、不操作界面。其中 `tests/test-metric-platform.cjs` 会在内部再运行 `tests/metrics/` 下的 core/dictionary/binding/lineage 测试；`tests/workbook-branding.cjs` 依赖 Java，未安装 Java 时显式 SKIP（本环境即为 SKIP）。本环境运行结果：除该 SKIP 外其余全部 PASS，无 FAIL。
2. **`npm run build`**：webpack 生产构建在本环境通过（输出 `build success`）。
3. **CI**：`.github/workflows/test.yml` 在 pull request 与推送 `main` 时于 ubuntu-latest / Node 24 上执行 `npm ci` 与 `npm test`（未装 Java，`workbook-branding` 同样 SKIP），并以“仅报告、不阻塞”方式运行 `npm audit --omit=dev`。`build-macos.yml`、`build-windows.yml` 在推送 `main` 时构建安装包。本文不记录这些工作流的运行结果，以 GitHub Actions 页面为准。
4. `tests/gui-smoke.cjs` 依赖 Playwright 与 Electron，不在 `npm test` 内，本次未运行。

## 未验证的范围

- **GUI/Electron**：本环境没有做任何界面验证。以下区域只有逻辑或源码层面的测试，界面行为待按 [UAT.md](./UAT.md) 人工验收：业务流程连接桩显示/隐藏、外链处理与导航守卫、窗口最小尺寸、ErrorBoundary 兜底界面、修改 AI 端点后重新输入 key、指标平台页面（就绪状态、版本页完整性检查与审计、丢弃草案、废弃与失效绑定）、画图持久化（工程文件缺失、恢复日志高水位、单实例）、前向工程向导与空项目上手引导。
- **安装包**：本次未打包；未在 Windows、macOS 实机安装运行。
- **Java 相关能力**：Word/Excel 导入导出、DDL 文件解析、数据库连接/逆向在本环境未验证；真实数据库连接需专用连接环境。

## 已知限制

- **安全加固未完成**：ARCH-02（渲染进程 `nodeIntegration` 仍开启，未启用 `contextIsolation` 与 preload）与 ARCH-05（规则脚本仍以 `new Function` 执行）均未修复，留待 Phase 3；尚未配置 CSP（内容安全策略）。见 [ROADMAP.md](./ROADMAP.md)。
- 备注中 `file:` 或 Windows 路径的图片不再显示。
- 指标平台：原子指标的计算绑定未设时间字段映射时显示“未就绪”，目前只能解除后重建绑定；整表删除尚未接入绑定失效标记。
- 画图持久化：`anchor.json` 损坏后第二次打开不再保持损坏状态；锁回收时可能短暂出现 `.reclaim-mutex`/`.reclaim-*` 文件，极少数情况下因崩溃残留。
- `npm audit` 仅报告，不阻塞 CI；本文不记录审计结果。

## 历史记录（0.1.0）

以下为 0.1.0 首发时的原始验收记录，按原文保留（仅调整标题层级），其中的日期、环境、产物与结论均只适用于 0.1.0。

### CS-M 0.1.0 首发候选验收记录

日期：2026-10-30。状态：**实现与技术验收完成，安装包发布至 GitHub Releases。**

#### 本地候选

| 系统 | 本地安装包 | 构建与验证 |
| --- | --- | --- |
| Windows x64 | `dist/CS-M-win_x64_v0.1.0.exe` | NSIS 实际构建成功；应用 PE 为 x64；版本、产品身份及多尺寸图标通过；未在 Windows 系统安装运行 |
| macOS Apple Silicon | `dist/CS-M-mac_arm64_v0.1.0.dmg` | DMG 完整性通过；实际包内 App 启动并通过 8 项 GUI 冒烟 |
| macOS Intel | `dist/CS-M-mac_x64_v0.1.0.dmg` | DMG 完整性通过；x64 App 在 Apple Silicon 主机经 Rosetta 启动并通过相同 8 项；未在 Intel 物理设备单独验证 |

可直接打开的本地应用：`dist/mac-arm64/CS-M.app` 或 `dist/mac/CS-M.app`。安装包均未使用发布者证书签名，也未做 Apple 公证。

产物大小、SHA-256 和对应源码指纹在本地 `dist/ARTIFACTS.json`；安装包校验列表为 `dist/SHA256SUMS.txt`。这些本地构建产物被 Git 忽略，不会随首次源码提交上传，正式下载入口待 UAT 后发布。

#### 基线与品牌审查

- 新工作台为唯一布局，经典头部和布局切换已从源码剥离。
- 产品界面、元数据、Logo、安装包、外置 Excel 模板表头与动态 Excel 产品表头已采用 CS-M；代码模板生成的 C# 命名空间为合法标识符 `CSM.Application`。
- 图二原图（透明背景）SHA-256：`0a999e98e0a5fd4d3811f8481f8949038202b25c0ca6f3b06b149c42f9ce4d94`。README 与图标均由该原图提供，未重新绘制 Logo。
- macOS 的两个 App 内 `.icns` 与项目图标一致；Windows PE 的图标资源包含 `.ico` 中的全部尺寸。
- 上游 LICENSE 字节保持不变，SHA-256 为 `7c91afc2c15fc478de3fc38f2678e560906859da6932f2c03b6bc9076d592d18`。三个候选包均包含相同的 LICENSE、NOTICE、第三方声明与本项目源码入口。
- 必须保留的上游归属和兼容技术字符串见 [BASELINE.md](./BASELINE.md) 白名单；未将这些必要信息伪装成自己的原创。
- 原 PDManer 的 627 个源码/资产指纹复核零改动。CS-M 已使用独立依赖目录，不依赖原 PDManer 的 `node_modules`。
- CS-M 首发源码以原有 README 初始提交为父提交，通过独立分支和 PR 提交，不改写既有历史；构建产物与本地数据不进入源码提交。

本候选产品源码指纹（486 个源码、资产、构建/依赖/许可文件）：

`87dd7dfa1974ade7397a5c753d947c8e4ab664afcfdea0ff0ca491d928e78bbe`

逐文件清单在本地 `dist/acceptance/source-manifest.json`。这是本地候选包对应的产品源码树指纹，不能将既有 README 初始提交当作本次产品源码版本；文档与忽略规则不在该产品指纹范围内。

#### 已完成验证

环境：macOS 15.7.5 / arm64，Node 24.11.1，npm 11.6.2，OpenJDK 25.0.1；Electron 13.1.7，electron-builder 23.3.3。

1. 独立临时目录的锁文件安装通过，依赖安装脚本通过；根依赖和 app 运行时依赖随后独立落到 CS-M 目录。
2. 生产 webpack 构建通过；Windows NSIS x64 与 macOS 两套 DMG 实际构建通过。
3. 字段推荐/标准应用/词元交换 6 项、工程外部冲突与并发锁 3 项、保存状态与异步编辑保护 6 组通过。
4. 动态 Excel：实际 Java 生成 → 品牌表头适配 → ZIP 非目标条目逐字节保持 → SheetJS 回读 → Java 重导入，实体、字段、用户备注均保留，Java 工具本身未改动。
5. 最终两个 Mac App 分别通过 8 项 GUI：品牌与 Logo 尺寸；空项目创建落盘；兼容工程直接进入新工作台；属性/状态栏几何位置；基线模块往返；编辑与保存退脏；真实 ER 节点/连线；1280/1440 窗口适配。各报告均无 renderer 异常。
6. 最终 Mac DMG 校验通过；NSIS 容器可读且文件测试无解压错误（7-Zip 有 NSIS 尾随数据提示，不将其当作 Windows 运行验证）。

本地 GUI 证据：`dist/acceptance-mac-arm64/`、`dist/acceptance-mac-x64/`。截图是通用样例和临时合成项目，未使用真实业务工程。

#### 待 UAT 与验证边界

- Windows 实机安装、启动、卸载与文件操作；Intel Mac 物理设备验证。
- 使用存量工程副本进行业务验收；真实数据库连接/逆向需测试连接环境。
- 冒烟和合成测试不代表逐一验过全部数据库方言、全部导出类型和所有边界输入。
- 未升级上游 Electron/React 等依赖大版本；安全升级和公开签名/公证不在本次基线提取范围。

UAT 按 [UAT.md](./UAT.md) 执行。源码已合并至 main 分支，安装包通过 GitHub Releases 分发。
