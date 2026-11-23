import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import i18n from '@/lib/i18n';
import { useAuth } from '@/stores/auth';
import { LoginPage } from './login-page';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderAt(url: string) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/cuenta', element: <p>mis barberías</p> },
      { path: '/s/:slug', element: <p>panel</p> },
      { path: '/platform', element: <p>plataforma</p> },
    ],
    { initialEntries: [url] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('LoginPage', () => {
  beforeEach(async () => {
    useAuth.getState().clear();
    await i18n.changeLanguage('es');
  });
  afterEach(() => vi.restoreAllMocks());

  it('valida antes de llamar a la API', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    renderAt('/login');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(f).not.toHaveBeenCalled();
  });

  it('inicia sesión, guarda la sesión y respeta ?next (solo rutas internas)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json(200, {
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
        tokenType: 'Bearer',
        user: { id: 'u', email: 'o@x.pe', fullName: 'O', platformRole: null },
      }),
    );
    const router = renderAt('/login?next=/s/el-clasico');
    await userEvent.type(screen.getByLabelText('Email'), 'o@x.pe');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'demo-1234');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/s/el-clasico'));
    expect(useAuth.getState().accessToken).toBe('a');
  });

  it('un ?next externo se ignora (sin redirección abierta)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json(200, {
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
        tokenType: 'Bearer',
        user: { id: 'u', email: 'o@x.pe', fullName: 'O', platformRole: 'superadmin' },
      }),
    );
    const router = renderAt('/login?next=//evil.com');
    await userEvent.type(screen.getByLabelText('Email'), 'o@x.pe');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/platform'));
  });

  it('muestra el error de la API', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json(401, { title: 'Email o contraseña incorrectos', status: 401, code: 'UNAUTHENTICATED' }),
    );
    renderAt('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'o@x.pe');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Email o contraseña incorrectos')).toBeInTheDocument();
  });
});
