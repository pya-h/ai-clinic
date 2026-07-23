import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AppointmentStatusEnum, User, VisitMethodsEnum } from '@prisma/client';
import {
  CalendlyEventType,
  CalendlyEventTypeListResponse,
  CalendlyScheduledEvent,
  CalendlySchedulingLink,
  CalendlyWebhookEvent,
} from './types/calendly.types';
import * as crypto from 'crypto';

const CACHE_GROUP = 'calendly';
const EVENT_TYPES_KEY = 'event-types';
const EVENT_TYPES_TTL = 60 * 60 * 1000; // 1 hour

@Injectable()
export class CalendlyService {
  private readonly logger = new Logger(CalendlyService.name);
  private readonly apiKey: string;
  private readonly organizationUri: string;
  private readonly webhookSigningKey: string;
  private readonly baseUrl = 'https://api.calendly.com';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {
    this.apiKey = this.config.get<string>('calendly.apiKey') || '';
    this.organizationUri = this.config.get<string>('calendly.organizationUri') || '';
    this.webhookSigningKey = this.config.get<string>('calendly.webhookSigningKey') || '';
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.organizationUri);
  }

  // ──────────────── Event Type Mapping (B-89) ────────────────

  async getEventTypes(): Promise<CalendlyEventType[]> {
    const cached = await this.cache.get<CalendlyEventType[]>(CACHE_GROUP, EVENT_TYPES_KEY);
    if (cached) return cached;

    const response = await this.apiRequest<CalendlyEventTypeListResponse>(
      `/event_types?organization=${encodeURIComponent(this.organizationUri)}&active=true`,
    );

    await this.cache.set(CACHE_GROUP, EVENT_TYPES_KEY, response.collection, EVENT_TYPES_TTL);
    return response.collection;
  }

  async findMatchingEventType(
    visitMethod: VisitMethodsEnum,
    durationMinutes: number,
  ): Promise<CalendlyEventType | null> {
    const eventTypes = await this.getEventTypes();

    const methodKeywords = this.getMethodKeywords(visitMethod);

    const match = eventTypes.find(
      (et) =>
        et.active &&
        et.duration === durationMinutes &&
        methodKeywords.some((kw) => et.name.toLowerCase().includes(kw)),
    );

    if (match) return match;

    return (
      eventTypes.find((et) => et.active && et.duration === durationMinutes) ?? null
    );
  }

  private getMethodKeywords(method: VisitMethodsEnum): string[] {
    switch (method) {
      case VisitMethodsEnum.VIDEO_CALL:
        return ['video', 'telehealth', 'virtual', 'online'];
      case VisitMethodsEnum.VOICE_CALL:
        return ['phone', 'voice', 'call', 'audio'];
      case VisitMethodsEnum.ON_SITE:
        return ['in-person', 'on-site', 'office', 'clinic'];
      case VisitMethodsEnum.CHAT:
        return ['chat', 'message', 'async'];
      default:
        return [];
    }
  }

  // ──────────────── Scheduling on Appointment (B-90) ────────────────

  async scheduleForAppointment(appointmentId: number): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.warn('Calendly not configured — skipping scheduling.');
      return;
    }

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { select: { id: true, email: true, firstname: true, lastname: true } },
        doctor: { include: { user: { select: { email: true, firstname: true, lastname: true } } } },
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }

    if (appointment.calendlyEventUri) {
      this.logger.warn(`Appointment ${appointmentId} already has a Calendly event.`);
      return;
    }

    const eventType = await this.findMatchingEventType(
      appointment.method,
      appointment.durationMinutes,
    );

    if (!eventType) {
      this.logger.warn(
        `No matching Calendly event type for method=${appointment.method} duration=${appointment.durationMinutes}min`,
      );
      return;
    }

    const schedulingLink = await this.createSchedulingLink(eventType.uri);

    const bookingUrl = new URL(schedulingLink.booking_url);
    bookingUrl.searchParams.set('utm_content', `apt_${appointmentId}`);

    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        calendlyEventUri: bookingUrl.toString(),
      },
    });

    this.logger.log(
      `Calendly scheduling link created for appointment ${appointmentId}: ${bookingUrl.toString()}`,
    );
  }

  private async createSchedulingLink(eventTypeUri: string): Promise<CalendlySchedulingLink> {
    const response = await this.apiRequest<{ resource: CalendlySchedulingLink }>(
      '/scheduling_links',
      {
        method: 'POST',
        body: JSON.stringify({
          max_event_count: 1,
          owner: eventTypeUri,
          owner_type: 'EventType',
        }),
      },
    );
    return response.resource;
  }

  // ──────────────── Webhook Handling (B-91) ────────────────

  verifyWebhookSignature(
    rawBody: string,
    signature: string,
    timestamp: string,
  ): boolean {
    if (!this.webhookSigningKey) return false;

    const data = `${timestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSigningKey)
      .update(data)
      .digest('hex');

    const sigParts = signature.split(',');
    const v1Sig = sigParts
      .find((part) => part.startsWith('v1='))
      ?.replace('v1=', '');

    if (!v1Sig) return false;

    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(v1Sig),
      );
    } catch {
      return false;
    }
  }

  async handleWebhookEvent(event: CalendlyWebhookEvent): Promise<void> {
    switch (event.event) {
      case 'invitee.created':
        await this.handleInviteeCreated(event);
        break;
      case 'invitee.canceled':
        await this.handleInviteeCanceled(event);
        break;
      default:
        this.logger.warn(`Unhandled Calendly webhook event: ${event.event}`);
    }
  }

  private async handleInviteeCreated(event: CalendlyWebhookEvent): Promise<void> {
    const { payload } = event;

    const appointment = await this.findAppointmentFromWebhook(payload);
    if (!appointment) {
      this.logger.warn(`No appointment found for Calendly invitee.created event`);
      return;
    }

    const terminalStates: AppointmentStatusEnum[] = [
      AppointmentStatusEnum.COMPLETED,
      AppointmentStatusEnum.CANCELLED,
      AppointmentStatusEnum.NO_SHOW,
    ];
    if (terminalStates.includes(appointment.status)) {
      this.logger.warn(
        `Ignoring Calendly invitee.created for appointment ${appointment.id} — already in terminal state ${appointment.status}`,
      );
      return;
    }

    await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        calendlyEventUri: payload.event,
        calendlyInviteeUri: payload.uri,
        calendlyRescheduleUrl: payload.reschedule_url,
        calendlyCancelUrl: payload.cancel_url,
        status: AppointmentStatusEnum.CONFIRMED,
      },
    });

    this.logger.log(
      `Appointment ${appointment.id} confirmed via Calendly invitee.created`,
    );
  }

  private async handleInviteeCanceled(event: CalendlyWebhookEvent): Promise<void> {
    const { payload } = event;
    const eventUri = payload.event;

    const appointment = await this.prisma.appointment.findFirst({
      where: { calendlyEventUri: eventUri },
    });

    if (!appointment) {
      this.logger.warn(`No appointment found for Calendly event: ${eventUri}`);
      return;
    }

    const terminalStates: AppointmentStatusEnum[] = [
      AppointmentStatusEnum.COMPLETED,
      AppointmentStatusEnum.CANCELLED,
      AppointmentStatusEnum.NO_SHOW,
    ];
    if (terminalStates.includes(appointment.status)) {
      return;
    }

    await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        status: AppointmentStatusEnum.CANCELLED,
      },
    });

    this.logger.log(
      `Appointment ${appointment.id} cancelled via Calendly invitee.canceled`,
    );
  }

  private async findAppointmentFromWebhook(payload: CalendlyWebhookEvent['payload']) {
    // Primary: match via UTM tracking param (set during scheduleForAppointment)
    const utmContent = payload.tracking?.utm_content;
    if (utmContent?.startsWith('apt_')) {
      const appointmentId = parseInt(utmContent.replace('apt_', ''), 10);
      if (!isNaN(appointmentId)) {
        const appointment = await this.prisma.appointment.findUnique({
          where: { id: appointmentId },
        });
        if (appointment) return appointment;
      }
    }

    // Fallback: match by Calendly event URI (for events updated after invitee.created)
    return this.prisma.appointment.findFirst({
      where: { calendlyEventUri: payload.event },
    });
  }

  // ──────────────── Two-Way Sync (B-92) ────────────────

  async cancelCalendlyEvent(appointmentId: number, reason?: string): Promise<void> {
    if (!this.isConfigured()) return;

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment?.calendlyEventUri) return;

    // Only cancel if we have the actual Calendly API event URI (set by webhook)
    if (!appointment.calendlyEventUri.includes('api.calendly.com/scheduled_events/')) return;

    const eventUuid = this.extractUuid(appointment.calendlyEventUri);
    if (!eventUuid) return;

    try {
      const event = await this.apiRequest<{ resource: CalendlyScheduledEvent }>(
        `/scheduled_events/${eventUuid}`,
      );

      if (event.resource.status === 'canceled') return;

      await this.apiRequest(
        `/scheduled_events/${eventUuid}/cancellation`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: reason || 'Cancelled from AI-Clinic platform.',
          }),
        },
      );

      this.logger.log(
        `Calendly event cancelled for appointment ${appointmentId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to cancel Calendly event for appointment ${appointmentId}:`,
        error,
      );
    }
  }

  async getCalendlyEventDetails(
    appointmentId: number,
    user?: User,
  ): Promise<CalendlyScheduledEvent | null> {
    if (!this.isConfigured()) return null;

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) throw new NotFoundException('Appointment not found.');

    if (user && !user.isAdmin && !user.isSuperAdmin) {
      if (appointment.patientId !== user.id) {
        const doctorProfile = await this.prisma.doctorProfile.findUnique({
          where: { id: appointment.doctorId },
          select: { userId: true },
        });
        if (doctorProfile?.userId !== user.id) {
          throw new ForbiddenException('Access denied.');
        }
      }
    }

    if (!appointment.calendlyEventUri) return null;

    if (!appointment.calendlyEventUri.includes('api.calendly.com/scheduled_events/')) return null;

    const eventUuid = this.extractUuid(appointment.calendlyEventUri);
    if (!eventUuid) return null;

    try {
      const response = await this.apiRequest<{ resource: CalendlyScheduledEvent }>(
        `/scheduled_events/${eventUuid}`,
      );
      return response.resource;
    } catch {
      return null;
    }
  }

  // ──────────────── Private Helpers ────────────────

  private extractUuid(uri: string): string | null {
    const parts = uri.split('/');
    return parts[parts.length - 1] || null;
  }

  private async apiRequest<T>(
    path: string,
    options?: { method?: string; body?: string },
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const method = options?.method || 'GET';

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: options?.body,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Calendly API ${method} ${path} failed (${response.status}): ${errorBody}`);
        throw new InternalServerErrorException(
          'An error occurred while communicating with the scheduling provider.',
        );
      }

      if (response.status === 204) return {} as T;

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      this.logger.error(`Calendly API request failed:`, error);
      throw new InternalServerErrorException(
        'An error occurred while communicating with the scheduling provider.',
      );
    }
  }
}
