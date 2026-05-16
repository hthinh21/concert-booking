import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { BookingStatus } from '@prisma/client';

const PENDING_EXPIRY_MINUTES = 10;

@Injectable()
export class BookingSchedulerService {
  private readonly logger = new Logger(BookingSchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // Chạy mỗi phút để check booking PENDING quá 10 phút
  @Cron(CronExpression.EVERY_MINUTE)
  async expirePendingBookings() {
    const expiredBefore = new Date(Date.now() - PENDING_EXPIRY_MINUTES * 60 * 1000);

    // Lấy tất cả booking PENDING quá 10 phút kèm đủ thông tin để hoàn lại
    const staleBookings = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.PENDING,
        createdAt: { lt: expiredBefore },
      },
      include: {
        bookingItems: true,
        bookingVoucher: true,
        user: { select: { id: true } },
      },
    });

    if (staleBookings.length === 0) return;

    this.logger.log(`Expiring ${staleBookings.length} stale PENDING booking(s)...`);

    // Xử lý từng booking trong 1 transaction riêng
    // Dùng Promise.allSettled để booking này lỗi không ảnh hưởng booking khác
    const results = await Promise.allSettled(
      staleBookings.map((booking) => this.expireOneBooking(booking)),
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      this.logger.error(`${failed.length} booking(s) failed to expire`, failed);
    }

    this.logger.log(
      `Expired ${results.length - failed.length}/${staleBookings.length} bookings successfully`,
    );
  }

  private async expireOneBooking(booking: any) {
    // DB transaction — atomic: expire + hoàn lại inventory + voucher
    await this.prisma.$transaction(async (tx) => {
      // 1. Chuyển status sang EXPIRED
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.EXPIRED },
      });

      // 2. Hoàn lại reservedQty cho từng loại vé
      for (const item of booking.bookingItems) {
        await tx.ticketCategory.update({
          where: { id: item.ticketCategoryId },
          data: { reservedQty: { decrement: item.quantity } },
        });
      }

      // 3. Hoàn lại voucher usedCount nếu booking có dùng voucher
      if (booking.bookingVoucher) {
        await tx.voucher.update({
          where: { id: booking.bookingVoucher.voucherId },
          data: { usedCount: { decrement: 1 } },
        });
      }
    });

    // 4. Sync Redis sau DB commit (non-critical)
    try {
      if (booking.bookingVoucher) {
        const voucherId = booking.bookingVoucher.voucherId;
        const countKey = `voucher:usedCount:${voucherId}`;
        const current = await this.redis.get(countKey);

        if (current !== null && parseInt(current) > 0) {
          await this.redis.decr(countKey);
        }

        // Xóa flag user đã dùng → user có thể dùng lại voucher
        await this.redis.del(`voucher:used:${voucherId}:${booking.user.id}`);
      }
    } catch (redisErr) {
      this.logger.warn(`Redis sync failed for expired booking ${booking.id}:`, redisErr);
    }

    this.logger.debug(`Booking ${booking.id} expired. Inventory restored.`);
  }
}
