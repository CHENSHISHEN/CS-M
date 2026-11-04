<p align="center">
  <img src="assets/branding/logo.png" width="180" alt="CS-M logo" />
</p>

# CS-M

CS-M 是一款开源的桌面端数据建模与业务画图设计工具，面向数据平台建设与业务系统架构中的结构设计、业务建模、图谱绘制与交付场景。本项目基于开源项目 [PDManer](https://github.com/roberGroup/PDManer) v4.9.4 进行二次开发，当前发布 **v0.3.0 版本**。

## 功能特性

### v0.3.0 新增核心能力（业务建模与分类画图平台）

- **多模块协同架构（Multi-Module Architecture）**：
  - 在数据建模（Data Modeling）基础上，原生集成业务建模（Business Modeling）与画图平台（Drawing Platform）两大核心模块。
  - 支持按项目需要灵活启用/切换模块，提供主工作台顶部导航切换、首页模块卡片与分类过滤。
  - 内置工程文件读写守卫与只读安全保护，保障多模块共存下的数据持久化安全。
- **业务建模工作台（Business Modeling）**：
  - **业务对象（Business Objects）**：支持高阶业务领域实体定义与属性抽象，衔接业务语义与底层数据模型。
  - **业务流程（Business Processes）**：提供可视化流程图编排设计，支持泳道、活动节点、判定分支与流转连线。
  - **业务规则与职责（Rules & Roles）**：支持业务逻辑判定规则结构化表达，提供参与者角色定义与职责矩阵管理。
- **分类画图平台（Drawing Platform）**：
  - **9 大专业图种体系**：全面覆盖概念 ER（Chen ER）、思维导图（Tree）、时序图（Sequence）、系统架构图、业务流程图、网络拓扑图、UML 用例图、组织结构图及自由白板（Graph）。
  - **24 个即开即用起始模板**：内置各图种典型场景模板（涵盖借阅、选课、电商、权限、部署拓扑等），支持一键初始化与自由修改。
  - **专用可视化编辑器**：针对自由拓扑（Graph）、层级树（Tree）、交互时序（Sequence）提供专用编辑画布与属性检查器，支持样式主题、图层管理与语义检查。
  - **纯 JSON 文档格式与多画布**：单文档多画布支持、矢量 SVG/PNG 高清导出、本机草稿自动保存与恢复机制。

### v0.2.0 核心能力（数仓模型目录与概念建模）

- **数仓分层模型目录（Model Catalog）**：支持多层数仓模型分层（如 ODS / DWD / DWS / ADS / DIM 等自定义分层）与数据域/主题域分类管理，统一纳管概念实体、逻辑实体与物理表，支持多重归属及旧主题域待归档投影。
- **概念实体建模（Concept Entities）**：支持高阶业务概念抽象建模，提供独立概念实体编辑器、专属紫色卡片标识、实体级 12/18 端口连接，以及独立集合存储，不强制依赖底层物理字段。
- **概念 / 逻辑 / 物理（C/L/P）三层模型与关系图**：
  - **图级别强约束**：概念图（C）、逻辑图（L）、物理图（P）分别对应接收各自层级的实体与节点，防止跨层级错乱拖拽。
  - **多视图联动与反查**：支持按模型层级快速检索、反查定位所属关系图与目录节点，保存/导出时保持 ID 与目录引用完整。
- **工作台资源树增强**：左侧统一模型目录树支持按上下文快捷新建对应层级对象、分层折叠展开、分类筛选及快捷全局搜索。

### 基础核心能力（v0.1.0 继承）

- **关系数据建模**：物理表与逻辑实体的设计、ER 关系图（基于图编辑能力）
- **数据库管理**：多数据库支持、在线/离线 DDL 生成与执行、结构逆向（从数据库反向导入）
- **数据透视**：对表与字段的多维度透视查看
- **数据类型与字典**：数据库方言类型映射、数据字典管理
- **字段标准（数据标准）与规则**：标准字段/数据标准管理、命名与校验规则
- **字段推荐**：录入字段时依据标准字典/已有模型给出推荐
- **版本管理与导入导出**：工程版本管理、工程/模块导入导出，与 PDManer 工程文件格式保持导入兼容
- **新工作台 UI**：重构后的现代化工作台界面（替代旧版经典布局）

## 平台支持

| 平台 | 架构 | 安装包格式 | 说明 |
| --- | --- | --- | --- |
| Windows | x64 | NSIS 安装包（.exe） | 本版本默认提供 x64 |
| macOS | arm64（Apple Silicon） | DMG | 支持 Apple M 系列芯片 |
| macOS | x64（Intel） | DMG | 支持 Intel 芯片 |
| Linux | — | — | 保留了构建配置，本版本暂未提供预编译安装包 |

> Windows arm64 安装包未经实际验证，本版本不提供、不宣称支持。

## 下载与安装

官方发布入口为 GitHub Releases：<https://github.com/CHENSHISHEN/CS-M/releases>。

请在 Release 页面下载对应操作系统的安装包：
- **Windows (x64)**：`CS-M-win_x64_v0.3.0.exe`
- **macOS Apple Silicon (arm64)**：`CS-M-mac_arm64_v0.3.0.dmg`
- **macOS Intel (x64)**：`CS-M-mac_x64_v0.3.0.dmg`

校验文件（SHA-256）可同步在 Release 页面下载 `SHA256SUMS.txt` 进行比对。

> 说明：本项目未配置商业代码签名证书，产物为未签名安装包；macOS 首次打开需在“系统设置 - 隐私与安全性”中允许，Windows SmartScreen 可能提示未知发布者。也可以通过源码自行构建获取安装包。

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
