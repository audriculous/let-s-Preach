// The side sheet beside a study: an Outline tab (big idea, breakup into points,
// application, illustrations, checks before preaching) and a Compare tab that shows
// other translations verse by verse with the differences marked.

import { walkVerses, passageContainer, suggestBreakup, rangeLabel, openingWords, pointStarts, diffWords, esc, seams, breakupOptions, sectionsFromCuts } from './verses.js';
import { SECTION_COLORS } from './marks.js';
import { Pad, emptyPad } from './pad.js';
import { scanSensitive, CHECKLIST } from './checks.js';

export const VERSIONS = ['NIV', 'ESV', 'NASB', 'NASB1995', 'CSB', 'NKJV', 'KJV', 'NLT', 'NRSVUE'];

export function emptyOutline() {
  return { bigIdea: '', points: [], application: '', illustrations: '', pads: {}, checks: {}, showOnPage: true };
}

const $ = id => document.getElementById(id);
const pid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export function initSheet({ getStudy, save, marks, fetchPassage, getWorker, toast, pushAction, setSplitMode, isSplitMode, pen, fingerDraw, renderRefs }) {
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
    if (isSplitMode()) setSplitMode(false);
    sheet.hidden = true;
    document.getElementById('study').classList.remove('sheet-open');
    $('outlineBtn').classList.remove('active');
  }
  function render() {
    if (sheet.hidden || !study()) return;
    document.querySelectorAll('#sheetTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('outlinePane').hidden = tab !== 'outline';
    $('comparePane').hidden = tab !== 'compare';
    $('refsPane').hidden = tab !== 'refs';
    verses = walkVerses(passageContainer(study().passage), study().passage.reference);
    if (tab === 'outline') renderOutline(); else if (tab === 'compare') renderCompare(); else renderRefs();
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
      ${verses.length > 1 ? `
      <p class="hint">Tap a verse to split before it, tap again to join. Dots show natural seams: headings, new paragraphs and words like “therefore”.</p>
      <div class="strip" id="strip"></div>
      <p class="strip-note" id="stripNote"></p>
      <div class="sheet-row tight">
        <button type="button" class="chip-btn small" id="splitModeBtn" aria-pressed="false">Split on the page</button>
        <button type="button" class="text-link" id="clearSplitsBtn">Clear splits</button>
      </div>
      <p class="eyebrow sub">Try a different breakup</p>
      <div class="options" id="options"></div>` : '<p class="hint">This passage has no verse numbers, so add points by hand.</p>'}
      <ol class="points" id="points"></ol>
      <button type="button" class="text-link" id="addPointBtn">+ Add a point</button>
      <label class="opt-row"><span>Show the breakup on the page</span><input type="checkbox" class="switch" id="showBreakup"></label>
      <label class="opt-row"><span>Show point titles in the text</span><input type="checkbox" class="switch" id="showTitles"></label>

      <p class="eyebrow">Application</p>
      <p class="hint">Write with the Pencil. What does this mean on Monday for the young adults in the room?</p>
      ${o.application ? '<textarea class="field sheet-field" data-f="application" rows="2"></textarea>' : ''}
      <div id="padApplication"></div>

      <p class="eyebrow">Illustrations</p>
      <p class="hint">Write with the Pencil. Stories, pictures, quotes.</p>
      ${o.illustrations ? '<textarea class="field sheet-field" data-f="illustrations" rows="2"></textarea>' : ''}
      <div id="padIllustrations"></div>

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
    o.pads = o.pads || {};
    for (const [key, id] of [['application', 'padApplication'], ['illustrations', 'padIllustrations']]) {
      o.pads[key] = o.pads[key] || emptyPad();
      const pad = new Pad($(id), o.pads[key], { onChange: save, pushAction, pen, fingerDraw });
      requestAnimationFrame(() => pad.render());
    }
    keyboardOnPencil(pane.querySelector('[data-f=bigIdea]'));
    $('showBreakup').checked = o.showOnPage !== false;
    $('showBreakup').addEventListener('change', e => { o.showOnPage = e.target.checked; save(); marks.render(); });
    $('showTitles').checked = o.titlesOnPage !== false;
    $('showTitles').addEventListener('change', e => { o.titlesOnPage = e.target.checked; save(); marks.render(); });
    $('suggestBtn').addEventListener('click', suggest);
    $('suggestBtn').disabled = verses.length < 2;
    if (verses.length > 1) {
      $('splitModeBtn').addEventListener('click', () => { setSplitMode(!isSplitMode()); syncSplitButton(); });
      $('clearSplitsBtn').addEventListener('click', () => applyCuts([], 'Cleared. The passage is one section.'));
      syncSplitButton();
      renderStrip();
      renderOptions();
    }
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
          <span class="point-num" style="--c:${SECTION_COLORS[i % SECTION_COLORS.length]}">${i + 1}</span>
          <input class="point-title" placeholder="Point ${i + 1}" spellcheck="true">
          <input class="point-verses" placeholder="vv." aria-label="Verses" inputmode="text">
          <button type="button" class="point-del" aria-label="Remove point">×</button>
        </div>
        <div class="point-start"></div>
        <ul class="subs"></ul>
        <button type="button" class="text-link sub-add">+ Sub-point</button>
        <textarea class="point-notes" rows="1" placeholder="Notes"></textarea>`;
      const title = li.querySelector('.point-title'), vv = li.querySelector('.point-verses'), notes = li.querySelector('.point-notes');
      [title, vv, notes].forEach(keyboardOnPencil);
      renderSubs(p, li.querySelector('.subs'));
      li.querySelector('.sub-add').addEventListener('click', () => addSub(p, li.querySelector('.subs'), (p.subs || []).length));
      const start = li.querySelector('.point-start');
      title.value = p.title; vv.value = p.verses; notes.value = p.notes;
      const showStart = idx => {
        start.textContent = idx >= 0 ? '“' + openingWords(verses[idx].text) + '”' : (p.verses ? 'Those verses are not in this passage' : '');
        start.classList.toggle('bad', idx < 0 && !!p.verses);
      };
      showStart(starts[i]);
      autoGrow(notes);
      title.addEventListener('input', () => { p.title = title.value; save(); rescan(); remark(); });
      notes.addEventListener('input', () => { p.notes = notes.value; autoGrow(notes); save(); rescan(); });
      vv.addEventListener('input', () => {
        p.verses = vv.value; save();
        showStart(pointStarts(o.points, verses)[i]);
        remark();
        renderStrip();
      });
      li.querySelector('.point-del').addEventListener('click', () => {
        if ((p.title || p.notes || (p.subs || []).some(Boolean)) && !confirm(`Remove point ${i + 1}?`)) return;
        const prev = clone(o.points);
        o.points.splice(i, 1);
        const next = clone(o.points);
        pushAction({ undo: () => applyPoints(prev), redo: () => applyPoints(next) });
        save(); renderPoints(); renderStrip(); renderOptions(); marks.render(); rescan();
      });
      ol.appendChild(li);
    });
  }

  // Sub-points: one line each. Return adds the next one, Backspace on an empty one removes it.
  function renderSubs(p, ul) {
    ul.innerHTML = '';
    (p.subs || []).forEach((text, j) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="sub-mark">${String.fromCharCode(97 + (j % 26))}</span><input class="sub-input" placeholder="Sub-point" enterkeyhint="next">`;
      const inp = li.querySelector('input');
      inp.value = text;
      keyboardOnPencil(inp);
      inp.addEventListener('input', () => { p.subs[j] = inp.value; save(); rescan(); });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); addSub(p, ul, j + 1); }
        else if (e.key === 'Backspace' && !inp.value) {
          e.preventDefault();
          p.subs.splice(j, 1);
          save();
          renderSubs(p, ul);
          const ins = ul.querySelectorAll('input');
          if (ins[j - 1]) ins[j - 1].focus();
        }
      });
      ul.appendChild(li);
    });
  }

  function addSub(p, ul, at) {
    p.subs = p.subs || [];
    p.subs.splice(at, 0, '');
    save();
    renderSubs(p, ul);
    ul.querySelectorAll('input')[at]?.focus();
  }

  // On iPad, a Pencil tap on a text box normally opens the small handwriting (Scribble)
  // palette. Here a Pencil tap focuses the box directly, which brings up the keyboard.
  function keyboardOnPencil(el) {
    if (!el) return;
    let pen = false;
    el.addEventListener('touchstart', e => {
      pen = [...e.changedTouches].some(t => t.touchType === 'stylus');
      if (pen && document.activeElement !== el) e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchend', e => {
      if (!pen || document.activeElement === el) return;
      e.preventDefault();
      el.focus();
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch {}
    }, { passive: false });
  }

  // ---------- playing with the breakup ----------

  const clone = pts => pts.map(p => ({ ...p, subs: p.subs ? p.subs.slice() : undefined }));

  // Where the current points start (as verse indexes), not counting the first verse.
  function currentCuts() {
    return [...new Set(pointStarts(outline().points, verses).filter(i => i > 0))].sort((a, b) => a - b);
  }

  // New points for a set of cuts, keeping the title and notes of any point that still
  // starts in the same place. A point that is joined into another hands its notes on.
  function pointsFromCuts(cuts) {
    const old = outline().points, starts = pointStarts(old, verses);
    const secs = sectionsFromCuts(cuts, verses.length);
    const used = new Set();
    const pts = secs.map(sec => {
      const j = starts.findIndex((st, k) => st === sec.from && !used.has(k));
      const label = rangeLabel(verses[sec.from], verses[sec.to]);
      if (j >= 0) { used.add(j); return { ...old[j], verses: label }; }
      return { id: pid(), title: verses[sec.from].heading || '', verses: label, notes: '' };
    });
    old.forEach((p, k) => {
      if (used.has(k) || !(p.title || p.notes)) return;
      if (starts[k] < 0) { pts.push({ ...p }); return; } // verses typed by hand that are not in the passage
      const into = secs.findIndex(sec => starts[k] >= sec.from && starts[k] <= sec.to);
      const t = pts[into];
      t.notes = [t.notes, [p.title, p.notes].filter(Boolean).join(': ')].filter(Boolean).join('\n');
      if ((p.subs || []).some(Boolean)) t.subs = [...(t.subs || []), ...p.subs.filter(Boolean)];
    });
    return pts;
  }

  function applyPoints(pts) {
    outline().points = clone(pts);
    outline().showOnPage = true;
    save();
    if (!sheet.hidden && tab === 'outline') { renderPoints(); renderStrip(); renderOptions(); rescan(); }
    marks.render();
  }

  function applyCuts(cuts, message) {
    const prev = clone(outline().points);
    const next = pointsFromCuts(cuts);
    applyPoints(next);
    pushAction({ undo: () => applyPoints(prev), redo: () => applyPoints(next) });
    if (message) toast(message);
  }

  function toggleCut(vi) {
    if (vi <= 0 || vi >= verses.length) return;
    const cuts = currentCuts();
    const on = !cuts.includes(vi);
    const S = seams(verses)[vi];
    const v = verses[vi];
    const label = (v.v === 1 ? v.ch + ':1' : 'v. ' + v.v);
    applyCuts(on ? [...cuts, vi] : cuts.filter(c => c !== vi));
    const note = $('stripNote');
    const msg = on ? `Split before ${label}${S.why.length ? ' (' + S.why.join(', ') + ')' : ''}` : `Joined at ${label}`;
    if (note) note.textContent = msg;
    if (sheet.hidden || isSplitMode()) toast(msg);
  }

  function renderStrip() {
    const box = $('strip');
    if (!box) return;
    const cuts = currentCuts(), S = seams(verses);
    const secs = sectionsFromCuts(outline().points.length ? cuts : [], verses.length);
    const secOf = i => secs.findIndex(sec => i >= sec.from && i <= sec.to);
    box.innerHTML = '';
    verses.forEach((v, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const sec = outline().points.length ? secOf(i) : -1;
      b.className = 'vchip' + (cuts.includes(i) ? ' cut' : '') + (i === 0 ? ' first' : '');
      if (sec >= 0) b.style.setProperty('--c', SECTION_COLORS[sec % SECTION_COLORS.length]);
      const dots = Math.min(3, Math.round(S[i].s));
      b.innerHTML = `<span class="seam">${'•'.repeat(dots)}</span><span class="vn">${v.v === 1 ? v.ch + ':1' : v.v}</span>`;
      b.title = i === 0 ? 'Start of the passage' : (S[i].why.join(', ') || 'Mid-paragraph');
      b.setAttribute('aria-label', `Verse ${v.ch}:${v.v}. ${cuts.includes(i) ? 'Split here. Tap to join.' : 'Tap to split here.'}`);
      if (i > 0) b.addEventListener('click', () => toggleCut(i));
      box.appendChild(b);
    });
  }

  function renderOptions() {
    const box = $('options');
    if (!box) return;
    const cur = currentCuts().join(',');
    const n = verses.length;
    box.innerHTML = '';
    for (const opt of breakupOptions(verses)) {
      const secs = sectionsFromCuts(opt.cuts, n);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'option' + (opt.key === cur && outline().points.length ? ' on' : '');
      const bar = secs.map((sec, i) => `<span style="flex:${sec.to - sec.from + 1};--c:${SECTION_COLORS[i % SECTION_COLORS.length]}"></span>`).join('');
      b.innerHTML = `<div class="option-head"><b>${esc(opt.label)}</b><span>${secs.length} parts</span></div>
        <div class="option-bar">${bar}</div>
        <div class="option-ranges">${secs.map(sec => esc(rangeLabel(verses[sec.from], verses[sec.to]))).join(' · ')}</div>
        <div class="option-why">${esc(opt.why)}</div>`;
      b.addEventListener('click', () => applyCuts(opt.cuts, `${opt.label}: ${secs.length} parts. Undo to go back.`));
      box.appendChild(b);
    }
  }

  function syncSplitButton() {
    const b = $('splitModeBtn');
    if (!b) return;
    const on = isSplitMode();
    b.setAttribute('aria-pressed', on);
    b.classList.toggle('on', on);
    b.textContent = on ? 'Done splitting' : 'Split on the page';
  }

  // A tap on the page in split mode: split (or join) before the verse that was tapped.
  function splitAtKey(key) {
    if (!verses.length) verses = walkVerses(passageContainer(study().passage), study().passage.reference);
    const vi = verses.findIndex(v => v.key === key);
    if (vi === 0) { toast('That is the start of the passage'); return; }
    if (vi > 0) toggleCut(vi);
  }

  function suggest() {
    const secs = suggestBreakup(verses);
    applyCuts(secs.slice(1).map(sec => sec.from), `Split into ${secs.length} parts. Tap verses to adjust, or Undo.`);
  }

  function renderChecks() {
    const box = $('sensitivity');
    if (!box) return;
    const s = study(), o = s.outline;
    const sources = [
      { where: 'Big idea', text: o.bigIdea },
      ...o.points.flatMap((p, i) => [{ where: `Point ${i + 1}`, text: [p.title, ...(p.subs || []), p.notes].join('\n') }]),
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
      (p.subs || []).filter(Boolean).forEach((sub, j) => lines.push(`   ${String.fromCharCode(97 + (j % 26))}. ${sub}`));
      if (p.notes) lines.push(p.notes.replace(/^/gm, '   '));
      lines.push('');
    });
    const inked = k => o.pads && o.pads[k] && o.pads[k].strokes.length;
    if (o.application || inked('application')) lines.push('APPLICATION', o.application || '(handwritten, see the PDF)', '');
    if (o.illustrations || inked('illustrations')) lines.push('ILLUSTRATIONS', o.illustrations || '(handwritten, see the PDF)', '');
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
    splitAtKey,
    syncSplitButton,
  };
}

function autoGrow(t) {
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight + 2, 420) + 'px';
}
