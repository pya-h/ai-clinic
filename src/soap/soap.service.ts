import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  NursePermissionEnum,
  PatientSOAP,
  UserRolesEnum,
} from '@prisma/client';
import { PaginationOptionsDto } from '../common/dtos/pagination-options.dto';
import { NotificationService } from '../notification/notification.service';
import { NurseService } from '../nurse/nurse.service';

@Injectable()
export class SoapService {
  private readonly logger = new Logger(SoapService.name);
  private readonly SOAP_TAG = '***SOAP***';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
    private readonly nurseService: NurseService,
  ) {}

  private static readonly HWS =
    '[ \\t\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]';

  private static buildSectionHeadingPattern(
    letter: string,
    name: string,
  ): string {
    const h = SoapService.HWS;
    const prefix = `(?:(?:#{1,6}|[-*•]|\\d+[.)])${h}+)?[*_]{0,3}${h}*`;
    const core = [
      `(?:${letter}${h}*[*_]{0,3}${h}*[-–—−:/.)]${h}*[*_]{0,3}${h}*)?${name}\\b(?:${h}*\\([^)\\r\\n]{1,40}\\))?`,
      `${letter}${h}*\\(${h}*${name}${h}*\\)`,
      `(?:${letter}${h}*[-–—−:/.)]${h}*)?[^\\r\\n(:*_#]{1,30}${h}*\\(${h}*${name}${h}*\\)`,
    ].join('|');
    // require ":", spaced dash, or end-of-line so prose like "Plan to follow up" is ignored
    const suffix = `${h}*[*_]{0,3}${h}*(?::${h}*[*_]{0,3}${h}*|${h}+[-–—−]${h}+[*_]{0,3}${h}*|(?=\\r?$))`;
    return `^${h}*${prefix}(?:${core})${suffix}`;
  }

  private static readonly SECTION_PATTERNS = (
    [
      ['subjective', 'S', 'Subjective'],
      ['objective', 'O', 'Objective'],
      ['assessment', 'A', 'Assessment'],
      ['plan', 'P', 'Plan'],
    ] as const
  ).map(([key, letter, name]) => {
    const pattern = SoapService.buildSectionHeadingPattern(letter, name);
    return {
      key,
      pattern,
      testRe: new RegExp(pattern, 'im'),
    };
  });

  private hasAllSoapHeadings(text: string): boolean {
    return SoapService.SECTION_PATTERNS.every(({ testRe }) =>
      testRe.test(text),
    );
  }

  private deriveTitleFromSoap(parsed: {
    subjective: string;
    assessment: string;
  }): string | null {
    const source = parsed.assessment || parsed.subjective;
    if (!source) return null;

    let clean = source
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/\*+/g, '')
      .replace(/#+\s*/g, '')
      .replace(/(^|\n)[-]\s+/g, '$1')
      .replace(/\n+/g, ' ')
      .trim();

    const sentenceEnd = clean.search(/[.!?؟]/);
    if (sentenceEnd > 0 && sentenceEnd <= 80) {
      clean = clean.slice(0, sentenceEnd + 1);
    } else if (clean.length > 80) {
      clean = clean.slice(0, 77) + '...';
    }

    return clean || null;
  }

  containsSoapTag(text: string): boolean {
    return text.includes(this.SOAP_TAG) || this.hasAllSoapHeadings(text);
  }

  extractSoapContent(text: string): string | null {
    const taggedRegex = /\*\*\*SOAP\*\*\*([\s\S]*?)\*\*\*SOAP\*\*\*/;
    const taggedMatch = text.match(taggedRegex);
    if (taggedMatch) return taggedMatch[1].trim();

    if (!this.hasAllSoapHeadings(text)) return null;

    const firstHeading = SoapService.SECTION_PATTERNS[0].testRe.exec(text);
    if (firstHeading && firstHeading.index !== undefined) {
      return text
        .slice(firstHeading.index)
        .replace(/\*\*\*SOAP\*\*\*\s*$/, '')
        .trim();
    }
    return null;
  }

  parseSoapSections(rawNote: string): {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    rawNote: string;
  } {
    const sections = {
      subjective: '',
      objective: '',
      assessment: '',
      plan: '',
    };

    const headings: {
      key: keyof typeof sections;
      start: number;
      end: number;
    }[] = [];

    for (const { key, pattern } of SoapService.SECTION_PATTERNS) {
      const re = new RegExp(pattern, 'gim');
      for (const m of rawNote.matchAll(re)) {
        if (m.index !== undefined) {
          headings.push({
            key,
            start: m.index,
            end: m.index + m[0].length,
          });
        }
      }
    }

    headings.sort((a, b) => a.start - b.start);

    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].end;
      const end =
        i + 1 < headings.length ? headings[i + 1].start : rawNote.length;
      const key = headings[i].key;
      sections[key] = rawNote.slice(start, end).trim();
    }

    return { ...sections, rawNote };
  }

  /**
   * Detect SOAP tags in text, parse, and upsert (one SOAP per conversation).
   * Only saves if the user is authenticated (userId is provided).
   */
  async detectAndUpsert(
    userId: string,
    conversationId: string,
    messageText: string,
  ): Promise<PatientSOAP | null> {
    const rawContent = this.extractSoapContent(messageText);
    if (!rawContent) return null;

    const parsed = this.parseSoapSections(rawContent);

    this.logger.log(
      `SOAP detected for conversation ${conversationId}, upserting...`,
    );

    const soap = await this.prisma.patientSOAP.upsert({
      where: { conversationId },
      create: {
        userId,
        conversationId,
        subjective: parsed.subjective || null,
        objective: parsed.objective || null,
        assessment: parsed.assessment || null,
        plan: parsed.plan || null,
        rawNote: parsed.rawNote,
      },
      update: {
        subjective: parsed.subjective || null,
        objective: parsed.objective || null,
        assessment: parsed.assessment || null,
        plan: parsed.plan || null,
        rawNote: parsed.rawNote,
      },
    });

    // Auto-title conversation if it doesn't have one yet
    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
      select: { topic: true },
    });
    if (conversation && !conversation.topic) {
      const title = this.deriveTitleFromSoap(parsed);
      if (title) {
        await this.prisma.aiConversation.update({
          where: { id: conversationId },
          data: { topic: title },
        });
      }
    }

    this.notificationService
      .onSoapReady(userId, conversationId)
      .catch((e) => this.logger.error(`Notification failed: ${e.message}`));

    return soap;
  }

  /**
   * Get a single SOAP by conversation ID.
   */
  async getByConversation(conversationId: string): Promise<PatientSOAP | null> {
    return this.prisma.patientSOAP.findUnique({
      where: { conversationId },
    });
  }

  /**
   * Get all SOAPs for a user, paginated.
   */
  async getByUser(
    userId: string,
    pagination: PaginationOptionsDto,
  ): Promise<{
    data: PatientSOAP[];
    total: number;
    skip: number;
    take: number;
  }> {
    const skip = +(pagination.skip ?? 0);
    const take = +(pagination.take ?? 20);

    const [data, total] = await Promise.all([
      this.prisma.patientSOAP.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.patientSOAP.count({ where: { userId } }),
    ]);

    return { data, total, skip, take };
  }

  async getForNurse(
    nurseUserId: string,
    pagination: PaginationOptionsDto,
  ): Promise<{
    data: PatientSOAP[];
    total: number;
    skip: number;
    take: number;
  }> {
    const doctorIds = await this.nurseService.getDoctorIdsForNurse(
      nurseUserId,
      NursePermissionEnum.VIEW_SOAPS,
    );
    if (doctorIds.length === 0) {
      const skip = +(pagination.skip ?? 0);
      const take = +(pagination.take ?? 20);
      return { data: [], total: 0, skip, take };
    }

    const skip = +(pagination.skip ?? 0);
    const take = +(pagination.take ?? 20);

    const where = {
      consultations: {
        some: { doctorId: { in: doctorIds } },
      },
    };

    const [data, total] = await Promise.all([
      this.prisma.patientSOAP.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.patientSOAP.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  async getForConversation(
    conversationId: string,
    requestingUserId: string,
    isAdminOrSuperAdmin = false,
    requestingUserRole?: UserRolesEnum,
  ): Promise<PatientSOAP | null> {
    const soap = await this.getByConversation(conversationId);
    if (!soap) return null;

    await this.assertCanReadSoap(
      soap,
      requestingUserId,
      isAdminOrSuperAdmin,
      requestingUserRole,
    );
    return soap;
  }

  /**
   * Besides the owner and admins: a doctor with a consultation linked to the SOAP,
   * or a nurse with VIEW_SOAPS for such a doctor.
   */
  async getById(
    id: string,
    requestingUserId: string,
    isAdminOrSuperAdmin = false,
    requestingUserRole?: UserRolesEnum,
  ): Promise<PatientSOAP> {
    const soap = await this.prisma.patientSOAP.findUnique({
      where: { id },
    });

    if (!soap) {
      throw new NotFoundException('SOAP note not found.');
    }

    await this.assertCanReadSoap(
      soap,
      requestingUserId,
      isAdminOrSuperAdmin,
      requestingUserRole,
    );
    return soap;
  }

  private async assertCanReadSoap(
    soap: PatientSOAP,
    requestingUserId: string,
    isAdminOrSuperAdmin: boolean,
    requestingUserRole?: UserRolesEnum,
  ): Promise<void> {
    if (isAdminOrSuperAdmin) return;

    if (soap.userId === requestingUserId) return;

    if (requestingUserRole === UserRolesEnum.DOCTOR) {
      const linked = await this.prisma.consultation.findFirst({
        where: { soapId: soap.id, doctor: { userId: requestingUserId } },
        select: { id: true },
      });
      if (linked) return;
    }

    if (requestingUserRole === UserRolesEnum.NURSE) {
      const doctorIds = await this.nurseService.getDoctorIdsForNurse(
        requestingUserId,
        NursePermissionEnum.VIEW_SOAPS,
      );
      if (doctorIds.length > 0) {
        const linked = await this.prisma.consultation.findFirst({
          where: { soapId: soap.id, doctorId: { in: doctorIds } },
          select: { id: true },
        });
        if (linked) return;
      }
    }

    throw new ForbiddenException(
      'You do not have permission to view this SOAP note.',
    );
  }
}
