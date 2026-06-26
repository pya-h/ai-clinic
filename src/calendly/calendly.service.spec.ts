import { Test, TestingModule } from '@nestjs/testing';
import { CalendlyService } from './calendly.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/helpers/mock-prisma.helper';
import {
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AppointmentStatusEnum, VisitMethodsEnum } from '@prisma/client';
import * as crypto from 'crypto';

const mockConfig = new Map<string, string>([
  ['calendly.apiKey', 'test-api-key'],
  ['calendly.organizationUri', 'https://api.calendly.com/organizations/test-org'],
  ['calendly.webhookSigningKey', 'test-signing-key'],
  ['calendly.userUri', 'https://api.calendly.com/users/test-user'],
]);

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
};

const sampleEventTypes = [
  {
    uri: 'https://api.calendly.com/event_types/et-video-30',
    name: 'Video Consultation (30 min)',
    slug: 'video-30',
    active: true,
    kind: 'solo' as const,
    duration: 30,
    type: 'StandardEventType' as const,
    scheduling_url: 'https://calendly.com/doctor/video-30',
  },
  {
    uri: 'https://api.calendly.com/event_types/et-phone-15',
    name: 'Phone Call (15 min)',
    slug: 'phone-15',
    active: true,
    kind: 'solo' as const,
    duration: 15,
    type: 'StandardEventType' as const,
    scheduling_url: 'https://calendly.com/doctor/phone-15',
  },
  {
    uri: 'https://api.calendly.com/event_types/et-office-60',
    name: 'In-Person Office Visit (60 min)',
    slug: 'office-60',
    active: true,
    kind: 'solo' as const,
    duration: 60,
    type: 'StandardEventType' as const,
    scheduling_url: 'https://calendly.com/doctor/office-60',
  },
  {
    uri: 'https://api.calendly.com/event_types/et-generic-30',
    name: 'General Appointment (30 min)',
    slug: 'general-30',
    active: true,
    kind: 'solo' as const,
    duration: 30,
    type: 'StandardEventType' as const,
    scheduling_url: 'https://calendly.com/doctor/general-30',
  },
  {
    uri: 'https://api.calendly.com/event_types/et-inactive',
    name: 'Inactive Type',
    slug: 'inactive',
    active: false,
    kind: 'solo' as const,
    duration: 30,
    type: 'StandardEventType' as const,
    scheduling_url: 'https://calendly.com/doctor/inactive',
  },
];

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('CalendlyService', () => {
  let service: CalendlyService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    mockCache.get.mockReset();
    mockCache.set.mockReset();
    mockFetch.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendlyService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => mockConfig.get(key) },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<CalendlyService>(CalendlyService);
  });

  // ──────────────── isConfigured ────────────────

  describe('isConfigured', () => {
    it('should return true when apiKey and organizationUri are set', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('should return false when missing config', async () => {
      const module = await Test.createTestingModule({
        providers: [
          CalendlyService,
          { provide: ConfigService, useValue: { get: (): any => undefined } },
          { provide: PrismaService, useValue: prisma },
          { provide: CacheService, useValue: mockCache },
        ],
      }).compile();
      const svc = module.get<CalendlyService>(CalendlyService);
      expect(svc.isConfigured()).toBe(false);
    });
  });

  // ──────────────── getEventTypes ────────────────

  describe('getEventTypes', () => {
    it('should return cached event types if available', async () => {
      mockCache.get.mockResolvedValue(sampleEventTypes);
      const result = await service.getEventTypes();
      expect(result).toBe(sampleEventTypes);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fetch from API when cache misses and cache the result', async () => {
      mockCache.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          collection: sampleEventTypes,
          pagination: { count: 5, next_page: null as null, previous_page: null as null, next_page_token: null as null },
        }),
      });

      const result = await service.getEventTypes();
      expect(result).toEqual(sampleEventTypes);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockCache.set).toHaveBeenCalledWith(
        'calendly',
        'event-types',
        sampleEventTypes,
        3600000,
      );
    });

    it('should throw InternalServerErrorException on API failure', async () => {
      mockCache.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(service.getEventTypes()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ──────────────── findMatchingEventType ────────────────

  describe('findMatchingEventType', () => {
    beforeEach(() => {
      mockCache.get.mockResolvedValue(sampleEventTypes);
    });

    it('should match VIDEO_CALL to video event type by keyword + duration', async () => {
      const result = await service.findMatchingEventType(VisitMethodsEnum.VIDEO_CALL, 30);
      expect(result?.slug).toBe('video-30');
    });

    it('should match VOICE_CALL to phone event type by keyword + duration', async () => {
      const result = await service.findMatchingEventType(VisitMethodsEnum.VOICE_CALL, 15);
      expect(result?.slug).toBe('phone-15');
    });

    it('should match ON_SITE to office event type by keyword + duration', async () => {
      const result = await service.findMatchingEventType(VisitMethodsEnum.ON_SITE, 60);
      expect(result?.slug).toBe('office-60');
    });

    it('should fall back to duration-only match when no keyword matches', async () => {
      const result = await service.findMatchingEventType(VisitMethodsEnum.CHAT, 30);
      expect(result).not.toBeNull();
      expect(result!.duration).toBe(30);
    });

    it('should return null when no matching duration exists', async () => {
      const result = await service.findMatchingEventType(VisitMethodsEnum.VIDEO_CALL, 120);
      expect(result).toBeNull();
    });

    it('should not match inactive event types by keyword', async () => {
      const result = await service.findMatchingEventType(VisitMethodsEnum.VIDEO_CALL, 30);
      expect(result?.slug).not.toBe('inactive');
    });
  });

  // ──────────────── scheduleForAppointment ────────────────

  describe('scheduleForAppointment', () => {
    const appointment = {
      id: 1,
      method: VisitMethodsEnum.VIDEO_CALL,
      durationMinutes: 30,
      calendlyEventUri: null as null,
      patient: { id: 'p1', email: 'patient@test.com', firstname: 'John', lastname: 'Doe' },
      doctor: { user: { email: 'doc@test.com', firstname: 'Dr', lastname: 'Smith' } },
    };

    it('should skip when not configured', async () => {
      const module = await Test.createTestingModule({
        providers: [
          CalendlyService,
          { provide: ConfigService, useValue: { get: (): any => undefined } },
          { provide: PrismaService, useValue: prisma },
          { provide: CacheService, useValue: mockCache },
        ],
      }).compile();
      const svc = module.get<CalendlyService>(CalendlyService);

      await svc.scheduleForAppointment(1);
      expect(prisma.appointment.findUnique).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when appointment not found', async () => {
      prisma.appointment.findUnique.mockResolvedValue(null);
      await expect(service.scheduleForAppointment(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should skip when appointment already has a Calendly event', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        ...appointment,
        calendlyEventUri: 'https://api.calendly.com/events/existing',
      });
      mockCache.get.mockResolvedValue(sampleEventTypes);

      await service.scheduleForAppointment(1);
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('should create scheduling link with UTM tracking and update appointment', async () => {
      prisma.appointment.findUnique.mockResolvedValue(appointment);
      mockCache.get.mockResolvedValue(sampleEventTypes);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          resource: {
            booking_url: 'https://calendly.com/d/abc123',
            owner: sampleEventTypes[0].uri,
            owner_type: 'EventType',
          },
        }),
      });

      await service.scheduleForAppointment(1);

      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          calendlyEventUri: 'https://calendly.com/d/abc123?utm_content=apt_1',
        },
      });
    });

    it('should skip when no matching event type found', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        ...appointment,
        durationMinutes: 999,
      });
      mockCache.get.mockResolvedValue(sampleEventTypes);

      await service.scheduleForAppointment(1);
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });
  });

  // ──────────────── verifyWebhookSignature ────────────────

  describe('verifyWebhookSignature', () => {
    it('should verify a valid signature', () => {
      const timestamp = '1234567890';
      const body = '{"event":"invitee.created"}';
      const data = `${timestamp}.${body}`;
      const hmac = crypto
        .createHmac('sha256', 'test-signing-key')
        .update(data)
        .digest('hex');
      const signature = `t=${timestamp},v1=${hmac}`;

      expect(service.verifyWebhookSignature(body, signature, timestamp)).toBe(true);
    });

    it('should reject an invalid signature', () => {
      expect(
        service.verifyWebhookSignature('body', 't=123,v1=invalid', '123'),
      ).toBe(false);
    });

    it('should reject when no v1 prefix in signature', () => {
      expect(
        service.verifyWebhookSignature('body', 't=123,bad=hmac', '123'),
      ).toBe(false);
    });

    it('should return false when signing key is empty', async () => {
      const module = await Test.createTestingModule({
        providers: [
          CalendlyService,
          {
            provide: ConfigService,
            useValue: {
              get: (key: string) => {
                if (key === 'calendly.webhookSigningKey') return '';
                return mockConfig.get(key);
              },
            },
          },
          { provide: PrismaService, useValue: prisma },
          { provide: CacheService, useValue: mockCache },
        ],
      }).compile();
      const svc = module.get<CalendlyService>(CalendlyService);

      expect(svc.verifyWebhookSignature('body', 'sig', '123')).toBe(false);
    });
  });

  // ──────────────── handleWebhookEvent ────────────────

  describe('handleWebhookEvent', () => {
    describe('invitee.created', () => {
      it('should confirm appointment via UTM tracking param', async () => {
        const eventUri = 'https://api.calendly.com/scheduled_events/evt-123';
        prisma.appointment.findUnique.mockResolvedValue({
          id: 5,
          status: AppointmentStatusEnum.PENDING,
          calendlyEventUri: 'https://calendly.com/d/abc?utm_content=apt_5',
        });

        await service.handleWebhookEvent({
          event: 'invitee.created',
          created_at: '2026-06-01T00:00:00Z',
          created_by: 'calendly',
          payload: {
            uri: 'https://api.calendly.com/invitees/inv-456',
            email: 'patient@test.com',
            name: 'John Doe',
            status: 'active',
            reschedule_url: 'https://calendly.com/rescheduling/inv-456',
            cancel_url: 'https://calendly.com/cancellations/inv-456',
            event: eventUri,
            created_at: '2026-06-01T00:00:00Z',
            updated_at: '2026-06-01T00:00:00Z',
            tracking: { utm_content: 'apt_5' },
          },
        });

        expect(prisma.appointment.findUnique).toHaveBeenCalledWith({ where: { id: 5 } });
        expect(prisma.appointment.update).toHaveBeenCalledWith({
          where: { id: 5 },
          data: {
            calendlyEventUri: eventUri,
            calendlyInviteeUri: 'https://api.calendly.com/invitees/inv-456',
            calendlyRescheduleUrl: 'https://calendly.com/rescheduling/inv-456',
            calendlyCancelUrl: 'https://calendly.com/cancellations/inv-456',
            status: AppointmentStatusEnum.CONFIRMED,
          },
        });
      });

      it('should fall back to event URI lookup when no UTM tracking', async () => {
        const eventUri = 'https://api.calendly.com/scheduled_events/evt-123';
        prisma.appointment.findUnique.mockResolvedValue(null);
        prisma.appointment.findFirst.mockResolvedValue({
          id: 5,
          status: AppointmentStatusEnum.PENDING,
          calendlyEventUri: eventUri,
        });

        await service.handleWebhookEvent({
          event: 'invitee.created',
          created_at: '2026-06-01T00:00:00Z',
          created_by: 'calendly',
          payload: {
            uri: 'https://api.calendly.com/invitees/inv-456',
            email: 'patient@test.com',
            name: 'John Doe',
            status: 'active',
            reschedule_url: 'https://calendly.com/rescheduling/inv-456',
            cancel_url: 'https://calendly.com/cancellations/inv-456',
            event: eventUri,
            created_at: '2026-06-01T00:00:00Z',
            updated_at: '2026-06-01T00:00:00Z',
          },
        });

        expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
          where: { calendlyEventUri: eventUri },
        });
        expect(prisma.appointment.update).toHaveBeenCalled();
      });

      it('should do nothing if no matching appointment found', async () => {
        prisma.appointment.findUnique.mockResolvedValue(null);
        prisma.appointment.findFirst.mockResolvedValue(null);

        await service.handleWebhookEvent({
          event: 'invitee.created',
          created_at: '2026-06-01T00:00:00Z',
          created_by: 'calendly',
          payload: {
            uri: 'inv-uri',
            email: 'x@x.com',
            name: 'X',
            status: 'active',
            reschedule_url: '',
            cancel_url: '',
            event: 'unknown-event',
            created_at: '2026-06-01T00:00:00Z',
            updated_at: '2026-06-01T00:00:00Z',
          },
        });

        expect(prisma.appointment.update).not.toHaveBeenCalled();
      });
    });

    describe('invitee.canceled', () => {
      it('should cancel appointment on invitee canceled', async () => {
        const eventUri = 'https://api.calendly.com/scheduled_events/evt-789';
        prisma.appointment.findFirst.mockResolvedValue({
          id: 10,
          status: AppointmentStatusEnum.CONFIRMED,
          calendlyEventUri: eventUri,
        });

        await service.handleWebhookEvent({
          event: 'invitee.canceled',
          created_at: '2026-06-01T00:00:00Z',
          created_by: 'calendly',
          payload: {
            uri: 'inv-uri',
            email: 'patient@test.com',
            name: 'John Doe',
            status: 'canceled',
            reschedule_url: '',
            cancel_url: '',
            event: eventUri,
            created_at: '2026-06-01T00:00:00Z',
            updated_at: '2026-06-01T00:00:00Z',
          },
        });

        expect(prisma.appointment.update).toHaveBeenCalledWith({
          where: { id: 10 },
          data: { status: AppointmentStatusEnum.CANCELLED },
        });
      });

      it('should skip if appointment already cancelled', async () => {
        prisma.appointment.findFirst.mockResolvedValue({
          id: 10,
          status: AppointmentStatusEnum.CANCELLED,
          calendlyEventUri: 'event-uri',
        });

        await service.handleWebhookEvent({
          event: 'invitee.canceled',
          created_at: '2026-06-01T00:00:00Z',
          created_by: 'calendly',
          payload: {
            uri: 'inv-uri',
            email: 'patient@test.com',
            name: 'John Doe',
            status: 'canceled',
            reschedule_url: '',
            cancel_url: '',
            event: 'event-uri',
            created_at: '2026-06-01T00:00:00Z',
            updated_at: '2026-06-01T00:00:00Z',
          },
        });

        expect(prisma.appointment.update).not.toHaveBeenCalled();
      });
    });

    it('should handle unknown event types gracefully', async () => {
      await expect(
        service.handleWebhookEvent({
          event: 'routing_form_submission.created' as any,
          created_at: '2026-06-01T00:00:00Z',
          created_by: 'calendly',
          payload: {} as any,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ──────────────── cancelCalendlyEvent ────────────────

  describe('cancelCalendlyEvent', () => {
    it('should skip when not configured', async () => {
      const module = await Test.createTestingModule({
        providers: [
          CalendlyService,
          { provide: ConfigService, useValue: { get: (): any => undefined } },
          { provide: PrismaService, useValue: prisma },
          { provide: CacheService, useValue: mockCache },
        ],
      }).compile();
      const svc = module.get<CalendlyService>(CalendlyService);

      await svc.cancelCalendlyEvent(1);
      expect(prisma.appointment.findUnique).not.toHaveBeenCalled();
    });

    it('should skip when appointment has no Calendly event', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        calendlyEventUri: null as null,
      });

      await service.cancelCalendlyEvent(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should skip when calendlyEventUri is a booking URL (not yet confirmed)', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        calendlyEventUri: 'https://calendly.com/d/abc?utm_content=apt_1',
      });

      await service.cancelCalendlyEvent(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should cancel the event directly via Calendly API', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        calendlyEventUri: 'https://api.calendly.com/scheduled_events/evt-abc',
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            resource: { status: 'active', uri: 'https://api.calendly.com/scheduled_events/evt-abc' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
        });

      await service.cancelCalendlyEvent(1, 'Test reason');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const cancelCall = mockFetch.mock.calls[1];
      expect(cancelCall[0]).toContain('/scheduled_events/evt-abc/cancellation');
      expect(JSON.parse(cancelCall[1].body)).toEqual({ reason: 'Test reason' });
    });

    it('should skip already canceled Calendly events', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        calendlyEventUri: 'https://api.calendly.com/scheduled_events/evt-abc',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          resource: { status: 'canceled' },
        }),
      });

      await service.cancelCalendlyEvent(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors gracefully', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        calendlyEventUri: 'https://api.calendly.com/scheduled_events/evt-abc',
      });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.cancelCalendlyEvent(1)).resolves.toBeUndefined();
    });
  });

  // ──────────────── getCalendlyEventDetails ────────────────

  describe('getCalendlyEventDetails', () => {
    it('should return null when not configured', async () => {
      const module = await Test.createTestingModule({
        providers: [
          CalendlyService,
          { provide: ConfigService, useValue: { get: (): any => undefined } },
          { provide: PrismaService, useValue: prisma },
          { provide: CacheService, useValue: mockCache },
        ],
      }).compile();
      const svc = module.get<CalendlyService>(CalendlyService);

      expect(await svc.getCalendlyEventDetails(1)).toBeNull();
    });

    it('should return null when appointment has no Calendly event', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        calendlyEventUri: null as null,
      });

      expect(await service.getCalendlyEventDetails(1)).toBeNull();
    });

    it('should return null when calendlyEventUri is a booking URL', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        calendlyEventUri: 'https://calendly.com/d/abc?utm_content=apt_1',
      });

      expect(await service.getCalendlyEventDetails(1)).toBeNull();
    });

    it('should return event details from Calendly API', async () => {
      const eventData = {
        uri: 'https://api.calendly.com/scheduled_events/evt-abc',
        name: 'Video Call',
        status: 'active',
        start_time: '2026-06-01T10:00:00Z',
        end_time: '2026-06-01T10:30:00Z',
      };

      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        calendlyEventUri: 'https://api.calendly.com/scheduled_events/evt-abc',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ resource: eventData }),
      });

      const result = await service.getCalendlyEventDetails(1);
      expect(result).toEqual(eventData);
    });

    it('should return null on API error', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        calendlyEventUri: 'https://api.calendly.com/scheduled_events/evt-abc',
      });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      expect(await service.getCalendlyEventDetails(1)).toBeNull();
    });
  });
});
