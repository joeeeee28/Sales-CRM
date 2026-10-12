import { db } from '../db/index.js';
import { nowIso, uuid, b, json } from './util.js';
import { badRequest, conflict, notFound } from './errors.js';
import { getSettings } from './settings.js';
import type { Cart, CartItem, AppliedCoupon, Quote } from '../../shared/types.js';

export const GUEST_COOKIE = 'ojas_cart';

export async function getOrCreateCart(guestKey: string | null, userId: string | null): Promise<string> {
  if (userId) {
    const row = await db().get(`SELECT id FROM carts WHERE user_id = ?`, [userId]);
    if (row) return row.id;
    const id = uuid();
    await db().run(`INSERT INTO carts (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)`, [id, userId, nowIso(), nowIso()]);
    return id;
  }
  if (guestKey) {
    const row = await db().get(`SELECT id FROM carts WHERE guest_key = ?`, [guestKey]);
    if (row) return row.id;
  }
  const id = uuid();
  const key = uuid();
  await db().run(`INSERT INTO carts (id, guest_key, created_at, updated_at) VALUES (?, ?, ?, ?)`, [id, key, nowIso(), nowIso()]);
  return id;
}

/** Merge a guest cart into the user's cart on login. */
export async function mergeGuestCart(guestCartId: string | null, userId: string): Promise<void> {
  if (!guestCartId) return;
  const userCartId = await getOrCreateCart(null, userId);
  if (guestCartId === userCartId) return;
  const guestItems = await db().query(`SELECT * FROM cart_items WHERE cart_id = ?`, [guestCartId]);
  for (const item of guestItems) {
    const existing = await db().get(`SELECT * FROM cart_items WHERE cart_id = ? AND variant_id = ?`, [userCartId, item.variant_id]);
    if (existing) {
      await db().run(`UPDATE cart_items SET qty = qty + ? WHERE id = ?`, [item.qty, existing.id]);
    } else {
      await db().run(`INSERT INTO cart_items (id, cart_id, variant_id, qty, unit_price_snapshot_paise, added_at) VALUES (?, ?, ?, ?, ?, ?)`, [
        item.id, userCartId, item.variant_id, item.qty, item.unit_price_snapshot_paise, item.added_at,
      ]);
    }
  }
  await db().run(`DELETE FROM cart_items WHERE cart_id = ?`, [guestCartId]);
  await db().run(`DELETE FROM carts WHERE id = ?`, [guestCartId]);
}

export interface CartLineInput {
  variantId: string;
  qty: number;
}

export async function addToCart(cartId: string, input: CartLineInput): Promise<void> {
  const variant = await db().get(
    `SELECT v.*, p.status AS product_status FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
    [input.variantId]
  );
  if (!variant || variant.product_status !== 'active' || !b(variant.is_active)) throw notFound('This product is not available');
  const qty = Math.floor(input.qty);
  if (qty < 1 || qty > 99) throw badRequest('Quantity must be between 1 and 99');
  if (variant.stock_qty < 1) throw conflict('This item is out of stock');
  const existing = await db().get(`SELECT * FROM cart_items WHERE cart_id = ? AND variant_id = ?`, [cartId, input.variantId]);
  const newQty = (existing?.qty ?? 0) + qty;
  if (newQty > variant.stock_qty) {
    throw conflict(`Only ${variant.stock_qty} unit(s) of ${variant.sku} are available right now`, { available: variant.stock_qty });
  }
  if (existing) {
    await db().run(`UPDATE cart_items SET qty = ?, unit_price_snapshot_paise = ? WHERE id = ?`, [
      newQty,
      variant.price_paise ?? (await basePrice(variant.product_id)),
      existing.id,
    ]);
  } else {
    await db().run(
      `INSERT INTO cart_items (id, cart_id, variant_id, qty, unit_price_snapshot_paise, added_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid(), cartId, input.variantId, qty, variant.price_paise ?? (await basePrice(variant.product_id)), nowIso()]
    );
  }
  await db().run(`UPDATE carts SET updated_at = ? WHERE id = ?`, [nowIso(), cartId]);
}

