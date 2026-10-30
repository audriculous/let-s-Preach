// Preaching roster from Google Sheets. The sheet is read as CSV (published to the web,
// or shared "anyone with the link"), the right columns are found by their headings,
// and the rows with your name tell the home screen what you are preaching next.

const CACHE = 'letspreach.roster';
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
    out.push({ date: date.toISOString().slice(0, 10), preacher: get('preacher'), passage, series: get('series'), title: get('title'), service: get('service') });
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
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString().slice(0, 10);
  return rows.filter(r => r.date >= t);
}

export function loadCached() {
  try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { return null; }
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
      const data = { fetchedAt: Date.now(), ...parsed };
      try { localStorage.setItem(CACHE, JSON.stringify(data)); } catch {}
      return data;
    } catch (e) { last = e; if (e.message.startsWith('Could not find')) throw e; }
  }
  if (last && last.message === 'not-public') throw new Error('Google returned a sign-in page. In Sheets, use File, Share, Publish to web, CSV, and paste that link.');
  throw new Error('Could not read the roster' + (workerUrl ? '' : '. Adding your Worker in Settings may help') + '.');
}
