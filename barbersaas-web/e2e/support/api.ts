/**
 * Preparación de datos por la API (rápido y sin depender de la UI ni de los datos demo).
 * Cada llamada a `createShop()` arma una barbería nueva y publicada:
 *  - dueño con cuenta, horario de todos los días (00:00–23:45) y reservas sin anticipación mínima;
 *  - 2 barberos: Carlos (con usuario propio, rol barbero, para "Mi día") y Diego;
 *  - 2 servicios que hacen ambos.
 */
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3100';
export const PASSWORD = 'e2e-pass-1234';

type Opts = { token?: string; slug?: string; body?: unknown };

export async function api<T = unknown>(method: string, path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.slug) headers['x-tenant-slug'] = opts.slug;
  const res = await fetch(`${API_URL}/v1${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) throw new ApiFailure(method, path, res.status, data);
  return data as T;
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(method: string, path: string, status: number, body: unknown) {
    super(`${method} ${path} → ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

const rand = () => Math.random().toString(36).slice(2, 8);

export type ShopFixture = {
  id: string;
  slug: string;
  name: string;
  owner: { email: string; token: string };
  barber: { email: string; staffId: string };
  staff: { carlos: string; diego: string };
  services: { corte: string; barba: string };
};

export async function register(email: string, fullName: string): Promise<string> {
  const r = await api<{ accessToken: string }>('POST', '/auth/register', {
    body: { email, password: PASSWORD, fullName, acceptTerms: true },
  });
  return r.accessToken;
}

export async function createShop(): Promise<ShopFixture> {
  const tag = `${Date.now().toString(36)}${rand()}`;
  const ownerEmail = `e2e-dueno-${tag}@test.pe`;
  const ownerToken = await register(ownerEmail, 'Dueña E2E');
  const name = `Barbería E2E ${tag}`;
  const shop = await api<{ id: string; slug: string }>('POST', '/me/barbershops', { token: ownerToken, body: { name } });
  const s = { token: ownerToken, slug: shop.slug };

  await api('PATCH', '/shop/profile', { ...s, body: { phone: '+51 911 222 333', address: { address: 'Av. Pruebas 123, Miraflores' } } });
  const [loc] = await api<Array<{ id: string; isPrimary: boolean }>>('GET', '/shop/locations', s);
  await api('PUT', `/shop/locations/${loc!.id}/hours`, {
    ...s,
    body: { days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, blocks: [{ start: '00:00', end: '23:45' }] })) },
  });
  await api('PUT', '/shop/settings/booking-rules', {
    ...s,
    body: { minNoticeMinutes: 0, maxAdvanceDays: 30, slotIntervalMinutes: 15, cancellationWindowHours: 0, rescheduleWindowHours: 0, maxActiveBookingsPerCustomer: 5 },
  });

  // Carlos entra con su propio usuario (invitación aceptada) → rol barbero vinculado a su perfil.
  const barberEmail = `e2e-barbero-${tag}@test.pe`;
  const inv = await api<{ inviteToken: string; member: { staffId: string } }>('POST', '/shop/members/invite', {
    ...s,
    body: { email: barberEmail, role: 'barber', staff: { displayName: 'Carlos' } },
  });
  const barberToken = await register(barberEmail, 'Carlos E2E');
  await api('POST', `/invitations/${inv.inviteToken}/accept`, { token: barberToken });
  const carlos = inv.member.staffId;
  const diego = (await api<{ id: string }>('POST', '/shop/staff', { ...s, body: { displayName: 'Diego' } })).id;

  const corte = (await api<{ id: string }>('POST', '/shop/services', {
    ...s,
    body: { name: 'Corte clásico', priceCents: 3500, durationMin: 30, staffIds: [carlos, diego] },
  })).id;
  const barba = (await api<{ id: string }>('POST', '/shop/services', {
    ...s,
    body: { name: 'Perfilado de barba', priceCents: 2000, durationMin: 20, staffIds: [carlos, diego] },
  })).id;

  await api('POST', '/shop/onboarding/activate', s);
  return {
    id: shop.id,
    slug: shop.slug,
    name,
    owner: { email: ownerEmail, token: ownerToken },
    barber: { email: barberEmail, staffId: carlos },
    staff: { carlos, diego },
    services: { corte, barba },
  };
}

type Availability = { timezone: string; days: Array<{ date: string; slots: Array<{ start: string; staffIds?: string[] }> }> };

