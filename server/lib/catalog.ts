import { db } from '../db/index.js';
import { b, json } from './util.js';
import type { Product, ProductListItem, ProductVariant, Review, Category, ProductImage, ProductSpec } from '../../shared/types.js';

export function mapVariant(row: any): ProductVariant {
  return {
    id: row.id,
    product_id: row.product_id,
    sku: row.sku,
    title: row.title,
    options: json(row.options_json, {}),
    price_paise: row.price_paise ?? null,
    compare_at_price_paise: row.compare_at_price_paise ?? null,
    stock_qty: row.stock_qty,
    low_stock_threshold: row.low_stock_threshold,
    is_active: b(row.is_active),
    supplier_id: row.supplier_id ?? null,
    supplier_variant_ref: row.supplier_variant_ref ?? null,
  };
}

export function effectivePrice(product: { base_price_paise: number; compare_at_price_paise: number | null }, variant: ProductVariant | null | undefined) {
  return {
    price: variant?.price_paise ?? product.base_price_paise,
    compareAt: variant?.compare_at_price_paise ?? product.compare_at_price_paise,
  };
}

export function mapProduct(row: any): Product {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    brand: row.brand,
    tagline: row.tagline,
    description_md: row.description_md,
    highlights: json<string[]>(row.highlights_json, []),
    category_id: row.category_id,
    status: row.status,
    base_price_paise: Number(row.base_price_paise),
    compare_at_price_paise: row.compare_at_price_paise == null ? null : Number(row.compare_at_price_paise),
    currency: row.currency,
    tax_rate_bps: row.tax_rate_bps,
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    is_sample: b(row.is_sample),
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    rating: row.rating_avg != null ? { average: Number(row.rating_avg), count: Number(row.rating_count) } : null,
    units_sold: Number(row.units_sold ?? 0),
  };
}

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug,
         r.rating_avg, r.rating_count, s.units_sold
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN (
    SELECT product_id, AVG(rating * 1.0) AS rating_avg, COUNT(*) AS rating_count
    FROM reviews WHERE status = 'published' GROUP BY product_id
  ) r ON r.product_id = p.id
  LEFT JOIN (
    SELECT oi.product_id, SUM(oi.qty) AS units_sold FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status NOT IN ('cancelled','refunded') GROUP BY oi.product_id
  ) s ON s.product_id = p.id`;

export async function getProductBySlug(slug: string, includeInactive = false): Promise<Product | null> {
  const row = await db().get(`${PRODUCT_SELECT} WHERE p.slug = ? ${includeInactive ? '' : "AND p.status = 'active'"}`, [slug]);
  if (!row) return null;
  const product = mapProduct(row);
  product.category = row.category_id ? { id: row.category_id, slug: row.category_slug, name: row.category_name } as Category : null;
  product.images = (await db().query(`SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id`, [product.id])) as ProductImage[];
  product.variants = (
    await db().query(`SELECT * FROM product_variants WHERE product_id = ? ORDER BY title, sku`, [product.id])
  ).map(mapVariant);
  product.specs = (await db().query(`SELECT * FROM product_specs WHERE product_id = ? ORDER BY sort_order, id`, [product.id])) as ProductSpec[];
  return product;
}

export async function getProductById(id: string): Promise<Product | null> {
  const row = await db().get(`${PRODUCT_SELECT} WHERE p.id = ?`, [id]);
  if (!row) return null;
  const product = mapProduct(row);
  product.images = (await db().query(`SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id`, [product.id])) as ProductImage[];
  product.variants = (await db().query(`SELECT * FROM product_variants WHERE product_id = ? ORDER BY title, sku`, [product.id])).map(mapVariant);
  product.specs = (await db().query(`SELECT * FROM product_specs WHERE product_id = ? ORDER BY sort_order, id`, [product.id])) as ProductSpec[];
  return product;
}

export interface ListFilters {
  category?: string;
  q?: string;
  min?: number;
  max?: number;
  inStock?: boolean;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'popular' | 'rating' | 'featured' | 'offer';
  page?: number;
  pageSize?: number;
  status?: string;
  /** Only products with an editorial featured_rank (home "Editor's picks"). */
  featuredOnly?: boolean;
  /** Only products with a genuine compare-at price above the selling price. */
  onOffer?: boolean;
  /** Only products with real sales (units_sold > 0) — honest best-sellers. */
  hasSales?: boolean;
}

export async function listProducts(f: ListFilters): Promise<{ items: ProductListItem[]; total: number; page: number; pageSize: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  where.push(`p.status = ?`);
  params.push(f.status ?? 'active');
  if (f.category) {
    where.push(`c.slug = ?`);
    params.push(f.category);
  }
  if (f.q) {
    where.push(`LOWER(p.search_text) LIKE ?`);
    params.push(`%${f.q.toLowerCase()}%`);
  }
  if (f.inStock) where.push(`stock.total_stock > 0`);
  if (f.featuredOnly) where.push(`p.featured_rank IS NOT NULL`);
  if (f.onOffer) where.push(`p.compare_at_price_paise IS NOT NULL AND p.compare_at_price_paise > p.base_price_paise`);
  if (f.hasSales) where.push(`COALESCE(s.units_sold, 0) > 0`);

  const order =
    f.sort === 'price_asc'
      ? `price_agg.min_price ASC, p.created_at DESC`
      : f.sort === 'price_desc'
        ? `price_agg.min_price DESC, p.created_at DESC`
        : f.sort === 'popular'
          ? `COALESCE(s.units_sold, 0) DESC, p.created_at DESC`
          : f.sort === 'featured'
            ? `p.featured_rank ASC, p.published_at DESC`
            : f.sort === 'offer'
              ? `(p.compare_at_price_paise - p.base_price_paise) DESC, p.published_at DESC`
              : f.sort === 'rating'
                ? `COALESCE(r.rating_avg, 0) DESC, COALESCE(r.rating_count,0) DESC, p.created_at DESC`
                : `p.published_at DESC, p.created_at DESC`;

  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, f.pageSize ?? 12));

  const sql = `
    SELECT p.*, c.name AS category_name, c.slug AS category_slug, r.rating_avg, r.rating_count, s.units_sold,
           price_agg.min_price AS min_price_paise, price_agg.max_price AS max_price_paise,
           COALESCE(stock.total_stock, 0) AS total_stock
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN (SELECT product_id, AVG(rating*1.0) rating_avg, COUNT(*) rating_count FROM reviews WHERE status='published' GROUP BY product_id) r ON r.product_id = p.id
    LEFT JOIN (SELECT oi.product_id, SUM(oi.qty) units_sold FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status NOT IN ('cancelled','refunded') GROUP BY oi.product_id) s ON s.product_id = p.id
    LEFT JOIN (SELECT product_id, MIN(COALESCE(price_paise, (SELECT base_price_paise FROM products pp WHERE pp.id = product_variants.product_id))) AS min_price,
                      MAX(COALESCE(price_paise, (SELECT base_price_paise FROM products pp WHERE pp.id = product_variants.product_id))) AS max_price
               FROM product_variants WHERE is_active = 1 GROUP BY product_id) price_agg ON price_agg.product_id = p.id
    LEFT JOIN (SELECT product_id, SUM(stock_qty) total_stock FROM product_variants WHERE is_active = 1 GROUP BY product_id) stock ON stock.product_id = p.id
    WHERE ${where.join(' AND ')}
    ${f.min != null ? `AND price_agg.min_price >= ${Number(f.min)} ` : ''}${f.max != null ? `AND price_agg.min_price <= ${Number(f.max)} ` : ''}
    ORDER BY ${order}
    LIMIT ? OFFSET ?`;
  params.push(pageSize, (page - 1) * pageSize);

  const rows = await db().query(sql, params);

  // NOTE: keep joins in sync with the main query — `where` may reference c/price_agg/stock/r/s.
  const countSql = `
    SELECT COUNT(*) AS n FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN (SELECT product_id, AVG(rating*1.0) rating_avg, COUNT(*) rating_count FROM reviews WHERE status='published' GROUP BY product_id) r ON r.product_id = p.id
    LEFT JOIN (SELECT oi.product_id, SUM(oi.qty) units_sold FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status NOT IN ('cancelled','refunded') GROUP BY oi.product_id) s ON s.product_id = p.id
    LEFT JOIN (SELECT product_id, MIN(COALESCE(price_paise, (SELECT base_price_paise FROM products pp WHERE pp.id = product_variants.product_id))) AS min_price
               FROM product_variants WHERE is_active = 1 GROUP BY product_id) price_agg ON price_agg.product_id = p.id
    LEFT JOIN (SELECT product_id, SUM(stock_qty) total_stock FROM product_variants WHERE is_active = 1 GROUP BY product_id) stock ON stock.product_id = p.id
    WHERE ${where.join(' AND ')}
    ${f.min != null ? `AND price_agg.min_price >= ${Number(f.min)} ` : ''}${f.max != null ? `AND price_agg.min_price <= ${Number(f.max)} ` : ''}`;
  const countRow = await db().get(countSql, params.slice(0, params.length - 2));

  return {
    items: rows.map((row) => ({
      ...mapProduct(row),
      category: row.category_id ? ({ id: row.category_id, slug: row.category_slug, name: row.category_name } as Category) : null,
      images: undefined,
      min_price_paise: Number(row.min_price_paise ?? row.base_price_paise),
      max_price_paise: Number(row.max_price_paise ?? row.base_price_paise),
      total_stock: Number(row.total_stock),
    })),
    total: Number(countRow?.n ?? 0),
    page,
    pageSize,
  };
}

/** Batch-attach the primary product image to list items (one query, first image by sort_order). */
export async function attachPrimaryImages<T extends { id: string }>(items: T[]): Promise<(T & { images: { id: string; url: string; alt_text: string }[] })[]> {
  if (!items.length) return items.map((i) => ({ ...i, images: [] }));
  const ids = items.map((i) => i.id);
  const rows = await db().query(
    `SELECT id, product_id, url, alt_text FROM product_images WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY sort_order`,
    ids
  );
  const byProduct = new Map<string, { id: string; url: string; alt_text: string }[]>();
  for (const img of rows) {
    const list = byProduct.get(img.product_id) ?? [];
    if (list.length < 1) list.push({ id: img.id, url: img.url, alt_text: img.alt_text });
    byProduct.set(img.product_id, list);
  }
  return items.map((i) => ({ ...i, images: byProduct.get(i.id) ?? [] }));
}

export async function listCategories(includeInactive = false): Promise<Category[]> {
  const rows = await db().query(
    `SELECT * FROM categories ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order, name`
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    image_url: r.image_url,
    sort_order: r.sort_order,
    is_active: b(r.is_active),
  }));
}

export async function publishedReviews(productId: string): Promise<Review[]> {
  const rows = await db().query(
    `SELECT * FROM reviews WHERE product_id = ? AND status = 'published' ORDER BY created_at DESC`,
    [productId]
  );
  return rows.map((r) => ({
    id: r.id,
    product_id: r.product_id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    author_name: r.author_name,
    is_verified_purchase: b(r.is_verified_purchase),
    status: r.status,
    created_at: r.created_at,
  }));
}

export async function relatedProducts(productId: string, categoryId: string | null, limit = 4): Promise<ProductListItem[]> {
  const rows = await db().query(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug, r.rating_avg, r.rating_count, s.units_sold,
            COALESCE(stock.total_stock,0) AS total_stock,
            COALESCE(price_agg.min_price, p.base_price_paise) AS min_price_paise,
            COALESCE(price_agg.max_price, p.base_price_paise) AS max_price_paise
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN (SELECT product_id, AVG(rating*1.0) rating_avg, COUNT(*) rating_count FROM reviews WHERE status='published' GROUP BY product_id) r ON r.product_id = p.id
     LEFT JOIN (SELECT oi.product_id, SUM(oi.qty) units_sold FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status NOT IN ('cancelled','refunded') GROUP BY oi.product_id) s ON s.product_id = p.id
     LEFT JOIN (SELECT product_id, MIN(COALESCE(price_paise, (SELECT base_price_paise FROM products pp WHERE pp.id = product_variants.product_id))) AS min_price,
                       MAX(COALESCE(price_paise, (SELECT base_price_paise FROM products pp WHERE pp.id = product_variants.product_id))) AS max_price
                FROM product_variants WHERE is_active = 1 GROUP BY product_id) price_agg ON price_agg.product_id = p.id
     LEFT JOIN (SELECT product_id, SUM(stock_qty) total_stock FROM product_variants WHERE is_active=1 GROUP BY product_id) stock ON stock.product_id = p.id
     WHERE p.status = 'active' AND p.id != ? AND (? IS NULL OR p.category_id = ?)
     ORDER BY p.published_at DESC LIMIT ?`,
    [productId, categoryId, categoryId, limit]
  );
  const items = rows.map((row) => ({
    ...mapProduct(row),
    category: row.category_id ? ({ id: row.category_id, slug: row.category_slug, name: row.category_name } as Category) : null,
    images: undefined,
    min_price_paise: Number(row.min_price_paise),
    max_price_paise: Number(row.max_price_paise),
    total_stock: Number(row.total_stock),
  }));
  return attachPrimaryImages(items);
}
