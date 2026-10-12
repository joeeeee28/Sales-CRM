import type {
  SupplierAdapter,
  SupplierCatalogItem,
  FulfillmentRequest,
  FulfillmentResult,
  SupplierShipmentStatus,
} from './types.js';
import { SupplierApiError } from './types.js';

/**
 * Deterministic offline supplier used for development, demos and tests.
 * It is ALWAYS labelled as simulated in the admin UI and sync logs.
 *
 * Behaviour knobs come from the supplier's config_json so failure paths can
 * be exercised on demand:
 *   { "failNextFulfillment": 1, "stockOverride": { "<externalId>": 0 },
 *     "priceDriftPercent": 5, "latencyMs": 50 }
 */
export class MockSupplierAdapter implements SupplierAdapter {
  readonly type = 'mock';
  private config: Record<string, any>;
  private state = new Map<string, { orders: FulfillmentRequest[] }>();

  constructor(
    readonly supplierId: string,
    readonly supplierCode: string,
    config: Record<string, any>
  ) {
    this.config = config ?? {};
  }

  private latency(): Promise<void> {
    const ms = Number(this.config.latencyMs ?? 20);
    return new Promise((r) => setTimeout(r, ms));
  }

  async healthCheck() {
    await this.latency();
    return { ok: true, message: 'Simulated supplier reachable (offline mock — not a real vendor)' };
  }

  async listCatalog() {
    await this.latency();
    const items: SupplierCatalogItem[] = (this.config.catalog ?? DEFAULT_CATALOG).map((raw: any) => ({
      externalId: String(raw.id),
      externalSku: raw.sku ?? null,
      title: raw.title,
      pricePaise: raw.price_paise ?? null,
      currency: 'INR',
      stockQty: this.stockFor(String(raw.id), raw.stock ?? 25),
      status: raw.status ?? 'active',
      options: raw.options,
      imageUrl: raw.image_url ?? null,
      raw,
    }));
    return { items, nextCursor: null };
  }

  private stockFor(externalId: string, base: number): number {
    const override = this.config.stockOverride?.[externalId];
    return override == null ? base : Number(override);
  }

  async checkStock(externalIds: string[]) {
    await this.latency();
    const catalog = (this.config.catalog ?? DEFAULT_CATALOG) as any[];
    return externalIds.map((id) => {
      const item = catalog.find((c) => String(c.id) === id);
      return { externalId: id, stockQty: item ? this.stockFor(id, item.stock ?? 25) : null, status: item?.status ?? 'unknown' };
    });
  }

  async checkPrices(externalIds: string[]) {
    await this.latency();
    const drift = Number(this.config.priceDriftPercent ?? 0) / 100;
    const catalog = (this.config.catalog ?? DEFAULT_CATALOG) as any[];
    return externalIds.map((id) => {
      const item = catalog.find((c) => String(c.id) === id);
      const base = item?.price_paise ?? null;
      return { externalId: id, pricePaise: base == null ? null : Math.round(base * (1 + drift)) };
    });
  }

  async createOrder(req: FulfillmentRequest): Promise<FulfillmentResult> {
    await this.latency();
    const fail = Number(this.config.failNextFulfillment ?? 0);
    if (fail > 0) {
      this.config.failNextFulfillment = fail - 1;
      throw new SupplierApiError('Simulated supplier API timeout (503)', true);
    }
    const outOfStock = req.lines.find((l) => {
      const id = l.supplierVariantRef;
      return id != null && this.stockFor(id, 25) < l.qty;
    });
    if (outOfStock) {
      return { ok: false, error: `Supplier reports insufficient stock for ${outOfStock.sku}`, retryable: false };
    }
    const entry = this.state.get(req.idempotencyKey) ?? { orders: [] };
    if (entry.orders.length) {
      // Idempotent replay: same key returns the same reference.
      return { ok: true, externalRef: `MOCK-${req.idempotencyKey.slice(0, 8).toUpperCase()}` };
    }
    entry.orders.push(req);
    this.state.set(req.idempotencyKey, entry);
    return {
      ok: true,
      externalRef: `MOCK-${req.idempotencyKey.slice(0, 8).toUpperCase()}`,
      trackingNumber: null,
      carrier: null,
    };
  }

  async getOrderStatus(externalRef: string): Promise<SupplierShipmentStatus | null> {
    await this.latency();
    if (!externalRef.startsWith('MOCK-')) return null;
    // Deterministic progression: shipped with tracking once submitted.
    const submitted = new Date().toISOString();
    return {
      externalRef,
      status: 'shipped',
      trackingNumber: `MOCKTRK${externalRef.slice(5)}`,
      carrier: 'MockExpress',
      events: [
        { status: 'accepted', description: 'Supplier accepted the order', location: 'Supplier warehouse', occurredAt: submitted },
        { status: 'shipped', description: 'Handed to carrier', location: 'Supplier warehouse', occurredAt: submitted },
      ],
    };
  }

  async cancelOrder(externalRef: string) {
    await this.latency();
    return { ok: externalRef.startsWith('MOCK-') };
  }
}

const DEFAULT_CATALOG = [
  { id: 'SUP-HP-01', sku: 'SUP-HP-01', title: 'Meridian Pro ANC Headphones', price_paise: 749000, stock: 40, options: { Colour: 'Charcoal' } },
  { id: 'SUP-HP-02', sku: 'SUP-HP-02', title: 'Meridian Pro ANC Headphones', price_paise: 749000, stock: 12, options: { Colour: 'Bone' } },
  { id: 'SUP-KB-01', sku: 'SUP-KB-01', title: 'Field 65 Mechanical Keyboard', price_paise: 424000, stock: 30, options: { Switch: 'Tactile' } },
  { id: 'SUP-KB-02', sku: 'SUP-KB-02', title: 'Field 65 Mechanical Keyboard', price_paise: 424000, stock: 18, options: { Switch: 'Linear' } },
  { id: 'SUP-LMP-01', sku: 'SUP-LMP-01', title: 'Halo Desk Lamp', price_paise: 214000, stock: 25 },
  { id: 'SUP-MUG-01', sku: 'SUP-MUG-01', title: 'Terra Stoneware Mug Set', price_paise: 89000, stock: 60 },
  { id: 'SUP-THR-01', sku: 'SUP-THR-01', title: 'Aera Linen Throw', price_paise: 174000, stock: 22 },
  { id: 'SUP-BP-01', sku: 'SUP-BP-01', title: 'Commuter 22L Backpack', price_paise: 339000, stock: 35 },
  { id: 'SUP-PC-01', sku: 'SUP-PC-01', title: 'Voyager Packing Cubes', price_paise: 109000, stock: 45 },
  { id: 'SUP-WLT-01', sku: 'SUP-WLT-01', title: 'Slate Minimal Wallet', price_paise: 69000, stock: 80 },
  { id: 'SUP-BTL-01', sku: 'SUP-BTL-01', title: 'Copper Water Bottle', price_paise: 59000, stock: 70 },
  { id: 'SUP-MSK-01', sku: 'SUP-MSK-01', title: 'Calm Weighted Eye Mask', price_paise: 42000, stock: 55 },
  { id: 'SUP-MAT-01', sku: 'SUP-MAT-01', title: 'Prana Yoga Mat', price_paise: 199000, stock: 28 },
  { id: 'SUP-CLK-01', sku: 'SUP-CLK-01', title: 'Lumen Sunset Alarm Clock', price_paise: 274000, stock: 0, status: 'out_of_stock' },
];
