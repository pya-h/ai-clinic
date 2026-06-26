import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SoapModule } from '../src/soap/soap.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { UtilsModule } from '../src/utils/utils.module';
import { AuthModule } from '../src/auth/auth.module';
import { UserModule } from '../src/user/user.module';
import { NotificationService } from '../src/notification/notification.service';
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
    SoapModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

describe('SOAP (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  const patientUser = createMockUser();
  const doctorUser = createMockDoctorUser();
  const adminUser = createMockAdminUser();

  const buildSoap = (overrides: Record<string, any> = {}) => ({
    id: randomUuid(),
    conversationId: randomUuid(),
    userId: patientUser.id,
    subjective: 'Patient reports headache',
    objective: 'BP 120/80',
    assessment: 'Tension headache',
    plan: 'Rest and hydration',
    triageLevel: 'NON_URGENT',
    suggestedSpecialty: null as null,
    rawContent: 'full raw text',
    createdAt: new Date(),
    updatedAt: new Date(),
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
        onSoapGenerated: jest.fn().mockResolvedValue(undefined),
        onNewChatMessage: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(NurseService)
      .useValue({
        getMyAssignments: jest.fn().mockResolvedValue([]),
        getDoctorNurseIds: jest.fn().mockResolvedValue([]),
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

  // ─── GET /soap ───

  describe('GET /soap', () => {
    it('should return paginated SOAP notes for authenticated user', async () => {
      sessionUser = patientUser;
      const soaps = [buildSoap()];
      prisma.patientSOAP.findMany.mockResolvedValue(soaps);
      prisma.patientSOAP.count.mockResolvedValue(1);

      const res = await app.inject({ method: 'GET', url: '/soap' });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
    });

    it('should return 401 for unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({ method: 'GET', url: '/soap' });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /soap/:id ───

  describe('GET /soap/:id', () => {
    it('should return SOAP note for owner', async () => {
      sessionUser = patientUser;
      const soapId = randomUuid();
      const soap = buildSoap({ id: soapId });
      prisma.patientSOAP.findUnique.mockResolvedValue(soap);

      const res = await app.inject({ method: 'GET', url: `/soap/${soapId}` });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
    });

    it('should return 404 for non-existent SOAP', async () => {
      sessionUser = patientUser;
      const fakeId = randomUuid();
      prisma.patientSOAP.findUnique.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: `/soap/${fakeId}` });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should return 400 for invalid UUID', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/soap/not-a-uuid',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should return 401 for unauthenticated request', async () => {
      sessionUser = null;
      const id = randomUuid();

      const res = await app.inject({ method: 'GET', url: `/soap/${id}` });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should reject non-owner access', async () => {
      const otherUser = createMockUser();
      sessionUser = otherUser;
      const soapId = randomUuid();
      const soap = buildSoap({ id: soapId, userId: patientUser.id });
      prisma.patientSOAP.findUnique.mockResolvedValue(soap);

      const res = await app.inject({ method: 'GET', url: `/soap/${soapId}` });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should allow admin to view any SOAP', async () => {
      sessionUser = adminUser;
      const soapId = randomUuid();
      const soap = buildSoap({ id: soapId });
      prisma.patientSOAP.findUnique.mockResolvedValue(soap);

      const res = await app.inject({ method: 'GET', url: `/soap/${soapId}` });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });
  });
});
