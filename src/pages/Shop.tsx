import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { api } from '@/lib/api';
import { useBootstrap } from '@/store/bootstrap';
import { usePageMeta } from '@/lib/format';
import { ProductCard } from '@/components/product';
import { Button, Checkbox, EmptyState, Select, Skeleton, Input } from '@/components/ui';
import type { ProductListItem } from '@shared/types';
import clsx from 'clsx';

interface ListResponse {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Popularity (units sold)' },
  { value: 'rating', label: 'Top rated' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

export default function Shop() {
  const { categorySlug } = useParams();
  const [params, setParams] = useSearchParams();
  const categories = useBootstrap((s) => s.categories);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const q = params.get('q') ?? '';
  const sort = params.get('sort') ?? 'newest';
  const page = Number(params.get('page') ?? '1');
  const min = params.get('min') ?? '';
  const max = params.get('max') ?? '';
  const inStock = params.get('inStock') === '1';

  const activeCategory = categories.find((c) => c.slug === categorySlug);
  usePageMeta(
    `${activeCategory ? `${activeCategory.name} — ` : q ? `“${q}” — ` : 'Shop all — '}Ojas`,
    activeCategory?.description ?? 'Browse the full catalogue with category, price, availability and rating filters.'
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams();
    if (categorySlug) qs.set('category', categorySlug);
    if (q) qs.set('q', q);
    if (min) qs.set('min', min);
    if (max) qs.set('max', max);
    if (inStock) qs.set('inStock', '1');
    qs.set('sort', sort);
    qs.set('page', String(page));
    qs.set('pageSize', '12');
    api
      .get<ListResponse>(`/products?${qs.toString()}`)
      .then((d) => !cancelled && setData(d))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [categorySlug, q, sort, page, min, max, inStock]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const pages = useMemo(() => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1), [data]);

  const filters = (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-2">Category</h3>
        <ul className="space-y-1.5">
          <li>
            <a href={`/shop${params.toString() ? `?${params.toString()}` : ''}`} className={clsx('text-sm hover:underline underline-offset-4', !categorySlug && 'font-semibold underline')}>All products</a>
          </li>
          {categories.map((c) => (
            <li key={c.id}>
              <a href={`/shop/${c.slug}${params.toString() ? `?${params.toString()}` : ''}`} className={clsx('text-sm hover:underline underline-offset-4', categorySlug === c.slug && 'font-semibold underline')}>{c.name}</a>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Price (₹)</h3>
        <div className="flex items-center gap-2">
          <Input inputMode="numeric" placeholder="Min" defaultValue={min} onBlur={(e) => setParam('min', e.target.value)} className="h-9 text-sm" aria-label="Minimum price" />
          <span className="text-muted text-sm">–</span>
          <Input inputMode="numeric" placeholder="Max" defaultValue={max} onBlur={(e) => setParam('max', e.target.value)} className="h-9 text-sm" aria-label="Maximum price" />
        </div>
      </div>
      <Checkbox label="In stock only" checked={inStock} onChange={(e) => setParam('inStock', e.target.checked ? '1' : null)} />
      {(min || max || inStock || q) && (
        <Button variant="ghost" size="sm" onClick={() => setParams(categorySlug ? new URLSearchParams() : new URLSearchParams(), { replace: true })}>Clear all filters</Button>
      )}
    </div>
  );

  return (
    <div className="container-page py-10">
      <nav className="text-xs text-muted" aria-label="Breadcrumb">
        <a href="/" className="hover:underline">Home</a> <span aria-hidden="true">/</span> <span className="text-ink">{activeCategory?.name ?? 'Shop'}</span>
      </nav>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl">{q ? `Results for “${q}”` : activeCategory?.name ?? 'All products'}</h1>
          <p className="mt-1 text-sm text-muted">{activeCategory?.description ?? (data ? `${data.total} product${data.total === 1 ? '' : 's'}` : 'Loading…')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>Filters</Button>
          <Select value={sort} onChange={(e) => setParam('sort', e.target.value)} className="h-10 w-52 text-sm" aria-label="Sort products">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside className={clsx('lg:block', filtersOpen ? 'block' : 'hidden')} aria-label="Filters">{filters}</aside>
        <div>
          {loading ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />)}
            </div>
          ) : data && data.items.length === 0 ? (
            <EmptyState
              title="Nothing matches those filters"
              body="Try widening the price range or clearing filters — new products land every few weeks."
              action={<Button variant="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>}
            />
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {data?.items.map((p) => <ProductCard key={p.id} product={p} />)}
              </div>
              {pages > 1 && (
                <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>Previous</Button>
                  <span className="text-sm text-muted tabular-nums px-2">Page {page} of {pages}</span>
                  <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setParam('page', String(page + 1))}>Next</Button>
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
