/** Roles de la barbería: fijos (owner, admin, recepción, barbero); sus permisos se ajustan por barbería. */
export type Role = 'owner' | 'admin' | 'receptionist' | 'barber';

export const ROLE_INFO: Record<Role, { description: string }> = {
  owner: { description: 'Dueño de la barbería: acceso total, incluida la suscripción.' },
  admin: { description: 'Administra la barbería: agenda, clientes, equipo y configuración.' },
  receptionist: { description: 'Atiende la agenda de todos los barberos y a los clientes.' },
  barber: { description: 'Su agenda y "Mi día", sus bloqueos y los clientes que atiende.' },
};

export const PERM_LABELS: Record<string, string> = {
  'dashboard.view': 'Ver el inicio',
  'reports.view': 'Ver reportes',
  'appointments.view_all': 'Ver todas las citas',
  'appointments.manage_all': 'Gestionar todas las citas',
  'appointments.view_own': 'Ver sus citas',
  'appointments.manage_own': 'Gestionar sus citas',
  'customers.view': 'Ver clientes',
  'customers.manage': 'Crear, editar, bloquear y fusionar clientes',
  'customers.view_contact': 'Ver teléfono y email de los clientes',
  'customers.export': 'Exportar clientes (CSV)',
  'shop.manage': 'Configurar la barbería (datos, marca, reglas)',
  'locations.manage': 'Gestionar sedes',
  'schedules.manage': 'Gestionar horarios y feriados',
  'services.manage': 'Gestionar servicios',
  'staff.manage': 'Gestionar barberos',
  'members.manage': 'Gestionar usuarios',
  'whatsapp.manage': 'WhatsApp y mensajes',
  'cash.manage': 'Caja',
  'commissions.view_own': 'Ver sus comisiones',
  'commissions.manage': 'Configurar y liquidar comisiones',
  'products.manage': 'Gestionar el catálogo de productos',
  'inventory.manage': 'Ingresar compras y ajustar stock',
  'sales.create': 'Cobrar (punto de venta)',
  'sales.view_all': 'Ver todas las ventas',
  'sales.void': 'Anular ventas',
  'payments.manage': 'Conectar la pasarela de pagos en línea',
  'complaints.manage': 'Ver y responder el Libro de Reclamaciones',
  'billing.view': 'Ver la suscripción',
  'billing.manage': 'Pagar la suscripción',
};

/** Agrupados por módulo, como en Cognira ERP. La suscripción (billing.*) es solo del dueño. */
export const PERM_GROUPS: Array<{ name: string; perms: string[] }> = [
  { name: 'Agenda', perms: ['appointments.view_all', 'appointments.manage_all', 'appointments.view_own', 'appointments.manage_own'] },
  { name: 'Clientes', perms: ['customers.view', 'customers.manage', 'customers.view_contact', 'customers.export', 'complaints.manage'] },
  { name: 'Barbería', perms: ['shop.manage', 'schedules.manage', 'services.manage', 'staff.manage', 'locations.manage'] },
  { name: 'Equipo', perms: ['members.manage'] },
  { name: 'Inventario', perms: ['products.manage', 'inventory.manage'] },
  { name: 'Mensajes', perms: ['whatsapp.manage'] },
  { name: 'Caja y ventas', perms: ['sales.create', 'sales.view_all', 'sales.void', 'cash.manage', 'payments.manage'] },
  { name: 'Inicio, reportes y comisiones', perms: ['dashboard.view', 'reports.view', 'commissions.view_own', 'commissions.manage'] },
];

/** Permisos que exponen datos personales o dan control del negocio. */
export const SENSITIVE = new Set(['customers.view_contact', 'customers.export', 'members.manage', 'shop.manage', 'staff.manage', 'sales.void', 'commissions.manage', 'payments.manage', 'complaints.manage']);
