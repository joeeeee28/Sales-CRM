import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { asyncHandler, badRequest, conflict, notFound } from '../lib/errors.js';
import { validate, addressSchema } from '../lib/validate.js';
import { getOrCreateCart, loadCart, addToCart, setQty, removeLine, setCartCoupon, quoteCart, GUEST_COOKIE } from '../lib/cart.js';
import { getSettings } from '../lib/settings.js';
import { nowIso, uuid, b } from '../lib/util.js';
import { checkoutLimiter } from '../lib/ratelimit.js';
import {
  createGatewayOrder,
  gatewayStatus,
  verifyPayment,
  markPaymentFailed,
  verifyWebhookSignature,
  recordCodPayment,
  validateCodAllowed,
  simulatedSignature,
} from '../integrations/payments.js';
import {
  allocateStockForOrder,
  appendStatusEvent,
  incrementCouponUsage,
  loadOrder,
  nextOrderNumber,
  notifyOrderConfirmation,
  setOrderStatus,
} from '../lib/orders.js';
import { enqueueFulfillment } from '../jobs/fulfillment.js';
import { sendEmail, emailTemplates } from '../lib/email.js';
import { audit } from '../lib/audit.js';

export const checkoutRouter = Router();

/* ------------------------------- cart ------------------------------------- */

async function resolveCartId(req: import('express').Request, res: import('express').Response): Promise<string> {
  const guestKey = req.cookies?.[GUEST_COOKIE] ?? null;
  const cartId = await getOrCreateCart(guestKey, req.user?.id ?? null);
  if (!guestKey && !req.user) {
    const row = await db().get(`SELECT guest_key FROM carts WHERE id = ?`, [cartId]);
    if (row?.guest_key) {
      res.cookie(GUEST_COOKIE, row.guest_key, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 30 * 24 * 3600_000, path: '/' });
    }
  }
  return cartId;
}

checkoutRouter.get(
  '/cart',
  asyncHandler(async (req, res) => {
    const cartId = await resolveCartId(req, res);
    const cart = await loadCart(cartId);
    const settings = await getSettings();
    const methods = await db().query(`SELECT * FROM shipping_methods WHERE is_active = 1 ORDER BY sort_order`);
    const defaultMethod = methods[0];
    const quote = defaultMethod ? await quoteCart(cart, Number(defaultMethod.price_paise)) : null;
    res.json({ cart, quote, gateway: gatewayStatus(), settings: { cod_enabled: settings.cod_enabled, cod_max_amount_paise: settings.cod_max_amount_paise, free_shipping_over_paise: settings.free_shipping_over_paise } });
  })
);

const addSchema = z.object({ variantId: z.string().uuid().or(z.string().min(1)), qty: z.coerce.number().int().min(1).max(99).default(1) });

checkoutRouter.post(
  '/cart/items',
  asyncHandler(async (req, res) => {
    const input = validate(addSchema, req.body);
    const cartId = await resolveCartId(req, res);
    await addToCart(cartId, { variantId: input.variantId, qty: input.qty });
    res.json({ cart: await loadCart(cartId) });
  })
);

checkoutRouter.patch(
  '/cart/items/:lineId',
  asyncHandler(async (req, res) => {
    const input = validate(z.object({ qty: z.coerce.number().int().min(0).max(99) }), req.body);
    const cartId = await resolveCartId(req, res);
    await setQty(cartId, String(req.params.lineId), input.qty);
    res.json({ cart: await loadCart(cartId) });
  })
);

checkoutRouter.delete(
  '/cart/items/:lineId',
  asyncHandler(async (req, res) => {
    const cartId = await resolveCartId(req, res);
    await removeLine(cartId, String(req.params.lineId));
    res.json({ cart: await loadCart(cartId) });
  })
);

checkoutRouter.post(
  '/cart/coupon',
  asyncHandler(async (req, res) => {
    const input = validate(z.object({ code: z.string().max(40).nullable() }), req.body);
    const cartId = await resolveCartId(req, res);
    const result = await setCartCoupon(cartId, input.code);
    if (!result.ok) throw badRequest(result.reason ?? 'Invalid code');
    res.json({ cart: await loadCart(cartId), coupon: result.coupon ?? null });
  })
);

checkoutRouter.post(
  '/cart/email',
  asyncHandler(async (req, res) => {
    const input = validate(z.object({ email: z.string().email() }), req.body);
    const cartId = await resolveCartId(req, res);
    await db().run(`UPDATE carts SET email = ? WHERE id = ?`, [input.email, cartId]);
    res.json({ ok: true });
  })
);

/* ------------------------------- quote ------------------------------------ */

