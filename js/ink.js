// Ink engine: Apple Pencil drawing over a fixed-width (1000 logical px) page.
//
// Strokes are stored in logical page coordinates, so they stay aligned with the text at
// any zoom. Rendering uses canvas tiles that live inside the scrolling page (so ink moves
// with the text during momentum scrolling) and only the tiles near the viewport exist,
// which keeps iPad canvas memory low.

export const PAGE_W = 1000;
const TILE_H = 512;
const MAX_DPR = 2;

let nextId = 1;
const uid = () => Date.now().toString(36) + '-' + (nextId++).toString(36);

export class Ink {
  constructor({ scroller, pageBox, hlLayer, inkLayer, onAction, onChange, onTextTap, onNearBottom }) {
    this.scroller = scroller;
    this.pageBox = pageBox;
    this.hlLayer = hlLayer;
    this.inkLayer = inkLayer;
    this.onAction = onAction;
    this.onChange = onChange;
    this.onTextTap = onTextTap;
    this.onNearBottom = onNearBottom;

    this.strokes = [];
    this.scale = 1;
    this.pageH = 2000;
    this.tool = 'pen';
    this.color = '#1f1d1a';
    this.size = 3;
    this.fingerDraw = false;
    this.smoothing = 2;     // 0 off, 1 low, 2 medium, 3 high
    this.snapShapes = true; // hold the Pencil still to turn a stroke into a line or oval

    this.tiles = new Map(); // index -> { hl, ink }
    this.pool = [];
    this.active = null;     // stroke being drawn
    this.erasing = null;    // { pointerId, removed: [] }
    this.tap = null;        // text tool tap tracking
    this.penDown = false;
    this.rafPending = false;

    this._bind();
  }

  // ---------- public API ----------

  setStrokes(strokes) {
    this.strokes = strokes.map(s => ({ ...s, bbox: s.bbox || bboxOf(s) }));
    this.rebuildTiles();
  }

  layout(scale, pageH) {
    const changedScale = Math.abs(scale - this.scale) > 1e-4;
    this.scale = scale;
    this.pageH = pageH;
    if (changedScale) this.rebuildTiles();
    else this.updateTiles();
  }

  maxInkY() {
    let m = 0;
    for (const s of this.strokes) m = Math.max(m, s.bbox[3]);
    return m;
  }

  addStroke(s, record = true) {
    s.bbox = s.bbox || bboxOf(s);
    this.strokes.push(s);
    this.redrawRegion(s.bbox);
    if (record) {
      this.onAction({
        undo: () => this.removeStrokes([s], false),
        redo: () => this.addStroke(s, false),
      });
    }
    this.onChange();
  }

  removeStrokes(list, record = true) {
    const ids = new Set(list.map(s => s.id));
    this.strokes = this.strokes.filter(s => !ids.has(s.id));
    this.redrawAll();
    if (record) {
      this.onAction({
        undo: () => { list.forEach(s => this.strokes.push(s)); this.redrawAll(); this.onChange(); },
        redo: () => this.removeStrokes(list, false),
      });
    }
    this.onChange();
  }

  clearAll() {
    if (this.strokes.length) this.removeStrokes(this.strokes.slice());
  }

  // ---------- tiles ----------

  dpr() { return Math.min(window.devicePixelRatio || 1, MAX_DPR); }

  rebuildTiles() {
    for (const [i, t] of this.tiles) this._release(t);
    this.tiles.clear();
    this.updateTiles();
  }

  updateTiles() {
    const s = this.scale;
    const top = this.scroller.scrollTop / s;
    const bottom = (this.scroller.scrollTop + this.scroller.clientHeight) / s;
    const maxIdx = Math.max(0, Math.ceil(this.pageH / TILE_H) - 1);
    const first = Math.max(0, Math.floor(top / TILE_H) - 1);
    const last = Math.min(maxIdx, Math.floor(bottom / TILE_H) + 1);

    for (const [i, t] of this.tiles) {
      if (i < first || i > last) { this._release(t); this.tiles.delete(i); }
    }
    for (let i = first; i <= last; i++) {
      if (!this.tiles.has(i)) {
        const t = this._acquire(i);
        this.tiles.set(i, t);
        this._renderTile(i, t);
      }
    }
  }

