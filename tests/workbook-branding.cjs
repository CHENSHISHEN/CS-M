// 动态导出品牌适配回归：用真实 jar（GenExcelImpl）在临时目录现场生成
// 合成 xlsx，验证 workbook_branding 只改两个产品表头、其余 ZIP 条目逐字节
// 不变、SheetJS 可回读、Java ParseExcelFileImpl 可重导入且实体/字段不丢、
// 用户备注中的 PDManer 字样原样保留、jar 本身未被改动。不读取真实工程。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const Babel = require('@babel/core');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const jarPath = path.join(root, 'public', 'jar', 'pdmaner-java.jar');
const modulePath = path.join(root, 'src', 'lib', 'workbook_branding.js');
const jsonPath = path.join(root, 'src', 'lib', 'json.js');

// Babel 解析（含 json.js 接缝改动）并把 workbook_branding 作为 CJS 加载执行。
const compile = (file) => Babel.transformFileSync(file, {babelrc: true, cwd: root}).code;
compile(jsonPath);
const loadModule = (file) => {
  const exportsObj = {exports: {}};
  new Function('exports', 'require', 'module', '__filename', '__dirname',
    compile(file))(exportsObj.exports, require, exportsObj, file, path.dirname(file));
  return exportsObj.exports;
};
const {brandWorkbookBuffer, brandExcelFile} = loadModule(modulePath);

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const java = (args) => spawnSync('java', ['-Dfile.encoding=utf-8', '-jar', jarPath, ...args],
  {encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024});

// 合成最小工程：实体/字典备注里刻意带 PDManer 字样（应保留），导出表头里的
// PDManer[元数建模]（应改写）由 jar 自身产生。
const syntheticProject = () => ({
  name: 'CSMSynTest',
  profile: {headers: [
    {refKey: 'defKey', hideInGraph: false, freeze: false},
    {refKey: 'defName', hideInGraph: false, freeze: false},
    {refKey: 'primaryKey', hideInGraph: false, freeze: false},
    {refKey: 'notNull', hideInGraph: true, freeze: false},
    {refKey: 'autoIncrement', hideInGraph: true, freeze: false},
    {refKey: 'domain', hideInGraph: true, freeze: false},
    {refKey: 'type', hideInGraph: false, freeze: false},
    {refKey: 'len', hideInGraph: false, freeze: false},
    {refKey: 'scale', hideInGraph: false, freeze: false},
    {refKey: 'comment', hideInGraph: true, freeze: false},
    {refKey: 'refDict', hideInGraph: true, freeze: false},
    {refKey: 'uiHint', hideInGraph: true, freeze: false},
    {refKey: 'defaultValue', hideInGraph: true, freeze: false}]},
  entities: [{
    id: 'E1', defKey: 'T_USER', defName: '用户表', comment: '备注保留PDManer字样',
    type: 'P', headers: [
      {refKey: 'hideInGraph', hideInGraph: true, freeze: true},
      {refKey: 'defKey', hideInGraph: false, freeze: false},
      {refKey: 'defName', hideInGraph: false, freeze: false},
      {refKey: 'comment', hideInGraph: false, freeze: false}],
    fields: [
      {id: 'F1', defKey: 'USER_ID', defName: '用户ID', comment: '字段备注PDManer迁移，参考 PDManer[元数建模]码表字典 说明',
        type: 'VARCHAR', len: 32, scale: '', primaryKey: true, notNull: true,
        autoIncrement: false, defaultValue: '', hideInGraph: false, refDict: '', domain: '', uiHint: ''},
      {id: 'F2', defKey: 'USER_STATUS', defName: '用户状态', comment: '',
        type: 'VARCHAR', len: 8, scale: '', primaryKey: false, notNull: false,
        autoIncrement: false, defaultValue: '', hideInGraph: false, refDict: 'D1', domain: '', uiHint: ''}],
    indexes: [], correlations: [], properties: {}, sysProps: null}],
  views: [],
  dicts: [{id: 'D1', defKey: 'UserStatus', defName: '用户状态', sort: '', intro: '', items: [
    {id: 'I1', defKey: '0', defName: '冻结', sort: '', parentKey: '', intro: '', enabled: true, attr1: '', attr2: '', attr3: ''},
    {id: 'I2', defKey: '1', defName: '正常', sort: '', parentKey: '', intro: '', enabled: true, attr1: '', attr2: '', attr3: ''}]}],
});