/** Primer horario libre (desde hoy) para esos servicios y barbero, según la API pública. */
export async function firstFreeSlot(slug: string, serviceIds: string[], staffId?: string): Promise<{ date: string; start: string }> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
  const to = new Date(Date.parse(`${today}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const q = new URLSearchParams({ from: today, to });
  for (const id of serviceIds) q.append('serviceIds', id);
  if (staffId) q.set('staffId', staffId);
  const a = await api<Availability>('GET', `/public/shops/${slug}/availability?${q}`);
  // Mañana o después: evita que el horario "de hoy" venza mientras corre la prueba.
  const day = a.days.find((d) => d.date > today && d.slots.length) ?? a.days.find((d) => d.slots.length);
  if (!day) throw new Error('Sin disponibilidad para la prueba');
  return { date: day.date, start: day.slots[0]!.start };
}

export type PublicAppointment = { id: string; status: string; startAt: string; manageToken: string; staff: { id: string; displayName: string } };

export function bookPublic(slug: string, body: { serviceIds: string[]; staffId: string | null; startAt: string; customer: { fullName: string; phone: string } }) {
  return api<PublicAppointment>('POST', `/public/shops/${slug}/appointments`, { body });
}

export function viewPublic(token: string) {
  return api<PublicAppointment>('GET', `/public/appointments/${token}`);
}

/** Celular peruano único por prueba (el cliente se identifica por teléfono). */
export const phone = () => `9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/** Superadmin del seed (en CI lo crea `pnpm db:seed` con SEED_SUPERADMIN_*). */
const SUPERADMIN = {
  email: process.env.E2E_SUPERADMIN_EMAIL ?? 'admin@barbersaas.pe',
  password: process.env.E2E_SUPERADMIN_PASSWORD ?? 'admin-1234',
};

/**
 * Pagos en línea para la barbería de la prueba: el superadmin la pasa al plan Pro (incluye
 * `onlinePayments`) y la dueña conecta la pasarela simulada (sin dinero real).
 */
let superToken: Promise<string> | null = null;
/** Token del superadmin (un solo login por worker, para no gastar el límite de logins). */
function superadmin(): Promise<string> {
  superToken ??= api<{ accessToken: string }>('POST', '/auth/login', { body: SUPERADMIN }).then((r) => r.accessToken);
  return superToken;
}

/** Borra (soft delete) la barbería de la prueba al terminar, para no ensuciar la base. */
export async function deleteShop(shop: ShopFixture): Promise<void> {
  await api('DELETE', `/platform/barbershops/${shop.id}`, {
    token: await superadmin(),
    body: { reason: 'Limpieza: barbería creada por las pruebas E2E' },
  });
}

export async function enableOnlinePayments(shop: ShopFixture): Promise<void> {
  await api('POST', `/platform/barbershops/${shop.id}/change-plan`, { token: await superadmin(), body: { planCode: 'pro' } });
  // Idempotente: las pruebas del proyecto comparten la barbería (409 = el simulador ya estaba).
  await api('POST', '/shop/payment-gateways', { token: shop.owner.token, slug: shop.slug, body: { provider: 'simulator' } }).catch(
    (e: unknown) => {
      if (!(e instanceof ApiFailure && e.status === 409)) throw e;
    },
  );
}

/** Regla de comisión del barbero: % sobre servicios (en puntos básicos: 4000 = 40 %). */
export function setServiceCommission(shop: ShopFixture, staffId: string, percentBp: number) {
  return api('PUT', `/shop/commissions/config/${staffId}`, {
    token: shop.owner.token,
    slug: shop.slug,
    body: { service: { type: 'percent', value: percentBp } },
  });
}

/** Regla de adelanto de la barbería (p. ej. 50 % a todos, horario apartado 15 min). */
export async function setDeposit(shop: ShopFixture, deposit: { required: boolean; type: 'percent' | 'fixed' | 'full'; value: number }) {
  const s = { token: shop.owner.token, slug: shop.slug };
  const rules = await api<Record<string, unknown> & { deposit: Record<string, unknown> }>('GET', '/shop/settings/booking-rules', s);
  await api('PUT', '/shop/settings/booking-rules', { ...s, body: { ...rules, deposit: { ...rules.deposit, ...deposit, appliesTo: 'all', holdMinutes: 15 } } });
}
