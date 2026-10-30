<p align="center">
  <img src="assets/branding/logo.png" width="180" alt="CS-M logo" />
</p>

# CS-M

CS-M 是一款开源的桌面端数据建模工具，面向数据平台建设中的表结构设计、管理与交付场景。本项目基于开源项目 [PDManer](https://github.com/roberGroup/PDManer) v4.9.4 进行二次开发，当前发布 **v0.1.0 首发候选版本**。

## 功能范围（v0.1.0 基线）

包含的核心能力：

- **关系数据建模**：上游表（物理表）与逻辑实体的设计、ER 关系图（基于图编辑能力）
- **数据库管理**：多数据库支持、在线/离线 DDL 生成与执行、结构逆向（从数据库反向导入）
- **数据透视**：对表与字段的多维度透视查看
- **数据类型与字典**：数据库方言类型映射、数据字典管理
- **字段标准（数据标准）与规则**：标准字段/数据标准管理、命名与校验规则
- **字段推荐**：录入字段时依据标准字典/已有模型给出推荐（本版本新增）
- **版本管理与导入导出**：工程版本管理、工程/模块导入导出，与 PDManer 工程文件格式保持导入兼容
- **新工作台 UI**：重构后的工作台界面（本版本新增，替代旧版经典布局）

明确**不包含**的能力（本基线已移除或从未纳入，请注意甄别）：

- 独立概念模型设计、数仓分层目录
- 企业总览、业务建模
- 独立画图平台
- AI 辅助能力（含外部大模型接入）
- 指标管理

## 平台支持

| 平台 | 架构 | 安装包格式 | 说明 |
| --- | --- | --- | --- |
| Windows | x64 | NSIS 安装包（.exe） | 本版本默认且仅提供 x64 |
| macOS | arm64（Apple Silicon） | DMG | 可单独构建 |
| macOS | x64（Intel） | DMG | 可单独构建 |
| Linux | — | — | 保留了构建配置，但本版本未做验证，不在支持范围内 |

> Windows arm64 安装包未经实际验证，本版本不提供、不宣称支持。

## 下载

- **当前状态**：v0.1.0 为首发候选版本，**尚未发布任何安装包**。官方发布入口为 GitHub Releases：<https://github.com/CHENSHISHEN/CS-M/releases>。在正式发布前，该页面没有任何资产，请勿相信任何第三方提供的"CS-M 安装包"下载源。
- 本地候选包已构建，文件名和验证范围见 [验收记录](docs/ACCEPTANCE.md)。在正式发布前，也可以通过源码构建获取候选安装包，步骤见下文"从源码构建安装包"。

## 环境要求与源码开发

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | 本次验证环境：24.11.1 | 构建脚本已内置 webpack 4 与新版 Node/OpenSSL 3 的兼容处理（自动以 `--openssl-legacy-provider` 启动），无需手工设置环境变量；其他版本需通过 preflight 和实际构建验证 |
| npm | 本次验证环境：11.6.2 | 使用仓库锁文件执行 `npm ci` |
| Java（可选） | JRE/JDK 8+ | 以下能力依赖 Java（内置 `pdmaner-java.jar`，通过 `java` 命令或应用内设置的 JAVA_HOME 调用）：**Word 文档导出、Excel 导入/导出（含标准字段 Excel）、PowerDesigner/DDL 文件导入解析、数据库连接/逆向工程/在线执行 DDL**。未安装 Java 时上述功能不可用，但建模、ER 图、工程文件（.chnr/.json）保存与导入导出、Markdown/HTML 导出、数据字典、版本管理等不依赖 Java，仍可正常使用 |

开发步骤：

```bash
git clone https://github.com/CHENSHISHEN/CS-M.git
cd CS-M
npm ci                       # 安装根目录依赖（含构建链，与 CI 一致）
npm ci --prefix app          # 安装应用运行时依赖（双 package 布局）
npm start                    # 启动开发模式（webpack dev server + Electron）
```

## 从源码构建安装包

先执行前置检查（可选但推荐）：

```bash
npm run preflight -- win          # 检查 Windows 包构建条件
npm run preflight -- mac-arm64    # 检查 macOS arm64 包构建条件
```

构建产物输出到 `dist/` 目录：

```bash
npm run package-win          # Windows NSIS x64（.exe）
npm run package-mac-arm64    # macOS Apple Silicon（.dmg）
npm run package-mac-x64      # macOS Intel（.dmg）
npm run package-mac          # macOS 双架构各出一个 .dmg
```

说明：

- **macOS 交叉构建 Windows**：本次 electron-builder 23.3.3 实际构建会自动下载 Wine 等兼容工具到构建缓存，无需全局手工安装 Wine。Apple Silicon 主机需能运行 x86_64 构建工具（本机 Rosetta 检查通过）；也可使用仓库的 Windows 原生 CI 工作流。Windows 安装包的构建验证与实机安装运行验证分别记录。
- 首次打包需联网下载 Electron 运行时与 NSIS 等构建工具（国内网络已在 `.npmrc` 配置镜像）。
- 本项目未配置代码签名证书，产物为**未签名**安装包；macOS 首次打开需在"系统设置-隐私与安全性"中允许，Windows SmartScreen 可能提示未知发布者。
- `npm run build` 仅产出 Web/主进程构建文件到 `app/build`，不打安装包。

## 与上游 PDManer 的关系与致谢

- CS-M 基于 [PDManer](https://github.com/roberGroup/PDManer)（v4.9.4）二次开发，继承并保留了其关系建模、ER 图、多数据库方言、数据字典等核心能力，在此对原作者及社区贡献者表示感谢。
- 上游与其修改均遵循 [木兰公共许可证 第2版（MulanPubL-2.0）](./LICENSE)，本项目的修改同样以 MulanPubL-2.0 提供。
- 第三方组件声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 与 [NOTICE](./NOTICE)。
- **随包法律文件与源码获取**：构建产物（`app/build`，随安装包分发）内附 `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md`；对应完整源码见本仓库 <https://github.com/CHENSHISHEN/CS-M>（当前未发布任何 Release，获取方式为克隆源码自行构建）。

## 许可证

[木兰公共许可证 第2版（MulanPubL-2.0）](./LICENSE)，与上游保持一致。

## 基线与验收

- [首发基线与兼容边界](docs/BASELINE.md)
- [构建与验收记录](docs/ACCEPTANCE.md)
- [UAT 操作说明](docs/UAT.md)

功能截图后续补充。
