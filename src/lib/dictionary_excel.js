// Read-only dictionary workbook adapter on the vendored SheetJS CE 0.20.3
// (ADR-005). Only cell values within the fixed column ranges are read; VBA
// and macros are never loaded or executed. Provenance (file name/version,
// sheet, Excel row) travels with every row so imports stay traceable.
import * as XLSX from 'xlsx';

export const ROOT_SHEET = '4-词根库';
export const COMMON_SHEET = '3-常用词库';

const cellText = (sheet, row, col) => {
  const cell = sheet[XLSX.utils.encode_cell({r: row, c: col})];
  if (!cell || cell.v === undefined || cell.v === null) return '';
  return String(cell.v).trim();
};

// Row 1 is the known header; data starts at row 2. Fully empty rows are
// skipped; the reported row is the 1-based Excel row for traceability.
const sheetRows = (sheet, columns) => {
  if (!sheet || !sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const rows = [];
  for (let r = 1; r <= range.e.r; r += 1) {
    const values = columns.map(c => cellText(sheet, r, c));
    if (values.some(value => value !== '')) rows.push({values, row: r + 1});
  }
  return rows;
};

const buildReferenceNames = (refKey, refName) => {
  if (!refKey && !refName) return [];
  return [{defKey: refKey, fullName: refName}];
};

// Word roots: A 中文名称, B 首选缩写, C 英文全称, D 参考缩写, E 参考全称.
// Reference names are display-only evidence and never join auto-matching.
const readRootRows = (sheet, origin) => sheetRows(sheet, [0, 1, 2, 3, 4]).map(({values, row}) => ({
  defName: values[0],
  defKey: values[1],
  fullName: values[2],
  referenceNames: buildReferenceNames(values[3], values[4]),
  origin: {...origin, sheet: ROOT_SHEET, row},
}));

// Common words: A 中文名称, B 命名 (abbreviation or full name as stored).
const readCommonRows = (sheet, origin) => sheetRows(sheet, [0, 1]).map(({values, row}) => ({
  defName: values[0],
  defKey: values[1],
  origin: {...origin, sheet: COMMON_SHEET, row},
}));

export const readDictionaryWorkbook = (buffer, {name = '', version = ''} = {}) => {
  // xlsx/xlsm are ZIP containers; reject before SheetJS sniffs the bytes as
  // CSV/text and reports a confusing "missing sheet" for non-workbook files.
  if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return {error: 'invalidWorkbook'};
  }
  let workbook;
  try {
    workbook = XLSX.read(buffer, {type: 'buffer'});
  } catch (e) {
    return {error: 'invalidWorkbook'};
  }
  const rootSheet = workbook.Sheets[ROOT_SHEET];
  const commonSheet = workbook.Sheets[COMMON_SHEET];
  if (!rootSheet && !commonSheet) return {error: 'missingSheets'};
  const origin = {name, version, sheet: '', row: 0};
  return {
    rootRows: rootSheet ? readRootRows(rootSheet, origin) : [],
    commonRows: commonSheet ? readCommonRows(commonSheet, origin) : [],
  };
};
