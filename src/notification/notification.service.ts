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
  // Per recipient and chat; see onNewChatMessage.
  private readonly chatMessageQueue = new Map<string, Promise<void>>();

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
        `Notification dispatch failed for user ${userId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
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
    const cappedTake = Math.min(take, 100);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: cappedTake,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return { data, total, skip, take: cappedTake };
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

  /**
   * Keeps one unread notification per chat: further messages update its count,
   * text and time instead of adding more. Push is sent for every message.
   */
  async onNewChatMessage(
    chatId: string,
    senderId: string,
    recipientUserId: string,
    senderName: string,
  ): Promise<void> {
    if (senderId === recipientUserId) return;

    // One at a time per recipient and chat, so a burst of messages updates a single notification.
    const key = `${recipientUserId}:${chatId}`;
    const next = (this.chatMessageQueue.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.notifyChatMessage(chatId, senderId, recipientUserId, senderName));
    this.chatMessageQueue.set(key, next);
    try {
      await next;
    } finally {
      if (this.chatMessageQueue.get(key) === next) this.chatMessageQueue.delete(key);
    }
  }

  /** Marks the user's unread notifications about a chat's messages as read (they opened it). */
  async markChatMessagesRead(userId: string, chatId: string): Promise<{ count: number }> {
    return this.prisma.notification.updateMany({
      where: this.unreadChatMessageWhere(userId, chatId),
      data: { isRead: true, readAt: new Date() },
    });
  }

  private async notifyChatMessage(
    chatId: string,
    senderId: string,
    recipientUserId: string,
    senderName: string,
  ): Promise<void> {
    const unread = await this.prisma.notification.findFirst({
      where: this.unreadChatMessageWhere(recipientUserId, chatId),
      orderBy: { createdAt: 'desc' },
    });

    if (unread) {
      const previousCount = Number((unread.data as { count?: unknown } | null)?.count) || 1;
      const content = chatMessageContent(senderName, previousCount + 1);
      const data = { chatId, senderId, count: previousCount + 1 };
      // Conditional: if the user read it meanwhile, a new notification starts below.
      const { count: updated } = await this.prisma.notification.updateMany({
        where: { id: unread.id, isRead: false },
        data: { ...content, data, createdAt: new Date(), sentAt: null },
      });
      if (updated === 1) {
        try {
          await this.pushChannel.send(recipientUserId, content.title, content.body, data);
          await this.prisma.notification.update({ where: { id: unread.id }, data: { sentAt: new Date() } });
        } catch (err) {
          this.logger.error(
            `Notification dispatch failed for user ${recipientUserId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
        return;
      }
    }

    const content = chatMessageContent(senderName, 1);
    await this.send(
      recipientUserId,
      NotificationTypeEnum.NEW_CHAT_MESSAGE,
      content.title,
      content.body,
      { chatId, senderId, count: 1 },
      NotificationChannelEnum.PUSH,
    );
  }

  private unreadChatMessageWhere(userId: string, chatId: string) {
    return {
      userId,
      type: NotificationTypeEnum.NEW_CHAT_MESSAGE,
      isRead: false,
      data: { path: ['chatId'], equals: chatId },
    };
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

  /** Shares the DOCTOR_VERIFIED type; `data.approved` is false. */
  async onDoctorRejected(doctorUserId: string, reason: string): Promise<void> {
    await this.send(
      doctorUserId,
      NotificationTypeEnum.DOCTOR_VERIFIED,
      'Profile Not Verified',
      `Your doctor profile was not verified (reason: ${reason}). Update your profile or documents, then re-submit it for review.`,
      { approved: false, reason },
      NotificationChannelEnum.BOTH,
    );
  }

  async onNurseInvitation(
    inviteeUserId: string,
    assignmentId: number,
    doctorName: string,
  ): Promise<void> {
    await this.send(
      inviteeUserId,
      NotificationTypeEnum.NURSE_INVITATION,
      'Nurse Invitation',
      `Dr. ${doctorName} invited you to join their team as a nurse. Accept or decline it on your invitations page.`,
      { assignmentId },
      NotificationChannelEnum.BOTH,
    );
  }

  async onNurseInvitationAnswered(
    doctorUserId: string,
    assignmentId: number,
    nurseName: string,
    accepted: boolean,
  ): Promise<void> {
    await this.send(
      doctorUserId,
      NotificationTypeEnum.NURSE_INVITATION_ANSWERED,
      accepted ? 'Nurse Invitation Accepted' : 'Nurse Invitation Declined',
      `${nurseName} ${accepted ? 'accepted' : 'declined'} your invitation to join your team as a nurse.`,
      { assignmentId, accepted },
      NotificationChannelEnum.PUSH,
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

function chatMessageContent(senderName: string, count: number): { title: string; body: string } {
  return count === 1
    ? { title: 'New Message', body: `${senderName} sent you a message.` }
    : { title: 'New Messages', body: `${senderName} sent you ${count} messages.` };
}