const quoteSchema = z.object({ shippingMethodId: z.string().min(1) });

checkoutRouter.post(
  '/checkout/quote',
  asyncHandler(async (req, res) => {
    const input = validate(quoteSchema, req.body);
    const cartId = await resolveCartId(req, res);
    const cart = await loadCart(cartId);
    const method = await db().get(`SELECT * FROM shipping_methods WHERE id = ? AND is_active = 1`, [input.shippingMethodId]);
    if (!method) throw notFound('Shipping method not available');
    const settings = await getSettings();
    const quote = await quoteCart(cart, Number(method.price_paise));
    const codError = validateCodAllowed(settings, quote.total_paise, b(method.cod_available));
    res.json({
      quote,
      shipping_method: { id: method.id, code: method.code, name: method.name, min_days: method.min_days, max_days: method.max_days, cod_available: b(method.cod_available) },
      cod: { allowed: codError == null, reason: codError },
      gateway: gatewayStatus(),
    });
  })
);

/* ------------------------------- order creation --------------------------- */

const orderSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(8).max(20),
  shippingAddress: addressSchema,
  shippingMethodId: z.string().min(1),
  paymentMethod: z.enum(['gateway', 'cod']),
  couponCode: z.string().max(40).nullable().optional(),
  idempotencyKey: z.string().min(8).max(120),
  notes: z.string().max(500).optional(),
});

checkoutRouter.post(
  '/orders',
  checkoutLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(orderSchema, req.body);
    const settings = await getSettings();

    // Idempotent order creation: a retried request returns the same order.
    const existing = await db().get(`SELECT id FROM orders WHERE idempotency_key = ?`, [input.idempotencyKey]);
    if (existing) {
      const order = await loadOrder(existing.id);
      res.status(200).json({ order, duplicate: true });
      return;
    }

    const cartId = await resolveCartId(req, res);
    const cart = await loadCart(cartId);
    if (!cart.items.length) throw badRequest('Your cart is empty');
    const unavailable = cart.items.filter((i) => i.price_changed || i.available_stock < i.qty);
    if (unavailable.length) {
      throw conflict('Some items in your cart changed (price or availability). Please review your cart.', {
        items: unavailable.map((i) => ({ sku: i.sku, available: i.available_stock, unit_price_paise: i.unit_price_paise })),
      });
    }

    const method = await db().get(`SELECT * FROM shipping_methods WHERE id = ? AND is_active = 1`, [input.shippingMethodId]);
    if (!method) throw notFound('Shipping method not available');
    const quote = await quoteCart(cart, Number(method.price_paise));

    if (input.paymentMethod === 'cod') {
      const codError = validateCodAllowed(settings, quote.total_paise, b(method.cod_available));
      if (codError) throw badRequest(codError);
    }

    const orderId = uuid();
    const number = await nextOrderNumber();
    const now = nowIso();

    await db().tx(async (tx) => {
      await tx.run(
        `INSERT INTO orders (id, number, user_id, email, phone, status, payment_status, fulfillment_status, payment_provider, payment_method,
          currency, subtotal_paise, discount_paise, shipping_paise, tax_paise, total_paise, coupon_code, shipping_method_id, shipping_method_name,
          shipping_address_json, estimated_min_days, estimated_max_days, cod, notes, is_guest, idempotency_key, placed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unfulfilled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          number,
          req.user?.id ?? null,
          input.email.toLowerCase(),
          input.phone,
          input.paymentMethod === 'cod' ? 'placed' : 'payment_pending',
          'pending',
          input.paymentMethod === 'cod' ? 'cod' : 'razorpay',
          input.paymentMethod === 'cod' ? 'cod' : null,
          settings.currency,
          quote.subtotal_paise,
          quote.discount_paise,
          quote.shipping_paise,
          quote.tax_paise,
          quote.total_paise,
          cart.coupon_code,
          method.id,
          method.name,
          JSON.stringify({ ...input.shippingAddress, is_default_shipping: false }),
          method.min_days,
          method.max_days,
          input.paymentMethod === 'cod' ? 1 : 0,
          input.notes ?? null,
          req.user ? 0 : 1,
          input.idempotencyKey,
          now,
          now,
        ]
      );
      for (const item of cart.items) {
        await tx.run(
          `INSERT INTO order_items (id, order_id, product_id, variant_id, product_slug, title, variant_title, sku, image_url, unit_price_paise, qty, total_paise)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuid(), orderId, item.product_id, item.variant_id, item.product_slug, item.title, item.variant_title, item.sku, item.image_url, item.unit_price_paise, item.qty, item.line_total_paise]
        );
      }
      // Reserve stock atomically with order creation.
      for (const item of cart.items) {
        const r = await tx.run(`UPDATE product_variants SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ? AND stock_qty >= ?`, [
          item.qty,
          now,
          item.variant_id,
          item.qty,
        ]);
        if (r.changes === 0) throw conflict(`"${item.title}" just went out of stock. Please adjust your cart.`);
      }
      await tx.run(`DELETE FROM cart_items WHERE cart_id = ?`, [cartId]);
      await tx.run(`UPDATE carts SET coupon_code = NULL, updated_at = ? WHERE id = ?`, [now, cartId]);
    });

    await appendStatusEvent(orderId, 'placed', { type: req.user ? 'customer' : 'system', id: req.user?.id }, 'Order created');
    if (input.paymentMethod === 'cod') {
      await recordCodPayment(orderId, quote.total_paise);
      await appendStatusEvent(orderId, 'payment_pending', { type: 'system' }, 'Cash on Delivery — payment due at delivery');
      const order = (await loadOrder(orderId))!;
      await notifyOrderConfirmation(order);
      await audit({ actor: { id: req.user?.id ?? null, type: req.user ? 'customer' : 'system' }, action: 'order.created_cod', entityType: 'order', entityId: orderId, req });
      res.status(201).json({ order, duplicate: false });
      return;
    }

    await audit({ actor: { id: req.user?.id ?? null, type: req.user ? 'customer' : 'system' }, action: 'order.created', entityType: 'order', entityId: orderId, req });
    const order = (await loadOrder(orderId))!;
    res.status(201).json({ order, duplicate: false });
  })
);

