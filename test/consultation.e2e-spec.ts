/**
 * Consultation E2E Tests
 *
 * Tests:
 *   POST   /consultation            — create (patient only)
 *   GET    /consultation            — list (role-based)
 *   GET    /consultation/:id        — get by ID (ownership check)
 *   PATCH  /consultation/:id/decide — doctor decision
 *   PATCH  /consultation/:id/complete — doctor completes
 *   PATCH  /consultation/:id/cancel — cancel (patient/doctor/admin)
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
import { ConsultationModule } from '../src/consultation/consultation.module';
import { NotificationService } from '../src/notification/notification.service';
import { NurseService } from '../src/nurse/nurse.service';
import { ExceptionTemplateFilter } from '../src/common/filters/exception-template.filter';
import { ResponseTemplateInterceptor } from '../src/common/interceptors/response-template.interceptor';
import {
  createMockPrismaService,
  MockPrismaService,
} from './helpers/mock-prisma.helper';
import {
  ConsultationStatusEnum,
  ConsultationModeEnum,
} from '@prisma/client';
import authConfigs from '../src/configs/auth';
import generalConfigs from '../src/configs/general';
import {
  createMockUser,
  createMockDoctorUser,
  createMockAdminUser,
  MockUser,
} from './helpers/mock-session.helper';
import {
  randomUuid,
  buildDoctorProfile,
} from './helpers/test-data.factory';

// ── Mock services ────────────────────────────────────────────────────

const mockNotificationService = {
  onNewConsultation: jest.fn().mockResolvedValue(undefined),
  onDoctorDecision: jest.fn().mockResolvedValue(undefined),
};

const mockNurseService = {
  assertNursePermission: jest.fn().mockResolvedValue(undefined),
  getDoctorIdsForNurse: jest.fn().mockResolvedValue([]),
};

// ── Test module ──────────────────────────────────────────────────────

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ load: [authConfigs, generalConfigs] }),
    CacheModule,
    UtilsModule,
    AuthModule,
    UserModule,
    ConsultationModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

// ── Suite ────────────────────────────────────────────────────────────

describe('Consultation (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  // Shared test identities (created once, reused across tests)
  const patientUser = createMockUser();
  const doctorUser = createMockDoctorUser();
  const adminUser = createMockAdminUser();
  const otherPatientUser = createMockUser();

  const doctorProfileId = 10;
  const consultationId = randomUuid();

  const doctorProfile = buildDoctorProfile({
    id: doctorProfileId,
    userId: doctorUser.id,
    verified: true,
  });

  function buildConsultation(
    overrides: Record<string, any> = {},
  ): Record<string, any> {
    const now = new Date();
    return {
      id: consultationId,
      patientId: patientUser.id,
      doctorId: doctorProfileId,
      soapId: null,
      status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      doctorDecision: null,
      visitMethod: null,
      notes: null,
      summary: null,
      followUpNeeded: false,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      doctor: {
        id: doctorProfileId,
        userId: doctorUser.id,
        user: {
          id: doctorUser.id,
          firstname: doctorUser.firstname,
          lastname: doctorUser.lastname,
          avatar: null,
        },
      },
      patient: {
        id: patientUser.id,
        firstname: patientUser.firstname,
        lastname: patientUser.lastname,
        avatar: null,
      },
      soap: null,
      appointment: null,
      ...overrides,
    };
  }

  // ── Bootstrap ──────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(NotificationService)
      .useValue(mockNotificationService)
      .overrideProvider(NurseService)
      .useValue(mockNurseService)
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

  // ─── POST /consultation ──────────────────────────────────────────

  describe('POST /consultation', () => {
    it('should create a consultation successfully (patient)', async () => {
      sessionUser = patientUser;

      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.consultation.create.mockResolvedValue(buildConsultation());

      const res = await app.inject({
        method: 'POST',
        url: '/consultation',
        payload: { doctorId: doctorProfileId },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(consultationId);
      expect(body.contents.patientId).toBe(patientUser.id);
      expect(body.contents.doctorId).toBe(doctorProfileId);
      expect(body.contents.status).toBe(
        ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      );
    });

    it('should reject non-patient (doctor role)', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'POST',
        url: '/consultation',
        payload: { doctorId: doctorProfileId },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/consultation',
        payload: { doctorId: doctorProfileId },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should reject when doctor not found', async () => {
      sessionUser = patientUser;

      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/consultation',
        payload: { doctorId: 9999 },
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should reject invalid doctorId (non-integer)', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/consultation',
        payload: { doctorId: 'not-a-number' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /consultation ───────────────────────────────────────────

  describe('GET /consultation', () => {
    it('should list patient own consultations', async () => {
      sessionUser = patientUser;

      const consultations = [buildConsultation()];
      prisma.consultation.findMany.mockResolvedValue(consultations);
      prisma.consultation.count.mockResolvedValue(1);

      const res = await app.inject({
        method: 'GET',
        url: '/consultation',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.data).toHaveLength(1);
      expect(body.contents.total).toBe(1);
    });

    it('should list doctor assigned consultations', async () => {
      sessionUser = doctorUser;

      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      const consultations = [buildConsultation()];
      prisma.consultation.findMany.mockResolvedValue(consultations);
      prisma.consultation.count.mockResolvedValue(1);

      const res = await app.inject({
        method: 'GET',
        url: '/consultation',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.data).toHaveLength(1);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/consultation',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /consultation/:id ──────────────────────────────────────

  describe('GET /consultation/:id', () => {
    it('should return consultation for patient owner', async () => {
      sessionUser = patientUser;

      const consultation = buildConsultation();
      prisma.consultation.findUnique.mockResolvedValue(consultation);

      const res = await app.inject({
        method: 'GET',
        url: `/consultation/${consultationId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(consultationId);
      expect(body.contents.patientId).toBe(patientUser.id);
    });

    it('should reject non-owner patient', async () => {
      sessionUser = otherPatientUser;

      const consultation = buildConsultation();
      prisma.consultation.findUnique.mockResolvedValue(consultation);

      const res = await app.inject({
        method: 'GET',
        url: `/consultation/${consultationId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return consultation for admin', async () => {
      sessionUser = adminUser;

      const consultation = buildConsultation();
      prisma.consultation.findUnique.mockResolvedValue(consultation);

      const res = await app.inject({
        method: 'GET',
        url: `/consultation/${consultationId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(consultationId);
    });

    it('should return 404 for non-existent consultation', async () => {
      sessionUser = patientUser;

      prisma.consultation.findUnique.mockResolvedValue(null);

      const missingId = randomUuid();
      const res = await app.inject({
        method: 'GET',
        url: `/consultation/${missingId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─── PATCH /consultation/:id/decide ─────────────────────────────

  describe('PATCH /consultation/:id/decide', () => {
    it('should update status to DOCTOR_DECIDED', async () => {
      sessionUser = doctorUser;

      const consultation = buildConsultation({
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });
      // getByIdRaw — raw findUnique (no include)
      prisma.consultation.findUnique.mockResolvedValueOnce(consultation);
      // assertDoctorOwnership — doctorProfile lookup
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      // atomic CAS update
      const updated = buildConsultation({
        status: ConsultationStatusEnum.DOCTOR_DECIDED,
        doctorDecision: ConsultationModeEnum.ONLINE,
      });
      prisma.consultation.updateMany.mockResolvedValue({ count: 1 });
      prisma.consultation.findUniqueOrThrow.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PATCH',
        url: `/consultation/${consultationId}/decide`,
        payload: { doctorDecision: ConsultationModeEnum.ONLINE },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.status).toBe(
        ConsultationStatusEnum.DOCTOR_DECIDED,
      );
      expect(body.contents.doctorDecision).toBe(ConsultationModeEnum.ONLINE);
    });

    it('should reject non-doctor user', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/consultation/${consultationId}/decide`,
        payload: { doctorDecision: ConsultationModeEnum.ONLINE },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject wrong doctor', async () => {
      const otherDoctor = createMockDoctorUser();
      sessionUser = otherDoctor;

      const consultation = buildConsultation({
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });
      prisma.consultation.findUnique.mockResolvedValueOnce(consultation);

      // Doctor profile with a different id than consultation.doctorId
      const otherProfile = buildDoctorProfile({
        id: doctorProfileId + 100,
        userId: otherDoctor.id,
        verified: true,
      });
      prisma.doctorProfile.findUnique.mockResolvedValue(otherProfile);

      const res = await app.inject({
        method: 'PATCH',
        url: `/consultation/${consultationId}/decide`,
        payload: { doctorDecision: ConsultationModeEnum.ONLINE },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─── PATCH /consultation/:id/complete ───────────────────────────

  describe('PATCH /consultation/:id/complete', () => {
    it('should complete a consultation', async () => {
      sessionUser = doctorUser;

      const consultation = buildConsultation({
        status: ConsultationStatusEnum.IN_PROGRESS,
      });
      prisma.consultation.findUnique.mockResolvedValueOnce(consultation);
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);

      const completedAt = new Date();
      const updated = buildConsultation({
        status: ConsultationStatusEnum.COMPLETED,
        notes: 'Patient recovering',
        summary: 'Flu treatment',
        completedAt,
      });
      prisma.consultation.updateMany.mockResolvedValue({ count: 1 });
      prisma.consultation.findUniqueOrThrow.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PATCH',
        url: `/consultation/${consultationId}/complete`,
        payload: { notes: 'Patient recovering', summary: 'Flu treatment' },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.status).toBe(ConsultationStatusEnum.COMPLETED);
      expect(body.contents.notes).toBe('Patient recovering');
      expect(body.contents.summary).toBe('Flu treatment');
    });

    it('should reject from wrong status (PENDING_DOCTOR_REVIEW)', async () => {
      sessionUser = doctorUser;

      const consultation = buildConsultation({
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });
      prisma.consultation.findUnique.mockResolvedValueOnce(consultation);
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);

      const res = await app.inject({
        method: 'PATCH',
        url: `/consultation/${consultationId}/complete`,
        payload: { notes: 'notes', summary: 'summary' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /consultation/:id/cancel ─────────────────────────────

  describe('PATCH /consultation/:id/cancel', () => {
    it('should cancel from PENDING_DOCTOR_REVIEW (patient)', async () => {
      sessionUser = patientUser;

      const consultation = buildConsultation({
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });
      prisma.consultation.findUnique.mockResolvedValueOnce(consultation);

      const updated = buildConsultation({
        status: ConsultationStatusEnum.CANCELLED,
      });
      prisma.consultation.updateMany.mockResolvedValue({ count: 1 });
      prisma.consultation.findUniqueOrThrow.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PATCH',
        url: `/consultation/${consultationId}/cancel`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.status).toBe(ConsultationStatusEnum.CANCELLED);
    });

    it('should reject cancelling COMPLETED consultation', async () => {
      sessionUser = patientUser;

      const consultation = buildConsultation({
        status: ConsultationStatusEnum.COMPLETED,
      });
      prisma.consultation.findUnique.mockResolvedValueOnce(consultation);

      const res = await app.inject({
        method: 'PATCH',
        url: `/consultation/${consultationId}/cancel`,
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should allow admin to cancel any consultation', async () => {
      sessionUser = adminUser;

      const consultation = buildConsultation({
        status: ConsultationStatusEnum.IN_PROGRESS,
      });
      prisma.consultation.findUnique.mockResolvedValueOnce(consultation);

      const updated = buildConsultation({
        status: ConsultationStatusEnum.CANCELLED,
      });
      prisma.consultation.updateMany.mockResolvedValue({ count: 1 });
      prisma.consultation.findUniqueOrThrow.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PATCH',
        url: `/consultation/${consultationId}/cancel`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.status).toBe(ConsultationStatusEnum.CANCELLED);
    });
  });
});
