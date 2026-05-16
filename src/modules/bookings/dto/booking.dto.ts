import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsArray,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BookingStatus } from '@prisma/client';

// ─── Item trong booking ───────────────────────────────────
export class BookingItemDto {
  @ApiProperty({
    example: 'ticket-category-uuid',
    description: 'ID của ticket category (VIP, Standard, ...)',
  })
  @IsString()
  ticketCategoryId: string;

  @ApiProperty({
    example: 2,
    description: 'Số lượng vé muốn đặt',
  })
  @IsNumber()
  @Min(1)
  quantity: number;
}

// ─── Tạo booking ─────────────────────────────────────────
export class CreateBookingDto {
  @ApiProperty({
    example: 'concert-uuid',
    description: 'ID của concert muốn đặt vé',
  })
  @IsString()
  concertId: string;

  @ApiProperty({
    type: [BookingItemDto],
    description: 'Danh sách vé muốn đặt (có thể đặt nhiều loại cùng lúc)',
    example: [
      { ticketCategoryId: 'uuid-vip', quantity: 2 },
      { ticketCategoryId: 'uuid-standard', quantity: 1 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BookingItemDto)
  items: BookingItemDto[];

  @ApiPropertyOptional({
    example: 'FLASHSALE50',
    description: 'Voucher code (optional). Mỗi user chỉ dùng 1 voucher/lần.',
  })
  @IsOptional()
  @IsString()
  voucherCode?: string;
}

// ─── Admin update status ──────────────────────────────────
export class UpdateBookingStatusDto {
  @ApiProperty({
    enum: ['CONFIRMED', 'CANCELLED'],
    example: 'CONFIRMED',
    description: `
State machine hợp lệ:
- PENDING     → CONFIRMED (payment xác nhận)
- PENDING     → CANCELLED (huỷ trước confirm)
- CONFIRMED   → CANCELLED (refund)
- EXPIRED     → CANCELLED (cleanup)
    `,
  })
  @IsEnum(['CONFIRMED', 'CANCELLED'])
  status: 'CONFIRMED' | 'CANCELLED';
}

// ─── List / filter bookings ───────────────────────────────
export class ListBookingsDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Trang hiện tại',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 10,
    description: 'Số records mỗi trang',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({
    enum: BookingStatus,
    example: 'PENDING',
    description: 'Filter theo booking status',
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: 'concert-uuid',
    description: 'Filter theo concert (admin only)',
  })
  @IsOptional()
  @IsString()
  concertId?: string;
}