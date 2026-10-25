import { Ink, PAGE_W } from './ink.js';
import { fetchPassage, passageFromText } from './bible.js';
import * as db from './db.js';
import { exportPdf } from './pdf.js';

const $ = id => document.getElementById(id);

// ---------- palettes & prefs ----------

const PALETTES = {
  pen: ['#1f1d1a', '#2f5d8a', '#c62828', '#2e7d32', '#6a1b9a', '#e65100', '#00838f', '#8d6e63'],
  highlighter: ['#ffd400', '#7ee36b', '#ff7eb6', '#6ec6ff', '#ffab40', '#c39bff'],
  text: ['#1f1d1a', '#2f5d8a', '#c62828', '#2e7d32', '#6a1b9a', '#e65100'],
};
const SIZES = {
  pen: [1.5, 3, 5],
  highlighter: [3, 4.5, 6],
  text: [16, 20, 28],
};
const DEFAULT_LAYOUT = { font: 26, spacing: 2.3, margin: 'right', verses: true, headings: true, footnotes: false };
const MARGINS = {
  right: { left: 70, width: 560 },
  both: { left: 210, width: 580 },
  none: { left: 70, width: 860 },
};

const loadJSON = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return { ...d }; } };
const prefs = loadJSON('letspreach.prefs', {
  tool: 'pen', zoom: 1, fingerDraw: false,
  color: { pen: PALETTES.pen[0], highlighter: PALETTES.highlighter[0], text: PALETTES.text[1] },
  size: { pen: 1, highlighter: 1, text: 1 },
});
const settings = loadJSON('letspreach.settings', { workerUrl: '' });
const savePrefs = () => localStorage.setItem('letspreach.prefs', JSON.stringify(prefs));
const saveSettings = () => localStorage.setItem('letspreach.settings', JSON.stringify(settings));

// ---------- state ----------

let study = null;
let undoStack = [], redoStack = [];
let saveTimer = null;

const scroller = $('scroller');
const pageBox = $('pageBox');
const page = $('page');
const passageEl = $('passage');
const notesEl = $('notes');

const ink = new Ink({
  scroller, pageBox,
  hlLayer: $('hlLayer'),
  inkLayer: $('inkLayer'),
  onAction: pushAction,
  onChange: scheduleSave,
  onTextTap: (x, y) => createNote(x, y),
  onNearBottom: () => { study.extraSpace += 600; relayout(); },
});

// ---------- history ----------

function pushAction(a) {
  undoStack.push(a);
  if (undoStack.length > 300) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}
function undo() {
  const a = undoStack.pop();
  if (!a) return;
  a.undo(); redoStack.push(a); updateUndoButtons(); scheduleSave();
}
function redo() {
  const a = redoStack.pop();
  if (!a) return;
  a.redo(); undoStack.push(a); updateUndoButtons(); scheduleSave();
}
function updateUndoButtons() {
  $('undoBtn').disabled = !undoStack.length;
  $('redoBtn').disabled = !redoStack.length;
}

// ---------- saving ----------

