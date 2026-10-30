# 第三方组件声明（Third Party Notices）

CS-M 构建与运行使用了以下第三方开源组件。各组件的完整许可证文本以其发布包内的
LICENSE / NOTICE 文件为准。上游 [PDManer](https://github.com/roberGroup/PDManer)
v4.9.4 已包含其中大部分依赖。

## 运行时依赖（随应用分发）

| 组件 | 版本 | 许可证 |
| --- | --- | --- |
| react / react-dom | 16.8.6 | MIT |
| react-redux / redux / redux-thunk / redux-logger | 7.1.0 / 4.0.4 / 2.3.0 / 3.0.6 | MIT |
| react-router-dom | 5.0.1 | MIT |
| prop-types | 15.6.1 | MIT |
| react-ace | 9.4.1 | MIT |
| react-color | 2.18.1 | MIT |
| react-window / react-vtree / react-virtualized-auto-sizer | 1.8.9 / 3.0.0-beta.3 / 1.0.20 | MIT |
| @antv/x6 / @antv/hierarchy / @antv/x6-react-shape | 1.18.3 / 0.6.8 / 1.3.5 | MIT |
| lodash | 4.17.15 | MIT |
| jquery | 3.2.1 | MIT |
| moment | 2.20.1 | MIT |
| marked | 2.1.3 | MIT |
| numeral | 2.0.6 | MIT |
| dot | 1.1.2 | MIT |
| html2canvas | 1.4.1 | MIT |
| dom-to-svg | 0.12.2 | MIT |
| sortablejs | 1.7.0 | MIT |
| xterm | 4.1.0 | MIT |
| xlsx（SheetJS CE，本地 vendor：vendor/xlsx-0.20.3.tgz） | 0.20.3 | Apache-2.0 |
| crypto | 1.0.1 | ISC |
| @electron/remote | 1.2.1 | MIT |
| electron-updater | 4.3.9 | MIT |
| Electron（运行时框架） | 13.1.7 | MIT |

## 构建工具链（不随应用分发）

webpack、Babel、ESLint 及相关 loader/插件、electron-builder 23.3.3 等开发依赖，
均为 MIT 许可（个别传递依赖可能为 BSD/ISC 等），以各包自带许可证文件为准。

## 内置资源

- `public/jar/pdmaner-java.jar`：数据库逆向 / DDL 解析能力的 Java 组件，随上游
  PDManer 引入，遵循 MulanPubL-2.0（与上游一致）。
- 导入导出模板（`public/file/`）沿用上游 PDManer 附带模板。
