import {
  Controller,
  Get,
  Post,
  Patch,
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
import { ConcertsService } from './concerts.service';
import {
  ListConcertsDto,
  CreateConcertDto,
  CreateTicketCategoryDto,
} from './dto/concert.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

// ─── CUSTOMER CONTROLLER ─────────────────────────────────
@ApiTags('Concerts')
@Controller('concerts')
export class ConcertsController {
  constructor(private concertsService: ConcertsService) { }

  @Get()
  @ApiOperation({ summary: 'Browse published concerts' })
  findAll(@Query() dto: ListConcertsDto) {
    return this.concertsService.findAll(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get concert detail' })
  @ApiParam({ name: 'id', example: 'concert-uuid-here' })
  findOne(@Param('id') id: string) {
    return this.concertsService.findOne(id);
  }

  @Get(':id/tickets')
  @ApiOperation({ summary: 'View ticket categories and prices' })
  @ApiParam({ name: 'id', example: 'concert-uuid-here' })
  findTickets(@Param('id') id: string) {
    return this.concertsService.findTickets(id);
  }
}

// ─── ADMIN CONTROLLER ────────────────────────────────────
@ApiTags('Admin - Concerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OPERATOR', 'ADMIN')
@Controller('admin/concerts')
export class AdminConcertsController {
  constructor(private concertsService: ConcertsService) { }

  @Get()
  @ApiOperation({ summary: '[Admin] List all concerts with stats' })
  adminFindAll(@Query() dto: ListConcertsDto) {
    return this.concertsService.adminFindAll(dto);
  }

  @Post()
  @ApiOperation({ summary: '[Admin] Create new concert (status: DRAFT)' })
  create(@Body() dto: CreateConcertDto) {
    return this.concertsService.create(dto);
  }

  @Patch(':id/publish')
  @ApiOperation({ summary: '[Admin] Publish concert (DRAFT → PUBLISHED)' })
  @ApiParam({ name: 'id', example: 'concert-uuid-here' })
  publish(@Param('id') id: string) {
    return this.concertsService.publish(id);
  }

  @Post(':id/tickets')
  @ApiOperation({ summary: '[Admin] Add ticket category to concert' })
  @ApiParam({ name: 'id', example: 'concert-uuid-here' })
  addTicketCategory(
    @Param('id') concertId: string,
    @Body() dto: CreateTicketCategoryDto,
  ) {
    return this.concertsService.addTicketCategory(concertId, dto);
  }

  @Get(':id/tickets/availability')
  @ApiOperation({ summary: '[Admin] Validate ticket availability' })
  @ApiParam({ name: 'id', example: 'concert-uuid-here' })
  getAvailability(@Param('id') id: string) {
    return this.concertsService.getTicketAvailability(id);
  }
}