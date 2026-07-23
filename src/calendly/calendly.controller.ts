import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CalendlyService } from './calendly.service';
import { CalendlyWebhookDto } from './dto/calendly-webhook.dto';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { CalendlyWebhookEvent } from './types/calendly.types';
import { FastifyRequest } from 'fastify';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Calendly')
@Controller('calendly')
export class CalendlyController {
  constructor(private readonly calendlyService: CalendlyService) {}

  @ApiOperation({
    description:
      'Calendly webhook endpoint. Handles invitee.created and invitee.canceled events.',
  })
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleWebhook(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('calendly-webhook-signature') signature: string,
    @Body() body: CalendlyWebhookDto,
  ) {
    const rawBody = req.rawBody?.toString('utf8') || JSON.stringify(req.body);

    const timestamp =
      signature
        ?.split(',')
        .find((p) => p.startsWith('t='))
        ?.replace('t=', '') || '';

    if (
      !this.calendlyService.verifyWebhookSignature(rawBody, signature || '', timestamp)
    ) {
      throw new UnauthorizedException('Invalid webhook signature.');
    }

    await this.calendlyService.handleWebhookEvent(body as unknown as CalendlyWebhookEvent);

    return { received: true };
  }

  @ApiOperation({ description: 'List cached Calendly event types.' })
  @UseGuards(CookieAuthGuard)
  @Get('event-types')
  async getEventTypes() {
    return this.calendlyService.getEventTypes();
  }

  @ApiOperation({
    description: 'Get Calendly event details for an appointment.',
  })
  @UseGuards(CookieAuthGuard)
  @Get('appointment/:id/event')
  async getAppointmentEvent(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.calendlyService.getCalendlyEventDetails(id, user);
  }
}
