import { Module } from '@nestjs/common';
import { TlsAskController } from './tls-ask.controller';

@Module({ controllers: [TlsAskController] })
export class EdgeModule {}
