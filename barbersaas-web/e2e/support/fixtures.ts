import { test as base, expect, type Page } from '@playwright/test';
import { createShop, deleteShop, PASSWORD, type ShopFixture } from './api';

/**
 * `shop`: una barbería nueva por worker (cada proyecto tiene la suya). Se comparte entre las
 * pruebas del proyecto para no gastar el límite de registros de la API (10/min por IP).
 * Todas las páginas arrancan en español.
 */
export const test = base.extend<{ page: Page }, { shop: ShopFixture }>({
  shop: [
    async ({}, use) => {
      const shop = await createShop();
      await use(shop);
      // Sin superadmin (p. ej. otra base) la limpieza se omite: no debe tumbar la corrida.
      await deleteShop(shop).catch((e: unknown) => console.warn(`No se pudo borrar ${shop.slug}: ${String(e)}`));
    },
    { scope: 'worker' },
  ],
  page: async ({ page }, use) => {
    await page.addInitScript(() => localStorage.setItem('barbersaas.lang', 'es'));
    await use(page);
  },
});
export { expect };

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/(cuenta|s\/)/);
}

/** Hora como la muestra la app ("9:15 a. m.") en la zona de la barbería. */
export const limaTime = (iso: string) =>
  new Intl.DateTimeFormat('es-PE', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Lima' }).format(new Date(iso));
/** "09:15" en Lima (agenda y Mi día). */
export const limaTime24 = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Lima' }).format(new Date(iso));
