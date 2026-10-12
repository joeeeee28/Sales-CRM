/**
 * Payment gateway integration layer.
 *
 * Razorpay is prepared for the Indian market (UPI, cards, netbanking, wallets).
 * - When RAZORPAY_KEY_ID/SECRET are configured we create real Orders via the
 *   Razorpay REST API and verify checkout signatures server-side (HMAC-SHA256).
 * - Without credentials the gateway runs in SIMULATED mode: the UI is clearly
 *   labelled, no money moves, and the same server-side verification code path
 *   is exercised so the flow is testable end-to-end.
 *
 * Card data NEVER touches this server: the browser tokenises directly with the
 * gateway (Razorpay Checkout), we only ever see order/payment ids + signatures.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { nowIso, uuid, hmacSha256, safeEqual } from '../lib/util.js';
import { badRequest, conflict } from '../lib/errors.js';
import type { PaymentMethod } from '../../shared/types.js';

export interface GatewayStatus {
  provider: 'razorpay';
  mode: 'live' | 'simulated';
  keyId: string | null;
  methods: PaymentMethod[];
}

export function gatewayStatus(): GatewayStatus {
  return {
    provider: 'razorpay',
    mode: config.payments.razorpayLive ? 'live' : 'simulated',
    keyId: config.payments.razorpayLive ? config.payments.razorpayKeyId : null,
    methods: ['upi', 'card', 'netbanking', 'wallet'],
  };
}

export interface CreateGatewayOrderResult {
  providerOrderId: string;
  mode: 'live' | 'simulated';
  keyId: string | null;
  amountPaise: number;
  currency: string;
}

export async function createGatewayOrder(opts: {
  orderId: string;
  orderNumber: string;
  amountPaise: number;
  currency: string;
  customerEmail: string;
  customerPhone?: string | null;
  idempotencyKey: string;
}): Promise<CreateGatewayOrderResult> {
  // Idempotency: reuse an existing gateway order for the same checkout attempt.
  const existing = await db().get(
    `SELECT provider_order_id, amount_paise FROM payments WHERE order_id = ? AND provider = 'razorpay' AND status IN ('created','authorized') ORDER BY created_at DESC LIMIT 1`,
    [opts.orderId]
  );
  if (existing && Number(existing.amount_paise) === opts.amountPaise && existing.provider_order_id) {
    return {
      providerOrderId: existing.provider_order_id,
      mode: gatewayStatus().mode,
      keyId: gatewayStatus().keyId,
      amountPaise: opts.amountPaise,
      currency: opts.currency,
    };
  }

  let providerOrderId: string;
  if (config.payments.razorpayLive) {
    const auth = Buffer.from(`${config.payments.razorpayKeyId}:${config.payments.razorpayKeySecret}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: opts.amountPaise,
        currency: opts.currency,
        receipt: opts.orderNumber,
        notes: { order_id: opts.orderId, idempotency_key: opts.idempotencyKey },
      }),
    });
    if (!res.ok) throw new Error(`Razorpay order creation failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { id: string };
    providerOrderId = body.id;
  } else {
    providerOrderId = `order_SIMULATED_${crypto.createHash('sha1').update(opts.idempotencyKey).digest('hex').slice(0, 14)}`;
  }

  await db().run(
    `INSERT INTO payments (id, order_id, provider, provider_order_id, status, amount_paise, idempotency_key, created_at)
     VALUES (?, ?, 'razorpay', ?, 'created', ?, ?, ?)`,
    [uuid(), opts.orderId, providerOrderId, opts.amountPaise, opts.idempotencyKey, nowIso()]
  );
  return {
    providerOrderId,
    mode: gatewayStatus().mode,
    keyId: gatewayStatus().keyId,
    amountPaise: opts.amountPaise,
    currency: opts.currency,
  };
}

export interface VerificationInput {
  orderId: string;
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
  method: PaymentMethod | null;
}

export type VerificationResult =
  | { ok: true; paymentId: string; duplicate: boolean }
  | { ok: false; reason: string };

/**
 * Server-side verification. In live mode the Razorpay signature
 * (HMAC-SHA256 of `order_id|payment_id` with the key secret) MUST match.
 * Duplicate webhook/verification calls are absorbed via the unique
 * provider_payment_id constraint — the order is captured exactly once.
 */
