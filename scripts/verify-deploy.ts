export {};
/**
 * Post-deployment smoke tests against a LIVE URL (read-only, no writes):
 *
 *   npm run verify:deploy -- https://your-app.onrender.com
 *
 * Checks: health+DB readiness, security headers, SPA shell + SEO tokens,
 * catalogue API, bootstrap, robots/sitemap, 404 behaviour, and that no
 * server internals leak. Exits non-zero on any FAIL.
 */
const base = (process.argv[2] ?? process.env.DEPLOY_URL ?? '').replace(/\/$/, '');
if (!base || !/^https?:\/\//.test(base)) {
  console.error('usage: npm run verify:deploy -- https://your-app.onrender.com');
  process.exit(2);
}

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });

async function get(path: string): Promise<{ status: number; headers: Headers; text: string }> {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

console.log(`Verifying ${base} … (first request may take ~60s if the free instance was asleep)\n`);

// 1. Health + DB readiness
try {
  const h = await get('/api/health');
  const body = JSON.parse(h.text);
  check('health endpoint', h.status === 200 && body.ok === true, `status=${h.status} db=${body.db}`);
  check('health db readiness', body.db === 'ok', `db=${body.db}`);
  check('health leaks nothing', !JSON.stringify(body).match(/postgres|sqlite|DATABASE_URL|password|secret/i), JSON.stringify(body).slice(0, 120));
} catch (e: any) {
  check('health endpoint', false, e.message);
}

// 2. Security headers
try {
  const h = await get('/api/health');
  check('no x-powered-by', !h.headers.has('x-powered-by'));
  check('X-Content-Type-Options', h.headers.get('x-content-type-options') === 'nosniff');
  check('X-Frame-Options', h.headers.get('x-frame-options') === 'DENY');
  check('HSTS (production)', h.headers.get('strict-transport-security')?.includes('max-age=31536000') || !base.startsWith('https://'), String(h.headers.get('strict-transport-security')));
} catch (e: any) {
  check('security headers', false, e.message);
}

// 3. SPA shell with SEO injection
try {
  const home = await get('/');
  check('home renders HTML', home.status === 200 && home.text.includes('<div id="root">'), `status=${home.status}`);
  check('SEO title injected', /<title>[^<]+<\/title>/.test(home.text) && !home.text.includes('__SEO_TITLE__'));
  check('SEO canonical injected', home.text.includes('rel="canonical"') && !home.text.includes('__SEO_CANONICAL__'));
} catch (e: any) {
  check('home shell', false, e.message);
}

// 4. Catalogue + bootstrap APIs
try {
  const p = await get('/api/products?pageSize=4');
  const body = JSON.parse(p.text);
  check('products API', p.status === 200 && Array.isArray(body.items), `status=${p.status} total=${body.total}`);
  check('products carry images', !body.items.length || body.items.every((i: any) => Array.isArray(i.images)), body.items?.[0]?.title ?? 'empty catalogue');
  const b = await get('/api/bootstrap');
  const bs = JSON.parse(b.text);
  check('bootstrap API', b.status === 200 && Boolean(bs.store?.name), `store=${bs.store?.name}`);
} catch (e: any) {
  check('catalogue API', false, e.message);
}

// 5. SEO files
try {
  const r = await get('/robots.txt');
  check('robots.txt', r.status === 200 && r.text.includes('Sitemap:'));
  const s = await get('/sitemap.xml');
  check('sitemap.xml', s.status === 200 && s.text.includes('<urlset'));
} catch (e: any) {
  check('seo files', false, e.message);
}

// 6. 404 behaviour + no stack traces
try {
  const nf = await get('/api/definitely-not-a-route');
  check('API 404 is JSON', nf.status === 404 && nf.text.includes('"not_found"'), `status=${nf.status}`);
  const nf2 = await get('/definitely-not-a-page');
  check('unknown HTML route serves SPA shell', nf2.status === 200 && nf2.text.includes('<div id="root">'), `status=${nf2.status}`);
  check('no stack traces exposed', !nf.text.includes('at ') || !nf.text.includes('.ts:'), '');
} catch (e: any) {
  check('404 handling', false, e.message);
}

// 7. Admin protection (unauthenticated)
try {
  const a = await get('/api/admin/orders');
  check('admin API protected', a.status === 401, `status=${a.status}`);
} catch (e: any) {
  check('admin API protected', false, e.message);
}

// 8. Media/static assets
try {
  const m = await get('/favicon.svg');
  check('static assets served', m.status === 200, `status=${m.status}`);
} catch (e: any) {
  check('static assets', false, e.message);
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '✓ PASS' : '✗ FAIL'}  ${r.name.padEnd(34)} ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
