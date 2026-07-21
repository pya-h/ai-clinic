import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewService } from '../review/review.service';
import { NotificationService } from '../notification/notification.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRolesEnum } from '@prisma/client';
import {
  buildAdminUser,
  buildSuperAdminUser,
  buildUser,
  randomUuid,
  randomFirstName,
} from '../../test/helpers/test-data.factory';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: Record<string, any>;
  let reviewService: Record<string, jest.Mock>;

  const mockAdminUser = buildAdminUser();

  const mockSuperAdmin = buildSuperAdminUser();

  const mockRegularUser = buildUser();

  const mockDoctorProfile = {
    id: Math.floor(Math.random() * 1000) + 1,
    userId: randomUuid(),
    verified: false,
    verifiedAt: null as null,
    verifiedBy: null as null,
    rejectionReason: null as null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      doctorProfile: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      patientProfile: {
        count: jest.fn(),
      },
      consultation: {
        count: jest.fn(),
      },
      appointment: {
        count: jest.fn(),
      },
      payment: {
        aggregate: jest.fn(),
      },
      doctorDocument: {
        findMany: jest.fn(),
      },
    };

    reviewService = {
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReviewService, useValue: reviewService },
        {
          provide: NotificationService,
          useValue: { onDoctorVerified: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /* ── listUsers ─────────────────────────────────────────── */

  describe('listUsers', () => {
    it('should return paginated users with default skip/take', async () => {
      const users = [mockRegularUser];
      prisma.user.findMany.mockResolvedValue(users);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.listUsers({});

      expect(result).toEqual({ data: users, total: 1, skip: 0, take: 20 });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('should apply role filter', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.listUsers({ role: UserRolesEnum.DOCTOR });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: UserRolesEnum.DOCTOR }),
        }),
      );
    });

    it('should apply isActive filter', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.listUsers({ isActive: 'true' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it('should apply isAdmin filter', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.listUsers({ isAdmin: 'true' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isAdmin: true }),
        }),
      );
    });

    it('should apply search filter with OR on name/email', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.listUsers({ search: 'john' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { firstname: { contains: 'john', mode: 'insensitive' } },
              { lastname: { contains: 'john', mode: 'insensitive' } },
              { email: { contains: 'john', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('should apply custom skip and take', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.listUsers({ skip: 10 as any, take: 5 as any });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });
  });

  /* ── updateUser ────────────────────────────────────────── */

  describe('updateUser', () => {
    it('should update a user', async () => {
      const updatedName = randomFirstName();
      prisma.user.findUnique.mockResolvedValue(mockRegularUser);
      prisma.user.update.mockResolvedValue({
        ...mockRegularUser,
        firstname: updatedName,
      });

      const result = await service.updateUser(mockRegularUser.id, {
        firstname: updatedName,
      }, mockSuperAdmin as any);

      expect(result.firstname).toBe(updatedName);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockRegularUser.id },
          data: { firstname: updatedName },
          select: expect.any(Object),
        }),
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUser(randomUuid(), { firstname: randomFirstName() }, mockSuperAdmin as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  /* ── deactivateUser ────────────────────────────────────── */

  describe('deactivateUser', () => {
    it('should deactivate an active user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockRegularUser);
      prisma.user.update.mockResolvedValue({
        ...mockRegularUser,
        isActive: false,
      });

      const result = await service.deactivateUser(mockRegularUser.id, mockSuperAdmin as any);

      expect(result.isActive).toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockRegularUser.id },
          data: { isActive: false },
          select: expect.any(Object),
        }),
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deactivateUser('nonexistent', mockSuperAdmin as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if user already deactivated', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockRegularUser,
        isActive: false,
      });

      await expect(
        service.deactivateUser(mockRegularUser.id, mockSuperAdmin as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  /* ── listPendingDoctors ────────────────────────────────── */

  describe('listPendingDoctors', () => {
    it('should return unverified doctors', async () => {
      const pending = [mockDoctorProfile];
      prisma.doctorProfile.findMany.mockResolvedValue(pending);

      const result = await service.listPendingDoctors();

      expect(result).toEqual(pending);
      expect(prisma.doctorProfile.findMany).toHaveBeenCalledWith({
        where: { verified: false },
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              email: true,
            },
          },
        },
      });
    });
  });

  /* ── getDoctorDocuments ────────────────────────────────── */

  describe('getDoctorDocuments', () => {
    it('should return documents for a doctor', async () => {
      const docs = [
        {
          id: 1,
          doctorId: 1,
          type: 'LICENSE',
          fileUrl: 'https://example.com/file.pdf',
          fileName: 'license.pdf',
          mimeType: 'application/pdf',
          status: 'PENDING',
        },
      ];
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorDocument.findMany.mockResolvedValue(docs);

      const result = await service.getDoctorDocuments(1);

      expect(result).toEqual(docs);
      expect(prisma.doctorDocument.findMany).toHaveBeenCalledWith({
        where: { doctorId: 1 },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should throw NotFoundException if doctor not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(service.getDoctorDocuments(999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  /* ── verifyDoctor ──────────────────────────────────────── */

  describe('verifyDoctor', () => {
    it('should approve a doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorProfile.update.mockResolvedValue({
        ...mockDoctorProfile,
        verified: true,
        verifiedAt: expect.any(Date),
        verifiedBy: mockAdminUser.id,
      });

      const result = await service.verifyDoctor(
        1,
        { approved: true },
        mockAdminUser as any,
      );

      expect(prisma.doctorProfile.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          verified: true,
          verifiedAt: expect.any(Date),
          verifiedBy: mockAdminUser.id,
          rejectionReason: null,
        },
      });
    });

    it('should reject a doctor with reason', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorProfile.update.mockResolvedValue({
        ...mockDoctorProfile,
        verified: false,
        rejectionReason: 'Invalid license',
      });

      await service.verifyDoctor(
        1,
        { approved: false, reason: 'Invalid license' },
        mockAdminUser as any,
      );

      expect(prisma.doctorProfile.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          verified: false,
          verifiedAt: null,
          verifiedBy: null,
          rejectionReason: 'Invalid license',
        },
      });
    });

    it('should throw BadRequestException if rejecting without reason', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);

      await expect(
        service.verifyDoctor(
          1,
          { approved: false },
          mockAdminUser as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if doctor not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyDoctor(999, { approved: true }, mockAdminUser as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  /* ── promoteToAdmin ────────────────────────────────────── */

  describe('promoteToAdmin', () => {
    it('should promote a regular user to admin', async () => {
      prisma.user.findUnique.mockResolvedValue(mockRegularUser);
      prisma.user.update.mockResolvedValue({
        ...mockRegularUser,
        isAdmin: true,
      });

      const result = await service.promoteToAdmin(mockRegularUser.id);

      expect(result.isAdmin).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockRegularUser.id },
          data: { isAdmin: true },
          select: expect.any(Object),
        }),
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.promoteToAdmin('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if user is already admin', async () => {
      prisma.user.findUnique.mockResolvedValue(mockAdminUser);

      await expect(
        service.promoteToAdmin(mockAdminUser.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user is superadmin', async () => {
      prisma.user.findUnique.mockResolvedValue(mockSuperAdmin);

      await expect(
        service.promoteToAdmin(mockSuperAdmin.id),
      ).rejects.toThrow(BadRequestException);
    });
  });

  /* ── demoteAdmin ───────────────────────────────────────── */

  describe('demoteAdmin', () => {
    it('should demote an admin to regular user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockAdminUser);
      prisma.user.update.mockResolvedValue({
        ...mockAdminUser,
        isAdmin: false,
      });

      const result = await service.demoteAdmin(
        mockAdminUser.id,
        mockSuperAdmin as any,
      );

      expect(result.isAdmin).toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockAdminUser.id },
          data: { isAdmin: false },
          select: expect.any(Object),
        }),
      );
    });

    it('should throw ForbiddenException if trying to self-demote', async () => {
      await expect(
        service.demoteAdmin(mockSuperAdmin.id, mockSuperAdmin as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.demoteAdmin('nonexistent', mockSuperAdmin as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if target is not admin', async () => {
      prisma.user.findUnique.mockResolvedValue(mockRegularUser);

      await expect(
        service.demoteAdmin(mockRegularUser.id, mockSuperAdmin as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException if trying to demote superadmin', async () => {
      prisma.user.findUnique.mockResolvedValue(mockSuperAdmin);

      await expect(
        service.demoteAdmin(mockSuperAdmin.id, mockAdminUser as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  /* ── getPlatformStats ──────────────────────────────────── */

  describe('getPlatformStats', () => {
    it('should return aggregated platform statistics', async () => {
      prisma.user.count
        .mockResolvedValueOnce(100)   // totalUsers
        .mockResolvedValueOnce(3)     // bannedUsers
        .mockResolvedValueOnce(8);    // newUsersThisMonth
      prisma.doctorProfile.count
        .mockResolvedValueOnce(25)    // verified doctors
        .mockResolvedValueOnce(5);    // pending verifications
      prisma.patientProfile.count.mockResolvedValue(60);
      prisma.consultation.count
        .mockResolvedValueOnce(200)   // totalConsultations
        .mockResolvedValueOnce(10);   // activeConsultations
      prisma.appointment.count.mockResolvedValue(50);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 1500 } });

      const result = await service.getPlatformStats();

      expect(result).toEqual({
        totalUsers: 100,
        totalDoctors: 25,
        totalPatients: 60,
        totalConsultations: 200,
        pendingVerifications: 5,
        activeConsultations: 10,
        bannedUsers: 3,
        totalAppointments: 50,
        newUsersThisMonth: 8,
        totalRevenue: 1500,
      });
    });
  });

  /* ── banUser ────────────────────────────────────────────── */

  describe('banUser', () => {
    it('should ban a user', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockRegularUser, isBanned: false });
      prisma.user.update.mockResolvedValue({ ...mockRegularUser, isBanned: true, banReason: 'spam' });

      const result = await service.banUser(
        mockRegularUser.id,
        { reason: 'spam' },
        mockAdminUser as any,
      );

      expect(result.isBanned).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockRegularUser.id },
          data: expect.objectContaining({ isBanned: true, banReason: 'spam' }),
        }),
      );
    });

    it('should throw BadRequestException when user is already banned', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockRegularUser, isBanned: true });

      await expect(
        service.banUser(mockRegularUser.id, { reason: 'spam' }, mockAdminUser as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.banUser('nonexistent', { reason: 'spam' }, mockAdminUser as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when banning a superadmin', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockSuperAdmin, isBanned: false });

      await expect(
        service.banUser(mockSuperAdmin.id, { reason: 'test' }, mockAdminUser as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when banning yourself', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockAdminUser, isBanned: false });

      await expect(
        service.banUser(mockAdminUser.id, { reason: 'test' }, mockAdminUser as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  /* ── unbanUser ─────────────────────────────────────────── */

  describe('unbanUser', () => {
    it('should unban a user', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockRegularUser, isBanned: true });
      prisma.user.update.mockResolvedValue({ ...mockRegularUser, isBanned: false, banReason: null });

      const result = await service.unbanUser(mockRegularUser.id, mockAdminUser as any);

      expect(result.isBanned).toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isBanned: false, banReason: null }),
        }),
      );
    });

    it('should throw BadRequestException when user is not banned', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockRegularUser, isBanned: false });

      await expect(
        service.unbanUser(mockRegularUser.id, mockAdminUser as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.unbanUser('nonexistent', mockAdminUser as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  /* ── removeReview ──────────────────────────────────────── */

  describe('removeReview', () => {
    it('should delegate to ReviewService.delete', async () => {
      reviewService.delete.mockResolvedValue(undefined);

      await service.removeReview(42, mockAdminUser as any);

      expect(reviewService.delete).toHaveBeenCalledWith(42, mockAdminUser);
    });

    it('should propagate errors from ReviewService', async () => {
      reviewService.delete.mockRejectedValue(
        new NotFoundException('Review not found.'),
      );

      await expect(
        service.removeReview(999, mockAdminUser as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
