import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { requirePermission, requireAuth } from '../lib/auth.js';
import { nowIso, uuid, b, bi, json, slugify, dayKey } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { getSettings, setSettingsBulk, invalidateSettings } from '../lib/settings.js';
import { loadOrder, cancelOrder, setOrderStatus, appendStatusEvent, notifyShipped } from '../lib/orders.js';
import { syncCatalog, syncStock, syncPrices } from '../jobs/sync.js';
import { processFulfillmentQueue, attemptFulfillment, syncTracking } from '../jobs/fulfillment.js';
import { getSupplier, listSuppliers, buildAdapter } from '../integrations/suppliers/registry.js';
import { gatewayStatus } from '../integrations/payments.js';
import type { AdminMetrics } from '../../shared/types.js';

export const adminRouter = Router();

adminRouter.use((req, _res, next) => {
  try {
    requireAuth(req);
    next();
  } catch (err) {
    next(err);
  }
});

/* ------------------------------- overview --------------------------------- */

const REVENUE_STATUSES = `('payment_confirmed','processing','shipped','out_for_delivery','delivered')`;

adminRouter.get(
  '/metrics/overview',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'reports:read');
    const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30)));
    const from = new Date(Date.now() - days * 86400_000).toISOString();
    const to = nowIso();
    const sampleFilter = req.query.includeSample === '1' ? '' : `AND o.is_sample = 0`;

    const revenueRow = await db().get(
      `SELECT COALESCE(SUM(total_paise),0) AS revenue, COUNT(*) AS orders, COALESCE(SUM(
         (SELECT SUM(oi.qty) FROM order_items oi WHERE oi.order_id = o.id)),0) AS units
       FROM orders o WHERE o.payment_status = 'captured' AND o.status NOT IN ('cancelled','refunded') AND o.placed_at >= ? ${sampleFilter}`,
      [from]
    );
    const customersRow = await db().get(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer' AND created_at >= ?`, [from]);
    const sessionsRow = await db().get(`SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE created_at >= ?`, [from]);
    const ordersRow = await db().get(`SELECT COUNT(*) AS n FROM orders o WHERE o.placed_at >= ? ${sampleFilter}`, [from]);

    const byDay = await db().query(
      `SELECT substr(placed_at, 1, 10) AS day, COALESCE(SUM(total_paise),0) AS revenue, COUNT(*) AS orders
       FROM orders o WHERE o.payment_status = 'captured' AND o.status NOT IN ('cancelled','refunded') AND o.placed_at >= ? ${sampleFilter}
       GROUP BY substr(placed_at, 1, 10) ORDER BY day`,
      [from]
    );

    const top = await db().query(
      `SELECT oi.product_id, oi.title, SUM(oi.qty) AS units, SUM(oi.total_paise) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.payment_status = 'captured' AND o.status NOT IN ('cancelled','refunded') AND o.placed_at >= ? ${sampleFilter}
       GROUP BY oi.product_id, oi.title ORDER BY units DESC LIMIT 5`,
      [from]
    );

    const byStatus = await db().query(`SELECT status, COUNT(*) AS n FROM orders o WHERE o.placed_at >= ? ${sampleFilter} GROUP BY status`, [from]);

    const pendingFulfillment = await db().get(
      `SELECT COUNT(*) AS n FROM supplier_orders WHERE status IN ('pending','retrying','submitted')`
    );
    const supplierFailures = await db().get(`SELECT COUNT(*) AS n FROM supplier_orders WHERE status = 'failed'`);
    const lowStock = await db().query(
      `SELECT v.id AS variant_id, v.sku, p.title, v.stock_qty FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.stock_qty <= v.low_stock_threshold AND p.status = 'active' ORDER BY v.stock_qty LIMIT 10`
    );

    const revenue = Number(revenueRow?.revenue ?? 0);
    const ordersCount = Number(revenueRow?.orders ?? 0);
    const sessions = Number(sessionsRow?.n ?? 0);
    const placed = Number(ordersRow?.n ?? 0);

    const metrics: AdminMetrics = {
      range: { from, to },
      revenue_paise: revenue,
      orders_count: ordersCount,
      aov_paise: ordersCount ? Math.round(revenue / ordersCount) : 0,
      units_sold: Number(revenueRow?.units ?? 0),
      customers_count: Number(customersRow?.n ?? 0),
      conversion: sessions > 0 ? { sessions, orders: placed, rate: placed / sessions } : null,
      revenue_by_day: byDay.map((r) => ({ day: r.day, revenue_paise: Number(r.revenue), orders: Number(r.orders) })),
      top_products: top.map((r) => ({ product_id: r.product_id, title: r.title, units: Number(r.units), revenue_paise: Number(r.revenue) })),
      orders_by_status: byStatus.map((r) => ({ status: r.status, count: Number(r.n) })),
      pending_fulfillment: Number(pendingFulfillment?.n ?? 0),
      supplier_failures: Number(supplierFailures?.n ?? 0),
      low_stock: lowStock.map((r) => ({ variant_id: r.variant_id, sku: r.sku, title: r.title, stock_qty: r.stock_qty })),
    };
    res.json({ metrics, gateway: gatewayStatus(), settings: await getSettings() });
  })
);

/* ------------------------------- products --------------------------------- */

const productSchema = z.object({
  title: z.string().min(2).max(160),
  slug: z.string().max(160).optional(),
  brand: z.string().max(80).nullable().optional(),
  tagline: z.string().max(200).nullable().optional(),
  description_md: z.string().max(20000).optional().default(''),
  highlights: z.array(z.string().max(200)).max(10).optional().default([]),
  category_id: z.string().nullable().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional().default('draft'),
  base_price_paise: z.number().int().nonnegative(),
  compare_at_price_paise: z.number().int().nonnegative().nullable().optional(),
  tax_rate_bps: z.number().int().min(0).max(5000).optional().default(1800),
  meta_title: z.string().max(200).nullable().optional(),
  meta_description: z.string().max(320).nullable().optional(),
  featured_rank: z.number().int().nullable().optional(),
  is_sample: z.boolean().optional(),
});

adminRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const q = String(req.query.q ?? '');
    const status = String(req.query.status ?? '');
    const rows = await db().query(
      `SELECT p.*, c.name AS category_name,
              COALESCE((SELECT SUM(stock_qty) FROM product_variants v WHERE v.product_id = p.id),0) AS total_stock
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE (? = '' OR LOWER(p.search_text) LIKE ?) AND (? = '' OR p.status = ?)
       ORDER BY p.updated_at DESC LIMIT 200`,
      [q, `%${q.toLowerCase()}%`, status, status]
    );
    res.json({
      products: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        status: r.status,
        category_name: r.category_name,
        base_price_paise: Number(r.base_price_paise),
        compare_at_price_paise: r.compare_at_price_paise == null ? null : Number(r.compare_at_price_paise),
        total_stock: Number(r.total_stock),
        is_sample: b(r.is_sample),
        updated_at: r.updated_at,
      })),
    });
  })
);

adminRouter.get(
  '/products/:id',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const row = await db().get(`SELECT * FROM products WHERE id = ?`, [req.params.id]);
    if (!row) throw notFound('Product not found');
    const variants = await db().query(`SELECT * FROM product_variants WHERE product_id = ? ORDER BY sku`, [row.id]);
    const images = await db().query(`SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order`, [row.id]);
    const specs = await db().query(`SELECT * FROM product_specs WHERE product_id = ? ORDER BY sort_order`, [row.id]);
    const supplierLinks = await db().query(
      `SELECT sp.*, s.name AS supplier_name, s.code AS supplier_code FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id WHERE sp.store_variant_id IN (SELECT id FROM product_variants WHERE product_id = ?)`,
      [row.id]
    );
    res.json({
      product: { ...row, base_price_paise: Number(row.base_price_paise), highlights: json(row.highlights_json, []), is_sample: b(row.is_sample) },
      variants: variants.map((v) => ({ ...v, price_paise: v.price_paise == null ? null : Number(v.price_paise), cost_paise: v.cost_paise == null ? null : Number(v.cost_paise), options: json(v.options_json, {}) })),
      images,
      specs,
      supplierLinks,
    });
  })
);

adminRouter.post(
  '/products',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'products:write');
    const input = validate(productSchema, req.body);
    const id = uuid();
    let slug = input.slug ? slugify(input.slug) : slugify(input.title);
    const dupe = await db().get(`SELECT id FROM products WHERE slug = ?`, [slug]);
    if (dupe) slug = `${slug}-${id.slice(0, 6)}`;
    const now = nowIso();
    await db().run(
      `INSERT INTO products (id, slug, title, brand, tagline, description_md, highlights_json, category_id, status, base_price_paise, compare_at_price_paise, currency, tax_rate_bps, meta_title, meta_description, search_text, featured_rank, is_sample, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, slug, input.title, input.brand ?? null, input.tagline ?? null, input.description_md, JSON.stringify(input.highlights),
        input.category_id ?? null, input.status, input.base_price_paise, input.compare_at_price_paise ?? null, (await getSettings()).currency,
        input.tax_rate_bps, input.meta_title ?? null, input.meta_description ?? null,
        `${input.title} ${input.brand ?? ''} ${input.tagline ?? ''} ${input.description_md}`.toLowerCase(),
        input.featured_rank ?? null, input.is_sample ? 1 : 0, input.status === 'active' ? now : null, now, now,
      ]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'product.create', entityType: 'product', entityId: id, after: input, req });
    res.status(201).json({ id, slug });
  })
);

adminRouter.patch(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'products:write');
    const existing = await db().get(`SELECT * FROM products WHERE id = ?`, [req.params.id]);
    if (!existing) throw notFound('Product not found');
    const input = validate(productSchema.partial(), req.body);
    const now = nowIso();
    const status = input.status ?? existing.status;
    const search = `${input.title ?? existing.title} ${input.brand ?? existing.brand ?? ''} ${input.description_md ?? existing.description_md}`.toLowerCase();
    await db().run(
      `UPDATE products SET title = COALESCE(?, title), brand = COALESCE(?, brand), tagline = COALESCE(?, tagline),
        description_md = COALESCE(?, description_md), highlights_json = COALESCE(?, highlights_json),
        category_id = COALESCE(?, category_id), status = ?, base_price_paise = COALESCE(?, base_price_paise),
        compare_at_price_paise = ?, tax_rate_bps = COALESCE(?, tax_rate_bps), meta_title = ?, meta_description = ?,
        search_text = ?, featured_rank = ?, published_at = COALESCE(published_at, CASE WHEN ? = 'active' THEN ? END), updated_at = ?
       WHERE id = ?`,
      [
        input.title, input.brand === undefined ? null : input.brand, input.tagline === undefined ? null : input.tagline,
        input.description_md, input.highlights ? JSON.stringify(input.highlights) : null,
        input.category_id === undefined ? null : input.category_id, status,
        input.base_price_paise, input.compare_at_price_paise === undefined ? existing.compare_at_price_paise : input.compare_at_price_paise,
        input.tax_rate_bps, input.meta_title === undefined ? null : input.meta_title, input.meta_description === undefined ? null : input.meta_description,
        search, input.featured_rank === undefined ? existing.featured_rank : input.featured_rank, status, now, now, existing.id,
      ]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'product.update', entityType: 'product', entityId: existing.id, before: { status: existing.status, price: existing.base_price_paise }, after: input, req });
    res.json({ ok: true });
  })
);

adminRouter.delete(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'products:write');
    // Archive instead of hard delete: preserves order history integrity.
    await db().run(`UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?`, [nowIso(), req.params.id]);
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'product.archive', entityType: 'product', entityId: String(req.params.id), req });
    res.json({ ok: true });
  })
);

const variantSchema = z.object({
  sku: z.string().min(1).max(60),
  title: z.string().max(120).optional().default(''),
  options: z.record(z.string().max(60)).optional().default({}),
  price_paise: z.number().int().nonnegative().nullable().optional(),
  compare_at_price_paise: z.number().int().nonnegative().nullable().optional(),
  stock_qty: z.number().int().min(0).optional().default(0),
  low_stock_threshold: z.number().int().min(0).optional().default(2),
  cost_paise: z.number().int().nonnegative().nullable().optional(),
  is_active: z.boolean().optional().default(true),
  supplier_id: z.string().nullable().optional(),
  supplier_variant_ref: z.string().max(120).nullable().optional(),
});

adminRouter.post(
  '/products/:id/variants',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'products:write');
    const product = await db().get(`SELECT id FROM products WHERE id = ?`, [req.params.id]);
    if (!product) throw notFound('Product not found');
    const input = validate(variantSchema, req.body);
    const dupe = await db().get(`SELECT id FROM product_variants WHERE sku = ?`, [input.sku]);
    if (dupe) throw badRequest(`SKU "${input.sku}" already exists`);
    const id = uuid();
    await db().run(
      `INSERT INTO product_variants (id, product_id, sku, title, options_json, price_paise, compare_at_price_paise, stock_qty, low_stock_threshold, is_active, supplier_id, supplier_variant_ref, cost_paise, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, product.id, input.sku, input.title, JSON.stringify(input.options), input.price_paise ?? null, input.compare_at_price_paise ?? null, input.stock_qty, input.low_stock_threshold, bi(input.is_active), input.supplier_id ?? null, input.supplier_variant_ref ?? null, input.cost_paise ?? null, nowIso(), nowIso()]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'variant.create', entityType: 'variant', entityId: id, after: input, req });
    res.status(201).json({ id });
  })
);

