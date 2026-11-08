// Observe: prompts for exegesis, each with what the app can find in this passage
// (repeated words, therefores, contrasts, purpose clauses, questions, Scripture
// quoted and so on). Tap a verse to go to it, or box the words on the page. The
// finds are rough helps for your own reading, not a parse of the text.

import { WORD_RE, normWord, isStopWord, esc } from './verses.js';

// Each prompt: what to look for, why it matters, and how to spot it in the text.
const PROMPTS = [
  { key: 'logic', tag: 'Therefores and fors', q: 'How is the argument built?', hint: 'Therefore, so and thus point back to a reason. For, because and since give the reason. Ask what each one is there for.',
    words: ['therefore', 'so', 'thus', 'because', 'since', 'consequently', 'hence', 'wherefore'], phrases: ['so then', 'for this reason', 'that is why'],
    res: [['for', /(^|[.;:!?,\u2014\u2013]\s*)for\b/]] }, // "for" giving a reason, not "a light for those"
  { key: 'contrast', tag: 'Contrasts', q: 'What is set against what?', hint: 'But, yet and rather mark a turn. The second half is often the point.',
    words: ['but', 'yet', 'however', 'rather', 'instead', 'nevertheless', 'although', 'though', 'whereas'] },
  { key: 'purpose', tag: 'Purpose and result', q: 'What is it all for?', hint: 'So that and in order that show God’s purpose or the result. Often the heart of the passage.',
    phrases: ['so that', 'in order that', 'in order to', 'that you may', 'that we may', 'so as to', 'with the result'] },
  { key: 'if', tag: 'Conditions', q: 'If this, then what?', hint: 'Spell out each if and its then. Is it a real condition, or an argument (“if, as is true…”)?',
    words: ['if', 'unless'] },
  { key: 'compare', tag: 'Comparisons and pictures', q: 'What is it like?', hint: 'Like, as and just as bring a picture. What did the picture mean to the first hearers?',
    words: ['like', 'likewise'], phrases: ['just as', 'even as', 'in the same way', 'as it were'] },
  { key: 'questions', tag: 'Questions', q: 'What questions does the text ask?', hint: 'Who is asking, and how would the hearers have answered? Rhetorical questions often carry the punch.', test: t => /\?/.test(t) },
  { key: 'commands', tag: 'Commands', q: 'What does it tell people to do, and on what basis?', hint: 'Find the indicative (what God has done) behind each imperative. Grace comes before the command.',
    phrases: ['let us', 'do not', 'must', 'be careful', 'make every effort', 'put on', 'put off', 'see to it', 'remember', 'go and'] },
  { key: 'time', tag: 'Time and sequence', q: 'When is this, and what changed?', hint: 'Now, then, once, until and after show a turn in the story or in salvation history (“but now”).',
    words: ['now', 'then', 'once', 'until', 'after', 'before', 'when', 'today', 'formerly', 'already'], phrases: ['but now', 'at that time', 'in those days', 'the last days'] },
  { key: 'scripture', tag: 'Scripture quoted', q: 'Where does it quote or echo the Old Testament?', hint: 'Look up the original context. What did it mean there, and how is it used here?',
    phrases: ['it is written', 'as it says', 'scripture says', 'the scripture', 'says the lord', 'declares the lord', 'the prophet', 'was spoken', 'to fulfil', 'to fulfill', 'fulfilled'] },
  { key: 'god', tag: 'God at work', q: 'What is God doing in this passage?', hint: 'Make God the subject. What he says, does and promises is the ground for everything else.',
    words: ['god', 'lord', 'jesus', 'christ', 'spirit', 'father', 'son', 'messiah'] },
];

// Prompts the app cannot find for you.
const ALSO = [
  ['context', 'Read what comes before and after. How does this passage fit the book’s argument or story?'],
  ['genre', 'What kind of writing is it: letter, narrative, poetry, prophecy, wisdom, apocalyptic? Read it that way.'],
  ['firsthearers', 'Who first heard this, and what were they facing?'],
  ['structure', 'Is there a shape: parallel lines, a chiasm (A B B A), a list, a build to a climax?'],
  ['surprise', 'What surprises you, or would surprise the first hearers? What feels odd?'],
  ['tone', 'What is the tone: warning, comfort, grief, joy, rebuke? Preach it in that key.'],
  ['people', 'Who are the people here, and who are “you”, “we” and “they”? Watch for the pronouns shifting.'],
  ['keywords', 'Which words carry the weight? Look them up with Word study (magnifier tool).'],
];

const lower = s => s.toLowerCase().replace(/’/g, "'");
const vLabel = v => (v.v === 1 ? v.ch + ':1' : 'v. ' + v.v);

