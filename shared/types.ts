/**
 * Shared domain types & helpers used by both the API server and the React app.
 * Money is ALWAYS represented as integer paise (1/100 of the currency unit) to
 * avoid floating point drift. Formatting lives in `money.ts`.
 */

export type Role = 'customer' | 'support' | 'manager' | 'owner';

export const ADMIN_ROLES: Role[] = ['support', 'manager', 'owner'];

export type ProductStatus = 'draft' | 'active' | 'archived';

export type OrderStatus =
  | 'placed'
  | 'payment_pending'
  | 'payment_confirmed'
  | 'processing'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type PaymentStatus = 'pending' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
export type FulfillmentStatus =
  | 'unfulfilled'
  | 'pending_supplier'
  | 'supplier_failed'
  | 'fulfilled'
  | 'partially_fulfilled'
  | 'cancelled';

export type PaymentProvider = 'razorpay' | 'cod' | 'manual';
export type PaymentMethod = 'upi' | 'card' | 'netbanking' | 'wallet' | 'cod' | 'manual';

export type ReturnStatus =
  | 'requested'
  | 'approved'
  | 'picked_up'
  | 'received'
  | 'refunded'
  | 'rejected'
  | 'closed';

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface ProductImage {
  id: string;
  url: string;
  alt_text: string;
  sort_order: number;
  width: number | null;
  height: number | null;
}

export interface VariantOption {
  [optionName: string]: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string;
  title: string;
  options: VariantOption;
  price_paise: number | null;
  compare_at_price_paise: number | null;
  stock_qty: number;
  low_stock_threshold: number;
  is_active: boolean;
  supplier_id: string | null;
  supplier_variant_ref: string | null;
}

export interface ProductSpec {
  id: string;
  label: string;
  value: string;
  sort_order: number;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  tagline: string | null;
  description_md: string;
  highlights: string[];
  category_id: string | null;
  status: ProductStatus;
  base_price_paise: number;
  compare_at_price_paise: number | null;
  currency: string;
  tax_rate_bps: number;
  meta_title: string | null;
  meta_description: string | null;
  is_sample: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  category?: Category | null;
  images?: ProductImage[];
  variants?: ProductVariant[];
  specs?: ProductSpec[];
  rating?: { average: number; count: number } | null;
  units_sold?: number;
}

export interface ProductListItem extends Product {
  min_price_paise: number;
  max_price_paise: number;
  total_stock: number;
}

export interface Review {
  id: string;
  product_id: string;
  rating: number;
  title: string | null;
  body: string;
  author_name: string;
  is_verified_purchase: boolean;
  status: 'pending' | 'published' | 'rejected';
  created_at: string;
}

export interface CartItem {
  line_id: string;
  variant_id: string;
  product_id: string;
  product_slug: string;
  title: string;
  variant_title: string;
  sku: string;
  image_url: string | null;
  options: VariantOption;
  unit_price_paise: number;
  compare_at_price_paise: number | null;
  qty: number;
  available_stock: number;
  line_total_paise: number;
  price_changed: boolean;
}

export interface Cart {
  id: string;
  items: CartItem[];
  coupon_code: string | null;
  coupon: AppliedCoupon | null;
  subtotal_paise: number;
  discount_paise: number;
  email: string | null;
}

export interface Quote {
  subtotal_paise: number;
  discount_paise: number;
  shipping_paise: number;
  shipping_free: boolean;
  tax_paise: number;
  total_paise: number;
  coupon: AppliedCoupon | null;
  free_shipping_over: number | null;
}

export interface AppliedCoupon {
  code: string;
  description: string;
  type: 'percent' | 'fixed' | 'free_shipping';
  value: number;
  discount_paise: number;
}

export interface ShippingMethod {
  id: string;
  code: string;
  name: string;
  description: string;
  price_paise: number;
  free_over_paise: number | null;
  min_days: number;
  max_days: number;
  is_active: boolean;
  cod_available: boolean;
}

export interface Address {
  id: string;
  label: string;
  full_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default_shipping: boolean;
}

export interface OrderItem {
  id: string;
  product_id: string | null;
  product_slug: string | null;
  title: string;
  variant_title: string;
  sku: string;
  image_url: string | null;
  unit_price_paise: number;
  qty: number;
  total_paise: number;
}

export interface OrderStatusEvent {
  id: string;
  status: string;
  note: string | null;
  actor_type: 'system' | 'admin' | 'customer' | 'supplier';
  created_at: string;
}

export interface Shipment {
  id: string;
  carrier: string | null;
  tracking_number: string | null;
  status: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  events: TrackingEvent[];
}

export interface TrackingEvent {
  id: string;
  status: string;
  description: string | null;
  location: string | null;
  occurred_at: string;
  source: 'supplier' | 'carrier' | 'manual';
}

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  payment_provider: PaymentProvider | null;
  payment_method: PaymentMethod | null;
  currency: string;
  subtotal_paise: number;
  discount_paise: number;
  shipping_paise: number;
  tax_paise: number;
  total_paise: number;
  coupon_code: string | null;
  email: string;
  phone: string | null;
  shipping_method_name: string;
  shipping_address: Address;
  items: OrderItem[];
  status_events: OrderStatusEvent[];
  shipments: Shipment[];
  placed_at: string;
  updated_at: string;
  cancel_reason: string | null;
  estimated_delivery: { min_days: number; max_days: number } | null;
  cod_enabled_for_order: boolean;
  is_sample?: boolean;
}

export interface SupplierProduct {
  id: string;
  supplier_id: string;
  external_id: string;
  external_sku: string | null;
  title: string;
  price_paise: number | null;
  stock_qty: number | null;
  status: string | null;
  store_variant_id: string | null;
  last_synced_at: string | null;
}

export interface SupplierOrder {
  id: string;
  supplier_id: string;
  order_id: string;
  external_ref: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  next_retry_at: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface AdminMetrics {
  range: { from: string; to: string };
  revenue_paise: number;
  orders_count: number;
  aov_paise: number;
  units_sold: number;
  customers_count: number;
  conversion: { sessions: number; orders: number; rate: number } | null;
  revenue_by_day: { day: string; revenue_paise: number; orders: number }[];
  top_products: { product_id: string; title: string; units: number; revenue_paise: number }[];
  orders_by_status: { status: string; count: number }[];
  pending_fulfillment: number;
  supplier_failures: number;
  low_stock: { variant_id: string; sku: string; title: string; stock_qty: number }[];
}

export interface StoreSettings {
  store_name: string;
  tagline: string;
  support_email: string;
  support_phone: string;
  address_line: string;
  currency: string;
  cod_enabled: boolean;
  cod_max_amount_paise: number;
  free_shipping_over_paise: number | null;
  tax_inclusive: boolean;
  default_tax_bps: number;
  announcement_text: string | null;
  announcement_link: string | null;
  fulfillment_enabled: boolean;
  reviews_require_purchase: boolean;
  marketing_consent_default: boolean;
}

export interface Faq {
  id: string;
  question: string;
  answer_md: string;
  category: string | null;
  sort_order: number;
}

export interface ContentPage {
  slug: string;
  title: string;
  body_md: string;
  updated_at: string;
  requires_legal_review: boolean;
}

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  og_image?: string;
  jsonld?: unknown;
  robots?: string;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  placed: 'Order placed',
  payment_pending: 'Awaiting payment',
  payment_confirmed: 'Payment confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const ORDER_FLOW: OrderStatus[] = [
  'placed',
  'payment_confirmed',
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
];
