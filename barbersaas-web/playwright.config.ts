import { defineConfig, devices } from '@playwright/test';

/**
 * E2E contra la app real: la web (Vite) + la API con su base de datos.
 * La API NO la levanta este config: en local corre con `docker compose up` en barbersaas-api;
 * en CI la levanta el workflow. `e2e/global-setup.ts` verifica que responda antes de empezar.
 *
 * Cada corrida crea su propia barbería por API (slug único), así que no depende de los datos demo
 * ni ensucia los de otras corridas.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5180';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    locale: 'es-PE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // El cliente reserva desde el celular y el barbero usa "Mi día" en el celular.
    { name: 'movil', use: { ...devices['Pixel 7'] }, testMatch: /(reserva|mi-dia)\.spec\.ts/ },
    // El panel en escritorio, con el navegador en OTRA zona horaria: la agenda debe mostrar la hora de Lima.
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], timezoneId: 'Asia/Tokyo' }, testMatch: /panel\.spec\.ts/ },
    // Fase 3: reserva con adelanto (barbería propia: activa pagos en línea y adelanto).
    { name: 'adelanto', use: { ...devices['Pixel 7'] }, testMatch: /adelanto\.spec\.ts/ },
    // Fase 2: un día en la caja (cobro mixto con QR, comisión, arqueo y reporte).
    { name: 'caja', use: { ...devices['Desktop Chrome'], timezoneId: 'America/Lima' }, testMatch: /fase-2\.spec\.ts/ },
  ],
  webServer: {
    command: 'pnpm dev',
    url: WEB_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