function scheduleSave() {
  if (!study) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
function saveNow() {
  clearTimeout(saveTimer);
  if (!study) return Promise.resolve();
  study.strokes = ink.strokes.map(({ bbox, ...s }) => s);
  study.updated = Date.now();
  return db.putStudy(study);
}
window.addEventListener('pagehide', () => saveNow());
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

// ---------- library ----------

async function showLibrary() {
  await saveNow();
  study = null;
  $('study').hidden = true;
  $('library').hidden = false;
  $('menuPanel').hidden = true;
  const list = (await db.allStudies()).sort((a, b) => b.updated - a.updated);
  const ul = $('studyList');
  ul.innerHTML = '';
  $('studiesBlock').hidden = list.length === 0;
  setGreeting();
  for (const s of list) {
    const li = document.createElement('li');
    li.className = 'study-item';
    const when = new Date(s.updated).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const sub = [s.passage.reference !== s.title ? s.passage.reference : '', s.passage.version, when].filter(Boolean).join(' · ');
    li.innerHTML = `<div class="meta"><div class="title"></div><div class="sub"></div></div><button class="del" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg></button>`;
    li.querySelector('.title').textContent = s.title;
    li.querySelector('.sub').textContent = sub;
    li.addEventListener('click', e => {
      if (e.target.closest('.del')) return;
      openStudy(s.id);
    });
    li.querySelector('.del').addEventListener('click', async () => {
      if (!confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
      await db.deleteStudy(s.id);
      showLibrary();
    });
    ul.appendChild(li);
  }
}

function newStudy(passage) {
  const now = Date.now();
  return {
    id: 's' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    title: passage.reference || 'Untitled',
    passage,
    layout: { ...DEFAULT_LAYOUT },
    strokes: [],
    notes: [],
    extraSpace: 1400,
    created: now,
    updated: now,
  };
}

async function createAndOpen(passage) {
  const s = newStudy(passage);
  await db.putStudy(s);
  openStudy(s.id);
}

$('fetchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const ref = $('refInput').value.trim();
  const version = $('versionSelect').value;
  if (!ref) return;
  const status = $('fetchStatus');
  const btn = $('fetchBtn');
  status.classList.remove('error');
  status.textContent = `Getting ${ref} (${version}) from Bible Gateway…`;
  btn.disabled = true;
  try {
    const passage = await fetchPassage(ref, version, settings.workerUrl, (i, n) => {
      if (i > 0) status.textContent = `Still trying (relay ${i + 1} of ${n})…`;
    });
    status.textContent = '';
    $('refInput').value = '';
    await createAndOpen(passage);
  } catch (err) {
    status.classList.add('error');
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('pasteBtn').addEventListener('click', () => {
  $('pasteRef').value = $('refInput').value.trim();
  $('pasteText').value = '';
  $('pasteDialog').showModal();
});
$('pasteDialog').addEventListener('close', () => {
  if ($('pasteDialog').returnValue !== 'ok') return;
  const text = $('pasteText').value;
  if (!text.trim()) return;
  createAndOpen(passageFromText($('pasteRef').value.trim(), text));
});
$('blankBtn').addEventListener('click', () => {
  createAndOpen({ reference: 'Blank page', version: '', parts: [], footnotes: [], copyright: '', source: 'blank' });
});

$('settingsBtn').addEventListener('click', () => {
  $('proxyInput').value = settings.workerUrl;
  $('settingsDialog').showModal();
});
$('settingsDialog').addEventListener('close', () => {
  if ($('settingsDialog').returnValue !== 'ok') return;
  settings.workerUrl = $('proxyInput').value.trim();
  saveSettings();
  toast(settings.workerUrl ? 'Fetcher saved' : 'Using public relays');
});

// Backup / restore
$('exportBtn').addEventListener('click', async () => {
  const all = await db.allStudies();
  const blob = new Blob([JSON.stringify({ app: 'letspreach', version: 1, studies: all })], { type: 'application/json' });
  const name = `lets-preach-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = data.studies || [];
    for (const s of list) if (s && s.id && s.passage) await db.putStudy(s);
    toast(`Restored ${list.length} ${list.length === 1 ? 'study' : 'studies'}`);
    showLibrary();
  } catch {
    toast('That file is not a Let\'s Preach backup');
  }
});

// ---------- study view ----------

async function openStudy(id) {
  const s = await db.getStudy(id);
  if (!s) return;
  study = s;
  study.layout = { ...DEFAULT_LAYOUT, ...study.layout };
  study.notes = study.notes || [];
  undoStack = []; redoStack = [];
  updateUndoButtons();

  $('library').hidden = true;
  $('study').hidden = false;
  $('studyTitle').value = study.title;
  renderPassage();
  renderNotes();
  ink.setStrokes(study.strokes || []);
  scroller.scrollTop = 0;
  relayout();
  setTool(prefs.tool);
}

function renderPassage() {
  const p = study.passage;
  const L = study.layout;
  let html = '';
  if (p.source !== 'blank') {
    html += `<div class="ref-version">${esc(p.version || 'Passage')}</div><div class="ref-heading">${esc(p.reference)}</div><span class="ref-dash"></span>`;
    p.parts.forEach((part, i) => {
      if (p.parts.length > 1 && part.ref) html += `<h4 class="part-ref">${esc(part.ref)}</h4>`;
      html += part.html;
    });
    if (p.footnotes && p.footnotes.length) {
      html += `<div class="footnotes"><strong>Footnotes</strong><ol>${p.footnotes.map(f => `<li>${esc(f)}</li>`).join('')}</ol></div>`;
    }
    if (p.copyright) html += `<div class="copyright">${esc(p.copyright)}</div>`;
  }
  passageEl.innerHTML = html;
  const m = MARGINS[L.margin] || MARGINS.right;
  passageEl.style.fontSize = L.font + 'px';
  passageEl.style.lineHeight = L.spacing;
  passageEl.style.marginLeft = m.left + 'px';
  passageEl.style.width = m.width + 'px';
  passageEl.classList.toggle('no-verses', !L.verses);
  passageEl.classList.toggle('no-headings', !L.headings);
  passageEl.classList.toggle('no-footnotes', !L.footnotes);
}

function relayout() {
  if (!study) return;
  const fit = scroller.clientWidth / PAGE_W;
  const scale = fit * prefs.zoom;
  const notesBottom = study.notes.reduce((m, n) => Math.max(m, n.y + 200), 0);
  const pageH = Math.ceil(Math.max(
    passageEl.offsetHeight + study.extraSpace,
    ink.maxInkY() + 500,
    notesBottom + 300,
    scroller.clientHeight / scale,
  ));
  page.style.transform = `scale(${scale})`;
  page.style.height = pageH + 'px';
  pageBox.style.width = PAGE_W * scale + 'px';
  pageBox.style.height = pageH * scale + 'px';
  ink.layout(scale, pageH);
}

new ResizeObserver(() => relayout()).observe(scroller);
new ResizeObserver(() => relayout()).observe(passageEl);
document.fonts && document.fonts.ready.then(relayout);

$('backBtn').addEventListener('click', showLibrary);
$('studyTitle').addEventListener('input', () => { study.title = $('studyTitle').value.trim() || 'Untitled'; scheduleSave(); });
$('studyTitle').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);

// ---------- tools ----------

function setTool(tool) {
  prefs.tool = tool;
  savePrefs();
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  $('study').classList.toggle('text-mode', tool === 'text');
  scroller.classList.toggle('allow-pan', tool === 'hand' || tool === 'text');
  $('menuPanel').hidden = true;
  if (tool !== 'text' && document.activeElement && document.activeElement.classList.contains('note')) document.activeElement.blur();
  ink.tool = tool;
  renderColors();
  renderSizes();
  applyToolStyle();
}

function applyToolStyle() {
  const t = prefs.tool;
  if (PALETTES[t]) ink.color = prefs.color[t];
  if (SIZES[t]) ink.size = SIZES[t][prefs.size[t]];
  document.querySelector('.tool[data-tool="highlighter"]').style.setProperty('--tool-color', prefs.color.highlighter);
}

function renderColors() {
  const g = $('colorGroup');
  g.innerHTML = '';
  const t = prefs.tool;
  const pal = PALETTES[t];
  g.hidden = !pal;
  if (!pal) return;
  pal.forEach(c => {
    const b = document.createElement('button');
    b.className = 'swatch' + (prefs.color[t] === c ? ' active' : '');
    b.style.background = c;
    b.setAttribute('aria-label', 'Colour ' + c);
    b.addEventListener('click', () => {
      prefs.color[t] = c; savePrefs(); applyToolStyle(); renderColors();
      const n = document.activeElement;
      if (t === 'text' && n && n.classList.contains('note')) updateNoteStyle(n.closest('.note-wrap').dataset.id, { color: c });
    });
    g.appendChild(b);
  });
}

function renderSizes() {
  const g = $('sizeGroup');
  g.innerHTML = '';
  const t = prefs.tool;
  const sizes = SIZES[t];
  g.hidden = !sizes;
  if (!sizes) return;
  sizes.forEach((sz, i) => {
    const b = document.createElement('button');
    b.className = 'size-btn' + (prefs.size[t] === i ? ' active' : '');
    const d = [6, 10, 15][i];
    b.innerHTML = t === 'text' ? `<b style="font-size:${[13, 17, 22][i]}px">A</b>` : `<span style="width:${d}px;height:${d}px"></span>`;
    b.setAttribute('aria-label', ['Small', 'Medium', 'Large'][i]);
    b.addEventListener('click', () => {
      prefs.size[t] = i; savePrefs(); applyToolStyle(); renderSizes();
      const n = document.activeElement;
      if (t === 'text' && n && n.classList.contains('note')) updateNoteStyle(n.closest('.note-wrap').dataset.id, { size: sz });
    });
    g.appendChild(b);
  });
}

document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

// ---------- text boxes ----------

function renderNotes() {
  notesEl.innerHTML = '';
  study.notes.forEach(n => notesEl.appendChild(noteEl(n)));
}

function noteEl(n) {
  const wrap = document.createElement('div');
  wrap.className = 'note-wrap';
  wrap.dataset.id = n.id;
  wrap.style.left = n.x + 'px';
  wrap.style.top = n.y + 'px';
  const box = document.createElement('div');
  box.className = 'note';
  try { box.contentEditable = 'plaintext-only'; } catch { box.contentEditable = 'true'; }
  if (box.contentEditable !== 'plaintext-only') box.contentEditable = 'true';
  box.textContent = n.text;
  box.style.color = n.color;
  box.style.fontSize = n.size + 'px';
  const del = document.createElement('button');
  del.className = 'note-del';
  del.textContent = '×';
  del.setAttribute('aria-label', 'Delete text box');
  const grip = document.createElement('div');
  grip.className = 'note-grip';
  wrap.append(grip, box, del);

  let before = n.text;
  box.addEventListener('focus', () => { before = noteById(n.id)?.text ?? ''; });
  box.addEventListener('input', () => { const m = noteById(n.id); if (m) { m.text = box.innerText; scheduleSave(); } });
  box.addEventListener('blur', () => {
    const m = noteById(n.id);
    if (!m) return;
    const text = box.innerText.replace(/\n+$/, '');
    m.text = text;
    if (m.isNew) {
      delete m.isNew;
      if (!text.trim()) { removeNote(m.id); return; }
      const copy = { ...m };
      pushAction({ undo: () => removeNote(copy.id), redo: () => addNote({ ...copy }) });
    } else if (text !== before) {
      const was = before;
      if (!text.trim()) {
        const copy = { ...m, text: was };
        removeNote(m.id);
        pushAction({ undo: () => addNote({ ...copy }), redo: () => removeNote(copy.id) });
      } else {
        pushAction({ undo: () => setNoteText(m.id, was), redo: () => setNoteText(m.id, text) });
      }
    }
    scheduleSave();
  });

  del.addEventListener('click', () => {
    const m = noteById(n.id);
    if (!m) return;
    const copy = { ...m };
    delete copy.isNew;
    removeNote(m.id);
    if (copy.text.trim()) pushAction({ undo: () => addNote({ ...copy }), redo: () => removeNote(copy.id) });
  });

  grip.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    const m = noteById(n.id);
    const start = { x: m.x, y: m.y, cx: e.clientX, cy: e.clientY };
    const move = ev => {
      m.x = Math.round(start.x + (ev.clientX - start.cx) / ink.scale);
      m.y = Math.round(start.y + (ev.clientY - start.cy) / ink.scale);
      wrap.style.left = m.x + 'px'; wrap.style.top = m.y + 'px';
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      const from = { x: start.x, y: start.y }, to = { x: m.x, y: m.y };
      if (from.x !== to.x || from.y !== to.y) {
        pushAction({ undo: () => moveNote(m.id, from), redo: () => moveNote(m.id, to) });
        scheduleSave();
        relayout();
      }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  return wrap;
}

const noteById = id => study.notes.find(n => n.id === id);
const noteWrap = id => notesEl.querySelector(`.note-wrap[data-id="${id}"]`);

function createNote(x, y) {
  const t = 'text';
  const n = {
    id: 'n' + Date.now().toString(36),
    x: Math.round(x), y: Math.round(y - 16),
    text: '', color: prefs.color[t], size: SIZES[t][prefs.size[t]], isNew: true,
  };
  study.notes.push(n);
  const el = noteEl(n);
  notesEl.appendChild(el);
  el.querySelector('.note').focus();
}
function addNote(n) { study.notes.push(n); notesEl.appendChild(noteEl(n)); scheduleSave(); relayout(); }
function removeNote(id) {
  study.notes = study.notes.filter(n => n.id !== id);
  const w = noteWrap(id); if (w) w.remove();
  scheduleSave();
}
function setNoteText(id, text) {
  const n = noteById(id); if (!n) return;
  n.text = text; const w = noteWrap(id); if (w) w.querySelector('.note').textContent = text;
}
function moveNote(id, { x, y }) {
  const n = noteById(id); if (!n) return;
  n.x = x; n.y = y; const w = noteWrap(id); if (w) { w.style.left = x + 'px'; w.style.top = y + 'px'; }
}
function updateNoteStyle(id, patch) {
  const n = noteById(id); if (!n) return;
  Object.assign(n, patch);
  const box = noteWrap(id).querySelector('.note');
  box.style.color = n.color; box.style.fontSize = n.size + 'px';
  scheduleSave();
}

// ---------- page options panel ----------

$('menuBtn').addEventListener('click', () => {
  const p = $('menuPanel');
  p.hidden = !p.hidden;
  if (!p.hidden) syncPanel();
});
$('menuClose').addEventListener('click', () => { $('menuPanel').hidden = true; });

function syncPanel() {
  const L = study.layout;
  $('fingerDraw').checked = prefs.fingerDraw;
  $('optVerses').checked = L.verses;
  $('optHeadings').checked = L.headings;
  $('optFootnotes').checked = L.footnotes;
  document.querySelectorAll('#spacingSeg button').forEach(b => b.classList.toggle('active', +b.dataset.spacing === L.spacing));
  document.querySelectorAll('#marginSeg button').forEach(b => b.classList.toggle('active', b.dataset.margin === L.margin));
  $('layoutWarn').hidden = !(ink.strokes.length || study.notes.length);
}

function changeLayout(patch) {
  const prev = { ...study.layout };
  study.layout = { ...study.layout, ...patch };
  const next = { ...study.layout };
  const apply = L => { study.layout = { ...L }; renderPassage(); relayout(); syncPanel(); scheduleSave(); };
  apply(next);
  pushAction({ undo: () => apply(prev), redo: () => apply(next) });
}

document.querySelectorAll('[data-font]').forEach(b => b.addEventListener('click', () => {
  const f = Math.max(16, Math.min(44, study.layout.font + 2 * +b.dataset.font));
  if (f !== study.layout.font) changeLayout({ font: f });
}));
document.querySelectorAll('[data-spacing]').forEach(b => b.addEventListener('click', () => changeLayout({ spacing: +b.dataset.spacing })));
document.querySelectorAll('[data-margin]').forEach(b => b.addEventListener('click', () => changeLayout({ margin: b.dataset.margin })));
$('optVerses').addEventListener('change', e => changeLayout({ verses: e.target.checked }));
$('optHeadings').addEventListener('change', e => changeLayout({ headings: e.target.checked }));
$('optFootnotes').addEventListener('change', e => changeLayout({ footnotes: e.target.checked }));

document.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => {
  const d = +b.dataset.zoom;
  const anchor = scroller.scrollTop / ink.scale;
  prefs.zoom = d === 0 ? 1 : Math.max(0.6, Math.min(2.5, prefs.zoom * (d > 0 ? 1.2 : 1 / 1.2)));
  savePrefs();
  relayout();
  scroller.scrollTop = anchor * ink.scale;
}));

$('addSpaceBtn').addEventListener('click', () => {
  study.extraSpace += 1000;
  relayout();
  scheduleSave();
  toast('Added more space at the bottom');
});

$('fingerDraw').addEventListener('change', e => {
  prefs.fingerDraw = e.target.checked;
  savePrefs();
  applyFingerDraw();
});
function applyFingerDraw() {
  ink.fingerDraw = prefs.fingerDraw;
  scroller.classList.toggle('finger-draw', prefs.fingerDraw);
}
applyFingerDraw();

$('clearInkBtn').addEventListener('click', () => {
  if (!ink.strokes.length) return;
  if (!confirm('Clear all pen and highlighter marks on this page? You can undo this.')) return;
  ink.clearAll();
  $('menuPanel').hidden = true;
});
$('deleteStudyBtn').addEventListener('click', async () => {
  if (!confirm(`Delete "${study.title}"? This cannot be undone.`)) return;
  const id = study.id;
  study = null;
  await db.deleteStudy(id);
  showLibrary();
});

// ---------- PDF ----------

async function doExportPdf() {
  if (!study) return;
  $('menuPanel').hidden = true;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  $('busy').hidden = false;
  try {
    await saveNow();
    const blob = await exportPdf({ page, passageEl, strokes: ink.strokes, pageH: ink.pageH, title: study.title });
    const name = (study.title || 'Study').replace(/[\\/:*?"<>|]+/g, '').trim() + '.pdf';
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
}
$('pdfBtn').addEventListener('click', doExportPdf);
$('pdfBtn2').addEventListener('click', doExportPdf);

// ---------- misc ----------

function setGreeting() {
  const h = new Date().getHours();
  $('greeting').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// Keyboard shortcuts (Magic Keyboard / Smart Keyboard)
document.addEventListener('keydown', e => {
  if (!study || e.target.closest('input, textarea, .note')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  const keys = { p: 'pen', h: 'highlighter', e: 'eraser', t: 'text' };
  if (!mod && keys[e.key]) setTool(keys[e.key]);
});

// Stop iOS pinch-zooming the whole interface.
document.addEventListener('gesturestart', e => e.preventDefault());

db.requestPersistence();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
showLibrary();
