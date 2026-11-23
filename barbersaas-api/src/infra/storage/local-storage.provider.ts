import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { StorageProvider } from './storage.provider';

export const FILES_ROUTE = '/files';

/** Guarda en disco bajo STORAGE_LOCAL_DIR y se sirve estático en /files (ver configureApp). */
@Injectable()
export class LocalStorageProvider extends StorageProvider {
  private readonly root: string;
  private readonly base: string;

  constructor(@Inject(ENV) env: Env) {
    super();
    this.root = resolve(env.STORAGE_LOCAL_DIR);
    this.base = `${env.PUBLIC_API_URL.replace(/\/$/, '')}${FILES_ROUTE}/`;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  publicUrl(key: string): string {
    return this.base + key;
  }

  keyFromUrl(url: string): string | null {
    return url.startsWith(this.base) ? url.slice(this.base.length) : null;
  }

  /** Evita path traversal: la ruta final debe quedar dentro de la raíz. */
  private pathFor(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error(`Key de storage inválida: ${key}`);
    return path;
  }
}
