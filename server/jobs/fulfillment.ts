import { db } from '../db/index.js';
import { nowIso, uuid, json, b } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { getSettings } from '../lib/settings.js';
import { getSupplier, buildAdapter } from '../integrations/suppliers/registry.js';
import { appendStatusEvent, loadOrder } from '../lib/orders.js';
import { sendEmail, emailTemplates } from '../lib/email.js';
import type { FulfillmentLine } from '../integrations/suppliers/types.js';

/**
 * Fulfillment pipeline.
 *
 * When an order's payment is captured and `settings.fulfillment_enabled` is
 * true, each supplier-backed line group is sent to its supplier exactly once
 * (idempotency key = `fulfil_<orderId>_<supplierId>`), with exponential-backoff
 * retries and a full audit trail in `supplier_orders` + `sync_runs`.
 */

export async function enqueueFulfillment(orderId: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.fulfillment_enabled) return; // explicit opt-in only
  const order = await loadOrder(orderId);
  if (!order) return;

  const items = await db().query(
    `SELECT oi.*, v.supplier_id, v.supplier_variant_ref, v.cost_paise
     FROM order_items oi LEFT JOIN product_variants v ON v.id = oi.variant_id
     WHERE oi.order_id = ?`,
    [orderId]
  );

  const bySupplier = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.supplier_id) continue;
    const list = bySupplier.get(item.supplier_id) ?? [];
    list.push(item);
    bySupplier.set(item.supplier_id, list);
  }

  for (const [supplierId, lines] of bySupplier) {
    const supplier = await getSupplier(supplierId);
    if (!supplier || !b(supplier.is_active) || !b(supplier.supports_fulfillment)) continue;
    const idempotencyKey = `fulfil_${orderId}_${supplierId}`;
    const existing = await db().get(`SELECT id FROM supplier_orders WHERE idempotency_key = ?`, [idempotencyKey]);
    if (existing) continue; // duplicate protection
    const payload: FulfillmentLine[] = lines.map((l) => ({
      sku: l.sku,
      supplierVariantRef: l.supplier_variant_ref,
      title: l.title,
      qty: l.qty,
      unitCostPaise: l.cost_paise == null ? null : Number(l.cost_paise),
    }));
    await db().run(
      `INSERT INTO supplier_orders (id, supplier_id, order_id, status, attempts, payload_json, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
      [uuid(), supplierId, orderId, JSON.stringify({ lines: payload, shipping: order.shipping_address, storeOrderNumber: order.number }), idempotencyKey, nowIso(), nowIso()]
    );
  }

  const anySupplierOrders = await db().get(`SELECT id FROM supplier_orders WHERE order_id = ? LIMIT 1`, [orderId]);
  if (anySupplierOrders) {
    await db().run(`UPDATE orders SET fulfillment_status = 'pending_supplier', updated_at = ? WHERE id = ?`, [nowIso(), orderId]);
    await appendStatusEvent(orderId, 'pending_supplier', { type: 'system' }, 'Sent to supplier fulfillment queue');
  }
}

export async function processFulfillmentQueue(): Promise<{ processed: number; failed: number }> {
  const due = await db().query(
    `SELECT * FROM supplier_orders WHERE status IN ('pending','retrying') AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY created_at LIMIT 25`,
    [nowIso()]
  );
  let processed = 0;
  let failed = 0;
  for (const row of due) {
    const result = await attemptFulfillment(row.id);
    if (result === 'ok') processed += 1;
    else failed += 1;
  }
  return { processed, failed };
}

export async function attemptFulfillment(supplierOrderId: string): Promise<'ok' | 'retry' | 'failed'> {
  const row = await db().get(`SELECT * FROM supplier_orders WHERE id = ?`, [supplierOrderId]);
  if (!row) return 'failed';
  const supplier = await getSupplier(row.supplier_id);
  if (!supplier) {
    await db().run(`UPDATE supplier_orders SET status = 'failed', last_error = 'Supplier record missing', updated_at = ? WHERE id = ?`, [nowIso(), row.id]);
    return 'failed';
  }
  const adapter = buildAdapter(supplier);
  const payload = json<{ lines: FulfillmentLine[]; shipping: any; storeOrderNumber: string }>(row.payload_json, { lines: [], shipping: {}, storeOrderNumber: '' });

  const attempts = Number(row.attempts) + 1;
  try {
    const result = await adapter.createOrder({
      storeOrderId: row.order_id,
      storeOrderNumber: payload.storeOrderNumber,
      lines: payload.lines,
      shipping: payload.shipping,
      idempotencyKey: row.idempotency_key,
    });
    if (!result.ok) {
      await markFailure(row, attempts, result.error ?? 'Supplier rejected the order', result.retryable !== false);
      return result.retryable === false ? 'failed' : 'retry';
    }
    await db().run(
      `UPDATE supplier_orders SET status = 'submitted', external_ref = ?, attempts = ?, last_error = NULL, next_retry_at = NULL, submitted_at = ?, response_json = ?, updated_at = ? WHERE id = ?`,
      [result.externalRef ?? null, attempts, nowIso(), JSON.stringify(result), nowIso(), row.id]
    );
    await db().run(`UPDATE orders SET fulfillment_status = 'pending_supplier', updated_at = ? WHERE id = ?`, [nowIso(), row.order_id]);
    await appendStatusEvent(row.order_id, 'fulfillment_submitted', { type: 'supplier' }, `Supplier reference ${result.externalRef}`);
    await audit({ actor: { type: 'system' }, action: 'supplier.order_submitted', entityType: 'supplier_order', entityId: row.id, after: { external_ref: result.externalRef } });
    return 'ok';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = (err as { retryable?: boolean }).retryable !== false;
    await markFailure(row, attempts, message, retryable);
    return retryable ? 'retry' : 'failed';
  }
}

async function markFailure(row: any, attempts: number, message: string, retryable: boolean): Promise<void> {
  // exponential backoff: 1m, 5m, 25m, 2h, then give up and flag for ops
  const backoffMinutes = [1, 5, 25, 120];
  const nextRetry = retryable && attempts <= backoffMinutes.length
    ? new Date(Date.now() + backoffMinutes[attempts - 1]! * 60_000).toISOString()
    : null;
  const status = nextRetry ? 'retrying' : 'failed';
  await db().run(
    `UPDATE supplier_orders SET status = ?, attempts = ?, last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
    [status, attempts, message, nextRetry, nowIso(), row.id]
  );
  if (status === 'failed') {
    await db().run(`UPDATE orders SET fulfillment_status = 'supplier_failed', updated_at = ? WHERE id = ?`, [nowIso(), row.order_id]);
    await appendStatusEvent(row.order_id, 'supplier_failed', { type: 'supplier' }, message);
    const order = await loadOrder(row.order_id);
    const settings = await getSettings();
    if (order) {
      await sendEmail({
        to: settings.support_email,
        subject: `[OPS] Supplier fulfillment failed for ${order.number}`,
        template: 'ops_supplier_failure',
        text: emailTemplates.supplierFailure(settings.store_name, order.number, message, attempts),
      });
    }
    await audit({ actor: { type: 'system' }, action: 'supplier.order_failed', entityType: 'supplier_order', entityId: row.id, after: { error: message, attempts } });
  }
}

