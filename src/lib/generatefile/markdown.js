const groupList = '分组清单';
const relation = '关联关系';
const tableList = '表清单';
const tableColumnList = '表列清单';

const escapingHtml = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')
  .replace(/\r\n|\r|\n/g, '<br>');
// Markdown 单元格先处理标记字符，再转义 HTML，避免破坏数字字符引用。
const escapingChar = value => escapingHtml(
  String(value == null ? '' : value)
    .replace(/\\/g, '\\\\').replace(/[|`*_{}[\]()#+.!-]/g, c => `\\${c}`),
);
const anchor = value => encodeURIComponent(String(value)).replace(/['()]/g, c => `%${c.charCodeAt(0).toString(16)}`);
const groupAnchor = group => `group-${anchor(group.id || group.defKey)}`;
const entityAnchor = (group, entity) => `${groupAnchor(group)}-tableColumnList-${anchor(entity.id || entity.defKey)}`;
const groupEntities = (dataSource, group) => (dataSource.entities || [])
  .filter(entity => (group.refEntities || []).includes(entity.id));
const heading = (level, id, label, target) => `<h${level} id="${id}"><a href="#${target}">${label}</a></h${level}>`;

const generateHeader = (dataSource) => {
  let result = ` - ### 1. ${groupList}\n`;
  (dataSource.viewGroups || []).forEach((group, index) => {
    const id = groupAnchor(group);
    result += `- ${heading(4, `${id}-from`, `1.${index + 1}. ${escapingHtml(group.defName || group.defKey)}`, id)}\n`;
    [relation, tableList, tableColumnList].forEach((label, i) => {
      const suffix = ['relation', 'tableList', 'tableColumnList'][i];
      result += `\t- ${heading(5, `${id}-${suffix}-from`, `1.${index + 1}.${i + 1}. ${label}`, `${id}-${suffix}`)}\n`;
    });
    groupEntities(dataSource, group).forEach((entity, entityIndex) => {
      const label = `${escapingHtml(entity.defKey)}【${escapingHtml(entity.defName)}】`;
      const target = entityAnchor(group, entity);
      result += `\t\t- ${heading(6, `${target}-from`, `1.${index + 1}.3.${entityIndex + 1} ${label}`, target)}\n`;
    });
  });
  return result;
};
const generateTableList = (entities) => {
  let result = '| 名称 | 代码 | 备注 |\n| ------------ | ------------ | ------------ |\n';
  entities.forEach((entity) => {
    result += `| ${escapingChar(entity.defName)} | ${escapingChar(entity.defKey)} | ${escapingChar(entity.comment)} |\n`;
  });
  return result;
};
const generateFields = (entity) => {
  let result = '| 代码 | 名称 | 数据类型 | 主键 | 备注 |\n| ------------ | ------------ | ------------ | ------------ | ------------ |\n';
  (entity.fields || []).forEach((field) => {
    result += `| ${escapingChar(field.defKey)} | ${escapingChar(field.defName)} | ${escapingChar(field.type)} | ${field.primaryKey ? '√' : ''} | ${escapingChar(field.comment)} |\n`;
  });
  return result;
};
const generateRelation = (group, images) => {
  // 与 HTML 导出共用图像协议：fileName 是关系图 ID，每个组显示自己的全部图。
  const sources = Array.isArray(images)
    ? images.filter(image => (group.refDiagrams || []).includes(image.fileName))
      .map(image => image.data)
    : (images[group.id] || images[group.defKey] || []);
  if (!sources.length) return '\n该模块未配置关系图\n';
  return sources.map((source) => {
    const url = String(source).replace(/[\s<>"()]/g, c => encodeURIComponent(c));
    return `\n![image](<${url}>)\n`;
  }).join('\n');
};
const generateModuleBody = (dataSource, images) => {
  let result = `  ---\n\n### 1. ${groupList}\n`;
  (dataSource.viewGroups || []).forEach((group, index) => {
    const id = groupAnchor(group);
    const entities = groupEntities(dataSource, group);
    result += ` - ${heading(4, id, `1.${index + 1}. ${escapingHtml(group.defName || group.defKey)}`, `${id}-from`)}\n`;
    result += ` - ${heading(5, `${id}-relation`, `1.${index + 1}.1 ${relation}`, `${id}-relation-from`)}\n ---\n\n`;
    result += `${generateRelation(group, images)}\n ---\n\n`;
    result += ` - ${heading(5, `${id}-tableList`, `1.${index + 1}.2 ${tableList}`, `${id}-tableList-from`)}\n\n`;
    result += ` ---\n\n${generateTableList(entities)}\n ---\n\n`;
    result += ` - ${heading(5, `${id}-tableColumnList`, `1.${index + 1}.3 ${tableColumnList}`, `${id}-tableColumnList-from`)}\n\n ---\n\n`;
    entities.forEach((entity) => {
      const target = entityAnchor(group, entity);
      const label = `${escapingHtml(entity.defKey)}【${escapingHtml(entity.defName)}】`;
      result += ` - ${heading(6, target, label, `${target}-from`)}\n\n${generateFields(entity)}\n ---\n\n`;
    });
  });
  return result;
};
export const markdown = (dataSource, images = [], projectName, callBack) => {
  const result = `## <center>目录</center>\n${generateHeader(dataSource)}${generateModuleBody(dataSource, images)}`;
  callBack && callBack(result);
};