  _acquire(i) {
    const t = this.pool.pop() || { hl: makeCanvas('tile hl'), ink: makeCanvas('tile ink') };
    const k = this.scale * this.dpr();
    const wPx = Math.round(PAGE_W * k);
    const hPx = Math.round(TILE_H * k);
    for (const c of [t.hl, t.ink]) {
      if (c.width !== wPx) c.width = wPx;
      if (c.height !== hPx) c.height = hPx;
      c.style.width = PAGE_W * this.scale + 'px';
      c.style.height = TILE_H * this.scale + 'px';
      c.style.top = i * TILE_H * this.scale + 'px';
    }
    if (!t.hl.parentNode) this.hlLayer.appendChild(t.hl);
    if (!t.ink.parentNode) this.inkLayer.appendChild(t.ink);
    t.index = i;
    return t;
  }

  _release(t) {
    t.hl.remove(); t.ink.remove();
    if (this.pool.length < 8) this.pool.push(t);
  }

  _ctx(canvas, i) {
    const ctx = canvas.getContext('2d');
    const k = this.scale * this.dpr();
    ctx.setTransform(k, 0, 0, k, 0, -i * TILE_H * k);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  }

  _renderTile(i, t) {
    const y0 = i * TILE_H, y1 = y0 + TILE_H;
    const hl = this._ctx(t.hl, i), ink = this._ctx(t.ink, i);
    hl.clearRect(0, y0, PAGE_W, TILE_H);
    ink.clearRect(0, y0, PAGE_W, TILE_H);
    for (const s of this.strokes) {
      if (s.bbox[3] < y0 || s.bbox[1] > y1) continue;
      drawStroke(s.tool === 'highlighter' ? hl : ink, s);
    }
  }

  redrawAll() {
    for (const [i, t] of this.tiles) this._renderTile(i, t);
  }

  redrawRegion(b) {
    for (const [i, t] of this.tiles) {
      const y0 = i * TILE_H;
      if (b[3] >= y0 && b[1] <= y0 + TILE_H) this._renderTile(i, t);
    }
  }

  // ---------- input ----------

  _bind() {
    const sc = this.scroller;

    // Stop the Pencil from scrolling the page while the finger still scrolls normally.
    const blockStylus = e => {
      if (this.tool === 'hand' || this.tool === 'text') return;
      for (const t of e.touches) {
        if (t.touchType === 'stylus') { e.preventDefault(); return; }
      }
      if (this.fingerDraw && this.tool !== 'hand') e.preventDefault();
    };
    sc.addEventListener('touchstart', blockStylus, { passive: false });
    sc.addEventListener('touchmove', blockStylus, { passive: false });

    sc.addEventListener('pointerdown', e => this._down(e));
    sc.addEventListener('pointermove', e => this._move(e));
    sc.addEventListener('pointerup', e => this._up(e));
    sc.addEventListener('pointercancel', e => this._up(e, true));
    sc.addEventListener('scroll', () => this._scheduleTiles(), { passive: true });
    sc.addEventListener('contextmenu', e => e.preventDefault());
  }

