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
import { UserStatusCache } from '../auth/user-status';
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
  let notificationService: {
    onDoctorVerified: jest.Mock;
    onDoctorRejected: jest.Mock;
  };

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

    notificationService = {
      onDoctorVerified: jest.fn().mockResolvedValue(undefined),
      onDoctorRejected: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReviewService, useValue: reviewService },
        { provide: NotificationService, useValue: notificationService },
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

      const result = await service.updateUser(
        mockRegularUser.id,
        {
          firstname: updatedName,
        },
        mockSuperAdmin as any,
      );

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
        service.updateUser(
          randomUuid(),
          { firstname: randomFirstName() },
          mockSuperAdmin as any,
        ),
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

      const result = await service.deactivateUser(
        mockRegularUser.id,
        mockSuperAdmin as any,
      );

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

      await expect(
        service.deactivateUser('nonexistent', mockSuperAdmin as any),
      ).rejects.toThrow(NotFoundException);
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
    it('should return unverified doctors that are not rejected, with their documents', async () => {
      const pending = [
        {
          ...mockDoctorProfile,
          documents: [
            {
              id: Math.floor(Math.random() * 10_000) + 1,
              doctorId: mockDoctorProfile.id,
              type: 'LICENSE',
              fileUrl: `/uploads/doctor-documents/${Math.random().toString(36).slice(2)}.pdf`,
              fileName: 'license.pdf',
              mimeType: 'application/pdf',
              status: 'PENDING',
            },
          ],
        },
      ];
      prisma.doctorProfile.findMany.mockResolvedValue(pending);

      const result = await service.listPendingDoctors();

      expect(result).toEqual(pending);
      expect(prisma.doctorProfile.findMany).toHaveBeenCalledWith({
        where: { verified: false, rejectionReason: null },
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              email: true,
              avatar: true,
            },
          },
          documents: { orderBy: { createdAt: 'desc' } },
        },
      });
    });

    it('should return an empty list when no doctor is pending', async () => {
      prisma.doctorProfile.findMany.mockResolvedValue([]);

      await expect(service.listPendingDoctors()).resolves.toEqual([]);
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

      await service.verifyDoctor(1, { approved: true }, mockAdminUser as any);

      expect(prisma.doctorProfile.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          verified: true,
          verifiedAt: expect.any(Date),
          verifiedBy: mockAdminUser.id,
          rejectionReason: null,
        },
      });
      expect(notificationService.onDoctorVerified).toHaveBeenCalledWith(
        mockDoctorProfile.userId,
      );
      expect(notificationService.onDoctorRejected).not.toHaveBeenCalled();
    });

    it('should ignore a reason sent with an approval', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorProfile.update.mockResolvedValue({
        ...mockDoctorProfile,
        verified: true,
      });

      await service.verifyDoctor(
        1,
        { approved: true, reason: 'leftover' },
        mockAdminUser as any,
      );

      expect(prisma.doctorProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rejectionReason: null }),
        }),
      );
      expect(notificationService.onDoctorVerified).toHaveBeenCalledWith(
        mockDoctorProfile.userId,
      );
      expect(notificationService.onDoctorRejected).not.toHaveBeenCalled();
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
      expect(notificationService.onDoctorRejected).toHaveBeenCalledWith(
        mockDoctorProfile.userId,
        'Invalid license',
      );
      expect(notificationService.onDoctorVerified).not.toHaveBeenCalled();
    });

    it('should store and send the reason without surrounding whitespace', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorProfile.update.mockResolvedValue(mockDoctorProfile);

      await service.verifyDoctor(
        1,
        { approved: false, reason: '  Blurry scan \n' },
        mockAdminUser as any,
      );

      expect(prisma.doctorProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rejectionReason: 'Blurry scan' }),
        }),
      );
      expect(notificationService.onDoctorRejected).toHaveBeenCalledWith(
        mockDoctorProfile.userId,
        'Blurry scan',
      );
    });

    it.each([
      ['no reason', undefined],
      ['an empty reason', ''],
      ['a blank reason', '  \t '],
    ])(
      'should throw BadRequestException when rejecting with %s',
      async (_case, reason) => {
        prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);

        await expect(
          service.verifyDoctor(
            1,
            { approved: false, reason },
            mockAdminUser as any,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.doctorProfile.update).not.toHaveBeenCalled();
        expect(notificationService.onDoctorRejected).not.toHaveBeenCalled();
      },
    );

    it('should still return the rejection when the notification fails', async () => {
      const rejected = {
        ...mockDoctorProfile,
        rejectionReason: 'Invalid license',
      };
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.doctorProfile.update.mockResolvedValue(rejected);
      notificationService.onDoctorRejected.mockRejectedValue(
        new Error('smtp down'),
      );
      const logError = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      const result = await service.verifyDoctor(
        1,
        { approved: false, reason: 'Invalid license' },
        mockAdminUser as any,
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(result).toEqual(rejected);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('smtp down'),
      );
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

      await expect(service.promoteToAdmin(mockAdminUser.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if user is superadmin', async () => {
      prisma.user.findUnique.mockResolvedValue(mockSuperAdmin);

      await expect(service.promoteToAdmin(mockSuperAdmin.id)).rejects.toThrow(
        BadRequestException,
      );
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
        .mockResolvedValueOnce(100) // totalUsers
        .mockResolvedValueOnce(3) // bannedUsers
        .mockResolvedValueOnce(8); // newUsersThisMonth
      prisma.doctorProfile.count
        .mockResolvedValueOnce(25) // verified doctors
        .mockResolvedValueOnce(5); // pending verifications
      prisma.patientProfile.count.mockResolvedValue(60);
      prisma.consultation.count
        .mockResolvedValueOnce(200) // totalConsultations
        .mockResolvedValueOnce(10); // activeConsultations
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

    it('should count pending verifications like the pending list, leaving out rejected doctors', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.doctorProfile.count.mockResolvedValue(0);
      prisma.patientProfile.count.mockResolvedValue(0);
      prisma.consultation.count.mockResolvedValue(0);
      prisma.appointment.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });

      await service.getPlatformStats();

      expect(prisma.doctorProfile.count).toHaveBeenCalledWith({
        where: { verified: false, rejectionReason: null },
      });
      expect(prisma.doctorProfile.count).toHaveBeenCalledWith({
        where: { verified: true },
      });
    });
  });

  /* ── banUser ────────────────────────────────────────────── */

  describe('banUser', () => {
    it('should ban a user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockRegularUser,
        isBanned: false,
      });
      prisma.user.update.mockResolvedValue({
        ...mockRegularUser,
        isBanned: true,
        banReason: 'spam',
      });

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
      prisma.user.findUnique.mockResolvedValue({
        ...mockRegularUser,
        isBanned: true,
      });

      await expect(
        service.banUser(
          mockRegularUser.id,
          { reason: 'spam' },
          mockAdminUser as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.banUser(
          'nonexistent',
          { reason: 'spam' },
          mockAdminUser as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when banning a superadmin', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockSuperAdmin,
        isBanned: false,
      });

      await expect(
        service.banUser(
          mockSuperAdmin.id,
          { reason: 'test' },
          mockAdminUser as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when banning yourself', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockAdminUser,
        isBanned: false,
      });

      await expect(
        service.banUser(
          mockAdminUser.id,
          { reason: 'test' },
          mockAdminUser as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  /* ── unbanUser ─────────────────────────────────────────── */

  describe('unbanUser', () => {
    it('should unban a user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockRegularUser,
        isBanned: true,
      });
      prisma.user.update.mockResolvedValue({
        ...mockRegularUser,
        isBanned: false,
        banReason: null,
      });

      const result = await service.unbanUser(
        mockRegularUser.id,
        mockAdminUser as any,
      );

      expect(result.isBanned).toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isBanned: false, banReason: null }),
        }),
      );
    });

    it('should throw BadRequestException when user is not banned', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockRegularUser,
        isBanned: false,
      });

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

    it('should throw ForbiddenException when non-superadmin tries to unban an admin', async () => {
      const bannedAdmin = { ...buildAdminUser(), isBanned: true };
      prisma.user.findUnique.mockResolvedValue(bannedAdmin);

      await expect(
        service.unbanUser(bannedAdmin.id, mockAdminUser as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow superadmin to unban an admin', async () => {
      const bannedAdmin = { ...buildAdminUser(), isBanned: true };
      prisma.user.findUnique.mockResolvedValue(bannedAdmin);
      prisma.user.update.mockResolvedValue({
        ...bannedAdmin,
        isBanned: false,
        banReason: null,
      });

      const result = await service.unbanUser(
        bannedAdmin.id,
        mockSuperAdmin as any,
      );
      expect(result.isBanned).toBe(false);
    });
  });

  /* ── auth status cache invalidation ─────────────────────── */

  describe('session status invalidation', () => {
    let invalidateSpy: jest.SpyInstance;

    beforeEach(() => {
      invalidateSpy = jest.spyOn(UserStatusCache, 'invalidate');
    });

    afterEach(() => {
      invalidateSpy.mockRestore();
    });

    const regular = () => ({ ...buildUser(), isActive: true, isBanned: false });

    it.each([
      [
        'updateUser (role change)',
        regular,
        (id: string) =>
          service.updateUser(
            id,
            { role: UserRolesEnum.NURSE },
            mockSuperAdmin as any,
          ),
      ],
      [
        'deactivateUser',
        regular,
        (id: string) => service.deactivateUser(id, mockSuperAdmin as any),
      ],
      [
        'banUser',
        regular,
        (id: string) =>
          service.banUser(id, { reason: 'spam' }, mockSuperAdmin as any),
      ],
      [
        'unbanUser',
        () => ({ ...regular(), isBanned: true }),
        (id: string) => service.unbanUser(id, mockSuperAdmin as any),
      ],
      ['promoteToAdmin', regular, (id: string) => service.promoteToAdmin(id)],
      [
        'demoteAdmin',
        () => buildAdminUser(),
        (id: string) => service.demoteAdmin(id, mockSuperAdmin as any),
      ],
    ])(
      '%s should make the change apply to the target user on their next request',
      async (_name, buildTarget, act) => {
        const target = buildTarget();
        prisma.user.findUnique.mockResolvedValue(target);
        prisma.user.update.mockResolvedValue(target);

        await act(target.id);

        expect(invalidateSpy).toHaveBeenCalledTimes(1);
        expect(invalidateSpy).toHaveBeenCalledWith(target.id);
        expect(invalidateSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
          prisma.user.update.mock.invocationCallOrder[0],
        );
      },
    );

    it('should not invalidate when the update fails', async () => {
      const target = regular();
      prisma.user.findUnique.mockResolvedValue(target);
      prisma.user.update.mockRejectedValue(new Error('db down'));

      await expect(
        service.banUser(target.id, { reason: 'spam' }, mockSuperAdmin as any),
      ).rejects.toThrow('db down');
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('should not invalidate when the action is rejected', async () => {
      prisma.user.findUnique.mockResolvedValue(mockSuperAdmin);

      await expect(
        service.demoteAdmin(mockSuperAdmin.id, mockAdminUser as any),
      ).rejects.toThrow(ForbiddenException);
      expect(invalidateSpy).not.toHaveBeenCalled();
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
