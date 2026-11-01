// Listening: sermon notes for when someone else is preaching. Kept apart from sermon
// prep (its own home tab, list and page), but saved in the same store with
// kind: 'listen', so sync, backups and restore carry them too.

import { Pad, emptyPad } from './pad.js';
import { esc } from './verses.js';

export const LISTEN_PROMPTS = [
  { key: 'notes', label: 'Notes', hint: 'Write as you listen.', h: 700 },
  { key: 'big', label: 'The big idea', hint: 'The one thing the sermon was saying.', h: 120 },
  { key: 'jesus', label: 'Where was Jesus?', hint: 'How did the passage point to him?', h: 120 },
  { key: 'remember', label: 'To remember', hint: 'What struck you, surprised you or stung.', h: 140 },
  { key: 'do', label: 'This week', hint: 'One thing to do, change or tell someone.', h: 120 },
  { key: 'ask', label: 'Questions', hint: 'To look into, or to ask the preacher or your growth group.', h: 120 },
  { key: 'pray', label: 'Pray', hint: 'For yourself and for others.', h: 120 },
];

const $ = id => document.getElementById(id);
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const niceDate = d => d ? new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const isListen = s => s && s.kind === 'listen';
export const noteTitle = n => n.title || (n.passage && n.passage.reference) || 'Sermon notes';
const hasInk = a => a && a.pad && a.pad.strokes.length;
const hasAny = a => a && (String(a.text || '').trim() || hasInk(a));

