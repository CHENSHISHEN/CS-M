// DM-01:前向工程向导阻断错误文案全覆盖 + 全部阻断错误分组渲染
//  1) 从 model_forward_engineering.js 源码收集全部 code 字面量,zh/en 的 forward.err.<code> 均非空;
//  2) en 文案不含汉字;zh/en 同一 code 的 {占位符} 集合一致;
// 运行: node --import ./tests/esm-loader.mjs tests/test-forward-errors.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zh from '../src/lang/zh.js';
import en from '../src/lang/en.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let count = 0;
function ok(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}

// 从生成器源码收集 `code: '…'` / `code: "…"` 字面量(含映射状态与 DDL 模板校验状态;
// `code: v.code` / `code: baseTemplate.code` 透传的正是 validateDDLTemplate 内的字面量,已被覆盖)
export const collectForwardErrorCodes = (source) => {
  const re = /\bcode:\s*(['"])(\w+)\1/g;
  const set = new Set();
  let m = re.exec(source);
  while (m) {
    set.add(m[2]);
    m = re.exec(source);
  }
  return [...set].sort();
};

const GENERATOR = read('src/lib/model_forward_engineering.js');
const CODES = collectForwardErrorCodes(GENERATOR);
// 评测报告 DM-01 点名的 code 必须被收集到(防止正则或源码写法变化导致漏检)
const EXPECTED = [
  'invalidDomain', 'invalidBaseType', 'noType', 'cannotIdentify', 'ambiguous', 'missingTargetType',
  'invalidSupport', 'templateMissing', 'templateEmpty',
  'emptyDatabaseName', 'invalidDbType', 'databaseCreateFailed', 'targetDatabaseMissing', 'targetRequired',
  'logicalEntityMissing', 'noSourceSelected', 'emptyFieldKey', 'duplicateField', 'refFieldMissing',
  'relationFieldMissing', 'indexFieldMissing', 'indexFieldDropped',
  'emptyDefKey', 'duplicateDefKey', 'outOfScopeRelations', 'existingArtifact',
];
const CJK = /[一-鿿]/;
const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort();

ok('collectForwardErrorCodes 收集到全部已知 code', () => {
  const missing = EXPECTED.filter(c => !CODES.includes(c));
  assert.deepEqual(missing, [], `未收集到: ${missing.join(', ')}`);
});

ok('每个 code 在 zh/en 的 forward.err 下均有非空文案', () => {
  const missing = [];
  CODES.forEach((code) => {
    [['zh', zh], ['en', en]].forEach(([lang, pack]) => {
      const v = pack.forward && pack.forward.err && pack.forward.err[code];
      if (typeof v !== 'string' || v.trim() === '') missing.push(`${lang}:${code}`);
    });
  });
  assert.deepEqual(missing, [], `缺少 ${missing.length} 个: ${missing.join(', ')}`);
});

ok('en 的 forward.err 文案不含汉字', () => {
  const bad = Object.keys(en.forward.err).filter(k => CJK.test(en.forward.err[k]));
  assert.deepEqual(bad, []);
});

ok('zh/en 同一 code 的占位符一致', () => {
  const keys = new Set([...Object.keys(zh.forward.err), ...Object.keys(en.forward.err)]);
  const bad = [...keys].filter(k => placeholders(zh.forward.err[k] || '').join(',')
    !== placeholders(en.forward.err[k] || '').join(','));
  assert.deepEqual(bad, [], `占位符不一致: ${bad.join(', ')}`);
});

// ---- 向导分组渲染辅助（纯函数）----
const {
  FORWARD_ERROR_LEVELS, forwardErrorData, labelForwardErrors, renderBlockingErrors,
} = await import('../src/app/workbench/forwardErrors.js');
const {planForwardGeneration} = await import('../src/lib/model_forward_engineering.js');

if (!Math.uuid) {
  let seq = 0;
  Math.uuid = () => `uuid-${++seq}`;
}

// 以 zh 文案为准的 t：与 _getMessage 同口径做 {x} 替换，缺键返回 undefined 字符串以便暴露
const zhT = (key, data) => {
  const msg = key.split('.').reduce((o, k) => (o == null ? o : o[k]), zh.forward);
  assert.equal(typeof msg, 'string', `缺少 forward.${key}`);
  return data ? msg.replace(/\{(\w+)\}/g, (_, k) => String(data[k])) : msg;
};

const fixture = () => ({
  profile: {
    default: {db: 'S_MYSQL'},
    dataTypeSupports: [{id: 'S_MYSQL', defKey: 'MySQL'}],
    codeTemplates: [{applyFor: 'S_MYSQL', type: 'dbDDL', createTable: 'CREATE TABLE {{=it.entity.defKey}}'}],
  },
  dataTypeMapping: {mappings: [{id: 'BT_STR', defKey: 'string', defName: '字串', S_MYSQL: 'VARCHAR'}]},
  domains: [],
  entities: [{id: 'p_exist', defKey: 'CUSTOMER'}],
  views: [],
  logicEntities: [
    {id: 'l_cust', defKey: 'LE_CUSTOMER', fields: [{id: 'f1', defKey: 'ID', baseType: 'BT_STR'}]},
    {id: 'l_dup', defKey: 'LE_ORDER', fields: [
      {id: 'f2', defKey: 'NAME', baseType: 'BT_STR'},
      {id: 'f3', defKey: 'name', baseType: 'BT_STR'},
      {id: 'f4', defKey: '', baseType: 'BT_STR'},
    ]},
  ],
});

ok('renderBlockingErrors：重名表/缺目标库/空字段名/字段重名全部按 level 分组展示明细', () => {
  const source = fixture();
  const res = planForwardGeneration(source, {
    entityIds: ['l_cust', 'l_dup'],
    target: {mode: 'existing', databaseId: 'db_gone'},
  });
  assert.equal(res.status, 'error');
  const groups = renderBlockingErrors(labelForwardErrors(res.errors, source), zhT);
  const levels = groups.map(g => g.level);
  assert.deepEqual(levels, ['name', 'target', 'field'], JSON.stringify(levels));
  // 组顺序遵循 FORWARD_ERROR_LEVELS
  assert.deepEqual(levels, FORWARD_ERROR_LEVELS.filter(l => levels.includes(l)));
  const byLevel = Object.fromEntries(groups.map(g => [g.level, g]));
  assert.equal(byLevel.name.title, zh.forward.errLevel.name);
  const nameLine = byLevel.name.lines[0];
  assert.equal(nameLine.code, 'duplicateDefKey');
  assert.equal(nameLine.where, 'LE_CUSTOMER');
  assert.ok(nameLine.text.includes('CUSTOMER'), nameLine.text);
  assert.equal(byLevel.target.lines[0].code, 'targetDatabaseMissing');
  assert.equal(byLevel.target.lines[0].text, zh.forward.err.targetDatabaseMissing);
  const fieldCodes = byLevel.field.lines.map(l => `${l.code}@${l.where}`);
  assert.ok(fieldCodes.includes('duplicateField@LE_ORDER.name'), fieldCodes.join(' | '));
  assert.ok(fieldCodes.includes('emptyFieldKey@LE_ORDER'), fieldCodes.join(' | '));
  // R-C-F1：目标库失效时不再逐字段误报"缺少目标类型映射"
  assert.ok(!res.errors.some(e => e.code === 'missingTargetType'), fieldCodes.join(' | '));
  // M-4：targetDatabaseMissing 的定位列显示所选数据库 ID
  assert.equal(byLevel.target.lines[0].where, 'db_gone');
  // 每条都有文案，且没有未替换占位符或 undefined
  groups.forEach(g => g.lines.forEach((l) => {
    assert.ok(l.text && !/\{\w+\}|undefined/.test(l.text), `${l.code}: ${l.text}`);
  }));
});

// R-C-F1：targetSupportId 为空的每条路径都必须先有目标级错误，字段级 missingTargetType 随之省略
const withDatabases = (source, databases) => ({
  ...source,
  profile: {...source.profile, modelCatalog: {physicalDatabases: databases}},
});
const fieldMissingTargetType = res => res.errors
  .filter(e => e.level === 'field' && e.code === 'missingTargetType');

ok('R-C-F1：目标库不存在 → 仅目标级 targetDatabaseMissing，无字段级 missingTargetType', () => {
  const res = planForwardGeneration(fixture(), {
    entityIds: ['l_cust'], target: {mode: 'existing', databaseId: 'db_gone'},
  });
  assert.equal(res.status, 'error');
  assert.equal(res.plan, null);
  assert.ok(res.errors.some(e => e.level === 'target' && e.code === 'targetDatabaseMissing'));
  assert.deepEqual(fieldMissingTargetType(res), []);
});

ok('R-C-F1：未选目标 → 仅目标级 targetRequired，无字段级 missingTargetType', () => {
  const res = planForwardGeneration(fixture(), {entityIds: ['l_cust']});
  assert.equal(res.status, 'error');
  assert.ok(res.errors.some(e => e.level === 'target' && e.code === 'targetRequired'));
  assert.deepEqual(fieldMissingTargetType(res), []);
});

ok('R-C-F1：已有数据库缺 dbTypeId(手改工程) → 目标级 invalidSupport 阻断，不会生成 type 为 undefined 的表', () => {
  [undefined, '', 'S_GONE'].forEach((dbTypeId) => {
    const source = withDatabases(fixture(), [{id: 'db_bad', defKey: 'DB_BAD', dbTypeId}]);
    const res = planForwardGeneration(source, {
      entityIds: ['l_cust'], target: {mode: 'existing', databaseId: 'db_bad'},
    });
    assert.equal(res.status, 'error', `dbTypeId=${dbTypeId}`);
    assert.equal(res.plan, null);
    const target = res.errors.filter(e => e.level === 'target');
    assert.deepEqual(target.map(e => e.code), ['invalidSupport'], JSON.stringify(res.errors));
    assert.equal(target[0].databaseId, 'db_bad');
    assert.deepEqual(fieldMissingTargetType(res), []);
    // 定位列：有(未知)类型 ID 显示它，缺类型时回落到数据库代码；文案无占位残留
    const [group] = renderBlockingErrors(labelForwardErrors(target, source), zhT);
    assert.equal(group.lines[0].where, dbTypeId || 'DB_BAD');
    assert.equal(group.lines[0].text, zh.forward.err.invalidSupport);
  });
});

ok('R-C-F1：已有数据库类型存在但 DDL 模板被删 → 仍报更具体的 templateMissing(不降级为 invalidSupport)', () => {
  const source = withDatabases(fixture(), [{id: 'db_tpl', defKey: 'DB_TPL', dbTypeId: 'S_MYSQL'}]);
  source.profile.codeTemplates = [];
  const res = planForwardGeneration(source, {
    entityIds: ['l_cust'], target: {mode: 'existing', databaseId: 'db_tpl'},
  });
  assert.equal(res.status, 'error');
  assert.deepEqual(res.errors.filter(e => e.level === 'target').map(e => e.code), ['templateMissing']);
});

ok('R-C-F1：已有数据库类型有效但映射缺失 → 字段级 missingTargetType 照常阻断', () => {
  const source = withDatabases(fixture(), [{id: 'db_ok', defKey: 'DB_OK', dbTypeId: 'S_MYSQL'}]);
  source.dataTypeMapping.mappings[0].S_MYSQL = '';
  const res = planForwardGeneration(source, {
    entityIds: ['l_cust'], target: {mode: 'existing', databaseId: 'db_ok'},
  });
  assert.equal(res.status, 'error');
  assert.ok(!res.errors.some(e => e.level === 'target'), JSON.stringify(res.errors));
  assert.equal(fieldMissingTargetType(res).length, 1);
});

ok('renderBlockingErrors：新建库空代码/非法类型与映射/引用/索引错误文案带占位参数', () => {
  const source = fixture();
  const errors = labelForwardErrors([
    {level: 'target', code: 'emptyDatabaseName'},
    {level: 'target', code: 'invalidDbType', dbTypeId: 'S_MYSQL'},
    {level: 'target', code: 'databaseCreateFailed', message: 'boom'},
    {level: 'entity', entityId: 'l_missing', code: 'logicalEntityMissing'},
    {level: 'field', entityId: 'l_cust', fieldId: 'f1', defKey: 'ID', code: 'cannotIdentify',
      type: 'text', db: 'S_MYSQL'},
    {level: 'field', entityId: 'l_cust', fieldId: 'f1', defKey: 'ID', code: 'ambiguous',
      type: 'int', candidates: ['a', 'b']},
    {level: 'field', entityId: 'l_cust', fieldId: 'f1', defKey: 'ID', code: 'missingTargetType',
      baseTypeName: '字串'},
    {level: 'relation', entityId: 'l_dup', fieldId: 'f2', code: 'refFieldMissing', refEntity: 'LE_CUSTOMER'},
    {level: 'relation', entityId: 'l_dup', code: 'relationFieldMissing', refEntity: 'LE_CUSTOMER'},
    {level: 'index', entityId: 'l_dup', code: 'indexFieldMissing', defKey: 'idx_name', fields: ['gone']},
    {level: 'custom', code: 'noSourceSelected'},
  ], source);
  const groups = renderBlockingErrors(errors, (key, data) => (key.startsWith('errLevel.')
    && !zh.forward.errLevel[key.slice(9)] ? key : zhT(key, data)));
  assert.deepEqual(groups.map(g => g.level), ['target', 'entity', 'field', 'relation', 'index', 'custom']);
  const lines = Object.fromEntries(groups.flatMap(g => g.lines).map(l => [l.code, l]));
  assert.equal(lines.invalidDbType.text, '数据库类型无效：MySQL');
  assert.equal(lines.invalidDbType.where, 'MySQL');
  assert.equal(lines.databaseCreateFailed.text, '新建数据库失败：boom');
  assert.equal(lines.logicalEntityMissing.where, 'l_missing');
  assert.equal(lines.cannotIdentify.text, '无法唯一识别源类型 text（MySQL）');
  assert.equal(lines.cannotIdentify.where, 'LE_CUSTOMER.ID');
  assert.equal(lines.ambiguous.text, '源类型 int 匹配多个基础类型：a, b');
  assert.equal(lines.missingTargetType.text, '基础类型 字串 缺少目标类型映射');
  assert.equal(lines.refFieldMissing.where, 'LE_ORDER.NAME');
  assert.ok(lines.relationFieldMissing.text.includes('LE_CUSTOMER'));
  assert.equal(lines.indexFieldMissing.text, '索引 idx_name 存在无法映射的字段：gone');
  assert.equal(lines.indexFieldMissing.where, 'LE_ORDER');
});

ok('forwardErrorData 覆盖 zh/en 全部 forward.err 占位符(不会渲染出 undefined)', () => {
  const provided = Object.keys(forwardErrorData({}));
  const used = new Set(Object.values(zh.forward.err).concat(Object.values(en.forward.err))
    .flatMap(placeholders));
  const missing = [...used].filter(p => !provided.includes(p));
  assert.deepEqual(missing, []);
  Object.values(forwardErrorData({})).forEach(v => assert.equal(typeof v, 'string'));
});

ok('ForwardEngineering 向导用 renderBlockingErrors 渲染全部阻断错误，不再只渲染 name 级', () => {
  const src = read('src/app/workbench/ForwardEngineering.js');
  assert.ok(/renderBlockingErrors\(/.test(src), '向导未调用 renderBlockingErrors');
  assert.ok(!/blockingErrors\.filter\(e => e\.level === 'name'\)/.test(src), '仍只渲染 name 级错误');
  assert.ok(/Message\.error\(\{title: t\('blockHint'\)\}\)/.test(src), 'goStep(3) 泛化 toast 应保留');
});

// ---- UX-13：DDL 方言高亮 / 完成后定位新表 / 三处入口共用 openForwardEngineering ----
const {ddlLanguageFor, firstCreatedEntity} = await import('../src/lib/model_forward_engineering.js');

ok('ddlLanguageFor：按目标库类型代码映射 ace 模式(大小写无关)', () => {
  assert.equal(ddlLanguageFor('mysql'), 'mysql');
  assert.equal(ddlLanguageFor('postgresql'), 'pgsql');
  assert.equal(ddlLanguageFor('oracle'), 'plsql');
  assert.equal(ddlLanguageFor('sqlserver'), 'sql');
  // 模板项目实测 defKey：MYSQL / PostgreSQL / ORACLE / SQLServer
  assert.equal(ddlLanguageFor('MYSQL'), 'mysql');
  assert.equal(ddlLanguageFor('MySQL'), 'mysql');
  assert.equal(ddlLanguageFor('PostgreSQL'), 'pgsql');
  assert.equal(ddlLanguageFor('ORACLE'), 'plsql');
  assert.equal(ddlLanguageFor('SQLServer'), 'sql');
  assert.equal(ddlLanguageFor(' Oracle '), 'plsql');
});

ok('ddlLanguageFor：未知类型/空值回退 sql', () => {
  assert.equal(ddlLanguageFor('Hive'), 'sql');
  assert.equal(ddlLanguageFor('DM'), 'sql');
  assert.equal(ddlLanguageFor('default'), 'sql');
  assert.equal(ddlLanguageFor('constructor'), 'sql');
  assert.equal(ddlLanguageFor(''), 'sql');
  assert.equal(ddlLanguageFor(null), 'sql');
  assert.equal(ddlLanguageFor(undefined), 'sql');
});

ok('ddlLanguageFor：传入 source 时把 dataTypeSupports 的 UUID 解析为类型代码', () => {
  const source = {profile: {dataTypeSupports: [
    {id: '29D1CE08-4C35-4D2D-AAA9-23D93305B52E', defKey: 'MYSQL'},
    {id: 'DFBEC1DD-AA84-456E-BBF3-C95DD0DB2022', defKey: 'PostgreSQL'},
    {id: 'A4E23CB7-BB01-4BD1-9F71-F73F3E15A542', defKey: 'ORACLE'},
    {id: 'BFC87171-C74F-494A-B7C2-76B9C55FACC9', defKey: 'SQLServer'},
    {id: '81CCA482-3F4D-4EAC-8CF9-F5E7BC098AD2', defKey: 'Hive'},
  ]}};
  assert.equal(ddlLanguageFor('29D1CE08-4C35-4D2D-AAA9-23D93305B52E', source), 'mysql');
  assert.equal(ddlLanguageFor('DFBEC1DD-AA84-456E-BBF3-C95DD0DB2022', source), 'pgsql');
  assert.equal(ddlLanguageFor('A4E23CB7-BB01-4BD1-9F71-F73F3E15A542', source), 'plsql');
  assert.equal(ddlLanguageFor('BFC87171-C74F-494A-B7C2-76B9C55FACC9', source), 'sql');
  assert.equal(ddlLanguageFor('81CCA482-3F4D-4EAC-8CF9-F5E7BC098AD2', source), 'sql');
  // 不在 source 中的值按类型代码本身解析；空 source 不抛错
  assert.equal(ddlLanguageFor('mysql', source), 'mysql');
  assert.equal(ddlLanguageFor('UNKNOWN-UUID', source), 'sql');
  assert.equal(ddlLanguageFor('oracle', {}), 'plsql');
  assert.equal(ddlLanguageFor(null, source), 'sql');
});

ok('firstCreatedEntity：取 createdEntityIds 中第一个确实存在于源的物理表', () => {
  const source = {entities: [{id: 'p_exist', defKey: 'CUSTOMER'}, {id: 'p_new1', defKey: 'ORDER'},
    {id: 'p_new2', defKey: 'ITEM'}]};
  assert.equal(firstCreatedEntity(source, ['p_new1', 'p_new2']).defKey, 'ORDER');
  assert.equal(firstCreatedEntity(source, ['p_gone', 'p_new2']).id, 'p_new2');
  assert.equal(firstCreatedEntity(source, []), null);
  assert.equal(firstCreatedEntity(source, undefined), null);
  assert.equal(firstCreatedEntity({}, ['p_new1']), null);
  assert.equal(firstCreatedEntity(null, ['p_new1']), null);
});

ok('向导完成回调 onFinish({createdEntityIds}) 且 DDL 预览不再写死 mysql', () => {
  const src = read('src/app/workbench/ForwardEngineering.js');
  assert.ok(/onFinish\(\{\s*createdEntityIds\s*:/.test(src), '向导未以 {createdEntityIds} 调用 onFinish');
  assert.ok(!/<CodeHighlight[^>]*mode=['"]mysql['"]/.test(src), 'DDL 预览仍写死 mode=mysql');
  assert.ok(/ddlLanguageFor\(/.test(src), 'DDL 预览未按目标库调用 ddlLanguageFor');
});

ok('三处入口(资源树/逻辑实体编辑器/顶栏)共用宿主的 openForwardEngineering', () => {
  const host = read('src/app/main/index.js');
  assert.ok(/const\s+openForwardEngineering\s*=/.test(host), '宿主未定义 openForwardEngineering');
  // 宿主把同一函数下发给三个入口组件
  const passed = host.match(/openForwardEngineering\s*=\s*\{\s*openForwardEngineering\s*\}/g) || [];
  assert.ok(passed.length >= 3, `宿主仅下发 ${passed.length} 处`);
  assert.ok(/onFinish\s*=\s*\{/.test(host), '宿主未接收 onFinish 定位新表');
  ['src/app/workbench/ModelCatalog.js', 'src/app/container/logicentity/index.js',
    'src/app/workbench/WorkbenchShell.js'].forEach((file) => {
    assert.ok(/\bopenForwardEngineering\b/.test(read(file)), `${file} 未引用 openForwardEngineering`);
  });
  assert.ok(!/_wbOpenForwardWizard|\bonGenerate\b/.test(host + read('src/app/workbench/ModelCatalog.js')),
    '旧入口名仍残留');
});

ok('forward.finishHint 文案 zh/en 均存在且占位符一致', () => {
  ['finishHint'].forEach((k) => {
    assert.equal(typeof zh.forward[k], 'string');
    assert.equal(typeof en.forward[k], 'string');
    assert.ok(!CJK.test(en.forward[k]));
    assert.deepEqual(placeholders(zh.forward[k]), placeholders(en.forward[k]));
  });
  // M-5：页签名不写死，由调用处用 tableEdit.dbDDL 填入 {tab}
  assert.deepEqual(placeholders(zh.forward.finishHint).sort(), ['count', 'name', 'tab']);
  assert.ok(!/dbDDL|数据库代码/.test(zh.forward.finishHint + en.forward.finishHint));
  const main = read('src/app/main/index.js');
  assert.ok(/tab: FormatMessage\.string\(\{id: 'tableEdit\.dbDDL'\}\)/.test(main), 'finishHint 未传 tab');
});

ok('M-6：compact 并入“更多”的工具组随 toolMenus(canForward) 刷新', () => {
  const shell = read('src/app/workbench/WorkbenchShell.js');
  const memo = shell.slice(shell.indexOf('const moreMenus = useMemo'));
  const deps = memo.slice(0, memo.indexOf('const runTopCommand')).match(/\}, \[([^\]]*)\]\);\s*$/m);
  assert.ok(deps, 'moreMenus 依赖数组未找到');
  assert.ok(/\btoolMenus\b/.test(deps[1]) && /\bdataPlatform\b/.test(deps[1]), deps[1]);
});

ok('M-2：跨模块完成时先给成功反馈再切模块（留在规则检查也有反馈），同模块路径只提示一次', () => {
  const main = read('src/app/main/index.js');
  const body = main.slice(main.indexOf('const _forwardFinished'), main.indexOf('const openForwardEngineering'));
  assert.ok(/if \(menuType !== '1'\) \{[\s\S]*?Message\.success\(\{title: FormatMessage\.string\(\{id: 'optSuccess'\}\)\}\);[\s\S]*?_menuTypeChange\('1', locate\);[\s\S]*?\} else \{\s*locate\(\);\s*\}/.test(body),
    '跨模块分支应在 _menuTypeChange 前提示成功，同模块分支仅调用 locate');
  assert.equal((body.match(/forward\.finishHint/g) || []).length, 1);
});

console.log(`${count} passed`);
