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
  DoctorSpecialtiesEnum,
  NursePermissionEnum,
  PatientSOAP,
  TriageLevelEnum,
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

  private static readonly SPECIALTY_RULES: ReadonlyArray<{
    specialty: DoctorSpecialtiesEnum;
    aliases: readonly string[];
    keywords: readonly string[];
  }> = [
    {
      specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
      aliases: ['cardiology', 'cardiologist', 'قلب', 'قلب و عروق'],
      keywords: [
        'chest pain',
        'palpitation',
        'arrhythmia',
        'tachycardia',
        'bradycardia',
        'hypertension',
        'angina',
        'cardiac',
        'heart',
        'ecg',
        'درد قفسه سینه',
        'تپش قلب',
        'فشار خون',
        'قلب',
        'آریتمی',
      ],
    },
    {
      specialty: DoctorSpecialtiesEnum.DERMATOLOGY,
      aliases: ['dermatology', 'dermatologist', 'پوست', 'پوست و مو'],
      keywords: [
        'rash',
        'eczema',
        'acne',
        'dermatitis',
        'psoriasis',
        'pruritus',
        'hives',
        'urticaria',
        'skin lesion',
        'itchy skin',
        'بثورات',
        'خارش پوست',
        'اگزما',
        'جوش',
        'ضایعه پوستی',
        'پوست',
      ],
    },
    {
      specialty: DoctorSpecialtiesEnum.ENT,
      aliases: ['ent', 'otolaryngology', 'گوش و حلق و بینی', 'گوش حلق بینی'],
      keywords: [
        'ear pain',
        'otitis',
        'tinnitus',
        'sinusitis',
        'sore throat',
        'tonsillitis',
        'nasal congestion',
        'hoarseness',
        'گوش درد',
        'گلودرد',
        'گلو درد',
        'سینوزیت',
        'گرفتگی بینی',
        'لوزه',
        'وزوز گوش',
      ],
    },
    {
      specialty: DoctorSpecialtiesEnum.GASTROENTEROLOGY,
      aliases: ['gastroenterology', 'gastroenterologist', 'گوارش'],
      keywords: [
        'abdominal pain',
        'heartburn',
        'acid reflux',
        'nausea',
        'vomiting',
        'diarrhea',
        'reflux',
        'gerd',
        'gastritis',
        'constipation',
        'bloating',
        'jaundice',
        'ulcer',
        'شکم درد',
        'دل درد',
        'سوزش معده',
        'ترش کردن',
        'تهوع',
        'استفراغ',
        'اسهال',
        'ریفلاکس',
        'معده',
        'یبوست',
        'زردی',
      ],
    },
    {
      specialty: DoctorSpecialtiesEnum.GYNECOLOGY,
      aliases: [
        'gynecology',
        'gynecologist',
        'ob/gyn',
        'زنان',
        'زنان و زایمان',
      ],
      keywords: [
        'pregnancy',
        'pregnant',
        'menstrual',
        'dysmenorrhea',
        'vaginal',
        'pelvic pain',
        'ovarian',
        'prenatal',
        'بارداری',
        'قاعدگی',
        'پریود',
        'رحم',
        'تخمدان',
        'واژینال',
      ],
    },
    {
      specialty: DoctorSpecialtiesEnum.NEUROLOGY,
      aliases: ['neurology', 'neurologist', 'مغز و اعصاب', 'اعصاب'],
      keywords: [
        'migraine',
        'seizure',
        'numbness',
        'tingling',
        'stroke',
        'tremor',
        'neuropathy',
        'vertigo',
        'dizziness',
        'severe headache',
        'میگرن',
        'تشنج',
        'بی حسی',
        'گزگز',
        'سکته مغزی',
        'لرزش',
        'سرگیجه',
        'سردرد شدید',
      ],
    },
    {
      specialty: DoctorSpecialtiesEnum.ONCOLOGY,
      aliases: ['oncology', 'oncologist', 'انکولوژی', 'سرطان'],
      keywords: [
        'tumor',
        'malignancy',
        'carcinoma',
        'chemotherapy',
        'cancer',
        'biopsy',
        'تومور',
        'بدخیمی',
        'سرطان',
        'شیمی درمانی',
      ],
    },
    {
      specialty: DoctorSpecialtiesEnum.ORTHOPEDICS,
      aliases: ['orthopedics', 'orthopedic', 'ارتوپدی'],
      keywords: [
        'fracture',
        'sprain',
        'joint pain',
        'back pain',
        'sciatica',
        'arthritis',
        'knee pain',
        'dislocation',
        'شکستگی',
        'رگ به رگ',
        'درد مفاصل',
        'کمر درد',
        'کمردرد',
        'سیاتیک',
        'آرتروز',
        'زانو درد',
      ],
    },
    {
      specialty: DoctorSpecialtiesEnum.PEDIATRICS,
      aliases: ['pediatrics', 'pediatrician', 'اطفال', 'کودکان'],
      keywords: [
        'pediatric',
        'infant',
        'toddler',
        'newborn',
        'child fever',
        'نوزاد',
        'کودک',
        'اطفال',
        'شیرخوار',
      ],
    },
    {
      specialty: DoctorSpecialtiesEnum.PSYCHIATRY,
      aliases: ['psychiatry', 'psychiatrist', 'روانپزشکی', 'روان پزشکی'],
      keywords: [
        'depression',
        'anxiety',
        'panic attack',
        'insomnia',
        'suicidal',
        'bipolar',
        'hallucination',
        'افسردگی',
        'اضطراب',
        'پانیک',
        'بی خوابی',
        'خودکشی',
        'توهم',
      ],
    },
    {
      specialty: DoctorSpecialtiesEnum.UROLOGY,
      aliases: ['urology', 'urologist', 'اورولوژی', 'کلیه و مجاری ادراری'],
      keywords: [
        'dysuria',
        'hematuria',
        'kidney stone',
        'urinary tract',
        'prostate',
        'flank pain',
        'سوزش ادرار',
        'سنگ کلیه',
        'ادرار خونی',
        'پروستات',
        'عفونت ادراری',
      ],
    },
  ];

  private static readonly TRIAGE_LEVEL_RULES: ReadonlyArray<{
    level: TriageLevelEnum;
    aliases: readonly string[];
    keywords: readonly string[];
  }> = [
    {
      level: TriageLevelEnum.EMERGENCY,
      aliases: ['emergency', 'emergent', 'اورژانس', 'اورژانسی'],
      keywords: [
        'call 911',
        'emergency department',
        'emergency room',
        'chest pain radiating',
        'shortness of breath',
        'difficulty breathing',
        'loss of consciousness',
        'fainting',
        'severe bleeding',
        'anaphylaxis',
        'suicidal',
        'paralysis',
        'تنگی نفس شدید',
        'از دست دادن هوشیاری',
        'بیهوشی',
        'بی هوشی',
        'خونریزی شدید',
        'درد شدید قفسه سینه',
        'اورژانس',
        'اورژانسی',
        'فلج',
        'خودکشی',
      ],
    },
    {
      level: TriageLevelEnum.URGENT,
      aliases: ['urgent', 'فوری'],
      keywords: [
        'urgent care',
        'urgent evaluation',
        'seek immediate',
        'within 24 hours',
        'high fever',
        'persistent vomiting',
        'severe pain',
        'acute severe',
        'acute abdomen',
        'تب بالا',
        'تب شدید',
        'استفراغ مداوم',
        'درد شدید',
        'مراجعه فوری',
        'فوری',
        '39°c',
        '39.5°c',
        '40°c',
        '۳۹',
        '۴۰',
      ],
    },
    {
      level: TriageLevelEnum.SELF_CARE,
      aliases: [
        'self_care',
        'self care',
        'self-care',
        'خودمراقبتی',
        'خود مراقبتی',
      ],
      keywords: [
        'self care',
        'self-care',
        'self limiting',
        'self-limiting',
        'rest and hydration',
        'rest, hydration',
        'monitor at home',
        'over-the-counter',
        'mild symptoms',
        'استراحت در منزل',
        'خود مراقبتی',
        'خودمراقبتی',
        'علائم خفیف',
      ],
    },
  ];

  private static normalizeClinicalText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[\u200c\u200b]/g, ' ')
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک');
  }

  /**
   * Removes negated symptom lines and clauses (EN/FA) so "denies chest pain"
   * or "علائم منفی: عدم وجود گلودرد" never trigger false specialty or emergency matches.
   */
  private static stripNegatedSegments(text: string): string {
    return SoapService.normalizeClinicalText(text)
      .replace(
        /^[ \t]*(?:[-*•]\s*)?(?:negative symptoms|pertinent negatives|علائم منفی|نکات منفی)\s*[:\-–][^\r\n]*/gm,
        ' ',
      )
      .replace(
        /\b(?:no|denies|denied|without|negative for|absence of|not having|rules? out)\s+[^.;,\r\n]{1,80}/g,
        ' ',
      )
      .replace(/(?:عدم وجود|فاقد|بدون)\s+[^.،؛\r\n]{1,80}/g, ' ')
      .replace(
        /[^.،؛:\r\n]{1,45}[:\s]+(?:ندارد|نداشت|نیست)(?=[.،؛\s\r\n]|$)/g,
        ' ',
      );
  }

  private static containsTerm(text: string, term: string): boolean {
    if (!term) return false;
    if (/^[a-z0-9 _/-]+$/.test(term)) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
    }
    return text.includes(term);
  }

  private inferSuggestedSpecialty(parsed: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    rawNote: string;
  }): DoctorSpecialtiesEnum {
    const explicitMatch = parsed.rawNote.match(
      /^[ \t]*(?:\*\*)?(?:Suggested\s*Specialty|Specialty|تخصص\s*پیشنهادی|تخصص)(?:\*\*)?\s*[:\-–]\s*([^\r\n]+)/im,
    );
    if (explicitMatch) {
      const value = SoapService.normalizeClinicalText(explicitMatch[1]).trim();
      const sortedEnums = [...Object.values(DoctorSpecialtiesEnum)].sort(
        (a, b) => b.length - a.length,
      );
      for (const enumVal of sortedEnums) {
        if (SoapService.containsTerm(value, enumVal.toLowerCase())) {
          return enumVal;
        }
      }
      for (const rule of SoapService.SPECIALTY_RULES) {
        if (
          rule.aliases.some((alias) => SoapService.containsTerm(value, alias))
        ) {
          return rule.specialty;
        }
      }
    }

    const primaryText = SoapService.stripNegatedSegments(
      `${parsed.assessment}\n${parsed.plan}`,
    );
    const secondaryText = SoapService.stripNegatedSegments(
      `${parsed.subjective}\n${parsed.objective}`,
    );

    let bestSpecialty: DoctorSpecialtiesEnum = DoctorSpecialtiesEnum.GENERAL;
    let bestScore = 0;

    for (const rule of SoapService.SPECIALTY_RULES) {
      let score = 0;
      for (const keyword of rule.keywords) {
        if (SoapService.containsTerm(primaryText, keyword)) score += 2;
        else if (SoapService.containsTerm(secondaryText, keyword)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestSpecialty = rule.specialty;
      }
    }

    return bestSpecialty;
  }

  private inferTriageLevel(parsed: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    rawNote: string;
  }): TriageLevelEnum {
    const explicitMatch = parsed.rawNote.match(
      /^[ \t]*(?:\*\*)?(?:Triage\s*Level|Triage|Urgency|سطح\s*تریاژ|تریاژ)(?:\*\*)?\s*[:\-–]\s*([^\r\n]+)/im,
    );
    if (explicitMatch) {
      const value = SoapService.normalizeClinicalText(explicitMatch[1]).trim();
      for (const enumVal of Object.values(TriageLevelEnum)) {
        if (
          SoapService.containsTerm(
            value,
            enumVal.toLowerCase().replace(/_/g, ' '),
          ) ||
          value.includes(enumVal.toLowerCase())
        ) {
          return enumVal;
        }
      }
      for (const rule of SoapService.TRIAGE_LEVEL_RULES) {
        if (
          rule.aliases.some((alias) => SoapService.containsTerm(value, alias))
        ) {
          return rule.level;
        }
      }
      if (
        SoapService.containsTerm(value, 'see doctor') ||
        value.includes('پزشک')
      ) {
        return TriageLevelEnum.SEE_DOCTOR;
      }
    }

    const combined = SoapService.stripNegatedSegments(
      `${parsed.assessment}\n${parsed.plan}\n${parsed.subjective}\n${parsed.objective}`,
    );

    for (const rule of SoapService.TRIAGE_LEVEL_RULES) {
      if (
        rule.keywords.some((keyword) =>
          SoapService.containsTerm(combined, keyword),
        )
      ) {
        return rule.level;
      }
    }

    return TriageLevelEnum.SEE_DOCTOR;
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
    // Serialize per conversation so concurrent poll + history calls don't race
    // on the initial existence check and emit duplicate SOAP-ready notifications.
    const previous =
      this.pendingUpserts.get(conversationId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() =>
        this.performDetectAndUpsert(userId, conversationId, messageText),
      );
    this.pendingUpserts.set(conversationId, next);
    try {
      return await next;
    } finally {
      if (this.pendingUpserts.get(conversationId) === next) {
        this.pendingUpserts.delete(conversationId);
      }
    }
  }

  private readonly pendingUpserts = new Map<
    string,
    Promise<PatientSOAP | null>
  >();

  private async performDetectAndUpsert(
    userId: string,
    conversationId: string,
    messageText: string,
  ): Promise<PatientSOAP | null> {
    const rawContent = this.extractSoapContent(messageText);
    if (!rawContent) return null;

    const parsed = this.parseSoapSections(rawContent);
    const suggestedSpecialty = this.inferSuggestedSpecialty(parsed);
    const triageLevel = this.inferTriageLevel(parsed);

    this.logger.log(
      `SOAP detected for conversation ${conversationId} (${suggestedSpecialty}, ${triageLevel}), upserting...`,
    );

    const existing = await this.prisma.patientSOAP.findUnique({
      where: { conversationId },
      select: { id: true },
    });

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
        suggestedSpecialty,
        triageLevel,
      },
      update: {
        subjective: parsed.subjective || null,
        objective: parsed.objective || null,
        assessment: parsed.assessment || null,
        plan: parsed.plan || null,
        rawNote: parsed.rawNote,
        suggestedSpecialty,
        triageLevel,
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

    if (!existing) {
      this.notificationService
        .onSoapReady(userId, conversationId)
        .catch((e) => this.logger.error(`Notification failed: ${e.message}`));
    }

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
