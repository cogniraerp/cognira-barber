import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserOrIpThrottlerGuard } from './common/http/throttler.guard';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { CommonModule } from './common/common.module';
import { AuthGuard } from './common/auth/auth.guard';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { RequestContextMiddleware } from './common/request-context/request-context.middleware';
import { TenantGuard } from './common/tenancy/tenant.guard';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ComplaintsModule } from './modules/complaints/complaints.module';
import { DomainsModule } from './modules/domains/domains.module';
import { EdgeModule } from './modules/edge/edge.module';
import { HealthModule } from './modules/health/health.module';
import { MeModule } from './modules/me/me.module';
import { PlatformModule } from './modules/platform/platform.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { CustomersModule } from './modules/customers/customers.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ShopModule } from './modules/shop/shop.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { BillingModule } from './modules/billing/billing.module';
import { DepositsModule } from './modules/deposits/deposits.module';
import { StorageModule } from './infra/storage/storage.module';
import { ShopContextModule } from './modules/shop-context/shop-context.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CommonModule,
    StorageModule,
    // Límite general por IP; los endpoints sensibles lo endurecen con @Throttle().
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    HealthModule,
    AuthModule,
    ComplaintsModule,
    DomainsModule,
    EdgeModule,
    MeModule,
    ShopContextModule,
    PlatformModule,
    ShopModule,
    InvitationsModule,
    AppointmentsModule,
    CustomersModule,
    NotificationsModule,
    PaymentsModule,
    BillingModule,
    DepositsModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    // El orden importa: autenticación → rate limit (por usuario o IP) → barbería + permisos.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: UserOrIpThrottlerGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
