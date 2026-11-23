import type { BillingNoticeKind } from '../../generated/prisma/enums';
import type { Tx } from '../../infra/prisma/prisma.service';

/**
 * Encola un aviso de cobranza por correo y por WhatsApp (una fila por canal; la tabla deduplica por
 * factura, tipo y canal). Devuelve cuántos se encolaron (0 si ya existían).
 */
export async function queueBillingNotice(
  tx: Tx,
  n: { barbershopId: string; invoiceId: string; kind: BillingNoticeKind },
): Promise<number> {
  const r = await tx.billingNotice.createMany({
    data: (['email', 'whatsapp'] as const).map((channel) => ({ ...n, channel })),
    skipDuplicates: true,
  });
  return r.count;
}
