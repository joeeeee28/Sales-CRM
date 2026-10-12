import { useState } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import type { Product, ProductListItem, Review } from '@shared/types';
import { Price, Stars, Badge, Button, Textarea, Field } from './ui';
import { useWishlist } from '@/store/wishlist';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/toast';
import { formatDate } from '@/lib/format';
import { api, ApiError } from '@/lib/api';

export function ProductCard({ product, eager }: { product: ProductListItem; eager?: boolean }) {
  const wishlist = useWishlist();
  const user = useAuth((s) => s.user);
  const inList = wishlist.ids.has(product.id);
  const out = product.total_stock <= 0;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-line-soft bg-card shadow-card transition-shadow hover:shadow-pop">
      <Link to={`/product/${product.slug}`} className="relative block aspect-[4/3] overflow-hidden bg-line-soft" tabIndex={-1} aria-hidden="true">
        {product.images?.[0] ? (
          <img
            src={product.images[0].url}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted text-sm">Image coming soon</div>
        )}
        {out && <span className="absolute left-3 top-3"><Badge tone="neutral">Out of stock</Badge></span>}
        {!out && product.total_stock <= 5 && <span className="absolute left-3 top-3"><Badge tone="warning">Low stock</Badge></span>}
      </Link>
      <button
        type="button"
        aria-label={inList ? 'Remove from wishlist' : 'Save to wishlist'}
        aria-pressed={inList}
        onClick={async () => {
          if (!user) {
            toast.info('Sign in to save products to your wishlist.');
            return;
          }
          const added = await wishlist.toggle(product.id);
          toast.success(added ? 'Saved to wishlist' : 'Removed from wishlist');
        }}
        className={clsx('absolute right-3 top-3 rounded-full p-2 shadow-card transition-colors', inList ? 'bg-accent text-white' : 'bg-card/90 text-ink-soft hover:text-accent')}
      >
        <svg className="size-4" viewBox="0 0 24 24" fill={inList ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8"><path d="M12 20s-7-4.6-9.2-8.6C1.2 8.5 3 5 6.5 5c2 0 3.6 1.1 4.5 2.7h2C13.9 6.1 15.5 5 17.5 5 21 5 22.8 8.5 21.2 11.4 19 15.4 12 20 12 20z" strokeLinejoin="round" /></svg>
      </button>
      <div className="flex flex-1 flex-col p-4">
        <Link to={`/product/${product.slug}`} className="font-medium leading-snug hover:underline">{product.title}</Link>
        {product.tagline && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{product.tagline}</p>}
        <div className="mt-2 flex items-center justify-between gap-2">
          <Price paise={product.min_price_paise} compareAt={product.compare_at_price_paise} size="sm" />
          {product.rating && product.rating.count > 0 && <Stars rating={product.rating.average} count={product.rating.count} />}
        </div>
      </div>
    </div>
  );
}

export function Gallery({ product }: { product: Product }) {
  const images = product.images ?? [];
  const [active, setActive] = useState(0);
  if (!images.length) {
    return <div className="aspect-[4/3] rounded-2xl bg-line-soft flex items-center justify-center text-muted text-sm">Photography in progress</div>;
  }
  return (
    <div>
      <div className="overflow-hidden rounded-2xl bg-line-soft border border-line-soft">
        <img src={images[active]?.url} alt={images[active]?.alt_text || product.title} className="aspect-[4/3] w-full object-cover" fetchPriority="high" />
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2" role="tablist" aria-label="Product images">
          {images.map((img, i) => (
            <button
              key={img.id}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={clsx('size-16 overflow-hidden rounded-lg border-2 transition-colors', i === active ? 'border-ink' : 'border-transparent opacity-70 hover:opacity-100')}
            >
              <img src={img.url} alt="" className="size-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReviewSection({ product, reviews, policy }: { product: Product; reviews: Review[]; policy: string }) {
  const user = useAuth((s) => s.user);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.post<{ message: string }>('/reviews', { productSlug: product.slug, rating, title: title || undefined, body });
      setNotice(res.message);
      setBody('');
      setTitle('');
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not submit review');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-16" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" className="font-display text-3xl">Customer reviews</h2>
      <p className="mt-1 text-sm text-muted">{policy}</p>

      {reviews.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-line bg-card/60 p-8 text-center">
          <p className="font-medium">No verified reviews yet</p>
          <p className="mt-1 text-sm text-muted">We only publish reviews from customers whose order for this product was delivered — so when they appear, they're real.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-5">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-2xl border border-line-soft bg-card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <Stars rating={r.rating} />
                <Badge tone="success">Verified purchase</Badge>
                <span className="ml-auto text-xs text-muted">{formatDate(r.created_at)}</span>
              </div>
              {r.title && <h3 className="mt-2 font-semibold">{r.title}</h3>}
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{r.body}</p>
              <p className="mt-2 text-xs text-muted">— {r.author_name}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 rounded-2xl border border-line bg-card p-6">
        <h3 className="font-semibold">{user ? 'Write a review' : 'Sign in to write a review'}</h3>
        {!user && <p className="mt-1 text-sm text-muted">Reviews are tied to delivered orders, so you'll need an account.</p>}
        {user && (
          <div className="mt-4 space-y-4">
            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink-soft">Your rating</span>
              <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} role="radio" aria-checked={rating === n} onClick={() => setRating(n)} className={clsx('p-1', n <= rating ? 'text-accent' : 'text-line')} aria-label={`${n} star${n > 1 ? 's' : ''}`}>
                    <svg className="size-6 fill-current" viewBox="0 0 20 20"><path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9l-5.3 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" /></svg>
                  </button>
                ))}
              </div>
            </div>
            <Field label="Title (optional)"><input value={title} onChange={(e) => setTitle(e.target.value)} className="h-11 w-full rounded-xl border border-line bg-card px-3.5 text-sm focus:border-ink focus:outline-none" maxLength={120} /></Field>
            <Field label="Your experience" error={undefined}>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What did you like or dislike? How is the quality in person?" minLength={10} />
            </Field>
            {notice && <p className="text-sm text-ink-soft rounded-lg bg-line-soft px-3 py-2">{notice}</p>}
            <Button onClick={submit} loading={busy} disabled={body.trim().length < 10}>Submit review</Button>
          </div>
        )}
      </div>
    </section>
  );
}
