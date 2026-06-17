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

  private static readonly HEADING_RE =
    /^[ \t]*\*{0,2}[ \t]*(Subjective|Objective|Assessment|Plan)[ \t]*:?[ \t]*\*{0,2}[ \t]*/gim;

  containsSoapTag(text: string): boolean {
    if (text.includes(this.SOAP_TAG)) return true;
    const headings = ['Subjective', 'Objective', 'Assessment', 'Plan'];
    return headings.every((h) =>
      new RegExp(`^[ \\t]*\\*{0,2}[ \\t]*${h}\\b`, 'im').test(text),
    );
  }

  extractSoapContent(text: string): string | null {
    const taggedRegex = /\*\*\*SOAP\*\*\*([\s\S]*?)\*\*\*SOAP\*\*\*/;
    const taggedMatch = text.match(taggedRegex);
    if (taggedMatch) return taggedMatch[1].trim();

    const firstHeading = text.match(
      /^[ \t]*\*{0,2}[ \t]*Subjective\b/im,
    );
    if (firstHeading && firstHeading.index !== undefined) {
      return text.slice(firstHeading.index).trim();
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
    const sections = { subjective: '', objective: '', assessment: '', plan: '' };

    const headings: { key: string; start: number; end: number }[] = [];
    const re = new RegExp(SoapService.HEADING_RE.source, 'gim');
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawNote)) !== null) {
      headings.push({
        key: m[1].toLowerCase(),
        start: m.index,
        end: m.index + m[0].length,
      });
    }

    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].end;
      const end =
        i + 1 < headings.length ? headings[i + 1].start : rawNote.length;
      const key = headings[i].key as keyof typeof sections;
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
    isAdminOrSuperAdmin = false,
  ): Promise<PatientSOAP> {
    const soap = await this.prisma.patientSOAP.findUnique({
      where: { id },
    });

    if (!soap) {
      throw new NotFoundException('SOAP note not found.');
    }

    if (!isAdminOrSuperAdmin && soap.userId !== requestingUserId) {
      throw new ForbiddenException(
        'You do not have permission to view this SOAP note.',
      );
    }

    return soap;
  }
}
