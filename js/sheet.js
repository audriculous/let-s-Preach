// The side sheet beside a study: an Outline tab (big idea, breakup into points,
// application, illustrations, checks before preaching) and a Compare tab that shows
// other translations verse by verse with the differences marked.

import { walkVerses, passageContainer, suggestBreakup, rangeLabel, openingWords, pointStarts, diffWords, esc, seams, breakupOptions, sectionsFromCuts, isFree, pointNumbers, versePoints, FREE_KINDS } from './verses.js';
import { SECTION_COLORS } from './marks.js';
import { Pad, emptyPad } from './pad.js';
import { scanSensitive, CHECKLIST, logicChecks } from './checks.js';

export const VERSIONS = ['NIV', 'ESV', 'NASB', 'NASB1995', 'CSB', 'NKJV', 'KJV', 'NLT', 'NRSVUE'];

// Questions from Christ-centred (redemptive) preaching, to keep the sermon from
// becoming moralism and to sharpen the big idea.
export const PROMPTS = [
  { key: 'god', tag: 'God', q: 'What does this passage show about God?', hint: 'His character, promises and actions here.' },
  { key: 'fcf', tag: 'Our need', q: 'What fallen condition does it address?', hint: 'The need it spoke to for its first hearers, and the same need in the room today.' },
  { key: 'christ', tag: 'Christ', q: 'How does it point to Christ?', hint: 'Does it predict, prepare for, reflect, or result from his work? Where does it sit in the Bible\u2019s story?' },
  { key: 'response', tag: 'Response', q: 'What response of faith does it call for?', hint: 'Not just \u201Ctry harder\u201D: what does grace make possible, and why would we want it?' },
];

// The application grid: areas of life for a young-adult congregation. Pick two or
// three; specific beats general.
export const GRID = [
  { key: 'heart', tag: 'Heart', q: 'What should they believe, love, fear or hope differently?', hint: 'Under the behaviour: desires, fears, guilt, pride.' },
  { key: 'work', tag: 'Uni and work', q: 'Where does this meet study, work and ambition?', hint: 'Deadlines, bosses, career choices, the casual job, being known as a Christian there.' },
  { key: 'love', tag: 'Dating, singleness, marriage', q: 'What does it say to the single, the dating and the married?', hint: 'Speak to all three, not just one as the normal case.' },
  { key: 'home', tag: 'Family and home', q: 'How does it play out with parents, siblings and housemates?', hint: 'Leaving home, honouring parents, sharing a house.' },
  { key: 'online', tag: 'Friends and online', q: 'What changes in friendships, group chats and on their phone?', hint: 'Comparison, outrage, image, what they watch and scroll.' },
  { key: 'money', tag: 'Money and time', q: 'What does it mean for spending, rent, saving and weekends?', hint: 'Generosity, contentment, busyness, rest.' },
  { key: 'church', tag: 'Church family', q: 'How should it shape the way they belong, serve and love the church?', hint: 'Growth groups, serving, the people who are hard to love.' },
  { key: 'outsider', tag: 'The friend who doesn\u2019t believe', q: 'How would this land with a non-Christian friend? What would they push back on?', hint: 'Answer the objection, and give believers words to share it.' },
  { key: 'hurting', tag: 'The one who is hurting', q: 'What comfort or hope does it give someone grieving, anxious, doubting or ashamed?', hint: 'Say it gently. Avoid quick fixes for real pain.' },
];

// Grid answers that have something in them, in grid order: [{ key, tag, text, pad }].
export function gridAnswers(o) {
  const g = o.grid || {};
  return GRID.filter(a => (g.on || []).includes(a.key) && g.a && g.a[a.key])
    .map(a => ({ key: a.key, tag: a.tag, q: a.q, text: g.a[a.key].text || '', pad: g.a[a.key].pad }))
    .filter(a => a.text.trim() || (a.pad && a.pad.strokes.length));
}

export function emptyOutline() {
  return { bigIdea: '', points: [], application: '', illustrations: '', pads: {}, checks: {}, showOnPage: true };
}

