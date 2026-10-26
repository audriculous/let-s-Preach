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
  constructor({ scroller, pageBox, hlLayer, inkLayer, overlay, onAction, onChange, onTextTap, onWordTap, onNearBottom }) {
    this.scroller = scroller;
    this.pageBox = pageBox;
    this.hlLayer = hlLayer;
    this.inkLayer = inkLayer;
    this.overlay = overlay;
    this.onAction = onAction;
    this.onChange = onChange;
    this.onTextTap = onTextTap;
    this.onWordTap = onWordTap;
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
    this.scribbleErase = true; // scribble over ink with the pen to erase it
    this.shapeKind = 'line';   // shape tool: line, arrow, box or oval
    this.ruler = null;         // set by the app; strokes that start beside it run along its edge

    this.tiles = new Map(); // index -> { hl, ink }
    // The stroke being written is redrawn whole every frame on its own canvas (one per
    // layer, so a live highlight already sits behind the words), then laid onto the tiles.
    this.live = { hl: makeCanvas('tile live'), ink: makeCanvas('tile live') };
    this.live.hl.hidden = this.live.ink.hidden = true;
    hlLayer.appendChild(this.live.hl);
    inkLayer.appendChild(this.live.ink);
    this.liveRaf = 0;
    this.pool = [];
    this.active = null;     // stroke being drawn
    this.erasing = null;    // { pointerId, removed: [] }
    this.tap = null;        // text / word tool tap tracking
    this.lassoing = null;   // { id, pts } while drawing a lasso
    this.selection = null;  // { strokes, box }
    this.dragging = null;   // moving or resizing the selection
    this.penDown = false;
    this.rafPending = false;

    this._bind();
  }

  // ---------- public API ----------

  setStrokes(strokes) {
    this.strokes = strokes.map(s => ({ ...s, bbox: s.bbox || bboxOf(s) }));
    this.selection = null;
    this.rebuildTiles();
    this._renderOverlay();
  }

  layout(scale, pageH) {
    const changedScale = Math.abs(scale - this.scale) > 1e-4;
    this.scale = scale;
    this.pageH = pageH;
    if (changedScale) this.rebuildTiles();
    else this.updateTiles();
    this._renderOverlay();
    if (this.ruler) this.ruler.render();
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

  addStrokes(list, record = true) {
    let b = null;
    for (const s of list) { s.bbox = bboxOf(s); this.strokes.push(s); b = b ? union(b, s.bbox) : s.bbox; }
    if (b) this.redrawRegion(b);
    if (record) {
      this.onAction({
        undo: () => this.removeStrokes(list, false),
        redo: () => this.addStrokes(list, false),
      });
    }
    this.onChange();
  }

  clearAll() {
    this.clearSelection();
    if (this.strokes.length) this.removeStrokes(this.strokes.slice());
  }

  // ---------- lasso selection ----------

  clearSelection() {
    if (!this.selection && !this.lassoing) return;
    this.selection = null;
    this.lassoing = null;
    this._renderOverlay();
  }

  deleteSelection() {
    const sel = this.selection;
    if (!sel) return;
    this.clearSelection();
    this.removeStrokes(sel.strokes);
  }

  duplicateSelection() {
    const sel = this.selection;
    if (!sel) return;
    const copies = sel.strokes.map(s => ({ ...s, id: uid(), pts: s.pts.map((v, i) => (i % 3 === 2 ? v : r1(v + 24))) }));
    this.addStrokes(copies);
    this.selection = { strokes: copies, box: boxOfAll(copies) };
    this._renderOverlay();
  }

  recolorSelection(color) {
    const sel = this.selection;
    if (!sel) return false;
    const list = sel.strokes.filter(s => s.tool !== 'highlighter' && s.color !== color);
    if (!list.length) return true;
    const before = list.map(s => s.color);
    const apply = cols => { list.forEach((s, i) => { s.color = cols[i]; }); this.redrawRegion(boxOfAll(list)); this.onChange(); };
    apply(list.map(() => color));
    this.onAction({ undo: () => apply(before), redo: () => apply(list.map(() => color)) });
    return true;
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
    // Tiles start and end on whole device pixels, so ink is never resampled (and softened)
    // between the live canvas and the page.
    const dpr = this.dpr(), k = this.scale * dpr;
    const wPx = Math.round(PAGE_W * k);
    const y0 = Math.round(i * TILE_H * k), hPx = Math.round((i + 1) * TILE_H * k) - y0;
    for (const c of [t.hl, t.ink]) {
      if (c.width !== wPx) c.width = wPx;
      if (c.height !== hPx) c.height = hPx;
      c.style.width = wPx / dpr + 'px';
      c.style.height = hPx / dpr + 'px';
      c.style.top = y0 / dpr + 'px';
    }
    if (!t.hl.parentNode) this.hlLayer.insertBefore(t.hl, this.live.hl); // keep the live stroke on top
    if (!t.ink.parentNode) this.inkLayer.insertBefore(t.ink, this.live.ink);
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
    ctx.setTransform(k, 0, 0, k, 0, -Math.round(i * TILE_H * k));
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
      if (e.target.closest && e.target.closest('.sel-bar, .note-wrap')) return;
      for (const t of e.touches) {
        if (t.touchType === 'stylus') { e.preventDefault(); return; }
      }
      if (this.tool === 'spot') return; // fingers tap words and still scroll
      // A finger that lands on a lasso selection moves it instead of scrolling.
      if (this.selection && e.type === 'touchstart' && e.touches.length === 1 && this._selHit(this._point(e.touches[0]))) { e.preventDefault(); return; }
      if (this.dragging) { e.preventDefault(); return; }
      if (this.fingerDraw) e.preventDefault();
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
    if (e.target.closest && e.target.closest('.note-wrap, .sel-bar')) return;

    if (this.tool === 'spot') {
      this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, pt: this._point(e), kind: 'word' };
      return;
    }

    // Pencil or finger on a lasso selection: move it, or resize from the corner handle.
    if (this.tool === 'lasso' && this.selection && !(e.pointerType === 'touch' && this.penDown)) {
      const pt = this._point(e);
      const mode = this._selHit(pt);
      if (mode) { this._startDrag(e, pt, mode); return; }
    }

    if (!this._accepts(e)) return;

    if (this.tool === 'text') {
      this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, pt: this._point(e), kind: 'text' };
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

    let [x, y, p] = this._point(e);

    if (this.tool === 'lasso') {
      this.clearSelection();
      this.lassoing = { id: e.pointerId, pts: [x, y] };
      this._renderOverlay();
      return;
    }

    if (this.tool === 'shape') {
      this.active = {
        id: uid(), pointerId: e.pointerId, tool: 'pen', color: this.color, size: this.size,
        pressure: false, kind: this.shapeKind, poly: this.shapeKind !== 'oval',
        x0: x, y0: y, pts: [r1(x), r1(y), 0.5],
      };
      this._liveBegin(this.active);
      return;
    }

    const isHl = this.tool === 'highlighter';
    const size = isHl ? this.size * 6 : this.size;
    const ruled = this.ruler && this.ruler.edgeNear(x, y, size);
    if (ruled) [x, y] = project(ruled, x, y);
    this.active = {
      id: uid(),
      pointerId: e.pointerId,
      tool: this.tool,
      color: this.color,
      size,
      pressure: e.pointerType === 'pen' && !isHl,
      pts: [r1(x), r1(y), r2(p)],
      sm: ruled ? 0 : this.smoothing,
      ruled,
      raw: [x, y, p],         // latest sample, so the stroke always ends at the Pencil
      pred: [],
    };
    this._liveBegin(this.active);
  }

  _move(e) {
    if (this.dragging && e.pointerId === this.dragging.id) {
      e.preventDefault();
      this._dragTo(this._point(e));
      return;
    }
    if (this.lassoing && e.pointerId === this.lassoing.id) {
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) { const [x, y] = this._point(ev); this.lassoing.pts.push(x, y); }
      this._queueOverlay();
      return;
    }
    if (this.erasing && e.pointerId === this.erasing.id) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      (evs.length ? evs : [e]).forEach(ev => this._eraseAt(this._point(ev)));
      return;
    }
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    e.preventDefault();
    if (a.kind) {
      // Shape tool: the shape follows the Pencil from where it went down.
      const [x, y] = this._point(e);
      const before = bboxOf(a);
      a.pts = dragShape(a.kind, a.x0, a.y0, x, y, a.size);
      this._requestLive();
      return;
    }
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      let [x, y, p] = this._point(ev);
      if (a.ruled) [x, y] = project(a.ruled, x, y);
      a.raw = [x, y, p];
      if (a.snapped) {
        // After a line snaps, keep holding and drag to move its far end.
        if (a.snapped.type === 'line') this._dragLineEnd(x, y);
        continue;
      }
      if (!a.ruled) this._armHold(x, y);
      // Keep every real sample (smoothing happens when drawing, without lag).
      const n = a.pts.length;
      const dx = x - a.pts[n - 3], dy = y - a.pts[n - 2];
      if (dx * dx + dy * dy < 0.25) continue; // sub-pixel jitter
      a.pts.push(r1(x), r1(y), r2(p));
    }
    // Where the system expects the Pencil to be next frame, drawn but never kept.
    a.pred = [];
    if (!a.snapped && e.getPredictedEvents) {
      for (const ev of e.getPredictedEvents().slice(0, 3)) {
        let [x, y, p] = this._point(ev);
        if (a.ruled) [x, y] = project(a.ruled, x, y);
        a.pred.push(x, y, p);
      }
    }
    this._requestLive();
  }

  _up(e, cancelled) {
    if (e.pointerType === 'pen') this.penDown = false;

    if (this.tap && e.pointerId === this.tap.id) {
      const moved = Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y);
      const { pt, kind } = this.tap;
      this.tap = null;
      if (!cancelled && moved < 12) (kind === 'word' ? this.onWordTap : this.onTextTap)(pt[0], pt[1]);
      return;
    }

    if (this.dragging && e.pointerId === this.dragging.id) { this._endDrag(); return; }

    if (this.lassoing && e.pointerId === this.lassoing.id) {
      const poly = this.lassoing.pts;
      this.lassoing = null;
      const picked = poly.length >= 12 ? this.strokes.filter(s => insideShare(s, poly) >= 0.6) : [];
      this.selection = picked.length ? { strokes: picked, box: boxOfAll(picked) } : null;
      this._renderOverlay();
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
    const pts = a.pts;
    if (a.kind) {
      const b = bboxOf(a);
      if (b[2] - b[0] < a.size * 2.4 + 6 && b[3] - b[1] < a.size * 2.4 + 6) { this._liveEnd(); return; } // a tap, not a shape
    }
    const stroke = { id: a.id, tool: a.tool, color: a.color, size: a.size, pressure: a.pressure, pts };
    if (a.poly) stroke.poly = true;
    if (a.sm && !a.snapped) stroke.sm = a.sm;
    stroke.bbox = bboxOf(stroke);

    // Scribble to erase: a tight back-and-forth pen stroke over existing ink removes that ink.
    if (this.scribbleErase && a.tool === 'pen' && !a.snapped && !a.kind && !a.ruled && isScribble(a.pts)) {
      const victims = this.strokes.filter(s => scribbleCovers(stroke, s));
      if (victims.length) {
        this._liveEnd();
        this._eraseList(victims, stroke.bbox);
        return;
      }
    }

    // Lay the finished stroke onto the page exactly as it was drawn live, then drop the live copy.
    this.strokes.push(stroke);
    const b = stroke.bbox, layer = stroke.tool === 'highlighter' ? 'hl' : 'ink';
    for (const [i, t] of this.tiles) {
      const y0 = i * TILE_H;
      if (b[3] >= y0 && b[1] <= y0 + TILE_H) drawStroke(this._ctx(t[layer], i), stroke);
    }
    this._liveEnd();
    this.onAction({
      undo: () => this.removeStrokes([stroke], false),
      redo: () => this.addStroke(stroke, false),
    });
    this.onChange();
    if (stroke.bbox[3] > this.pageH - 350) this.onNearBottom();
  }

  _eraseList(list, alsoClear) {
    const ids = new Set(list.map(s => s.id));
    this.strokes = this.strokes.filter(s => !ids.has(s.id));
    this.redrawRegion(list.reduce((acc, s) => union(acc, s.bbox), alsoClear));
    this.onAction({
      undo: () => { list.forEach(s => this.strokes.push(s)); this.redrawAll(); this.onChange(); },
      redo: () => this.removeStrokes(list, false),
    });
    this.onChange();
  }

  // ---------- moving a selection ----------

  _selHit([x, y]) {
    const sel = this.selection;
    if (!sel) return null;
    const b = sel.box, hr = Math.max(20, 28 / this.scale);
    if (Math.hypot(x - b[2], y - b[3]) < hr) return 'resize';
    const pad = 8;
    if (x > b[0] - pad && x < b[2] + pad && y > b[1] - pad && y < b[3] + pad) return 'move';
    return null;
  }

  _startDrag(e, pt, mode) {
    e.preventDefault();
    try { this.scroller.setPointerCapture(e.pointerId); } catch {}
    const sel = this.selection;
    this.dragging = {
      id: e.pointerId, mode, start: pt, box: sel.box.slice(), moved: false,
      orig: sel.strokes.map(s => ({ pts: s.pts.slice(), size: s.size })),
    };
  }

  _dragTo([x, y]) {
    const d = this.dragging, sel = this.selection;
    if (!sel) return;
    let f, k = 1;
    if (d.mode === 'move') {
      const dx = x - d.start[0], dy = y - d.start[1];
      f = (px, py) => [px + dx, py + dy];
    } else {
      const [b0, b1, b2, b3] = d.box;
      k = Math.max(0.2, ((x - b0) + (y - b1)) / ((b2 - b0) + (b3 - b1)));
      f = (px, py) => [b0 + (px - b0) * k, b1 + (py - b1) * k];
    }
    let region = sel.box;
    sel.strokes.forEach((s, i) => {
      const o = d.orig[i], P = new Array(o.pts.length);
      for (let j = 0; j < o.pts.length; j += 3) {
        const [nx, ny] = f(o.pts[j], o.pts[j + 1]);
        P[j] = r1(nx); P[j + 1] = r1(ny); P[j + 2] = o.pts[j + 2];
      }
      s.pts = P;
      s.size = Math.round(o.size * k * 100) / 100;
      region = union(region, s.bbox);
      s.bbox = bboxOf(s);
      region = union(region, s.bbox);
    });
    sel.box = boxOfAll(sel.strokes);
    d.moved = true;
    this._queueRedraw(region);
  }

  _endDrag() {
    const d = this.dragging, sel = this.selection;
    this.dragging = null;
    this._renderOverlay(); // bring the action bar back
    if (!sel || !d.moved) return;
    const list = sel.strokes.slice();
    const before = d.orig, after = list.map(s => ({ pts: s.pts.slice(), size: s.size }));
    const apply = states => {
      list.forEach((s, i) => { s.pts = states[i].pts.slice(); s.size = states[i].size; s.bbox = bboxOf(s); });
      this.selection = null;
      this.redrawAll();
      this._renderOverlay();
      this.onChange();
    };
    this.onAction({ undo: () => apply(before), redo: () => apply(after) });
    this.onChange();
    if (sel.box[3] > this.pageH - 350) this.onNearBottom();
  }

  _queueRedraw(region) {
    this.pendingRegion = this.pendingRegion ? union(this.pendingRegion, region) : region;
    if (this.redrawPending) return;
    this.redrawPending = true;
    requestAnimationFrame(() => {
      this.redrawPending = false;
      const r = this.pendingRegion;
      this.pendingRegion = null;
      if (r) this.redrawRegion(r);
      this._renderOverlay();
    });
  }

  _queueOverlay() {
    if (this.overlayPending) return;
    this.overlayPending = true;
    requestAnimationFrame(() => { this.overlayPending = false; this._renderOverlay(); });
  }

  // The lasso line, the selection box, its resize handle and its little action bar.
  _renderOverlay() {
    const o = this.overlay;
    if (!o) return;
    const k = this.scale;
    let html = '';
    if (this.lassoing) {
      const P = this.lassoing.pts;
      let d = '';
      for (let i = 0; i < P.length; i += 2) d += (i ? 'L' : 'M') + (P[i] * k).toFixed(1) + ' ' + (P[i + 1] * k).toFixed(1);
      html += `<svg class="lasso-svg" width="${PAGE_W * k}" height="${this.pageH * k}"><path d="${d}"/></svg>`;
    }
    const sel = this.selection;
    if (sel) {
      const [x0, y0, x1, y1] = sel.box.map(v => v * k);
      html += `<div class="sel-rect" style="left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px"></div>`;
      html += `<div class="sel-handle" style="left:${x1}px;top:${y1}px"></div>`;
      if (!this.dragging) {
        const top = y0 > 64 ? y0 - 56 : y1 + 14;
        html += `<div class="sel-bar" style="left:${Math.max(4, x0)}px;top:${top}px">` +
          `<button type="button" data-act="dup">Duplicate</button><button type="button" data-act="del">Delete</button></div>`;
      }
    }
    o.innerHTML = html;
    if (!this.overlayBound) {
      this.overlayBound = true;
      o.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'del') this.deleteSelection();
        else this.duplicateSelection();
      });
    }
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
    a.snapped = shape;
    a.pred = [];
    a.pts = shapePoints(shape, avgPressure(a.pts));
    this._requestLive();
  }

  _dragLineEnd(x, y) {
    const a = this.active, L = a.snapped;
    [L.x1, L.y1] = straighten(L.x0, L.y0, x, y);
    a.pts = shapePoints(L, a.pts[2]);
    this._requestLive();
  }

  // ---------- live stroke ----------

  // Cover the visible part of the page with the live canvas for the active stroke's layer.
  _liveBegin(a) {
    const c = this.live[a.tool === 'highlighter' ? 'hl' : 'ink'];
    const sc = this.scroller.getBoundingClientRect(), pb = this.pageBox.getBoundingClientRect();
    const left = Math.max(sc.left, pb.left), top = Math.max(sc.top, pb.top);
    const w = Math.max(1, Math.min(sc.right, pb.right) - left), h = Math.max(1, Math.min(sc.bottom, pb.bottom) - top);
    const dpr = this.dpr();
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const dx = Math.round((left - pb.left) * dpr), dy = Math.round((top - pb.top) * dpr); // whole device px
    c.style.width = W / dpr + 'px'; c.style.height = H / dpr + 'px';
    c.style.left = dx / dpr + 'px'; c.style.top = dy / dpr + 'px';
    c.hidden = false;
    a.live = { c, ctx: c.getContext('2d', { desynchronized: true }), dx, dy, dpr };
    this._liveDraw();
  }

  _requestLive() {
    if (this.liveRaf) return;
    this.liveRaf = requestAnimationFrame(() => { this.liveRaf = 0; this._liveDraw(); });
  }

  _liveDraw() {
    const a = this.active;
    if (!a || !a.live) return;
    const { c, ctx, dx, dy, dpr } = a.live;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const k = this.scale * dpr;
    ctx.setTransform(k, 0, 0, k, -dx, -dy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawStroke(ctx, a.pred && a.pred.length ? { ...a, pts: a.pts.concat(a.pred) } : a, false);
  }

  _liveEnd() {
    if (this.liveRaf) { cancelAnimationFrame(this.liveRaf); this.liveRaf = 0; }
    for (const c of [this.live.hl, this.live.ink]) {
      if (c.hidden) continue;
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
      c.hidden = true;
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

// Smoothing levels (index 0 is off): how far each point of the drawn line moves toward
// the Pencil sample. The tip of the line is always the Pencil itself, so there is no lag;
// only the line behind it is eased into a smoother curve.
const STREAM = [1, 0.62, 0.46, 0.33];

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

// A scribble is a compact stroke that keeps doubling back on itself.
function isScribble(P) {
  const n = P.length / 3;
  if (n < 8) return null;
  // Resample every ~5px so slow and fast strokes count the same.
  const pts = [[P[0], P[1]]];
  let len = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    const [lx, ly] = pts[pts.length - 1];
    const d = Math.hypot(x - lx, y - ly);
    if (d >= 5) { pts.push([x, y]); len += d; }
  }
  const big = Math.max(maxX - minX, maxY - minY);
  if (len < 70 || big < 12 || len < 3 * big) return false;
  let reversals = 0;
  for (let i = 2; i < pts.length - 2; i++) {
    const ax = pts[i][0] - pts[i - 2][0], ay = pts[i][1] - pts[i - 2][1];
    const bx = pts[i + 2][0] - pts[i][0], by = pts[i + 2][1] - pts[i][1];
    const cos = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
    if (cos < -0.5) { reversals++; i += 2; } // one sharp turn counts once
  }
  return reversals >= 4;
}

// Does the scribble touch stroke s (or sit right over a small mark)?
function scribbleCovers(scr, s) {
  const a = scr.bbox, b = s.bbox;
  if (b[2] < a[0] || b[0] > a[2] || b[3] < a[1] || b[1] > a[3]) return false;
  if (b[0] >= a[0] && b[2] <= a[2] && b[1] >= a[1] && b[3] <= a[3]) return true; // fully inside
  const P = scr.pts, r = scr.size / 2 + s.size / 2 + 3;
  for (let i = 0; i < P.length; i += 3) if (hitStroke(s, P[i], P[i + 1], r)) return true;
  return false;
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

// Points for a shape dragged from (x0, y0) to (x, y).
function dragShape(kind, x0, y0, x, y, size) {
  if (kind === 'box') return [x0, y0, x, y0, x, y, x0, y, x0, y0].flatMap((v, i) => (i % 2 ? [r1(v), 0.5] : [r1(v)]));
  if (kind === 'oval') {
    const rx = Math.abs(x - x0) / 2, ry = Math.abs(y - y0) / 2;
    return shapePoints({ type: 'oval', cx: (x0 + x) / 2, cy: (y0 + y) / 2, rx, ry, ang: 0 }, 0.5);
  }
  [x, y] = straighten(x0, y0, x, y);
  const pts = [r1(x0), r1(y0), 0.5, r1(x), r1(y), 0.5];
  if (kind === 'arrow') {
    const len = Math.hypot(x - x0, y - y0);
    if (len > 4) {
      const head = Math.min(len * 0.45, Math.max(16, size * 4.5));
      const a = Math.atan2(y - y0, x - x0), spread = 0.5;
      const lx = x - head * Math.cos(a - spread), ly = y - head * Math.sin(a - spread);
      const rx = x - head * Math.cos(a + spread), ry = y - head * Math.sin(a + spread);
      pts.push(r1(lx), r1(ly), 0.5, r1(x), r1(y), 0.5, r1(rx), r1(ry), 0.5);
    }
  }
  return pts;
}

// Move a point onto a ruler edge line { ox, oy, ux, uy }.
function project(L, x, y) {
  const t = (x - L.ox) * L.ux + (y - L.oy) * L.uy;
  return [L.ox + t * L.ux, L.oy + t * L.uy];
}

// Share of a stroke's points that sit inside a lasso polygon [x, y, x, y, ...].
function insideShare(s, poly) {
  const P = s.pts, n = P.length / 3, step = Math.max(1, Math.floor(n / 30));
  let inside = 0, total = 0;
  for (let i = 0; i < n; i += step) {
    total++;
    if (pointInPoly(P[i * 3], P[i * 3 + 1], poly)) inside++;
  }
  return total ? inside / total : 0;
}

function pointInPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function boxOfAll(list) {
  return list.reduce((acc, s) => union(acc, s.bbox || bboxOf(s)), [Infinity, Infinity, -Infinity, -Infinity]);
}

// ---------- stroke rendering ----------
//
// A stroke's samples become a smooth centre line (eased toward the Pencil, then fitted
// with a curve sampled about every logical pixel). Pressure strokes are filled as one
// outline whose width follows the pressure, like a real pen; uniform strokes are stroked
// along the same line. The result is cached per stroke.

const PATHS = new WeakMap();

function radiusAt(s, p) {
  if (!s.pressure) return s.size / 2;
  const q = Math.sqrt(Math.min(1, Math.max(0, p)));
  return Math.max(0.3, s.size * (0.5 + 0.75 * q) / 2);
}

function centreLine(s) {
  const P = s.pts, n = P.length / 3;
  const t = STREAM[s.sm || 0] ?? 1;
  // 1. Ease each point toward its sample, then let the line curve in to finish exactly
  //    at the last sample (the Pencil), the same way while writing and after lifting.
  const q = [P[0], P[1], P[2]];
  let x = P[0], y = P[1], p = P[2];
  const push = force => {
    const m = q.length;
    if (!force && (x - q[m - 3]) ** 2 + (y - q[m - 2]) ** 2 < 0.04) return;
    q.push(x, y, p);
  };
  for (let i = 1; i < n; i++) {
    x += (P[i * 3] - x) * t;
    y += (P[i * 3 + 1] - y) * t;
    p += (P[i * 3 + 2] - p) * 0.5;
    push(false);
  }
  if (n > 1 && t < 1) {
    const ex = P[(n - 1) * 3], ey = P[(n - 1) * 3 + 1];
    for (let j = 0; j < 8 && (ex - x) ** 2 + (ey - y) ** 2 > 0.09; j++) {
      x += (ex - x) * t; y += (ey - y) * t;
      push(false);
    }
    x = ex; y = ey;
    push(true);
  }
  // 2. Curve through the midpoints (never overshoots), sampled finely.
  const C = { x: [], y: [], r: [] };
  const add = (X, Y, R) => { C.x.push(X); C.y.push(Y); C.r.push(R); };
  const k = q.length / 3;
  const R = i => radiusAt(s, q[i * 3 + 2]);
  add(q[0], q[1], R(0));
  if (k === 1) return C;
  let sx = q[0], sy = q[1], sr = R(0);
  for (let i = 1; i < k - 1; i++) {
    const cx = q[i * 3], cy = q[i * 3 + 1], cr = R(i);
    const ex = (cx + q[(i + 1) * 3]) / 2, ey = (cy + q[(i + 1) * 3 + 1]) / 2, er = (cr + R(i + 1)) / 2;
    const len = Math.hypot(cx - sx, cy - sy) + Math.hypot(ex - cx, ey - cy);
    const steps = Math.max(1, Math.min(24, Math.ceil(len / 1.1)));
    for (let j = 1; j <= steps; j++) {
      const u = j / steps, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
      add(a * sx + b * cx + c * ex, a * sy + b * cy + c * ey, a * sr + b * cr + c * er);
    }
    sx = ex; sy = ey; sr = er;
  }
  const lx = q[(k - 1) * 3], ly = q[(k - 1) * 3 + 1], lr = R(k - 1);
  const steps = Math.max(1, Math.min(24, Math.ceil(Math.hypot(lx - sx, ly - sy) / 1.1)));
  for (let j = 1; j <= steps; j++) {
    const u = j / steps;
    add(sx + (lx - sx) * u, sy + (ly - sy) * u, sr + (lr - sr) * u);
  }
  return C;
}

// Filled outline for a pressure stroke. Each run is a band (one side forward, the other
// back) wound the same way as the round caps, so overlaps merge cleanly into one shape.
function outlinePath(C) {
  const path = new Path2D();
  const m = C.x.length;
  const dot = j => { path.moveTo(C.x[j] + C.r[j], C.y[j]); path.arc(C.x[j], C.y[j], C.r[j], 0, Math.PI * 2); };
  dot(0);
  if (m === 1) return path;
  const band = (a, b) => {
    if (b <= a) return;
    const nx = [], ny = [];
    for (let j = a; j <= b; j++) {
      const j0 = Math.max(a, j - 1), j1 = Math.min(b, j + 1);
      let dx = C.x[j1] - C.x[j0], dy = C.y[j1] - C.y[j0];
      const l = Math.hypot(dx, dy) || 1;
      nx.push(-dy / l); ny.push(dx / l);
    }
    path.moveTo(C.x[a] - nx[0] * C.r[a], C.y[a] - ny[0] * C.r[a]);
    for (let j = a + 1; j <= b; j++) path.lineTo(C.x[j] - nx[j - a] * C.r[j], C.y[j] - ny[j - a] * C.r[j]);
    for (let j = b; j >= a; j--) path.lineTo(C.x[j] + nx[j - a] * C.r[j], C.y[j] + ny[j - a] * C.r[j]);
    path.closePath();
  };
  let start = 0;
  for (let j = 1; j < m - 1; j++) {
    const ax = C.x[j] - C.x[j - 1], ay = C.y[j] - C.y[j - 1], bx = C.x[j + 1] - C.x[j], by = C.y[j + 1] - C.y[j];
    const cos = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
    if (cos < 0.2) { band(start, j); dot(j); start = j; } // a sharp corner: start a new band
    else if (cos < 0.97) dot(j);                        // a tight curve: fill the inside of the bend
  }
  band(start, m - 1);
  dot(m - 1);
  return path;
}

function linePath(C) {
  const path = new Path2D();
  path.moveTo(C.x[0], C.y[0]);
  if (C.x.length === 1) path.lineTo(C.x[0] + 0.01, C.y[0]);
  for (let j = 1; j < C.x.length; j++) path.lineTo(C.x[j], C.y[j]);
  return path;
}

function strokePath(s, cache) {
  if (cache) {
    const c = PATHS.get(s);
    if (c && c.pts === s.pts && c.size === s.size && c.n === s.pts.length) return c.path;
  }
  const C = centreLine(s);
  const path = s.pressure ? outlinePath(C) : linePath(C);
  if (cache) PATHS.set(s, { pts: s.pts, size: s.size, n: s.pts.length, path });
  return path;
}

export function drawStroke(ctx, s, cache = true) {
  const n = s.pts.length / 3;
  if (s.poly && n > 1) {
    // Shapes keep their sharp corners.
    const P = s.pts;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    ctx.moveTo(P[0], P[1]);
    for (let i = 1; i < n; i++) ctx.lineTo(P[i * 3], P[i * 3 + 1]);
    ctx.stroke();
    return;
  }
  const path = strokePath(s, cache);
  if (s.pressure) {
    ctx.fillStyle = s.color;
    ctx.fill(path);
  } else {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.stroke(path);
  }
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
