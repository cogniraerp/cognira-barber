import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { EvolutionCredentials } from './providers/evolution';
import { SenderRegistry } from './sender-registry';
import { disconnectedEmail } from './whatsapp-health';

const SYSTEM = { kind: 'system' } as const;
const EVERY_MS = 10 * 60_000;
export const DISCONNECTED_ERROR = 'El WhatsApp se desvinculó: vuelve a escanear el código QR';

/**
 * Vigila los WhatsApp vinculados por QR (Evolution). Si uno se desvincula, lo marca y avisa al dueño
 * por correo; si vuelve, lo da por conectado. Solo actúa en los cambios (no repite avisos).
 */
@Injectable()
export class WhatsAppHealthService {
  private readonly logger = new Logger('WhatsAppHealth');
  private lastRun = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly senders: SenderRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Lo llama el worker cada minuto; revisa cada 10. */
  async checkDue(now = Date.now()): Promise<void> {
    if (now - this.lastRun < EVERY_MS) return;
    this.lastRun = now;
    await this.check();
  }

  async check(): Promise<{ checked: number; disconnected: number; reconnected: number }> {
    const out = { checked: 0, disconnected: 0, reconnected: 0 };
    const evo = this.senders.evolution();
    if (!evo.configured) return out;
    const rows = await this.prisma.run(SYSTEM, (tx) =>
      tx.whatsappConfig.findMany({
        where: { provider: 'evolution', barbershop: { deletedAt: null } },
        select: {
          barbershopId: true,
          provider: true,
          credentialsEnc: true,
          keyVersion: true,
          status: true,
          displayPhone: true,
          barbershop: {
            select: {
              name: true,
              slug: true,
              email: true,
              memberships: {
                where: { role: 'owner', status: 'active', deletedAt: null },
                select: { user: { select: { email: true } } },
              },
            },
          },
        },
      }),
    );
    for (const row of rows) {
      let instance: string;
      try {
        instance = this.senders.creds<EvolutionCredentials>(row).instanceName;
      } catch {
        continue;
      }
      // Si Evolution no responde no se cambia nada: no se alarma a todas las barberías por una caída.
      const state = await evo.state(instance).catch(() => null);
      if (!state) continue;
      out.checked++;
      if (state === 'open' && row.status !== 'ok') {
        const phone = await evo.phone(instance).catch(() => row.displayPhone);
        await this.prisma.run(SYSTEM, (tx) =>
          tx.whatsappConfig.update({
            where: { barbershopId: row.barbershopId },
            data: { status: 'ok', displayPhone: phone, lastError: null, verifiedAt: new Date() },
          }),
        );
        out.reconnected++;
      } else if (state !== 'open' && row.status === 'ok') {
        await this.prisma.run(SYSTEM, (tx) =>
          tx.whatsappConfig.update({
            where: { barbershopId: row.barbershopId },
            data: { status: 'error', lastError: DISCONNECTED_ERROR },
          }),
        );
        out.disconnected++;
        const b = row.barbershop;
        const to = b.memberships.flatMap((m) => (m.user ? [m.user.email] : []));
        if (!to.length && b.email) to.push(b.email);
        const msg = disconnectedEmail({
          shopName: b.name,
          phone: row.displayPhone,
          url: `${this.env.WEB_URL.replace(/\/$/, '')}/s/${b.slug}/mensajes`,
        });
        for (const email of to) this.mail(email, msg);
      }
    }
    if (out.disconnected || out.reconnected) this.logger.log(`whatsapp: ${JSON.stringify(out)}`);
    return out;
  }

  private mail(to: string, msg: { subject: string; body: string }): void {
    let sender;
    try {
      sender = this.senders.email();
    } catch (e) {
      this.logger.warn(`Aviso de desconexión sin correo: ${(e as Error).message}`);
      return;
    }
    sender
      .send({ to, subject: msg.subject, body: msg.body })
      .catch((e: Error) => this.logger.error(`No se pudo avisar la desconexión: ${e.message}`));
  }
}
