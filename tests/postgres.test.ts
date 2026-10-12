/**
 * PostgreSQL (Supabase) dialect tests — SKIPPED unless TEST_DATABASE_URL is set.
 *
 *   TEST_DATABASE_URL='postgres://user:pass@host:5432/db' npx vitest run tests/postgres.test.ts
 *
 * NON-DESTRUCTIVE: applies migrations (idempotent), seeds only when the store is
 * empty, inserts test users/orders like any client would, and never drops data.
 * Still: point it at a SCRATCH database, not production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CookieJar, makeClient, registerUser, placeAndPayOrder, type TestClient } from './helpers.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
// helpers.ts set DATABASE_URL='' at module level; override before any server import (boot is dynamic).
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('postgres dialect (Supabase-compatible)', () => {
  let client: TestClient;
  let close: () => Promise<void>;
  let db: any;

  beforeAll(async () => {
    const { initDb } = await import('../server/db/index.js');
    const { migrate } = await import('../server/db/migrate.js');
    const { seedIfEmpty } = await import('../scripts/seed.js');
    const { createApp } = await import('../server/app.js');

    db = await initDb();
    await migrate(db);
    await seedIfEmpty();
    const app = createApp();
    const server: any = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    client = makeClient(`http://127.0.0.1:${server.address().port}`);
    close = async () => {
      server.close();
      await db.close();
    };
  }, 60_000);

  afterAll(async () => {
    await close();
  });

  it('boots on the postgres adapter', () => {
    expect(db.dialect).toBe('postgres');
  });

  it('health check verifies db readiness', async () => {
    const res = await client.fetch('/api/health');
    expect(res.status).toBe(200);
    expect(res.data.db).toBe('ok');
  });

  it('RLS helper functions exist (0002_rls applied)', async () => {
    const row = await db.get(`SELECT current_app_role() AS role, current_app_user_id() AS uid`);
    expect(row.role).toBe('anonymous');
    expect(row.uid).toBeNull();
  });

  it('request identity is visible to RLS inside the request transaction', async () => {
    const { withRequestIdentity } = await import('../server/db/index.js');
    const seen = await withRequestIdentity('user-123', 'owner', async () => {
      return db.get(`SELECT current_app_user_id() AS uid, current_app_role() AS role`);
    });
    expect(seen.uid).toBe('user-123');
    expect(seen.role).toBe('owner');
    // transaction-local: identity must NOT leak after the request
    const after = await db.get(`SELECT current_app_user_id() AS uid`);
    expect(after.uid).toBeNull();
  });

  it('serves catalogue with images and numeric aggregates', async () => {
    const list = await client.fetch('/api/products?pageSize=4&sort=popular');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data.items)).toBe(true);
    for (const item of list.data.items) {
      expect(Array.isArray(item.images)).toBe(true);
      expect(typeof item.total_stock).toBe('number'); // pg bigint parsed centrally
      expect(typeof item.units_sold).toBe('number');
      expect(typeof item.min_price_paise).toBe('number');
    }
  });

  it('admin metrics are numbers, not strings (int8/numeric parsing)', async () => {
    const jar = new CookieJar();
    const login = await client.fetch('/api/auth/login', {
      body: { email: process.env.ADMIN_EMAIL ?? 'owner@example.com', password: process.env.ADMIN_PASSWORD ?? 'ChangeMe123!' },
      jar,
    });
    if (login.status !== 200) {
      console.warn('[pg-test] admin login failed (pre-existing db without seeded admin?) — skipping metrics assertions');
      return;
    }
    const m = await client.fetch('/api/admin/metrics/overview?days=30', { jar });
    expect(m.status).toBe(200);
    expect(typeof m.data.revenue_paise).toBe('number');
    expect(typeof m.data.orders).toBe('number');
  });

  it('full order journey works on postgres (tx, binds, payments) and stays isolated', async () => {
    const jarA = new CookieJar();
    await registerUser(client, jarA, `pg-a-${Date.now()}@example.com`);
    const products = await client.fetch('/api/products?inStock=1&pageSize=1');
    if (!products.data.items.length) {
      console.warn('[pg-test] no stocked products on target — skipping order journey');
      return;
    }
    const slug = products.data.items[0].slug;
    const emailA = `pg-a-${Date.now()}@example.com`;
    const { order } = await placeAndPayOrder(client, jarA, slug, 1, emailA);
    expect(order.payment_status).toBe('captured');

    const jarB = new CookieJar();
    await registerUser(client, jarB, `pg-b-${Date.now()}@example.com`);
    const listB = await client.fetch('/api/orders', { jar: jarB });
    expect(listB.data.orders.map((o: any) => o.id)).not.toContain(order.id);
    const directB = await client.fetch(`/api/orders/${order.id}`, { jar: jarB });
    expect(directB.status).toBe(404);
  }, 60_000);

  it('duplicate webhook absorption works on postgres (one captured payment)', async () => {
    const jar = new CookieJar();
    const email = `pg-dup-${Date.now()}@example.com`;
    await registerUser(client, jar, email);
    const products = await client.fetch('/api/products?inStock=1&pageSize=1');
    if (!products.data.items.length) return;
    const p = await client.fetch(`/api/products/${products.data.items[0].slug}`);
    await client.fetch('/api/cart/items', { body: { variantId: p.data.product.variants[0].id, qty: 1 }, jar });
    const methods = await client.fetch('/api/shipping-methods');
    const order = await client.fetch('/api/orders', {
      jar,
      body: {
        email, phone: '+919876543210',
        shippingAddress: { full_name: 'Pg Dup', phone: '+919876543210', line1: '1 Rd', city: 'Mumbai', state: 'MH', postal_code: '400001' },
        shippingMethodId: methods.data.methods[0].id, paymentMethod: 'gateway', idempotencyKey: `pg-dup-${Date.now()}`,
      },
    });
    expect(order.status).toBe(201);
    const prep = await client.fetch(`/api/payments/${order.data.order.id}/prepare`, { jar, method: 'POST', body: {} });
    const wh = { event: 'payment.captured', payload: { payment: { entity: { id: `pay_PG_${Date.now()}`, order_id: prep.data.providerOrderId, method: 'upi' } } } };
    const w1 = await client.fetch('/api/webhooks/razorpay', { body: wh });
    const w2 = await client.fetch('/api/webhooks/razorpay', { body: wh });
    expect(w1.status).toBe(200);
    expect(w2.status).toBe(200);
    const rows = await db.query(`SELECT status FROM payments WHERE order_id = ?`, [order.data.order.id]);
    expect(rows.filter((r: any) => r.status === 'captured').length).toBe(1);
  }, 60_000);
});
