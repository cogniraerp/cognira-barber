import type { PublicShopDtoOutput } from '@/api/generated/model';
import { formatMoney } from '@/lib/utils';
import type { Selection } from './booking-wizard';

type Hours = PublicShopDtoOutput['locations'][number]['hours'];

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** "Abierto · cierra 19:00" / "Cerrado · abre mañana 09:00" a partir del horario y la hora de pared de la sede. */
export function openStatus(hours: Hours, wallNow: Date): { open: boolean; label: string } {
  const dow = wallNow.getDay();
  const mins = wallNow.getHours() * 60 + wallNow.getMinutes();
  const today = hours.find((h) => h.dayOfWeek === dow)?.blocks ?? [];
  const current = today.find((b) => toMin(b.start) <= mins && mins < toMin(b.end));
  if (current) return { open: true, label: `Abierto · cierra ${current.end}` };
  const laterToday = today.find((b) => toMin(b.start) > mins);
  if (laterToday) return { open: false, label: `Cerrado · abre hoy ${laterToday.start}` };
  for (let i = 1; i <= 7; i++) {
    const d = (dow + i) % 7;
    const first = hours.find((h) => h.dayOfWeek === d)?.blocks[0];
    if (first) return { open: false, label: `Cerrado · abre ${i === 1 ? 'mañana' : DAY_NAMES[d]!.toLowerCase()} ${first.start}` };
  }
  return { open: false, label: 'Cerrado' };
}

export const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Enlace a Google Maps: por coordenadas si las hay, si no por dirección. */
export function mapsUrl(loc: { lat: number | null; lng: number | null; address: string | null }, name: string): string | null {
  if (loc.lat !== null && loc.lng !== null) return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
  if (loc.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${loc.address}`)}`;
  return null;
}

/** "2027-03-01" + n días (sin depender de la zona del navegador). */
export function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** Agrupa horarios en Mañana / Tarde / Noche según la hora local. */
export function partOfDay(hour: number): 'Mañana' | 'Tarde' | 'Noche' {
  return hour < 12 ? 'Mañana' : hour < 18 ? 'Tarde' : 'Noche';
}

/** Servicios que puede hacer cada barbero → barberos que pueden hacer TODOS los elegidos. */
export function eligibleStaff(shop: PublicShopDtoOutput, serviceIds: string[]) {
  const sets = shop.services.filter((s) => serviceIds.includes(s.id)).map((s) => new Set(s.staffIds));
  return shop.staff.filter((st) => sets.every((set) => set.has(st.id)));
}

/** Rango de precio de los servicios elegidos (cada barbero puede cobrar distinto). */
export function priceRange(shop: PublicShopDtoOutput, serviceIds: string[]) {
  const chosen = shop.services.filter((s) => serviceIds.includes(s.id));
  return {
    from: chosen.reduce((n, s) => n + s.priceFromCents, 0),
    to: chosen.reduce((n, s) => n + s.priceToCents, 0),
    minutes: chosen.reduce((n, s) => n + s.durationMin, 0),
  };
}

// ───────────── Reservas recordadas en este dispositivo ─────────────
// Solo el enlace de gestión (token firmado) y la hora: así "Tu próxima cita" aparece al volver.

type Saved = { token: string; startAt: string };
const key = (slug: string) => `barbersaas.bookings.${slug}`;

export function savedBookings(slug: string): Saved[] {
  try {
    const list = JSON.parse(localStorage.getItem(key(slug)) ?? '[]') as Saved[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function rememberBooking(slug: string, b: Saved): void {
  const list = [b, ...savedBookings(slug).filter((x) => x.token !== b.token)].slice(0, 5);
  localStorage.setItem(key(slug), JSON.stringify(list));
}

export function forgetBooking(slug: string, token: string): void {
  localStorage.setItem(key(slug), JSON.stringify(savedBookings(slug).filter((x) => x.token !== token)));
}

/** Datos del cliente para no volver a escribirlos (solo si lo pidió). */
type Contact = { fullName: string; phone: string; email: string };
const CONTACT = 'barbersaas.contact';
export function savedContact(): Contact | null {
  try {
    return JSON.parse(localStorage.getItem(CONTACT) ?? 'null') as Contact | null;
  } catch {
    return null;
  }
}
export function rememberContact(c: Contact | null): void {
  if (c) localStorage.setItem(CONTACT, JSON.stringify(c));
  else localStorage.removeItem(CONTACT);
}

export const EMPTY: Selection = { serviceIds: [], staffId: null, slot: null, quotes: [] };

/** "S/ 30.00" o "S/ 30.00 – S/ 40.00" si los barberos cobran distinto. */
export function money(shop: PublicShopDtoOutput, from: number, to: number): string {
  return from === to ? formatMoney(from, shop.currency) : `${formatMoney(from, shop.currency)} – ${formatMoney(to, shop.currency)}`;
}

/** "mm:ss" que faltan (0 si ya venció). */
export function remaining(untilIso: string, now: number): { ms: number; label: string } {
  const ms = Math.max(0, Date.parse(untilIso) - now);
  const s = Math.floor(ms / 1000);
  return { ms, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` };
}
