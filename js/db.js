// Tiny IndexedDB wrapper for studies (and PDFs to preach from). Studies fall back to
// localStorage if IndexedDB is unavailable.
const DB_NAME = 'letspreach';
const STORE = 'studies';
const DECKS = 'decks';      // { id, name, pages, size, created, opened, pos, studyId }
const FILES = 'deckFiles';  // { id, blob }, kept apart so listing decks stays light
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no idb'));
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [STORE, DECKS, FILES]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn, name = STORE) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(name, mode);
    const store = t.objectStore(name);
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

// ---------- PDFs to preach from ----------

export const allDecks = () => tx('readonly', s => s.getAll(), DECKS);
export const getDeck = id => tx('readonly', s => s.get(id), DECKS);
export const putDeck = deck => tx('readwrite', s => s.put(deck), DECKS);
export const getDeckFile = id => tx('readonly', s => s.get(id), FILES).then(r => r && r.blob);
export const putDeckFile = (id, blob) => tx('readwrite', s => s.put({ id, blob }), FILES);
export async function deleteDeck(id) {
  await tx('readwrite', s => s.delete(id), DECKS);
  await tx('readwrite', s => s.delete(id), FILES);
}
