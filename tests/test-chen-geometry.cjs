// V5-R3 behavior assertions for the Chen editor's pure geometry helpers
// (src/app/drawing/platform/chenGeometry.js). No DOM required — these verify
// the port hit-area contract, the no-jump scroll-compensation math and the
// work-area margins against worked numeric scenarios.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const babel = require('@babel/core');

const src = path.join(__dirname, '..', 'src', 'app', 'drawing', 'platform', 'chenGeometry.js');
const {code} = babel.transformSync(fs.readFileSync(src, 'utf8'), {
  presets: [['@babel/env', {targets: {node: 'current'}}]],
  filename: 'chenGeometry.js',
});
const tmp = path.join(os.tmpdir(), `chen-geometry-${Date.now()}.js`);
fs.writeFileSync(tmp, code);
const M = require(tmp);

const results = [];
const test = (name, fn) => {try {fn();results.push(`PASS ${name}`);} catch (e) {results.push(`FAIL ${name}: ${e.message}`);process.exitCode = 1;}};

// T1 · Result 5 port contract: four side ports, hit circle ≥12px and the only
// magnet, dot purely visual AND click-through, both hidden by default
// (off-canvas renderers). R3 field repro: the dot is a SIBLING of the hit
// circle and X6 resolves mousedowns by walking UP from the event target, so a
// clickable dot over the port center swallowed the magnet drag — the dot must
// carry pointer-events:none.
test('T1 port hit-area contract', () => {
  const ports = M.chenPorts();
  assert.deepStrictEqual(Object.keys(ports.groups).sort(), ['bottom', 'left', 'right', 'top'], 'four side groups');
  assert.deepStrictEqual(ports.items.map(i => i.id), ['top', 'right', 'bottom', 'left'], 'port ids');
  for (const [name, group] of Object.entries(ports.groups)) {
    assert.strictEqual(group.position, name, 'group position matches its name');
    const hit = group.markup.find(m => m.selector === 'hit');
    const dot = group.markup.find(m => m.selector === 'dot');
    assert.ok(hit && dot, 'each port renders hit + dot circles');
    assert.strictEqual(group.attrs.hit.magnet, true, 'hit circle is the magnet');
    assert.strictEqual(group.attrs.dot.magnet, undefined, 'dot circle never magnets');
    assert.strictEqual(group.attrs.hit.r, M.CHEN_PORT_HIT_RADIUS);
    assert.ok(group.attrs.hit.r * 2 >= 12, `hit diameter ${group.attrs.hit.r * 2}px must be >= 12px`);
    assert.strictEqual(group.attrs.dot.r, M.CHEN_PORT_DOT_RADIUS);
    assert.strictEqual(group.attrs.hit.style.visibility, 'hidden', 'hit hidden by default');
    assert.strictEqual(group.attrs.dot.style.visibility, 'hidden', 'dot hidden by default');
    assert.strictEqual(group.attrs.dot.style.pointerEvents, 'none', 'R3 fix: dot never intercepts the port-center mousedown');
    assert.strictEqual(group.attrs.hit.style.pointerEvents, undefined, 'hit circle stays clickable');
  }
  const a = M.chenPorts(), b = M.chenPorts();
  assert.notStrictEqual(a, b, 'fresh object per call');
  a.groups.top.attrs.dot.r = 999;
  assert.strictEqual(M.chenPorts().groups.top.attrs.dot.r, M.CHEN_PORT_DOT_RADIUS, 'no shared mutable state');
});

// T2 · Result 4 no-jump compensation. Worked scenario (sidebar restore):
// screen(w) = base + w·scale − scroll with base 850, scale 1. World −250 sat
// at screen 100 with scroll 500; the resize re-anchored the center and left
// the anchor rendering at screen 200 with scroll 400. Compensation must move
// the scroll so the anchor lands back at screen 100 without moving content.
test('T2 compensation restores the anchor screen position', () => {
  const next = M.compensateScroll({scrollLeft: 400, scrollTop: 0, afterX: 200, afterY: 0, targetX: 100, targetY: 0, maxLeft: 100000, maxTop: 100000});
  assert.strictEqual(next.left, 500, 'scroll returns to the pre-change value');
  const base = 850, world = -250, scale = 1;
  assert.strictEqual(base + world * scale - next.left, 100, 'world −250 still renders at screen 100');
  assert.strictEqual(next.top, 0, 'untouched axis stays put');
});

