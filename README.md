# Ojas — premium dropshipping storefront + admin (India-first)

A complete, working e-commerce application: React + TypeScript storefront, Express API, supplier integration layer, and a role-protected admin dashboard. It boots in a clearly-labelled **simulated mode** when credentials are missing — nothing ever pretends an integration is live.

> **Sample data policy:** the seeded catalogue (7 products, 4 categories, 1 mock supplier, policy/FAQ pages) is flagged `is_sample` and labeled in the admin UI. Reviews and orders are **never** seeded. Set `SEED_SAMPLE_DATA=0` to start with an empty store. There are no fake reviews, testimonials, stock timers, or sales counters anywhere in the product.

---

## Quick start

```bash
npm install
cp .env.example .env        # everything optional — sane dev defaults
npm run dev                 # API on :4000 + Vite dev server (proxied)
```

Production-style run (single server on port 4000, serves the built client):

```bash
npm run build               # vite build + server tsc
npm start                   # node dist/server/server/index.js
```

On first boot the server runs migrations and seeds the sample store.

**Admin login:** `owner@example.com` / `ChangeMe123!` — change via `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars (seed only creates the admin if none exists). Admin lives at `/admin`.

### Useful scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API (tsx watch) + Vite concurrently |
| `npm run build` / `npm start` | Production build / run |
| `npm test` | Integration test suite (vitest) — boots a real server on an ephemeral port against a throwaway SQLite DB |
| `npm run typecheck` | Both tsconfigs (client + server) |
| `npm run db:migrate` / `db:seed` / `db:reset` | Schema / seed / wipe local SQLite |
| `npm run jobs:run` | One-shot supplier job tick (stock, prices, fulfillment retries, tracking) |

---

## Environment variables

All optional in development; see `.env.example` for the annotated list.

- **Core:** `PORT`, `PUBLIC_URL`, `NODE_ENV`
- **Database:** `DATABASE_URL` (empty → embedded SQLite at `SQLITE_PATH`; set a `postgres://` URL for production — Postgres migrations live in `migrations/postgres/`)
- **Auth:** `SESSION_SECRET` (**required in production**, server refuses to boot without it), `SESSION_TTL_HOURS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`
- **Payments (Razorpay):** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- **Email:** `EMAIL_PROVIDER=console|resend`, `EMAIL_FROM`, `RESEND_API_KEY`
- **Suppliers:** `SUPPLIER_SCHEDULER_ENABLED`, `SUPPLIER_SCHEDULER_INTERVAL_MS`; real adapter credentials come from env only (e.g. `SUPPLIER_HTTP_BEARER_TOKEN`)
- **Analytics:** `VITE_GA4_MEASUREMENT_ID`, `VITE_META_PIXEL_ID` (off unless set *and* visitor consents — first-party event logging is always on)
- **Store:** `STORE_CURRENCY`, `SEED_SAMPLE_DATA`

---

## Payments (Razorpay)

- **Simulated mode (default, no keys):** checkout clearly says payments are simulated; `/api/payments/:id/prepare` returns a mock provider order, and the UI offers explicit *Simulate success / Simulate failure* buttons so the full state machine (`payment_pending → payment_confirmed / failed → refundable`) is testable end-to-end.
- **Live mode (keys set):** server-side order creation, `verifyPayment` with HMAC signature verification, and webhook handling with `x-razorpay-signature` verification. Raw card data is never touched or stored — only provider ids, method, amount, status.
- **Idempotency:** one payment row per gateway order (duplicate webhooks/replays update, never insert); order creation is idempotent per `idempotencyKey`; stock is reserved in the same transaction.
- **COD:** gated by store settings (`cod_enabled`, min/max order value) — when unavailable the checkout shows the honest reason.

**Known limitation (deliberate):** in live mode the storefront does not yet inject `checkout.razorpay.com/v1/checkout.js`; the checkout sidebar shows a warning that the hosted Razorpay modal still needs to be wired. The server side (order creation, verification, webhooks) is complete.

---

## Supplier integration layer

