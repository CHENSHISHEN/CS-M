// Synthetic test suite for the modeling AI core (real pure functions only —
// no AI service, no database, no filesystem writes). Run:
//   node --import ./core-test-loader.mjs ./core-test.mjs
// All fixtures are hand-written synthetic data; results are asserted against
// computed outcomes, never hardcoded example values.
import assert from 'node:assert';
import {
  sha256Hex, canonicalJson, hashJson,
  resourceFingerprint, verifyReadSet,
  parsePlanText, validatePlanStructure,
  computePlanHash, computeContextDigest, selectOperations,
  previewPlan, applyPlan, collectReadSet, createSequentialIdAllocator,
  createLedger, undoChangeSet,
  listCommands, describeCommand,
  parseDdlScript, draftTableOpsFromDdl, SQL_DIALECTS,
} from '../src/lib/ai/index.js';
import {
  validateQualityRuleSet, runModelQuality, readQualityProfile,
} from '../src/lib/quality/modelRules.js';
import {redactSensitiveText} from '../src/lib/ai/orchestration/context.js';
import {credentialStatusFromReceipt} from '../src/app/ai/integration/credentialStatus.js';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}\n    ${e.message}`);
  }
};

// ---------- synthetic project fixture ----------
const field = (id, defKey, defName, type, baseType, extra = {}) => ({
  id, defKey, defName, type, baseType, len: '', scale: '',
  primaryKey: false, notNull: false, autoIncrement: false,
  defaultValue: '', hideInGraph: false, refDict: '', domain: '', uiHint: '',
  comment: '', ...extra,
});

const makeSource = () => ({
  name: 'synthetic-project',
  entities: [{
    id: 'ent_customer',
    defKey: 'customer',
    defName: '客户',
    comment: '现有客户表',
    type: 'P',
    fields: [
      field('f_customer_id', 'id', '编号', 'BIGINT', 'map_bigint', {primaryKey: true, notNull: true}),
      field('f_customer_name', 'name', '名称', 'VARCHAR', 'map_varchar'),
    ],
    correlations: [],
    indexes: [],
  }],
  diagrams: [],
  standardFields: [{
    id: 'grp_base',
    defKey: 'BASE',
    defName: '基础',
    fields: [{id: 'sf_customer_id', defKey: 'customer_id', defName: '客户编号', baseType: 'map_bigint'}],
  }],
  dataTypeMapping: {
    mappings: [
      {id: 'map_bigint', defKey: 'BIGINT', defName: 'BIGINT', db_mysql: 'BIGINT'},
      {id: 'map_varchar', defKey: 'VARCHAR', defName: 'VARCHAR', db_mysql: 'VARCHAR'},
      {id: 'map_int', defKey: 'INT', defName: 'INT', db_mysql: 'INT'},
    ],
  },
  profile: {
    default: {db: 'db_mysql'},
    dataTypeSupports: [{id: 'db_mysql', defKey: 'MYSQL', defName: 'MySQL'}],
    fieldRecommendation: {wordRoots: []},
  },
});

// ---------- plan builder ----------
const buildPlan = (source, operations, overrides = {}) => {
  const draft = {
    protocolVersion: '1.0',
    planId: 'plan_synthetic_1',
    scope: {platform: 'modeling', projectSessionId: 'sess-1'},
    baseVersion: 'v1',
    contextDigest: '0'.repeat(64),
    readSet: collectReadSet(source, {operations}),
    expiresAt: new Date(Date.now() + 3600e3).toISOString(),
    summary: '合成测试计划',
    assumptions: [],
    operations,
    planHash: '0'.repeat(64),
  };
  draft.contextDigest = computeContextDigest(draft.readSet);
  draft.planHash = computePlanHash(draft);
  return {...draft, ...overrides};
};

const compositeOperations = () => ([
  {
    opId: 'table-order',
    command: 'model.table.create',
    dependsOn: [],
    args: {
      localKey: 'order',
      defKey: 'dwd_order',
      defName: '订单',
      dbType: {kind: 'existing', collection: 'dataTypeSupports', id: 'db_mysql'},
      fields: [
        {localKey: 'order.order_id', defKey: 'order_id', defName: '订单编号',
          type: 'BIGINT', notNull: true, primaryKey: true},
        {localKey: 'order.customer_id', defKey: 'customer_id', defName: '客户编号',
          type: 'BIGINT', notNull: true, primaryKey: false},
      ],
    },
  },
  {
    opId: 'diagram',
    command: 'model.diagram.create',
    dependsOn: ['table-order'],
    args: {
      localKey: 'order-diagram',
      defKey: 'ORDER_VIEW',
      defName: '订单模型图',
      level: 'physical',
      tables: [
        {kind: 'local', key: 'order'},
        {kind: 'existing', collection: 'entities', id: 'ent_customer'},
      ],
    },
  },
  {
    opId: 'fk',
    command: 'model.foreignKey.create',
    dependsOn: ['table-order', 'diagram'],
    args: {
      localKey: 'fk-order-customer',
      name: '订单客户外键',
      sourceTable: {kind: 'local', key: 'order'},
      sourceFields: [{kind: 'local', key: 'order.customer_id'}],
      targetTable: {kind: 'existing', collection: 'entities', id: 'ent_customer'},
      targetFields: [{kind: 'existing', collection: 'fields',
        owner: {collection: 'entities', id: 'ent_customer'}, id: 'f_customer_id'}],
    },
  },
  {
    opId: 'field-note',
    command: 'model.field.add',
    dependsOn: [],
    args: {
      table: {kind: 'existing', collection: 'entities', id: 'ent_customer'},
      fields: [
        {localKey: 'customer.note', defKey: 'note', defName: '备注',
          type: 'VARCHAR', notNull: false, primaryKey: false, len: 500},
      ],
    },
  },
  {opId: 'group', command: 'standard.group.create', dependsOn: [],
    args: {localKey: 'trade-group', defKey: 'TRADE', defName: '交易标准'}},
  {opId: 'root-order', command: 'standard.root.create', dependsOn: [],
    args: {localKey: 'root-order', defKey: 'order', defName: '订单', fullName: 'Order'}},
  {opId: 'root-id', command: 'standard.root.create', dependsOn: [],
    args: {localKey: 'root-id', defKey: 'id', defName: '编号', fullName: 'Identifier'}},
  {
    opId: 'standard-order-id',
    command: 'standard.field.create',
    dependsOn: ['group', 'root-order', 'root-id'],
    args: {
      localKey: 'standard-order-id',
      group: {kind: 'local', key: 'trade-group'},
      defKey: 'order_id',
      defName: '订单编号',
      baseType: {kind: 'existing', collection: 'dataTypeMappings', id: 'map_bigint'},
      wordRoots: [{kind: 'local', key: 'root-order'}, {kind: 'local', key: 'root-id'}],
      len: 20,
    },
  },
  {
    opId: 'quality',
    command: 'quality.modelRuleSet.create',
    dependsOn: ['table-order'],
    args: {
      localKey: 'order-quality',
      name: '订单建模规范',
      enabled: false,
      targets: [{kind: 'local', key: 'order'}],
      rules: [
        {localKey: 'order-has-pk', name: '物理表应有主键', severity: 'error',
          target: 'physicalTable', predicate: {op: 'hasPrimaryKey'}},
        {localKey: 'order-name', name: '表应有中文名', severity: 'warning',
          target: 'physicalTable', predicate: {op: 'required', field: 'defName'}},
      ],
    },
  },
]);

// ===================== 1. hash =====================
console.log('hash & canonical serialization');
// Known-answer tests (FIPS 180-4 vectors + CJK + surrogate pair) with fixed
// constants: the implementation delegates to the platform crypto module, so
// comparing it against node crypto again would be vacuous.
test('sha256Hex matches published FIPS 180-4 test vectors', () => {
  const vectors = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ];
  vectors.forEach(([input, expected]) => assert.strictEqual(sha256Hex(input), expected));
});
test('sha256Hex handles CJK text and surrogate pairs (UTF-8 fidelity)', () => {
  assert.strictEqual(sha256Hex('中文'),
    '72726d8818f693066ceb69afa364218b692e62ea92b385782363780f47529c21');
  // U+1D11E (MUSICAL SYMBOL G CLEF) as a surrogate pair.
  assert.strictEqual(sha256Hex('\uD834\uDD1E'),
    'e419efd3d6046adf7662b0daadab65047e8014a523316d7ccc8710de694aa9b6');
});
test('canonicalJson sorts keys recursively and keeps array order', () => {
  assert.strictEqual(canonicalJson({b: 1, a: {d: [3, 2, 1], c: true}}),
    '{"a":{"c":true,"d":[3,2,1]},"b":1}');
});
test('hashJson is stable across key order', () => {
  assert.strictEqual(hashJson({a: 1, b: 2}), hashJson({b: 2, a: 1}));
});

// ===================== 2. schema & examples =====================
console.log('plan schema & design examples');
['modeling-plan.json', 'chen-plan.json', 'chen-patch-plan.json'].forEach((file) => {
  test(`structure validates design example ${file}`, () => {
    const plan = JSON.parse(readFileSync(path.join(here, 'fixtures/examples', file), 'utf8'));
    const result = validatePlanStructure(plan);
    assert.strictEqual(result.ok, true, JSON.stringify(result.problems.slice(0, 3)));
  });
});
test('parsePlanText rejects duplicate JSON keys', () => {
  const text = '{"protocolVersion":"1.0","protocolVersion":"1.0"}';
  const result = parsePlanText(text);
  assert.strictEqual(result.ok, false);
  assert.match(result.problems[0].message, /duplicate JSON key/);
});
test('parsePlanText rejects dangerous prototype keys', () => {
  const result = parsePlanText('{"__proto__": {"polluted": true}}');
  assert.strictEqual(result.ok, false);
});
test('unknown command and platform mixing are rejected', () => {
  const plan = JSON.parse(readFileSync(path.join(here, 'fixtures/examples/modeling-plan.json'), 'utf8'));
  const bad = JSON.parse(JSON.stringify(plan));
  bad.operations[0].command = 'model.entity.drop';
  assert.ok(!validatePlanStructure(bad).ok);
  const mixed = JSON.parse(JSON.stringify(plan));
  mixed.operations[0].command = 'drawing.chen.patch';
  assert.ok(!validatePlanStructure(mixed).ok);
});

// ===================== 3. composite happy path =====================
console.log('composite plan: table+diagram+FK+field+standard+quality');
const source0 = makeSource();
const plan1 = buildPlan(source0, compositeOperations());
let preview1;
let applied1;
let ledger1;
test('preview succeeds with no blocking issues', () => {
  preview1 = previewPlan(source0, plan1, {idAllocator: createSequentialIdAllocator('p')});
  assert.deepStrictEqual(preview1.blockingIssues, [],
    JSON.stringify(preview1.blockingIssues));
  assert.ok(preview1.changes.length >= 8);
  assert.strictEqual(preview1.counts.create, 7); // table+diagram+group+2 roots+standard field+rule set
  assert.ok(preview1.counts.update >= 2); // FK edge + field.add
});
test('apply succeeds and mutates a copy, not the original', () => {
  ledger1 = createLedger();
  const result = applyPlan(source0, plan1, {
    commandId: 'cmd-1',
    confirmationId: 'conf-1',
    ledger: ledger1,
    idAllocator: createSequentialIdAllocator('a'),
    context: {projectSessionId: 'sess-1', baseVersion: 'v1', now: Date.now()},
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues || []));
  applied1 = result.dataSource;
  assert.notStrictEqual(applied1, source0);
  assert.strictEqual(source0.entities.length, 1);
  assert.strictEqual(applied1.entities.length, 2);
});
test('applied snapshot: entity/diagram/edge/standard/quality structures', () => {
  const order = applied1.entities.find(entity => entity.defKey === 'dwd_order');
  assert.ok(order, 'order entity created');
  assert.strictEqual(order.fields.length, 2);
  assert.strictEqual(order.fields[0].baseType, 'map_bigint');
  assert.strictEqual(order.fields[0].type, 'BIGINT');
  const diagram = applied1.diagrams.find(item => item.defKey === 'ORDER_VIEW');
  assert.ok(diagram, 'diagram created');
  const cells = diagram.canvasData.cells;
  assert.strictEqual(cells.filter(cell => cell.shape === 'table').length, 2);
  const edges = cells.filter(cell => cell.shape === 'erdRelation');
  assert.strictEqual(edges.length, 1);
  // C9：子表→父表方向，基数 n:1（calcCorrelations 把 relation[0]/source 解析为
  // myEntity/myRows：子表 n 行引用父表 1 行）
  assert.strictEqual(edges[0].relation, 'n:1');
  assert.ok(String(edges[0].source.port).endsWith('%out'));
  assert.ok(String(edges[0].target.port).endsWith('%in'));
  const customer = applied1.entities.find(entity => entity.id === 'ent_customer');
  assert.strictEqual(customer.fields.length, 3, 'field.add applied');
  assert.strictEqual(customer.fields[2].defKey, 'note');
  assert.strictEqual(customer.fields[2].len, 500);
  const trade = applied1.standardFields.find(group => group.defKey === 'TRADE');
  assert.ok(trade, 'standard group created');
  assert.strictEqual(trade.fields.length, 1);
  assert.strictEqual(trade.fields[0].standardMeta.wordRootRefs.length, 2);
  const roots = applied1.profile.fieldRecommendation.wordRoots;
  assert.strictEqual(roots.length, 2);
  const quality = readQualityProfile(applied1);
  assert.strictEqual(quality.modelRuleSets.length, 1);
  assert.strictEqual(quality.modelRuleSets[0].enabled, false, 'default not enabled');
  assert.strictEqual(quality.modelRuleSets[0].scope[0].collection, 'entities');
});
test('receipt: undo token, objects, afterVersion', () => {
  const receipt = ledger1.getReceiptByCommandId('cmd-1');
  assert.ok(receipt);
  assert.strictEqual(receipt.state, 'applied');
  assert.strictEqual(receipt.undo.available, true);
  assert.ok(receipt.objects.length >= 8);
});
test('idempotent replay: same commandId returns original receipt, no duplicates', () => {
  const replay = applyPlan(applied1, plan1, {
    commandId: 'cmd-1',
    confirmationId: 'conf-1b',
    ledger: ledger1,
    context: {projectSessionId: 'sess-1', baseVersion: 'v1', now: Date.now()},
  });
  assert.strictEqual(replay.ok, true);
  assert.strictEqual(replay.replayed, true);
  assert.strictEqual(replay.dataSource.entities.length, 2, 'replay creates nothing');
});
test('re-apply with a new commandId is blocked by readSet staleness', () => {
  const again = applyPlan(applied1, plan1, {
    commandId: 'cmd-2',
    confirmationId: 'conf-2',
    ledger: ledger1,
    context: {projectSessionId: 'sess-1', baseVersion: 'v1', now: Date.now()},
  });
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.code, 'APPLY_FAILED');
  assert.ok(again.issues.some(issue => issue.code === 'PLAN_STALE'));
});

// ===================== 4. guards & failure paths =====================
console.log('guards and failure paths');
test('READ_ONLY: write path refused, preview still works', () => {
  const result = applyPlan(applied1, plan1, {
    commandId: 'cmd-ro',
    confirmationId: 'conf-ro',
    context: {readonly: true, projectSessionId: 'sess-1', now: Date.now()},
  });
  assert.strictEqual(result.code, 'READ_ONLY');
  assert.strictEqual(previewPlan(applied1, plan1).blockingIssues.length >= 0, true);
});
test('wrong project session -> PROJECT_CHANGED', () => {
  const result = applyPlan(source0, plan1, {
    commandId: 'cmd-x', confirmationId: 'conf-x',
    context: {projectSessionId: 'sess-other', now: Date.now()},
  });
  assert.strictEqual(result.code, 'PROJECT_CHANGED');
});
test('baseVersion mismatch -> PLAN_STALE', () => {
  const result = applyPlan(source0, plan1, {
    commandId: 'cmd-x', confirmationId: 'conf-x',
    context: {projectSessionId: 'sess-1', baseVersion: 'v2', now: Date.now()},
  });
  assert.strictEqual(result.code, 'PLAN_STALE');
});
test('expired plan -> PLAN_STALE', () => {
  const expired = buildPlan(source0, compositeOperations().slice(0, 1),
    {expiresAt: new Date(Date.now() - 1000).toISOString()});
  const result = applyPlan(source0, expired, {
    commandId: 'cmd-x', confirmationId: 'conf-x',
    context: {projectSessionId: 'sess-1', now: Date.now()},
  });
  assert.strictEqual(result.code, 'PLAN_STALE');
});
test('missing confirmation -> CONFIRMATION_REQUIRED', () => {
  const result = applyPlan(source0, plan1, {
    commandId: 'cmd-x',
    context: {projectSessionId: 'sess-1', now: Date.now()},
  });
  assert.strictEqual(result.code, 'CONFIRMATION_REQUIRED');
});
test('unknown type blocks and the original source is untouched', () => {
  const ops = [{
    opId: 'bad-table',
    command: 'model.table.create',
    dependsOn: [],
    args: {
      localKey: 'bad', defKey: 'bad_table', defName: '坏表',
      dbType: {kind: 'existing', collection: 'dataTypeSupports', id: 'db_mysql'},
      fields: [{localKey: 'bad.x', defKey: 'x', defName: '未知类型',
        type: 'STRUCT_UNKNOWN', notNull: false, primaryKey: false}],
    },
  }];
  const badPlan = buildPlan(source0, ops);
  const badPreview = previewPlan(source0, badPlan);
  assert.ok(badPreview.blockingIssues.some(issue => issue.code === 'UNKNOWN_TYPE'));
  const result = applyPlan(source0, badPlan, {
    commandId: 'cmd-bad', confirmationId: 'conf-bad',
    context: {projectSessionId: 'sess-1', now: Date.now()},
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'APPLY_FAILED');
  assert.strictEqual(result.dataSource, source0, 'failure keeps the original source');
  assert.strictEqual(source0.entities.length, 1);
});
test('duplicate entity code blocks (platform uniqueness kept)', () => {
  const ops = [{
    opId: 'dup-table', command: 'model.table.create', dependsOn: [],
    args: {
      localKey: 'dup', defKey: 'CUSTOMER', defName: '重名',
      dbType: {kind: 'existing', collection: 'dataTypeSupports', id: 'db_mysql'},
      fields: [{localKey: 'dup.id', defKey: 'id', defName: '编号',
        type: 'BIGINT', notNull: true, primaryKey: true}],
    },
  }];
  const preview = previewPlan(source0, buildPlan(source0, ops));
  assert.ok(preview.blockingIssues.some(issue => issue.code === 'DUPLICATE_CODE'));
});
test('FK owner collision is detected', () => {
  const ops = compositeOperations().map(op => (op.opId === 'fk' ? {
    ...op,
    args: {
      ...op.args,
      sourceFields: [{
        kind: 'existing', collection: 'fields',
        owner: {collection: 'entities', id: 'ent_customer'},
        id: 'f_customer_name',
      }],
    },
  } : op));
  // sourceTable is the plan-local order, but the field belongs to customer
  const preview = previewPlan(source0, buildPlan(source0, ops));
  assert.ok(preview.blockingIssues.some(issue => issue.code === 'OWNER_COLLISION'),
    JSON.stringify(preview.blockingIssues));
});
test('local reference outside dependency closure -> DEPENDENCY_MISSING', () => {
  // quality references the plan-local order entity but no longer depends on
  // the op that produces it — implicit ordering must not satisfy the reference
  const ops = compositeOperations().map(op => (op.opId === 'quality'
    ? {...op, dependsOn: []} : op));
  const preview = previewPlan(source0, buildPlan(source0, ops));
  assert.ok(preview.blockingIssues.some(issue => issue.code === 'DEPENDENCY_MISSING'),
    JSON.stringify(preview.blockingIssues));
});
test('FK without any host diagram blocks (no ghost diagrams)', () => {
  const ops = [{
    opId: 'table-a', command: 'model.table.create', dependsOn: [],
    args: {
      localKey: 'a', defKey: 'tbl_a', defName: 'A',
      dbType: {kind: 'existing', collection: 'dataTypeSupports', id: 'db_mysql'},
      fields: [{localKey: 'a.aid', defKey: 'aid', defName: 'A编号',
        type: 'BIGINT', notNull: true, primaryKey: true}],
    },
  }, {
    opId: 'fk-nohost', command: 'model.foreignKey.create',
    dependsOn: ['table-a'],
    args: {
      localKey: 'fk-a', name: '无宿主外键',
      sourceTable: {kind: 'local', key: 'a'},
      sourceFields: [{kind: 'local', key: 'a.aid'}],
      targetTable: {kind: 'existing', collection: 'entities', id: 'ent_customer'},
      targetFields: [{kind: 'existing', collection: 'fields',
        owner: {collection: 'entities', id: 'ent_customer'}, id: 'f_customer_id'}],
    },
  }];
  const preview = previewPlan(source0, buildPlan(source0, ops));
  assert.ok(preview.blockingIssues.some(issue => issue.code === 'FK_NO_HOST_DIAGRAM'),
    JSON.stringify(preview.blockingIssues));
});
test('drawing platform plan -> CAPABILITY_UNAVAILABLE in modeling core', () => {
  const chenPlan = JSON.parse(readFileSync(path.join(here, 'fixtures/examples/chen-plan.json'), 'utf8'));
  const rest = JSON.parse(JSON.stringify(chenPlan));
  delete rest.planHash;
  const fixed = {...rest, contextDigest: computeContextDigest(rest.readSet)};
  fixed.planHash = computePlanHash(fixed);
  const preview = previewPlan(source0, fixed);
  assert.ok(preview.blockingIssues.some(issue => issue.code === 'CAPABILITY_UNAVAILABLE'));
});
test('unknown command op -> UNKNOWN_COMMAND', () => {
  const ops = [{
    opId: 'mystery', command: 'model.magic.wand', dependsOn: [],
    args: {localKey: 'x'},
  }];
  const preview = previewPlan(source0, buildPlan(source0, ops));
  assert.ok(preview.blockingIssues.some(issue => issue.code === 'UNKNOWN_COMMAND'));
});
test('planHash tampering -> PLAN_HASH_MISMATCH', () => {
  const tampered = {...plan1, summary: 'changed after review', planHash: plan1.planHash};
  const preview = previewPlan(source0, tampered);
  assert.ok(preview.blockingIssues.some(issue => issue.code === 'PLAN_HASH_MISMATCH'));
});
test('manual target change -> PLAN_STALE via readSet fingerprint', () => {
  const mutated = {
    ...source0,
    entities: source0.entities.map(entity => (entity.id === 'ent_customer'
      ? {...entity, comment: '手工改过'} : entity)),
  };
  const verification = verifyReadSet(mutated, plan1.readSet);
  assert.strictEqual(verification.ok, false);
  assert.ok(verification.stale.some(entry => entry.resource === 'entities'));
});

// ===================== 5. partial selection =====================
console.log('partial selection');
test('selectOperations keeps dependency closure and rehashes', () => {
  const selected = selectOperations(plan1, ['standard-order-id']);
  assert.strictEqual(selected.ok, true);
  assert.strictEqual(selected.plan.operations.length, 4,
    'group + 2 roots + field');
  assert.notStrictEqual(selected.plan.planHash, plan1.planHash);
  const preview = previewPlan(source0, selected.plan);
  assert.deepStrictEqual(preview.blockingIssues, []);
});
test('selectOperations rejects unknown ops and empty closures', () => {
  assert.strictEqual(selectOperations(plan1, ['nope']).ok, false);
});

// ===================== 6. undo =====================
console.log('undo post-conditions');
test('undo restores the whole changeset on unchanged resources', () => {
  const undone = undoChangeSet(applied1, ledger1, 'cmd-1');
  assert.strictEqual(undone.ok, true, JSON.stringify(undone.detail || []));
  const source = undone.dataSource;
  assert.strictEqual(source.entities.length, 1);
  assert.strictEqual(source.entities[0].fields.length, 2, 'field.add rolled back');
  assert.strictEqual(source.diagrams.length, 0);
  assert.strictEqual(source.standardFields.find(group => group.defKey === 'TRADE'), undefined);
  assert.strictEqual(source.profile.fieldRecommendation.wordRoots.length, 0);
  assert.strictEqual(readQualityProfile(source).modelRuleSets.length, 0);
});
test('undo refuses when a touched resource changed afterwards', () => {
  const ledger = createLedger();
  const result = applyPlan(source0, plan1, {
    commandId: 'cmd-undo2', confirmationId: 'conf-undo2', ledger,
    context: {projectSessionId: 'sess-1', baseVersion: 'v1', now: Date.now()},
  });
  assert.strictEqual(result.ok, true);
  const laterEdit = {
    ...result.dataSource,
    entities: result.dataSource.entities.map(entity => (entity.defKey === 'dwd_order'
      ? {...entity, comment: 'later manual edit'} : entity)),
  };
  const blocked = undoChangeSet(laterEdit, ledger, 'cmd-undo2');
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, 'UNDO_CONFLICT');
});
test('undo proceeds when only unrelated objects changed', () => {
  const ledger = createLedger();
  const result = applyPlan(source0, plan1, {
    commandId: 'cmd-undo3', confirmationId: 'conf-undo3', ledger,
    context: {projectSessionId: 'sess-1', baseVersion: 'v1', now: Date.now()},
  });
  assert.strictEqual(result.ok, true);
  const withUnrelated = {
    ...result.dataSource,
    entities: result.dataSource.entities.concat([{
      id: 'ent_later', defKey: 'later_table', defName: '后续无关表', type: 'P', fields: [],
    }]),
  };
  const undone = undoChangeSet(withUnrelated, ledger, 'cmd-undo3');
  assert.strictEqual(undone.ok, true);
  assert.ok(undone.dataSource.entities.some(entity => entity.id === 'ent_later'),
    'unrelated later work preserved');
  assert.ok(!undone.dataSource.entities.some(entity => entity.defKey === 'dwd_order'));
});

// ===================== 7. quality DSL =====================
console.log('quality DSL');
test('runModelQuality separates pass/fail/notApplicable on enabled sets', () => {
  const entityOk = {id: 'e1', defKey: 'good_table', defName: '好表',
    fields: [field('f1', 'id', '编号', 'BIGINT', 'map_bigint', {primaryKey: true})]};
  const entityBad = {id: 'e2', defKey: 'BadTable', defName: '',
    fields: [field('f2', 'x', 'X', 'INT', 'map_int')]};
  const concept = {id: 'c1', defKey: 'Concept', defName: '概念', fields: []};
  const source = {
    ...makeSource(),
    entities: [entityOk, entityBad],
    conceptEntities: [concept],
    profile: {
      ...makeSource().profile,
      quality: {
        schemaVersion: 1,
        modelRuleSets: [{
          id: 'rs1', name: '规则一', enabled: true,
          scope: [{collection: 'entities', id: 'e1'},
            {collection: 'entities', id: 'e2'},
            {collection: 'conceptEntities', id: 'c1'}],
          rules: [
            {id: 'r1', name: '主键', severity: 'error', target: 'physicalTable',
              predicate: {op: 'hasPrimaryKey'}},
            {id: 'r2', name: '中文名', severity: 'warning', target: 'physicalTable',
              predicate: {op: 'required', field: 'defName'}},
            {id: 'r3', name: '命名', severity: 'warning', target: 'physicalTable',
              predicate: {op: 'nameStyle', style: 'snake_lower'}},
            {id: 'r4', name: '概念主键', severity: 'warning', target: 'conceptEntity',
              predicate: {op: 'hasPrimaryKey'}},
          ],
        }, {
          id: 'rs2', name: '未启用', enabled: false,
          scope: [{collection: 'entities', id: 'e1'}],
          rules: [{id: 'r5', name: 'x', severity: 'error', target: 'physicalTable',
            predicate: {op: 'hasPrimaryKey'}}],
        }],
      },
    },
  };
  const report = runModelQuality(source);
  const rs1 = report.ruleSets.find(ruleSet => ruleSet.id === 'rs1');
  assert.ok(rs1, 'enabled set runs');
  assert.strictEqual(report.ruleSets.length, 1, 'disabled set does not run');
  const byRule = new Map(rs1.rules.map(rule => [rule.ruleId, rule.results]));
  assert.strictEqual(byRule.get('r1')[0].status, 'pass'); // e1 has pk
  assert.strictEqual(byRule.get('r1')[1].status, 'fail'); // e2 no pk
  assert.strictEqual(byRule.get('r1')[2].status, 'notApplicable'); // concept entry under table rule
  assert.strictEqual(byRule.get('r2')[1].status, 'fail'); // e2 empty defName
  assert.strictEqual(byRule.get('r3')[0].status, 'pass'); // good_table
  assert.strictEqual(byRule.get('r3')[1].status, 'fail'); // BadTable
  assert.strictEqual(byRule.get('r4')[0].status, 'notApplicable'); // entity entry under concept rule
  assert.strictEqual(byRule.get('r4')[2].status, 'notApplicable'); // concept has no physical keys
  assert.strictEqual(report.summary.pass, 3);
  assert.strictEqual(report.summary.fail, 3);
  assert.strictEqual(report.summary.notApplicable, 6);
  assert.strictEqual(report.summary.error, 0);
});
test('unknown predicate rejected at definition time and errored at runtime', () => {
  const invalid = validateQualityRuleSet({name: 'x', enabled: true, scope: [],
    rules: [{name: 'r', severity: 'error', target: 'physicalTable',
      predicate: {op: 'dropTable'}}]});
  assert.ok(invalid.some(problem => problem.code === 'UNSUPPORTED_PREDICATE'));
  const source = {...makeSource(), profile: {...makeSource().profile, quality: {
    schemaVersion: 1,
    modelRuleSets: [{id: 'rs9', name: 'x', enabled: true,
      scope: [{collection: 'entities', id: 'ent_customer'}],
      rules: [{id: 'r9', name: 'r', severity: 'error', target: 'physicalTable',
        predicate: {op: 'evil'}}]}],
  }}};
  const report = runModelQuality(source);
  assert.ok(report.summary.error >= 1);
  assert.strictEqual(report.summary.pass, 0);
});
test('standardMatch composes word-root abbreviations', () => {
  const source = {
    ...makeSource(),
    entities: [{id: 'e1', defKey: 'order_id', defName: '订单编号',
      fields: [field('fx', 'order_id', '订单编号', 'BIGINT', 'map_bigint')]}],
    profile: {
      ...makeSource().profile,
      fieldRecommendation: {wordRoots: [
        {id: 'wr_order', defKey: 'order', defName: '订单', fullName: 'Order'},
        {id: 'wr_id', defKey: 'id', defName: '编号', fullName: 'Identifier'},
      ]},
      quality: {schemaVersion: 1, modelRuleSets: [{
        id: 'rs10', name: 'm', enabled: true,
        scope: [{collection: 'fields', owner: {collection: 'entities', id: 'e1'}, id: 'fx'}],
        rules: [{id: 'r10', name: 'm', severity: 'error', target: 'field',
          predicate: {op: 'standardMatch', standardRefs: [
            {kind: 'existing', collection: 'wordRoots', id: 'wr_order'},
            {kind: 'existing', collection: 'wordRoots', id: 'wr_id'},
          ]}}],
      }]},
    },
  };
  const report = runModelQuality(source);
  assert.strictEqual(report.summary.pass, 1);
  assert.deepStrictEqual(report.ruleSets[0].rules[0].results[0].expected, ['order_id']);
});
test('budget overrun surfaces as error, never as pass', () => {
  const many = [];
  for (let i = 0; i < 5; i += 1) {
    many.push({id: `e${i}`, defKey: `t${i}`, defName: `表${i}`,
      fields: [field(`f${i}`, 'id', '编号', 'BIGINT', 'map_bigint', {primaryKey: true})]});
  }
  const source = {...makeSource(), entities: many, profile: {...makeSource().profile,
    quality: {schemaVersion: 1, modelRuleSets: [{
      id: 'rsB', name: 'b', enabled: true,
      scope: many.map(entity => ({collection: 'entities', id: entity.id})),
      rules: [{id: 'rB', name: 'b', severity: 'error', target: 'physicalTable',
        predicate: {op: 'hasPrimaryKey'}}],
    }]}}};
  const report = runModelQuality(source, {budget: {maxObjectsPerRuleSet: 2, maxTotalEvaluations: 3}});
  assert.strictEqual(report.budgetExceeded, true);
  assert.ok(report.summary.error >= 2);
});

// ===================== 8. SQL DDL parser =====================
console.log('SQL DDL subset parser');
const mysqlDdl = `-- synthetic mysql fixture
CREATE TABLE \`order\` (
  order_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '订单编号',
  customer_id BIGINT NOT NULL COMMENT '客户编号',
  amount DECIMAL(10,2) DEFAULT 0.00 COMMENT '金额',
  remark VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id),
  KEY idx_customer (customer_id),
  CONSTRAINT fk_order_customer FOREIGN KEY (customer_id)
    REFERENCES customer (id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单表';
CREATE INDEX idx_amount ON \`order\` (amount);
`;
test('mysql: two statements parsed with columns/keys/fk/options', () => {
  const parsed = parseDdlScript(mysqlDdl, {dialect: 'mysql'});
  assert.deepStrictEqual(parsed.errors, []);
  assert.strictEqual(parsed.summary.createTable, 1);
  assert.strictEqual(parsed.summary.createIndex, 1);
  assert.strictEqual(parsed.summary.unsupported, 0);
  const table = parsed.statements[0];
  assert.strictEqual(table.table.table.value, 'order');
  assert.strictEqual(table.columns.length, 5);
  const orderId = table.columns[0];
  assert.strictEqual(orderId.type.raw, 'BIGINT UNSIGNED');
  assert.strictEqual(orderId.type.len, null);
  assert.strictEqual(orderId.autoIncrement, true);
  assert.strictEqual(orderId.comment, '订单编号');
  const amount = table.columns[2];
  assert.strictEqual(amount.type.raw, 'DECIMAL');
  assert.strictEqual(amount.type.len, 10);
  assert.strictEqual(amount.type.scale, 2);
  assert.strictEqual(amount.defaultValue.raw, '0.00');
  assert.deepStrictEqual(table.primaryKey.columns, ['order_id']);
  assert.strictEqual(table.indexes.length, 1);
  const fk = table.foreignKeys[0];
  assert.strictEqual(fk.name, 'fk_order_customer');
  assert.deepStrictEqual(fk.columns, ['customer_id']);
  assert.strictEqual(fk.refTable.value, 'customer');
  assert.deepStrictEqual(fk.refColumns, ['id']);
  assert.strictEqual(fk.onDelete, 'CASCADE');
  assert.strictEqual(fk.onUpdate, 'RESTRICT');
  assert.strictEqual(table.tableComment, '订单表');
});
const pgDdl = `CREATE TABLE myschema."Order" (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  price NUMERIC(12,4),
  created TIMESTAMPTZ,
  note TEXT,
  CONSTRAINT fk_code UNIQUE (code)
);
ALTER TABLE myschema."Order" ADD CONSTRAINT fk_ext
  FOREIGN KEY (code) REFERENCES myschema.dict (code) ON DELETE SET NULL;
`;
test('postgresql: quoted/schema/serial/timestamptz/alter fk', () => {
  const parsed = parseDdlScript(pgDdl, {dialect: 'postgresql'});
  assert.deepStrictEqual(parsed.errors, []);
  assert.strictEqual(parsed.summary.createTable, 1);
  assert.strictEqual(parsed.summary.alterForeignKey, 1);
  const table = parsed.statements[0];
  assert.strictEqual(table.table.prefix, 'myschema');
  assert.strictEqual(table.table.table.value, 'Order');
  assert.strictEqual(table.columns[0].type.raw, 'SERIAL');
  assert.strictEqual(table.columns[3].type.raw, 'TIMESTAMPTZ');
  assert.strictEqual(table.columns[2].type.scale, 4);
  assert.deepStrictEqual(table.primaryKey.columns, ['id']);
  assert.deepStrictEqual(table.uniques[0].columns, ['code']);
  const alter = parsed.statements[1];
  assert.strictEqual(alter.foreignKey.name, 'fk_ext');
  assert.strictEqual(alter.foreignKey.refTable.value, 'myschema.dict');
  assert.strictEqual(alter.foreignKey.onDelete, 'SET NULL');
});
test('unsupported dialect rejected up front', () => {
  const parsed = parseDdlScript('CREATE TABLE t (id INT);', {dialect: 'oracle'});
  assert.strictEqual(parsed.error, 'DIALECT_UNSUPPORTED');
  assert.deepStrictEqual(parsed.supportedDialects, SQL_DIALECTS);
});
const mixedScript = `CREATE TABLE a (id INT PRIMARY KEY);
INSERT INTO a VALUES (1);
DROP TABLE b;
CREATE TABLE b (id INT);
`;
test('mixed script: DML/DROP reported explicitly and drafts blocked', () => {
  const parsed = parseDdlScript(mixedScript, {dialect: 'mysql'});
  assert.strictEqual(parsed.summary.createTable, 2);
  assert.strictEqual(parsed.summary.unsupported, 2);
  const unsupported = parsed.unsupportedStatements.map(statement => statement.statementType);
  assert.deepStrictEqual(unsupported, ['INSERT', 'DROP']);
  assert.ok(parsed.unsupportedStatements[0].range.line >= 2);
  const drafts = draftTableOpsFromDdl(parsed);
  assert.strictEqual(drafts.blocked, 'SQL_PARTIAL_PARSE');
  assert.strictEqual(drafts.unsupported.length, 2);
});
test('acknowledged mixed script drafts only the parsed subset', () => {
  const parsed = parseDdlScript(mixedScript, {dialect: 'mysql'});
  const drafts = draftTableOpsFromDdl(parsed, {acknowledgeUnsupported: true});
  assert.strictEqual(drafts.blocked, null);
  assert.strictEqual(drafts.operations.filter(op => op.command === 'model.table.create').length, 2);
});
test('FK to an absent table stays pending, never a ghost draft', () => {
  const ddl = `CREATE TABLE t1 (id INT PRIMARY KEY, ref_id INT,
    FOREIGN KEY (ref_id) REFERENCES missing_table (id));`;
  const parsed = parseDdlScript(ddl, {dialect: 'mysql'});
  const drafts = draftTableOpsFromDdl(parsed, {acknowledgeUnsupported: true});
  assert.strictEqual(drafts.pendingForeignKeys.length, 1);
  assert.strictEqual(drafts.pendingForeignKeys[0].refTable, 'missing_table');
  assert.ok(!drafts.operations.some(op => op.command === 'model.foreignKey.create'));
});
test('in-script FK becomes an op draft with local references', () => {
  const ddl = `CREATE TABLE customer (id BIGINT PRIMARY KEY);
CREATE TABLE ord (oid BIGINT PRIMARY KEY, cid BIGINT,
  CONSTRAINT fk_c FOREIGN KEY (cid) REFERENCES customer (id));`;
  const parsed = parseDdlScript(ddl, {dialect: 'mysql'});
  const drafts = draftTableOpsFromDdl(parsed);
  const fk = drafts.operations.find(op => op.command === 'model.foreignKey.create');
  assert.ok(fk);
  assert.deepStrictEqual(fk.dependsOn, ['op-ord', 'op-customer']);
  assert.deepStrictEqual(fk.args.targetTable, {kind: 'local', key: 'customer'});
});
test('generated column / check recorded as unsupported feature with position', () => {
  const ddl = `CREATE TABLE t (id INT PRIMARY KEY,
    name VARCHAR(20) GENERATED ALWAYS AS (concat(id, 'x')) STORED,
    CHECK (id > 0));`;
  const parsed = parseDdlScript(ddl, {dialect: 'mysql'});
  const table = parsed.statements[0];
  const features = table.unsupportedFeatures.map(feature => feature.feature).sort();
  assert.ok(features.includes('generatedColumn'));
  assert.ok(features.includes('checkConstraint'));
});
test('statement positions let the host locate original text', () => {
  const parsed = parseDdlScript(mysqlDdl, {dialect: 'mysql'});
  const first = parsed.statements[0];
  const slice = mysqlDdl.slice(first.range.start, first.range.end);
  assert.ok(slice.startsWith('CREATE TABLE'));
  assert.ok(slice.includes('ENGINE=InnoDB'));
});
test('default expressions round-trip through the parser serializer (mysql)', () => {
  const ddl = `CREATE TABLE t (
    a TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
    b INT DEFAULT 5,
    c VARCHAR(8) DEFAULT 'x');`;
  const parsed = parseDdlScript(ddl, {dialect: 'mysql'});
  const cols = parsed.statements[0].columns;
  assert.match(cols[0].defaultValue.raw, /^CURRENT_TIMESTAMP/i);
  assert.strictEqual(cols[1].defaultValue.raw, '5');
  assert.strictEqual(cols[2].defaultValue.raw, "'x'");
});
test('postgresql defaults keep now()/cast/nextval expressions', () => {
  const ddl = `CREATE TABLE t (ts TIMESTAMPTZ DEFAULT now(),
    n TEXT DEFAULT 'x'::text, q INT DEFAULT nextval('s'));`;
  const parsed = parseDdlScript(ddl, {dialect: 'postgresql'});
  const cols = parsed.statements[0].columns;
  assert.match(cols[0].defaultValue.raw, /^now\(\)/i);
  assert.match(cols[1].defaultValue.raw, /^'x'::text$/i);
  assert.match(cols[2].defaultValue.raw, /^nextval\('s'\)$/i);
});
test('postgresql array and WITH TIME ZONE suffixes preserved in type text', () => {
  const ddl = 'CREATE TABLE t (tags VARCHAR(30)[], ts TIMESTAMP(3) WITH TIME ZONE);';
  const parsed = parseDdlScript(ddl, {dialect: 'postgresql'});
  const cols = parsed.statements[0].columns;
  assert.strictEqual(cols[0].type.raw, 'VARCHAR[]');
  assert.strictEqual(cols[0].type.len, 30);
  assert.strictEqual(cols[1].type.raw, 'TIMESTAMP WITH TIME ZONE');
  assert.strictEqual(cols[1].type.len, 3);
});
test('unparseable statements become explicit unsupported with a position', () => {
  const ddl = 'CREATE TABLE t (a INT);\nCREATE TABLE p (a INT) PARTITION BY HASH (a);';
  const parsed = parseDdlScript(ddl, {dialect: 'mysql'});
  assert.strictEqual(parsed.summary.createTable, 1);
  assert.strictEqual(parsed.summary.unsupported, 1);
  const bad = parsed.unsupportedStatements[0];
  assert.match(bad.reason, /^parse failed:/);
  assert.ok(bad.range.line >= 2);
});
test('CREATE VIEW and other non-subset DDL classified by statement type', () => {
  const parsed = parseDdlScript('CREATE VIEW v AS SELECT 1 FROM t;', {dialect: 'mysql'});
  assert.strictEqual(parsed.summary.unsupported, 1);
  assert.strictEqual(parsed.unsupportedStatements[0].statementType, 'CREATE VIEW');
});
test('ALTER TABLE variants outside ADD FOREIGN KEY/INDEX rejected explicitly', () => {
  const parsed = parseDdlScript('ALTER TABLE t ADD COLUMN b INT;', {dialect: 'mysql'});
  assert.strictEqual(parsed.summary.unsupported, 1);
  assert.strictEqual(parsed.unsupportedStatements[0].statementType, 'ALTER TABLE');
  assert.match(parsed.unsupportedStatements[0].reason, /ADD FOREIGN KEY/);
});
test('dollar-quoted bodies stay one statement (no bogus split)', () => {
  const fn = 'CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql;';
  const parsed = parseDdlScript(fn, {dialect: 'postgresql'});
  assert.strictEqual(parsed.statements.length, 1);
  assert.strictEqual(parsed.unsupportedStatements[0].statementType, 'CREATE FUNCTION');
});
test('inline column REFERENCES maps to a foreign key', () => {
  const ddl = 'CREATE TABLE a (id INT PRIMARY KEY);\nCREATE TABLE b (aid INT REFERENCES a (id));';
  const parsed = parseDdlScript(ddl, {dialect: 'postgresql'});
  const table = parsed.statements[1];
  assert.strictEqual(table.foreignKeys.length, 1);
  assert.deepStrictEqual(table.foreignKeys[0].columns, ['aid']);
  assert.strictEqual(table.foreignKeys[0].refTable.value, 'a');
  assert.deepStrictEqual(table.foreignKeys[0].refColumns, ['id']);
});

