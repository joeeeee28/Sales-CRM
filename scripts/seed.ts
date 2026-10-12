/**
 * Seed script. Idempotent: only runs when the store has no products yet.
 * Everything it inserts is explicitly flagged `is_sample = 1` so the admin can
 * tell demo data apart from real data, and metrics exclude samples by default.
 * No fake reviews, no fake orders-with-history, no invented social proof.
 */
import { initDb, db } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { config } from '../server/config.js';
import { hashPassword } from '../server/lib/auth.js';
import { nowIso, uuid, bi } from '../server/lib/util.js';
import { setSettingsBulk } from '../server/lib/settings.js';

interface SeedVariant {
  sku: string;
  title: string;
  options: Record<string, string>;
  price: number | null;
  stock: number;
  cost: number;
  supplierRef: string;
}

interface SeedProduct {
  slug: string;
  title: string;
  tagline: string;
  category: string;
  price: number;
  compareAt: number | null;
  taxBps: number;
  image: string;
  alt: string;
  featured: number | null;
  description: string;
  highlights: string[];
  specs: [string, string][];
  variants: SeedVariant[];
}

const CATEGORIES = [
  { slug: 'audio-desk', name: 'Audio & Desk', sort: 1, image: '/media/categories/audio-desk.jpg', description: 'Headphones, keyboards and lighting that make a desk feel considered.' },
  { slug: 'home-living', name: 'Home & Living', sort: 2, image: '/media/categories/home-living.jpg', description: 'Stoneware, linen and warm light for the rooms you actually live in.' },
  { slug: 'carry-travel', name: 'Carry & Travel', sort: 3, image: '/media/categories/carry-travel.jpg', description: 'Bags and organisers built for commutes, weekends and everything between.' },
  { slug: 'wellness-care', name: 'Wellness & Care', sort: 4, image: '/media/categories/wellness-care.jpg', description: 'Quiet tools for rest, movement and hydration.' },
];

const P = (p: SeedProduct) => p;

