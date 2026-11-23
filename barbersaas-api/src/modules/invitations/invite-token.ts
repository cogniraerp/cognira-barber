import { createHash, randomBytes } from 'node:crypto';

export const INVITE_TTL_MS = 7 * 86_400_000;

export function newInviteToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: hashInviteToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
