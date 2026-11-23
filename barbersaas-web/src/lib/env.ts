export const env = {
  apiUrl: (import.meta.env.VITE_API_URL ?? 'http://localhost:3100').replace(/\/$/, ''),
  rootDomain: import.meta.env.VITE_ROOT_DOMAIN ?? 'barbersaas.localhost',
  /**
   * Página pública en {slug}.ROOT_DOMAIN (requiere DNS y certificado comodín). Con 'false' se usa
   * {origen}/b/{slug} (p. ej. mientras el DNS no permite el comodín).
   */
  publicSubdomains: (import.meta.env.VITE_PUBLIC_SUBDOMAINS ?? 'true') !== 'false',
};
