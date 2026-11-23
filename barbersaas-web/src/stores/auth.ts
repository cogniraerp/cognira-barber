import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  platformRole: 'superadmin' | 'support' | null;
}

/** Sesión de impersonación (superadmin/soporte entrando a una barbería). Token corto, sin refresh. */
export interface Impersonation {
  token: string;
  barbershopId: string;
  slug: string;
  name: string;
  expiresAt: number;
}

interface AuthState {
  impersonation: Impersonation | null;
  setImpersonation: (i: Impersonation | null) => void;
  accessToken: string | null;
  refreshToken: string | null;
  /** epoch ms en que vence el access token */
  expiresAt: number | null;
  user: SessionUser | null;
  setSession: (s: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: SessionUser;
  }) => void;
  setUser: (u: SessionUser) => void;
  clear: () => void;
}

/**
 * Sesión persistida en localStorage (mismo origen para todo el panel; ver lib/tenant.ts).
 * El access token dura 15 min; el mutator HTTP lo renueva con el refresh token cuando hace falta.
 */
export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      user: null,
      impersonation: null,
      setImpersonation: (impersonation) => set({ impersonation }),
      setSession: ({ accessToken, refreshToken, expiresIn, user }) =>
        set({ accessToken, refreshToken, user, expiresAt: Date.now() + expiresIn * 1000 }),
      setUser: (user) => set({ user }),
      clear: () => set({ accessToken: null, refreshToken: null, expiresAt: null, user: null, impersonation: null }),
    }),
    { name: 'barbersaas.session', version: 1 },
  ),
);
