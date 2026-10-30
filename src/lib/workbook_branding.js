// 动态导出品牌适配：上游 GenExcelImpl 生成的工作簿在 xl/sharedStrings.xml
// 内嵌固定的产品表头「PDManer[元数建模]…」。本适配器只把这两个精确表头
// 字符串改为与外置 public/file/CS-M-excel*.xlsx 模板一致的 CS-M 表头。
// 处理仅发生在 ZIP 容器层（vendored SheetJS CE 0.20.3 的 XLSX.CFB）：
// 不经 XLSX.read/write 重建工作簿，除该条目内的表头字节外，其余所有
// ZIP 条目内容逐字节原样保留（公式/样式/图片/工作表顺序不受影响）。
// 用户自填内容（模型名/字段/备注等）即使包含 PDManer 字样也不改动。
import * as XLSX from 'xlsx';
import fs from 'fs';

const SHARED_STRINGS_ENTRY = '/xl/sharedStrings.xml';
// 仅替换确定的上游产品表头，禁止全文件宽泛品牌替换。
const PRODUCT_HEADERS = [
  ['PDManer[元数建模]数据表结构', 'CS-M[元数建模]数据表结构'],
  ['PDManer[元数建模]码表字典', 'CS-M[元数建模]码表字典'],
];

// 仅当 <t>…</t> 文本节点的完整值与产品表头逐字相等时才替换，用户备注中
// 仅包含该表头片段的子串（如「参考 PDManer[元数建模]码表字典 说明」）不动。
const TEXT_NODE = /<t(\s[^>]*)?>([^<]*)<\/t>/g;
const replaceExactTextNodes = (xml, from, to) => {
  let changed = false;
  const out = xml.replace(TEXT_NODE, (match, attrs, text) => {
    if (text !== from) return match;
    changed = true;
    return `<t${attrs || ''}>${to}</t>`;
  });
  return changed ? out : null;
};

// 返回 {buffer, changed}；仅当结构异常（非ZIP/缺sharedStrings条目）时抛错，
// 让调用方以失败反馈，而不是把未适配的文件当成功导出展示。
export const brandWorkbookBuffer = (buffer) => {
  let cfb;
  try {
    cfb = XLSX.CFB.read(buffer, {type: 'buffer'});
  } catch (e) {
    throw new Error(`brandWorkbook: unreadable workbook (${e.message})`);
  }
  const entry = XLSX.CFB.find(cfb, SHARED_STRINGS_ENTRY);
  if (!entry || !entry.content) {
    throw new Error('brandWorkbook: xl/sharedStrings.xml entry missing');
  }
  let xml = Buffer.from(entry.content).toString('utf8');
  let changed = false;
  PRODUCT_HEADERS.forEach(([from, to]) => {
    const next = replaceExactTextNodes(xml, from, to);
    if (next) {
      xml = next;
      changed = true;
    }
  });
  if (!changed) return {buffer, changed: false};
  const content = Buffer.from(xml, 'utf8');
  entry.content = content;
  entry.size = content.length;
  return {buffer: XLSX.CFB.write(cfb, {type: 'buffer', fileType: 'zip'}), changed: true};
};

// 原地适配 GenExcelImpl 已成功写出的 xlsx 文件；返回是否发生改写。
export const brandExcelFile = (filePath) => {
  const {buffer, changed} = brandWorkbookBuffer(fs.readFileSync(filePath));
  if (changed) {
    fs.writeFileSync(filePath, buffer);
  }
  return changed;
};
