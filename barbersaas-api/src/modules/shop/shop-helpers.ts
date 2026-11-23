import { HttpStatus } from '@nestjs/common';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import type { Tx } from '../../infra/prisma/prisma.service';

/** Citas que bloquean borrar/desactivar algo (pendientes, confirmadas o en curso, en el futuro). */
export const ACTIVE_APPOINTMENT = {
  in: ['awaiting_payment', 'pending', 'confirmed', 'in_progress'] as Array<
    'awaiting_payment' | 'pending' | 'confirmed' | 'in_progress'
  >,
};

export async function assertNoFutureAppointments(
  tx: Tx,
  where: { barbershopId: string; staffId?: string; locationId?: string },
  what: string,
): Promise<void> {
  const n = await tx.appointment.count({
    where: { ...where, deletedAt: null, status: ACTIVE_APPOINTMENT, endAt: { gt: new Date() } },
  });
  if (n > 0) {
    throw AppError.conflict(
      `${what} tiene ${n} cita(s) futura(s): reprograma o cancela primero`,
      ErrorCode.CONFLICT,
      { futureAppointments: n },
    );
  }
}

export function badRequest(path: string, message: string): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, message, {
    errors: [{ path, message }],
  });
}

/** Reordenar: la lista debe contener exactamente todos los ids existentes. */
export function assertSameSet(ids: string[], existing: string[]): void {
  const known = new Set(existing);
  if (
    ids.length !== known.size ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => known.has(id))
  ) {
    throw AppError.conflict('La lista debe contener exactamente todos los elementos, sin repetir');
  }
}
