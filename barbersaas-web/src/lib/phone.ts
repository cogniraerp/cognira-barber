/**
 * Teléfono E.164 → legible. Perú (móvil): "+51 987 654 321". Los de otros países se dejan tal cual
 * (sin una librería de numeración no se sabe dónde termina el código de país), igual que los
 * enmascarados ("+51 ••• ••• 555") y vacíos.
 */
export function formatPhone(phone: string | null | undefined): string | null {
  if (!phone) return phone ?? null;
  const pe = /^\+51(9\d{2})(\d{3})(\d{3})$/.exec(phone);
  return pe ? `+51 ${pe[1]} ${pe[2]} ${pe[3]}` : phone;
}