async function basePrice(productId: string): Promise<number> {
  const row = await db().get(`SELECT base_price_paise FROM products WHERE id = ?`, [productId]);
  return Number(row?.base_price_paise ?? 0);
}

export async function setQty(cartId: string, lineId: string, qty: number): Promise<void> {
  const line = await db().get(`SELECT * FROM cart_items WHERE id = ? AND cart_id = ?`, [lineId, cartId]);
  if (!line) throw notFound('Cart line not found');
  if (qty <= 0) {
    await db().run(`DELETE FROM cart_items WHERE id = ?`, [lineId]);
  } else {
    const variant = await db().get(`SELECT stock_qty FROM product_variants WHERE id = ?`, [line.variant_id]);
    if (variant && qty > variant.stock_qty) {
      throw conflict(`Only ${variant.stock_qty} unit(s) available`, { available: variant.stock_qty });
    }
    await db().run(`UPDATE cart_items SET qty = ? WHERE id = ?`, [qty, lineId]);
  }
  await db().run(`UPDATE carts SET updated_at = ? WHERE id = ?`, [nowIso(), cartId]);
}

export async function removeLine(cartId: string, lineId: string): Promise<void> {
  await db().run(`DELETE FROM cart_items WHERE id = ? AND cart_id = ?`, [lineId, cartId]);
  await db().run(`UPDATE carts SET updated_at = ? WHERE id = ?`, [nowIso(), cartId]);
}

/* --------------------------- coupons --------------------------------------- */

export interface CouponValidation {
  ok: boolean;
  reason?: string;
  coupon?: AppliedCoupon;
}

export async function validateCoupon(code: string, subtotalPaise: number): Promise<CouponValidation> {
  const row = await db().get(`SELECT * FROM coupons WHERE code = ?`, [code.trim().toUpperCase()]);
  if (!row) return { ok: false, reason: 'This code is not recognised' };
  if (!b(row.is_active)) return { ok: false, reason: 'This code is no longer active' };
  const now = nowIso();
  if (row.starts_at && now < row.starts_at) return { ok: false, reason: 'This code is not active yet' };
  if (row.ends_at && now > row.ends_at) return { ok: false, reason: 'This code has expired' };
  if (row.usage_limit != null && row.used_count >= row.usage_limit) return { ok: false, reason: 'This code has reached its usage limit' };
  if (subtotalPaise < row.min_subtotal_paise) {
    return { ok: false, reason: `This code needs a minimum subtotal of ₹${(row.min_subtotal_paise / 100).toFixed(0)}` };
  }
  let discount = 0;
  if (row.type === 'percent') {
    discount = Math.round((subtotalPaise * row.value) / 100);
    if (row.max_discount_paise != null) discount = Math.min(discount, row.max_discount_paise);
  } else if (row.type === 'fixed') {
    discount = Math.min(row.value, subtotalPaise);
  } else {
    discount = 0;
  }
  return {
    ok: true,
    coupon: { code: row.code, description: row.description, type: row.type, value: row.value, discount_paise: discount },
  };
}

/* --------------------------- cart view ------------------------------------- */

