import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentFilterDto } from './dto/payment-filter.dto';

@ApiTags('Payment')
@Controller('payment')
@UseGuards(CookieAuthGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @ApiOperation({ description: 'Create a new payment record (stub — no real provider).' })
  @HttpCode(HttpStatus.CREATED)
  @Post()
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentService.create(user, dto);
  }

  @ApiOperation({ description: 'List current user\'s payments (paginated, optional status filter).' })
  @Get()
  async list(
    @CurrentUser() user: User,
    @Query() filters: PaymentFilterDto,
  ) {
    return this.paymentService.getUserPayments(user, filters);
  }

  @ApiOperation({ description: 'Get a specific payment by ID.' })
  @Get(':id')
  async getById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.paymentService.getById(id, user);
  }

  @ApiOperation({ description: 'Confirm a payment (stub — marks as COMPLETED without real provider).' })
  @HttpCode(HttpStatus.OK)
  @Post(':id/confirm')
  async confirm(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.paymentService.confirmPayment(id, user);
  }
}
