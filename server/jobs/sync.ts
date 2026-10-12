import { db } from '../db/index.js';
import { nowIso, uuid, json, b } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { getSupplier, buildAdapter, listSuppliers } from '../integrations/suppliers/registry.js';
import { applyMarkupRule, type MarkupRule } from '../integrations/suppliers/types.js';

/**
 * Supplier → store synchronisation jobs:
 *  - syncCatalog : import supplier products & keep the mapping table current
 *  - syncStock   : mirror supplier availability into variant stock
 *  - syncPrices  : apply configured markup rules; flag drift for review
 */

async function withRun(job: string, supplierId: string | null, fn: () => Promise<{ processed: number; failed: number; details?: unknown }>) {
  const id = uuid();
  const startedAt = nowIso();
  await db().run(`INSERT INTO sync_runs (id, job, supplier_id, status, started_at) VALUES (?, ?, ?, 'running', ?)`, [id, job, supplierId, startedAt]);
  try {
    const result = await fn();
    await db().run(
      `UPDATE sync_runs SET status = 'success', finished_at = ?, items_processed = ?, items_failed = ?, details_json = ? WHERE id = ?`,
      [nowIso(), result.processed, result.failed, JSON.stringify(result.details ?? {}), id]
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db().run(`UPDATE sync_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`, [nowIso(), message, id]);
    throw err;
  }
}

export async function syncCatalog(supplierId: string): Promise<{ processed: number; failed: number; imported: number }> {
  const supplier = await getSupplier(supplierId);
  if (!supplier) throw new Error('Supplier not found');
  const adapter = buildAdapter(supplier);
  return withRun('catalog', supplierId, async () => {
    let cursor: string | null = null;
    let processed = 0;
    let imported = 0;
    let failed = 0;
    do {
      const page = await adapter.listCatalog(cursor ?? undefined);
      for (const item of page.items) {
        try {
          await db().run(
            `INSERT INTO supplier_products (id, supplier_id, external_id, external_sku, title, price_paise, stock_qty, status, raw_json, last_synced_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(supplier_id, external_id) DO UPDATE SET
               external_sku = excluded.external_sku, title = excluded.title, price_paise = excluded.price_paise,
               stock_qty = excluded.stock_qty, status = excluded.status, raw_json = excluded.raw_json,
               last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`,
            [uuid(), supplierId, item.externalId, item.externalSku, item.title, item.pricePaise, item.stockQty, item.status, JSON.stringify(item.raw), nowIso(), nowIso(), nowIso()]
          );
          processed += 1;
          if (!item.raw) imported += 0;
        } catch {
          failed += 1;
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    const mapped = await db().get(`SELECT COUNT(*) AS n FROM supplier_products WHERE supplier_id = ? AND store_variant_id IS NOT NULL`, [supplierId]);
    imported = Number(mapped?.n ?? 0);
    return { processed, failed, details: { mapped_variants: imported } };
  }) as Promise<{ processed: number; failed: number; imported: number }>;
}

export async function syncStock(supplierId: string): Promise<{ processed: number; failed: number; changed: number }> {
  const supplier = await getSupplier(supplierId);
  if (!supplier) throw new Error('Supplier not found');
  const adapter = buildAdapter(supplier);
  return withRun('stock', supplierId, async () => {
    const mapped = await db().query(
      `SELECT sp.*, v.sku, v.stock_qty AS store_stock FROM supplier_products sp
       JOIN product_variants v ON v.id = sp.store_variant_id
       WHERE sp.supplier_id = ? AND sp.store_variant_id IS NOT NULL`,
      [supplierId]
    );
    if (!mapped.length) return { processed: 0, failed: 0, changed: 0 };
    const levels = await adapter.checkStock(mapped.map((m) => m.external_id));
    const byId = new Map(levels.map((l) => [l.externalId, l]));
    let changed = 0;
    let failed = 0;
    for (const row of mapped) {
      const level = byId.get(row.external_id);
      if (!level || level.stockQty == null) {
        failed += 1;
        continue;
      }
      if (Number(row.store_stock) !== level.stockQty) {
        await db().run(`UPDATE product_variants SET stock_qty = ?, updated_at = ? WHERE id = ?`, [level.stockQty, nowIso(), row.store_variant_id]);
        changed += 1;
        await audit({ actor: { type: 'system' }, action: 'stock.synced', entityType: 'variant', entityId: row.store_variant_id, before: { stock: row.store_stock }, after: { stock: level.stockQty, supplier: supplier.code } });
      }
      if (level.status && level.status !== row.status) {
        await db().run(`UPDATE supplier_products SET status = ?, updated_at = ? WHERE id = ?`, [level.status, nowIso(), row.id]);
      }
    }
    await db().run(`UPDATE supplier_products SET last_synced_at = ? WHERE supplier_id = ?`, [nowIso(), supplierId]).catch(() => {});
    return { processed: mapped.length, failed, changed };
  }) as Promise<{ processed: number; failed: number; changed: number }>;
}

export async function syncPrices(supplierId: string): Promise<{ processed: number; failed: number; changed: number; flagged: number }> {
  const supplier = await getSupplier(supplierId);
  if (!supplier) throw new Error('Supplier not found');
  const adapter = buildAdapter(supplier);
  return withRun('prices', supplierId, async () => {
    const mapped = await db().query(
      `SELECT sp.*, v.id AS variant_id, v.cost_paise, v.price_paise FROM supplier_products sp
       JOIN product_variants v ON v.id = sp.store_variant_id
       WHERE sp.supplier_id = ? AND sp.store_variant_id IS NOT NULL`,
      [supplierId]
    );
    if (!mapped.length) return { processed: 0, failed: 0, changed: 0, flagged: 0 };
    const prices = await adapter.checkPrices(mapped.map((m) => m.external_id));
    const byId = new Map(prices.map((p) => [p.externalId, p]));
    let changed = 0;
    let flagged = 0;
    let failed = 0;
    for (const row of mapped) {
      const price = byId.get(row.external_id);
      if (!price || price.pricePaise == null) {
        failed += 1;
        continue;
      }
      const previousCost = row.cost_paise == null ? null : Number(row.cost_paise);
      if (previousCost !== price.pricePaise) {
        const rule: MarkupRule | null = json<MarkupRule | null>(json<Record<string, any>>(supplier.config_json, {}).markupRule ?? null, null);
        const newCost = price.pricePaise;
        const suggested = applyMarkupRule(newCost, rule);
        await db().run(`UPDATE product_variants SET cost_paise = ?, updated_at = ? WHERE id = ?`, [newCost, nowIso(), row.variant_id]);
        // Price changes never silently reach customers: if the variant's
        // selling price would fall below the new cost, flag it for review.
        const current = row.price_paise == null ? null : Number(row.price_paise);
        if (current != null && current < newCost) {
          await db().run(`UPDATE product_variants SET is_active = 0, updated_at = ? WHERE id = ?`, [nowIso(), row.variant_id]);
          flagged += 1;
          await audit({ actor: { type: 'system' }, action: 'price.margin_breach', entityType: 'variant', entityId: row.variant_id, before: { price: current, cost: previousCost }, after: { cost: newCost, suggested } });
        } else if (rule) {
          await db().run(`UPDATE product_variants SET price_paise = ?, updated_at = ? WHERE id = ?`, [suggested, nowIso(), row.variant_id]);
          changed += 1;
        }
      }
    }
    return { processed: mapped.length, failed, changed, flagged };
  }) as Promise<{ processed: number; failed: number; changed: number; flagged: number }>;
}

export async function runAllSyncs(): Promise<void> {
  const suppliers = await listSuppliers();
  for (const s of suppliers.filter((x) => b(x.is_active))) {
    for (const job of [syncStock, syncPrices]) {
      try {
        await job(s.id);
      } catch (err) {
        console.warn(`[sync] ${job.name} ${s.code}:`, err instanceof Error ? err.message : err);
      }
    }
  }
}
