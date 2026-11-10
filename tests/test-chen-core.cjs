const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const root = path.resolve(__dirname, '..');
const model = require(path.join(root, 'public/drawing-document'));
const { DrawingPersistence, decode, encode } = require(path.join(root, 'public/drawing-persistence'));

const result = [];
const check = async (name, run) => {
  await run();
  result.push(name);
  console.log('PASS', name);
};

(async () => {
  for (let variant = 0; variant < 5; variant++) {
    await check('Chen template ' + variant, () => {
      const d = model.newChen('模板', true, variant);
      assert.deepStrictEqual(model.errors(d), []);
      assert(model.project(d.pages[0]).cells.length > 5);
      assert.strictEqual(model.errors({...d, pages: [model.clonePage(d.pages[0])]}).length, 0);
    });
  }
  await check('owner cycle rejected', () => {
    let p = model.newChen().pages[0];
    const a = model.addSemantic(p, 'entity', 'e');
    const b = model.addSemantic(a.page, 'composite', 'a', 200, 200, { type: 'entity', id: a.id });
    const c = model.addSemantic(b.page, 'composite', 'b', 200, 200, { type: 'attribute', id: b.id });
    p = c.page;
    p.erModel.attributes[0].owner = { type: 'attribute', id: c.id };
    const d = model.newChen();
    d.pages = [p];
    assert(model.errors(d).includes('owner-cycle'));
  });
  await check('legacy wrapper preserves payload', () => {
    const d = { id: 'v1', schemaVersion: 1, diagramType: 'er-sketch', canvasData: { cells: [{ id: 'x', shape: 'rect', data: { assetRef: { objectId: 'table' }, extra: 'kept' } }] } };
    const u = model.upgrade(d);
    assert.strictEqual(u.notation, 'legacy-free');
    assert.deepStrictEqual(u.pages[0].scene.cells, d.canvasData.cells);
    assert(d.canvasData);
  });
  await check('no direct Chen entity link', () => {
    const d = model.newChen('x', true);
    assert.throws(() => model.connect(d.pages[0], d.pages[0].erModel.entities[0].id, d.pages[0].erModel.entities[1].id));
  });
  await check('cascade preserves valid draft', () => {
    const d = model.newChen('x', true);
    d.pages = [model.removeSemantic(d.pages[0], [d.pages[0].erModel.entities[0].id])];
    assert.deepStrictEqual(model.errors(d), []);
  });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-m-chen-core-'));
  const file = path.join(work, 'sample.pdma.json');
  const base = { version: '0.4.0', name: '合成', entities: [{ id: 'baseline' }], drawings: [] };
  fs.writeFileSync(file, JSON.stringify(base));
  const storage = path.join(work, 'recovery');
  const store = new DrawingPersistence(storage, { delay: 60000, maxDelay: 60000 });

  await check('durable delta and duplicate idempotency', async () => {
    await store.open(file, base);
    const d = model.newChen('第一次', true);
    const command = { commandId: 'one', delta: { upsert: [d], order: [d.id] } };
    await store.command(file, command);
    await store.command(file, command);
    assert.strictEqual(store.session(file).seq, 1);
    assert.strictEqual(store.session(file).drawings.length, 1);
  });
  await check('reopen before project checkpoint replays ACK', async () => {
    const other = new DrawingPersistence(storage, { delay: 60000 });
    const opened = await other.open(file, base);
    assert.strictEqual(opened.drawings[0].defName, '第一次');
    assert.strictEqual(opened.seq, 1);
    assert(opened.recovered);
  });
  await check('drawing checkpoint does not save model draft', async () => {
    await store.flush(file);
    const saved = JSON.parse(fs.readFileSync(file));
    assert.deepStrictEqual(saved.entities, base.entities);
    assert.strictEqual(saved.profile.drawingPersistence.lastAppliedSeq, 1);
  });
  await check('manual save merges latest drawings', async () => {
    await store.flush(file, 'default', { ...base, name: 'manual', entities: [{ id: 'explicit' }], drawings: [] });
    const saved = JSON.parse(fs.readFileSync(file));
    assert.strictEqual(saved.drawings.length, 1);
    assert.strictEqual(saved.entities[0].id, 'explicit');
  });
  await check('external change preserved, recovery anchor independent', async () => {
    const doc = model.newChen('第二次');
    await store.command(file, { commandId: 'two', delta: { upsert: [doc], order: [...store.session(file).drawings.map(d => d.id), doc.id] } });
    const ext = JSON.stringify({ ...base, name: '外部' });
    fs.writeFileSync(file, ext);
    await assert.rejects(store.flush(file), /PROJECT_CONFLICT/);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), ext);
    const other = new DrawingPersistence(storage, { delay: 60000 });
    const restored = await other.open(file, JSON.parse(ext));
    assert.strictEqual(restored.status, 'conflict');
    assert.strictEqual(restored.drawings.length, 2);
    const recovery = await other.recovery(file);
    assert.strictEqual(recovery.name, 'manual');
    assert.strictEqual(recovery.drawings.length, 2);
  });
  await check('framing tail truncation and middle damage', () => {
    const a = encode({ id: 1 }), b = encode({ id: 2 });
    assert.strictEqual(decode(a + b.slice(0, -4)).records.length, 1);
    assert(!decode(a + b.slice(0, -4)).damaged);
    assert(decode(a.replace('id', 'xx') + b).damaged);
  });
  await check('invalid document rejected before ACK', async () => {
    await assert.rejects(store.command(file, { commandId: 'bad', delta: { upsert: [{ id: 'bad', schemaVersion: 99 }], order: ['bad'] } }), /unsupported-schema/);
    assert.strictEqual(store.session(file).seq, 2);
  });
  await check('single session owner and alias guard', async () => {
    await assert.rejects(store.open(file, base, 'other'), /PROJECT_BUSY/);
    const alias = path.join(work, 'alias.json');
    fs.symlinkSync(file, alias);
    assert.strictEqual(store.session(alias), store.session(file));
  });
  await check('disk sync failure has no durable ACK', async () => {
    const f = path.join(work, 'fail.json');
    fs.writeFileSync(f, JSON.stringify(base));
    const broken = new DrawingPersistence(path.join(work, 'bad'), {
      beforeSync: async rec => {
        if (rec.type === 'command') throw Error('injected fsync failure');
      }
    });
    await broken.open(f, base);
    const drawing = model.newChen();
    await assert.rejects(broken.command(f, { commandId: 'fail', delta: { upsert: [drawing], order: [drawing.id] } }), /injected fsync failure/);
    assert.strictEqual(broken.session(f).seq, 0);
  });

  for (const s of store.sessions.values()) {
    clearTimeout(s.timer);
    clearTimeout(s.maxTimer);
  }
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`All ${result.length} Chen core checks passed.`);
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => {
  setTimeout(() => process.exit(process.exitCode || 0), 100);
});
