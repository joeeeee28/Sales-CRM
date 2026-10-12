import { create } from 'zustand';
import { api } from '@/lib/api';
import { useCart } from './cart';

export interface SessionUser {
  id: string;
  email: string;
  role: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  marketing_consent: boolean;
  created_at: string;
}

interface AuthState {
  user: SessionUser | null;
  permissions: string[];
  initialised: boolean;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; firstName?: string; lastName?: string; marketingConsent?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  permissions: [],
  initialised: false,
  init: async () => {
    try {
      const data = await api.get<{ user: SessionUser | null; permissions?: string[] }>('/auth/me');
      set({ user: data.user, permissions: data.permissions ?? [], initialised: true });
    } catch {
      set({ initialised: true });
    }
  },
  login: async (email, password) => {
    const data = await api.post<{ user: SessionUser }>('/auth/login', { email, password });
    set({ user: data.user });
    await useCart.getState().refresh();
  },
  register: async (input) => {
    const data = await api.post<{ user: SessionUser }>('/auth/register', input);
    set({ user: data.user });
    await useCart.getState().refresh();
  },
  logout: async () => {
    await api.post('/auth/logout');
    set({ user: null, permissions: [] });
    await useCart.getState().refresh();
  },
  refresh: async () => {
    const data = await api.get<{ user: SessionUser | null; permissions?: string[] }>('/auth/me');
    set({ user: data.user, permissions: data.permissions ?? [] });
  },
}));