adminRouter.patch(
  '/variants/:id',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'products:write');
    const existing = await db().get(`SELECT * FROM product_variants WHERE id = ?`, [req.params.id]);
    if (!existing) throw notFound('Variant not found');
    const input = validate(variantSchema.partial(), req.body);
    await db().run(
      `UPDATE product_variants SET sku = COALESCE(?, sku), title = COALESCE(?, title), options_json = COALESCE(?, options_json),
        price_paise = ?, compare_at_price_paise = ?, stock_qty = COALESCE(?, stock_qty), low_stock_threshold = COALESCE(?, low_stock_threshold),
        is_active = COALESCE(?, is_active), supplier_id = ?, supplier_variant_ref = ?, cost_paise = ?, updated_at = ? WHERE id = ?`,
      [
        input.sku, input.title, input.options ? JSON.stringify(input.options) : null,
        input.price_paise === undefined ? existing.price_paise : input.price_paise,
        input.compare_at_price_paise === undefined ? existing.compare_at_price_paise : input.compare_at_price_paise,
        input.stock_qty, input.low_stock_threshold,
        input.is_active === undefined ? null : bi(input.is_active),
        input.supplier_id === undefined ? existing.supplier_id : input.supplier_id,
        input.supplier_variant_ref === undefined ? existing.supplier_variant_ref : input.supplier_variant_ref,
        input.cost_paise === undefined ? existing.cost_paise : input.cost_paise,
        nowIso(), existing.id,
      ]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'variant.update', entityType: 'variant', entityId: existing.id, before: { stock: existing.stock_qty, price: existing.price_paise }, after: input, req });
    res.json({ ok: true });
  })
);

adminRouter.post(
  '/products/:id/images',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'products:write');
    const input = validate(z.object({ url: z.string().min(3).max(500), alt_text: z.string().max(300).default(''), sort_order: z.number().int().default(0) }), req.body);
    await db().run(`INSERT INTO product_images (id, product_id, url, alt_text, sort_order) VALUES (?, ?, ?, ?, ?)`, [uuid(), req.params.id, input.url, input.alt_text, input.sort_order]);
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'image.add', entityType: 'product', entityId: String(req.params.id), after: input, req });
    res.status(201).json({ ok: true });
  })
);

adminRouter.delete(
  '/images/:id',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'products:write');
    await db().run(`DELETE FROM product_images WHERE id = ?`, [req.params.id]);
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'image.remove', entityType: 'image', entityId: String(req.params.id), req });
    res.json({ ok: true });
  })
);

adminRouter.post(
  '/products/:id/specs',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'products:write');
    const input = validate(z.object({ label: z.string().min(1).max(80), value: z.string().min(1).max(300), sort_order: z.number().int().default(0) }), req.body);
    await db().run(`INSERT INTO product_specs (id, product_id, label, value, sort_order) VALUES (?, ?, ?, ?, ?)`, [uuid(), req.params.id, input.label, input.value, input.sort_order]);
    res.status(201).json({ ok: true });
  })
);

adminRouter.delete(
  '/specs/:id',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'products:write');
    await db().run(`DELETE FROM product_specs WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  })
);

/* ------------------------------- categories ------------------------------- */

adminRouter.get(
  '/categories',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const rows = await db().query(`SELECT * FROM categories ORDER BY sort_order, name`);
    res.json({ categories: rows.map((r) => ({ ...r, is_active: b(r.is_active) })) });
  })
);

const categorySchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  image_url: z.string().max(500).nullable().optional(),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

adminRouter.post(
  '/categories',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'products:write');
    const input = validate(categorySchema, req.body);
    const slug = input.slug ? slugify(input.slug) : slugify(input.name);
    const id = uuid();
    await db().run(
      `INSERT INTO categories (id, slug, name, description, image_url, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, slug, input.name, input.description ?? null, input.image_url ?? null, input.sort_order, bi(input.is_active), nowIso(), nowIso()]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'category.create', entityType: 'category', entityId: id, after: input, req });
    res.status(201).json({ id, slug });
  })
);

adminRouter.patch(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'products:write');
    const input = validate(categorySchema.partial(), req.body);
    await db().run(
      `UPDATE categories SET name = COALESCE(?, name), slug = COALESCE(?, slug), description = ?, image_url = ?, sort_order = COALESCE(?, sort_order), is_active = COALESCE(?, is_active), updated_at = ? WHERE id = ?`,
      [input.name, input.slug ? slugify(input.slug) : null, input.description === undefined ? null : input.description, input.image_url === undefined ? null : input.image_url, input.sort_order, input.is_active === undefined ? null : bi(input.is_active), nowIso(), req.params.id]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'category.update', entityType: 'category', entityId: String(req.params.id), after: input, req });
    res.json({ ok: true });
  })
);

/* ------------------------------- orders ----------------------------------- */

adminRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const status = String(req.query.status ?? '');
    const q = String(req.query.q ?? '').toLowerCase();
    const rows = await db().query(
      `SELECT o.*, u.email AS customer_email FROM orders o LEFT JOIN users u ON u.id = o.user_id
       WHERE (? = '' OR o.status = ?) AND (? = '' OR LOWER(o.number) LIKE ? OR LOWER(o.email) LIKE ?)
       ORDER BY o.placed_at DESC LIMIT 200`,
      [status, status, q, `%${q}%`, `%${q}%`]
    );
    res.json({
      orders: rows.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        payment_status: r.payment_status,
        fulfillment_status: r.fulfillment_status,
        email: r.email,
        total_paise: Number(r.total_paise),
        placed_at: r.placed_at,
        is_sample: b(r.is_sample),
        items_count: null,
      })),
    });
  })
);

adminRouter.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const order = await loadOrder(String(req.params.id));
    if (!order) throw notFound('Order not found');
    const supplierOrders = await db().query(`SELECT * FROM supplier_orders WHERE order_id = ? ORDER BY created_at`, [order.id]);
    const payments = await db().query(`SELECT id, provider, provider_order_id, provider_payment_id, method, status, amount_paise, captured_at, failure_reason, created_at FROM payments WHERE order_id = ?`, [order.id]);
    const returns = await db().query(`SELECT * FROM returns WHERE order_id = ?`, [order.id]);
    const customer = order.id ? await db().get(`SELECT u.id, u.email, u.first_name, u.last_name, u.created_at FROM users u JOIN orders o ON o.user_id = u.id WHERE o.id = ?`, [order.id]) : null;
    res.json({
      order,
      supplier_orders: supplierOrders.map((s) => ({ ...s, attempts: Number(s.attempts) })),
      payments: payments.map((p) => ({ ...p, amount_paise: Number(p.amount_paise) })),
      returns,
      customer,
    });
  })
);

const statusSchema = z.object({ status: z.string().min(2).max(40), note: z.string().max(300).nullable().optional() });

adminRouter.post(
  '/orders/:id/status',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'orders:write');
    const input = validate(statusSchema, req.body);
    const order = await loadOrder(String(req.params.id));
    if (!order) throw notFound('Order not found');
    await setOrderStatus(order.id, input.status as any, { type: 'admin', id: user.id }, input.note ?? null);

    if (input.status === 'shipped' && !order.shipments.length) {
      const shipmentId = uuid();
      await db().run(
        `INSERT INTO shipments (id, order_id, carrier, status, shipped_at, created_at, updated_at) VALUES (?, ?, 'Store logistics', 'shipped', ?, ?, ?)`,
        [shipmentId, order.id, nowIso(), nowIso(), nowIso()]
      );
      await appendStatusEvent(order.id, 'shipped', { type: 'admin', id: user.id }, 'Shipment created');
      const updated = (await loadOrder(order.id))!;
      await notifyShipped(updated, updated.shipments[0]!);
    }
    if (input.status === 'cancelled') {
      await cancelOrder(order.id, { type: 'admin', id: user.id }, input.note ?? null);
    }
    if (input.status === 'delivered') {
      await db().run(`UPDATE payments SET status = 'captured', captured_at = COALESCE(captured_at, ?) WHERE order_id = ? AND provider = 'cod'`, [nowIso(), order.id]);
      await db().run(`UPDATE orders SET payment_status = CASE WHEN payment_provider = 'cod' THEN 'captured' ELSE payment_status END, updated_at = ? WHERE id = ?`, [nowIso(), order.id]);
    }
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'order.status', entityType: 'order', entityId: order.id, before: { status: order.status }, after: { status: input.status }, req });
    res.json({ order: await loadOrder(order.id) });
  })
);

adminRouter.post(
  '/orders/:id/refund',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'orders:write');
    const input = validate(z.object({ amountPaise: z.number().int().nonnegative().optional(), reason: z.string().max(300).optional() }), req.body);
    const order = await loadOrder(String(req.params.id));
    if (!order) throw notFound('Order not found');
    const amount = input.amountPaise ?? order.total_paise;
    await db().run(`UPDATE orders SET payment_status = ?, status = 'refunded', updated_at = ? WHERE id = ?`, [amount >= order.total_paise ? 'refunded' : 'partially_refunded', nowIso(), order.id]);
    await db().run(`UPDATE payments SET status = 'refunded' WHERE order_id = ? AND status = 'captured'`, [order.id]);
    await appendStatusEvent(order.id, 'refunded', { type: 'admin', id: user.id }, input.reason ?? `Refund of ₹${(amount / 100).toFixed(2)} initiated`);
    const { sendEmail, emailTemplates } = await import('../lib/email.js');
    const settings = await getSettings();
    await sendEmail({ to: order.email, subject: `Refund initiated for ${order.number}`, template: 'refund_issued', text: emailTemplates.refund(settings.store_name, order.number, `₹${(amount / 100).toLocaleString('en-IN')}`) });
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'order.refund', entityType: 'order', entityId: order.id, after: { amount_paise: amount }, req });
    res.json({ order: await loadOrder(order.id) });
  })
);

adminRouter.post(
  '/orders/:id/fulfill',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'orders:write');
    const order = await loadOrder(String(req.params.id));
    if (!order) throw notFound('Order not found');
    await enqueueFulfillmentImport(order.id);
    const result = await processFulfillmentQueue();
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'order.fulfill_trigger', entityType: 'order', entityId: order.id, after: result, req });
    res.json({ ok: true, result, order: await loadOrder(order.id) });
  })
);

async function enqueueFulfillmentImport(orderId: string) {
  const { enqueueFulfillment } = await import('../jobs/fulfillment.js');
  await enqueueFulfillment(orderId);
}

adminRouter.get(
  '/exports/orders.csv',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'reports:read');
    const rows = await db().query(
      `SELECT o.number, o.placed_at, o.status, o.payment_status, o.fulfillment_status, o.email, o.total_paise, o.shipping_paise, o.discount_paise, o.coupon_code, o.is_sample
       FROM orders o ORDER BY o.placed_at DESC LIMIT 5000`
    );
    const header = 'number,placed_at,status,payment_status,fulfillment_status,email,total_paise,shipping_paise,discount_paise,coupon_code,sample';
    const lines = rows.map((r) =>
      [r.number, r.placed_at, r.status, r.payment_status, r.fulfillment_status, csv(r.email), r.total_paise, r.shipping_paise, r.discount_paise, csv(r.coupon_code ?? ''), r.is_sample].join(',')
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${dayKey(nowIso())}.csv"`);
    res.send([header, ...lines].join('\n'));
  })
);

