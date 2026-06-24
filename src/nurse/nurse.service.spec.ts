import { Test, TestingModule } from '@nestjs/testing';
import { NurseService } from './nurse.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/helpers/mock-prisma.helper';
import {
  createMockDoctorUser,
  createMockNurseUser,
  createMockUser,
  createMockAdminUser,
  MockUser,
} from '../../test/helpers/mock-session.helper';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NursePermissionEnum, UserRolesEnum } from '@prisma/client';

describe('NurseService', () => {
  let service: NurseService;
  let prisma: MockPrismaService;
  let doctorUser: MockUser;
  let nurseUser: MockUser;

  const doctorProfile = { id: 10, userId: '', verified: true };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    doctorUser = createMockDoctorUser();
    nurseUser = createMockNurseUser();
    doctorProfile.userId = doctorUser.id;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NurseService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<NurseService>(NurseService);
  });

  // ──────────────── assignNurse ────────────────

  describe('assignNurse', () => {
    it('should assign a nurse to the doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.user.findUnique.mockResolvedValue(nurseUser);
      const created = {
        id: 1,
        doctorId: doctorProfile.id,
        nurseId: nurseUser.id,
        permissions: [NursePermissionEnum.VIEW_PATIENTS],
        isActive: true,
      };
      prisma.doctorNurseAssignment.create.mockResolvedValue(created);

      const result = await service.assignNurse(doctorUser as any, {
        nurseId: nurseUser.id,
      });

      expect(result).toEqual(created);
      expect(prisma.doctorNurseAssignment.create).toHaveBeenCalledWith({
        data: {
          doctorId: doctorProfile.id,
          nurseId: nurseUser.id,
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
          isActive: true,
        },
        include: expect.any(Object),
      });
    });

    it('should assign with custom permissions', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.user.findUnique.mockResolvedValue(nurseUser);
      prisma.doctorNurseAssignment.create.mockResolvedValue({ id: 1 });

      await service.assignNurse(doctorUser as any, {
        nurseId: nurseUser.id,
        permissions: [NursePermissionEnum.VIEW_PATIENTS, NursePermissionEnum.MANAGE_SCHEDULE],
      });

      expect(prisma.doctorNurseAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            permissions: [NursePermissionEnum.VIEW_PATIENTS, NursePermissionEnum.MANAGE_SCHEDULE],
          }),
        }),
      );
    });

    it('should throw NotFoundException when doctor profile not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.assignNurse(doctorUser as any, { nurseId: nurseUser.id }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when nurse user not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.assignNurse(doctorUser as any, { nurseId: 'nonexistent' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when user is not a nurse', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.user.findUnique.mockResolvedValue(createMockUser());

      await expect(
        service.assignNurse(doctorUser as any, { nurseId: 'patient-id' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException on duplicate assignment', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.user.findUnique.mockResolvedValue(nurseUser);
      prisma.doctorNurseAssignment.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.assignNurse(doctorUser as any, { nurseId: nurseUser.id }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ──────────────── updatePermissions ────────────────

  describe('updatePermissions', () => {
    const assignment = { id: 1, doctorId: 10, nurseId: 'n1', isActive: true };

    it('should update permissions on own assignment', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(assignment);
      const updated = { ...assignment, permissions: [NursePermissionEnum.MANAGE_SCHEDULE] };
      prisma.doctorNurseAssignment.update.mockResolvedValue(updated);

      const result = await service.updatePermissions(
        doctorUser as any,
        1,
        { permissions: [NursePermissionEnum.MANAGE_SCHEDULE] },
      );

      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when assignment not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePermissions(doctorUser as any, 999, {
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when doctor does not own assignment', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue({
        ...assignment,
        doctorId: 99,
      });

      await expect(
        service.updatePermissions(doctorUser as any, 1, {
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ──────────────── removeAssignment ────────────────

  describe('removeAssignment', () => {
    const assignment = { id: 1, doctorId: 10, nurseId: 'n1', isActive: true };

    it('should deactivate the assignment', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(assignment);
      prisma.doctorNurseAssignment.update.mockResolvedValue({
        ...assignment,
        isActive: false,
      });

      const result = await service.removeAssignment(doctorUser as any, 1);
      expect(result.isActive).toBe(false);
      expect(prisma.doctorNurseAssignment.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { isActive: false },
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException when assignment not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(null);

      await expect(
        service.removeAssignment(doctorUser as any, 999),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when doctor does not own assignment', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue({
        ...assignment,
        doctorId: 99,
      });

      await expect(
        service.removeAssignment(doctorUser as any, 1),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ──────────────── getMyAssignments ────────────────

  describe('getMyAssignments', () => {
    it('should return assignments for doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      const assignments = [{ id: 1, doctorId: 10 }];
      prisma.doctorNurseAssignment.findMany.mockResolvedValue(assignments);

      const result = await service.getMyAssignments(doctorUser as any);
      expect(result).toEqual(assignments);
      expect(prisma.doctorNurseAssignment.findMany).toHaveBeenCalledWith({
        where: { doctorId: doctorProfile.id },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return assignments for nurse', async () => {
      const assignments = [{ id: 1, nurseId: nurseUser.id }];
      prisma.doctorNurseAssignment.findMany.mockResolvedValue(assignments);

      const result = await service.getMyAssignments(nurseUser as any);
      expect(result).toEqual(assignments);
      expect(prisma.doctorNurseAssignment.findMany).toHaveBeenCalledWith({
        where: { nurseId: nurseUser.id },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should throw ForbiddenException for non-doctor/non-nurse', async () => {
      const patient = createMockUser();
      await expect(
        service.getMyAssignments(patient as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ──────────────── getAssignment ────────────────

  describe('getAssignment', () => {
    const assignment = { id: 1, doctorId: 10, nurseId: '', isActive: true };

    it('should allow admin to view any assignment', async () => {
      const admin = createMockAdminUser();
      assignment.nurseId = nurseUser.id;
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(assignment);

      const result = await service.getAssignment(admin as any, 1);
      expect(result).toEqual(assignment);
    });

    it('should allow doctor to view own assignment', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(assignment);

      const result = await service.getAssignment(doctorUser as any, 1);
      expect(result).toEqual(assignment);
    });

    it('should allow nurse to view own assignment', async () => {
      assignment.nurseId = nurseUser.id;
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(assignment);

      const result = await service.getAssignment(nurseUser as any, 1);
      expect(result).toEqual(assignment);
    });

    it('should throw ForbiddenException when nurse views others assignment', async () => {
      assignment.nurseId = 'other-nurse-id';
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(assignment);

      await expect(
        service.getAssignment(nurseUser as any, 1),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when assignment not found', async () => {
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(null);

      await expect(
        service.getAssignment(doctorUser as any, 999),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────────── getNursePermissionForDoctor ────────────────

  describe('getNursePermissionForDoctor', () => {
    it('should return assignment when nurse has the permission', async () => {
      const assignment = {
        id: 1,
        nurseId: nurseUser.id,
        doctorId: 10,
        isActive: true,
        permissions: [NursePermissionEnum.VIEW_PATIENTS, NursePermissionEnum.MANAGE_APPOINTMENTS],
      };
      prisma.doctorNurseAssignment.findFirst.mockResolvedValue(assignment);

      const result = await service.getNursePermissionForDoctor(
        nurseUser.id,
        10,
        NursePermissionEnum.VIEW_PATIENTS,
      );
      expect(result).toEqual(assignment);
    });

    it('should return null when nurse lacks the specific permission', async () => {
      prisma.doctorNurseAssignment.findFirst.mockResolvedValue({
        id: 1,
        permissions: [NursePermissionEnum.VIEW_PATIENTS],
        isActive: true,
      });

      const result = await service.getNursePermissionForDoctor(
        nurseUser.id,
        10,
        NursePermissionEnum.MANAGE_SCHEDULE,
      );
      expect(result).toBeNull();
    });

    it('should return null when no assignment exists', async () => {
      prisma.doctorNurseAssignment.findFirst.mockResolvedValue(null);

      const result = await service.getNursePermissionForDoctor(
        nurseUser.id,
        10,
        NursePermissionEnum.VIEW_PATIENTS,
      );
      expect(result).toBeNull();
    });
  });

  // ──────────────── assertNursePermission ────────────────

  describe('assertNursePermission', () => {
    it('should not throw when nurse has permission', async () => {
      prisma.doctorNurseAssignment.findFirst.mockResolvedValue({
        id: 1,
        permissions: [NursePermissionEnum.MANAGE_APPOINTMENTS],
        isActive: true,
      });

      await expect(
        service.assertNursePermission(
          nurseUser.id,
          10,
          NursePermissionEnum.MANAGE_APPOINTMENTS,
        ),
      ).resolves.toBeUndefined();
    });

    it('should throw ForbiddenException when nurse lacks permission', async () => {
      prisma.doctorNurseAssignment.findFirst.mockResolvedValue(null);

      await expect(
        service.assertNursePermission(
          nurseUser.id,
          10,
          NursePermissionEnum.MANAGE_APPOINTMENTS,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ──────────────── getDoctorIdsForNurse ────────────────

  describe('getDoctorIdsForNurse', () => {
    it('should return doctor IDs where nurse has the permission', async () => {
      prisma.doctorNurseAssignment.findMany.mockResolvedValue([
        { doctorId: 10, permissions: [NursePermissionEnum.MANAGE_APPOINTMENTS, NursePermissionEnum.VIEW_PATIENTS] },
        { doctorId: 20, permissions: [NursePermissionEnum.VIEW_PATIENTS] },
        { doctorId: 30, permissions: [NursePermissionEnum.MANAGE_APPOINTMENTS] },
      ]);

      const result = await service.getDoctorIdsForNurse(
        nurseUser.id,
        NursePermissionEnum.MANAGE_APPOINTMENTS,
      );
      expect(result).toEqual([10, 30]);
    });

    it('should return empty array when no assignments', async () => {
      prisma.doctorNurseAssignment.findMany.mockResolvedValue([]);

      const result = await service.getDoctorIdsForNurse(
        nurseUser.id,
        NursePermissionEnum.VIEW_PATIENTS,
      );
      expect(result).toEqual([]);
    });
  });
});