export async function loadCart(cartId: string): Promise<Cart> {
  const cartRow = await db().get(`SELECT * FROM carts WHERE id = ?`, [cartId]);
  const rows = await db().query(
    `SELECT ci.id AS line_id, ci.qty, ci.unit_price_snapshot_paise,
            v.id AS variant_id, v.sku, v.title AS variant_title, v.options_json, v.stock_qty, v.price_paise, v.is_active,
            p.id AS product_id, p.slug, p.title, p.base_price_paise, p.compare_at_price_paise, p.status AS product_status,
            img.url AS image_url
     FROM cart_items ci
     JOIN product_variants v ON v.id = ci.variant_id
     JOIN products p ON p.id = v.product_id
     LEFT JOIN product_images img ON img.id = (SELECT id FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1)
     WHERE ci.cart_id = ?
     ORDER BY ci.added_at`,
    [cartId]
  );

  const items: CartItem[] = rows.map((r) => {
    const currentPrice = r.price_paise != null ? Number(r.price_paise) : Number(r.base_price_paise);
    const unavailable = r.product_status !== 'active' || !b(r.is_active) || r.stock_qty < 1;
    return {
      line_id: r.line_id,
      variant_id: r.variant_id,
      product_id: r.product_id,
      product_slug: r.slug,
      title: r.title,
      variant_title: r.variant_title,
      sku: r.sku,
      image_url: r.image_url,
      options: json(r.options_json, {}),
      unit_price_paise: currentPrice,
      compare_at_price_paise: r.compare_at_price_paise == null ? null : Number(r.compare_at_price_paise),
      qty: r.qty,
      available_stock: r.stock_qty,
      line_total_paise: currentPrice * r.qty,
      price_changed: Number(r.unit_price_snapshot_paise) !== currentPrice || unavailable,
    };
  });

  const subtotal = items.reduce((sum, i) => sum + i.line_total_paise, 0);
  let coupon: AppliedCoupon | null = null;
  let discount = 0;
  if (cartRow?.coupon_code) {
    const validation = await validateCoupon(cartRow.coupon_code, subtotal);
    if (validation.ok && validation.coupon) {
      coupon = validation.coupon;
      discount = coupon.type === 'free_shipping' ? 0 : validation.coupon.discount_paise;
    } else {
      await db().run(`UPDATE carts SET coupon_code = NULL WHERE id = ?`, [cartId]);
    }
  }

  return {
    id: cartId,
    items,
    coupon_code: coupon?.code ?? null,
    coupon,
    subtotal_paise: subtotal,
    discount_paise: discount,
    email: cartRow?.email ?? null,
  };
}

export async function setCartCoupon(cartId: string, code: string | null): Promise<CouponValidation> {
  if (!code) {
    await db().run(`UPDATE carts SET coupon_code = NULL, updated_at = ? WHERE id = ?`, [nowIso(), cartId]);
    return { ok: true };
  }
  const cart = await loadCart(cartId);
  const validation = await validateCoupon(code, cart.subtotal_paise);
  if (!validation.ok) return validation;
  await db().run(`UPDATE carts SET coupon_code = ?, updated_at = ? WHERE id = ?`, [code.trim().toUpperCase(), nowIso(), cartId]);
  return validation;
}

/* --------------------------- quote (shipping + tax) ------------------------ */

export async function quoteCart(cart: Cart, shippingMethodPrice: number, opts?: { forceFreeShipping?: boolean }): Promise<Quote> {
  const settings = await getSettings();
  const subtotal = cart.subtotal_paise;
  const discount = cart.discount_paise;
  const afterDiscount = Math.max(0, subtotal - discount);

  let shipping = shippingMethodPrice;
  let free = false;
  const freeOver = cart.coupon?.type === 'free_shipping' ? 0 : settings.free_shipping_over_paise;
  if (opts?.forceFreeShipping || cart.coupon?.type === 'free_shipping' || (freeOver != null && subtotal >= freeOver)) {
    shipping = 0;
    free = true;
  }

  // Tax-inclusive pricing by default (Indian GST): the displayed price already
  // contains tax; we surface the component for transparency instead of adding it.
  let tax = 0;
  if (!settings.tax_inclusive) {
    tax = Math.round((afterDiscount * settings.default_tax_bps) / 10_000);
  }

  return {
    subtotal_paise: subtotal,
    discount_paise: discount,
    shipping_paise: shipping,
    shipping_free: free,
    tax_paise: tax,
    total_paise: afterDiscount + shipping + tax,
    coupon: cart.coupon,
    free_shipping_over: settings.free_shipping_over_paise,
  };
}
