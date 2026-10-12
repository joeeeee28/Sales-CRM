import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { listProducts, getProductBySlug, listCategories, publishedReviews, relatedProducts } from '../lib/catalog.js';
import { getSettings } from '../lib/settings.js';
import { validate } from '../lib/validate.js';
import { b, json, mdToHtml } from '../lib/util.js';
import { trackingLimiter, contactLimiter } from '../lib/ratelimit.js';
import { loadOrderByNumber } from '../lib/orders.js';
import { gatewayStatus } from '../integrations/payments.js';
import type { ProductListItem, Product } from '../../shared/types.js';

export const storefrontRouter = Router();

function publicProduct(p: Product | ProductListItem) {
  const list = p as ProductListItem;
  return {
    ...p,
    min_price_paise: list.min_price_paise ?? p.base_price_paise,
    max_price_paise: list.max_price_paise ?? p.base_price_paise,
    total_stock: list.total_stock ?? (p.variants ?? []).reduce((s, v) => s + v.stock_qty, 0),
    images: (p.images ?? []).map((i) => ({ id: i.id, url: i.url, alt_text: i.alt_text })),
  };
}

storefrontRouter.get(
  '/bootstrap',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    res.json({
      store: {
        name: settings.store_name,
        tagline: settings.tagline,
        support_email: settings.support_email,
        support_phone: settings.support_phone,
        address_line: settings.address_line,
        currency: settings.currency,
        announcement_text: settings.announcement_text,
        announcement_link: settings.announcement_link,
        free_shipping_over_paise: settings.free_shipping_over_paise,
        cod_enabled: settings.cod_enabled,
      },
      payments: gatewayStatus(),
      categories: await listCategories(),
    });
  })
);

storefrontRouter.get(
  '/home',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    const categories = await listCategories();
    const featured = await listProducts({ pageSize: 8, sort: 'newest' });
    // "Featured" is an editorial curation (featured_rank), never fake popularity.
    const featuredRows = await db().query(
      `SELECT p.*, COALESCE(stock.total_stock,0) AS total_stock, p.base_price_paise AS min_price_paise, p.base_price_paise AS max_price_paise
       FROM products p
       LEFT JOIN (SELECT product_id, SUM(stock_qty) total_stock FROM product_variants WHERE is_active=1 GROUP BY product_id) stock ON stock.product_id = p.id
       WHERE p.status='active' AND p.featured_rank IS NOT NULL ORDER BY p.featured_rank LIMIT 4`
    );
    const newArrivals = await listProducts({ pageSize: 8, sort: 'newest' });
    // Genuine offers only: a real compare-at price higher than the selling price.
    const offerRows = await db().query(
      `SELECT p.*, COALESCE(stock.total_stock,0) AS total_stock, p.base_price_paise AS min_price_paise, p.base_price_paise AS max_price_paise
       FROM products p
       LEFT JOIN (SELECT product_id, SUM(stock_qty) total_stock FROM product_variants WHERE is_active=1 GROUP BY product_id) stock ON stock.product_id = p.id
       WHERE p.status='active' AND p.compare_at_price_paise IS NOT NULL AND p.compare_at_price_paise > p.base_price_paise
       ORDER BY p.compare_at_price_paise - p.base_price_paise DESC LIMIT 4`
    );
    const faqs = await db().query(`SELECT * FROM faqs WHERE is_active = 1 ORDER BY sort_order LIMIT 8`);

    // Verified reviews across the catalogue (never invented).
    const reviewRows = await db().query(
      `SELECT r.*, p.title AS product_title, p.slug AS product_slug
       FROM reviews r JOIN products p ON p.id = r.product_id
       WHERE r.status = 'published' AND r.is_verified_purchase = 1
       ORDER BY r.created_at DESC LIMIT 6`
    );

    const map = (rows: any[]): ProductListItem[] =>
      rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        brand: row.brand,
        tagline: row.tagline,
        description_md: row.description_md,
        highlights: json(row.highlights_json, []),
        category_id: row.category_id,
        status: row.status,
        base_price_paise: Number(row.base_price_paise),
        compare_at_price_paise: row.compare_at_price_paise == null ? null : Number(row.compare_at_price_paise),
        currency: row.currency,
        tax_rate_bps: row.tax_rate_bps,
        meta_title: row.meta_title,
        meta_description: row.meta_description,
        is_sample: b(row.is_sample),
        published_at: row.published_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        rating: null,
        units_sold: 0,
        min_price_paise: Number(row.min_price_paise),
        max_price_paise: Number(row.max_price_paise),
        total_stock: Number(row.total_stock),
        images: [],
      }));

    res.json({
      settings: {
        store_name: settings.store_name,
        tagline: settings.tagline,
        announcement_text: settings.announcement_text,
        free_shipping_over_paise: settings.free_shipping_over_paise,
      },
      categories,
      featured: map(featuredRows.length ? featuredRows : featured.items.slice(0, 4)),
      newArrivals: newArrivals.items.slice(0, 8).map(publicProduct),
      offers: map(offerRows),
      faqs: faqs.map((f) => ({ id: f.id, question: f.question, answer_md: f.answer_md, category: f.category })),
      reviews: reviewRows.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        author_name: r.author_name,
        product_title: r.product_title,
        product_slug: r.product_slug,
        created_at: r.created_at,
        is_verified_purchase: true,
      })),
      reviewPolicy: settings.reviews_require_purchase
        ? 'Reviews are published only from customers with a delivered order for the product.'
        : 'Reviews are moderated before publishing.',
    });
  })
);

storefrontRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    const q = validate(
      z.object({
        category: z.string().optional(),
        q: z.string().max(120).optional(),
        min: z.coerce.number().int().nonnegative().optional(),
        max: z.coerce.number().int().nonnegative().optional(),
        inStock: z.enum(['1', 'true']).optional(),
        sort: z.enum(['newest', 'price_asc', 'price_desc', 'popular', 'rating']).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(48).optional(),
      }),
      req.query
    );
    const result = await listProducts({
      category: q.category,
      q: q.q,
      min: q.min,
      max: q.max,
      inStock: q.inStock != null,
      sort: q.sort,
      page: q.page,
      pageSize: q.pageSize,
    });
    // attach primary image per product (single batched query)
    const ids = result.items.map((i) => i.id);
    const images = ids.length
      ? await db().query(
          `SELECT id, product_id, url, alt_text FROM product_images WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY sort_order`,
          ids
        )
      : [];
    const byProduct = new Map<string, { id: string; url: string; alt_text: string }[]>();
    for (const img of images) {
      const list = byProduct.get(img.product_id) ?? [];
      if (list.length < 1) list.push({ id: img.id, url: img.url, alt_text: img.alt_text });
      byProduct.set(img.product_id, list);
    }
    res.json({
      ...result,
      items: result.items.map((i) => ({ ...i, images: byProduct.get(i.id) ?? [] })),
    });
  })
);

storefrontRouter.get(
  '/products/:slug',
  asyncHandler(async (req, res) => {
    const product = await getProductBySlug(String(req.params.slug));
    if (!product) throw notFound('Product not found');
    const reviews = await publishedReviews(product.id);
    const related = await relatedProducts(product.id, product.category_id);
    const settings = await getSettings();
    res.json({ product: publicProduct(product), reviews, related: related.map(publicProduct), settings: { reviews_require_purchase: settings.reviews_require_purchase, tax_inclusive: settings.tax_inclusive, default_tax_bps: settings.default_tax_bps } });
  })
);

storefrontRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json({ categories: await listCategories() });
  })
);

storefrontRouter.get(
  '/shipping-methods',
  asyncHandler(async (_req, res) => {
    const rows = await db().query(`SELECT * FROM shipping_methods WHERE is_active = 1 ORDER BY sort_order`);
    res.json({
      methods: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        price_paise: Number(r.price_paise),
        free_over_paise: r.free_over_paise == null ? null : Number(r.free_over_paise),
        min_days: r.min_days,
        max_days: r.max_days,
        cod_available: b(r.cod_available),
      })),
    });
  })
);

const reviewSchema = z.object({
  productSlug: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(120).optional(),
  body: z.string().min(10).max(4000),
});

