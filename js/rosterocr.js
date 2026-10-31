// Read a preaching roster from a screenshot (of a Google Doc, a Sheet, an email or a
// printed page), on the device, with Tesseract. The words are put back into rows by
// where they sit, the columns found from the headings, and each row's date and passage
// pulled out. Nothing is saved until you have checked the rows.

import { parseDate, isoDay } from './roster.js';

let workerPromise = null;
function ocr(onProgress) {
  const base = new URL('../vendor/tesseract/', import.meta.url).href;
  workerPromise = workerPromise || import('../vendor/tesseract/tesseract.esm.min.js').then(m => (m.default || m).createWorker('eng', 1, {
    workerPath: base + 'worker.min.js',
    corePath: base + 'core/',
    langPath: base + 'lang',
    workerBlobURL: false,
    logger: l => progressFn && progressFn(l),
  }));
  progressFn = onProgress;
  return workerPromise;
}
let progressFn = null;

// ---------- Bible references ----------

const BOOKS = [
  'Genesis|Gen|Ge|Gn', 'Exodus|Exod|Exo|Ex', 'Leviticus|Lev|Lv', 'Numbers|Num|Nu|Nm', 'Deuteronomy|Deut|Dt',
  'Joshua|Josh|Jos', 'Judges|Judg|Jdg', 'Ruth|Ru', '1 Samuel|1 Sam|1 Sa', '2 Samuel|2 Sam|2 Sa', '1 Kings|1 Kgs|1 Ki',
  '2 Kings|2 Kgs|2 Ki', '1 Chronicles|1 Chron|1 Chr', '2 Chronicles|2 Chron|2 Chr', 'Ezra|Ezr', 'Nehemiah|Neh',
  'Esther|Esth|Est', 'Job', 'Psalms|Psalm|Pss|Ps', 'Proverbs|Prov|Pr', 'Ecclesiastes|Eccles|Eccl|Ecc',
  'Song of Songs|Song of Solomon|Song', 'Isaiah|Isa|Is', 'Jeremiah|Jer', 'Lamentations|Lam', 'Ezekiel|Ezek|Eze',
  'Daniel|Dan|Dn', 'Hosea|Hos', 'Joel', 'Amos', 'Obadiah|Obad|Ob', 'Jonah|Jon', 'Micah|Mic', 'Nahum|Nah',
  'Habakkuk|Hab', 'Zephaniah|Zeph', 'Haggai|Hag', 'Zechariah|Zech', 'Malachi|Mal',
  'Matthew|Matt|Mt', 'Mark|Mk', 'Luke|Lk', 'John|Jn', 'Acts', 'Romans|Rom', '1 Corinthians|1 Cor', '2 Corinthians|2 Cor',
  'Galatians|Gal', 'Ephesians|Eph', 'Philippians|Phil', 'Colossians|Col', '1 Thessalonians|1 Thess|1 Th',
  '2 Thessalonians|2 Thess|2 Th', '1 Timothy|1 Tim', '2 Timothy|2 Tim', 'Titus|Tit', 'Philemon|Phlm|Philem',
  'Hebrews|Heb', 'James|Jas', '1 Peter|1 Pet|1 Pe', '2 Peter|2 Pet|2 Pe', '1 John|1 Jn', '2 John|2 Jn', '3 John|3 Jn',
  'Jude', 'Revelation|Rev',
];
// "1 Cor", "1Cor", "I Cor" and "First Cor" are all the same book.
const bookPat = BOOKS.map(b => b.split('|').map(n => n.replace(/^([123]) /, (_, d) => `(?:${d}|${'I'.repeat(+d)}|${['First', 'Second', 'Third'][d - 1]})\\s*`)).join('|')).join('|');
const NUM = '\\d{1,3}(?:\\s*[:.]\\s*\\d{1,3}[a-c]?)?';
const RANGE = `${NUM}(?:\\s*[-–—~]\\s*${NUM})?`;
const REF_RE = new RegExp(`\\b(?:${bookPat})\\.?\\s*${RANGE}(?:\\s*[,;]\\s*${RANGE})*`, 'i');
// A book on its own ("Ruth", "Jude"), for whole-book sermons.
const BOOK_ONLY_RE = new RegExp(`^(?:${bookPat})$`, 'i');

