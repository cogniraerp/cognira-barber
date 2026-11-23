import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  PlatformComplaintsController,
  PublicComplaintsController,
  ShopComplaintsController,
} from './complaints.controller';
import { ComplaintsService } from './complaints.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PublicComplaintsController, ShopComplaintsController, PlatformComplaintsController],
  providers: [ComplaintsService],
})
export class ComplaintsModule {}