  _scheduleTiles() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => { this.rafPending = false; this.updateTiles(); });
  }

  _accepts(e) {
    if (e.pointerType === 'pen' || e.pointerType === 'mouse') return true;
    // Finger: only when finger drawing is on, and never while the Pencil is down (palm).
    return this.fingerDraw && !this.penDown;
  }

  _point(e) {
    const r = this.pageBox.getBoundingClientRect();
    const x = (e.clientX - r.left) / this.scale;
    const y = (e.clientY - r.top) / this.scale;
    const p = e.pointerType === 'pen' ? (e.pressure || 0.3) : 0.5;
    return [x, y, p];
  }

  _down(e) {
    if (this.tool === 'hand') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!this._accepts(e)) return;
    if (e.target.closest && e.target.closest('.note-wrap')) return;

    if (this.tool === 'text') {
      this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, pt: this._point(e) };
      return;
    }

    e.preventDefault();
    if (e.pointerType === 'pen') this.penDown = true;
    try { this.scroller.setPointerCapture(e.pointerId); } catch {}

    if (this.tool === 'eraser') {
      this.erasing = { id: e.pointerId, removed: [] };
      this._eraseAt(this._point(e));
      return;
    }

    const [x, y, p] = this._point(e);
    const isHl = this.tool === 'highlighter';
    this.active = {
      id: uid(),
      pointerId: e.pointerId,
      tool: this.tool,
      color: this.color,
      size: isHl ? this.size * 6 : this.size,
      pressure: e.pointerType === 'pen' && !isHl,
      pts: [r1(x), r1(y), r2(p)],
      lastP: p,
      sx: x, sy: y,           // stabilised pen position
      raw: [x, y, p],         // last unsmoothed sample, so the stroke ends where the Pencil lifted
    };
    this._drawLive(true);
  }

  _move(e) {
    if (this.erasing && e.pointerId === this.erasing.id) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      (evs.length ? evs : [e]).forEach(ev => this._eraseAt(this._point(ev)));
      return;
    }
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const follow = FOLLOW[this.smoothing] ?? 1;
    for (const ev of (evs.length ? evs : [e])) {
      let [x, y, p] = this._point(ev);
      a.raw = [x, y, p];
      if (a.snapped) {
        // After a line snaps, keep holding and drag to move its far end.
        if (a.snapped.type === 'line') this._dragLineEnd(x, y);
        continue;
      }
      this._armHold(x, y);
      // Stabiliser: the line trails the Pencil slightly, which irons out hand wobble.
      a.sx += (x - a.sx) * follow;
      a.sy += (y - a.sy) * follow;
      x = a.sx; y = a.sy;
      const n = a.pts.length;
      const dx = x - a.pts[n - 3], dy = y - a.pts[n - 2];
      if (dx * dx + dy * dy < 0.6) continue; // skip jitter
      p = a.lastP * 0.6 + p * 0.4;            // smooth pressure
      a.lastP = p;
      a.pts.push(r1(x), r1(y), r2(p));
      this._drawLive(false);
    }
  }

  _up(e, cancelled) {
    if (e.pointerType === 'pen') this.penDown = false;

    if (this.tap && e.pointerId === this.tap.id) {
      const moved = Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y);
      const pt = this.tap.pt;
      this.tap = null;
      if (!cancelled && moved < 12) this.onTextTap(pt[0], pt[1]);
      return;
    }

    if (this.erasing && e.pointerId === this.erasing.id) {
      const removed = this.erasing.removed;
      this.erasing = null;
      if (removed.length) {
        this.onAction({
          undo: () => { removed.forEach(s => this.strokes.push(s)); this.redrawAll(); this.onChange(); },
          redo: () => this.removeStrokes(removed, false),
        });
        this.onChange();
      }
      return;
    }

    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    this.active = null;
    clearTimeout(a.holdTimer);
    let pts = a.pts;
    const liveBox = union(bboxOf({ pts, size: a.size }), a.paintedBox || bboxOf({ pts, size: a.size })); // where the live preview was painted
    if (this.smoothing && !a.snapped) {
      const n = pts.length;
      const [rx, ry, rp] = a.raw;
      if ((rx - pts[n - 3]) ** 2 + (ry - pts[n - 2]) ** 2 > 0.6) pts.push(r1(rx), r1(ry), r2(rp));
      pts = smoothPoints(pts, PASSES[this.smoothing]);
    }
    const stroke = { id: a.id, tool: a.tool, color: a.color, size: a.size, pressure: a.pressure, pts };
    stroke.bbox = bboxOf(stroke);
    this.strokes.push(stroke);
    const b = stroke.bbox;
    // Replace the live preview with the clean (smoothed) render.
    this.redrawRegion([Math.min(b[0], liveBox[0]), Math.min(b[1], liveBox[1]), Math.max(b[2], liveBox[2]), Math.max(b[3], liveBox[3])]);
    this.onAction({
      undo: () => this.removeStrokes([stroke], false),
      redo: () => this.addStroke(stroke, false),
    });
    this.onChange();
    if (stroke.bbox[3] > this.pageH - 350) this.onNearBottom();
  }

  // ---------- hold to snap ----------

  // Restart the hold timer whenever the Pencil moves more than a few px.
  _armHold(x, y) {
    const a = this.active;
    if (!this.snapShapes) return;
    if (a.hold && Math.hypot(x - a.hold.x, y - a.hold.y) < HOLD_SLOP) return;
    a.hold = { x, y };
    clearTimeout(a.holdTimer);
    a.holdTimer = setTimeout(() => this._snap(), HOLD_MS);
  }

  _snap() {
    const a = this.active;
    if (!a || a.snapped) return;
    const shape = recognise(a.pts, a.raw);
    if (!shape) return;
    const before = bboxOf({ pts: a.pts, size: a.size });
    a.snapped = shape;
    a.pts = shapePoints(shape, avgPressure(a.pts));
    this._repaintActive(before);
  }

  _dragLineEnd(x, y) {
    const a = this.active, L = a.snapped;
    const before = bboxOf({ pts: a.pts, size: a.size });
    [L.x1, L.y1] = straighten(L.x0, L.y0, x, y);
    a.pts = shapePoints(L, a.pts[2]);
    this._repaintActive(before);
  }

  // Wipe the old preview and paint the active stroke whole.
  _repaintActive(prevBox) {
    const a = this.active;
    const nb = bboxOf({ pts: a.pts, size: a.size });
    a.paintedBox = union(a.paintedBox || prevBox, union(prevBox, nb));
    this.redrawRegion(union(prevBox, nb));
    const layer = a.tool === 'highlighter' ? 'hl' : 'ink';
    for (const [i, t] of this.tiles) {
      const y0 = i * TILE_H;
      if (nb[3] < y0 || nb[1] > y0 + TILE_H) continue;
      drawStroke(this._ctx(t[layer], i), a);
    }
  }

  // Draw only the newest segment of the live stroke on the tiles it touches.
  _drawLive(first) {
    const a = this.active;
    const pts = a.pts;
    const n = pts.length / 3;
    const layer = a.tool === 'highlighter' ? 'hl' : 'ink';
    const pad = a.size * 2;
    let segB;
    if (first) segB = [pts[0] - pad, pts[1] - pad, pts[0] + pad, pts[1] + pad];
    else {
      const i = n - 1;
      const xs = [pts[(i - 2 < 0 ? 0 : i - 2) * 3], pts[(i - 1) * 3], pts[i * 3]];
      const ys = [pts[(i - 2 < 0 ? 0 : i - 2) * 3 + 1], pts[(i - 1) * 3 + 1], pts[i * 3 + 1]];
      segB = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
    }
    for (const [i, t] of this.tiles) {
      const y0 = i * TILE_H;
      if (segB[3] < y0 || segB[1] > y0 + TILE_H) continue;
      const ctx = this._ctx(t[layer], i);
      if (first) drawDot(ctx, a, 0);
      else drawSegment(ctx, a, n - 1);
    }
  }

  _eraseAt([x, y]) {
    const r = 10;
    const hits = [];
    for (const s of this.strokes) {
      const b = s.bbox, pad = r + s.size / 2;
      if (x < b[0] - pad || x > b[2] + pad || y < b[1] - pad || y > b[3] + pad) continue;
      if (hitStroke(s, x, y, pad)) hits.push(s);
    }
    if (!hits.length) return;
    const ids = new Set(hits.map(s => s.id));
    this.strokes = this.strokes.filter(s => !ids.has(s.id));
    this.erasing.removed.push(...hits);
    const b = hits.reduce((acc, s) => [Math.min(acc[0], s.bbox[0]), Math.min(acc[1], s.bbox[1]), Math.max(acc[2], s.bbox[2]), Math.max(acc[3], s.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    this.redrawRegion(b);
  }
}

// ---------- drawing helpers ----------

function makeCanvas(cls) {
  const c = document.createElement('canvas');
  c.className = cls;
  return c;
}

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

// Smoothing levels: how closely the live line follows the Pencil, and how many
// tidy-up passes run when the Pencil lifts. Index 0 is off.
const FOLLOW = [1, 0.6, 0.42, 0.28];
const PASSES = [0, 1, 2, 4];

// Hold to snap: how long the Pencil must rest, and how far it may drift (logical px).
const HOLD_MS = 550;
const HOLD_SLOP = 4;
const AXIS_SNAP_DEG = 5;

const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

function avgPressure(P) {
  let t = 0;
  for (let i = 2; i < P.length; i += 3) t += P[i];
  return r2(t / (P.length / 3));
}

// Lines close to level or upright become exactly level or upright.
function straighten(x0, y0, x1, y1) {
  const deg = Math.abs(Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI);
  if (deg < AXIS_SNAP_DEG || deg > 180 - AXIS_SNAP_DEG) return [x1, y0];
  if (Math.abs(deg - 90) < AXIS_SNAP_DEG) return [x0, y1];
  return [x1, y1];
}

// Decide whether a held stroke is a line, an oval, or neither (left as handwriting).
function recognise(P, raw) {
  const n = P.length / 3;
  if (n < 4) return null;
  let len = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1];
    if (i) len += Math.hypot(x - P[(i - 1) * 3], y - P[(i - 1) * 3 + 1]);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (len < 24) return null;
  const x0 = P[0], y0 = P[1], [ex, ey] = raw;
  const gap = Math.hypot(ex - x0, ey - y0);

  if (gap / len > 0.85) {
    const [x1, y1] = straighten(x0, y0, ex, ey);
    return { type: 'line', x0, y0, x1, y1 };
  }

  const w = maxX - minX, h = maxY - minY, big = Math.max(w, h);
  if (big < 20 || gap > 0.35 * big || len < 1.1 * (w + h) || len > 3.2 * (w + h)) return null;

  // Fit a (possibly tilted) oval through the points' spread.
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += P[i * 3]; my += P[i * 3 + 1]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = P[i * 3] - mx, dy = P[i * 3 + 1] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (Math.abs(ang) < 6 * Math.PI / 180) ang = 0; // nearly level ovals sit level
  const c = Math.cos(ang), s = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = P[i * 3] - mx, dy = P[i * 3 + 1] - my;
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const rx = (u1 - u0) / 2, ry = (v1 - v0) / 2;
  if (rx < 6 || ry < 6) return null;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const cx = mx + cu * c - cv * s, cy = my + cu * s + cv * c;

  // Only snap if the stroke really was roughly oval.
  let err = 0;
  for (let i = 0; i < n; i++) {
    const dx = P[i * 3] - cx, dy = P[i * 3 + 1] - cy;
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    err += Math.abs(Math.hypot(u / rx, v / ry) - 1);
  }
  if (err / n > 0.22) return null;
  return { type: 'oval', cx, cy, rx, ry, ang };
}

function shapePoints(sh, p) {
  if (sh.type === 'line') return [r1(sh.x0), r1(sh.y0), p, r1(sh.x1), r1(sh.y1), p];
  const out = [], c = Math.cos(sh.ang), s = Math.sin(sh.ang), N = 72;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const u = Math.cos(t) * sh.rx, v = Math.sin(t) * sh.ry;
    out.push(r1(sh.cx + u * c - v * s), r1(sh.cy + u * s + v * c), p);
  }
  return out;
}

