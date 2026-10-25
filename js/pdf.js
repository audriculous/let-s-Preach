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

export async function exportPdf({ page, passageEl, strokes, pageH, title }) {
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

  const jpegs = [];
  for (let i = 0; i < slices.length; i++) {
    jpegs.push(await renderPage(slices[i], words, bars, strokes, `Let’s Preach  ·  ${title}  ·  ${i + 1} of ${slices.length}`));
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

function renderPage({ top, cut, padTop }, words, bars, strokes, footer) {
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

  return new Promise(resolve => canvas.toBlob(b => {
    b.arrayBuffer().then(buf => { canvas.width = canvas.height = 0; resolve(new Uint8Array(buf)); });
  }, 'image/jpeg', 0.9));
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
