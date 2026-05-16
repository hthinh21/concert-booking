import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import {
  CreateBookingDto,
  UpdateBookingStatusDto,
  ListBookingsDto,
} from './dto/booking.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// ─── CUSTOMER ────────────────────────────────────────────
@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private bookingsService: BookingsService) {}

  @Post()
  @ApiOperation({
    summary: 'Reserve tickets',
    description: `
**Requires header:** \`X-Idempotency-Key: <uuid>\`

Flow:
1. Check idempotency (chống duplicate do retry)
2. Validate concert published
3. Redis lock per ticket category (chống oversell)
4. Check inventory
5. Validate voucher (nếu có)
6. DB transaction: tạo booking + decrement inventory
7. Update Redis counters
8. Cache result vào idempotency key (24h)
    `,
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    description: 'UUID để prevent duplicate booking khi retry',
    required: true,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  create(
    @CurrentUser() user: any,
    @Body() dto: CreateBookingDto,
    @Headers('x-idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException(
        'X-Idempotency-Key header is required. Generate a UUID on client side.',
      );
    }
    return this.bookingsService.create(user.id, dto, idempotencyKey);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get my bookings (with filter by status)' })
  findMyBookings(
    @CurrentUser() user: any,
    @Query() dto: ListBookingsDto,
  ) {
    return this.bookingsService.findMyBookings(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking detail + track status' })
  @ApiParam({ name: 'id', example: 'booking-uuid-here' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.findOne(id, user.id);
  }
}

// ─── ADMIN ───────────────────────────────────────────────
@ApiTags('Admin - Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OPERATOR', 'ADMIN')
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private bookingsService: BookingsService) {}

  @Get()
  @ApiOperation({
    summary: '[Admin] Monitor all bookings',
    description: 'Filter by status và concertId. Dùng để handle failed/suspicious bookings.',
  })
  adminFindAll(@Query() dto: ListBookingsDto) {
    return this.bookingsService.adminFindAll(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '[Admin] Get booking detail' })
  @ApiParam({ name: 'id', example: 'booking-uuid-here' })
  adminFindOne(@Param('id') id: string) {
    return this.bookingsService.adminFindOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: '[Admin] Update booking status manually',
    description: `
State machine (chỉ cho phép transition hợp lệ):

| From | To | Ghi chú |
|---|---|---|
| PENDING | CONFIRMED | Payment xác nhận |
| PENDING | CANCELLED | Huỷ trước confirm |
| CONFIRMED | CANCELLED | Refund sau confirm |
| EXPIRED | CANCELLED | Cleanup |

Khi CANCEL: tự động hoàn lại inventory + voucher usage.
    `,
  })
  @ApiParam({ name: 'id', example: 'booking-uuid-here' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookingsService.updateStatus(id, dto);
  }
}