const $ = id => document.getElementById(id);
const pid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export function initSheet({ getStudy, save, marks, fetchPassage, getWorker, toast, pushAction, setSplitMode, isSplitMode, pen, fingerDraw, renderRefs, renderPlan, renderObserve }) {
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
    $('planPane').hidden = tab !== 'plan';
    $('observePane').hidden = tab !== 'observe';
    verses = walkVerses(passageContainer(study().passage), study().passage.reference);
    if (tab === 'outline') renderOutline(); else if (tab === 'compare') renderCompare(); else if (tab === 'plan') renderPlan(); else if (tab === 'observe') renderObserve(verses); else renderRefs();
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
        <p class="eyebrow">Christ-centred</p>
        <button type="button" class="text-link" id="ccToggle"></button>
      </div>
      <div id="cc"></div>

      <div class="sheet-row">
        <p class="eyebrow">Breakup</p>
        <button type="button" class="chip-btn small" id="suggestBtn">Suggest a breakup</button>
      </div>
      ${verses.length > 1 ? `
      <p class="hint">Tap the verse a point ends on, tap again to join. Dots show natural seams before a verse: headings, new paragraphs and words like “therefore”.</p>
      <div class="strip" id="strip"></div>
      <p class="strip-note" id="stripNote"></p>
      <div class="sheet-row tight">
        <button type="button" class="chip-btn small" id="splitModeBtn" aria-pressed="false">Split on the page</button>
        <button type="button" class="text-link" id="clearSplitsBtn">Clear splits</button>
      </div>
      <p class="eyebrow sub">Try a different breakup</p>
      <div class="options" id="options"></div>` : '<p class="hint">This passage has no verse numbers, so add points by hand.</p>'}
      <ol class="points" id="points"></ol>
      <div class="sheet-row tight point-adds">
        <button type="button" class="text-link" id="addPointBtn">+ Add a point</button>
        <button type="button" class="text-link" id="addFreeBtn">+ Add a point without verses</button>
      </div>
      <label class="opt-row"><span>Show the breakup on the page</span><input type="checkbox" class="switch" id="showBreakup"></label>
      <label class="opt-row"><span>Show point titles in the text</span><input type="checkbox" class="switch" id="showTitles"></label>

      <p class="eyebrow">Application</p>
      <p class="hint">Write with the Pencil. What does this mean on Monday for the young adults in the room?</p>
      ${o.application ? '<textarea class="field sheet-field" data-f="application" rows="2"></textarea>' : ''}
      <div id="padApplication"></div>
      <div class="sheet-row">
        <p class="eyebrow sub">Application grid</p>
        <button type="button" class="text-link" id="gridToggle"></button>
      </div>
      <div id="grid"></div>

      <p class="eyebrow">Illustrations</p>
      <p class="hint">Write with the Pencil. Stories, pictures, quotes.</p>
      ${o.illustrations ? '<textarea class="field sheet-field" data-f="illustrations" rows="2"></textarea>' : ''}
      <div id="padIllustrations"></div>

      <div id="wordsBox"></div>

      <p class="eyebrow">Tighten the logic</p>
      <div id="logic"></div>

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
      const pad = new Pad($(id), o.pads[key], { onChange: () => { save(); rescan(); }, pushAction, pen, fingerDraw });
      requestAnimationFrame(() => pad.render());
    }
    keyboardOnPencil(pane.querySelector('[data-f=bigIdea]'));
    renderPrompts();
    renderGrid();
    renderWords();
    $('gridToggle').addEventListener('click', () => { o.grid = o.grid || {}; o.grid.hidden = !o.grid.hidden; save(); renderGrid(); });
    $('ccToggle').addEventListener('click', () => { o.ccHidden = !o.ccHidden; save(); renderPrompts(); });
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
      // A verse point goes before the application point at the end, if there is one.
      const at = o.points.length && o.points[o.points.length - 1].kind === 'apply' ? o.points.length - 1 : o.points.length;
      o.points.splice(at, 0, { id: pid(), title: '', verses: '', notes: '' });
      save(); renderPoints();
      pane.querySelectorAll('.point-title')[at]?.focus();
    });
    $('addFreeBtn').addEventListener('click', () => {
      const missing = !o.points.some(p => p.kind === 'intro') ? 'intro' : !o.points.some(p => p.kind === 'apply') ? 'apply' : 'free';
      const item = freePoint(missing);
      if (missing === 'intro') o.points.unshift(item);
      else if (missing === 'apply') o.points.push(item);
      else o.points.splice(Math.max(0, o.points.length - (o.points[o.points.length - 1]?.kind === 'apply' ? 1 : 0)), 0, item);
      save(); renderPoints(); marks.render(); rescan();
      if (missing === 'free') toast('Drag it by its handle to where it belongs');
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
    const nums = pointNumbers(o.points);
    o.points.forEach((p, i) => {
      const free = isFree(p);
      const li = document.createElement('li');
      li.className = 'point' + (free ? ' free ' + (p.kind || 'free') : '');
      li.dataset.i = i;
      const name = free ? (FREE_KINDS[p.kind] || 'Extra') : 'Point ' + nums[i];
      const ph = p.kind === 'intro' ? 'Heading or hook' : p.kind === 'apply' ? 'Bring it home' : free ? 'Title' : 'Point ' + nums[i];
      li.innerHTML = `
        <div class="point-head">
          ${free ? `<span class="point-grip" aria-label="Drag to move" title="Drag to move"><svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg></span>
            <span class="point-kind">${esc(name)}</span>`
          : `<span class="point-num" style="--c:${SECTION_COLORS[(nums[i] - 1) % SECTION_COLORS.length]}">${nums[i]}</span>`}
          <input class="point-title" placeholder="${esc(ph)}" spellcheck="true">
          ${free ? '' : '<input class="point-verses" placeholder="vv." aria-label="Verses" inputmode="text">'}
          <button type="button" class="point-del" aria-label="Remove ${esc(name)}">×</button>
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
      title.value = p.title; notes.value = p.notes || '';
      const showStart = idx => {
        start.textContent = idx >= 0 ? '“' + openingWords(verses[idx].text) + '”' : (p.verses ? 'Those verses are not in this passage' : '');
        start.classList.toggle('bad', idx < 0 && !!p.verses);
      };
      if (!free) { vv.value = p.verses; showStart(starts[i]); }
      autoGrow(notes);
      title.addEventListener('input', () => { p.title = title.value; save(); rescan(); remark(); });
      notes.addEventListener('input', () => { p.notes = notes.value; autoGrow(notes); save(); rescan(); });
      if (vv) vv.addEventListener('input', () => {
        p.verses = vv.value; save(); rescan();
        showStart(pointStarts(o.points, verses)[i]);
        remark();
        renderStrip();
      });
      li.querySelector('.point-del').addEventListener('click', () => {
        if ((p.title || p.notes || (p.subs || []).some(Boolean)) && !confirm(`Remove ${free ? 'the ' + name.toLowerCase() : 'point ' + nums[i]}?`)) return;
        const prev = clone(o.points);
        o.points.splice(i, 1);
        const next = clone(o.points);
        pushAction({ undo: () => applyPoints(prev), redo: () => applyPoints(next) });
        save(); renderPoints(); renderStrip(); renderOptions(); marks.render(); rescan();
      });
      if (free) dragByGrip(li, i);
      ol.appendChild(li);
    });
  }

  const freePoint = kind => ({ id: pid(), free: true, kind, title: '', verses: '', notes: '' });

  // The intro and application points go round the breakup the first time there is one.
  // Remove either and it stays removed.
  function frame(pts) {
    const o = outline();
    if (o.framed || !versePoints(pts).length) return pts;
    o.framed = true;
    const out = pts.slice();
    if (!out.some(p => p.kind === 'intro')) out.unshift(freePoint('intro'));
    if (!out.some(p => p.kind === 'apply')) out.push(freePoint('apply'));
    return out;
  }

  // Drag a point that is not tied to verses up or down the list by its handle.
  function dragByGrip(li, from) {
    const grip = li.querySelector('.point-grip');
    grip.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const ol = $('points');
      const items = [...ol.children];
      const rect = li.getBoundingClientRect();
      const centers = items.map(x => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; });
      const startY = e.clientY;
      let to = from;
      li.classList.add('dragging');
      try { grip.setPointerCapture(e.pointerId); } catch {}
      const move = ev => {
        if (ev.pointerId !== e.pointerId) return;
        const dy = ev.clientY - startY;
        li.style.transform = `translateY(${dy}px)`;
        const mid = rect.top + rect.height / 2 + dy;
        to = from;
        items.forEach((other, k) => {
          if (other === li) return;
          const c = centers[k];
          if (k < from && mid < c) to = Math.min(to, k);
          if (k > from && mid > c) to = Math.max(to, k);
        });
        // Show the gap where it will land.
        items.forEach((other, k) => {
          if (other === li) return;
          const shift = from < to && k > from && k <= to ? -rect.height - 10 : from > to && k >= to && k < from ? rect.height + 10 : 0;
          other.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      };
      const up = ev => {
        if (ev.pointerId !== e.pointerId) return;
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        items.forEach(x => { x.style.transform = ''; });
        li.classList.remove('dragging');
        if (to === from) return;
        const o = outline();
        const prev = clone(o.points);
        const [it] = o.points.splice(from, 1);
        o.points.splice(to, 0, it);
        const next = clone(o.points);
        pushAction({ undo: () => applyPoints(prev), redo: () => applyPoints(next) });
        save(); renderPoints(); marks.render(); rescan();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  }

  // Christ-centred prompts: handwrite (or type) an answer to each.
  function renderPrompts() {
    const o = outline(), box = $('cc');
    if (!box) return;
    o.cc = o.cc || {};
    $('ccToggle').textContent = o.ccHidden ? 'Show prompts' : 'Hide';
    box.hidden = !!o.ccHidden;
    box.innerHTML = '';
    if (o.ccHidden) return;
    for (const pr of PROMPTS) {
      const a = o.cc[pr.key] = o.cc[pr.key] || { text: '', mode: 'write', pad: emptyPad(130) };
      box.appendChild(answerCard(pr, a, renderPrompts));
    }
  }

  // One prompt with its answer: handwritten on a pad, or typed.
  function answerCard(pr, a, rerender, extra = '') {
    const div = document.createElement('div');
    div.className = 'cc';
    div.innerHTML = `<div class="cc-head"><span class="cc-tag">${esc(pr.tag)}</span><span class="cc-q">${esc(pr.q)}</span>${extra}</div>
      <p class="cc-hint">${esc(pr.hint)}</p><div class="cc-body"></div>
      <button type="button" class="text-link cc-mode">${a.mode === 'type' ? 'Write with the Pencil instead' : 'Type instead'}</button>`;
    const body = div.querySelector('.cc-body');
    if (a.mode === 'type') {
      const t = document.createElement('textarea');
      t.className = 'field sheet-field';
      t.rows = 2;
      t.value = a.text;
      t.addEventListener('input', () => { a.text = t.value; autoGrow(t); save(); rescan(); });
      body.appendChild(t);
      keyboardOnPencil(t);
      requestAnimationFrame(() => autoGrow(t));
    } else {
      if (a.text) { const p = document.createElement('p'); p.className = 'cc-typed'; p.textContent = a.text; body.appendChild(p); }
      const pad = new Pad(body, a.pad, { onChange: () => { save(); rescan(); }, pushAction, pen, fingerDraw });
      requestAnimationFrame(() => pad.render());
    }
    div.querySelector('.cc-mode').addEventListener('click', () => { a.mode = a.mode === 'type' ? 'write' : 'type'; save(); rerender(); });
    return div;
  }

  // The application grid: tap areas of life to open them, then write or type.
  function renderGrid() {
    const o = outline(), box = $('grid');
    if (!box) return;
    const g = o.grid = o.grid || {};
    g.on = g.on || []; g.a = g.a || {};
    $('gridToggle').textContent = g.hidden ? 'Show' : 'Hide';
    box.hidden = !!g.hidden;
    box.innerHTML = '';
    if (g.hidden) return;
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Pick two or three areas of life where this passage bites. Specific beats general.';
    box.appendChild(hint);
    const chips = document.createElement('div');
    chips.className = 'grid-chips';
    for (const area of GRID) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'grid-chip' + (g.on.includes(area.key) ? ' on' : '');
      b.textContent = area.tag;
      b.setAttribute('aria-pressed', g.on.includes(area.key));
      b.addEventListener('click', () => {
        if (g.on.includes(area.key)) g.on = g.on.filter(k => k !== area.key); // what was written stays, ready if it is opened again
        else g.on = GRID.map(x => x.key).filter(k => k === area.key || g.on.includes(k));
        save(); renderGrid(); rescan();
      });
      chips.appendChild(b);
    }
    box.appendChild(chips);
    for (const area of GRID) {
      if (!g.on.includes(area.key)) continue;
      const a = g.a[area.key] = g.a[area.key] || { text: '', mode: 'write', pad: emptyPad(130) };
      box.appendChild(answerCard(area, a, renderGrid));
    }
    if (g.on.length > 4) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = `${g.on.length} areas open. A sermon usually lands better hitting two or three hard than everything lightly.`;
      box.appendChild(p);
    }
  }

  // Words kept from word study.
  function renderWords() {
    const o = outline(), box = $('wordsBox');
    if (!box) return;
    const list = o.words || [];
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<p class="eyebrow">Word studies</p><ul class="word-list"></ul>';
    const ul = box.querySelector('ul');
    list.forEach((w, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<div><span class="wl-orig"></span> <span class="wl-tr"></span> <b class="wl-gloss"></b></div><div class="wl-meta"></div>
        <textarea class="point-notes" rows="1" placeholder="What it adds to the sermon"></textarea><button type="button" class="point-del" aria-label="Remove">×</button>`;
      li.querySelector('.wl-orig').textContent = w.lemma;
      li.querySelector('.wl-tr').textContent = w.tr;
      li.querySelector('.wl-gloss').textContent = w.gloss;
      li.querySelector('.wl-meta').textContent = [`“${w.english}” in ${w.ref}`, w.here].filter(Boolean).join(' · ');
      const t = li.querySelector('textarea');
      t.value = w.note || '';
      keyboardOnPencil(t);
      requestAnimationFrame(() => autoGrow(t));
      t.addEventListener('input', () => { w.note = t.value; autoGrow(t); save(); });
      li.querySelector('.point-del').addEventListener('click', () => { o.words.splice(i, 1); save(); renderWords(); });
      ul.appendChild(li);
    });
  }

  function renderLogic() {
    const box = $('logic');
    if (!box) return;
    const o = outline();
    const vp = versePoints(o.points);
    const results = logicChecks({ outline: { ...o, points: vp }, starts: pointStarts(vp, verses), verseCount: verses.length, grid: gridAnswers(o) });
    const good = results.filter(r => r.ok), look = results.filter(r => !r.ok);
    box.innerHTML = `<p class="hint">${look.length ? `${good.length} of ${results.length} look good. Worth a look:` : 'Everything checks out. Read it aloud once to be sure it flows.'}</p>` +
      look.map(r => `<div class="logic-card"><b>${esc(r.label)}</b> ${esc(r.note)}</div>`).join('') +
      (good.length ? `<p class="logic-ok">${good.map(r => `<span title="${esc(r.note)}">✓ ${esc(r.label)}</span>`).join('')}</p>` : '');
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
    const all = outline().points;
    // Free points (intro, application, extras) keep their place: remember how many
    // verse points came before each, and put them back after the same number.
    const freeAt = [];
    let seen = 0;
    for (const p of all) { if (isFree(p)) freeAt.push({ p, after: seen }); else seen++; }
    const old = versePoints(all), starts = pointStarts(old, verses);
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
    // Anything that sat after the last verse point (the application) stays at the end.
    const out = [];
    pts.forEach((p, k) => {
      for (const f of freeAt) if (f.after === k && f.after < seen) out.push({ ...f.p });
      out.push(p);
    });
    for (const f of freeAt) if (f.after >= seen || f.after >= pts.length) out.push({ ...f.p });
    return frame(out);
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

  // Tap the verse a point ends on: the next point starts on the verse after it.
  function toggleEnd(ei) {
    if (ei === verses.length - 1) { toast('That is the end of the passage'); return; }
    toggleCut(ei + 1);
  }

  function toggleCut(vi) {
    if (vi <= 0 || vi >= verses.length) return;
    const cuts = currentCuts();
    const on = !cuts.includes(vi);
    const S = seams(verses)[vi];
    const end = verses[vi - 1];
    const label = (end.v === 1 ? end.ch + ':1' : 'v. ' + end.v);
    applyCuts(on ? [...cuts, vi] : cuts.filter(c => c !== vi));
    const note = $('stripNote');
    const msg = on ? `A point ends at ${label}${S.why.length ? ' (next verse: ' + S.why.join(', ') + ')' : ''}` : `Joined after ${label}`;
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
      const ends = cuts.includes(i + 1);
      b.classList.toggle('end', ends);
      b.setAttribute('aria-label', `Verse ${v.ch}:${v.v}. ${ends ? 'A point ends here. Tap to join.' : 'Tap to end a point here.'}`);
      b.addEventListener('click', () => toggleEnd(i));
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

  // A tap on the page in split mode: end a point at the verse that was tapped (or join).
  function splitAtKey(key) {
    if (!verses.length) verses = walkVerses(passageContainer(study().passage), study().passage.reference);
    const vi = verses.findIndex(v => v.key === key);
    if (vi >= 0) toggleEnd(vi);
  }

  function suggest() {
    const secs = suggestBreakup(verses);
    applyCuts(secs.slice(1).map(sec => sec.from), `Split into ${secs.length} parts. Tap verses to adjust, or Undo.`);
  }

  function renderChecks() {
    renderLogic();
    const box = $('sensitivity');
    if (!box) return;
    const s = study(), o = s.outline;
    const sources = [
      { where: 'Big idea', text: o.bigIdea },
      ...PROMPTS.map(pr => ({ where: pr.tag, text: o.cc && o.cc[pr.key] ? o.cc[pr.key].text : '' })),
      ...o.points.map((p, i) => ({ where: isFree(p) ? FREE_KINDS[p.kind] || 'Extra' : `Point ${pointNumbers(o.points)[i]}`, text: [p.title, ...(p.subs || []), p.notes].join('\n') })),
      { where: 'Application', text: o.application },
      { where: 'Illustrations', text: o.illustrations },
      ...gridAnswers(o).map(a => ({ where: a.tag, text: a.text })),
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
    for (const pr of PROMPTS) {
      const a = o.cc && o.cc[pr.key];
      if (a && (a.text || (a.pad && a.pad.strokes.length))) lines.push(pr.tag.toUpperCase(), a.text || '(handwritten, see the PDF)', '');
    }
    const nums = pointNumbers(o.points);
    o.points.forEach((p, i) => {
      if (isFree(p)) lines.push(`${(FREE_KINDS[p.kind] || 'Extra').toUpperCase()}${p.title ? ': ' + p.title : ''}`);
      else lines.push(`${nums[i]}. ${p.title || 'Point ' + nums[i]}${p.verses ? ' (' + p.verses + ')' : ''}`);
      (p.subs || []).filter(Boolean).forEach((sub, j) => lines.push(`   ${String.fromCharCode(97 + (j % 26))}. ${sub}`));
      if (p.notes) lines.push(p.notes.replace(/^/gm, '   '));
      lines.push('');
    });
    const inked = k => o.pads && o.pads[k] && o.pads[k].strokes.length;
    if (o.application || inked('application')) lines.push('APPLICATION', o.application || '(handwritten, see the PDF)', '');
    const grid = gridAnswers(o);
    if (grid.length) {
      lines.push('APPLICATION GRID');
      for (const a of grid) lines.push(`${a.tag}: ${a.text || '(handwritten, see the PDF)'}`);
      lines.push('');
    }
    if (o.illustrations || inked('illustrations')) lines.push('ILLUSTRATIONS', o.illustrations || '(handwritten, see the PDF)', '');
    if ((o.words || []).length) {
      lines.push('WORD STUDIES');
      for (const w of o.words) lines.push(`${w.lemma} (${w.tr}), ${w.gloss}: “${w.english}” in ${w.ref}${w.note ? '. ' + w.note : ''}`);
      lines.push('');
    }
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
    get tab() { return tab; },
    rescan,
    renderWords,
    splitAtKey,
    syncSplitButton,
  };
}

function autoGrow(t) {
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight + 2, 420) + 'px';
}
