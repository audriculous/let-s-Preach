import { Ink, PAGE_W } from './ink.js';
import { fetchPassage, passageFromText } from './bible.js';
import * as db from './db.js';
import { exportPdf } from './pdf.js';
import { Ruler } from './ruler.js';
import { Marks, SPOT_COLORS } from './marks.js';
import { initSheet, emptyOutline } from './sheet.js';
import { initSync, makeSyncCode, timeAgo } from './sync.js';
import { initRefs } from './refs.js';
import { walkVerses } from './verses.js';

const $ = id => document.getElementById(id);

// ---------- palettes & prefs ----------

const PALETTES = {
  pen: ['#1f1d1a', '#2f5d8a', '#c62828', '#2e7d32', '#6a1b9a', '#e65100', '#00838f', '#8d6e63'],
  highlighter: ['#ffd400', '#7ee36b', '#ff7eb6', '#6ec6ff', '#ffab40', '#c39bff'],
  text: ['#1f1d1a', '#2f5d8a', '#c62828', '#2e7d32', '#6a1b9a', '#e65100'],
};
const SIZES = {
  pen: [0.9, 1.4, 2, 2.8, 3.8, 5.2],
  highlighter: [2.5, 3.5, 4.5, 6],
  text: [16, 20, 28],
};
const SHAPES = {
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5"/><path d="M10.5 5H19v8.5"/>',
  box: '<rect x="4.5" y="6" width="15" height="12" rx="1.2"/>',
  oval: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
};
const DEFAULT_LAYOUT = { font: 26, spacing: 2.3, margin: 'right', verses: true, headings: true, markers: true, footnotes: false };
const MARGINS = {
  right: { left: 70, width: 560 },
  both: { left: 210, width: 580 },
  none: { left: 70, width: 860 },
};

const loadJSON = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return { ...d }; } };
const prefs = loadJSON('letspreach.prefs', {
  tool: 'pen', zoom: 1, fingerDraw: false, smoothing: 2, snapShapes: true, scribbleErase: true, shapeKind: 'line',
  color: { pen: PALETTES.pen[0], highlighter: PALETTES.highlighter[0], text: PALETTES.text[1] },
  size: { pen: 2, highlighter: 1, text: 1 }, sizesV: 2,
});
if (prefs.sizesV !== 2) { // there used to be three pen and highlighter sizes
  prefs.size = { ...prefs.size, pen: [1, 2, 4][prefs.size.pen] ?? 2, highlighter: [0, 1, 3][prefs.size.highlighter] ?? 1 };
  prefs.sizesV = 2;
}
const settings = loadJSON('letspreach.settings', { workerUrl: '', syncCode: '', syncOn: true });
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
  overlay: $('overlay'),
  onAction: pushAction,
  onChange: scheduleSave,
  onTextTap: (x, y) => createNote(x, y),
  onWordTap: (x, y) => spotWordAt(x, y),
  onNearBottom: () => { study.extraSpace += 600; relayout(); },
});
window.__ink = ink; // handy for debugging from the console
const ruler = new Ruler(ink, pageBox);
ink.ruler = ruler;
const marks = new Marks({ page, passageEl, layer: $('marks') });
const refs = initRefs({
  getStudy: () => study,
  save: () => scheduleSave(),
  fetchPassage,
  getWorker: () => settings.workerUrl,
  toast,
  openPassage: p => createAndOpen(p),
});
const sheet = initSheet({
  renderRefs: () => refs.renderTab(),
  getStudy: () => study,
  save: () => scheduleSave(),
  marks,
  fetchPassage,
  getWorker: () => settings.workerUrl,
  toast,
  pushAction: a => pushAction(a),
  setSplitMode: on => setSplitMode(on),
  isSplitMode: () => ink.tool === 'split',
  pen: () => ({ color: prefs.color.pen, size: SIZES.pen[prefs.size.pen] ?? SIZES.pen[2], smoothing: prefs.smoothing }),
  fingerDraw: () => prefs.fingerDraw,
});
const sync = initSync({
  settings, saveSettings,
  getOpenId: () => study && study.id,
  onRemoteChange: () => { if (!study) renderLibrary(); },
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
  ink.clearSelection();
  a.undo(); redoStack.push(a); updateUndoButtons(); scheduleSave();
}
function redo() {
  const a = redoStack.pop();
  if (!a) return;
  ink.clearSelection();
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
  study.updated = study.modified = Date.now();
  sync.schedule();
  return db.putStudy(study);
}
window.addEventListener('pagehide', () => saveNow());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveNow().then(() => sync.syncNow()).catch(() => {});
  else sync.syncNow().catch(() => {});
});

