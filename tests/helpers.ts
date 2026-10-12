import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ojas-test-'));
process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = path.join(tmpDir, 'test.sqlite');
process.env.DATABASE_URL = '';
process.env.SESSION_SECRET = 'test-secret-value-long-enough';
process.env.SUPPLIER_SCHEDULER_ENABLED = 'false';
process.env.EMAIL_PROVIDER = 'console';
process.env.PUBLIC_URL = 'http://localhost:0';

export class CookieJar {
  private cookies = new Map<string, string>();
  absorb(headers: Headers) {
    const raw = headers.getSetCookie?.() ?? [];
    for (const c of raw) {
      const [pair] = c.split(';');
      const [k, ...rest] = pair.split('=');
      if (k) this.cookies.set(k.trim(), rest.join('='));
    }
  }
  header(): string | undefined {
    if (!this.cookies.size) return undefined;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

export interface TestClient {
  fetch: (path: string, init?: { method?: string; body?: unknown; jar?: CookieJar; headers?: Record<string, string> }) => Promise<{ status: number; data: any; headers: Headers }>;
  origin: string;
}

export async function boot(): Promise<{ client: TestClient; close: () => Promise<void> }> {
  const { initDb } = await import('../server/db/index.js');
  const { migrate } = await import('../server/db/migrate.js');
  const { seed } = await import('../scripts/seed.js');
  const { createApp } = await import('../server/app.js');

  const db = await initDb();
  await migrate(db);
  await seed();
  const app = createApp();
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const client: TestClient = {
    origin,
    fetch: async (p, init = {}) => {
      const headers: Record<string, string> = { ...(init.headers ?? {}) };
      const cookie = init.jar?.header();
      if (cookie) headers.Cookie = cookie;
      if (init.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`${origin}${p}`, {
        method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      init.jar?.absorb(res.headers);
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { status: res.status, data, headers: res.headers };
    },
  };

  return { client, close: async () => { server.close(); await db.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); } };
}

export async function loginAsAdmin(client: TestClient, jar: CookieJar) {
  const res = await client.fetch('/api/auth/login', { body: { email: process.env.ADMIN_EMAIL ?? 'owner@example.com', password: process.env.ADMIN_PASSWORD ?? 'ChangeMe123!' }, jar });
  if (res.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(res.data)}`);
  return res.data;
}

export async function registerUser(client: TestClient, jar: CookieJar, email: string) {
  const res = await client.fetch('/api/auth/register', { body: { email, password: 'Password123!', firstName: 'Test', lastName: 'User' }, jar });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.data)}`);
  return res.data;
}

export async function placeAndPayOrder(client: TestClient, jar: CookieJar, slug: string, qty = 1, email = 'buyer@example.com') {
  const product = await client.fetch(`/api/products/${slug}`);
  const variant = product.data.product.variants.find((v: any) => v.stock_qty > 0);
  await client.fetch('/api/cart/items', { body: { variantId: variant.id, qty }, jar });
  const methods = await client.fetch('/api/shipping-methods');
  const order = await client.fetch('/api/orders', {
    jar,
    body: {
      email,
      phone: '+919876543210',
      shippingAddress: { full_name: 'Buyer Person', phone: '+919876543210', line1: '22 Test Street', city: 'Bengaluru', state: 'Karnataka', postal_code: '560001' },
      shippingMethodId: methods.data.methods[0].id,
      paymentMethod: 'gateway',
      idempotencyKey: `test-${Math.random().toString(36).slice(2)}`,
    },
  });
  if (order.status !== 201) throw new Error(`order failed: ${JSON.stringify(order.data)}`);
  await client.fetch(`/api/payments/${order.data.order.id}/prepare`, { jar, method: 'POST', body: {} });
  const paid = await client.fetch(`/api/payments/${order.data.order.id}/simulate-success`, { jar, method: 'POST', body: {} });
  if (paid.status !== 200) throw new Error(`pay failed: ${JSON.stringify(paid.data)}`);
  return { order: order.data.order, variantId: variant.id, paid: paid.data.order };
}
