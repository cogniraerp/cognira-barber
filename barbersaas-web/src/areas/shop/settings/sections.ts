import { BadgeCheck, BookOpenText, CalendarClock, Globe, ClipboardList, CreditCard, IdCard, Palette, SlidersHorizontal, UsersRound, type LucideIcon } from 'lucide-react';

/** Secciones de Configuración: cada una es una ruta propia (/s/:slug/configuracion/<to>) y un ítem del submenú. */
export const SETTINGS_SECTIONS: Array<{ to: string; label: string; perm: string; icon: LucideIcon; description: string }> = [
  { to: 'perfil', label: 'Datos', perm: 'shop.manage', icon: IdCard, description: 'Nombre, contacto, dirección, redes y logo de la barbería.' },
  { to: 'marca', label: 'Marca', perm: 'shop.manage', icon: Palette, description: 'Colores, tipografía, portada y galería de tu página de reservas.' },
  { to: 'horarios', label: 'Horarios', perm: 'schedules.manage', icon: CalendarClock, description: 'Horario de atención, feriados y días especiales.' },
  { to: 'reglas', label: 'Reglas de reserva', perm: 'shop.manage', icon: ClipboardList, description: 'Anticipación, intervalos, cancelación y datos que pides al cliente.' },
  { to: 'usuarios', label: 'Usuarios y permisos', perm: 'members.manage', icon: UsersRound, description: 'Quién entra al panel, con qué rol y qué puede hacer cada rol.' },
  { to: 'dominio', label: 'Dominio propio', perm: 'shop.manage', icon: Globe, description: 'Tu página de reservas en tu propia dirección (reservas.tubarberia.pe).' },
  { to: 'pagos', label: 'Pagos en línea', perm: 'payments.manage', icon: CreditCard, description: 'Conecta tu pasarela (Mercado Pago o Izipay) para cobrar con link o QR.' },
  { to: 'reclamaciones', label: 'Libro de reclamaciones', perm: 'complaints.manage', icon: BookOpenText, description: 'Las hojas de reclamación de tus clientes y tu respuesta (INDECOPI).' },
  { to: 'suscripcion', label: 'Suscripción', perm: 'billing.view', icon: BadgeCheck, description: 'Tu plan de Cognira Barber, tus facturas y el pago en línea.' },
  { to: 'general', label: 'Preferencias', perm: 'shop.manage', icon: SlidersHorizontal, description: 'Idioma, zona horaria y moneda.' },
];
