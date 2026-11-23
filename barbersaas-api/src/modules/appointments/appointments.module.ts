import { Module } from '@nestjs/common';
import { AvailabilityService } from '../availability/availability.service';
import { PaymentsModule } from '../payments/payments.module';
import { BookingService } from './booking.service';
import { PublicBookingController } from './public-booking.controller';
import { ShopAppointmentsController } from './shop-appointments.controller';

@Module({
  imports: [PaymentsModule],
  controllers: [ShopAppointmentsController, PublicBookingController],
  providers: [AvailabilityService, BookingService],
  exports: [BookingService, AvailabilityService],
})
export class AppointmentsModule {}
