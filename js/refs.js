// Footnotes and cross references: a small card when you tap a letter or a verse
// number in the passage, and a References tab in the side sheet listing them verse
// by verse. Tapping a cross reference fetches its text right there.

import { esc } from './verses.js';

const $ = id => document.getElementById(id);

// "Romans 2:17" or "John 3:16" -> { ch, v } (the last chapter:verse in the label).
function chv(label) {
  const m = String(label || '').match(/(\d+):(\d+)(?!.*\d+:\d+)/);
  return m ? { ch: +m[1], v: +m[2] } : null;
}

export function initRefs({ getStudy, save, fetchPassage, getWorker, toast, openPassage }) {
  const pop = document.createElement('div');
  pop.className = 'ref-pop';
  pop.hidden = true;
  document.body.appendChild(pop);
  const textCache = new Map(); // "ref|version" -> passage

  const study = () => getStudy();
  const extras = () => study().passage.extras || { footnotes: [], crossrefs: [] };
  const version = () => study().passage.version || 'NIV';

  // Everything attached to one verse.
  function forVerse(ch, v) {
    const ex = extras(), same = x => { const k = chv(x.verse); return k && k.ch === ch && k.v === v; };
    return { footnotes: ex.footnotes.filter(same), crossrefs: ex.crossrefs.filter(same) };
  }

  function byId(id) {
    const ex = extras();
    const f = ex.footnotes.find(x => x.id === id);
    if (f) return { footnotes: [f], crossrefs: [] };
    const c = ex.crossrefs.find(x => x.id === id);
    return c ? { footnotes: [], crossrefs: [c] } : null;
  }

  function itemsHtml({ footnotes, crossrefs }, opts = {}) {
    let html = '';
    for (const f of footnotes) {
      html += `<div class="ref-fn"><span class="ref-letter fn">${esc(f.letter || '•')}</span><div>${opts.showVerse ? `<div class="ref-from">${esc(f.verse)}</div>` : ''}${esc(f.text)}</div></div>`;
    }
    for (const c of crossrefs) {
      html += `<div class="ref-xr"><span class="ref-letter xr">${esc(c.letter || '•')}</span><div class="ref-xr-body">` +
        `<div class="ref-from">${opts.showVerse ? esc(c.verse) + ' · ' : ''}${c.refs.length} cross reference${c.refs.length === 1 ? '' : 's'}</div>` +
        `<div class="ref-chips">${c.refs.map(r => `<button type="button" class="ref-chip" data-ref="${esc(r)}">${esc(r)}</button>`).join('')}` +
        (c.refs.length > 1 ? `<button type="button" class="ref-chip all" data-ref="${esc(c.refs.join('; '))}">Read all</button>` : '') +
        `</div><div class="ref-text" hidden></div></div></div>`;
    }
    return html;
  }

  // Tapping a reference shows its text underneath, fetched once and remembered.
  function wireChips(root) {
    root.querySelectorAll('.ref-chip').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const body = b.closest('.ref-xr-body');
      const out = body.querySelector('.ref-text');
      const ref = b.dataset.ref;
      if (!out.hidden && out.dataset.ref === ref) { out.hidden = true; b.classList.remove('on'); return; }
      body.querySelectorAll('.ref-chip').forEach(x => x.classList.toggle('on', x === b));
      out.hidden = false;
      out.dataset.ref = ref;
      out.innerHTML = `<p class="ref-loading">Getting ${esc(ref)}…</p>`;
      try {
        const key = ref + '|' + version();
        let p = textCache.get(key);
        if (!p) {
          p = await fetchPassage(ref, version(), getWorker());
          textCache.set(key, p);
        }
        if (out.dataset.ref !== ref) return;
        out.innerHTML = p.parts.map(part => (p.parts.length > 1 ? `<div class="ref-part">${esc(part.ref)}</div>` : '') + part.html).join('') +
          `<button type="button" class="text-link ref-open">Open ${esc(p.reference)} as a new study</button>`;
        out.querySelector('.ref-open').addEventListener('click', () => { hide(); openPassage(p); });
      } catch (err) {
        out.innerHTML = `<p class="ref-loading error">${esc(err.message)}</p>`;
      }
    }));
  }

  // ---------- the card ----------

  function show(anchor, data, title) {
    if (!data || (!data.footnotes.length && !data.crossrefs.length)) {
      toast(study().passage.extras ? 'Nothing noted for this verse' : 'Open the References tab to load footnotes and cross references');
      return;
    }
    pop.innerHTML = `<div class="ref-pop-head"><span>${esc(title)}</span><button type="button" class="ref-close" aria-label="Close">×</button></div>` +
      `<div class="ref-pop-body">${itemsHtml(data)}</div>`;
    pop.querySelector('.ref-close').addEventListener('click', hide);
    wireChips(pop);
    pop.hidden = false;
    // Sit just below the letter, kept on screen.
    const r = anchor.getBoundingClientRect();
    const w = Math.min(380, window.innerWidth - 24);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left - 20)) + 'px';
    const below = r.bottom + 10, room = window.innerHeight - below;
    if (room > 220) { pop.style.top = below + 'px'; pop.style.bottom = 'auto'; pop.style.maxHeight = room - 16 + 'px'; }
    else { pop.style.top = 'auto'; pop.style.bottom = (window.innerHeight - r.top + 10) + 'px'; pop.style.maxHeight = r.top - 26 + 'px'; }
  }

  function hide() { pop.hidden = true; }

  document.addEventListener('pointerdown', e => {
    if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('sup.fn, sup.xr, sup.versenum, .chapternum')) hide();
  }, true);

  // A tap on a marker or verse number in the passage.
  function tapped(el, verseKey) {
    if (el.matches('sup.fn, sup.xr')) {
      let data = el.dataset.id ? byId(el.dataset.id) : null;
      if (!data && el.matches('sup.fn')) { // studies saved before footnotes were linked: match by order
        const all = [...el.closest('.passage').querySelectorAll('sup.fn')];
        const f = (study().passage.footnotes || [])[all.indexOf(el)];
        if (f) data = { footnotes: [{ letter: el.textContent, text: typeof f === 'string' ? f : f.text }], crossrefs: [] };
      }
      const item = data && (data.footnotes[0] || data.crossrefs[0]);
      show(el, data, item ? (data.footnotes.length ? 'Footnote' : 'Cross references') + (item.verse ? ' · ' + item.verse : '') : '');
      return;
    }
    if (verseKey) {
      const [ch, v] = verseKey.split('|')[1].split(':').map(Number);
      show(el, forVerse(ch, v), `${study().passage.reference.replace(/\s*\d+:.*$/, '')} ${ch}:${v}`.trim());
    }
  }

  // ---------- the References tab ----------

  async function load(button) {
    const s = study();
    button.disabled = true;
    button.textContent = 'Getting them from Bible Gateway…';
    try {
      const p = await fetchPassage(s.passage.reference, version(), getWorker());
      s.passage.extras = p.extras || { footnotes: [], crossrefs: [] };
      save();
      renderTab();
      toast(`Found ${s.passage.extras.footnotes.length} footnotes and ${s.passage.extras.crossrefs.length} cross references`);
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Try again';
      toast(err.message);
    }
  }

  function renderTab() {
    const pane = $('refsPane');
    if (!pane) return;
    const s = study();
    const ex = s.passage.extras;
    if (!ex) {
      const can = s.passage.source === 'biblegateway';
      pane.innerHTML = `<p class="eyebrow">Footnotes and cross references</p>
        <p class="hint">${can ? 'This study was opened before the app kept these. Load them now; your page and ink stay exactly as they are.' : 'Pasted text and blank pages have no footnotes or cross references.'}</p>
        ${can ? '<button type="button" class="pill pill-block" id="loadRefsBtn"><span>Load them</span></button>' : ''}`;
      if (can) $('loadRefsBtn').addEventListener('click', e => load(e.currentTarget));
      return;
    }
    // Group by verse, in passage order.
    const groups = new Map();
    const add = (x, kind) => {
      const k = chv(x.verse), key = k ? k.ch * 1000 + k.v : 1e9;
      if (!groups.has(key)) groups.set(key, { label: x.verse || 'Other', footnotes: [], crossrefs: [] });
      groups.get(key)[kind].push(x);
    };
    ex.footnotes.forEach(f => add(f, 'footnotes'));
    ex.crossrefs.forEach(c => add(c, 'crossrefs'));
    const keys = [...groups.keys()].sort((a, b) => a - b);
    pane.innerHTML = `<p class="hint">Tap a reference to read it here. In the passage, tap a footnote letter <span class="ref-letter fn inline">a</span>, a cross-reference letter <span class="ref-letter xr inline">A</span> or a verse number to see the same card.</p>` +
      (keys.length ? keys.map(k => {
        const g = groups.get(k);
        return `<section class="ref-group"><div class="ref-verse">${esc(g.label)}</div>${itemsHtml(g)}</section>`;
      }).join('') : `<p class="hint">Bible Gateway has no footnotes or cross references for this passage in the ${esc(version())}.</p>`);
    wireChips(pane);
  }

  return { tapped, hide, renderTab };
}
