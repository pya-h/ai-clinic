import { Test, TestingModule } from '@nestjs/testing';
import { SoapService } from './soap.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomUuid } from '../../test/helpers/test-data.factory';

describe('SoapService', () => {
  let service: SoapService;
  let prisma: Record<string, any>;

  const mockUserId = randomUuid();
  const mockConversationId = randomUuid();
  const mockSoapId = randomUuid();

  const mockSoap = {
    id: mockSoapId,
    userId: mockUserId,
    conversationId: mockConversationId,
    subjective: 'Patient reports headache for 3 days',
    objective: 'Temperature 38°C, BP 120/80',
    assessment: 'Likely viral infection',
    plan: 'Rest, hydration, paracetamol PRN',
    rawNote:
      '**Subjective:** Patient reports headache for 3 days\n**Objective:** Temperature 38°C, BP 120/80\n**Assessment:** Likely viral infection\n**Plan:** Rest, hydration, paracetamol PRN',
    suggestedSpecialty: null,
    triageLevel: null,
    confidenceScores: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      patientSOAP: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SoapService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationService,
          useValue: { onSoapReady: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<SoapService>(SoapService);
  });

  // ─── containsSoapTag ───

  describe('containsSoapTag', () => {
    it('should return true when text contains SOAP tags', () => {
      const text = 'Some preamble ***SOAP***\nSubjective: pain\n***SOAP***';
      expect(service.containsSoapTag(text)).toBe(true);
    });

    it('should return true when text contains only the opening tag', () => {
      const text = 'Here is the ***SOAP*** note';
      expect(service.containsSoapTag(text)).toBe(true);
    });

    it('should return false for regular messages without tags', () => {
      expect(service.containsSoapTag('Hello, how are you feeling today?')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(service.containsSoapTag('')).toBe(false);
    });

    it('should return false for partial tag', () => {
      expect(service.containsSoapTag('**SOAP** is not the right tag')).toBe(false);
    });

    it('should be case-sensitive (***soap*** should not match)', () => {
      expect(service.containsSoapTag('***soap***')).toBe(false);
    });
  });

  // ─── extractSoapContent ───

  describe('extractSoapContent', () => {
    it('should extract content between SOAP tags', () => {
      const text =
        'Some message ***SOAP***\nSubjective: headache\nObjective: normal\n***SOAP*** end';
      const result = service.extractSoapContent(text);
      expect(result).toBe('Subjective: headache\nObjective: normal');
    });

    it('should return null when no SOAP tags exist', () => {
      expect(service.extractSoapContent('regular message')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(service.extractSoapContent('')).toBeNull();
    });

    it('should return null for only one SOAP tag (no closing tag)', () => {
      const text = '***SOAP*** some content but no closing tag';
      expect(service.extractSoapContent(text)).toBeNull();
    });

    it('should trim whitespace from extracted content', () => {
      const text = '***SOAP***   \n  content here  \n   ***SOAP***';
      expect(service.extractSoapContent(text)).toBe('content here');
    });

    it('should handle multiline content between tags', () => {
      const text = `***SOAP***
**Subjective:** Patient reports severe headache for 3 days.
Pain is throbbing, located in the frontal region.

**Objective:** Temperature 38.2°C, BP 130/85
**Assessment:** Tension headache vs. sinusitis
**Plan:** Ibuprofen 400mg TID, follow-up in 1 week
***SOAP***`;
      const result = service.extractSoapContent(text);
      expect(result).toContain('**Subjective:**');
      expect(result).toContain('**Plan:**');
    });

    it('should extract only the first SOAP block if multiple exist', () => {
      const text =
        '***SOAP***first block***SOAP*** some text ***SOAP***second block***SOAP***';
      const result = service.extractSoapContent(text);
      expect(result).toBe('first block');
    });
  });

  // ─── parseSoapSections ───

  describe('parseSoapSections', () => {
    it('should parse all four sections', () => {
      const raw =
        'Subjective: pain\nObjective: temp 38C\nAssessment: flu\nPlan: rest';
      const result = service.parseSoapSections(raw);
      expect(result.subjective).toBe('pain');
      expect(result.objective).toBe('temp 38C');
      expect(result.assessment).toBe('flu');
      expect(result.plan).toBe('rest');
      expect(result.rawNote).toBe(raw);
    });

    it('should parse sections with bold markdown headers (**Section:**)', () => {
      const raw =
        '**Subjective:** Patient reports headache\n**Objective:** Temp 38°C\n**Assessment:** Viral infection\n**Plan:** Rest and fluids';
      const result = service.parseSoapSections(raw);
      expect(result.subjective).toBe('Patient reports headache');
      expect(result.objective).toBe('Temp 38°C');
      expect(result.assessment).toBe('Viral infection');
      expect(result.plan).toBe('Rest and fluids');
    });

    it('should handle multiline section content', () => {
      const raw = `Subjective: Patient has had a headache for 3 days.
The pain is throbbing and worse in the morning.
Also reports nausea.
Objective: Temp 38.5°C
BP 130/85
Assessment: Likely migraine
Plan: Start sumatriptan 50mg
Follow up in 2 weeks`;
      const result = service.parseSoapSections(raw);
      expect(result.subjective).toContain('throbbing');
      expect(result.subjective).toContain('nausea');
      expect(result.objective).toContain('130/85');
      expect(result.plan).toContain('sumatriptan');
      expect(result.plan).toContain('Follow up');
    });

    it('should return empty strings for missing sections', () => {
      const raw = 'Subjective: pain only';
      const result = service.parseSoapSections(raw);
      expect(result.subjective).toBe('pain only');
      expect(result.objective).toBe('');
      expect(result.assessment).toBe('');
      expect(result.plan).toBe('');
    });

    it('should handle case-insensitive section headers', () => {
      const raw = 'subjective: pain\nOBJECTIVE: temp\nassessment: flu\nPlan: rest';
      const result = service.parseSoapSections(raw);
      expect(result.subjective).toBe('pain');
      expect(result.objective).toBe('temp');
      expect(result.assessment).toBe('flu');
      expect(result.plan).toBe('rest');
    });

    it('should include rawNote in the result', () => {
      const raw = 'Subjective: test';
      const result = service.parseSoapSections(raw);
      expect(result.rawNote).toBe(raw);
    });

    it('should handle text with no recognized sections', () => {
      const raw = 'This is just some random text without sections';
      const result = service.parseSoapSections(raw);
      expect(result.subjective).toBe('');
      expect(result.objective).toBe('');
      expect(result.assessment).toBe('');
      expect(result.plan).toBe('');
      expect(result.rawNote).toBe(raw);
    });
  });

  // ─── detectAndUpsert ───

  describe('detectAndUpsert', () => {
    it('should detect, parse, and upsert a SOAP note', async () => {
      const messageText = `Here is your summary:\n***SOAP***\nSubjective: headache\nObjective: normal vitals\nAssessment: tension headache\nPlan: rest\n***SOAP***`;
      prisma.patientSOAP.upsert.mockResolvedValue(mockSoap);

      const result = await service.detectAndUpsert(
        mockUserId,
        mockConversationId,
        messageText,
      );

      expect(result).toEqual(mockSoap);
      expect(prisma.patientSOAP.upsert).toHaveBeenCalledWith({
        where: { conversationId: mockConversationId },
        create: expect.objectContaining({
          userId: mockUserId,
          conversationId: mockConversationId,
          rawNote: expect.any(String),
        }),
        update: expect.objectContaining({
          rawNote: expect.any(String),
        }),
      });
    });

    it('should return null if no SOAP content is found', async () => {
      const result = await service.detectAndUpsert(
        mockUserId,
        mockConversationId,
        'regular message without SOAP',
      );

      expect(result).toBeNull();
      expect(prisma.patientSOAP.upsert).not.toHaveBeenCalled();
    });

    it('should return null for single SOAP tag (no closing)', async () => {
      const result = await service.detectAndUpsert(
        mockUserId,
        mockConversationId,
        '***SOAP*** content without closing',
      );

      expect(result).toBeNull();
      expect(prisma.patientSOAP.upsert).not.toHaveBeenCalled();
    });

    it('should set empty sections to null in create', async () => {
      const messageText =
        '***SOAP***\nSubjective: headache only\n***SOAP***';
      prisma.patientSOAP.upsert.mockResolvedValue(mockSoap);

      await service.detectAndUpsert(
        mockUserId,
        mockConversationId,
        messageText,
      );

      const upsertCall = prisma.patientSOAP.upsert.mock.calls[0][0];
      expect(upsertCall.create.subjective).toBe('headache only');
      expect(upsertCall.create.objective).toBeNull();
      expect(upsertCall.create.assessment).toBeNull();
      expect(upsertCall.create.plan).toBeNull();
    });
  });

  // ─── getByConversation ───

  describe('getByConversation', () => {
    it('should return SOAP for existing conversation', async () => {
      prisma.patientSOAP.findUnique.mockResolvedValue(mockSoap);
      const result = await service.getByConversation(mockConversationId);
      expect(result).toEqual(mockSoap);
      expect(prisma.patientSOAP.findUnique).toHaveBeenCalledWith({
        where: { conversationId: mockConversationId },
      });
    });

    it('should return null for non-existing conversation', async () => {
      prisma.patientSOAP.findUnique.mockResolvedValue(null);
      const result = await service.getByConversation('non-existent');
      expect(result).toBeNull();
    });
  });

  // ─── getByUser ───

  describe('getByUser', () => {
    it('should return paginated SOAPs for user', async () => {
      prisma.patientSOAP.findMany.mockResolvedValue([mockSoap]);
      prisma.patientSOAP.count.mockResolvedValue(1);

      const result = await service.getByUser(mockUserId, {
        skip: 0,
        take: 20,
      });

      expect(result).toEqual({
        data: [mockSoap],
        total: 1,
        skip: 0,
        take: 20,
      });
      expect(prisma.patientSOAP.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    });

    it('should use default pagination when values are missing', async () => {
      prisma.patientSOAP.findMany.mockResolvedValue([]);
      prisma.patientSOAP.count.mockResolvedValue(0);

      const result = await service.getByUser(mockUserId, {} as any);

      expect(result).toEqual({ data: [], total: 0, skip: 0, take: 20 });
    });
  });

  // ─── getById ───

  describe('getById', () => {
    it('should return SOAP if owner requests it', async () => {
      prisma.patientSOAP.findUnique.mockResolvedValue(mockSoap);
      const result = await service.getById(mockSoapId, mockUserId);
      expect(result).toEqual(mockSoap);
    });

    it('should allow admin to access any SOAP', async () => {
      prisma.patientSOAP.findUnique.mockResolvedValue(mockSoap);
      const result = await service.getById(
        mockSoapId,
        randomUuid(),
        true,
      );
      expect(result).toEqual(mockSoap);
    });

    it('should throw NotFoundException if SOAP not found', async () => {
      prisma.patientSOAP.findUnique.mockResolvedValue(null);
      await expect(
        service.getById(randomUuid(), mockUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if non-owner non-admin requests', async () => {
      prisma.patientSOAP.findUnique.mockResolvedValue(mockSoap);
      await expect(
        service.getById(mockSoapId, randomUuid(), false),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
