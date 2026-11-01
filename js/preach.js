// Preach mode: a PDF (an imported manuscript, or a study's own PDF) full screen, with a
// sermon timer, a lock against stray touches, and the screen kept awake.

import * as db from './db.js';
import { drawStroke } from './ink.js';

const $ = id => document.getElementById(id);
const TIMER_KEY = 'letspreach.timer';
const TARGETS = [10, 15, 20, 25, 30, 35, 40, 45];
const HOLD_MS = 900;
const INK_COLORS = ['#1f1d1a', '#c62828', '#2f5d8a', '#2e7d32'];
const HL_COLORS = ['#ffd400', '#7ee36b', '#ff7eb6', '#6ec6ff'];
const U = 1000; // ink is kept in page units: the full page width is 1000

// The part of the page with anything on it, across the first few pages, as fractions
// of the page width: { x0, x1 }. Used to trim wide margins so the words can be bigger.
async function contentBounds(doc) {
  let x0 = 1, x1 = 0;
  const n = Math.min(doc.numPages, 4);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 360 / page.getViewport({ scale: 1 }).width });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    const cols = new Uint16Array(width);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      if (data[k] + data[k + 1] + data[k + 2] < 640) cols[x]++;
    }
    let a = cols.findIndex(v => v > 0), b = width - 1;
    while (b > 0 && !cols[b]) b--;
    if (a < 0) continue;
    x0 = Math.min(x0, a / width); x1 = Math.max(x1, (b + 1) / width);
  }
  if (x1 <= x0) return { x0: 0, x1: 1 };
  const pad = 0.025;
  return { x0: Math.max(0, x0 - pad), x1: Math.min(1, x1 + pad) };
}

let pdfjsPromise = null;
function pdfjs() {
  // Loaded only when needed: the PDF engine is large.
  pdfjsPromise = pdfjsPromise || import('../vendor/pdfjs/pdf.min.js').then(m => {
    m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
    return m;
  });
  return pdfjsPromise;
}

export async function pdfPageCount(blob) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), ...docOpts() }).promise;
  const n = doc.numPages;
  doc.destroy();
  return n;
}

function docOpts() {
  return { standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href, isEvalSupported: false };
}

