-- Sales-CRM schema (SQLite runtime dialect).
-- Booleans are INTEGER 0/1 in both dialects; timestamps are ISO-8601 TEXT.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','support','manager','owner')),
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS addresses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Home',
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'IN',
  is_default_shipping INTEGER NOT NULL DEFAULT 0 CHECK (is_default_shipping IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  brand TEXT,
  tagline TEXT,
  description_md TEXT NOT NULL DEFAULT '',
  highlights_json TEXT NOT NULL DEFAULT '[]',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  base_price_paise INTEGER NOT NULL CHECK (base_price_paise >= 0),
  compare_at_price_paise INTEGER CHECK (compare_at_price_paise IS NULL OR compare_at_price_paise >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  tax_rate_bps INTEGER NOT NULL DEFAULT 0,
  meta_title TEXT,
  meta_description TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  featured_rank INTEGER,
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0,1)),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, status);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  adapter_type TEXT NOT NULL CHECK (adapter_type IN ('mock','http_json')),
  config_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  supports_fulfillment INTEGER NOT NULL DEFAULT 0 CHECK (supports_fulfillment IN (0,1)),
  supports_tracking INTEGER NOT NULL DEFAULT 0 CHECK (supports_tracking IN (0,1)),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '{}',
  price_paise INTEGER CHECK (price_paise IS NULL OR price_paise >= 0),
  compare_at_price_paise INTEGER,
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 2,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_variant_ref TEXT,
  cost_paise INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER
);
CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id);

CREATE TABLE IF NOT EXISTS product_specs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_specs_product ON product_specs(product_id);

CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  guest_key TEXT UNIQUE,
  email TEXT,
  coupon_code TEXT,
  abandoned_email_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id);

CREATE TABLE IF NOT EXISTS cart_items (
  id TEXT PRIMARY KEY,
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_snapshot_paise INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  UNIQUE (cart_id, variant_id)
);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);

CREATE TABLE IF NOT EXISTS wishlist_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('percent','fixed','free_shipping')),
  value INTEGER NOT NULL DEFAULT 0,
  min_subtotal_paise INTEGER NOT NULL DEFAULT 0,
  max_discount_paise INTEGER,
  starts_at TEXT,
  ends_at TEXT,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shipping_methods (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_paise INTEGER NOT NULL DEFAULT 0,
  free_over_paise INTEGER,
  min_days INTEGER NOT NULL DEFAULT 2,
  max_days INTEGER NOT NULL DEFAULT 6,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  cod_available INTEGER NOT NULL DEFAULT 0 CHECK (cod_available IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'placed',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled',
  payment_provider TEXT,
  payment_method TEXT,
  currency TEXT NOT NULL DEFAULT 'INR',
  subtotal_paise INTEGER NOT NULL,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  shipping_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL,
  coupon_code TEXT,
  shipping_method_id TEXT,
  shipping_method_name TEXT NOT NULL DEFAULT '',
  shipping_address_json TEXT NOT NULL,
  billing_address_json TEXT,
  estimated_min_days INTEGER,
  estimated_max_days INTEGER,
  cod INTEGER NOT NULL DEFAULT 0 CHECK (cod IN (0,1)),
  notes TEXT,
  cancel_reason TEXT,
  is_guest INTEGER NOT NULL DEFAULT 0 CHECK (is_guest IN (0,1)),
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0,1)),
  idempotency_key TEXT UNIQUE,
  placed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_placed ON orders(placed_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  product_slug TEXT,
  title TEXT NOT NULL,
  variant_title TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  unit_price_paise INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  total_paise INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_status_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('system','admin','customer','supplier')),
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ose_order ON order_status_events(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_order_id TEXT,
  provider_payment_id TEXT UNIQUE,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','authorized','captured','failed','refunded')),
  amount_paise INTEGER NOT NULL,
  captured_at TEXT,
  failure_reason TEXT,
  raw_json TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  supplier_order_id TEXT,
  carrier TEXT,
  service TEXT,
  tracking_number TEXT,
  status TEXT,
  shipped_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);

CREATE TABLE IF NOT EXISTS tracking_events (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  description TEXT,
  location TEXT,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('supplier','carrier','manual')),
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_te_shipment ON tracking_events(shipment_id);

CREATE TABLE IF NOT EXISTS supplier_products (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  external_sku TEXT,
  title TEXT NOT NULL DEFAULT '',
  price_paise INTEGER,
  stock_qty INTEGER,
  status TEXT,
  raw_json TEXT,
  store_variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (supplier_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_sp_store_variant ON supplier_products(store_variant_id);

CREATE TABLE IF NOT EXISTS supplier_orders (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  external_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TEXT,
  payload_json TEXT,
  response_json TEXT,
  submitted_at TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_so_order ON supplier_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_so_retry ON supplier_orders(status, next_retry_at);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL,
  supplier_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  items_processed INTEGER NOT NULL DEFAULT 0,
  items_failed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs ON sync_runs(job, started_at);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT,
  body TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  is_verified_purchase INTEGER NOT NULL DEFAULT 0 CHECK (is_verified_purchase IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, status);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id TEXT REFERENCES order_items(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  refund_amount_paise INTEGER,
  refund_method TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  consented_at TEXT NOT NULL,
  unsubscribed_at TEXT,
  source TEXT NOT NULL DEFAULT 'footer'
);

CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  session_id TEXT,
  name TEXT NOT NULL,
  path TEXT,
  props_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name ON analytics_events(name, created_at);

CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider TEXT NOT NULL,
  error TEXT,
  body_text TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS faqs (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  answer_md TEXT NOT NULL,
  category TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);

CREATE TABLE IF NOT EXISTS content_pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  requires_legal_review INTEGER NOT NULL DEFAULT 0 CHECK (requires_legal_review IN (0,1)),
  updated_at TEXT NOT NULL
);
