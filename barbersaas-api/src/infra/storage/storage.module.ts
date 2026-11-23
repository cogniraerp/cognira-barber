import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { LocalStorageProvider } from './local-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import { StorageProvider } from './storage.provider';

@Global()
@Module({
  providers: [
    {
      provide: StorageProvider,
      inject: [ENV],
      useFactory: (env: Env): StorageProvider =>
        env.STORAGE_DRIVER === 's3' ? new S3StorageProvider(env) : new LocalStorageProvider(env),
    },
  ],
  exports: [StorageProvider],
})
export class StorageModule {}
