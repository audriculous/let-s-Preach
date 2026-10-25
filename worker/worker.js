// Cloudflare Worker: a private passage fetcher for Let's Preach.
// It only fetches Bible Gateway passage pages, so it cannot be used as an open proxy.
//
// Usage: https://<your-worker>.workers.dev/?search=Romans%208:1-17&version=NIV

const VERSIONS = new Set(['NIV', 'ESV', 'NASB', 'NASB1995', 'CSB', 'NKJV', 'KJV', 'NLT', 'NRSVUE']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
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
  },
};
