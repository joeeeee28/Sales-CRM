import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import clsx from 'clsx';
import { useBootstrap } from '@/store/bootstrap';
import { useCart, cartCount } from '@/store/cart';
import { useAuth } from '@/store/auth';
import { useToast } from '@/store/toast';
import { formatMoney, usePageViewTracking } from '@/lib/format';
import { Button, Input, QtyStepper } from './ui';
import { api, ApiError } from '@/lib/api';
import type { ProductListItem } from '@shared/types';
import { PAYMENT_BADGES } from '@shared/brand';

function Logo() {
  const store = useBootstrap((s) => s.store);
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label={`${store?.name ?? 'Store'} home`}>
      <svg viewBox="0 0 64 64" className="size-8" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#17171A" />
        <path d="M32 14c10 0 17 7.6 17 18s-7 18-17 18-17-7.6-17-18 7-18 17-18zm0 7.5c-5.6 0-9.5 4.2-9.5 10.5s3.9 10.5 9.5 10.5 9.5-4.2 9.5-10.5-3.9-10.5-9.5-10.5z" fill="#FAF9F6" />
        <circle cx="45" cy="19" r="5" fill="#C8552B" />
      </svg>
      <span className="font-display text-2xl tracking-tight">{store?.name ?? 'Ojas'}</span>
    </Link>
  );
}

