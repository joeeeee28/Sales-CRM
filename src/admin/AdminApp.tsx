import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { formatDateTime, formatDate, formatMoney } from '@/lib/format';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton, StatusPill, Textarea, Modal } from '@/components/ui';
import { toast } from '@/store/toast';
import type { AdminMetrics, Order } from '@shared/types';

/* ------------------------------- shell ------------------------------------ */

const NAV = [
  { to: '/admin', label: 'Overview', perm: null, end: true },
  { to: '/admin/orders', label: 'Orders', perm: 'orders:write' },
  { to: '/admin/products', label: 'Products', perm: 'orders:write' },
  { to: '/admin/customers', label: 'Customers', perm: 'customers:read' },
  { to: '/admin/coupons', label: 'Coupons', perm: 'orders:write' },
  { to: '/admin/suppliers', label: 'Suppliers', perm: 'orders:write' },
  { to: '/admin/stock', label: 'Stock', perm: 'orders:write' },
  { to: '/admin/returns', label: 'Returns', perm: 'returns:write' },
  { to: '/admin/reviews', label: 'Reviews', perm: 'orders:write' },
  { to: '/admin/content', label: 'Content', perm: 'content:write' },
  { to: '/admin/settings', label: 'Settings', perm: 'orders:write' },
  { to: '/admin/audit', label: 'Audit log', perm: 'reports:read' },
];

export default function AdminApp() {
  const { user, permissions, initialised, init, logout } = useAuth();
  useEffect(() => {
    if (!initialised) void init();
  }, [initialised, init]);

  if (!initialised) return <div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>;
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper">
        <h1 className="font-display text-3xl">Admin sign-in required</h1>
        <p className="text-sm text-muted">Use your store account with an admin role.</p>
        <Link to="/account/login" className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-paper">Sign in</Link>
      </div>
    );
  }
  if (!permissions.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper text-center px-6">
        <h1 className="font-display text-3xl">No admin access</h1>
        <p className="max-w-md text-sm text-muted">Your account ({user.email}) has the role “{user.role}”, which does not include dashboard permissions.</p>
        <Link to="/" className="rounded-full border border-line bg-card px-6 py-3 text-sm">Back to store</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-card lg:border-b-0 lg:border-r lg:min-h-screen lg:sticky lg:top-0">
        <div className="flex items-center justify-between px-5 py-4">
          <Link to="/" className="font-display text-xl">Ojas <span className="text-muted text-sm font-sans">Admin</span></Link>
          <button onClick={() => { void logout(); }} className="text-xs text-muted underline underline-offset-2 hover:text-ink">Sign out</button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col" aria-label="Admin">
          {NAV.filter((n) => !n.perm || permissions.includes(n.perm)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => clsx('whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-line-soft')}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="p-5 lg:p-8 min-w-0">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="products/:id" element={<ProductEditPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="coupons" element={<CouponsPage />} />
          <Route path="suppliers" element={<SuppliersPage />} />
          <Route path="stock" element={<StockPage />} />
          <Route path="returns" element={<ReturnsPage />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="content" element={<ContentAdminPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="*" element={<EmptyState title="Not found" />} />
        </Routes>
      </main>
    </div>
  );
}

function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('rounded-2xl border border-line bg-card p-5 shadow-card', className)}>{children}</div>;
}

/* ------------------------------- dashboard -------------------------------- */

function Sparkline({ points }: { points: { day: string; revenue_paise: number }[] }) {
  if (!points.length) return <p className="py-8 text-center text-sm text-muted">No revenue data in this range yet.</p>;
  const max = Math.max(...points.map((p) => p.revenue_paise), 1);
  const w = 560;
  const h = 120;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (p.revenue_paise / max) * (h - 10) - 5).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Revenue by day">
      <path d={path} fill="none" stroke="#C8552B" strokeWidth="2.5" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={p.day} cx={i * step} cy={h - (p.revenue_paise / max) * (h - 10) - 5} r="3" fill="#C8552B">
          <title>{p.day}: {formatMoney(p.revenue_paise)}</title>
        </circle>
      ))}
    </svg>
  );
}

