import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useWishlist } from '@/store/wishlist';
import { toast } from '@/store/toast';
import { formatDateTime, formatMoney, usePageMeta } from '@/lib/format';
import { Badge, Button, Checkbox, EmptyState, Field, Input, LinkButton, StatusPill } from '@/components/ui';
import type { Address, Order } from '@shared/types';
import clsx from 'clsx';

/* ------------------------------- Auth pages ------------------------------- */

export function LoginPage() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePageMeta('Sign in — Ojas');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/account/orders');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-page max-w-md py-16">
      <h1 className="font-display text-4xl">Welcome back</h1>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-line bg-card p-6 shadow-card">
        <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
        <Field label="Password"><Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
        <div className="flex justify-between text-xs">
          <Link to="/account/register" className="text-accent-dark underline underline-offset-4">Create an account</Link>
          <Link to="/account/forgot" className="text-muted underline underline-offset-4">Forgot password?</Link>
        </div>
      </form>
    </div>
  );
}

export function RegisterPage() {
  const register = useAuth((s) => s.register);
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', marketingConsent: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePageMeta('Create account — Ojas');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form);
      navigate('/account/orders');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-page max-w-md py-16">
      <h1 className="font-display text-4xl">Create your account</h1>
      <p className="mt-1 text-sm text-muted">Order history, saved addresses, wishlist and faster checkout.</p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-line bg-card p-6 shadow-card">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoComplete="given-name" /></Field>
          <Field label="Last name"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} autoComplete="family-name" /></Field>
        </div>
        <Field label="Email"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></Field>
        <Field label="Password" hint="At least 8 characters"><Input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></Field>
        <Checkbox label="Email me occasional product updates (optional)." checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} />
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>Create account</Button>
      </form>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  usePageMeta('Reset password — Ojas');
  return (
    <div className="container-page max-w-md py-16">
      <h1 className="font-display text-4xl">Reset password</h1>
      {sent ? (
        <p className="mt-6 rounded-2xl bg-success-soft px-4 py-3 text-sm text-success">If an account exists for that email, a reset link is on its way. In development the link is printed to the server log and stored in Admin → Emails.</p>
      ) : (
        <form
          className="mt-6 space-y-4 rounded-2xl border border-line bg-card p-6 shadow-card"
          onSubmit={async (e) => {
            e.preventDefault();
            await api.post('/auth/password/forgot', { email });
            setSent(true);
          }}
        >
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" className="w-full">Send reset link</Button>
        </form>
      )}
    </div>
  );
}

export function ResetPasswordPage() {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  usePageMeta('Choose a new password — Ojas');
  return (
    <div className="container-page max-w-md py-16">
      <h1 className="font-display text-4xl">Choose a new password</h1>
      {done ? (
        <p className="mt-6 rounded-2xl bg-success-soft px-4 py-3 text-sm text-success">Password updated. <Link className="underline" to="/account/login">Sign in</Link></p>
      ) : (
        <form
          className="mt-6 space-y-4 rounded-2xl border border-line bg-card p-6 shadow-card"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post('/auth/password/reset', { token, password });
              setDone(true);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Reset failed');
            }
          }}
        >
          <Field label="New password" hint="At least 8 characters"><Input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
          <Button type="submit" className="w-full">Update password</Button>
        </form>
      )}
    </div>
  );
}

/* ------------------------------- Account shell ---------------------------- */

