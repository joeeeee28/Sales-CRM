/**
 * Deployment-readiness tests (sqlite dialect, CORS configured):
 * health/DB readiness, security headers, CORS allowlist, 404 behaviour,
 * admin protection, and no leakage of internals.
 */
process.env.CORS_ORIGINS = 'https://shop.example.com, https://preview.example.com';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, type TestClient } from './helpers.js';

let client: TestClient;
let close: () => Promise<void>;

beforeAll(async () => {
  const app = await boot();
  client = app.client;
  close = app.close;
});

afterAll(async () => {
  await close();
});

describe('health & readiness', () => {
  it('reports ok with db readiness and no internals', async () => {
    const res = await client.fetch('/api/health');
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(res.data.db).toBe('ok');
    const raw = JSON.stringify(res.data);
    expect(raw).not.toMatch(/sqlite|postgres|password|secret|DATABASE_URL/i);
  });
});

describe('security headers', () => {
  it('sets hardening headers and hides the framework', async () => {
    const res = await client.fetch('/api/health');
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe('CORS allowlist', () => {
  it('allows configured origins with credentials', async () => {
    const res = await client.fetch('/api/bootstrap', { headers: { Origin: 'https://shop.example.com' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://shop.example.com');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('answers preflight for allowed origins', async () => {
    const res = await client.fetch('/api/orders', {
      method: 'OPTIONS',
      headers: { Origin: 'https://preview.example.com', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('refuses unlisted origins (no ACAO header)', async () => {
    const res = await client.fetch('/api/bootstrap', { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(200); // same-origin-style response, but no cross-origin grant
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('routing & error behaviour', () => {
  it('unknown API routes return JSON 404', async () => {
    const res = await client.fetch('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.data.error.code).toBe('not_found');
  });

  it('unknown HTML routes fall through to the SPA shell handler', async () => {
    const res = await fetch(`${client.origin}/some/unknown/page`, { headers: { Accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('admin API is protected for anonymous visitors', async () => {
    const res = await client.fetch('/api/admin/orders');
    expect(res.status).toBe(401);
  });
});

describe('simulate endpoints stay gated', () => {
  it('payment simulation is unavailable without an order (and mode-gated server-side)', async () => {
    const res = await client.fetch('/api/payments/00000000-0000-0000-0000-000000000000/simulate-success', { method: 'POST', body: {} });
    // simulated mode is active in tests (no razorpay keys), so this reaches the order lookup → 404
    expect(res.status).toBe(404);
  });
});
