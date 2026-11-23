import { QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import i18n from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';

/** Mismas reglas para el cliente global y los de cada barbería. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      // Errores inesperados en lecturas (5xx / red): aviso global. Los 4xx los maneja cada pantalla.
      onError: (e) => {
        if (!(e instanceof ApiError) || e.status >= 500) toast.error(errorMessage(e, i18n.t));
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = makeQueryClient();

/**
 * Un QueryClient por barbería: las keys que genera Orval son la URL (/v1/shop/services) y NO
 * incluyen la barbería, así que compartir caché entre barberías mostraría datos de otra.
 */
const tenantClients = new Map<string, QueryClient>();
export function tenantQueryClient(slug: string): QueryClient {
  let c = tenantClients.get(slug);
  if (!c) {
    c = makeQueryClient();
    tenantClients.set(slug, c);
  }
  return c;
}
export function clearAllQueryClients(): void {
  queryClient.clear();
  for (const c of tenantClients.values()) c.clear();
  tenantClients.clear();
}