Modular adapters behind one interface (`server/integrations/suppliers/`): catalog import, SKU/variant mapping, price + stock sync, paid-order fulfillment with idempotency keys, tracking sync, retry-with-backoff and per-run logs. Credentials live server-side only.

- The bundled **mock supplier** simulates latency, stock overrides, and injectable failures (`config.failNextFulfillment`) so the failure path is testable without a real vendor.
- 5 supplier catalog items are intentionally **unmapped** to demonstrate the admin mapping UI (`/admin` → Suppliers → Map products).
- To add a real supplier: implement the adapter interface using their **official/authorized API** and register it. The scheduler (60s tick) runs stock/price sync, fulfillment submission for paid orders, retries, and tracking updates; every run is visible in `/admin` → Sync runs.

---

## Security & privacy

- Zod validation on every mutating endpoint; parameterized SQL everywhere.
- Session cookies (httpOnly, sameSite) — roles: `customer`, `staff`, `owner`; admin routes require staff+, with audit logs for admin mutations.
- Customer data isolation: customers only ever see their own orders/addresses (verified by tests); public order tracking requires order number **plus** matching email/phone.
- Rate limiting on auth, password reset, contact, newsletter, and webhook-adjacent endpoints.
- Reviews require a **delivered** order (verified-purchase only); no review, the product page shows no rating rather than an invented one.
- Privacy-conscious analytics: first-party events only; external pixels off by default and consent-gated.

## SEO & accessibility

- Server-rendered meta shell: unique title/description/canonical/OG per route, `Product`/`Offer` JSON-LD (accurate data only — `aggregateRating` appears solely when verified reviews exist), `sitemap.xml`, `robots.txt` (disallows `/admin`).
- Semantic HTML, keyboard-navigable menus/modals, visible focus states, labeled forms with inline errors, lazy images, honest empty/loading/error states.

---

## Branding

Everything is centralized for easy rebranding:

- `shared/brand.ts` — store name, tagline, contact info
- `src/styles.css` — design tokens (paper `#faf9f6`, ink `#17171a`, accent `#c8552b`, Instrument Serif + Inter)
- `public/favicon.svg`, `index.html`
- Settings (currency, COD, free-shipping threshold, coupons) are editable in `/admin` → Settings.

Policy pages (shipping, returns, privacy, terms, cancellation) ship as **editable templates** — business-specific numbers and legal-review sections are clearly flagged in the content. Edit them in `/admin` → Pages. They are not legal advice.

---

## Tests

`npm test` runs 21 integration tests against a real booted server (ephemeral port, temp SQLite DB):

- catalogue browsing, search, filters, sorting, variants, stock limits
- cart math, coupon discount caps, free-shipping threshold, invalid coupon
- checkout validation errors, idempotent order creation, stock reservation, COD gating
- payment success/failure, **duplicate webhook absorption** (single captured payment)
- RBAC (customer/anonymous → 403/401 on admin), customer-to-customer isolation, tracking contact check
- verified-purchase review gating
- supplier stock sync, fulfillment failure → retry → submitted, tracking sync → shipped with events
- policy pages, contact form, sitemap/robots, login rate limiting

---

## Project layout

```
src/            React storefront (pages, store, components) + lazy-loaded admin SPA
server/         Express API: routes, db (sqlite|pg adapters), lib, jobs
server/integrations/  payments (razorpay), email, suppliers (adapters)
shared/         types, money helpers, brand config (used by both sides)
migrations/     sqlite/ and postgres/ schema
scripts/        seed / migrate / reset / run-jobs
tests/          vitest integration suite (own temp DB)
public/media/   product imagery
```

## Production checklist

1. Set `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUBLIC_URL`.
2. Set `DATABASE_URL` (Postgres) and run `npm run db:migrate && npm run db:seed`.
3. Add Razorpay keys + webhook secret; register the webhook URL `POST /api/webhooks/razorpay` (event: `payment.captured`) in the Razorpay dashboard.
4. Configure `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` (otherwise emails only log).
5. Replace mock supplier with a real adapter and its credentials.
6. `SEED_SAMPLE_DATA=0` for a clean store; rewrite the flagged policy templates; have a lawyer review them.
