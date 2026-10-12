import { db } from '../db/index.js';
import { nowIso, uuid } from './util.js';
import { badRequest, conflict, notFound } from './errors.js';
import { audit } from './audit.js';
import type { Order, OrderItem, OrderStatus, Shipment } from '../../shared/types.js';
import { b, json } from './util.js';
import { sendEmail, emailTemplates } from './email.js';
import { getSettings } from './settings.js';

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed: ['payment_pending', 'payment_confirmed', 'cancelled'],
  payment_pending: ['payment_confirmed', 'cancelled'],
  payment_confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export async function appendStatusEvent(
  orderId: string,
  status: string,
  actor: { type: 'system' | 'admin' | 'customer' | 'supplier'; id?: string | null },
  note: string | null = null
): Promise<void> {
  await db().run(`INSERT INTO order_status_events (id, order_id, status, note, actor_type, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    uuid(),
    orderId,
    status,
    note,
    actor.type,
    actor.id ?? null,
    nowIso(),
  ]);
}

export async function setOrderStatus(
  orderId: string,
  status: OrderStatus,
  actor: { type: 'system' | 'admin' | 'customer' | 'supplier'; id?: string | null },
  note: string | null = null,
  opts?: { skipValidation?: boolean }
): Promise<void> {
  const order = await db().get(`SELECT status FROM orders WHERE id = ?`, [orderId]);
  if (!order) throw notFound('Order not found');
  if (!opts?.skipValidation && !canTransition(order.status, status)) {
    throw conflict(`Cannot move order from "${order.status}" to "${status}"`);
  }
  await db().run(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`, [status, nowIso(), orderId]);
  await appendStatusEvent(orderId, status, actor, note);
}

export async function allocateStockForOrder(orderId: string): Promise<void> {
  const items = await db().query(`SELECT variant_id, qty FROM order_items WHERE order_id = ?`, [orderId]);
  for (const item of items) {
    if (!item.variant_id) continue;
    const res = await db().run(
      `UPDATE product_variants SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ? AND stock_qty >= ?`,
      [item.qty, nowIso(), item.variant_id, item.qty]
    );
    if (res.changes === 0) {
      throw conflict('Stock changed while we were processing your order. Please review your cart.');
    }
  }
}

export async function releaseStockForOrder(orderId: string): Promise<void> {
  const items = await db().query(`SELECT variant_id, qty FROM order_items WHERE order_id = ?`, [orderId]);
  for (const item of items) {
    if (!item.variant_id) continue;
    await db().run(`UPDATE product_variants SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?`, [
      item.qty,
      nowIso(),
      item.variant_id,
    ]);
  }
}

export async function incrementCouponUsage(code: string | null): Promise<void> {
  if (!code) return;
  await db().run(`UPDATE coupons SET used_count = used_count + 1, updated_at = ? WHERE code = ?`, [nowIso(), code]);
}

export function mapOrder(row: any, items: OrderItem[], events: any[], shipments: Shipment[]): Order {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    payment_status: row.payment_status,
    fulfillment_status: row.fulfillment_status,
    payment_provider: row.payment_provider,
    payment_method: row.payment_method,
    currency: row.currency,
    subtotal_paise: Number(row.subtotal_paise),
    discount_paise: Number(row.discount_paise),
    shipping_paise: Number(row.shipping_paise),
    tax_paise: Number(row.tax_paise),
    total_paise: Number(row.total_paise),
    coupon_code: row.coupon_code,
    email: row.email,
    phone: row.phone,
    shipping_method_name: row.shipping_method_name,
    shipping_address: json(row.shipping_address_json, {} as Order['shipping_address']),
    items,
    status_events: events.map((e) => ({
      id: e.id,
      status: e.status,
      note: e.note,
      actor_type: e.actor_type,
      created_at: e.created_at,
    })),
    shipments,
    placed_at: row.placed_at,
    updated_at: row.updated_at,
    cancel_reason: row.cancel_reason,
    estimated_delivery:
      row.estimated_min_days != null ? { min_days: row.estimated_min_days, max_days: row.estimated_max_days } : null,
    cod_enabled_for_order: b(row.cod),
    is_sample: b(row.is_sample),
  };
}