// OCR slips inside references: "Romans 2.17-3.8", "Romans 2:l7", "Romans 2 : 17 — 3 : 8".
function cleanRef(s) {
  return s
    .replace(/(\d)[lI|](?=\d|\b)/g, '$11').replace(/\b[lI|](\d)/g, '1$1').replace(/(\s)[lI|](?=\s*[:.]\s*\d)/g, '$11').replace(/(\d)[oO](?=\d)/g, '$10')
    .replace(/(\d)\s*[.;]\s*(\d)/g, '$1:$2').replace(/(\d)\s*:\s*(\d)/g, '$1:$2')
    .replace(/\s*[–—~]\s*/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}

export function findRef(text) {
  const t = cleanRef(text);
  const m = t.match(REF_RE);
  if (m) return m[0].replace(/\.(?=\s)/, '').replace(/,\s*$/, '');
  return BOOK_ONLY_RE.test(t.trim()) ? t.trim() : '';
}

// ---------- dates ----------

const DATE_RE = /\b(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s*)?(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{2,4})?|\d{1,2}\s*[\/.-]\s*\d{1,2}(?:\s*[\/.-]\s*\d{2,4})?)\b/i;

const DATE_G = new RegExp(DATE_RE.source, 'gi');
const REF_G = new RegExp(REF_RE.source, 'gi');

function findDate(text) {
  // Take Bible references out first, so "Romans 2:17-3:8" is not read as 17 March.
  const t = text.replace(REF_G, ' ').replace(/(\d)[lI|]/g, '$11').replace(/[lI|](\d)/g, '1$1').replace(/(\d)[oO]/g, '$10').replace(/[oO](\d)/g, '0$1');
  for (const m of t.matchAll(DATE_G)) {
    if (/^\s*[ap]\.?m\b/i.test(t.slice(m.index + m[0].length))) continue; // 10.30am is a time
    const d = parseDate(m[0].replace(/\s+/g, ' ').replace(/\s*([\/.-])\s*/g, '$1'));
    if (d && !isNaN(d)) return { iso: isoDay(d), text: m[0] };
  }
  return null;
}

// ---------- rows from word positions ----------

const HEAD = {
  date: /^(date|sunday|week|day|when)/i,
  preacher: /^(preacher|speaker|preaching|minister|who|leader)/i,
  passage: /^(passage|text|reading|readings|bible|scripture|reference|ref)/i,
  series: /^series/i,
  title: /^(title|topic|theme|sermon)/i,
  service: /^(service|time|congregation|venue|gathering)/i,
};

function linesOf(words) {
  const ws = words.filter(w => w.text.trim()).map(w => ({ ...w, yc: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 }))
    .sort((a, b) => a.yc - b.yc);
  const hs = ws.map(w => w.h).sort((a, b) => a - b);
  const mh = hs[Math.floor(hs.length / 2)] || 12;
  const lines = [];
  for (const w of ws) {
    const line = lines.find(l => Math.abs(l.yc - w.yc) < mh * 0.55);
    if (line) { line.words.push(w); line.yc = (line.yc * (line.words.length - 1) + w.yc) / line.words.length; }
    else lines.push({ yc: w.yc, words: [w] });
  }
  for (const l of lines) l.words.sort((a, b) => a.x0 - b.x0);
  return { lines: lines.sort((a, b) => a.yc - b.yc), mh };
}

const lineText = ws => ws.map(w => w.text).join(' ');

