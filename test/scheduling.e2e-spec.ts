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
      const body = res.json();
      expect(body.contents).toBeDefined();
      expect(body.contents.dayOfWeek).toBe(1);
      expect(body.contents.startTime).toBe('09:00');
      expect(body.contents.endTime).toBe('17:00');
      expect(body.contents.doctorId).toBe(1);
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
      const body = res.json();
      expect(body.contents).toBeDefined();
      expect(Array.isArray(body.contents)).toBe(true);
      expect(body.contents).toHaveLength(0);
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
      const body = res.json();
      expect(body.contents).toBeDefined();
      expect(Array.isArray(body.contents)).toBe(true);
    });

    it('should exclude a slot booked later on a single-day range', async () => {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 1 + Math.floor(Math.random() * 30));
      const date = day.toISOString().slice(0, 10);
      const bookedHour = 9 + Math.floor(Math.random() * 7);
      const booked = `${String(bookedHour).padStart(2, '0')}:00`;

      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: day.getUTCDay(), startTime: '09:00', endTime: '16:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([{ minutes: 60, isActive: true }]);
      prisma.availabilityException.findMany.mockResolvedValue([]);
      prisma.appointment.findMany.mockResolvedValue([
        {
          dateTime: new Date(`${date}T${booked}:00.000Z`),
          durationMinutes: 60,
          status: AppointmentStatusEnum.CONFIRMED,
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: `/scheduling/doctor/1/slots?start=${date}&end=${date}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const startTimes = res.json().contents.map((s: { startTime: string }) => s.startTime);
      expect(startTimes).toHaveLength(6);
      expect(startTimes).not.toContain(booked);

      const nextDay = new Date(`${date}T00:00:00.000Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      expect(prisma.appointment.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          dateTime: { gte: new Date(`${date}T00:00:00.000Z`), lt: nextDay },
        }),
      });
    });

    it('should return 404 for an unverified doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({ ...mockDoctorProfile, verified: false });

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/doctor/1/slots?start=2026-07-01&end=2026-07-07',
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it.each([
      ['end before start', 'start=2026-07-07&end=2026-07-01'],
      ['range over 31 days', 'start=2026-07-01&end=2026-08-15'],
      ['invalid date', 'start=not-a-date&end=2026-07-07'],
      ['missing end', 'start=2026-07-01'],
    ])('should return 400 for %s', async (_case, query) => {
      const res = await app.inject({
        method: 'GET',
        url: `/scheduling/doctor/1/slots?${query}`,
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    });

    it('should return 400 for non-integer doctorId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/doctor/abc/slots?start=2026-07-01&end=2026-07-07',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    // Loosely validated, these rolled over (2026-02-30 → March 2) and listed another day's slots.
    it.each([
      ['start=2026-02-30&end=2026-03-05'],
      ['start=2026-04-01&end=2026-04-31'],
      ['start=2027-02-29&end=2027-03-01'],
    ])('should return 400 for a date that does not exist (%s)', async (query) => {
      const res = await app.inject({ method: 'GET', url: `/scheduling/doctor/1/slots?${query}` });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.doctorProfile.findUnique).not.toHaveBeenCalled();
    });

    it('should accept a leap day that exists', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({ id: 1, verified: true });
      prisma.doctorAvailability.findMany.mockResolvedValue([]);

      const res = await app.inject({ method: 'GET', url: '/scheduling/doctor/1/slots?start=2028-02-29&end=2028-03-01' });

      expect(res.statusCode).toBe(HttpStatus.OK);
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
      const body = res.json();
      expect(body.contents).toBeDefined();
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].minutes).toBe(30);
      expect(body.contents[0].label).toBe('30 min');
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

    it.each(['2030-04-31T10:00:00.000Z', '2031-02-29T09:30:00Z'])(
      'should return 400 for a dateTime that does not exist (%s) instead of booking another day',
      async (dateTime) => {
        sessionUser = patientUser;

        const res = await app.inject({
          method: 'POST',
          url: '/scheduling/book',
          payload: { doctorId: 1, dateTime, durationMinutes: 30, price: 50, method: 'CHAT' },
        });

        expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
        // Refused by validation, before the service looks anything up.
        expect(prisma.doctorProfile.findUnique).not.toHaveBeenCalled();
        expect(prisma.appointment.create).not.toHaveBeenCalled();
      },
    );
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
      const body = res.json();
      expect(body.contents).toBeDefined();
      expect(body.contents.data).toHaveLength(0);
      expect(body.contents.total).toBe(0);
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
      const body = res.json();
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(1);
      expect(body.contents.status).toBe(AppointmentStatusEnum.CONFIRMED);
      expect(body.contents.patientId).toBe(patientUser.id);
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
      const body = res.json();
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(1);
      expect(body.contents.status).toBe(AppointmentStatusEnum.CANCELLED);
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

  // ─── PATCH /scheduling/availability/:id ───

  describe('PATCH /scheduling/availability/:id', () => {
    const mockAvailability = {
      id: 10,
      doctorId: 1,
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '17:00',
      isActive: true,
    };

    it('should update availability as doctor', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorAvailability.findUnique.mockResolvedValue(mockAvailability);
      prisma.doctorAvailability.update.mockResolvedValue({
        ...mockAvailability,
        endTime: '18:00',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/scheduling/availability/10',
        payload: { endTime: '18:00' },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = res.json();
      expect(body.contents.endTime).toBe('18:00');
      expect(body.contents.doctorId).toBe(1);
    });

    it('should return 404 for non-existent availability', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorAvailability.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PATCH',
        url: '/scheduling/availability/999',
        payload: { endTime: '18:00' },
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should reject when doctor does not own the availability', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorAvailability.findUnique.mockResolvedValue({
        ...mockAvailability,
        doctorId: 999,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/scheduling/availability/10',
        payload: { endTime: '18:00' },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject patient role', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'PATCH',
        url: '/scheduling/availability/10',
        payload: { endTime: '18:00' },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: '/scheduling/availability/10',
        payload: { endTime: '18:00' },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── DELETE /scheduling/availability/:id ───

  describe('DELETE /scheduling/availability/:id', () => {
    const mockAvailability = {
      id: 10,
      doctorId: 1,
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '17:00',
      isActive: true,
    };

    it('should delete availability as doctor', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorAvailability.findUnique.mockResolvedValue(mockAvailability);
      prisma.doctorAvailability.delete.mockResolvedValue(mockAvailability);

      const res = await app.inject({
        method: 'DELETE',
        url: '/scheduling/availability/10',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = res.json();
      expect(body.status).toBe(200);
      expect(prisma.doctorAvailability.delete).toHaveBeenCalled();
    });

    it('should return 404 for non-existent availability', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorAvailability.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'DELETE',
        url: '/scheduling/availability/999',
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should reject when doctor does not own the availability', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorAvailability.findUnique.mockResolvedValue({
        ...mockAvailability,
        doctorId: 999,
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/scheduling/availability/10',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'DELETE',
        url: '/scheduling/availability/10',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── POST /scheduling/slot-durations ───

  describe('POST /scheduling/slot-durations', () => {
    it('should create slot duration as doctor', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.slotDuration.create.mockResolvedValue({
        id: 1,
        doctorId: 1,
        minutes: 30,
        price: 50,
        label: 'Quick Check-Up',
        isActive: true,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/slot-durations',
        payload: { minutes: 30, price: 50, label: 'Quick Check-Up' },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = res.json();
      expect(body.contents.minutes).toBe(30);
      expect(body.contents.price).toBe(50);
      expect(body.contents.label).toBe('Quick Check-Up');
    });

    it('should reject invalid minutes (below min)', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/slot-durations',
        payload: { minutes: 2, price: 50 },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject patient role', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/slot-durations',
        payload: { minutes: 30, price: 50 },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/slot-durations',
        payload: { minutes: 30, price: 50 },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /scheduling/slot-durations ───

  describe('GET /scheduling/slot-durations', () => {
    it('should return own slot durations as doctor', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.slotDuration.findMany.mockResolvedValue([
        { id: 1, doctorId: 1, minutes: 30, price: 50, label: '30 min', isActive: true },
        { id: 2, doctorId: 1, minutes: 60, price: 90, label: '60 min', isActive: true },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/slot-durations',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = res.json();
      expect(body.contents).toHaveLength(2);
      expect(body.contents[0].minutes).toBe(30);
      expect(body.contents[1].minutes).toBe(60);
    });

    it('should reject patient role', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/slot-durations',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/slot-durations',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── POST /scheduling/exceptions ───

  describe('POST /scheduling/exceptions', () => {
    it('should create a full-day exception as doctor', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.availabilityException.create.mockResolvedValue({
        id: 1,
        doctorId: 1,
        date: new Date('2026-08-15'),
        isBlocked: true,
        startTime: null,
        endTime: null,
        reason: 'Vacation',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/exceptions',
        payload: { date: '2026-08-15', isBlocked: true, reason: 'Vacation' },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = res.json();
      expect(body.contents.isBlocked).toBe(true);
      expect(body.contents.reason).toBe('Vacation');
    });

    it('should create a partial-day exception with times', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.availabilityException.create.mockResolvedValue({
        id: 2,
        doctorId: 1,
        date: new Date('2026-08-20'),
        isBlocked: false,
        startTime: '09:00',
        endTime: '12:00',
        reason: 'Half day',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/exceptions',
        payload: {
          date: '2026-08-20',
          isBlocked: false,
          startTime: '09:00',
          endTime: '12:00',
          reason: 'Half day',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = res.json();
      expect(body.contents.isBlocked).toBe(false);
      expect(body.contents.startTime).toBe('09:00');
      expect(body.contents.endTime).toBe('12:00');
    });

    it('should reject patient role', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/exceptions',
        payload: { date: '2026-08-15' },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/scheduling/exceptions',
        payload: { date: '2026-08-15' },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /scheduling/exceptions ───

  describe('GET /scheduling/exceptions', () => {
    it('should return own exceptions as doctor', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.availabilityException.findMany.mockResolvedValue([
        {
          id: 1,
          doctorId: 1,
          date: new Date('2026-08-15'),
          isBlocked: true,
          startTime: null,
          endTime: null,
          reason: 'Vacation',
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/exceptions',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = res.json();
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].isBlocked).toBe(true);
      expect(body.contents[0].reason).toBe('Vacation');
    });

    it('should reject patient role', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/exceptions',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/scheduling/exceptions',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── DELETE /scheduling/exceptions/:id ───

  describe('DELETE /scheduling/exceptions/:id', () => {
    const mockException = {
      id: 5,
      doctorId: 1,
      date: new Date('2026-08-15'),
      isBlocked: true,
      startTime: null,
      endTime: null,
      reason: 'Vacation',
    };

    it('should delete exception as doctor', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.availabilityException.findUnique.mockResolvedValue(mockException);
      prisma.availabilityException.delete.mockResolvedValue(mockException);

      const res = await app.inject({
        method: 'DELETE',
        url: '/scheduling/exceptions/5',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = res.json();
      expect(body.status).toBe(200);
      expect(prisma.availabilityException.delete).toHaveBeenCalled();
    });

    it('should return 404 for non-existent exception', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.availabilityException.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'DELETE',
        url: '/scheduling/exceptions/999',
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should reject when doctor does not own the exception', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.availabilityException.findUnique.mockResolvedValue({
        ...mockException,
        doctorId: 999,
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/scheduling/exceptions/5',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'DELETE',
        url: '/scheduling/exceptions/5',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });
});
