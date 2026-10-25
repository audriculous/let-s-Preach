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
    for (const ev of (evs.length ? evs : [e])) {
      let [x, y, p] = this._point(ev);
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
    const stroke = { id: a.id, tool: a.tool, color: a.color, size: a.size, pressure: a.pressure, pts: a.pts };
    stroke.bbox = bboxOf(stroke);
    this.strokes.push(stroke);
    this.redrawRegion(stroke.bbox); // replaces the live preview with the clean render
    this.onAction({
      undo: () => this.removeStrokes([stroke], false),
      redo: () => this.addStroke(stroke, false),
    });
    this.onChange();
    if (stroke.bbox[3] > this.pageH - 350) this.onNearBottom();
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
