import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulingModule } from '../src/scheduling/scheduling.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { UtilsModule } from '../src/utils/utils.module';
import { AuthModule } from '../src/auth/auth.module';
import { UserModule } from '../src/user/user.module';
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
  MockUser,
} from './helpers/mock-session.helper';
import { randomUuid } from './helpers/test-data.factory';
import { AppointmentStatusEnum } from '@prisma/client';
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
    SchedulingModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

describe('Scheduling (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  const patientUser = createMockUser();
  const doctorUser = createMockDoctorUser();

  const mockDoctorProfile = {
    id: 1,
    userId: doctorUser.id,
    verified: true,
  };

  beforeAll(async () => {
    prisma = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(CalendlyService)
      .useValue({
        getAvailability: jest.fn().mockResolvedValue([]),
        syncEvents: jest.fn().mockResolvedValue(undefined),
        scheduleForAppointment: jest.fn().mockResolvedValue(undefined),
        cancelCalendlyEvent: jest.fn().mockResolvedValue(undefined),
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

  // ─── POST /scheduling/availability ───

  describe('POST /scheduling/availability', () => {
    it('should create availability as doctor', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorAvailability.create.mockResolvedValue({
        id: 1,
        doctorId: 1,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '17:00',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/availability',
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
    });

    it('should reject patient role', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/availability',
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/availability',
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /scheduling/availability ───

  describe('GET /scheduling/availability', () => {
    it('should return doctor availability', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorAvailability.findMany.mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/availability',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });
  });

  // ─── GET /scheduling/doctor/:doctorId/slots (public) ───

  describe('GET /scheduling/doctor/:doctorId/slots', () => {
    it('should return available slots for a doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorAvailability.findMany.mockResolvedValue([]);
      prisma.availabilityException.findMany.mockResolvedValue([]);
      prisma.appointment.findMany.mockResolvedValue([]);
      prisma.slotDuration.findMany.mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/doctor/1/slots?start=2026-07-01&end=2026-07-07',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });

    it('should return 400 for non-integer doctorId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/doctor/abc/slots?start=2026-07-01&end=2026-07-07',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /scheduling/doctor/:doctorId/durations (public) ───

  describe('GET /scheduling/doctor/:doctorId/durations', () => {
    it('should return slot durations', async () => {
      prisma.slotDuration.findMany.mockResolvedValue([
        { id: 1, doctorId: 1, minutes: 30, label: '30 min' },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/doctor/1/durations',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });
  });

  // ─── POST /scheduling/book ───

  describe('POST /scheduling/book', () => {
    it('should reject unauthenticated booking', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/book',
        payload: {
          doctorId: 1,
          date: '2026-07-15',
          startTime: '10:00',
          duration: 30,
        },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should reject doctor booking (patient only)', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/book',
        payload: {
          doctorId: 1,
          date: '2026-07-15',
          startTime: '10:00',
          duration: 30,
        },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─── GET /scheduling/appointments ───

  describe('GET /scheduling/appointments', () => {
    it('should list appointments for authenticated user', async () => {
      sessionUser = patientUser;
      prisma.appointment.findMany.mockResolvedValue([]);
      prisma.appointment.count.mockResolvedValue(0);

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/appointments',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });

    it('should reject unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/appointments',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /scheduling/appointments/:id ───

  describe('GET /scheduling/appointments/:id', () => {
    it('should return appointment by id', async () => {
      sessionUser = patientUser;
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        patientId: patientUser.id,
        doctorId: 1,
        status: AppointmentStatusEnum.CONFIRMED,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/appointments/1',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });

    it('should return 400 for non-integer id', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/appointments/abc',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /scheduling/appointments/:id/cancel ───

  describe('PATCH /scheduling/appointments/:id/cancel', () => {
    it('should cancel appointment for owner', async () => {
      sessionUser = patientUser;
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        patientId: patientUser.id,
        status: AppointmentStatusEnum.CONFIRMED,
      });
      prisma.appointment.updateMany.mockResolvedValue({ count: 1 });
      prisma.appointment.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        status: AppointmentStatusEnum.CANCELLED,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/scheduling/appointments/1/cancel',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });

    it('should reject unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: '/scheduling/appointments/1/cancel',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });
});
