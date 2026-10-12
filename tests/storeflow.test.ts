import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, CookieJar, loginAsAdmin, registerUser, placeAndPayOrder, type TestClient } from './helpers.js';

let client: TestClient;
let close: () => Promise<void>;
const adminJar = new CookieJar();

beforeAll(async () => {
  const app = await boot();
  client = app.client;
  close = app.close;
  await loginAsAdmin(client, adminJar);
});

afterAll(async () => {
  await close();
});

describe('catalogue: browsing, search, filters, variants', () => {
  it('lists products and filters by category, price, stock and sort', async () => {
    const all = await client.fetch('/api/products?pageSize=48');
    expect(all.status).toBe(200);
    expect(all.data.total).toBeGreaterThanOrEqual(7);

    const audio = await client.fetch('/api/products?category=audio-desk');
    expect(audio.data.items.every((i: any) => i.category?.slug === 'audio-desk' || i.category_id)).toBe(true);
    expect(audio.data.total).toBe(3);

    const cheap = await client.fetch('/api/products?max=200000');
    expect(cheap.data.items.every((i: any) => i.min_price_paise <= 200000)).toBe(true);

    const inStock = await client.fetch('/api/products?inStock=1');
    expect(inStock.data.items.every((i: any) => i.total_stock > 0)).toBe(true);

    const asc = await client.fetch('/api/products?sort=price_asc');
    const prices = asc.data.items.map((i: any) => i.min_price_paise);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('search returns relevant products only', async () => {
    const res = await client.fetch('/api/products?q=keyboard');
    expect(res.data.total).toBe(1);
    expect(res.data.items[0].slug).toContain('keyboard');
    const none = await client.fetch('/api/products?q=zzzznotfound');
    expect(none.data.total).toBe(0);
  });

  it('product page exposes variants, specs, images and honest availability', async () => {
    const res = await client.fetch('/api/products/meridian-pro-anc-headphones');
    expect(res.status).toBe(200);
    const p = res.data.product;
    expect(p.variants.length).toBe(2);
    expect(p.specs.length).toBeGreaterThan(0);
    expect(p.images.length).toBeGreaterThan(0);
    expect(p.rating).toBeNull(); // no verified reviews yet → no invented rating
  });

  it('rejects adding more than available stock', async () => {
    const jar = new CookieJar();
    const p = await client.fetch('/api/products/aera-linen-throw');
    const v = p.data.product.variants[0];
    const res = await client.fetch('/api/cart/items', { body: { variantId: v.id, qty: v.stock_qty + 50 }, jar });
    expect(res.status).toBe(409);
  });
});

describe('cart maths & coupons', () => {
  it('computes subtotal, coupon discount, free shipping and totals', async () => {
    const jar = new CookieJar();
    const p = await client.fetch('/api/products/terra-stoneware-mug-set');
    const v = p.data.product.variants[0];
    await client.fetch('/api/cart/items', { body: { variantId: v.id, qty: 1 }, jar });
    const cart = await client.fetch('/api/cart', { jar });
    const unit = v.price_paise ?? p.data.product.base_price_paise;
    expect(cart.data.cart.subtotal_paise).toBe(unit);

    const methods = await client.fetch('/api/shipping-methods');
    const quote = await client.fetch('/api/checkout/quote', { body: { shippingMethodId: methods.data.methods[0].id }, jar });
    // below free-shipping threshold → shipping charged
    expect(quote.data.quote.shipping_paise).toBe(methods.data.methods[0].price_paise);

    await client.fetch('/api/cart/coupon', { body: { code: 'WELCOME10' }, jar });
    const cart2 = await client.fetch('/api/cart', { jar });
    expect(cart2.data.cart.discount_paise).toBe(Math.round((cart2.data.cart.subtotal_paise * 10) / 100));

    const bad = await client.fetch('/api/cart/coupon', { body: { code: 'DOESNOTEXIST' }, jar });
    expect(bad.status).toBe(400);

    // free shipping coupon overrides price threshold
    await client.fetch('/api/cart/coupon', { body: { code: 'FREESHIP' }, jar });
    const quote2 = await client.fetch('/api/checkout/quote', { body: { shippingMethodId: methods.data.methods[0].id }, jar });
    expect(quote2.data.quote.shipping_paise).toBe(0);
  });
});

describe('checkout validation & order creation', () => {
  it('rejects invalid checkout payloads', async () => {
    const jar = new CookieJar();
    const p = await client.fetch('/api/products/terra-stoneware-mug-set');
    await client.fetch('/api/cart/items', { body: { variantId: p.data.product.variants[0].id, qty: 1 }, jar });
    const methods = await client.fetch('/api/shipping-methods');
    const res = await client.fetch('/api/orders', {
      jar,
      body: { email: 'not-an-email', phone: '123', shippingAddress: { full_name: 'x' }, shippingMethodId: methods.data.methods[0].id, paymentMethod: 'gateway', idempotencyKey: 'invalid-payload-test' },
    });
    expect(res.status).toBe(400);
  });

  it('creates an order once per idempotency key and reserves stock', async () => {
    const jar = new CookieJar();
    const p = await client.fetch('/api/products/terra-stoneware-mug-set');
    const v = p.data.product.variants[0];
    const before = v.stock_qty;
    await client.fetch('/api/cart/items', { body: { variantId: v.id, qty: 2 }, jar });
    const methods = await client.fetch('/api/shipping-methods');
    const body = {
      email: 'idem@example.com',
      phone: '+919876543210',
      shippingAddress: { full_name: 'Idem Potent', phone: '+919876543210', line1: '1 Rd', city: 'Bengaluru', state: 'KA', postal_code: '560001' },
      shippingMethodId: methods.data.methods[0].id,
      paymentMethod: 'gateway',
      idempotencyKey: 'fixed-key-abc-123',
    };
    const first = await client.fetch('/api/orders', { jar, body });
    expect(first.status).toBe(201);
    const second = await client.fetch('/api/orders', { jar, body });
    expect(second.data.order.id).toBe(first.data.order.id);
    expect(second.data.duplicate).toBe(true);

    const stock = await client.fetch(`/api/products/terra-stoneware-mug-set`);
    expect(stock.data.product.variants[0].stock_qty).toBe(before - 2);
  });

  it('blocks COD while the store has it disabled', async () => {
    const jar = new CookieJar();
    const p = await client.fetch('/api/products/terra-stoneware-mug-set');
    await client.fetch('/api/cart/items', { body: { variantId: p.data.product.variants[0].id, qty: 1 }, jar });
    const methods = await client.fetch('/api/shipping-methods');
    const res = await client.fetch('/api/orders', {
      jar,
      body: {
        email: 'cod@example.com', phone: '+919876543210',
        shippingAddress: { full_name: 'Cod Test', phone: '+919876543210', line1: '1 Rd', city: 'Bengaluru', state: 'KA', postal_code: '560001' },
        shippingMethodId: methods.data.methods[0].id, paymentMethod: 'cod', idempotencyKey: 'cod-test-1',
      },
    });
    expect(res.status).toBe(400);
    expect(res.data.error.message).toMatch(/Cash on Delivery/);
  });
});

describe('payments: success, failure, duplicates', () => {
  it('captures payment once and confirms the order', async () => {
    const jar = new CookieJar();
    const { paid } = await placeAndPayOrder(client, jar, 'halo-desk-lamp');
    expect(paid.payment_status).toBe('captured');
    expect(paid.status).toBe('payment_confirmed');
  });

  it('failure leaves the order payable and notifies the customer', async () => {
    const jar = new CookieJar();
    const p = await client.fetch('/api/products/halo-desk-lamp');
    await client.fetch('/api/cart/items', { body: { variantId: p.data.product.variants[0].id, qty: 1 }, jar });
    const methods = await client.fetch('/api/shipping-methods');
    const order = await client.fetch('/api/orders', {
      jar,
      body: {
        email: 'failpay@example.com', phone: '+919876543210',
        shippingAddress: { full_name: 'Fail Pay', phone: '+919876543210', line1: '1 Rd', city: 'Bengaluru', state: 'KA', postal_code: '560001' },
        shippingMethodId: methods.data.methods[0].id, paymentMethod: 'gateway', idempotencyKey: 'fail-pay-1',
      },
    });
    const fail = await client.fetch(`/api/payments/${order.data.order.id}/fail`, { jar, body: { reason: 'card declined' } });
    expect(fail.status).toBe(200);
    expect(fail.data.order.payment_status).toBe('failed');
    expect(fail.data.order.status).toBe('payment_pending');
  });

  it('absorbs duplicate webhook notifications (single captured payment)', async () => {
    const jar = new CookieJar();
    const p = await client.fetch('/api/products/halo-desk-lamp');
    await client.fetch('/api/cart/items', { body: { variantId: p.data.product.variants[0].id, qty: 1 }, jar });
    const methods = await client.fetch('/api/shipping-methods');
    const order = await client.fetch('/api/orders', {
      jar,
      body: {
        email: 'dup@example.com', phone: '+919876543210',
        shippingAddress: { full_name: 'Dup Webhook', phone: '+919876543210', line1: '1 Rd', city: 'Bengaluru', state: 'KA', postal_code: '560001' },
        shippingMethodId: methods.data.methods[0].id, paymentMethod: 'gateway', idempotencyKey: 'dup-webhook-1',
      },
    });
    const prep = await client.fetch(`/api/payments/${order.data.order.id}/prepare`, { jar, method: 'POST', body: {} });
    expect(prep.status).toBe(200);
    const webhook = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST_DUP', order_id: prep.data.providerOrderId, method: 'upi' } } } };
    const w1 = await client.fetch('/api/webhooks/razorpay', { body: webhook });
    const w2 = await client.fetch('/api/webhooks/razorpay', { body: webhook });
    expect(w1.status).toBe(200);
    expect(w2.status).toBe(200);

    const adminOrder = await client.fetch(`/api/admin/orders/${order.data.order.id}`, { jar: adminJar });
    const captured = adminOrder.data.payments.filter((x: any) => x.status === 'captured');
    expect(captured.length).toBe(1);
    expect(adminOrder.data.order.payment_status).toBe('captured');
  });
});

describe('authorization & data isolation', () => {
  it('customers cannot reach admin APIs', async () => {
    const jar = new CookieJar();
    await registerUser(client, jar, 'plain-customer@example.com');
    const res = await client.fetch('/api/admin/metrics/overview', { jar });
    expect(res.status).toBe(403);
  });

  it('anonymous visitors cannot reach admin APIs', async () => {
    const res = await client.fetch('/api/admin/orders');
    expect(res.status).toBe(401);
  });

  it('customer A cannot read customer B orders', async () => {
    const jarA = new CookieJar();
    await registerUser(client, jarA, 'a@example.com');
    const { order } = await placeAndPayOrder(client, jarA, 'commuter-22l-backpack', 1, 'a@example.com');

    const jarB = new CookieJar();
    await registerUser(client, jarB, 'b@example.com');
    const list = await client.fetch('/api/orders', { jar: jarB });
    expect(list.data.orders.map((o: any) => o.id)).not.toContain(order.id);
    const direct = await client.fetch(`/api/orders/${order.id}`, { jar: jarB });
    expect(direct.status).toBe(404);
  });

  it('public tracking requires the matching contact detail', async () => {
    const jarA = new CookieJar();
    await registerUser(client, jarA, 'track-owner@example.com');
    const { order } = await placeAndPayOrder(client, jarA, 'commuter-22l-backpack', 1, 'track-owner@example.com');
    const ok = await client.fetch(`/api/track?number=${order.number}&contact=track-owner@example.com`);
    expect(ok.status).toBe(200);
    const bad = await client.fetch(`/api/track?number=${order.number}&contact=stranger@example.com`);
    expect(bad.status).toBe(404);
  });
});

describe('reviews are verified-purchase only', () => {
  it('blocks reviews without a delivered order, publishes with one', async () => {
    const jar = new CookieJar();
    await registerUser(client, jar, 'reviewer@example.com');
    const blocked = await client.fetch('/api/reviews', { jar, body: { productSlug: 'halo-desk-lamp', rating: 5, body: 'Great lamp, warm light exactly as described.' } });
    expect(blocked.status).toBe(400);

    const { order } = await placeAndPayOrder(client, jar, 'halo-desk-lamp', 1, 'reviewer@example.com');
    // admin marks it delivered
    await client.fetch(`/api/admin/orders/${order.id}/status`, { jar: adminJar, body: { status: 'processing' } });
    await client.fetch(`/api/admin/orders/${order.id}/status`, { jar: adminJar, body: { status: 'shipped' } });
    await client.fetch(`/api/admin/orders/${order.id}/status`, { jar: adminJar, body: { status: 'delivered' } });

    const review = await client.fetch('/api/reviews', { jar, body: { productSlug: 'halo-desk-lamp', rating: 5, title: 'Warm and solid', body: 'The dim-to-warm curve is exactly as described. Lovely on a desk.' } });
    expect(review.status).toBe(201);
    expect(review.data.status).toBe('published');

    const product = await client.fetch('/api/products/halo-desk-lamp');
    expect(product.data.reviews.length).toBe(1);
    expect(product.data.reviews[0].is_verified_purchase).toBe(true);
    expect(product.data.product.rating.count).toBe(1);
  });
});

describe('supplier integration: stock sync, fulfillment, failures', () => {
  it('syncs supplier stock into variant stock', async () => {
    const suppliers = await client.fetch('/api/admin/suppliers', { jar: adminJar });
    const sid = suppliers.data.suppliers[0].id;
    const catalog = await client.fetch(`/api/admin/supplier-products?supplierId=${sid}`, { jar: adminJar });
    const mug = catalog.data.items.find((i: any) => i.external_sku === 'SUP-MUG-01');
    await client.fetch(`/api/admin/suppliers/${sid}`, { jar: adminJar, method: 'PATCH', body: { config: { latencyMs: 1, stockOverride: { [mug.external_id]: 7 } } } });
    const sync = await client.fetch(`/api/admin/suppliers/${sid}/sync/stock`, { jar: adminJar, method: 'POST' });
    expect(sync.status).toBe(200);
    expect(sync.data.result.changed).toBeGreaterThanOrEqual(1);
    const stock = await client.fetch('/api/admin/stock', { jar: adminJar });
    expect(stock.data.items.find((i: any) => i.sku === 'OJ-MUG-CRM').stock_qty).toBe(7);
    await client.fetch(`/api/admin/suppliers/${sid}`, { jar: adminJar, method: 'PATCH', body: { config: { latencyMs: 1 } } });
  });

  it('sends paid orders to the supplier, retries failures, and syncs tracking', async () => {
    const suppliers = await client.fetch('/api/admin/suppliers', { jar: adminJar });
    const sid = suppliers.data.suppliers[0].id;
    // enable fulfillment
    await client.fetch('/api/admin/settings', { jar: adminJar, method: 'PATCH', body: { fulfillment_enabled: true } });
    // make the supplier fail
    await client.fetch(`/api/admin/suppliers/${sid}`, { jar: adminJar, method: 'PATCH', body: { config: { latencyMs: 1, failNextFulfillment: 9 } } });

    const jar = new CookieJar();
    const { order } = await placeAndPayOrder(client, jar, 'prana-natural-rubber-yoga-mat', 1, 'fulfil@example.com');

    const processed = await client.fetch(`/api/admin/suppliers/${sid}/sync/fulfillment`, { jar: adminJar, method: 'POST' });
    expect(processed.data.result.failed).toBe(1);
    const soList = await client.fetch('/api/admin/supplier-orders', { jar: adminJar });
    const so = soList.data.items.find((s: any) => s.order_id === order.id);
    expect(so.status).toBe('retrying');
    expect(so.next_retry_at).toBeTruthy();
    expect(so.last_error).toMatch(/timeout/i);

    // heal + retry
    await client.fetch(`/api/admin/suppliers/${sid}`, { jar: adminJar, method: 'PATCH', body: { config: { latencyMs: 1 } } });
    const retry = await client.fetch(`/api/admin/supplier-orders/${so.id}/retry`, { jar: adminJar, method: 'POST' });
    expect(retry.data.result).toBe('ok');

    // tracking sync creates a shipment with events and moves the order to shipped
    await client.fetch(`/api/admin/suppliers/${sid}/sync/tracking`, { jar: adminJar, method: 'POST' });
    const after = await client.fetch(`/api/admin/orders/${order.id}`, { jar: adminJar });
    expect(after.data.order.status).toBe('shipped');
    expect(after.data.order.shipments.length).toBe(1);
    expect(after.data.order.shipments[0].tracking_number).toMatch(/^MOCKTRK/);
    expect(after.data.order.shipments[0].events.length).toBeGreaterThan(0);

    await client.fetch('/api/admin/settings', { jar: adminJar, method: 'PATCH', body: { fulfillment_enabled: false } });
  });
});

describe('home rails are catalogue-driven and carry images', () => {
  it('serves featured/offers/new-arrivals/popular from real queries', async () => {
    const res = await client.fetch('/api/home');
    expect(res.status).toBe(200);
    expect(res.data.featured.length).toBeGreaterThan(0);
    expect(res.data.newArrivals.length).toBeGreaterThan(0);
    expect(Array.isArray(res.data.popular)).toBe(true); // empty until real orders exist — honest
    for (const rail of ['featured', 'offers', 'newArrivals', 'popular']) {
      for (const item of res.data[rail]) {
        expect(Array.isArray(item.images)).toBe(true);
        expect(item.images.length).toBeGreaterThan(0); // seeded products all have photography
        expect(typeof item.min_price_paise).toBe('number');
        expect(typeof item.total_stock).toBe('number');
      }
    }
    // offers must be genuine compare-at reductions
    expect(res.data.offers.length).toBeGreaterThan(0);
    for (const o of res.data.offers) {
      expect(o.compare_at_price_paise).toBeGreaterThan(o.min_price_paise);
    }
  });
});

describe('content, policies & SEO', () => {
  it('serves every policy page and the contact form works', async () => {
    for (const slug of ['shipping-policy', 'returns-refund-policy', 'privacy-policy', 'terms-and-conditions', 'cancellation-policy', 'about']) {
      const res = await client.fetch(`/api/pages/${slug}`);
      expect(res.status).toBe(200);
      expect(res.data.page.html.length).toBeGreaterThan(50);
    }
    const contact = await client.fetch('/api/contact', { body: { name: 'Test Person', email: 't@example.com', body: 'A sufficiently long test message.' } });
    expect(contact.status).toBe(201);
  });

  it('exposes sitemap and robots', async () => {
    const sm = await fetch(`${client.origin}/sitemap.xml`);
    expect(sm.status).toBe(200);
    expect(await sm.text()).toContain('<urlset');
    const rb = await fetch(`${client.origin}/robots.txt`);
    expect(await rb.text()).toContain('Sitemap:');
  });

  it('rate-limits sensitive endpoints', async () => {
    const results: number[] = [];
    for (let i = 0; i < 14; i++) {
      const r = await client.fetch('/api/auth/login', { body: { email: 'rl@example.com', password: 'nope-nope' } });
      results.push(r.status);
    }
    expect(results).toContain(429);
  });
});
