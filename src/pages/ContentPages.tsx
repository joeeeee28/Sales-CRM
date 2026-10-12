import { useEffect, useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router';
import { api, ApiError } from '@/lib/api';
import { usePageMeta } from '@/lib/format';
import { Accordion, Button, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { toast } from '@/store/toast';
import { useBootstrap } from '@/store/bootstrap';

export function ContentPage() {
  const { slug } = useParams();
  const [page, setPage] = useState<{ slug: string; title: string; html: string; updated_at: string } | null>(null);
  const [error, setError] = useState(false);
  usePageMeta(page ? `${page.title} — Ojas` : 'Page — Ojas');

  useEffect(() => {
    setPage(null);
    setError(false);
    api.get<{ page: typeof page }>(`/pages/${slug}`)
      .then((d) => setPage(d.page))
      .catch(() => setError(true));
  }, [slug]);

  if (error) {
    return (
      <div className="container-page max-w-3xl py-24 text-center">
        <h1 className="font-display text-4xl">Page not found</h1>
        <Link to="/" className="mt-4 inline-block text-accent underline underline-offset-4">Back home</Link>
      </div>
    );
  }
  if (!page) return <div className="container-page max-w-3xl py-12"><Skeleton className="h-10 w-1/2" /><Skeleton className="mt-6 h-64 w-full" /></div>;

  return (
    <article className="container-page max-w-3xl py-12">
      <h1 className="font-display text-4xl sm:text-5xl">{page.title}</h1>
      <div className="prose-store mt-6" dangerouslySetInnerHTML={{ __html: page.html }} />
      <p className="mt-10 border-t border-line pt-4 text-xs text-muted">Last updated {new Date(page.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. Questions? <Link className="text-accent underline underline-offset-4" to="/contact">Contact us</Link>.</p>
    </article>
  );
}

export function FaqPage() {
  const [faqs, setFaqs] = useState<{ id: string; question: string; answer: string; category: string | null }[] | null>(null);
  usePageMeta('FAQ — Ojas', 'Shipping, returns, refunds, payments and product questions, answered plainly.');
  useEffect(() => {
    api.get<{ faqs: any[] }>('/faqs').then((d) => setFaqs(d.faqs)).catch(() => setFaqs([]));
  }, []);
  return (
    <div className="container-page max-w-3xl py-12">
      <h1 className="font-display text-4xl sm:text-5xl">Frequently asked questions</h1>
      <div className="mt-8">
        {!faqs ? <Skeleton className="h-64" /> : <Accordion items={faqs.map((f) => ({ id: f.id, q: f.question, a: <div dangerouslySetInnerHTML={{ __html: f.answer }} /> }))} />}
      </div>
    </div>
  );
}

export function ContactPage() {
  const store = useBootstrap((s) => s.store);
  const [form, setForm] = useState({ name: '', email: '', subject: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  usePageMeta('Contact us — Ojas', 'Questions about an order, a product or a return? We reply within one business day.');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/contact', form);
      setSent(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not send message');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-page grid gap-10 py-12 lg:grid-cols-[1fr_1.3fr]">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl">Contact us</h1>
        <p className="mt-3 text-muted">One accountable support inbox for everything — orders, returns, product questions.</p>
        <dl className="mt-8 space-y-4 text-sm">
          <div><dt className="font-semibold">Email</dt><dd className="text-muted">{store?.support_email ?? 'care@ojas.example'}</dd></div>
          <div><dt className="font-semibold">Phone</dt><dd className="text-muted">{store?.support_phone ?? '+91 80 4719 0000'} · Mon–Sat, 9:00–18:00 IST</dd></div>
          <div><dt className="font-semibold">Registered address</dt><dd className="text-muted">{store?.address_line}</dd></div>
        </dl>
      </div>
      {sent ? (
        <div className="rounded-2xl bg-success-soft p-8 text-center">
          <h2 className="font-display text-2xl text-success">Message received</h2>
          <p className="mt-2 text-sm text-success">We reply within one business day. For order issues, include your order number to speed things up.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-card p-6 shadow-card">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></Field>
            <Field label="Email"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></Field>
          </div>
          <Field label="Subject"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Order OJ-2026-… / product question" /></Field>
          <Field label="Message" hint="Minimum 10 characters"><Textarea required minLength={10} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <Button type="submit" loading={busy}>Send message</Button>
        </form>
      )}
    </div>
  );
}

export function NotFoundPage() {
  usePageMeta('Page not found — Ojas');
  return (
    <div className="container-page py-28 text-center">
      <p className="font-display text-7xl text-line">404</p>
      <h1 className="mt-2 font-display text-4xl">This page wandered off</h1>
      <p className="mt-2 text-muted">The link may be old, or the product may have been archived.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link to="/shop" className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-white hover:bg-accent-dark">Browse the shop</Link>
        <Link to="/" className="rounded-full border border-line bg-card px-6 py-3 text-sm font-medium hover:border-ink/40">Back home</Link>
      </div>
    </div>
  );
}
