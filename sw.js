// Offline support: cache the app shell. Bump VERSION when files change.
const VERSION = 'lp-v12';
const SHELL = [
  './', 'index.html', 'css/app.css', 'css/fonts.css', 'js/app.js', 'js/ink.js', 'js/bible.js', 'js/db.js', 'js/pdf.js',
  'js/ruler.js', 'js/marks.js', 'js/verses.js', 'js/sheet.js', 'js/checks.js', 'js/sync.js', 'js/pad.js', 'js/refs.js',
  'fonts/Barlow-400.woff2', 'fonts/Barlow-400i.woff2', 'fonts/Barlow-500.woff2', 'fonts/Barlow-600.woff2',
  'fonts/Barlow-700.woff2', 'fonts/BarlowCondensed-700.woff2', 'fonts/BarlowCondensed-800i.woff2', 'fonts/BarlowCondensed-900i.woff2',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first for our own files (so updates arrive), cache when offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
