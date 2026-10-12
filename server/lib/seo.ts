import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from '../config.js';
import { db } from '../db/index.js';
import { getSettings } from './settings.js';
import type { PageMeta } from '../../shared/types.js';

let shellCache: { mtime: number; html: string } | null = null;

export function readShell(): string | null {
  const file = path.join(paths.publicDir, 'index.html');
  if (!fs.existsSync(file)) return null;
  const mtime = fs.statSync(file).mtimeMs;
  if (!shellCache || shellCache.mtime !== mtime) {
    shellCache = { mtime, html: fs.readFileSync(file, 'utf8') };
  }
  return shellCache.html;
}

export function injectMeta(shell: string, meta: PageMeta): string {
  const jsonld = meta.jsonld ? JSON.stringify(meta.jsonld) : '{}';
  return shell
    .replaceAll('__SEO_TITLE__', escapeAttr(meta.title))
    .replaceAll('__SEO_DESCRIPTION__', escapeAttr(meta.description))
    .replaceAll('__SEO_CANONICAL__', escapeAttr(meta.canonical))
    .replaceAll('__SEO_OG_IMAGE__', escapeAttr(meta.og_image ?? `${config.publicUrl}/media/hero/editorial-desk.jpg`))
    .replaceAll('__SEO_JSONLD__', jsonld.replace(/</g, '\\u003c'))
    .replaceAll('__SEO_ROBOTS__', escapeAttr(meta.robots ?? 'index,follow'));
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STATIC_META: Record<string, { title: string; description: string }> = {
  '/': { title: 'Ojas — Considered goods for everyday life', description: 'Premium everyday essentials: audio, home, carry and wellness. Transparent pricing, honest delivery windows and 30-day returns.' },
  '/shop': { title: 'Shop all products — Ojas', description: 'Browse the full Ojas catalogue. Filter by category, price, availability and rating.' },
  '/cart': { title: 'Your bag — Ojas', description: 'Review your bag, apply a code and check out securely.' },
  '/checkout': { title: 'Checkout — Ojas', description: 'Secure checkout with UPI, cards, netbanking and wallets.' },
  '/track': { title: 'Track your order — Ojas', description: 'Enter your order number and email or phone to see real tracking status.' },
  '/about': { title: 'About us — Ojas', description: 'Who we are, how we source, and what we promise.' },
  '/contact': { title: 'Contact us — Ojas', description: 'Questions about an order, a product or a return? We reply within one business day.' },
  '/faq': { title: 'FAQ — Ojas', description: 'Shipping, returns, refunds, payments and product questions answered.' },
  '/account': { title: 'Your account — Ojas', description: 'Sign in to view orders, addresses and wishlist.' },
};

export async function metaForPath(pathname: string): Promise<PageMeta> {
  const settings = await getSettings();
  const canonical = `${config.publicUrl}${pathname === '/' ? '/' : pathname}`;
  const base = STATIC_META[pathname] ?? STATIC_META['/']!;

  const productMatch = /^\/product\/([^/]+)$/.exec(pathname);
  if (productMatch) {
    const row = await db().get(
      `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.slug = ? AND p.status = 'active'`,
      [productMatch[1]]
    );
    if (row) {
      const image = await db().get(`SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1`, [row.id]);
      const rating = await db().get(`SELECT AVG(rating*1.0) AS avg, COUNT(*) AS n FROM reviews WHERE product_id = ? AND status = 'published'`, [row.id]);
      const offers = {
        '@type': 'Offer',
        priceCurrency: row.currency,
        price: (Number(row.base_price_paise) / 100).toFixed(2),
        availability: (await db().get(`SELECT COALESCE(SUM(stock_qty),0) AS s FROM product_variants WHERE product_id = ? AND is_active = 1`, [row.id]))?.s > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
        url: canonical,
      };
      const jsonld: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: row.title,
        description: row.meta_description ?? row.tagline ?? '',
        image: image ? `${config.publicUrl}${image.url}` : undefined,
        sku: row.slug,
        brand: row.brand ? { '@type': 'Brand', name: row.brand } : undefined,
        offers,
      };
      // Structured data only carries a rating when verified reviews exist.
      if (rating && Number(rating.n) > 0) {
        jsonld.aggregateRating = { '@type': 'AggregateRating', ratingValue: Number(rating.avg).toFixed(2), reviewCount: Number(rating.n) };
      }
      return {
        title: row.meta_title ?? `${row.title} — ${settings.store_name}`,
        description: row.meta_description ?? row.tagline ?? `${row.title} at ${settings.store_name}.`,
        canonical,
        og_image: image ? `${config.publicUrl}${image.url}` : undefined,
        jsonld,
      };
    }
    return { title: `Product not found — ${settings.store_name}`, description: base.description, canonical, robots: 'noindex' };
  }

  const categoryMatch = /^\/shop\/([^/]+)$/.exec(pathname);
  if (categoryMatch) {
    const row = await db().get(`SELECT * FROM categories WHERE slug = ?`, [categoryMatch[1]]);
    if (row) {
      return {
        title: `${row.name} — ${settings.store_name}`,
        description: row.description ?? `Shop ${row.name} at ${settings.store_name}.`,
        canonical,
        og_image: row.image_url ? `${config.publicUrl}${row.image_url}` : undefined,
      };
    }
  }

  const pageMatch = /^\/pages\/([^/]+)$/.exec(pathname);
  if (pageMatch) {
    const row = await db().get(`SELECT * FROM content_pages WHERE slug = ?`, [pageMatch[1]]);
    if (row) return { title: `${row.title} — ${settings.store_name}`, description: `${row.title} at ${settings.store_name}.`, canonical };
  }

  return { title: `${base.title}`, description: base.description, canonical };
}

export async function buildSitemap(): Promise<string> {
  const urls: { loc: string; lastmod?: string; priority: string }[] = [
    { loc: '/', priority: '1.0' },
    { loc: '/shop', priority: '0.9' },
    { loc: '/about', priority: '0.5' },
    { loc: '/contact', priority: '0.5' },
    { loc: '/faq', priority: '0.5' },
    { loc: '/track', priority: '0.4' },
  ];
  const products = await db().query(`SELECT slug, updated_at FROM products WHERE status = 'active'`);
  for (const p of products) urls.push({ loc: `/product/${p.slug}`, lastmod: p.updated_at, priority: '0.8' });
  const categories = await db().query(`SELECT slug FROM categories WHERE is_active = 1`);
  for (const c of categories) urls.push({ loc: `/shop/${c.slug}`, priority: '0.7' });
  const pages = await db().query(`SELECT slug FROM content_pages`);
  for (const p of pages) urls.push({ loc: `/pages/${p.slug}`, priority: '0.3' });

  const body = urls
    .map((u) => `  <url><loc>${config.publicUrl}${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ''}<priority>${u.priority}</priority></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /account\nDisallow: /checkout\nDisallow: /cart\nDisallow: /api/\n\nSitemap: ${config.publicUrl}/sitemap.xml\n`;
}
