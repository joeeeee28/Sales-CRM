import { useEffect } from 'react';
import { useLocation } from 'react-router';

export function formatMoney(paise: number, currency = 'INR'): string {
  const value = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function deliveryWindow(minDays: number, maxDays: number): string {
  const from = new Date(Date.now() + minDays * 86400_000);
  const to = new Date(Date.now() + maxDays * 86400_000);
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return minDays === maxDays ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

/** Client-side meta sync (server injects the same values for crawlers). */
export function usePageMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title;
    if (description) {
      let tag = document.querySelector('meta[name="description"]');
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', 'description');
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', description);
    }
  }, [title, description]);
}

/* --------------------- privacy-conscious first-party analytics ------------ */

let clientId = localStorage.getItem('ojas_cid');
if (!clientId) {
  clientId = crypto.randomUUID();
  localStorage.setItem('ojas_cid', clientId);
}
const sessionId = crypto.randomUUID();

export function track(name: string, props: Record<string, string | number | boolean> = {}) {
  // fire-and-forget; never blocks UX, never sets cookies
  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({ name, props, sessionId, path: location.pathname }),
  }).catch(() => {});
}

export function usePageViewTracking() {
  const location = useLocation();
  useEffect(() => {
    track('page_view', { path: location.pathname });
  }, [location.pathname]);
}
