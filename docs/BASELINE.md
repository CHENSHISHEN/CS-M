# CS-M 0.5.0 源码基线

> 当前版本以 `package.json` 的 `version` 为准：**0.5.0**（标签 `v0.5.0`）。`main` 上另有 v0.5.0 之后合入、尚未发布的修改，汇总在 [CHANGELOG](../CHANGELOG.md) 的“未发布（Unreleased）”节；尚未实现的能力列在 [ROADMAP](./ROADMAP.md)。下方“历史记录（0.1.0）”保留首发时的原始基线说明，不代表当前状态。

## 基线来源与许可

CS-M 基于 [PDManer 4.9.4](https://github.com/roberGroup/PDManer) 的源码二次开发，继续采用仓库根目录的 MulanPubL-2.0 许可证。上游来源和版权声明见 [NOTICE](../NOTICE)，第三方组件见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。公开源码必须保留上游及第三方的许可与版权归属。

在上游关系建模（逻辑实体、物理表、ER 关系图、字典、数据库类型与代码模板、数据库连接/逆向、DDL、导入导出、版本与规则检查）之上，0.1.0～0.5.0 依次叠加了新工作台、字段推荐与数据标准、数仓模型目录与概念建模、业务建模与画图平台、Chen ER 画板与绘图持久化、企业建模、指标平台与平台 AI。各能力的当前口径以 [README](../README.md) 与 [CHANGELOG](../CHANGELOG.md) 为准，本文不重复列举。

## 兼容约束（不可替换）

产品名称、界面、应用元数据与安装包名称统一使用 **CS-M**；但下列上游名称属于兼容所需的技术标识，不作为产品品牌，也**不能**通过全仓字符替换改名，否则旧工程无法打开或与旧版应用互相破坏：

| 位置 | 保留内容 | 原因 |
| --- | --- | --- |
| README、NOTICE、LICENSE、第三方声明 | PDManer 4.9.4 及真实来源 | 说明二次开发来源，保留许可与版权归属（MulanPubL-2.0） |
| 主进程与 `public/jar/` | `pdmaner-java.jar` 及其内部包名 | 沿用上游 Java 工具，保持二进制原样和兼容性 |
| 工程文件格式 | `.pdma.json` 等已有工程格式 | 继续读写旧工程 |
| 导入分派、语言键和兼容文件说明 | `PDManer`、`importPDManer` 等历史格式标识 | 读取旧工程，不作为当前产品名称 |
| 项目文件保护 | `.pdmaner-write-lock` | 与旧版应用协同防止并发写入同一工程；未发布版本起锁内容扩展为 `{pid,startTime,host,createdAt}`，仍兼容旧的 `{pid}` |
| Excel 品牌适配器及其测试 | 旧表头的精确识别字符串 | 识别上游动态输出并转换为 CS-M，保留用户备注不变 |

内置代码模板生成的 C# 命名空间使用 `CSM.Application`（代码标识符不使用连字符）。样式类前缀和工程格式等技术标识保留兼容性，不进行破坏性的全仓字符替换。旧数据须原样可打开（例如指标平台的旧 `h<8hex>` 哈希、重复的“1.0”版本号、没有高水位的恢复日志）。

## 仓库边界

- 纳入版本管理：完整清单以 `git ls-files` 为准；主要包括 `src/`、`public/`（含 `public/jar/`、`public/file/`、`public/asset/`）、`bin/`、`config/`、`app/`（第二套运行时依赖清单与锁文件）、`vendor/xlsx-0.20.3.tgz`、`assets/branding/`、`.github/`、`docs/`、`tests/`，根目录的 `package.json`/`package-lock.json`、`profile.js`、`.babelrc`、`.eslintrc`、`.npmrc` 等构建配置，以及 README/CHANGELOG/LICENSE/NOTICE/THIRD_PARTY_NOTICES。
- 不纳入：`node_modules/`、`build/`、`app/build/`、`dist/` 等可再生成的依赖与构建产物；缓存、日志、IDE 配置与本地 agent 状态；真实业务工程、数据库凭据、私钥、签名证书。具体规则以 `.gitignore` 为准；`.gitignore` 只约束未跟踪文件，提交前仍需检查暂存内容，不要用 `git add -f` 绕过。
- 安装包不进入源码仓库，通过 GitHub Releases 附件分发；源码构建与测试方式见 [ACCEPTANCE.md](./ACCEPTANCE.md)。

## 历史记录（0.1.0）

以下为 0.1.0 首发时的原始基线说明，按原文保留（仅调整标题层级），其中“当前”“本次”均指 0.1.0。

### CS-M 0.1.0 首发源码基线

#### 基线来源

CS-M 基于 [PDManer 4.9.4](https://github.com/roberGroup/PDManer) 的源码二次开发，继续采用仓库根目录的 MulanPubL-2.0 许可证。上游来源和版权声明见 [NOTICE](../NOTICE)。本次按功能范围重建首次提交候选，不能将其理解为某个历史日期的完整源码快照。

保留上游关系建模、原有逻辑实体、物理表、ER 关系图、透视、字典、数据库类型与代码模板、数据库连接/逆向、DDL、导入导出、版本与规则检查能力；叠加字段推荐、数据标准库、新工作台和相关基础可靠性改进。工作台只提供新布局，不提供经典布局切换。

本基线聚焦于当前发布的核心关系建模、数据标准与工作台能力，旧工程文件格式的兼容读入遵循此范围。

#### 品牌与必要兼容信息

产品名称、界面、项目说明、应用元数据、安装包名称统一使用 **CS-M**。项目 Logo 与应用图标均来自 chen 指定的第二张图；原图位于 [assets/branding/logo.png](../assets/branding/logo.png)，应用图标是由它转换而来。

公开源码仍须保留上游及第三方的许可与版权归属。导入文件的兼容分派、数据结构标识以及上游 Java 工具的内部技术名称不能通过盲目替换而破坏兼容性；这些技术信息不作为 CS-M 的产品品牌。保留 `.pdma.json` 等已有工程格式。

仓库内不携带原项目 Git 历史、真实业务工程、旧测试截图和旧协作记录。原目录保持原样，CS-M 是独立仓库，安装与运行无需原目录存在。

#### 提交与发布边界

当前为 v0.1.0 发布版本。安装包构建产物通过 GitHub Releases 附件分发，源码与必要运行资源纳入仓库管理。实际验证记录和 UAT 入口另见验收文档。

##### 首次提交文件范围

| 范围 | 是否提交 | 说明 |
| --- | --- | --- |
| `src/`、`public/`、`bin/`、`config/`、`profile.js` | 是 | 产品源码、运行资源与构建脚本；排除下述旧更新描述 |
| 根目录与 `app/` 下的 `package.json`、`package-lock.json` | 是 | 两套依赖清单与锁文件都用于可复现构建，不要忽略整个 `app/` |
| `vendor/xlsx-0.20.3.tgz` | 是 | `package.json` 直接引用的本地依赖，不能按压缩包统一排除 |
| `public/jar/`、`public/file/`、`src/lib/template/` | 是 | Java 工具、Office 模板与内置通用工程示例，不能按 jar、Office 或工程文件扩展名统一排除 |
| `assets/branding/`、`public/branding/` 与应用图标 | 是 | 项目 Logo 和构建图标；仅排除 `assets/branding/app.iconset/` 转换中间目录 |
| `.github/`、Babel/ESLint 配置、`.npmrc` | 是 | CI 与公共开发配置；当前 `.npmrc` 只有公共镜像及安装选项，禁止加入 token 或账号密码 |
| README、CHANGELOG、LICENSE、NOTICE、THIRD_PARTY_NOTICES、`docs/`、`tests/` | 是 | 产品说明、许可归属、验收说明及测试源码；运行报告另放 `dist/` 等忽略目录 |
| `node_modules/`、`build/`、`app/build/`、`dist/` | 否 | 可重新生成的依赖、构建产物、安装包与本地验收证据；安装包以后通过 Release 分发 |
| `src/dev-app-update.yml` | 否 | 未被当前源码引用的上游 3.5.4 开发更新描述，不属于本次发布配置 |
| 缓存、日志、IDE 配置、agent 本地状态、图标转换中间文件 | 否 | 由 `.gitignore` 排除 |
| 真实业务工程、数据库凭据、私钥、签名证书、个人截图与导出 | 否 | 本地资料统一放 `local/` 或 `scratch/`；敏感材料放 `secrets/` 或仓库外，不能混入示例、文档或源码 |

根目录的个人 `.pdma.json` / `.chnr.json` 工程文件会被忽略，`src/lib/template/` 中的通用模板仍会提交。`.env` 与其本机变体被忽略，允许提交不含真实值的 `.env.example`、`.env.*.example`、`.env.sample`。

`.gitignore` 只约束未跟踪文件，不能清除已提交历史，也不能识别写在普通源码或 JSON 中的密码。提交前仍应检查暂存内容，特别是工程连接信息和环境示例；不要使用 `git add -f` 绕过以上边界。

#### 保留的上游名称白名单

| 位置 | 保留内容 | 原因 |
| --- | --- | --- |
| README、NOTICE、LICENSE、第三方声明 | PDManer 4.9.4 及真实来源 | 说明二次开发来源，保留许可与版权归属 |
| 主进程与 `public/jar/` | `pdmaner-java.jar` 及其内部包名 | 沿用上游 Java 工具，保持二进制原样和兼容性 |
| 导入分派、语言键和兼容文件说明 | `PDManer`、`importPDManer` 等历史格式标识 | 读取旧工程，不作为当前产品名称 |
| 项目文件保护 | `.pdmaner-write-lock` | 与旧版应用协同防止并发写入同一工程 |
| Excel 品牌适配器及其测试 | 旧表头的精确识别字符串 | 识别上游动态输出并转换为 CS-M，保留用户备注不变 |

内置代码模板生成的 C# 命名空间使用 `CSM.Application`（代码标识符不使用连字符）。样式类前缀和工程格式等技术标识保留兼容性，不进行破坏性的全仓字符替换。
