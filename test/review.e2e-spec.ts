import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ReviewModule } from '../src/review/review.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { UtilsModule } from '../src/utils/utils.module';
import { AuthModule } from '../src/auth/auth.module';
import { UserModule } from '../src/user/user.module';
import { NotificationService } from '../src/notification/notification.service';
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
import { UserRolesEnum, ConsultationStatusEnum } from '@prisma/client';
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
    ReviewModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

describe('Review (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  const patientUser = createMockUser();
  const doctorUser = createMockDoctorUser();
  const adminUser = createMockAdminUser();

  const buildReview = (overrides: Record<string, any> = {}) => ({
    id: 1,
    reviewerId: patientUser.id,
    doctorId: 1,
    rating: 5,
    title: 'Great doctor',
    overview: 'Very professional',
    createdAt: new Date(),
    updatedAt: new Date(),
    reviewer: {
      id: patientUser.id,
      firstname: patientUser.firstname,
      lastname: patientUser.lastname,
      avatar: null,
    },
    ...overrides,
  });

  beforeAll(async () => {
    prisma = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(NotificationService)
      .useValue({
        onNewReview: jest.fn().mockResolvedValue(undefined),
        onNewChatMessage: jest.fn().mockResolvedValue(undefined),
      })
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
  });

  // ─── POST /review ───

  describe('POST /review', () => {
    it('should create a review as patient', async () => {
      sessionUser = patientUser;
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        userId: doctorUser.id,
        verified: true,
      });
      prisma.consultation.findFirst.mockResolvedValue({
        id: randomUuid(),
        patientId: patientUser.id,
        doctorId: 1,
        status: ConsultationStatusEnum.COMPLETED,
      });
      prisma.doctorReview.findUnique.mockResolvedValue(null);
      prisma.doctorReview.create.mockResolvedValue(buildReview());

      const res = await app.inject({
        method: 'POST',
        url: '/review',
        payload: {
          doctorId: 1,
          rating: 5,
          title: 'Great doctor',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/review',
        payload: { doctorId: 1, rating: 5 },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should reject doctor role', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'POST',
        url: '/review',
        payload: { doctorId: 1, rating: 5 },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject invalid rating', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/review',
        payload: { doctorId: 1, rating: 10 },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /review/:id ───

  describe('PATCH /review/:id', () => {
    it('should update own review as patient', async () => {
      sessionUser = patientUser;
      const review = buildReview();
      prisma.doctorReview.findUnique.mockResolvedValue(review);
      prisma.doctorReview.update.mockResolvedValue({ ...review, rating: 4 });

      const res = await app.inject({
        method: 'PATCH',
        url: '/review/1',
        payload: { rating: 4 },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });

    it('should reject non-integer id', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'PATCH',
        url: '/review/abc',
        payload: { rating: 4 },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── DELETE /review/:id ───

  describe('DELETE /review/:id', () => {
    it('should delete own review', async () => {
      sessionUser = patientUser;
      const review = buildReview();
      prisma.doctorReview.findUnique.mockResolvedValue(review);
      prisma.doctorReview.delete.mockResolvedValue(review);

      const res = await app.inject({
        method: 'DELETE',
        url: '/review/1',
      });

      expect(res.statusCode).toBe(HttpStatus.NO_CONTENT);
    });

    it('should reject unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({ method: 'DELETE', url: '/review/1' });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /review/admin/all ───

  describe('GET /review/admin/all', () => {
    it('should list all reviews for admin', async () => {
      sessionUser = adminUser;
      prisma.doctorReview.findMany.mockResolvedValue([buildReview()]);
      prisma.doctorReview.count.mockResolvedValue(1);

      const res = await app.inject({
        method: 'GET',
        url: '/review/admin/all',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });

    it('should reject non-admin', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/review/admin/all',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─── GET /review/doctor/:doctorId ───

  describe('GET /review/doctor/:doctorId', () => {
    it('should list reviews for doctor (public)', async () => {
      prisma.doctorReview.findMany.mockResolvedValue([buildReview()]);
      prisma.doctorReview.count.mockResolvedValue(1);

      const res = await app.inject({
        method: 'GET',
        url: '/review/doctor/1',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });

    it('should return 400 for non-integer doctorId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/review/doctor/abc',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /review/doctor/:doctorId/rating ───

  describe('GET /review/doctor/:doctorId/rating', () => {
    it('should return aggregate rating', async () => {
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: 4.5 },
        _count: { rating: 10 },
      });
      prisma.doctorReview.groupBy.mockResolvedValue([
        { rating: 5, _count: { rating: 6 } },
        { rating: 4, _count: { rating: 4 } },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/review/doctor/1/rating',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });
  });
});
