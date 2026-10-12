import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { asyncHandler, badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { validate, addressSchema } from '../lib/validate.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  requireAuth,
  createPasswordResetToken,
  consumePasswordResetToken,
  listPermissionsFor,
} from '../lib/auth.js';
import { authLimiter } from '../lib/ratelimit.js';
import { nowIso, uuid, b } from '../lib/util.js';
import { mergeGuestCart, GUEST_COOKIE } from '../lib/cart.js';
import { loadOrder, cancelOrder } from '../lib/orders.js';
import { sendEmail, emailTemplates } from '../lib/email.js';
import { getSettings } from '../lib/settings.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';

export const accountRouter = Router();

const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(128),
  firstName: z.string().max(60).optional().default(''),
  lastName: z.string().max(60).optional().default(''),
  phone: z.string().max(20).optional(),
  marketingConsent: z.boolean().optional().default(false),
});

accountRouter.post(
  '/auth/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(registerSchema, req.body);
    const email = input.email.toLowerCase();
    const existing = await db().get(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existing) throw conflict('An account with this email already exists. Try signing in.');
    const id = uuid();
    const now = nowIso();
    await db().run(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, marketing_consent, created_at, updated_at)
       VALUES (?, ?, ?, 'customer', ?, ?, ?, ?, ?, ?)`,
      [id, email, hashPassword(input.password), input.firstName, input.lastName, input.phone ?? null, input.marketingConsent ? 1 : 0, now, now]
    );
    await createSession(req, res, id);
    const guestCartId = req.cookies?.[GUEST_COOKIE] ? await db().get(`SELECT id FROM carts WHERE guest_key = ?`, [req.cookies[GUEST_COOKIE]]).then((r) => r?.id ?? null) : null;
    await mergeGuestCart(guestCartId, id);
    const settings = await getSettings();
    await sendEmail({ to: email, subject: `Welcome to ${settings.store_name}`, template: 'welcome', text: emailTemplates.welcome(settings.store_name, input.firstName) });
    await audit({ actor: { id, type: 'customer' }, action: 'auth.register', entityType: 'user', entityId: id, req });
    res.status(201).json({ user: await publicUser(id) });
  })
);

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

accountRouter.post(
  '/auth/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(loginSchema, req.body);
    const row = await db().get(`SELECT * FROM users WHERE email = ?`, [input.email.toLowerCase()]);
    if (!row || !verifyPassword(input.password, row.password_hash)) {
      throw unauthorized('Incorrect email or password');
    }
    await createSession(req, res, row.id);
    const guestCartId = req.cookies?.[GUEST_COOKIE] ? (await db().get(`SELECT id FROM carts WHERE guest_key = ?`, [req.cookies[GUEST_COOKIE]]))?.id ?? null : null;
    await mergeGuestCart(guestCartId, row.id);
    await audit({ actor: { id: row.id, type: 'customer' }, action: 'auth.login', entityType: 'user', entityId: row.id, req });
    res.json({ user: await publicUser(row.id) });
  })
);

accountRouter.post(
  '/auth/logout',
  asyncHandler(async (req, res) => {
    await destroySession(req, res);
    res.json({ ok: true });
  })
);

accountRouter.get(
  '/auth/me',
  asyncHandler(async (req, res) => {
    if (!req.user) {
      res.json({ user: null });
      return;
    }
    res.json({ user: await publicUser(req.user.id), permissions: listPermissionsFor(req.user.role) });
  })
);

async function publicUser(id: string) {
  const row = await db().get(`SELECT * FROM users WHERE id = ?`, [id]);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    marketing_consent: b(row.marketing_consent),
    created_at: row.created_at,
  };
}

accountRouter.patch(
  '/auth/me',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    const input = validate(
      z.object({
        firstName: z.string().max(60).optional(),
        lastName: z.string().max(60).optional(),
        phone: z.string().max(20).nullable().optional(),
        marketingConsent: z.boolean().optional(),
        currentPassword: z.string().optional(),
        newPassword: z.string().min(8).max(128).optional(),
      }),
      req.body
    );
    if (input.newPassword) {
      const row = await db().get(`SELECT password_hash FROM users WHERE id = ?`, [user.id]);
      if (!row || !verifyPassword(input.currentPassword ?? '', row.password_hash)) throw badRequest('Current password is incorrect');
      await db().run(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [hashPassword(input.newPassword), nowIso(), user.id]);
    }
    await db().run(
      `UPDATE users SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), phone = COALESCE(?, phone), marketing_consent = COALESCE(?, marketing_consent), updated_at = ? WHERE id = ?`,
      [input.firstName, input.lastName, input.phone === undefined ? null : input.phone, input.marketingConsent == null ? null : input.marketingConsent ? 1 : 0, nowIso(), user.id]
    );
    res.json({ user: await publicUser(user.id) });
  })
);

accountRouter.post(
  '/auth/password/forgot',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(z.object({ email: z.string().email() }), req.body);
    const row = await db().get(`SELECT id FROM users WHERE email = ?`, [input.email.toLowerCase()]);
    // Always respond the same way — no account enumeration.
    if (row) {
      const token = await createPasswordResetToken(row.id);
      const link = `${config.publicUrl}/account/reset?token=${token}`;
      const settings = await getSettings();
      await sendEmail({ to: input.email.toLowerCase(), subject: `Reset your ${settings.store_name} password`, template: 'password_reset', text: emailTemplates.passwordReset(settings.store_name, link) });
    }
    res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
  })
);

accountRouter.post(
  '/auth/password/reset',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(z.object({ token: z.string().min(10), password: z.string().min(8).max(128) }), req.body);
    const userId = await consumePasswordResetToken(input.token);
    await db().run(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [hashPassword(input.password), nowIso(), userId]);
    await db().run(`UPDATE sessions SET revoked_at = ? WHERE user_id = ?`, [nowIso(), userId]);
    res.json({ ok: true });
  })
);

/* ------------------------------- addresses -------------------------------- */

accountRouter.get(
  '/addresses',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    const rows = await db().query(`SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default_shipping DESC, created_at`, [user.id]);
    res.json({ addresses: rows.map((r) => ({ ...r, is_default_shipping: b(r.is_default_shipping) })) });
  })
);

accountRouter.post(
  '/addresses',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    const input = validate(addressSchema, req.body);
    const id = uuid();
    await db().tx(async (tx) => {
      if (input.is_default_shipping) await tx.run(`UPDATE addresses SET is_default_shipping = 0 WHERE user_id = ?`, [user.id]);
      await tx.run(
        `INSERT INTO addresses (id, user_id, label, full_name, phone, line1, line2, city, state, postal_code, country, is_default_shipping, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, user.id, input.label, input.full_name, input.phone, input.line1, input.line2 ?? null, input.city, input.state, input.postal_code, input.country, input.is_default_shipping ? 1 : 0, nowIso()]
      );
    });
    res.status(201).json({ ok: true });
  })
);

