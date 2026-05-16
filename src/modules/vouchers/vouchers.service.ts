import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { DiscountType } from '@prisma/client';
import {
  ValidateVoucherDto,
  CreateVoucherDto,
  ListVouchersDto,
} from './dto/voucher.dto';

@Injectable()
export class VouchersService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // ─── CUSTOMER ─────────────────────────────────────────

  async validate(userId: string, dto: ValidateVoucherDto) {
    // 1. Check Redis cache trước (tránh hit DB liên tục)
    const cacheKey = `voucher:${dto.code}`;
    const cached = await this.redis.get(cacheKey);

    let voucher;
    if (cached) {
      voucher = JSON.parse(cached);
    } else {
      voucher = await this.prisma.voucher.findUnique({
        where: { code: dto.code },
      });

      if (!voucher) throw new NotFoundException('Voucher not found');

      // Cache voucher info 5 phút
      await this.redis.set(cacheKey, JSON.stringify(voucher), 300);
    }

    // 2. Check expired
    if (new Date(voucher.expiresAt) < new Date()) {
      return { valid: false, reason: 'Voucher has expired' };
    }

    // 3. Check max uses — dùng Redis counter để check realtime
    // (DB usedCount có thể stale nếu nhiều request đồng thời)
    const redisCountKey = `voucher:usedCount:${voucher.id}`;
    let usedCount = await this.redis.get(redisCountKey);

    if (usedCount === null) {
      // Sync từ DB vào Redis lần đầu
      const fresh = await this.prisma.voucher.findUnique({
        where: { id: voucher.id },
        select: { usedCount: true },
      });

      // Voucher tồn tại trong cache nhưng đã bị xóa khỏi DB
      if (!fresh) {
        await this.redis.del(`voucher:${dto.code}`); // Xóa cache stale
        throw new NotFoundException('Voucher not found');
      }

      usedCount = String(fresh.usedCount);
      await this.redis.set(redisCountKey, usedCount);
    }

    if (parseInt(usedCount) >= voucher.maxUses) {
      return { valid: false, reason: 'Voucher has reached maximum uses' };
    }

    // 4. Check user đã dùng chưa — cache per user+voucher
    const userUsedKey = `voucher:used:${voucher.id}:${userId}`;
    const userUsed = await this.redis.get(userUsedKey);

    if (userUsed) {
      return { valid: false, reason: 'You have already used this voucher' };
    }

    // Fallback check DB nếu cache miss
    const alreadyUsed = await this.prisma.bookingVoucher.findFirst({
      where: {
        voucherId: voucher.id,
        booking: { userId },
      },
    });

    if (alreadyUsed) {
      // Set cache để lần sau không cần query DB
      await this.redis.set(userUsedKey, '1');
      return { valid: false, reason: 'You have already used this voucher' };
    }

    // 5. Tính discount preview nếu có orderAmount
    let discountAmount = 0;
    let finalAmount = dto.orderAmount || 0;

    if (dto.orderAmount) {
      if (voucher.discountType === DiscountType.PERCENTAGE) {
        discountAmount =
          dto.orderAmount * (Number(voucher.discountValue) / 100);
      } else {
        discountAmount = Number(voucher.discountValue);
      }
      finalAmount = Math.max(0, dto.orderAmount - discountAmount);
    }

    return {
      valid: true,
      voucher: {
        code: voucher.code,
        discountType: voucher.discountType,
        discountValue: Number(voucher.discountValue),
        remainingUses: voucher.maxUses - parseInt(usedCount),
        expiresAt: voucher.expiresAt,
      },
      ...(dto.orderAmount && {
        preview: {
          originalAmount: dto.orderAmount,
          discountAmount,
          finalAmount,
        },
      }),
    };
  }

  // ─── ADMIN ────────────────────────────────────────────

  async create(dto: CreateVoucherDto) {
    const existing = await this.prisma.voucher.findUnique({
      where: { code: dto.code },
    });
    if (existing) throw new ConflictException('Voucher code already exists');

    if (
      dto.discountType === DiscountType.PERCENTAGE &&
      dto.discountValue > 100
    ) {
      throw new BadRequestException('Percentage discount cannot exceed 100%');
    }

    const voucher = await this.prisma.voucher.create({
      data: {
        code: dto.code,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxUses: dto.maxUses,
        expiresAt: new Date(dto.expiresAt),
      },
    });

    // Init Redis counter cho voucher mới
    await this.redis.set(`voucher:usedCount:${voucher.id}`, '0');

    return voucher;
  }

  async findAll(dto: ListVouchersDto) {
    const { page = 1, limit = 10 } = dto;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.voucher.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          code: true,
          discountType: true,
          discountValue: true,
          maxUses: true,
          usedCount: true,
          expiresAt: true,
          createdAt: true,
          _count: { select: { bookingVouchers: true } },
        },
      }),
      this.prisma.voucher.count(),
    ]);

    // Enrich với Redis realtime usedCount
    const enriched = await Promise.all(
      data.map(async (v) => {
        const redisCount = await this.redis.get(`voucher:usedCount:${v.id}`);
        const realtimeUsed = redisCount !== null ? parseInt(redisCount) : v.usedCount;

        return {
          ...v,
          usedCount: realtimeUsed,
          remainingUses: v.maxUses - realtimeUsed,
          usagePercentage: Math.round((realtimeUsed / v.maxUses) * 100),
          isExpired: new Date(v.expiresAt) < new Date(),
          isExhausted: realtimeUsed >= v.maxUses,
        };
      }),
    );

    return {
      data: enriched,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const voucher = await this.prisma.voucher.findUnique({
      where: { id },
      include: {
        bookingVouchers: {
          include: {
            booking: {
              select: {
                id: true,
                status: true,
                totalAmount: true,
                createdAt: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
          take: 20,
          orderBy: { booking: { createdAt: 'desc' } },
        },
      },
    });

    if (!voucher) throw new NotFoundException('Voucher not found');

    // Lấy realtime usedCount từ Redis
    const redisCount = await this.redis.get(`voucher:usedCount:${voucher.id}`);
    const realtimeUsed =
      redisCount !== null ? parseInt(redisCount) : voucher.usedCount;

    return {
      ...voucher,
      usedCount: realtimeUsed,
      remainingUses: voucher.maxUses - realtimeUsed,
      usagePercentage: Math.round((realtimeUsed / voucher.maxUses) * 100),
      isExpired: voucher.expiresAt < new Date(),
      isExhausted: realtimeUsed >= voucher.maxUses,
    };
  }

  // ─── HELPER — gọi từ BookingsService khi apply voucher ───

  async incrementUsedCount(voucherId: string) {
    const key = `voucher:usedCount:${voucherId}`;
    await this.redis.incr(key);
  }

  async decrementUsedCount(voucherId: string) {
    const key = `voucher:usedCount:${voucherId}`;
    await this.redis.decr(key);
  }

  async markUserUsed(voucherId: string, userId: string) {
    const key = `voucher:used:${voucherId}:${userId}`;
    await this.redis.set(key, '1');
  }

  async invalidateCache(code: string) {
    await this.redis.del(`voucher:${code}`);
  }
}