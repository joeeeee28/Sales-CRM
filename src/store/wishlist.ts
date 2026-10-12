import { create } from 'zustand';
import { api } from '@/lib/api';
import { useAuth } from './auth';

interface WishlistState {
  ids: Set<string>;
  loaded: boolean;
  refresh: () => Promise<void>;
  toggle: (productId: string) => Promise<boolean>;
}

export const useWishlist = create<WishlistState>((set, get) => ({
  ids: new Set(),
  loaded: false,
  refresh: async () => {
    if (!useAuth.getState().user) {
      set({ ids: new Set(), loaded: true });
      return;
    }
    try {
      const data = await api.get<{ items: { id: string }[] }>('/wishlist');
      set({ ids: new Set(data.items.map((i) => i.id)), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  toggle: async (productId) => {
    if (!useAuth.getState().user) return false;
    const has = get().ids.has(productId);
    if (has) await api.delete(`/wishlist/${productId}`);
    else await api.post(`/wishlist/${productId}`);
    const next = new Set(get().ids);
    if (has) next.delete(productId);
    else next.add(productId);
    set({ ids: next });
    return !has;
  },
}));
