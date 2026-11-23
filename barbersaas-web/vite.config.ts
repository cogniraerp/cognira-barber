import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'brand/*.svg'],
      manifest: {
        name: 'Cognira Barber',
        short_name: 'Cognira Barber',
        description: 'Reservas y gestión para barberías',
        lang: 'es',
        theme_color: '#060b1e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // La API nunca se cachea en el service worker (datos por usuario/barbería).
        navigateFallbackDenylist: [/^\/v1\//],
        runtimeCaching: [],
      },
    }),
  ],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  server: {
    port: 5180,
    strictPort: true,
    // Subdominios de barberías en local: http://el-clasico.barbersaas.localhost:5173
    allowedHosts: ['.barbersaas.localhost', 'localhost'],
  },
  build: { sourcemap: true },
});
