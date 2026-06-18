import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Notification,
  NotificationChannelEnum,
  NotificationTypeEnum,
  PushSubscription,
} from '@prisma/client';
import { EmailChannel } from './channels/email.channel';
import { WebPushChannel } from './channels/web-push.channel';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailChannel: EmailChannel,
    private readonly pushChannel: WebPushChannel,
  ) {}

  // ─────────────── Core dispatch ───────────────

  async send(
    userId: string,
    type: NotificationTypeEnum,
    title: string,
    body: string,
    data?: Record<string, any>,
    channel: NotificationChannelEnum = NotificationChannelEnum.PUSH,
  ): Promise<Notification> {
    const notification = await this.prisma.notification.create({
      data: { userId, type, title, body, data: data ?? undefined, channel },
    });

    try {
      if (
        channel === NotificationChannelEnum.EMAIL ||
        channel === NotificationChannelEnum.BOTH
      ) {
        await this.emailChannel.send(userId, title, body, data);
      }
      if (
        channel === NotificationChannelEnum.PUSH ||
        channel === NotificationChannelEnum.BOTH
      ) {
        await this.pushChannel.send(userId, title, body, data);
      }

      return this.prisma.notification.update({
        where: { id: notification.id },
        data: { sentAt: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `Notification dispatch failed for user ${userId}: ${err.message}`,
      );
      return notification;
    }
  }

  // ─────────────── Query endpoints ───────────────

  async getUserNotifications(
    userId: string,
    skip = 0,
    take = 20,
  ): Promise<{ data: Notification[]; total: number; skip: number; take: number }> {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return { data, total, skip, take };
  }

  async markAsRead(notificationId: number, userId: string): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) throw new NotFoundException('Notification not found.');
    if (notification.userId !== userId)
      throw new ForbiddenException('Not your notification.');

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { count: result.count };
  }

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  // ─────────────── Push subscription management ───────────────

  async subscribe(
    userId: string,
    endpoint: string,
    keys: { p256dh: string; auth: string },
  ): Promise<PushSubscription> {
    return this.prisma.pushSubscription.upsert({
      where: { userId_endpoint: { userId, endpoint } },
      update: { keys, isActive: true },
      create: { userId, endpoint, keys, isActive: true },
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.updateMany({
      where: { userId, endpoint },
      data: { isActive: false },
    });
  }

  // ─────────────── Business event convenience methods ───────────────

  async onNewConsultation(
    consultationId: string,
    doctorUserId: string,
  ): Promise<void> {
    await this.send(
      doctorUserId,
      NotificationTypeEnum.CONSULTATION_REQUEST,
      'New Consultation Request',
      'A patient has requested a consultation with you. Please review and respond.',
      { consultationId },
      NotificationChannelEnum.BOTH,
    );
  }

  async onDoctorDecision(
    consultationId: string,
    patientUserId: string,
    accepted: boolean,
  ): Promise<void> {
    const title = accepted
      ? 'Consultation Accepted'
      : 'Consultation Update';
    const body = accepted
      ? 'Your doctor has accepted the consultation. You can proceed with payment.'
      : 'Your doctor has responded to your consultation request. Please check the details.';

    await this.send(
      patientUserId,
      NotificationTypeEnum.DOCTOR_DECISION,
      title,
      body,
      { consultationId, accepted },
      NotificationChannelEnum.BOTH,
    );
  }

  async onPaymentConfirmed(
    consultationId: string,
    doctorUserId: string,
    patientUserId: string,
  ): Promise<void> {
    await this.send(
      doctorUserId,
      NotificationTypeEnum.PAYMENT_CONFIRMED,
      'Payment Confirmed',
      'The patient has completed payment. The consultation is now ready to begin.',
      { consultationId },
      NotificationChannelEnum.BOTH,
    );

    await this.send(
      patientUserId,
      NotificationTypeEnum.PAYMENT_CONFIRMED,
      'Payment Confirmed',
      'Your payment has been confirmed. Your consultation is now active.',
      { consultationId },
      NotificationChannelEnum.PUSH,
    );
  }

  async onNewChatMessage(
    chatId: string,
    senderId: string,
    recipientUserId: string,
    senderName: string,
  ): Promise<void> {
    if (senderId === recipientUserId) return;

    await this.send(
      recipientUserId,
      NotificationTypeEnum.NEW_CHAT_MESSAGE,
      'New Message',
      `${senderName} sent you a message.`,
      { chatId, senderId },
      NotificationChannelEnum.PUSH,
    );
  }

  async onNewReview(
    doctorUserId: string,
    reviewerName: string,
  ): Promise<void> {
    await this.send(
      doctorUserId,
      NotificationTypeEnum.NEW_REVIEW,
      'New Review',
      `${reviewerName} left a review on your profile.`,
      {},
      NotificationChannelEnum.PUSH,
    );
  }

  async onDoctorVerified(doctorUserId: string): Promise<void> {
    await this.send(
      doctorUserId,
      NotificationTypeEnum.DOCTOR_VERIFIED,
      'Profile Verified',
      'Congratulations! Your doctor profile has been verified. You can now receive consultations.',
      {},
      NotificationChannelEnum.BOTH,
    );
  }

  async onSoapReady(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    await this.send(
      userId,
      NotificationTypeEnum.SOAP_READY,
      'SOAP Note Ready',
      'Your AI consultation has generated a SOAP note. You can now find a matching doctor.',
      { conversationId },
      NotificationChannelEnum.PUSH,
    );
  }

  async onMatchFound(
    doctorUserId: string,
    matchRequestId: string,
  ): Promise<void> {
    await this.send(
      doctorUserId,
      NotificationTypeEnum.CONSULTATION_REQUEST,
      'New Patient Match',
      'A patient has been matched with you. Please review and accept or decline.',
      { matchRequestId },
      NotificationChannelEnum.BOTH,
    );
  }

  async onMatchAccepted(
    patientUserId: string,
    consultationId: string,
    doctorName: string,
  ): Promise<void> {
    await this.send(
      patientUserId,
      NotificationTypeEnum.DOCTOR_DECISION,
      'Doctor Match Accepted',
      `Dr. ${doctorName} has accepted your match request. A consultation has been created.`,
      { consultationId },
      NotificationChannelEnum.BOTH,
    );
  }
}
