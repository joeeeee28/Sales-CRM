import { db } from '../db/index.js';
import { config } from '../config.js';
import { nowIso, b } from '../lib/util.js';
import { sendEmail, emailTemplates } from '../lib/email.js';
import { getSettings } from '../lib/settings.js';

/**
 * Cart recovery — consent-first. Only carts that (a) belong to a user or have
 * a captured email, (b) have marketing_consent = true, (c) have no order yet
 * and (d) were updated >1h ago receive ONE recovery email.
 */
export async function sweepAbandonedCarts(): Promise<{ sent: number }> {
  const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
  const rows = await db().query(
    `SELECT c.id, c.email, c.updated_at, u.email AS user_email, u.marketing_consent
     FROM carts c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.abandoned_email_sent_at IS NULL AND c.updated_at < ?
       AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = c.user_id AND o.placed_at > c.updated_at)`,
    [cutoff]
  );
  let sent = 0;
  const settings = await getSettings();
  for (const row of rows) {
    const consent = row.user_email != null ? b(row.marketing_consent) : false; // guest carts: never email without an account consent
    if (!consent) continue;
    const email = row.user_email ?? row.email;
    if (!email) continue;
    await sendEmail({
      to: email,
      subject: `Your ${settings.store_name} bag is still here`,
      template: 'abandoned_cart',
      text: emailTemplates.abandonedCart(settings.store_name, `${config.publicUrl}/cart`),
    });
    await db().run(`UPDATE carts SET abandoned_email_sent_at = ? WHERE id = ?`, [nowIso(), row.id]);
    sent += 1;
  }
  return { sent };
}
