import { z } from 'zod';

/**
 * Subdominios/rutas que no pueden ser slug de una barbería
 * ({slug}.barbersaas.com y barbersaas.com/b/{slug}).
 */
export const RESERVED_SLUGS = new Set([
  'www',
  'app',
  'admin',
  'api',
  'docs',
  'help',
  'soporte',
  'support',
  'status',
  'blog',
  'mail',
  'email',
  'smtp',
  'ftp',
  'cdn',
  'static',
  'assets',
  'img',
  'media',
  'files',
  'storage',
  'auth',
  'login',
  'signup',
  'registro',
  'cuenta',
  'account',
  'billing',
  'pagos',
  'dashboard',
  'panel',
  'platform',
  'plataforma',
  'superadmin',
  'root',
  'test',
  'demo',
  'dev',
  'staging',
  'barbersaas',
]);

export const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/,
    'Usa 3–48 caracteres: letras, números y guiones (sin guion al inicio o al final)',
  )
  .refine((s) => !s.includes('--'), 'No uses guiones dobles')
  .refine((s) => !RESERVED_SLUGS.has(s), 'Ese nombre está reservado');

/** "Barbería El Bárbaro & Co." → "barberia-el-barbaro-co" */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}