adminRouter.get(
  '/exports/sales.csv',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'reports:read');
    const rows = await db().query(
      `SELECT substr(o.placed_at,1,10) AS day, COUNT(DISTINCT o.id) AS orders, SUM(o.total_paise) AS revenue, SUM(oi.qty) AS units
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       WHERE o.payment_status = 'captured' AND o.status NOT IN ('cancelled','refunded')
       GROUP BY substr(o.placed_at,1,10) ORDER BY day DESC LIMIT 1000`
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sales-${dayKey(nowIso())}.csv"`);
    res.send(['day,orders,revenue_paise,units', ...rows.map((r) => [r.day, r.orders, r.revenue, r.units].join(','))].join('\n'));
  })
);

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/* ------------------------------- customers -------------------------------- */

adminRouter.get(
  '/customers',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'customers:read');
    const q = String(req.query.q ?? '').toLowerCase();
    const rows = await db().query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.created_at, u.marketing_consent,
              (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders_count,
              (SELECT COALESCE(SUM(o.total_paise),0) FROM orders o WHERE o.user_id = u.id AND o.payment_status='captured') AS lifetime_paise
       FROM users u WHERE (? = '' OR LOWER(u.email) LIKE ? OR LOWER(u.first_name || ' ' || u.last_name) LIKE ?)
       ORDER BY u.created_at DESC LIMIT 200`,
      [q, `%${q}%`, `%${q}%`]
    );
    res.json({ customers: rows.map((r) => ({ ...r, lifetime_paise: Number(r.lifetime_paise), marketing_consent: b(r.marketing_consent) })) });
  })
);

adminRouter.get(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'customers:read');
    const user = await db().get(`SELECT id, email, first_name, last_name, phone, role, marketing_consent, created_at FROM users WHERE id = ?`, [req.params.id]);
    if (!user) throw notFound('Customer not found');
    const orderIds = await db().query(`SELECT id FROM orders WHERE user_id = ? ORDER BY placed_at DESC`, [user.id]);
    const orders = [];
    for (const row of orderIds.slice(0, 50)) orders.push(await loadOrder(row.id));
    const addresses = await db().query(`SELECT * FROM addresses WHERE user_id = ?`, [user.id]);
    res.json({ customer: { ...user, marketing_consent: b(user.marketing_consent) }, orders, addresses });
  })
);

/* ------------------------------- coupons ---------------------------------- */

const couponSchema = z.object({
  code: z.string().min(2).max(40),
  description: z.string().max(200).default(''),
  type: z.enum(['percent', 'fixed', 'free_shipping']),
  value: z.number().int().nonnegative().default(0),
  min_subtotal_paise: z.number().int().nonnegative().default(0),
  max_discount_paise: z.number().int().nonnegative().nullable().optional(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  usage_limit: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().default(true),
});

adminRouter.get(
  '/coupons',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const rows = await db().query(`SELECT * FROM coupons ORDER BY created_at DESC`);
    res.json({ coupons: rows.map((r) => ({ ...r, is_active: b(r.is_active), value: Number(r.value), min_subtotal_paise: Number(r.min_subtotal_paise), max_discount_paise: r.max_discount_paise == null ? null : Number(r.max_discount_paise) })) });
  })
);

adminRouter.post(
  '/coupons',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'coupons:write');
    const input = validate(couponSchema, req.body);
    const id = uuid();
    await db().run(
      `INSERT INTO coupons (id, code, description, type, value, min_subtotal_paise, max_discount_paise, starts_at, ends_at, usage_limit, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.code.toUpperCase(), input.description, input.type, input.value, input.min_subtotal_paise, input.max_discount_paise ?? null, input.starts_at ?? null, input.ends_at ?? null, input.usage_limit ?? null, bi(input.is_active), nowIso(), nowIso()]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'coupon.create', entityType: 'coupon', entityId: id, after: input, req });
    res.status(201).json({ id });
  })
);

adminRouter.patch(
  '/coupons/:id',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'coupons:write');
    const input = validate(couponSchema.partial(), req.body);
    const existing = await db().get(`SELECT * FROM coupons WHERE id = ?`, [req.params.id]);
    if (!existing) throw notFound('Coupon not found');
    await db().run(
      `UPDATE coupons SET code = COALESCE(?, code), description = COALESCE(?, description), type = COALESCE(?, type), value = COALESCE(?, value),
        min_subtotal_paise = COALESCE(?, min_subtotal_paise), max_discount_paise = ?, starts_at = ?, ends_at = ?, usage_limit = ?, is_active = COALESCE(?, is_active), updated_at = ? WHERE id = ?`,
      [input.code?.toUpperCase(), input.description, input.type, input.value, input.min_subtotal_paise,
       input.max_discount_paise === undefined ? existing.max_discount_paise : input.max_discount_paise,
       input.starts_at === undefined ? existing.starts_at : input.starts_at,
       input.ends_at === undefined ? existing.ends_at : input.ends_at,
       input.usage_limit === undefined ? existing.usage_limit : input.usage_limit,
       input.is_active === undefined ? null : bi(input.is_active), nowIso(), existing.id]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'coupon.update', entityType: 'coupon', entityId: existing.id, after: input, req });
    res.json({ ok: true });
  })
);

/* ------------------------------- suppliers -------------------------------- */

adminRouter.get(
  '/suppliers',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const suppliers = await listSuppliers();
    const out = [];
    for (const s of suppliers) {
      const mapped = await db().get(`SELECT COUNT(*) AS n FROM supplier_products WHERE supplier_id = ? AND store_variant_id IS NOT NULL`, [s.id]);
      const orders = await db().get(`SELECT COUNT(*) AS n, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM supplier_orders WHERE supplier_id = ?`, [s.id]);
      const lastRun = await db().get(`SELECT * FROM sync_runs WHERE supplier_id = ? ORDER BY started_at DESC LIMIT 1`, [s.id]);
      out.push({
        ...s,
        is_active: b(s.is_active),
        supports_fulfillment: b(s.supports_fulfillment),
        supports_tracking: b(s.supports_tracking),
        config: json(s.config_json, {}),
        mapped_variants: Number(mapped?.n ?? 0),
        orders_count: Number(orders?.n ?? 0),
        orders_failed: Number(orders?.failed ?? 0),
        last_sync: lastRun ?? null,
      });
    }
    res.json({ suppliers: out });
  })
);

