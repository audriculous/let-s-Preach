// Sync between devices and a daily cloud backup, both through your own Cloudflare
// Worker. Each study syncs as a whole: whichever device changed it last wins.

import * as db from './db.js';

const TOMBS = 'letspreach.deleted';
const PUSH_DELAY = 90 * 1000;    // wait for a pause in writing before sending changes
const EVERY = 5 * 60 * 1000;     // check for changes from your other devices

export const modOf = s => s.modified || s.updated || 0;

export function makeSyncCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = [...bytes].map(b => abc[b % abc.length]).join('');
  return 'LP-' + chars.match(/.{5}/g).join('-');
}

export function initSync({ settings, saveSettings, getOpenId, onRemoteChange }) {
  let timer = null, running = null, again = false;
  const state = { status: '', error: false };

  const enabled = () => !!(settings.workerUrl && settings.syncCode && settings.syncOn !== false);
  const base = () => settings.workerUrl.replace(/\/+$/, '');

  async function call(path, body) {
    const res = await fetch(base() + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Sync-Key': settings.syncCode, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok || !data) {
      const why = data && data.error;
      if (res.status === 501 || why === 'no-storage') throw new Error('Your Worker has no storage yet. Add the KV binding called LP (see the README).');
      if (res.status === 404 && !data) throw new Error('Your Worker is the old version. Paste in the new worker code (see the README).');
      if (why === 'bad-key') throw new Error('That sync code is too short.');
      throw new Error('Sync failed (' + (why || 'HTTP ' + res.status) + ').');
    }
    return data;
  }

  const tombs = () => { try { return JSON.parse(localStorage.getItem(TOMBS) || '[]'); } catch { return []; } };
  const setTombs = t => localStorage.setItem(TOMBS, JSON.stringify(t));

  function recordDelete(id) {
    if (!settings.syncCode) return;
    setTombs([...tombs().filter(t => t.id !== id), { id, at: Date.now() }]);
    schedule(5000);
  }

  function schedule(delay = PUSH_DELAY) {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow(), delay);
  }

  async function syncNow() {
    if (!enabled()) return { pulled: 0, pushed: 0 };
    if (running) { again = true; return running; }
    clearTimeout(timer);
    running = (async () => {
      try {
        const remote = await call('/sync/list');
        const rMod = new Map(remote.studies.map(s => [s.id, s.modified]));
        const rDel = new Map(remote.deleted.map(d => [d.id, d.at]));
        const local = await db.allStudies();
        const lMap = new Map(local.map(s => [s.id, s]));
        const myTombs = tombs();
        const myDel = new Map(myTombs.map(t => [t.id, t.at]));
        const openId = getOpenId();
        let changed = 0;

        // Deleted on another device, and not edited here since.
        for (const [id, at] of rDel) {
          const s = lMap.get(id);
          if (s && modOf(s) <= at && id !== openId) { await db.deleteStudy(id); lMap.delete(id); changed++; }
        }

        const pull = [];
        for (const [id, m] of rMod) {
          const s = lMap.get(id);
          if (id === openId) continue; // never swap a study out from under you; it catches up later
          if ((myDel.get(id) || 0) >= m) continue;
          if (!s || m > modOf(s)) pull.push(id);
        }
        for (let i = 0; i < pull.length; i += 40) {
          const { studies } = await call('/sync/get', { ids: pull.slice(i, i + 40) });
          for (const s of studies) { await db.putStudy(s); changed++; }
        }

        const push = [...lMap.values()].filter(s => {
          const m = rMod.get(s.id);
          if ((rDel.get(s.id) || 0) >= modOf(s)) return false;
          return m == null || modOf(s) > m;
        });
        let batch = [], size = 0;
        const flush = async (deleted = []) => {
          if (!batch.length && !deleted.length) return;
          await call('/sync/put', { studies: batch, deleted });
          batch = []; size = 0;
        };
        for (const s of push) {
          const n = JSON.stringify(s).length;
          if (size + n > 4e6) await flush();
          batch.push(s); size += n;
        }
        await flush(myTombs);
        if (myTombs.length) setTombs(tombs().filter(t => !myTombs.some(m => m.id === t.id && m.at === t.at)));

        settings.lastSync = Date.now();
        saveSettings();
        state.status = `Synced ${timeAgo(settings.lastSync)}`;
        state.error = false;
        if (changed) onRemoteChange();
        try { await backupIfDue(); } catch {} // a missed backup is retried next sync
        return { pulled: changed, pushed: push.length };
      } catch (e) {
        state.status = navigator.onLine === false ? 'Offline. Will sync when you are back online.' : e.message;
        state.error = true;
        throw e;
      } finally {
        running = null;
        if (again) { again = false; schedule(2000); }
      }
    })();
    return running;
  }

  // One snapshot a day, kept for 30 days on your Worker.
  async function backupIfDue() {
    const day = new Date().toISOString().slice(0, 10);
    if (settings.lastBackupDay === day) return;
    await backupNow();
  }

  async function backupNow() {
    const studies = await db.allStudies();
    if (!studies.length) return;
    const { day } = await call('/backup', { studies });
    settings.lastBackupDay = day;
    saveSettings();
    return day;
  }

  async function listBackups() { return (await call('/backups')).days; }

  async function restoreBackup(day) {
    const data = await call('/backup?day=' + encodeURIComponent(day));
    const list = data.studies || [];
    const now = Date.now();
    for (const s of list) {
      if (!s || !s.id || !s.passage) continue;
      s.modified = now; // the restored copy becomes the newest everywhere
      await db.putStudy(s);
    }
    setTombs(tombs().filter(t => !list.some(s => s.id === t.id)));
    schedule(3000);
    return list.length;
  }

  setInterval(() => { if (!document.hidden) syncNow().catch(() => {}); }, EVERY);
  window.addEventListener('online', () => syncNow().catch(() => {}));

  return { state, enabled, schedule, syncNow, recordDelete, backupNow, listBackups, restoreBackup };
}

export function timeAgo(t) {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
