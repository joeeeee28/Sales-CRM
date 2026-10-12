/**
 * One-shot data migration: SQLite (local source) → PostgreSQL (Supabase target).
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/migrate-to-postgres.ts [--flags]
 *
 * Flags:
 *   (default)        catalogue + content + configuration only (categories, products,
 *                    variants, images, specs, suppliers, supplier mappings, coupons,
 *                    shipping methods, store settings, FAQs, content pages).
 *                    Transactional/demo data (users, orders, payments, sessions…) is
 *                    NOT copied — simulated payment records must never reach a live store.
 *   --include-users  + users, addresses, sessions, password resets, carts, wishlists,
 *                    newsletter subscribers, contact messages
 *   --include-orders + orders, order items, payments, shipments, tracking events,
 *                    supplier orders, sync runs, reviews, returns, audit/email/analytics
 *                    logs (implies --include-users; only for REAL historical data)
 *   --include-data   every table
 *   --tables=a,b     explicit table list (FK ancestors are added automatically)
 *   --dry-run        report what would be copied, write nothing
 *
 * Safety properties:
 *   - the SQLite source is opened read-only and never modified;
 *   - ids, timestamps, prices, stock and statuses are copied verbatim;
 *   - inserts use ON CONFLICT DO NOTHING → re-running never duplicates rows;
 *   - the whole copy runs in ONE transaction; any validation failure rolls back;
 *   - no fulfillment is triggered: this is a pure data copy, the supplier scheduler
 *     only acts on orders whose payment was verified through the live pipeline.
 *
 * Prerequisite: target schema exists — run `DATABASE_URL=... npm run db:migrate` first
 * (or let this script do it; it needs a DDL-capable role, e.g. Supabase `postgres`).
 */
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../server/config.js';
import { initDb, db } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { hashPassword } from '../server/lib/auth.js';
import { nowIso, uuid } from '../server/lib/util.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const includeData = args.includes('--include-data');
const includeOrders = args.includes('--include-orders') || includeData;
const includeUsers = args.includes('--include-users') || includeOrders;
const explicit = args.find((a) => a.startsWith('--tables='))?.slice('--tables='.length).split(',').map((s) => s.trim()).filter(Boolean);

const TX_TABLES = new Set([
  'users', 'sessions', 'password_reset_tokens', 'addresses', 'carts', 'cart_items', 'wishlist_items',
  'orders', 'order_items', 'order_status_events', 'payments', 'shipments', 'tracking_events',
  'supplier_orders', 'sync_runs', 'reviews', 'returns', 'contact_messages', 'newsletter_subscribers',
  'audit_logs', 'analytics_events', 'email_log',
]);
const USER_TABLES = new Set(['users', 'sessions', 'password_reset_tokens', 'addresses', 'carts', 'cart_items', 'wishlist_items', 'newsletter_subscribers', 'contact_messages']);

function keep(table: string): boolean {
  if (explicit) return explicit.includes(table);
  if (includeData) return true;
  if (USER_TABLES.has(table)) return includeUsers;
  if (TX_TABLES.has(table)) return includeOrders;
  return true; // catalogue/content/config tables
}

if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set — refusing to run. Point it at the TARGET Postgres (Supabase) database.');
  process.exit(1);
}

const sourcePath = path.resolve(config.sqlitePath);
let source: DatabaseSync;
try {
  source = new DatabaseSync(sourcePath, { readOnly: true });
} catch {
  // older node:sqlite without readOnly support — open normally; this script never writes to it
  source = new DatabaseSync(sourcePath);
}

const target = await initDb();
if (target.dialect !== 'postgres') {
  console.error('DATABASE_URL did not produce a postgres connection — aborting.');
  process.exit(1);
}

console.log(`[copy] source : sqlite ${sourcePath} (read-only)`);
console.log(`[copy] target : postgres (${config.databaseUrl.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@')})`);

// 1. Ensure target schema (idempotent).
const applied = await migrate(target);
console.log(applied.length ? `[copy] target migrations applied: ${applied.join(', ')}` : '[copy] target schema up to date');

