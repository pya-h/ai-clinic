/**
 * NotificationService Unit Tests
 *
 * Tests:
 *   send                 — PUSH only, EMAIL only, BOTH channels, dispatch error handled gracefully,
 *                          data passed through, default channel is PUSH
 *   getUserNotifications — returns paginated data with defaults, custom skip/take
 *   markAsRead           — success, not found, wrong owner (forbidden)
 *   markAllAsRead        — updates unread notifications, returns count
 *   getUnreadCount       — returns count of unread notifications
 *   subscribe            — upserts push subscription by compound key
 *   unsubscribe          — deactivates subscription
 *   onNewConsultation    — sends CONSULTATION_REQUEST via BOTH
 *   onDoctorDecision     — accepted vs declined title/body, BOTH channel
 *   onPaymentConfirmed   — sends TWO notifications (doctor BOTH, patient PUSH)
 *   onNewChatMessage     — sends PUSH, skips self-message
 *   onNewReview          — sends PUSH to doctor
 *   onDoctorVerified     — sends BOTH to doctor
 *   onSoapReady          — sends PUSH with conversationId
 *   onMatchFound         — sends CONSULTATION_REQUEST via BOTH
 *   onMatchAccepted      — sends DOCTOR_DECISION via BOTH
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailChannel } from './channels/email.channel';
import { WebPushChannel } from './channels/web-push.channel';
import { NotificationChannelEnum, NotificationTypeEnum } from '@prisma/client';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/helpers/mock-prisma.helper';
import { randomUUID } from 'crypto';

describe('NotificationService', () => {
  let service: NotificationService;
  let prisma: MockPrismaService;
  let emailChannel: { send: jest.Mock };
  let pushChannel: { send: jest.Mock };

  // ── Reusable IDs ──────────────────────────────────────────────
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const consultationId = randomUUID();
  const chatId = randomUUID();

  let notificationIdSeq = 0;

  /** Build a mock Notification row */
  const buildNotification = (overrides: Record<string, any> = {}) => {
    notificationIdSeq += 1;
    return {
      id: notificationIdSeq,
      createdAt: new Date(),
      userId,
      type: NotificationTypeEnum.SYSTEM,
      title: 'Test title',
      body: 'Test body',
      data: null,
      channel: NotificationChannelEnum.PUSH,
      isRead: false,
      sentAt: null,
      readAt: null,
      ...overrides,
    };
  };

  /** Build a mock PushSubscription row */
  const buildSubscription = (overrides: Record<string, any> = {}) => ({
    id: 1,
    createdAt: new Date(),
    userId,
    endpoint: 'https://push.example.com/sub/abc',
    keys: { p256dh: 'key-p256dh', auth: 'key-auth' },
    isActive: true,
    ...overrides,
  });

  beforeEach(async () => {
    notificationIdSeq = 0;
    prisma = createMockPrismaService();
    emailChannel = { send: jest.fn().mockResolvedValue(undefined) };
    pushChannel = { send: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailChannel, useValue: emailChannel },
        { provide: WebPushChannel, useValue: pushChannel },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  // ═══════════════════════════════════════════════════════════════
  //  send()
  // ═══════════════════════════════════════════════════════════════
  describe('send()', () => {
    it('should create notification and dispatch via PUSH only (default)', async () => {
      const created = buildNotification();
      const updated = { ...created, sentAt: new Date() };
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue(updated);

      const result = await service.send(
        userId,
        NotificationTypeEnum.SYSTEM,
        'Title',
        'Body',
      );

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId,
          type: NotificationTypeEnum.SYSTEM,
          title: 'Title',
          body: 'Body',
          data: undefined,
          channel: NotificationChannelEnum.PUSH,
        },
      });
      expect(pushChannel.send).toHaveBeenCalledWith(userId, 'Title', 'Body', undefined);
      expect(emailChannel.send).not.toHaveBeenCalled();
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: created.id },
        data: { sentAt: expect.any(Date) },
      });
      expect(result).toEqual(updated);
    });

    it('should dispatch via EMAIL only when channel is EMAIL', async () => {
      const created = buildNotification({ channel: NotificationChannelEnum.EMAIL });
      const updated = { ...created, sentAt: new Date() };
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue(updated);

      const result = await service.send(
        userId,
        NotificationTypeEnum.SYSTEM,
        'Title',
        'Body',
        { key: 'value' },
        NotificationChannelEnum.EMAIL,
      );

      expect(emailChannel.send).toHaveBeenCalledWith(userId, 'Title', 'Body', { key: 'value' });
      expect(pushChannel.send).not.toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('should dispatch via both EMAIL and PUSH when channel is BOTH', async () => {
      const created = buildNotification({ channel: NotificationChannelEnum.BOTH });
      const updated = { ...created, sentAt: new Date() };
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue(updated);

      const result = await service.send(
        userId,
        NotificationTypeEnum.SYSTEM,
        'Title',
        'Body',
        undefined,
        NotificationChannelEnum.BOTH,
      );

      expect(emailChannel.send).toHaveBeenCalledTimes(1);
      expect(pushChannel.send).toHaveBeenCalledTimes(1);
      expect(result).toEqual(updated);
    });

    it('should pass data through to channels and DB', async () => {
      const data = { consultationId: randomUUID(), extra: 42 };
      const created = buildNotification({ data });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.send(
        userId,
        NotificationTypeEnum.CONSULTATION_REQUEST,
        'Title',
        'Body',
        data,
        NotificationChannelEnum.PUSH,
      );

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ data }),
        }),
      );
      expect(pushChannel.send).toHaveBeenCalledWith(userId, 'Title', 'Body', data);
    });

    it('should return original notification (without sentAt) on dispatch error', async () => {
      const created = buildNotification();
      prisma.notification.create.mockResolvedValue(created);
      pushChannel.send.mockRejectedValue(new Error('Push service unavailable'));

      const result = await service.send(
        userId,
        NotificationTypeEnum.SYSTEM,
        'Title',
        'Body',
      );

      // Should NOT throw, and should NOT update sentAt
      expect(prisma.notification.update).not.toHaveBeenCalled();
      expect(result).toEqual(created);
      expect(result.sentAt).toBeNull();
    });

    it('should handle email dispatch error for BOTH channel gracefully', async () => {
      const created = buildNotification({ channel: NotificationChannelEnum.BOTH });
      prisma.notification.create.mockResolvedValue(created);
      emailChannel.send.mockRejectedValue(new Error('SMTP error'));

      const result = await service.send(
        userId,
        NotificationTypeEnum.SYSTEM,
        'Title',
        'Body',
        undefined,
        NotificationChannelEnum.BOTH,
      );

      expect(result).toEqual(created);
      expect(result.sentAt).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  getUserNotifications()
  // ═══════════════════════════════════════════════════════════════
  describe('getUserNotifications()', () => {
    it('should return paginated notifications with default skip/take', async () => {
      const notifications = [buildNotification(), buildNotification()];
      const total = 5;

      prisma.$transaction.mockResolvedValue([notifications, total]);

      const result = await service.getUserNotifications(userId);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        data: notifications,
        total,
        skip: 0,
        take: 20,
      });
    });

    it('should pass custom skip and take values', async () => {
      const notifications = [buildNotification()];
      prisma.$transaction.mockResolvedValue([notifications, 10]);

      const result = await service.getUserNotifications(userId, 5, 10);

      expect(result.skip).toBe(5);
      expect(result.take).toBe(10);
    });

    it('should return empty data array when no notifications exist', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      const result = await service.getUserNotifications(userId);

      expect(result).toEqual({ data: [], total: 0, skip: 0, take: 20 });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  markAsRead()
  // ═══════════════════════════════════════════════════════════════
  describe('markAsRead()', () => {
    it('should mark a notification as read', async () => {
      const notification = buildNotification({ userId });
      const updated = { ...notification, isRead: true, readAt: new Date() };
      prisma.notification.findUnique.mockResolvedValue(notification);
      prisma.notification.update.mockResolvedValue(updated);

      const result = await service.markAsRead(notification.id, userId);

      expect(prisma.notification.findUnique).toHaveBeenCalledWith({
        where: { id: notification.id },
      });
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: notification.id },
        data: { isRead: true, readAt: expect.any(Date) },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when notification does not exist', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(service.markAsRead(999, userId)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when notification belongs to another user', async () => {
      const notification = buildNotification({ userId: otherUserId });
      prisma.notification.findUnique.mockResolvedValue(notification);

      await expect(
        service.markAsRead(notification.id, userId),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  markAllAsRead()
  // ═══════════════════════════════════════════════════════════════
  describe('markAllAsRead()', () => {
    it('should update all unread notifications and return count', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllAsRead(userId);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId, isRead: false },
        data: { isRead: true, readAt: expect.any(Date) },
      });
      expect(result).toEqual({ count: 3 });
    });

    it('should return zero count when no unread notifications', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.markAllAsRead(userId);

      expect(result).toEqual({ count: 0 });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  getUnreadCount()
  // ═══════════════════════════════════════════════════════════════
  describe('getUnreadCount()', () => {
    it('should return the count of unread notifications', async () => {
      prisma.notification.count.mockResolvedValue(7);

      const result = await service.getUnreadCount(userId);

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId, isRead: false },
      });
      expect(result).toEqual({ count: 7 });
    });

    it('should return zero when all notifications are read', async () => {
      prisma.notification.count.mockResolvedValue(0);

      const result = await service.getUnreadCount(userId);

      expect(result).toEqual({ count: 0 });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  subscribe()
  // ═══════════════════════════════════════════════════════════════
  describe('subscribe()', () => {
    it('should upsert a push subscription', async () => {
      const endpoint = 'https://push.example.com/sub/' + randomUUID();
      const keys = { p256dh: 'test-p256dh-key', auth: 'test-auth-key' };
      const subscription = buildSubscription({ endpoint, keys });
      prisma.pushSubscription.upsert.mockResolvedValue(subscription);

      const result = await service.subscribe(userId, endpoint, keys);

      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { userId_endpoint: { userId, endpoint } },
        update: { keys, isActive: true },
        create: { userId, endpoint, keys, isActive: true },
      });
      expect(result).toEqual(subscription);
    });

    it('should reactivate an existing subscription on re-subscribe', async () => {
      const endpoint = 'https://push.example.com/sub/existing';
      const keys = { p256dh: 'new-key', auth: 'new-auth' };
      const subscription = buildSubscription({ endpoint, keys, isActive: true });
      prisma.pushSubscription.upsert.mockResolvedValue(subscription);

      const result = await service.subscribe(userId, endpoint, keys);

      expect(result.isActive).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  unsubscribe()
  // ═══════════════════════════════════════════════════════════════
  describe('unsubscribe()', () => {
    it('should deactivate the push subscription', async () => {
      const endpoint = 'https://push.example.com/sub/' + randomUUID();
      prisma.pushSubscription.updateMany.mockResolvedValue({ count: 1 });

      await service.unsubscribe(userId, endpoint);

      expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({
        where: { userId, endpoint },
        data: { isActive: false },
      });
    });

    it('should not throw when subscription does not exist', async () => {
      prisma.pushSubscription.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.unsubscribe(userId, 'https://nonexistent.example.com'),
      ).resolves.toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Business event convenience methods
  // ═══════════════════════════════════════════════════════════════
  describe('onNewConsultation()', () => {
    it('should send a CONSULTATION_REQUEST notification via BOTH', async () => {
      const doctorUserId = randomUUID();
      const created = buildNotification({
        userId: doctorUserId,
        type: NotificationTypeEnum.CONSULTATION_REQUEST,
        channel: NotificationChannelEnum.BOTH,
      });
      const updated = { ...created, sentAt: new Date() };
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue(updated);

      await service.onNewConsultation(consultationId, doctorUserId);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: doctorUserId,
            type: NotificationTypeEnum.CONSULTATION_REQUEST,
            title: 'New Consultation Request',
            channel: NotificationChannelEnum.BOTH,
            data: { consultationId },
          }),
        }),
      );
      expect(emailChannel.send).toHaveBeenCalledTimes(1);
      expect(pushChannel.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('onDoctorDecision()', () => {
    it('should send accepted notification with correct title and body', async () => {
      const patientUserId = randomUUID();
      const created = buildNotification({ userId: patientUserId });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.onDoctorDecision(consultationId, patientUserId, true);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: patientUserId,
            type: NotificationTypeEnum.DOCTOR_DECISION,
            title: 'Consultation Accepted',
            body: 'Your doctor has accepted the consultation. You can proceed with payment.',
            data: { consultationId, accepted: true },
            channel: NotificationChannelEnum.BOTH,
          }),
        }),
      );
    });

    it('should send declined notification with different title and body', async () => {
      const patientUserId = randomUUID();
      const created = buildNotification({ userId: patientUserId });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.onDoctorDecision(consultationId, patientUserId, false);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Consultation Update',
            body: 'Your doctor has responded to your consultation request. Please check the details.',
            data: { consultationId, accepted: false },
          }),
        }),
      );
    });
  });

  describe('onPaymentConfirmed()', () => {
    it('should send TWO notifications: doctor via BOTH, patient via PUSH', async () => {
      const doctorUserId = randomUUID();
      const patientUserId = randomUUID();
      const doctorNotif = buildNotification({
        userId: doctorUserId,
        channel: NotificationChannelEnum.BOTH,
      });
      const patientNotif = buildNotification({
        userId: patientUserId,
        channel: NotificationChannelEnum.PUSH,
      });

      prisma.notification.create
        .mockResolvedValueOnce(doctorNotif)
        .mockResolvedValueOnce(patientNotif);
      prisma.notification.update
        .mockResolvedValueOnce({ ...doctorNotif, sentAt: new Date() })
        .mockResolvedValueOnce({ ...patientNotif, sentAt: new Date() });

      await service.onPaymentConfirmed(consultationId, doctorUserId, patientUserId);

      expect(prisma.notification.create).toHaveBeenCalledTimes(2);

      // First call: doctor notification via BOTH
      expect(prisma.notification.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            userId: doctorUserId,
            type: NotificationTypeEnum.PAYMENT_CONFIRMED,
            channel: NotificationChannelEnum.BOTH,
          }),
        }),
      );

      // Second call: patient notification via PUSH
      expect(prisma.notification.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            userId: patientUserId,
            type: NotificationTypeEnum.PAYMENT_CONFIRMED,
            channel: NotificationChannelEnum.PUSH,
          }),
        }),
      );

      // Doctor BOTH = email + push, Patient PUSH = push only
      expect(emailChannel.send).toHaveBeenCalledTimes(1);
      expect(pushChannel.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('onNewChatMessage()', () => {
    it('should send PUSH notification to recipient', async () => {
      const senderId = randomUUID();
      const recipientUserId = randomUUID();
      const senderName = 'Dr. Smith';
      const created = buildNotification({ userId: recipientUserId });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.onNewChatMessage(chatId, senderId, recipientUserId, senderName);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: recipientUserId,
            type: NotificationTypeEnum.NEW_CHAT_MESSAGE,
            title: 'New Message',
            body: `${senderName} sent you a message.`,
            data: { chatId, senderId },
            channel: NotificationChannelEnum.PUSH,
          }),
        }),
      );
      expect(pushChannel.send).toHaveBeenCalledTimes(1);
      expect(emailChannel.send).not.toHaveBeenCalled();
    });

    it('should skip notification when sender is the recipient', async () => {
      const sameUserId = randomUUID();

      await service.onNewChatMessage(chatId, sameUserId, sameUserId, 'Self');

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(pushChannel.send).not.toHaveBeenCalled();
      expect(emailChannel.send).not.toHaveBeenCalled();
    });
  });

  describe('onNewReview()', () => {
    it('should send PUSH notification to doctor', async () => {
      const doctorUserId = randomUUID();
      const reviewerName = 'Alice Johnson';
      const created = buildNotification({ userId: doctorUserId });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.onNewReview(doctorUserId, reviewerName);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: doctorUserId,
            type: NotificationTypeEnum.NEW_REVIEW,
            title: 'New Review',
            body: `${reviewerName} left a review on your profile.`,
            channel: NotificationChannelEnum.PUSH,
          }),
        }),
      );
      expect(pushChannel.send).toHaveBeenCalledTimes(1);
      expect(emailChannel.send).not.toHaveBeenCalled();
    });
  });

  describe('onDoctorVerified()', () => {
    it('should send BOTH notification to doctor', async () => {
      const doctorUserId = randomUUID();
      const created = buildNotification({ userId: doctorUserId });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.onDoctorVerified(doctorUserId);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: doctorUserId,
            type: NotificationTypeEnum.DOCTOR_VERIFIED,
            title: 'Profile Verified',
            body: 'Congratulations! Your doctor profile has been verified. You can now receive consultations.',
            channel: NotificationChannelEnum.BOTH,
          }),
        }),
      );
      expect(emailChannel.send).toHaveBeenCalledTimes(1);
      expect(pushChannel.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('onSoapReady()', () => {
    it('should send PUSH notification with conversationId', async () => {
      const conversationId = randomUUID();
      const created = buildNotification({ userId });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.onSoapReady(userId, conversationId);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            type: NotificationTypeEnum.SOAP_READY,
            title: 'SOAP Note Ready',
            data: { conversationId },
            channel: NotificationChannelEnum.PUSH,
          }),
        }),
      );
      expect(pushChannel.send).toHaveBeenCalledTimes(1);
      expect(emailChannel.send).not.toHaveBeenCalled();
    });
  });

  describe('onMatchFound()', () => {
    it('should send CONSULTATION_REQUEST via BOTH to doctor', async () => {
      const doctorUserId = randomUUID();
      const matchRequestId = randomUUID();
      const created = buildNotification({ userId: doctorUserId });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.onMatchFound(doctorUserId, matchRequestId);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: doctorUserId,
            type: NotificationTypeEnum.CONSULTATION_REQUEST,
            title: 'New Patient Match',
            data: { matchRequestId },
            channel: NotificationChannelEnum.BOTH,
          }),
        }),
      );
      expect(emailChannel.send).toHaveBeenCalledTimes(1);
      expect(pushChannel.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('onMatchAccepted()', () => {
    it('should send DOCTOR_DECISION via BOTH to patient with doctor name', async () => {
      const patientUserId = randomUUID();
      const doctorName = 'Johnson';
      const created = buildNotification({ userId: patientUserId });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.onMatchAccepted(patientUserId, consultationId, doctorName);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: patientUserId,
            type: NotificationTypeEnum.DOCTOR_DECISION,
            title: 'Doctor Match Accepted',
            body: `Dr. ${doctorName} has accepted your match request. A consultation has been created.`,
            data: { consultationId },
            channel: NotificationChannelEnum.BOTH,
          }),
        }),
      );
      expect(emailChannel.send).toHaveBeenCalledTimes(1);
      expect(pushChannel.send).toHaveBeenCalledTimes(1);
    });
  });
});
