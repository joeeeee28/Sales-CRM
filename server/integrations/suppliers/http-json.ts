import type {
  SupplierAdapter,
  SupplierCatalogItem,
  FulfillmentRequest,
  FulfillmentResult,
  SupplierShipmentStatus,
} from './types.js';
import { SupplierApiError } from './types.js';

/**
 * Generic REST supplier adapter driven entirely by config, so a new supplier
 * can be wired from the admin UI without deploying code.
 *
 * config_json shape:
 * {
 *   "baseUrl": "https://api.supplier.example/v2",
 *   "authEnvVar": "SUPPLIER_HTTP_BEARER_TOKEN",     // credentials from env ONLY
 *   "authStyle": "bearer" | "basic" | "header",
 *   "authHeader": "X-Api-Key",                       // when authStyle=header
 *   "endpoints": {
 *     "catalog":  { "path": "/products", "method": "GET" },
 *     "stock":    { "path": "/stock",    "method": "POST" },
 *     "prices":   { "path": "/prices",   "method": "POST" },
 *     "createOrder": { "path": "/orders", "method": "POST" },
 *     "orderStatus": { "path": "/orders/{ref}", "method": "GET" },
 *     "cancelOrder": { "path": "/orders/{ref}/cancel", "method": "POST" }
 *   },
 *   "mapping": {
 *     "items": "data.items", "id": "product_id", "sku": "sku", "title": "name",
 *     "price": "price_minor", "stock": "available", "status": "state",
 *     "orderRef": "order_id", "tracking": "tracking.number", "carrier": "tracking.carrier"
 *   }
 * }
 */
export class HttpJsonSupplierAdapter implements SupplierAdapter {
  readonly type = 'http_json';

  constructor(
    readonly supplierId: string,
    readonly supplierCode: string,
    private config: Record<string, any>
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const style = this.config.authStyle ?? 'bearer';
    const secret = this.config.authEnvVar ? process.env[this.config.authEnvVar] : undefined;
    if (secret) {
      if (style === 'bearer') headers.Authorization = `Bearer ${secret}`;
      else if (style === 'basic') headers.Authorization = `Basic ${Buffer.from(secret).toString('base64')}`;
      else headers[this.config.authHeader ?? 'X-Api-Key'] = secret;
    }
    return headers;
  }

  private async request(endpoint: string, opts: { method?: string; body?: unknown; pathParams?: Record<string, string> } = {}) {
    const ep = this.config.endpoints?.[endpoint];
    if (!ep) throw new SupplierApiError(`Supplier config missing endpoint "${endpoint}"`, false);
    let path: string = ep.path;
    for (const [k, v] of Object.entries(opts.pathParams ?? {})) path = path.replace(`{${k}}`, encodeURIComponent(v));
    const url = `${String(this.config.baseUrl).replace(/\/$/, '')}${path}`;
    const res = await fetch(url, {
      method: ep.method ?? 'GET',
      headers: this.headers(),
      body: opts.body == null ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 500) throw new SupplierApiError(`Supplier API ${res.status}`, true);
    if (!res.ok) throw new SupplierApiError(`Supplier API ${res.status}: ${await res.text()}`, false);
    return (await res.json()) as any;
  }

  private dig(obj: any, dotted: string | undefined, fallback: any = undefined): any {
    if (!dotted) return fallback;
    return dotted.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj) ?? fallback;
  }

  async healthCheck() {
    try {
      await this.request('catalog');
      return { ok: true, message: 'Supplier API reachable' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unreachable' };
    }
  }

  async listCatalog(cursor?: string) {
    const body = await this.request('catalog', { body: cursor ? { cursor } : undefined });
    const m = this.config.mapping ?? {};
    const rawItems: any[] = this.dig(body, m.items, Array.isArray(body) ? body : []);
    const items: SupplierCatalogItem[] = rawItems.map((raw) => ({
      externalId: String(this.dig(raw, m.id, raw.id)),
      externalSku: this.dig(raw, m.sku, null),
      title: String(this.dig(raw, m.title, 'Untitled')),
      pricePaise: this.dig(raw, m.price, null),
      currency: this.config.currency ?? 'INR',
      stockQty: this.dig(raw, m.stock, null),
      status: this.dig(raw, m.status, null),
      raw,
    }));
    return { items, nextCursor: this.dig(body, m.nextCursor ?? 'next_cursor', null) };
  }

  async checkStock(externalIds: string[]) {
    const body = await this.request('stock', { body: { ids: externalIds } });
    const m = this.config.mapping ?? {};
    const rows: any[] = this.dig(body, m.items, Array.isArray(body) ? body : []);
    return rows.map((r) => ({
      externalId: String(this.dig(r, m.id, r.id)),
      stockQty: this.dig(r, m.stock, null),
      status: this.dig(r, m.status, null),
    }));
  }

  async checkPrices(externalIds: string[]) {
    const body = await this.request('prices', { body: { ids: externalIds } });
    const m = this.config.mapping ?? {};
    const rows: any[] = this.dig(body, m.items, Array.isArray(body) ? body : []);
    return rows.map((r) => ({ externalId: String(this.dig(r, m.id, r.id)), pricePaise: this.dig(r, m.price, null) }));
  }

  async createOrder(req: FulfillmentRequest): Promise<FulfillmentResult> {
    const body = await this.request('createOrder', {
      body: {
        reference: req.idempotencyKey,
        store_order: req.storeOrderNumber,
        lines: req.lines.map((l) => ({ sku: l.sku, supplier_ref: l.supplierVariantRef, qty: l.qty })),
        shipping: req.shipping,
      },
    });
    const m = this.config.mapping ?? {};
    const ref = this.dig(body, m.orderRef, body?.id);
    if (!ref) return { ok: false, error: 'Supplier response missing order reference', retryable: false };
    return { ok: true, externalRef: String(ref), trackingNumber: this.dig(body, m.tracking, null), carrier: this.dig(body, m.carrier, null) };
  }

  async getOrderStatus(externalRef: string): Promise<SupplierShipmentStatus | null> {
    try {
      const body = await this.request('orderStatus', { pathParams: { ref: externalRef } });
      const m = this.config.mapping ?? {};
      const events: any[] = this.dig(body, m.events ?? 'events', []);
      return {
        externalRef,
        status: String(this.dig(body, m.status ?? 'status', 'unknown')),
        trackingNumber: this.dig(body, m.tracking, null),
        carrier: this.dig(body, m.carrier, null),
        events: events.map((e) => ({
          status: String(this.dig(e, m.eventStatus ?? 'status', 'update')),
          description: this.dig(e, m.eventDescription ?? 'description', null),
          location: this.dig(e, m.eventLocation ?? 'location', null),
          occurredAt: String(this.dig(e, m.eventTime ?? 'timestamp', new Date().toISOString())),
        })),
      };
    } catch (err) {
      if (err instanceof SupplierApiError && !err.retryable && err.message.includes('404')) return null;
      throw err;
    }
  }

  async cancelOrder(externalRef: string) {
    try {
      await this.request('cancelOrder', { pathParams: { ref: externalRef } });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'cancel failed' };
    }
  }
}