export function initListen({ db, fetchPassage, getWorker, getVersion, toast, pen, fingerDraw, exportNotesPdf, onSaved, showHome }) {
  let note = null, saveTimer = null, undoStack = [], redoStack = [];

  // ---------- home: new notes and the list ----------

  async function renderHome() {
    const all = (await db.allStudies()).filter(isListen).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updated - a.updated);
    $('lnPreachers').innerHTML = [...new Set(all.map(n => n.preacher).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('');
    $('lnPlaces').innerHTML = [...new Set(all.map(n => n.where).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('');
    if (!$('lnDate').value) $('lnDate').value = isoToday();
    if (!$('lnWhere').value && all[0]) $('lnWhere').value = all[0].where || '';
    const q = $('lnSearch').value.trim().toLowerCase();
    const text = n => [noteTitle(n), n.preacher, n.where, n.passage && n.passage.reference, ...Object.values(n.sections || {}).map(a => a.text)].join(' ').toLowerCase();
    const list = all.filter(n => !q || q.split(/\s+/).every(w => text(n).includes(w)));
    $('lnTools').hidden = all.length < 4;
    $('lnListHead').hidden = !all.length;
    const ul = $('listenList');
    ul.innerHTML = '';
    $('lnEmpty').hidden = !(all.length && !list.length);
    for (const n of list) {
      const li = document.createElement('li');
      li.className = 'study-item';
      const sub = [n.preacher, n.passage && n.passage.reference !== noteTitle(n) ? n.passage.reference : '', n.where, niceDate(n.date)].filter(Boolean).join(' · ');
      li.innerHTML = `<div class="meta"><div class="title"></div><div class="sub"></div></div><button class="del" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg></button>`;
      li.querySelector('.title').textContent = noteTitle(n);
      li.querySelector('.sub').textContent = sub;
      li.addEventListener('click', e => { if (!e.target.closest('.del')) open(n.id); });
      li.querySelector('.del').addEventListener('click', async () => {
        if (!confirm(`Delete your notes on “${noteTitle(n)}”?`)) return;
        await db.deleteStudy(n.id);
        onSaved(true);
        renderHome();
      });
      ul.appendChild(li);
    }
  }

  $('lnSearch').addEventListener('input', renderHome);
  $('lnStart').addEventListener('click', async () => {
    const now = Date.now();
    const n = {
      id: 'l' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      kind: 'listen',
      title: $('lnTitle').value.trim(),
      preacher: $('lnPreacher').value.trim(),
      where: $('lnWhere').value.trim(),
      date: $('lnDate').value || isoToday(),
      passage: { reference: $('lnPassage').value.trim(), version: '', parts: [], source: 'listen' },
      sections: {},
      created: now, updated: now, modified: now,
    };
    await db.putStudy(n);
    onSaved();
    $('lnTitle').value = ''; $('lnPassage').value = '';
    open(n.id);
  });

  // ---------- the notes page ----------

  async function open(id) {
    note = await db.getStudy(id);
    if (!note) return;
    note.sections = note.sections || {};
    undoStack = []; redoStack = [];
    syncUndo();
    $('library').hidden = true;
    $('listenView').hidden = false;
    window.scrollTo(0, 0);
    $('lvScroll').scrollTop = 0;
    render();
  }

  async function close() {
    await saveNow();
    note = null;
    $('listenView').hidden = true;
    showHome();
  }
  $('lvBack').addEventListener('click', close);

  function schedule() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 500); }
  async function saveNow() {
    clearTimeout(saveTimer);
    if (!note) return;
    note.updated = note.modified = Date.now();
    await db.putStudy(note);
    onSaved();
  }
  window.addEventListener('pagehide', () => { if (note) saveNow(); });

  function pushAction(a) { undoStack.push(a); redoStack = []; syncUndo(); }
  function syncUndo() { $('lvUndo').disabled = !undoStack.length; $('lvRedo').disabled = !redoStack.length; }
  $('lvUndo').addEventListener('click', () => { const a = undoStack.pop(); if (a) { a.undo(); redoStack.push(a); schedule(); } syncUndo(); });
  $('lvRedo').addEventListener('click', () => { const a = redoStack.pop(); if (a) { a.redo(); undoStack.push(a); schedule(); } syncUndo(); });

  function render() {
    const n = note;
    $('lvTitle').value = noteTitle(n) === 'Sermon notes' && !n.title ? '' : n.title || '';
    $('lvTitle').placeholder = (n.passage && n.passage.reference) || 'Sermon notes';
    $('lvPreacher').value = n.preacher || '';
    $('lvWhere').value = n.where || '';
    $('lvDate').value = n.date || '';
    $('lvPassageRef').value = (n.passage && n.passage.reference) || '';
    renderPassage();
    renderSections();
  }

  for (const [id, key] of [['lvTitle', 'title'], ['lvPreacher', 'preacher'], ['lvWhere', 'where'], ['lvDate', 'date']]) {
    $(id).addEventListener('input', () => { if (note) { note[key] = $(id).value.trim(); schedule(); } });
  }
  $('lvPassageRef').addEventListener('change', () => {
    if (!note) return;
    const ref = $('lvPassageRef').value.trim();
    if (ref === note.passage.reference) return;
    note.passage = { reference: ref, version: '', parts: [], source: 'listen' };
    $('lvTitle').placeholder = ref || 'Sermon notes';
    schedule();
    renderPassage();
  });

  // The passage, fetched once and kept with the notes so it reads offline.
  function renderPassage() {
    const box = $('lvPassage'), p = note.passage || {};
    if (!p.reference) { box.innerHTML = ''; return; }
    if (!(p.parts || []).length) {
      box.innerHTML = `<button type="button" class="chip-btn small" id="lvFetch">Show ${esc(p.reference)}</button>`;
      $('lvFetch').addEventListener('click', async () => {
        const b = $('lvFetch');
        b.disabled = true; b.textContent = `Getting ${p.reference}…`;
        try {
          const got = await fetchPassage(p.reference, getVersion(), getWorker());
          if (note.passage !== p) return;
          note.passage = { reference: got.reference, version: got.version, parts: got.parts, copyright: got.copyright, source: 'listen' };
          note.showPassage = true;
          schedule();
          renderPassage();
        } catch (err) {
          b.disabled = false; b.textContent = `Show ${p.reference}`;
          toast(err.message);
        }
      });
      return;
    }
    box.innerHTML = `<div class="sheet-row"><p class="eyebrow">${esc(p.reference)}${p.version ? ' · ' + esc(p.version) : ''}</p>
      <button type="button" class="text-link" id="lvTogglePassage">${note.showPassage ? 'Hide' : 'Show'}</button></div>
      <div class="ln-passage ref-text"${note.showPassage ? '' : ' hidden'}>${p.parts.map(part => (p.parts.length > 1 ? `<div class="ref-part">${esc(part.ref)}</div>` : '') + part.html).join('')}${p.copyright ? `<p class="cmp-copy">${esc(p.copyright)}</p>` : ''}</div>`;
    $('lvTogglePassage').addEventListener('click', () => { note.showPassage = !note.showPassage; schedule(); renderPassage(); });
  }

  function renderSections() {
    const box = $('lvSections');
    box.innerHTML = '';
    const shown = LISTEN_PROMPTS.filter(pr => pr.key === 'notes' || !note.hidePrompts || hasAny(note.sections[pr.key]));
    for (const pr of shown) {
      const a = note.sections[pr.key] = note.sections[pr.key] || { text: '', mode: 'write', pad: emptyPad(pr.h) };
      const div = document.createElement('div');
      div.className = 'ln-sec' + (pr.key === 'notes' ? ' main' : '');
      div.innerHTML = `<div class="ln-head"><p class="eyebrow">${esc(pr.label)}</p><span class="cc-hint">${esc(pr.hint)}</span></div><div class="ln-body"></div>
        <button type="button" class="text-link cc-mode">${a.mode === 'type' ? 'Write with the Pencil instead' : 'Type instead'}</button>`;
      const body = div.querySelector('.ln-body');
      if (a.mode === 'type') {
        const t = document.createElement('textarea');
        t.className = 'field sheet-field';
        t.rows = pr.key === 'notes' ? 10 : 2;
        t.value = a.text;
        const grow = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };
        t.addEventListener('input', () => { a.text = t.value; grow(); schedule(); });
        body.appendChild(t);
        requestAnimationFrame(grow);
      } else {
        if (a.text) { const p = document.createElement('p'); p.className = 'cc-typed'; p.textContent = a.text; body.appendChild(p); }
        const pad = new Pad(body, a.pad, { onChange: schedule, pushAction, pen, fingerDraw });
        requestAnimationFrame(() => pad.render());
      }
      div.querySelector('.cc-mode').addEventListener('click', () => { a.mode = a.mode === 'type' ? 'write' : 'type'; schedule(); renderSections(); });
      box.appendChild(div);
    }
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'text-link ln-prompts';
    t.textContent = note.hidePrompts ? 'Show the reflection prompts' : 'Just notes, no prompts';
    t.addEventListener('click', () => { note.hidePrompts = !note.hidePrompts; schedule(); renderSections(); });
    box.appendChild(t);
  }

  function sectionsForExport() {
    return LISTEN_PROMPTS.map(pr => ({ label: pr.label, ...(note.sections[pr.key] || {}) }));
  }

  $('lvShare').addEventListener('click', async () => {
    if (!note) return;
    await saveNow();
    $('busy').hidden = false;
    try {
      const n = note;
      const blob = await exportNotesPdf({
        title: noteTitle(n),
        eyebrow: ['Sermon notes', n.where].filter(Boolean).join('  ·  '),
        meta: [n.preacher, n.passage && n.passage.reference !== noteTitle(n) ? n.passage.reference : '', niceDate(n.date)].filter(Boolean).join(' · '),
        sections: sectionsForExport(),
      });
      const name = noteTitle(n).replace(/[\\/:*?"<>|]+/g, '').trim() + ' notes.pdf';
      const file = new File([blob], name, { type: 'application/pdf' });
      $('busy').hidden = true;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (err) {
      console.error(err);
      toast('Could not make the PDF');
    } finally {
      $('busy').hidden = true;
    }
  });

  // Typed parts as text, for a message to a friend or your growth group.
  $('lvCopy').addEventListener('click', async () => {
    if (!note) return;
    const n = note;
    const lines = [noteTitle(n), [n.preacher, n.passage && n.passage.reference !== noteTitle(n) ? n.passage.reference : '', niceDate(n.date)].filter(Boolean).join(' · '), ''];
    let typed = 0, inked = 0;
    for (const pr of LISTEN_PROMPTS) {
      const a = n.sections[pr.key];
      if (a && String(a.text || '').trim()) { lines.push(pr.label.toUpperCase(), a.text.trim(), ''); typed++; }
      else if (hasInk(a)) inked++;
    }
    if (!typed) { toast(inked ? 'Your notes are handwritten. Use Share PDF instead.' : 'Nothing typed yet'); return; }
    const text = lines.join('\n').trim() + '\n';
    if (navigator.share) { try { await navigator.share({ title: noteTitle(n), text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not share the text'); }
  });

  return { renderHome, open, get isOpen() { return !!note; }, get openId() { return note && note.id; } };
}
