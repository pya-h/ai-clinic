/**
 * Calendly E2E Tests
 *
 * Tests:
 *   POST /calendly/webhook            — valid invitee.created + invitee.canceled + invalid signature + missing signature
 *   GET  /calendly/event-types        — authenticated + unauthenticated
 *   GET  /calendly/appointment/:id/event — authenticated + unauthenticated + invalid ID
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
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { UtilsModule } from '../src/utils/utils.module';
import { CalendlyModule } from '../src/calendly/calendly.module';
import { CalendlyService } from '../src/calendly/calendly.service';
import { ExceptionTemplateFilter } from '../src/common/filters/exception-template.filter';
import { ResponseTemplateInterceptor } from '../src/common/interceptors/response-template.interceptor';
import {
  createMockPrismaService,
  MockPrismaService,
} from './helpers/mock-prisma.helper';
import { createMockUser, MockUser } from './helpers/mock-session.helper';
import { ScheduleModule } from '@nestjs/schedule';
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
    CalendlyModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

describe('Calendly (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  const mockCalendlyService = {
    verifyWebhookSignature: jest.fn(),
    handleWebhookEvent: jest.fn().mockResolvedValue(undefined),
    getEventTypes: jest.fn().mockResolvedValue([]),
    getCalendlyEventDetails: jest.fn().mockResolvedValue(null),
    isConfigured: jest.fn().mockReturnValue(true),
    findMatchingEventType: jest.fn().mockResolvedValue(null),
    scheduleForAppointment: jest.fn().mockResolvedValue(undefined),
    cancelCalendlyEvent: jest.fn().mockResolvedValue(undefined),
  };

  const validWebhookBody = {
    event: 'invitee.created',
    created_at: '2026-06-20T12:00:00.000000Z',
    created_by: 'https://api.calendly.com/users/USER_UUID',
    payload: {
      uri: 'https://api.calendly.com/scheduled_events/EVENT_UUID/invitees/INVITEE_UUID',
      email: 'patient@example.com',
      name: 'Test Patient',
      status: 'active',
      reschedule_url: 'https://calendly.com/reschedulings/RESCHEDULE_UUID',
      cancel_url: 'https://calendly.com/cancellations/CANCEL_UUID',
      event: 'https://api.calendly.com/scheduled_events/EVENT_UUID',
      created_at: '2026-06-20T12:00:00.000000Z',
      updated_at: '2026-06-20T12:00:00.000000Z',
    },
  };

  const cancelWebhookBody = {
    ...validWebhookBody,
    event: 'invitee.canceled',
    payload: {
      ...validWebhookBody.payload,
      status: 'canceled',
      cancellation: {
        canceled_by: 'Test Patient',
        reason: 'Schedule conflict',
      },
    },
  };

  beforeAll(async () => {
    prisma = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(CalendlyService)
      .useValue(mockCalendlyService)
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
    // Re-apply default mock return values after clearAllMocks
    mockCalendlyService.handleWebhookEvent.mockResolvedValue(undefined);
    mockCalendlyService.getEventTypes.mockResolvedValue([]);
    mockCalendlyService.getCalendlyEventDetails.mockResolvedValue(null);
    mockCalendlyService.isConfigured.mockReturnValue(true);
    mockCalendlyService.findMatchingEventType.mockResolvedValue(null);
    mockCalendlyService.scheduleForAppointment.mockResolvedValue(undefined);
    mockCalendlyService.cancelCalendlyEvent.mockResolvedValue(undefined);
  });

  // ─── POST /calendly/webhook ───

  describe('POST /calendly/webhook', () => {
    it('should accept valid invitee.created webhook with valid signature', async () => {
      mockCalendlyService.verifyWebhookSignature.mockReturnValue(true);

      const res = await app.inject({
        method: 'POST',
        url: '/calendly/webhook',
        payload: validWebhookBody,
        headers: {
          'calendly-webhook-signature': 't=1234567890,v1=abc123signature',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.received).toBe(true);
      expect(mockCalendlyService.verifyWebhookSignature).toHaveBeenCalledTimes(1);
      expect(mockCalendlyService.handleWebhookEvent).toHaveBeenCalledTimes(1);
    });

    it('should accept valid invitee.canceled webhook with valid signature', async () => {
      mockCalendlyService.verifyWebhookSignature.mockReturnValue(true);

      const res = await app.inject({
        method: 'POST',
        url: '/calendly/webhook',
        payload: cancelWebhookBody,
        headers: {
          'calendly-webhook-signature': 't=1234567890,v1=abc123signature',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.received).toBe(true);
      expect(mockCalendlyService.handleWebhookEvent).toHaveBeenCalledTimes(1);
    });

    it('should reject webhook with invalid signature', async () => {
      mockCalendlyService.verifyWebhookSignature.mockReturnValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/calendly/webhook',
        payload: validWebhookBody,
        headers: {
          'calendly-webhook-signature': 't=1234567890,v1=invalidsignature',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
      expect(mockCalendlyService.handleWebhookEvent).not.toHaveBeenCalled();
    });

    it('should reject webhook with missing signature header', async () => {
      mockCalendlyService.verifyWebhookSignature.mockReturnValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/calendly/webhook',
        payload: validWebhookBody,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
      expect(mockCalendlyService.handleWebhookEvent).not.toHaveBeenCalled();
    });

    it('should reject webhook with invalid event type', async () => {
      mockCalendlyService.verifyWebhookSignature.mockReturnValue(true);

      const res = await app.inject({
        method: 'POST',
        url: '/calendly/webhook',
        payload: {
          ...validWebhookBody,
          event: 'unknown.event',
        },
        headers: {
          'calendly-webhook-signature': 't=1234567890,v1=abc123signature',
        },
      });

      // ValidationPipe rejects unknown event values (IsIn constraint)
      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject webhook with missing event field', async () => {
      mockCalendlyService.verifyWebhookSignature.mockReturnValue(true);

      const { event, ...noEvent } = validWebhookBody;

      const res = await app.inject({
        method: 'POST',
        url: '/calendly/webhook',
        payload: noEvent,
        headers: {
          'calendly-webhook-signature': 't=1234567890,v1=abc123signature',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject webhook with missing payload field', async () => {
      mockCalendlyService.verifyWebhookSignature.mockReturnValue(true);

      const { payload, ...noPayload } = validWebhookBody;

      const res = await app.inject({
        method: 'POST',
        url: '/calendly/webhook',
        payload: noPayload,
        headers: {
          'calendly-webhook-signature': 't=1234567890,v1=abc123signature',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject webhook with empty body', async () => {
      mockCalendlyService.verifyWebhookSignature.mockReturnValue(true);

      const res = await app.inject({
        method: 'POST',
        url: '/calendly/webhook',
        payload: {},
        headers: {
          'calendly-webhook-signature': 't=1234567890,v1=abc123signature',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /calendly/event-types ───

  describe('GET /calendly/event-types', () => {
    it('should return event types for authenticated user', async () => {
      sessionUser = createMockUser();

      const mockEventTypes = [
        {
          uri: 'https://api.calendly.com/event_types/TYPE_1',
          name: '30 Minute Video Consultation',
          slug: '30-min-video',
          active: true,
          kind: 'solo',
          duration: 30,
          type: 'StandardEventType',
          scheduling_url: 'https://calendly.com/clinic/30-min-video',
        },
        {
          uri: 'https://api.calendly.com/event_types/TYPE_2',
          name: '60 Minute In-Person Visit',
          slug: '60-min-inperson',
          active: true,
          kind: 'solo',
          duration: 60,
          type: 'StandardEventType',
          scheduling_url: 'https://calendly.com/clinic/60-min-inperson',
        },
      ];
      mockCalendlyService.getEventTypes.mockResolvedValue(mockEventTypes);

      const res = await app.inject({
        method: 'GET',
        url: '/calendly/event-types',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents).toHaveLength(2);
      expect(body.contents[0].name).toBe('30 Minute Video Consultation');
      expect(body.contents[1].duration).toBe(60);
      expect(mockCalendlyService.getEventTypes).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no event types exist', async () => {
      sessionUser = createMockUser();
      mockCalendlyService.getEventTypes.mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/calendly/event-types',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toEqual([]);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/calendly/event-types',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
      expect(mockCalendlyService.getEventTypes).not.toHaveBeenCalled();
    });
  });

  // ─── GET /calendly/appointment/:id/event ───

  describe('GET /calendly/appointment/:id/event', () => {
    it('should return event details for valid appointment', async () => {
      sessionUser = createMockUser();

      const mockEventDetails = {
        uri: 'https://api.calendly.com/scheduled_events/EVENT_UUID',
        name: '30 Minute Video Consultation',
        status: 'active',
        start_time: '2026-06-25T10:00:00.000000Z',
        end_time: '2026-06-25T10:30:00.000000Z',
        event_type: 'https://api.calendly.com/event_types/TYPE_1',
        location: {
          type: 'google_conference',
          join_url: 'https://meet.google.com/abc-defg-hij',
        },
        invitees_counter: { total: 1, active: 1, limit: 1 },
        created_at: '2026-06-20T12:00:00.000000Z',
        updated_at: '2026-06-20T12:00:00.000000Z',
        event_memberships: [{ user: 'https://api.calendly.com/users/USER_UUID' }],
      };
      mockCalendlyService.getCalendlyEventDetails.mockResolvedValue(mockEventDetails);

      const res = await app.inject({
        method: 'GET',
        url: '/calendly/appointment/42/event',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.status).toBe('active');
      expect(body.contents.start_time).toBe('2026-06-25T10:00:00.000000Z');
      expect(mockCalendlyService.getCalendlyEventDetails).toHaveBeenCalledWith(42);
    });

    it('should return null contents when no Calendly event is linked', async () => {
      sessionUser = createMockUser();
      mockCalendlyService.getCalendlyEventDetails.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/calendly/appointment/99/event',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeNull();
      expect(mockCalendlyService.getCalendlyEventDetails).toHaveBeenCalledWith(99);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/calendly/appointment/42/event',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
      expect(mockCalendlyService.getCalendlyEventDetails).not.toHaveBeenCalled();
    });

    it('should reject non-integer appointment ID', async () => {
      sessionUser = createMockUser();

      const res = await app.inject({
        method: 'GET',
        url: '/calendly/appointment/not-a-number/event',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(mockCalendlyService.getCalendlyEventDetails).not.toHaveBeenCalled();
    });

    it('should reject float appointment ID', async () => {
      sessionUser = createMockUser();

      const res = await app.inject({
        method: 'GET',
        url: '/calendly/appointment/3.14/event',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(mockCalendlyService.getCalendlyEventDetails).not.toHaveBeenCalled();
    });
  });
});
