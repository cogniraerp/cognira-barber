import { useSearchParams } from 'react-router';
import { PAGE_SIZES } from '@/components/ui/pagination-utils';

/**
 * Estado de un listado en la URL (se puede compartir y sobrevive al recargar):
 * `?page=2&filas=50&q=…&<filtros>`. Cambiar un filtro vuelve a la página 1.
 */
export function useListParams(defaultPageSize = 20) {
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const filas = Number(sp.get('filas'));
  const pageSize = PAGE_SIZES.includes(filas) ? filas : defaultPageSize;
  const set = (patch: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  return {
    sp,
    page,
    pageSize,
    get: (k: string) => sp.get(k) ?? '',
    set,
    setPage: (p: number) => set({ page: p > 1 ? String(p) : null }),
    setPageSize: (n: number) => set({ filas: n === defaultPageSize ? null : String(n) }),
  };
}
