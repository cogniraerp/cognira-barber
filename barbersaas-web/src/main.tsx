import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { Toaster } from 'sonner';
import { queryClient } from './app/query-client';
import { createRouter } from './app/router';
import { env } from './lib/env';
import { bootstrapHost } from './lib/tenant';
import './lib/i18n';
import './index.css';

// En un dominio propio (reservas.mibarberia.pe) primero se averigua de qué barbería es.
await bootstrapHost(env.rootDomain, env.apiUrl);
const router = createRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster richColors position="top-right" closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