// T3 · clamping: compensation never leaves the scrollable range, and negative
// deltas clamp to 0 rather than jumping backwards.
test('T3 compensation clamps to the scroll range', () => {
  assert.strictEqual(M.compensateScroll({scrollLeft: 10, scrollTop: 0, afterX: 260, afterY: 0, targetX: 100, targetY: 0, maxLeft: 150, maxTop: 100}).left, 150, 'clamped to max');
  const back = M.compensateScroll({scrollLeft: 50, scrollTop: 60, afterX: 40, afterY: 40, targetX: 100, targetY: 30, maxLeft: 90, maxTop: 90});
  assert.strictEqual(back.left, 0, 'negative delta clamps to 0');
  assert.strictEqual(back.top, 70, 'independent axes');
  assert.strictEqual(M.clampScroll(-5, 100), 0);
  assert.strictEqual(M.clampScroll(105, 100), 100);
  assert.strictEqual(M.clampScroll(42, 100), 42);
});

// T4 · Result 3 work area = content bbox + 160 world units on every side,
// including negative-coordinate content.
test('T4 work-area box margin', () => {
  assert.strictEqual(M.WORKAREA_MARGIN, 160, 'design margin');
  assert.deepStrictEqual(M.workareaBox({x: 0, y: 0, width: 10, height: 10}), {x: -160, y: -160, width: 330, height: 330});
  const neg = M.workareaBox({x: -300, y: -200, width: 100, height: 50});
  assert.deepStrictEqual(neg, {x: -460, y: -360, width: 420, height: 370}, 'negative coords extend the box, never crop it');
  assert.deepStrictEqual(M.workareaBox({x: 0, y: 0, width: 10, height: 10}, 0), {x: 0, y: 0, width: 10, height: 10}, 'margin is a parameter');
});

// ---- R3 rectification 2: viewport-origin compensation SEQUENCE ----
// Worked numeric model of the GraphEditor compensate() order, mirroring the
// X6 scroller mapping screen(w) = hostLeft + h + w·scale − scroll (h bundles
// the scroller padding + matrix translation; the graph host moves with the
// wrap, scroll/matrix are untouched by a pure host move). The ResizeObserver
// fires AFTER the DOM moved but BEFORE scrollerWidget.resize(), so the anchor
// is taken from the CURRENT (new) wrap rect — that world point equals the
// pre-change scroller-origin world point — and is pinned back to the OLD wrap
// rect position (lastHost).
const makeView = ({hostLeft, h, scale, scroll}) => ({
  hostLeft, h, scale, scroll,
  clientToLocal: function (cx) {return (cx - this.hostLeft - this.h + this.scroll) / this.scale;},
  localToClient: function (w) {return this.hostLeft + this.h + w * this.scale - this.scroll;},
});
// One compensate() step exactly as implemented in GraphEditor.
const compensateStep = (view, nowLeft, lastLeft) => {
  const anchor = view.clientToLocal(nowLeft);
  // scrollerWidget.resize(): the scroller's own re-center keeps the
  // container-RELATIVE center world point put, i.e. the mapping above is
  // unchanged — only the wrap width changed, which affects the scrollable
  // range, never the mapping.
  const after = view.localToClient(anchor);
  const next = M.compensateScroll({scrollLeft: view.scroll, scrollTop: 0, afterX: after, afterY: 0, targetX: lastLeft, targetY: 0, maxLeft: 1e6, maxTop: 1e6});
  view.scroll = next.left;
  return view.localToClient(anchor);
};

// T5 · the exact field repro: hand-pan release restores a 240px left sidebar;
// the same node must stay at its pre-collapse screen position (≤2px).
test('T5 pan-collapse + restore keeps the anchor on screen (240px repro)', () => {
  for (const scale of [1, 0.75, 1.6]) {
    const world = -250;
    const view = makeView({hostLeft: 240, h: 80, scale, scroll: 500});
    const before = view.localToClient(world);
    // collapse: wrap left 240 → 0 (content shifts left with the container);
    // anchor pins back to the PRE-change origin screen position (lastHost 240).
    view.hostLeft = 0;
    let residual = compensateStep(view, 0, 240) - 240;
    assert.ok(Math.abs(residual) <= 2, `collapse residual ${residual}px at scale ${scale}`);
    // user pans 130px left during the collapse (scroll grows by 130/scale in world units)
    view.scroll += 130;
    const panned = view.localToClient(world);
    // release: wrap left 0 → 240 again; the anchor now pins to the COLLAPSED
    // origin (lastHost 0) — the released view must equal the collapsed view.
    view.hostLeft = 240;
    residual = compensateStep(view, 240, 0) - 0;
    assert.ok(Math.abs(residual) <= 2, `restore residual ${residual}px at scale ${scale}`);
    assert.ok(Math.abs(view.localToClient(world) - panned) <= 2, `panned position kept at scale ${scale}`);
    assert.ok(Math.abs(view.localToClient(world) - before) <= 132, `real pan amount retained (not reset) at scale ${scale}`);
  }
});

