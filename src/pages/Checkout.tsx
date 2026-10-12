import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '@/lib/api';
import { useCart } from '@/store/cart';
import { useAuth } from '@/store/auth';
import { useBootstrap } from '@/store/bootstrap';
import { toast } from '@/store/toast';
import { formatMoney, usePageMeta, deliveryWindow, track } from '@/lib/format';
import { Button, Field, Input, Select, Skeleton, Textarea } from '@/components/ui';
import type { Order, Quote, ShippingMethod } from '@shared/types';

declare global {
  interface Window {
    Razorpay?: any;
  }
}

interface QuoteResponse {
  quote: Quote;
  shipping_method: ShippingMethod & { cod_available: boolean };
  cod: { allowed: boolean; reason: string | null };
  gateway: { mode: 'live' | 'simulated'; keyId: string | null };
}

const emptyAddress = { full_name: '', phone: '', line1: '', line2: '', city: '', state: '', postal_code: '', country: 'IN' };

export default function Checkout() {
  const { cart, refresh } = useCart();
  const user = useAuth((s) => s.user);
  const store = useBootstrap((s) => s.store);
  const navigate = useNavigate();
  usePageMeta('Checkout — Ojas', 'Secure checkout with UPI, cards, netbanking and wallets.');

  const [methods, setMethods] = useState<ShippingMethod[]>([]);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [email, setEmail] = useState(user?.email ?? '');
  const [address, setAddress] = useState({ ...emptyAddress, full_name: user ? `${user.first_name} ${user.last_name}`.trim() : '', phone: user?.phone ?? '' });
  const [payment, setPayment] = useState<'gateway' | 'cod'>('gateway');
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  const [payState, setPayState] = useState<{ orderId: string; number: string; providerOrderId: string; mode: 'live' | 'simulated'; keyId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    void refresh();
    api.get<{ methods: ShippingMethod[] }>('/shipping-methods').then((d) => {
      setMethods(d.methods);
      setMethodId(d.methods[0]?.id ?? null);
    });
  }, [refresh]);

  useEffect(() => {
    if (!methodId || !cart?.items.length) return;
    api.post<QuoteResponse>('/checkout/quote', { shippingMethodId: methodId }).then(setQuote).catch(() => setQuote(null));
  }, [methodId, cart?.subtotal_paise, cart?.coupon_code]);

  if (!cart || !cart.items.length) {
    return (
      <div className="container-page py-24 text-center">
        <h1 className="font-display text-4xl">Nothing to check out</h1>
        <p className="mt-2 text-muted">Your bag is empty.</p>
        <Button className="mt-6" variant="accent" onClick={() => navigate('/shop')}>Browse products</Button>
      </div>
    );
  }

  const set = (key: keyof typeof address) => (e: React.ChangeEvent<HTMLInputElement>) => setAddress({ ...address, [key]: e.target.value });

  const placeOrder = async () => {
    setError(null);
    setPlacing(true);
    try {
      const res = await api.post<{ order: Order }>('/orders', {
        email,
        phone: address.phone,
        shippingAddress: { ...address, label: 'Delivery' },
        shippingMethodId: methodId,
        paymentMethod: payment,
        couponCode: cart.coupon_code,
        idempotencyKey,
        notes: notes || undefined,
      });
      track('begin_checkout', { orderId: res.order.id, total: res.order.total_paise });
      localStorage.setItem('ojas_last_email', email);
      if (payment === 'cod') {
        navigate(`/order/${res.order.number}/confirmation`);
        return;
      }
      const prep = await api.post<{ providerOrderId: string; mode: 'live' | 'simulated'; keyId: string | null }>(`/payments/${res.order.id}/prepare`);
      setPayState({ orderId: res.order.id, number: res.order.number, providerOrderId: prep.providerOrderId, mode: prep.mode, keyId: prep.keyId });
      if (prep.mode === 'live' && prep.keyId && window.Razorpay) {
        openRazorpay(res.order, prep.providerOrderId, prep.keyId);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not place the order');
    } finally {
      setPlacing(false);
    }
  };

  const openRazorpay = (order: Order, providerOrderId: string, keyId: string) => {
    const rzp = new window.Razorpay({
      key: keyId,
      order_id: providerOrderId,
      amount: order.total_paise,
      currency: order.currency,
      name: store?.name ?? 'Ojas',
      description: order.number,
      prefill: { email, contact: address.phone },
      theme: { color: '#C8552B' },
      handler: async (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        try {
          await api.post(`/payments/${order.id}/verify`, {
            providerOrderId: resp.razorpay_order_id,
            providerPaymentId: resp.razorpay_payment_id,
            signature: resp.razorpay_signature,
            method: 'card',
          });
          track('purchase', { orderId: order.id, total: order.total_paise });
          navigate(`/order/${order.number}/confirmation`);
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Verification failed');
        }
      },
      modal: {
        ondismiss: () => setPayState(null),
      },
    });
    rzp.open();
  };

  const simulate = async (success: boolean) => {
    if (!payState) return;
    try {
      if (success) {
        await api.post(`/payments/${payState.orderId}/simulate-success`);
        track('purchase', { orderId: payState.orderId });
        toast.success('Payment captured (simulated gateway)');
        navigate(`/order/${payState.number}/confirmation`);
      } else {
        await api.post(`/payments/${payState.orderId}/fail`, { reason: 'Simulated failure: insufficient funds' });
        toast.error('Payment failed — no money was captured. You can retry.');
        setPayState(null);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Payment step failed');
    }
  };

  const selectedMethod = methods.find((m) => m.id === methodId);

  return (
    <div className="container-page py-10">
      <h1 className="font-display text-4xl sm:text-5xl">Checkout</h1>
      <p className="mt-1 text-sm text-muted">{!user && <>Checking out as guest — <Link className="text-accent-dark underline underline-offset-4" to="/account/login">sign in</Link> to save this order to your account.</>}</p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-8">
          <section className="rounded-2xl border border-line bg-card p-6 shadow-card" aria-labelledby="contact-heading">
            <h2 id="contact-heading" className="font-display text-2xl">Contact</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Email" id="email"><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></Field>
              <Field label="Phone" id="phone"><Input id="phone" required value={address.phone} onChange={set('phone')} placeholder="+91 98765 43210" autoComplete="tel" /></Field>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-card p-6 shadow-card" aria-labelledby="ship-heading">
            <h2 id="ship-heading" className="font-display text-2xl">Shipping address</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Full name"><Input required value={address.full_name} onChange={set('full_name')} autoComplete="name" /></Field>
              <Field label="PIN code"><Input required value={address.postal_code} onChange={set('postal_code')} inputMode="numeric" autoComplete="postal-code" /></Field>
              <Field label="Address line 1"><Input required value={address.line1} onChange={set('line1')} autoComplete="address-line1" /></Field>
              <Field label="Address line 2 (optional)"><Input value={address.line2} onChange={set('line2')} autoComplete="address-line2" /></Field>
              <Field label="City"><Input required value={address.city} onChange={set('city')} autoComplete="address-level2" /></Field>
              <Field label="State"><Input required value={address.state} onChange={set('state')} autoComplete="address-level1" /></Field>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-card p-6 shadow-card" aria-labelledby="method-heading">
            <h2 id="method-heading" className="font-display text-2xl">Shipping method</h2>
            <div className="mt-4 space-y-2">
              {methods.length === 0 && <Skeleton className="h-16" />}
              {methods.map((m) => (
                <label key={m.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors ${methodId === m.id ? 'border-ink bg-line-soft' : 'border-line hover:border-ink/40'}`}>
                  <input type="radio" name="shipping" checked={methodId === m.id} onChange={() => setMethodId(m.id)} className="accent-[#C8552B]" />
                  <span className="flex-1">
                    <span className="block font-medium">{m.name}</span>
                    <span className="block text-xs text-muted">{m.description} · {deliveryWindow(m.min_days, m.max_days)}</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{quote && methodId === m.id ? (quote.quote.shipping_paise === 0 ? 'Free' : formatMoney(m.price_paise)) : formatMoney(m.price_paise)}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-card p-6 shadow-card" aria-labelledby="pay-heading">
            <h2 id="pay-heading" className="font-display text-2xl">Payment</h2>
            <div className="mt-4 space-y-2">
              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${payment === 'gateway' ? 'border-ink bg-line-soft' : 'border-line'}`}>
                <input type="radio" name="payment" checked={payment === 'gateway'} onChange={() => setPayment('gateway')} className="accent-[#C8552B]" />
                <span className="flex-1">
                  <span className="block font-medium">Pay online — UPI, cards, netbanking, wallets</span>
                  <span className="block text-xs text-muted">Processed by our PCI-DSS compliant gateway. Card details never touch our servers.</span>
                </span>
              </label>
              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${payment === 'cod' ? 'border-ink bg-line-soft' : 'border-line'} ${quote && !quote.cod.allowed ? 'opacity-60' : ''}`}>
                <input type="radio" name="payment" checked={payment === 'cod'} disabled={quote ? !quote.cod.allowed : false} onChange={() => setPayment('cod')} className="accent-[#C8552B]" />
                <span className="flex-1">
                  <span className="block font-medium">Cash on Delivery</span>
                  <span className="block text-xs text-muted">{quote ? (quote.cod.allowed ? 'Pay in cash or UPI when your order arrives.' : quote.cod.reason) : 'Checking availability…'}</span>
                </span>
              </label>
            </div>
            {quote?.gateway.mode === 'simulated' && payment === 'gateway' && (
              <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                Payment gateway credentials are not configured on this deployment, so checkout runs in a clearly-labelled <strong>simulated mode</strong>. No real charge is made; the full verification flow still runs server-side.
              </p>
            )}
            <Field label="Order notes (optional)" >
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery instructions, gate code…" className="mt-1.5 min-h-20" />
            </Field>
          </section>
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-24">
          <div className="rounded-2xl border border-line bg-card p-6 shadow-card">
            <h2 className="font-display text-2xl">Order summary</h2>
            <ul className="mt-4 space-y-3 max-h-64 overflow-y-auto pr-1">
              {cart.items.map((i) => (
                <li key={i.line_id} className="flex gap-3 text-sm">
                  {i.image_url && <img src={i.image_url} alt="" className="size-12 rounded-lg object-cover" loading="lazy" />}
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">{i.title}</span>
                    <span className="text-xs text-muted">{Object.values(i.options).join(' · ')} · Qty {i.qty}</span>
                  </span>
                  <span className="tabular-nums">{formatMoney(i.line_total_paise)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{formatMoney(quote?.quote.subtotal_paise ?? cart.subtotal_paise)}</dd></div>
              {(quote?.quote.discount_paise ?? cart.discount_paise) > 0 && <div className="flex justify-between text-success"><dt>Discount</dt><dd className="tabular-nums">−{formatMoney(quote?.quote.discount_paise ?? cart.discount_paise)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">Shipping{selectedMethod ? ` (${selectedMethod.name})` : ''}</dt><dd className="tabular-nums">{quote ? (quote.quote.shipping_paise === 0 ? 'Free' : formatMoney(quote.quote.shipping_paise)) : '—'}</dd></div>
              {quote?.quote.tax_paise ? <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular-nums">{formatMoney(quote.quote.tax_paise)}</dd></div> : null}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(quote?.quote.total_paise ?? 0)}</dd></div>
            </dl>
            {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
            {!payState ? (
              <Button variant="accent" size="lg" className="mt-5 w-full" loading={placing} onClick={placeOrder}
                disabled={!email || !address.full_name || !address.line1 || !address.city || !address.state || !address.postal_code || !methodId}>
                {payment === 'cod' ? 'Place order' : 'Place order & pay'}
              </Button>
            ) : (
              <div className="mt-5 rounded-xl border border-line bg-paper p-4">
                <p className="text-sm font-semibold">Order {payState.number} created</p>
                <p className="mt-1 text-xs text-muted">
                  {payState.mode === 'simulated'
                    ? 'Simulated gateway: choose an outcome to exercise the verified payment flow.'
                    : 'Complete the payment in the gateway window.'}
                </p>
                {payState.mode === 'simulated' && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button size="sm" variant="accent" onClick={() => simulate(true)}>Simulate success</Button>
                    <Button size="sm" variant="secondary" onClick={() => simulate(false)}>Simulate failure</Button>
                  </div>
                )}
                {payState.mode === 'live' && !window.Razorpay && (
                  <p className="mt-2 text-xs text-warning">Razorpay Checkout script not loaded — check network access to checkout.razorpay.com.</p>
                )}
                <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => setPayState(null)}>Back to form</Button>
              </div>
            )}
            <p className="mt-3 text-center text-[11px] leading-relaxed text-muted">By placing this order you agree to our terms, returns and privacy policies. Payments are verified server-side; we never store card data.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