export async function loadOrder(orderId: string): Promise<Order | null> {
  const row = await db().get(`SELECT * FROM orders WHERE id = ?`, [orderId]);
  if (!row) return null;
  const items = (await db().query(`SELECT * FROM order_items WHERE order_id = ? ORDER BY id`, [orderId])).map((i) => ({
    id: i.id,
    product_id: i.product_id,
    product_slug: i.product_slug,
    title: i.title,
    variant_title: i.variant_title,
    sku: i.sku,
    image_url: i.image_url,
    unit_price_paise: Number(i.unit_price_paise),
    qty: i.qty,
    total_paise: Number(i.total_paise),
  }));
  const events = await db().query(`SELECT * FROM order_status_events WHERE order_id = ? ORDER BY created_at`, [orderId]);
  const shipmentRows = await db().query(`SELECT * FROM shipments WHERE order_id = ? ORDER BY created_at`, [orderId]);
  const shipments: Shipment[] = [];
  for (const s of shipmentRows) {
    const eventsForShipment = await db().query(`SELECT * FROM tracking_events WHERE shipment_id = ? ORDER BY occurred_at`, [s.id]);
    shipments.push({
      id: s.id,
      carrier: s.carrier,
      tracking_number: s.tracking_number,
      status: s.status,
      shipped_at: s.shipped_at,
      delivered_at: s.delivered_at,
      events: eventsForShipment.map((e) => ({
        id: e.id,
        status: e.status,
        description: e.description,
        location: e.location,
        occurred_at: e.occurred_at,
        source: e.source,
      })),
    });
  }
  return mapOrder(row, items, events, shipments);
}

export async function loadOrderByNumber(number: string): Promise<Order | null> {
  const row = await db().get(`SELECT id FROM orders WHERE number = ?`, [number.trim().toUpperCase()]);
  if (!row) return null;
  return loadOrder(row.id);
}

/* --------------------------- customer notifications ----------------------- */

export async function notifyOrderConfirmation(order: Order): Promise<void> {
  const settings = await getSettings();
  const eta = order.estimated_delivery
    ? `${order.estimated_delivery.min_days}–${order.estimated_delivery.max_days} business days`
    : null;
  await sendEmail({
    to: order.email,
    subject: `Order ${order.number} confirmed — ${settings.store_name}`,
    template: 'order_confirmation',
    text: emailTemplates.orderConfirmation(settings.store_name, order.number, `₹${(order.total_paise / 100).toLocaleString('en-IN')}`, eta),
  });
}

export async function notifyShipped(order: Order, shipment: Shipment): Promise<void> {
  const settings = await getSettings();
  await sendEmail({
    to: order.email,
    subject: `Order ${order.number} has shipped`,
    template: 'order_shipped',
    text: emailTemplates.shipped(settings.store_name, order.number, shipment.carrier, shipment.tracking_number),
  });
}

export async function nextOrderNumber(): Promise<string> {
  const row = await db().get(`SELECT COUNT(*) AS n FROM orders`);
  const year = new Date().getFullYear();
  const seq = Number(row?.n ?? 0) + 1;
  return `OJ-${year}-${String(seq).padStart(6, '0')}`;
}

export async function cancelOrder(orderId: string, actor: { type: 'admin' | 'customer' | 'system'; id?: string | null }, reason: string | null): Promise<Order> {
  const order = await loadOrder(orderId);
  if (!order) throw notFound('Order not found');
  if (['shipped', 'out_for_delivery', 'delivered'].includes(order.status)) {
    throw badRequest('This order has already shipped — please start a return instead.');
  }
  await db().tx(async (tx) => {
    await tx.run(`UPDATE orders SET status = 'cancelled', cancel_reason = ?, fulfillment_status = 'cancelled', updated_at = ? WHERE id = ?`, [
      reason,
      nowIso(),
      orderId,
    ]);
  });
  await releaseStockForOrder(orderId);
  await appendStatusEvent(orderId, 'cancelled', actor, reason);
  const settings = await getSettings();
  await sendEmail({
    to: order.email,
    subject: `Order ${order.number} cancelled`,
    template: 'order_cancelled',
    text: emailTemplates.cancelled(settings.store_name, order.number, reason),
  });
  await audit({ actor: { id: actor.id ?? null, type: actor.type }, action: 'order.cancel', entityType: 'order', entityId: orderId, req: undefined });
  return (await loadOrder(orderId))!;
}
