// On-screen ruler. Move it with one finger, turn it with two. Pen and highlighter
// strokes that start right beside one of its long edges run dead straight along it.

import { PAGE_W } from './ink.js';

const LEN = 760;   // logical px
const H = 84;
const GRAB = 30;   // how close to an edge a stroke must start to follow it
const SNAP_DEG = 3;

export class Ruler {
  constructor(ink, host) {
    this.ink = ink;
    this.visible = false;
    this.cx = PAGE_W / 2; this.cy = 400; this.ang = 0;
    this.pointers = new Map();
    this.el = document.createElement('div');
    this.el.className = 'ruler';
    this.el.hidden = true;
    this.el.innerHTML = '<span class="ruler-angle"></span>';
    host.appendChild(this.el);
    this.el.addEventListener('pointerdown', e => this._down(e));
    this.el.addEventListener('pointermove', e => this._move(e));
    this.el.addEventListener('pointerup', e => this._up(e));
    this.el.addEventListener('pointercancel', e => this._up(e));
    this.el.addEventListener('touchstart', e => {
      for (const t of e.touches) if (t.touchType !== 'stylus') { e.preventDefault(); return; }
    }, { passive: false });
  }

  toggle() { this.visible ? this.hide() : this.show(); return this.visible; }

  show() {
    const sc = this.ink.scroller, k = this.ink.scale;
    this.cx = PAGE_W / 2;
    this.cy = (sc.scrollTop + sc.clientHeight * 0.45) / k;
    this.ang = 0;
    this.visible = true;
    this.render();
  }

  hide() { this.visible = false; this.pointers.clear(); this.render(); }

  render() {
    const el = this.el;
    el.hidden = !this.visible;
    if (!this.visible) return;
    const k = this.ink.scale;
    el.style.width = LEN * k + 'px';
    el.style.height = H * k + 'px';
    el.style.left = (this.cx - LEN / 2) * k + 'px';
    el.style.top = (this.cy - H / 2) * k + 'px';
    el.style.transform = `rotate(${this.ang}rad)`;
    el.style.setProperty('--tick', Math.max(4, 10 * k) + 'px');
    let deg = Math.round(((this.ang * 180 / Math.PI) % 180 + 180) % 180);
    if (deg > 90) deg = 180 - deg;
    el.firstChild.textContent = deg + '°';
  }

  // A line just outside the nearest long edge, or null if (x, y) is not beside one.
  edgeNear(x, y, size) {
    if (!this.visible) return null;
    const ux = Math.cos(this.ang), uy = Math.sin(this.ang);
    const nx = -uy, ny = ux;
    const dx = x - this.cx, dy = y - this.cy;
    const along = dx * ux + dy * uy, across = dx * nx + dy * ny;
    if (Math.abs(along) > LEN / 2 + 20) return null;
    const off = H / 2 + size / 2 + 1;
    let side = 0;
    if (across < 0 && across > -H / 2 - GRAB) side = -1;
    else if (across > 0 && across < H / 2 + GRAB) side = 1;
    if (!side) return null;
    return { ox: this.cx + nx * off * side, oy: this.cy + ny * off * side, ux, uy };
  }

  _down(e) {
    if (e.pointerType === 'pen') return; // the Pencil draws along the ruler
    e.preventDefault();
    e.stopPropagation();
    try { this.el.setPointerCapture(e.pointerId); } catch {}
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._baseline();
  }

  _baseline() {
    this.base = { cx: this.cx, cy: this.cy, ang: this.ang, pts: new Map([...this.pointers].map(([id, p]) => [id, { ...p }])) };
  }

  _move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    e.stopPropagation();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const k = this.ink.scale, b = this.base;
    const ids = [...this.pointers.keys()].slice(0, 2);
    if (ids.length === 1) {
      const p = this.pointers.get(ids[0]), q = b.pts.get(ids[0]);
      this.cx = b.cx + (p.x - q.x) / k;
      this.cy = b.cy + (p.y - q.y) / k;
    } else {
      const [p1, p2] = ids.map(id => this.pointers.get(id));
      const [q1, q2] = ids.map(id => b.pts.get(id));
      this.cx = b.cx + ((p1.x + p2.x) - (q1.x + q2.x)) / 2 / k;
      this.cy = b.cy + ((p1.y + p2.y) - (q1.y + q2.y)) / 2 / k;
      let ang = b.ang + Math.atan2(p2.y - p1.y, p2.x - p1.x) - Math.atan2(q2.y - q1.y, q2.x - q1.x);
      const step = Math.PI / 4, near = Math.round(ang / step) * step; // settle on level, upright and 45°
      if (Math.abs(ang - near) < SNAP_DEG * Math.PI / 180) ang = near;
      this.ang = ang;
    }
    this.render();
  }

  _up(e) {
    if (!this.pointers.delete(e.pointerId)) return;
    e.stopPropagation();
    this._baseline();
  }
}
