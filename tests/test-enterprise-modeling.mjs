// CS-M 企业级统一建模全链路断言测试
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

import {
  HOME_CANVAS_MIME,
  HOME_CANVAS_SCHEMA_VERSION,
  HOME_LABELS,
  HOME_NODE_DEFAULTS,
  HOME_NODE_KINDS,
  cellsFromHomeCanvas,
  diagramDisplayName,
  diagramThumbGeometry,
  findDiagram,
  homeCanvasBounds,
  homeCanvasFromCells,
  normalizeHomeCanvas,
  readHomeCanvas,
  resolveDiagramRef,
  writeEnterpriseInfo,
  writeHomeCanvas,
} from '../src/lib/enterprise_home.js';

import {
  CONCEPT_LOGICAL_LINKS_KEY,
  addConceptLogicalLinks,
  conceptLinkedLogicStats,
  isLinkEffective,
  linkDeletionImpact,
  linksForConcept,
  linksForLogic,
  mergeConceptLogicalLinkCollections,
  physicalSourcesForLogic,
  readConceptLogicalLinks,
  remapConceptLogicalLinksForReduce,
  removeConceptLogicalLinks,
  resolveConceptLogicalLinks,
  updateConceptLogicalLink,
} from '../src/lib/concept_logical_links.js';

import {
  stripLogicPrefix,
  resolveFieldMapping,
  validateDDLTemplate,
  checkDefKeyUniqueness,
  planForwardGeneration,
  buildForwardCommit,
} from '../src/lib/model_forward_engineering.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${passed} ${name}`);
}

// 1. Enterprise Home Constants & Schemas
test('EnterpriseHome: 常量规范与默认画布结构', () => {
  assert.equal(HOME_CANVAS_SCHEMA_VERSION, 1);
  assert.equal(HOME_CANVAS_MIME, 'application/x-pdman-enterprise-home');
  assert.deepEqual(HOME_NODE_KINDS, ['rect', 'text', 'group', 'diagram']);
  assert.equal(HOME_LABELS.zh.canvasLabel, '企业架构画布');
  assert(HOME_NODE_DEFAULTS.rect.width >= 100);
});