const supplierSchema = z.object({
  code: z.string().min(2).max(40),
  name: z.string().min(2).max(120),
  adapter_type: z.enum(['mock', 'http_json']),
  config: z.record(z.any()).default({}),
  is_active: z.boolean().default(true),
  supports_fulfillment: z.boolean().default(false),
  supports_tracking: z.boolean().default(false),
  notes: z.string().max(1000).nullable().optional(),
});

adminRouter.post(
  '/suppliers',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'suppliers:write');
    const input = validate(supplierSchema, req.body);
    const id = uuid();
    await db().run(
      `INSERT INTO suppliers (id, code, name, adapter_type, config_json, is_active, supports_fulfillment, supports_tracking, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.code, input.name, input.adapter_type, JSON.stringify(input.config), bi(input.is_active), bi(input.supports_fulfillment), bi(input.supports_tracking), input.notes ?? null, nowIso(), nowIso()]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'supplier.create', entityType: 'supplier', entityId: id, after: { ...input, config: '[redacted in audit]' }, req });
    res.status(201).json({ id });
  })
);

adminRouter.patch(
  '/suppliers/:id',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'suppliers:write');
    const input = validate(supplierSchema.partial(), req.body);
    const existing = await getSupplier(String(req.params.id));
    if (!existing) throw notFound('Supplier not found');
    await db().run(
      `UPDATE suppliers SET code = COALESCE(?, code), name = COALESCE(?, name), config_json = COALESCE(?, config_json),
        is_active = COALESCE(?, is_active), supports_fulfillment = COALESCE(?, supports_fulfillment), supports_tracking = COALESCE(?, supports_tracking), notes = ?, updated_at = ? WHERE id = ?`,
      [input.code, input.name, input.config ? JSON.stringify(input.config) : null,
       input.is_active === undefined ? null : bi(input.is_active),
       input.supports_fulfillment === undefined ? null : bi(input.supports_fulfillment),
       input.supports_tracking === undefined ? null : bi(input.supports_tracking),
       input.notes === undefined ? existing.notes : input.notes, nowIso(), existing.id]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'supplier.update', entityType: 'supplier', entityId: existing.id, req });
    res.json({ ok: true });
  })
);

adminRouter.post(
  '/suppliers/:id/test',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'suppliers:write');
    const supplier = await getSupplier(String(req.params.id));
    if (!supplier) throw notFound('Supplier not found');
    const result = await buildAdapter(supplier).healthCheck();
    res.json(result);
  })
);

adminRouter.post(
  '/suppliers/:id/sync/:job',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'suppliers:write');
    const supplier = await getSupplier(String(req.params.id));
    if (!supplier) throw notFound('Supplier not found');
    const job = String(req.params.job);
    let result: unknown;
    if (job === 'catalog') result = await syncCatalog(supplier.id);
    else if (job === 'stock') result = await syncStock(supplier.id);
    else if (job === 'prices') result = await syncPrices(supplier.id);
    else if (job === 'tracking') result = await syncTracking();
    else if (job === 'fulfillment') result = await processFulfillmentQueue();
    else throw notFound('Unknown job');
    await audit({ actor: { id: user.id, type: 'admin' }, action: `supplier.sync.${job}`, entityType: 'supplier', entityId: supplier.id, after: result, req });
    res.json({ ok: true, result });
  })
);

adminRouter.get(
  '/supplier-products',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const supplierId = String(req.query.supplierId ?? '');
    const rows = await db().query(
      `SELECT sp.*, s.code AS supplier_code, v.sku AS store_sku, p.title AS store_title
       FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id
       LEFT JOIN product_variants v ON v.id = sp.store_variant_id
       LEFT JOIN products p ON p.id = v.product_id
       WHERE (? = '' OR sp.supplier_id = ?) ORDER BY sp.updated_at DESC LIMIT 300`,
      [supplierId, supplierId]
    );
    res.json({ items: rows.map((r) => ({ ...r, price_paise: r.price_paise == null ? null : Number(r.price_paise) })) });
  })
);

adminRouter.post(
  '/supplier-products/:id/map',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'suppliers:write');
    const input = validate(z.object({ variantId: z.string().nullable() }), req.body);
    const row = await db().get(`SELECT * FROM supplier_products WHERE id = ?`, [req.params.id]);
    if (!row) throw notFound('Supplier product not found');
    await db().run(`UPDATE supplier_products SET store_variant_id = ?, updated_at = ? WHERE id = ?`, [input.variantId, nowIso(), row.id]);
    if (input.variantId) {
      await db().run(`UPDATE product_variants SET supplier_id = ?, supplier_variant_ref = ?, updated_at = ? WHERE id = ?`, [row.supplier_id, row.external_id, nowIso(), input.variantId]);
    }
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'supplier.map_variant', entityType: 'supplier_product', entityId: row.id, after: { variant_id: input.variantId }, req });
    res.json({ ok: true });
  })
);

adminRouter.get(
  '/supplier-orders',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const rows = await db().query(
      `SELECT so.*, s.code AS supplier_code, o.number AS order_number FROM supplier_orders so
       JOIN suppliers s ON s.id = so.supplier_id JOIN orders o ON o.id = so.order_id
       ORDER BY so.created_at DESC LIMIT 200`
    );
    res.json({ items: rows.map((r) => ({ ...r, attempts: Number(r.attempts) })) });
  })
);

adminRouter.post(
  '/supplier-orders/:id/retry',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'suppliers:write');
    const result = await attemptFulfillment(String(req.params.id));
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'supplier.retry', entityType: 'supplier_order', entityId: String(req.params.id), after: { result }, req });
    res.json({ ok: true, result });
  })
);

/* ------------------------------- stock ------------------------------------ */

adminRouter.get(
  '/stock',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const rows = await db().query(
      `SELECT v.id, v.sku, v.title, v.stock_qty, v.low_stock_threshold, v.is_active, v.supplier_variant_ref,
              p.title AS product_title, p.slug AS product_slug, s.code AS supplier_code, sp.last_synced_at, sp.stock_qty AS supplier_stock
       FROM product_variants v JOIN products p ON p.id = v.product_id
       LEFT JOIN suppliers s ON s.id = v.supplier_id
       LEFT JOIN supplier_products sp ON sp.store_variant_id = v.id
       WHERE p.status != 'archived'
       ORDER BY v.stock_qty ASC LIMIT 300`
    );
    res.json({ items: rows.map((r) => ({ ...r, is_active: b(r.is_active) })) });
  })
);

/* ------------------------------- returns ---------------------------------- */

adminRouter.get(
  '/returns',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'returns:write');
    const rows = await db().query(
      `SELECT r.*, o.number AS order_number, o.email FROM returns r JOIN orders o ON o.id = r.order_id ORDER BY r.created_at DESC LIMIT 200`
    );
    res.json({ returns: rows.map((r) => ({ ...r, refund_amount_paise: r.refund_amount_paise == null ? null : Number(r.refund_amount_paise) })) });
  })
);

adminRouter.patch(
  '/returns/:id',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'returns:write');
    const input = validate(z.object({ status: z.enum(['requested', 'approved', 'picked_up', 'received', 'refunded', 'rejected', 'closed']), refundAmountPaise: z.number().int().nonnegative().nullable().optional(), note: z.string().max(300).optional() }), req.body);
    const row = await db().get(`SELECT * FROM returns WHERE id = ?`, [req.params.id]);
    if (!row) throw notFound('Return not found');
    await db().run(
      `UPDATE returns SET status = ?, refund_amount_paise = COALESCE(?, refund_amount_paise), updated_at = ?, resolved_at = CASE WHEN ? IN ('refunded','rejected','closed') THEN ? ELSE resolved_at END WHERE id = ?`,
      [input.status, input.refundAmountPaise === undefined ? null : input.refundAmountPaise, nowIso(), input.status, nowIso(), row.id]
    );
    if (input.status === 'refunded') {
      await db().run(`UPDATE orders SET payment_status = 'refunded', status = 'refunded', updated_at = ? WHERE id = ?`, [nowIso(), row.order_id]);
      const order = await loadOrder(row.order_id);
      if (order) {
        const settings = await getSettings();
        const { sendEmail, emailTemplates } = await import('../lib/email.js');
        await sendEmail({ to: order.email, subject: `Refund issued for ${order.number}`, template: 'refund_issued', text: emailTemplates.refund(settings.store_name, order.number, `₹${((input.refundAmountPaise ?? order.total_paise) / 100).toLocaleString('en-IN')}`) });
      }
    }
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'return.update', entityType: 'return', entityId: row.id, before: { status: row.status }, after: input, req });
    res.json({ ok: true });
  })
);

/* ------------------------------- reviews moderation ----------------------- */

adminRouter.get(
  '/reviews',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const status = String(req.query.status ?? 'pending');
    const rows = await db().query(
      `SELECT r.*, p.title AS product_title, p.slug AS product_slug FROM reviews r JOIN products p ON p.id = r.product_id
       WHERE (? = '' OR r.status = ?) ORDER BY r.created_at DESC LIMIT 200`,
      [status, status]
    );
    res.json({ reviews: rows.map((r) => ({ ...r, is_verified_purchase: b(r.is_verified_purchase) })) });
  })
);

adminRouter.patch(
  '/reviews/:id',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'content:write');
    const input = validate(z.object({ status: z.enum(['pending', 'published', 'rejected']) }), req.body);
    await db().run(`UPDATE reviews SET status = ?, updated_at = ? WHERE id = ?`, [input.status, nowIso(), req.params.id]);
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'review.moderate', entityType: 'review', entityId: String(req.params.id), after: input, req });
    res.json({ ok: true });
  })
);

/* ------------------------------- content ---------------------------------- */

adminRouter.get(
  '/pages',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'content:write');
    const rows = await db().query(`SELECT * FROM content_pages ORDER BY slug`);
    res.json({ pages: rows.map((r) => ({ ...r, requires_legal_review: b(r.requires_legal_review) })) });
  })
);

adminRouter.patch(
  '/pages/:slug',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'content:write');
    const input = validate(z.object({ title: z.string().max(200).optional(), body_md: z.string().max(50000).optional(), requires_legal_review: z.boolean().optional() }), req.body);
    const existing = await db().get(`SELECT * FROM content_pages WHERE slug = ?`, [req.params.slug]);
    if (!existing) throw notFound('Page not found');
    await db().run(`UPDATE content_pages SET title = COALESCE(?, title), body_md = COALESCE(?, body_md), requires_legal_review = COALESCE(?, requires_legal_review), updated_at = ? WHERE slug = ?`, [
      input.title, input.body_md, input.requires_legal_review === undefined ? null : bi(input.requires_legal_review), nowIso(), existing.slug,
    ]);
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'page.update', entityType: 'page', entityId: existing.slug, req });
    res.json({ ok: true });
  })
);

adminRouter.get(
  '/faqs',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'content:write');
    const rows = await db().query(`SELECT * FROM faqs ORDER BY sort_order`);
    res.json({ faqs: rows.map((f) => ({ ...f, is_active: b(f.is_active) })) });
  })
);

adminRouter.post(
  '/faqs',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'content:write');
    const input = validate(z.object({ question: z.string().min(3).max(300), answer_md: z.string().min(3).max(5000), category: z.string().max(80).nullable().optional(), sort_order: z.number().int().default(0), is_active: z.boolean().default(true) }), req.body);
    await db().run(`INSERT INTO faqs (id, question, answer_md, category, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?)`, [uuid(), input.question, input.answer_md, input.category ?? null, input.sort_order, bi(input.is_active)]);
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'faq.create', entityType: 'faq', after: input, req });
    res.status(201).json({ ok: true });
  })
);

adminRouter.patch(
  '/faqs/:id',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'content:write');
    const input = validate(z.object({ question: z.string().min(3).max(300).optional(), answer_md: z.string().min(3).max(5000).optional(), sort_order: z.number().int().optional(), is_active: z.boolean().optional(), category: z.string().max(80).nullable().optional() }), req.body);
    await db().run(`UPDATE faqs SET question = COALESCE(?, question), answer_md = COALESCE(?, answer_md), sort_order = COALESCE(?, sort_order), is_active = COALESCE(?, is_active), category = ? WHERE id = ?`, [
      input.question, input.answer_md, input.sort_order, input.is_active === undefined ? null : bi(input.is_active), input.category === undefined ? null : input.category, req.params.id,
    ]);
    res.json({ ok: true });
  })
);

adminRouter.delete(
  '/faqs/:id',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'content:write');
    await db().run(`DELETE FROM faqs WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  })
);

