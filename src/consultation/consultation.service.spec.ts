import { Test, TestingModule } from '@nestjs/testing';
import { ConsultationService } from './consultation.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/helpers/mock-prisma.helper';
import {
  createMockUser,
  createMockDoctorUser,
  createMockAdminUser,
  MockUser,
} from '../../test/helpers/mock-session.helper';
import {
  ConsultationStatusEnum,
  ConsultationModeEnum,
  VisitMethodsEnum,
  UserRolesEnum,
} from '@prisma/client';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

describe('ConsultationService', () => {
  let service: ConsultationService;
  let prisma: MockPrismaService;
  let patient: MockUser;
  let doctor: MockUser;
  let admin: MockUser;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    patient = createMockUser();
    doctor = createMockDoctorUser();
    admin = createMockAdminUser();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsultationService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationService,
          useValue: {
            onNewConsultation: jest.fn().mockResolvedValue(undefined),
            onDoctorDecision: jest.fn().mockResolvedValue(undefined),
            onPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ConsultationService>(ConsultationService);
  });

  // ──────────────── State Machine ────────────────

  describe('validateTransition', () => {
    const validTransitions: [ConsultationStatusEnum, ConsultationStatusEnum][] = [
      [ConsultationStatusEnum.CREATED, ConsultationStatusEnum.PENDING_DOCTOR_REVIEW],
      [ConsultationStatusEnum.CREATED, ConsultationStatusEnum.CANCELLED],
      [ConsultationStatusEnum.PENDING_DOCTOR_REVIEW, ConsultationStatusEnum.DOCTOR_DECIDED],
      [ConsultationStatusEnum.PENDING_DOCTOR_REVIEW, ConsultationStatusEnum.CANCELLED],
      [ConsultationStatusEnum.DOCTOR_DECIDED, ConsultationStatusEnum.PENDING_PAYMENT],
      [ConsultationStatusEnum.DOCTOR_DECIDED, ConsultationStatusEnum.CANCELLED],
      [ConsultationStatusEnum.PENDING_PAYMENT, ConsultationStatusEnum.PAYMENT_CONFIRMED],
      [ConsultationStatusEnum.PENDING_PAYMENT, ConsultationStatusEnum.CANCELLED],
      [ConsultationStatusEnum.PAYMENT_CONFIRMED, ConsultationStatusEnum.IN_PROGRESS],
      [ConsultationStatusEnum.PAYMENT_CONFIRMED, ConsultationStatusEnum.CANCELLED],
      [ConsultationStatusEnum.IN_PROGRESS, ConsultationStatusEnum.COMPLETED],
      [ConsultationStatusEnum.IN_PROGRESS, ConsultationStatusEnum.CANCELLED],
    ];

    it.each(validTransitions)(
      'should allow transition from %s to %s',
      (from, to) => {
        expect(() => service.validateTransition(from, to)).not.toThrow();
      },
    );

    const invalidTransitions: [ConsultationStatusEnum, ConsultationStatusEnum][] = [
      [ConsultationStatusEnum.CREATED, ConsultationStatusEnum.COMPLETED],
      [ConsultationStatusEnum.CREATED, ConsultationStatusEnum.IN_PROGRESS],
      [ConsultationStatusEnum.PENDING_DOCTOR_REVIEW, ConsultationStatusEnum.COMPLETED],
      [ConsultationStatusEnum.DOCTOR_DECIDED, ConsultationStatusEnum.IN_PROGRESS],
      [ConsultationStatusEnum.PENDING_PAYMENT, ConsultationStatusEnum.COMPLETED],
      [ConsultationStatusEnum.COMPLETED, ConsultationStatusEnum.CANCELLED],
      [ConsultationStatusEnum.COMPLETED, ConsultationStatusEnum.IN_PROGRESS],
      [ConsultationStatusEnum.CANCELLED, ConsultationStatusEnum.CREATED],
      [ConsultationStatusEnum.CANCELLED, ConsultationStatusEnum.IN_PROGRESS],
      [ConsultationStatusEnum.IN_PROGRESS, ConsultationStatusEnum.CREATED],
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
          ConsultationStatusEnum.COMPLETED,
          ConsultationStatusEnum.IN_PROGRESS,
        ),
      ).toThrow('Cannot transition from COMPLETED to IN_PROGRESS.');
    });
  });

  // ──────────────── Create ────────────────

  describe('create', () => {
    const dto = { doctorId: 1 };

    it('should create a consultation for a patient', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        verified: true,
      });
      const created = {
        id: 'consult-uuid',
        patientId: patient.id,
        doctorId: 1,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      };
      prisma.consultation.create.mockResolvedValue(created);

      const result = await service.create(patient as any, dto);

      expect(result).toEqual(created);
      expect(prisma.consultation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: patient.id,
            doctorId: 1,
            status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
          }),
        }),
      );
    });

    it('should reject non-patient users', async () => {
      await expect(service.create(doctor as any, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject if doctor not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);
      await expect(service.create(patient as any, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject if doctor not verified', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        verified: false,
      });
      await expect(service.create(patient as any, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should create with soapId when provided', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        verified: true,
      });
      prisma.patientSOAP.findUnique.mockResolvedValue({
        id: 'soap-1',
        userId: patient.id,
      });
      prisma.consultation.create.mockResolvedValue({
        id: 'consult-uuid',
        soapId: 'soap-1',
      });

      await service.create(patient as any, {
        doctorId: 1,
        soapId: 'soap-1',
      });

      expect(prisma.consultation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ soapId: 'soap-1' }),
        }),
      );
    });

    it('should reject if SOAP not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        verified: true,
      });
      prisma.patientSOAP.findUnique.mockResolvedValue(null);

      await expect(
        service.create(patient as any, { doctorId: 1, soapId: 'bad-soap' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject if SOAP belongs to another user', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        verified: true,
      });
      prisma.patientSOAP.findUnique.mockResolvedValue({
        id: 'soap-1',
        userId: 'other-user',
      });

      await expect(
        service.create(patient as any, { doctorId: 1, soapId: 'soap-1' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ──────────────── Doctor Decide ────────────────

  describe('doctorDecide', () => {
    const consultationId = 'consult-uuid';
    const decisionDto = {
      doctorDecision: ConsultationModeEnum.ONLINE,
      visitMethod: VisitMethodsEnum.VIDEO_CALL,
    };

    it('should let the assigned doctor decide', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        doctorId: 1,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        userId: doctor.id,
      });
      const updated = {
        id: consultationId,
        status: ConsultationStatusEnum.DOCTOR_DECIDED,
        doctorDecision: ConsultationModeEnum.ONLINE,
      };
      prisma.consultation.update.mockResolvedValue(updated);

      const result = await service.doctorDecide(
        consultationId,
        doctor as any,
        decisionDto,
      );

      expect(result).toEqual(updated);
      expect(prisma.consultation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ConsultationStatusEnum.DOCTOR_DECIDED,
            doctorDecision: ConsultationModeEnum.ONLINE,
            visitMethod: VisitMethodsEnum.VIDEO_CALL,
          }),
        }),
      );
    });

    it('should reject non-doctor users', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        doctorId: 1,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });

      await expect(
        service.doctorDecide(consultationId, patient as any, decisionDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject doctor who is not assigned', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        doctorId: 99,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        userId: doctor.id,
      });

      await expect(
        service.doctorDecide(consultationId, doctor as any, decisionDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject invalid state transition', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        doctorId: 1,
        status: ConsultationStatusEnum.COMPLETED,
      });
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        userId: doctor.id,
      });

      await expect(
        service.doctorDecide(consultationId, doctor as any, decisionDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────── Complete ────────────────

  describe('complete', () => {
    const consultationId = 'consult-uuid';
    const completeDto = {
      notes: 'Patient is recovering well.',
      summary: 'Follow-up in 2 weeks.',
      followUpNeeded: true,
    };

    it('should let the assigned doctor complete', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        doctorId: 1,
        status: ConsultationStatusEnum.IN_PROGRESS,
        notes: null,
        summary: null,
        followUpNeeded: false,
      });
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        userId: doctor.id,
      });
      prisma.consultation.update.mockResolvedValue({
        id: consultationId,
        status: ConsultationStatusEnum.COMPLETED,
      });

      const result = await service.complete(
        consultationId,
        doctor as any,
        completeDto,
      );

      expect(result.status).toBe(ConsultationStatusEnum.COMPLETED);
      expect(prisma.consultation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ConsultationStatusEnum.COMPLETED,
            notes: completeDto.notes,
            summary: completeDto.summary,
            followUpNeeded: true,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should reject if not in IN_PROGRESS status', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        doctorId: 1,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        userId: doctor.id,
      });

      await expect(
        service.complete(consultationId, doctor as any, completeDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────── Cancel ────────────────

  describe('cancel', () => {
    const consultationId = 'consult-uuid';

    it('should let the patient cancel', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        patientId: patient.id,
        doctorId: 1,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });
      prisma.consultation.update.mockResolvedValue({
        id: consultationId,
        status: ConsultationStatusEnum.CANCELLED,
      });

      const result = await service.cancel(consultationId, patient as any);
      expect(result.status).toBe(ConsultationStatusEnum.CANCELLED);
    });

    it('should let the assigned doctor cancel', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        patientId: patient.id,
        doctorId: 1,
        status: ConsultationStatusEnum.IN_PROGRESS,
      });
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        userId: doctor.id,
      });
      prisma.consultation.update.mockResolvedValue({
        id: consultationId,
        status: ConsultationStatusEnum.CANCELLED,
      });

      const result = await service.cancel(consultationId, doctor as any);
      expect(result.status).toBe(ConsultationStatusEnum.CANCELLED);
    });

    it('should let admin cancel any consultation', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        patientId: 'other-patient',
        doctorId: 99,
        status: ConsultationStatusEnum.DOCTOR_DECIDED,
      });
      prisma.consultation.update.mockResolvedValue({
        id: consultationId,
        status: ConsultationStatusEnum.CANCELLED,
      });

      const result = await service.cancel(consultationId, admin as any);
      expect(result.status).toBe(ConsultationStatusEnum.CANCELLED);
    });

    it('should reject if already COMPLETED', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        patientId: patient.id,
        status: ConsultationStatusEnum.COMPLETED,
      });

      await expect(
        service.cancel(consultationId, patient as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if already CANCELLED', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        patientId: patient.id,
        status: ConsultationStatusEnum.CANCELLED,
      });

      await expect(
        service.cancel(consultationId, patient as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject patient cancelling another patient consultation', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        patientId: 'other-patient-id',
        doctorId: 1,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      });

      await expect(
        service.cancel(consultationId, patient as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ──────────────── getById ────────────────

  describe('getById', () => {
    const consultationId = 'consult-uuid';

    it('should return consultation for the owning patient', async () => {
      const consultation = {
        id: consultationId,
        patientId: patient.id,
        doctorId: 1,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      };
      prisma.consultation.findUnique.mockResolvedValue(consultation);

      const result = await service.getById(consultationId, patient as any);
      expect(result).toEqual(consultation);
    });

    it('should return consultation for the assigned doctor', async () => {
      const consultation = {
        id: consultationId,
        patientId: 'some-patient',
        doctorId: 1,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      };
      prisma.consultation.findUnique.mockResolvedValue(consultation);
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        userId: doctor.id,
      });

      const result = await service.getById(consultationId, doctor as any);
      expect(result).toEqual(consultation);
    });

    it('should return consultation for admin', async () => {
      const consultation = {
        id: consultationId,
        patientId: 'some-patient',
        doctorId: 99,
        status: ConsultationStatusEnum.IN_PROGRESS,
      };
      prisma.consultation.findUnique.mockResolvedValue(consultation);

      const result = await service.getById(consultationId, admin as any);
      expect(result).toEqual(consultation);
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.consultation.findUnique.mockResolvedValue(null);

      await expect(
        service.getById('nonexistent', patient as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong patient', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        patientId: 'other-patient',
        doctorId: 1,
        status: ConsultationStatusEnum.CREATED,
      });

      await expect(
        service.getById(consultationId, patient as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for wrong doctor', async () => {
      prisma.consultation.findUnique.mockResolvedValue({
        id: consultationId,
        patientId: 'some-patient',
        doctorId: 99,
        status: ConsultationStatusEnum.CREATED,
      });
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        userId: doctor.id,
      });

      await expect(
        service.getById(consultationId, doctor as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ──────────────── list ────────────────

  describe('list', () => {
    const filters = {};

    it('should list consultations for patient (own only)', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.consultation.count.mockResolvedValue(0);

      const result = await service.list(patient as any, filters);

      expect(result).toEqual({ data: [], total: 0, skip: 0, take: 20 });
      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ patientId: patient.id }),
        }),
      );
    });

    it('should list consultations for doctor (assigned only)', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        userId: doctor.id,
      });
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.consultation.count.mockResolvedValue(0);

      const result = await service.list(doctor as any, filters);

      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ doctorId: 1 }),
        }),
      );
    });

    it('should list all consultations for admin', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.consultation.count.mockResolvedValue(0);

      const result = await service.list(admin as any, filters);

      // Admin should have no patientId or doctorId filter
      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ patientId: expect.anything() }),
        }),
      );
    });

    it('should apply status filter', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.consultation.count.mockResolvedValue(0);

      await service.list(patient as any, {
        status: ConsultationStatusEnum.COMPLETED,
      });

      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: ConsultationStatusEnum.COMPLETED,
          }),
        }),
      );
    });

    it('should throw NotFoundException if doctor profile not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(service.list(doctor as any, filters)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject NONE role users (non-admin)', async () => {
      const noneUser = createMockUser({ role: UserRolesEnum.NONE, isAdmin: false });

      await expect(service.list(noneUser as any, filters)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ──────────────── getPendingForDoctor ────────────────

  describe('getPendingForDoctor', () => {
    it('should return pending consultations for doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        userId: doctor.id,
      });
      prisma.consultation.findMany.mockResolvedValue([
        { id: 'c1', status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW },
      ]);

      const result = await service.getPendingForDoctor(doctor as any);

      expect(result).toHaveLength(1);
      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            doctorId: 1,
            status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
          }),
        }),
      );
    });

    it('should throw NotFoundException if doctor profile not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.getPendingForDoctor(doctor as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
