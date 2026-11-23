import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { StorageProvider } from './storage.provider';

/** Lo único que usamos del cliente: facilita probarlo sin red. */
export type S3Like = Pick<S3Client, 'send'>;

/** Una key válida: `{barbershopId}/{tipo}/{uuid}.{ext}`, sin `..` ni rutas absolutas. */
export function assertKey(key: string): void {
  if (!/^[\w-]+(\/[\w.-]+)+$/.test(key) || key.split('/').some((p) => p === '..' || p === '.'))
    throw new Error(`Key de storage inválida: ${key}`);
}

/**
 * Bucket S3 compatible (Cloudflare R2, AWS S3, MinIO). Los archivos se sirven directo desde el
 * bucket (o su dominio público), no desde la API. Las keys llevan un UUID: nunca cambian, así que
 * se cachean un año.
 */
@Injectable()
export class S3StorageProvider extends StorageProvider {
  private readonly base: string;
  private readonly bucket: string;
  private readonly client: S3Like;

  constructor(@Inject(ENV) env: Env, client?: S3Like) {
    super();
    this.bucket = env.S3_BUCKET;
    this.base = `${env.S3_PUBLIC_URL.replace(/\/$/, '')}/`;
    this.client =
      client ??
      new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT || undefined,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  publicUrl(key: string): string {
    return this.base + key;
  }

  keyFromUrl(url: string): string | null {
    if (!url.startsWith(this.base)) return null;
    const key = url.slice(this.base.length);
    try {
      assertKey(key);
      return key;
    } catch {
      return null;
    }
  }
}
