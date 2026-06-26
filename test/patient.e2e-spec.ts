/**
 * Patient E2E Tests
 *
 * Tests:
 *   POST   /patient/profile — create patient profile (valid, duplicate, non-patient role, unauthed)
 *   PATCH  /patient/profile — update patient profile (valid, no profile, unauthed)
 *   GET    /patient/profile — get own patient profile (has profile, no profile, unauthed)
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
import { PatientModule } from '../src/patient/patient.module';
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
import { ScheduleModule } from '@nestjs/schedule';
import authConfigs from '../src/configs/auth';
import generalConfigs from '../src/configs/general';
import {
  createMockUser,
  createMockDoctorUser,
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
    PatientModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

describe('Patient (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  const mockProfile = {
    id: 'profile-uuid',
    userId: 'test-user-uuid-1234',
    location: 'Tehran',
    bio: 'Test patient',
    medicalHistory: ['Flu 2024'],
    allergies: ['Penicillin'],
    medications: [] as string[],
    surgeries: [] as string[],
    familyHistory: [] as string[],
    visitMethods: [] as string[],
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

  // ─── POST /patient/profile ───

  describe('POST /patient/profile', () => {
    it('should create patient profile with valid data', async () => {
      sessionUser = createMockUser(); // PATIENT role
      prisma.patientProfile.findUnique.mockResolvedValue(null);
      prisma.patientProfile.create.mockResolvedValue({
        ...mockProfile,
        userId: sessionUser.id,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/patient/profile',
        payload: {
          location: 'Tehran',
          bio: 'Test patient',
          medicalHistory: ['Flu 2024'],
          allergies: ['Penicillin'],
        },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.location).toBe('Tehran');
    });

    it('should create profile with empty payload (all optional)', async () => {
      sessionUser = createMockUser();
      prisma.patientProfile.findUnique.mockResolvedValue(null);
      prisma.patientProfile.create.mockResolvedValue({
        ...mockProfile,
        userId: sessionUser.id,
        location: null,
        bio: null,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/patient/profile',
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
    });

    it('should reject duplicate profile', async () => {
      sessionUser = createMockUser();
      prisma.patientProfile.findUnique.mockResolvedValue(mockProfile);

      const res = await app.inject({
        method: 'POST',
        url: '/patient/profile',
        payload: { location: 'Tehran' },
      });

      expect(res.statusCode).toBe(HttpStatus.CONFLICT);
    });

    it('should reject non-patient role (DOCTOR)', async () => {
      sessionUser = createMockDoctorUser(); // DOCTOR role

      const res = await app.inject({
        method: 'POST',
        url: '/patient/profile',
        payload: { location: 'Tehran' },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/patient/profile',
        payload: { location: 'Tehran' },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── PATCH /patient/profile ───

  describe('PATCH /patient/profile', () => {
    it('should update patient profile', async () => {
      sessionUser = createMockUser();
      prisma.patientProfile.findUnique.mockResolvedValue(mockProfile);
      prisma.patientProfile.update.mockResolvedValue({
        ...mockProfile,
        bio: 'Updated bio',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/patient/profile',
        payload: { bio: 'Updated bio' },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.bio).toBe('Updated bio');
    });

    it('should return 404 if no profile exists', async () => {
      sessionUser = createMockUser();
      prisma.patientProfile.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PATCH',
        url: '/patient/profile',
        payload: { bio: 'Updated' },
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: '/patient/profile',
        payload: { bio: 'Updated' },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should reject non-patient role', async () => {
      sessionUser = createMockDoctorUser();

      const res = await app.inject({
        method: 'PATCH',
        url: '/patient/profile',
        payload: { bio: 'Updated' },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─── GET /patient/profile ───

  describe('GET /patient/profile', () => {
    it('should return patient profile', async () => {
      sessionUser = createMockUser();
      prisma.patientProfile.findUnique.mockResolvedValue(mockProfile);

      const res = await app.inject({
        method: 'GET',
        url: '/patient/profile',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.location).toBe('Tehran');
    });

    it('should return 404 if no profile', async () => {
      sessionUser = createMockUser();
      prisma.patientProfile.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/patient/profile',
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/patient/profile',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });
});
