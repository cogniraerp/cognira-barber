import { create } from 'zustand';

/** Slug de la barbería activa (lo fija el layout del panel desde la ruta /s/:slug). */
interface TenantState {
  slug: string | null;
  setSlug: (slug: string | null) => void;
}
export const useTenant = create<TenantState>()((set) => ({ slug: null, setSlug: (slug) => set({ slug }) }));
