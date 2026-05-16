import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsString,
    IsDateString,
    IsOptional,
    IsEnum,
    IsNumber,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ConcertStatus } from '@prisma/client';

export class ListConcertsDto {
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

    @ApiPropertyOptional({ example: 'HOANGTHINH' })
    @IsOptional()
    @IsString()
    search?: string;
}

export class CreateConcertDto {
    @ApiProperty({ example: 'HOANGTHINH CONCERT 2026' })
    @IsString()
    name: string;

    @ApiPropertyOptional({ example: 'The most anticipated concert of the year' })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ example: 'Phú Thọ Stadium, Ho Chi Minh' })
    @IsString()
    venue: string;

    @ApiProperty({ example: '2026-12-31T19:00:00Z' })
    @IsDateString()
    date: string;
}

export class CreateTicketCategoryDto {
    @ApiProperty({ example: 'VIP' })
    @IsString()
    name: string;

    @ApiProperty({ example: 5000000 })
    @IsNumber()
    @Min(0)
    price: number;

    @ApiProperty({ example: 100 })
    @IsNumber()
    @Min(1)
    totalQty: number;
}