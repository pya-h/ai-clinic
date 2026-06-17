import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { HttpStatus, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AiAgentsModule } from '../src/ai-agents/ai-agents.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { ExceptionTemplateFilter } from '../src/common/filters/exception-template.filter';
import { ResponseTemplateInterceptor } from '../src/common/interceptors/response-template.interceptor';
import {
  createMockPrismaService,
  MockPrismaService,
} from './helpers/mock-prisma.helper';
import { createMockUser, MockUser } from './helpers/mock-session.helper';
import {
  randomUuid,
  buildAiConversation,
} from './helpers/test-data.factory';
import aiConfigs from '../src/configs/ai';
import generalConfigs from '../src/configs/general';

jest.mock('@botpress/chat', () => {
  const client: Record<string, any> = {
    user: { id: 'bp-user-id', key: 'bp-user-key' },
    createMessage: jest.fn().mockResolvedValue({}),
    getConversation: jest.fn().mockResolvedValue({ id: 'any' }),
    createConversation: jest.fn(),
    listMessages: jest.fn().mockResolvedValue({ messages: [] }),
    listenConversation: jest.fn(),
  };
  return {
    __esModule: true,
    _mockClient: client,
    Client: class MockClient {
      webhookId: string;
      constructor(opts?: any) {
        this.webhookId = opts?.webhookId;
      }
      static connect = jest.fn().mockResolvedValue(client);
      getUser = jest.fn().mockResolvedValue({
        user: { id: 'bp-user-id', key: 'bp-user-key' },
      });
    },
    AuthenticatedClient: jest.fn().mockImplementation(() => client),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { _mockClient: bpClient } = require('@botpress/chat');

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      load: [generalConfigs, aiConfigs],
      envFilePath: '.env.test',
      isGlobal: true,
    }),
    CacheModule,
    AiAgentsModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

describe('AI Agents (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;

  beforeAll(async () => {
    process.env.BOTAGENT_KEY = `test-webhook-${randomUuid()}`;

    prisma = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );

    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new ExceptionTemplateFilter());
    app.useGlobalInterceptors(new ResponseTemplateInterceptor());

    const instance = app.getHttpAdapter().getInstance();
    instance.addHook('preHandler', (request: any, _reply: any, done: any) => {
      if (sessionUser) {
        request.session = {
          get: (key: string) => (key === 'user' ? sessionUser : undefined),
          set: jest.fn(),
          delete: jest.fn(),
        };
      } else {
        request.session = {
          get: () => undefined,
          set: jest.fn(),
          delete: jest.fn(),
        };
      }
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

    bpClient.createMessage.mockResolvedValue({});
    bpClient.getConversation.mockResolvedValue({ id: 'any' });
    bpClient.listMessages.mockResolvedValue({ messages: [] });
    prisma.user.update.mockResolvedValue({});
  });

  // ─── POST /ai-agents/start ───

  describe('POST /ai-agents/start', () => {
    it('should start conversation for authenticated user', async () => {
      sessionUser = createMockUser();
      const convo = buildAiConversation({ userId: sessionUser.id });

      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      prisma.aiConversation.findFirst.mockResolvedValue(null);
      const bpId = randomUuid();
      bpClient.createConversation.mockResolvedValue({
        conversation: { id: bpId },
      });
      prisma.aiConversation.create.mockResolvedValue({
        ...convo,
        id: bpId,
      });
      prisma.user.update.mockResolvedValue({});

      const res = await app.inject({
        method: 'POST',
        url: '/ai-agents/start',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toHaveProperty('id');
    });

    it('should start guest conversation when not authenticated', async () => {
      sessionUser = null;
      const guestBpId = randomUuid();

      bpClient.createConversation.mockResolvedValue({
        conversation: { id: guestBpId },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/ai-agents/start',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.guest).toBe(true);
      expect(body.contents.id).toBeDefined();
    });
  });

  // ─── POST /ai-agents/message ───

  describe('POST /ai-agents/message', () => {
    it('should send message for authenticated user', async () => {
      sessionUser = createMockUser();
      const convo = buildAiConversation({ userId: sessionUser.id });

      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      prisma.aiConversation.findFirst.mockResolvedValue(convo);
      prisma.aiConversation.findUnique.mockResolvedValue(convo);
      bpClient.getConversation.mockResolvedValue({ id: convo.id });

      const res = await app.inject({
        method: 'POST',
        url: '/ai-agents/message',
        payload: { conversationId: convo.id, text: 'hello' },
      });

      expect(res.statusCode).toBe(HttpStatus.NO_CONTENT);
    });

    it('should reject missing text', async () => {
      sessionUser = createMockUser();

      const res = await app.inject({
        method: 'POST',
        url: '/ai-agents/message',
        payload: { conversationId: randomUuid() },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject empty text', async () => {
      sessionUser = createMockUser();

      const res = await app.inject({
        method: 'POST',
        url: '/ai-agents/message',
        payload: { conversationId: randomUuid(), text: '' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject guest message without conversationId', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/ai-agents/message',
        payload: { text: 'hello guest' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /ai-agents/messages/:conversationId ───

  describe('GET /ai-agents/messages/:conversationId', () => {
    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: `/ai-agents/messages/${randomUuid()}`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return messages for authenticated user', async () => {
      sessionUser = createMockUser();
      const convoId = randomUuid();
      const messages = [
        {
          id: randomUuid(),
          userId: 'bot',
          payload: { text: 'hello' },
          createdAt: new Date().toISOString(),
        },
      ];

      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.listMessages.mockResolvedValue({ messages });
      prisma.user.update.mockResolvedValue({});

      const res = await app.inject({
        method: 'GET',
        url: `/ai-agents/messages/${convoId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeInstanceOf(Array);
    });

    it('should pass dateOffset query param to service', async () => {
      sessionUser = createMockUser();
      const convoId = randomUuid();

      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.listMessages.mockResolvedValue({ messages: [] });
      prisma.user.update.mockResolvedValue({});

      const res = await app.inject({
        method: 'GET',
        url: `/ai-agents/messages/${convoId}?dateOffset=2026-01-01T00:00:00Z`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });
  });

  // ─── GET /ai-agents/guest/messages/:conversationId ───

  describe('GET /ai-agents/guest/messages/:conversationId', () => {
    it('should return 404 for unknown guest conversation', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/ai-agents/guest/messages/${randomUuid()}`,
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should return messages for valid guest conversation', async () => {
      const guestBpId = randomUuid();
      bpClient.createConversation.mockResolvedValue({
        conversation: { id: guestBpId },
      });

      const startRes = await app.inject({
        method: 'POST',
        url: '/ai-agents/start',
      });

      const guestConvoId = JSON.parse(startRes.body).contents.id;

      bpClient.listMessages.mockResolvedValue({ messages: [] });

      const res = await app.inject({
        method: 'GET',
        url: `/ai-agents/guest/messages/${guestConvoId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeInstanceOf(Array);
    });
  });

  // ─── GET /ai-agents/history/:conversationId ───

  describe('GET /ai-agents/history/:conversationId', () => {
    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: `/ai-agents/history/${randomUuid()}`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return empty array for non-owned conversation', async () => {
      sessionUser = createMockUser();
      prisma.aiConversation.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `/ai-agents/history/${randomUuid()}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toEqual([]);
    });

    it('should return conversation history for owned conversation', async () => {
      sessionUser = createMockUser();
      const convoId = randomUuid();
      const convo = buildAiConversation({
        id: convoId,
        userId: sessionUser.id,
      });

      prisma.aiConversation.findFirst.mockResolvedValue(convo);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      prisma.user.update.mockResolvedValue({});

      const now = new Date().toISOString();
      bpClient.listMessages.mockResolvedValue({
        messages: [
          {
            id: randomUuid(),
            userId: bpClient.user.id,
            createdAt: now,
            payload: { text: 'user msg' },
          },
          {
            id: randomUuid(),
            userId: 'bot-id',
            createdAt: now,
            payload: { text: 'bot reply' },
          },
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: `/ai-agents/history/${convoId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toHaveLength(2);
      expect(body.contents.map((m: any) => m.role)).toContain('user');
      expect(body.contents.map((m: any) => m.role)).toContain('bot');
    });
  });

  // ─── GET /ai-agents/conversations ───

  describe('GET /ai-agents/conversations', () => {
    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/ai-agents/conversations',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return paginated conversations', async () => {
      sessionUser = createMockUser();
      const convos = [
        buildAiConversation({ userId: sessionUser.id }),
        buildAiConversation({ userId: sessionUser.id }),
      ];

      prisma.aiConversation.findMany.mockResolvedValue(convos);
      prisma.aiConversation.count.mockResolvedValue(2);

      const res = await app.inject({
        method: 'GET',
        url: '/ai-agents/conversations',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.data).toHaveLength(2);
      expect(body.contents.total).toBe(2);
    });

    it('should accept skip and take query params', async () => {
      sessionUser = createMockUser();

      prisma.aiConversation.findMany.mockResolvedValue([]);
      prisma.aiConversation.count.mockResolvedValue(100);

      const res = await app.inject({
        method: 'GET',
        url: '/ai-agents/conversations?skip=20&take=5',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.skip).toBe(20);
      expect(body.contents.take).toBe(5);
    });
  });

  // ─── POST /ai-agents/start/new ───

  describe('POST /ai-agents/start/new', () => {
    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/ai-agents/start/new',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should create new conversation for authenticated user', async () => {
      sessionUser = createMockUser();
      const bpId = randomUuid();
      const convo = buildAiConversation({ id: bpId, userId: sessionUser.id });

      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.createConversation.mockResolvedValue({
        conversation: { id: bpId },
      });
      prisma.aiConversation.create.mockResolvedValue(convo);
      prisma.user.update.mockResolvedValue({});

      const res = await app.inject({
        method: 'POST',
        url: '/ai-agents/start/new',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toHaveProperty('id', bpId);
    });
  });

  // ─── POST /ai-agents/start/:conversationId ───

  describe('POST /ai-agents/start/:conversationId', () => {
    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: `/ai-agents/start/${randomUuid()}`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 404 for non-owned conversation', async () => {
      sessionUser = createMockUser();
      prisma.aiConversation.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: `/ai-agents/start/${randomUuid()}`,
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should resume owned conversation', async () => {
      sessionUser = createMockUser();
      const convoId = randomUuid();
      const convo = buildAiConversation({
        id: convoId,
        userId: sessionUser.id,
      });

      prisma.aiConversation.findFirst.mockResolvedValue(convo);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.getConversation.mockResolvedValue({ id: convoId });
      prisma.user.update.mockResolvedValue({});

      const res = await app.inject({
        method: 'POST',
        url: `/ai-agents/start/${convoId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toHaveProperty('id', convoId);
    });
  });
});
