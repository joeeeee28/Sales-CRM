import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCart } from '@/store/cart';
import { useBootstrap } from '@/store/bootstrap';
import { formatMoney, usePageMeta } from '@/lib/format';
import { Button, EmptyState, Input, QtyStepper, Skeleton } from '@/components/ui';
import { toast } from '@/store/toast';
import { ApiError } from '@/lib/api';

export default function CartPage() {
  const { cart, quote, refresh, setQty, remove, applyCoupon } = useCart();
  const store = useBootstrap((s) => s.store);
  const [code, setCode] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const navigate = useNavigate();
  usePageMeta('Your bag — Ojas', 'Review your bag, apply a discount code and check out securely.');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!cart) {
    return <div className="container-page grid gap-10 py-12 lg:grid-cols-[1.6fr_1fr]"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  }

  if (!cart.items.length) {
    return (
      <div className="container-page py-16">
        <EmptyState
          title="Your bag is empty"
          body="Browse the catalogue — everything you add stays saved on this device, and in your account once you sign in."
          action={<Button variant="accent" onClick={() => navigate('/shop')}>Start shopping</Button>}
        />
      </div>
    );
  }

  const apply = async () => {
    setCouponBusy(true);
    try {
      await applyCoupon(code.trim() || null);
      toast.success(code.trim() ? 'Code applied' : 'Code removed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setCouponBusy(false);
    }
  };

  return (
    <div className="container-page py-10">
      <h1 className="font-display text-4xl sm:text-5xl">Your bag</h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <ul className="space-y-4">
          {cart.items.map((item) => (
            <li key={item.line_id} className="flex gap-4 rounded-2xl border border-line-soft bg-card p-4 shadow-card">
              {item.image_url ? <Link to={`/product/${item.product_slug}`}><img src={item.image_url} alt={item.title} className="size-24 rounded-xl object-cover" loading="lazy" /></Link> : <div className="size-24 rounded-xl bg-line-soft" />}
              <div className="flex-1 min-w-0">
                <div className="flex justify-between gap-3">
                  <div>
                    <Link to={`/product/${item.product_slug}`} className="font-medium hover:underline">{item.title}</Link>
                    <p className="text-sm text-muted">{Object.entries(item.options).map(([k, v]) => `${k}: ${v}`).join(' · ') || item.sku}</p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatMoney(item.line_total_paise)}</span>
                </div>
                {item.price_changed && (
                  <p className="mt-2 rounded-lg bg-warning-soft px-3 py-1.5 text-xs text-warning">
                    The price or availability of this item changed since you added it. Current price: {formatMoney(item.unit_price_paise)}.
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <QtyStepper small value={item.qty} max={Math.max(1, item.available_stock)} onChange={(n) => (n <= 0 ? remove(item.line_id) : setQty(item.line_id, n).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Update failed')))} />
                  <button className="text-xs text-muted underline underline-offset-2 hover:text-danger" onClick={() => remove(item.line_id)}>Remove</button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="h-fit rounded-2xl border border-line bg-card p-6 shadow-card lg:sticky lg:top-24">
          <h2 className="font-display text-2xl">Summary</h2>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums font-medium">{formatMoney(cart.subtotal_paise)}</dd></div>
            {cart.discount_paise > 0 && <div className="flex justify-between text-success"><dt>Discount {cart.coupon_code ? `(${cart.coupon_code})` : ''}</dt><dd className="tabular-nums">−{formatMoney(cart.discount_paise)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Shipping</dt><dd className="tabular-nums font-medium">{quote ? (quote.shipping_paise === 0 ? 'Free' : formatMoney(quote.shipping_paise)) : '—'}</dd></div>
            {quote && quote.tax_paise > 0 && <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular-nums font-medium">{formatMoney(quote.tax_paise)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-3 text-base"><dt className="font-semibold">Estimated total</dt><dd className="tabular-nums font-semibold">{formatMoney(quote?.total_paise ?? cart.subtotal_paise - cart.discount_paise)}</dd></div>
          </dl>
          {store?.free_shipping_over_paise != null && cart.subtotal_paise < store.free_shipping_over_paise && (
            <p className="mt-3 text-xs text-muted">Add {formatMoney(store.free_shipping_over_paise - cart.subtotal_paise)} more to unlock free standard shipping.</p>
          )}

          <div className="mt-5">
            <label className="text-sm font-medium text-ink-soft" htmlFor="coupon">Discount code</label>
            <div className="mt-1.5 flex gap-2">
              <Input id="coupon" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. WELCOME10" className="h-10" />
              <Button variant="secondary" size="sm" loading={couponBusy} onClick={apply}>Apply</Button>
            </div>
            {cart.coupon && <p className="mt-2 text-xs text-success">{cart.coupon.code}: {cart.coupon.description}</p>}
          </div>

          <Button variant="accent" className="mt-5 w-full" size="lg" onClick={() => navigate('/checkout')}>Proceed to checkout</Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => navigate('/shop')}>Continue shopping</Button>
          <p className="mt-4 text-center text-xs text-muted">Your bag is saved between visits{store ? ' and syncs to your account on sign-in' : ''}.</p>
        </aside>
      </div>
    </div>
  );
}
