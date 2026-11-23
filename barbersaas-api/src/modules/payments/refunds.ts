import type { Tx } from '../../infra/prisma/prisma.service';

/**
 * Pide la devolución total de un cobro en línea (dentro de la transacción del cambio que la origina).
 * Idempotente: un cobro tiene a lo sumo una devolución activa (índice único parcial). La ejecuta el
 * worker con la pasarela; solo se piden cobros pagados.
 */
export async function requestRefund(
  tx: Tx,
  chargeId: string,
  reason: string,
  link: { saleId?: string; depositId?: string } = {},
): Promise<void> {
  const c = await tx.paymentCharge.findUnique({
    where: { id: chargeId },
    select: { barbershopId: true, amountCents: true, status: true },
  });
  if (!c || c.status !== 'paid') return;
  await tx.paymentRefund.createMany({
    data: [
      {
        barbershopId: c.barbershopId,
        chargeId,
        amountCents: c.amountCents,
        reason: reason.slice(0, 200),
        saleId: link.saleId ?? null,
        depositId: link.depositId ?? null,
      },
    ],
    skipDuplicates: true,
  });
}