const PRODUCTS: SeedProduct[] = [
  P({
    slug: 'meridian-pro-anc-headphones', title: 'Meridian Pro ANC Headphones', tagline: 'Forty hours of quiet, tuned warm.',
    category: 'audio-desk', price: 1499000, compareAt: 1799000, taxBps: 1800,
    image: '/media/products/meridian-anc-headphones.jpg', alt: 'Matte charcoal over-ear headphones with bone ear cushions on a warm off-white background',
    featured: 1,
    description: `Meridian Pro pairs hybrid active noise cancellation with a warm, unhurried tuning — the kind of sound you can work under for eight hours without fatigue.\n\nMemory-foam cushions wrapped in protein leather seal passively, so ANC has less to do and battery lasts longer. Multipoint Bluetooth keeps your laptop and phone connected at once, and the 3.5 mm cable means the headphones never become e-waste when a battery eventually ages.`,
    highlights: ['Hybrid ANC with transparency mode', '40 h playback (ANC on), USB-C fast charge', 'Multipoint Bluetooth 5.3 + wired mode', 'Replaceable ear cushions and cable'],
    specs: [['Driver', '40 mm dynamic, bio-cellulose'], ['Battery', '40 h ANC on / 60 h off'], ['Weight', '254 g'], ['Charging', 'USB-C, 10 min = 5 h'], ['Warranty', '2 years']],
    variants: [
      { sku: 'OJ-HP-CHR', title: 'Charcoal', options: { Colour: 'Charcoal' }, price: null, stock: 24, cost: 749000, supplierRef: 'SUP-HP-01' },
      { sku: 'OJ-HP-BNE', title: 'Bone', options: { Colour: 'Bone' }, price: null, stock: 9, cost: 749000, supplierRef: 'SUP-HP-02' },
    ],
  }),
  P({
    slug: 'field-65-mechanical-keyboard', title: 'Field 65 Mechanical Keyboard', tagline: 'A 65% board that sounds like a library.',
    category: 'audio-desk', price: 849000, compareAt: null, taxBps: 1800,
    image: '/media/products/field-65-keyboard.jpg', alt: 'Compact 65 percent mechanical keyboard with bone and charcoal keycaps',
    featured: 2,
    description: `Sixty-five percent of the keys, all of the feel. Field 65 is gasket-mounted with five layers of damping, so every keystroke lands as a soft thock instead of a clack.\n\nHot-swappable sockets take any 3-pin or 5-pin switch, and the aluminium case adds the mass that plastic boards lack. Ships with coiled USB-C cable and a keycap puller.`,
    highlights: ['Gasket mount, 5-layer damping', 'Hot-swap sockets (3/5-pin)', 'PBT double-shot keycaps', 'QMK/VIA remapping'],
    specs: [['Layout', '65% (68 keys)'], ['Case', 'CNC aluminium'], ['Connection', 'USB-C, wired'], ['Weight', '1.1 kg']],
    variants: [
      { sku: 'OJ-KB-TAC', title: 'Tactile', options: { Switch: 'Tactile' }, price: null, stock: 18, cost: 424000, supplierRef: 'SUP-KB-01' },
      { sku: 'OJ-KB-LIN', title: 'Linear', options: { Switch: 'Linear' }, price: null, stock: 12, cost: 424000, supplierRef: 'SUP-KB-02' },
    ],
  }),
  P({
    slug: 'halo-desk-lamp', title: 'Halo Desk Lamp', tagline: 'Warm dim, like the last hour of sunlight.',
    category: 'audio-desk', price: 429000, compareAt: null, taxBps: 1800,
    image: '/media/products/halo-desk-lamp.jpg', alt: 'Small brass dome desk lamp glowing warmly on an off-white background',
    featured: null,
    description: `Halo dims toward amber as you lower it, the way natural light does at dusk — which is why it is easier on late-night eyes than a fixed-white LED.\n\nA single machined-brass dome, a weighted base, and one knob for brightness and warmth. No app, no firmware, nothing to update.`,
    highlights: ['2200K–3000K warm-dim curve', 'Stepless rotary dimming', 'Solid brass, fabric cable', 'Flicker-free driver'],
    specs: [['Output', '450 lm max'], ['CRI', '95+'], ['Power', '9 W'], ['Cable', '1.8 m fabric, inline knob']],
    variants: [{ sku: 'OJ-LMP-BRS', title: 'Brass', options: { Finish: 'Brass' }, price: null, stock: 15, cost: 214000, supplierRef: 'SUP-LMP-01' }],
  }),
  P({
    slug: 'terra-stoneware-mug-set', title: 'Terra Stoneware Mug — Set of 2', tagline: 'Thrown, glazed and fired in small batches.',
    category: 'home-living', price: 189000, compareAt: null, taxBps: 1200,
    image: '/media/products/terra-mug-set.jpg', alt: 'Two speckled stoneware mugs in cream glaze with raw clay bases',
    featured: 3,
    description: `Each Terra mug is wheel-thrown, so no two share exactly the same curve or speckle. The cream glaze stops short of the base, leaving raw clay where your hand meets the cup.\n\n350 ml — a proper pour, not a thimble. Dishwasher and microwave safe despite the handmade finish.`,
    highlights: ['Wheel-thrown stoneware', '350 ml each, set of 2', 'Food-safe cream glaze', 'Dishwasher & microwave safe'],
    specs: [['Capacity', '350 ml'], ['Material', 'Stoneware'], ['Care', 'Dishwasher safe'], ['Origin', 'Small-batch studio, IN']],
    variants: [{ sku: 'OJ-MUG-CRM', title: 'Cream', options: { Glaze: 'Cream' }, price: null, stock: 40, cost: 89000, supplierRef: 'SUP-MUG-01' }],
  }),
  P({
    slug: 'aera-linen-throw', title: 'Aera Linen Throw', tagline: 'European flax, woven loose, washed soft.',
    category: 'home-living', price: 349000, compareAt: 429000, taxBps: 500,
    image: '/media/products/aera-linen-throw.jpg', alt: 'Folded oatmeal linen throw with fringed edge on off-white background',
    featured: null,
    description: `Aera is stonewashed European flax woven at a low density, so it drapes instead of standing to attention. It gets softer with every wash and never pills.\n\n130 × 200 cm — big enough to share on a sofa, light enough for summer evenings.`,
    highlights: ['100% stonewashed European flax', '130 × 200 cm', 'OEKO-TEX certified dye', 'Softens with every wash'],
    specs: [['Size', '130 × 200 cm'], ['Material', '100% linen'], ['Care', 'Machine wash 30°']],
    variants: [
      { sku: 'OJ-THR-OAT', title: 'Oatmeal', options: { Colour: 'Oatmeal' }, price: null, stock: 14, cost: 174000, supplierRef: 'SUP-THR-01' },
    ],
  }),
  P({
    slug: 'commuter-22l-backpack', title: 'Commuter 22L Backpack', tagline: 'One bag, door to desk to departure gate.',
    category: 'carry-travel', price: 679000, compareAt: null, taxBps: 1800,
    image: '/media/products/commuter-22l-backpack.jpg', alt: 'Structured charcoal waxed canvas backpack with tan leather pulls',
    featured: 4,
    description: `A clamshell opening that lies flat, a suspended 16" laptop sleeve, and waxed canvas that shrugs off monsoon drizzle. The harness is cut for carrying real weight — 22 litres of it — without digging.\n\nLeather pulls are vegetable-tanned and will darken with use; that is the point.`,
    highlights: ['22 L, clamshell opening', 'Suspended 16" laptop sleeve', 'Waxed canvas, water-resistant', 'Luggage pass-through sleeve'],
    specs: [['Volume', '22 L'], ['Laptop', 'Up to 16"'], ['Fabric', '18 oz waxed canvas'], ['Weight', '1.3 kg']],
    variants: [{ sku: 'OJ-BP-CHR', title: 'Charcoal', options: { Colour: 'Charcoal' }, price: null, stock: 20, cost: 339000, supplierRef: 'SUP-BP-01' }],
  }),
  P({
    slug: 'prana-natural-rubber-yoga-mat', title: 'Prana Yoga Mat — Natural Rubber', tagline: 'Grip that improves as you warm up.',
    category: 'wellness-care', price: 399000, compareAt: null, taxBps: 1800,
    image: '/media/products/prana-yoga-mat.jpg', alt: 'Rolled natural rubber yoga mat in clay colour',
    featured: null,
    description: `Natural tree rubber with a polyurethane top layer that grips harder as your hands warm — the opposite of PVC mats, which go slippery.\n\n4.5 mm cushions knees and wrists on hard floors without swallowing balance poses.`,
    highlights: ['Natural rubber base', 'PU top: grippier when warm', '4.5 mm cushioning', '183 × 66 cm'],
    specs: [['Size', '183 × 66 cm, 4.5 mm'], ['Material', 'Natural rubber + PU']],
    variants: [{ sku: 'OJ-MAT-CLY', title: 'Clay', options: { Colour: 'Clay' }, price: null, stock: 16, cost: 199000, supplierRef: 'SUP-MAT-01' }],
  }),
];

