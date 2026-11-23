/** Dominio propio por barbería: validación y verificación DNS (sin I/O). */

export const TXT_PREFIX = '_cognira-verify';

/**
 * Normaliza lo que escribe el dueño ("https://Reservas.MiBarberia.pe/") a un hostname.
 * Devuelve un mensaje de error si no sirve.
 */
export function normalizeDomain(
  input: string,
  rootDomain: string,
): { ok: true; domain: string } | { ok: false; error: string } {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  if (!host) return { ok: false, error: 'Escribe tu dominio, por ejemplo reservas.tubarberia.pe' };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':'))
    return { ok: false, error: 'Usa un dominio, no una dirección IP' };
  const labels = host.split('.');
  const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  if (
    host.length > 253 ||
    labels.length < 2 ||
    !labels.every((l) => label.test(l)) ||
    /^\d+$/.test(labels.at(-1)!)
  )
    return { ok: false, error: 'No es un dominio válido' };
  const root = rootDomain.toLowerCase();
  if (host === root || host.endsWith(`.${root}`))
    return { ok: false, error: 'Ese dominio ya es de Cognira: usa uno tuyo' };
  return { ok: true, domain: host };
}

/** ¿Es un dominio raíz (sin subdominio)? Esos no admiten CNAME: se usan registros A. */
export const isApex = (domain: string) =>
  domain.split('.').length === 2 ||
  (/\.(com|net|org|gob|edu)\.pe$/.test(domain) && domain.split('.').length === 3);

export interface DnsInstructions {
  txt: { name: string; value: string };
  /** Subdominio: CNAME → {slug}.ROOT. Dominio raíz: registros A (las IP del servidor). */
  point: { type: 'CNAME' | 'A'; name: string; value: string };
}

export function instructions(
  domain: string,
  token: string,
  target: string,
  targetA: string[],
): DnsInstructions {
  return {
    txt: { name: `${TXT_PREFIX}.${domain}`, value: `cognira-verify=${token}` },
    point: isApex(domain)
      ? { type: 'A', name: domain, value: targetA.join(', ') || '(IP del servidor)' }
      : { type: 'CNAME', name: domain, value: target },
  };
}

export interface DnsLookup {
  txt: string[][];
  cname: string[];
  a: string[];
  targetA: string[];
}

/** Resultado de la verificación: los dos registros deben estar bien. */
export function evaluateDns(
  r: DnsLookup,
  token: string,
  target: string,
): { ok: boolean; txtOk: boolean; pointOk: boolean; error: string | null } {
  const txtOk = r.txt.some((chunks) => chunks.join('').trim() === `cognira-verify=${token}`);
  const norm = (h: string) => h.toLowerCase().replace(/\.$/, '');
  const pointOk =
    r.cname.some((c) => norm(c) === norm(target)) ||
    (r.a.length > 0 && r.a.some((ip) => r.targetA.includes(ip)));
  const error = !txtOk
    ? 'No encontramos el registro TXT de verificación (puede tardar hasta unas horas en propagarse).'
    : !pointOk
      ? 'El dominio todavía no apunta a Cognira: revisa el registro CNAME o A.'
      : null;
  return { ok: txtOk && pointOk, txtOk, pointOk, error };
}
