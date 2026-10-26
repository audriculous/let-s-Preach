// PDF export of the marked-up page.
//
// Each A4 page is painted onto a canvas: highlights, then the words (copied from the live
// layout so they sit exactly where the ink was drawn), then pen strokes. Page breaks avoid
// cutting through a line of text. The canvases are packed into a small hand-written PDF,
// so there is no library to load and it works offline.

import { drawStroke, PAGE_W } from './ink.js';

const PAGE_H = Math.round(PAGE_W * 297 / 210); // A4 in logical px
const RES = 2;                                  // canvas px per logical px
const PAD_TOP = 56;                             // top margin on pages after the first
const PAD_BOTTOM = 56;
const HL_ALPHA = 0.4;

export async function exportPdf({ page, passageEl, strokes, pageH, title, marks = [], study = null }) {
  if (document.fonts) await document.fonts.ready;
  const box = page.getBoundingClientRect();
  const scale = box.width / PAGE_W;
  const words = collectWords(page, box, scale);
  const bars = collectBars(page, box, scale);

  let bottom = passageEl.offsetHeight;
  for (const w of words) bottom = Math.max(bottom, w.y + w.h);
  for (const s of strokes) bottom = Math.max(bottom, s.bbox[3]);
  bottom = Math.min(pageH, bottom + 40);

  // Work out where each page starts and stops.
  const slices = [];
  let top = 0;
  while (top < bottom) {
    const padTop = slices.length ? PAD_TOP : 0;
    let cut = top + PAGE_H - padTop - PAD_BOTTOM;
    if (cut < bottom) {
      let safe = cut;
      for (const w of words) if (w.y < safe && w.y + w.h > safe) safe = w.y - 6;
      if (safe > top + (cut - top) * 0.5) cut = safe;
    } else cut = bottom;
    slices.push({ top, cut, padTop });
    top = cut;
  }

  const outlinePages = study ? layoutOutline(study) : [];
  const total = slices.length + outlinePages.length;
  const footer = i => `Let’s Preach  ·  ${title}  ·  ${i + 1} of ${total}`;
  const jpegs = [];
  for (let i = 0; i < slices.length; i++) {
    jpegs.push(await renderPage(slices[i], words, bars, marks, strokes, footer(i)));
  }
  for (let i = 0; i < outlinePages.length; i++) {
    jpegs.push(await renderTextPage(outlinePages[i], footer(slices.length + i)));
  }
  return buildPdf(jpegs, PAGE_W * RES, PAGE_H * RES);
}

// ---------- collecting the layout ----------

function collectWords(root, box, scale) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const styleCache = new Map();
  let node;
  while ((node = walker.nextNode())) {
    const el = node.parentElement;
    if (!el || !node.textContent.trim()) continue;
    let st = styleCache.get(el);
    if (!st) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || el.getClientRects().length === 0) { styleCache.set(el, 'skip'); continue; }
      st = {
        font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
        color: cs.color,
        upper: cs.textTransform === 'uppercase',
        spacing: parseFloat(cs.letterSpacing) || 0,
      };
      styleCache.set(el, st);
    }
    if (st === 'skip') continue;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(node.textContent))) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getClientRects()[0];
      if (!r || !r.width) continue;
      out.push({
        text: st.upper ? m[0].toUpperCase() : m[0],
        x: (r.left - box.left) / scale,
        y: (r.top - box.top) / scale,
        w: r.width / scale,
        h: r.height / scale,
        ...st,
      });
    }
  }
  return out;
}

function collectBars(root, box, scale) {
  return [...root.querySelectorAll('.ref-dash')].map(el => {
    const r = el.getBoundingClientRect();
    return { x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, w: r.width / scale, h: r.height / scale, color: getComputedStyle(el).backgroundColor };
  });
}

// ---------- painting ----------