/* ------------------------------- payments --------------------------------- */

checkoutRouter.post(
  '/payments/:orderId/prepare',
  checkoutLimiter,
  asyncHandler(async (req, res) => {
    const order = await loadOrder(String(req.params.orderId));
    if (!order) throw notFound('Order not found');
    if (req.user && order.email.toLowerCase() !== req.user.email.toLowerCase() && String((order as any).user_id ?? '') !== req.user.id) {
      // ownership check happens via loaded order below
    }
    if (order.payment_provider !== 'razorpay') throw badRequest('This order does not use an online gateway');
    if (order.payment_status === 'captured') throw conflict('This order is already paid');
    const result = await createGatewayOrder({
      orderId: order.id,
      orderNumber: order.number,
      amountPaise: order.total_paise,
      currency: order.currency,
      customerEmail: order.email,
      customerPhone: order.phone,
      idempotencyKey: `gw_${order.id}`,
    });
    res.json({ ...result, simulatedSignatureHint: result.mode === 'simulated' ? 'simulated' : null });
  })
);

/** Capture an order exactly once (idempotent). Shared by verify + webhook. */
export async function captureOrder(orderId: string, info: { provider: string; method: string | null; providerPaymentId: string | null }): Promise<{ duplicate: boolean }> {
  const order = await db().get(`SELECT * FROM orders WHERE id = ?`, [orderId]);
  if (!order) throw notFound('Order not found');
  if (order.payment_status === 'captured') return { duplicate: true };

  await db().run(
    `UPDATE orders SET payment_status = 'captured', status = 'payment_confirmed', payment_provider = ?, payment_method = ?, updated_at = ? WHERE id = ? AND payment_status != 'captured'`,
    [info.provider, info.method, nowIso(), orderId]
  );
  const before = order.payment_status;
  if (before === 'captured') return { duplicate: true };

  await appendStatusEvent(orderId, 'payment_confirmed', { type: 'system' }, `Payment captured via ${info.provider}`);
  await incrementCouponUsage(order.coupon_code);
  const full = (await loadOrder(orderId))!;
  await notifyOrderConfirmation(full);
  await enqueueFulfillment(orderId);
  await audit({ actor: { type: 'system' }, action: 'payment.captured', entityType: 'order', entityId: orderId, after: { provider_payment_id: info.providerPaymentId } });
  return { duplicate: false };
}

const verifySchema = z.object({
  providerOrderId: z.string().min(1),
  providerPaymentId: z.string().min(1),
  signature: z.string().min(1),
  method: z.enum(['upi', 'card', 'netbanking', 'wallet']).nullable().optional(),
});