export function AccountLayout() {
  const user = useAuth((s) => s.user);
  const initialised = useAuth((s) => s.initialised);
  const navigate = useNavigate();
  useEffect(() => {
    if (initialised && !user) navigate('/account/login');
  }, [initialised, user, navigate]);
  if (!user) return null;

  const tabs: [string, string][] = [
    ['/account/orders', 'Orders'],
    ['/account/addresses', 'Addresses'],
    ['/account/wishlist', 'Wishlist'],
    ['/account/profile', 'Profile'],
  ];
  return (
    <div className="container-page py-10">
      <h1 className="font-display text-4xl">Your account</h1>
      <p className="mt-1 text-sm text-muted">{user.email}</p>
      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Account">
        {tabs.map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => clsx('whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors', isActive ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-8"><Outlet /></div>
    </div>
  );
}

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  usePageMeta('Your orders — Ojas');
  useEffect(() => {
    api.get<{ orders: Order[] }>('/orders').then((d) => setOrders(d.orders)).catch(() => setOrders([]));
  }, []);
  if (!orders) return <EmptyState title="Loading your orders…" />;
  if (!orders.length) return <EmptyState title="No orders yet" body="When you place an order it will appear here with live status and tracking." action={<LinkButton to="/shop" variant="accent">Start shopping</LinkButton>} />;
  return (
    <ul className="space-y-4">
      {orders.map((o) => (
        <li key={o.id} className="rounded-2xl border border-line bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-center gap-3">
            <Link to={`/account/orders/${o.id}`} className="font-semibold hover:underline">{o.number}</Link>
            <StatusPill status={o.status} />
            <span className="text-xs text-muted">{formatDateTime(o.placed_at)}</span>
            <span className="ml-auto font-semibold tabular-nums">{formatMoney(o.total_paise)}</span>
          </div>
          <p className="mt-2 text-sm text-muted">{o.items.map((i) => `${i.title} × ${i.qty}`).join(', ')}</p>
          <div className="mt-3 flex gap-2">
            <LinkButton to={`/account/orders/${o.id}`} size="sm" variant="secondary">Details & tracking</LinkButton>
            <LinkButton to="/track" size="sm" variant="ghost">Track</LinkButton>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [returnReason, setReturnReason] = useState('');
  usePageMeta('Order details — Ojas');
  useEffect(() => {
    if (id) api.get<{ order: Order }>(`/orders/${id}`).then((d) => setOrder(d.order)).catch(() => setOrder(null));
  }, [id]);
  if (!order) return <EmptyState title="Order not found" />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-3xl">{order.number}</h2>
        <StatusPill status={order.status} />
        <span className="text-sm text-muted">{formatDateTime(order.placed_at)}</span>
      </div>
      <ul className="divide-y divide-line-soft rounded-2xl border border-line bg-card">
        {order.items.map((i) => (
          <li key={i.id} className="flex gap-3 p-4 text-sm">
            {i.image_url && <img src={i.image_url} alt="" className="size-14 rounded-lg object-cover" />}
            <span className="flex-1"><span className="block font-medium">{i.title}</span><span className="text-xs text-muted">{i.variant_title} · {i.sku} · Qty {i.qty}</span></span>
            <span className="tabular-nums">{formatMoney(i.total_paise)}</span>
          </li>
        ))}
      </ul>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-card p-5">
          <h3 className="font-semibold">Status history</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {order.status_events.map((e) => (
              <li key={e.id} className="flex justify-between gap-3"><span><StatusPill status={e.status} /> {e.note && <span className="text-muted">— {e.note}</span>}</span><span className="text-xs text-muted whitespace-nowrap">{formatDateTime(e.created_at)}</span></li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-card p-5">
          <h3 className="font-semibold">Delivery address</h3>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">{order.shipping_address.full_name}<br />{order.shipping_address.line1}<br />{order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.postal_code}</p>
          {order.status === 'delivered' && (
            <form
              className="mt-4 space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api.post(`/orders/${order.id}/return`, { reason: returnReason });
                  toast.success('Return requested');
                  setReturnReason('');
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : 'Could not request return');
                }
              }}
            >
              <Field label="Start a return"><Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Reason (e.g. size issue)" required minLength={3} /></Field>
              <Button size="sm" variant="secondary" type="submit">Request return</Button>
            </form>
          )}
          {['placed', 'payment_pending', 'payment_confirmed', 'processing'].includes(order.status) && (
            <Button
              size="sm"
              variant="danger"
              className="mt-4"
              onClick={async () => {
                if (!confirm('Cancel this order?')) return;
                try {
                  await api.post(`/orders/${order.id}/cancel`, { reason: 'Cancelled by customer' });
                  toast.success('Order cancelled');
                  const d = await api.get<{ order: Order }>(`/orders/${order.id}`);
                  setOrder(d.order);
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : 'Could not cancel');
                }
              }}
            >
              Cancel order
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [form, setForm] = useState<Partial<Address> & { is_default_shipping?: boolean }>({});
  usePageMeta('Addresses — Ojas');
  const load = () => api.get<{ addresses: Address[] }>('/addresses').then((d) => setAddresses(d.addresses));
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ul className="space-y-3">
        {addresses.map((a) => (
          <li key={a.id} className="rounded-2xl border border-line bg-card p-5 text-sm">
            <div className="flex justify-between"><span className="font-semibold">{a.label}</span>{a.is_default_shipping && <Badge tone="accent">Default</Badge>}</div>
            <p className="mt-1 text-ink-soft">{a.full_name} · {a.phone}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />{a.city}, {a.state} {a.postal_code}</p>
            <button className="mt-2 text-xs text-danger underline underline-offset-2" onClick={async () => { await api.delete(`/addresses/${a.id}`); void load(); }}>Delete</button>
          </li>
        ))}
        {!addresses.length && <EmptyState title="No saved addresses" body="Add one to speed up checkout." />}
      </ul>
      <form
        className="h-fit space-y-3 rounded-2xl border border-line bg-card p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post('/addresses', { label: form.label ?? 'Home', full_name: form.full_name, phone: form.phone, line1: form.line1, line2: form.line2 ?? null, city: form.city, state: form.state, postal_code: form.postal_code, country: 'IN', is_default_shipping: form.is_default_shipping ?? false });
            setForm({});
            void load();
            toast.success('Address saved');
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Could not save');
          }
        }}
      >
        <h3 className="font-semibold">Add address</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Label"><Input value={form.label ?? ''} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Home / Work" /></Field>
          <Field label="Full name"><Input required value={form.full_name ?? ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <Field label="Phone"><Input required value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="PIN"><Input required value={form.postal_code ?? ''} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} /></Field>
        </div>
        <Field label="Address line 1"><Input required value={form.line1 ?? ''} onChange={(e) => setForm({ ...form, line1: e.target.value })} /></Field>
        <Field label="Address line 2"><Input value={form.line2 ?? ''} onChange={(e) => setForm({ ...form, line2: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City"><Input required value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Field label="State"><Input required value={form.state ?? ''} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
        </div>
        <Checkbox label="Default shipping address" checked={form.is_default_shipping ?? false} onChange={(e) => setForm({ ...form, is_default_shipping: e.target.checked })} />
        <Button type="submit">Save address</Button>
      </form>
    </div>
  );
}

export function WishlistPage() {
  const [items, setItems] = useState<{ id: string; slug: string; title: string; base_price_paise: number; image_url: string | null; total_stock: number }[] | null>(null);
  const refreshWishlist = useWishlist((s) => s.refresh);
  usePageMeta('Wishlist — Ojas');
  useEffect(() => {
    void refreshWishlist();
    api.get<{ items: any[] }>('/wishlist').then((d) => setItems(d.items)).catch(() => setItems([]));
  }, [refreshWishlist]);
  if (!items) return <EmptyState title="Loading…" />;
  if (!items.length) return <EmptyState title="Your wishlist is empty" body="Tap the heart on any product to save it here." action={<LinkButton to="/shop" variant="accent">Browse products</LinkButton>} />;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => (
        <li key={i.id} className="flex gap-3 rounded-2xl border border-line bg-card p-4">
          {i.image_url && <img src={i.image_url} alt="" className="size-16 rounded-lg object-cover" />}
          <div className="flex-1">
            <Link to={`/product/${i.slug}`} className="text-sm font-medium hover:underline">{i.title}</Link>
            <p className="text-sm text-muted">{formatMoney(i.base_price_paise)}</p>
            <p className="text-xs text-muted">{i.total_stock > 0 ? 'In stock' : 'Out of stock'}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProfilePage() {
  const user = useAuth((s) => s.user)!;
  const refresh = useAuth((s) => s.refresh);
  const [form, setForm] = useState({ firstName: user.first_name, lastName: user.last_name, phone: user.phone ?? '', marketingConsent: user.marketing_consent });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  usePageMeta('Profile — Ojas');
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-4 rounded-2xl border border-line bg-card p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          await api.patch('/auth/me', form);
          await refresh();
          toast.success('Profile updated');
        }}
      >
        <h3 className="font-semibold">Details</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
          <Field label="Last name"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
        </div>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Checkbox label="Send me occasional product emails (consent can be withdrawn anytime)." checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} />
        <Button type="submit">Save changes</Button>
      </form>
      <form
        className="h-fit space-y-4 rounded-2xl border border-line bg-card p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.patch('/auth/me', pw);
            setPw({ currentPassword: '', newPassword: '' });
            toast.success('Password changed');
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Could not change password');
          }
        }}
      >
        <h3 className="font-semibold">Change password</h3>
        <Field label="Current password"><Input type="password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="New password" hint="At least 8 characters"><Input type="password" required minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" /></Field>
        <Button type="submit" variant="secondary">Update password</Button>
      </form>
    </div>
  );
}
