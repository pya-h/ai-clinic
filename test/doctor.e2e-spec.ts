/**
 * Doctor E2E Tests
 *
 * Tests:
 *   POST /doctor — create doctor profile
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

    it('should reject non-doctor role (405)', async () => {
      sessionUser = createMockUser(); // PATIENT role

      const res = await app.inject({
        method: 'POST',
        url: '/doctor',
        payload: validDoctorPayload,
      });

      expect(res.statusCode).toBe(HttpStatus.METHOD_NOT_ALLOWED);
    });

    it('should reject duplicate doctor profile', async () => {
      sessionUser = createMockDoctorUser();
      prisma.doctorProfile.findFirst.mockResolvedValue({
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
});
