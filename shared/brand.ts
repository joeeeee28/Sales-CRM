/**
 * Brand system — the single place to customise the store's identity.
 * Visual tokens (colours/type) live in `src/styles.css` under `@theme`;
 * this file holds the textual identity + defaults used server & client.
 */
export const BRAND = {
  name: 'Ojas',
  legalName: 'Ojas Lifestyle Pvt. Ltd.',
  tagline: 'Considered goods for everyday life.',
  /** Short brand promise shown in the announcement bar when no promo is set. */
  announcement: 'Free shipping on orders over ₹1,999 · 30-day easy returns',
  supportEmail: 'care@ojas.example',
  supportPhone: '+91 80 4719 0000',
  addressLine: 'WeWork Galaxy, 43 Residency Rd, Bengaluru 560025, India',
  /**
   * Social profiles — rendered in the footer ONLY when configured here.
   * Empty by default: we never render placeholder links to example.com or
   * generic platform homepages. Add your real profile URLs, e.g.
   * { label: 'Instagram', href: 'https://instagram.com/yourstore' }
   */
  social: [] as readonly { label: string; href: string }[],
  /** Returns window promised in the (legally-flagged) returns policy template. */
  returnsWindowDays: 30,
  /** Accent colour mirrored in styles.css (`--color-accent-*`). */
  accent: '#C8552B',
} as const;

export const PAYMENT_BADGES = ['UPI', 'Visa', 'Mastercard', 'RuPay', 'NetBanking', 'Wallets', 'COD'] as const;