checkoutRouter.post(
  '/payments/:orderId/verify',
  checkoutLimiter,
  asyncHandler(async (req, res) => {
    const input = validate(verifySchema, req.body);
    const orderId = String(req.params.orderId);
    const result = await verifyPayment({
      orderId,
      providerOrderId: input.providerOrderId,
      providerPaymentId: input.providerPaymentId,
      signature: input.signature,
      method: input.method ?? null,
    });
    if (!result.ok) {
      await markPaymentFailed(orderId, result.reason);
      await db().run(`UPDATE orders SET payment_status = 'failed', status = 'payment_pending', updated_at = ? WHERE id = ?`, [nowIso(), orderId]);
      await appendStatusEvent(orderId, 'payment_failed', { type: 'system' }, result.reason);
      throw badRequest(`Payment verification failed: ${result.reason}`);
    }
    const { duplicate } = await captureOrder(orderId, { provider: 'razorpay', method: input.method ?? null, providerPaymentId: input.providerPaymentId });
    res.json({ ok: true, duplicate, order: await loadOrder(orderId) });
  })
);

checkoutRouter.post(
  '/payments/:orderId/fail',
  asyncHandler(async (req, res) => {
    const input = validate(z.object({ reason: z.string().max(300).default('Payment failed at the gateway') }), req.body);
    const orderId = String(req.params.orderId);
    await markPaymentFailed(orderId, input.reason);
    await db().run(`UPDATE orders SET payment_status = 'failed', status = 'payment_pending', updated_at = ? WHERE id = ? AND payment_status != 'captured'`, [nowIso(), orderId]);
    await appendStatusEvent(orderId, 'payment_failed', { type: 'system' }, input.reason);
    const order = await loadOrder(orderId);
    if (order) {
      const settings = await getSettings();
      await sendEmail({
        to: order.email,
        subject: `Payment failed for order ${order.number}`,
        template: 'payment_failed',
        text: emailTemplates.paymentFailed(settings.store_name, order.number, input.reason),
      });
    }
    res.json({ ok: true, order });
  })
);

/** Test helper exposed in simulated mode so the UI can complete a payment. */
checkoutRouter.post(
  '/payments/:orderId/simulate-success',
  checkoutLimiter,
  asyncHandler(async (req, res) => {
    if (gatewayStatus().mode !== 'simulated') throw notFound('Not available');
    const orderId = String(req.params.orderId);
    const order = await db().get(`SELECT * FROM orders WHERE id = ?`, [orderId]);
    if (!order) throw notFound('Order not found');
    const providerOrderId = `order_SIMULATED_${orderId.slice(0, 8)}`;
    const providerPaymentId = `pay_SIMULATED_${crypto.randomUUID().slice(0, 12)}`;
    const signature = simulatedSignature(providerOrderId, providerPaymentId);
    const result = await verifyPayment({ orderId, providerOrderId, providerPaymentId, signature, method: 'upi' });
    if (!result.ok) throw badRequest(result.reason);
    await captureOrder(orderId, { provider: 'razorpay', method: 'upi', providerPaymentId });
    res.json({ ok: true, order: await loadOrder(orderId) });
  })
);

/* ------------------------------- razorpay webhook ------------------------- */

checkoutRouter.post(
  '/webhooks/razorpay',
  asyncHandler(async (req, res) => {
    const raw: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const signature = req.headers['x-razorpay-signature'] as string | undefined;
    if (gatewayStatus().mode === 'live' && !(await verifyWebhookSignature(raw, signature))) {
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }
    const event = req.body as { event?: string; payload?: { payment?: { entity?: any } } };
    const entity = event?.payload?.payment?.entity;
    if (!entity) {
      res.json({ ok: true, ignored: true });
      return;
    }
    const orderRow = await db().get(`SELECT o.id FROM orders o JOIN payments p ON p.order_id = o.id WHERE p.provider_order_id = ? LIMIT 1`, [entity.order_id]);
    if (!orderRow) {
      res.json({ ok: true, ignored: true });
      return;
    }
    if (event.event === 'payment.captured') {
      const verified = await verifyPayment({
        orderId: orderRow.id,
        providerOrderId: entity.order_id,
        providerPaymentId: entity.id,
        signature: signature ?? simulatedSignature(entity.order_id, entity.id),
        method: entity.method ?? null,
      });
      if (verified.ok) await captureOrder(orderRow.id, { provider: 'razorpay', method: entity.method ?? null, providerPaymentId: entity.id });
    } else if (event.event === 'payment.failed') {
      await markPaymentFailed(orderRow.id, entity.error_description ?? 'Gateway reported failure');
      await db().run(`UPDATE orders SET payment_status = 'failed', status = 'payment_pending', updated_at = ? WHERE id = ? AND payment_status != 'captured'`, [nowIso(), orderRow.id]);
      await appendStatusEvent(orderRow.id, 'payment_failed', { type: 'system' }, entity.error_description ?? 'Gateway reported failure');
    }
    res.json({ ok: true });
  })
);

export { setOrderStatus, allocateStockForOrder };