/** Pull tracking from suppliers that support it and mirror into shipments. */
export async function syncTracking(): Promise<{ updated: number }> {
  const rows = await db().query(
    `SELECT so.*, s.adapter_type, s.supports_tracking FROM supplier_orders so JOIN suppliers s ON s.id = so.supplier_id
     WHERE so.status IN ('submitted','shipped') AND s.supports_tracking = 1 AND so.external_ref IS NOT NULL`
  );
  let updated = 0;
  for (const row of rows) {
    const supplier = await getSupplier(row.supplier_id);
    if (!supplier) continue;
    try {
      const status = await buildAdapter(supplier).getOrderStatus(row.external_ref);
      if (!status) continue;
      updated += await applyShipmentStatus(row, status);
    } catch (err) {
      console.warn(`[tracking] ${row.external_ref}:`, err instanceof Error ? err.message : err);
    }
  }
  return { updated };
}

async function applyShipmentStatus(supplierOrder: any, status: any): Promise<number> {
  const orderId = supplierOrder.order_id;
  let shipment = await db().get(`SELECT * FROM shipments WHERE supplier_order_id = ?`, [supplierOrder.id]);
  if (!shipment) {
    const id = uuid();
    await db().run(
      `INSERT INTO shipments (id, order_id, supplier_order_id, carrier, tracking_number, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, orderId, supplierOrder.id, status.carrier, status.trackingNumber, status.status, nowIso(), nowIso()]
    );
    shipment = { id };
  } else {
    await db().run(`UPDATE shipments SET carrier = ?, tracking_number = ?, status = ?, updated_at = ? WHERE id = ?`, [
      status.carrier ?? shipment.carrier,
      status.trackingNumber ?? shipment.tracking_number,
      status.status,
      nowIso(),
      shipment.id,
    ]);
  }
  let added = 0;
  for (const ev of status.events ?? []) {
    const exists = await db().get(`SELECT id FROM tracking_events WHERE shipment_id = ? AND status = ? AND occurred_at = ?`, [shipment.id, ev.status, ev.occurredAt]);
    if (exists) continue;
    await db().run(
      `INSERT INTO tracking_events (id, shipment_id, status, description, location, occurred_at, source) VALUES (?, ?, ?, ?, ?, ?, 'supplier')`,
      [uuid(), shipment.id, ev.status, ev.description, ev.location, ev.occurredAt]
    );
    added += 1;
  }

  const normalised = normaliseSupplierStatus(status.status);
  if (normalised) {
    await db().run(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('cancelled','refunded','delivered')`, [normalised, nowIso(), orderId]);
    const order = await loadOrder(orderId);
    if (order && order.status === normalised) {
      await appendStatusEvent(orderId, normalised, { type: 'supplier' }, `Supplier status: ${status.status}`);
      if (normalised === 'shipped' && status.trackingNumber) {
        const s = await db().get(`SELECT * FROM shipments WHERE id = ?`, [shipment.id]);
        await sendEmail({
          to: order.email,
          subject: `Order ${order.number} has shipped`,
          template: 'order_shipped',
          text: emailTemplates.shipped('Ojas', order.number, s?.carrier ?? null, s?.tracking_number ?? null),
        }).catch(() => {});
      }
    }
  }
  if (status.status === 'delivered') {
    await db().run(`UPDATE shipments SET delivered_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), shipment.id]);
  } else if (status.status === 'shipped') {
    await db().run(`UPDATE shipments SET shipped_at = COALESCE(shipped_at, ?), updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), shipment.id]);
  }
  await db().run(`UPDATE supplier_orders SET status = ?, updated_at = ? WHERE id = ?`, [status.status === 'delivered' ? 'delivered' : 'shipped', nowIso(), supplierOrder.id]);
  return added;
}

function normaliseSupplierStatus(status: string): 'processing' | 'shipped' | 'out_for_delivery' | 'delivered' | null {
  const s = status.toLowerCase();
  if (s.includes('deliver')) return 'delivered';
  if (s.includes('out_for') || s.includes('out for')) return 'out_for_delivery';
  if (s.includes('ship') || s.includes('transit') || s.includes('dispatch')) return 'shipped';
  if (s.includes('accept') || s.includes('process') || s.includes('pack')) return 'processing';
  return null;
}
