// Word study: tap an English word in the passage and see the Greek or Hebrew word
// behind it, with its grammar here, a short lexicon entry, and how often it is used.
// The data comes from STEP Bible (Tyndale House, CC BY 4.0) and is bundled with the
// app, one file per book plus the lexicon in chunks, so it works offline once loaded.

import { walkVerses, normWord, esc, bookOf } from './verses.js';

const DATA = new URL('../data/words/', import.meta.url).href;
const cache = new Map();

function load(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(DATA + path).then(r => {
      if (!r.ok) throw new Error('missing');
      return r.json();
    }).catch(err => { cache.delete(path); throw err; }));
  }
  return cache.get(path);
}
export const loadBook = code => load(`book/${code}.json`);
const chunkOf = strong => strong.slice(0, 2);

export async function lookup(strong) {
  const lex = await load(`lex/${chunkOf(strong)}.json`);
  return lex[strong] || lex[strong.slice(0, 5)] || null;
}

// The words of one verse: [{ word, tr, gloss, strong, morph }].
export async function verseWords(code, ch, v) {
  const book = await loadBook(code);
  return (book[ch + '.' + v] || []).map(([word, tr, gloss, strong, morph]) => ({ word, tr, gloss, strong, morph }));
}

// ---------- matching an English word to the original ----------

