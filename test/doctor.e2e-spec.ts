/**
 * Doctor E2E Tests
 *
 * Tests:
 *   POST   /doctor         — create doctor profile
 *   PATCH  /doctor/profile  — update doctor profile
 *   GET    /doctor          — public listing of verified doctors
 *   GET    /doctor/:id      — public single doctor profile
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../src/auth/auth.module';
import { UserModule } from '../src/user/user.module';
import { DoctorModule } from '../src/doctor/doctor.module';
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
  DoctorSpecialtiesEnum,
  VisitMethodsEnum,
  VisitTypesEnum,
} from '@prisma/client';
import { ScheduleModule } from '@nestjs/schedule';
import authConfigs from '../src/configs/auth';
import generalConfigs from '../src/configs/general';
import {
  createMockDoctorUser,
  createMockUser,
  MockUser,
} from './helpers/mock-session.helper';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ load: [authConfigs, generalConfigs] }),
    CacheModule,
    UtilsModule,
    AuthModule,
    UserModule,
    DoctorModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

describe('Doctor (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  const validDoctorPayload = {
    startedAt: '2020-01-15T00:00:00.000Z',
    specialty: DoctorSpecialtiesEnum.GENERAL,
    visitMethods: [VisitMethodsEnum.CHAT, VisitMethodsEnum.VIDEO_CALL],
    visitTypes: [VisitTypesEnum.CONSULTATION],
    bio: 'General practitioner with 10 years of experience.',
  };

  beforeAll(async () => {
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
    app.useGlobalFilters(new ExceptionTemplateFilter());
    app.useGlobalInterceptors(new ResponseTemplateInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidUnknownValues: true,
        transform: true,
      }),
    );

    // Session simulation hook — BEFORE app.init()
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

  describe('POST /doctor', () => {
    it('should create doctor profile with valid data', async () => {
      sessionUser = createMockDoctorUser();
      prisma.doctorProfile.findFirst.mockResolvedValue(null);
      prisma.doctorProfile.create.mockResolvedValue({
        id: 'doc-profile-uuid',
        userId: sessionUser.id,
        specialty: DoctorSpecialtiesEnum.GENERAL,
        secondarySpecialties: [],
        visitMethods: validDoctorPayload.visitMethods,
        visitTypes: validDoctorPayload.visitTypes,
        bio: validDoctorPayload.bio,
        startedAt: new Date(validDoctorPayload.startedAt),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/doctor',
        payload: validDoctorPayload,
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.specialty).toBe(DoctorSpecialtiesEnum.GENERAL);
    });

    it('should reject non-doctor role (403)', async () => {
      sessionUser = createMockUser(); // PATIENT role

      const res = await app.inject({
        method: 'POST',
        url: '/doctor',
        payload: validDoctorPayload,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject duplicate doctor profile', async () => {
      sessionUser = createMockDoctorUser();
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 'existing-profile-uuid',
        userId: sessionUser.id,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/doctor',
        payload: validDoctorPayload,
      });

      expect(res.statusCode).toBe(HttpStatus.CONFLICT);
    });

    it('should reject missing required fields', async () => {
      sessionUser = createMockDoctorUser();

      const res = await app.inject({
        method: 'POST',
        url: '/doctor',
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject invalid specialty enum value', async () => {
      sessionUser = createMockDoctorUser();

      const res = await app.inject({
        method: 'POST',
        url: '/doctor',
        payload: {
          ...validDoctorPayload,
          specialty: 'INVALID_SPECIALTY',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/doctor',
        payload: validDoctorPayload,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ───────────────── PATCH /doctor/profile ─────────────────

  describe('PATCH /doctor/profile', () => {
    const updatePayload = {
      bio: 'Updated bio text',
      university: 'Harvard Medical School',
      clinicLocation: '123 Main St',
    };

    it('should update doctor profile with valid data', async () => {
      sessionUser = createMockDoctorUser();
      const existingProfile = {
        id: 1,
        userId: sessionUser.id,
        specialty: DoctorSpecialtiesEnum.GENERAL,
        bio: 'Old bio',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updatedProfile = { ...existingProfile, ...updatePayload };

      prisma.doctorProfile.findUnique.mockResolvedValue(existingProfile);
      prisma.doctorProfile.update.mockResolvedValue(updatedProfile);

      const res = await app.inject({
        method: 'PATCH',
        url: '/doctor/profile',
        payload: updatePayload,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.bio).toBe('Updated bio text');
      expect(body.contents.university).toBe('Harvard Medical School');
    });

    it('should return 404 if doctor has no profile', async () => {
      sessionUser = createMockDoctorUser();
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PATCH',
        url: '/doctor/profile',
        payload: updatePayload,
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should reject non-doctor role', async () => {
      sessionUser = createMockUser(); // PATIENT role

      const res = await app.inject({
        method: 'PATCH',
        url: '/doctor/profile',
        payload: updatePayload,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: '/doctor/profile',
        payload: updatePayload,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should accept partial update (only bio)', async () => {
      sessionUser = createMockDoctorUser();
      const existingProfile = {
        id: 1,
        userId: sessionUser.id,
        specialty: DoctorSpecialtiesEnum.GENERAL,
        bio: 'Old bio',
      };
      prisma.doctorProfile.findUnique.mockResolvedValue(existingProfile);
      prisma.doctorProfile.update.mockResolvedValue({
        ...existingProfile,
        bio: 'Just bio',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/doctor/profile',
        payload: { bio: 'Just bio' },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.bio).toBe('Just bio');
    });
  });

  // ───────────────── GET /doctor (public listing) ─────────────────

  describe('GET /doctor', () => {
    const mockListResult = [
      {
        id: 1,
        userId: 'doc-1',
        specialty: DoctorSpecialtiesEnum.GENERAL,
        verified: true,
        bio: 'GP',
        user: { id: 'doc-1', firstname: 'John', lastname: 'Doe', avatar: null },
        _count: { reviewsAbout: 3 },
      },
    ];

    it('should list verified doctors without auth', async () => {
      sessionUser = null; // no auth needed
      prisma.doctorProfile.findMany.mockResolvedValue(mockListResult);
      prisma.doctorProfile.count.mockResolvedValue(1);

      const res = await app.inject({
        method: 'GET',
        url: '/doctor',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.data).toHaveLength(1);
      expect(body.contents.total).toBe(1);
    });

    it('should pass specialty filter to query', async () => {
      prisma.doctorProfile.findMany.mockResolvedValue([]);
      prisma.doctorProfile.count.mockResolvedValue(0);

      const res = await app.inject({
        method: 'GET',
        url: '/doctor?specialty=CARDIOLOGY',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.data).toHaveLength(0);
      expect(body.contents.total).toBe(0);
    });

    it('should support pagination params', async () => {
      prisma.doctorProfile.findMany.mockResolvedValue([]);
      prisma.doctorProfile.count.mockResolvedValue(50);

      const res = await app.inject({
        method: 'GET',
        url: '/doctor?skip=10&take=5',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.skip).toBe(10);
      expect(body.contents.take).toBe(5);
    });

    it('should reject invalid specialty enum in filter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/doctor?specialty=NOT_A_SPECIALTY',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ───────────────── GET /doctor/:id (public profile) ─────────────────

  describe('GET /doctor/:id', () => {
    const verifiedProfile = {
      id: 1,
      userId: 'doc-1',
      specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
      verified: true,
      bio: 'Heart doctor',
      user: { id: 'doc-1', firstname: 'Jane', lastname: 'Doe', avatar: null },
    };

    it('should return a verified doctor profile with ratings', async () => {
      sessionUser = null; // public endpoint
      prisma.doctorProfile.findUnique.mockResolvedValue(verifiedProfile);
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: 4.5 },
        _count: { rating: 2 },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/doctor/1',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.specialty).toBe(DoctorSpecialtiesEnum.CARDIOLOGY);
      expect(body.contents.averageRating).toBe(4.5);
      expect(body.contents.totalReviews).toBe(2);
    });

    it('should return 404 for non-existent doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: null },
        _count: { rating: 0 },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/doctor/999',
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should return 404 for unverified doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        ...verifiedProfile,
        verified: false,
      });
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: null },
        _count: { rating: 0 },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/doctor/1',
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/doctor/abc',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });
});