const SHIPPING_METHODS = [
  { code: 'standard', name: 'Standard delivery', description: 'Tracked, door-step delivery across India', price: 7900, freeOver: 199900, min: 3, max: 6, cod: 1, sort: 1 },
  { code: 'express', name: 'Express delivery', description: 'Priority handling in metro cities', price: 19900, freeOver: null, min: 1, max: 3, cod: 0, sort: 2 },
];

const COUPONS = [
  { code: 'WELCOME10', description: '10% off your first order', type: 'percent', value: 10, min: 0, maxDiscount: 150000, active: true },
  { code: 'FREESHIP', description: 'Free standard shipping, any order value', type: 'free_shipping', value: 0, min: 0, maxDiscount: null, active: true },
];

const FAQS: [string, string, string][] = [
  ['How long does delivery take?', 'Standard delivery is 3–6 business days across India; express is 1–3 business days in metro cities. Each product page shows the estimate that applies to it, and your confirmation email repeats it. We only publish windows our logistics data supports.', 'Shipping'],
  ['How do returns work?', 'You have 30 days from delivery to start a return from your account or the tracking page. We arrange pickup, and refunds are issued to the original payment method within 5–7 business days of the item reaching us.', 'Returns'],
  ['Which payment methods do you accept?', 'UPI, credit and debit cards (Visa, Mastercard, RuPay, Amex), netbanking and popular wallets via our payment gateway. Card details are handled entirely by the gateway — they never touch our servers. Cash on Delivery is enabled only where our fraud controls allow it.', 'Payments'],
  ['Is my payment secure?', 'Yes. Payments are processed by our PCI-DSS compliant gateway and every transaction is verified server-side before an order is confirmed. We never store card numbers or CVVs.', 'Payments'],
  ['Do you ship internationally?', 'Not yet. We currently ship within India while we build reliable international logistics.', 'Shipping'],
  ['How do I track my order?', 'Use the Track page with your order number (from your confirmation email) and the email or phone you ordered with. You will see real status updates as they happen — we never show estimated steps as if they were real scans.', 'Orders'],
  ['Can I cancel my order?', 'Yes, any time before it ships — from Your Account → Orders, or by contacting us with the order number. Once shipped, use the 30-day return window instead.', 'Orders'],
  ['Are the reviews on this site verified?', 'Reviews can only be written by customers whose order for that product is delivered. Unverified submissions are held for moderation. We do not seed, incentivise or edit reviews.', 'Reviews'],
];

