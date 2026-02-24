import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PatientSOAP } from '@prisma/client';
import { PaginationOptionsDto } from '../common/dtos/pagination-options.dto';

@Injectable()
export class SoapService {
  private readonly logger = new Logger(SoapService.name);
  private readonly SOAP_TAG = '***SOAP***';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if a text contains SOAP tags.
   */
  containsSoapTag(text: string): boolean {
    return text.includes(this.SOAP_TAG);
  }

  /**
   * Extract the raw SOAP content between ***SOAP*** tags.
   * Returns null if no valid SOAP block is found.
   */
  extractSoapContent(text: string): string | null {
    const regex = /\*\*\*SOAP\*\*\*([\s\S]*?)\*\*\*SOAP\*\*\*/;
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  }

  /**
   * Parse the raw SOAP note into individual sections
   * (Subjective, Objective, Assessment, Plan).
   */
  parseSoapSections(rawNote: string): {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    rawNote: string;
  } {
    const sections = { subjective: '', objective: '', assessment: '', plan: '' };
    const sectionRegex =
      /(?:\*{2})?\s*(Subjective|Objective|Assessment|Plan)\s*:\s*(?:\*{2})?\s*([\s\S]*?)(?=(?:\*{2})?\s*(?:Subjective|Objective|Assessment|Plan)\s*:\s*(?:\*{2})?|$)/gi;

    let match: RegExpExecArray | null;
    while ((match = sectionRegex.exec(rawNote)) !== null) {
      const key = match[1].toLowerCase() as keyof typeof sections;
      sections[key] = match[2].trim();
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

    return this.prisma.patientSOAP.upsert({
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
  }

  /**
   * Get a single SOAP by conversation ID.
   */
  async getByConversation(
    conversationId: string,
  ): Promise<PatientSOAP | null> {
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
  ): Promise<{ data: PatientSOAP[]; total: number; skip: number; take: number }> {
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

  /**
   * Get a single SOAP by ID, with ownership check.
   * Admins can access any SOAP.
   */
  async getById(
    id: string,
    requestingUserId: string,
    isAdmin = false,
  ): Promise<PatientSOAP> {
    const soap = await this.prisma.patientSOAP.findUnique({
      where: { id },
    });

    if (!soap) {
      throw new NotFoundException('SOAP note not found.');
    }

    if (!isAdmin && soap.userId !== requestingUserId) {
      throw new ForbiddenException(
        'You do not have permission to view this SOAP note.',
      );
    }

    return soap;
  }
}
