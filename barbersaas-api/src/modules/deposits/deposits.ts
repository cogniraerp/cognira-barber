import { requestRefund } from '../payments/refunds';
import type { AuditService } from '../../common/audit/audit.service';
import type { Tx } from '../../infra/prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { readBookingRules } from '../shop/settings.schemas';

/**
 * Se pagó el cobro de un adelanto (lo llama ChargesService en la misma transacción).
 *  - Si la cita sigue apartada: se confirma (o queda pendiente si la barbería aprueba a mano)
 *    y recién ahí sale el aviso de "reserva recibida/confirmada".
 *  - Si llegó tarde (la cita ya venció o se canceló): el adelanto queda para devolver.
 */
export async function onDepositChargePaid(
  tx: Tx,
  chargeId: string,
  deps: { notifications: NotificationsService; audit: AuditService },
): Promise<void> {
  const dep = await tx.appointmentDeposit.findUnique({
    where: { chargeId },
    select: {
      id: true,
      status: true,
      barbershopId: true,
      appointmentId: true,
      appointment: { select: { status: true } },
    },
  });
  if (!dep || (dep.status !== 'pending' && dep.status !== 'expired')) return;
  const now = new Date();
  if (dep.appointment.status === 'awaiting_payment') {
    const settings = await tx.barbershopSettings.findUnique({
      where: { barbershopId: dep.barbershopId },
      select: { bookingRules: true },
    });
    const status =
      readBookingRules(settings?.bookingRules).approvalMode === 'manual' ? 'pending' : 'confirmed';
    await tx.appointment.update({
      where: { id: dep.appointmentId },
      data: { status, confirmedAt: status === 'confirmed' ? now : null },
    });
    await tx.appointmentDeposit.update({
      where: { id: dep.id },
      data: { status: 'paid', paidAt: now },
    });
    await deps.notifications.onAppointment(tx, 'created', dep.appointmentId);
  } else {
    await tx.appointmentDeposit.update({
      where: { id: dep.id },
      data: { status: 'refund_pending', paidAt: now },
    });
    await requestRefund(tx, chargeId, 'Adelanto pagado después de vencer la reserva', {
      depositId: dep.id,
    });
  }
  await deps.audit.record(tx, {
    action: dep.appointment.status === 'awaiting_payment' ? 'deposit.paid' : 'deposit.paid_late',
    barbershopId: dep.barbershopId,
    entity: 'appointment',
    entityId: dep.appointmentId,
  });
}

/**
 * La cita con adelanto PAGADO (aún no aplicado a una venta) cambió de estado:
 *  - cancelada (por el cliente a tiempo o por la barbería) → se devuelve;
 *  - no se presentó → la barbería lo retiene (o se devuelve si así lo configuró).
 */
export async function onDepositAppointmentClosed(
  tx: Tx,
  appointmentId: string,
  to: 'canceled' | 'no_show',
): Promise<void> {
  const dep = await tx.appointmentDeposit.findUnique({
    where: { appointmentId },
    select: { id: true, status: true, barbershopId: true, chargeId: true },
  });
  if (!dep || dep.status !== 'paid') return;
  let next: 'refund_pending' | 'retained' = 'refund_pending';
  if (to === 'no_show') {
    const settings = await tx.barbershopSettings.findUnique({
      where: { barbershopId: dep.barbershopId },
      select: { bookingRules: true },
    });
    if (readBookingRules(settings?.bookingRules).deposit.retainOnNoShow) next = 'retained';
  }
  await tx.appointmentDeposit.update({
    where: { id: dep.id },
    data: { status: next, resolvedAt: new Date() },
  });
  if (next === 'refund_pending' && dep.chargeId)
    await requestRefund(
      tx,
      dep.chargeId,
      to === 'no_show' ? 'Adelanto devuelto (no se presentó)' : 'Cita cancelada',
      {
        depositId: dep.id,
      },
    );
}

/** En caja: el cobro del adelanto se usó como pago de la venta → queda aplicado. */
export async function onDepositAppliedToSale(
  tx: Tx,
  chargeId: string,
  saleId: string,
): Promise<void> {
  await tx.appointmentDeposit.updateMany({
    where: { chargeId, status: 'paid' },
    data: { status: 'applied', appliedSaleId: saleId, resolvedAt: new Date() },
  });
}

/** Se anuló la venta que usó el adelanto → hay que devolverlo. */
export async function onDepositSaleVoided(tx: Tx, saleId: string): Promise<void> {
  await tx.appointmentDeposit.updateMany({
    where: { appliedSaleId: saleId, status: 'applied' },
    data: { status: 'refund_pending', resolvedAt: new Date() },
  });
}
