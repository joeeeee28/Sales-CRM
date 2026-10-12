import { forwardRef, useEffect, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Link } from 'react-router';
import { formatMoney } from '@/lib/format';

/* ------------------------------- Button ----------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-ink text-paper hover:bg-black active:scale-[.99]',
    accent: 'bg-accent text-white hover:bg-accent-dark active:scale-[.99]',
    secondary: 'bg-card text-ink border border-line hover:border-ink/40 hover:bg-line-soft',
    ghost: 'text-ink hover:bg-line-soft',
    danger: 'bg-danger text-white hover:brightness-95',
  };
  const sizes = { sm: 'h-9 px-3.5 text-sm', md: 'h-11 px-5 text-sm', lg: 'h-12 px-7 text-base' };
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none select-none',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function LinkButton({ to, variant = 'primary', size = 'md', className, children }: { to: string; variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; className?: string; children: ReactNode }) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-ink text-paper hover:bg-black',
    accent: 'bg-accent text-white hover:bg-accent-dark',
    secondary: 'bg-card text-ink border border-line hover:border-ink/40',
    ghost: 'text-ink hover:bg-line-soft',
    danger: 'bg-danger text-white',
  };
  const sizes = { sm: 'h-9 px-3.5 text-sm', md: 'h-11 px-5 text-sm', lg: 'h-12 px-7 text-base' };
  return (
    <Link to={to} className={clsx('inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors', variants[variant], sizes[size], className)}>
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  );
}

/* ------------------------------- Inputs ----------------------------------- */

export const Field = ({ label, hint, error, children, id }: { label: string; hint?: string; error?: string; children: ReactNode; id?: string }) => (
  <label className="block text-left" htmlFor={id}>
    <span className="mb-1.5 block text-sm font-medium text-ink-soft">{label}</span>
    {children}
    {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
  </label>
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(
        'h-11 w-full rounded-xl border bg-card px-3.5 text-sm text-ink placeholder:text-muted/70 transition-colors focus:border-ink focus:outline-none',
        invalid ? 'border-danger' : 'border-line',
        className
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={clsx('w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-ink focus:outline-none min-h-28', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={clsx('h-11 w-full appearance-none rounded-xl border border-line bg-card px-3.5 pr-8 text-sm text-ink focus:border-ink focus:outline-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 24 24%27 stroke=%27%236e6b66%27%3E%3Cpath stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M19 9l-7 7-7-7%27/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_10px_center] bg-no-repeat', className)} {...props}>
      {children}
    </select>
  );
});

export const Checkbox = ({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) => (
  <label className={clsx('flex items-start gap-2.5 text-sm text-ink-soft cursor-pointer select-none', className)}>
    <input type="checkbox" className="mt-0.5 size-4 accent-[#C8552B] rounded" {...props} />
    <span>{label}</span>
  </label>
);

/* ------------------------------- Display ---------------------------------- */

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-line-soft text-ink-soft',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    accent: 'bg-accent-soft text-accent-dark',
  };
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

export function Price({ paise, compareAt, currency = 'INR', size = 'md', className }: { paise: number; compareAt?: number | null; currency?: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizes = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' };
  const off = compareAt && compareAt > paise ? Math.round(((compareAt - paise) / compareAt) * 100) : 0;
  return (
    <span className={clsx('inline-flex items-baseline gap-2', className)}>
      <span className={clsx('font-semibold tabular-nums', sizes[size])}>{formatMoney(paise, currency)}</span>
      {off > 0 && (
        <>
          <span className={clsx('text-muted line-through tabular-nums', size === 'lg' ? 'text-base' : 'text-xs')}>{formatMoney(compareAt!, currency)}</span>
          <Badge tone="accent">-{off}%</Badge>
        </>
      )}
    </span>
  );
}

export function Stars({ rating, count, className }: { rating: number; count?: number; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1', className)} aria-label={`Rated ${rating.toFixed(1)} out of 5${count ? ` from ${count} verified reviews` : ''}`}>
      <span className="flex text-accent" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <svg key={i} viewBox="0 0 20 20" className={clsx('size-3.5', i <= Math.round(rating) ? 'fill-current' : 'fill-line')}>
            <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9l-5.3 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
          </svg>
        ))}
      </span>
      <span className="text-xs text-muted tabular-nums">{rating.toFixed(1)}{count != null && ` (${count})`}</span>
    </span>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-card/60 px-6 py-16 text-center">
      <div className="mb-3 text-muted">{icon ?? <svg className="size-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4" strokeLinecap="round" strokeLinejoin="round" /></svg>}</div>
      <h3 className="font-display text-xl">{title}</h3>
      {body && <p className="mt-1.5 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />;
}

export function QtyStepper({ value, onChange, max = 99, small }: { value: number; onChange: (n: number) => void; max?: number; small?: boolean }) {
  const btn = clsx('flex items-center justify-center text-ink-soft hover:bg-line-soft transition-colors disabled:opacity-30', small ? 'size-8' : 'size-10');
  return (
    <div className={clsx('inline-flex items-center rounded-full border border-line bg-card', small ? 'h-8' : 'h-10')} role="group" aria-label="Quantity">
      <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label="Decrease quantity">−</button>
      <span className={clsx('text-center tabular-nums font-medium', small ? 'w-8 text-sm' : 'w-10 text-sm')}>{value}</span>
      <button type="button" className={btn} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Increase quantity">+</button>
    </div>
  );
}

export function Accordion({ items }: { items: { id: string; q: string; a: ReactNode }[] }) {
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-card">
      {items.map((item) => (
        <details key={item.id} className="group px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-medium text-ink [&::-webkit-details-marker]:hidden">
            {item.q}
            <svg className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </summary>
          <div className="pt-3 text-sm leading-relaxed text-ink-soft">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('relative max-h-[90vh] w-full overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-card p-6 shadow-pop animate-fade-up', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-line-soft hover:text-ink" aria-label="Close">
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'accent'> = {
    delivered: 'success',
    captured: 'success',
    published: 'success',
    active: 'success',
    shipped: 'accent',
    out_for_delivery: 'accent',
    processing: 'warning',
    payment_confirmed: 'warning',
    pending: 'warning',
    requested: 'warning',
    retrying: 'warning',
    placed: 'neutral',
    draft: 'neutral',
    cancelled: 'danger',
    failed: 'danger',
    refunded: 'danger',
    rejected: 'danger',
    supplier_failed: 'danger',
    archived: 'neutral',
  };
  return <Badge tone={map[status] ?? 'neutral'}>{status.replace(/_/g, ' ')}</Badge>;
}
