// The side sheet beside a study: an Outline tab (big idea, breakup into points,
// application, illustrations, checks before preaching) and a Compare tab that shows
// other translations verse by verse with the differences marked.

import { walkVerses, passageContainer, suggestBreakup, rangeLabel, openingWords, pointStarts, diffWords, esc } from './verses.js';
import { scanSensitive, CHECKLIST } from './checks.js';

export const VERSIONS = ['NIV', 'ESV', 'NASB', 'NASB1995', 'CSB', 'NKJV', 'KJV', 'NLT', 'NRSVUE'];

export function emptyOutline() {
  return { bigIdea: '', points: [], application: '', illustrations: '', checks: {}, showOnPage: true };
}

const $ = id => document.getElementById(id);
const pid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export function initSheet({ getStudy, save, marks, fetchPassage, getWorker, toast }) {
  const sheet = $('sheet');
  let tab = 'outline';
  let verses = [];
  let markTimer = null, scanTimer = null;

  const study = () => getStudy();
  const outline = () => study().outline;

  function open(which) {
    if (which) tab = which;
    sheet.hidden = false;
    document.getElementById('study').classList.add('sheet-open');
    $('outlineBtn').classList.add('active');
    render();
  }
  function close() {
    sheet.hidden = true;
    document.getElementById('study').classList.remove('sheet-open');
    $('outlineBtn').classList.remove('active');
  }
  function render() {
    if (sheet.hidden || !study()) return;
    document.querySelectorAll('#sheetTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('outlinePane').hidden = tab !== 'outline';
    $('comparePane').hidden = tab !== 'compare';
    verses = walkVerses(passageContainer(study().passage), study().passage.reference);
    if (tab === 'outline') renderOutline(); else renderCompare();
  }

  $('sheetClose').addEventListener('click', close);
  document.querySelectorAll('#sheetTabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));

  const remark = () => { clearTimeout(markTimer); markTimer = setTimeout(() => marks.render(), 250); };
  const rescan = () => { clearTimeout(scanTimer); scanTimer = setTimeout(renderChecks, 400); };

  // ---------- outline ----------

  function renderOutline() {
    const o = outline();
    const pane = $('outlinePane');
    pane.innerHTML = `
      <p class="eyebrow">Big idea</p>
      <textarea class="field sheet-field" data-f="bigIdea" rows="2" placeholder="The whole passage in one sentence"></textarea>

      <div class="sheet-row">
        <p class="eyebrow">Breakup</p>
        <button type="button" class="chip-btn small" id="suggestBtn">Suggest a breakup</button>
      </div>
      <p class="hint">${verses.length ? 'Splits the passage at its headings, paragraph breaks and words like "therefore". Change a point’s verses to move a split.' : 'This passage has no verse numbers, so add points by hand.'}</p>
      <ol class="points" id="points"></ol>
      <button type="button" class="text-link" id="addPointBtn">+ Add a point</button>
      <label class="opt-row"><span>Show the breakup on the page</span><input type="checkbox" class="switch" id="showBreakup"></label>

      <p class="eyebrow">Application</p>
      <textarea class="field sheet-field" data-f="application" rows="3" placeholder="What does this mean on Monday for the young adults in the room?"></textarea>

      <p class="eyebrow">Illustrations</p>
      <textarea class="field sheet-field" data-f="illustrations" rows="3" placeholder="Stories, pictures, quotes"></textarea>

      <p class="eyebrow">Before you preach</p>
      <div id="sensitivity"></div>
      <ul class="checklist" id="checklist"></ul>

      <button type="button" class="pill pill-block" id="shareOutlineBtn"><span>Share outline</span></button>
      <p class="hint">The outline also goes at the end of the PDF.</p>`;

    pane.querySelectorAll('[data-f]').forEach(t => {
      t.value = o[t.dataset.f] || '';
      autoGrow(t);
      t.addEventListener('input', () => { o[t.dataset.f] = t.value; autoGrow(t); save(); rescan(); });
    });
    $('showBreakup').checked = o.showOnPage !== false;
    $('showBreakup').addEventListener('change', e => { o.showOnPage = e.target.checked; save(); marks.render(); });
    $('suggestBtn').addEventListener('click', suggest);
    $('suggestBtn').disabled = verses.length < 2;
    $('addPointBtn').addEventListener('click', () => {
      o.points.push({ id: pid(), title: '', verses: '', notes: '' });
      save(); renderPoints();
      const inputs = pane.querySelectorAll('.point-title');
      inputs[inputs.length - 1]?.focus();
    });
    $('shareOutlineBtn').addEventListener('click', shareOutline);

    const cl = $('checklist');
    for (const [key, label] of CHECKLIST) {
      const li = document.createElement('li');
      li.innerHTML = `<label><input type="checkbox"><span></span></label>`;
      li.querySelector('span').textContent = label;
      const cb = li.querySelector('input');
      cb.checked = !!o.checks[key];
      cb.addEventListener('change', () => { o.checks[key] = cb.checked; save(); });
      cl.appendChild(li);
    }
    renderPoints();
    renderChecks();
  }

  function renderPoints() {
    const o = outline();
    const ol = $('points');
    if (!ol) return;
    ol.innerHTML = '';
    const starts = pointStarts(o.points, verses);
    o.points.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'point';
      li.innerHTML = `
        <div class="point-head">
          <span class="point-num">${i + 1}</span>
          <input class="point-title" placeholder="Point ${i + 1}" spellcheck="true">
          <input class="point-verses" placeholder="vv." aria-label="Verses" inputmode="text">
          <button type="button" class="point-del" aria-label="Remove point">×</button>
        </div>
        <div class="point-start"></div>
        <textarea class="point-notes" rows="1" placeholder="Notes"></textarea>`;
      const title = li.querySelector('.point-title'), vv = li.querySelector('.point-verses'), notes = li.querySelector('.point-notes');
      const start = li.querySelector('.point-start');
      title.value = p.title; vv.value = p.verses; notes.value = p.notes;
      const showStart = idx => {
        start.textContent = idx >= 0 ? '“' + openingWords(verses[idx].text) + '”' : (p.verses ? 'Those verses are not in this passage' : '');
        start.classList.toggle('bad', idx < 0 && !!p.verses);
      };
      showStart(starts[i]);
      autoGrow(notes);
      title.addEventListener('input', () => { p.title = title.value; save(); rescan(); });
      notes.addEventListener('input', () => { p.notes = notes.value; autoGrow(notes); save(); rescan(); });
      vv.addEventListener('input', () => {
        p.verses = vv.value; save();
        showStart(pointStarts(o.points, verses)[i]);
        remark();
      });
      li.querySelector('.point-del').addEventListener('click', () => {
        if ((p.title || p.notes) && !confirm(`Remove point ${i + 1}?`)) return;
        o.points.splice(i, 1);
        save(); renderPoints(); marks.render(); rescan();
      });
      ol.appendChild(li);
    });
  }

  function suggest() {
    const o = outline();
    const used = o.points.some(p => p.title || p.notes);
    if (used && !confirm('Replace your current points with a suggested breakup? Their titles and notes will be cleared.')) return;
    const secs = suggestBreakup(verses);
    o.points = secs.map(sec => ({
      id: pid(),
      title: verses[sec.from].heading || '',
      verses: rangeLabel(verses[sec.from], verses[sec.to]),
      notes: '',
    }));
    o.showOnPage = true;
    save();
    renderOutline();
    marks.render();
    toast(`Split into ${secs.length} parts. Adjust the verses to taste.`);
  }

  function renderChecks() {
    const box = $('sensitivity');
    if (!box) return;
    const s = study(), o = s.outline;
    const sources = [
      { where: 'Big idea', text: o.bigIdea },
      ...o.points.flatMap((p, i) => [{ where: `Point ${i + 1}`, text: p.title + '\n' + p.notes }]),
      { where: 'Application', text: o.application },
      { where: 'Illustrations', text: o.illustrations },
      ...(s.notes || []).map(n => ({ where: 'Text box', text: n.text })),
    ];
    const found = scanSensitive(sources);
    if (!found.length) {
      box.innerHTML = '<p class="hint">Nothing in your typed notes needs a second look. Handwriting is not checked, so give anything you wrote by hand a once-over too.</p>';
      return;
    }
    box.innerHTML = '<p class="hint">Worth a second look before Sunday. These may be exactly right to include. Just handle them with care.</p>' +
      found.map(f => `<div class="warn-card"><div class="warn-where">${esc(f.where)} · “${esc(f.word)}”</div><div>${esc(f.note)}</div></div>`).join('');
  }

  function outlineText() {
    const s = study(), o = s.outline;
    const lines = [`${s.title}${s.passage.reference && s.passage.reference !== s.title ? ' (' + s.passage.reference + ')' : ''}${s.passage.version ? ' ' + s.passage.version : ''}`];
    if (s.series) lines.push('Series: ' + s.series);
    lines.push('');
    if (o.bigIdea) lines.push('BIG IDEA', o.bigIdea, '');
    o.points.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.title || 'Point ' + (i + 1)}${p.verses ? ' (' + p.verses + ')' : ''}`);
      if (p.notes) lines.push(p.notes.replace(/^/gm, '   '));
      lines.push('');
    });
    if (o.application) lines.push('APPLICATION', o.application, '');
    if (o.illustrations) lines.push('ILLUSTRATIONS', o.illustrations, '');
    return lines.join('\n').trim() + '\n';
  }

  async function shareOutline() {
    const text = outlineText();
    if (navigator.share) {
      try { await navigator.share({ title: study().title, text }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast('Outline copied'); } catch { toast('Could not share the outline'); }
  }

  // ---------- compare ----------

  function cmp() {
    const s = study();
    s.compare = s.compare || { versions: [], data: {}, diff: true };
    return s.compare;
  }

  function renderCompare() {
    const s = study(), c = cmp();
    const pane = $('comparePane');
    const base = s.passage.version || 'Your text';
    const canFetch = s.passage.source === 'biblegateway' || (s.passage.source === 'paste' && /\d/.test(s.passage.reference));
    pane.innerHTML = `
      <p class="eyebrow">Compare with</p>
      <div class="ver-chips" id="verChips"></div>
      <label class="opt-row"><span>Mark the differences</span><input type="checkbox" class="switch" id="cmpDiff"></label>
      <p class="fetch-status" id="cmpStatus" role="status"></p>
      <div id="cmpList" class="cmp-list"></div>`;
    const chips = $('verChips');
    for (const v of VERSIONS) {
      if (v === s.passage.version) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ver-chip' + (c.versions.includes(v) ? ' on' : '');
      b.textContent = v;
      b.disabled = !canFetch;
      b.addEventListener('click', () => toggleVersion(v));
      chips.appendChild(b);
    }
    $('cmpDiff').checked = c.diff !== false;
    $('cmpDiff').addEventListener('change', e => { c.diff = e.target.checked; save(); renderCompareList(); });
    if (!canFetch) $('cmpStatus').textContent = 'Compare needs a passage reference, such as one opened from Bible Gateway.';
    else if (!c.versions.length) $('cmpStatus').textContent = `Tap a translation to see it beside the ${base}, verse by verse.`;
    renderCompareList();
  }

  async function toggleVersion(v) {
    const s = study(), c = cmp();
    if (c.versions.includes(v)) {
      c.versions = c.versions.filter(x => x !== v);
      delete c.data[v];
      save(); renderCompare();
      return;
    }
    const status = $('cmpStatus');
    status.classList.remove('error');
    status.textContent = `Getting the ${v}…`;
    try {
      const p = await fetchPassage(s.passage.reference, v, getWorker());
      if (study() !== s) return;
      c.data[v] = { parts: p.parts, reference: p.reference, version: v, copyright: p.copyright };
      c.versions = VERSIONS.filter(x => x === v || c.versions.includes(x));
      save();
      renderCompare();
    } catch (err) {
      status.classList.add('error');
      status.textContent = err.message;
    }
  }

  function renderCompareList() {
    const s = study(), c = cmp();
    const list = $('cmpList');
    if (!list) return;
    if (!c.versions.length || !verses.length) { list.innerHTML = ''; return; }
    const maps = {};
    for (const v of c.versions) {
      const d = c.data[v];
      if (!d) continue;
      maps[v] = new Map(walkVerses(passageContainer(d), d.reference || s.passage.reference).map(x => [x.ch + ':' + x.v + '|' + x.part, x.text]));
    }
    const baseLabel = s.passage.version || 'Text';
    list.innerHTML = verses.map(x => {
      const k = x.ch + ':' + x.v + '|' + x.part;
      const rows = c.versions.filter(v => maps[v]).map(v => {
        const t = maps[v].get(k);
        const body = t == null ? '<span class="cmp-missing">Not in this version</span>' : (c.diff !== false ? diffWords(x.text, t) : esc(t));
        return `<div class="cmp-line"><span class="cmp-ver">${esc(v)}</span><span>${body}</span></div>`;
      }).join('');
      return `<div class="cmp-verse"><div class="cmp-num">${x.v === 1 ? x.ch + ':1' : x.v}</div><div class="cmp-lines">` +
        `<div class="cmp-line base"><span class="cmp-ver">${esc(baseLabel)}</span><span>${esc(x.text)}</span></div>${rows}</div></div>`;
    }).join('') + c.versions.filter(v => c.data[v]?.copyright).map(v => `<p class="cmp-copy">${esc(c.data[v].copyright)}</p>`).join('');
  }

  return {
    open, close, render,
    toggle(which) { if (!sheet.hidden && (!which || which === tab)) close(); else open(which); },
    get isOpen() { return !sheet.hidden; },
    rescan,
  };
}

function autoGrow(t) {
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight + 2, 420) + 'px';
}
