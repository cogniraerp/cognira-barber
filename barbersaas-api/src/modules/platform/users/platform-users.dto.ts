import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate } from '../../../common/http/zod';

export class EmailVerifiedDto extends createZodDto(z.object({ emailVerifiedAt: IsoDate }), {
  codec: true,
}) {}

export class ResetLinkDto extends createZodDto(
  z.object({ url: z.string(), expiresAt: IsoDate, email: z.string() }),
  { codec: true },
) {}
