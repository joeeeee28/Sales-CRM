import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '@/lib/api';
import { useBootstrap } from '@/store/bootstrap';
import { usePageMeta, formatMoney, formatDate } from '@/lib/format';
import { ProductCard } from '@/components/product';
import { Accordion, Badge, LinkButton, Skeleton, Stars } from '@/components/ui';
import type { Category, ProductListItem } from '@shared/types';
import { BRAND } from '@shared/brand';
import { mdToHtmlClient } from '@/lib/md';

interface HomeData {
  categories: Category[];
  featured: ProductListItem[];
  newArrivals: ProductListItem[];
  offers: ProductListItem[];
  popular: ProductListItem[];
  faqs: { id: string; question: string; answer_md: string }[];
  reviews: { id: string; rating: number; title: string | null; body: string; author_name: string; product_title: string; product_slug: string; created_at: string }[];
  reviewPolicy: string;
}

export default function Home() {
  const store = useBootstrap((s) => s.store);
  const [data, setData] = useState<HomeData | null>(null);
  usePageMeta(`${store?.name ?? 'Ojas'} — ${store?.tagline ?? 'Considered goods for everyday life'}`, 'Premium everyday essentials across audio, home, carry and wellness. Transparent pricing, honest delivery windows, verified reviews and 30-day returns.');

  useEffect(() => {
    api.get<HomeData>('/home').then(setData).catch(() => setData(null));
  }, []);

  const offers = data?.offers ?? [];
  const freeOver = store?.free_shipping_over_paise ?? null;

  return (
    <>
      {/* Hero */}
      <section className="container-page pt-8 pb-4 sm:pt-12">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="animate-fade-up">
            {offers.length > 0 ? (
              <Badge tone="accent">Real price cuts on {offers.length} product{offers.length === 1 ? '' : 's'} — no countdowns</Badge>
            ) : (
              <Badge tone="neutral">{store?.tagline ?? 'Considered goods for everyday life'}</Badge>
            )}
            <h1 className="mt-4 font-display text-[2.7rem] sm:text-6xl lg:text-7xl leading-[1.02] tracking-tight">
              Everyday objects,<br />chosen carefully.
            </h1>
            <p className="mt-5 max-w-md text-lg text-muted leading-relaxed">
              A small catalogue of audio, home and carry essentials — sourced transparently, priced honestly, and shipped with delivery windows we can actually keep.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton to="/shop" variant="accent" size="lg">Shop now</LinkButton>
              <LinkButton to="/pages/about" variant="secondary" size="lg">How we work</LinkButton>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-line pt-6 text-sm">
              <div>
                <dt className="text-muted">Shipping</dt>
                <dd className="font-semibold mt-0.5">{freeOver != null ? <>Free over {formatMoney(freeOver)}</> : 'Calculated at checkout'}</dd>
              </div>
              <div>
                <dt className="text-muted">Returns</dt>
                <dd className="font-semibold mt-0.5">{BRAND.returnsWindowDays} days</dd>
              </div>
              <div>
                <dt className="text-muted">Reviews</dt>
                <dd className="font-semibold mt-0.5">Verified only</dd>
              </div>
            </dl>
          </div>
          <div className="relative">
            <img
              src="/media/hero/editorial-desk.jpg"
              alt="A calm sunlit home workspace with headphones, a brass lamp, a stoneware mug and folded linen on an oak desk"
              className="aspect-[4/3] w-full rounded-3xl object-cover shadow-card"
              fetchPriority="high"
            />
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="container-page mt-16" aria-labelledby="cat-heading">
        <div className="flex items-end justify-between">
          <h2 id="cat-heading" className="font-display text-3xl sm:text-4xl">Shop by category</h2>
          <Link to="/shop" className="text-sm font-medium text-accent-dark hover:underline underline-offset-4">View all</Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {(data?.categories ?? []).map((c) => (
            <Link key={c.id} to={`/shop/${c.slug}`} className="group relative overflow-hidden rounded-2xl border border-line-soft bg-card shadow-card focus-within:ring-2 focus-within:ring-ink/50">
              {c.image_url ? (
                <img src={c.image_url} alt="" className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" loading="lazy" />
              ) : (
                <div className="aspect-[4/3] bg-line-soft" />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/70 to-transparent p-3 sm:p-4 pt-8 sm:pt-10">
                <h3 className="font-display text-lg sm:text-xl text-paper">{c.name}</h3>
              </div>
            </Link>
          ))}
          {!data && [1, 2, 3, 4].map((i) => <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />)}
        </div>
      </section>

      {/* Best sellers — rendered only when real orders exist (units sold > 0) */}
      {data && data.popular.length > 0 && (
        <section className="container-page mt-20" aria-labelledby="popular-heading">
          <div className="flex items-end justify-between">
            <div>
              <h2 id="popular-heading" className="font-display text-3xl sm:text-4xl">Best sellers</h2>
              <p className="mt-1 text-sm text-muted">Ranked by units sold from real, non-cancelled orders.</p>
            </div>
            <Link to="/shop?sort=popular" className="text-sm font-medium text-accent-dark hover:underline underline-offset-4">See ranking</Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
            {data.popular.slice(0, 4).map((p, i) => <ProductCard key={p.id} product={p} eager={i < 2} />)}
          </div>
        </section>
      )}

      {/* Featured */}
      <section className="container-page mt-20" aria-labelledby="featured-heading">
        <h2 id="featured-heading" className="font-display text-3xl sm:text-4xl">Editor's picks</h2>
        <p className="mt-1 text-sm text-muted">A short list we stand behind — curated by our team, not by an algorithm.</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {(data?.featured ?? []).map((p, i) => <ProductCard key={p.id} product={p} eager={i < 2} />)}
          {!data && [1, 2, 3, 4].map((i) => <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />)}
        </div>
      </section>

      {/* Genuine offers — rendered only when real compare-at prices exist */}
      {data && offers.length > 0 && (
        <section className="container-page mt-20" aria-labelledby="offers-heading">
          <div className="rounded-3xl bg-ink text-paper p-6 sm:p-12">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="offers-heading" className="font-display text-3xl sm:text-4xl">Current offers</h2>
                <p className="mt-1 text-sm text-paper/70">Real price reductions on selected products — no invented countdowns.</p>
              </div>
              <LinkButton to="/shop" variant="secondary" size="sm">Shop all products</LinkButton>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
              {offers.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          </div>
        </section>
      )}

      {/* New arrivals */}
      <section className="container-page mt-20" aria-labelledby="new-heading">
        <div className="flex items-end justify-between">
          <h2 id="new-heading" className="font-display text-3xl sm:text-4xl">New arrivals</h2>
          <Link to="/shop?sort=newest" className="text-sm font-medium text-accent-dark hover:underline underline-offset-4">See what's new</Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {(data?.newArrivals ?? []).slice(0, 4).map((p) => <ProductCard key={p.id} product={p} />)}
          {!data && [1, 2, 3, 4].map((i) => <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />)}
        </div>
      </section>

      {/* Why us */}
      <section className="container-page mt-24" aria-labelledby="why-heading">
        <h2 id="why-heading" className="font-display text-3xl sm:text-4xl">Why shop with us</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            { t: 'Transparent sourcing', d: 'Where a partner supplier ships directly to you, we say so on the product page — and we stay your single point of accountability.', i: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z' },
            { t: 'Honest stock & delivery', d: 'Availability and delivery windows come from live supplier and logistics data. If we cannot keep a promise, we cancel and refund in full.', i: 'M8 3v4m8-4v4M4 9h16M6 5h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2z' },
            { t: 'Verified reviews only', d: 'Reviews unlock after a delivered order. No incentives, no seeding, no edits — which is why some products show none yet.', i: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
          ].map((f) => (
            <div key={f.t} className="rounded-2xl border border-line-soft bg-card p-6 shadow-card">
              <svg className="size-7 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d={f.i} strokeLinecap="round" strokeLinejoin="round" /></svg>
              <h3 className="mt-4 font-semibold text-lg">{f.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Verified reviews */}
      <section className="container-page mt-24" aria-labelledby="social-heading">
        <h2 id="social-heading" className="font-display text-3xl sm:text-4xl">From verified customers</h2>
        <p className="mt-1 text-sm text-muted">{data?.reviewPolicy ?? 'Reviews are published only from customers with a delivered order.'}</p>
        {data && data.reviews.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-line bg-card/60 p-8 text-center">
            <p className="font-medium">No verified reviews published yet</p>
            <p className="mt-1 text-sm text-muted">As a young store we would rather show an honest empty space than invent praise. Reviews appear here the moment delivered customers write them.</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {(data?.reviews ?? []).slice(0, 3).map((r) => (
              <blockquote key={r.id} className="rounded-2xl border border-line-soft bg-card p-6 shadow-card">
                <Stars rating={r.rating} />
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">“{r.body}”</p>
                <footer className="mt-4 text-xs text-muted">
                  <span className="font-medium text-ink">{r.author_name}</span> · <Link className="hover:underline" to={`/product/${r.product_slug}`}>{r.product_title}</Link> · {formatDate(r.created_at)}
                </footer>
              </blockquote>
            ))}
          </div>
        )}
      </section>

      {/* FAQ */}
      <section className="container-page mt-24 grid gap-10 lg:grid-cols-[1fr_1.4fr]" aria-labelledby="faq-heading">
        <div>
          <h2 id="faq-heading" className="font-display text-3xl sm:text-4xl">Questions, answered</h2>
          <p className="mt-2 text-sm text-muted">Everything else lives on the <Link className="text-accent-dark underline underline-offset-4" to="/faq">FAQ page</Link>.</p>
          <LinkButton to="/contact" variant="secondary" className="mt-5">Contact support</LinkButton>
        </div>
        <Accordion items={(data?.faqs ?? []).slice(0, 5).map((f) => ({ id: f.id, q: f.question, a: <div dangerouslySetInnerHTML={{ __html: mdToHtmlClient(f.answer_md) }} /> }))} />
      </section>
    </>
  );
}
