// Marks drawn under the passage text: boxes around spotted words, underlines on
// connectives, and the numbered breakup of the passage into sermon points.
// Everything is kept in logical page coordinates so the PDF can draw it too.

import { PAGE_W } from './ink.js';
import { WORD_RE, CONNECTIVES, normWord, isStopWord, walkVerses, pointStarts } from './verses.js';

export const SPOT_COLORS = ['#2f5d8a', '#c62828', '#2e7d32', '#6a1b9a', '#e65100', '#00838f', '#ad1457', '#5d4037'];
export const CONNECTIVE_COLOR = '#b07a12';
export const BREAK_COLOR = '#e0a32e';
// One colour per sermon point, shared by the page, the outline and the PDF.
export const SECTION_COLORS = ['#e0a32e', '#4d7a66', '#2f5d8a', '#b5523b', '#7b5ea7', '#3f8c8c'];
const DARK_TEXT = new Set(['#e0a32e']);

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

  // The verse a tap on the page falls in (by reading order), as its key.
  verseAt(x, y) {
    const g = this._geom();
    if (!g || !this.study) return null;
    const verses = walkVerses(this.passageEl, this.study.passage.reference);
    const lh = (parseFloat(this.passageEl.style.fontSize) || 26) * (parseFloat(this.passageEl.style.lineHeight) || 2);
    let best = null;
    for (const v of verses) {
      const r = v.el.getBoundingClientRect();
      if (!r.height) continue;
      const mx = (r.left - g.r.left) / g.scale, my = (r.top + r.height / 2 - g.r.top) / g.scale;
      const earlierLine = my < y - lh / 2;
      const sameLine = Math.abs(my - y) <= lh / 2;
      if (earlierLine || (sameLine && mx <= x + 12)) best = v.key;
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
      const font = parseFloat(this.passageEl.style.fontSize) || 26;
      const lastWord = words[words.length - 1];
      const textEnd = lastWord ? lastWord.y + lastWord.h + font * 0.3 : 0;
      const tops = starts.map(vi => {
        if (vi < 0) return null;
        const r = verses[vi].el.getBoundingClientRect();
        return r.height ? { vi, x: (r.left - g.r.left) / g.scale, y: (r.top - g.r.top) / g.scale - font * 0.2 } : null;
      });
      // Sections run in passage order, each down to where the next one starts.
      const order = tops.map((t, i) => (t ? i : -1)).filter(i => i >= 0).sort((a, b) => tops[a].vi - tops[b].vi);
      const bx = Math.max(4, left - 52);
      order.forEach((i, k) => {
        const t = tops[i], v = verses[t.vi];
        const color = SECTION_COLORS[i % SECTION_COLORS.length];
        const next = order[k + 1] != null ? tops[order[k + 1]].y - font * 0.35 : textEnd;
        if (next - t.y > 40) items.push({ kind: 'band', x: bx + 15, y: t.y + 40, w: 4, h: next - t.y - 44, color });
        if (k > 0 && !v.paraStart) items.push({ kind: 'cut', x: t.x - 7, y: t.y, w: 0, h: font * 1.45, color });
        items.push({ kind: 'badge', x: bx, y: t.y + font * 0.1, w: 34, h: 34, n: i + 1, color, light: !DARK_TEXT.has(color) });
        const title = (o.points[i].title || '').trim();
        if (title && o.titlesOnPage !== false) items.push(titleLabel(title, t, v, { g, left, font, color, light: !DARK_TEXT.has(color), passageEl: this.passageEl, words }));
      });
    }

    this.items = items;
    this.layer.innerHTML = items.map(it => {
      const pos = `left:${it.x.toFixed(1)}px;top:${it.y.toFixed(1)}px;width:${it.w.toFixed(1)}px;height:${it.h.toFixed(1)}px;--c:${it.color}`;
      if (it.kind === 'badge') return `<div class="mk-badge${it.light ? ' light' : ''}" data-n="${it.n}" style="${pos}"></div>`;
      if (it.kind === 'label') return `<div class="mk-label${it.light ? ' light' : ''}" data-t="${attr(it.text)}" style="${pos};font-size:${it.fs.toFixed(1)}px"></div>`;
      return `<div class="mk-${it.kind}" style="${pos}"></div>`;
    }).join('');
  }
}

// ---------- point titles on the page ----------

const LABEL_FONT = (fs) => `italic 800 ${fs}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
let measureCtx = null;
function labelWidth(text, fs) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = LABEL_FONT(fs);
  return measureCtx.measureText(text.toUpperCase()).width + fs * 0.06 * text.length;
}

// A small pill with the point's title, in the gap above the line where the point starts
// (or beside the translators' heading, when the point starts right under one). It is
// drawn over the page, so the Bible text never moves.
function titleLabel(text, t, v, { g, left, font, color, light, passageEl, words }) {
  const label = text.length > 60 ? text.slice(0, 58) + '…' : text;
  const size = h => { const fs = h * 0.68; return { h, fs, w: labelWidth(label, fs) + fs * 1.3 }; };
  const block = v.el.closest('p, div');
  const head = block && block.previousElementSibling;
  if (v.heading && head && head.matches('h3, h4') && !passageEl.classList.contains('no-headings')) {
    const r = head.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(head);
    const tr = range.getBoundingClientRect();
    const { h, fs, w } = size(22);
    const x = (tr.right - g.r.left) / g.scale + 16;
    const y = (r.top + r.height / 2 - g.r.top) / g.scale - h / 2;
    return { kind: 'label', x, y, w, h, fs, text: label, color, light };
  }
  // Measure the real gap between this line and the one above it.
  const mr = v.el.getBoundingClientRect();
  const mid = (mr.top + mr.height / 2 - g.r.top) / g.scale;
  const line = words.filter(w => Math.abs(w.y + w.h / 2 - mid) < font * 0.6);
  const lineTop = line.length ? Math.min(...line.map(w => w.y)) : t.y;
  const lineBottom = line.length ? Math.max(...line.map(w => w.y + w.h)) : t.y + font * 1.2;
  const above = words.filter(w => w.y + w.h <= lineTop + 1);
  const prevBottom = above.length ? Math.max(...above.map(w => w.y + w.h)) : lineTop - 40;
  const gap = lineTop - prevBottom;
  if (gap >= 15) {
    const { h, fs, w } = size(Math.min(24, gap - 3));
    return { kind: 'label', x: v.paraStart ? left : t.x, y: prevBottom + (gap - h) / 2, w, h, fs, text: label, color, light };
  }
  // No room between the lines: sit in the margin beside the line where the point starts.
  const width = parseFloat(passageEl.style.width) || 560;
  const { h, fs, w } = size(20);
  return { kind: 'label', x: left + width + 14, y: (lineTop + lineBottom) / 2 - h / 2, w, h, fs, text: label, color, light };
}

function attr(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { LABEL_FONT };
