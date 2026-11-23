import { AsyncLocalStorage } from 'node:async_hooks';

/** Datos del request disponibles en cualquier punto (auditoría, logs) sin pasarlos a mano. */
export interface RequestContextData {
  requestId: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  impersonatorUserId?: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  get(): RequestContextData | undefined {
    return storage.getStore();
  },
  /** Enriquecer el contexto actual (p. ej. el AuthGuard añade el usuario). */
  patch(data: Partial<RequestContextData>): void {
    const current = storage.getStore();
    if (current) Object.assign(current, data);
  },
};
