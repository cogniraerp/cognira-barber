import { Global, Module } from '@nestjs/common';
import { DispatcherService } from './dispatcher.service';
import { NotificationsService } from './notifications.service';
import { HTTP_FETCH } from './providers/types';
import { SenderRegistry } from './sender-registry';
import { ShopNotificationsController } from './shop-notifications.controller';
import { WebhooksController } from './webhooks.controller';

@Global()
@Module({
  controllers: [ShopNotificationsController, WebhooksController],
  providers: [
    { provide: HTTP_FETCH, useValue: globalThis.fetch.bind(globalThis) },
    SenderRegistry,
    NotificationsService,
    DispatcherService,
  ],
  exports: [NotificationsService, DispatcherService, SenderRegistry, HTTP_FETCH],
})
export class NotificationsModule {}
