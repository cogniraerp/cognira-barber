import { afterEach, describe, expect, it, vi } from 'vitest';
import { SentryLogger, initSentry } from './sentry';

const { captureException, init } = vi.hoisted(() => ({ captureException: vi.fn(), init: vi.fn() }));
vi.mock('@sentry/node', () => ({ captureException, init }));

afterEach(() => vi.clearAllMocks());

describe('Sentry', () => {
  it('sin DSN no se inicializa', () => {
    expect(initSentry({ SENTRY_DSN: '' } as never)).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('con DSN se inicializa sin datos personales ni trazas', () => {
    expect(
      initSentry({
        SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1',
        SENTRY_ENVIRONMENT: 'production',
        APP_MODE: 'worker',
      } as never),
    ).toBe(true);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ sendDefaultPii: false, tracesSampleRate: 0, serverName: 'worker' }),
    );
  });

  it('el logger manda los errores a Sentry solo si está activo', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    new SentryLogger(['error'], false).error('falló', 'Worker');
    expect(captureException).not.toHaveBeenCalled();
    new SentryLogger(['error'], true).error('falló el cobro', 'stack…', 'Payments');
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { context: 'Payments' },
    });
  });
});
