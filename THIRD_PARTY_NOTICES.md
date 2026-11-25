# 第三方组件声明（Third Party Notices）

CS-M 构建与运行使用了以下第三方组件。各组件的完整许可证文本以其发布包内的
LICENSE / NOTICE 文件为准。上游 [PDManer](https://github.com/roberGroup/PDManer)
v4.9.4 已包含其中大部分依赖。

版本与许可证口径：npm 依赖的版本为 `package-lock.json` 实际解析并安装到 `node_modules`
的版本，许可证照录各包 `package.json` 的 `license` 字段（`tests/test-docs-claims.cjs`
逐行比对；`package.json` 的每个直接依赖都必须在下表列出）。

## 运行时依赖（随应用分发）

| 组件 | 版本 | 许可证 | 说明 |
| --- | --- | --- | --- |
| `react` | 16.8.6 | MIT | |
| `react-dom` | 16.8.6 | MIT | |
| `react-redux` | 7.1.0 | MIT | |
| `redux` | 4.0.4 | MIT | |
| `redux-thunk` | 2.3.0 | MIT | |
| `redux-logger` | 3.0.6 | MIT | 仅开发环境启用 |
| `react-router-dom` | 5.0.1 | MIT | |
| `prop-types` | 15.6.1 | MIT | |
| `react-ace` | 9.4.1 | MIT | |
| `ace-builds` | 1.44.0 | BSD-3-Clause | `react-ace` 的依赖（代码编辑器内核） |
| `react-color` | 2.18.1 | MIT | |
| `react-window` | 1.8.9 | MIT | |
| `react-vtree` | 3.0.0-beta.3 | MIT | |
| `react-virtualized-auto-sizer` | 1.0.20 | MIT | |
| `@antv/x6` | 1.18.3 | MIT | |
| `@antv/hierarchy` | 0.6.8 | MIT | |
| `@antv/x6-react-shape` | 1.3.5 | MIT | |
| `lodash` | 4.18.1 | MIT | |
| `jquery` | 3.2.1 | MIT | `public/asset/jquery/jquery.min.js` 另有同版本副本 |
| `moment` | 2.31.0 | MIT | |
| `marked` | 2.1.3 | MIT | |
| `dompurify` | 2.5.8 | (MPL-2.0 OR Apache-2.0) | HTML 注入点清洗 |
| `node-sql-parser` | 5.3.13 | Apache-2.0 | SQL DDL 解析 |
| `numeral` | 2.0.6 | MIT | |
| `dot` | 1.1.2 | MIT | |
| `html2canvas` | 1.4.1 | MIT | |
| `dom-to-svg` | 0.12.2 | MIT | |
| `sortablejs` | 1.7.0 | MIT | |
| `xterm` | 4.1.0 | MIT | |
| `xlsx` | 0.20.3 | Apache-2.0 | SheetJS CE，本地 vendor：`vendor/xlsx-0.20.3.tgz` |
| `crypto` | 1.0.1 | ISC | |
| `@electron/remote` | 1.2.1 | MIT | |
| `electron-updater` | 4.3.9 | MIT | |
| `electron` | 13.1.7 | MIT | 运行时框架 |

## 随仓库内置的前端资源（不经 npm 安装）

| 组件 | 版本 | 许可证 | 说明 |
| --- | --- | --- | --- |
| `luckysheet` | 2.1.13 | 未随附许可证文件，以上游仓库 [mengshukeji/Luckysheet](https://github.com/mengshukeji/Luckysheet) 的声明为准（本仓库未核实） | `public/asset/lucky-sheet/`，版本取自 `luckysheet.umd.js` 文件头；目录内的插件脚本另含其依赖，未逐一声明 |
| `font-awesome` | 4.7.0 | 字体 SIL OFL 1.1，CSS MIT（据其 CSS 文件头声明） | `public/asset/font-awesome-4.7.0/` |

## 构建工具链（不随应用分发）

webpack、Babel、ESLint 及相关 loader/插件、electron-builder 23.3.3 等开发依赖，
均为 MIT 许可（个别传递依赖可能为 BSD/ISC 等），以各包自带许可证文件为准。

## 内置资源

- `public/jar/pdmaner-java.jar`：数据库逆向 / DDL 解析与 Word/Excel 导入导出能力的 Java
  组件，随上游 PDManer 引入；该 jar 自身代码遵循 MulanPubL-2.0（与上游一致）。
- `public/jar/pdmaner-java.jar` 是内嵌依赖的可执行 jar，`BOOT-INF/lib/` 下打包了 89 个第三方
  jar（例如 Apache POI、Apache Batik、Jackson 以及多种数据库 JDBC 驱动）。这些第三方库的
  许可证各不相同，本文未逐一列出，也未逐一核实；请以各库的上游发布及其 jar 内 `META-INF`
  中的许可声明（如有）为准。
- 导入导出模板（`public/file/`）沿用上游 PDManer 附带模板。
