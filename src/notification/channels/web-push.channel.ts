import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WebPushChannel {
  private readonly logger = new Logger(WebPushChannel.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const vapidSubject = this.configService.get<string>(
      'notification.vapid.subject',
    );
    const vapidPublicKey = this.configService.get<string>(
      'notification.vapid.publicKey',
    );
    const vapidPrivateKey = this.configService.get<string>(
      'notification.vapid.privateKey',
    );

    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    } else {
      this.logger.warn(
        'VAPID keys not configured — web push notifications disabled',
      );
    }
  }

  async send(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId, isActive: true },
    });

    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({ title, body, data });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys as any },
          payload,
        );
      } catch (err: any) {
        if (err.statusCode === 410) {
          await this.prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { isActive: false },
          });
          this.logger.log(
            `Deactivated expired push subscription ${sub.id} for user ${userId}`,
          );
        } else {
          this.logger.error(
            `Push notification failed for subscription ${sub.id}: ${err.message}`,
          );
        }
      }
    }
  }
}
