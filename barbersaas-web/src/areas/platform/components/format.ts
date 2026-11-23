export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Lima' }).format(new Date(iso)) : '—';
export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' }).format(new Date(iso));