// Turn recognised words into roster rows: { date, passage, preacher, series, title, service }.
export function rowsFromWords(words) {
  const { lines } = linesOf(words);
  // The heading row: the line with the most heading words, needing at least a date or a passage heading.
  let head = null;
  for (const l of lines.slice(0, 40)) {
    // Words close together are one heading ("Sermon title"); a wide gap starts the next column.
    const groups = [];
    for (const w of l.words) {
      const g = groups[groups.length - 1];
      if (g && w.x0 - g.x1 < (w.y1 - w.y0) * 1.2) { g.words.push(w); g.x1 = w.x1; }
      else groups.push({ x0: w.x0, x1: w.x1, words: [w] });
    }
    const cols = [];
    for (const g of groups) {
      let key = 'other';
      for (const w of g.words) {
        const t = w.text.replace(/[^a-z]/gi, '');
        const k = Object.keys(HEAD).find(k => HEAD[k].test(t) && !cols.some(c => c.key === k));
        if (k) { key = k; break; }
      }
      cols.push({ key, x0: g.x0 });
    }
    const known = cols.filter(c => c.key !== 'other');
    if (known.length >= 2 && known.length * 2 >= cols.length && (known.some(c => c.key === 'date') || known.some(c => c.key === 'passage')) &&
      (!head || known.length > head.cols.filter(c => c.key !== 'other').length)) head = { line: l, cols };
  }
  const cols = head ? head.cols.sort((a, b) => a.x0 - b.x0) : null;
  const colOf = w => {
    if (!cols) return null;
    const xc = (w.x0 + w.x1) / 2;
    let c = cols[0];
    for (const col of cols) if (col.x0 <= xc + 8) c = col;
    return c.key;
  };

  const body = head ? lines.slice(lines.indexOf(head.line) + 1) : lines;
  const rows = [];
  let cur = null;
  for (const l of body) {
    const dateWords = cols ? l.words.filter(w => colOf(w) === 'date') : l.words;
    const date = findDate(lineText(dateWords));
    if (date) { cur = { date: date.iso, dateText: date.text, words: [...l.words] }; rows.push(cur); }
    else if (cur) cur.words.push(...l.words); // a cell that wraps onto a second line
  }

  return rows.map(r => {
    const field = k => lineText(r.words.filter(w => colOf(w) === k)).trim();
    const all = lineText(r.words);
    let passage = findRef(cols && cols.some(c => c.key === 'passage') ? field('passage') : all) || findRef(all);
    const out = { date: r.date, passage, preacher: '', series: '', title: '', service: '' };
    if (cols) {
      for (const k of ['preacher', 'series', 'title', 'service']) out[k] = field(k);
    } else {
      // No headings: whatever is left once the date and passage are taken out.
      let rest = all.replace(r.dateText, ' ');
      const raw = REF_RE.exec(cleanRef(rest));
      rest = cleanRef(rest).replace(raw ? raw[0] : '\u0000', ' ');
      out.preacher = rest.replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').trim();
    }
    out.unsure = !passage;
    return out;
  });
}

function wordsFrom(data) {
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
    if (w.confidence < 15 && !/\d/.test(w.text)) continue;
    out.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
  }
  return out;
}

// Get the image ready: enlarge small screenshots, turn it black on white (inverting a
// dark-mode screenshot), and rub out table borders, which otherwise ruin the reading.
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const scale = bmp.width < 1600 ? Math.min(3, 2000 / bmp.width) : 1;
  const c = document.createElement('canvas');
  const W = c.width = Math.round(bmp.width * scale), H = c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close && bmp.close();
  const im = ctx.getImageData(0, 0, W, H), d = im.data;
  const lum = new Uint8Array(W * H);
  let sum = 0;
  for (let i = 0; i < W * H; i++) { lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += lum[i]; }
  const dark = sum / (W * H) < 110;
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) ink[i] = dark ? lum[i] > 120 : lum[i] < 165;
  // Any straight run of ink longer than a letter could be is a border or a rule.
  const L = Math.max(90, Math.round(Math.min(W, H) * 0.05));
  const kill = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let s = -1;
    for (let x = 0; x <= W; x++) {
      const on = x < W && ink[y * W + x];
      if (on && s < 0) s = x;
      if (!on && s >= 0) { if (x - s >= L) kill.fill(1, y * W + s, y * W + x); s = -1; }
    }
  }
  for (let x = 0; x < W; x++) {
    let s = -1;
    for (let y = 0; y <= H; y++) {
      const on = y < H && ink[y * W + x];
      if (on && s < 0) s = y;
      if (!on && s >= 0) { if (y - s >= L) for (let k = s; k < y; k++) kill[k * W + x] = 1; s = -1; }
    }
  }
  for (let i = 0; i < W * H; i++) { const v = ink[i] && !kill[i] ? 0 : 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  ctx.putImageData(im, 0, 0);
  return c;
}

// Read one or more screenshots. onProgress(fraction, label).
export async function readScreenshots(files, onProgress = () => {}) {
  const rows = [];
  for (let i = 0; i < files.length; i++) {
    const part = f => onProgress((i + f) / files.length, files.length > 1 ? `Reading screenshot ${i + 1} of ${files.length}` : 'Reading the screenshot');
    part(0);
    const worker = await ocr(l => { if (l.status === 'recognizing text') part(l.progress); });
    // Sparse text: table cells are read as separate pieces and put back in rows by position.
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const img = await prepare(files[i]);
    const { data } = await worker.recognize(img, {}, { blocks: true });
    rows.push(...rowsFromWords(wordsFrom(data)));
  }
  // The same row in two overlapping screenshots counts once.
  const seen = new Set();
  return rows.filter(r => { const k = r.date + '|' + r.passage.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date));
}
