# Storefront design audit — 2026-10-13

Scope: code inspection + live HTTP checks against the running server (port 4000).
**No browser/screenshot tooling is available in this environment**, so "visual" findings below come from
reading components/CSS and from actual API responses (e.g. the missing-images defect was confirmed by
querying `/api/home` live). The live preview is provided for human visual verification.

## What already works (keep, don't rewrite)

- Design tokens exist in `src/styles.css` `@theme` (paper/ink/accent palette, display + sans fonts, shadows, radii) — brand identity is established (Ojas, warm-white + charcoal + terracotta accent, Instrument Serif/Inter). It matches the requested "premium editorial DTC" direction; refine, don't replace.
- Consistent component kit (`src/components/ui.tsx`): buttons w/ variants+sizes, inputs, badges, price, stars, skeletons, empty states, accordion, modal, status pills.
- Honest-data rules already enforced: verified-only reviews, offers only from real compare-at prices, announcement bar only when configured, simulated payments clearly labelled and **server-gated** (`simulate-success` 404s in live mode).
- Accessibility baseline: global `:focus-visible` outline, `prefers-reduced-motion` kill-switch, aria labels on icon buttons, semantic landmarks, skeletons + empty states everywhere.
- Admin tables already scroll horizontally (`overflow-x-auto` ×10), StatusPill vocabulary covers all order/fulfillment states.

## Defects & gaps found (issue → fix → file)

| # | Issue (severity) | Fix | File(s) |
|---|---|---|---|
| 1 | **`/api/home` returns every product with `images: []`** — hero-adjacent rails ("Editor's picks", "New arrivals", "Current offers") render "Image coming soon" placeholders. Confirmed live: `featured 4 [('Meridian…', 0 images)]`. Root cause: custom `map()` in `/home` + `listProducts` returns `images: undefined`; only `/products` attaches images. (critical, first screen) | Extract `attachPrimaryImages()` helper in catalog lib; rewrite `/home` to use `listProducts` (real min/max prices, ratings, units_sold) + image attachment. | `server/lib/catalog.ts`, `server/routes/storefront.ts` |
| 2 | **No best-sellers section** although real `units_sold` data exists (`sort=popular`). Spec requires it, driven by the actual catalogue. (missing feature) | Add `popular` to `/home` (only products with real sales, `hasSales` filter); render section client-side **only when sales exist** — zero-sales stores don't get a fake "best sellers" rail. | same + `src/pages/Home.tsx` |
| 3 | **Footer social links are dead placeholders** (`https://example.com` ×3), ignoring `BRAND.social`. Violates "no dead buttons / social links where configured". (honesty defect) | Default `BRAND.social` to `[]`; footer renders links only when configured. | `shared/brand.ts`, `src/components/layout.tsx` |
| 4 | **Hardcoded claims in hero & PDP**: "Delivery 3–6 days", "Returns 30 days", badge "New season, same standards" not derived from data. (honesty/maintainability) | Hero stats from real config: free-shipping threshold (settings), returns window (single `BRAND.returnsWindowDays` source), verified-reviews policy. Badge becomes offer-driven ("Real price cuts on N products") or the store tagline. | `shared/brand.ts`, `src/pages/Home.tsx`, `src/pages/ProductPage.tsx` |
| 5 | **Small-text accent fails WCAG AA**: `#c8552b` on white ≈ 4.36:1 (< 4.5) — used for `text-sm`/`text-xs` links ("View all", "Edit", breadcrumbs…). (accessibility) | Sweep small-text `text-accent` → `text-accent-dark` (#a9431f ≈ 6.0:1). Accent stays for icons/large text/fills (≥3:1 OK). | 8 files (Home, ProductPage, Checkout, OrderConfirmation, AccountPages, ContentPages, AdminApp, product.tsx) |
| 6 | **Catalog grid never reaches 4 columns; 1 column below 640px.** Spec: 4 lg-desktop / 3 sm-desktop / 2 mobile / 1 only very narrow. (spec gap) | Shop: `grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4`, tighter mobile gaps, card padding/text scale down on small screens. Home rails & related: `grid-cols-2 lg:grid-cols-4`. Skeletons match. | `src/pages/Shop.tsx`, `Home.tsx`, `ProductPage.tsx`, `src/components/product.tsx` |
| 7 | **Product card has no explicit action & hides multi-variant pricing** (shows min price as if single). (UX clarity) | "From ₹X" when `max > min`; explicit **View product** pill (always visible on touch/small screens, revealed on hover/`focus-within` on desktop); card gets `focus-within` ring. | `src/components/product.tsx` |
| 8 | **PDP: buy button scrolls out of reach on mobile.** (spec: primary action easy to reach) | Sticky bottom purchase bar on `<lg` (price + Add to bag), appears only after the inline CTA scrolls past, dismissed by scrolling back; content gets bottom padding so nothing is obstructed. | `src/pages/ProductPage.tsx` |
| 9 | **No skip link / `main` has no id.** (accessibility) | "Skip to content" link + `id="main"` landmark target. | `src/App.tsx` |
| 10 | **Overlays ignore Escape** (search, cart drawer, modals). (accessibility) | Escape-to-close on SearchOverlay, CartDrawer, Modal. | `layout.tsx`, `ui.tsx` |
| 11 | **Checkout has a non-functional marketing checkbox** (`checked={false}`, onChange only toasts) — a dead control. (honesty defect) | Remove it; consent genuinely lives on register/profile + footer newsletter. | `src/pages/Checkout.tsx` |
| 12 | **Newsletter result always styled as success** (errors shown in green `text-success`). (feedback bug) | Track success/error tone separately. | `src/components/layout.tsx` |
| 13 | **`window.location.href` navigations** (Home "Contact support", PDP "Buy now") cause full page reloads. (perf/consistency) | Router `LinkButton` / `navigate()`. | `Home.tsx`, `ProductPage.tsx` |
| 14 | Offers rail duplicates card markup inline (inconsistent with ProductCard, no stock/rating states). (consistency) | Reuse `ProductCard` inside the offers band. | `Home.tsx` |

## Verified before editing (functionality intact)

- Server boots, `/` 200; `/api/home`, `/api/products` (filters/search), cart → order → simulated payment → webhook flow all pass (21 vitest integration tests green as of last run).
- `simulate-success`/`fail` endpoints 404 unless gateway is in simulated mode → simulation cannot fire in production (spec constraint already satisfied server-side).
- Admin routes server-authorized (403 for customers) — frontend changes below don't touch auth boundaries.
- Product URLs (`/product/:slug`), `usePageMeta` SEO titles/canonicals untouched by this redesign.

## Out of scope (deliberately)

- No framework/dependency changes, no DB schema changes, no API contract removals (only additive: `/home.popular`, `/home` items gain `images`, correct `min/max_price_paise`, `rating`, `units_sold`).
- Admin information architecture unchanged (already consistent via shared tokens); only the contrast sweep + small polish touches it.
- No new sample products to "fill" grids; best-sellers rail stays hidden until real orders exist.
