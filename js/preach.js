// Preach mode: a PDF (an imported manuscript, or a study's own PDF) full screen, with a
// sermon timer, a lock against stray touches, and the screen kept awake.

import * as db from './db.js';

const $ = id => document.getElementById(id);
const TIMER_KEY = 'letspreach.timer';
const TARGETS = [10, 15, 20, 25, 30, 35, 40, 45];
const HOLD_MS = 900;

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
  document.addEventListener('visibilitychange', () => { if (!view.hidden && !document.hidden) { keepAwake(); drawTimer(); } });

  // ---------- pages ----------
  async function renderAll() {
    const token = ++renderToken;
    pages.innerHTML = '';
    if (observer) observer.disconnect();
    const width = Math.min(pages.clientWidth - 24, 1400) * zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    observer = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting && !en.target.dataset.done) paint(en.target);
    }, { root: pages, rootMargin: '1200px 0px' });
    const paint = async holder => {
      holder.dataset.done = '1';
      const page = await doc.getPage(+holder.dataset.n);
      if (token !== renderToken) return;
      const vp = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width * dpr); c.height = Math.round(vp.height * dpr);
      c.style.width = vp.width + 'px'; c.style.height = vp.height + 'px';
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      if (token !== renderToken) return;
      holder.replaceChildren(c);
    };
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      if (token !== renderToken) return;
      const v = page.getViewport({ scale: 1 });
      const holder = document.createElement('div');
      holder.className = 'preach-page';
      holder.dataset.n = n;
      holder.style.width = width + 'px';
      holder.style.height = width * v.height / v.width + 'px';
      pages.appendChild(holder);
      observer.observe(holder);
    }
  }

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
  const deck = { id, name: name.replace(/\.pdf$/i, '').trim() || 'Sermon', pages, size: blob.size, created: Date.now(), opened: 0, pos: 0, ...extra };
  await db.putDeckFile(id, blob);
  await db.putDeck(deck);
  return deck;
}
