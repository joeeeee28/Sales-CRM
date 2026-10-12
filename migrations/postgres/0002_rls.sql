-- Row-Level Security (PostgreSQL / Supabase).
--
-- The API enforces authorisation at the query layer in BOTH dialects (so
-- behaviour is identical on SQLite). These policies are defence-in-depth:
-- even a bug in application code cannot leak another customer's rows when
-- running on Postgres, because the per-request identity is pushed into the
-- connection via `set_config('app.user_id', ...)` / `set_config('app.role', ...)`.

CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')
$$;

CREATE OR REPLACE FUNCTION current_app_role() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), 'anonymous')
$$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT current_app_role() IN ('support', 'manager', 'owner')
$$;

CREATE OR REPLACE FUNCTION is_self(uid TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT uid IS NOT NULL AND uid = current_app_user_id()
$$;

-- Catalogue: public read, admin write ---------------------------------------
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_read ON products;
CREATE POLICY products_read ON products FOR SELECT USING (status = 'active' OR is_admin());
DROP POLICY IF EXISTS products_write ON products;
CREATE POLICY products_write ON products FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS variants_read ON product_variants;
CREATE POLICY variants_read ON product_variants FOR SELECT USING (true);
DROP POLICY IF EXISTS variants_write ON product_variants;
CREATE POLICY variants_write ON product_variants FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS images_read ON product_images;
CREATE POLICY images_read ON product_images FOR SELECT USING (true);
DROP POLICY IF EXISTS images_write ON product_images;
CREATE POLICY images_write ON product_images FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE product_specs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS specs_read ON product_specs;
CREATE POLICY specs_read ON product_specs FOR SELECT USING (true);
DROP POLICY IF EXISTS specs_write ON product_specs;
CREATE POLICY specs_write ON product_specs FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categories_read ON categories;
CREATE POLICY categories_read ON categories FOR SELECT USING (true);
DROP POLICY IF EXISTS categories_write ON categories;
CREATE POLICY categories_write ON categories FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reviews_read ON reviews;
CREATE POLICY reviews_read ON reviews FOR SELECT USING (status = 'published' OR is_self(user_id) OR is_admin());
DROP POLICY IF EXISTS reviews_insert ON reviews;
CREATE POLICY reviews_insert ON reviews FOR INSERT WITH CHECK (is_self(user_id));
DROP POLICY IF EXISTS reviews_write ON reviews;
CREATE POLICY reviews_write ON reviews FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- Customer-private data ------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users FOR SELECT USING (is_self(id) OR is_admin());
DROP POLICY IF EXISTS users_update ON users;
CREATE POLICY users_update ON users FOR UPDATE USING (is_self(id) OR is_admin()) WITH CHECK (is_self(id) OR is_admin());

ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS addresses_self ON addresses;
CREATE POLICY addresses_self ON addresses FOR ALL USING (is_self(user_id) OR is_admin()) WITH CHECK (is_self(user_id) OR is_admin());

ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS carts_self ON carts;
CREATE POLICY carts_self ON carts FOR ALL USING (is_self(user_id) OR is_admin()) WITH CHECK (is_self(user_id) OR is_admin());

ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cart_items_self ON cart_items;
CREATE POLICY cart_items_self ON cart_items FOR ALL
  USING (EXISTS (SELECT 1 FROM carts c WHERE c.id = cart_id AND (is_self(c.user_id) OR is_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM carts c WHERE c.id = cart_id AND (is_self(c.user_id) OR is_admin())));

ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wishlist_self ON wishlist_items;
CREATE POLICY wishlist_self ON wishlist_items FOR ALL USING (is_self(user_id) OR is_admin()) WITH CHECK (is_self(user_id) OR is_admin());

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_self ON orders;
CREATE POLICY orders_self ON orders FOR SELECT USING (is_self(user_id) OR is_admin());
DROP POLICY IF EXISTS orders_update ON orders;
CREATE POLICY orders_update ON orders FOR UPDATE USING (is_self(user_id) OR is_admin()) WITH CHECK (is_self(user_id) OR is_admin());

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_self ON order_items;
CREATE POLICY order_items_self ON order_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND (is_self(o.user_id) OR is_admin())));

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_self ON payments;
CREATE POLICY payments_self ON payments FOR SELECT
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND (is_self(o.user_id) OR is_admin())) OR is_admin());

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipments_self ON shipments;
CREATE POLICY shipments_self ON shipments FOR SELECT
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND (is_self(o.user_id) OR is_admin())) OR is_admin());

ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tracking_events_self ON tracking_events;
CREATE POLICY tracking_events_self ON tracking_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM shipments s JOIN orders o ON o.id = s.order_id
                 WHERE s.id = shipment_id AND (is_self(o.user_id) OR is_admin())));

ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS returns_self ON returns;
CREATE POLICY returns_self ON returns FOR ALL USING (is_self(user_id) OR is_admin()) WITH CHECK (is_self(user_id) OR is_admin());

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sessions_self ON sessions;
CREATE POLICY sessions_self ON sessions FOR ALL USING (is_self(user_id)) WITH CHECK (is_self(user_id));

-- Operational tables: admin only --------------------------------------------
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suppliers_admin ON suppliers;
CREATE POLICY suppliers_admin ON suppliers FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE supplier_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_products_admin ON supplier_products;
CREATE POLICY supplier_products_admin ON supplier_products FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_orders_admin ON supplier_orders;
CREATE POLICY supplier_orders_admin ON supplier_orders FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_runs_admin ON sync_runs;
CREATE POLICY sync_runs_admin ON sync_runs FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coupons_admin ON coupons;
CREATE POLICY coupons_admin ON coupons FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE shipping_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipping_methods_read ON shipping_methods;
CREATE POLICY shipping_methods_read ON shipping_methods FOR SELECT USING (true);
DROP POLICY IF EXISTS shipping_methods_write ON shipping_methods;
CREATE POLICY shipping_methods_write ON shipping_methods FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settings_read ON store_settings;
CREATE POLICY settings_read ON store_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS settings_write ON store_settings;
CREATE POLICY settings_write ON store_settings FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_admin ON audit_logs;
CREATE POLICY audit_admin ON audit_logs FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_log_admin ON email_log;
CREATE POLICY email_log_admin ON email_log FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_admin ON contact_messages;
CREATE POLICY contact_admin ON contact_messages FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS newsletter_admin ON newsletter_subscribers;
CREATE POLICY newsletter_admin ON newsletter_subscribers FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS faqs_read ON faqs;
CREATE POLICY faqs_read ON faqs FOR SELECT USING (true);
DROP POLICY IF EXISTS faqs_write ON faqs;
CREATE POLICY faqs_write ON faqs FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE content_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pages_read ON content_pages;
CREATE POLICY pages_read ON content_pages FOR SELECT USING (true);
DROP POLICY IF EXISTS pages_write ON content_pages;
CREATE POLICY pages_write ON content_pages FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analytics_insert ON analytics_events;
CREATE POLICY analytics_insert ON analytics_events FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS analytics_admin ON analytics_events;
CREATE POLICY analytics_admin ON analytics_events FOR SELECT USING (is_admin());

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prt_admin ON password_reset_tokens;
CREATE POLICY prt_admin ON password_reset_tokens FOR ALL USING (is_admin()) WITH CHECK (is_admin());
