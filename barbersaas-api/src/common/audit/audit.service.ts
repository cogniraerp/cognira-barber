import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../infra/prisma/prisma.service';
import { RequestContext } from '../request-context/request-context';

export interface AuditEntry {
  action: string;
  barbershopId?: string | null;
  entity?: string;
  entityId?: string;
  /** Cualquier objeto serializable (DTOs, cambios from/to). Las fechas se guardan en ISO. */
  diff?: object;
}

const SECRET_KEYS = /password|token|secret|credential|hash/i;

/**
 * Registra acciones sensibles DENTRO de la transacción de la operación:
 * si la operación hace rollback, el log también (y viceversa).
 * Actor, impersonador, IP y user-agent salen del RequestContext.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    const rc = RequestContext.get();
    await tx.auditLog.create({
      data: {
        action: entry.action,
        barbershopId: entry.barbershopId ?? null,
        entity: entry.entity,
        entityId: entry.entityId,
        diff: entry.diff === undefined ? undefined : redact(toJson(entry.diff)),
        actorUserId: rc?.userId,
        impersonatorUserId: rc?.impersonatorUserId,
        ip: rc?.ip,
        userAgent: rc?.userAgent,
      },
    });
  }
}

function toJson(v: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

export function redact(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  if (Array.isArray(value)) return value.map((v) => redact(v as Prisma.InputJsonValue));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SECRET_KEYS.test(k) ? '[redacted]' : redact(v as Prisma.InputJsonValue),
      ]),
    );
  }
  return value;
}