test('EnterpriseHome: 空态画布读写与标准归一化', () => {
  const empty = readHomeCanvas(null);
  assert.equal(empty.schemaVersion, 1);
  assert.deepEqual(empty.nodes, []);
  assert.deepEqual(empty.edges, []);

  const normalized = normalizeHomeCanvas({
    schemaVersion: 1,
    nodes: [
      { id: 'n1', kind: 'rect', text: '零售域', x: 100, y: 120, width: 200, height: 100 },
      { id: 'n2', kind: 'invalid_kind', text: '无效节点' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n1', target: 'n999' },
    ],
  });
  assert.equal(normalized.nodes.length, 1);
  assert.equal(normalized.nodes[0].id, 'n1');
  assert.equal(normalized.edges.length, 0); // 孤立连线自动剔除
});

test('EnterpriseHome: 画布节点与 AntV X6 Cells 互转保真', () => {
  const canvas = {
    schemaVersion: 1,
    nodes: [
      { id: 'd1', kind: 'rect', text: '会员域', x: 50, y: 80, width: 220, height: 140 },
      { id: 'k1', kind: 'text', text: '核心指标', x: 300, y: 80, width: 180, height: 100 },
    ],
    edges: [
      { id: 'e1', source: 'd1', target: 'k1', label: '核心度量' },
    ],
  };

  const cells = cellsFromHomeCanvas(canvas);
  assert.equal(cells.length, 3);
  const back = homeCanvasFromCells(cells);
  assert.equal(back.nodes.length, 2);
  assert.equal(back.edges.length, 1);
  assert.equal(back.nodes[0].text, '会员域');
  assert.equal(back.edges[0].label, '核心度量');
});

test('EnterpriseHome: 画布视口边界包围盒计算', () => {
  const bounds = homeCanvasBounds({
    nodes: [
      { x: 10, y: 20, width: 100, height: 50 },
      { x: 200, y: 150, width: 50, height: 80 },
    ],
  });
  assert.equal(bounds.minX, 10);
  assert.equal(bounds.minY, 20);
  assert.equal(bounds.maxX, 250);
  assert.equal(bounds.maxY, 230);
});

test('EnterpriseHome: 架构图引用解析与展示名', () => {
  const project = {
    diagrams: [{ id: 'diag-1', defName: '订单主流程图', defKey: 'flow1' }],
  };
  const resolved = resolveDiagramRef(project, 'diag-1');
  assert.equal(resolved.status, 'ok');
  assert.equal(resolved.diagram.defName, '订单主流程图');
  assert.equal(diagramDisplayName(resolved.diagram), 'flow1 [订单主流程图]');
});

// 2. Concept Logical Links
test('ConceptLogicalLinks: 集合读写与有效性校验', () => {
  assert.equal(CONCEPT_LOGICAL_LINKS_KEY, 'conceptLogicalLinks');
  const project = {
    conceptEntities: [{ id: 'c_user', defKey: 'C_USER', defName: '用户概念' }],
    logicEntities: [{ id: 'l_user', defKey: 'L_USER', defName: '用户逻辑' }],
    profile: {
      modelCatalog: {
        conceptLogicalLinks: [
          { id: 'l1', conceptEntityId: 'c_user', logicalEntityId: 'l_user' },
        ],
      },
    },
  };

  const links = readConceptLogicalLinks(project);
  assert.equal(links.length, 1);
  assert.equal(isLinkEffective(project, links[0]), true);

  const stats = conceptLinkedLogicStats(project);
  assert.equal(stats.linkedLogicCount, 1);
  assert.equal(stats.totalLogicCount, 1);
  assert.equal(stats.invalidLinkCount, 0);
});

test('ConceptLogicalLinks: 实体增删与双向索引查询', () => {
  let project = {
    conceptEntities: [{ id: 'c_prod', defKey: 'C_PROD', defName: '商品概念' }],
    logicEntities: [
      { id: 'l_sku', defKey: 'L_SKU', defName: 'SKU' },
      { id: 'l_spu', defKey: 'L_SPU', defName: 'SPU' },
    ],
    profile: {
      modelCatalog: {
        conceptLogicalLinks: [],
      },
    },
  };

  project = addConceptLogicalLinks(project, [
    { id: 'lk1', conceptEntityId: 'c_prod', logicalEntityId: 'l_sku' },
    { id: 'lk2', conceptEntityId: 'c_prod', logicalEntityId: 'l_spu' },
  ]);

  const conceptLinks = linksForConcept(project, 'c_prod');
  assert.equal(conceptLinks.length, 2);
  const logicLinks = linksForLogic(project, 'l_sku');
  assert.equal(logicLinks.length, 1);
  assert.equal(logicLinks[0].link.conceptEntityId, 'c_prod');

  project = removeConceptLogicalLinks(project, ['lk2']);
  assert.equal(linksForConcept(project, 'c_prod').length, 1);
});

test('ConceptLogicalLinks: 级联删除影响分析 (linkDeletionImpact)', () => {
  const project = {
    conceptEntities: [
      { id: 'c_cust', defKey: 'C_CUST', defName: '客户' },
      { id: 'c_vendor', defKey: 'C_VENDOR', defName: '供应商' },
    ],
    logicEntities: [
      { id: 'l_cust_vip', defKey: 'L_VIP', defName: 'VIP' },
      { id: 'l_cust_common', defKey: 'L_COMMON', defName: '普通' },
      { id: 'l_vendor', defKey: 'L_VENDOR', defName: '供应商逻辑' },
    ],
    profile: {
      modelCatalog: {
        conceptLogicalLinks: [
          { id: 'l1', conceptEntityId: 'c_cust', logicalEntityId: 'l_cust_vip' },
          { id: 'l2', conceptEntityId: 'c_cust', logicalEntityId: 'l_cust_common' },
          { id: 'l3', conceptEntityId: 'c_vendor', logicalEntityId: 'l_vendor' },
        ],
      },
    },
  };

  const impactConcept = linkDeletionImpact(project, { conceptIds: ['c_cust'] });
  assert.equal(impactConcept.count, 2);
  assert.deepEqual(impactConcept.links.map(l => l.id).sort(), ['l1', 'l2']);

  const impactLogic = linkDeletionImpact(project, { logicalIds: ['l_vendor'] });
  assert.equal(impactLogic.count, 1);
  assert.equal(impactLogic.links[0].id, 'l3');
});

// 3. Forward Engineering
test('ForwardEngineering: 逻辑前缀裁剪与表名冲突检查', () => {
  assert.equal(stripLogicPrefix('LE_USER'), 'USER');
  assert.equal(stripLogicPrefix('le_order_item'), 'order_item');
  assert.equal(stripLogicPrefix('customer'), 'customer');

  const source = {
    entities: [{ defKey: 't_user' }],
  };
  const errors = checkDefKeyUniqueness(source, { ent1: 't_user', ent2: 't_product' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'duplicateDefKey');
  assert.equal(errors[0].defKey, 't_user');
});

console.log(`\nALL ${passed} Enterprise Modeling verification checks PASSED successfully!`);
