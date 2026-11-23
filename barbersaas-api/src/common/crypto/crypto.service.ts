import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * Cifrado de secretos de integraciones (tokens de WhatsApp, Twilio, pasarelas) con AES-256-GCM.
 * Formato: iv(12) | tag(16) | ciphertext. La versión de la clave se guarda aparte (key_version)
 * para poder rotarla: descifrar con la vieja, recifrar con la nueva.
 */
@Injectable()
export class CryptoService {
  private readonly keys: Map<number, Buffer>;
  readonly currentVersion: number;

  constructor(@Inject(ENV) env: Env) {
    this.currentVersion = env.ENCRYPTION_KEY_VERSION;
    this.keys = new Map([[env.ENCRYPTION_KEY_VERSION, Buffer.from(env.ENCRYPTION_KEY, 'base64')]]);
  }

  encryptJson(value: unknown): { data: Buffer; keyVersion: number } {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(this.currentVersion), iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { data: Buffer.concat([iv, cipher.getAuthTag(), ct]), keyVersion: this.currentVersion };
  }

  decryptJson<T>(data: Uint8Array, keyVersion: number): T {
    const buf = Buffer.from(data);
    const decipher = createDecipheriv('aes-256-gcm', this.key(keyVersion), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const pt = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    return JSON.parse(pt.toString('utf8')) as T;
  }

  private key(version: number): Buffer {
    const k = this.keys.get(version);
    if (!k) throw new Error(`Clave de cifrado v${version} no disponible`);
    return k;
  }
}
