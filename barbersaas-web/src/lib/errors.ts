import type { TFunction } from 'i18next';
import { ApiError } from '@/api/errors';

/** Mensaje para el usuario: título de la API si es específico; si no, el del código traducido. */
export function errorMessage(e: unknown, t: TFunction): string {
  if (e instanceof ApiError) {
    const generic = t(`errors.${e.code}`, { defaultValue: '' });
    // Validación: el detalle va por campo; arriba, el genérico.
    if (e.code === 'VALIDATION_FAILED') return generic;
    return e.problem.title || generic || t('errors.INTERNAL');
  }
  if (e instanceof TypeError) return t('errors.network');
  return t('errors.INTERNAL');
}