// T6 · regression documentation: the OLD anchor order (clientToLocal on the
// OLD rect AFTER the DOM moved) misreads the origin by the sidebar delta and
// leaves the repro's 240px on-screen jump — proving why the order matters.
test('T6 old anchor order reproduces the 240px jump (negative control)', () => {
  const baseline = makeView({hostLeft: 240, h: 80, scale: 1, scroll: 500});
  const world = -250;
  const before = baseline.localToClient(world);
  const view = makeView({hostLeft: 240, h: 80, scale: 1, scroll: 500});
  view.hostLeft = 0; // DOM moved; OLD code anchored on lastHost.left = 240
  const anchor = view.clientToLocal(240);
  const after = view.localToClient(anchor);
  const next = M.compensateScroll({scrollLeft: view.scroll, scrollTop: 0, afterX: after, afterY: 0, targetX: 240, targetY: 0, maxLeft: 1e6, maxTop: 1e6});
  view.scroll = next.left;
  const shift = view.localToClient(world) - before;
  assert.ok(Math.abs(Math.abs(shift) - 240) <= 2, `old order shifts content ~240px (got ${shift}px)`);
});

// T7 · continuous sidebar drag: every incremental step pins the world point
// to its pre-step screen position, so a full drag accumulates no drift.
test('T7 incremental width drag accumulates no drift', () => {
  const view = makeView({hostLeft: 240, h: 80, scale: 1, scroll: 500});
  const world = 100;
  const start = view.localToClient(world);
  let last = 240;
  for (let left = 236; left >= 120; left -= 4) {
    view.hostLeft = left;
    compensateStep(view, left, last);
    last = left;
  }
  assert.ok(Math.abs(view.localToClient(world) - start) <= 2, `drift after 30 steps: ${view.localToClient(world) - start}px`);
});

// ---- R3 follow-up (dispatch ctx_07619720a8a1): muted-session retention ----
// The Chen inline editor mutes per-keystroke publishes; a style edit made
// mid-session must still persist when the text ends up unchanged. The guard
// in GraphEditor's contentChanged separates draft writes from everything else
// using the X6 1.18 Store contract (verified against
// node_modules/@antv/x6/es/model/store.js): a nested setByPath fires change:*
// with the TOP-LEVEL key ('attrs') while options.propertyPath carries the
// full slash path. This pins that contract and the classification table.
const storeEvent = attrPath => ({key: 'attrs', options: {propertyPath: `attrs/${attrPath}`}});
// Exactly the predicate used in GraphEditor.contentChanged's muted branch.
const isDraftWrite = (args, inlineId, cellId) =>
  Boolean(inlineId && cellId === inlineId && args?.options?.propertyPath === 'attrs/label/text');
test('T8 muted-session guard classifies draft vs style writes', () => {
  assert.strictEqual(storeEvent('label/text').key, 'attrs', 'nested attr writes surface as a bare attrs change');
  // draft keystroke on the edited label → stays local, session NOT marked
  assert.strictEqual(isDraftWrite(storeEvent('label/text'), 'e1', 'e1'), true);
  // style write on the same cell → session marked (must publish at session end)
  assert.strictEqual(isDraftWrite(storeEvent('label/fontSize'), 'e1', 'e1'), false);
  assert.strictEqual(isDraftWrite(storeEvent('body/stroke'), 'e1', 'e1'), false);
  // any write on another cell, or a non-attr change (no options) → marked
  assert.strictEqual(isDraftWrite(storeEvent('label/text'), 'e1', 'e2'), false);
  assert.strictEqual(isDraftWrite({cell: {}}, 'e1', 'e1'), false);
  // finishInline decision table: publish once iff text changed OR session marked
  const publishAtEnd = (value, initial, sessionDirty) => value !== initial || sessionDirty;
  assert.strictEqual(publishAtEnd('b', 'a', false), true, 'text changed');
  assert.strictEqual(publishAtEnd('a', 'a', true), true, 'style-only session still publishes');
  assert.strictEqual(publishAtEnd('a', 'a', false), false, 'nothing touched → zero publishes (Esc 零历史)');
});

