import { createContext, useContext } from 'react';
import type { ShopContextDtoOutput } from '@/api/generated/model';

export const ShopCtx = createContext<ShopContextDtoOutput | null>(null);

/** Contexto de la barbería activa (rol, permisos efectivos, plan). Solo dentro de /s/:slug. */
export function useShop(): ShopContextDtoOutput {
  const ctx = useContext(ShopCtx);
  if (!ctx) throw new Error('useShop fuera del panel de una barbería');
  return ctx;
}

export function useCan(): (perm: string | string[]) => boolean {
  const { permissions } = useShop();
  return (perm) => (Array.isArray(perm) ? perm : [perm]).some((p) => (permissions as string[]).includes(p));
}
