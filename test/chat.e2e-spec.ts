/**
 * Chat E2E Tests (REST endpoints only — socket.io-client not installed)
 *
 * Tests:
 *   POST /chat          — create/reopen chat (happy, existing, self-chat, patient-patient, unauth, not-found)
 *   GET  /chat          — list user chats (happy, unauth)
 *   GET  /chat/:id      — get single chat (happy, non-participant, not-found)
 *   GET  /chat/:id/messages  — get paginated messages (happy, non-participant)
 *   POST /chat/:id/message   — send message HTTP fallback (happy, closed chat, non-participant)
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
  MockUser,
} from './helpers/mock-session.helper';
import { randomUuid } from './helpers/test-data.factory';
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
      expect(body.contents.parties).toHaveLength(2);
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
    it('should send a text message successfully', async () => {
      sessionUser = patientUser;
      const chatId = randomUuid();
      const mockChat = buildChatData({ id: chatId });
      const mockMessage = buildMessageData(chatId, {
        content: 'Hello doctor!',
      });

      prisma.chat.findUnique.mockResolvedValue(mockChat);
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
