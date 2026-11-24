/** Correo de invitación a una barbería (sin I/O). */
const ROLE_LABEL: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  receptionist: 'Recepción',
  barber: 'Barbero',
};

export function inviteEmail(p: { shopName: string; role: string; url: string; expiresAt: Date }) {
  const until = new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'long',
    timeZone: 'America/Lima',
  }).format(p.expiresAt);
  return {
    subject: `Te invitaron a ${p.shopName} en Cognira Barber`,
    body: [
      'Hola:',
      '',
      `Te invitaron a unirte a ${p.shopName} como ${ROLE_LABEL[p.role] ?? p.role} en Cognira Barber.`,
      'Crea tu cuenta y elige tu contraseña con este enlace:',
      p.url,
      '',
      `El enlace vence el ${until} y sirve una sola vez. Si no esperabas este correo, ignóralo.`,
      '',
      'Cognira Barber',
    ].join('\n'),
  };
}
