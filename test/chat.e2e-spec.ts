/**
 * Chat E2E Tests (REST endpoints only — socket.io-client not installed)
 *
 * Tests:
 *   POST /chat          — create/reopen chat (happy, existing, self-chat, patient-patient, unauth, not-found)
 *   POST /chat          — who may start a chat (doctor→patient relationship, doctor→nurse, nurse→assigned
 *                         doctor, nurse reopening a doctor's chat, blocked pairs, admin exemption)
 *   GET  /chat          — list user chats (happy, unauth)
 *   GET  /chat/:id      — get single chat (happy, non-participant, not-found)
 *   GET  /chat/:id/messages  — get paginated messages (happy, non-participant)
 *   POST /chat/:id/message   — send message HTTP fallback (happy, closed chat, non-participant;
 *                              broadcast to the room + offline notification, none when refused)
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ChatModule } from '../src/chat/chat.module';
import { ChatGateway } from '../src/chat/chat.gateway';
import { NotificationService } from '../src/notification/notification.service';
import { AuthModule } from '../src/auth/auth.module';
import { UserModule } from '../src/user/user.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { UtilsModule } from '../src/utils/utils.module';
import { ExceptionTemplateFilter } from '../src/common/filters/exception-template.filter';
import { ResponseTemplateInterceptor } from '../src/common/interceptors/response-template.interceptor';
import {
  createMockPrismaService,
  MockPrismaService,
} from './helpers/mock-prisma.helper';
import {
  createMockUser,
  createMockDoctorUser,
  createMockNurseUser,
  createMockAdminUser,
  MockUser,
} from './helpers/mock-session.helper';
import { randomUuid } from './helpers/test-data.factory';
import { flushPromises } from './helpers/ws-handshake.helper';
import { UserRolesEnum, MessageTypeEnum } from '@prisma/client';
import authConfigs from '../src/configs/auth';
import generalConfigs from '../src/configs/general';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ load: [authConfigs, generalConfigs] }),
    CacheModule,
    UtilsModule,
    AuthModule,
    UserModule,
    ChatModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

describe('Chat (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  // Stable test users — created once, reused across all tests
  const patientUser = createMockUser();
  const doctorUser = createMockDoctorUser();

  // Reusable chat & message builders
  const buildChatData = (overrides: Record<string, any> = {}) => {
    const chatId = overrides.id ?? randomUuid();
    const now = new Date();
    return {
      id: chatId,
      topic: null as null,
      consultationId: null as null,
      closedAt: null as null,
      createdAt: now,
      updatedAt: now,
      parties: [
        {
          userId: patientUser.id,
          joinedAt: now,
          lastSeenAt: null as null,
          user: {
            id: patientUser.id,
            firstname: patientUser.firstname,
            lastname: patientUser.lastname,
            avatar: null as null,
            role: UserRolesEnum.PATIENT,
            isAdmin: false,
            isSuperAdmin: false,
          },
        },
        {
          userId: doctorUser.id,
          joinedAt: now,
          lastSeenAt: null as null,
          user: {
            id: doctorUser.id,
            firstname: doctorUser.firstname,
            lastname: doctorUser.lastname,
            avatar: null as null,
            role: UserRolesEnum.DOCTOR,
            isAdmin: false,
            isSuperAdmin: false,
          },
        },
      ],
      messages: [] as any[],
      ...overrides,
    };
  };

  const buildMessageData = (
    chatId: string,
    overrides: Record<string, any> = {},
  ) => {
    const now = new Date();
    return {
      id: BigInt(1),
      chatId,
      senderId: patientUser.id,
      content: 'Hello doctor',
      type: MessageTypeEnum.TEXT,
      fileUrl: null as null,
      readBy: null as null,
      editedAt: null as null,
      deletedAt: null as null,
      repliedToId: null as null,
      repliedTo: null as null,
      createdAt: now,
      updatedAt: now,
      sender: {
        id: patientUser.id,
        firstname: patientUser.firstname,
        lastname: patientUser.lastname,
        avatar: null as null,
        role: UserRolesEnum.PATIENT,
        isAdmin: false,
        isSuperAdmin: false,
      },
      ...overrides,
    };
  };

  beforeAll(async () => {
    prisma = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(NotificationService)
      .useValue({ onNewChatMessage: jest.fn().mockResolvedValue(undefined) })
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalFilters(new ExceptionTemplateFilter());
    app.useGlobalInterceptors(new ResponseTemplateInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidUnknownValues: true,
        transform: true,
      }),
    );

    // Add session simulation hook BEFORE app.init()
    const instance = app.getHttpAdapter().getInstance();
    instance.addHook('preHandler', (request: any, _reply: any, done: any) => {
      request.session = {
        get: (key: string) => {
          if (key === 'user') return sessionUser;
          return sessionStore[key];
        },
        set: (key: string, value: any) => {
          if (key === 'user') sessionUser = value;
          sessionStore[key] = value;
        },
        delete: () => {
          sessionUser = null;
          sessionStore = {};
        },
      };
      done();
    });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sessionUser = null;
    sessionStore = {};
  });

  // ─── POST /chat (create chat) ───

  describe('POST /chat', () => {
    it('should create a chat between patient and doctor', async () => {
      sessionUser = patientUser;
      const mockChat = buildChatData();

      // findUnique for initiator and participant (Promise.all order)
      prisma.user.findUnique
        .mockResolvedValueOnce({ ...patientUser }) // initiator
        .mockResolvedValueOnce({ ...doctorUser }); // participant
      // No existing chat
      prisma.chat.findFirst.mockResolvedValue(null);
      // Create returns the new chat
      prisma.chat.create.mockResolvedValue(mockChat);

      const res = await app.inject({
        method: 'POST',
        url: '/chat',
        payload: { participantId: doctorUser.id },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(mockChat.id);
      expect(body.contents.participants).toHaveLength(2);
    });

    it("should put both participants' open sockets in the new chat's room", async () => {
      sessionUser = patientUser;
      const mockChat = buildChatData();
      prisma.user.findUnique
        .mockResolvedValueOnce({ ...patientUser })
        .mockResolvedValueOnce({ ...doctorUser });
      prisma.chat.findFirst.mockResolvedValue(null);
      prisma.chat.create.mockResolvedValue(mockChat);
      const join = jest.spyOn(app.get(ChatGateway), 'addUserToRoom');

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/chat',
          payload: { participantId: doctorUser.id },
        });

        expect(res.statusCode).toBe(HttpStatus.CREATED);
        expect(join).toHaveBeenCalledTimes(2);
        expect(join).toHaveBeenCalledWith(patientUser.id, mockChat.id);
        expect(join).toHaveBeenCalledWith(doctorUser.id, mockChat.id);
      } finally {
        join.mockRestore();
      }
    });

    it('should return existing chat if one already exists', async () => {
      sessionUser = patientUser;
      const existingChat = buildChatData();

      prisma.user.findUnique
        .mockResolvedValueOnce({ ...patientUser })
        .mockResolvedValueOnce({ ...doctorUser });
      prisma.chat.findFirst.mockResolvedValue(existingChat);

      const res = await app.inject({
        method: 'POST',
        url: '/chat',
        payload: { participantId: doctorUser.id },
      });

      // Controller uses @Post() so the status is always 201
      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(existingChat.id);
      // chat.create should NOT have been called
      expect(prisma.chat.create).not.toHaveBeenCalled();
    });

    it('should reject self-chat', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/chat',
        payload: { participantId: patientUser.id },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject patient-to-patient chat', async () => {
      const otherPatient = createMockUser();
      sessionUser = patientUser;

      prisma.user.findUnique
        .mockResolvedValueOnce({ ...patientUser })
        .mockResolvedValueOnce({ ...otherPatient });
      prisma.chat.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/chat',
        payload: { participantId: otherPatient.id },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/chat',
        payload: { participantId: doctorUser.id },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 404 when participant not found', async () => {
      sessionUser = patientUser;
      const fakeId = randomUuid();

      prisma.user.findUnique
        .mockResolvedValueOnce({ ...patientUser }) // initiator
        .mockResolvedValueOnce(null); // participant not found

      const res = await app.inject({
        method: 'POST',
        url: '/chat',
        payload: { participantId: fakeId },
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should reject invalid participantId (not UUID)', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/chat',
        payload: { participantId: 'not-a-uuid' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject missing participantId', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/chat',
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── POST /chat — who may start a chat ───

  describe('POST /chat — who may start a chat', () => {
    const randomId = () => 1 + Math.floor(Math.random() * 100_000);

    beforeEach(() => {
      for (const mock of [
        prisma.user.findUnique,
        prisma.chat.findFirst,
        prisma.chat.create,
        prisma.doctorProfile.findUnique,
        prisma.consultation.findFirst,
        prisma.appointment.findFirst,
        prisma.doctorNurseAssignment.findFirst,
        prisma.doctorNurseAssignment.findMany,
      ]) {
        mock.mockReset();
      }
      prisma.chat.findFirst.mockResolvedValue(null);
      prisma.chat.create.mockResolvedValue(buildChatData());
    });

    const startChat = async (initiator: MockUser, participant: MockUser) => {
      sessionUser = initiator;
      prisma.user.findUnique
        .mockResolvedValueOnce({ ...initiator })
        .mockResolvedValueOnce({ ...participant });
      return app.inject({
        method: 'POST',
        url: '/chat',
        payload: { participantId: participant.id },
      });
    };

    it('should let a doctor start a chat with their own patient', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({ id: randomId() });
      prisma.consultation.findFirst.mockResolvedValue({ id: randomUuid() });

      const res = await startChat(createMockDoctorUser(), createMockUser());

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      expect(prisma.chat.create).toHaveBeenCalled();
    });

    it('should let a doctor start a chat with a patient they only have an appointment with', async () => {
      const doctorProfileId = randomId();
      const patient = createMockUser();
      prisma.doctorProfile.findUnique.mockResolvedValue({ id: doctorProfileId });
      prisma.consultation.findFirst.mockResolvedValue(null);
      prisma.appointment.findFirst.mockResolvedValue({ id: randomUuid() });

      const res = await startChat(createMockDoctorUser(), patient);

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
        where: { patientId: patient.id, doctorId: { in: [doctorProfileId] } },
        select: { id: true },
      });
      expect(prisma.chat.create).toHaveBeenCalled();
    });

    it('should return 403 when a doctor starts a chat with an unrelated patient', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({ id: randomId() });
      prisma.consultation.findFirst.mockResolvedValue(null);
      prisma.appointment.findFirst.mockResolvedValue(null);

      const res = await startChat(createMockDoctorUser(), createMockUser());

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
      expect(JSON.parse(res.body).message).toContain('your own patients');
      expect(prisma.chat.create).not.toHaveBeenCalled();
    });

    it('should let a verified doctor start a chat with any nurse', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({ verified: true });

      const res = await startChat(createMockDoctorUser(), createMockNurseUser());

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      expect(prisma.chat.create).toHaveBeenCalled();
    });

    it.each([
      ['an unverified profile', { verified: false }],
      ['no profile', null],
    ])('should return 403 when a doctor with %s starts a chat with a nurse', async (_case, profile) => {
      prisma.doctorProfile.findUnique.mockResolvedValue(profile);

      const res = await startChat(createMockDoctorUser(), createMockNurseUser());

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
      expect(JSON.parse(res.body).message).toBe('Only verified doctors can start chats with nurses');
      expect(prisma.chat.create).not.toHaveBeenCalled();
    });

    it('should let a nurse start a chat with their assigned doctor', async () => {
      prisma.doctorNurseAssignment.findFirst.mockResolvedValue({ id: randomId() });

      const res = await startChat(createMockNurseUser(), createMockDoctorUser());

      expect(res.statusCode).toBe(HttpStatus.CREATED);
    });

    it('should return 403 when a nurse starts a chat with an unassigned doctor', async () => {
      prisma.doctorNurseAssignment.findFirst.mockResolvedValue(null);

      const res = await startChat(createMockNurseUser(), createMockDoctorUser());

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
      expect(prisma.chat.create).not.toHaveBeenCalled();
    });

    it('should let a nurse reopen a chat an unassigned doctor started', async () => {
      const existing = buildChatData();
      prisma.chat.findFirst.mockResolvedValue(existing);

      const res = await startChat(createMockNurseUser(), createMockDoctorUser());

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      expect(JSON.parse(res.body).contents.id).toBe(existing.id);
      expect(prisma.doctorNurseAssignment.findFirst).not.toHaveBeenCalled();
      expect(prisma.chat.create).not.toHaveBeenCalled();
    });

    it.each([
      ['doctor', 'doctor', createMockDoctorUser, createMockDoctorUser],
      ['nurse', 'nurse', createMockNurseUser, createMockNurseUser],
      ['doctor', 'site admin', createMockDoctorUser, createMockAdminUser],
      ['role-less user', 'doctor', () => createMockUser({ role: UserRolesEnum.NONE }), createMockDoctorUser],
    ])('should return 403 when a %s starts a chat with a %s', async (_from, _to, makeFrom, makeTo) => {
      const res = await startChat(makeFrom(), makeTo());

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
      expect(prisma.chat.create).not.toHaveBeenCalled();
    });

    it('should let an admin start a chat with a doctor', async () => {
      const res = await startChat(createMockAdminUser(), createMockDoctorUser());

      expect(res.statusCode).toBe(HttpStatus.CREATED);
    });
  });

  // ─── GET /chat (list user chats) ───

  describe('GET /chat', () => {
    it('should return paginated chats for the current user', async () => {
      sessionUser = patientUser;
      const chatId = randomUuid();
      const mockChats = [
        buildChatData({ id: chatId }),
      ];

      prisma.chat.findMany.mockResolvedValue(mockChats);
      prisma.chat.count.mockResolvedValue(1);

      const res = await app.inject({
        method: 'GET',
        url: '/chat',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.chats).toBeDefined();
      expect(body.contents.total).toBe(1);
    });

    it('should return empty list when user has no chats', async () => {
      sessionUser = patientUser;

      prisma.chat.findMany.mockResolvedValue([]);
      prisma.chat.count.mockResolvedValue(0);

      const res = await app.inject({
        method: 'GET',
        url: '/chat',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.chats).toEqual([]);
      expect(body.contents.total).toBe(0);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/chat',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /chat/:id (get single chat) ───

  describe('GET /chat/:id', () => {
    it('should return chat for a participant', async () => {
      sessionUser = patientUser;
      const chatId = randomUuid();
      const mockChat = buildChatData({ id: chatId });

      prisma.chat.findUnique.mockResolvedValue(mockChat);

      const res = await app.inject({
        method: 'GET',
        url: `/chat/${chatId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(chatId);
      expect(body.contents.participants).toBeDefined();
    });

    it('should reject non-participant', async () => {
      const outsider = createMockUser();
      sessionUser = outsider;
      const chatId = randomUuid();
      // Chat parties do not include outsider
      const mockChat = buildChatData({ id: chatId });

      prisma.chat.findUnique.mockResolvedValue(mockChat);

      const res = await app.inject({
        method: 'GET',
        url: `/chat/${chatId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 404 for non-existent chat', async () => {
      sessionUser = patientUser;
      const fakeId = randomUuid();

      prisma.chat.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `/chat/${fakeId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should reject invalid chat ID (not UUID)', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/chat/not-a-uuid',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /chat/:id/messages ───

  describe('GET /chat/:id/messages', () => {
    it('should return paginated messages for a participant', async () => {
      sessionUser = patientUser;
      const chatId = randomUuid();
      const mockChat = buildChatData({ id: chatId });
      const mockMessages = [
        buildMessageData(chatId),
        buildMessageData(chatId, { id: BigInt(2), content: 'Follow-up' }),
      ];

      prisma.chat.findUnique.mockResolvedValue(mockChat);
      prisma.message.findMany.mockResolvedValue(mockMessages);
      prisma.message.count.mockResolvedValue(2);

      const res = await app.inject({
        method: 'GET',
        url: `/chat/${chatId}/messages`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.messages).toBeDefined();
      expect(body.contents.messages).toHaveLength(2);
      expect(body.contents.total).toBe(2);
      // BigInt id should be serialized as string
      expect(typeof body.contents.messages[0].id).toBe('string');
    });

    it('should reject non-participant', async () => {
      const outsider = createMockUser();
      sessionUser = outsider;
      const chatId = randomUuid();
      const mockChat = buildChatData({ id: chatId });

      prisma.chat.findUnique.mockResolvedValue(mockChat);

      const res = await app.inject({
        method: 'GET',
        url: `/chat/${chatId}/messages`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 404 for non-existent chat', async () => {
      sessionUser = patientUser;
      const fakeId = randomUuid();

      prisma.chat.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `/chat/${fakeId}/messages`,
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─── POST /chat/:id/message (send message — HTTP fallback) ───

  describe('POST /chat/:id/message', () => {
    it('should refuse a SYSTEM message from a user (400), saving nothing', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: `/chat/${randomUuid()}/message`,
        payload: { content: 'The doctor has left the chat.', type: 'SYSTEM' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('should send a text message successfully', async () => {
      sessionUser = patientUser;
      const chatId = randomUuid();
      const mockChat = buildChatData({ id: chatId });
      const mockMessage = buildMessageData(chatId, {
        content: 'Hello doctor!',
      });

      prisma.chat.findUnique.mockResolvedValue(mockChat);
      prisma.user.findUnique.mockResolvedValue({ isActive: true, isBanned: false });
      prisma.message.create.mockResolvedValue(mockMessage);
      prisma.chat.update.mockResolvedValue({ ...mockChat, updatedAt: new Date() });

      const res = await app.inject({
        method: 'POST',
        url: `/chat/${chatId}/message`,
        payload: { content: 'Hello doctor!' },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      // BigInt id serialized to string
      expect(typeof body.contents.id).toBe('string');
      expect(body.contents.content).toBe('Hello doctor!');
      expect(body.contents.senderId).toBe(patientUser.id);
    });

    it('should push the message to the chat room and notify the offline participant, like a WebSocket send', async () => {
      sessionUser = patientUser;
      const chatId = randomUuid();
      const content = `Over HTTP ${randomUuid()}`;
      const mockMessage = buildMessageData(chatId, { content });
      prisma.chat.findUnique.mockResolvedValue(buildChatData({ id: chatId }));
      prisma.user.findUnique.mockResolvedValue({ isActive: true, isBanned: false });
      prisma.message.create.mockResolvedValue(mockMessage);
      prisma.chat.update.mockResolvedValue({});
      prisma.chatParticipant.findMany.mockResolvedValue([
        { userId: patientUser.id },
        { userId: doctorUser.id },
      ]);
      const gateway = app.get(ChatGateway);
      const roomEmit = jest.fn();
      const to = jest
        .spyOn(gateway.server, 'to')
        .mockReturnValue({ emit: roomEmit } as any);
      const notifications = app.get(NotificationService) as unknown as {
        onNewChatMessage: jest.Mock;
      };

      try {
        const res = await app.inject({
          method: 'POST',
          url: `/chat/${chatId}/message`,
          payload: { content },
        });

        expect(res.statusCode).toBe(HttpStatus.CREATED);
        expect(to).toHaveBeenCalledWith(`chat:${chatId}`);
        expect(roomEmit).toHaveBeenCalledWith('chat:message', {
          message: expect.objectContaining({
            id: mockMessage.id.toString(),
            chatId,
            content,
            senderId: patientUser.id,
          }),
        });
        // Nobody is connected, so nobody has the chat open.
        await flushPromises();
        expect(notifications.onNewChatMessage).toHaveBeenCalledWith(
          chatId,
          patientUser.id,
          doctorUser.id,
          `${patientUser.firstname} ${patientUser.lastname}`,
        );
        expect(notifications.onNewChatMessage).toHaveBeenCalledTimes(1);
      } finally {
        to.mockRestore();
      }
    });

    it('should still return 201 for the saved message when the room broadcast fails', async () => {
      sessionUser = patientUser;
      const chatId = randomUuid();
      const mockMessage = buildMessageData(chatId, { content: `Saved ${randomUuid()}` });
      prisma.chat.findUnique.mockResolvedValue(buildChatData({ id: chatId }));
      prisma.user.findUnique.mockResolvedValue({ isActive: true, isBanned: false });
      prisma.message.create.mockResolvedValue(mockMessage);
      prisma.chat.update.mockResolvedValue({});
      prisma.chatParticipant.findMany.mockResolvedValue([]);
      const to = jest.spyOn(app.get(ChatGateway).server, 'to').mockImplementation(() => {
        throw new Error('adapter down');
      });

      try {
        const res = await app.inject({
          method: 'POST',
          url: `/chat/${chatId}/message`,
          payload: { content: mockMessage.content },
        });

        expect(res.statusCode).toBe(HttpStatus.CREATED);
        expect(JSON.parse(res.body).contents.content).toBe(mockMessage.content);
        expect(prisma.message.create).toHaveBeenCalledTimes(1);
      } finally {
        to.mockRestore();
      }
    });

    it('should neither broadcast nor notify when the send is refused', async () => {
      sessionUser = createMockUser();
      const chatId = randomUuid();
      prisma.chat.findUnique.mockResolvedValue(buildChatData({ id: chatId }));
      const to = jest.spyOn(app.get(ChatGateway).server, 'to');
      const notifications = app.get(NotificationService) as unknown as {
        onNewChatMessage: jest.Mock;
      };

      try {
        const res = await app.inject({
          method: 'POST',
          url: `/chat/${chatId}/message`,
          payload: { content: 'Not my chat' },
        });

        expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
        expect(to).not.toHaveBeenCalled();
        expect(notifications.onNewChatMessage).not.toHaveBeenCalled();
      } finally {
        to.mockRestore();
      }
    });

    it('should reject when chat is closed', async () => {
      sessionUser = patientUser;
      const chatId = randomUuid();
      const closedChat = buildChatData({
        id: chatId,
        closedAt: new Date(),
      });

      prisma.chat.findUnique.mockResolvedValue(closedChat);

      const res = await app.inject({
        method: 'POST',
        url: `/chat/${chatId}/message`,
        payload: { content: 'This should fail' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject non-participant', async () => {
      const outsider = createMockUser();
      sessionUser = outsider;
      const chatId = randomUuid();
      const mockChat = buildChatData({ id: chatId });

      prisma.chat.findUnique.mockResolvedValue(mockChat);

      const res = await app.inject({
        method: 'POST',
        url: `/chat/${chatId}/message`,
        payload: { content: 'Intruder message' },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject missing content', async () => {
      sessionUser = patientUser;
      const chatId = randomUuid();

      const res = await app.inject({
        method: 'POST',
        url: `/chat/${chatId}/message`,
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;
      const chatId = randomUuid();

      const res = await app.inject({
        method: 'POST',
        url: `/chat/${chatId}/message`,
        payload: { content: 'Hello' },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 404 for non-existent chat', async () => {
      sessionUser = patientUser;
      const fakeId = randomUuid();

      prisma.chat.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: `/chat/${fakeId}/message`,
        payload: { content: 'Hello' },
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });
  });
});