accountRouter.patch(
  '/addresses/:id',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    const existing = await db().get(`SELECT * FROM addresses WHERE id = ? AND user_id = ?`, [req.params.id, user.id]);
    if (!existing) throw notFound('Address not found');
    const input = validate(addressSchema, req.body);
    await db().tx(async (tx) => {
      if (input.is_default_shipping) await tx.run(`UPDATE addresses SET is_default_shipping = 0 WHERE user_id = ?`, [user.id]);
      await tx.run(
        `UPDATE addresses SET label=?, full_name=?, phone=?, line1=?, line2=?, city=?, state=?, postal_code=?, country=?, is_default_shipping=? WHERE id = ? AND user_id = ?`,
        [input.label, input.full_name, input.phone, input.line1, input.line2 ?? null, input.city, input.state, input.postal_code, input.country, input.is_default_shipping ? 1 : 0, existing.id, user.id]
      );
    });
    res.json({ ok: true });
  })
);

accountRouter.delete(
  '/addresses/:id',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    const res2 = await db().run(`DELETE FROM addresses WHERE id = ? AND user_id = ?`, [req.params.id, user.id]);
    if (!res2.changes) throw notFound('Address not found');
    res.json({ ok: true });
  })
);

/* ------------------------------- orders (own) ----------------------------- */

accountRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    const rows = await db().query(`SELECT * FROM orders WHERE user_id = ? ORDER BY placed_at DESC LIMIT 100`, [user.id]);
    const orders = [];
    for (const row of rows) {
      const order = await loadOrder(row.id);
      if (order) orders.push(order);
    }
    res.json({ orders });
  })
);

accountRouter.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    const row = await db().get(`SELECT * FROM orders WHERE id = ?`, [req.params.id]);
    if (!row || row.user_id !== user.id) throw notFound('Order not found');
    res.json({ order: await loadOrder(row.id) });
  })
);

accountRouter.post(
  '/orders/:id/cancel',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    const row = await db().get(`SELECT * FROM orders WHERE id = ?`, [req.params.id]);
    if (!row || row.user_id !== user.id) throw notFound('Order not found');
    const input = validate(z.object({ reason: z.string().max(300).nullable().optional() }), req.body ?? {});
    const order = await cancelOrder(row.id, { type: 'customer', id: user.id }, input.reason ?? null);
    res.json({ order });
  })
);

/* ------------------------------- wishlist --------------------------------- */

accountRouter.get(
  '/wishlist',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    const rows = await db().query(
      `SELECT p.id, p.slug, p.title, p.base_price_paise, p.compare_at_price_paise, w.created_at,
              (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) AS image_url,
              COALESCE((SELECT SUM(stock_qty) FROM product_variants WHERE product_id = p.id AND is_active = 1), 0) AS total_stock
       FROM wishlist_items w JOIN products p ON p.id = w.product_id
       WHERE w.user_id = ? ORDER BY w.created_at DESC`,
      [user.id]
    );
    res.json({ items: rows.map((r) => ({ ...r, base_price_paise: Number(r.base_price_paise), compare_at_price_paise: r.compare_at_price_paise == null ? null : Number(r.compare_at_price_paise), total_stock: Number(r.total_stock) })) });
  })
);

accountRouter.post(
  '/wishlist/:productId',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    const product = await db().get(`SELECT id FROM products WHERE id = ? AND status = 'active'`, [req.params.productId]);
    if (!product) throw notFound('Product not found');
    await db().run(
      `INSERT INTO wishlist_items (user_id, product_id, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id, product_id) DO NOTHING`,
      [user.id, product.id, nowIso()]
    );
    res.json({ ok: true });
  })
);

accountRouter.delete(
  '/wishlist/:productId',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    await db().run(`DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?`, [user.id, req.params.productId]);
    res.json({ ok: true });
  })
);

/* ------------------------------- returns (customer) ----------------------- */

accountRouter.post(
  '/orders/:id/return',
  asyncHandler(async (req, res) => {
    const user = requireAuth(req);
    const row = await db().get(`SELECT * FROM orders WHERE id = ? AND user_id = ?`, [req.params.id, user.id]);
    if (!row) throw notFound('Order not found');
    if (row.status !== 'delivered') throw badRequest('Returns can be started once the order is delivered.');
    const input = validate(
      z.object({ orderItemId: z.string().optional(), reason: z.string().min(3).max(200), description: z.string().max(2000).optional() }),
      req.body
    );
    const id = uuid();
    await db().run(
      `INSERT INTO returns (id, order_id, order_item_id, user_id, reason, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?)`,
      [id, row.id, input.orderItemId ?? null, user.id, input.reason, input.description ?? null, nowIso(), nowIso()]
    );
    await audit({ actor: { id: user.id, type: 'customer' }, action: 'return.requested', entityType: 'return', entityId: id, req });
    res.status(201).json({ ok: true, message: 'Return requested — our team will approve it within 1 business day.' });
  })
);
