// Preaching roster from Google Sheets. The sheet is read as CSV (published to the web,
// or shared "anyone with the link"), the right columns are found by their headings,
// and the rows with your name tell the home screen what you are preaching next.

const CACHE = 'letspreach.roster';
// A date as YYYY-MM-DD in local time (toISOString would use UTC and, in Australia, give the day before).
export const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Any Google Sheets link -> a CSV address.
export function csvUrl(link) {
  const u = String(link || '').trim();
  if (!u) return '';
  if (/output=csv|format=csv|tqx=out:csv/.test(u)) return u;
  let m = u.match(/docs\.google\.com\/spreadsheets\/d\/e\/([\w-]+)/);
  if (m) {
    const gid = (u.match(/[#&?]gid=(\d+)/) || [])[1];
    return `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=csv${gid ? '&gid=' + gid + '&single=true' : ''}`;
  }
  m = u.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (m) {
    const gid = (u.match(/[#&?]gid=(\d+)/) || [])[1];
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? '&gid=' + gid : ''}`;
  }
  return u;
}

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim()));
}

// Dates as Australians write them (day first), plus "Sun 2 Nov", "2 November 2026" and ISO.
export function parseDate(s, now = new Date()) {
  s = String(s || '').trim().toLowerCase();
  if (!s) return null;
  // Excel stores dates as a day count from 30 Dec 1899.
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 80000) { const d = new Date(1899, 11, 30); d.setDate(d.getDate() + Math.floor(+s)); return d; }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/);
  if (m) return withYear(+m[1], +m[2] - 1, m[3], now);
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?(?:,?\s+(\d{2,4}))?/);
  if (m && MONTHS.includes(m[2])) return withYear(+m[1], MONTHS.indexOf(m[2]), m[3], now);
  m = s.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{2,4}))?/);
  if (m && MONTHS.includes(m[1])) return withYear(+m[2], MONTHS.indexOf(m[1]), m[3], now);
  return null;
}

function withYear(d, mo, y, now) {
  if (!(mo >= 0 && mo <= 11 && d >= 1 && d <= 31)) return null;
  if (y) { y = +y; if (y < 100) y += 2000; return new Date(y, mo, d); }
  // No year: the nearest such date, not more than about six months back.
  let date = new Date(now.getFullYear(), mo, d);
  if (date - now < -182 * 864e5) date = new Date(now.getFullYear() + 1, mo, d);
  return date;
}

const COLS = {
  date: /^(date|sunday|week|day|when)/,
  preacher: /(preacher|speaker|preaching|minister|who)/,
  passage: /(passage|text|reading|bible|scripture|reference)/,
  series: /series/,
  title: /(title|topic|theme|sermon)/,
  service: /(service|time|congregation|venue|gathering)/,
};

// Turn the sheet into rows: { date, preacher, passage, series, title, service }.
export function readRoster(rows) {
  let h = -1, cols = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const found = {};
    rows[i].forEach((c, j) => {
      const l = c.toLowerCase();
      for (const [k, re] of Object.entries(COLS)) if (found[k] == null && re.test(l)) { found[k] = j; break; }
    });
    if (found.date != null && found.passage != null) { h = i; cols = found; break; }
  }
  if (!cols) return { rows: [], error: 'Could not find a Date column and a Passage column. Check the sheet has headings like "Date" and "Passage".' };
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const date = parseDate(r[cols.date]);
    const passage = (r[cols.passage] || '').trim();
    if (!date || !passage) continue;
    const get = k => (cols[k] != null ? (r[cols[k]] || '').trim() : '');
    out.push({ date: isoDay(date), preacher: get('preacher'), passage, series: get('series'), title: get('title'), service: get('service') });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { rows: out, hasPreacher: cols.preacher != null };
}

export function mine(rows, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return rows;
  const parts = n.split(/\s+/).filter(p => p.length > 1);
  return rows.filter(r => { const p = r.preacher.toLowerCase(); return p && parts.some(x => p.includes(x)); });
}

export function upcoming(rows, today = new Date()) {
  const t = isoDay(today);
  return rows.filter(r => r.date >= t);
}

export function loadCached() {
  try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { return null; }
}

export function saveRoster(data) { return save(data); }

function save(data) {
  try { localStorage.setItem(CACHE, JSON.stringify(data)); } catch {}
  return data;
}

// A roster file chosen from Files: Excel (.xlsx) or CSV. Every sheet in a workbook is
// tried until one has Date and Passage headings.
export async function importRosterFile(file) {
  const name = file.name || 'roster';
  let tables;
  if (/\.xlsx$/i.test(name) || file.type.includes('spreadsheetml')) tables = await readXlsx(await file.arrayBuffer());
  else if (/\.xls$/i.test(name)) throw new Error('That is an old .xls file. In Excel, save it as .xlsx or CSV and try again.');
  else tables = [parseCsv(await file.text())];
  let parsed = null;
  for (const t of tables) { parsed = readRoster(t); if (!parsed.error) break; }
  if (!parsed || parsed.error) throw new Error(parsed ? parsed.error : 'That file has no sheets.');
  return save({ fetchedAt: Date.now(), source: 'file', fileName: name, ...parsed });
}

// ---------- a small .xlsx reader (an .xlsx is a zip of XML files) ----------

async function unzip(buf) {
  const v = new DataView(buf), bytes = new Uint8Array(buf);
  let e = buf.byteLength - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('That does not look like an Excel file.');
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    files.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async name => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + v.getUint16(f.local + 26, true) + v.getUint16(f.local + 28, true);
    const raw = bytes.subarray(start, start + f.size);
    if (f.method === 0) return dec.decode(raw);
    const out = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(out).text();
  };
}

const xmlText = s => s.replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi, (_, c) => (
  { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[c.toLowerCase()] ?? String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : +c.slice(1))));

async function readXlsx(buf) {
  const read = await unzip(buf);
  const shared = [];
  const ss = await read('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push([...m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => xmlText(t[1])).join(''));
  }
  // Sheets in the order the workbook lists them.
  const wb = (await read('xl/workbook.xml')) || '';
  const rels = (await read('xl/_rels/workbook.xml.rels')) || '';
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/\bId="([^"]+)"/) || [])[1], t = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && t) target[id] = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
  }
  const paths = [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => target[(m[0].match(/r:id="([^"]+)"/) || [])[1]]).filter(Boolean);
  if (!paths.length) paths.push('xl/worksheets/sheet1.xml');
  const tables = [];
  for (const path of paths) {
    const xml = await read(path);
    if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], body = cm[2] || '';
        const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
        const col = ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : row.length;
        const type = (attrs.match(/\bt="(\w+)"/) || [])[1];
        const val = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let text = '';
        if (type === 's') text = shared[+val] || '';
        else if (type === 'inlineStr') text = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => xmlText(t[1])).join('');
        else if (val != null) text = xmlText(val);
        while (row.length < col) row.push('');
        row[col] = text.trim();
      }
      rows.push(row);
    }
    tables.push(rows);
  }
  return tables;
}

// Fetch the sheet: straight from Google if it allows it, otherwise through your Worker.
export async function fetchRoster(link, workerUrl) {
  const url = csvUrl(link);
  if (!url) throw new Error('Add your roster link in Settings.');
  const tries = [url];
  if (workerUrl) tries.push(workerUrl.replace(/\/+$/, '') + '/sheet?url=' + encodeURIComponent(url));
  let last;
  for (const u of tries) {
    try {
      const res = await fetch(u, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (/^\s*<!doctype html|<html/i.test(text)) throw new Error('not-public');
      const parsed = readRoster(parseCsv(text));
      if (parsed.error) throw new Error(parsed.error);
      return save({ fetchedAt: Date.now(), source: 'link', ...parsed });
    } catch (e) { last = e; if (e.message.startsWith('Could not find')) throw e; }
  }
  if (last && last.message === 'not-public') throw new Error('Google returned a sign-in page. In Sheets, use File, Share, Publish to web, CSV, and paste that link.');
  throw new Error('Could not read the roster' + (workerUrl ? '' : '. Adding your Worker in Settings may help') + '.');
}