function Dashboard() {
  const [data, setData] = useState<{ metrics: AdminMetrics; gateway: { mode: string }; settings: any } | null>(null);
  const [days, setDays] = useState(30);
  const load = useCallback(() => api.get<any>(`/admin/metrics/overview?days=${days}`).then(setData).catch((e) => toast.error(e.message)), [days]);
  useEffect(() => {
    void load();
  }, [load]);

  const m = data?.metrics;
  return (
    <>
      <PageHead
        title="Overview"
        sub={`Last ${days} days · metrics computed from stored orders only`}
        actions={
          <>
            <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="h-10 w-32" aria-label="Range">
              <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option>
            </Select>
            <a href="/api/admin/exports/orders.csv" className="inline-flex h-10 items-center rounded-full border border-line bg-card px-4 text-sm font-medium hover:border-ink/40">Export orders CSV</a>
            <a href="/api/admin/exports/sales.csv" className="inline-flex h-10 items-center rounded-full border border-line bg-card px-4 text-sm font-medium hover:border-ink/40">Sales CSV</a>
          </>
        }
      />
      {data?.gateway.mode === 'simulated' && (
        <p className="mb-4 rounded-xl bg-warning-soft px-4 py-2.5 text-xs text-warning">Payments are running in <strong>simulated mode</strong> (no Razorpay credentials configured). Configure keys in Settings to go live.</p>
      )}
      {data?.settings?.fulfillment_enabled === false && (
        <p className="mb-4 rounded-xl bg-line-soft px-4 py-2.5 text-xs text-muted">Supplier fulfilment is <strong>disabled</strong>. Orders stay in-store until you enable fulfilment after testing supplier credentials (Settings → Fulfilment).</p>
      )}
      {!m ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Revenue (captured)', value: formatMoney(m.revenue_paise) },
              { label: 'Orders', value: String(m.orders_count) },
              { label: 'Average order value', value: formatMoney(m.aov_paise) },
              { label: 'Units sold', value: String(m.units_sold) },
            ].map((k) => (
              <Card key={k.label}>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{k.label}</p>
                <p className="mt-2 font-display text-3xl tabular-nums">{k.value}</p>
              </Card>
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <h2 className="font-semibold">Revenue by day</h2>
              <div className="mt-3"><Sparkline points={m.revenue_by_day} /></div>
            </Card>
            <Card>
              <h2 className="font-semibold">Best sellers (by units)</h2>
              {m.top_products.length === 0 ? (
                <p className="mt-4 text-sm text-muted">No sales recorded yet — this list fills in from real orders.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {m.top_products.map((p) => (
                    <li key={p.product_id} className="flex justify-between gap-3"><span className="truncate">{p.title}</span><span className="tabular-nums text-muted">{p.units} u · {formatMoney(p.revenue_paise)}</span></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card>
              <h2 className="font-semibold">Orders by status</h2>
              <ul className="mt-3 space-y-1.5 text-sm">
                {m.orders_by_status.length === 0 && <li className="text-muted">No orders yet.</li>}
                {m.orders_by_status.map((s) => (
                  <li key={s.status} className="flex justify-between"><StatusPill status={s.status} /><span className="tabular-nums">{s.count}</span></li>
                ))}
              </ul>
            </Card>
            <Card>
              <h2 className="font-semibold">Operations</h2>
              <ul className="mt-3 space-y-2 text-sm">
                <li className="flex justify-between"><span className="text-muted">Awaiting fulfilment</span><span className="tabular-nums font-medium">{m.pending_fulfillment}</span></li>
                <li className="flex justify-between"><span className="text-muted">Supplier failures</span><span className={clsx('tabular-nums font-medium', m.supplier_failures > 0 && 'text-danger')}>{m.supplier_failures}</span></li>
                <li className="flex justify-between"><span className="text-muted">New customers</span><span className="tabular-nums font-medium">{m.customers_count}</span></li>
                <li className="flex justify-between"><span className="text-muted">Store sessions</span><span className="tabular-nums font-medium">{m.conversion?.sessions ?? 0}</span></li>
                <li className="flex justify-between"><span className="text-muted">Conversion</span><span className="tabular-nums font-medium">{m.conversion ? `${(m.conversion.rate * 100).toFixed(1)}%` : '—'}</span></li>
              </ul>
            </Card>
            <Card>
              <h2 className="font-semibold">Low stock</h2>
              {m.low_stock.length === 0 ? (
                <p className="mt-3 text-sm text-muted">Nothing below its threshold.</p>
              ) : (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {m.low_stock.map((s) => (
                    <li key={s.variant_id} className="flex justify-between gap-2"><span className="truncate">{s.sku} · {s.title}</span><Badge tone={s.stock_qty === 0 ? 'danger' : 'warning'}>{s.stock_qty}</Badge></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------- orders ----------------------------------- */

function OrdersPage() {
  const [orders, setOrders] = useState<any[] | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const load = useCallback(() => api.get<{ orders: any[] }>(`/admin/orders?status=${status}&q=${encodeURIComponent(q)}`).then((d) => setOrders(d.orders)), [status, q]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <PageHead title="Orders" sub="Update status, trigger fulfilment, issue refunds" />
      <div className="mb-4 flex gap-2">
        <Input placeholder="Order number or email" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48" aria-label="Filter status">
          <option value="">All statuses</option>
          {['placed', 'payment_pending', 'payment_confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </Select>
      </div>
      {!orders ? <Skeleton className="h-64" /> : orders.length === 0 ? (
        <EmptyState title="No orders yet" body="Orders appear here the moment a customer checks out — including sample-flagged ones." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>{['Order', 'Date', 'Customer', 'Payment', 'Fulfilment', 'Status', 'Total'].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-line-soft/60">
                  <td className="px-4 py-3"><Link to={`/admin/orders/${o.id}`} className="font-medium hover:underline">{o.number}</Link>{o.is_sample === 1 && <Badge tone="warning" className="ml-2">sample</Badge>}</td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDateTime(o.placed_at)}</td>
                  <td className="px-4 py-3">{o.email}</td>
                  <td className="px-4 py-3"><StatusPill status={o.payment_status} /></td>
                  <td className="px-4 py-3"><StatusPill status={o.fulfillment_status} /></td>
                  <td className="px-4 py-3"><StatusPill status={o.status} /></td>
                  <td className="px-4 py-3 tabular-nums font-medium">{formatMoney(o.total_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function OrderDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [note, setNote] = useState('');
  const load = useCallback(() => api.get<any>(`/admin/orders/${id}`).then(setData), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const navigate = useNavigate();
  if (!data) return <Skeleton className="h-96" />;
  const order: Order = data.order;

  const setStatus = async (status: string) => {
    try {
      await api.post(`/admin/orders/${order.id}/status`, { status, note: note || null });
      toast.success(`Status → ${status}`);
      setNote('');
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed');
    }
  };

  return (
    <>
      <PageHead
        title={order.number}
        sub={`${formatDateTime(order.placed_at)} · ${order.email}${order.is_sample ? ' · SAMPLE ORDER' : ''}`}
        actions={<Button variant="secondary" size="sm" onClick={() => navigate('/admin/orders')}>Back</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="font-semibold">Items</h2>
          <ul className="mt-3 divide-y divide-line-soft text-sm">
            {order.items.map((i) => (
              <li key={i.id} className="flex gap-3 py-2.5">
                {i.image_url && <img src={i.image_url} alt="" className="size-12 rounded-lg object-cover" />}
                <span className="flex-1">{i.title} <span className="text-muted">· {i.variant_title} · {i.sku} · ×{i.qty}</span></span>
                <span className="tabular-nums">{formatMoney(i.total_paise)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{formatMoney(order.subtotal_paise)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Discount {order.coupon_code ?? ''}</dt><dd className="tabular-nums">−{formatMoney(order.discount_paise)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Shipping</dt><dd className="tabular-nums">{formatMoney(order.shipping_paise)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(order.total_paise)}</dd></div>
          </dl>
        </Card>
        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold">Update status</h2>
            <div className="mt-3 space-y-2">
              <Select value={order.status} onChange={(e) => setStatus(e.target.value)} aria-label="Order status">
                {['placed', 'payment_pending', 'payment_confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </Select>
              <Input placeholder="Note (optional, shown in timeline)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="secondary" onClick={() => api.post(`/admin/orders/${order.id}/fulfill`).then(() => { toast.success('Fulfilment triggered'); void load(); }).catch((e) => toast.error(e.message))}>Send to supplier</Button>
                <Button size="sm" variant="danger" onClick={async () => {
                  const amount = prompt('Refund amount in ₹ (blank = full)', String(order.total_paise / 100));
                  if (amount == null) return;
                  await api.post(`/admin/orders/${order.id}/refund`, { amountPaise: Math.round(Number(amount) * 100) || undefined });
                  toast.success('Refund initiated');
                  void load();
                }}>Refund</Button>
              </div>
            </div>
          </Card>
          <Card>
            <h2 className="font-semibold">Timeline</h2>
            <ul className="mt-3 space-y-2 text-xs">
              {order.status_events.map((e: any) => (
                <li key={e.id} className="flex justify-between gap-2"><span><StatusPill status={e.status} /> <span className="text-muted">{e.actor_type}</span></span><span className="text-muted whitespace-nowrap">{formatDateTime(e.created_at)}</span></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="font-semibold">Shipping address</h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">{order.shipping_address.full_name} · {order.shipping_address.phone}<br />{order.shipping_address.line1}{order.shipping_address.line2 ? `, ${order.shipping_address.line2}` : ''}<br />{order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.postal_code}</p>
        </Card>
        <Card>
          <h2 className="font-semibold">Payments</h2>
          <ul className="mt-2 space-y-2 text-xs">
            {data.payments.map((p: any) => (
              <li key={p.id} className="flex justify-between gap-2"><span>{p.provider} · {p.method ?? '—'} · <code className="text-muted">{p.provider_payment_id ?? p.provider_order_id ?? ''}</code></span><StatusPill status={p.status} /></li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="font-semibold">Supplier orders</h2>
          {data.supplier_orders.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Not sent to a supplier yet.</p>
          ) : (
            <ul className="mt-2 space-y-3 text-xs">
              {data.supplier_orders.map((s: any) => (
                <li key={s.id} className="rounded-xl border border-line-soft p-3">
                  <div className="flex justify-between"><code>{s.external_ref ?? s.idempotency_key}</code><StatusPill status={s.status} /></div>
                  <p className="mt-1 text-muted">attempts {s.attempts}{s.last_error ? ` · last error: ${s.last_error}` : ''}</p>
                  {['failed', 'retrying'].includes(s.status) && (
                    <Button size="sm" variant="secondary" className="mt-2" onClick={() => api.post(`/admin/supplier-orders/${s.id}/retry`).then(() => { toast.success('Retry queued'); void load(); })}>Retry now</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

/* ------------------------------- products --------------------------------- */

function ProductsPage() {
  const [products, setProducts] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const load = useCallback(() => api.get<{ products: any[] }>(`/admin/products?q=${encodeURIComponent(q)}`).then((d) => setProducts(d.products)), [q]);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const title = prompt('Product title');
    if (!title) return;
    setCreating(true);
    try {
      const res = await api.post<{ id: string }>('/admin/products', { title, base_price_paise: 0, status: 'draft', description_md: '', highlights: [] });
      navigate(`/admin/products/${res.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <PageHead title="Products" sub="Create, price, publish and archive catalogue items" actions={<Button onClick={create} loading={creating}>New product</Button>} />
      <Input placeholder="Search catalogue" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-xs" />
      {!products ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><tr>{['Product', 'Status', 'Category', 'Price', 'Stock', 'Sample', ''].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-soft">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-line-soft/60">
                  <td className="px-4 py-3 font-medium">{p.title}<span className="block text-xs text-muted">/{p.slug}</span></td>
                  <td className="px-4 py-3"><StatusPill status={p.status} /></td>
                  <td className="px-4 py-3 text-muted">{p.category_name ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{formatMoney(p.base_price_paise)}</td>
                  <td className="px-4 py-3 tabular-nums">{p.total_stock}</td>
                  <td className="px-4 py-3">{p.is_sample ? <Badge tone="warning">sample</Badge> : '—'}</td>
                  <td className="px-4 py-3"><Link className="text-accent underline underline-offset-2" to={`/admin/products/${p.id}`}>Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ProductEditPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [variantModal, setVariantModal] = useState(false);
  const [variant, setVariant] = useState<any>({ sku: '', title: '', stock_qty: 0, cost_paise: null, price_paise: null, options: {} });
  const load = useCallback(() => api.get<any>(`/admin/products/${id}`).then((d) => { setData(d); setForm({ ...d.product, highlights: d.product.highlights.join('\n') }); }), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data || !form) return <Skeleton className="h-96" />;

  const save = async () => {
    try {
      await api.patch(`/admin/products/${id}`, { ...form, highlights: String(form.highlights).split('\n').filter(Boolean) });
      toast.success('Product saved');
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    }
  };

  return (
    <>
      <PageHead title={data.product.title} sub={`/${data.product.slug}`} actions={<Button onClick={save}>Save changes</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="space-y-3">
            <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Tagline"><Input value={form.tagline ?? ''} onChange={(e) => setForm({ ...form, tagline: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="draft">draft</option><option value="active">active</option><option value="archived">archived</option></Select></Field>
              <Field label="Featured rank"><Input type="number" value={form.featured_rank ?? ''} onChange={(e) => setForm({ ...form, featured_rank: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <Field label="Base price (₹)"><Input type="number" step="0.01" value={(form.base_price_paise / 100).toFixed(2)} onChange={(e) => setForm({ ...form, base_price_paise: Math.round(Number(e.target.value) * 100) })} /></Field>
              <Field label="Compare-at (₹)"><Input type="number" step="0.01" value={form.compare_at_price_paise != null ? (form.compare_at_price_paise / 100).toFixed(2) : ''} onChange={(e) => setForm({ ...form, compare_at_price_paise: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} /></Field>
            </div>
            <Field label="Description (markdown)"><Textarea value={form.description_md} onChange={(e) => setForm({ ...form, description_md: e.target.value })} className="min-h-40" /></Field>
            <Field label="Highlights (one per line)"><Textarea value={form.highlights} onChange={(e) => setForm({ ...form, highlights: e.target.value })} className="min-h-24" /></Field>
            <Field label="Meta title"><Input value={form.meta_title ?? ''} onChange={(e) => setForm({ ...form, meta_title: e.target.value })} /></Field>
            <Field label="Meta description"><Textarea value={form.meta_description ?? ''} onChange={(e) => setForm({ ...form, meta_description: e.target.value })} className="min-h-16" /></Field>
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between"><h2 className="font-semibold">Variants & pricing</h2><Button size="sm" variant="secondary" onClick={() => setVariantModal(true)}>Add variant</Button></div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted"><tr>{['SKU', 'Options', 'Price ₹', 'Cost ₹', 'Stock', 'Active', ''].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line-soft">
                  {data.variants.map((v: any) => (
                    <tr key={v.id}>
                      <td className="py-2 pr-3 font-mono">{v.sku}</td>
                      <td className="py-2 pr-3">{Object.entries(v.options).map(([k, val]) => `${k}:${val}`).join(' ')}</td>
                      <td className="py-2 pr-3"><input className="w-20 rounded border border-line px-1.5 py-0.5" type="number" step="0.01" defaultValue={v.price_paise != null ? (v.price_paise / 100).toFixed(2) : ''} onBlur={(e) => api.patch(`/admin/variants/${v.id}`, { price_paise: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) }).then(() => toast.success('Variant updated'))} /></td>
                      <td className="py-2 pr-3 text-muted">{v.cost_paise != null ? (v.cost_paise / 100).toFixed(0) : '—'}</td>
                      <td className="py-2 pr-3"><input className="w-14 rounded border border-line px-1.5 py-0.5" type="number" defaultValue={v.stock_qty} onBlur={(e) => api.patch(`/admin/variants/${v.id}`, { stock_qty: Number(e.target.value) }).then(() => toast.success('Stock updated'))} /></td>
                      <td className="py-2 pr-3"><input type="checkbox" defaultChecked={v.is_active} onChange={(e) => api.patch(`/admin/variants/${v.id}`, { is_active: e.target.checked })} /></td>
                      <td className="py-2">{v.supplier_variant_ref && <Badge tone="accent">{v.supplier_variant_ref}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <h2 className="font-semibold">Images</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.images.map((img: any) => (
                <div key={img.id} className="relative">
                  <img src={img.url} alt={img.alt_text} className="size-20 rounded-lg object-cover" />
                  <button className="absolute -right-1.5 -top-1.5 rounded-full bg-danger px-1.5 text-xs text-white" onClick={() => api.delete(`/admin/images/${img.id}`).then(() => { void load(); })} aria-label="Remove image">×</button>
                </div>
              ))}
            </div>
            <form className="mt-3 flex gap-2" onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              await api.post(`/admin/products/${id}/images`, { url: fd.get('url'), alt_text: fd.get('alt') });
              toast.success('Image added');
              void load();
            }}>
              <Input name="url" placeholder="/media/products/file.jpg" required className="h-9" />
              <Input name="alt" placeholder="Alt text" className="h-9" />
              <Button size="sm" type="submit">Add</Button>
            </form>
          </Card>
          <Card>
            <h2 className="font-semibold">Supplier mapping</h2>
            {data.supplierLinks.length === 0 ? <p className="mt-2 text-sm text-muted">Not mapped to a supplier yet — map from Suppliers → Catalogue.</p> : (
              <ul className="mt-2 space-y-1.5 text-xs">
                {data.supplierLinks.map((l: any) => <li key={l.id}><code>{l.external_id}</code> → {l.store_sku} <span className="text-muted">({l.supplier_code})</span></li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal open={variantModal} onClose={() => setVariantModal(false)} title="Add variant">
        <div className="space-y-3">
          <Field label="SKU"><Input value={variant.sku} onChange={(e) => setVariant({ ...variant, sku: e.target.value })} placeholder="OJ-XXX-001" /></Field>
          <Field label="Option (e.g. Colour: Charcoal)">
            <div className="flex gap-2">
              <Input id="optk" placeholder="Colour" value={variant.optKey ?? ''} onChange={(e) => setVariant({ ...variant, optKey: e.target.value })} />
              <Input placeholder="Charcoal" value={variant.optVal ?? ''} onChange={(e) => setVariant({ ...variant, optVal: e.target.value })} />
            </div>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Stock"><Input type="number" value={variant.stock_qty} onChange={(e) => setVariant({ ...variant, stock_qty: Number(e.target.value) })} /></Field>
            <Field label="Price ₹"><Input type="number" step="0.01" value={variant.price_paise ?? ''} onChange={(e) => setVariant({ ...variant, price_paise: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} /></Field>
            <Field label="Cost ₹"><Input type="number" step="0.01" value={variant.cost_paise ?? ''} onChange={(e) => setVariant({ ...variant, cost_paise: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} /></Field>
          </div>
          <Button
            onClick={async () => {
              try {
                await api.post(`/admin/products/${id}/variants`, {
                  sku: variant.sku,
                  title: variant.optVal ?? '',
                  options: variant.optKey ? { [variant.optKey]: variant.optVal ?? '' } : {},
                  stock_qty: variant.stock_qty,
                  price_paise: variant.price_paise,
                  cost_paise: variant.cost_paise,
                });
                toast.success('Variant added');
                setVariantModal(false);
                void load();
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : 'Failed');
              }
            }}
          >Create variant</Button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------- customers / coupons ---------------------- */

function CustomersPage() {
  const [customers, setCustomers] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    api.get<{ customers: any[] }>(`/admin/customers?q=${encodeURIComponent(q)}`).then((d) => setCustomers(d.customers));
  }, [q]);
  return (
    <>
      <PageHead title="Customers" sub="Accounts, order counts and lifetime value" />
      <Input placeholder="Search email or name" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-xs" />
      {!customers ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><tr>{['Customer', 'Role', 'Orders', 'Lifetime value', 'Marketing consent', 'Joined'].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-soft">
              {customers.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">{c.first_name} {c.last_name}<span className="block text-xs text-muted">{c.email}</span></td>
                  <td className="px-4 py-3"><Badge>{c.role}</Badge></td>
                  <td className="px-4 py-3 tabular-nums">{c.orders_count}</td>
                  <td className="px-4 py-3 tabular-nums">{formatMoney(c.lifetime_paise)}</td>
                  <td className="px-4 py-3">{c.marketing_consent ? <Badge tone="success">opted in</Badge> : <Badge>none</Badge>}</td>
                  <td className="px-4 py-3 text-muted">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CouponsPage() {
  const [coupons, setCoupons] = useState<any[] | null>(null);
  const load = () => api.get<{ coupons: any[] }>('/admin/coupons').then((d) => setCoupons(d.coupons));
  useEffect(() => {
    void load();
  }, []);
  const [form, setForm] = useState({ code: '', type: 'percent', value: 10, description: '' });
  return (
    <>
      <PageHead title="Coupons" sub="Percent, fixed-amount and free-shipping codes" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {!coupons ? <Skeleton className="h-64" /> : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><tr>{['Code', 'Type', 'Value', 'Used', 'Active', ''].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line-soft">
                {coupons.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-mono font-medium">{c.code}<span className="block font-sans text-xs text-muted">{c.description}</span></td>
                    <td className="px-4 py-3">{c.type}</td>
                    <td className="px-4 py-3 tabular-nums">{c.type === 'percent' ? `${c.value}%` : c.type === 'fixed' ? formatMoney(c.value) : 'free ship'}</td>
                    <td className="px-4 py-3 tabular-nums">{c.used_count}{c.usage_limit ? ` / ${c.usage_limit}` : ''}</td>
                    <td className="px-4 py-3"><input type="checkbox" defaultChecked={c.is_active} onChange={(e) => api.patch(`/admin/coupons/${c.id}`, { is_active: e.target.checked }).then(() => void load())} /></td>
                    <td className="px-4 py-3 text-xs text-muted">{c.ends_at ? `ends ${formatDate(c.ends_at)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Card className="h-fit">
          <h2 className="font-semibold">Create coupon</h2>
          <div className="mt-3 space-y-3">
            <Field label="Code"><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SPRING15" /></Field>
            <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="percent">percent</option><option value="fixed">fixed ₹</option><option value="free_shipping">free shipping</option></Select></Field>
            <Field label="Value"><Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} /></Field>
            <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Button onClick={async () => {
              try {
                await api.post('/admin/coupons', { ...form, value: form.type === 'fixed' ? Math.round(form.value * 100) : form.value });
                toast.success('Coupon created');
                setForm({ code: '', type: 'percent', value: 10, description: '' });
                void load();
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : 'Failed');
              }
            }}>Create</Button>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------- suppliers -------------------------------- */

function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<any[] | null>(null);
  const [catalogue, setCatalogue] = useState<any[] | null>(null);
  const [variants, setVariants] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.get<{ suppliers: any[] }>('/admin/suppliers').then((d) => setSuppliers(d.suppliers));
  useEffect(() => {
    void load();
    api.get<{ products: any[] }>('/admin/products').then(async (d) => {
      const all: any[] = [];
      for (const p of d.products.slice(0, 30)) {
        const detail = await api.get<any>(`/admin/products/${p.id}`);
        detail.variants.forEach((v: any) => all.push({ id: v.id, label: `${p.title} — ${v.sku}` }));
      }
      setVariants(all);
    });
  }, []);

  const act = async (supplierId: string, action: string) => {
    setBusy(`${supplierId}:${action}`);
    try {
      const res = await api.post<any>(`/admin/suppliers/${supplierId}/sync/${action}`);
      toast.success(`${action}: ${JSON.stringify(res.result)}`);
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead title="Suppliers" sub="Modular integration layer — adapters, sync jobs, fulfilment retries" />
      {!suppliers ? <Skeleton className="h-64" /> : suppliers.length === 0 ? (
        <EmptyState title="No suppliers configured" body="Add a supplier adapter (mock for testing, http_json for a real REST API) to start importing catalogue, stock and prices." />
      ) : (
        <div className="space-y-4">
          {suppliers.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-semibold text-lg">{s.name}</h2>
                <Badge tone={s.adapter_type === 'mock' ? 'warning' : 'accent'}>{s.adapter_type}</Badge>
                {s.is_active ? <Badge tone="success">active</Badge> : <Badge>disabled</Badge>}
                <span className="ml-auto flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" loading={busy === `${s.id}:test`} onClick={() => api.post<{ ok: boolean; message: string }>(`/admin/suppliers/${s.id}/test`).then((r) => toast.info(r.message))}>Health check</Button>
                  <Button size="sm" variant="secondary" loading={busy === `${s.id}:catalog`} onClick={() => act(s.id, 'catalog')}>Sync catalogue</Button>
                  <Button size="sm" variant="secondary" loading={busy === `${s.id}:stock`} onClick={() => act(s.id, 'stock')}>Sync stock</Button>
                  <Button size="sm" variant="secondary" loading={busy === `${s.id}:prices`} onClick={() => act(s.id, 'prices')}>Sync prices</Button>
                  <Button size="sm" variant="secondary" loading={busy === `${s.id}:fulfillment`} onClick={() => act(s.id, 'fulfillment')}>Process fulfilment</Button>
                  <Button size="sm" variant="secondary" loading={busy === `${s.id}:tracking`} onClick={() => act(s.id, 'tracking')}>Sync tracking</Button>
                </span>
              </div>
              {s.notes && <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">{s.notes}</p>}
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                <div><dt className="text-muted">Mapped variants</dt><dd className="font-medium tabular-nums">{s.mapped_variants}</dd></div>
                <div><dt className="text-muted">Supplier orders</dt><dd className="font-medium tabular-nums">{s.orders_count}</dd></div>
                <div><dt className="text-muted">Failed</dt><dd className={clsx('font-medium tabular-nums', s.orders_failed > 0 && 'text-danger')}>{s.orders_failed}</dd></div>
                <div><dt className="text-muted">Fulfilment</dt><dd>{s.supports_fulfillment ? 'supported' : '—'}</dd></div>
                <div><dt className="text-muted">Last sync</dt><dd className="text-xs">{s.last_sync ? `${s.last_sync.job} · ${s.last_sync.status}` : 'never'}</dd></div>
              </dl>
              <button className="mt-3 text-xs text-accent underline underline-offset-2" onClick={() => api.get<{ items: any[] }>(`/admin/supplier-products?supplierId=${s.id}`).then((d) => setCatalogue(d.items))}>View imported catalogue & mappings</button>
            </Card>
          ))}
        </div>
      )}

      {catalogue && (
        <Card className="mt-4">
          <h2 className="font-semibold">Imported supplier catalogue</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted"><tr>{['External ID', 'Title', 'Supplier price', 'Supplier stock', 'Mapped store variant', 'Last sync'].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line-soft">
                {catalogue.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-3 font-mono">{c.external_id}</td>
                    <td className="py-2 pr-3">{c.title}</td>
                    <td className="py-2 pr-3 tabular-nums">{c.price_paise != null ? formatMoney(c.price_paise) : '—'}</td>
                    <td className="py-2 pr-3 tabular-nums">{c.stock_qty ?? '—'}</td>
                    <td className="py-2 pr-3">
                      <select
                        className="rounded border border-line bg-card px-2 py-1"
                        value={c.store_variant_id ?? ''}
                        onChange={(e) => api.post(`/admin/supplier-products/${c.id}/map`, { variantId: e.target.value || null }).then(() => { toast.success('Mapping saved'); setCatalogue(null); })}
                      >
                        <option value="">— unmapped —</option>
                        {variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3 text-muted">{c.last_synced_at ? formatDateTime(c.last_synced_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function StockPage() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => {
    api.get<{ items: any[] }>('/admin/stock').then((d) => setItems(d.items));
  }, []);
  return (
    <>
      <PageHead title="Stock & supplier availability" sub="Store stock vs last synced supplier availability" />
      {!items ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><tr>{['SKU', 'Product', 'Store stock', 'Supplier stock', 'Threshold', 'Supplier', 'Last sync'].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-soft">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3 font-mono text-xs">{i.sku}</td>
                  <td className="px-4 py-3">{i.product_title}<span className="block text-xs text-muted">{i.title}</span></td>
                  <td className="px-4 py-3"><Badge tone={i.stock_qty === 0 ? 'danger' : i.stock_qty <= i.low_stock_threshold ? 'warning' : 'success'}>{i.stock_qty}</Badge></td>
                  <td className="px-4 py-3 tabular-nums text-muted">{i.supplier_stock ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-muted">{i.low_stock_threshold}</td>
                  <td className="px-4 py-3 text-xs">{i.supplier_code ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted">{i.last_synced_at ? formatDateTime(i.last_synced_at) : 'never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ReturnsPage() {
  const [returns, setReturns] = useState<any[] | null>(null);
  const load = () => api.get<{ returns: any[] }>('/admin/returns').then((d) => setReturns(d.returns));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <PageHead title="Returns & refunds" sub="Approve, track pickup and issue refunds" />
      {!returns ? <Skeleton className="h-64" /> : returns.length === 0 ? (
        <EmptyState title="No return requests" body="Customers can request returns on delivered orders; requests land here." />
      ) : (
        <div className="space-y-3">
          {returns.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">{r.order_number}</span>
                <StatusPill status={r.status} />
                <span className="text-muted">{r.email}</span>
                <span className="ml-auto text-xs text-muted">{formatDateTime(r.created_at)}</span>
              </div>
              <p className="mt-2 text-sm"><strong>{r.reason}</strong>{r.description ? ` — ${r.description}` : ''}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {['approved', 'picked_up', 'received', 'refunded', 'rejected', 'closed'].map((s) => (
                  <Button key={s} size="sm" variant={s === 'refunded' ? 'accent' : s === 'rejected' ? 'danger' : 'secondary'} onClick={() => api.patch(`/admin/returns/${r.id}`, { status: s }).then(() => { toast.success(`Return ${s}`); void load(); })}>{s}</Button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function ReviewsPage() {
  const [reviews, setReviews] = useState<any[] | null>(null);
  const [status, setStatus] = useState('pending');
  const load = useCallback(() => api.get<{ reviews: any[] }>(`/admin/reviews?status=${status}`).then((d) => setReviews(d.reviews)), [status]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <PageHead title="Review moderation" sub="Verified-purchase reviews publish automatically; others wait here" actions={
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Filter"><option value="pending">pending</option><option value="published">published</option><option value="rejected">rejected</option><option value="">all</option></Select>
      } />
      {!reviews ? <Skeleton className="h-64" /> : reviews.length === 0 ? <EmptyState title="Nothing to moderate" /> : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">{r.product_title}</span>
                <Badge tone="accent">{'★'.repeat(r.rating)}</Badge>
                {r.is_verified_purchase ? <Badge tone="success">verified purchase</Badge> : <Badge tone="warning">unverified</Badge>}
                <StatusPill status={r.status} />
              </div>
              {r.title && <p className="mt-2 font-medium">{r.title}</p>}
              <p className="mt-1 text-sm text-ink-soft">{r.body}</p>
              <p className="mt-1 text-xs text-muted">{r.author_name} · {formatDateTime(r.created_at)}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="accent" onClick={() => api.patch(`/admin/reviews/${r.id}`, { status: 'published' }).then(() => void load())}>Publish</Button>
                <Button size="sm" variant="danger" onClick={() => api.patch(`/admin/reviews/${r.id}`, { status: 'rejected' }).then(() => void load())}>Reject</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------- content / settings / audit --------------- */

function ContentAdminPage() {
  const [pages, setPages] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [messages, setMessages] = useState<any[] | null>(null);
  useEffect(() => {
    api.get<{ pages: any[] }>('/admin/pages').then((d) => setPages(d.pages));
    api.get<{ messages: any[] }>('/admin/messages').then((d) => setMessages(d.messages));
  }, []);
  useEffect(() => {
    if (selected && pages) setDraft({ ...pages.find((p) => p.slug === selected) });
  }, [selected, pages]);

  return (
    <>
      <PageHead title="Content & policies" sub="Editable templates — sections needing legal review are flagged" />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <h2 className="font-semibold">Pages</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {pages?.map((p) => (
              <li key={p.slug}>
                <button className={clsx('w-full rounded-lg px-3 py-2 text-left hover:bg-line-soft', selected === p.slug && 'bg-line-soft font-medium')} onClick={() => setSelected(p.slug)}>
                  {p.title} {p.requires_legal_review === 1 && <Badge tone="warning" className="ml-1">legal review</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          {draft && (
            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">{draft.title}</h2>
                <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={draft.requires_legal_review === 1} onChange={(e) => setDraft({ ...draft, requires_legal_review: e.target.checked ? 1 : 0 })} /> needs legal review</label>
              </div>
              <Textarea value={draft.body_md} onChange={(e) => setDraft({ ...draft, body_md: e.target.value })} className="mt-3 min-h-96 font-mono text-xs" />
              <Button className="mt-3" onClick={() => api.patch(`/admin/pages/${draft.slug}`, { body_md: draft.body_md, requires_legal_review: draft.requires_legal_review === 1 }).then(() => { toast.success('Page saved'); api.get<{ pages: any[] }>('/admin/pages').then((d) => setPages(d.pages)); })}>Save page</Button>
            </Card>
          )}
          <Card>
            <h2 className="font-semibold">Contact messages</h2>
            {!messages?.length ? <p className="mt-2 text-sm text-muted">No messages yet.</p> : (
              <ul className="mt-2 space-y-3 text-sm">
                {messages.map((m) => (
                  <li key={m.id} className="rounded-xl border border-line-soft p-3">
                    <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{m.name} · {m.email}</span><StatusPill status={m.status === 'new' ? 'pending' : m.status} /></div>
                    {m.subject && <p className="mt-1 text-xs font-medium text-muted">{m.subject}</p>}
                    <p className="mt-1 text-ink-soft">{m.body}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => api.patch(`/admin/messages/${m.id}`, { status: 'replied' }).then(() => api.get<{ messages: any[] }>('/admin/messages').then((d) => setMessages(d.messages)))}>Mark replied</Button>
                      <Button size="sm" variant="ghost" onClick={() => api.patch(`/admin/messages/${m.id}`, { status: 'closed' }).then(() => api.get<{ messages: any[] }>('/admin/messages').then((d) => setMessages(d.messages)))}>Close</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function SettingsPage() {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const load = () => api.get<any>('/admin/settings').then((d) => { setData(d); setForm({ ...d.settings }); });
  useEffect(() => {
    void load();
  }, []);
  if (!data || !form) return <Skeleton className="h-96" />;
  return (
    <>
      <PageHead title="Settings" sub="Store identity, commerce rules, fulfilment and shipping" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Store</h2>
          <div className="mt-3 space-y-3">
            <Field label="Store name"><Input value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} /></Field>
            <Field label="Tagline"><Input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Support email"><Input value={form.support_email} onChange={(e) => setForm({ ...form, support_email: e.target.value })} /></Field>
              <Field label="Support phone"><Input value={form.support_phone} onChange={(e) => setForm({ ...form, support_phone: e.target.value })} /></Field>
            </div>
            <Field label="Announcement bar"><Input value={form.announcement_text ?? ''} onChange={(e) => setForm({ ...form, announcement_text: e.target.value })} /></Field>
          </div>
        </Card>
        <Card>
          <h2 className="font-semibold">Commerce rules</h2>
          <div className="mt-3 space-y-3">
            <Field label="Free shipping over (₹, blank = never)"><Input type="number" value={form.free_shipping_over_paise != null ? form.free_shipping_over_paise / 100 : ''} onChange={(e) => setForm({ ...form, free_shipping_over_paise: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.cod_enabled} onChange={(e) => setForm({ ...form, cod_enabled: e.target.checked })} /> Enable Cash on Delivery</label>
            <Field label="COD max order value (₹)"><Input type="number" value={form.cod_max_amount_paise / 100} onChange={(e) => setForm({ ...form, cod_max_amount_paise: Math.round(Number(e.target.value) * 100) })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.reviews_require_purchase} onChange={(e) => setForm({ ...form, reviews_require_purchase: e.target.checked })} /> Reviews require a delivered order</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.fulfillment_enabled} onChange={(e) => setForm({ ...form, fulfillment_enabled: e.target.checked })} /> Auto-send paid orders to suppliers (enable only after testing)</label>
          </div>
        </Card>
      </div>
      <Button className="mt-4" onClick={() => api.patch('/admin/settings', form).then(() => { toast.success('Settings saved'); void load(); }).catch((e) => toast.error(e.message))}>Save settings</Button>

      <Card className="mt-4">
        <h2 className="font-semibold">Integrations status</h2>
        <ul className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <li className="rounded-xl border border-line-soft p-3"><span className="block text-muted text-xs">Payments</span>{data.gateway.mode === 'live' ? <Badge tone="success">Razorpay live</Badge> : <Badge tone="warning">simulated — keys missing</Badge>}</li>
          <li className="rounded-xl border border-line-soft p-3"><span className="block text-muted text-xs">Email</span><Badge>{import.meta.env.DEV ? 'console (dev)' : 'configured provider'}</Badge></li>
          <li className="rounded-xl border border-line-soft p-3"><span className="block text-muted text-xs">Fulfilment</span>{form.fulfillment_enabled ? <Badge tone="success">enabled</Badge> : <Badge>disabled</Badge>}</li>
        </ul>
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold">Shipping methods</h2>
        <div className="mt-3 space-y-3">
          {data.shipping_methods.map((m: any) => (
            <div key={m.id} className="grid gap-2 rounded-xl border border-line-soft p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center text-sm">
              <span className="font-medium">{m.name}<span className="block text-xs text-muted">{m.description}</span></span>
              <span className="tabular-nums text-muted">{formatMoney(m.price_paise)}</span>
              <span className="text-xs text-muted">{m.min_days}–{m.max_days} days</span>
              <span className="flex gap-2 text-xs">
                {m.cod_available && <Badge tone="accent">COD</Badge>}
                {m.is_active ? <Badge tone="success">active</Badge> : <Badge>off</Badge>}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function AuditPage() {
  const [entries, setEntries] = useState<any[] | null>(null);
  const [emails, setEmails] = useState<any[] | null>(null);
  const [tab, setTab] = useState<'audit' | 'emails' | 'syncs'>('audit');
  const [syncs, setSyncs] = useState<any[] | null>(null);
  useEffect(() => {
    api.get<{ entries: any[] }>('/admin/audit').then((d) => setEntries(d.entries));
    api.get<{ emails: any[] }>('/admin/emails').then((d) => setEmails(d.emails));
    api.get<{ runs: any[] }>('/admin/sync-runs').then((d) => setSyncs(d.runs));
  }, []);
  return (
    <>
      <PageHead title="Audit & operations" sub="Admin actions, transactional email log, supplier sync runs" />
      <div className="mb-4 flex gap-1">
        {(['audit', 'emails', 'syncs'] as const).map((t) => (
          <button key={t} className={clsx('rounded-full px-4 py-2 text-sm font-medium', tab === t ? 'bg-ink text-paper' : 'hover:bg-line-soft')} onClick={() => setTab(t)}>{t === 'syncs' ? 'Sync runs' : t}</button>
        ))}
      </div>
      {tab === 'audit' && (!entries ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-xs">
            <thead className="border-b border-line text-left uppercase tracking-wide text-muted"><tr>{['When', 'Actor', 'Action', 'Entity', 'After'].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-soft">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-muted">{formatDateTime(e.created_at)}</td>
                  <td className="px-4 py-2">{e.actor_type}</td>
                  <td className="px-4 py-2 font-mono">{e.action}</td>
                  <td className="px-4 py-2">{e.entity_type} <span className="text-muted">{e.entity_id?.slice(0, 8)}</span></td>
                  <td className="px-4 py-2 max-w-md truncate text-muted">{e.after_json ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {tab === 'emails' && (!emails ? <Skeleton className="h-64" /> : emails.length === 0 ? <EmptyState title="No emails logged" /> : (
        <div className="space-y-2">
          {emails.map((e) => (
            <Card key={e.id} className="p-4">
              <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{e.subject}</span><StatusPill status={e.status === 'sent' ? 'delivered' : e.status} /></div>
              <p className="text-xs text-muted">to {e.to_email} · template {e.template} · {formatDateTime(e.created_at)}</p>
            </Card>
          ))}
        </div>
      ))}
      {tab === 'syncs' && (!syncs ? <Skeleton className="h-64" /> : syncs.length === 0 ? <EmptyState title="No sync runs yet" body="Trigger syncs from the Suppliers page." /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-xs">
            <thead className="border-b border-line text-left uppercase tracking-wide text-muted"><tr>{['Job', 'Status', 'Started', 'Processed', 'Failed', 'Error'].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-soft">
              {syncs.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-mono">{s.job}</td>
                  <td className="px-4 py-2"><StatusPill status={s.status === 'success' ? 'delivered' : s.status} /></td>
                  <td className="px-4 py-2 whitespace-nowrap text-muted">{formatDateTime(s.started_at)}</td>
                  <td className="px-4 py-2 tabular-nums">{s.items_processed}</td>
                  <td className="px-4 py-2 tabular-nums">{s.items_failed}</td>
                  <td className="px-4 py-2 max-w-sm truncate text-muted">{s.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