// 2. Discover tables + FK graph from the source.
const allTables = source
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name`)
  .all()
  .map((r) => String(r.name));

const parentsOf = new Map<string, string[]>();
for (const t of allTables) {
  const fks = source.prepare(`PRAGMA foreign_key_list("${t}")`).all() as { table: string }[];
  parentsOf.set(t, [...new Set(fks.map((f) => String(f.table)).filter((p) => p !== t))]);
}

// 3. Selection + FK-ancestor expansion (a child is never copied without its parents).
const selected = new Set<string>();
const expand = (t: string) => {
  if (selected.has(t)) return;
  for (const p of parentsOf.get(t) ?? []) if (allTables.includes(p)) expand(p);
  selected.add(t);
};
for (const t of allTables) if (keep(t)) expand(t);
const expandedBeyondKeep = [...selected].filter((t) => !keep(t));
if (expandedBeyondKeep.length) console.log(`[copy] FK ancestors added automatically: ${expandedBeyondKeep.join(', ')}`);
const unknown = explicit?.filter((t) => !allTables.includes(t)) ?? [];
if (unknown.length) console.warn(`[copy] warning: unknown tables ignored: ${unknown.join(', ')}`);

// 4. Topological order (parents first); deterministic.
const order: string[] = [];
const visiting = new Set<string>();
const visit = (t: string) => {
  if (order.includes(t) || visiting.has(t)) return; // cycles: first writer wins, FKs retried below
  visiting.add(t);
  for (const p of parentsOf.get(t) ?? []) if (selected.has(p)) visit(p);
  visiting.delete(t);
  order.push(t);
};
[...selected].sort().forEach(visit);

const tables = order.map((t) => {
  const cols = (source.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
  const rows = source.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[];
  return { table: t, cols, rows };
});

console.log(`[copy] plan: ${tables.length} tables, ${tables.reduce((s, t) => s + t.rows.length, 0)} source rows${dryRun ? ' (DRY RUN)' : ''}`);
for (const t of tables) console.log(`       - ${t.table}: ${t.rows.length} rows (${t.cols.length} cols)`);
if (dryRun) {
  console.log('[copy] dry run complete — nothing written.');
  process.exit(0);
}

// 5. Copy + validate inside ONE transaction on the target.
type Report = { table: string; source: number; inserted: number; targetTotal: number; sampleOk: boolean }[];
const report = await target.tx<Report>(async (tx) => {
  // column parity check against the target schema
  for (const t of tables) {
    const targetCols = (
      await tx.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?`,
        [t.table]
      )
    ).map((r) => String(r.column_name));
    if (!targetCols.length) throw new Error(`target table "${t.table}" does not exist — run migrations first`);
    const missing = t.cols.filter((c) => !targetCols.includes(c));
    if (missing.length) throw new Error(`target table "${t.table}" is missing columns: ${missing.join(', ')}`);
  }

  const rep: Report = [];
  for (const t of tables) {
    let inserted = 0;
    if (t.rows.length && t.cols.length) {
      const CHUNK = 100;
      for (let i = 0; i < t.rows.length; i += CHUNK) {
        const slice = t.rows.slice(i, i + CHUNK);
        const values = slice.map(() => `(${t.cols.map(() => '?').join(',')})`).join(',');
        const params = slice.flatMap((row) => t.cols.map((c) => row[c]));
        const res = await tx.run(
          `INSERT INTO "${t.table}" (${t.cols.map((c) => `"${c}"`).join(',')}) VALUES ${values} ON CONFLICT DO NOTHING`,
          params
        );
        inserted += res.changes;
      }
    }
    const targetTotal = Number((await tx.get(`SELECT COUNT(*) AS n FROM "${t.table}"`))?.n ?? 0);
    // representative-record check: first source row must exist in the target with the same id
    let sampleOk = true;
    const pk = t.rows[0]?.id != null ? t.rows[0] : null;
    if (pk) {
      const found = await tx.get(`SELECT id FROM "${t.table}" WHERE id = ?`, [pk.id]);
      sampleOk = Boolean(found);
    }
    rep.push({ table: t.table, source: t.rows.length, inserted, targetTotal, sampleOk });
  }

  // 6. Ensure an admin exists on the target (seedIfEmpty skips everything once
  //    products exist, so a data-copied store would otherwise have no admin).
  const admin = await tx.get(`SELECT id FROM users WHERE role != 'customer' LIMIT 1`);
  if (!admin && (includeUsers || explicit)) {
    console.log('[copy] users copied — admin check skipped (source data includes users)');
  } else if (!admin) {
    await tx.run(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, 'owner', 'Store', 'Owner', ?, ?)`,
      [uuid(), config.adminEmail.toLowerCase(), hashPassword(config.adminPassword), nowIso(), nowIso()]
    );
    console.log(`[copy] admin created on target: ${config.adminEmail.toLowerCase()} (set ADMIN_PASSWORD env before running!)`);
  }

  // Representative-record validation — any failure rolls the WHOLE copy back.
  const broken = rep.filter((r) => !r.sampleOk);
  if (broken.length) {
    throw new Error(`validation failed, rolling back: ${broken.map((r) => r.table).join(', ')}`);
  }
  return rep;
});

console.log('\n[copy] validation report (transaction committed)');
console.log('table                     source  inserted  target  sample');
for (const r of report) {
  console.log(
    `${r.table.padEnd(25)} ${String(r.source).padStart(6)}  ${String(r.inserted).padStart(8)}  ${String(r.targetTotal).padStart(6)}  ${r.sampleOk ? '✓' : '✗'}`
  );
}
await target.close();
source.close();

console.log(`\n[copy] done. ${report.reduce((s, r) => s + r.inserted, 0)} rows inserted (duplicates skipped).`);
console.log('[copy] the SQLite source was NOT modified. Keep it as your rollback snapshot.');
console.log('[copy] next: start the app with the same DATABASE_URL and verify /api/health, then smoke-test the storefront.');
