// CS-M drawing persistence session semantics tests.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { DrawingPersistence } = require(path.resolve(__dirname, '../public/drawing-persistence'));

const checks = [];
const check = async (id, name, fn) => {
  await fn();
  checks.push({ id, name });
  console.log('PASS', id, name);
};

const drawing = (name, entity) => ({
  id: 'd1',
  type: 'drawing',
  schemaVersion: 2,
  diagramType: 'er-sketch',
  notation: 'chen',
  revision: null,
  defName: name,
  defKey: 'k1',
  pages: [{
    id: 'p1',
    name: '画布 1',
    kind: 'graph',
    erModel: { entities: [{ id: entity, name, kind: 'strong' }], relationships: [], attributes: [] },
    scene: {
      nodes: { [entity]: { x: 100, y: 100, width: 140, height: 58, layerId: 'main', style: {} } },
      edges: {},
      annotations: [],
      layers: [{ id: 'main', name: '主图层', visible: true, locked: false }],
      pageStyle: { background: '#ffffff' }
    },
    comments: []
  }],
  enabledPacks: ['chen', 'basic'],
  resources: [],
  components: []
});

const project = drawings => ({
  name: '合成项目',
  version: '0.4.0',
  entities: [],
  drawings,
  profile: {},
  viewGroups: [],
  diagrams: [],
  logicEntities: [],
  conceptEntities: []
});

const command = (drawings, previous) => ({
  commandId: `cmd-${Math.random().toString(36).slice(2)}`,
  delta: {
    upsert: drawings,
    remove: [],
    order: drawings.map(d => d.id),
    baseRevisions: Object.fromEntries([previous].flat().filter(Boolean).map(d => [d.id, d.revision == null ? null : d.revision]))
  }
});

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-m-persist-'));
  const store = new DrawingPersistence(dir, { notify: () => {}, delay: 3600000, maxDelay: 7200000 });
  const owner = 'owner-1';
  const clearTimers = () => {
    for (const s of store.sessions.values()) {
      clearTimeout(s.timer);
      clearTimeout(s.maxTimer);
    }
  };

  try {
    await check('CP01', 'command without any session is SESSION_REQUIRED', async () => {
      let code = '';
      try {
        await store.command('', command([drawing('订单', 'e1')], []), owner);
      } catch (e) {
        code = e.message;
      }
      assert.match(code, /SESSION_REQUIRED/);
    });

    await check('CP02', 'named saved project has no session until open', async () => {
      const file = path.join(dir, 'created.pdma.json');
      fs.writeFileSync(file, JSON.stringify(project([drawing('订单', 'e1')]), null, 2));
      let code = '';
      try {
        await store.command(file, command([drawing('订单改', 'e1')], [drawing('订单', 'e1')]), owner);
      } catch (e) {
        code = e.message;
      }
      assert.match(code, /SESSION_REQUIRED/);
    });

    await check('CP03', 'untitled ensure-open then command reaches durable checkpoint', async () => {
      const first = [drawing('订单', 'e1')];
      await store.open('', project(first), owner);
      const next = [{ ...first[0], defName: '订单改' }];
      await store.command('', command(next, first), owner);
      const flushed = await store.flush('', owner);
      assert.strictEqual(flushed.drawings[0].defName, '订单改');
    });

    await check('CP04', 'session loss recovery: reopen original baseline, same commandId retry applies exactly once', async () => {
      const original = [drawing('客户', 'e1')];
      const file = path.join(dir, 'a.pdma.json');
      fs.writeFileSync(file, JSON.stringify(project(original), null, 2));
      await store.open(file, project(original), owner);
      const edited = [{ ...original[0], defName: '客户改' }];
      const cmd = command(edited, original);
      await store.command(file, cmd, owner);
      clearTimers();
      store.sessions.delete(store.canonical(file));
      let failed = '';
      try {
        await store.command(file, { ...cmd, commandId: 'cmd-other' }, owner);
      } catch (e) {
        failed = e.message;
      }
      assert.match(failed, /SESSION_REQUIRED/);
      await store.open(file, project(original), owner);
      await store.command(file, cmd, owner);
      const flushed = await store.flush(file, owner);
      assert.strictEqual(flushed.drawings[0].defName, '客户改');
      assert.strictEqual(flushed.drawings.length, 1);
      const onDisk = JSON.parse(fs.readFileSync(file));
      assert.strictEqual(onDisk.drawings.length, 1);
      assert.strictEqual(onDisk.drawings[0].defName, '客户改');
    });

    await check('CP05', 'recovery() without session is SESSION_REQUIRED', async () => {
      let code = '';
      try {
        await store.recovery('', owner + '-x');
      } catch (e) {
        code = e.message;
      }
      assert.match(code, /SESSION_REQUIRED/);
    });

    await check('CP06', 'stale owner against a live session is rejected', async () => {
      const file = path.join(dir, 'b.pdma.json');
      fs.writeFileSync(file, JSON.stringify(project([drawing('订单', 'e1')]), null, 2));
      await store.open(file, project([drawing('订单', 'e1')]), 'owner-A');
      let code = '';
      try {
        await store.command(file, command([drawing('订单', 'e1')], []), 'owner-B');
      } catch (e) {
        code = e.message;
      }
      assert.match(code, /SESSION_REQUIRED|PROJECT_BUSY/);
    });
  } finally {
    clearTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`All ${checks.length} persistence session checks passed.`);
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
