import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import { S3StorageProvider, assertKey } from './s3-storage.provider';

const env = {
  S3_BUCKET: 'cognira-media',
  S3_PUBLIC_URL: 'https://media.cognira.pe/',
  S3_REGION: 'auto',
  S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com',
  S3_FORCE_PATH_STYLE: false,
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
} as unknown as Env;
const key = '11111111-2222-3333-4444-555555555555/logo/abc-def.png';

describe('S3StorageProvider', () => {
  it('sube con tipo, caché larga y al bucket configurado', async () => {
    const send = vi.fn().mockResolvedValue({});
    const s3 = new S3StorageProvider(env, { send });
    await s3.put(key, Buffer.from('x'), 'image/png');
    const cmd = send.mock.calls[0]![0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toMatchObject({
      Bucket: 'cognira-media',
      Key: key,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    await s3.delete(key);
    expect(send.mock.calls[1]![0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('URL pública ↔ key (sin la barra doble)', () => {
    const s3 = new S3StorageProvider(env, { send: vi.fn() });
    expect(s3.publicUrl(key)).toBe(`https://media.cognira.pe/${key}`);
    expect(s3.keyFromUrl(`https://media.cognira.pe/${key}`)).toBe(key);
    expect(s3.keyFromUrl(`https://otro.com/${key}`)).toBeNull();
    expect(s3.keyFromUrl('https://media.cognira.pe/../secreto')).toBeNull();
  });

  it('rechaza keys peligrosas', () => {
    expect(() => assertKey('../etc/passwd')).toThrow();
    expect(() => assertKey('/abs/x.png')).toThrow();
    expect(() => assertKey('a/../b.png')).toThrow();
    expect(() => assertKey(key)).not.toThrow();
  });
});
