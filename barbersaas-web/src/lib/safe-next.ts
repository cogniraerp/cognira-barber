/** Solo rutas internas como destino tras el login (evita redirecciones abiertas: //evil.com, https://…). */
export function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : null;
}
