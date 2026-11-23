import { Injectable } from '@nestjs/common';
import type { MessageChannel, MessageEvent } from '../../generated/prisma/enums';
import type { Tx } from '../../infra/prisma/prisma.service';
import { readNotificationSettings } from '../shop/settings.schemas';

/** Cambios de una cita que disparan mensajes. */
export type AppointmentChange = 'created' | 'confirmed' | 'rescheduled' | 'canceled';

const CHANNELS: MessageChannel[] = ['whatsapp', 'email'];

/**
 * Encola mensajes y recordatorios DENTRO de la transacción que modifica la cita:
 * si la cita se confirma, sus mensajes existen; si hay rollback, tampoco hay mensajes.
 * El envío real lo hace el worker (Dispatcher), que renderiza la plantilla en el momento de enviar.
 */
@Injectable()
export class NotificationsService {
  async onAppointment(
    tx: Tx,
    change: AppointmentChange,
    appointmentId: string,
    now = new Date(),
  ): Promise<void> {
    const a = await tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: {
        id: true,
        barbershopId: true,
        status: true,
        source: true,
        startAt: true,
        customer: { select: { id: true, phoneE164: true, email: true, waOptIn: true } },
        staff: {
          select: {
            membership: {
              select: {
                status: true,
                deletedAt: true,
                user: { select: { email: true, phone: true } },
              },
            },
          },
        },
      },
    });
    const settings = readNotificationSettings(
      (
        await tx.barbershopSettings.findUnique({
          where: { barbershopId: a.barbershopId },
          select: { notifications: true },
        })
      )?.notifications,
    );
    const rows: Array<{
      event: MessageEvent;
      channel: MessageChannel;
      to: string;
      recipientKind: 'customer' | 'staff';
      scheduledFor: Date;
      dedupeKey: string | null;
    }> = [];
    const toCustomer = (
      event: MessageEvent,
      at: Date = now,
      dedupeKey: (ch: MessageChannel) => string | null = () => null,
    ) => {
      if (!a.customer) return;
      for (const ch of CHANNELS) {
        if (!settings.events[event]?.[ch]) continue;
        const to =
          ch === 'whatsapp' ? (a.customer.waOptIn ? a.customer.phoneE164 : null) : a.customer.email;
        if (to)
          rows.push({
            event,
            channel: ch,
            to,
            recipientKind: 'customer',
            scheduledFor: at,
            dedupeKey: dedupeKey(ch),
          });
      }
    };

    // Un walk-in está en el local: no tiene sentido confirmarle por WhatsApp.
    const walkIn = a.source === 'walk_in';

    if (change === 'created' && !walkIn) {
      toCustomer(a.status === 'pending' ? 'booking_requested' : 'booking_confirmed');
      const member = a.staff.membership;
      if (
        a.source === 'online' &&
        member &&
        member.status === 'active' &&
        !member.deletedAt &&
        member.user
      ) {
        for (const ch of CHANNELS) {
          if (!settings.events.staff_new_booking[ch]) continue;
          const to = ch === 'whatsapp' ? member.user.phone : member.user.email;
          if (to)
            rows.push({
              event: 'staff_new_booking',
              channel: ch,
              to,
              recipientKind: 'staff',
              scheduledFor: now,
              dedupeKey: null,
            });
        }
      }
    }
    if (change === 'confirmed') toCustomer('booking_confirmed');
    if (change === 'rescheduled') toCustomer('rescheduled');
    if (change === 'canceled') toCustomer('canceled');

    // Recordatorios: se rehacen en cada cambio (los viejos sin enviar se descartan).
    await tx.messageLog.deleteMany({
      where: {
        barbershopId: a.barbershopId,
        appointmentId: a.id,
        event: 'reminder',
        status: 'queued',
      },
    });
    if (a.status === 'confirmed' && change !== 'canceled') {
      for (const h of settings.reminderHours) {
        const at = new Date(a.startAt.getTime() - h * 3_600_000);
        if (at.getTime() <= now.getTime() + 5 * 60_000) continue; // demasiado cerca: no tiene sentido
        // La clave incluye el inicio: si se reprograma de vuelta a una hora cuyo recordatorio ya salió, no se duplica.
        toCustomer('reminder', at, (ch) => `reminder:${h}:${ch}:${a.id}:${a.startAt.getTime()}`);
      }
    }

    if (rows.length) {
      await tx.messageLog.createMany({
        data: rows.map((r) => ({
          ...r,
          barbershopId: a.barbershopId,
          appointmentId: a.id,
          customerId: r.recipientKind === 'customer' ? (a.customer?.id ?? null) : null,
          provider: 'pending',
          status: 'queued' as const,
        })),
        skipDuplicates: true,
      });
    }
  }
}
