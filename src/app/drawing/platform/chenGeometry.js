// V5-R3 pure geometry helpers for the Chen editor. Kept DOM-free so the
// port hit-area contract, scroll-compensation math and work-area margins can
// be unit-tested in plain Node (see doc/developer/chen-er-studio-v5/verify-*.cjs).

// Result 5: Chen direct-connection ports. Each port renders a small dot
// (r 3.5) on top of an invisible hit circle (r 8 → 16px on screen, above the
// 12px minimum); only the hit circle is a magnet, so dragging a port always
// starts a connection while the shape body still moves the node. The dot MUST
// carry pointerEvents:none — X6 resolves a mousedown to a magnet by walking UP
// from the event target, and the dot is a sibling (not a child) of the hit
// circle, so a clickable dot over the port center swallows the magnet drag and
// degenerates into a node drag (R3 field repro: port-center → port-center
// never created the semantic edge). Both circles carry inline
// visibility:hidden (same contract as the legacy ports) so off-canvas
// renderers (PageExport, thumbnails) never show them; the hover handlers
// toggle the .x6-port-body group AND its children together.
export const CHEN_PORT_HIT_RADIUS = 8;
export const CHEN_PORT_DOT_RADIUS = 3.5;
// Fresh object per group: every cell owns its port attrs — mutating one
// cell's ports must never leak into other cells.
export const chenPortAttrs = () => ({
  hit: {r: CHEN_PORT_HIT_RADIUS, fill: 'transparent', stroke: 'transparent', cursor: 'crosshair', magnet: true, style: {visibility: 'hidden'}},
  dot: {r: CHEN_PORT_DOT_RADIUS, fill: '#ffffff', stroke: '#3868bd', strokeWidth: 1.4, style: {visibility: 'hidden', pointerEvents: 'none'}},
});
export const chenPorts = () => ({
  groups: ['top', 'right', 'bottom', 'left'].reduce((a, p) => ({...a, [p]: {position: p,
    markup: [{tagName: 'circle', selector: 'hit'}, {tagName: 'circle', selector: 'dot'}],
    attrs: chenPortAttrs()}}), {}),
  items: ['top', 'right', 'bottom', 'left'].map(p => ({id: p, group: p})),
});

// Result 4: viewport-origin compensation. After a scroller resize, a world
// anchor point that should stay at screen position (targetX, targetY) has
// actually landed at (afterX, afterY); scrolling the container by the delta
// restores it. Both axes clamp to the scrollable range — when clamping bites,
// the residual shift lies inside the whitespace margin, never on content.
export const clampScroll = (value, max) => Math.max(0, Math.min(Math.max(0, max), value));
export const compensateScroll = ({scrollLeft, scrollTop, afterX, afterY, targetX, targetY, maxLeft, maxTop}) => ({
  left: clampScroll(scrollLeft + Math.round(afterX - targetX), maxLeft),
  top: clampScroll(scrollTop + Math.round(afterY - targetY), maxTop),
});

// Result 3: the opt-in work-area box = content bounding box plus an operating
// margin (default 160 world units, per the design spec).
export const WORKAREA_MARGIN = 160;
export const workareaBox = (area, margin = WORKAREA_MARGIN) => ({
  x: area.x - margin,
  y: area.y - margin,
  width: area.width + margin * 2,
  height: area.height + margin * 2,
});
