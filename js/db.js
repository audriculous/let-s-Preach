// Tiny IndexedDB wrapper for studies. Falls back to localStorage if IndexedDB is unavailable.
const DB_NAME = 'letspreach';
const STORE = 'studies';
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
  }));
}

const ls = {
  all() {
    return Object.keys(localStorage).filter(k => k.startsWith('lp:')).map(k => JSON.parse(localStorage.getItem(k)));
  },
  put(s) { localStorage.setItem('lp:' + s.id, JSON.stringify(s)); },
  del(id) { localStorage.removeItem('lp:' + id); },
};

export async function allStudies() {
  try { return await tx('readonly', s => s.getAll()); }
  catch { return ls.all(); }
}

export async function getStudy(id) {
  try { return await tx('readonly', s => s.get(id)); }
  catch { return ls.all().find(s => s.id === id); }
}

export async function putStudy(study) {
  try { await tx('readwrite', s => s.put(study)); }
  catch { ls.put(study); }
}

export async function deleteStudy(id) {
  try { await tx('readwrite', s => s.delete(id)); }
  catch { ls.del(id); }
}

// Ask Safari not to evict our data when storage is tight.
export function requestPersistence() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
