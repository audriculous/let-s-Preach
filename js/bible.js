// Fetches a passage from Bible Gateway and turns it into clean, annotatable HTML.
//
// Browsers block web apps from reading biblegateway.com directly (no CORS headers),
// so requests go through a relay: the user's own Cloudflare Worker if set, otherwise
// a few free public CORS relays tried in order.

const TIMEOUT_MS = 12000;

function bgUrl(search, version) {
  return 'https://www.biblegateway.com/passage/?search=' + encodeURIComponent(search) +
    '&version=' + encodeURIComponent(version) + '&interface=print';
}

function relays(search, version, workerUrl) {
  const target = bgUrl(search, version);
  const list = [];
  if (workerUrl) {
    const base = workerUrl.replace(/\/+$/, '');
    list.push(base + '/?search=' + encodeURIComponent(search) + '&version=' + encodeURIComponent(version));
  }
  list.push('https://api.allorigins.win/raw?url=' + encodeURIComponent(target));
  list.push('https://corsproxy.io/?url=' + encodeURIComponent(target));
  list.push('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(target));
  return list;
}

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPassage(search, version, workerUrl, onProgress) {
  const urls = relays(search, version, workerUrl);
  let lastErr = null;
  let workerErr = null;
  for (let i = 0; i < urls.length; i++) {
    onProgress && onProgress(i, urls.length);
    try {
      const html = await fetchWithTimeout(urls[i]);
      const parsed = parsePassage(html, search, version);
      if (parsed) return parsed;
      lastErr = new Error('not-found');
      // A relay returned a real Bible Gateway page with no passage: the reference is wrong.
      if (/class="search-/.test(html) && /biblegateway/i.test(html)) break;
      if (workerUrl && i === 0) workerErr = 'it answered, but not with a passage page';
    } catch (e) {
      lastErr = e;
      if (workerUrl && i === 0) workerErr = e.name === 'AbortError' ? 'it timed out' : e.message;
    }
  }
  if (lastErr && lastErr.message === 'not-found' && !workerErr) {
    throw new Error('Bible Gateway could not find "' + search + '". Check the reference and try again.');
  }
  if (workerErr) {
    throw new Error('Your fetcher in Settings did not work (' + workerErr + '). Check the URL, or paste the text instead.');
  }
  throw new Error('Could not reach Bible Gateway through the free relays. Set up your own fetcher in Settings (see the README), or paste the text instead.');
}

// ---------- Parsing ----------

const DROP_SELECTORS = [
  'script', 'style', 'noscript', 'h1', '.footnotes', '.crossrefs', 'sup.crossreference',
  '.full-chap-link', '.passage-other-trans', '.publisher-info-bottom', '.passage-scroller',
  '.dropdowns', '.passage-display', '.translation', '.il-text', 'a.bibleref', '.copyright-table',
];

const KEEP_CLASSES = new Set([
  'chapternum', 'versenum', 'woj', 'small-caps', 'poetry', 'line', 'selah',
  'indent-1', 'indent-2', 'indent-3', 'indent-1-breaks', 'indent-2-breaks', 'indent-3-breaks',
]);

const TAG_MAP = { P: 'p', H3: 'h3', H4: 'h4', H2: 'h3', H5: 'h4', SPAN: 'span', SUP: 'sup', BR: 'br', DIV: 'div', I: 'i', EM: 'em', B: 'b', STRONG: 'strong', SMALL: 'small' };

export function parsePassage(html, search, version) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [...doc.querySelectorAll('.passage-text')];
  if (!blocks.length) return null;

  const parts = [];
  const footnotes = [];
  const extras = { footnotes: [], crossrefs: [] };

  blocks.forEach((block, idx) => {
    const col = block.closest('.passage-col, .passage-table, .passage-wrap') || doc;
    const refEl = col.querySelector('.dropdown-display-text, .passage-display-bcv, .bcv');
    const ref = refEl ? refEl.textContent.trim() : (idx === 0 ? search : '');

    const root = block.querySelector('.text-html, .result-text-style-normal, .version-' + version) || block;
    collectExtras(block.querySelector('.footnotes, .crossrefs') ? block : col, root, extras, footnotes);

    // Footnote and cross-reference markers become small tappable letters.
    root.querySelectorAll('sup.footnote, sup.crossreference').forEach(sup => {
      const fn = sup.classList.contains('footnote');
      const s = doc.createElement('sup');
      s.className = fn ? 'fn' : 'xr';
      s.textContent = sup.textContent.replace(/[\[\]()\s]/g, '');
      const id = (sup.getAttribute(fn ? 'data-fn' : 'data-cr') || '').replace(/^#/, '');
      if (id) s.dataset.id = id;
      sup.replaceWith(s);
    });
    DROP_SELECTORS.forEach(sel => root.querySelectorAll(sel).forEach(el => el.remove()));

    const clean = sanitize(root);
    if (clean.trim()) parts.push({ ref, html: clean });
  });

  if (!parts.length) return null;

  const pub = doc.querySelector('.publisher-info-bottom');
  let copyright = pub ? pub.textContent.replace(/\s+/g, ' ').trim() : '';
  if (!copyright && version === 'NIV') {
    copyright = 'Scripture quotations taken from The Holy Bible, New International Version® NIV®. Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.™ Used by permission. All rights reserved worldwide.';
  }

  const reference = parts.map(p => p.ref).filter(Boolean).join('; ') || search;
  return { reference, version, parts, footnotes, extras, copyright, source: 'biblegateway' };
}

// Footnotes and cross references, kept with the verse each one belongs to.
//   extras.footnotes: [{ id, letter, verse, text }]
//   extras.crossrefs: [{ id, letter, verse, refs: ['Romans 5:8', ...] }]
function collectExtras(scope, root, extras, footnotes) {
  const letters = new Map();
  root.querySelectorAll('sup.footnote, sup.crossreference').forEach(sup => {
    const id = (sup.getAttribute('data-fn') || sup.getAttribute('data-cr') || '').replace(/^#/, '');
    if (id) letters.set(id, sup.textContent.replace(/[\[\]()\s]/g, ''));
  });
  const verseOf = li => {
    const a = li.querySelector('a');
    return a ? (a.textContent || a.getAttribute('title') || '').replace(/^Go to\s+/i, '').trim() : '';
  };
  scope.querySelectorAll('.footnotes li').forEach(li => {
    const t = li.querySelector('.footnote-text');
    const verse = verseOf(li);
    const text = (t ? t.textContent : li.textContent.replace(verse, '')).replace(/\s+/g, ' ').trim();
    if (extras.footnotes.some(f => f.id && f.id === li.id)) return;
    extras.footnotes.push({ id: li.id || '', letter: letters.get(li.id) || '', verse, text });
    footnotes.push((verse ? verse + ' ' : '') + text);
  });
  scope.querySelectorAll('.crossrefs li').forEach(li => {
    if (extras.crossrefs.some(c => c.id && c.id === li.id)) return;
    const refs = [...li.querySelectorAll('a.crossref-link, a[data-bibleref]')]
      .flatMap(a => (a.getAttribute('data-bibleref') || a.textContent).split(/;\s*/))
      .map(r => r.trim()).filter(Boolean);
    if (refs.length) extras.crossrefs.push({ id: li.id || '', letter: letters.get(li.id) || '', verse: verseOf(li), refs });
  });
}

function sanitize(root) {
  const out = document.createElement('div');
  const walk = (src, dest) => {
    src.childNodes.forEach(node => {
      if (node.nodeType === 3) {
        dest.appendChild(document.createTextNode(node.textContent));
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = TAG_MAP[node.tagName];
      if (!tag) { walk(node, dest); return; } // unwrap unknown wrappers (e.g. <a>)
      const classes = [...node.classList].filter(c => KEEP_CLASSES.has(c) || c === 'fn' || c === 'xr');
      if (node.tagName === 'SPAN' && !classes.length) { walk(node, dest); return; } // drop verse wrappers
      if (node.tagName === 'SUP' && !classes.length) return; // stray sup
      const el = document.createElement(tag);
      if (classes.length) el.className = classes.join(' ');
      if (node.tagName === 'SUP' && node.dataset.id && /^[\w-]+$/.test(node.dataset.id)) el.dataset.id = node.dataset.id;
      dest.appendChild(el);
      walk(node, el);
    });
  };
  walk(root, out);
  // Bible Gateway headings live in <h3><span class="text ...">; they come through as plain h3/h4.
  return out.innerHTML;
}

// Build a passage object from text the user pasted.
export function passageFromText(ref, text) {
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const paras = text.trim().split(/\n\s*\n/).map(p => {
    const body = esc(p.trim()).replace(/\n/g, '<br>')
      // Turn leading verse numbers like "16 For God" or "16For" into verse markers.
      .replace(/(^|<br>|\s)(\d{1,3})(?=\s?[A-Z“"‘'(\[])/g, '$1<sup class="versenum">$2</sup>');
    return '<p>' + body + '</p>';
  });
  return { reference: ref || 'Passage', version: '', parts: [{ ref: ref || '', html: paras.join('') }], footnotes: [], copyright: '', source: 'paste' };
}
