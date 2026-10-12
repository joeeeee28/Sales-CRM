import { db } from '../db/index.js';
import { nowIso, json, b } from './util.js';
import type { StoreSettings } from '../../shared/types.js';
import { BRAND } from '../../shared/brand.js';

const DEFAULTS: StoreSettings = {
  store_name: BRAND.name,
  tagline: BRAND.tagline,
  support_email: BRAND.supportEmail,
  support_phone: BRAND.supportPhone,
  address_line: BRAND.addressLine,
  currency: 'INR',
  cod_enabled: false,
  cod_max_amount_paise: 2000000, // ₹20,000 — enable COD per your fraud policy
  free_shipping_over_paise: 199900,
  tax_inclusive: true,
  default_tax_bps: 1800,
  announcement_text: BRAND.announcement,
  announcement_link: '/pages/shipping-policy',
  fulfillment_enabled: false, // flip on only after supplier credentials + e2e tests
  reviews_require_purchase: true,
  marketing_consent_default: false,
};

let cache: { at: number; settings: StoreSettings } | null = null;

export async function getSettings(): Promise<StoreSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.settings;
  const rows = await db().query(`SELECT key, value_json FROM store_settings`);
  const merged: StoreSettings = { ...DEFAULTS };
  for (const row of rows) {
    (merged as unknown as Record<string, unknown>)[row.key] = json(row.value_json, (DEFAULTS as unknown as Record<string, unknown>)[row.key]);
  }
  cache = { at: Date.now(), settings: merged };
  return merged;
}

export function invalidateSettings(): void {
  cache = null;
}

export async function setSetting(key: string, value: unknown, actorId: string | null): Promise<void> {
  await db().run(
    `INSERT INTO store_settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [key, JSON.stringify(value), nowIso(), actorId]
  );
  invalidateSettings();
}

export async function setSettingsBulk(patch: Partial<StoreSettings>, actorId: string | null): Promise<void> {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    await setSetting(k, v, actorId);
  }
}

export { b };
