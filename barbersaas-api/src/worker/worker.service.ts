import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DunningService } from '../modules/billing/dunning.service';
import { DepositsService } from '../modules/deposits/deposits.service';
import { RefundsService } from '../modules/payments/refunds.service';
import { DispatcherService } from '../modules/notifications/dispatcher.service';
import { WhatsAppHealthService } from '../modules/notifications/whatsapp-health.service';

/** Bucle del worker: procesa lotes mientras haya trabajo; si no, espera NOTIFICATIONS_POLL_MS. */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private running = false;
  private loop?: Promise<void>;
  private dunningLoop?: Promise<void>;

  constructor(
    private readonly dispatcher: DispatcherService,
    private readonly dunning: DunningService,
    private readonly deposits: DepositsService,
    private readonly refunds: RefundsService,
    private readonly whatsappHealth: WhatsAppHealthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.APP_MODE !== 'worker') return;
    this.running = true;
    this.loop = this.run();
    this.dunningLoop = this.runDunning();
    this.logger.log(
      `Worker de notificaciones iniciado (cada ${this.env.NOTIFICATIONS_POLL_MS} ms)`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await Promise.all([this.loop, this.dunningLoop]);
  }

  private async run(): Promise<void> {
    while (this.running) {
      let claimed = 0;
      try {
        const r = await this.dispatcher.processBatch(20);
        claimed = r.claimed;
        if (claimed) this.logger.log(`lote: ${JSON.stringify(r)}`);
      } catch (e) {
        this.logger.error(`Error procesando lote: ${(e as Error).message}`);
      }
      await new Promise((res) => setTimeout(res, claimed ? 100 : this.env.NOTIFICATIONS_POLL_MS));
    }
  }

  /**
   * Cobranza: corrida completa cada DUNNING_INTERVAL_MS (renovaciones, morosidad, suspensiones) y
   * envío de avisos pendientes cada minuto (p. ej. "reactivada" justo después de un pago).
   */
  private async runDunning(): Promise<void> {
    let last = 0;
    while (this.running) {
      try {
        if (Date.now() - last >= this.env.DUNNING_INTERVAL_MS) {
          last = Date.now();
          await this.dunning.run();
        } else {
          await this.dunning.sendPending();
        }
        // Adelantos: libera los horarios apartados que no se pagaron a tiempo.
        await this.deposits.expireDue();
        // Devoluciones por la pasarela (adelantos y ventas anuladas pagadas en línea).
        await this.refunds.processDue();
        // WhatsApp por QR: avisa al dueño si su número se desvinculó (revisa cada 10 min).
        await this.whatsappHealth.checkDue();
      } catch (e) {
        this.logger.error(`Error en cobranza: ${(e as Error).message}`);
      }
      for (let waited = 0; this.running && waited < 60_000; waited += 1000)
        await new Promise((res) => setTimeout(res, 1000));
    }
  }
}
