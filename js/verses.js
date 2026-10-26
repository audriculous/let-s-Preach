// Verse-level helpers: walking a passage verse by verse, normalising words so
// "law" and "laws" count as one, suggesting a breakup into sections, and
// word-level differences between two translations.

const SKIP = '.ref-version, .ref-heading, .ref-dash, .footnotes, .copyright';

export const WORD_RE = /\p{L}[\p{L}’'-]*/gu;

// Words that join ideas. Spotting them shows how an argument is built.
export const CONNECTIVES = new Set([
  'therefore', 'but', 'for', 'because', 'since', 'so', 'then', 'thus', 'yet', 'if',
  'although', 'though', 'unless', 'until', 'likewise', 'consequently', 'nevertheless',
  'however', 'hence', 'wherefore',
]);

// Small words that are never worth suggesting as a repeat.
const STOP = new Set(('the a an and or nor of to in into on at by with from as is are was were be been being am ' +
  'it its this that these those there here he him his she her they them their theirs you your yours ' +
  'we us our ours i me my mine who whom whose which what when where why how not no all any each every ' +
  'have has had do does did will shall would should can could may might must let also even than ' +
  'up out over under again very one own same such too only just about against among through ' +
  'himself herself themselves yourself yourselves ourselves myself itself whoever whatever ' +
  'said says say like now those upon unto thee thou thy thine ye hath doth').split(' '));
for (const c of CONNECTIVES) STOP.add(c);

export function isStopWord(lower, norm) {
  return STOP.has(lower) || STOP.has(norm) || lower.length < 3;
}

export function normWord(w) {
  let s = w.toLowerCase().replace(/’/g, "'").replace(/^['-]+|['-]+$/g, '');
  s = s.replace(/'s$/, '');
  if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 4 && /(ss|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  return s;
}

// First chapter (and verse) named in a reference such as "Romans 2:17-3:20" or "Psalm 23".
export function parseRef(ref) {
  const r = String(ref || '');
  const m = r.match(/(\d+)\s*:\s*(\d+)/);
  if (m) return { ch: +m[1], v: +m[2] };
  const n = r.match(/(\d+)\s*$/);
  return { ch: n ? +n[1] : 1, v: 1 };
}

// Walk a passage in reading order and return one entry per verse:
// { key, part, ch, v, text, el (the verse marker), heading, paraStart }.
export function walkVerses(root, reference) {
  const verses = [];
  let ch = parseRef(reference).ch;
  let part = 0, sawPartRef = false, heading = '', cur = null;
  const seen = new Set(); // blocks that already have text before the current marker
  const blockOf = el => (el && el.closest('p, li, h3, h4, div')) || root;

  const begin = (v, el) => {
    cur = { key: part + '|' + ch + ':' + v, part, ch, v, text: '', el, heading, paraStart: !seen.has(blockOf(el)) };
    heading = '';
    verses.push(cur);
  };

  const visit = node => {
    if (node.nodeType === 3) {
      const t = node.textContent;
      if (!t.trim()) { if (cur) cur.text += ' '; return; }
      seen.add(blockOf(node.parentElement));
      if (cur) cur.text += t;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    if (el.matches(SKIP)) return;
    if (el.matches('h4.part-ref')) {
      if (sawPartRef) part++;
      sawPartRef = true;
      ch = parseRef(el.textContent).ch;
      heading = '';
      return;
    }
    if (el.matches('h3, h4')) { heading = el.textContent.replace(/\s+/g, ' ').trim(); return; }
    if (el.matches('.chapternum')) { ch = parseInt(el.textContent, 10) || ch; begin(1, el); return; }
    if (el.matches('sup.versenum')) { const v = parseInt(el.textContent, 10); if (v) begin(v, el); return; }
    if (el.matches('sup')) return;
    el.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  for (const v of verses) v.text = v.text.replace(/\s+/g, ' ').trim();
  return verses;
}

// A detached copy of a passage, for walking versions that are not on screen.
export function passageContainer(p) {
  const div = document.createElement('div');
  div.innerHTML = (p.parts || []).map(part =>
    (p.parts.length > 1 && part.ref ? `<h4 class="part-ref">${esc(part.ref)}</h4>` : '') + part.html).join('');
  return div;
}

export function rangeLabel(a, b) {
  if (a.part !== b.part || a.ch !== b.ch) return `${a.ch}:${a.v}-${b.ch}:${b.v}`;
  return a.v === b.v ? `${a.ch}:${a.v}` : `${a.ch}:${a.v}-${b.v}`;
}

export function openingWords(text, n = 8) {
  const w = text.split(/\s+/).filter(Boolean);
  return w.slice(0, n).join(' ') + (w.length > n ? '…' : '');
}

// Where each point starts: an index into verses, or -1 if its verses do not match.
export function pointStarts(points, verses) {
  let ch = verses.length ? verses[0].ch : 1;
  return points.map(p => {
    const m = String(p.verses || '').match(/(?:(\d+)\s*:\s*)?(\d+)/);
    if (!m) return -1;
    if (m[1]) ch = +m[1];
    const v = +m[2];
    return verses.findIndex(x => x.ch === ch && x.v === v);
  });
}

const OPENERS = /^["“‘']?(therefore|but now|but|so then|so|now|then|for this reason|what then|what|thus|again|finally|likewise|after this|when|in the same way|because)\b/i;

// How natural a place each verse is to start a new section, and why.
export function seams(verses) {
  return verses.map((x, i) => {
    const why = [];
    let s = 0;
    if (i === 0) return { s: 0, why };
    if (x.heading) { s += 3; why.push('heading: ' + x.heading); }
    if (x.paraStart) { s += 1; why.push('new paragraph'); }
    const m = x.text.match(OPENERS);
    if (m) { s += x.paraStart ? 1 : 0.5; why.push('starts with “' + m[1].toLowerCase() + '”'); }
    if (x.v === 1) { s += 1; why.push('new chapter'); }
    return { s, why, opener: m ? m[1].toLowerCase() : '' };
  });
}

export function sectionsFromCuts(cuts, n) {
  const out = [];
  let from = 0;
  for (const c of [...[...new Set(cuts)].filter(c => c > 0 && c < n).sort((a, b) => a - b), n]) {
    if (c > from) out.push({ from, to: c - 1 });
    from = c;
  }
  return out;
}

// The best k-part split: cuts land on strong seams, close to evenly spaced.
function bestCuts(verses, k, S = seams(verses)) {
  const n = verses.length, span = n / k;
  const cuts = [];
  let last = 0;
  for (let j = 1; j < k; j++) {
    const ideal = j * span;
    let best = -1, bestScore = -Infinity;
    for (let i = last + 1; i < n - (k - 1 - j); i++) {
      const score = S[i].s - 2.2 * Math.abs(i - ideal) / span;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (bestScore < -1) best = Math.max(last + 1, Math.round(ideal));
    if (best <= last || best >= n) continue;
    cuts.push(best);
    last = best;
  }
  return cuts;
}

// Several different ways to break the passage up, to compare and play with.
export function breakupOptions(verses) {
  const n = verses.length;
  if (n < 2) return [];
  const S = seams(verses);
  const opts = [];
  const add = (label, why, cuts) => {
    cuts = [...new Set(cuts)].filter(c => c > 0 && c < n).sort((a, b) => a - b);
    if (!cuts.length) return;
    const key = cuts.join(',');
    if (opts.some(o => o.key === key)) return;
    opts.push({ label, why, cuts, key });
  };
  const idx = f => verses.map((_, i) => i).filter(i => i > 0 && f(i));
  const heads = idx(i => verses[i].heading);
  if (heads.length) add('Headings', 'Where the translators put section headings', heads);
  const turns = idx(i => S[i].opener && (verses[i].paraStart || /^(therefore|but now|so then|what then|for this reason|finally)$/.test(S[i].opener)));
  if (turns.length && turns.length <= 6) add('Turning words', 'Where a new move opens with "therefore", "but", "so" and similar', turns);
  const paras = idx(i => verses[i].paraStart);
  if (paras.length && paras.length <= 7) add('Paragraphs', 'At every paragraph break', paras);
  const chapters = idx(i => verses[i].v === 1);
  if (chapters.length) add('Chapters', 'At the chapter break', chapters);
  for (const k of [2, 3, 4]) if (n >= k * 2) add(k + ' points', `The ${k} most natural seams, roughly even in length`, bestCuts(verses, k, S));
  return opts;
}

// The default suggestion (kept for the "Suggest a breakup" button).
export function suggestBreakup(verses) {
  const n = verses.length;
  if (!n) return [];
  if (n < 4) return [{ from: 0, to: n - 1 }];
  const heads = verses.map((x, i) => (x.heading && i > 0 ? i : -1)).filter(i => i > 0);
  const cuts = heads.length >= 1 && heads.length <= 4 ? heads : bestCuts(verses, Math.max(2, Math.min(4, Math.round(n / 7))));
  return sectionsFromCuts(cuts, n);
}

// HTML of `other` with the words that differ from `base` wrapped in <mark>.
export function diffWords(base, other) {
  const core = w => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const a = base.split(/\s+/).filter(Boolean).map(core);
  const parts = other.split(/(\s+)/);
  const words = [];
  parts.forEach((p, i) => { if (p.trim()) words.push(i); });
  const b = words.map(i => core(parts[i]));
  // Longest common subsequence keeps the words both versions share, in order.
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const same = new Set();
  for (let i = 0, j = 0; i < m && j < n;) {
    if (a[i] === b[j]) { same.add(j); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const changed = new Set(words.filter((_, j) => !same.has(j) && b[j]));
  return parts.map((p, i) => (changed.has(i) ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
