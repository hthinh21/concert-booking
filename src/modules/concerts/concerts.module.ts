import { Module } from '@nestjs/common';
import { ConcertsController, AdminConcertsController } from './concerts.controller';
import { ConcertsService } from './concerts.service';

@Module({
  controllers: [ConcertsController, AdminConcertsController],
  providers: [ConcertsService],
  exports: [ConcertsService],
})
export class ConcertsModule {}