import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/auth/decorators';
import { UuidPipe } from '../../common/http/uuid.pipe';
import { ChargesService } from './charges.service';
import { InvoicePayService } from './invoice-pay.service';

/** Webhooks de las pasarelas de las barberías. La autenticación es el token de la URL + la firma. */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly charges: ChargesService) {}

  @Post(':token')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('token') token: string,
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    await this.charges.webhook(token, {
      body,
      query: req.query,
      headers: req.headers,
    });
    return { ok: true };
  }
}

/** Webhooks de la pasarela de la plataforma (pago de suscripciones). */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('webhooks/platform-payments')
export class PlatformPaymentWebhooksController {
  constructor(private readonly invoices: InvoicePayService) {}

  @Post(':token')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('token') token: string,
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    await this.invoices.webhook(token, {
      body,
      query: req.query,
      headers: req.headers,
    });
    return { ok: true };
  }
}

/** Checkout simulado (solo desarrollo): una página mínima con "Pagar" y "Rechazar". */
@ApiExcludeController()
@Public()
@Controller('public/pay/simulator')
export class SimulatorCheckoutController {
  constructor(
    private readonly charges: ChargesService,
    private readonly invoices: InvoicePayService,
  ) {}

  /** Atiende cobros de caja y pagos de factura (mismo checkout, misma firma). */
  @Get(':id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async page(@Param('id', UuidPipe) id: string, @Query('sig') sig: string): Promise<string> {
    this.charges.assertSimulator(id, sig);
    const data = (await this.invoices.owns(id))
      ? await this.invoices.simulatorPage(id)
      : await this.charges.simulatorPage(id, sig);
    return render(id, sig, data);
  }

  @Post(':id')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async pay(
    @Param('id', UuidPipe) id: string,
    @Body() body: { sig?: string; action?: string },
  ): Promise<string> {
    const sig = body.sig ?? '';
    this.charges.assertSimulator(id, sig);
    const approve = body.action === 'pay';
    const data = (await this.invoices.owns(id))
      ? await this.invoices.simulatorPay(id, approve)
      : await this.charges.simulatorPay(id, sig, approve);
    return render(
      id,
      sig,
      data,
      approve ? null : 'Pago rechazado (simulado). Puedes intentarlo de nuevo.',
    );
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function render(
  id: string,
  sig: string,
  c: {
    amountCents: number;
    currency: string;
    description: string;
    status: string;
    expiresAt: Date;
    barbershop: { name: string };
  },
  notice: string | null = null,
): string {
  const amount = new Intl.NumberFormat('es-PE', { style: 'currency', currency: c.currency }).format(
    c.amountCents / 100,
  );
  const open = c.status === 'pending' && c.expiresAt > new Date();
  const state =
    c.status === 'paid'
      ? '<p class="ok">✔ Pago aprobado. Ya puedes cerrar esta pestaña.</p>'
      : !open
        ? '<p class="warn">Este cobro ya no está disponible.</p>'
        : `<form method="post"><input type="hidden" name="sig" value="${esc(sig)}">
            <button name="action" value="pay">Pagar ${esc(amount)}</button>
            <button name="action" value="reject" class="sec">Rechazar</button></form>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pago simulado · ${esc(c.barbershop.name)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f1f5f9;display:grid;place-items:center;min-height:100vh;margin:0;color:#0f172a}
main{background:#fff;border-radius:16px;padding:28px;max-width:360px;width:calc(100% - 32px);box-shadow:0 1px 3px #0001}
.tag{display:inline-block;background:#fef3c7;color:#92400e;font-size:12px;padding:2px 8px;border-radius:99px}
h1{font-size:28px;margin:12px 0 4px}p{color:#475569}button{display:block;width:100%;margin-top:10px;padding:12px;border:0;border-radius:10px;font-size:16px;font-weight:600;background:#1043c4;color:#fff;cursor:pointer}
button.sec{background:#fff;color:#b91c1c;border:1px solid #fecaca}.ok{color:#047857;font-weight:600}.warn{color:#b45309}.n{color:#b91c1c}</style></head>
<body><main><span class="tag">Simulador · sin dinero real</span><h1>${esc(amount)}</h1><p>${esc(c.description)}</p>
${notice ? `<p class="n">${esc(notice)}</p>` : ''}${state}<p style="font-size:12px">Ref. ${esc(id.slice(0, 8))}</p></main></body></html>`;
}
