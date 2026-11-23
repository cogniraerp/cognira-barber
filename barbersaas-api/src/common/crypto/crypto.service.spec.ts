import { describe, expect, it } from 'vitest';
import { CryptoService } from './crypto.service';

const svc = (byte = 7, version = 1) =>
  new CryptoService({
    ENCRYPTION_KEY: Buffer.alloc(32, byte).toString('base64'),
    ENCRYPTION_KEY_VERSION: version,
  } as never);

describe('CryptoService', () => {
  it('cifra y descifra; el texto plano no aparece en el resultado', () => {
    const { data, keyVersion } = svc().encryptJson({ accessToken: 'EAAG-secreto' });
    expect(data.toString('utf8')).not.toContain('secreto');
    expect(svc().decryptJson(data, keyVersion)).toEqual({ accessToken: 'EAAG-secreto' });
  });
  it('IV aleatorio: dos cifrados del mismo valor son distintos', () => {
    expect(svc().encryptJson('x').data.equals(svc().encryptJson('x').data)).toBe(false);
  });
  it('detecta manipulación (GCM) y clave incorrecta', () => {
    const { data } = svc().encryptJson({ a: 1 });
    const tampered = Buffer.from(data);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => svc().decryptJson(tampered, 1)).toThrow();
    expect(() => svc(8).decryptJson(data, 1)).toThrow();
    expect(() => svc().decryptJson(data, 2)).toThrow(/v2/);
  });
});