adminRouter.get(
  '/messages',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const rows = await db().query(`SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 200`);
    res.json({ messages: rows });
  })
);

adminRouter.patch(
  '/messages/:id',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const input = validate(z.object({ status: z.enum(['new', 'replied', 'closed']) }), req.body);
    await db().run(`UPDATE contact_messages SET status = ? WHERE id = ?`, [input.status, req.params.id]);
    res.json({ ok: true });
  })
);

/* ------------------------------- settings / ops --------------------------- */

adminRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const settings = await getSettings();
    const shippingMethods = await db().query(`SELECT * FROM shipping_methods ORDER BY sort_order`);
    res.json({ settings, shipping_methods: shippingMethods.map((m) => ({ ...m, is_active: b(m.is_active), cod_available: b(m.cod_available), price_paise: Number(m.price_paise), free_over_paise: m.free_over_paise == null ? null : Number(m.free_over_paise) })), gateway: gatewayStatus() });
  })
);

const settingsSchema = z.object({
  store_name: z.string().min(1).max(80).optional(),
  tagline: z.string().max(200).optional(),
  support_email: z.string().email().optional(),
  support_phone: z.string().max(40).optional(),
  address_line: z.string().max(300).optional(),
  cod_enabled: z.boolean().optional(),
  cod_max_amount_paise: z.number().int().nonnegative().optional(),
  free_shipping_over_paise: z.number().int().nonnegative().nullable().optional(),
  tax_inclusive: z.boolean().optional(),
  default_tax_bps: z.number().int().min(0).max(5000).optional(),
  announcement_text: z.string().max(200).nullable().optional(),
  announcement_link: z.string().max(300).nullable().optional(),
  fulfillment_enabled: z.boolean().optional(),
  reviews_require_purchase: z.boolean().optional(),
});

adminRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'settings:write');
    const input = validate(settingsSchema, req.body);
    await setSettingsBulk(input, user.id);
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'settings.update', entityType: 'settings', after: input, req });
    res.json({ settings: await getSettings() });
  })
);

adminRouter.post(
  '/shipping-methods',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'settings:write');
    const input = validate(z.object({ code: z.string().min(2).max(40), name: z.string().min(2).max(80), description: z.string().max(300).default(''), price_paise: z.number().int().nonnegative(), free_over_paise: z.number().int().nonnegative().nullable().optional(), min_days: z.number().int().min(0).max(60), max_days: z.number().int().min(0).max(90), is_active: z.boolean().default(true), cod_available: z.boolean().default(false), sort_order: z.number().int().default(0) }), req.body);
    await db().run(
      `INSERT INTO shipping_methods (id, code, name, description, price_paise, free_over_paise, min_days, max_days, is_active, cod_available, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), input.code, input.name, input.description, input.price_paise, input.free_over_paise ?? null, input.min_days, input.max_days, bi(input.is_active), bi(input.cod_available), input.sort_order]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'shipping_method.create', entityType: 'shipping_method', after: input, req });
    res.status(201).json({ ok: true });
  })
);

adminRouter.patch(
  '/shipping-methods/:id',
  asyncHandler(async (req, res) => {
    const user = requirePermission(req, 'settings:write');
    const input = validate(z.object({ name: z.string().max(80).optional(), description: z.string().max(300).optional(), price_paise: z.number().int().nonnegative().optional(), free_over_paise: z.number().int().nonnegative().nullable().optional(), min_days: z.number().int().min(0).max(60).optional(), max_days: z.number().int().min(0).max(90).optional(), is_active: z.boolean().optional(), cod_available: z.boolean().optional(), sort_order: z.number().int().optional() }), req.body);
    const existing = await db().get(`SELECT * FROM shipping_methods WHERE id = ?`, [req.params.id]);
    if (!existing) throw notFound('Shipping method not found');
    await db().run(
      `UPDATE shipping_methods SET name = COALESCE(?, name), description = COALESCE(?, description), price_paise = COALESCE(?, price_paise), free_over_paise = ?, min_days = COALESCE(?, min_days), max_days = COALESCE(?, max_days), is_active = COALESCE(?, is_active), cod_available = COALESCE(?, cod_available), sort_order = COALESCE(?, sort_order) WHERE id = ?`,
      [input.name, input.description, input.price_paise, input.free_over_paise === undefined ? existing.free_over_paise : input.free_over_paise, input.min_days, input.max_days, input.is_active === undefined ? null : bi(input.is_active), input.cod_available === undefined ? null : bi(input.cod_available), input.sort_order, existing.id]
    );
    await audit({ actor: { id: user.id, type: 'admin' }, action: 'shipping_method.update', entityType: 'shipping_method', entityId: existing.id, after: input, req });
    invalidateSettings();
    res.json({ ok: true });
  })
);

adminRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'reports:read');
    const rows = await db().query(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 300`);
    res.json({ entries: rows });
  })
);

adminRouter.get(
  '/emails',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const rows = await db().query(`SELECT id, to_email, subject, template, status, provider, error, created_at FROM email_log ORDER BY created_at DESC LIMIT 200`);
    res.json({ emails: rows });
  })
);

adminRouter.get(
  '/sync-runs',
  asyncHandler(async (req, res) => {
    requirePermission(req, 'orders:write');
    const rows = await db().query(`SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 100`);
    res.json({ runs: rows });
  })
);

void forbidden;
