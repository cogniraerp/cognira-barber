import { describe, expect, it } from 'vitest';
import {
  EvolutionClient,
  EvolutionSender,
  REPLY_HINT,
  instanceNameFor,
  jidToPhone,
  resetEvolutionChecks,
} from './evolution';
import { ProviderError } from './types';

/** Evolution simulado (mismas formas de respuesta que v2.3.7). */
function fakeEvolution() {
  const instances = new Map<string, { state: 'connecting' | 'open'; jid: string | null }>();
  const sent: Array<{
    instance: string;
    number: string;
    text: string;
    delay?: number;
    linkPreview?: boolean;
  }> = [];
  const noWhatsApp = new Set<string>();
  const QR = 'data:image/png;base64,iVBORw0KGgo';
  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const fetchFn = ((input: string, init?: RequestInit) => {
    const url = new URL(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers.apikey !== 'k') return json(401, { status: 401 });
    const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    if (url.pathname === '/instance/create') {
      const b = JSON.parse(init?.body as string) as { instanceName: string };
      instances.set(b.instanceName, { state: 'connecting', jid: null });
      return json(201, {
        instance: { instanceName: b.instanceName, status: 'connecting' },
        qrcode: { base64: QR, pairingCode: null },
      });
    }
    if (url.pathname.startsWith('/instance/connectionState/')) {
      const i = instances.get(name);
      return i
        ? json(200, { instance: { instanceName: name, state: i.state } })
        : json(404, { status: 404 });
    }
    if (url.pathname.startsWith('/instance/connect/'))
      return json(200, { pairingCode: 'None', code: '2@x', base64: QR, count: 2 });
    if (url.pathname === '/instance/fetchInstances') {
      const n = url.searchParams.get('instanceName')!;
      return json(200, [{ name: n, ownerJid: instances.get(n)?.jid ?? null }]);
    }
    if (url.pathname.startsWith('/chat/whatsappNumbers/')) {
      const b = JSON.parse(init?.body as string) as { numbers: string[] };
      return json(
        200,
        b.numbers.map((n) => ({ number: n, exists: !noWhatsApp.has(n) })),
      );
    }
    if (url.pathname.startsWith('/message/sendText/')) {
      const b = JSON.parse(init?.body as string) as { number: string; text: string };
      sent.push({ instance: name, ...b });
      return json(201, { key: { id: `msg-${sent.length}` }, status: 'PENDING' });
    }
    if (url.pathname.startsWith('/instance/logout/')) {
      instances.delete(name);
      return json(200, { status: 'SUCCESS' });
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  const link = (name: string, phone = '51987654321') =>
    instances.set(name, { state: 'open', jid: `${phone}@s.whatsapp.net` });
  return { fetchFn, sent, link, QR, noWhatsApp };
}

describe('Evolution', () => {
  const inst = instanceNameFor('11111111-2222-3333-4444-555555555555');

  it('nombres e identificadores', () => {
    expect(inst).toBe('cognira-11111111-2222-3333-4444-555555555555');
    expect(jidToPhone('51987654321@s.whatsapp.net')).toBe('+51987654321');
    expect(jidToPhone(null)).toBeNull();
  });

  it('QR: crea la instancia si no existe; luego renueva el QR; conectada devuelve el número', async () => {
    const f = fakeEvolution();
    const c = new EvolutionClient('http://evo:8080', 'k', f.fetchFn);
    expect(await c.qr(inst)).toEqual({
      state: 'connecting',
      qr: f.QR,
      pairingCode: null,
      phone: null,
    });
    expect((await c.qr(inst)).qr).toBe(f.QR);
    f.link(inst);
    expect(await c.qr(inst)).toEqual({
      state: 'open',
      qr: null,
      pairingCode: null,
      phone: '+51987654321',
    });
  });

  it('enviar: conectado sale por WhatsApp; desconectado queda como envío manual (wa.me)', async () => {
    const f = fakeEvolution();
    const c = new EvolutionClient('http://evo:8080', 'k', f.fetchFn);
    const s = new EvolutionSender(c, inst, 0);
    const manual = await s.send({ to: '+51911222333', body: 'Hola' });
    expect(manual).toMatchObject({
      status: 'manual',
      actionUrl: expect.stringContaining('https://wa.me/51911222333'),
    });
    f.link(inst);
    expect(await s.send({ to: '+51911222333', body: 'Recordatorio' })).toEqual({
      status: 'sent',
      providerMessageId: 'msg-1',
    });
    expect(f.sent[0]).toMatchObject({
      instance: inst,
      number: '51911222333',
      text: 'Recordatorio',
      linkPreview: false,
    });
    expect(await s.verify()).toEqual({ displayPhone: '+51987654321', name: null });
  });

  it('separa los envíos de un mismo número', async () => {
    const f = fakeEvolution();
    f.link('pausa');
    const s = new EvolutionSender(
      new EvolutionClient('http://evo:8080', 'k', f.fetchFn),
      'pausa',
      150,
    );
    const t0 = Date.now();
    await s.send({ to: '+51911222333', body: 'a' });
    await s.send({ to: '+51911222334', body: 'b' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
  });

  it('sin configurar o con la clave mala: error que no se reintenta', async () => {
    const f = fakeEvolution();
    await expect(new EvolutionClient('', '', f.fetchFn).state(inst)).rejects.toThrow(
      /no está configurado/,
    );
    const err = (await new EvolutionClient('http://evo:8080', 'mala', f.fetchFn)
      .state(inst)
      .catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
  });

  it('anti-bloqueo: no escribe a números sin WhatsApp, simula "escribiendo…" e invita a responder', async () => {
    resetEvolutionChecks();
    const f = fakeEvolution();
    f.link('anti');
    f.noWhatsApp.add('51900000000');
    const s = new EvolutionSender(new EvolutionClient('http://evo:8080', 'k', f.fetchFn), 'anti', {
      replyHint: true,
      typingMs: [1000, 3000],
      rand: () => 0.5,
    });
    const err = (await s
      .send({ to: '+51900000000', body: 'x' })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
    expect(f.sent).toHaveLength(0);
    await s.send({ to: '+51911222333', body: 'Tu cita es mañana' });
    expect(f.sent[0]).toMatchObject({ delay: 2000, linkPreview: false });
    expect(f.sent[0]!.text).toBe(`Tu cita es mañana\n\n${REPLY_HINT}`);
  });
});
