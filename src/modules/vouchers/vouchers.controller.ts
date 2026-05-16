import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { VouchersService } from './vouchers.service';
import {
  ValidateVoucherDto,
  CreateVoucherDto,
  ListVouchersDto,
} from './dto/voucher.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// ─── CUSTOMER ────────────────────────────────────────────
@ApiTags('Vouchers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vouchers')
export class VouchersController {
  constructor(private vouchersService: VouchersService) {}

  @Post('validate')
  @ApiOperation({
    summary: 'Validate voucher before booking',
    description: 'Pass orderAmount to preview discount calculation',
  })
  validate(@CurrentUser() user: any, @Body() dto: ValidateVoucherDto) {
    return this.vouchersService.validate(user.id, dto);
  }
}

// ─── ADMIN ───────────────────────────────────────────────
@ApiTags('Admin - Vouchers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OPERATOR', 'ADMIN')
@Controller('admin/vouchers')
export class AdminVouchersController {
  constructor(private vouchersService: VouchersService) {}

  @Post()
  @ApiOperation({ summary: '[Admin] Create voucher campaign' })
  create(@Body() dto: CreateVoucherDto) {
    return this.vouchersService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: '[Admin] List all vouchers with usage stats' })
  findAll(@Query() dto: ListVouchersDto) {
    return this.vouchersService.findAll(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '[Admin] Get voucher detail with booking history' })
  @ApiParam({ name: 'id', example: 'voucher-uuid' })
  findOne(@Param('id') id: string) {
    return this.vouchersService.findOne(id);
  }
}