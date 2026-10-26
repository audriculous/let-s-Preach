// A small handwriting pad for the outline (Application, Illustrations). The Pencil
// writes, a finger scrolls the sheet. Strokes use the same pen renderer as the page,
// and are kept in pad units (400 wide) so they scale with the sheet.

import { drawStroke } from './ink.js';

export const PAD_W = 400;
const MAX_DPR = 2;

export function emptyPad(h = 220) { return { h, strokes: [] }; }

export class Pad {
  // data: { h, strokes }, opts: { onChange, pushAction, pen: () => ({ color, size, smoothing }), fingerDraw: () => bool }
  constructor(host, data, opts) {
    this.data = data;
    this.opts = opts;
    this.erasing = false;
    this.el = document.createElement('div');
    this.el.className = 'pad';
    this.el.innerHTML = `<canvas></canvas>
      <div class="pad-tools">
        <button type="button" data-act="pen" class="on" aria-label="Write">Write</button>
        <button type="button" data-act="erase" aria-label="Erase">Erase</button>
        <button type="button" data-act="more" aria-label="More space">More space</button>
      </div>`;
    host.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.active = null;
    this.raf = 0;

    this.el.querySelector('.pad-tools').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'more') { this._resize(this.data.h + 160); return; }
      this.erasing = b.dataset.act === 'erase';
      this.el.querySelectorAll('[data-act=pen],[data-act=erase]').forEach(x => x.classList.toggle('on', x === b));
    });

    const c = this.canvas;
    // Stop the Pencil (but not a finger) from scrolling the sheet.
    c.addEventListener('touchstart', e => {
      for (const t of e.touches) if (t.touchType === 'stylus' || this.opts.fingerDraw()) { e.preventDefault(); return; }
    }, { passive: false });
    c.addEventListener('pointerdown', e => this._down(e));
    c.addEventListener('pointermove', e => this._move(e));
    c.addEventListener('pointerup', e => this._up(e));
    c.addEventListener('pointercancel', e => this._up(e));
    new ResizeObserver(() => this.render()).observe(this.el);
  }

  get k() { return (this.canvas.clientWidth || PAD_W) / PAD_W; }

  _pt(e) {
    const r = this.canvas.getBoundingClientRect(), k = r.width / PAD_W;
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k, e.pointerType === 'pen' ? (e.pressure || 0.3) : 0.5];
  }

  _down(e) {
    if (e.pointerType === 'touch' && !this.opts.fingerDraw()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch {}
    const [x, y, p] = this._pt(e);
    if (this.erasing) { this.active = { id: e.pointerId, erase: [] }; this._eraseAt(x, y); return; }
    const pen = this.opts.pen();
    this.active = {
      id: e.pointerId,
      stroke: { tool: 'pen', color: pen.color, size: pen.size, pressure: e.pointerType === 'pen', sm: pen.smoothing, pts: [r1(x), r1(y), r2(p)] },
    };
    this._queue();
  }

  _move(e) {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const [x, y, p] = this._pt(ev);
      if (a.erase) { this._eraseAt(x, y); continue; }
      const P = a.stroke.pts, n = P.length;
      if ((x - P[n - 3]) ** 2 + (y - P[n - 2]) ** 2 < 0.25) continue;
      P.push(r1(x), r1(y), r2(p));
    }
    this._queue();
  }

  _up(e) {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    this.active = null;
    if (a.erase) {
      const gone = a.erase;
      if (gone.length) {
        this.opts.pushAction({
          undo: () => { this.data.strokes.push(...gone); this._changed(); },
          redo: () => { this.data.strokes = this.data.strokes.filter(s => !gone.includes(s)); this._changed(); },
        });
        this._changed();
      }
      return;
    }
    const s = a.stroke;
    this.data.strokes.push(s);
    if (maxY(s) > this.data.h - 30) this.data.h = Math.ceil(maxY(s) + 120); // room to keep writing
    this.opts.pushAction({
      undo: () => { this.data.strokes = this.data.strokes.filter(x => x !== s); this._changed(); },
      redo: () => { this.data.strokes.push(s); this._changed(); },
    });
    this._changed();
  }

  _eraseAt(x, y) {
    const r2v = 10 * 10;
    const keep = [];
    for (const s of this.data.strokes) {
      const P = s.pts;
      let hit = false;
      for (let i = 0; i < P.length && !hit; i += 3) if ((P[i] - x) ** 2 + (P[i + 1] - y) ** 2 <= r2v) hit = true;
      if (hit) this.active.erase.push(s); else keep.push(s);
    }
    if (keep.length !== this.data.strokes.length) { this.data.strokes = keep; this._queue(); }
  }

  _resize(h) {
    const before = this.data.h;
    this.data.h = h;
    this.opts.pushAction({ undo: () => { this.data.h = before; this._changed(); }, redo: () => { this.data.h = h; this._changed(); } });
    this._changed();
  }

  _changed() { this.render(); this.opts.onChange(); }

  _queue() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  render() {
    const c = this.canvas, w = c.clientWidth || this.el.clientWidth;
    if (!w) return;
    const k = w / PAD_W, dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const hCss = this.data.h * k;
    c.style.height = hCss + 'px';
    const W = Math.round(w * dpr), H = Math.round(hCss * dpr);
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of this.data.strokes) drawStroke(ctx, s);
    if (this.active && this.active.stroke) drawStroke(ctx, this.active.stroke, false);
  }
}

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
function maxY(s) { let m = 0; for (let i = 1; i < s.pts.length; i += 3) m = Math.max(m, s.pts[i]); return m; }