const HEADERS = [
  ['PDManer[元数建模]数据表结构', 'CS-M[元数建模]数据表结构'],
  ['PDManer[元数建模]码表字典', 'CS-M[元数建模]码表字典'],
];

const entryMap = (buffer) => {
  const cfb = XLSX.CFB.read(buffer, {type: 'buffer'});
  const prefix = cfb.FullPaths[0]; // CFB 读 ZIP 时会带虚拟根（如 'Root Entry/'）
  const map = new Map();
  cfb.FullPaths.forEach((p, i) => {
    if (cfb.FileIndex[i].content && cfb.FileIndex[i].content.length) map.set(`/${p.slice(prefix.length)}`, Buffer.from(cfb.FileIndex[i].content));
  });
  return map;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-wb-'));
try {
  assert(fs.existsSync(jarPath), '缺少 public/jar/pdmaner-java.jar');
  const jarHashBefore = sha256(jarPath);

  const sinerFile = path.join(tmp, 'siner.json');
  fs.writeFileSync(sinerFile, JSON.stringify(syntheticProject()));
  const rawXlsx = path.join(tmp, 'raw.xlsx');
  const genResult = path.join(tmp, 'gen-result.json');
  const gen = java(['GenExcelImpl', `dataFile='${sinerFile}'`, `sinerFile='${sinerFile}'`,
    `outFile='${rawXlsx}'`, `out='${genResult}'`]);
  assert.equal(gen.status, 0, `GenExcelImpl 退出码 ${gen.status}: ${(gen.stderr || '').slice(-500)}`);
  const genJson = JSON.parse(fs.readFileSync(genResult, 'utf8'));
  assert.equal(genJson.status, 'SUCCESS', `GenExcelImpl 失败: ${JSON.stringify(genJson.body).slice(0, 300)}`);

  const rawBuf = fs.readFileSync(rawXlsx);
  const rawEntries = entryMap(rawBuf);
  const rawShared = rawEntries.get('/xl/sharedStrings.xml');
  HEADERS.forEach(([from]) => assert(rawShared.includes(Buffer.from(from, 'utf8')), `适配前应含表头 ${from}`));
  const REMARKS = ['备注保留PDManer字样', '字段备注PDManer迁移，参考 PDManer[元数建模]码表字典 说明'];
  REMARKS.forEach((s) =>
    assert(rawShared.includes(Buffer.from(s, 'utf8')), `合成输入应含用户备注 ${s}`));

  // 修正：缓冲级纯函数
  const {buffer: brandedBuf, changed} = brandWorkbookBuffer(rawBuf);
  assert.ok(changed, '应发生表头改写');

  // 结构对比：条目集合一致；除 sharedStrings 外逐字节相同；sharedStrings 的
  // 差异逆替换后必须与原文完全一致（即只有两个表头被改）。
  const brandedEntries = entryMap(brandedBuf);
  assert.deepStrictEqual([...brandedEntries.keys()].sort(), [...rawEntries.keys()].sort(), 'ZIP 条目集合不应变化');
  for (const name of rawEntries.keys()) {
    if (name !== '/xl/sharedStrings.xml') {
      assert(rawEntries.get(name).equals(brandedEntries.get(name)), `条目被改动: ${name}`);
    }
  }
  let revert = brandedEntries.get('/xl/sharedStrings.xml');
  HEADERS.forEach(([, to], i) => {
    assert(revert.includes(Buffer.from(to, 'utf8')), `适配后应含表头 ${to}`);
    revert = Buffer.from(revert.toString('utf8').split(HEADERS[i][1]).join(HEADERS[i][0]), 'utf8');
  });
  assert(revert.equals(rawShared), 'sharedStrings 除表头外不应有任何字节差异');
  const brandedXml = brandedEntries.get('/xl/sharedStrings.xml').toString('utf8');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  HEADERS.forEach(([from]) => assert(!new RegExp(`<t(\\s[^>]*)?>${esc(from)}</t>`).test(brandedXml),
    `不应残留完整值等于上游表头的文本节点 ${from}`));
  assert(brandedXml.includes('参考 PDManer[元数建模]码表字典 说明'), '含表头片段的用户备注应原样保留');

  // 幂等：已适配文件再跑一次不改动
  const again = brandWorkbookBuffer(brandedBuf);
  assert.ok(!again.changed && again.buffer.equals(brandedBuf), '重复适配应为无操作');

  // 失败路径：非工作簿输入必须抛错（接缝据此反馈失败而非展示成功）
  assert.throws(() => brandWorkbookBuffer(Buffer.from('not a zip workbook')), /brandWorkbook/);

  // 文件级接缝：原地改写
  const brandedPath = path.join(tmp, 'branded.xlsx');
  fs.writeFileSync(brandedPath, rawBuf);
  assert.ok(brandExcelFile(brandedPath), 'brandExcelFile 应改写文件');
  assert(fs.readFileSync(brandedPath).equals(brandedBuf), '文件内容应与缓冲级结果一致');
  assert.throws(() => brandExcelFile(path.join(tmp, 'missing.xlsx')), /ENOENT/);

  // SheetJS 回读：工作表顺序/标题/用户备注可读且正确
  const wb = XLSX.read(brandedBuf, {type: 'buffer'});
  assert.ok(wb.SheetNames.includes('码表字典') && wb.SheetNames.includes('T_USER'), `工作表异常: ${wb.SheetNames}`);
  const cellTexts = Object.values(wb.Sheets).flatMap((sheet) =>
    Object.keys(sheet).filter((k) => k !== '!ref' && k !== '!cols' && k !== '!merges')
      .map((k) => String(sheet[k].v)));
  HEADERS.forEach(([, to]) => assert(cellTexts.includes(to), `回读应含 ${to}`));
  REMARKS.forEach((s) => assert(cellTexts.includes(s), `回读应保留用户备注 ${s}`));
  HEADERS.forEach(([from]) => assert(!cellTexts.includes(from), `回读不应再出现表头完整值 ${from}`));

  // Java 重导入：实体/字段不丢，用户备注原样
  const parseResult = path.join(tmp, 'parse-result.json');
  const parse = java(['ParseExcelFileImpl', `excelFile='${brandedPath}'`, `out='${parseResult}'`]);
  assert.equal(parse.status, 0, `ParseExcelFileImpl 退出码 ${parse.status}: ${(parse.stderr || '').slice(-500)}`);
  const parseJson = JSON.parse(fs.readFileSync(parseResult, 'utf8'));
  assert.equal(parseJson.status, 'SUCCESS', `重导入失败: ${JSON.stringify(parseJson.body).slice(0, 300)}`);
  const entity = (parseJson.body.entities || []).find((e) => e.defKey === 'T_USER');
  assert.ok(entity, '重导入应含实体 T_USER');
  assert.equal(entity.comment, '备注保留PDManer字样', '实体备注应原样保留');
  const fieldIds = (entity.fields || []).map((f) => f.defKey);
  ['USER_ID', 'USER_STATUS'].forEach((f) => assert(fieldIds.includes(f), `字段丢失: ${f}`));
  assert.equal((entity.fields || []).find((f) => f.defKey === 'USER_ID').comment,
    '字段备注PDManer迁移，参考 PDManer[元数建模]码表字典 说明', '含表头片段的用户备注应原样保留');

  // jar 未被本流程改动
  assert.equal(sha256(jarPath), jarHashBefore, 'jar SHA256 不应变化');

  console.log('PASS 动态导出品牌适配：表头改写、ZIP保真、SheetJS回读、Java重导入、jar未动');
} finally {
  fs.rmSync(tmp, {recursive: true, force: true});
}
