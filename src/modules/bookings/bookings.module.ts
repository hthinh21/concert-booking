import { Module } from '@nestjs/common';
import { BookingsController, AdminBookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingSchedulerService } from './booking-scheduler.service';

@Module({
  controllers: [BookingsController, AdminBookingsController],
  providers: [BookingsService, BookingSchedulerService],
  exports: [BookingsService],
})
export class BookingsModule {}
