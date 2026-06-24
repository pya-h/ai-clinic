import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { UnsubscribePushDto } from './dto/unsubscribe-push.dto';

@ApiTags('Notification')
@Controller('notification')
@UseGuards(CookieAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @ApiOperation({ description: 'Get my notifications (paginated).' })
  @Get()
  async getNotifications(
    @CurrentUser() user: User,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(20), ParseIntPipe) take: number,
  ) {
    return this.notificationService.getUserNotifications(
      user.id,
      skip,
      take,
    );
  }

  @ApiOperation({ description: 'Get unread notification count.' })
  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: User) {
    return this.notificationService.getUnreadCount(user.id);
  }

  @ApiOperation({ description: 'Mark a notification as read.' })
  @Patch(':id/read')
  async markAsRead(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.notificationService.markAsRead(id, user.id);
  }

  @ApiOperation({ description: 'Mark all notifications as read.' })
  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: User) {
    return this.notificationService.markAllAsRead(user.id);
  }

  @ApiOperation({ description: 'Subscribe to push notifications.' })
  @HttpCode(HttpStatus.CREATED)
  @Post('subscribe')
  async subscribe(
    @CurrentUser() user: User,
    @Body() dto: SubscribePushDto,
  ) {
    return this.notificationService.subscribe(user.id, dto.endpoint, dto.keys);
  }

  @ApiOperation({ description: 'Unsubscribe from push notifications.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('unsubscribe')
  async unsubscribe(
    @CurrentUser() user: User,
    @Body() dto: UnsubscribePushDto,
  ) {
    await this.notificationService.unsubscribe(user.id, dto.endpoint);
  }
}