function renderPage({ top, cut, padTop }, words, bars, marks, strokes, footer) {
  const W = PAGE_W * RES, H = PAGE_H * RES;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Map logical page y to this sheet, clipped to the slice.
  const toSheet = c => {
    c.setTransform(RES, 0, 0, RES, 0, (padTop - top) * RES);
    c.beginPath();
    c.rect(0, top, PAGE_W, cut - top);
    c.clip();
    c.lineCap = 'round';
    c.lineJoin = 'round';
  };
  const inSlice = (y0, y1) => y1 >= top && y0 <= cut;

  // Highlights on their own layer, then laid down translucent like on screen.
  const hl = document.createElement('canvas');
  hl.width = W; hl.height = H;
  const hctx = hl.getContext('2d');
  toSheet(hctx);
  for (const s of strokes) if (s.tool === 'highlighter' && inSlice(s.bbox[1], s.bbox[3])) drawStroke(hctx, s);
  ctx.globalAlpha = HL_ALPHA;
  ctx.drawImage(hl, 0, 0);
  ctx.globalAlpha = 1;
  hl.width = hl.height = 0;

  ctx.save();
  toSheet(ctx);
  drawMarks(ctx, marks, inSlice);
  for (const b of bars) {
    if (!inSlice(b.y, b.y + b.h)) continue;
    ctx.fillStyle = b.color;
    roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
    ctx.fill();
  }
  ctx.textBaseline = 'alphabetic';
  for (const w of words) {
    if (!inSlice(w.y, w.y + w.h)) continue;
    ctx.font = w.font;
    ctx.fillStyle = w.color;
    const m = ctx.measureText(w.text);
    const desc = m.fontBoundingBoxDescent ?? w.h * 0.22;
    const base = w.y + w.h - desc;
    if (w.spacing) {
      let x = w.x;
      for (const ch of w.text) { ctx.fillText(ch, x, base); x += ctx.measureText(ch).width + w.spacing; }
    } else {
      ctx.fillText(w.text, w.x, base);
    }
  }
  for (const s of strokes) if (s.tool !== 'highlighter' && inSlice(s.bbox[1], s.bbox[3])) drawStroke(ctx, s);
  ctx.restore();

  // Footer
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.font = `600 12px Barlow, sans-serif`;
  ctx.fillStyle = '#8a8882';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(footer.toUpperCase(), 70, PAGE_H - 24);

  return toJpeg(canvas);
}

function toJpeg(canvas) {
  return new Promise(resolve => canvas.toBlob(b => {
    b.arrayBuffer().then(buf => { canvas.width = canvas.height = 0; resolve(new Uint8Array(buf)); });
  }, 'image/jpeg', 0.9));
}