function findIn(verses, pr) {
  const hits = [];
  for (const v of verses) {
    const t = lower(v.text);
    const found = new Set();
    if (pr.test && pr.test(v.text)) found.add('?');
    for (const w of pr.words || []) if (new RegExp(`\\b${w}\\b`, 'i').test(t)) found.add(w);
    for (const p of pr.phrases || []) if (new RegExp(`\\b${p}\\b`).test(t)) found.add(p);
    for (const [label, re] of pr.res || []) if (re.test(t)) found.add(label);
    if (pr.key === 'logic' && found.has('so') && !/\bso\b(?! that)/.test(t)) found.delete('so'); // "so that" is purpose
    if (found.size) hits.push({ v, found: [...found] });
  }
  return hits;
}

function repeats(verses, study) {
  const counts = new Map();
  for (const v of verses) {
    for (const m of v.text.matchAll(WORD_RE)) {
      const w = m[0].replace(/['’-]+$/, ''), lw = w.toLowerCase(), n = normWord(w);
      if (isStopWord(lw, n)) continue;
      const c = counts.get(n) || { norm: n, label: lw === 'god' || lw === 'lord' ? w : lw, n: 0, verses: new Set() };
      c.n++; c.verses.add(v.key);
      counts.set(n, c);
    }
  }
  const all = [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const min = all.filter(c => c.n >= 3).length >= 3 ? 3 : 2;
  const spotted = new Set((study.spots || []).map(s => s.norm));
  return all.filter(c => c.n >= min).slice(0, 14).map(c => ({ ...c, on: spotted.has(c.norm) }));
}

export function renderObserve(pane, { study, verses, save, onSpot, onGoto, onConnectives }) {
  const o = study.observe = study.observe || { done: {}, open: {} };
  if (!verses.length) {
    pane.innerHTML = '<p class="eyebrow">Observe</p><p class="hint">This page has no verse numbers, so there is nothing to find. The questions below still apply.</p>' + alsoHtml(o);
    wireAlso(pane, o, save);
    return;
  }
  const reps = repeats(verses, study);
  const groups = PROMPTS.map(pr => ({ pr, hits: findIn(verses, pr) }));
  pane.innerHTML = `
    <p class="eyebrow">Observe</p>
    <p class="hint">Slow down and notice before you interpret. The app finds some things for you; tap a verse to go to it. These are rough finds to start your own reading, not a final word.</p>

    <div class="obs">
      <div class="obs-head"><span class="cc-tag">Repeats</span><span class="cc-q">What words keep coming back?</span></div>
      <p class="cc-hint">Repetition shows emphasis. Box a word to see every place it falls on the page.</p>
      <div class="obs-chips">${reps.length ? reps.map(r => `<button type="button" class="obs-chip rep${r.on ? ' on' : ''}" data-norm="${esc(r.norm)}" data-label="${esc(r.label)}">${esc(r.label)} <b>${r.n}</b></button>`).join('') : '<span class="hint">No word repeats much here.</span>'}</div>
    </div>

    ${groups.map(({ pr, hits }) => `
    <div class="obs${hits.length ? '' : ' none'}">
      <div class="obs-head"><span class="cc-tag">${esc(pr.tag)}</span><span class="cc-q">${esc(pr.q)}</span><span class="obs-n">${hits.length ? hits.length + (hits.length === 1 ? ' verse' : ' verses') : 'none found'}</span></div>
      <p class="cc-hint">${esc(pr.hint)}</p>
      ${hits.length ? `<div class="obs-chips">${hits.map(h => `<button type="button" class="obs-chip" data-key="${esc(h.v.key)}"><span>${esc(vLabel(h.v))}</span> ${esc(h.found.filter(f => f !== '?').map(f => (pr.key === 'god' ? f[0].toUpperCase() + f.slice(1) : f)).join(', ') || 'question')}</button>`).join('')}</div>` : ''}
      ${pr.key === 'logic' || pr.key === 'contrast' ? `<button type="button" class="text-link obs-conn">${study.connectives ? 'Hide' : 'Underline'} the connectives on the page</button>` : ''}
    </div>`).join('')}

    <p class="eyebrow sub">Also ask</p>
    ${alsoHtml(o)}`;

  pane.querySelectorAll('.obs-chip.rep').forEach(b => b.addEventListener('click', () => { onSpot(b.dataset.norm, b.dataset.label); b.classList.toggle('on'); }));
  pane.querySelectorAll('.obs-chip[data-key]').forEach(b => b.addEventListener('click', () => onGoto(b.dataset.key)));
  pane.querySelectorAll('.obs-conn').forEach(b => b.addEventListener('click', () => {
    onConnectives();
    pane.querySelectorAll('.obs-conn').forEach(x => { x.textContent = `${study.connectives ? 'Hide' : 'Underline'} the connectives on the page`; });
  }));
  wireAlso(pane, o, save);
}

function alsoHtml(o) {
  return `<ul class="checklist obs-also">${ALSO.map(([k, t]) => `<li><label><input type="checkbox" data-also="${k}"${o.done[k] ? ' checked' : ''}><span>${esc(t)}</span></label></li>`).join('')}</ul>`;
}
function wireAlso(pane, o, save) {
  pane.querySelectorAll('[data-also]').forEach(cb => cb.addEventListener('change', () => { o.done[cb.dataset.also] = cb.checked; save(); }));
}