// ---------- library ----------

let libFilter = null; // { type: 'series' | 'tag', value }

async function showLibrary() {
  const leaving = !!study; // the app's first load already syncs below
  await saveNow();
  study = null;
  sheet.close();
  ruler.hide();
  $('rulerBtn').classList.remove('on');
  $('study').hidden = true;
  $('library').hidden = false;
  $('menuPanel').hidden = true;
  setGreeting();
  await renderLibrary();
  if (leaving) sync.syncNow().catch(() => {});
}

const tagsOf = s => (s.tags || []).filter(Boolean);

function matches(s, q) {
  if (libFilter) {
    if (libFilter.type === 'series' && (s.series || '') !== libFilter.value) return false;
    if (libFilter.type === 'tag' && !tagsOf(s).some(t => t.toLowerCase() === libFilter.value.toLowerCase())) return false;
  }
  if (!q) return true;
  const hay = [s.title, s.passage.reference, s.series, ...tagsOf(s), ...(s.notes || []).map(n => n.text),
    s.outline && s.outline.bigIdea, ...(s.outline ? s.outline.points.map(p => p.title) : [])].join(' ').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

async function renderLibrary() {
  const all = (await db.allStudies()).sort((a, b) => b.updated - a.updated);
  const q = $('searchInput').value.trim().toLowerCase();
  renderFilters(all);
  const list = all.filter(s => matches(s, q));
  const pinned = list.filter(s => s.pinned), rest = list.filter(s => !s.pinned);
  $('pinnedList').innerHTML = '';
  $('studyList').innerHTML = '';
  $('libTools').hidden = all.length < 2;
  $('pinnedBlock').hidden = pinned.length === 0;
  $('studiesBlock').hidden = rest.length === 0;
  $('noMatches').hidden = !(all.length && !list.length);
  for (const s of list) {
    const ul = s.pinned ? $('pinnedList') : $('studyList');
    const li = document.createElement('li');
    li.className = 'study-item';
    const when = new Date(s.updated).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const preached = s.preached ? 'Preached ' + new Date(s.preached + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : when;
    const sub = [s.passage.reference !== s.title ? s.passage.reference : '', s.passage.version, preached].filter(Boolean).join(' · ');
    li.innerHTML = `<div class="meta">${s.series ? `<div class="series-tag">${esc(s.series)}</div>` : ''}<div class="title"></div><div class="sub"></div>${tagsOf(s).length ? `<div class="tags">${tagsOf(s).map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}</div><button class="pin${s.pinned ? ' on' : ''}" aria-label="${s.pinned ? 'Unpin' : 'Pin to top'}" title="${s.pinned ? 'Unpin' : 'Pin to top'}"><svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v5"/></svg></button><button class="del" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg></button>`;
    li.querySelector('.title').textContent = s.title;
    li.querySelector('.sub').textContent = sub;
    li.addEventListener('click', e => {
      if (e.target.closest('.del, .pin')) return;
      openStudy(s.id);
    });
    li.querySelector('.pin').addEventListener('click', async () => {
      s.pinned = !s.pinned; // pinning leaves the "last edited" date alone
      s.modified = Date.now();
      await db.putStudy(s);
      sync.schedule(5000);
      renderLibrary();
    });
    li.querySelector('.del').addEventListener('click', async () => {
      if (!confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
      await db.deleteStudy(s.id);
      sync.recordDelete(s.id);
      renderLibrary();
    });
    ul.appendChild(li);
  }
}

function renderFilters(all) {
  const series = [...new Set(all.map(s => s.series).filter(Boolean))].sort();
  const tags = [...new Map(all.flatMap(tagsOf).map(t => [t.toLowerCase(), t])).values()].sort((a, b) => a.localeCompare(b));
  $('seriesList').innerHTML = series.map(x => `<option value="${esc(x)}">`).join('');
  const box = $('filterChips');
  box.innerHTML = '';
  if (libFilter && !(libFilter.type === 'series' ? series.includes(libFilter.value) : tags.some(t => t.toLowerCase() === libFilter.value.toLowerCase()))) libFilter = null;
  const chip = (label, f, cls) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter-chip ' + cls + ((f === null ? !libFilter : libFilter && libFilter.type === f.type && libFilter.value === f.value) ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', () => { libFilter = f && libFilter && libFilter.type === f.type && libFilter.value === f.value ? null : f; renderLibrary(); });
    box.appendChild(b);
  };
  if (!series.length && !tags.length) return;
  chip('All', null, '');
  series.forEach(x => chip(x, { type: 'series', value: x }, 'series'));
  tags.forEach(t => chip('#' + t, { type: 'tag', value: t }, 'tag'));
}

let searchTimer;
$('searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderLibrary, 120); });

function newStudy(passage) {
  const now = Date.now();
  return {
    id: 's' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    title: passage.reference || 'Untitled',
    passage,
    layout: { ...DEFAULT_LAYOUT },
    strokes: [],
    notes: [],
    spots: [],
    outline: emptyOutline(),
    series: '',
    tags: [],
    extraSpace: 1400,
    created: now,
    updated: now,
    modified: now,
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
  $('syncCodeInput').value = settings.syncCode || '';
  $('syncOn').checked = settings.syncOn !== false;
  $('backupList').hidden = true;
  syncStatusText();
  $('settingsDialog').showModal();
});
$('syncCodeInput').addEventListener('input', syncStatusText);
$('settingsDialog').addEventListener('close', () => {
  if ($('settingsDialog').returnValue !== 'ok') return;
  settings.workerUrl = $('proxyInput').value.trim();
  saveSettings();
  settings.syncCode = $('syncCodeInput').value.trim();
  settings.syncOn = $('syncOn').checked;
  saveSettings();
  if (sync.enabled()) {
    toast('Saved. Syncing…');
    sync.syncNow().then(r => toast(r.pulled ? `Synced. ${r.pulled} change${r.pulled === 1 ? '' : 's'} from your other devices` : 'Synced'))
      .catch(e => toast(e.message));
  } else {
    toast(settings.workerUrl ? 'Fetcher saved' : 'Using public relays');
  }
});

function syncStatusText() {
  const el = $('syncStatus');
  if (!settings.workerUrl) { el.textContent = 'Sync needs your Worker URL above.'; el.classList.remove('error'); return; }
  if (!$('syncCodeInput').value.trim()) { el.textContent = 'Make a code here, then type the same code on your other device.'; el.classList.remove('error'); return; }
  el.textContent = sync.state.status || (settings.lastSync ? 'Last synced ' + timeAgo(settings.lastSync) : 'Not synced yet.');
  if (settings.lastBackupDay) el.textContent += ` Last cloud backup ${settings.lastBackupDay}.`;
  el.classList.toggle('error', sync.state.error);
}
$('newCodeBtn').addEventListener('click', () => {
  if ($('syncCodeInput').value.trim() && !confirm('Make a new code? Your other devices will need the new code too.')) return;
  $('syncCodeInput').value = makeSyncCode();
  syncStatusText();
});
$('copyCodeBtn').addEventListener('click', async () => {
  const v = $('syncCodeInput').value.trim();
  if (!v) return;
  try { await navigator.clipboard.writeText(v); toast('Code copied'); } catch { $('syncCodeInput').select(); }
});
$('syncNowBtn').addEventListener('click', async () => {
  const before = { ...settings };
  settings.workerUrl = $('proxyInput').value.trim();
  settings.syncCode = $('syncCodeInput').value.trim();
  settings.syncOn = true;
  $('syncOn').checked = true;
  $('syncStatus').textContent = 'Syncing…';
  try {
    const r = await sync.syncNow();
    await sync.backupNow();
    saveSettings();
    $('syncStatus').classList.remove('error');
    syncStatusText();
    toast(`Synced and backed up${r.pulled ? `. ${r.pulled} change${r.pulled === 1 ? '' : 's'} came in` : ''}`);
  } catch (e) {
    Object.assign(settings, before);
    $('syncStatus').textContent = e.message;
    $('syncStatus').classList.add('error');
  }
});
$('cloudBackupsBtn').addEventListener('click', async () => {
  const ul = $('backupList');
  if (!ul.hidden) { ul.hidden = true; return; }
  const code = $('syncCodeInput').value.trim();
  if (!settings.workerUrl || !code) { toast('Add your Worker URL and sync code first'); return; }
  const before = settings.syncCode;
  settings.syncCode = code;
  ul.hidden = false;
  ul.innerHTML = '<li>Loading…</li>';
  try {
    const days = await sync.listBackups();
    ul.innerHTML = days.length ? '' : '<li>No cloud backups yet. One is saved each day you use the app.</li>';
    for (const d of days) {
      const li = document.createElement('li');
      const label = new Date(d.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      li.innerHTML = `<span>${esc(label)}${d.count != null ? ` · ${d.count} stud${d.count === 1 ? 'y' : 'ies'}` : ''}</span><button type="button" class="chip-btn">Restore</button>`;
      li.querySelector('button').addEventListener('click', async () => {
        if (!confirm(`Restore the studies from ${label}? Any study in that backup replaces the copy on this device. Studies made since are kept.`)) return;
        try {
          const n = await sync.restoreBackup(d.day);
          toast(`Restored ${n} ${n === 1 ? 'study' : 'studies'}`);
          $('settingsDialog').close();
          renderLibrary();
        } catch (e) { toast(e.message); }
      });
      ul.appendChild(li);
    }
  } catch (e) {
    ul.innerHTML = `<li>${esc(e.message)}</li>`;
  } finally {
    settings.syncCode = before;
  }
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
    for (const s of list) if (s && s.id && s.passage) { s.modified = Date.now(); await db.putStudy(s); }
    toast(`Restored ${list.length} ${list.length === 1 ? 'study' : 'studies'}`);
    sync.schedule(3000);
    renderLibrary();
  } catch {
    toast('That file is not a Let\'s Preach backup');
  }
});

// ---------- study view ----------

async function openStudy(id) {
  const s = await db.getStudy(id);
  if (!s) return;
  study = s;
  // Studies from before the letters option: keep their text exactly where it was.
  if (study.layout && study.layout.markers === undefined) study.layout.markers = !!study.layout.footnotes;
  study.layout = { ...DEFAULT_LAYOUT, ...study.layout };
  study.notes = study.notes || [];
  study.spots = study.spots || [];
  study.outline = { ...emptyOutline(), ...(study.outline || {}) };
  study.tags = study.tags || [];
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
  marks.setStudy(study);
  setTool(prefs.tool);
  sheet.render();
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
      html += `<div class="footnotes"><strong>Footnotes</strong><ol>${p.footnotes.map(f => `<li>${esc(typeof f === 'string' ? f : f.text)}</li>`).join('')}</ol></div>`;
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
  passageEl.classList.toggle('no-markers', !L.markers);
  marks.invalidate();
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
new ResizeObserver(() => { relayout(); if (study) { marks.invalidate(); marks.render(); } }).observe(passageEl);
document.fonts && document.fonts.ready.then(() => { relayout(); if (study) { marks.invalidate(); marks.render(); } });

$('backBtn').addEventListener('click', showLibrary);
$('studyTitle').addEventListener('input', () => { study.title = $('studyTitle').value.trim() || 'Untitled'; scheduleSave(); });
$('studyTitle').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);

// ---------- tools ----------

// Split mode: tap a verse on the page to split the passage there (or join it again).
function setSplitMode(on) {
  if (on) {
    ink.clearSelection();
    ink.tool = 'split';
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    $('spotBar').hidden = true;
    $('colorGroup').hidden = $('sizeGroup').hidden = true;
    scroller.classList.add('allow-pan');
    $('study').classList.add('split-mode');
    toast('Tap a verse on the page to split before it. Tap again to join.');
  } else if (ink.tool === 'split') {
    $('study').classList.remove('split-mode');
    setTool(prefs.tool);
  }
  sheet.syncSplitButton();
}

function setTool(tool) {
  if (!document.querySelector(`.tool[data-tool="${tool}"]`)) tool = 'pen';
  $('study').classList.remove('split-mode');
  prefs.tool = tool;
  savePrefs();
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  $('study').classList.toggle('text-mode', tool === 'text');
  scroller.classList.toggle('allow-pan', tool === 'hand' || tool === 'text' || tool === 'spot');
  if (tool !== 'lasso') ink.clearSelection();
  $('spotBar').hidden = tool !== 'spot';
  if (tool === 'spot') renderSpotBar();
  $('menuPanel').hidden = true;
  if (tool !== 'text' && document.activeElement && document.activeElement.classList.contains('note')) document.activeElement.blur();
  ink.tool = tool;
  sheet.syncSplitButton();
  renderColors();
  renderSizes();
  applyToolStyle();
}

// Shapes share the pen's colour and thickness; the lasso shows the pen colours to recolour a selection.
const paletteKey = t => (t === 'shape' || t === 'lasso' ? 'pen' : t);

function applyToolStyle() {
  const t = paletteKey(prefs.tool);
  if (PALETTES[t]) ink.color = prefs.color[t];
  if (SIZES[t]) ink.size = SIZES[t][prefs.size[t]] ?? SIZES[t][1];
  ink.shapeKind = prefs.shapeKind;
  document.querySelector('.tool[data-tool="highlighter"]').style.setProperty('--tool-color', prefs.color.highlighter);
}

function renderColors() {
  const g = $('colorGroup');
  g.innerHTML = '';
  const lasso = prefs.tool === 'lasso';
  const t = paletteKey(prefs.tool);
  const pal = PALETTES[t];
  g.hidden = !pal;
  if (!pal) return;
  pal.forEach(c => {
    const b = document.createElement('button');
    b.className = 'swatch' + (!lasso && prefs.color[t] === c ? ' active' : '');
    b.style.background = c;
    b.setAttribute('aria-label', (lasso ? 'Recolour selection ' : 'Colour ') + c);
    b.addEventListener('click', () => {
      if (lasso) { if (!ink.recolorSelection(c)) toast('Draw a loop around some ink first, then pick a colour'); return; }
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
  if (prefs.tool === 'lasso') { g.hidden = true; return; }
  const t = paletteKey(prefs.tool);
  const sizes = SIZES[t];
  g.hidden = !sizes;
  if (!sizes) return;
  if (prefs.tool === 'shape') {
    for (const [kind, icon] of Object.entries(SHAPES)) {
      const b = document.createElement('button');
      b.className = 'size-btn kind' + (prefs.shapeKind === kind ? ' active' : '');
      b.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg>`;
      b.setAttribute('aria-label', kind[0].toUpperCase() + kind.slice(1));
      b.title = b.getAttribute('aria-label');
      b.addEventListener('click', () => { prefs.shapeKind = kind; savePrefs(); applyToolStyle(); renderSizes(); });
      g.appendChild(b);
    }
    const sep = document.createElement('span');
    sep.className = 'tb-sep';
    g.appendChild(sep);
  }
  sizes.forEach((sz, i) => {
    const b = document.createElement('button');
    b.className = 'size-btn' + (prefs.size[t] === i ? ' active' : '');
    const d = t === 'pen' ? Math.round(3 + sz * 2.3) : 6 + i * 3;
    b.innerHTML = t === 'text' ? `<b style="font-size:${[13, 17, 22][i]}px">A</b>` : `<span style="width:${d}px;height:${d}px"></span>`;
    b.setAttribute('aria-label', t === 'text' ? ['Small', 'Medium', 'Large'][i] : `Thickness ${i + 1} of ${sizes.length}`);
    b.addEventListener('click', () => {
      prefs.size[t] = i; savePrefs(); applyToolStyle(); renderSizes();
      const n = document.activeElement;
      if (t === 'text' && n && n.classList.contains('note')) updateNoteStyle(n.closest('.note-wrap').dataset.id, { size: sz });
    });
    g.appendChild(b);
  });
}

document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

$('rulerBtn').addEventListener('click', () => {
  const on = ruler.toggle();
  $('rulerBtn').classList.toggle('on', on);
  $('rulerBtn').setAttribute('aria-pressed', on);
  if (on && !['pen', 'highlighter'].includes(prefs.tool)) setTool('pen');
  if (on) toast('Drag the ruler with one finger, turn it with two. Draw along its edge.');
});
$('outlineBtn').addEventListener('click', () => sheet.toggle());

// ---------- word spotting ----------

function setSpots(next, connectives = study.connectives) {
  const prev = { spots: study.spots.slice(), connectives: !!study.connectives };
  const after = { spots: next, connectives: !!connectives };
  const apply = st => { study.spots = st.spots.slice(); study.connectives = st.connectives; marks.render(); renderSpotBar(); scheduleSave(); };
  apply(after);
  pushAction({ undo: () => apply(prev), redo: () => apply(after) });
}

function spotWordAt(x, y) {
  if (ink.tool === 'split') {
    const key = marks.verseAt(x, y);
    if (key) sheet.splitAtKey(key);
    return;
  }
  const w = marks.wordAt(x, y);
  if (!w) return;
  toggleSpot(w.norm, w.lower === 'god' || w.lower === 'lord' ? w.text : w.lower);
}

function toggleSpot(norm, label) {
  if (study.spots.some(s => s.norm === norm)) { setSpots(study.spots.filter(s => s.norm !== norm)); return; }
  const used = new Set(study.spots.map(s => s.color));
  const color = SPOT_COLORS.find(c => !used.has(c)) || SPOT_COLORS[study.spots.length % SPOT_COLORS.length];
  setSpots([...study.spots, { norm, label, color }]);
  const n = marks.count(norm);
  toast(`“${label}” appears ${n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times'}`);
}

function renderSpotBar() {
  if (!study || $('spotBar').hidden) return;
  const chips = $('spotChips');
  chips.innerHTML = '';
  for (const sp of study.spots) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'spot-chip';
    b.style.setProperty('--c', sp.color);
    b.innerHTML = `<span></span><span class="n">${marks.count(sp.norm)}</span><span class="x" aria-hidden="true">×</span>`;
    b.firstChild.textContent = sp.label;
    b.setAttribute('aria-label', `Stop spotting ${sp.label}`);
    b.addEventListener('click', () => toggleSpot(sp.norm, sp.label));
    chips.appendChild(b);
  }
  $('connBtn').setAttribute('aria-pressed', !!study.connectives);
  const sug = $('spotSuggest');
  sug.innerHTML = '';
  const reps = marks.repeats();
  $('repeatLabel').hidden = !reps.length;
  for (const r of reps) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'spot-chip suggest';
    b.innerHTML = `<span></span><span class="n">${r.n}</span>`;
    b.firstChild.textContent = r.label;
    b.addEventListener('click', () => toggleSpot(r.norm, r.label));
    sug.appendChild(b);
  }
  $('spotClear').hidden = !(study.spots.length || study.connectives);
}
$('connBtn').addEventListener('click', () => setSpots(study.spots.slice(), !study.connectives));
$('spotClear').addEventListener('click', () => setSpots([], false));

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
  box.addEventListener('input', () => { const m = noteById(n.id); if (m) { m.text = box.innerText; scheduleSave(); sheet.rescan(); } });
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
  $('seriesInput').value = study.series || '';
  $('tagsInput').value = (study.tags || []).join(', ');
  $('preachedInput').value = study.preached || '';
  db.allStudies().then(all => {
    $('seriesList').innerHTML = [...new Set(all.map(s => s.series).filter(Boolean))].sort().map(x => `<option value="${esc(x)}">`).join('');
  });
  $('fingerDraw').checked = prefs.fingerDraw;
  $('snapShapes').checked = prefs.snapShapes;
  $('scribbleErase').checked = prefs.scribbleErase;
  document.querySelectorAll('#smoothSeg button').forEach(b => b.classList.toggle('active', +b.dataset.smooth === prefs.smoothing));
  $('optVerses').checked = L.verses;
  $('optHeadings').checked = L.headings;
  $('optFootnotes').checked = L.footnotes;
  $('optMarkers').checked = L.markers;
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

$('seriesInput').addEventListener('input', e => { study.series = e.target.value.trim(); scheduleSave(); });
$('tagsInput').addEventListener('input', e => {
  study.tags = [...new Set(e.target.value.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean))];
  scheduleSave();
});
$('preachedInput').addEventListener('change', e => { study.preached = e.target.value || ''; scheduleSave(); });

document.querySelectorAll('[data-font]').forEach(b => b.addEventListener('click', () => {
  const f = Math.max(16, Math.min(44, study.layout.font + 2 * +b.dataset.font));
  if (f !== study.layout.font) changeLayout({ font: f });
}));
document.querySelectorAll('[data-spacing]').forEach(b => b.addEventListener('click', () => changeLayout({ spacing: +b.dataset.spacing })));
document.querySelectorAll('[data-margin]').forEach(b => b.addEventListener('click', () => changeLayout({ margin: b.dataset.margin })));
$('optVerses').addEventListener('change', e => changeLayout({ verses: e.target.checked }));
$('optHeadings').addEventListener('change', e => changeLayout({ headings: e.target.checked }));
$('optFootnotes').addEventListener('change', e => changeLayout({ footnotes: e.target.checked }));
$('optMarkers').addEventListener('change', e => changeLayout({ markers: e.target.checked }));

// A finger tap on a footnote or cross-reference letter, or on a verse number, shows its card.
passageEl.addEventListener('click', e => {
  const el = e.target.closest('sup.fn, sup.xr, sup.versenum, .chapternum');
  if (!el || !study || ink.tool === 'split') return;
  if (e.pointerType === 'mouse' && !['hand', 'text', 'spot'].includes(ink.tool)) return; // a mouse click there was drawing
  const v = el.matches('sup.versenum, .chapternum') ? walkVerses(passageEl, study.passage.reference).find(x => x.el === el) : null;
  refs.tapped(el, v && v.key);
});

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
document.querySelectorAll('[data-smooth]').forEach(b => b.addEventListener('click', () => {
  prefs.smoothing = +b.dataset.smooth;
  ink.smoothing = prefs.smoothing;
  savePrefs();
  syncPanel();
}));
ink.smoothing = prefs.smoothing;
ink.snapShapes = prefs.snapShapes;
ink.scribbleErase = prefs.scribbleErase;
$('scribbleErase').addEventListener('change', e => {
  prefs.scribbleErase = ink.scribbleErase = e.target.checked;
  savePrefs();
});
$('snapShapes').addEventListener('change', e => {
  prefs.snapShapes = ink.snapShapes = e.target.checked;
  savePrefs();
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
  sync.recordDelete(id);
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
    marks.render();
    const blob = await exportPdf({ page, passageEl, strokes: ink.strokes, pageH: ink.pageH, title: study.title, marks: marks.items, study });
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
  if (!study || e.target.closest('input, textarea, select, .note, dialog')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { if (ink.selection) { e.preventDefault(); ink.deleteSelection(); } return; }
  const keys = { p: 'pen', h: 'highlighter', e: 'eraser', t: 'text', l: 'lasso', s: 'shape', w: 'spot' };
  if (!mod && keys[e.key]) setTool(keys[e.key]);
});

// Stop iOS pinch-zooming the whole interface.
document.addEventListener('gesturestart', e => e.preventDefault());

db.requestPersistence();
sync.syncNow().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
showLibrary();
