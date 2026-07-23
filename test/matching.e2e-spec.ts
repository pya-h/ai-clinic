/**
 * Matching E2E Tests
 *
 * Tests:
 *   POST  /matching/request     — create match request (patient only)
 *   GET   /matching/status/:id  — get match request status
 *   GET   /matching/active      — get active match request for patient
 *   GET   /matching/pending     — get pending matches for doctor
 *   PATCH /matching/:id/cancel  — cancel match request
 *   PATCH /matching/:id/browse  — fallback to manual browse
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../src/auth/auth.module';
import { UserModule } from '../src/user/user.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { UtilsModule } from '../src/utils/utils.module';
import { MatchingModule } from '../src/matching/matching.module';
import { ReviewModule } from '../src/review/review.module';
import { SchedulingModule } from '../src/scheduling/scheduling.module';
import { CalendlyModule } from '../src/calendly/calendly.module';
import { NurseModule } from '../src/nurse/nurse.module';
import { NotificationService } from '../src/notification/notification.service';
import { ReviewService } from '../src/review/review.service';
import { SchedulingService } from '../src/scheduling/scheduling.service';
import { CalendlyService } from '../src/calendly/calendly.service';
import { NurseService } from '../src/nurse/nurse.service';
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
import { MatchStatusEnum, UserRolesEnum, DoctorSpecialtiesEnum } from '@prisma/client';
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
    MatchingModule,
    ReviewModule,
    SchedulingModule,
    CalendlyModule,
    NurseModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

describe('Matching (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  const patientUser = createMockUser();
  const doctorUser = createMockDoctorUser();
  const adminUser = createMockAdminUser();
  const unrelatedPatient = createMockUser();

  const matchRequestId = randomUuid();
  const mockMatchRequest = {
    id: matchRequestId,
    patientId: patientUser.id,
    soapId: null as null,
    specialty: null as null,
    triageLevel: null as null,
    status: MatchStatusEnum.SEARCHING,
    matchedDoctorId: null as null,
    consultationId: null as null,
    resolvedAt: null as null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    prisma = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(NotificationService)
      .useValue({
        onMatchFound: jest.fn().mockResolvedValue(undefined),
        onMatchAccepted: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(ReviewService)
      .useValue({
        getAggregateRating: jest.fn().mockResolvedValue({
          averageRating: 4.0,
          totalReviews: 10,
          distribution: { 1: 0, 2: 0, 3: 2, 4: 5, 5: 3 },
        }),
      })
      .overrideProvider(SchedulingService)
      .useValue({
        getAvailableSlots: jest.fn().mockResolvedValue([]),
      })
      .overrideProvider(CalendlyService)
      .useValue({
        isConfigured: jest.fn().mockReturnValue(false),
      })
      .overrideProvider(NurseService)
      .useValue({
        assertNursePermission: jest.fn(),
        getDoctorIdsForNurse: jest.fn().mockResolvedValue([]),
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

  // ─── POST /matching/request ───

  describe('POST /matching/request', () => {
    it('should create a match request for a patient', async () => {
      sessionUser = patientUser;

      // No active request exists
      prisma.matchRequest.findFirst.mockResolvedValue(null);
      // Create the match request
      prisma.matchRequest.create.mockResolvedValue({ ...mockMatchRequest });
      // scoreDoctors calls doctorProfile.findMany — return empty (no doctors available)
      prisma.doctorProfile.findMany.mockResolvedValue([]);

      const res = await app.inject({
        method: 'POST',
        url: '/matching/request',
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.matchRequest).toBeDefined();
      expect(body.contents.matchRequest.id).toBe(matchRequestId);
      expect(body.contents.matchRequest.status).toBe(MatchStatusEnum.SEARCHING);
      expect(body.contents.doctors).toEqual([]);
    });

    it('should create a match request with optional specialty', async () => {
      sessionUser = patientUser;

      prisma.matchRequest.findFirst.mockResolvedValue(null);
      prisma.matchRequest.create.mockResolvedValue({
        ...mockMatchRequest,
        specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
      });
      prisma.doctorProfile.findMany.mockResolvedValue([]);

      const res = await app.inject({
        method: 'POST',
        url: '/matching/request',
        payload: { specialty: DoctorSpecialtiesEnum.CARDIOLOGY },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents.matchRequest.specialty).toBe(
        DoctorSpecialtiesEnum.CARDIOLOGY,
      );
    });

    it('should reject non-patient (doctor)', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'POST',
        url: '/matching/request',
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/matching/request',
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should reject when an active request already exists', async () => {
      sessionUser = patientUser;

      // Active request already exists
      prisma.matchRequest.findFirst.mockResolvedValue({ ...mockMatchRequest });

      const res = await app.inject({
        method: 'POST',
        url: '/matching/request',
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /matching/status/:id ───

  describe('GET /matching/status/:id', () => {
    it('should return status for the patient owner', async () => {
      sessionUser = patientUser;

      prisma.matchRequest.findUnique.mockResolvedValue({
        ...mockMatchRequest,
        matchedDoctor: null,
        soap: null,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/matching/status/${matchRequestId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(matchRequestId);
      expect(body.contents.status).toBe(MatchStatusEnum.SEARCHING);
    });

    it('should reject an unrelated user', async () => {
      sessionUser = unrelatedPatient;

      prisma.matchRequest.findUnique.mockResolvedValue({
        ...mockMatchRequest,
        matchedDoctor: null,
        soap: null,
      });
      // Unrelated user is not the patient, not admin, and not the matched doctor
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `/matching/status/${matchRequestId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 404 for a non-existent request', async () => {
      sessionUser = patientUser;

      prisma.matchRequest.findUnique.mockResolvedValue(null);

      const nonExistentId = randomUuid();
      const res = await app.inject({
        method: 'GET',
        url: `/matching/status/${nonExistentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: `/matching/status/${matchRequestId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /matching/active ───

  describe('GET /matching/active', () => {
    it('should return active request for patient', async () => {
      sessionUser = patientUser;

      prisma.matchRequest.findFirst.mockResolvedValue({
        ...mockMatchRequest,
        matchedDoctor: null,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/matching/active',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(matchRequestId);
      expect(body.contents.status).toBe(MatchStatusEnum.SEARCHING);
    });

    it('should return null when no active request exists', async () => {
      sessionUser = patientUser;

      prisma.matchRequest.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/matching/active',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeNull();
    });

    it('should reject non-patient (doctor)', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'GET',
        url: '/matching/active',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/matching/active',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /matching/pending ───

  describe('GET /matching/pending', () => {
    it('should return pending matches for a doctor', async () => {
      sessionUser = doctorUser;

      const doctorProfileId = 42;
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: doctorProfileId,
        userId: doctorUser.id,
      });
      prisma.matchRequest.findMany.mockResolvedValue([
        {
          ...mockMatchRequest,
          status: MatchStatusEnum.MATCHED,
          matchedDoctorId: doctorProfileId,
          patient: {
            id: patientUser.id,
            firstname: patientUser.firstname,
            lastname: patientUser.lastname,
            avatar: null,
          },
          soap: null,
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/matching/pending',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(Array.isArray(body.contents)).toBe(true);
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].status).toBe(MatchStatusEnum.MATCHED);
    });

    it('should reject non-doctor (patient)', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/matching/pending',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/matching/pending',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── PATCH /matching/:id/cancel ───

  describe('PATCH /matching/:id/cancel', () => {
    it('should cancel a SEARCHING request by the patient owner', async () => {
      sessionUser = patientUser;

      prisma.matchRequest.findUnique.mockResolvedValue({
        ...mockMatchRequest,
        status: MatchStatusEnum.SEARCHING,
      });
      prisma.matchRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.matchRequest.findUniqueOrThrow.mockResolvedValue({
        ...mockMatchRequest,
        status: MatchStatusEnum.CANCELLED,
        resolvedAt: new Date(),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/matching/${matchRequestId}/cancel`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.status).toBe(MatchStatusEnum.CANCELLED);
    });

    it('should allow admin to cancel another patient request', async () => {
      sessionUser = adminUser;

      prisma.matchRequest.findUnique.mockResolvedValue({
        ...mockMatchRequest,
        status: MatchStatusEnum.SEARCHING,
      });
      prisma.matchRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.matchRequest.findUniqueOrThrow.mockResolvedValue({
        ...mockMatchRequest,
        status: MatchStatusEnum.CANCELLED,
        resolvedAt: new Date(),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/matching/${matchRequestId}/cancel`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.status).toBe(MatchStatusEnum.CANCELLED);
    });

    it('should reject cancellation from a terminal state (CONSULTATION_CREATED)', async () => {
      sessionUser = patientUser;

      prisma.matchRequest.findUnique.mockResolvedValue({
        ...mockMatchRequest,
        status: MatchStatusEnum.CONSULTATION_CREATED,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/matching/${matchRequestId}/cancel`,
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject non-owner non-admin', async () => {
      sessionUser = unrelatedPatient;

      prisma.matchRequest.findUnique.mockResolvedValue({
        ...mockMatchRequest,
        status: MatchStatusEnum.SEARCHING,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/matching/${matchRequestId}/cancel`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: `/matching/${matchRequestId}/cancel`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 404 for a non-existent request', async () => {
      sessionUser = patientUser;

      prisma.matchRequest.findUnique.mockResolvedValue(null);

      const nonExistentId = randomUuid();
      const res = await app.inject({
        method: 'PATCH',
        url: `/matching/${nonExistentId}/cancel`,
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─── PATCH /matching/:id/browse ───

  describe('PATCH /matching/:id/browse', () => {
    it('should transition TIMEOUT to MANUAL_BROWSE', async () => {
      sessionUser = patientUser;

      prisma.matchRequest.findUnique.mockResolvedValue({
        ...mockMatchRequest,
        status: MatchStatusEnum.TIMEOUT,
      });
      prisma.matchRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.matchRequest.findUniqueOrThrow.mockResolvedValue({
        ...mockMatchRequest,
        status: MatchStatusEnum.MANUAL_BROWSE,
        resolvedAt: new Date(),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/matching/${matchRequestId}/browse`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.status).toBe(MatchStatusEnum.MANUAL_BROWSE);
    });

    it('should reject from a non-TIMEOUT state (SEARCHING)', async () => {
      sessionUser = patientUser;

      prisma.matchRequest.findUnique.mockResolvedValue({
        ...mockMatchRequest,
        status: MatchStatusEnum.SEARCHING,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/matching/${matchRequestId}/browse`,
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject non-patient (doctor)', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/matching/${matchRequestId}/browse`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: `/matching/${matchRequestId}/browse`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });
});