// Tidy a finished stroke: each pass nudges every point toward the average of its
// neighbours (1-2-1 weights). Endpoints stay put, and sharp corners such as the
// tops of letters are softened only a little, so handwriting keeps its shape.
function smoothPoints(P, passes) {
  const n = P.length / 3;
  if (n < 4 || !passes) return P;
  let a = P.slice();
  for (let k = 0; k < passes; k++) {
    const b = a.slice();
    for (let i = 1; i < n - 1; i++) {
      for (let c = 0; c < 3; c++) {
        b[i * 3 + c] = (a[(i - 1) * 3 + c] + 2 * a[i * 3 + c] + a[(i + 1) * 3 + c]) / 4;
      }
    }
    a = b;
  }
  for (let i = 0; i < a.length; i++) a[i] = (i % 3 === 2) ? r2(a[i]) : r1(a[i]);
  return a;
}

function widthAt(s, i) {
  if (!s.pressure) return s.size;
  const p = s.pts[i * 3 + 2];
  return Math.max(0.6, s.size * (0.35 + 1.3 * p));
}

function drawDot(ctx, s, i) {
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.arc(s.pts[i * 3], s.pts[i * 3 + 1], widthAt(s, i) / 2, 0, Math.PI * 2);
  ctx.fill();
}

// Segment i joins the midpoint before point i-1 to the midpoint after it, curving through
// point i-1. Drawing segments 1..n-1 plus a final tail gives one smooth stroke.
function drawSegment(ctx, s, i) {
  const P = s.pts;
  const x0 = P[(i - 1) * 3], y0 = P[(i - 1) * 3 + 1];
  const x1 = P[i * 3], y1 = P[i * 3 + 1];
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  let sx, sy;
  if (i === 1) { sx = x0; sy = y0; }
  else { sx = (P[(i - 2) * 3] + x0) / 2; sy = (P[(i - 2) * 3 + 1] + y0) / 2; }
  ctx.strokeStyle = s.color;
  ctx.lineWidth = (widthAt(s, i - 1) + widthAt(s, i)) / 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(x0, y0, mx, my);
  ctx.stroke();
}