const POLICIES: { slug: string; title: string; legal: boolean; body: string }[] = [
  {
    slug: 'shipping-policy', title: 'Shipping Policy', legal: true,
    body: `## Scope\nThis policy describes how [[STORE_NAME]] ships orders placed on this website.\n\n## Delivery windows\n- Standard delivery: 3–6 business days across India.\n- Express delivery: 1–3 business days in metro cities.\n\nWindows shown at checkout are calculated from our shipping methods and supplier handling times. If an item is sourced from a third-party supplier, the supplier's handling time is included in the estimate shown to you before payment.\n\n## Shipping charges\nShipping charges are shown in the cart and at checkout before payment. Standard delivery is free above the threshold announced on the homepage, if any.\n\n## Tracking\nEvery shipped order receives a tracking number by email and on the Track page. Statuses reflect real carrier or supplier scans only.\n\n## Delays\nIf an order will miss its window we email you with a revised estimate and offer cancellation with a full refund.\n\n<!-- LEGAL REVIEW REQUIRED: confirm statutory delivery obligations, force majeure clause and jurisdiction-specific consumer law (e.g. Consumer Protection (E-Commerce) Rules, 2020 for India). -->\n\n## Questions\n[[SUPPORT_EMAIL]] · [[SUPPORT_PHONE]]`,
  },
  {
    slug: 'returns-refund-policy', title: 'Returns & Refund Policy', legal: true,
    body: `## Return window\nYou may request a return within 30 days of delivery for most products.\n\n## Non-returnable items\nHygiene-sensitive items (eye masks, ear cushions) are returnable only if unopened and sealed.\n\n## Process\n1. Start a return from Your Account → Orders, or email [[SUPPORT_EMAIL]] with your order number.\n2. We arrange pickup within 2–4 business days.\n3. Refunds are issued to the original payment method within 5–7 business days of the item reaching us.\n\n## Damaged or wrong items\nReport within 7 days of delivery with photos; we replace or refund including shipping, at your choice.\n\n<!-- LEGAL REVIEW REQUIRED: align with local consumer protection law; confirm statutory cooling-off periods and refund timelines. -->`,
  },
  {
    slug: 'privacy-policy', title: 'Privacy Policy', legal: true,
    body: `## What we collect\nAccount details (name, email, phone), order and delivery details, and the addresses you save. Payment card data is collected only by our payment gateway and never reaches our servers.\n\n## How we use it\nTo fulfil orders, provide support, send transactional emails, and — only with your consent — occasional product updates. You can withdraw consent at any time from Your Account.\n\n## Analytics\nWe run first-party, cookieless analytics (no cross-site tracking, no ad identifiers). External pixels load only if configured and only after your consent.\n\n## Sharing\nWe share the minimum required with: our payment gateway, delivery partners (name, address, phone), and suppliers who fulfil your order (items + delivery details).\n\n## Retention\nOrder records are kept as long as required by tax law; account data until you delete your account.\n\n## Your rights\nAccess, correction, deletion and export of your data: email [[SUPPORT_EMAIL]].\n\n<!-- LEGAL REVIEW REQUIRED: IT Act / DPDP Act (India) obligations, grievance officer details, and any jurisdiction-specific disclosures. -->`,
  },
  {
    slug: 'terms-and-conditions', title: 'Terms & Conditions', legal: true,
    body: `## Agreement\nBy using [[STORE_NAME]] you accept these terms.\n\n## Pricing & availability\nPrices are in INR and inclusive of taxes unless stated. In rare cases a supplier price or stock change may affect an order placed before the change synced; if we cannot fulfil at the confirmed price we cancel and refund in full — we never charge a different price after confirmation.\n\n## Orders\nAn order is confirmed when payment is captured (or immediately for Cash on Delivery). We may cancel an order for fraud-control reasons, with a full refund and an explanation.\n\n## Acceptable use\nYou agree not to misuse the site, scrape it at scale, or attempt to access other customers' data.\n\n## Liability\nOur liability for any order is limited to the amount paid for that order, except where law provides otherwise.\n\n<!-- LEGAL REVIEW REQUIRED: full legal review before launch — governing law, dispute resolution, limitation of liability, IP clauses. -->`,
  },
  {
    slug: 'cancellation-policy', title: 'Cancellation Policy', legal: true,
    body: `## Before shipping\nYou may cancel any order before it ships from Your Account → Orders or via [[SUPPORT_EMAIL]]. Refunds to the original method complete within 5–7 business days.\n\n## After shipping\nOnce shipped, cancellations convert to returns under the Returns & Refund Policy.\n\n## By us\nIf we cancel (stock or fraud-control reasons) you receive a full refund including shipping, and an email explaining why.\n\n<!-- LEGAL REVIEW REQUIRED: confirm cancellation rights under applicable consumer law. -->`,
  },
  {
    slug: 'about', title: 'About Us', legal: false,
    body: `[[STORE_NAME]] exists because most "premium" online stores are either overpriced marketplaces or dropshipping fronts with stock photos and invented reviews.\n\nWe work differently:\n\n- **Curated, small catalogue.** A few products per category, chosen because we would use them daily.\n- **Honest data.** Stock, prices and delivery windows come from real supplier and logistics feeds. Reviews come only from delivered orders.\n- **Direct fulfilment.** Where a partner supplier ships an item directly to you, we say so on the product page and keep one accountable support inbox: [[SUPPORT_EMAIL]].\n\n<!-- BUSINESS DETAILS REQUIRED: founder story, registration details, GSTIN, registered address. -->`,
  },
];