function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else setResults([]);
  }, [open]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const data = await api.get<{ items: ProductListItem[] }>(`/products?q=${encodeURIComponent(q)}&pageSize=6`);
        setResults(data.items);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Search products">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative mx-auto mt-20 w-[min(92vw,640px)] rounded-2xl bg-card p-4 shadow-pop animate-fade-up">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            onClose();
            navigate(`/shop?q=${encodeURIComponent(q)}`);
          }}
          className="flex items-center gap-2"
        >
          <svg className="size-5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" /></svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products, categories…"
            className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted/70"
            aria-label="Search query"
          />
          <Button type="submit" size="sm" variant="secondary">Search</Button>
        </form>
        {(searching || results.length > 0) && (
          <ul className="mt-3 divide-y divide-line-soft border-t border-line-soft">
            {searching && <li className="py-3 text-sm text-muted">Searching…</li>}
            {!searching &&
              results.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/product/${p.slug}`}
                    onClick={onClose}
                    className="flex items-center gap-3 py-2.5 hover:bg-line-soft rounded-lg px-2 -mx-2 transition-colors"
                  >
                    {p.images?.[0] && <img src={p.images[0].url} alt="" className="size-10 rounded-md object-cover" loading="lazy" />}
                    <span className="flex-1 text-sm font-medium">{p.title}</span>
                    <span className="text-sm tabular-nums text-muted">{formatMoney(p.min_price_paise)}</span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
        {q.trim().length >= 2 && !searching && results.length === 0 && (
          <p className="mt-3 border-t border-line-soft pt-3 text-sm text-muted">No products match “{q}”.</p>
        )}
      </div>
    </div>
  );
}

function CartDrawer() {
  const { cart, drawerOpen, setDrawer, setQty, remove } = useCart();
  const navigate = useNavigate();
  const store = useBootstrap((s) => s.store);
  if (!drawerOpen) return null;
  const subtotal = cart?.subtotal_paise ?? 0;
  const freeOver = store?.free_shipping_over_paise ?? null;
  const remaining = freeOver != null ? freeOver - subtotal : null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Shopping bag">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setDrawer(false)} />
      <aside className="absolute right-0 top-0 flex h-full w-[min(94vw,420px)] flex-col bg-paper shadow-pop">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-2xl">Your bag</h2>
          <button onClick={() => setDrawer(false)} className="rounded-full p-2 text-muted hover:bg-line-soft hover:text-ink" aria-label="Close bag">
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!cart?.items.length ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="font-display text-xl">Your bag is empty</p>
              <p className="mt-1 text-sm text-muted">Everything you add will wait for you here.</p>
              <Button className="mt-5" variant="secondary" onClick={() => { setDrawer(false); navigate('/shop'); }}>Browse products</Button>
            </div>
          ) : (
            <ul className="space-y-4">
              {cart.items.map((item) => (
                <li key={item.line_id} className="flex gap-3 rounded-xl bg-card border border-line-soft p-3">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.title} className="size-20 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <div className="size-20 rounded-lg bg-line-soft" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-2">
                      <Link to={`/product/${item.product_slug}`} onClick={() => setDrawer(false)} className="truncate text-sm font-medium hover:underline">{item.title}</Link>
                      <span className="text-sm font-semibold tabular-nums">{formatMoney(item.line_total_paise)}</span>
                    </div>
                    <p className="text-xs text-muted">{Object.values(item.options).join(' · ') || item.sku}</p>
                    {item.price_changed && <p className="mt-1 text-xs text-warning">Price or availability changed — review before checkout.</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <QtyStepper small value={item.qty} max={item.available_stock || 99} onChange={(n) => (n <= 0 ? remove(item.line_id) : setQty(item.line_id, n))} />
                      <button className="text-xs text-muted hover:text-danger underline underline-offset-2" onClick={() => remove(item.line_id)}>Remove</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {cart?.items.length ? (
          <div className="border-t border-line bg-card px-5 py-4 space-y-3">
            {remaining != null && remaining > 0 && (
              <p className="text-xs text-muted">Add {formatMoney(remaining)} more for free standard shipping.</p>
            )}
            {remaining != null && remaining <= 0 && <p className="text-xs text-success">Standard shipping is free on this order.</p>}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Subtotal</span>
              <span className="font-semibold tabular-nums">{formatMoney(subtotal)}</span>
            </div>
            <Button variant="accent" className="w-full" onClick={() => { setDrawer(false); navigate('/checkout'); }}>Proceed to checkout</Button>
            <Button variant="ghost" className="w-full" onClick={() => { setDrawer(false); navigate('/cart'); }}>View bag</Button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={clsx(
            'pointer-events-auto rounded-xl px-4 py-3 text-sm shadow-pop text-left animate-fade-up',
            t.kind === 'success' && 'bg-ink text-paper',
            t.kind === 'error' && 'bg-danger text-white',
            t.kind === 'info' && 'bg-card text-ink border border-line'
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

export function Header() {
  const categories = useBootstrap((s) => s.categories);
  const store = useBootstrap((s) => s.store);
  const user = useAuth((s) => s.user);
  const cart = useCart((s) => s.cart);
  const setDrawer = useCart((s) => s.setDrawer);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  usePageViewTracking();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const count = cartCount(cart);
  const nav = useMemo(
    () => [
      { to: '/shop', label: 'Shop all' },
      ...categories.slice(0, 4).map((c) => ({ to: `/shop/${c.slug}`, label: c.name })),
    ],
    [categories]
  );

  return (
    <>
      {store?.announcement_text && (
        <div className="bg-ink text-paper text-center text-xs sm:text-sm px-4 py-2">
          {store.announcement_link ? (
            <Link to={store.announcement_link} className="underline underline-offset-2 hover:opacity-80">{store.announcement_text}</Link>
          ) : (
            store.announcement_text
          )}
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
        <div className="container-page flex h-16 items-center gap-4">
          <button className="lg:hidden rounded-md p-2 -ml-2 hover:bg-line-soft" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Menu" aria-expanded={mobileOpen}>
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" /></svg>
          </button>
          <Logo />
          <nav className="ml-6 hidden lg:flex items-center gap-1" aria-label="Primary">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx('rounded-full px-3.5 py-2 text-sm font-medium transition-colors', isActive ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-line-soft')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <button className="rounded-full p-2.5 hover:bg-line-soft" onClick={() => setSearchOpen(true)} aria-label="Search">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" /></svg>
            </button>
            <Link to={user ? '/account/orders' : '/account/login'} className="hidden sm:block rounded-full p-2.5 hover:bg-line-soft" aria-label="Account">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" strokeLinecap="round" /></svg>
            </Link>
            <button className="relative rounded-full p-2.5 hover:bg-line-soft" onClick={() => setDrawer(true)} aria-label={`Bag, ${count} items`}>
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6a3 3 0 016 0v2" strokeLinecap="round" /></svg>
              {count > 0 && <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white tabular-nums">{count}</span>}
            </button>
          </div>
        </div>
        {mobileOpen && (
          <nav className="lg:hidden border-t border-line bg-paper px-4 py-3 space-y-1" aria-label="Mobile">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => clsx('block rounded-lg px-3 py-2.5 text-sm font-medium', isActive ? 'bg-ink text-paper' : 'hover:bg-line-soft')}>
                {item.label}
              </NavLink>
            ))}
            <NavLink to={user ? '/account/orders' : '/account/login'} className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-line-soft">
              {user ? 'Your orders' : 'Sign in'}
            </NavLink>
            <NavLink to="/track" className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-line-soft">Track order</NavLink>
          </nav>
        )}
      </header>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <CartDrawer />
      <Toasts />
    </>
  );
}

export function Footer() {
  const store = useBootstrap((s) => s.store);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [message, setMessage] = useState('');

  const subscribe = async (e: FormEvent) => {
    e.preventDefault();
    setState('loading');
    try {
      const res = await api.post<{ message: string }>('/newsletter', { email, source: 'footer' });
      setMessage(res.message);
      setState('done');
      setEmail('');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not subscribe');
      setState('done');
    }
  };

  const policyLinks: [string, string][] = [
    ['/pages/shipping-policy', 'Shipping policy'],
    ['/pages/returns-refund-policy', 'Returns & refunds'],
    ['/pages/cancellation-policy', 'Cancellation policy'],
    ['/pages/privacy-policy', 'Privacy policy'],
    ['/pages/terms-and-conditions', 'Terms & conditions'],
  ];

  return (
    <footer className="mt-24 border-t border-line bg-card">
      <div className="container-page grid gap-10 py-14 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted">{store?.tagline}</p>
          <div className="mt-5 flex gap-3" aria-label="Social links">
            {['Instagram', 'X', 'LinkedIn'].map((s) => (
              <a key={s} href="https://example.com" rel="noopener noreferrer" className="text-xs font-medium text-muted hover:text-ink underline underline-offset-4">{s}</a>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Help</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link className="hover:text-ink" to="/track">Track your order</Link></li>
            <li><Link className="hover:text-ink" to="/faq">FAQ</Link></li>
            <li><Link className="hover:text-ink" to="/contact">Contact us</Link></li>
            <li><Link className="hover:text-ink" to="/pages/about">About us</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Policies</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {policyLinks.map(([to, label]) => (
              <li key={to}><Link className="hover:text-ink" to={to}>{label}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">One thoughtful email a month</h3>
          <p className="mt-2 text-sm text-muted">New products and honest restock notes. No spam, unsubscribe anytime.</p>
          <form onSubmit={subscribe} className="mt-3 flex gap-2">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email address" className="h-10" />
            <Button type="submit" size="sm" loading={state === 'loading'}>Join</Button>
          </form>
          {message && <p className="mt-2 text-xs text-success">{message}</p>}
          <div className="mt-6">
            <h4 className="text-xs font-semibold text-muted uppercase tracking-wide">We accept</h4>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PAYMENT_BADGES.map((p) => (
                <span key={p} className="rounded-md border border-line bg-paper px-2 py-1 text-[11px] font-medium text-ink-soft">{p}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-line-soft">
        <div className="container-page flex flex-col sm:flex-row gap-2 sm:items-center justify-between py-5 text-xs text-muted">
          <p>© {new Date().getFullYear()} {store?.name ?? 'Ojas'}. {store?.address_line}</p>
          <p>Demo storefront — catalogue is clearly-labelled sample data.</p>
        </div>
      </div>
    </footer>
  );
}
