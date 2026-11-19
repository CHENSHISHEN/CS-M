const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '..');
const cache = new Map();

function load(file) {
  const p = path.resolve(file);
  if (cache.has(p)) return cache.get(p).exports;
  const m = {exports: {}};
  cache.set(p, m);
  const code = babel.transformSync(fs.readFileSync(p, 'utf8'), {
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-env', {targets: {node: 'current'}}]],
    plugins: ['@babel/plugin-proposal-optional-chaining'],
  }).code;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', {filename: p})(
    s => (s.startsWith('.') ? load(path.resolve(path.dirname(p), s.endsWith('.js') ? s : s + '.js')) : require(s)),
    m,
    m.exports
  );
  return m.exports;
}

const p = load(path.join(root, 'src/lib/drawing_platform.js'));
let n = 0;
const check = (name, fn) => {
  fn();
  console.log('PASS', ++n, name);
};

check('9 distinct types; 27 actual editable templates', () => {
  assert.equal(p.DRAWING_TYPES.length, 9);
  assert.equal(p.PLATFORM_TEMPLATES.length, 27);
  p.PLATFORM_TEMPLATES.filter(t => t.module === 'drawing').forEach(t => {
    const a = p.instantiateTemplate({}, t);
    const d = a.source.drawings[0];
    assert.equal(d.diagramType, t.typeId);
    assert.deepEqual(p.validateDrawing(d), []);
    assert(d.treeData || d.sequenceData || (d.canvasData && d.canvasData.cells && d.canvasData.cells.length) || (d.pages && d.pages.length));
  });
});

check('template copies keep independent IDs and internal references', () => {
  for (const t of p.PLATFORM_TEMPLATES) {
    let a = p.instantiateTemplate({}, t);
    let b = p.instantiateTemplate(a.source, t);
    assert.notEqual(a.documentId, b.documentId);
    assert.equal(t.version, 1);
    if (t.module === 'business') {
      let model = b.source.business;
      assert.equal(new Set(model.processes.flatMap(x => x.elements.map(e => e.id))).size, model.processes.flatMap(x => x.elements).length);
      for (const proc of model.processes) {
        for (const flow of proc.flows) {
          assert(proc.elements.some(e => e.id === flow.source) && proc.elements.some(e => e.id === flow.target));
        }
      }
    }
  }
});

check('tree rejects cycle/root move, valid move retains descendants', () => {
  const d = p.newDrawing('mindmap', 't', true).treeData;
  const a = d.children[0];
  const b = d.children[1];
  assert.throws(() => p.treeMove(d, a.id, a.children[0].id));
  assert.throws(() => p.treeMove(d, d.id, a.id));
  const moved = p.treeMove(d, a.id, b.id);
  assert.equal(moved.children.length, 2);
  assert(p.treeFind(p.treeFind(moved, b.id), a.id));
  assert.equal(d.children.length, 3);
});

check('sequence catches deleted participant and invalid fragment', () => {
  const d = p.newDrawing('sequence', 't', true);
  d.sequenceData.participants.pop();
  assert(p.validateDrawing(d).includes('missing-message-target'));
});

check('stable refs survive rename and preserve missing-reference state', () => {
  const ref = p.makeAssetRef('entities', 't1');
  const s = {entities: [{id: 't1', defKey: 'orders'}]};
  assert.equal(p.resolveAsset(s, ref).defKey, 'orders');
  assert.equal(p.resolveAsset({...s, entities: [{id: 't1', defKey: 'sales_orders'}]}, ref).defKey, 'sales_orders');
  assert.equal(p.resolveAsset({entities: [{id: 'different', defKey: 'orders'}]}, ref), null);
});

check('occurrences count diagrams separately from instances', () => {
  const ref = p.makeAssetRef('entities', 't1');
  const s = {
    diagrams: [
      {id: 'd1', canvasData: {cells: [{id: 'a', originKey: 't1'}, {id: 'b', originKey: 't1'}]}},
      {id: 'd2', canvasData: {cells: [{id: 'c', originKey: 't1'}]}},
    ],
    drawings: [
      {id: 'd3', canvasData: {cells: [{id: 'x', data: {assetRef: ref}}]}},
    ],
  };
  const all = p.assetOccurrences(s, ref);
  assert.equal(all.length, 3);
  assert.equal(all.reduce((n, r) => n + r.ids.length, 0), 4);
});

check('broken edges rejected and unknown schemas rejected', () => {
  assert(p.validateDrawing({canvasData: {cells: [{id: 'edge', shape: 'edge', source: {cell: 'lost'}, target: {cell: 'none'}}]}}).includes('missing-edge-target'));
  assert.throws(() => p.instantiateTemplate({}, {version: 99}));
});

check('data templates preserve existing tables and unique codes', () => {
  let s = {entities: [{id: 'existing', defKey: 'orders'}], business: {custom: 'kept'}};
  const t = p.PLATFORM_TEMPLATES.find(t => t.id === 'data-2');
  s = p.instantiateTemplate(s, t).source;
  assert.equal(s.entities[0].id, 'existing');
  assert.equal(s.business.custom, 'kept');
  assert.equal(s.entities[1].defKey, 'orders_2');
  assert.equal(s.diagrams[0].relationType, 'entity');
});

check('revision conflicts refuse stale writes and undo remains monotonic', () => {
  const d = p.newDrawing('flowchart', 't');
  let source = {drawings: [d]};
  source = p.replaceDrawing(source, {...d, defName: 'edited'}, 0);
  assert.equal(source.drawings[0].revision, 1);
  assert.throws(() => p.replaceDrawing(source, {...d, defName: 'stale'}, 0), /revision-conflict/);
  source = p.replaceDrawing(source, d, 1);
  assert.equal(source.drawings[0].revision, 2);
  assert.equal(source.drawings[0].defName, 't');
});

check('copies clear external binding slots and executable defaults', () => {
  const ref = p.makeAssetRef('entities', 'external');
  const a = p.shapeCell('rect', 'node');
  a.data.assetRef = ref;
  a.data.lastName = 'External';
  a.knobs = {position: () => 1};
  const c = p.copyWithIds([a])[0];
  assert(!c.data.assetRef);
  assert.equal(c.data.referenceMode, 'unbound');
  assert(!c.knobs.position);
  assert.notEqual(c.id, a.id);
});

check('sequence fragments cannot silently span unrelated messages', () => {
  const d = p.newDrawing('sequence', 't', true);
  d.sequenceData.fragments = [{id: 'fragment', kind: 'alt', label: 'ok'}];
  d.sequenceData.messages[0].fragmentId = 'fragment';
  d.sequenceData.messages[2].fragmentId = 'fragment';
  assert(p.validateDrawing(d).includes('fragment-order'));
});

check('delete impact lists dependent business and drawing assets', () => {
  const ref = p.makeAssetRef('entities', 'table');
  const source = {
    drawings: [{defName: 'D', canvasData: {cells: [{data: {assetRef: ref}}]}}],
    business: {businessObjects: [{name: 'Order', modelRefs: [ref]}]},
  };
  assert.deepEqual(p.assetDependents(source, 'entities', 'table'), ['D', 'Order']);
});

check('architecture relations use vertical ports behind component labels', () => {
  for (const variant of [0, 1]) {
    const d = p.newDrawing('architecture', 'arch', true, variant);
    for (const e of d.canvasData.cells.filter(c => c.shape === 'edge')) {
      assert.equal(e.zIndex, 0);
      assert.equal(e.source.port, 'bottom');
      assert.equal(e.target.port, 'top');
    }
  }
});

console.log('All ' + n + ' model integration checks passed.');
