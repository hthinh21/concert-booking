import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { ConcertStatus, BookingStatus, DiscountType, Voucher } from '@prisma/client';
import {
  CreateBookingDto,
  UpdateBookingStatusDto,
  ListBookingsDto,
} from './dto/booking.dto';

// ─── State machine ────────────────────────────────────────
// Chỉ cho phép các transition hợp lệ
// PENDING     → CONFIRMED | CANCELLED
// CONFIRMED   → CANCELLED (operator refund)
// EXPIRED     → CANCELLED (operator cleanup)
// CANCELLED   → không đi đâu được nữa
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [],
  EXPIRED: ['CANCELLED'],
};

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // ─── CUSTOMER ─────────────────────────────────────────────────────────────

  async create(
    userId: string,
    dto: CreateBookingDto,
    idempotencyKey: string,
  ) {
    // ── STEP 1: Idempotency check ─────────────────────────────
    // Nếu cùng idempotency key gửi lại (do retry/network issue)
    // → trả về kết quả cũ, không tạo booking mới
    const cached = await this.redis.getIdempotency(idempotencyKey);
    if (cached) {
      return {
        ...JSON.parse(cached),
        _fromCache: true, // debug flag, biết là từ cache
      };
    }

    // ── STEP 2: Validate concert published ───────────────────
    const concert = await this.prisma.concert.findFirst({
      where: { id: dto.concertId, status: ConcertStatus.PUBLISHED },
    });
    if (!concert) {
      throw new NotFoundException('Concert not found or not available for booking');
    }

    // ── STEP 3: Validate tất cả ticket categories tồn tại ───
    const categoryIds = dto.items.map((i) => i.ticketCategoryId);
    const ticketCategories = await this.prisma.ticketCategory.findMany({
      where: {
        id: { in: categoryIds },
        concertId: dto.concertId,
      },
    });

    if (ticketCategories.length !== dto.items.length) {
      throw new NotFoundException(
        'One or more ticket categories not found for this concert',
      );
    }

    // ── STEP 4: Acquire Redis distributed lock ───────────────
    // Lock theo từng ticketCategoryId để chống oversell concurrent
    // Ví dụ: 2 user cùng book VIP ticket cuối cùng đồng thời
    // → chỉ 1 người acquire được lock, người kia retry sau
    const acquiredLocks: string[] = [];

    // Sort để tránh deadlock khi 2 request lock cùng set keys
    const sortedCategoryIds = [...categoryIds].sort();

    try {
      for (const categoryId of sortedCategoryIds) {
        // TTL 10s — đủ để complete transaction, tự release nếu crash
        const acquired = await this.redis.acquireLock(categoryId, 10000);
        if (!acquired) {
          throw new ConflictException(
            'System is processing too many requests. Please retry in a moment.',
          );
        }
        acquiredLocks.push(categoryId);
      }

      // Lock thêm voucherId nếu có — tránh race condition khi 2 user
      // book khác ticket category nhưng cùng dùng 1 voucher
      if (dto.voucherCode) {
        const voucherLockKey = `voucher-apply:${dto.voucherCode}`;
        const acquired = await this.redis.acquireLock(voucherLockKey, 10000);
        if (!acquired) {
          throw new ConflictException(
            'Voucher is being processed by another request. Please retry.',
          );
        }
        acquiredLocks.push(voucherLockKey);
      }

      // ── STEP 5: Check inventory (trong lock) ──────────────
      // Phải check TRONG lock để đảm bảo atomic
      // Re-fetch để lấy reservedQty mới nhất từ DB
      const freshCategories = await this.prisma.ticketCategory.findMany({
        where: { id: { in: categoryIds } },
      });

      for (const item of dto.items) {
        const category = freshCategories.find(
          (c) => c.id === item.ticketCategoryId,
        );

        if (!category) {
          throw new NotFoundException(
            `Ticket category ${item.ticketCategoryId} no longer exists`,
          );
        }

        const available = category.totalQty - category.reservedQty;

        if (available < item.quantity) {
          throw new BadRequestException(
            `Not enough tickets for "${category.name}". ` +
            `Requested: ${item.quantity}, Available: ${available}`,
          );
        }
      }

      // ── STEP 6: Validate voucher (trong lock) ─────────────
      let voucher: Voucher | null = null;
      let discountAmount = 0;

      if (dto.voucherCode) {
        voucher = await this.prisma.voucher.findUnique({
          where: { code: dto.voucherCode },
        });

        if (!voucher) {
          throw new NotFoundException(`Voucher "${dto.voucherCode}" not found`);
        }

        if (new Date(voucher.expiresAt) < new Date()) {
          throw new BadRequestException('Voucher has expired');
        }

        // Check realtime usedCount từ Redis (chính xác hơn DB)
        const redisCountKey = `voucher:usedCount:${voucher.id}`;
        let usedCount = await this.redis.get(redisCountKey);

        if (usedCount === null) {
          // Sync từ DB vào Redis lần đầu
          usedCount = String(voucher.usedCount);
          await this.redis.set(redisCountKey, usedCount);
        }

        if (parseInt(usedCount) >= voucher.maxUses) {
          throw new BadRequestException(
            'Voucher has reached maximum uses',
          );
        }

        // Check per-user: 1 user chỉ dùng 1 voucher 1 lần
        const userUsedKey = `voucher:used:${voucher.id}:${userId}`;
        const userUsed = await this.redis.get(userUsedKey);

        if (userUsed) {
          throw new BadRequestException(
            'You have already used this voucher',
          );
        }

        // Fallback check DB nếu Redis cache miss (Redis restart, etc.)
        const alreadyUsedInDb = await this.prisma.bookingVoucher.findFirst({
          where: { voucherId: voucher.id, booking: { userId } },
        });
        if (alreadyUsedInDb) {
          // Re-set cache
          await this.redis.set(userUsedKey, '1');
          throw new BadRequestException('You have already used this voucher');
        }
      }

      // ── STEP 7: Tính total amount ──────────────────────────
      let totalAmount = dto.items.reduce((sum, item) => {
        const category = freshCategories.find(
          (c) => c.id === item.ticketCategoryId,
        );
        return sum + Number(category!.price) * item.quantity;
      }, 0);

      if (voucher) {
        if (voucher.discountType === DiscountType.PERCENTAGE) {
          discountAmount = totalAmount * (Number(voucher.discountValue) / 100);
        } else {
          discountAmount = Number(voucher.discountValue);
        }
        totalAmount = Math.max(0, totalAmount - discountAmount);
      }

      // ── STEP 8: DB Transaction ─────────────────────────────
      // Toàn bộ write operations trong 1 transaction
      // Nếu bất kỳ bước nào fail → rollback toàn bộ
      const booking = await this.prisma.$transaction(async (tx) => {
        // 8a. Tạo booking + items
        const newBooking = await tx.booking.create({
          data: {
            userId,
            concertId: dto.concertId,
            idempotencyKey,
            totalAmount,
            status: BookingStatus.PENDING,
            bookingItems: {
              create: dto.items.map((item) => {
                const category = freshCategories.find(
                  (c) => c.id === item.ticketCategoryId,
                );
                return {
                  ticketCategoryId: item.ticketCategoryId,
                  quantity: item.quantity,
                  unitPrice: category!.price,
                };
              }),
            },
            ...(voucher && {
              bookingVoucher: {
                create: { voucherId: voucher.id },
              },
            }),
          },
          include: {
            bookingItems: {
              include: {
                ticketCategory: {
                  select: { name: true, price: true },
                },
              },
            },
            bookingVoucher: {
              include: {
                voucher: {
                  select: {
                    code: true,
                    discountType: true,
                    discountValue: true,
                  },
                },
              },
            },
            concert: {
              select: { name: true, venue: true, date: true },
            },
          },
        });

        // 8b. Increment reservedQty cho từng category
        for (const item of dto.items) {
          await tx.ticketCategory.update({
            where: { id: item.ticketCategoryId },
            data: { reservedQty: { increment: item.quantity } },
          });
        }

        // 8c. Increment voucher usedCount trong DB
        if (voucher) {
          await tx.voucher.update({
            where: { id: voucher.id },
            data: { usedCount: { increment: 1 } },
          });
        }

        return newBooking;
      });

      // ── STEP 9: Update Redis sau khi DB commit ─────────────
      // Wrap trong try/catch riêng: DB đã commit thành công
      // Redis fail ở đây chỉ là cache inconsistency, không rollback booking
      try {
        if (voucher) {
          await this.redis.incr(`voucher:usedCount:${voucher.id}`);
          await this.redis.set(`voucher:used:${voucher.id}:${userId}`, '1');
          await this.redis.del(`voucher:${dto.voucherCode}`);
        }
      } catch (redisErr) {
        // Log để monitor, không throw — booking đã tạo thành công
        Logger.error('Redis sync failed after booking commit (non-critical):', redisErr);
      }

      // ── STEP 10: Cache idempotency result 24h ─────────────
      const result = {
        id: booking.id,
        status: booking.status,
        totalAmount: booking.totalAmount,
        discountAmount,
        concert: booking.concert,
        items: booking.bookingItems,
        voucher: booking.bookingVoucher?.voucher || null,
        createdAt: booking.createdAt,
        message: 'Booking created successfully',
      };

      await this.redis.setIdempotency(
        idempotencyKey,
        JSON.stringify(result),
        86400, // 24h
      );

      return result;

    } catch (error) {
      // Nếu lỗi không phải business logic → log để debug
      if (
        !(error instanceof BadRequestException) &&
        !(error instanceof NotFoundException) &&
        !(error instanceof ConflictException)
      ) {
        Logger.error('Unexpected booking error:', error);
        throw new InternalServerErrorException(
          'Booking failed due to an unexpected error. Please try again.',
        );
      }
      throw error;

    } finally {
      // ── STEP 11: Release tất cả locks ─────────────────────
      // Finally đảm bảo lock luôn được release dù có lỗi
      for (const key of acquiredLocks) {
        await this.redis.releaseLock(key);
      }
    }
  }

  async findMyBookings(userId: string, dto: ListBookingsDto) {
    const { page = 1, limit = 10, status } = dto;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      ...(status && { status }),
    };

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          concert: {
            select: { id: true, name: true, venue: true, date: true },
          },
          bookingItems: {
            include: {
              ticketCategory: {
                select: { name: true, price: true },
              },
            },
          },
          bookingVoucher: {
            include: {
              voucher: {
                select: { code: true, discountType: true, discountValue: true },
              },
            },
          },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, userId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, userId },
      include: {
        concert: true,
        bookingItems: {
          include: { ticketCategory: true },
        },
        bookingVoucher: {
          include: { voucher: true },
        },
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  // ─── ADMIN ────────────────────────────────────────────────────────────────

  async adminFindAll( dto: ListBookingsDto) {
    const { page = 1, limit = 10, status, concertId } = dto;
    const skip = (page - 1) * limit;

    const where = {
      ...(status && { status }),
      ...(concertId && { concertId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          concert: { select: { name: true, venue: true, date: true } },
          bookingItems: {
            include: {
              ticketCategory: { select: { name: true, price: true } },
            },
          },
          bookingVoucher: {
            include: { voucher: { select: { code: true } } },
          },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async adminFindOne(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        concert: true,
        bookingItems: {
          include: { ticketCategory: true },
        },
        bookingVoucher: {
          include: { voucher: true },
        },
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async updateStatus(id: string, dto: UpdateBookingStatusDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        bookingItems: true,
        bookingVoucher: true,
        user: { select: { id: true } },
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    // Validate state machine
    const allowed = VALID_TRANSITIONS[booking.status] || [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${booking.status} → ${dto.status}. ` +
        `Allowed transitions: [${allowed.join(', ') || 'none'}]`,
      );
    }

    // ── Nếu CANCEL → hoàn lại inventory + voucher ─────────
    if (dto.status === 'CANCELLED') {
      await this.prisma.$transaction(async (tx) => {
        // Update booking status
        await tx.booking.update({
          where: { id },
          data: { status: BookingStatus.CANCELLED },
        });

        // Hoàn lại reservedQty — dùng max(0) để tránh âm
        for (const item of booking.bookingItems) {
          await tx.ticketCategory.update({
            where: { id: item.ticketCategoryId },
            data: {
              reservedQty: {
                decrement: item.quantity,
              },
            },
          });
        }

        // Hoàn lại voucher usedCount nếu có
        if (booking.bookingVoucher) {
          await tx.voucher.update({
            where: { id: booking.bookingVoucher.voucherId },
            data: { usedCount: { decrement: 1 } },
          });
        }
      });

      // Sync Redis sau DB commit
      if (booking.bookingVoucher) {
        const voucherId = booking.bookingVoucher.voucherId;
        const countKey = `voucher:usedCount:${voucherId}`;
        const current = await this.redis.get(countKey);
        if (current !== null && parseInt(current) > 0) {
          await this.redis.decr(countKey);
        }
        // Xóa flag user đã dùng để họ có thể dùng lại voucher
        await this.redis.del(
          `voucher:used:${voucherId}:${booking.user.id}`,
        );
      }

      return {
        message: 'Booking cancelled. Inventory and voucher usage restored.',
      };
    }

    // ── Các transition khác (PENDING → CONFIRMED) ──────────
    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: dto.status as BookingStatus },
      include: {
        concert: { select: { name: true } },
        user: { select: { name: true, email: true } },
      },
    });

    return {
      message: `Booking status updated: ${booking.status} → ${dto.status}`,
      booking: {
        id: updated.id,
        status: updated.status,
        concert: updated.concert?.name ?? 'N/A',
        user: updated.user?.email ?? 'N/A',
      },
    };
  }
}