import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ChargesService, releaseHold } from '../payments/charges.service';

/** Adelantos: vencimiento de los horarios apartados que no se pagaron (lo corre el worker). */
@Injectable()
export class DepositsService {
  private readonly logger = new Logger('Deposits');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly charges: ChargesService,
  ) {}

  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.appointmentDeposit.findMany({
        where: { status: 'pending', holdExpiresAt: { lt: now } },
        select: { id: true, barbershopId: true, chargeId: true, appointmentId: true },
        orderBy: { holdExpiresAt: 'asc' },
        take: 100,
      }),
    );
    let released = 0;
    for (const d of due) {
      // Última consulta a la pasarela: si pagó y el webhook no llegó, se confirma en vez de liberar.
      if (d.chargeId)
        await this.charges.refreshSystem(d.barbershopId, d.chargeId).catch(() => undefined);
      const done = await this.prisma.run(
        { kind: 'tenant', barbershopId: d.barbershopId },
        async (tx) => {
          const [row] = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM appointment_deposits WHERE id = ${d.id}::uuid AND status = 'pending' FOR UPDATE SKIP LOCKED`;
          if (!row) return false;
          const ok = await releaseHold(tx, d.id, 'Pago del adelanto no completado');
          if (ok)
            await this.audit.record(tx, {
              action: 'deposit.expired',
              barbershopId: d.barbershopId,
              entity: 'appointment',
              entityId: d.appointmentId,
            });
          return ok;
        },
      );
      if (done) released++;
    }
    if (released) this.logger.log(`Horarios liberados por adelanto sin pagar: ${released}`);
    return released;
  }
}