storefrontRouter.post(
  '/reviews',
  asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user) throw badRequest('Sign in to write a review');
    const input = validate(reviewSchema, req.body);
    const settings = await getSettings();
    const product = await getProductBySlug(input.productSlug);
    if (!product) throw notFound('Product not found');

    let verifiedOrderId: string | null = null;
    if (settings.reviews_require_purchase) {
      const purchase = await db().get(
        `SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'delivered' LIMIT 1`,
        [user.id, product.id]
      );
      if (!purchase) {
        throw badRequest('Reviews can only be written after a delivered order of this product. This keeps every review on the site genuine.');
      }
      verifiedOrderId = purchase.id;
    }
    const existing = await db().get(`SELECT id FROM reviews WHERE product_id = ? AND user_id = ?`, [product.id, user.id]);
    if (existing) throw badRequest('You have already reviewed this product');

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db().run(
      `INSERT INTO reviews (id, product_id, user_id, order_id, rating, title, body, author_name, is_verified_purchase, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        product.id,
        user.id,
        verifiedOrderId,
        input.rating,
        input.title ?? null,
        input.body,
        `${user.first_name} ${user.last_name}`.trim() || user.email,
        verifiedOrderId ? 1 : 0,
        verifiedOrderId ? 'published' : 'pending',
        now,
        now,
      ]
    );
    res.status(201).json({
      ok: true,
      status: verifiedOrderId ? 'published' : 'pending',
      message: verifiedOrderId ? 'Thank you — your verified review is live.' : 'Thank you — your review is awaiting moderation.',
    });
  })
);

/* ------------------------- content pages / FAQ ---------------------------- */

storefrontRouter.get(
  '/pages/:slug',
  asyncHandler(async (req, res) => {
    const row = await db().get(`SELECT * FROM content_pages WHERE slug = ?`, [String(req.params.slug)]);
    if (!row) throw notFound('Page not found');
    res.json({ page: { slug: row.slug, title: row.title, html: mdToHtml(row.body_md), updated_at: row.updated_at } });
  })
);

storefrontRouter.get(
  '/faqs',
  asyncHandler(async (_req, res) => {
    const rows = await db().query(`SELECT * FROM faqs WHERE is_active = 1 ORDER BY sort_order`);
    res.json({ faqs: rows.map((f) => ({ id: f.id, question: f.question, answer: mdToHtml(f.answer_md), answer_md: f.answer_md, category: f.category })) });
  })
);

const contactSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  subject: z.string().max(200).optional().default(''),
  body: z.string().min(10).max(5000),
});

storefrontRouter.post(
  '/contact',
  contactLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(contactSchema, req.body);
    await db().run(`INSERT INTO contact_messages (id, name, email, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'new', ?)`, [
      crypto.randomUUID(),
      input.name,
      input.email,
      input.subject,
      input.body,
      new Date().toISOString(),
    ]);
    res.status(201).json({ ok: true, message: "Thanks — we've received your message and will reply by email." });
  })
);

const newsletterSchema = z.object({ email: z.string().email().max(200), source: z.string().max(40).optional() });

storefrontRouter.post(
  '/newsletter',
  contactLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(newsletterSchema, req.body);
    const existing = await db().get(`SELECT * FROM newsletter_subscribers WHERE email = ?`, [input.email.toLowerCase()]);
    if (existing && !existing.unsubscribed_at) {
      res.json({ ok: true, message: "You're already subscribed — thank you!" });
      return;
    }
    if (existing) {
      await db().run(`UPDATE newsletter_subscribers SET unsubscribed_at = NULL, consented_at = ? WHERE id = ?`, [new Date().toISOString(), existing.id]);
    } else {
      await db().run(`INSERT INTO newsletter_subscribers (id, email, consented_at, source) VALUES (?, ?, ?, ?)`, [
        crypto.randomUUID(),
        input.email.toLowerCase(),
        new Date().toISOString(),
        input.source ?? 'footer',
      ]);
    }
    res.status(201).json({ ok: true, message: 'Subscribed. One thoughtful email a month, no spam.' });
  })
);

/* ------------------------- public order tracking -------------------------- */

const trackSchema = z.object({ number: z.string().min(4).max(40), contact: z.string().min(4).max(200) });

storefrontRouter.get(
  '/track',
  trackingLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(trackSchema, { number: req.query.number, contact: req.query.contact });
    const order = await loadOrderByNumber(input.number);
    const contact = input.contact.trim().toLowerCase();
    if (!order || (order.email.toLowerCase() !== contact && (order.phone ?? '').replace(/\D/g, '') !== contact.replace(/\D/g, ''))) {
      // Uniform response: do not leak whether the order exists.
      throw notFound('No order matches that number and contact detail.');
    }
    res.json({ order });
  })
);

/* ------------------------- privacy-conscious analytics -------------------- */

const eventSchema = z.object({
  name: z.string().min(1).max(60),
  path: z.string().max(300).optional(),
  sessionId: z.string().max(64).optional(),
  props: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});

storefrontRouter.post(
  '/analytics/event',
  asyncHandler(async (req, res) => {
    const input = validate(eventSchema, req.body);
    await db().run(
      `INSERT INTO analytics_events (id, client_id, session_id, name, path, props_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        req.cookies?.ojas_cid ?? null,
        input.sessionId ?? null,
        input.name,
        input.path ?? req.path,
        JSON.stringify(input.props ?? {}),
        new Date().toISOString(),
      ]
    );
    res.status(202).json({ ok: true });
  })
);
