import argon2 from 'argon2';

// Parámetros OWASP 2024+ para argon2id (19 MiB, t=2, p=1).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Hash fijo para gastar el mismo tiempo cuando el email no existe (evita enumerar usuarios). */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= argon2.hash('dummy-password-for-timing', OPTIONS);
  return dummy;
}
