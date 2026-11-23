import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Normaliza ANTES de validar: los emails pegados suelen traer espacios o mayúsculas.
const email = z.string().trim().toLowerCase().pipe(z.email('Email inválido').max(254));

const password = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128, 'La contraseña no puede superar 128 caracteres');

export const RegisterSchema = z.object({
  email,
  password,
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(20).optional(),
  /** Acepta los Términos y la Política de privacidad (consentimiento, Ley 29733). */
  acceptTerms: z.literal(true, {
    message: 'Debes aceptar los Términos y la Política de privacidad',
  }),
});
export class RegisterDto extends createZodDto(RegisterSchema) {}

export const LoginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});
export class LoginDto extends createZodDto(LoginSchema) {}

export const RefreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });
export class RefreshDto extends createZodDto(RefreshSchema) {}

export const AuthUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  platformRole: z.enum(['superadmin', 'support']).nullable(),
});

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().describe('Segundos de vida del access token'),
  user: AuthUserSchema,
});
export class AuthTokensDto extends createZodDto(AuthTokensSchema) {}
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

// ── Recuperar contraseña y verificar correo ──
export const ForgotPasswordSchema = z.object({ email });
export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}

const oneTimeToken = z.string().trim().min(20).max(200);

export const ResetPasswordSchema = z.object({ token: oneTimeToken, password });
export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}

export const VerifyEmailSchema = z.object({ token: oneTimeToken });
export class VerifyEmailDto extends createZodDto(VerifyEmailSchema) {}