// CHEN-STUDIO-011 · pan keeps the selection. X6 1.18 contract (verified
// against node_modules/@antv/x6/lib/graph/selection.js + scroller.js):
// SelectionManager.onBlankMouseDown and ScrollerManager.preparePanning both
// run on the SAME graph 'blank:mousedown' trigger — when panning is allowed
// the selection branch hits `this.clean()`, so by the time pan:start fires
// the IDs are already gone. The fix snapshots the IDs on a NATIVE
// capture-phase workspace mousedown (before every X6 handler), restores on
// pan stop/abort when the pan was real (same ≥3px gate as the collapse), and
// the trailing blank:click consumes a one-shot guard instead of cleaning.
const x6SelectionSrc = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@antv', 'x6', 'lib', 'graph', 'selection.js'), 'utf8');
const x6ScrollerSrc = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@antv', 'x6', 'lib', 'graph', 'scroller.js'), 'utf8');
const editorSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'drawing', 'platform', 'GraphEditor.js'), 'utf8');
// Exactly the predicates used in GraphEditor's onPanMousedown / onPanStop /
// blank:click guard.
const snapshotOnMousedown = ({button, onCell, tool, space}) =>
  button === 0 && !onCell && (tool === 'hand' || space);
const restoreOnPanStop = ({snapshot, moved}) => Boolean(snapshot) && moved;
test('T9 hand/Space pan preserves the pre-pan selection', () => {
  // X6 contract pin: blank:mousedown cleans the selection when panning wins,
  // and panning prepares on that same trigger — a pan:start snapshot is too late.
  assert.ok(x6SelectionSrc.includes("this.graph.on('blank:mousedown', this.onBlankMouseDown"), 'SelectionManager listens on blank:mousedown');
  assert.ok(x6SelectionSrc.includes('this.startRubberband(e);'), 'rubberband branch');
  assert.ok(x6SelectionSrc.match(/else \{\s*\n\s*this\.clean\(\);/), 'non-rubberband blank mousedown cleans the selection');
  assert.ok(x6ScrollerSrc.includes("this.graph.on('blank:mousedown', this.preparePanning"), 'panning prepares on the same blank:mousedown trigger');
  // GraphEditor wiring pin: native capture BEFORE X6, restore at stop, guard at click, cleanup.
  assert.ok(editorSrc.includes("addEventListener('mousedown', onPanMousedown, true)"), 'capture-phase workspace mousedown snapshot');
  assert.ok(editorSrc.includes('panWrapEl.removeEventListener'), 'capture listener removed on teardown');
  assert.ok(editorSrc.includes('restorePanSelection();'), 'pan stop/abort restores');
  assert.ok(editorSrc.includes('panSelectionRestore = false;\n      if (inlineRef.current)'), 'blank:click consumes the guard before cleaning');
  // Decision table.
  // H drag on blank with a selection → snapshot → restore → trailing click keeps it.
  const hand = {button: 0, onCell: false, tool: 'hand', space: false};
  assert.strictEqual(snapshotOnMousedown(hand), true, 'hand tool blank press snapshots');
  assert.strictEqual(restoreOnPanStop({snapshot: ['e1'], moved: true}), true, 'real drag restores');
  assert.strictEqual(!restoreOnPanStop({snapshot: ['e1'], moved: true}), false, 'trailing blank:click guard active');
  // Space+drag in any tool.
  assert.strictEqual(snapshotOnMousedown({button: 0, onCell: false, tool: 'select', space: true}), true);
  // Bare hand/Space click (no 3px displacement) → NO restore, click still clears.
  assert.strictEqual(restoreOnPanStop({snapshot: ['e1'], moved: false}), false, 'bare press never restores');
  // Cell/port/edge press → never enters the logic (native selection behavior).
  assert.strictEqual(snapshotOnMousedown({button: 0, onCell: true, tool: 'hand', space: true}), false, 'cell/port press excluded');
  // Select-mode blank click without Space → no snapshot → still clears.
  assert.strictEqual(snapshotOnMousedown({button: 0, onCell: false, tool: 'select', space: false}), false);
  // Abort mid-real-pan (Esc/blur/pointercancel) restores too; snapshot is
  // consumed so a LATER unrelated blank click can never resurrect old IDs.
  const afterAbort = {snapshot: null, moved: false};
  assert.strictEqual(restoreOnPanStop(afterAbort), false, 'no lingering restore after abort cleanup');
});

// CHEN-STUDIO-011 · rubberband×panning mutex. 2026-10-25 GUI evidence: the
// native capture snapshot and the pan:stop restore both worked, yet the
// selection ended empty — final clear stack: X6 selection addon onMouseUp →
// stopSelecting → case 'selecting' → reset(cells). Root cause (verified
// against node_modules/@antv/x6/lib/graph/selection.js,
// lib/types/modifier.js, lib/addon/selection/index.js): with `rubberband:
// true` and no modifiers configured, allowRubberband(e, true) passes for
// every plain (no modifier keys) blank press — the panning-guarded second
// branch never gets a say — so the rubberband starts IN PARALLEL with the
// scroller pan and its delegated document mouseup resets the selection after
// the body pan:stop restore. The public disableRubberband() flips
// widgetOptions.rubberband, both branches fail, the blank press only cleans,
// and no document-mouseup reset is ever delegated. GraphEditor arms the mutex
// exactly while a pan gesture owns the canvas (hand tool or held Space, Chen
// only) and restores the initial `rubberband: !readOnly` config on exit.
const x6AddonSelectionSrc = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@antv', 'x6', 'lib', 'addon', 'selection', 'index.js'), 'utf8');
const x6ModifierSrc = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@antv', 'x6', 'lib', 'types', 'modifier.js'), 'utf8');
// ModifierKey.isMatch with modifiers == null (our config), exactly as shipped.
const isMatchPlain = (e, strict) => strict
  ? !(e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)
  : true;
// SelectionManager.onBlankMouseDown reduced to the terms that matter here:
// strict branch || (non-strict branch && panning NOT allowed).
const blankPressOutcome = ({rubberband, panning}, e = {}) =>
  (rubberband && isMatchPlain(e, true)) || (rubberband && isMatchPlain(e, false) && !panning)
    ? 'rubberband' : 'clean';
test('T10 rubberband×panning mutex removes the trailing selection reset', () => {
  // X6 contract pins — the parallel-start bug and the public-API off switch.
  assert.ok(x6SelectionSrc.includes('allowRubberband(e, true) ||'), 'strict branch runs first');
  assert.ok(x6SelectionSrc.includes('!this.graph.scroller.allowPanning(e, true)'), 'panning only guards the NON-strict branch');
  assert.ok(x6ModifierSrc.includes('return strict'), 'null modifiers + strict ⇒ requires no modifier keys');
  assert.ok(x6SelectionSrc.includes('this.widgetOptions.rubberband = false;'), 'disableRubberband flips the option');
  assert.ok(x6SelectionSrc.includes('this.widgetOptions.rubberband !== true'), 'rubberbandDisabled getter gates allowRubberband');
  assert.ok(x6AddonSelectionSrc.includes('this.reset(cells);'), 'stopSelecting selecting-case resets the selection');
  assert.ok(x6AddonSelectionSrc.includes("mouseup: 'onMouseUp'"), 'the reset is a DELEGATED document mouseup — later than body pan:stop');
  // Decision table: who owns a plain blank press.
  assert.strictEqual(blankPressOutcome({rubberband: true, panning: true}, {}), 'rubberband', 'unfixed: rubberband starts in parallel with the pan (the GUI bug)');
  assert.strictEqual(blankPressOutcome({rubberband: false, panning: true}, {}), 'clean', 'mutex: the pan owns the press — clean only, no rubberband, no trailing reset');
  assert.strictEqual(blankPressOutcome({rubberband: true, panning: false}, {}), 'rubberband', 'select mode: normal box select unchanged');
  assert.strictEqual(blankPressOutcome({rubberband: true, panning: false}, {shiftKey: true}), 'rubberband', 'shift-press keeps the historical rubberband path');
  // GraphEditor wiring pins: mutex armed with the pan, released with the
  // initial readOnly contract, Chen only.
  assert.ok(editorSrc.includes('if (tool === \'hand\') {g.enablePanning();g.disableRubberband();}'), 'hand tool disables rubberband');
  assert.ok(editorSrc.includes('if (!latest.current.readOnly) g.enableRubberband();'), 'leaving hand restores rubberband unless readOnly');
  assert.ok(editorSrc.includes('if (chenPage) g.disableRubberband();'), 'Space press arms the mutex (Chen only)');
  assert.ok(editorSrc.includes('if (chenPage && !latest.current.readOnly) g.enableRubberband();'), 'Space release restores it');
});

console.log(results.join('\n'));
console.log(`${results.filter(r => r.startsWith('PASS')).length}/${results.length} passed`);
fs.unlinkSync(tmp);