// Spotted-word boxes, connective underlines and the numbered breakup.
function drawMarks(ctx, marks, inSlice) {
  for (const m of marks) {
    if (!inSlice(m.y, m.y + m.h)) continue;
    ctx.save();
    if (m.kind === 'box') {
      roundRect(ctx, m.x, m.y, m.w, m.h, 7);
      ctx.globalAlpha = 0.09; ctx.fillStyle = m.color; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = m.color; ctx.lineWidth = 2.5; ctx.stroke();
    } else if (m.kind === 'under') {
      ctx.fillStyle = m.color; roundRect(ctx, m.x, m.y, m.w, m.h, 2); ctx.fill();
    } else if (m.kind === 'cut') {
      ctx.fillStyle = m.color; roundRect(ctx, m.x - 2, m.y, 4, m.h, 2); ctx.fill();
    } else if (m.kind === 'line') {
      ctx.strokeStyle = m.color; ctx.lineWidth = 2.5; ctx.setLineDash([7, 5]);
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + m.w, m.y); ctx.stroke();
    } else if (m.kind === 'badge') {
      const r = m.w / 2;
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(m.x + r, m.y + r, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `italic 900 22px 'Barlow Condensed', sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(m.n), m.x + r, m.y + r + 1);
    }
    ctx.restore();
  }
}

// ---------- outline pages ----------

const T = {
  title: { font: `italic 900 52px 'Barlow Condensed', sans-serif`, color: '#1a1a1a', lh: 54, upper: true },
  eyebrow: { font: `600 15px Barlow, sans-serif`, color: '#4d7a66', lh: 24, upper: true, spacing: 3.5 },
  point: { font: `italic 800 30px 'Barlow Condensed', sans-serif`, color: '#1a1a1a', lh: 34, upper: true },
  body: { font: `400 20px Barlow, sans-serif`, color: '#1a1a1a', lh: 30 },
  muted: { font: `500 17px Barlow, sans-serif`, color: '#6b6a66', lh: 26 },
};
const TX = 90, TW = PAGE_W - 180, TOP = 90, BOTTOM = PAGE_H - 90;

function layoutOutline(study) {
  const o = study.outline;
  if (!o) return [];
  const hasContent = o.bigIdea || o.application || o.illustrations || (o.points || []).some(p => p.title || p.notes || p.verses);
  if (!hasContent) return [];
  const blocks = [];
  const add = (style, text, gap = 0, indent = 0) => { if (text && String(text).trim()) blocks.push({ style, text: String(text), gap, indent }); };
  add(T.eyebrow, [study.series, 'Sermon outline'].filter(Boolean).join('  ·  '));
  add(T.title, study.title, 4);
  add(T.muted, [study.passage.reference !== study.title ? study.passage.reference : '', study.passage.version].filter(Boolean).join(' '), 4);
  if (o.bigIdea) { add(T.eyebrow, 'Big idea', 30); add(T.body, o.bigIdea, 4); }
  (o.points || []).forEach((p, i) => {
    add(T.point, `${i + 1}. ${p.title || 'Point ' + (i + 1)}`, i === 0 ? 34 : 24);
    add(T.muted, p.verses, 2, 34);
    add(T.body, p.notes, 6, 34);
  });
  if (o.application) { add(T.eyebrow, 'Application', 34); add(T.body, o.application, 4); }
  if (o.illustrations) { add(T.eyebrow, 'Illustrations', 30); add(T.body, o.illustrations, 4); }

  // Wrap into lines, then into pages.
  const ctx = document.createElement('canvas').getContext('2d');
  const pages = [[]];
  let y = TOP;
  for (const b of blocks) {
    ctx.font = b.style.font;
    const lines = wrap(ctx, b.style.upper ? b.text.toUpperCase() : b.text, TW - b.indent, b.style.spacing || 0);
    y += b.gap;
    for (const line of lines) {
      if (y + b.style.lh > BOTTOM) { pages.push([]); y = TOP; }
      pages[pages.length - 1].push({ ...b, line, y });
      y += b.style.lh;
    }
  }
  return pages;
}

function wrap(ctx, text, width, spacing) {
  const out = [];
  const measure = s => ctx.measureText(s).width + spacing * s.length;
  for (const para of text.split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (line && measure(next) > width) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

function renderTextPage(lines, footer) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W * RES; canvas.height = PAGE_H * RES;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.textBaseline = 'top';
  for (const l of lines) {
    ctx.font = l.style.font;
    ctx.fillStyle = l.style.color;
    const x = TX + l.indent;
    if (l.style.spacing) {
      let cx = x;
      for (const ch of l.line) { ctx.fillText(ch, cx, l.y); cx += ctx.measureText(ch).width + l.style.spacing; }
    } else ctx.fillText(l.line, x, l.y);
  }
  ctx.fillStyle = '#e0a32e';
  roundRect(ctx, TX, 66, 46, 8, 4);
  ctx.fill();
  ctx.font = `600 12px Barlow, sans-serif`;
  ctx.fillStyle = '#8a8882';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(footer.toUpperCase(), 70, PAGE_H - 24);
  return toJpeg(canvas);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- minimal PDF writer (one JPEG per A4 page) ----------

function buildPdf(jpegs, imgW, imgH) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = data => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };

  const A4W = 595.28, A4H = 841.89;
  const n = jpegs.length;
  const pageIds = jpegs.map((_, i) => 3 + i * 3);

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pageIds.map(id => id + ' 0 R').join(' ')}] >>`));
  jpegs.forEach((jpg, i) => {
    const pid = pageIds[i], img = pid + 1, content = pid + 2;
    obj(pid, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4W} ${A4H}] /Resources << /XObject << /Im${i} ${img} 0 R >> >> /Contents ${content} 0 R >>`));
    obj(img, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
      push(jpg);
      push('\nendstream');
    });
    const draw = `q ${A4W} 0 0 ${A4H} 0 0 cm /Im${i} Do Q`;
    obj(content, () => push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
  });

  const total = 3 + n * 3;
  const xref = length;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(table);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
