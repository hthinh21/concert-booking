import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsNumber,
  IsDateString,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DiscountType } from '@prisma/client';

export class ValidateVoucherDto {
  @ApiProperty({ example: 'FLASHSALE50' })
  @IsString()
  code: string;

  @ApiPropertyOptional({ example: 5000000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  orderAmount?: number;
}

export class CreateVoucherDto {
  @ApiProperty({ example: 'FLASHSALE50' })
  @IsString()
  code: string;

  @ApiProperty({ enum: DiscountType, example: 'PERCENTAGE' })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0)
  @Max(100)
  discountValue: number;

  @ApiProperty({ example: 100 })
  @IsNumber()
  @Min(1)
  maxUses: number;

  @ApiProperty({ example: '2026-12-31T00:00:00Z' })
  @IsDateString()
  expiresAt: string;
}

export class ListVouchersDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;
}