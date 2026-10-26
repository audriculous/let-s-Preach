// Cloudflare Worker for Let's Preach.
//
// 1. Passage fetcher: only fetches Bible Gateway passage pages, so it cannot be used
//    as an open proxy.  GET /?search=Romans%208:1-17&version=NIV
//
// 2. Sync and daily backups between your devices (optional). Needs a KV namespace
//    bound to this Worker with the variable name LP (see the README). Every request
//    carries your private sync code in the X-Sync-Key header; studies are stored under
//    a hash of that code, so nobody without it can read or change them.
//      GET  /sync/list            -> { studies: [{ id, modified }], deleted: [{ id, at }] }
//      POST /sync/get   { ids }   -> { studies: [...] }
//      POST /sync/put   { studies, deleted } -> { saved }
//      POST /backup     { studies } -> { day }   (one snapshot per day, last 30 kept)
//      GET  /backups              -> { days: [...] }
//      GET  /backup?day=YYYY-MM-DD -> { studies }

const VERSIONS = new Set(['NIV', 'ESV', 'NASB', 'NASB1995', 'CSB', 'NKJV', 'KJV', 'NLT', 'NRSVUE']);
const KEEP_BACKUPS = 30;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Key',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '') return passage(url);
    try {
      return await sync(request, url, env);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

async function passage(url) {
  const search = (url.searchParams.get('search') || '').slice(0, 200);
  const version = (url.searchParams.get('version') || 'NIV').toUpperCase();
  if (!search) return new Response('Missing ?search=', { status: 400, headers: CORS });
  if (!VERSIONS.has(version)) return new Response('Unsupported version', { status: 400, headers: CORS });

  const target = 'https://www.biblegateway.com/passage/?search=' + encodeURIComponent(search) +
    '&version=' + encodeURIComponent(version) + '&interface=print';

  const res = await fetch(target, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html',
    },
    cf: { cacheTtl: 86400, cacheEverything: true },
  });

  return new Response(await res.text(), {
    status: res.status,
    headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}

async function sync(request, url, env) {
  if (!env.LP) return json({ error: 'no-storage' }, 501);
  const code = request.headers.get('X-Sync-Key') || '';
  if (code.length < 16) return json({ error: 'bad-key' }, 401);
  const user = await hash(code);
  const S = `u:${user}:s:`, D = `u:${user}:d:`, B = `u:${user}:b:`;
  const path = url.pathname.replace(/\/+$/, '');
  const body = request.method === 'POST' ? await request.json() : null;

  if (path === '/sync/list' && request.method === 'GET') {
    const studies = (await listAll(env.LP, S)).map(k => ({ id: k.name.slice(S.length), modified: k.metadata?.m || 0 }));
    const deleted = (await listAll(env.LP, D)).map(k => ({ id: k.name.slice(D.length), at: k.metadata?.at || 0 }));
    return json({ studies, deleted, now: Date.now() });
  }

  if (path === '/sync/get' && request.method === 'POST') {
    const ids = (body.ids || []).slice(0, 500).map(String);
    const studies = (await Promise.all(ids.map(id => env.LP.get(S + id, 'json')))).filter(Boolean);
    return json({ studies });
  }

  if (path === '/sync/put' && request.method === 'POST') {
    let saved = 0;
    for (const s of body.studies || []) {
      if (!s || typeof s.id !== 'string' || !s.passage) continue;
      const m = s.modified || s.updated || 0;
      const cur = await env.LP.getWithMetadata(S + s.id);
      if (cur.metadata && cur.metadata.m >= m) continue; // the stored copy is as new or newer
      await env.LP.put(S + s.id, JSON.stringify(s), { metadata: { m } });
      await env.LP.delete(D + s.id);
      saved++;
    }
    for (const d of body.deleted || []) {
      if (!d || typeof d.id !== 'string') continue;
      const cur = await env.LP.getWithMetadata(S + d.id);
      if (cur.metadata && cur.metadata.m > d.at) continue; // edited again after it was deleted
      await env.LP.delete(S + d.id);
      await env.LP.put(D + d.id, '1', { metadata: { at: d.at }, expirationTtl: 60 * 60 * 24 * 120 });
    }
    return json({ saved });
  }

  if (path === '/backup' && request.method === 'POST') {
    const day = new Date().toISOString().slice(0, 10);
    await env.LP.put(B + day, JSON.stringify({ app: 'letspreach', version: 1, studies: body.studies || [] }), { metadata: { n: (body.studies || []).length } });
    const days = (await listAll(env.LP, B)).map(k => k.name.slice(B.length)).sort();
    for (const old of days.slice(0, Math.max(0, days.length - KEEP_BACKUPS))) await env.LP.delete(B + old);
    return json({ day });
  }

  if (path === '/backups' && request.method === 'GET') {
    const days = (await listAll(env.LP, B)).map(k => ({ day: k.name.slice(B.length), count: k.metadata?.n ?? null }))
      .sort((a, b) => b.day.localeCompare(a.day));
    return json({ days });
  }

  if (path === '/backup' && request.method === 'GET') {
    const day = (url.searchParams.get('day') || '').replace(/[^0-9-]/g, '');
    const data = await env.LP.get(B + day, 'json');
    return data ? json(data) : json({ error: 'not-found' }, 404);
  }

  return json({ error: 'not-found' }, 404);
}

async function listAll(kv, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    out.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function hash(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('letspreach:' + s));
  return [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}
