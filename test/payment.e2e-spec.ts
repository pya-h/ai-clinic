/**
 * Payment E2E Tests
 *
 * Tests:
 *   POST   /payment              — create payment record (auth required)
 *   GET    /payment              — list user payments (paginated)
 *   GET    /payment/:id          — get payment by ID
 *   POST   /payment/:id/confirm  — confirm payment
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { UtilsModule } from '../src/utils/utils.module';
import { AuthModule } from '../src/auth/auth.module';
import { UserModule } from '../src/user/user.module';
import { PaymentModule } from '../src/payment/payment.module';
import { ExceptionTemplateFilter } from '../src/common/filters/exception-template.filter';
import { ResponseTemplateInterceptor } from '../src/common/interceptors/response-template.interceptor';
import {
  createMockPrismaService,
  MockPrismaService,
} from './helpers/mock-prisma.helper';
import {
  createMockUser,
  createMockDoctorUser,
  createMockAdminUser,
  MockUser,
} from './helpers/mock-session.helper';
import { randomUuid } from './helpers/test-data.factory';
import {
  PaymentStatusEnum,
  ConsultationStatusEnum,
} from '@prisma/client';
import authConfigs from '../src/configs/auth';
import generalConfigs from '../src/configs/general';

// ── Test module ──────────────────────────────────────────────────────

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ load: [authConfigs, generalConfigs] }),
    CacheModule,
    UtilsModule,
    AuthModule,
    UserModule,
    PaymentModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

// ── Suite ────────────────────────────────────────────────────────────

describe('Payment (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  const patientUser = createMockUser();
  const doctorUser = createMockDoctorUser();
  const adminUser = createMockAdminUser();
  const otherUser = createMockUser();

  const paymentId = 101;
  const consultationId = randomUuid();

  function buildPayment(overrides: Record<string, any> = {}) {
    const now = new Date();
    return {
      id: paymentId,
      userId: patientUser.id,
      amount: 50.0,
      currency: 'USD',
      consultationId: null,
      method: null,
      status: PaymentStatusEnum.PENDING,
      paidAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  // ── Bootstrap ──────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createMockPrismaService();

    // Mock $transaction to execute callback with prisma as the tx client
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
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
    // Re-apply $transaction mock after clearAllMocks
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
  });

  // ─── POST /payment ──────────────────────────────────────────────

  describe('POST /payment', () => {
    it('should create a payment successfully', async () => {
      sessionUser = patientUser;

      prisma.payment.create.mockResolvedValue(buildPayment());

      const res = await app.inject({
        method: 'POST',
        url: '/payment',
        payload: {
          amount: 50.0,
          currency: 'USD',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.amount).toBe(50.0);
      expect(body.contents.status).toBe(PaymentStatusEnum.PENDING);
    });

    it('should create a payment with consultationId', async () => {
      sessionUser = patientUser;

      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        patientId: patientUser.id,
        status: ConsultationStatusEnum.PENDING_PAYMENT,
      });
      prisma.payment.create.mockResolvedValue(
        buildPayment({ consultationId }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/payment',
        payload: {
          amount: 75.0,
          consultationId,
        },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.consultationId).toBe(consultationId);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/payment',
        payload: {
          amount: 50.0,
        },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 400 when amount is missing', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/payment',
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should return 400 when amount is zero', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/payment',
        payload: { amount: 0 },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should return 400 when amount is negative', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/payment',
        payload: { amount: -10 },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should return 400 when consultationId is not a UUID', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/payment',
        payload: {
          amount: 50.0,
          consultationId: 'not-a-uuid',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /payment ────────────────────────────────────────────────

  describe('GET /payment', () => {
    it('should list payments for authenticated user', async () => {
      sessionUser = patientUser;

      prisma.payment.findMany.mockResolvedValue([buildPayment()]);
      prisma.payment.count.mockResolvedValue(1);

      const res = await app.inject({
        method: 'GET',
        url: '/payment',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.data).toHaveLength(1);
      expect(body.contents.total).toBe(1);
    });

    it('should return empty list when no payments', async () => {
      sessionUser = patientUser;

      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.count.mockResolvedValue(0);

      const res = await app.inject({
        method: 'GET',
        url: '/payment',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.data).toHaveLength(0);
      expect(body.contents.total).toBe(0);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/payment',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should accept pagination parameters', async () => {
      sessionUser = patientUser;

      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.count.mockResolvedValue(0);

      const res = await app.inject({
        method: 'GET',
        url: '/payment?skip=5&take=10',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.skip).toBe(5);
      expect(body.contents.take).toBe(10);
    });
  });

  // ─── GET /payment/:id ────────────────────────────────────────────

  describe('GET /payment/:id', () => {
    it('should get payment by ID (owner)', async () => {
      sessionUser = patientUser;

      prisma.payment.findUnique.mockResolvedValue(buildPayment());

      const res = await app.inject({
        method: 'GET',
        url: `/payment/${paymentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(paymentId);
    });

    it('should get payment by ID (admin)', async () => {
      sessionUser = adminUser;

      prisma.payment.findUnique.mockResolvedValue(buildPayment());

      const res = await app.inject({
        method: 'GET',
        url: `/payment/${paymentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
    });

    it('should return 403 when non-owner non-admin tries to access', async () => {
      sessionUser = otherUser;

      prisma.payment.findUnique.mockResolvedValue(buildPayment());

      const res = await app.inject({
        method: 'GET',
        url: `/payment/${paymentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 404 when payment not found', async () => {
      sessionUser = patientUser;

      prisma.payment.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/payment/99999',
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: `/payment/${paymentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 400 when id is not an integer', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/payment/not-a-number',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── POST /payment/:id/confirm ──────────────────────────────────

  describe('POST /payment/:id/confirm', () => {
    it('should confirm a pending payment (owner)', async () => {
      sessionUser = patientUser;

      const pendingPayment = buildPayment();
      prisma.payment.findUnique.mockResolvedValue(pendingPayment);
      prisma.payment.update.mockResolvedValue(
        buildPayment({
          status: PaymentStatusEnum.COMPLETED,
          paidAt: new Date(),
        }),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/payment/${paymentId}/confirm`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.status).toBe(PaymentStatusEnum.COMPLETED);
    });

    it('should confirm a pending payment (admin)', async () => {
      sessionUser = adminUser;

      prisma.payment.findUnique.mockResolvedValue(buildPayment());
      prisma.payment.update.mockResolvedValue(
        buildPayment({
          status: PaymentStatusEnum.COMPLETED,
          paidAt: new Date(),
        }),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/payment/${paymentId}/confirm`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.status).toBe(PaymentStatusEnum.COMPLETED);
    });

    it('should return 403 when non-owner non-admin tries to confirm', async () => {
      sessionUser = otherUser;

      prisma.payment.findUnique.mockResolvedValue(buildPayment());

      const res = await app.inject({
        method: 'POST',
        url: `/payment/${paymentId}/confirm`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 404 when payment not found', async () => {
      sessionUser = patientUser;

      prisma.payment.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/payment/99999/confirm',
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: `/payment/${paymentId}/confirm`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 400 when id is not an integer', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/payment/abc/confirm',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });
});
