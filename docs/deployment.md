# Production deployment guide — free tier (Render + Supabase)

Written 2026-10-13. Free-tier facts below were checked against current public sources at that date —
**re-verify limits before you rely on them**, providers change terms. Nothing here promises permanent
free hosting; it documents exactly what the free tiers do.

---

## 1. Chosen architecture (and why)

```
                         ┌────────────────────────────────────────────┐
 Browser ──HTTPS──►      │  Render free web service (Node 22)         │
                         │  Express server (`npm start`)              │
                         │   • serves built SPA (dist/public)         │
                         │   • /api/*  (same origin → no CORS needed) │
                         │   • /api/webhooks/razorpay ◄── Razorpay    │
                         │   • in-process supplier scheduler          │
                         └───────────────┬────────────────────────────┘
                                         │ pg driver, SSL, pool max 5
                                         ▼
                         ┌────────────────────────────────────────────┐
                         │  Supabase free Postgres (Mumbai region)    │
                         │  • direct connection :5432 (or session     │
                         │    pooler if you approach conn limits)     │
                         │  • migrations: postgres schema + RLS policies│
                         └────────────────────────────────────────────┘
```

**Single deployment, not split.** The frontend calls *relative* `/api` routes and the Express server
serves the built SPA, so one Render service hosts everything: no CORS surface, one cold start instead
of two, and the background scheduler lives in the same process. Splitting to Vercel/Cloudflare Pages +
API host adds a second free-tier service, CORS config and `VITE_*` plumbing for zero reliability gain.
`CORS_ORIGINS` exists if you ever do split (see `.env.example`).

Why these providers (free tiers, Oct 2026):

