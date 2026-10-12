import { db } from '../db/index.js';
import { config } from '../config.js';
import { nowIso, uuid } from './util.js';
import { getSettings } from './settings.js';

export type EmailTemplate =
  | 'order_confirmation'
  | 'payment_failed'
  | 'order_shipped'
  | 'order_delivered'
  | 'order_cancelled'
  | 'refund_issued'
  | 'password_reset'
  | 'welcome'
  | 'abandoned_cart'
  | 'ops_supplier_failure';

interface SendInput {
  to: string;
  subject: string;
  template: EmailTemplate;
  text: string;
  html?: string;
}

function wrapHtml(storeName: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#FAF9F6;font-family:ui-sans-serif,system-ui,sans-serif;color:#17171A">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="font-family:Georgia,serif;font-size:22px;letter-spacing:.02em">${storeName}</div>
    <div style="margin-top:24px;font-size:15px;line-height:1.6">${bodyHtml}</div>
    <div style="margin-top:40px;padding-top:16px;border-top:1px solid #E7E4DE;font-size:12px;color:#6E6B66">
      You received this email because of your activity on the ${storeName} store.
    </div>
  </div></body></html>`;
}

export async function sendEmail(input: SendInput): Promise<{ id: string; status: string }> {
  const settings = await getSettings();
  const id = uuid();
  const html = wrapHtml(settings.store_name, (input.html ?? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(input.text)}</pre>`));

  if (config.email.provider === 'resend' && config.email.resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.email.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.email.from, to: [input.to], subject: input.subject, html }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
      await logEmail(id, input, 'sent', 'resend', html, null);
      return { id, status: 'sent' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logEmail(id, input, 'failed', 'resend', html, message);
      return { id, status: 'failed' };
    }
  }

  // console provider (default in dev): never silently drops mail — it is
  // persisted to email_log so the admin can inspect exactly what would send.
  if (config.env !== 'test') {
    console.log(`\n[email:${input.template}] → ${input.to} | ${input.subject}\n${input.text}\n`);
  }
  await logEmail(id, input, 'sent', 'console', html, null);
  return { id, status: 'sent' };
}

async function logEmail(id: string, input: SendInput, status: string, provider: string, html: string, error: string | null) {
  await db().run(
    `INSERT INTO email_log (id, to_email, subject, template, status, provider, error, body_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.to, input.subject, input.template, status, provider, error, input.text, nowIso()]
  ).catch(() => {});
  void html;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ----------------------------- templates ---------------------------------- */

export const emailTemplates = {
  orderConfirmation(store: string, number: string, total: string, eta: string | null): SendInput['text'] {
    return [
      `Thank you for your order, ${number}.`,
      ``,
      `We've received your payment and your order is confirmed. Total paid: ${total}.`,
      eta ? `Estimated delivery: ${eta}.` : `We'll email your estimated delivery window as soon as the order is processed.`,
      ``,
      `Track anytime: /track (order number + your email).`,
      `— ${store}`,
    ].join('\n');
  },
  paymentFailed(store: string, number: string, reason: string): string {
    return [
      `We couldn't process the payment for order ${number}.`,
      `Reason: ${reason}`,
      `No money has been captured. You can retry from your account or the link in this email.`,
      `— ${store}`,
    ].join('\n');
  },
  shipped(store: string, number: string, carrier: string | null, tracking: string | null): string {
    return [
      `Good news — order ${number} has shipped.`,
      carrier ? `Carrier: ${carrier}` : '',
      tracking ? `Tracking number: ${tracking}` : 'Tracking details will appear on your order page shortly.',
      `— ${store}`,
    ]
      .filter(Boolean)
      .join('\n');
  },
  delivered(store: string, number: string): string {
    return `Order ${number} was delivered. If anything isn't right, you have 30 days to start a return from your account.\n— ${store}`;
  },
  cancelled(store: string, number: string, reason: string | null): string {
    return `Order ${number} has been cancelled.${reason ? ` Reason: ${reason}` : ''} Any captured payment will be refunded to the original method within 5–7 business days.\n— ${store}`;
  },
  refund(store: string, number: string, amount: string): string {
    return `A refund of ${amount} for order ${number} has been initiated. Banks typically settle refunds in 5–7 business days.\n— ${store}`;
  },
  passwordReset(store: string, link: string): string {
    return `Use this link within 1 hour to choose a new password:\n${link}\n\nIf you didn't request this, you can ignore this email.\n— ${store}`;
  },
  welcome(store: string, name: string): string {
    return `Welcome to ${store}, ${name || 'friend'}.\nYour account is ready — order history, saved addresses and faster checkout are waiting.\n— ${store}`;
  },
  abandonedCart(store: string, link: string): string {
    return `You left something in your bag at ${store}. Your cart is saved here:\n${link}\n\n(You're receiving this because you opted in to email updates. Unsubscribe anytime from your account.)\n— ${store}`;
  },
  supplierFailure(store: string, orderNumber: string, error: string, attempts: number): string {
    return `[OPS] Fulfillment request to supplier failed for order ${orderNumber} after ${attempts} attempt(s).\nLast error: ${error}\nThe order is marked "supplier_failed" and will retry automatically. Check Admin → Suppliers.`;
  },
};
