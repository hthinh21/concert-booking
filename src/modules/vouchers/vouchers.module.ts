import { Module } from '@nestjs/common';
import {
  VouchersController,
  AdminVouchersController,
} from './vouchers.controller';
import { VouchersService } from './vouchers.service';

@Module({
  controllers: [VouchersController, AdminVouchersController],
  providers: [VouchersService],
})
export class VouchersModule {}