import { HttpStatus } from '@nestjs/common';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import type { StorageProvider } from '../../infra/storage/storage.provider';

/**
 * Solo se aceptan URLs de imágenes subidas por ESTA barbería (evita hotlinking,
 * píxeles de rastreo o contenido de terceros en la página pública).
 */
export function assertOwnFile(
  storage: StorageProvider,
  barbershopId: string,
  url: string | null | undefined,
  field: string,
): void {
  if (url === null || url === undefined) return;
  const key = storage.keyFromUrl(url);
  if (!key || !key.startsWith(`${barbershopId}/`)) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      HttpStatus.BAD_REQUEST,
      'La imagen debe subirse primero a /v1/shop/uploads',
      {
        errors: [{ path: field, message: 'URL de imagen no válida' }],
      },
    );
  }
}
