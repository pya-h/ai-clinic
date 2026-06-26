import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MatchingService } from './matching.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewService } from '../review/review.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import {
  MatchStatusEnum,
  UserRolesEnum,
  DoctorSpecialtiesEnum,
  ConsultationStatusEnum,
  TriageLevelEnum,
} from '@prisma/client';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/helpers/mock-prisma.helper';
import {
  createMockUser,
  createMockDoctorUser,
  createMockAdminUser,
  createMockSuperAdminUser,
  MockUser,
} from '../../test/helpers/mock-session.helper';
import { buildDoctorProfile } from '../../test/helpers/test-data.factory';
import { randomUUID } from 'crypto';

describe('MatchingService', () => {
  let service: MatchingService;
  let prisma: MockPrismaService;
  let reviewService: { getAggregateRatingsForDoctors: jest.Mock };
  let schedulingService: { countAvailableSlotsForDoctors: jest.Mock };
  let patient: MockUser;
  let doctor: MockUser;
  let admin: MockUser;
  let superAdmin: MockUser;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    reviewService = { getAggregateRatingsForDoctors: jest.fn() };
    schedulingService = { countAvailableSlotsForDoctors: jest.fn() };
    patient = createMockUser();
    doctor = createMockDoctorUser();
    admin = createMockAdminUser();
    superAdmin = createMockSuperAdminUser();

    // Make $transaction execute the callback with the mock prisma as the tx client
    prisma.$transaction.mockImplementation((fn) => fn(prisma));

    // Add matchRejection model mock (used by rejectMatch and getRejectedDoctorIds)
    (prisma as any).matchRejection = {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReviewService, useValue: reviewService },
        { provide: SchedulingService, useValue: schedulingService },
      ],
    }).compile();

    service = module.get<MatchingService>(MatchingService);
  });

  // ──────────────── validateTransition ────────────────

  describe('validateTransition', () => {
    const validTransitions: [MatchStatusEnum, MatchStatusEnum][] = [
      [MatchStatusEnum.SEARCHING, MatchStatusEnum.MATCHED],
      [MatchStatusEnum.SEARCHING, MatchStatusEnum.TIMEOUT],
      [MatchStatusEnum.SEARCHING, MatchStatusEnum.CANCELLED],
      [MatchStatusEnum.MATCHED, MatchStatusEnum.ACCEPTED],
      [MatchStatusEnum.MATCHED, MatchStatusEnum.SEARCHING],
      [MatchStatusEnum.MATCHED, MatchStatusEnum.TIMEOUT],
      [MatchStatusEnum.MATCHED, MatchStatusEnum.CANCELLED],
      [MatchStatusEnum.ACCEPTED, MatchStatusEnum.CONSULTATION_CREATED],
      [MatchStatusEnum.ACCEPTED, MatchStatusEnum.CANCELLED],
      [MatchStatusEnum.TIMEOUT, MatchStatusEnum.MANUAL_BROWSE],
    ];

    it.each(validTransitions)(
      'should allow transition from %s to %s',
      (from, to) => {
        expect(() => service.validateTransition(from, to)).not.toThrow();
      },
    );

    const invalidTransitions: [MatchStatusEnum, MatchStatusEnum][] = [
      [MatchStatusEnum.SEARCHING, MatchStatusEnum.CONSULTATION_CREATED],
      [MatchStatusEnum.SEARCHING, MatchStatusEnum.MANUAL_BROWSE],
      [MatchStatusEnum.SEARCHING, MatchStatusEnum.ACCEPTED],
      [MatchStatusEnum.MATCHED, MatchStatusEnum.MANUAL_BROWSE],
      [MatchStatusEnum.ACCEPTED, MatchStatusEnum.SEARCHING],
      [MatchStatusEnum.ACCEPTED, MatchStatusEnum.MATCHED],
      [MatchStatusEnum.ACCEPTED, MatchStatusEnum.TIMEOUT],
      [MatchStatusEnum.CONSULTATION_CREATED, MatchStatusEnum.SEARCHING],
      [MatchStatusEnum.CONSULTATION_CREATED, MatchStatusEnum.CANCELLED],
      [MatchStatusEnum.CONSULTATION_CREATED, MatchStatusEnum.ACCEPTED],
      [MatchStatusEnum.TIMEOUT, MatchStatusEnum.SEARCHING],
      [MatchStatusEnum.TIMEOUT, MatchStatusEnum.CANCELLED],
      [MatchStatusEnum.MANUAL_BROWSE, MatchStatusEnum.SEARCHING],
      [MatchStatusEnum.MANUAL_BROWSE, MatchStatusEnum.TIMEOUT],
      [MatchStatusEnum.CANCELLED, MatchStatusEnum.SEARCHING],
      [MatchStatusEnum.CANCELLED, MatchStatusEnum.MATCHED],
    ];

    it.each(invalidTransitions)(
      'should reject transition from %s to %s',
      (from, to) => {
        expect(() => service.validateTransition(from, to)).toThrow(
          BadRequestException,
        );
      },
    );

    it('should throw with descriptive message on invalid transition', () => {
      expect(() =>
        service.validateTransition(
          MatchStatusEnum.CANCELLED,
          MatchStatusEnum.SEARCHING,
        ),
      ).toThrow('Cannot transition match from CANCELLED to SEARCHING.');
    });

    it('should allow no transitions from terminal states', () => {
      const terminalStates = [
        MatchStatusEnum.CONSULTATION_CREATED,
        MatchStatusEnum.MANUAL_BROWSE,
        MatchStatusEnum.CANCELLED,
      ];
      for (const state of terminalStates) {
        for (const target of Object.values(MatchStatusEnum)) {
          expect(() => service.validateTransition(state, target)).toThrow(
            BadRequestException,
          );
        }
      }
    });
  });

  // ──────────────── scoreDoctors ────────────────

  describe('scoreDoctors', () => {
    function buildMockDoctor(overrides: Record<string, any> = {}) {
      const profile = buildDoctorProfile({
        verified: true,
        specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
        secondarySpecialties: [],
        ...overrides,
      });
      return {
        id: profile.id,
        specialty: profile.specialty,
        secondarySpecialties: profile.secondarySpecialties,
        verified: true,
        user: {
          id: profile.userId,
          firstname: 'Dr',
          lastname: 'Test',
          avatar: null,
          isActive: true,
        },
        _count: { consultations: overrides.consultationCount ?? 50 },
      };
    }

    it('should return scored and sorted doctors (top 10)', async () => {
      const doctors = Array.from({ length: 12 }, (_, i) =>
        buildMockDoctor({ id: i + 1, consultationCount: (i + 1) * 10 }),
      );
      prisma.doctorProfile.findMany.mockResolvedValue(doctors);
      const ratingData = { averageRating: 4.0, totalReviews: 10, distribution: { 1: 0, 2: 0, 3: 2, 4: 5, 5: 3 } };
      reviewService.getAggregateRatingsForDoctors.mockResolvedValue(
        new Map(doctors.map((d) => [d.id, ratingData])),
      );
      schedulingService.countAvailableSlotsForDoctors.mockResolvedValue(
        new Map(doctors.map((d) => [d.id, 10])),
      );

      const result = await service.scoreDoctors({});

      expect(result).toHaveLength(10);
      expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
      expect(result[9].score).toBeLessThanOrEqual(result[0].score);
    });

    it('should return empty array when no doctors found', async () => {
      prisma.doctorProfile.findMany.mockResolvedValue([]);

      const result = await service.scoreDoctors({});

      expect(result).toEqual([]);
    });

    it('should give 1.0 specialty score for exact match', async () => {
      const doc = buildMockDoctor({
        id: 1,
        specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
      });
      prisma.doctorProfile.findMany.mockResolvedValue([doc]);
      reviewService.getAggregateRatingsForDoctors.mockResolvedValue(
        new Map([[1, { averageRating: null, totalReviews: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }]]),
      );
      schedulingService.countAvailableSlotsForDoctors.mockResolvedValue(new Map([[1, 0]]));

      const result = await service.scoreDoctors({
        specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
      });

      expect(result).toHaveLength(1);
      // Exact specialty match: 40 * 1.0 = 40, rating 0.5 default (null): 25 * 0.5 = 12.5
      // availability 0: 0, experience 50/200=0.25: 15*0.25 = 3.75
      // total: 40 + 12.5 + 0 + 3.75 = 56.25
      expect(result[0].score).toBe(56.25);
    });

    it('should give 0.6 specialty score for secondary specialty match', async () => {
      const doc = buildMockDoctor({
        id: 1,
        specialty: DoctorSpecialtiesEnum.GENERAL,
        secondarySpecialties: [DoctorSpecialtiesEnum.DERMATOLOGY],
        consultationCount: 0,
      });
      prisma.doctorProfile.findMany.mockResolvedValue([doc]);
      reviewService.getAggregateRatingsForDoctors.mockResolvedValue(
        new Map([[1, { averageRating: null, totalReviews: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }]]),
      );
      schedulingService.countAvailableSlotsForDoctors.mockResolvedValue(new Map([[1, 0]]));

      const result = await service.scoreDoctors({
        specialty: DoctorSpecialtiesEnum.DERMATOLOGY,
      });

      // secondary match: 40 * 0.6 = 24, rating null: 25 * 0.5 = 12.5, avail 0, exp 0
      expect(result[0].score).toBe(36.5);
    });

    it('should give 0.3 specialty score for GENERAL doctor when criteria has specific specialty', async () => {
      const doc = buildMockDoctor({
        id: 1,
        specialty: DoctorSpecialtiesEnum.GENERAL,
        secondarySpecialties: [],
        consultationCount: 0,
      });
      prisma.doctorProfile.findMany.mockResolvedValue([doc]);
      reviewService.getAggregateRatingsForDoctors.mockResolvedValue(
        new Map([[1, { averageRating: null, totalReviews: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }]]),
      );
      schedulingService.countAvailableSlotsForDoctors.mockResolvedValue(new Map([[1, 0]]));

      const result = await service.scoreDoctors({
        specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
      });

      // GENERAL fallback: 40 * 0.3 = 12, rating: 12.5, avail 0, exp 0
      expect(result[0].score).toBe(24.5);
    });

    it('should give 0.5 specialty score when no specialty criteria provided', async () => {
      const doc = buildMockDoctor({
        id: 1,
        specialty: DoctorSpecialtiesEnum.NEUROLOGY,
        consultationCount: 0,
      });
      prisma.doctorProfile.findMany.mockResolvedValue([doc]);
      reviewService.getAggregateRatingsForDoctors.mockResolvedValue(
        new Map([[1, { averageRating: null, totalReviews: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }]]),
      );
      schedulingService.countAvailableSlotsForDoctors.mockResolvedValue(new Map([[1, 0]]));

      const result = await service.scoreDoctors({});

      // no criteria: 40 * 0.5 = 20, rating: 12.5, avail 0, exp 0
      expect(result[0].score).toBe(32.5);
    });

    it('should handle review service errors gracefully', async () => {
      const doc = buildMockDoctor({ id: 1, consultationCount: 0 });
      prisma.doctorProfile.findMany.mockResolvedValue([doc]);
      reviewService.getAggregateRatingsForDoctors.mockRejectedValue(new Error('DB error'));
      schedulingService.countAvailableSlotsForDoctors.mockResolvedValue(new Map([[1, 0]]));

      const result = await service.scoreDoctors({});

      expect(result).toHaveLength(1);
      // Falls back to averageRating: null => ratingScore 0.5
      expect(result[0].rating).toBeNull();
    });

    it('should handle scheduling service errors gracefully', async () => {
      const doc = buildMockDoctor({ id: 1, consultationCount: 0 });
      prisma.doctorProfile.findMany.mockResolvedValue([doc]);
      reviewService.getAggregateRatingsForDoctors.mockResolvedValue(
        new Map([[1, { averageRating: 5.0, totalReviews: 20, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 20 } }]]),
      );
      schedulingService.countAvailableSlotsForDoctors.mockRejectedValue(
        new Error('Service down'),
      );

      const result = await service.scoreDoctors({});

      expect(result).toHaveLength(1);
      expect(result[0].availableSlots).toBe(0);
    });

    it('should exclude doctors by excludeDoctorIds', async () => {
      const doc1 = buildMockDoctor({ id: 1 });
      const doc2 = buildMockDoctor({ id: 2 });
      prisma.doctorProfile.findMany.mockResolvedValue([doc2]);
      reviewService.getAggregateRatingsForDoctors.mockResolvedValue(
        new Map([[2, { averageRating: 4.0, totalReviews: 5, distribution: { 1: 0, 2: 0, 3: 0, 4: 3, 5: 2 } }]]),
      );
      schedulingService.countAvailableSlotsForDoctors.mockResolvedValue(new Map([[2, 0]]));

      await service.scoreDoctors({ excludeDoctorIds: [doc1.id] });

      expect(prisma.doctorProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: [doc1.id] },
          }),
        }),
      );
    });

    it('should cap availability score at 1.0', async () => {
      const doc = buildMockDoctor({ id: 1, consultationCount: 0 });
      prisma.doctorProfile.findMany.mockResolvedValue([doc]);
      reviewService.getAggregateRatingsForDoctors.mockResolvedValue(
        new Map([[1, { averageRating: null, totalReviews: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }]]),
      );
      // 100 slots > maxSlots (50), should cap at 1.0
      schedulingService.countAvailableSlotsForDoctors.mockResolvedValue(new Map([[1, 100]]));

      const result = await service.scoreDoctors({});

      // no spec: 20, rating null: 12.5, avail capped 1.0: 20, exp 0
      expect(result[0].score).toBe(52.5);
    });

    it('should cap experience score at 1.0', async () => {
      const doc = buildMockDoctor({ id: 1, consultationCount: 500 });
      prisma.doctorProfile.findMany.mockResolvedValue([doc]);
      reviewService.getAggregateRatingsForDoctors.mockResolvedValue(
        new Map([[1, { averageRating: null, totalReviews: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }]]),
      );
      schedulingService.countAvailableSlotsForDoctors.mockResolvedValue(new Map([[1, 0]]));

      const result = await service.scoreDoctors({});

      // no spec: 20, rating null: 12.5, avail 0, exp capped 1.0: 15
      expect(result[0].score).toBe(47.5);
    });

    it('should include correct fields in scored doctor result', async () => {
      const doc = buildMockDoctor({
        id: 7,
        specialty: DoctorSpecialtiesEnum.PSYCHIATRY,
        secondarySpecialties: [DoctorSpecialtiesEnum.NEUROLOGY],
        consultationCount: 25,
      });
      doc.user.firstname = 'Jane';
      doc.user.lastname = 'Smith';
      doc.user.avatar = 'avatar-url.jpg';
      prisma.doctorProfile.findMany.mockResolvedValue([doc]);
      reviewService.getAggregateRatingsForDoctors.mockResolvedValue(
        new Map([[7, { averageRating: 3.5, totalReviews: 8, distribution: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 2 } }]]),
      );
      schedulingService.countAvailableSlotsForDoctors.mockResolvedValue(new Map([[7, 0]]));

      const result = await service.scoreDoctors({});

      expect(result[0]).toEqual(
        expect.objectContaining({
          doctorId: 7,
          userId: doc.user.id,
          firstname: 'Jane',
          lastname: 'Smith',
          avatar: 'avatar-url.jpg',
          specialty: DoctorSpecialtiesEnum.PSYCHIATRY,
          secondarySpecialties: [DoctorSpecialtiesEnum.NEUROLOGY],
          rating: 3.5,
          totalReviews: 8,
          availableSlots: 0,
        }),
      );
      expect(typeof result[0].score).toBe('number');
    });
  });

  // ──────────────── createMatchRequest ────────────────

  describe('createMatchRequest', () => {
    const matchRequestId = randomUUID();

    it('should create a match request for a patient', async () => {
      prisma.matchRequest.findFirst.mockResolvedValue(null);
      const created = {
        id: matchRequestId,
        patientId: patient.id,
        soapId: null,
        specialty: null,
        triageLevel: null,
        status: MatchStatusEnum.SEARCHING,
        createdAt: new Date(),
      };
      prisma.matchRequest.create.mockResolvedValue(created);
      prisma.doctorProfile.findMany.mockResolvedValue([]);

      const result = await service.createMatchRequest(patient as any);

      expect(result.matchRequest).toEqual(created);
      expect(result.doctors).toEqual([]);
      expect(prisma.matchRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: patient.id,
            status: MatchStatusEnum.SEARCHING,
            soapId: null,
          }),
        }),
      );
    });

    it('should reject non-patient users', async () => {
      await expect(
        service.createMatchRequest(doctor as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject admin users', async () => {
      await expect(
        service.createMatchRequest(admin as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject when active match request exists', async () => {
      prisma.matchRequest.findFirst.mockResolvedValue({
        id: randomUUID(),
        status: MatchStatusEnum.SEARCHING,
      });

      await expect(
        service.createMatchRequest(patient as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when MATCHED request already exists', async () => {
      prisma.matchRequest.findFirst.mockResolvedValue({
        id: randomUUID(),
        status: MatchStatusEnum.MATCHED,
      });

      await expect(
        service.createMatchRequest(patient as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use SOAP specialty when soapId provided', async () => {
      const soapId = randomUUID();
      prisma.matchRequest.findFirst.mockResolvedValue(null);
      prisma.patientSOAP.findUnique.mockResolvedValue({
        id: soapId,
        userId: patient.id,
        suggestedSpecialty: DoctorSpecialtiesEnum.CARDIOLOGY,
        triageLevel: TriageLevelEnum.SEE_DOCTOR,
      });
      prisma.matchRequest.create.mockResolvedValue({
        id: matchRequestId,
        patientId: patient.id,
        soapId,
        specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
        triageLevel: TriageLevelEnum.SEE_DOCTOR,
        status: MatchStatusEnum.SEARCHING,
      });
      prisma.doctorProfile.findMany.mockResolvedValue([]);

      const result = await service.createMatchRequest(
        patient as any,
        soapId,
      );

      expect(prisma.matchRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            soapId,
            specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
            triageLevel: TriageLevelEnum.SEE_DOCTOR,
          }),
        }),
      );
      expect(result.matchRequest.soapId).toBe(soapId);
    });

    it('should throw NotFoundException when SOAP not found', async () => {
      prisma.matchRequest.findFirst.mockResolvedValue(null);
      prisma.patientSOAP.findUnique.mockResolvedValue(null);

      await expect(
        service.createMatchRequest(patient as any, randomUUID()),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when SOAP belongs to another user', async () => {
      const soapId = randomUUID();
      prisma.matchRequest.findFirst.mockResolvedValue(null);
      prisma.patientSOAP.findUnique.mockResolvedValue({
        id: soapId,
        userId: randomUUID(), // different user
        suggestedSpecialty: null,
        triageLevel: null,
      });

      await expect(
        service.createMatchRequest(patient as any, soapId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should prefer manualSpecialty over SOAP suggestedSpecialty', async () => {
      const soapId = randomUUID();
      prisma.matchRequest.findFirst.mockResolvedValue(null);
      prisma.patientSOAP.findUnique.mockResolvedValue({
        id: soapId,
        userId: patient.id,
        suggestedSpecialty: DoctorSpecialtiesEnum.CARDIOLOGY,
        triageLevel: TriageLevelEnum.SELF_CARE,
      });
      prisma.matchRequest.create.mockResolvedValue({
        id: matchRequestId,
        patientId: patient.id,
        soapId,
        specialty: DoctorSpecialtiesEnum.DERMATOLOGY,
        status: MatchStatusEnum.SEARCHING,
      });
      prisma.doctorProfile.findMany.mockResolvedValue([]);

      await service.createMatchRequest(
        patient as any,
        soapId,
        DoctorSpecialtiesEnum.DERMATOLOGY,
      );

      expect(prisma.matchRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            specialty: DoctorSpecialtiesEnum.DERMATOLOGY,
          }),
        }),
      );
    });

    it('should create with null specialty when no soap and no manual specialty', async () => {
      prisma.matchRequest.findFirst.mockResolvedValue(null);
      prisma.matchRequest.create.mockResolvedValue({
        id: matchRequestId,
        patientId: patient.id,
        soapId: null,
        specialty: null,
        triageLevel: null,
        status: MatchStatusEnum.SEARCHING,
      });
      prisma.doctorProfile.findMany.mockResolvedValue([]);

      await service.createMatchRequest(patient as any);

      expect(prisma.matchRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            specialty: null,
            triageLevel: null,
            soapId: null,
          }),
        }),
      );
    });
  });

  // ──────────────── matchDoctor ────────────────

  describe('matchDoctor', () => {
    it('should update request to MATCHED with doctorId', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        status: MatchStatusEnum.SEARCHING,
      });
      const updated = {
        id: requestId,
        status: MatchStatusEnum.MATCHED,
        matchedDoctorId: 5,
      };
      prisma.matchRequest.update.mockResolvedValue(updated);

      const result = await service.matchDoctor(requestId, 5);

      expect(result).toEqual(updated);
      expect(prisma.matchRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: {
          status: MatchStatusEnum.MATCHED,
          matchedDoctorId: 5,
        },
      });
    });

    it('should throw NotFoundException when request not found', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.matchDoctor(randomUUID(), 1),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid transition', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: randomUUID(),
        status: MatchStatusEnum.CANCELLED,
      });

      await expect(
        service.matchDoctor(randomUUID(), 1),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────── acceptMatch ────────────────

  describe('acceptMatch', () => {
    const requestId = randomUUID();
    const consultationId = randomUUID();
    const doctorProfileId = 42;

    beforeEach(() => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: doctorProfileId,
        userId: doctor.id,
      });
    });

    it('should accept match and create consultation', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        soapId: null,
        matchedDoctorId: doctorProfileId,
        status: MatchStatusEnum.MATCHED,
      });
      prisma.consultation.create.mockResolvedValue({
        id: consultationId,
        patientId: patient.id,
        doctorId: doctorProfileId,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });
      const updatedRequest = {
        id: requestId,
        status: MatchStatusEnum.CONSULTATION_CREATED,
        consultationId,
        resolvedAt: expect.any(Date),
      };
      prisma.matchRequest.update.mockResolvedValue(updatedRequest);

      const result = await service.acceptMatch(requestId, doctor as any);

      expect(result.consultationId).toBe(consultationId);
      expect(result.matchRequest).toEqual(updatedRequest);
      expect(prisma.consultation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: patient.id,
            doctorId: doctorProfileId,
            status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
          }),
        }),
      );
    });

    it('should reject non-doctor users', async () => {
      await expect(
        service.acceptMatch(requestId, patient as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when doctor profile not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptMatch(requestId, doctor as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when request not assigned to this doctor', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        matchedDoctorId: 999, // different doctor
        status: MatchStatusEnum.MATCHED,
      });

      await expect(
        service.acceptMatch(requestId, doctor as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException for invalid transition (not MATCHED)', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        matchedDoctorId: doctorProfileId,
        status: MatchStatusEnum.SEARCHING, // wrong status
      });

      await expect(
        service.acceptMatch(requestId, doctor as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when match request not found', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptMatch(requestId, doctor as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should pass soapId to consultation when present', async () => {
      const soapId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        soapId,
        matchedDoctorId: doctorProfileId,
        status: MatchStatusEnum.MATCHED,
      });
      prisma.consultation.create.mockResolvedValue({
        id: consultationId,
        patientId: patient.id,
        doctorId: doctorProfileId,
        soapId,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });
      prisma.matchRequest.update.mockResolvedValue({
        id: requestId,
        status: MatchStatusEnum.CONSULTATION_CREATED,
      });

      await service.acceptMatch(requestId, doctor as any);

      expect(prisma.consultation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ soapId }),
        }),
      );
    });
  });

  // ──────────────── rejectMatch ────────────────

  describe('rejectMatch', () => {
    const requestId = randomUUID();
    const doctorProfileId = 10;

    beforeEach(() => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: doctorProfileId,
        userId: doctor.id,
      });
    });

    it('should reject match, clear doctor, and re-score', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        matchedDoctorId: doctorProfileId,
        specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
        triageLevel: null,
        status: MatchStatusEnum.MATCHED,
      });
      const updated = {
        id: requestId,
        status: MatchStatusEnum.SEARCHING,
        matchedDoctorId: null,
      };
      prisma.matchRequest.update.mockResolvedValue(updated);
      prisma.doctorProfile.findMany.mockResolvedValue([]);

      const result = await service.rejectMatch(requestId, doctor as any);

      expect(result.matchRequest).toEqual(updated);
      expect(result.nextDoctors).toEqual([]);
      expect(prisma.matchRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: {
          status: MatchStatusEnum.SEARCHING,
          matchedDoctorId: null,
        },
      });
    });

    it('should reject non-doctor users', async () => {
      await expect(
        service.rejectMatch(requestId, patient as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when doctor profile not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.rejectMatch(requestId, doctor as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when request not assigned to this doctor', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        matchedDoctorId: 999,
        status: MatchStatusEnum.MATCHED,
      });

      await expect(
        service.rejectMatch(requestId, doctor as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException for invalid transition', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        matchedDoctorId: doctorProfileId,
        status: MatchStatusEnum.CANCELLED,
      });

      await expect(
        service.rejectMatch(requestId, doctor as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should exclude the rejected doctor from re-scoring', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        matchedDoctorId: doctorProfileId,
        specialty: null,
        triageLevel: null,
        status: MatchStatusEnum.MATCHED,
      });
      prisma.matchRequest.update.mockResolvedValue({
        id: requestId,
        status: MatchStatusEnum.SEARCHING,
        matchedDoctorId: null,
      });
      prisma.doctorProfile.findMany.mockResolvedValue([]);

      await service.rejectMatch(requestId, doctor as any);

      expect(prisma.doctorProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: [doctorProfileId] },
          }),
        }),
      );
    });
  });

  // ──────────────── timeoutRequest ────────────────

  describe('timeoutRequest', () => {
    it('should timeout a SEARCHING request', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        status: MatchStatusEnum.SEARCHING,
      });
      const updated = {
        id: requestId,
        status: MatchStatusEnum.TIMEOUT,
        resolvedAt: expect.any(Date),
      };
      prisma.matchRequest.update.mockResolvedValue(updated);

      const result = await service.timeoutRequest(requestId);

      expect(result).toEqual(updated);
      expect(prisma.matchRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: {
          status: MatchStatusEnum.TIMEOUT,
          resolvedAt: expect.any(Date),
        },
      });
    });

    it('should timeout a MATCHED request', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        status: MatchStatusEnum.MATCHED,
      });
      prisma.matchRequest.update.mockResolvedValue({
        id: requestId,
        status: MatchStatusEnum.TIMEOUT,
      });

      const result = await service.timeoutRequest(requestId);

      expect(prisma.matchRequest.update).toHaveBeenCalled();
      expect(result.status).toBe(MatchStatusEnum.TIMEOUT);
    });

    it('should be a no-op for CANCELLED request', async () => {
      const requestId = randomUUID();
      const existing = {
        id: requestId,
        status: MatchStatusEnum.CANCELLED,
      };
      prisma.matchRequest.findUnique.mockResolvedValue(existing);

      const result = await service.timeoutRequest(requestId);

      expect(result).toEqual(existing);
      expect(prisma.matchRequest.update).not.toHaveBeenCalled();
    });

    it('should be a no-op for CONSULTATION_CREATED request', async () => {
      const requestId = randomUUID();
      const existing = {
        id: requestId,
        status: MatchStatusEnum.CONSULTATION_CREATED,
      };
      prisma.matchRequest.findUnique.mockResolvedValue(existing);

      const result = await service.timeoutRequest(requestId);

      expect(result).toEqual(existing);
      expect(prisma.matchRequest.update).not.toHaveBeenCalled();
    });

    it('should be a no-op for already TIMEOUT request', async () => {
      const requestId = randomUUID();
      const existing = { id: requestId, status: MatchStatusEnum.TIMEOUT };
      prisma.matchRequest.findUnique.mockResolvedValue(existing);

      const result = await service.timeoutRequest(requestId);

      expect(result).toEqual(existing);
      expect(prisma.matchRequest.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when request not found', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.timeoutRequest(randomUUID()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────────── cancelRequest ────────────────

  describe('cancelRequest', () => {
    it('should cancel a SEARCHING request by the patient owner', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        status: MatchStatusEnum.SEARCHING,
      });
      const updated = {
        id: requestId,
        status: MatchStatusEnum.CANCELLED,
        resolvedAt: expect.any(Date),
      };
      prisma.matchRequest.update.mockResolvedValue(updated);

      const result = await service.cancelRequest(requestId, patient as any);

      expect(result).toEqual(updated);
    });

    it('should cancel a MATCHED request', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        status: MatchStatusEnum.MATCHED,
      });
      prisma.matchRequest.update.mockResolvedValue({
        id: requestId,
        status: MatchStatusEnum.CANCELLED,
      });

      const result = await service.cancelRequest(requestId, patient as any);

      expect(result.status).toBe(MatchStatusEnum.CANCELLED);
    });

    it('should cancel an ACCEPTED request', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        status: MatchStatusEnum.ACCEPTED,
      });
      prisma.matchRequest.update.mockResolvedValue({
        id: requestId,
        status: MatchStatusEnum.CANCELLED,
      });

      const result = await service.cancelRequest(requestId, patient as any);

      expect(result.status).toBe(MatchStatusEnum.CANCELLED);
    });

    it('should allow admin to cancel any request', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: randomUUID(), // someone else's request
        status: MatchStatusEnum.SEARCHING,
      });
      prisma.matchRequest.update.mockResolvedValue({
        id: requestId,
        status: MatchStatusEnum.CANCELLED,
      });

      const result = await service.cancelRequest(requestId, admin as any);

      expect(result.status).toBe(MatchStatusEnum.CANCELLED);
    });

    it('should allow superAdmin to cancel any request', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: randomUUID(),
        status: MatchStatusEnum.MATCHED,
      });
      prisma.matchRequest.update.mockResolvedValue({
        id: requestId,
        status: MatchStatusEnum.CANCELLED,
      });

      const result = await service.cancelRequest(requestId, superAdmin as any);

      expect(result.status).toBe(MatchStatusEnum.CANCELLED);
    });

    it('should reject when non-owner non-admin tries to cancel', async () => {
      const otherPatient = createMockUser();
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id, // belongs to patient
        status: MatchStatusEnum.SEARCHING,
      });

      await expect(
        service.cancelRequest(requestId, otherPatient as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject doctor trying to cancel patient request', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        status: MatchStatusEnum.SEARCHING,
      });

      await expect(
        service.cancelRequest(requestId, doctor as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject cancelling CONSULTATION_CREATED (terminal)', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        status: MatchStatusEnum.CONSULTATION_CREATED,
      });

      await expect(
        service.cancelRequest(requestId, patient as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when request not found', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.cancelRequest(randomUUID(), patient as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────────── fallbackToManualBrowse ────────────────

  describe('fallbackToManualBrowse', () => {
    it('should transition TIMEOUT to MANUAL_BROWSE', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        status: MatchStatusEnum.TIMEOUT,
      });
      const updated = {
        id: requestId,
        status: MatchStatusEnum.MANUAL_BROWSE,
        resolvedAt: expect.any(Date),
      };
      prisma.matchRequest.update.mockResolvedValue(updated);

      const result = await service.fallbackToManualBrowse(requestId, patient as any);

      expect(result).toEqual(updated);
      expect(prisma.matchRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: {
          status: MatchStatusEnum.MANUAL_BROWSE,
          resolvedAt: expect.any(Date),
        },
      });
    });

    it('should reject from SEARCHING status', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: randomUUID(),
        patientId: patient.id,
        status: MatchStatusEnum.SEARCHING,
      });

      await expect(
        service.fallbackToManualBrowse(randomUUID(), patient as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject from CANCELLED status', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: randomUUID(),
        patientId: patient.id,
        status: MatchStatusEnum.CANCELLED,
      });

      await expect(
        service.fallbackToManualBrowse(randomUUID(), patient as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when request not found', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.fallbackToManualBrowse(randomUUID(), patient as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────────── getStatus ────────────────

  describe('getStatus', () => {
    it('should return request for the patient owner', async () => {
      const requestId = randomUUID();
      const request = {
        id: requestId,
        patientId: patient.id,
        status: MatchStatusEnum.SEARCHING,
        matchedDoctor: null,
        soap: null,
      };
      prisma.matchRequest.findUnique.mockResolvedValue(request);

      const result = await service.getStatus(requestId, patient as any);

      expect(result).toEqual(request);
    });

    it('should return request for admin', async () => {
      const requestId = randomUUID();
      const request = {
        id: requestId,
        patientId: randomUUID(),
        status: MatchStatusEnum.MATCHED,
        matchedDoctor: null,
        soap: null,
      };
      prisma.matchRequest.findUnique.mockResolvedValue(request);

      const result = await service.getStatus(requestId, admin as any);

      expect(result).toEqual(request);
    });

    it('should return request for superAdmin', async () => {
      const requestId = randomUUID();
      const request = {
        id: requestId,
        patientId: randomUUID(),
        status: MatchStatusEnum.SEARCHING,
        matchedDoctor: null,
        soap: null,
      };
      prisma.matchRequest.findUnique.mockResolvedValue(request);

      const result = await service.getStatus(requestId, superAdmin as any);

      expect(result).toEqual(request);
    });

    it('should return request for the matched doctor', async () => {
      const requestId = randomUUID();
      const doctorProfileId = 15;
      const request = {
        id: requestId,
        patientId: randomUUID(),
        matchedDoctorId: doctorProfileId,
        status: MatchStatusEnum.MATCHED,
        matchedDoctor: null,
        soap: null,
      };
      prisma.matchRequest.findUnique.mockResolvedValue(request);
      // Doctor profile lookup for access check
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: doctorProfileId,
        userId: doctor.id,
      });

      const result = await service.getStatus(requestId, doctor as any);

      expect(result).toEqual(request);
    });

    it('should throw ForbiddenException for unrelated user', async () => {
      const requestId = randomUUID();
      const unrelatedUser = createMockUser();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        matchedDoctorId: 99,
        status: MatchStatusEnum.MATCHED,
        matchedDoctor: null,
        soap: null,
      });
      // Not the matched doctor
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.getStatus(requestId, unrelatedUser as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for doctor not assigned to request', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: randomUUID(),
        matchedDoctorId: 99,
        status: MatchStatusEnum.MATCHED,
        matchedDoctor: null,
        soap: null,
      });
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 50, // different from matchedDoctorId
        userId: doctor.id,
      });

      await expect(
        service.getStatus(requestId, doctor as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when request not found', async () => {
      prisma.matchRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.getStatus(randomUUID(), patient as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should include matchedDoctor and soap in query', async () => {
      const requestId = randomUUID();
      prisma.matchRequest.findUnique.mockResolvedValue({
        id: requestId,
        patientId: patient.id,
        status: MatchStatusEnum.SEARCHING,
      });

      await service.getStatus(requestId, patient as any);

      expect(prisma.matchRequest.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            matchedDoctor: expect.any(Object),
            soap: expect.any(Object),
          }),
        }),
      );
    });
  });

  // ──────────────── getActiveForPatient ────────────────

  describe('getActiveForPatient', () => {
    it('should return active match request for patient', async () => {
      const request = {
        id: randomUUID(),
        patientId: patient.id,
        status: MatchStatusEnum.SEARCHING,
      };
      prisma.matchRequest.findFirst.mockResolvedValue(request);

      const result = await service.getActiveForPatient(patient.id);

      expect(result).toEqual(request);
      expect(prisma.matchRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            patientId: patient.id,
            status: { in: [MatchStatusEnum.SEARCHING, MatchStatusEnum.MATCHED] },
          },
        }),
      );
    });

    it('should return null when no active request exists', async () => {
      prisma.matchRequest.findFirst.mockResolvedValue(null);

      const result = await service.getActiveForPatient(patient.id);

      expect(result).toBeNull();
    });
  });

  // ──────────────── getPendingForDoctor ────────────────

  describe('getPendingForDoctor', () => {
    const doctorProfileId = 20;

    it('should return MATCHED requests for this doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: doctorProfileId,
        userId: doctor.id,
      });
      const requests = [
        { id: randomUUID(), matchedDoctorId: doctorProfileId, status: MatchStatusEnum.MATCHED },
        { id: randomUUID(), matchedDoctorId: doctorProfileId, status: MatchStatusEnum.MATCHED },
      ];
      prisma.matchRequest.findMany.mockResolvedValue(requests);

      const result = await service.getPendingForDoctor(doctor as any);

      expect(result).toEqual(requests);
      expect(prisma.matchRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            matchedDoctorId: doctorProfileId,
            status: MatchStatusEnum.MATCHED,
          },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('should return empty array when no pending requests', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: doctorProfileId,
        userId: doctor.id,
      });
      prisma.matchRequest.findMany.mockResolvedValue([]);

      const result = await service.getPendingForDoctor(doctor as any);

      expect(result).toEqual([]);
    });

    it('should reject non-doctor users', async () => {
      await expect(
        service.getPendingForDoctor(patient as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when doctor profile not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.getPendingForDoctor(doctor as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────────── isExpired ────────────────

  describe('isExpired', () => {
    it('should return true when request is older than 5 minutes', () => {
      const request = {
        createdAt: new Date(Date.now() - 6 * 60 * 1000), // 6 minutes ago
      } as any;

      expect(service.isExpired(request)).toBe(true);
    });

    it('should return false when request is newer than 5 minutes', () => {
      const request = {
        createdAt: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
      } as any;

      expect(service.isExpired(request)).toBe(false);
    });

    it('should return false at exactly 5 minutes', () => {
      const request = {
        createdAt: new Date(Date.now() - 5 * 60 * 1000 + 50), // 50ms buffer for test execution time
      } as any;

      expect(service.isExpired(request)).toBe(false);
    });

    it('should return true at 5 minutes + 1ms', () => {
      const request = {
        createdAt: new Date(Date.now() - 5 * 60 * 1000 - 1),
      } as any;

      expect(service.isExpired(request)).toBe(true);
    });

    it('should return false for just-created request', () => {
      const request = { createdAt: new Date() } as any;

      expect(service.isExpired(request)).toBe(false);
    });
  });

  // ──────────────── getDoctorUserId ────────────────

  describe('getDoctorUserId', () => {
    it('should return userId for existing doctor profile', async () => {
      const userId = randomUUID();
      prisma.doctorProfile.findUnique.mockResolvedValue({ userId });

      const result = await service.getDoctorUserId(42);

      expect(result).toBe(userId);
      expect(prisma.doctorProfile.findUnique).toHaveBeenCalledWith({
        where: { id: 42 },
        select: { userId: true },
      });
    });

    it('should return null when doctor profile not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      const result = await service.getDoctorUserId(999);

      expect(result).toBeNull();
    });
  });
});