export function drawStroke(ctx, s) {
  const n = s.pts.length / 3;
  if (n === 1) { drawDot(ctx, s, 0); return; }
  if (!s.pressure) {
    // Uniform width: one path, so overlapping parts do not double up.
    const P = s.pts;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    ctx.moveTo(P[0], P[1]);
    for (let i = 1; i < n; i++) {
      const x0 = P[(i - 1) * 3], y0 = P[(i - 1) * 3 + 1];
      const mx = (x0 + P[i * 3]) / 2, my = (y0 + P[i * 3 + 1]) / 2;
      if (i === 1) ctx.lineTo(mx, my);
      else ctx.quadraticCurveTo(x0, y0, mx, my);
    }
    ctx.lineTo(P[(n - 1) * 3], P[(n - 1) * 3 + 1]);
    ctx.stroke();
    return;
  }
  for (let i = 1; i < n; i++) drawSegment(ctx, s, i);
  // tail from last midpoint to the final point
  const P = s.pts, i = n - 1;
  ctx.lineWidth = widthAt(s, i);
  ctx.beginPath();
  ctx.moveTo((P[(i - 1) * 3] + P[i * 3]) / 2, (P[(i - 1) * 3 + 1] + P[i * 3 + 1]) / 2);
  ctx.lineTo(P[i * 3], P[i * 3 + 1]);
  ctx.stroke();
}

function bboxOf(s) {
  const P = s.pts;
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < a) a = P[i];
    if (P[i + 1] < b) b = P[i + 1];
    if (P[i] > c) c = P[i];
    if (P[i + 1] > d) d = P[i + 1];
  }
  const pad = s.size * 1.2;
  return [a - pad, b - pad, c + pad, d + pad];
}

function hitStroke(s, x, y, r) {
  const P = s.pts, r2v = r * r;
  const n = P.length / 3;
  if (n === 1) return (P[0] - x) ** 2 + (P[1] - y) ** 2 <= r2v;
  for (let i = 1; i < n; i++) {
    if (distSeg2(x, y, P[(i - 1) * 3], P[(i - 1) * 3 + 1], P[i * 3], P[i * 3 + 1]) <= r2v) return true;
  }
  return false;
}

function distSeg2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}
