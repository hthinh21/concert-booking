import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { ConcertStatus } from '@prisma/client';
import { ListConcertsDto, CreateConcertDto, CreateTicketCategoryDto } from './dto/concert.dto';

const TTL_CONCERT_LIST = 300;   
const TTL_CONCERT_DETAIL = 600;
const TTL_TICKETS = 30;         

@Injectable()
export class ConcertsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) { }

  // ─── CUSTOMER ───────────────────────────────────────────

  async findAll(dto: ListConcertsDto) {
    const { page = 1, limit = 10, search } = dto;

    // Tạo cache key dựa vào tham số query
    const cacheKey = `concerts:list:${page}:${limit}:${search || ''}`;

    // 1. Lấy từ cache
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // 2. Nếu Cache miss thì truy vấn DB
    const skip = (page - 1) * limit;
    const where = {
      status: ConcertStatus.PUBLISHED,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { venue: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.concert.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'asc' },
        select: {
          id: true,
          name: true,
          venue: true,
          date: true,
          status: true,
          _count: {
            select: { ticketCategories: true },
          },
        },
      }),
      this.prisma.concert.count({ where }),
    ]);

    const result = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(result), TTL_CONCERT_LIST);

    return result;
  }

  async findOne(id: string) {
    const cacheKey = `concerts:detail:${id}`;

    // 1. Thử lấy từ cache
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // 2. Nếu Cache miss thì truy vấn DB
    const concert = await this.prisma.concert.findFirst({
      where: { id, status: ConcertStatus.PUBLISHED },
      include: {
        ticketCategories: {
          select: {
            id: true,
            name: true,
            price: true,
            totalQty: true,
            reservedQty: true,
          },
        },
      },
    });

    if (!concert) throw new NotFoundException('Concert not found');

    // 3. Lưu vào cache
    await this.redis.set(cacheKey, JSON.stringify(concert), TTL_CONCERT_DETAIL);

    return concert;
  }

  async findTickets(concertId: string) {
    const cacheKey = `concerts:tickets:${concertId}`;

    // TTL ngắn vì số lượng vé thay đổi liên tục khi có booking
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const concert = await this.prisma.concert.findFirst({
      where: { id: concertId, status: ConcertStatus.PUBLISHED },
    });

    if (!concert) throw new NotFoundException('Concert not found');

    const tickets = await this.prisma.ticketCategory.findMany({
      where: { concertId },
      select: {
        id: true,
        name: true,
        price: true,
        totalQty: true,
        reservedQty: true,
      },
    });

    const result = tickets.map((t) => ({
      ...t,
      availableQty: t.totalQty - t.reservedQty,
      isSoldOut: t.reservedQty >= t.totalQty,
    }));

    await this.redis.set(cacheKey, JSON.stringify(result), TTL_TICKETS);

    return result;
  }

  // ─── ADMIN ───────────────────────────────────────────────
  // Admin không cache vì cần data real-time

  async adminFindAll(dto: ListConcertsDto) {
    const { page = 1, limit = 10, search } = dto;
    const skip = (page - 1) * limit;

    const where = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { venue: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.concert.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          ticketCategories: true,
          _count: { select: { bookings: true } },
        },
      }),
      this.prisma.concert.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async create(dto: CreateConcertDto) {
    const concert = await this.prisma.concert.create({
      data: {
        name: dto.name,
        description: dto.description,
        venue: dto.venue,
        date: new Date(dto.date),
        status: ConcertStatus.DRAFT,
      },
    });

    // Xóa cache danh sách vì có concert mới
    await this.invalidateConcertListCache();

    return concert;
  }

  async publish(id: string) {
    const concert = await this.prisma.concert.findUnique({
      where: { id },
      include: { ticketCategories: true },
    });

    if (!concert) throw new NotFoundException('Concert not found');

    if (concert.status === ConcertStatus.PUBLISHED) {
      return { message: 'Concert already published', concert };
    }

    if (concert.ticketCategories.length === 0) {
      throw new NotFoundException('Cannot publish concert without ticket categories');
    }

    const updated = await this.prisma.concert.update({
      where: { id },
      data: { status: ConcertStatus.PUBLISHED },
    });

    // Xóa cache vì trạng thái concert thay đổi
    await Promise.all([
      this.invalidateConcertListCache(),
      this.redis.del(`concerts:detail:${id}`),
    ]);

    return { message: 'Concert published successfully', concert: updated };
  }

  async addTicketCategory(concertId: string, dto: CreateTicketCategoryDto) {
    const concert = await this.prisma.concert.findUnique({ where: { id: concertId } });
    if (!concert) throw new NotFoundException('Concert not found');

    const ticket = await this.prisma.ticketCategory.create({
      data: {
        concertId,
        name: dto.name,
        price: dto.price,
        totalQty: dto.totalQty,
      },
    });

    // Xóa cache chi tiết concert và danh sách vé
    await Promise.all([
      this.redis.del(`concerts:detail:${concertId}`),
      this.redis.del(`concerts:tickets:${concertId}`),
    ]);

    return ticket;
  }

  async getTicketAvailability(concertId: string) {
    // Không cache - dùng để admin xem real-time
    const concert = await this.prisma.concert.findUnique({
      where: { id: concertId },
      include: { ticketCategories: true },
    });

    if (!concert) throw new NotFoundException('Concert not found');

    return {
      concertId,
      concertName: concert.name,
      status: concert.status,
      categories: concert.ticketCategories.map((t) => ({
        id: t.id,
        name: t.name,
        totalQty: t.totalQty,
        reservedQty: t.reservedQty,
        availableQty: t.totalQty - t.reservedQty,
        soldOutPercentage: Math.round((t.reservedQty / t.totalQty) * 100),
      })),
    };
  }

  // ─── HELPERS ──────────────────────────────────────────────

  private async invalidateConcertListCache(): Promise<void> {
    // Xóa toàn bộ cache danh sách: concerts:list:1:10:, concerts:list:2:5:HOANGTHINH, v.v.
    await this.redis.delByPattern('concerts:list:*');
  }     
}