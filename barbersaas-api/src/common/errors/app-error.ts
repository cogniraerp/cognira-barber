import { HttpStatus } from '@nestjs/common';

/** Códigos estables: el frontend los traduce con i18n. No cambiar los existentes. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  TENANT_REQUIRED: 'TENANT_REQUIRED',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  SLOT_TAKEN: 'SLOT_TAKEN',
  /** La pasarela de pago respondió con error o no respondió. */
  GATEWAY_ERROR: 'GATEWAY_ERROR',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: HttpStatus,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  static notFound(entity: string): AppError {
    return new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, `${entity} no encontrado`);
  }

  static unauthenticated(message = 'Sesión inválida o expirada'): AppError {
    return new AppError(ErrorCode.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, message);
  }

  static forbidden(message = 'No tienes permiso para esta acción'): AppError {
    return new AppError(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, message);
  }

  static conflict(
    message: string,
    code: ErrorCode = ErrorCode.CONFLICT,
    details?: Record<string, unknown>,
  ): AppError {
    return new AppError(code, HttpStatus.CONFLICT, message, details);
  }
}
