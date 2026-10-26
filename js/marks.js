// Marks drawn under the passage text: boxes around spotted words, underlines on
// connectives, and the numbered breakup of the passage into sermon points.
// Everything is kept in logical page coordinates so the PDF can draw it too.

import { PAGE_W } from './ink.js';
import { WORD_RE, CONNECTIVES, normWord, isStopWord, walkVerses, pointStarts } from './verses.js';

export const SPOT_COLORS = ['#2f5d8a', '#c62828', '#2e7d32', '#6a1b9a', '#e65100', '#00838f', '#ad1457', '#5d4037'];
export const CONNECTIVE_COLOR = '#b07a12';
export const BREAK_COLOR = '#e0a32e';

const EXCLUDE = '.ref-version, .ref-heading, .footnotes, .copyright, sup, h3, h4, .chapternum';

export class Marks {
  constructor({ page, passageEl, layer }) {
    this.page = page;
    this.passageEl = passageEl;
    this.layer = layer;
    this.study = null;
    this.index = null;
    this.items = [];
  }

  setStudy(s) { this.study = s; this.index = null; this.render(); }
  invalidate() { this.index = null; }

  _geom() {
    const r = this.page.getBoundingClientRect();
    const scale = r.width / PAGE_W;
    return scale > 0 ? { r, scale } : null;
  }

  // Every Bible word on the page with where it sits.
  _buildIndex() {
    const g = this._geom();
    if (!g) return null;
    const out = [];
    const walker = document.createTreeWalker(this.passageEl, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement.closest(EXCLUDE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent;
      for (const m of t.matchAll(WORD_RE)) {
        const word = m[0].replace(/['’-]+$/, '');
        range.setStart(node, m.index);
        range.setEnd(node, m.index + word.length);
        const rect = range.getClientRects()[0];
        if (!rect || !rect.width) continue;
        const lower = word.toLowerCase().replace(/’/g, "'");
        out.push({
          text: word, lower, norm: normWord(word),
          x: (rect.left - g.r.left) / g.scale, y: (rect.top - g.r.top) / g.scale,
          w: rect.width / g.scale, h: rect.height / g.scale,
        });
      }
    }
    return out;
  }

  words() {
    if (!this.index) this.index = this._buildIndex();
    return this.index || [];
  }

  wordAt(x, y) {
    let best = null, bestD = 14;
    for (const w of this.words()) {
      const dx = Math.max(w.x - x, 0, x - (w.x + w.w));
      const dy = Math.max(w.y - y, 0, y - (w.y + w.h));
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = w; }
    }
    return best;
  }

  count(norm) {
    let n = 0;
    for (const w of this.words()) if (w.norm === norm) n++;
    return n;
  }

  // The most repeated meaningful words, for one-tap spotting.
  repeats(limit = 8) {
    const counts = new Map();
    for (const w of this.words()) {
      if (isStopWord(w.lower, w.norm)) continue;
      const c = counts.get(w.norm) || { norm: w.norm, label: w.lower === 'god' || w.lower === 'lord' ? w.text : w.lower, n: 0 };
      c.n++;
      counts.set(w.norm, c);
    }
    const spotted = new Set((this.study?.spots || []).map(s => s.norm));
    return [...counts.values()].filter(c => c.n >= 3 && !spotted.has(c.norm))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, limit);
  }

  render() {
    const s = this.study;
    if (!s) { this.layer.innerHTML = ''; this.items = []; return; }
    const words = this.words();
    const g = this._geom();
    if (!g) return; // not on screen yet
    const items = [];

    const spots = new Map((s.spots || []).map(sp => [sp.norm, sp]));
    for (const w of words) {
      const sp = spots.get(w.norm);
      if (sp) items.push({ kind: 'box', x: w.x - 2.5, y: w.y - 1, w: w.w + 5, h: w.h + 2, color: sp.color });
      else if (s.connectives && CONNECTIVES.has(w.lower)) items.push({ kind: 'under', x: w.x, y: w.y + w.h - 3, w: w.w, h: 4, color: CONNECTIVE_COLOR });
    }

    const o = s.outline;
    if (o && o.showOnPage !== false && o.points && o.points.length) {
      const verses = walkVerses(this.passageEl, s.passage.reference);
      const starts = pointStarts(o.points, verses);
      const left = parseFloat(this.passageEl.style.marginLeft) || 70;
      const width = parseFloat(this.passageEl.style.width) || 560;
      const font = parseFloat(this.passageEl.style.fontSize) || 26;
      starts.forEach((vi, i) => {
        if (vi < 0) return;
        const v = verses[vi];
        const r = v.el.getBoundingClientRect();
        if (!r.height) return;
        const x = (r.left - g.r.left) / g.scale;
        const top = (r.top - g.r.top) / g.scale - font * 0.2;
        if (i > 0) {
          const headed = v.heading && !this.passageEl.classList.contains('no-headings');
          if (headed) { /* the heading already marks the break */ } else if (v.paraStart) items.push({ kind: 'line', x: left - 8, y: top - font * 0.45, w: width + 16, h: 0, color: BREAK_COLOR });
          else items.push({ kind: 'cut', x: x - 7, y: top, w: 0, h: font * 1.45, color: BREAK_COLOR });
        }
        items.push({ kind: 'badge', x: Math.max(4, left - 52), y: top + font * 0.1, w: 34, h: 34, n: i + 1, color: BREAK_COLOR });
      });
    }

    this.items = items;
    this.layer.innerHTML = items.map(it => {
      const pos = `left:${it.x.toFixed(1)}px;top:${it.y.toFixed(1)}px;width:${it.w.toFixed(1)}px;height:${it.h.toFixed(1)}px;--c:${it.color}`;
      if (it.kind === 'badge') return `<div class="mk-badge" data-n="${it.n}" style="${pos}"></div>`;
      return `<div class="mk-${it.kind}" style="${pos}"></div>`;
    }).join('');
  }
}