export function initPreach({ toast, prefs, savePrefs }) {
  const view = $('preach');
  const pages = $('preachPages');
  let deck = null, doc = null, observer = null, wake = null;
  let locked = false, zoom = 1, renderToken = 0;
  let posTimer = null, tick = null;
  let crop = { x0: 0, x1: 1 }, inkTimer = null, undo = [], redo = [];
  const pen = { tool: 'pen', color: prefs.preachInk || INK_COLORS[0], hl: prefs.preachHl || HL_COLORS[0] };

  // ---------- timer ----------
  // { deckId, target (min), acc (ms), start (ms or null), down (count down?) }
  const loadTimer = () => { try { return JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); } catch { return null; } };
  const saveTimer = t => { try { localStorage.setItem(TIMER_KEY, JSON.stringify(t)); } catch {} };
  let timer = null;
  const elapsed = () => timer.acc + (timer.start ? Date.now() - timer.start : 0);
  const fmt = ms => { const s = Math.floor(Math.abs(ms) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  function drawTimer() {
    if (!timer) return;
    const e = elapsed(), target = timer.target * 60000, left = target - e;
    const el = $('preachTime');
    el.textContent = timer.down ? (left >= 0 ? fmt(left) : '+' + fmt(left)) : fmt(e);
    view.classList.toggle('t-warn', left < 120000 && left >= 0);
    view.classList.toggle('t-over', left < 0);
    view.classList.toggle('t-running', !!timer.start);
    $('preachTarget').textContent = timer.down ? `of ${timer.target}:00` : `/ ${timer.target}:00`;
    $('preachBar').style.width = Math.min(100, e / target * 100) + '%';
    $('preachStart').textContent = timer.start ? 'Pause' : (e ? 'Resume' : 'Start');
    $('preachClock').textContent = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function startPause() {
    if (timer.start) { timer.acc += Date.now() - timer.start; timer.start = null; }
    else timer.start = Date.now();
    saveTimer(timer); drawTimer();
  }

  // ---------- lock ----------
  function setLocked(on) {
    locked = on;
    view.classList.toggle('locked', on);
    $('preachLock').setAttribute('aria-label', on ? 'Hold to unlock' : 'Lock');
    if (on) toast('Locked. Scroll with your finger. Hold the lock to unlock.');
  }

  // Unlocking needs a deliberate press and hold, so a brush of the hand cannot do it.
  let holdTimer = null;
  const lockBtn = $('preachLock');
  lockBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!locked) { setLocked(true); return; }
    lockBtn.classList.add('holding');
    holdTimer = setTimeout(() => { lockBtn.classList.remove('holding'); setLocked(false); }, HOLD_MS);
  });
  const cancelHold = () => { clearTimeout(holdTimer); lockBtn.classList.remove('holding'); };
  lockBtn.addEventListener('pointerup', cancelHold);
  lockBtn.addEventListener('pointerleave', cancelHold);
  lockBtn.addEventListener('pointercancel', cancelHold);
  lockBtn.addEventListener('contextmenu', e => e.preventDefault());

  // While locked, only scrolling works: no taps, no pinching, no Pencil.
  view.addEventListener('click', e => { if (locked && !e.target.closest('#preachLock')) { e.preventDefault(); e.stopPropagation(); } }, true);
  view.addEventListener('touchstart', e => {
    if (!locked) return;
    if (e.touches.length > 1 || [...e.touches].some(t => t.touchType === 'stylus')) e.preventDefault();
  }, { passive: false });
  view.addEventListener('gesturestart', e => e.preventDefault());

  // ---------- screen awake ----------
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !document.hidden) wake = await navigator.wakeLock.request('screen'); } catch { wake = null; }
  }
  // Locking the iPad, closing its cover or switching apps pauses the timer.
  let pausedAway = false;
  const pauseAway = () => {
    if (view.hidden || !timer || !timer.start) return;
    timer.acc += Date.now() - timer.start; timer.start = null;
    saveTimer(timer);
    pausedAway = true;
  };
  window.addEventListener('pagehide', pauseAway);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseAway(); return; }
    if (view.hidden) return;
    keepAwake(); drawTimer();
    if (pausedAway) { pausedAway = false; toast(`Timer paused at ${fmt(elapsed())} while you were away. ${locked ? 'Hold the lock, then tap Start and lock' : 'Tap Resume'} to carry on.`); }
  });

  // ---------- pages ----------
  async function renderAll() {
    const token = ++renderToken;
    pages.innerHTML = '';
    if (observer) observer.disconnect();
    const width = Math.min(pages.clientWidth - 24, 1400) * zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const trim = prefs.preachTrim !== false ? crop : { x0: 0, x1: 1 };
    const frac = trim.x1 - trim.x0;
    observer = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting && !en.target.dataset.done) paint(en.target);
    }, { root: pages, rootMargin: '1200px 0px' });
    const paint = async holder => {
      holder.dataset.done = '1';
      const page = await doc.getPage(+holder.dataset.n);
      if (token !== renderToken) return;
      const full = page.getViewport({ scale: 1 }).width;
      const scale = width / (full * frac);
      const vp = page.getViewport({ scale, offsetX: -trim.x0 * full * scale });
      const c = document.createElement('canvas');
      const h = parseFloat(holder.style.height);
      c.width = Math.round(width * dpr); c.height = Math.round(h * dpr);
      c.style.width = width + 'px'; c.style.height = h + 'px';
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      if (token !== renderToken) return;
      holder.replaceChildren(c, holder.inkCanvas);
    };
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      if (token !== renderToken) return;
      const v = page.getViewport({ scale: 1 });
      const holder = document.createElement('div');
      holder.className = 'preach-page';
      holder.dataset.n = n;
      holder.style.width = width + 'px';
      holder.style.height = width * v.height / (v.width * frac) + 'px';
      // Ink sits on its own canvas over the page; k maps page units to screen px.
      holder.k = width / (U * frac);
      holder.x0 = trim.x0 * U;
      holder.inkCanvas = makeInkCanvas(holder, width, parseFloat(holder.style.height), dpr);
      holder.appendChild(holder.inkCanvas);
      pages.appendChild(holder);
      observer.observe(holder);
    }
  }

  // ---------- writing on the PDF (only while unlocked) ----------
  const inkOf = n => { deck.ink = deck.ink || {}; return (deck.ink[n] = deck.ink[n] || []); };

  function makeInkCanvas(holder, w, h, dpr) {
    const c = document.createElement('canvas');
    c.className = 'preach-ink';
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = w + 'px'; c.style.height = h + 'px';
    c.dpr = dpr;
    let active = null;
    const pt = e => {
      const r = c.getBoundingClientRect();
      return [(e.clientX - r.left) / holder.k + holder.x0, (e.clientY - r.top) / holder.k, e.pointerType === 'pen' ? (e.pressure || 0.3) : 0.5];
    };
    c.addEventListener('touchstart', e => { if (!locked && [...e.touches].some(t => t.touchType === 'stylus')) e.preventDefault(); }, { passive: false });
    c.addEventListener('pointerdown', e => {
      if (locked || e.pointerType === 'touch' || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch {}
      const [x, y, p] = pt(e);
      if (pen.tool === 'eraser') { active = { id: e.pointerId, gone: [] }; eraseAt(holder, x, y, active); return; }
      const hl = pen.tool === 'highlighter';
      active = { id: e.pointerId, stroke: { tool: pen.tool, color: hl ? pen.hl : pen.color, size: hl ? 16 : 2.2, pressure: !hl && e.pointerType === 'pen', sm: 2, pts: [x, y, p] } };
    });
    c.addEventListener('pointermove', e => {
      if (!active || active.id !== e.pointerId) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) {
        const [x, y, p] = pt(ev);
        if (active.gone) { eraseAt(holder, x, y, active); continue; }
        const P = active.stroke.pts, n = P.length;
        if ((x - P[n - 3]) ** 2 + (y - P[n - 2]) ** 2 < 0.4) continue;
        P.push(x, y, p);
      }
      drawInk(holder, active.stroke);
    });
    const up = e => {
      if (!active || active.id !== e.pointerId) return;
      const a = active; active = null;
      const list = inkOf(holder.dataset.n);
      if (a.gone) {
        if (a.gone.length) action(holder, () => { list.push(...a.gone); }, () => { deck.ink[holder.dataset.n] = inkOf(holder.dataset.n).filter(s => !a.gone.includes(s)); });
        return;
      }
      list.push(a.stroke);
      action(holder, () => { deck.ink[holder.dataset.n] = inkOf(holder.dataset.n).filter(s => s !== a.stroke); }, () => { inkOf(holder.dataset.n).push(a.stroke); });
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    requestAnimationFrame(() => drawInk(holder));
    return c;
  }

  function drawInk(holder, live) {
    const c = holder.inkCanvas;
    if (!c || !deck) return;
    const ctx = c.getContext('2d'), d = c.dpr, k = holder.k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(k * d, 0, 0, k * d, -holder.x0 * k * d, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const all = [...((deck.ink && deck.ink[holder.dataset.n]) || []), ...(live ? [live] : [])];
    for (const s of all) {
      ctx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;
      drawStroke(ctx, s, s !== live);
    }
    ctx.globalAlpha = 1;
  }

  function eraseAt(holder, x, y, a) {
    const list = inkOf(holder.dataset.n), r = 12 * 12;
    const keep = list.filter(s => {
      for (let i = 0; i < s.pts.length; i += 3) if ((s.pts[i] - x) ** 2 + (s.pts[i + 1] - y) ** 2 <= r) { a.gone.push(s); return false; }
      return true;
    });
    if (keep.length !== list.length) { deck.ink[holder.dataset.n] = keep; drawInk(holder); }
  }

  // Record an undoable change (the change itself is already made).
  function action(holder, undoFn, redoFn) {
    undo.push({ holder, undo: undoFn, redo: redoFn });
    redo = [];
    afterInk(holder);
  }
  function afterInk(holder) {
    drawInk(holder);
    $('preachUndo').disabled = !undo.length;
    clearTimeout(inkTimer);
    inkTimer = setTimeout(() => { if (deck) db.putDeck(deck).catch(() => {}); }, 500);
  }
  $('preachUndo').addEventListener('click', () => { const a = undo.pop(); if (!a) return; a.undo(); redo.push(a); afterInk(a.holder); });

  function syncPenTools() {
    document.querySelectorAll('#preachTools [data-ptool]').forEach(b => b.classList.toggle('active', b.dataset.ptool === pen.tool));
    const colors = pen.tool === 'highlighter' ? HL_COLORS : INK_COLORS, cur = pen.tool === 'highlighter' ? pen.hl : pen.color;
    const box = $('preachColors');
    box.hidden = pen.tool === 'eraser';
    box.innerHTML = colors.map(c => `<button type="button" class="pc-dot${c === cur ? ' on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Colour"></button>`).join('');
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      if (pen.tool === 'highlighter') { pen.hl = prefs.preachHl = b.dataset.c; } else { pen.color = prefs.preachInk = b.dataset.c; }
      savePrefs(); syncPenTools();
    }));
  }
  document.querySelectorAll('#preachTools [data-ptool]').forEach(b => b.addEventListener('click', () => { pen.tool = b.dataset.ptool; syncPenTools(); }));
  syncPenTools();

  function pageNow() {
    const kids = [...pages.children];
    const mid = pages.scrollTop + pages.clientHeight * 0.35;
    let n = 1;
    for (const k of kids) if (k.offsetTop <= mid) n = +k.dataset.n;
    return n;
  }

  pages.addEventListener('scroll', () => {
    $('preachPageNo').textContent = `${pageNow()} / ${doc ? doc.numPages : 0}`;
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      if (!deck) return;
      deck.pos = pages.scrollTop / Math.max(1, pages.scrollHeight);
      db.putDeck(deck).catch(() => {});
    }, 600);
  }, { passive: true });

  // ---------- open / close ----------
  async function open(d) {
    const blob = await db.getDeckFile(d.id);
    if (!blob) { toast('That PDF is missing. Import it again.'); return; }
    deck = d;
    view.hidden = false;
    document.body.classList.add('preaching');
    $('preachTitle').textContent = d.name;
    $('preachPageNo').textContent = '';
    pages.innerHTML = '<p class="preach-loading">Opening…</p>';
    zoom = prefs.preachZoom || 1;
    view.classList.toggle('dim', !!prefs.preachDim);

    const saved = loadTimer();
    timer = saved && saved.deckId === d.id ? saved : { deckId: d.id, target: prefs.preachTarget || 30, acc: 0, start: null, down: !!prefs.preachDown };
    renderTargets();
    drawTimer();
    clearInterval(tick);
    tick = setInterval(drawTimer, 500);
    keepAwake();
    setLocked(false);

    d.opened = Date.now();
    db.putDeck(d).catch(() => {});
    try {
      const lib = await pdfjs();
      if (doc) doc.destroy();
      doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), ...docOpts() }).promise;
      undo = []; redo = []; $('preachUndo').disabled = true;
      crop = d.crop || (d.crop = await contentBounds(doc));
      db.putDeck(d).catch(() => {});
      syncTrim();
      await renderAll();
      if (d.pos) requestAnimationFrame(() => { pages.scrollTop = d.pos * pages.scrollHeight; });
      $('preachPageNo').textContent = `${pageNow()} / ${doc.numPages}`;
    } catch (err) {
      console.error(err);
      pages.innerHTML = '<p class="preach-loading">Could not open this PDF.</p>';
    }
  }

  function close() {
    if (locked) return;
    clearTimeout(inkTimer);
    if (deck) db.putDeck(deck).catch(() => {});
    view.hidden = true;
    document.body.classList.remove('preaching');
    clearInterval(tick);
    if (wake) { wake.release().catch(() => {}); wake = null; }
    renderToken++;
    if (doc) { doc.destroy(); doc = null; }
    pages.innerHTML = '';
    deck = null;
  }

  function renderTargets() {
    const sel = $('preachTargetSel');
    sel.innerHTML = TARGETS.map(m => `<option value="${m}"${m === timer.target ? ' selected' : ''}>${m} min</option>`).join('');
  }

  $('preachClose').addEventListener('click', close);
  $('preachStart').addEventListener('click', startPause);
  $('preachTime').addEventListener('click', () => { if (locked) return; timer.down = !timer.down; prefs.preachDown = timer.down; savePrefs(); saveTimer(timer); drawTimer(); });
  $('preachReset').addEventListener('click', () => {
    if (elapsed() > 0 && !confirm('Reset the timer to 0:00?')) return;
    timer.acc = 0; timer.start = null; saveTimer(timer); drawTimer();
  });
  $('preachTargetSel').addEventListener('change', e => { timer.target = +e.target.value; prefs.preachTarget = timer.target; savePrefs(); saveTimer(timer); drawTimer(); });
  $('preachStartLock').addEventListener('click', () => { if (!timer.start) startPause(); setLocked(true); });
  $('preachDim').addEventListener('click', () => { prefs.preachDim = !prefs.preachDim; savePrefs(); view.classList.toggle('dim', prefs.preachDim); });
  document.querySelectorAll('[data-pzoom]').forEach(b => b.addEventListener('click', async () => {
    const frac = pages.scrollTop / Math.max(1, pages.scrollHeight);
    zoom = Math.max(0.6, Math.min(2.2, zoom * (+b.dataset.pzoom > 0 ? 1.2 : 1 / 1.2)));
    prefs.preachZoom = zoom; savePrefs();
    await renderAll();
    pages.scrollTop = frac * pages.scrollHeight;
  }));
  function syncTrim() {
    const on = prefs.preachTrim !== false;
    $('preachTrim').classList.toggle('on', on);
    $('preachTrim').setAttribute('aria-pressed', on);
    $('preachTrim').hidden = crop.x1 - crop.x0 > 0.92; // nothing worth trimming
  }
  $('preachTrim').addEventListener('click', async () => {
    const frac = pages.scrollTop / Math.max(1, pages.scrollHeight);
    prefs.preachTrim = prefs.preachTrim === false; savePrefs(); syncTrim();
    await renderAll();
    pages.scrollTop = frac * pages.scrollHeight;
  });

  let resizeT;
  new ResizeObserver(() => { if (!doc || view.hidden) return; clearTimeout(resizeT); resizeT = setTimeout(async () => {
    const frac = pages.scrollTop / Math.max(1, pages.scrollHeight); await renderAll(); pages.scrollTop = frac * pages.scrollHeight;
  }, 250); }).observe(pages);

  return { open, close };
}

// Save a PDF (from Files, a drop, or a study) as something to preach from.
export async function addDeck(blob, name, extra = {}) {
  const pages = await pdfPageCount(blob);
  const id = extra.id || 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const old = extra.id ? await db.getDeck(id).catch(() => null) : null;
  const deck = { id, name: name.replace(/\.pdf$/i, '').trim() || 'Sermon', pages, size: blob.size, created: Date.now(), opened: 0, pos: 0, ...extra };
  if (old && old.ink) deck.ink = old.ink; // keep what you wrote on it last time
  await db.putDeckFile(id, blob);
  await db.putDeck(deck);
  return deck;
}