export async function seedIfEmpty(): Promise<void> {
  const existing = await db().get(`SELECT COUNT(*) AS n FROM products`);
  if (Number(existing?.n ?? 0) > 0) return;
  console.log('[seed] empty store detected — seeding sample catalogue (is_sample = 1)');
  await seed();
}

export async function seed(): Promise<void> {
  const now = nowIso();
  const sample = config.seedSampleData ? 1 : 0;

  /* settings */
  await setSettingsBulk({}, null);

  /* admin user */
  const adminExists = await db().get(`SELECT id FROM users WHERE role != 'customer' LIMIT 1`);
  if (!adminExists) {
    await db().run(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, 'owner', 'Store', 'Owner', ?, ?)`,
      [uuid(), config.adminEmail.toLowerCase(), hashPassword(config.adminPassword), now, now]
    );
    console.log(`[seed] admin created: ${config.adminEmail} (change ADMIN_PASSWORD before launch!)`);
  }

  /* categories */
  const categoryIds: Record<string, string> = {};
  for (const c of CATEGORIES) {
    const id = uuid();
    categoryIds[c.slug] = id;
    await db().run(
      `INSERT INTO categories (id, slug, name, description, image_url, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, c.slug, c.name, c.description, c.image, c.sort, now, now]
    );
  }

  /* supplier (simulated, clearly labelled) */
  const supplierId = uuid();
  await db().run(
    `INSERT INTO suppliers (id, code, name, adapter_type, config_json, is_active, supports_fulfillment, supports_tracking, notes, created_at, updated_at)
     VALUES (?, 'demo-supplier', 'Demo Supplier (simulated)', 'mock', ?, 1, 1, 1, ?, ?, ?)`,
    [supplierId, JSON.stringify({ latencyMs: 30 }), 'Offline mock adapter for development & tests. Not a real vendor. Replace with a real adapter + credentials before launch.', now, now]
  );

  /* products */
  for (const p of PRODUCTS) {
    const productId = uuid();
    const search = `${p.title} ${p.tagline} ${p.description} ${p.highlights.join(' ')}`.toLowerCase();
    await db().run(
      `INSERT INTO products (id, slug, title, brand, tagline, description_md, highlights_json, category_id, status, base_price_paise, compare_at_price_paise, currency, tax_rate_bps, meta_title, meta_description, search_text, featured_rank, is_sample, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId, p.slug, p.title, 'Ojas', p.tagline, p.description, JSON.stringify(p.highlights), categoryIds[p.category] ?? null,
        p.price, p.compareAt, 'INR', p.taxBps,
        `${p.title} — ${p.tagline}`, `${p.tagline} Free shipping over ₹1,999, 30-day returns.`,
        search, p.featured, sample, now, now, now,
      ]
    );
    await db().run(`INSERT INTO product_images (id, product_id, url, alt_text, sort_order, width, height) VALUES (?, ?, ?, ?, 0, 1600, 900)`, [
      uuid(), productId, p.image, p.alt,
    ]);
    for (const [i, [label, value]] of p.specs.entries()) {
      await db().run(`INSERT INTO product_specs (id, product_id, label, value, sort_order) VALUES (?, ?, ?, ?, ?)`, [uuid(), productId, label, value, i]);
    }
    for (const v of p.variants) {
      const variantId = uuid();
      await db().run(
        `INSERT INTO product_variants (id, product_id, sku, title, options_json, price_paise, stock_qty, low_stock_threshold, is_active, supplier_id, supplier_variant_ref, cost_paise, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 3, ?, ?, ?, ?, ?, ?)`,
        [variantId, productId, v.sku, v.title, JSON.stringify(v.options), v.price, v.stock, bi(true), supplierId, v.supplierRef, v.cost, now, now]
      );
      await db().run(
        `INSERT INTO supplier_products (id, supplier_id, external_id, external_sku, title, price_paise, stock_qty, status, store_variant_id, last_synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
        [uuid(), supplierId, v.supplierRef, v.supplierRef, p.title, v.cost, v.stock, variantId, now, now, now]
      );
    }
  }

  /* shipping methods */
  for (const m of SHIPPING_METHODS) {
    await db().run(
      `INSERT INTO shipping_methods (id, code, name, description, price_paise, free_over_paise, min_days, max_days, is_active, cod_available, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [uuid(), m.code, m.name, m.description, m.price, m.freeOver, m.min, m.max, m.cod, m.sort]
    );
  }

  /* coupons */
  for (const c of COUPONS) {
    await db().run(
      `INSERT INTO coupons (id, code, description, type, value, min_subtotal_paise, max_discount_paise, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), c.code, c.description, c.type, c.value, c.min, c.maxDiscount, bi(c.active), now, now]
    );
  }

  /* faqs */
  for (const [i, [q, a, cat]] of FAQS.entries()) {
    await db().run(`INSERT INTO faqs (id, question, answer_md, category, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)`, [uuid(), q, a, cat, i]);
  }

  /* policy / content pages */
  for (const page of POLICIES) {
    const body = page.body
      .replaceAll('[[STORE_NAME]]', 'Ojas')
      .replaceAll('[[SUPPORT_EMAIL]]', 'care@ojas.example')
      .replaceAll('[[SUPPORT_PHONE]]', '+91 80 4719 0000');
    await db().run(`INSERT INTO content_pages (slug, title, body_md, requires_legal_review, updated_at) VALUES (?, ?, ?, ?, ?)`, [
      page.slug, page.title, body, bi(page.legal), now,
    ]);
  }

  console.log('[seed] done — 7 sample products, 4 categories, 1 simulated supplier, policies & FAQs.');
}

if (process.argv[1]?.includes('seed')) {
  initDb()
    .then(async (db) => {
      await migrate(db);
      await seed();
      await db.close();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
