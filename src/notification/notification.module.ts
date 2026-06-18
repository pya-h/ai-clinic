import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { EmailChannel } from './channels/email.channel';
import { WebPushChannel } from './channels/web-push.channel';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [NotificationController],
  providers: [NotificationService, EmailChannel, WebPushChannel],
  exports: [NotificationService],
})
export class NotificationModule {}
