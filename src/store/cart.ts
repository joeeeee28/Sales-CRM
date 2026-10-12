import { create } from 'zustand';
import { api } from '@/lib/api';
import type { Cart, Quote } from '@shared/types';
import { track } from '@/lib/format';

interface CartState {
  cart: Cart | null;
  quote: Quote | null;
  loading: boolean;
  drawerOpen: boolean;
  setDrawer: (open: boolean) => void;
  refresh: () => Promise<void>;
  add: (variantId: string, qty?: number) => Promise<void>;
  setQty: (lineId: string, qty: number) => Promise<void>;
  remove: (lineId: string) => Promise<void>;
  applyCoupon: (code: string | null) => Promise<void>;
}

async function fetchCart(): Promise<{ cart: Cart; quote: Quote | null }> {
  return api.get<{ cart: Cart; quote: Quote | null }>('/cart');
}

export const useCart = create<CartState>((set, get) => ({
  cart: null,
  quote: null,
  loading: false,
  drawerOpen: false,
  setDrawer: (open) => set({ drawerOpen: open }),
  refresh: async () => {
    try {
      const data = await fetchCart();
      set({ cart: data.cart, quote: data.quote });
    } catch {
      /* leave as-is */
    }
  },
  add: async (variantId, qty = 1) => {
    set({ loading: true });
    try {
      const data = await api.post<{ cart: Cart }>('/cart/items', { variantId, qty });
      set({ cart: data.cart, drawerOpen: true });
      track('add_to_cart', { variantId, qty });
    } finally {
      set({ loading: false });
    }
  },
  setQty: async (lineId, qty) => {
    const res = await api.patch<{ cart: Cart }>(`/cart/items/${lineId}`, { qty });
    set({ cart: res.cart });
  },
  remove: async (lineId) => {
    const res = await api.delete<{ cart: Cart }>(`/cart/items/${lineId}`);
    set({ cart: res.cart });
  },
  applyCoupon: async (code) => {
    const res = await api.post<{ cart: Cart }>(`/cart/coupon`, { code });
    set({ cart: res.cart });
  },
}));

export const cartCount = (cart: Cart | null) => (cart?.items ?? []).reduce((n, i) => n + i.qty, 0);