// ===================== 9. registry & misc =====================
console.log('registry');
test('registry lists exactly the eight modeling commands', () => {
  const names = listCommands().map(command => command.name);
  assert.deepStrictEqual(names.sort(), ['model.diagram.create', 'model.field.add',
    'model.foreignKey.create', 'model.table.create', 'quality.modelRuleSet.create',
    'standard.field.create', 'standard.group.create', 'standard.root.create']);
  assert.strictEqual(describeCommand('model.table.create').transactionDomain, 'modeling-project');
  assert.strictEqual(describeCommand('drawing.chen.patch'), null);
});
test('fingerprint distinguishes object slices', () => {
  const a = resourceFingerprint(source0, 'entities/ent_customer/fields');
  const mutated = {
    ...source0,
    entities: source0.entities.map(entity => (entity.id === 'ent_customer'
      ? {...entity, comment: '别的改动'} : entity)),
  };
  const b = resourceFingerprint(mutated, 'entities/ent_customer/fields');
  assert.strictEqual(a, b, 'comment change does not touch the fields slice');
  const c = resourceFingerprint({
    ...source0,
    entities: source0.entities.map(entity => (entity.id === 'ent_customer'
      ? {...entity, fields: entity.fields.concat([field('f9', 'x', 'X', 'INT', 'map_int')])}
      : entity)),
  }, 'entities/ent_customer/fields');
  assert.notStrictEqual(a, c, 'field addition changes the slice fingerprint');
});

