/**
 * ChatService Unit Tests
 *
 * Tests:
 *   createChat          — success, self-chat denied, participant not found, patient↔patient denied,
 *                          admin bypass, existing chat returned, deactivated participant,
 *                          nurse↔patient permission check
 *   getUserChats        — returns enriched list with unread counts
 *   getChatById         — success, not found, not participant
 *   getUserChatIds      — returns list of ids
 *   sendMessage         — success, chat not found, closed chat, not participant
 *   getMessages         — success paginated, not participant
 *   markAsRead          — success, skips already-read
 *   editMessage         — success, not found, not sender, non-text
 *   deleteMessage       — success (soft delete), not found, not sender
 *   presence            — setOnline, setOffline, isOnline, getSocketIds
 *   serializeMessage    — BigInt→string conversion
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { NurseService } from '../nurse/nurse.service';
import { MessageTypeEnum, UserRolesEnum } from '@prisma/client';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/helpers/mock-prisma.helper';
import {
  createMockUser,
  createMockDoctorUser,
  createMockAdminUser,
} from '../../test/helpers/mock-session.helper';
import { randomUUID } from 'crypto';

describe('ChatService', () => {
  let service: ChatService;
  let prisma: MockPrismaService;
  let nurseService: { getDoctorIdsForNurse: jest.Mock };

  // ── Random test data factories ─────────────────────────────
  const uuid = () => randomUUID();
  const randName = () =>
    'User' + Math.random().toString(36).substring(2, 8);
  const randEmail = () =>
    `${randName().toLowerCase()}@test.com`;

  const patientId = uuid();
  const doctorId = uuid();
  const adminId = uuid();
  const chatId = uuid();

  const mockPatient = createMockUser({
    id: patientId,
    email: randEmail(),
    firstname: randName(),
    lastname: randName(),
    role: UserRolesEnum.PATIENT,
  });

  const mockDoctor = createMockDoctorUser({
    id: doctorId,
    email: randEmail(),
    firstname: randName(),
    lastname: randName(),
  });

  const mockAdmin = createMockAdminUser({
    id: adminId,
    email: randEmail(),
    firstname: randName(),
    lastname: randName(),
  });

  const mockChat = {
    id: chatId,
    topic: null as null,
    consultationId: null as null,
    closedAt: null as null,
    createdAt: new Date(),
    updatedAt: new Date(),
    parties: [
      { userId: patientId, chatId, joinedAt: new Date(), lastSeenAt: null as null, user: mockPatient },
      { userId: doctorId, chatId, joinedAt: new Date(), lastSeenAt: null as null, user: mockDoctor },
    ],
    messages: [] as any[],
  };

  const bigIntId = BigInt(1);
  const mockMessage = {
    id: bigIntId,
    chatId,
    senderId: patientId,
    content: 'Hello doctor',
    type: MessageTypeEnum.TEXT,
    fileUrl: null as null,
    repliedToId: null as null,
    repliedTo: null as null,
    readBy: null as null,
    editedAt: null as null,
    deletedAt: null as null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sender: {
      id: patientId,
      firstname: mockPatient.firstname,
      lastname: mockPatient.lastname,
      avatar: null as null,
      role: UserRolesEnum.PATIENT,
      isAdmin: false,
      isSuperAdmin: false,
    },
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    nurseService = {
      getDoctorIdsForNurse: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: NurseService, useValue: nurseService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─────────────────────────── createChat ───────────────────────────

  describe('createChat', () => {
    it('should reject creating a chat with yourself', async () => {
      await expect(
        service.createChat(patientId, { participantId: patientId }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when participant is not found', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(mockPatient) // initiator
        .mockResolvedValueOnce(null); // participant

      await expect(
        service.createChat(patientId, { participantId: uuid() }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject when participant is deactivated', async () => {
      const deactivated = { ...mockDoctor, isActive: false };
      prisma.user.findUnique
        .mockResolvedValueOnce(mockPatient)
        .mockResolvedValueOnce(deactivated);

      await expect(
        service.createChat(patientId, { participantId: doctorId }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject patient↔patient chat', async () => {
      const otherPatientId = uuid();
      const otherPatient = createMockUser({
        id: otherPatientId,
        email: randEmail(),
        role: UserRolesEnum.PATIENT,
      });

      prisma.user.findUnique
        .mockResolvedValueOnce(mockPatient)
        .mockResolvedValueOnce(otherPatient);
      prisma.chat.findFirst.mockResolvedValue(null);

      await expect(
        service.createChat(patientId, { participantId: otherPatientId }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow admin to chat with any role', async () => {
      const anotherPatient = createMockUser({
        id: uuid(),
        email: randEmail(),
        role: UserRolesEnum.PATIENT,
      });

      prisma.user.findUnique
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(anotherPatient);
      prisma.chat.findFirst.mockResolvedValue(null);
      prisma.chat.create.mockResolvedValue(mockChat);

      const result = await service.createChat(adminId, {
        participantId: anotherPatient.id,
      });
      expect(result).toBeDefined();
      expect(prisma.chat.create).toHaveBeenCalled();
    });

    it('should return existing chat instead of creating new one', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(mockPatient)
        .mockResolvedValueOnce(mockDoctor);
      prisma.chat.findFirst.mockResolvedValue(mockChat);

      const result = await service.createChat(patientId, {
        participantId: doctorId,
      });
      expect(result.id).toBe(chatId);
      expect(prisma.chat.create).not.toHaveBeenCalled();
    });

    it('should create a new chat between patient and doctor', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(mockPatient)
        .mockResolvedValueOnce(mockDoctor);
      prisma.chat.findFirst.mockResolvedValue(null);
      prisma.chat.create.mockResolvedValue(mockChat);

      const result = await service.createChat(patientId, {
        participantId: doctorId,
        topic: 'Headache follow-up',
      });
      expect(result).toBeDefined();
      expect(prisma.chat.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topic: 'Headache follow-up',
          }),
        }),
      );
    });

    it('should reject nurse→patient chat when nurse lacks CHAT_WITH_PATIENTS permission', async () => {
      const nurseId = uuid();
      const mockNurse = createMockUser({
        id: nurseId,
        email: randEmail(),
        role: UserRolesEnum.NURSE,
      });

      prisma.user.findUnique
        .mockResolvedValueOnce(mockNurse)
        .mockResolvedValueOnce(mockPatient);
      nurseService.getDoctorIdsForNurse.mockResolvedValue([]);

      await expect(
        service.createChat(nurseId, { participantId: patientId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow nurse→patient chat when nurse has CHAT_WITH_PATIENTS permission', async () => {
      const nurseId = uuid();
      const mockNurse = createMockUser({
        id: nurseId,
        email: randEmail(),
        role: UserRolesEnum.NURSE,
      });

      prisma.user.findUnique
        .mockResolvedValueOnce(mockNurse)
        .mockResolvedValueOnce(mockPatient);
      nurseService.getDoctorIdsForNurse.mockResolvedValue([1]);
      prisma.consultation.findFirst.mockResolvedValue({ id: uuid() });
      prisma.chat.findFirst.mockResolvedValue(null);
      prisma.chat.create.mockResolvedValue(mockChat);

      const result = await service.createChat(nurseId, { participantId: patientId });
      expect(result).toBeDefined();
    });

    it('should reject patient→nurse chat when nurse lacks CHAT_WITH_PATIENTS permission', async () => {
      const nurseId = uuid();
      const mockNurse = createMockUser({
        id: nurseId,
        email: randEmail(),
        role: UserRolesEnum.NURSE,
      });

      prisma.user.findUnique
        .mockResolvedValueOnce(mockPatient)
        .mockResolvedValueOnce(mockNurse);
      nurseService.getDoctorIdsForNurse.mockResolvedValue([]);

      await expect(
        service.createChat(patientId, { participantId: nurseId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow patient→nurse chat when nurse has CHAT_WITH_PATIENTS permission', async () => {
      const nurseId = uuid();
      const mockNurse = createMockUser({
        id: nurseId,
        email: randEmail(),
        role: UserRolesEnum.NURSE,
      });

      prisma.user.findUnique
        .mockResolvedValueOnce(mockPatient)
        .mockResolvedValueOnce(mockNurse);
      nurseService.getDoctorIdsForNurse.mockResolvedValue([1]);
      prisma.consultation.findFirst.mockResolvedValue({ id: uuid() });
      prisma.chat.findFirst.mockResolvedValue(null);
      prisma.chat.create.mockResolvedValue(mockChat);

      const result = await service.createChat(patientId, { participantId: nurseId });
      expect(result).toBeDefined();
    });
  });

  // ─────────────────────────── getUserChats ───────────────────────────

  describe('getUserChats', () => {
    it('should return chats with unread count and total', async () => {
      prisma.chat.findMany.mockResolvedValue([mockChat]);
      prisma.chat.count.mockResolvedValue(1);

      const result = await service.getUserChats(patientId);
      expect(result).toHaveProperty('chats');
      expect(result).toHaveProperty('total', 1);
      expect(result.chats).toHaveLength(1);
      expect(result.chats[0]).toHaveProperty('participants');
    });

    it('should return empty list when user has no chats', async () => {
      prisma.chat.findMany.mockResolvedValue([]);
      prisma.chat.count.mockResolvedValue(0);

      const result = await service.getUserChats(patientId);
      expect(result.chats).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ─────────────────────────── getChatById ───────────────────────────

  describe('getChatById', () => {
    it('should return chat when user is a participant', async () => {
      prisma.chat.findUnique.mockResolvedValue(mockChat);

      const result = await service.getChatById(chatId, patientId);
      expect(result).toHaveProperty('participants');
    });

    it('should throw NotFoundException when chat not found', async () => {
      prisma.chat.findUnique.mockResolvedValue(null);

      await expect(
        service.getChatById(uuid(), patientId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user is not a participant', async () => {
      prisma.chat.findUnique.mockResolvedValue(mockChat);

      await expect(
        service.getChatById(chatId, uuid()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─────────────────────────── getUserChatIds ───────────────────────────

  describe('getUserChatIds', () => {
    it('should return array of chat IDs', async () => {
      const ids = [uuid(), uuid()];
      prisma.chatParticipant.findMany.mockResolvedValue(
        ids.map((id) => ({ chatId: id })),
      );

      const result = await service.getUserChatIds(patientId);
      expect(result).toEqual(ids);
    });
  });

  // ─────────────────────────── sendMessage ───────────────────────────

  describe('sendMessage', () => {
    it('should send a text message', async () => {
      prisma.chat.findUnique.mockResolvedValue(mockChat);
      prisma.message.create.mockResolvedValue(mockMessage);
      prisma.chat.update.mockResolvedValue(mockChat);

      const result = await service.sendMessage(chatId, patientId, {
        content: 'Hello doctor',
      });
      expect(result).toBeDefined();
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            chatId,
            senderId: patientId,
            content: 'Hello doctor',
            type: MessageTypeEnum.TEXT,
          }),
        }),
      );
    });

    it('should throw NotFoundException when chat not found', async () => {
      prisma.chat.findUnique.mockResolvedValue(null);

      await expect(
        service.sendMessage(uuid(), patientId, { content: 'hi' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when chat is closed', async () => {
      prisma.chat.findUnique.mockResolvedValue({
        ...mockChat,
        closedAt: new Date(),
      });

      await expect(
        service.sendMessage(chatId, patientId, { content: 'hi' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when user is not a participant', async () => {
      prisma.chat.findUnique.mockResolvedValue(mockChat);

      await expect(
        service.sendMessage(chatId, uuid(), { content: 'hi' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should handle repliedToId correctly', async () => {
      prisma.chat.findUnique.mockResolvedValue(mockChat);
      prisma.message.findUnique.mockResolvedValue({
        id: BigInt(5),
        chatId,
      });
      prisma.message.create.mockResolvedValue({
        ...mockMessage,
        repliedToId: BigInt(5),
      });
      prisma.chat.update.mockResolvedValue(mockChat);

      await service.sendMessage(chatId, patientId, {
        content: 'Reply',
        repliedToId: '5',
      });

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            repliedToId: BigInt(5),
          }),
        }),
      );
    });
  });

  // ─────────────────────────── getMessages ───────────────────────────

  describe('getMessages', () => {
    it('should return paginated messages', async () => {
      prisma.chat.findUnique.mockResolvedValue(mockChat);
      prisma.message.findMany.mockResolvedValue([mockMessage]);
      prisma.message.count.mockResolvedValue(1);

      const result = await service.getMessages(chatId, patientId);
      expect(result.messages).toHaveLength(1);
      expect(result.total).toBe(1);
      // BigInt should be serialized to string
      expect(typeof result.messages[0].id).toBe('string');
    });

    it('should throw if user is not a participant', async () => {
      prisma.chat.findUnique.mockResolvedValue(mockChat);

      await expect(
        service.getMessages(chatId, uuid(), 0, 50),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─────────────────────────── markAsRead ───────────────────────────

  describe('markAsRead', () => {
    it('should mark unread messages as read', async () => {
      prisma.chat.findUnique.mockResolvedValue(mockChat);
      prisma.message.findMany.mockResolvedValue([
        { id: BigInt(1), readBy: [] },
        { id: BigInt(2), readBy: [] },
      ]);
      prisma.message.update.mockResolvedValue({});
      prisma.chatParticipant.update.mockResolvedValue({});

      await service.markAsRead(chatId, doctorId, BigInt(2));

      expect(prisma.message.update).toHaveBeenCalledTimes(2);
      expect(prisma.chatParticipant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chatId_userId: { chatId, userId: doctorId } },
        }),
      );
    });

    it('should skip messages already read by the user', async () => {
      prisma.chat.findUnique.mockResolvedValue(mockChat);
      prisma.message.findMany.mockResolvedValue([
        { id: BigInt(1), readBy: [{ userId: doctorId, readAt: new Date().toISOString() }] },
      ]);
      prisma.message.update.mockResolvedValue({});
      prisma.chatParticipant.update.mockResolvedValue({});

      await service.markAsRead(chatId, doctorId, BigInt(1));

      // message.update should NOT be called because all are already read
      expect(prisma.message.update).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────── editMessage ───────────────────────────

  describe('editMessage', () => {
    it('should edit a text message by the sender', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage);
      prisma.message.update.mockResolvedValue({
        ...mockMessage,
        content: 'Updated content',
        editedAt: new Date(),
      });

      const result = await service.editMessage(
        bigIntId,
        patientId,
        'Updated content',
      );
      expect(result.content).toBe('Updated content');
    });

    it('should throw NotFoundException for non-existent message', async () => {
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(
        service.editMessage(BigInt(999), patientId, 'edit'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not the sender', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage);

      await expect(
        service.editMessage(bigIntId, doctorId, 'sneaky edit'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException for non-TEXT messages', async () => {
      prisma.message.findUnique.mockResolvedValue({
        ...mockMessage,
        type: MessageTypeEnum.IMAGE,
      });

      await expect(
        service.editMessage(bigIntId, patientId, 'edit image?'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────────────────── deleteMessage ───────────────────────────

  describe('deleteMessage', () => {
    it('should soft-delete a message', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage);
      prisma.message.update.mockResolvedValue({
        ...mockMessage,
        deletedAt: new Date(),
        content: '[Message deleted]',
      });

      const result = await service.deleteMessage(bigIntId, patientId);
      expect(result.content).toBe('[Message deleted]');
      expect(result.deletedAt).toBeDefined();
    });

    it('should throw NotFoundException for deleted or non-existent message', async () => {
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteMessage(BigInt(999), patientId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not the sender', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage);

      await expect(
        service.deleteMessage(bigIntId, doctorId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─────────────────────────── Presence ───────────────────────────

  describe('presence tracking', () => {
    const userId = uuid();
    const socketA = `socket-${uuid().slice(0, 8)}`;
    const socketB = `socket-${uuid().slice(0, 8)}`;

    it('should track user as online after setOnline', () => {
      service.setOnline(userId, socketA);
      expect(service.isOnline(userId)).toBe(true);
    });

    it('should track multiple sockets per user', () => {
      service.setOnline(userId, socketA);
      service.setOnline(userId, socketB);
      expect(service.getSocketIds(userId)).toContain(socketA);
      expect(service.getSocketIds(userId)).toContain(socketB);
    });

    it('should remain online if one socket disconnects', () => {
      service.setOnline(userId, socketA);
      service.setOnline(userId, socketB);
      service.setOffline(userId, socketA);
      expect(service.isOnline(userId)).toBe(true);
      expect(service.getSocketIds(userId)).toEqual([socketB]);
    });

    it('should go offline when all sockets disconnect', () => {
      service.setOnline(userId, socketA);
      service.setOffline(userId, socketA);
      expect(service.isOnline(userId)).toBe(false);
      expect(service.getSocketIds(userId)).toEqual([]);
    });

    it('should return false for unknown user', () => {
      expect(service.isOnline(uuid())).toBe(false);
    });
  });

  // ─────────────────────────── serializeMessage ───────────────────────────

  describe('serializeMessage', () => {
    it('should convert BigInt id to string', () => {
      const serialized = service.serializeMessage(mockMessage);
      expect(typeof serialized.id).toBe('string');
      expect(serialized.id).toBe('1');
    });

    it('should handle repliedTo with BigInt id', () => {
      const msgWithReply = {
        ...mockMessage,
        repliedToId: BigInt(5),
        repliedTo: { id: BigInt(5), content: 'Original', senderId: doctorId, type: MessageTypeEnum.TEXT },
      };
      const serialized = service.serializeMessage(msgWithReply);
      expect(serialized.repliedToId).toBe('5');
      expect(serialized.repliedTo.id).toBe('5');
    });

    it('should handle null repliedTo', () => {
      const serialized = service.serializeMessage(mockMessage);
      expect(serialized.repliedTo).toBeNull();
      expect(serialized.repliedToId).toBeNull();
    });
  });
});
