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
 *   onNewChatMessage     — sends PUSH, skips self-message, one unread notification per chat (count updated, serialized)
 *   markChatMessagesRead — marks the chat's unread message notifications read
 *   onNewReview          — sends PUSH to doctor
 *   onDoctorVerified     — sends BOTH to doctor
 *   onDoctorRejected     — sends BOTH to doctor with the reason, DOCTOR_VERIFIED type, approved=false
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
      data: null as null,
      channel: NotificationChannelEnum.PUSH,
      isRead: false,
      sentAt: null as null,
      readAt: null as null,
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
            data: { chatId, senderId, count: 1 },
            channel: NotificationChannelEnum.PUSH,
          }),
        }),
      );
      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: {
          userId: recipientUserId,
          type: NotificationTypeEnum.NEW_CHAT_MESSAGE,
          isRead: false,
          data: { path: ['chatId'], equals: chatId },
        },
        orderBy: { createdAt: 'desc' },
      });
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

    describe('with an unread notification for the chat', () => {
      const senderId = randomUUID();
      const recipientUserId = randomUUID();
      const senderName = `Dr. ${randomUUID().slice(0, 6)}`;

      it.each([
        ['a single message', { chatId, senderId, count: 1 }, 2],
        ['a single message from before counts existed', { chatId, senderId }, 2],
        ['several messages', { chatId, senderId, count: 3 + Math.floor(Math.random() * 20) }, null],
      ])('should update the notification of %s instead of adding one, and push', async (_case, data, expected) => {
        const count = expected ?? (data as { count: number }).count + 1;
        const unread = buildNotification({ userId: recipientUserId, type: NotificationTypeEnum.NEW_CHAT_MESSAGE, data });
        prisma.notification.findFirst.mockResolvedValue(unread);
        prisma.notification.updateMany.mockResolvedValue({ count: 1 });
        prisma.notification.update.mockResolvedValue(unread);

        await service.onNewChatMessage(chatId, senderId, recipientUserId, senderName);

        const body = `${senderName} sent you ${count} messages.`;
        expect(prisma.notification.updateMany).toHaveBeenCalledWith({
          where: { id: unread.id, isRead: false },
          data: {
            title: 'New Messages',
            body,
            data: { chatId, senderId, count },
            createdAt: expect.any(Date),
            sentAt: null,
          },
        });
        expect(prisma.notification.create).not.toHaveBeenCalled();
        expect(pushChannel.send).toHaveBeenCalledWith(recipientUserId, 'New Messages', body, {
          chatId,
          senderId,
          count,
        });
        expect(prisma.notification.update).toHaveBeenCalledWith({
          where: { id: unread.id },
          data: { sentAt: expect.any(Date) },
        });
      });

      it('should start a new notification when the user read the old one meanwhile', async () => {
        prisma.notification.findFirst.mockResolvedValue(
          buildNotification({ type: NotificationTypeEnum.NEW_CHAT_MESSAGE, data: { chatId, senderId, count: 4 } }),
        );
        prisma.notification.updateMany.mockResolvedValue({ count: 0 });
        const created = buildNotification({ userId: recipientUserId });
        prisma.notification.create.mockResolvedValue(created);
        prisma.notification.update.mockResolvedValue(created);

        await service.onNewChatMessage(chatId, senderId, recipientUserId, senderName);

        expect(prisma.notification.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            title: 'New Message',
            body: `${senderName} sent you a message.`,
            data: { chatId, senderId, count: 1 },
          }),
        });
        expect(pushChannel.send).toHaveBeenCalledTimes(1);
      });

      it('should keep the updated notification and log when the push fails', async () => {
        prisma.notification.findFirst.mockResolvedValue(
          buildNotification({ type: NotificationTypeEnum.NEW_CHAT_MESSAGE, data: { chatId, senderId, count: 1 } }),
        );
        prisma.notification.updateMany.mockResolvedValue({ count: 1 });
        pushChannel.send.mockRejectedValue(new Error('push down'));
        const logError = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

        await expect(service.onNewChatMessage(chatId, senderId, recipientUserId, senderName)).resolves.toBeUndefined();

        expect(logError).toHaveBeenCalledWith(expect.stringContaining('push down'));
        expect(prisma.notification.update).not.toHaveBeenCalled();
        expect(prisma.notification.create).not.toHaveBeenCalled();
      });
    });

    describe('a burst of messages', () => {
      /** An in-memory notification table that answers the queries onNewChatMessage makes. */
      const useInMemoryTable = () => {
        const rows: any[] = [];
        prisma.notification.findFirst.mockImplementation(async ({ where }: any) => {
          await new Promise((r) => setTimeout(r, Math.random() * 5));
          return (
            rows.find(
              (n) => n.userId === where.userId && !n.isRead && n.data.chatId === where.data.equals,
            ) ?? null
          );
        });
        prisma.notification.create.mockImplementation(async ({ data }: any) => {
          await new Promise((r) => setTimeout(r, Math.random() * 5));
          const row = buildNotification({ ...data });
          rows.push(row);
          return row;
        });
        prisma.notification.updateMany.mockImplementation(async ({ where, data }: any) => {
          const row = rows.find((n) => n.id === where.id && !n.isRead);
          if (row) Object.assign(row, data);
          return { count: row ? 1 : 0 };
        });
        prisma.notification.update.mockImplementation(async ({ where }: any) => rows.find((n) => n.id === where.id));
        return rows;
      };

      it('should leave one notification counting every message, not one per message', async () => {
        const rows = useInMemoryTable();
        const [senderId, recipientUserId] = [randomUUID(), randomUUID()];
        const burst = 3 + Math.floor(Math.random() * 6);

        await Promise.all(
          Array.from({ length: burst }, () => service.onNewChatMessage(chatId, senderId, recipientUserId, 'Dr. Burst')),
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].data).toEqual({ chatId, senderId, count: burst });
        expect(rows[0].body).toBe(`Dr. Burst sent you ${burst} messages.`);
        expect(pushChannel.send).toHaveBeenCalledTimes(burst);
      });

      it('should keep separate notifications per chat and per recipient', async () => {
        const rows = useInMemoryTable();
        const [senderId, recipientA, recipientB, otherChat] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

        await Promise.all([
          service.onNewChatMessage(chatId, senderId, recipientA, 'Dr. A'),
          service.onNewChatMessage(otherChat, senderId, recipientA, 'Dr. A'),
          service.onNewChatMessage(chatId, senderId, recipientB, 'Dr. A'),
          service.onNewChatMessage(chatId, senderId, recipientA, 'Dr. A'),
        ]);

        const counts = rows.map((n) => `${n.userId === recipientA ? 'A' : 'B'}:${n.data.chatId === chatId ? 'chat' : 'other'}:${n.data.count}`);
        expect(counts.sort()).toEqual(['A:chat:2', 'A:other:1', 'B:chat:1']);
      });

      it("should not let a push that never answers hold up the chat's next notifications", async () => {
        const rows = useInMemoryTable();
        const [senderId, recipientUserId] = [randomUUID(), randomUUID()];
        pushChannel.send.mockReturnValueOnce(new Promise(() => undefined));

        void service.onNewChatMessage(chatId, senderId, recipientUserId, 'Dr. Slow');
        await service.onNewChatMessage(chatId, senderId, recipientUserId, 'Dr. Slow');

        expect(rows).toHaveLength(1);
        expect(rows[0].data.count).toBe(2);
        expect((service as any).chatMessageQueue.size).toBe(0);
      });

      it('should mark read only after a notification already being written for the chat', async () => {
        const rows = useInMemoryTable();
        const recipientUserId = randomUUID();
        prisma.notification.updateMany.mockImplementation(async ({ where, data }: any) => {
          const matching = rows.filter((n) =>
            where.id !== undefined ? n.id === where.id && !n.isRead : n.userId === where.userId && !n.isRead,
          );
          matching.forEach((n) => Object.assign(n, data));
          return { count: matching.length };
        });

        const notified = service.onNewChatMessage(chatId, randomUUID(), recipientUserId, 'Dr. Race');
        const marked = service.markChatMessagesRead(recipientUserId, chatId);
        await Promise.all([notified, marked]);

        expect(rows).toHaveLength(1);
        expect(rows[0].isRead).toBe(true);
        await expect(marked).resolves.toEqual({ count: 1 });
      });

      it('should process the next message when the previous one failed', async () => {
        const rows = useInMemoryTable();
        const [senderId, recipientUserId] = [randomUUID(), randomUUID()];
        prisma.notification.findFirst.mockRejectedValueOnce(new Error('DB blip'));

        const results = await Promise.allSettled([
          service.onNewChatMessage(chatId, senderId, recipientUserId, 'Dr. X'),
          service.onNewChatMessage(chatId, senderId, recipientUserId, 'Dr. X'),
        ]);

        expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
        expect(rows).toHaveLength(1);
        expect((service as any).chatMessageQueue.size).toBe(0);
      });
    });
  });

  describe('markChatMessagesRead()', () => {
    it("should mark only that user's unread notifications about that chat's messages", async () => {
      const count = Math.floor(Math.random() * 5);
      prisma.notification.updateMany.mockResolvedValue({ count });

      await expect(service.markChatMessagesRead(userId, chatId)).resolves.toEqual({ count });

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          userId,
          type: NotificationTypeEnum.NEW_CHAT_MESSAGE,
          isRead: false,
          data: { path: ['chatId'], equals: chatId },
        },
        data: { isRead: true, readAt: expect.any(Date) },
      });
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

  describe('onDoctorRejected()', () => {
    it('should send BOTH notification with the reason to the doctor', async () => {
      const doctorUserId = randomUUID();
      const reason = `Unreadable license ${randomUUID().slice(0, 8)}`;
      const created = buildNotification({ userId: doctorUserId });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.onDoctorRejected(doctorUserId, reason);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: doctorUserId,
          type: NotificationTypeEnum.DOCTOR_VERIFIED,
          title: 'Profile Not Verified',
          body: `Your doctor profile was not verified (reason: ${reason}). Update your profile or documents, then re-submit it for review.`,
          data: { approved: false, reason },
          channel: NotificationChannelEnum.BOTH,
        },
      });
      expect(emailChannel.send).toHaveBeenCalledWith(
        doctorUserId,
        'Profile Not Verified',
        expect.stringContaining(reason),
        { approved: false, reason },
      );
      expect(pushChannel.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('onNurseInvitation()', () => {
    it('should send NURSE_INVITATION via BOTH to the invitee, naming the doctor', async () => {
      const inviteeId = randomUUID();
      const assignmentId = Math.floor(Math.random() * 1e6) + 1;
      const doctorName = `Ana ${randomUUID().slice(0, 6)}`;
      const created = buildNotification({ userId: inviteeId });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.onNurseInvitation(inviteeId, assignmentId, doctorName);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: inviteeId,
          type: NotificationTypeEnum.NURSE_INVITATION,
          title: 'Nurse Invitation',
          body: `Dr. ${doctorName} invited you to join their team as a nurse. Accept or decline it on your invitations page.`,
          data: { assignmentId },
          channel: NotificationChannelEnum.BOTH,
        },
      });
      expect(emailChannel.send).toHaveBeenCalledTimes(1);
      expect(pushChannel.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('onNurseInvitationAnswered()', () => {
    it.each([
      [true, 'Nurse Invitation Accepted', 'accepted'],
      [false, 'Nurse Invitation Declined', 'declined'],
    ])('should tell the doctor by PUSH (accepted: %s)', async (accepted, title, verb) => {
      const doctorUserId = randomUUID();
      const assignmentId = Math.floor(Math.random() * 1e6) + 1;
      const nurseName = `Sam ${randomUUID().slice(0, 6)}`;
      const created = buildNotification({ userId: doctorUserId });
      prisma.notification.create.mockResolvedValue(created);
      prisma.notification.update.mockResolvedValue({ ...created, sentAt: new Date() });

      await service.onNurseInvitationAnswered(doctorUserId, assignmentId, nurseName, accepted);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: doctorUserId,
          type: NotificationTypeEnum.NURSE_INVITATION_ANSWERED,
          title,
          body: `${nurseName} ${verb} your invitation to join your team as a nurse.`,
          data: { assignmentId, accepted },
          channel: NotificationChannelEnum.PUSH,
        },
      });
      expect(pushChannel.send).toHaveBeenCalledTimes(1);
      expect(emailChannel.send).not.toHaveBeenCalled();
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