| Option | Verdict |
| --- | --- |
| **Render free web service** | ✅ Chosen. Long-running Node process (Express + scheduler + webhooks work), 750 instance-hrs/month, deploys from GitHub. Caveats: spins down after ~15 min idle → 30–60 s cold start; no free background workers (we don't need them — jobs run in-process); Render's own free Postgres **expires after 30 days** → that's why the DB is on Supabase. |
| Supabase free Postgres | ✅ Chosen for DB. 500 MB, unlimited API requests, no credit card. Caveats: **pauses after 7 days without a DB request** (restore is manual, data preserved); no PITR backups on free (manual `pg_dump` below); 2 projects max. |
| Vercel / Cloudflare Pages (frontend) | Not needed — would split the deployment. Vercel serverless can't host the in-process scheduler or long-lived Express semantics without re-architecture; CF Pages needs worker-compat shims. |
| Fly.io / Railway | No longer offer genuine free tiers. |
| SQLite in production | ❌ Render's filesystem is **ephemeral** — a redeploy wipes `data/app.sqlite`. SQLite stays for local dev/tests only. |

### Free-tier behaviour you must plan around

1. **Cold starts:** first request after idle takes ~30–60 s. Razorpay retries failed webhooks with
   backoff, so a payment webhook arriving at a sleeping service is normally retried successfully —
   but don't rely on it for time-critical flows.
2. **Supabase 7-day pause:** if the Render service is asleep AND nobody touches the DB for 7 days,
   Supabase pauses the project (manual restore in dashboard).
3. **Mitigation for both:** an external uptime pinger (cron-job.org, UptimeRobot — free) hitting
   `https://<your-app>.onrender.com/api/health` every 10–14 minutes keeps the service awake (which
   keeps issuing DB queries, which keeps Supabase active). Honest trade-off: staying awake 24/7
   consumes ~744 of the 750 monthly instance-hours — a 31-day month can exhaust the allowance and
   suspend the service until the 1st. A 15-minute interval is usually enough and safer.
4. **Scheduler:** `SUPPLIER_SCHEDULER_ENABLED=true` is set in `render.yaml` (production defaults it
   OFF). Jobs are idempotent and scan for pending work, so after every wake-up the next tick
   resumes stock/price sync, fulfillment submission and retries where they left off.
5. **No permanence:** this stack is $0 for demos/launch-validation. When real revenue starts, the
   first upgrades worth money are Render Starter (~$7/mo, no sleeping) and Supabase Pro ($25/mi,
   backups + no pausing).

---

## 2. Supabase setup (do this first, ~10 minutes)

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
   - Region: **South Asia (Mumbai)** — closest to your customers and to Render Singapore.
   - Set a strong database password (you'll need it in the connection string). Store it in your
     password manager; never commit it.
2. Wait for provisioning, then **Project Settings → Database → Connection string → URI**.
   Copy the string. It looks like:
   `postgres://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
   (that form is the **session pooler**; the *direct* connection is under "Direct connection" and
   uses `db.<ref>.supabase.co:5432`). URL-encode special characters in the password.
   - **Direct connection** — recommended for this single always-on service.
   - **Session pooler** — use if you ever approach direct-connection limits; fully compatible.
   - **Transaction pooler** — also compatible (the app's RLS identity uses transaction-local
     `set_config`, and every request runs inside an explicit transaction), but prefer session mode.
3. **Do not** use the Supabase JS client, anon key, or service-role key anywhere in this app. The
   Express server is the only DB access layer; it connects with the `postgres` role via
   `DATABASE_URL`. Authorization is enforced server-side (route guards + query scoping, covered by
   the test suite). RLS policies (`migrations/postgres/0002_rls.sql`) are defence-in-depth.
   ⚠️ Nuance: Supabase's `postgres` role *owns* the tables, and Postgres owners bypass RLS unless
   forced. If you want RLS to be a hard boundary too, create a non-owner app role:
   ```sql
   -- run in Supabase SQL editor
   CREATE ROLE ojas_app LOGIN PASSWORD 'strong-password-you-choose';
   GRANT USAGE ON SCHEMA public TO ojas_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ojas_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ojas_app;
   ```
   Then use `postgres://ojas_app:...@...` as `DATABASE_URL` **and** set `DB_MIGRATE_ON_BOOT=false`
   (that role can't run DDL); run migrations once yourself:
   `DATABASE_URL='postgres://postgres.<ref>:...@...' npm run db:migrate`.
   Migrations must always run as a DDL-capable role (`postgres`).

### Initialize the schema

From your local machine (repo checked out, Node ≥ 22.5):

```bash
# create tables, indexes, RLS policies (idempotent, re-runnable)
DATABASE_URL='postgres://...' npm run db:migrate

# EITHER start from the sample store (flagged is_sample, no orders/reviews):
DATABASE_URL='postgres://...' ADMIN_EMAIL='you@yourdomain.com' ADMIN_PASSWORD='strong' npm run db:seed

# OR copy your existing local SQLite data (see §3):
DATABASE_URL='postgres://...' npm run db:copy-to-pg -- --dry-run     # preview
DATABASE_URL='postgres://...' npm run db:copy-to-pg                  # catalogue/content/config
```

---

## 3. Data migration (SQLite → Postgres)

`scripts/migrate-to-postgres.ts` (`npm run db:copy-to-pg`) is the only supported path.

- **Source is never modified or deleted** — opened read-only; keep `data/app.sqlite` as your
  rollback snapshot.
- **Idempotent:** every insert is `ON CONFLICT DO NOTHING`; re-running skips existing rows.
- **Verbatim:** ids, timestamps, prices (paise integers), stock, statuses copy unchanged — the two
  schemas are column-identical (TEXT ids, TEXT ISO timestamps, INTEGER 0/1 booleans in both).
- **FK-safe:** tables are topologically ordered from the source's foreign-key graph; the whole copy
  runs in ONE transaction and rolls back if validation fails.
- **Validation:** per-table source/inserted/target counts + a representative-row existence check,
  printed as a report; non-zero exit on failure.
- **Scoped by default:** only catalogue/content/configuration tables copy (products, variants,
  images, specs, categories, suppliers, supplier mappings, coupons, shipping methods, store
  settings, FAQs, content pages). **Simulated orders/payments never migrate by default** — demo
  payment rows (`order_SIMULATED_*`) must not enter a live store, and copied historical orders must
  not trigger fulfillment (they can't: the supplier pipeline only acts on orders paid through the
  verified live flow, and a pure row-copy enqueues nothing).
  - `--include-users` adds accounts/addresses/carts/wishlists/newsletter/contacts.
  - `--include-orders` (implies users) adds real order history, payments, shipments, reviews,
    returns, logs — only use for genuine data.
  - `--include-data` copies everything; `--tables=a,b` picks explicitly (FK ancestors auto-added);
    `--dry-run` prints the plan without writing.
- If no admin exists on the target afterwards, the script creates one from `ADMIN_EMAIL` /
  `ADMIN_PASSWORD` (set them before running).

---

## 4. Render setup (~10 minutes)

1. Push this repository to GitHub (already done: branch `main` is the production branch).
2. [dashboard.render.com](https://dashboard.render.com) → **New + → Blueprint** → connect the
   GitHub repo → Render reads `render.yaml` → **Apply**.
   (Manual alternative: New + → Web Service → build `npm ci && npm run build`, start `npm start`,
   plan Free, health check `/api/health`.)
3. Render will prompt for every `sync: false` variable — enter them in the dashboard (see §5).
   **Secrets stay in Render's env UI; nothing sensitive is committed.**
4. First deploy runs migrations + seed at boot (`DB_MIGRATE_ON_BOOT=true`), so if you skipped §2's
   manual migrate/seed the service self-initializes (with sample data if `SEED_SAMPLE_DATA=1`).
5. When the deploy goes live, set `PUBLIC_URL` to the exact `https://<service>.onrender.com` URL
   (it drives canonical URLs, sitemap and email links) and redeploy.
6. Auto-deploy: every push to `main` builds and deploys (configured in `render.yaml`).

### Verify the deployment

```bash
npm run verify:deploy -- https://<your-service>.onrender.com
```

Runs read-only smoke checks: health + DB readiness, security headers, SPA shell + SEO injection,
catalogue/bootstrap APIs, robots/sitemap, JSON 404s, admin protection, static assets. Then log in
to `/admin` and walk one test purchase through checkout.

**Payment verification:** with `RAZORPAY_KEY_*` unset the store runs in clearly-labelled simulated
mode (the simulate endpoints are server-gated and return 404 in live mode). After adding real keys,
register the webhook in the Razorpay dashboard → **Webhooks**: URL
`https://<service>.onrender.com/api/webhooks/razorpay`, event `payment.captured`, secret =
`RAZORPAY_WEBHOOK_SECRET`. Do a real ₹1-test-order (Razorpay test mode keys first) and confirm:
signature verification passes, one captured payment row, order `payment_confirmed`. **Until you have
seen that, treat payments as unverified — don't announce live checkout.**

---

## 5. Environment variable checklist

Enter in **Render → your service → Environment** (never in the repo, never in `VITE_*` — the
frontend needs no secrets; it talks same-origin to the API):

| Variable | Required | Value / notes |
| --- | --- | --- |
| `NODE_ENV` | ✅ | `production` (set by render.yaml) |
| `NODE_VERSION` | ✅ | `22` (set by render.yaml; node:sqlite import needs ≥ 22.5) |
| `DATABASE_URL` | ✅ | Supabase connection string (§2). Server-side only. |
| `SESSION_SECRET` | ✅ | `openssl rand -hex 32`. Server **refuses to boot** in production without it. |
| `PUBLIC_URL` | ✅ | `https://<service>.onrender.com` or custom domain |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ✅ | Initial admin (used only when no admin exists) |
| `PG_POOL_MAX` | recommended | `5` (default) |
| `DATABASE_SSL_MODE` | optional | `auto` (default; SSL unless localhost) |
| `DB_MIGRATE_ON_BOOT` | optional | `true`; set `false` with a non-DDL role (§2) |
| `SUPPLIER_SCHEDULER_ENABLED` | ✅ for dropshipping | `true` (set by render.yaml) |
| `SEED_SAMPLE_DATA` | optional | `1` demo catalogue / `0` empty store |
| `CORS_ORIGINS` | only if split | comma-separated frontend origins; empty = same-origin only |
| `EMAIL_PROVIDER` + `RESEND_API_KEY` | for real email | else `console` (logs + Admin → Emails) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | for live payments | unset = simulated mode, clearly labelled |
| `SUPPLIER_HTTP_BEARER_TOKEN` etc. | per real supplier adapter | server-side only |
| Supabase URL / anon key / service-role | **not used** | app never talks to Supabase APIs — SQL only |

Cookies: `httpOnly`, `sameSite=lax`, `secure` automatically in production; `trust proxy` is set for
Render's load balancer. Security headers (nosniff, frame-deny, referrer-policy, permissions-policy,
HSTS in prod) are applied by the app; Render terminates TLS.

---

## 6. Backups, rollback, operations

### Automated GitHub Actions Backups
Because Supabase free has no Point-In-Time-Recovery (PITR) or automated backups:
- Workflow: `.github/workflows/database-backup.yml`
- Schedule: Runs weekly on Sunday at 02:00 UTC, or on-demand via `workflow_dispatch`.
- Tooling: PostgreSQL 16 client (`pg_dump` 16+) from the official PGDG apt repository to ensure full protocol and catalog compatibility with Supabase PostgreSQL 15/16.
- Format: PostgreSQL Custom format (`pg_dump -Fc --compress=9 --no-owner --no-privileges`).
- Encryption: Client-side **Authenticated Encryption with Associated Data (AEAD)** via **AES-256-GCM** using PBKDF2-HMAC-SHA256 (250,000 iterations) with a unique 16-byte random salt and 12-byte nonce (`scripts/crypto-backup.ts`).
- Cryptographic Integrity: Includes a 16-byte GCM authentication tag. **Any corrupt or tampered backup is cryptographically rejected before restoration commences.**
- Retention: 30 days default GitHub artifact retention (customizable up to 90 days on dispatch).
  *Note:* GitHub artifacts are transient retention windows, not permanent compliance archives. For long-term storage, download verified artifacts or mirror them to private object storage (S3/GCS/R2).

#### Required GitHub Secrets (Repository Settings → Secrets and variables → Actions):
1. `DATABASE_URL`: Production Supabase connection string (`postgres://postgres.<ref>:<password>@...:5432/postgres`).
2. `BACKUP_ENCRYPTION_KEY`: Dedicated secret passphrase (min 16 chars; generate with `openssl rand -hex 32`). Never commit this key.
3. `STAGING_DATABASE_URL` *(Optional)*: Non-production database URL for the automated test restoration workflow (`.github/workflows/validate-restore.yml`).

### Step-by-Step Restoration Procedure

> [!CAUTION]
> Never restore directly into production without prior verification in a staging/test environment. Do not run automated drops against your production database.

1. **Download and unpack the artifact:**
   In GitHub Actions → click the backup run → download the `supabase_backup_<TIMESTAMP>` zip containing `supabase_backup_<TIMESTAMP>.dump.enc` and its metadata file.

2. **Verify SHA256 checksum:**
   ```bash
   sha256sum supabase_backup_<TIMESTAMP>.dump.enc
   # Compare against the hash printed in supabase_backup_<TIMESTAMP>.meta.txt
   ```

3. **Decrypt the backup securely into an uncommitted local directory:**
   ```bash
   # Provide your BACKUP_ENCRYPTION_KEY safely without leaking into bash history:
   read -s -p "Enter BACKUP_ENCRYPTION_KEY: " BACKUP_ENCRYPTION_KEY && export BACKUP_ENCRYPTION_KEY && echo
   npx tsx scripts/crypto-backup.ts decrypt supabase_backup_<TIMESTAMP>.dump.enc restore_target.dump
   unset BACKUP_ENCRYPTION_KEY
   ```
   *Note:* If the file has been tampered with or corrupted, the AEAD authentication tag check will fail and delete `restore_target.dump` immediately.

4. **Inspect the archive contents (Table of Contents):**
   ```bash
   pg_restore --list restore_target.dump | head -n 30
   ```

5. **Restore into a fresh staging / test database first:**
   ```bash
   # Target MUST be a scratch/staging database, never production:
   export PGDATABASE='postgres://postgres:<password>@staging-db-host:5432/postgres'
   pg_restore --clean --if-exists --no-owner --no-privileges restore_target.dump
   unset PGDATABASE
   ```

6. **Validate restored schema & row counts:**
   Run the verification query on the restored database:
   ```bash
   psql -c "
     SELECT 'products' as tbl, count(*) FROM products
     UNION ALL SELECT 'categories', count(*) FROM categories
     UNION ALL SELECT 'users', count(*) FROM users
     UNION ALL SELECT 'orders', count(*) FROM orders
     UNION ALL SELECT 'supplier_items', count(*) FROM supplier_items;
   "
   ```
   Ensure critical tables (`products`, `orders`, `users`, `categories`, `supplier_items`) contain expected records.

7. **Clean up decrypted files:**
   ```bash
   shred -u restore_target.dump 2>/dev/null || rm -f restore_target.dump
   ```

8. **Disaster Recovery (Promoting restore if production database is lost):**
   - If the latest backup is corrupt or failed integrity verification: fall back to the preceding week's backup artifact.
   - If Supabase project was deleted/unrecoverable: create a new Supabase project, run migrations via `npm run db:migrate`, and restore data with `pg_restore --no-owner --no-privileges -d "$NEW_DATABASE_URL" restore_target.dump`.
   - Update `DATABASE_URL` in Render Environment Variables and restart the service.

**App rollback:** Render → your service → **Deploys** → ⋯ → *Roll back deploy* (previous image is
retained). Or revert the merge commit on `main` — auto-deploy ships the revert. Database schema
changes are forward-only (migrations are additive `IF NOT EXISTS`); roll the app back, not the schema.

**Config rollback:** Render keeps env-var history per deploy.

**Monitoring:** the pinger from §1 doubles as downtime alerting; `/api/health` returns 503 when the
DB is unreachable (Render surfaces failed health checks). Application errors log to Render logs;
admin-visible trail lives in Admin → Audit log and Admin → Sync runs.

---

## 7. What was verified vs. what needs you

Verified in this repository (automated):
- 21 storefront/API integration tests (sqlite): browse→cart→checkout→payment states→duplicate
  webhook→RBAC→isolation→supplier retry flows.
- 9 deployment-readiness tests: health+DB readiness, security headers, CORS allowlist behaviour,
  404s, admin protection, simulate-gating.
- 5 pg-adapter unit tests (mocked driver): `$n` rewriting, NULL binds, int8/numeric parsers
  (COUNT/SUM come back as numbers, matching sqlite), Date normalisation, tx BEGIN/COMMIT/ROLLBACK,
  transaction-local RLS identity.
- Postgres schema parity: 34 CREATE TABLEs mirror sqlite column-for-column + RLS policies;
  codebase grep confirms no sqlite-only SQL (no strftime/PRAGMA/INSERT OR; LIKE always lowered).

**Not verifiable from this sandbox (no network access to Supabase/Render, no Postgres server):**
- The live Supabase round-trip. Run it yourself in two commands:
  `TEST_DATABASE_URL='postgres://...' npx vitest run tests/postgres.test.ts` (8 real-server tests:
  migrations, RLS identity, catalogue images, numeric aggregates, order journey, isolation,
  duplicate webhooks — non-destructive, but use a scratch DB), then `npm run verify:deploy -- <url>`
  after deploying.
- Razorpay live/test-mode transactions (need your keys + dashboard).
