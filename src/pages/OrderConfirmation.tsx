import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '@/lib/api';
import { useCart } from '@/store/cart';
import { formatMoney, formatDate, usePageMeta, deliveryWindow } from '@/lib/format';
import { Badge, LinkButton, StatusPill } from '@/components/ui';
import type { Order } from '@shared/types';

export default function OrderConfirmation() {
  const { number } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const refreshCart = useCart((s) => s.refresh);
  usePageMeta(`Order ${number} confirmed — Ojas`);

  useEffect(() => {
    // confirmation is reachable by the owner of the session (guest or signed-in)
    api.get<{ orders: Order[] }>('/orders').then((d) => {
      const found = d.orders.find((o) => o.number === number);
      if (found) setOrder(found);
    }).catch(() => {});
    api.get<{ order: Order }>(`/track?number=${encodeURIComponent(number ?? '')}&contact=${encodeURIComponent(localStorage.getItem('ojas_last_email') ?? '')}`)
      .then((d) => setOrder(d.order))
      .catch(() => {});
    void refreshCart();
  }, [number, refreshCart]);

  if (!order) {
    return (
      <div className="container-page py-24 text-center">
        <h1 className="font-display text-4xl">Thank you for your order</h1>
        <p className="mx-auto mt-3 max-w-md text-muted">
          We've emailed your confirmation to the address you checked out with. Order number <strong>{number}</strong> — keep it for tracking and support.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <LinkButton to="/track" variant="accent">Track this order</LinkButton>
          <LinkButton to="/shop" variant="secondary">Continue shopping</LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page max-w-3xl py-12">
      <div className="text-center">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
          <svg className="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <h1 className="mt-4 font-display text-4xl sm:text-5xl">Order confirmed</h1>
        <p className="mt-2 text-muted">A confirmation email is on its way to {order.email}.</p>
        <div className="mt-3 flex justify-center gap-2"><Badge tone="neutral">{order.number}</Badge><StatusPill status={order.status} /></div>
      </div>

      <div className="mt-10 rounded-2xl border border-line bg-card p-6 shadow-card">
        <h2 className="font-semibold">Items</h2>
        <ul className="mt-3 divide-y divide-line-soft">
          {order.items.map((i) => (
            <li key={i.id} className="flex gap-3 py-3 text-sm">
              {i.image_url && <img src={i.image_url} alt="" className="size-14 rounded-lg object-cover" />}
              <span className="flex-1">
                <span className="block font-medium">{i.title}</span>
                <span className="text-xs text-muted">{i.variant_title} · {i.sku} · Qty {i.qty}</span>
              </span>
              <span className="tabular-nums font-medium">{formatMoney(i.total_paise)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{formatMoney(order.subtotal_paise)}</dd></div>
          {order.discount_paise > 0 && <div className="flex justify-between text-success"><dt>Discount</dt><dd className="tabular-nums">−{formatMoney(order.discount_paise)}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted">Shipping</dt><dd className="tabular-nums">{order.shipping_paise === 0 ? 'Free' : formatMoney(order.shipping_paise)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Total {order.payment_provider === 'cod' ? '(pay on delivery)' : 'paid'}</dt><dd className="tabular-nums">{formatMoney(order.total_paise)}</dd></div>
        </dl>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-card p-6">
          <h2 className="font-semibold">Delivery</h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">
            {order.shipping_address.full_name}<br />
            {order.shipping_address.line1}{order.shipping_address.line2 ? `, ${order.shipping_address.line2}` : ''}<br />
            {order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.postal_code}
          </p>
          <p className="mt-3 text-sm text-muted">{order.shipping_method_name}</p>
          {order.estimated_delivery && (
            <p className="mt-1 text-sm font-medium text-success">Estimated {deliveryWindow(order.estimated_delivery.min_days, order.estimated_delivery.max_days)}</p>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-card p-6">
          <h2 className="font-semibold">What happens next</h2>
          <ol className="mt-2 list-decimal pl-4 text-sm text-ink-soft space-y-1.5">
            <li>Payment confirmation{order.payment_provider === 'cod' ? ' on delivery' : ''} — {order.payment_status === 'captured' ? 'done' : 'pending'}.</li>
            <li>We prepare your order{order.fulfillment_status === 'pending_supplier' ? ' with our fulfilment partner' : ''}.</li>
            <li>You get a shipping email with real tracking.</li>
          </ol>
          <p className="mt-3 text-xs text-muted">Placed {formatDate(order.placed_at)}</p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <LinkButton to="/track" variant="accent">Track order</LinkButton>
        <LinkButton to="/shop" variant="secondary">Continue shopping</LinkButton>
        <Link to="/account/orders" className="self-center text-sm text-accent underline underline-offset-4">View in your account</Link>
      </div>
    </div>
  );
}
