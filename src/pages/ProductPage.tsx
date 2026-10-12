import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '@/lib/api';
import { useCart } from '@/store/cart';
import { useBootstrap } from '@/store/bootstrap';
import { toast } from '@/store/toast';
import { formatMoney, usePageMeta, deliveryWindow } from '@/lib/format';
import { Gallery, ProductCard, ReviewSection } from '@/components/product';
import { Badge, Button, Price, QtyStepper, Skeleton, StatusPill } from '@/components/ui';
import type { Product, ProductListItem, Review, ShippingMethod } from '@shared/types';
import { mdToHtmlClient } from '@/lib/md';
import { BRAND } from '@shared/brand';
import clsx from 'clsx';

interface ProductResponse {
  product: Product;
  reviews: Review[];
  related: ProductListItem[];
  settings: { reviews_require_purchase: boolean; tax_inclusive: boolean; default_tax_bps: number };
}

export default function ProductPage() {
  const { slug } = useParams();
  const [data, setData] = useState<ProductResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState<ShippingMethod | null>(null);
  const addToCart = useCart((s) => s.add);
  const navigate = useNavigate();
  const store = useBootstrap((s) => s.store);

  useEffect(() => {
    setData(null);
    setError(null);
    setVariantId(null);
    setQty(1);
    api
      .get<ProductResponse>(`/products/${slug}`)
      .then((d) => {
        setData(d);
        const firstAvailable = d.product.variants?.find((v) => v.is_active && v.stock_qty > 0) ?? d.product.variants?.[0] ?? null;
        setVariantId(firstAvailable?.id ?? null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load product'));
    api.get<{ methods: ShippingMethod[] }>('/shipping-methods').then((d) => setMethod(d.methods[0] ?? null));
  }, [slug]);

  const product = data?.product;
  const variant = product?.variants?.find((v) => v.id === variantId) ?? null;
  usePageMeta(
    product ? `${product.title} — ${store?.name ?? 'Ojas'}` : 'Product — Ojas',
    product?.meta_description ?? product?.tagline ?? undefined
  );

  const optionNames = useMemo(() => {
    if (!product?.variants) return [];
    const names = new Set<string>();
    product.variants.forEach((v) => Object.keys(v.options).forEach((k) => names.add(k)));
    return [...names];
  }, [product]);

  // Mobile sticky buy bar: appears once the inline CTA scrolls out of view (above the viewport).
  const ctaRef = useRef<HTMLDivElement>(null);
  const [showBuyBar, setShowBuyBar] = useState(false);
  useEffect(() => {
    const el = ctaRef.current;
    if (!el) {
      setShowBuyBar(false);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setShowBuyBar(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    }, { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [product?.id]);

  if (error) {
    return (
      <div className="container-page py-24 text-center">
        <h1 className="font-display text-4xl">Product not found</h1>
        <p className="mt-2 text-muted">{error}</p>
        <Link to="/shop" className="mt-6 inline-block text-accent-dark underline underline-offset-4">Back to shop</Link>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container-page grid gap-10 py-10 lg:grid-cols-2">
        <Skeleton className="aspect-[4/3] rounded-2xl" />
        <div className="space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-6 w-1/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-12 w-48" /></div>
      </div>
    );
  }

  const price = variant?.price_paise ?? product.base_price_paise;
  const compareAt = variant?.compare_at_price_paise ?? product.compare_at_price_paise;
  const stock = variant?.stock_qty ?? product.variants?.reduce((s, v) => s + v.stock_qty, 0) ?? 0;
  const inStock = (variant?.stock_qty ?? stock) > 0;
  const gstPercent = product.tax_rate_bps / 100;

  const buy = async (buyNow: boolean) => {
    if (!variantId) return;
    try {
      await addToCart(variantId, qty);
      if (buyNow) {
        useCart.getState().setDrawer(false);
        navigate('/checkout');
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not add to bag');
    }
  };

  return (
    <div className="container-page py-10 pb-24 lg:pb-10">
      <nav className="text-xs text-muted" aria-label="Breadcrumb">
        <Link to="/" className="hover:underline">Home</Link> <span aria-hidden="true">/</span>{' '}
        {product.category && <><Link to={`/shop/${product.category.slug}`} className="hover:underline">{product.category.name}</Link> <span aria-hidden="true">/</span> </>}
        <span className="text-ink">{product.title}</span>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <Gallery product={product} />

        <div>
          {product.brand && <p className="text-xs font-semibold uppercase tracking-widest text-muted">{product.brand}</p>}
          <h1 className="mt-2 font-display text-4xl sm:text-5xl leading-tight">{product.title}</h1>
          {product.tagline && <p className="mt-2 text-lg text-muted">{product.tagline}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Price paise={price} compareAt={compareAt} size="lg" />
            {product.rating && product.rating.count > 0 && (
              <a href="#reviews" className="text-sm text-muted underline underline-offset-4">
                {product.rating.average.toFixed(1)} ★ · {product.rating.count} verified review{product.rating.count > 1 ? 's' : ''}
              </a>
            )}
          </div>
          {data?.settings.tax_inclusive && (
            <p className="mt-1 text-xs text-muted">Inclusive of GST{gstPercent ? ` (${gstPercent}%)` : ''}. No hidden charges at checkout.</p>
          )}

          {/* Variant selectors */}
          {optionNames.map((name) => (
            <div key={name} className="mt-6">
              <h2 className="text-sm font-medium text-ink-soft">{name}: <span className="font-semibold text-ink">{variant?.options[name] ?? '—'}</span></h2>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={name}>
                {product.variants?.filter((v, i, arr) => arr.findIndex((x) => x.options[name] === v.options[name]) === i).map((v) => {
                  const disabled = v.stock_qty <= 0 || !v.is_active;
                  return (
                    <button
                      key={v.id}
                      role="radio"
                      aria-checked={variantId === v.id}
                      disabled={disabled}
                      onClick={() => setVariantId(v.id)}
                      className={clsx(
                        'rounded-full border px-4 py-2 text-sm transition-colors',
                        variantId === v.id ? 'border-ink bg-ink text-paper' : 'border-line bg-card hover:border-ink/50',
                        disabled && 'opacity-40 line-through cursor-not-allowed'
                      )}
                    >
                      {v.options[name] || v.title || v.sku}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Availability */}
          <div className="mt-6 flex items-center gap-2 text-sm">
            {inStock ? (
              (variant?.stock_qty ?? stock) <= (variant?.low_stock_threshold ?? 3) ? (
                <><StatusPill status="processing" /><span className="text-muted">Only {(variant?.stock_qty ?? stock)} left in stock</span></>
              ) : (
                <><StatusPill status="active" /><span className="text-muted">In stock and ready to ship</span></>
              )
            ) : (
              <><StatusPill status="cancelled" /><span className="text-muted">Out of stock — join the waitlist via support</span></>
            )}
          </div>

          {/* Qty + CTAs */}
          <div ref={ctaRef} className="mt-6 flex flex-wrap items-center gap-3">
            <QtyStepper value={qty} onChange={setQty} max={Math.max(1, variant?.stock_qty ?? 99)} />
            <Button variant="primary" size="lg" className="flex-1 min-w-40" disabled={!inStock} onClick={() => buy(false)}>Add to bag</Button>
            <Button variant="accent" size="lg" disabled={!inStock} onClick={() => buy(true)}>Buy now</Button>
          </div>

          {/* Delivery estimate */}
          {method && (
            <div className="mt-8 rounded-2xl border border-line bg-card p-5 text-sm space-y-2">
              <div className="flex justify-between gap-4">
                <span className="text-muted">Delivery ({method.name})</span>
                <span className="font-medium">{method.price_paise === 0 ? 'Free' : formatMoney(method.price_paise)}{store?.free_shipping_over_paise != null && <> · free over {formatMoney(store.free_shipping_over_paise)}</>}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">Estimated arrival</span>
                <span className="font-medium">{deliveryWindow(method.min_days, method.max_days)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">Returns</span>
                <Link to="/pages/returns-refund-policy" className="font-medium underline underline-offset-4">{BRAND.returnsWindowDays}-day easy returns</Link>
              </div>
            </div>
          )}

          {/* Highlights */}
          {product.highlights.length > 0 && (
            <ul className="mt-6 space-y-2">
              {product.highlights.map((h) => (
                <li key={h} className="flex items-start gap-2.5 text-sm text-ink-soft">
                  <svg className="mt-0.5 size-4 shrink-0 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  {h}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Description + specs */}
      <div className="mt-16 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <section aria-labelledby="desc-heading">
          <h2 id="desc-heading" className="font-display text-3xl">About this product</h2>
          <div className="prose-store mt-4" dangerouslySetInnerHTML={{ __html: mdToHtmlClient(product.description_md) }} />
        </section>
        {product.specs && product.specs.length > 0 && (
          <section aria-labelledby="specs-heading">
            <h2 id="specs-heading" className="font-display text-3xl">Specifications</h2>
            <dl className="mt-4 divide-y divide-line-soft rounded-2xl border border-line bg-card">
              {product.specs.map((s) => (
                <div key={s.id} className="flex justify-between gap-6 px-5 py-3 text-sm">
                  <dt className="text-muted">{s.label}</dt>
                  <dd className="font-medium text-right">{s.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 rounded-2xl bg-line-soft p-4 text-xs text-muted leading-relaxed">
              <p><Badge tone="neutral">Sourcing</Badge></p>
              <p className="mt-2">This product is fulfilled through our verified supplier network. Stock levels and delivery estimates shown here are synced from live supplier data — if anything changes after you order, we tell you immediately and offer a full refund.</p>
            </div>
          </section>
        )}
      </div>

      <div id="reviews">
        <ReviewSection product={product} reviews={data?.reviews ?? []} policy={data?.settings.reviews_require_purchase ? 'Reviews are published only from customers with a delivered order for this product.' : 'Reviews are moderated before publishing.'} />
      </div>

      {data?.related.length ? (
        <section className="mt-20" aria-labelledby="related-heading">
          <h2 id="related-heading" className="font-display text-3xl">You may also like</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
            {data.related.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      ) : null}

      {/* Sticky purchase bar (mobile only) — keeps the primary action in reach without covering content */}
      {product && (
        <div
          className={clsx(
            'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 px-4 py-3 backdrop-blur transition-transform duration-200 lg:hidden',
            showBuyBar ? 'translate-y-0' : 'pointer-events-none translate-y-full'
          )}
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          aria-hidden={!showBuyBar}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-muted">{product.title}{variant ? ` · ${Object.values(variant.options).join(' / ') || variant.title}` : ''}</p>
              <Price paise={price} compareAt={compareAt} size="sm" />
            </div>
            <Button variant="accent" disabled={!inStock || !variantId} tabIndex={showBuyBar ? 0 : -1} onClick={() => buy(false)}>
              {inStock ? 'Add to bag' : 'Out of stock'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