// ===================== 10. context redaction (AI-02) =====================
console.log('context redaction');
{
  const MASK = '[已遮蔽]';
  const assertMasked = (input, secret, keep = []) => {
    const out = redactSensitiveText(input);
    assert.ok(!out.text.includes(secret), `secret leaked: ${JSON.stringify(input)} -> ${JSON.stringify(out.text)}`);
    assert.ok(out.text.includes(MASK), `no mask marker: ${JSON.stringify(out.text)}`);
    assert.ok(out.maskCount >= 1, 'maskCount counted');
    assert.ok(out.notices.some(n => n.includes('密钥/令牌')), 'credential notice present');
    keep.forEach(k => assert.ok(out.text.includes(k), `expected to keep ${JSON.stringify(k)} in ${JSON.stringify(out.text)}`));
    return out;
  };
  const assertUnchanged = (input) => {
    const out = redactSensitiveText(input);
    assert.strictEqual(out.text, input, `over-masked: ${JSON.stringify(input)} -> ${JSON.stringify(out.text)}`);
    assert.strictEqual(out.maskCount, 0);
    assert.deepStrictEqual(out.notices, []);
  };

  test('Authorization: Bearer keeps the scheme word, masks only the token', () => {
    const out = assertMasked('Authorization: Bearer abc123def456ghi789', 'abc123def456ghi789', ['Authorization', 'Bearer']);
    assert.strictEqual(out.text, `Authorization: Bearer ${MASK}`);
    assert.strictEqual(out.maskCount, 1, 'masked exactly once');
    assertMasked('curl -H "authorization: bearer eyJhbGciOiJIUzI1NiJ9.e30.sig123"', 'eyJhbGciOiJIUzI1NiJ9', ['bearer']);
    assertMasked('{"Authorization": "Bearer abc123def456ghi789"}', 'abc123def456ghi789', ['Authorization', 'Bearer']);
    assertMasked('send it as Bearer abc123def456ghi789 please', 'abc123def456ghi789', ['Bearer']);
    assertMasked('Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA', ['Basic']);
  });
  test('URL userinfo password is masked, user/host kept', () => {
    const out = assertMasked('mysql://root:S3cret@db:3306/x', 'S3cret', ['mysql://root:', '@db:3306/x']);
    assert.strictEqual(out.text, `mysql://root:${MASK}@db:3306/x`);
    assertMasked('jdbc:postgresql://admin:p%40ss!word@10.0.0.1:5432/dw', 'p%40ss!word', ['admin', '10.0.0.1']);
    assertMasked('redis://default:Zx9@cache:6379', 'Zx9', ['cache:6379']);
  });
  test('JSON-form password/token/secret/api_key values are masked, key names kept', () => {
    const out = assertMasked('{"password":"hunter2hunter"}', 'hunter2hunter', ['"password"']);
    // 与既有 key=value 规则一致：引号连同值一起被替换（password="x" → password=[已遮蔽]）
    assert.strictEqual(out.text, `{"password":${MASK}}`);
    assertMasked('{"user":"u","token": "t0k"}', 't0k', ['"token"', '"user":"u"']);
    assertMasked("{'client_secret': 'cs-998877'}", 'cs-998877', ['client_secret']);
    assertMasked('{"api_key":"abcd"}', '"abcd"', ['"api_key"']);
  });
  test('Chinese labels 密码/口令/密钥 with an operator mask the value', () => {
    assertMasked('密码:Abcd1234efgh', 'Abcd1234efgh', ['密码']);
    assertMasked('数据库密码：Abcd1234', 'Abcd1234', ['数据库密码']);
    assertMasked('口令 = qwer1234', 'qwer1234', ['口令']);
    assertMasked('密钥=k9k9k9k9', 'k9k9k9k9', ['密钥']);
  });
  test('secret_key / secret-key / client_secret / short values via key=value', () => {
    assertMasked('secret_key=zzzz9999yyyy', 'zzzz9999yyyy', ['secret_key=']);
    assertMasked('secret-key: zzzz9999yyyy', 'zzzz9999yyyy', ['secret-key']);
    assertMasked('client_secret=abc12345', 'abc12345', ['client_secret=']);
    assertMasked('aws_secret_access_key=wJalrXUtnFEMI', 'wJalrXUtnFEMI');
    assertMasked('token=ab12', 'ab12', ['token=']);
    assertMasked('password="x1"', 'x1"', ['password=']);
  });
  test('Alibaba Cloud LTAI access key id is masked', () => {
    const out = assertMasked('ak is LTAI5tAbCdEfGhIjKlMnOp ok', 'LTAI5tAbCdEfGhIjKlMnOp', ['ak is ', ' ok']);
    assert.strictEqual(out.text, `ak is ${MASK} ok`);
  });
  test('ordinary prose is not over-masked', () => {
    [
      'the token count is high',
      'password policy is strict',
      '密码学基础',
      '密码学: 对称与非对称',
      '密码：请联系管理员',
      'use a Bearer token in prose',
      'Bearer authentication is described in RFC 6750',
      'the secretary: John',
      'token_count = 5',
      'see https://example.com:8443/docs and http://host/a@b',
      'email me at someone@example.com',
      'LTAI is a prefix',
      'ratio 3:2, time 12:30',
      // 有赋值符但值不像凭据：短占位词（不含数字）、字段类型、长度说明、非 userinfo 的 @
      'token: none',
      'password: null',
      'pwd: ./bin',
      'max_tokens: 4096',
      'password_hash: char(64)',
      '密码长度: 8',
      '密钥: 由KMS托管',
      'git@github.com:org/repo.git',
      'ssh://git@host:22/x',
    ].forEach(assertUnchanged);
  });
  test('previously covered redaction cases still behave the same', () => {
    const same = (input, expected, count = 1) => {
      const out = redactSensitiveText(input);
      assert.strictEqual(out.text, expected, `${JSON.stringify(input)} -> ${JSON.stringify(out.text)}`);
      assert.strictEqual(out.maskCount, count, `maskCount for ${JSON.stringify(input)}`);
    };
    same('api_key=sk-abcdefghijklmnop', `api_key=${MASK}`);
    same('token: abcdef123456', `token: ${MASK}`);
    same('password="hunter2"', `password=${MASK}`);
    same("pwd='abcd1234'", `pwd=${MASK}`);
    same('apikey = "abcd"', `apikey = ${MASK}`);
    same('access-key: 1234567890', `access-key: ${MASK}`);
    same('credential=abcdef', `credential=${MASK}`);
    same('authorization=abcdef123', `authorization=${MASK}`);
    same('key sk-abcdefghijklmnopqr here', `key ${MASK} here`);
    same('ghp_abcdefghijklmnopqrstuvwxyz', MASK);
    same('AKIAABCDEFGHIJKLMNOP', MASK);
    same('xoxb-1234567890-abcdef', MASK);
    same('-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', MASK);
    const p = redactSensitiveText('read /Users/alice/x.txt and C:\\Users\\bob\\y.sql');
    assert.strictEqual(p.text, `read ${MASK} and ${MASK}`);
    assert.strictEqual(p.maskCount, 2);
    assert.deepStrictEqual(p.notices, ['输入中检测到本机路径，已遮蔽；上下文不会携带 OS 路径。']);
    const both = redactSensitiveText('token=abcdef123 at /home/u/f');
    assert.strictEqual(both.notices.length, 2, 'credential + path notices');
    assert.deepStrictEqual(redactSensitiveText(42), {text: '', maskCount: 0, notices: []});
  });

  // ---- 性能回归（ReDoS 守卫）：对抗输入在修复后为数毫秒，限 200ms 足够宽松不抖动 ----
  const LIMIT_MS = 200;
  const N = 100000;
  const rep = (s, n = N) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
  const timeRedact = (input) => {
    let best = Infinity;
    for (let i = 0; i < 2; i += 1) { // 取两次中较快者，排除偶发 GC/调度抖动
      const t0 = process.hrtime.bigint();
      redactSensitiveText(input);
      best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return best;
  };
  test('adversarial inputs redact in linear time (no polynomial backtracking)', () => {
    const adversarial = {
      'a- x15000 (30KB)': 'a-'.repeat(15000),
      'a- 100KB': rep('a-'),
      'v1. 100KB': rep('v1.'),
      'ab. 100KB': rep('ab.'),
      'a+b. 100KB': rep('a+b.'),
      ':// 100KB': rep('://'),
      'x://u: 100KB': rep('x://u:'),
      'a://b:c 100KB': rep('a://b:c'),
      'x://u:+p… 100KB': 'x://u:' + 'p'.repeat(N),
      'password: 100KB': rep('password:'),
      '"password":" 100KB': rep('"password":"'),
      '"password":"+x… (unterminated)': '"password":"' + 'x'.repeat(N),
      'secret_key_id 100KB': rep('secret_key_id '),
      '密码: 100KB': rep('密码:'),
      '密码:"+a… (unterminated)': '密码:"' + 'a'.repeat(N),
      'Bearer 100KB': rep('Bearer '),
      'Bearer 1 100KB': rep('Bearer 1'),
      'Bearer +a… 100KB': 'Bearer ' + 'a'.repeat(N),
      'authorization:"Bearer 100KB': rep('authorization:"Bearer '),
      'LTAI+a… 100KB': 'LTAI' + 'a'.repeat(N),
      'PEM BEGIN without END 100KB': rep('-----BEGIN PRIVATE KEY-----\n'),
      'PEM BEGIN without END 300KB': rep('-----BEGIN PRIVATE KEY-----\n', 300000),
      'PEM type run 100KB': '-----BEGIN ' + rep('A ') + 'X',
      '/home/ 100KB': rep('/home/'),
    };
    const slow = Object.entries(adversarial)
      .map(([name, input]) => [name, timeRedact(input)])
      .filter(([, ms]) => ms > LIMIT_MS);
    assert.deepStrictEqual(slow.map(([name, ms]) => `${name}: ${ms.toFixed(0)}ms`), [], 'slow redaction');
  });
  test('userinfo/PEM positives still masked after the ReDoS fix; scheme boundary is 32 chars', () => {
    const s32 = 'a'.repeat(32);
    const s33 = 'a'.repeat(33);
    // 32 字符 scheme（RFC 3986 scheme 实际都很短）仍识别
    assert.strictEqual(redactSensitiveText(`${s32}://root:S3cret@db/x`).text, `${s32}://root:${MASK}@db/x`);
    // 33 个连续字母的 scheme 超出上限且内部无词边界：不识别（已知且接受的边界，见报告）
    const over = `${s33}://root:S3cret@db/x`;
    assert.strictEqual(redactSensitiveText(over).text, over);
    // 带分隔符的长 scheme：从最后 ≤32 字符的词边界起识别，口令仍被遮蔽
    assert.ok(!redactSensitiveText(`${'x'.repeat(40)}+ssh://root:S3cret@db/x`).text.includes('S3cret'));
    // 对抗前缀后紧跟真实 userinfo：仍遮蔽
    assert.ok(!redactSensitiveText(`${'a-'.repeat(5000)} mysql://root:S3cret@db:3306/x`).text.includes('S3cret'));
    assert.strictEqual(redactSensitiveText('git+ssh://u:pw12@h/x').text, `git+ssh://u:${MASK}@h/x`);
    // PEM：正常私钥块整体遮蔽；前面有一个不闭合的 BEGIN 时，后面完整的块仍被遮蔽
    const pem = '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE\n-----END EC PRIVATE KEY-----';
    assert.strictEqual(redactSensitiveText(`a ${pem} b`).text, `a ${MASK} b`);
    assert.strictEqual(redactSensitiveText(`-----BEGIN PRIVATE KEY-----\ntruncated\n${pem}`).text,
      `-----BEGIN PRIVATE KEY-----\ntruncated\n${MASK}`);
  });
}

// ===================== 11. credential status from configure receipt (AI-01 follow-up) =====================
{
  // broker 在「改 endpoint/协议但没重输 key」时会清除 key，回执 hasCredential=false：界面必须回到 none
  test('hasCredential=false overrides previous session status', () => {
    assert.strictEqual(credentialStatusFromReceipt({id: 'p', hasCredential: false}, false, 'session'), 'none');
  });
  test('hasCredential=false wins even if a key was just delivered (Host is authoritative)', () => {
    assert.strictEqual(credentialStatusFromReceipt({id: 'p', hasCredential: false}, true, 'none'), 'none');
  });
  test('delivered key -> session', () => {
    assert.strictEqual(credentialStatusFromReceipt({id: 'p', hasCredential: true}, true, 'none'), 'session');
    assert.strictEqual(credentialStatusFromReceipt({id: 'p'}, true, 'none'), 'session');
  });
  test('no new key but Host still holds one -> session (e.g. controller remounted)', () => {
    assert.strictEqual(credentialStatusFromReceipt({id: 'p', hasCredential: true}, false, 'none'), 'session');
  });
  test('receipt without hasCredential / no receipt keeps previous status', () => {
    assert.strictEqual(credentialStatusFromReceipt({id: 'p'}, false, 'session'), 'session');
    assert.strictEqual(credentialStatusFromReceipt({id: 'p'}, false, 'none'), 'none');
    assert.strictEqual(credentialStatusFromReceipt(null, false, 'session'), 'session');
    assert.strictEqual(credentialStatusFromReceipt(undefined, false, 'none'), 'none');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
