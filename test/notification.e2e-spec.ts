import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationModule } from '../src/notification/notification.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { UtilsModule } from '../src/utils/utils.module';
import { AuthModule } from '../src/auth/auth.module';
import { UserModule } from '../src/user/user.module';
import { EmailChannel } from '../src/notification/channels/email.channel';
import { WebPushChannel } from '../src/notification/channels/web-push.channel';
import { ExceptionTemplateFilter } from '../src/common/filters/exception-template.filter';
import { ResponseTemplateInterceptor } from '../src/common/interceptors/response-template.interceptor';
import {
  createMockPrismaService,
  MockPrismaService,
} from './helpers/mock-prisma.helper';
import { createMockUser, MockUser } from './helpers/mock-session.helper';
import { NotificationTypeEnum } from '@prisma/client';
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
    NotificationModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

describe('Notification (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  const testUser = createMockUser();

  const buildNotification = (overrides: Record<string, any> = {}) => ({
    id: 1,
    userId: testUser.id,
    type: NotificationTypeEnum.CONSULTATION_REQUEST,
    title: 'Consultation updated',
    body: 'Your consultation status changed',
    isRead: false,
    metadata: null as null,
    createdAt: new Date(),
    ...overrides,
  });

  beforeAll(async () => {
    prisma = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(EmailChannel)
      .useValue({ send: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(WebPushChannel)
      .useValue({ send: jest.fn().mockResolvedValue(undefined) })
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
    prisma.$transaction.mockImplementation((args: any) => Promise.all(args));
  });

  // ─── GET /notification ───

  describe('GET /notification', () => {
    it('should return paginated notifications', async () => {
      sessionUser = testUser;
      prisma.notification.findMany.mockResolvedValue([buildNotification()]);
      prisma.notification.count.mockResolvedValue(1);

      const res = await app.inject({
        method: 'GET',
        url: '/notification',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
    });

    it('should return 401 for unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({ method: 'GET', url: '/notification' });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /notification/unread-count ───

  describe('GET /notification/unread-count', () => {
    it('should return unread count', async () => {
      sessionUser = testUser;
      prisma.notification.count.mockResolvedValue(5);

      const res = await app.inject({
        method: 'GET',
        url: '/notification/unread-count',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });
  });

  // ─── PATCH /notification/:id/read ───

  describe('PATCH /notification/:id/read', () => {
    it('should mark notification as read', async () => {
      sessionUser = testUser;
      const notif = buildNotification();
      prisma.notification.findUnique.mockResolvedValue(notif);
      prisma.notification.update.mockResolvedValue({
        ...notif,
        isRead: true,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/notification/1/read',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });

    it('should return 400 for non-integer id', async () => {
      sessionUser = testUser;

      const res = await app.inject({
        method: 'PATCH',
        url: '/notification/abc/read',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should return 401 for unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: '/notification/1/read',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── PATCH /notification/read-all ───

  describe('PATCH /notification/read-all', () => {
    it('should mark all as read', async () => {
      sessionUser = testUser;
      prisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const res = await app.inject({
        method: 'PATCH',
        url: '/notification/read-all',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });
  });

  // ─── POST /notification/subscribe ───

  describe('POST /notification/subscribe', () => {
    it('should subscribe to push notifications', async () => {
      sessionUser = testUser;
      prisma.pushSubscription.upsert.mockResolvedValue({
        id: 1,
        userId: testUser.id,
        endpoint: 'https://push.example.com/sub1',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/notification/subscribe',
        payload: {
          endpoint: 'https://push.example.com/sub1',
          keys: { p256dh: 'key1', auth: 'key2' },
        },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
    });

    it('should reject missing endpoint', async () => {
      sessionUser = testUser;

      const res = await app.inject({
        method: 'POST',
        url: '/notification/subscribe',
        payload: { keys: { p256dh: 'a', auth: 'b' } },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── DELETE /notification/unsubscribe ───

  describe('DELETE /notification/unsubscribe', () => {
    it('should unsubscribe from push notifications', async () => {
      sessionUser = testUser;
      prisma.pushSubscription.updateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: 'DELETE',
        url: '/notification/unsubscribe',
        payload: { endpoint: 'https://push.example.com/sub1' },
      });

      expect(res.statusCode).toBe(HttpStatus.NO_CONTENT);
    });
  });
});
