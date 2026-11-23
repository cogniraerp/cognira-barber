import { z } from 'zod';
import { blockIssues, isContained, TimeBlockSchema } from '../../../common/time/time-blocks';

const DayOfWeek = z.number().int().min(0).max(6).describe('0 = domingo … 6 = sábado');

function uniqueDays(days: Array<{ dayOfWeek: number }>, ctx: z.RefinementCtx): void {
  const seen = new Set<number>();
  days.forEach((d, i) => {
    if (seen.has(d.dayOfWeek))
      ctx.addIssue({ code: 'custom', path: ['days', i, 'dayOfWeek'], message: 'Día repetido' });
    seen.add(d.dayOfWeek);
  });
}

/** Horario semanal de una sede: varios bloques por día (p. ej. 09:00–13:00 y 15:00–21:00). Día ausente = cerrado. */
export const LocationWeekSchema = z
  .object({
    days: z
      .array(z.object({ dayOfWeek: DayOfWeek, blocks: z.array(TimeBlockSchema).max(4) }))
      .max(7),
  })
  .superRefine((w, ctx) => {
    uniqueDays(w.days, ctx);
    w.days.forEach((d, i) =>
      blockIssues(d.blocks).forEach((iss) =>
        ctx.addIssue({
          code: 'custom',
          path: ['days', i, 'blocks', iss.index],
          message: iss.message,
        }),
      ),
    );
  });
export type LocationWeek = z.infer<typeof LocationWeekSchema>;

/**
 * Horario semanal de un barbero.
 * - inheritLocationHours = true: trabaja el horario de su sede; `blocks` debe ir vacío y solo se guardan descansos.
 * - false: horario propio en `blocks` (día ausente = no trabaja).
 * Los descansos deben caer dentro del horario efectivo (se valida contra la sede en el servicio).
 */
export const StaffWeekSchema = z
  .object({
    inheritLocationHours: z.boolean().default(false),
    days: z
      .array(
        z.object({
          dayOfWeek: DayOfWeek,
          blocks: z.array(TimeBlockSchema).max(4),
          breaks: z.array(TimeBlockSchema).max(4).default([]),
        }),
      )
      .max(7),
  })
  .superRefine((w, ctx) => {
    uniqueDays(w.days, ctx);
    w.days.forEach((d, i) => {
      blockIssues(d.blocks).forEach((iss) =>
        ctx.addIssue({
          code: 'custom',
          path: ['days', i, 'blocks', iss.index],
          message: iss.message,
        }),
      );
      blockIssues(d.breaks).forEach((iss) =>
        ctx.addIssue({
          code: 'custom',
          path: ['days', i, 'breaks', iss.index],
          message: iss.message,
        }),
      );
      if (w.inheritLocationHours && d.blocks.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['days', i, 'blocks'],
          message: 'Si hereda el horario de la sede, no envíes bloques propios',
        });
      }
      d.breaks.forEach((b, j) => {
        if (!w.inheritLocationHours && !isContained(b, d.blocks)) {
          ctx.addIssue({
            code: 'custom',
            path: ['days', i, 'breaks', j],
            message: 'El descanso debe estar dentro del horario de trabajo',
          });
        }
      });
    });
  });
export type StaffWeek = z.infer<typeof StaffWeekSchema>;

export const LocationWeekResponseSchema = z.object({
  days: z
    .array(z.object({ dayOfWeek: z.number().int(), blocks: z.array(TimeBlockSchema) }))
    .length(7),
});
export const StaffWeekResponseSchema = z.object({
  /** true si el barbero no tiene horario propio: trabaja el horario de su sede. */
  inheritsLocationHours: z.boolean(),
  days: z
    .array(
      z.object({
        dayOfWeek: z.number().int(),
        blocks: z.array(TimeBlockSchema),
        breaks: z.array(TimeBlockSchema),
      }),
    )
    .length(7),
});
