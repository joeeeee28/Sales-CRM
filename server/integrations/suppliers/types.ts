/**
 * Supplier integration layer.
 *
 * A supplier = an adapter implementing this interface plus a row in the
 * `suppliers` table (adapter_type + config_json). Credentials are read from
 * environment variables only — never from the database.
 *
 * Shipped adapters:
 *  - `mock`      : deterministic offline supplier for development & tests.
 *                  Clearly labelled; it never claims to be a real vendor.
 *  - `http_json` : generic REST adapter driven by config (endpoints + field
 *                  mapping). Use it to wire CJ Dropshipping / Spocket / a
 *                  private supplier API without writing new code.
 */

export interface SupplierCatalogItem {
  externalId: string;
  externalSku: string | null;
  title: string;
  pricePaise: number | null;
  currency: string;
  stockQty: number | null;
  status: string | null;
  options?: Record<string, string>;
  imageUrl?: string | null;
  raw: unknown;
}

export interface SupplierStockLevel {
  externalId: string;
  stockQty: number | null;
  status: string | null;
}

export interface SupplierPrice {
  externalId: string;
  pricePaise: number | null;
}

export interface FulfillmentLine {
  sku: string;
  supplierVariantRef: string | null;
  title: string;
  qty: number;
  unitCostPaise: number | null;
}

export interface FulfillmentRequest {
  /** Store order id — used as the idempotency key on the supplier side. */
  storeOrderId: string;
  storeOrderNumber: string;
  lines: FulfillmentLine[];
  shipping: {
    fullName: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  idempotencyKey: string;
}

export interface FulfillmentResult {
  ok: boolean;
  externalRef?: string;
  trackingNumber?: string | null;
  carrier?: string | null;
  error?: string;
  retryable?: boolean;
}

export interface SupplierShipmentStatus {
  externalRef: string;
  status: string;
  trackingNumber: string | null;
  carrier: string | null;
  events: { status: string; description: string | null; location: string | null; occurredAt: string }[];
}

export interface SupplierAdapter {
  readonly type: string;
  readonly supplierId: string;
  readonly supplierCode: string;
  healthCheck(): Promise<{ ok: boolean; message: string }>;
  listCatalog(cursor?: string): Promise<{ items: SupplierCatalogItem[]; nextCursor: string | null }>;
  checkStock(externalIds: string[]): Promise<SupplierStockLevel[]>;
  checkPrices(externalIds: string[]): Promise<SupplierPrice[]>;
  createOrder(req: FulfillmentRequest): Promise<FulfillmentResult>;
  getOrderStatus(externalRef: string): Promise<SupplierShipmentStatus | null>;
  cancelOrder(externalRef: string): Promise<{ ok: boolean; error?: string }>;
}

export class SupplierApiError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.retryable = retryable;
  }
}

/** Pricing rules applied when syncing supplier prices into the store. */
export interface MarkupRule {
  /** type 'percent' adds a margin over supplier cost; 'fixed' adds paise. */
  type: 'percent' | 'fixed';
  value: number;
  /** round the resulting price to a psychological threshold, e.g. 9900 → ₹99 endings */
  charmTo?: number;
  minMarginPercent?: number;
}

export function applyMarkupRule(costPaise: number, rule: MarkupRule | null): number {
  let price = costPaise;
  if (rule) {
    price = rule.type === 'percent' ? Math.round((costPaise * (100 + rule.value)) / 100) : costPaise + rule.value;
    if (rule.charmTo && rule.charmTo > 0) {
      price = Math.floor(price / rule.charmTo) * rule.charmTo + (rule.charmTo - 1);
    }
  }
  return Math.max(price, costPaise);
}