export async function verifyPayment(input: VerificationInput): Promise<VerificationResult> {
  if (config.payments.razorpayLive) {
    const expected = hmacSha256(config.payments.razorpayKeySecret, `${input.providerOrderId}|${input.providerPaymentId}`);
    if (!safeEqual(expected, input.signature)) {
      return { ok: false, reason: 'Signature verification failed' };
    }
  } else {
    // Simulated mode: signature is a HMAC of the same payload with the session
    // secret so the verification code path is still exercised in tests.
    const expected = hmacSha256(config.sessionSecret, `${input.providerOrderId}|${input.providerPaymentId}`);
    if (!safeEqual(expected, input.signature)) {
      return { ok: false, reason: 'Signature verification failed (simulated gateway)' };
    }
  }

  // 1) Already-recorded payment id → duplicate notification, absorb silently.
  const byPaymentId = await db().get(`SELECT id, status FROM payments WHERE provider_payment_id = ?`, [input.providerPaymentId]);
  if (byPaymentId) {
    if (byPaymentId.status === 'captured') return { ok: true, paymentId: byPaymentId.id, duplicate: true };
    await db().run(`UPDATE payments SET status = 'captured', captured_at = ?, method = ? WHERE id = ?`, [nowIso(), input.method, byPaymentId.id]);
    return { ok: true, paymentId: byPaymentId.id, duplicate: false };
  }

  // 2) Attach the payment id to the gateway order row created at `prepare`
  //    so there is exactly ONE payment row per gateway order.
  const prepared = await db().get(
    `SELECT id, status FROM payments WHERE order_id = ? AND provider_order_id = ? AND status IN ('created','authorized') ORDER BY created_at DESC LIMIT 1`,
    [input.orderId, input.providerOrderId]
  );
  if (prepared) {
    const res = await db().run(
      `UPDATE payments SET provider_payment_id = ?, status = 'captured', captured_at = ?, method = ? WHERE id = ? AND status IN ('created','authorized')`,
      [input.providerPaymentId, nowIso(), input.method, prepared.id]
    );
    if (res.changes > 0) return { ok: true, paymentId: prepared.id, duplicate: false };
    // lost the race → fall through; the unique constraint below protects us
  }

  // 3) No prepared row (e.g. webhook-first): insert, protected by uniqueness.
  try {
    await db().run(
      `INSERT INTO payments (id, order_id, provider, provider_order_id, provider_payment_id, method, status, amount_paise, captured_at, idempotency_key, created_at)
       VALUES (?, ?, 'razorpay', ?, ?, ?, 'captured', (SELECT total_paise FROM orders WHERE id = ?), ?, ?, ?)`,
      [uuid(), input.orderId, input.providerOrderId, input.providerPaymentId, input.method, input.orderId, nowIso(), `idem_${input.providerPaymentId}`, nowIso()]
    );
  } catch {
    const row = await db().get(`SELECT id FROM payments WHERE provider_payment_id = ?`, [input.providerPaymentId]);
    if (row) return { ok: true, paymentId: row.id, duplicate: true };
    throw conflict('Payment could not be recorded');
  }
  const row = await db().get(`SELECT id FROM payments WHERE provider_payment_id = ?`, [input.providerPaymentId]);
  return { ok: true, paymentId: row!.id, duplicate: false };
}

export function simulatedSignature(providerOrderId: string, providerPaymentId: string): string {
  return hmacSha256(config.sessionSecret, `${providerOrderId}|${providerPaymentId}`);
}

export async function markPaymentFailed(orderId: string, reason: string): Promise<void> {
  await db().run(
    `UPDATE payments SET status = 'failed', failure_reason = ? WHERE order_id = ? AND status IN ('created','authorized')`,
    [reason, orderId]
  );
}

export async function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): Promise<boolean> {
  if (!config.payments.razorpayWebhookSecret) return false;
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha256', config.payments.razorpayWebhookSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signatureHeader);
}

/** COD orders: payment is captured on delivery, never online. */
export async function recordCodPayment(orderId: string, amountPaise: number): Promise<void> {
  await db().run(
    `INSERT INTO payments (id, order_id, provider, method, status, amount_paise, idempotency_key, created_at)
     VALUES (?, ?, 'cod', 'cod', 'created', ?, ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`,
    [uuid(), orderId, amountPaise, `cod_${orderId}`, nowIso()]
  );
}

export function validateCodAllowed(settings: { cod_enabled: boolean; cod_max_amount_paise: number }, totalPaise: number, methodAvailable: boolean): string | null {
  if (!settings.cod_enabled) return 'Cash on Delivery is not enabled for this store yet.';
  if (!methodAvailable) return 'Cash on Delivery is not available for this shipping method.';
  if (totalPaise > settings.cod_max_amount_paise) {
    return `Cash on Delivery is available for orders up to ₹${(settings.cod_max_amount_paise / 100).toLocaleString('en-IN')}.`;
  }
  return null;
}

export { badRequest };
