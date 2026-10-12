import { create } from 'zustand';
import { api } from '@/lib/api';
import type { Category } from '@shared/types';

interface Bootstrap {
  loaded: boolean;
  store: {
    name: string;
    tagline: string;
    support_email: string;
    support_phone: string;
    address_line: string;
    currency: string;
    announcement_text: string | null;
    announcement_link: string | null;
    free_shipping_over_paise: number | null;
    cod_enabled: boolean;
  } | null;
  payments: { provider: string; mode: 'live' | 'simulated'; keyId: string | null; methods: string[] } | null;
  categories: Category[];
  load: () => Promise<void>;
}

export const useBootstrap = create<Bootstrap>((set, get) => ({
  loaded: false,
  store: null,
  payments: null,
  categories: [],
  load: async () => {
    if (get().loaded) return;
    try {
      const data = await api.get<{ store: Bootstrap['store']; payments: Bootstrap['payments']; categories: Category[] }>('/bootstrap');
      set({ loaded: true, store: data.store, payments: data.payments, categories: data.categories });
    } catch {
      set({ loaded: true });
    }
  },
}));
