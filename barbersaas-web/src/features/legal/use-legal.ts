import { usePublicComplaintsControllerLegal } from '@/api/generated/endpoints';

/** Datos legales de Cognira (vienen de la API: variables LEGAL_*). */
export function useLegal() {
  const q = usePublicComplaintsControllerLegal({ query: { staleTime: 3_600_000 } });
  const d = q.data;
  return {
    tradeName: d?.tradeName ?? 'Cognira Barber',
    legalName: d?.legalName ?? '[Razón social]',
    ruc: d?.taxId ?? '[RUC]',
    address: d?.address ?? '[Domicilio fiscal]',
    email: d?.email ?? '[correo de contacto]',
  };
}

/** Fecha de la versión vigente de los textos legales. */
export const LEGAL_UPDATED = '21 de noviembre de 2026';