const stem = w => {
  let s = normWord(w).replace(/[^a-z]/g, '');
  for (const suf of ['ness', 'ing', 'eth', 'est', 'ed', 'ly', 'es', 'er']) {
    if (s.length > suf.length + 3 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  return s;
};
const tokens = text => String(text || '').toLowerCase().replace(/<[^>]+>/g, ' ').match(/[a-z]+/g) || [];

// Irregular forms and common translation pairs that a gloss will not share letters with.
const ALSO = {
  god: ['lord'], lord: ['god', 'yahweh', 'master'], said: ['say', 'speak'], says: ['say'], went: ['go'], came: ['come'],
  gave: ['give'], given: ['give'], taught: ['teach'], thought: ['think'], brought: ['bring'], saw: ['see'], seen: ['see'],
  knew: ['know'], known: ['know'], spoke: ['speak'], spoken: ['speak'], wrote: ['write'], written: ['write'],
  people: ['person', 'man'], men: ['man'], women: ['woman'], children: ['child'], brothers: ['brother'],
  sisters: ['brother'], kept: ['keep'], led: ['lead'], fled: ['flee'], ate: ['eat'], born: ['bear', 'beget'],
  brag: ['boast'], boast: ['brag'], righteous: ['just'], righteousness: ['justice'], sin: ['sinful'],
};

// Pick the original word a tapped English word most likely translates. position is
// where the tapped word sits in the verse (0 to 1), used to break ties.
export function bestMatch(words, english, position = 0.5, lexGloss = {}) {
  const t = stem(english);
  const alts = new Set([t, ...(ALSO[english.toLowerCase()] || []).map(stem)]);
  let best = -1, bestScore = 0;
  words.forEach((w, i) => {
    let score = 0;
    const gl = tokens(w.gloss).map(stem);
    const lx = tokens(lexGloss[w.strong]).map(stem);
    for (const g of gl) {
      if (alts.has(g)) score = Math.max(score, 10);
      else if (g.length >= 4 && t.length >= 4 && (g.startsWith(t.slice(0, 5)) || t.startsWith(g.slice(0, 5)))) score = Math.max(score, 6);
    }
    for (const g of lx) {
      if (alts.has(g)) score = Math.max(score, 5);
    }
    if (!score) return;
    score -= Math.abs(i / Math.max(1, words.length - 1) - position) * 3;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

// ---------- grammar codes in plain words ----------

const G_CASE = { N: 'nominative', G: 'genitive', D: 'dative', A: 'accusative', V: 'vocative' };
const NUM = { S: 'singular', P: 'plural' };
const G_GEN = { M: 'masculine', F: 'feminine', N: 'neuter' };
const G_POS = {
  N: 'noun', A: 'adjective', T: 'article', V: 'verb', P: 'pronoun', R: 'relative pronoun', C: 'reciprocal pronoun',
  D: 'demonstrative pronoun', K: 'correlative pronoun', I: 'interrogative pronoun', X: 'indefinite pronoun',
  Q: 'correlative pronoun', F: 'reflexive pronoun', S: 'possessive pronoun', ADV: 'adverb', CONJ: 'conjunction',
  COND: 'conditional particle', PRT: 'particle', PREP: 'preposition', INJ: 'interjection', ARAM: 'Aramaic word', HEB: 'Hebrew word',
};
const G_TENSE = { P: 'present', I: 'imperfect', F: 'future', A: 'aorist', R: 'perfect', L: 'pluperfect' };
const G_VOICE = { A: 'active', M: 'middle', P: 'passive', E: 'middle or passive', D: 'middle', O: 'passive', N: 'middle or passive' };
const G_MOOD = { I: 'indicative', S: 'subjunctive', O: 'optative', M: 'imperative', N: 'infinitive', P: 'participle', R: 'imperative participle' };
const PERSON = { 1: '1st person', 2: '2nd person', 3: '3rd person' };

function greek(code) {
  const parts = code.split('-');
  const pos = parts[0];
  if (pos === 'V') {
    const m = (parts[1] || '').match(/^(2?)([PIFARL])([AMPEDON])([ISOMNPR])$/);
    if (!m) return 'verb';
    const out = ['verb', (m[1] ? 'second ' : '') + G_TENSE[m[2]], G_VOICE[m[3]], G_MOOD[m[4]]];
    const rest = parts[2] || '';
    const pn = rest.match(/^([123])([SP])$/);
    const cng = rest.match(/^([NGDAV])([SP])([MFN])$/);
    if (pn) out.push(PERSON[pn[1]], NUM[pn[2]]);
    else if (cng) out.push(G_CASE[cng[1]], NUM[cng[2]], G_GEN[cng[3]]);
    return out.join(', ');
  }
  const out = [G_POS[pos] || pos.toLowerCase()];
  if (parts[1] === 'PRI') out.push('proper name');
  else if (parts[1] === 'NUI') out.push('number');
  else if (parts[1]) {
    const m = parts[1].match(/^([123])?([NGDAV])([SP])([MFN])?$/);
    if (m) out.push(...[PERSON[m[1]], G_CASE[m[2]], NUM[m[3]], G_GEN[m[4]]].filter(Boolean));
  }
  const EXTRA = { C: 'comparative', S: 'superlative', P: 'name of a person', L: 'name of a place', PG: 'name of a people', LG: 'name of a people', T: 'title' };
  for (const x of parts.slice(2)) if (EXTRA[x]) out.push(EXTRA[x]);
  return out.join(', ');
}

const H_STEM = {
  q: 'Qal', N: 'Niphal', p: 'Piel', P: 'Pual', h: 'Hiphil', H: 'Hophal', t: 'Hithpael', o: 'Polel', O: 'Polal',
  r: 'Hithpolel', m: 'Poel', M: 'Poal', k: 'Palel', K: 'Pulal', Q: 'Qal passive', l: 'Pilpel', L: 'Polpal',
  f: 'Hithpalpel', D: 'Nithpael', j: 'Pealal', i: 'Pilel', u: 'Hothpaal', c: 'Tiphil', v: 'Hishtaphel',
  w: 'Nithpalel', y: 'Nithpoel', z: 'Hithpoel',
};
const A_STEM = {
  q: 'Peal', Q: 'Peil', u: 'Hithpeel', p: 'Pael', P: 'Ithpaal', M: 'Hithpaal', a: 'Aphel', h: 'Haphel', s: 'Saphel',
  e: 'Shaphel', H: 'Hophal', i: 'Ithpeel', t: 'Hishtaphel', v: 'Ishtaphel', w: 'Hithaphel', o: 'Polel', z: 'Ithpoel',
  r: 'Hithpolel', f: 'Hithpalpel', b: 'Hephal', c: 'Tiphel', m: 'Poel', l: 'Palpel', L: 'Ithpalpel', O: 'Ithpolel', G: 'Ittaphal',
};
const H_CONJ = {
  p: 'perfect', q: 'sequential perfect (weqatal)', i: 'imperfect', w: 'sequential imperfect (wayyiqtol)', h: 'cohortative',
  j: 'jussive', v: 'imperative', r: 'participle', s: 'passive participle', a: 'infinitive absolute', c: 'infinitive construct',
};
const H_GEN = { m: 'masculine', f: 'feminine', c: 'common', b: 'masculine or feminine' };
const H_NUM = { s: 'singular', p: 'plural', d: 'dual' };
const H_STATE = { a: '', c: 'construct', d: 'determined' };
const H_POS = { A: 'adjective', C: 'conjunction', D: 'adverb', N: 'noun', P: 'pronoun', R: 'preposition', S: 'suffix', T: 'particle', V: 'verb' };
const H_TYPE = {
  N: { c: '', g: 'gentilic', p: 'proper name', t: 'title' },
  A: { a: '', c: 'cardinal number', g: 'gentilic', o: 'ordinal number' },
  P: { d: 'demonstrative', f: 'indefinite', i: 'interrogative', p: 'personal', r: 'relative' },
  T: { a: 'affirmation', d: 'definite article', e: 'exhortation', i: 'interrogative', j: 'interjection', m: 'demonstrative', n: 'negative', o: 'object marker', r: 'relative' },
};

function hebrew(code) {
  const aram = code[0] === 'A';
  const c = code.slice(1);
  const pos = c[0];
  if (pos === 'V') {
    const stemName = (aram ? A_STEM : H_STEM)[c[1]] || '';
    const out = ['verb', stemName, H_CONJ[c[2]] || ''];
    const rest = c.slice(3);
    if (/^[rs]$/.test(c[2])) out.push(H_GEN[rest[0]], H_NUM[rest[1]], H_STATE[rest[2]]);
    else out.push(PERSON[rest[0]], H_GEN[rest[1]], H_NUM[rest[2]]);
    return out.filter(Boolean).join(', ') + (aram ? ' (Aramaic)' : '');
  }
  const out = [H_POS[pos] || 'word'];
  const types = H_TYPE[pos];
  let rest = c.slice(1);
  if (types && types[rest[0]] !== undefined) { if (types[rest[0]]) out.push(types[rest[0]]); rest = rest.slice(1); }
  if (pos === 'N' && out.includes('proper name')) rest = rest.replace(/^[mflt]/, '');
  if (pos === 'P') out.push(PERSON[rest[0]], H_GEN[rest[1]], H_NUM[rest[2]]);
  else if (rest) out.push(H_GEN[rest[0]], H_NUM[rest[1]], H_STATE[rest[2]]);
  return out.filter(Boolean).join(', ') + (aram ? ' (Aramaic)' : '');
}

export function grammar(code) {
  if (!code) return '';
  try { return /^[HA][A-Z]/.test(code) ? hebrew(code) : greek(code); } catch { return code; }
}

// ---------- the card ----------

export function initWordStudy({ getStudy, save, toast, onKeep }) {
  const pop = document.createElement('div');
  pop.className = 'ref-pop ws-pop';
  pop.hidden = true;
  document.body.appendChild(pop);
  let state = null; // { code, name, ch, v, words, sel, anchor, english }

  document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target)) hide(); }, true);
  function hide() { pop.hidden = true; state = null; }

  // The reference of the part of the passage a verse sits in.
  function partRef(verse) {
    const s = getStudy();
    const part = (s.passage.parts || [])[verse.part];
    return (part && part.ref) || s.passage.reference;
  }

  // A tap on a word in the passage (w from Marks.wordAt, with its text node).
  async function open(w, anchorRect, passageEl) {
    const s = getStudy();
    const verses = walkVerses(passageEl, s.passage.reference);
    let verse = null;
    for (const v of verses) {
      if (v.el.compareDocumentPosition(w.node) & Node.DOCUMENT_POSITION_FOLLOWING) verse = v; else break;
    }
    if (!verse) { toast('Tap a word inside a verse'); return; }
    const book = bookOf(partRef(verse));
    if (!book) { toast('Word study needs a Bible passage'); return; }
    // Where the tapped word sits within its verse, for matching.
    const next = verses[verses.indexOf(verse) + 1];
    const inVerse = w.all.filter(x => (verse.el.compareDocumentPosition(x.node) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      (!next || (next.el.compareDocumentPosition(x.node) & Node.DOCUMENT_POSITION_PRECEDING)));
    const at = inVerse.indexOf(w.word);
    const position = inVerse.length > 1 && at >= 0 ? at / (inVerse.length - 1) : 0.5;

    state = { code: book.code, name: book.name, ch: verse.ch, v: verse.v, english: w.word.text, anchor: anchorRect, words: null, sel: -1 };
    const mine = state;
    showShell(`${book.name} ${verse.ch}:${verse.v}`, '<p class="ref-loading">Finding the original word…</p>');
    try {
      const words = await verseWords(book.code, verse.ch, verse.v);
      if (state !== mine) return;
      if (!words.length) { body(`<p class="ref-loading">No Greek or Hebrew is stored for ${esc(book.name)} ${verse.ch}:${verse.v}.</p>`); return; }
      state.words = words;
      let sel = bestMatch(words, w.word.text, position);
      if (sel < 0) {
        // Try the lexicon glosses as well (NIV often uses a different English word).
        const lexGloss = {};
        await Promise.all(words.map(async x => { try { const e = await lookup(x.strong); if (e) lexGloss[x.strong] = e[2] + ' ' + e[3].slice(0, 300); } catch {} }));
        if (state !== mine) return;
        sel = bestMatch(words, w.word.text, position, lexGloss);
      }
      state.sel = sel;
      render();
    } catch {
      if (state === mine) body('<p class="ref-loading error">Word study needs the internet the first time you use it for a book. Try again when you are online.</p>');
    }
  }

  function showShell(title, inner) {
    pop.innerHTML = `<div class="ref-pop-head"><span>Word study · ${esc(title)}</span><button type="button" class="ref-close" aria-label="Close">×</button></div><div class="ref-pop-body"></div>`;
    pop.querySelector('.ref-close').addEventListener('click', hide);
    body(inner);
    pop.hidden = false;
    place();
  }
  const body = html => { pop.querySelector('.ref-pop-body').innerHTML = html; };

  function place() {
    const r = state.anchor;
    const w = Math.min(420, window.innerWidth - 24);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left - 30)) + 'px';
    const below = r.bottom + 10, room = window.innerHeight - below;
    if (room > 300) { pop.style.top = below + 'px'; pop.style.bottom = 'auto'; pop.style.maxHeight = room - 16 + 'px'; }
    else { pop.style.top = 'auto'; pop.style.bottom = (window.innerHeight - r.top + 10) + 'px'; pop.style.maxHeight = Math.max(260, r.top - 26) + 'px'; }
  }

  async function render() {
    const st = state;
    const { words, sel } = st;
    const strip = `<p class="ws-label">${sel < 0 ? `Which word is “${esc(st.english)}”? Tap one.` : 'In this verse'}</p>
      <div class="ws-strip ${/^H/.test(words[0].strong) ? 'rtl' : ''}">${words.map((x, i) =>
        `<button type="button" class="ws-w${i === sel ? ' on' : ''}" data-i="${i}"><span class="ws-o">${esc(x.word)}</span><span class="ws-g">${esc(x.gloss)}</span></button>`).join('')}</div>`;
    if (sel < 0) { body(strip); wireStrip(); return; }
    const w = words[sel];
    body(`<div class="ws-main"><p class="ref-loading">Looking it up…</p></div>${strip}`);
    wireStrip();
    let entry = null, book = null;
    try { [entry, book] = await Promise.all([lookup(w.strong), loadBook(st.code)]); } catch {}
    if (state !== st || st.sel !== sel) return;
    const base = w.strong.slice(0, 5);
    const uses = [];
    if (book) for (const [ref, ws] of Object.entries(book)) for (const x of ws) if (x[3].slice(0, 5) === base) { uses.push({ ref, gloss: x[2] }); break; }
    const lang = base[0] === 'G' ? 'greek' : 'hebrew';
    const num = String(+base.slice(1));
    const lemma = entry ? entry[0] : w.word, tr = entry ? entry[1] : w.tr, gloss = entry ? entry[2] : w.gloss;
    const total = entry ? entry[4] : 0;
    const main = pop.querySelector('.ws-main');
    main.innerHTML = `
      <div class="ws-lemma"><span class="ws-orig">${esc(lemma)}</span><span class="ws-tr">${esc(tr)}</span><span class="ws-num">${esc(base[0] + num)}</span></div>
      <div class="ws-gloss">${esc(gloss)}</div>
      <div class="ws-here">Here: <b>${esc(w.word)}</b> (${esc(w.tr)}), “${esc(w.gloss)}”${w.morph ? ` · ${esc(grammar(w.morph))}` : ''}</div>
      <div class="ws-count">${total ? `Used ${total} time${total === 1 ? '' : 's'} in the Bible` : ''}${uses.length ? `${total ? ' · ' : ''}<button type="button" class="text-link ws-uses-btn">${uses.length} verse${uses.length === 1 ? '' : 's'} in ${esc(st.name)}</button>` : ''}</div>
      <div class="ws-uses" hidden>${uses.map(u => `<span class="ws-use"><b>${esc(u.ref.replace('.', ':'))}</b> ${esc(u.gloss)}</span>`).join('')}</div>
      ${entry && entry[3] ? `<div class="ws-def clamp">${entry[3]}</div><button type="button" class="text-link ws-more">Read more</button>` : ''}
      <div class="ws-actions">
        <button type="button" class="chip-btn small ws-keep">Keep in outline</button>
        <a class="text-link" href="https://biblehub.com/${lang}/${num}.htm" target="_blank" rel="noopener">Bible Hub</a>
        <a class="text-link" href="https://www.stepbible.org/?q=strong=${base}" target="_blank" rel="noopener">STEP Bible</a>
      </div>
      <p class="ws-credit">Greek and Hebrew from STEP Bible (Tyndale House), CC BY 4.0</p>`;
    main.querySelector('.ws-uses-btn')?.addEventListener('click', () => { const u = main.querySelector('.ws-uses'); u.hidden = !u.hidden; });
    const def = main.querySelector('.ws-def'), more = main.querySelector('.ws-more');
    if (def) {
      requestAnimationFrame(() => { if (def.scrollHeight <= def.clientHeight + 4) more.hidden = true; });
      more.addEventListener('click', () => { def.classList.toggle('clamp'); more.textContent = def.classList.contains('clamp') ? 'Read more' : 'Show less'; });
    }
    main.querySelector('.ws-keep').addEventListener('click', () => {
      const s = getStudy();
      const o = s.outline;
      o.words = o.words || [];
      const ref = `${st.name} ${st.ch}:${st.v}`;
      if (o.words.some(x => x.strong === base && x.ref === ref)) { toast('Already in your outline'); return; }
      o.words.push({ strong: base, lemma, tr, gloss, ref, english: st.english, here: grammar(w.morph) });
      save();
      onKeep && onKeep();
      toast(`${lemma} (${gloss}) is in your outline`);
    });
  }

  function wireStrip() {
    pop.querySelectorAll('.ws-w').forEach(b => b.addEventListener('click', () => { state.sel = +b.dataset.i; render(); }));
  }

  // Load the book (and the lexicon it needs) in the background so word study works offline.
  async function warm(reference) {
    const book = bookOf(reference);
    if (!book || !navigator.onLine) return;
    try {
      const data = await loadBook(book.code);
      const chunks = new Set();
      for (const ws of Object.values(data)) for (const x of ws) chunks.add(chunkOf(x[3]));
      for (const c of chunks) await load(`lex/${c}.json`).catch(() => {});
    } catch {}
  }

  return { open, hide, warm, get isOpen() { return !pop.hidden; } };
}
