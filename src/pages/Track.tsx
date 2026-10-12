import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatMoney, usePageMeta } from '@/lib/format';
import { Button, Field, Input, StatusPill } from '@/components/ui';
import type { Order } from '@shared/types';
import { ORDER_STATUS_LABELS, ORDER_FLOW } from '@shared/types';
import clsx from 'clsx';

export default function Track() {
  const [number, setNumber] = useState('');
  const [contact, setContact] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePageMeta('Track your order — Ojas', 'Enter your order number and the email or phone used at checkout to see real tracking status.');

  const lookup = async () => {
    setBusy(true);
    setError(null);
    setOrder(null);
    try {
      const res = await api.get<{ order: Order }>(`/track?number=${encodeURIComponent(number)}&contact=${encodeURIComponent(contact)}`);
      setOrder(res.order);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lookup failed');
    } finally {
      setBusy(false);
    }
  };

  const flowIndex = order ? ORDER_FLOW.indexOf(order.status) : -1;
  const cancelled = order?.status === 'cancelled' || order?.status === 'refunded';

  return (
    <div className="container-page max-w-3xl py-12">
      <h1 className="font-display text-4xl sm:text-5xl">Track your order</h1>
      <p className="mt-2 text-muted">Statuses below come from real order and shipment events — we never display fabricated scans.</p>

      <form
        className="mt-8 grid gap-4 rounded-2xl border border-line bg-card p-6 shadow-card sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <Field label="Order number" id="tn"><Input id="tn" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="OJ-2026-000001" required /></Field>
        <Field label="Email or phone" id="tc"><Input id="tc" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="you@example.com" required /></Field>
        <div className="sm:self-end"><Button type="submit" loading={busy}>Track</Button></div>
      </form>
      {error && <p className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}

      {order && (
        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border border-line bg-card p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl">{order.number}</h2>
                <p className="text-sm text-muted">Placed {formatDateTime(order.placed_at)} · {formatMoney(order.total_paise)}</p>
              </div>
              <StatusPill status={order.status} />
            </div>

            {!cancelled ? (
              <ol className="mt-6 grid gap-0 sm:grid-cols-6" aria-label="Order progress">
                {ORDER_FLOW.map((step, i) => {
                  const done = flowIndex >= i;
                  const event = order.status_events.find((e) => e.status === step);
                  return (
                    <li key={step} className="relative flex sm:flex-col items-center gap-2 sm:gap-1 pb-4 sm:pb-0">
                      <span className={clsx('size-3 rounded-full ring-4', done ? 'bg-accent ring-accent-soft' : 'bg-line ring-paper')} aria-hidden="true" />
                      {i < ORDER_FLOW.length - 1 && <span className={clsx('hidden sm:block absolute left-[calc(50%+8px)] right-[calc(-50%+8px)] top-1 h-0.5', done && flowIndex > i ? 'bg-accent' : 'bg-line')} aria-hidden="true" />}
                      <span className={clsx('text-xs sm:text-center', done ? 'font-medium' : 'text-muted')}>{ORDER_STATUS_LABELS[step]}</span>
                      {event && <span className="text-[10px] text-muted sm:text-center">{formatDateTime(event.created_at)}</span>}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">This order was {order.status}{order.cancel_reason ? `: ${order.cancel_reason}` : ''}.</p>
            )}
          </div>

          {order.shipments.length > 0 && (
            <div className="rounded-2xl border border-line bg-card p-6 shadow-card">
              <h2 className="font-semibold">Shipments</h2>
              {order.shipments.map((s) => (
                <div key={s.id} className="mt-3">
                  <p className="text-sm">
                    {s.carrier ?? 'Carrier pending'} {s.tracking_number && <span className="font-mono text-xs text-muted">· {s.tracking_number}</span>}
                  </p>
                  {s.events.length ? (
                    <ul className="mt-3 space-y-3 border-l-2 border-line pl-4">
                      {s.events.map((e) => (
                        <li key={e.id} className="relative text-sm">
                          <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-accent" aria-hidden="true" />
                          <span className="font-medium">{e.status}</span>
                          {e.description && <span className="text-muted"> — {e.description}</span>}
                          {e.location && <span className="text-muted"> · {e.location}</span>}
                          <span className="block text-xs text-muted">{formatDateTime(e.occurred_at)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-muted">No carrier scans received yet — tracking updates appear here the moment they exist.</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-line bg-card p-6 shadow-card">
            <h2 className="font-semibold">Items</h2>
            <ul className="mt-3 divide-y divide-line-soft text-sm">
              {order.items.map((i) => (
                <li key={i.id} className="flex justify-between py-2.5">
                  <span>{i.title} <span className="text-muted">× {i.qty}</span></span>
                  <span className="tabular-nums">{formatMoney(i.total_paise)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
