import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccountRecoveryService } from './account-recovery.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, AccountRecoveryService],
  exports: [AccountRecoveryService],
})
export class AuthModule {}
