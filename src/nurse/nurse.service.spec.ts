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
import {
  NurseAssignmentStatusEnum,
  NursePermissionEnum,
  Prisma,
  UserRolesEnum,
} from '@prisma/client';
import { Logger } from '@nestjs/common';
import { UserStatusCache } from '../auth/user-status';
import { NotificationService } from '../notification/notification.service';

describe('NurseService', () => {
  let service: NurseService;
  let prisma: MockPrismaService;
  let doctorUser: MockUser;
  let nurseUser: MockUser;
  let notificationService: {
    onNurseInvitation: jest.Mock;
    onNurseInvitationAnswered: jest.Mock;
  };

  const doctorProfile = { id: 10, userId: '', verified: true };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    doctorUser = createMockDoctorUser();
    nurseUser = createMockNurseUser();
    doctorProfile.userId = doctorUser.id;
    doctorProfile.verified = true;
    notificationService = {
      onNurseInvitation: jest.fn().mockResolvedValue(undefined),
      onNurseInvitationAnswered: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NurseService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get<NurseService>(NurseService);
  });

  // ──────────────── assignNurse (invitation) ────────────────

  describe('assignNurse (invites)', () => {
    const randomId = () => Math.floor(Math.random() * 1e6) + 1;
    const noneUser = () => createMockUser({ role: UserRolesEnum.NONE });

    function givenInvitee(invitee: MockUser, existing: object | null = null) {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.user.findUnique.mockResolvedValue(invitee);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(existing);
      const saved = { id: randomId(), doctorId: doctorProfile.id, nurseId: invitee.id };
      prisma.doctorNurseAssignment.create.mockResolvedValue(saved);
      prisma.doctorNurseAssignment.updateMany.mockResolvedValue({ count: 1 });
      prisma.doctorNurseAssignment.findUniqueOrThrow.mockResolvedValue(saved);
      return saved;
    }

    it.each([
      ['a patient', () => createMockUser()],
      ['a role-less user', noneUser],
      ['an existing nurse', () => createMockNurseUser()],
    ])('should invite %s without changing their role or granting anything yet', async (_case, make) => {
      const invitee = make();
      const saved = givenInvitee(invitee);
      const invalidateSpy = jest.spyOn(UserStatusCache, 'invalidate');

      try {
        const result = await service.assignNurse(doctorUser as any, { nurseId: invitee.id });

        expect(result).toBe(saved);
        expect(prisma.doctorNurseAssignment.create).toHaveBeenCalledWith({
          data: {
            doctorId: doctorProfile.id,
            nurseId: invitee.id,
            permissions: [NursePermissionEnum.VIEW_PATIENTS],
            status: NurseAssignmentStatusEnum.PENDING,
            isActive: false,
            respondedAt: null,
          },
        });
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.user.updateMany).not.toHaveBeenCalled();
        expect(invalidateSpy).not.toHaveBeenCalled();
        expect(notificationService.onNurseInvitation).toHaveBeenCalledWith(
          invitee.id,
          saved.id,
          `${doctorUser.firstname} ${doctorUser.lastname}`,
        );
      } finally {
        invalidateSpy.mockRestore();
      }
    });

    it('should invite with custom permissions', async () => {
      const permissions = [NursePermissionEnum.VIEW_PATIENTS, NursePermissionEnum.MANAGE_SCHEDULE];
      givenInvitee(nurseUser);

      await service.assignNurse(doctorUser as any, { nurseId: nurseUser.id, permissions });

      expect(prisma.doctorNurseAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ permissions }),
      });
    });

    it('should refuse an unverified doctor (403) before touching the invitee', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({ ...doctorProfile, verified: false });

      await expect(
        service.assignNurse(doctorUser as any, { nurseId: nurseUser.id }),
      ).rejects.toThrow(new ForbiddenException('Only verified doctors can invite nurses.'));
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.doctorNurseAssignment.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when doctor profile not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.assignNurse(doctorUser as any, { nurseId: nurseUser.id }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when the invited user is not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.assignNurse(doctorUser as any, { nurseId: 'nonexistent' }),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([
      ['a doctor', () => createMockDoctorUser()],
      ['an admin', () => createMockAdminUser()],
    ])('should refuse to invite %s (400)', async (_case, make) => {
      const target = make();
      givenInvitee(target);

      await expect(
        service.assignNurse(doctorUser as any, { nurseId: target.id }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.doctorNurseAssignment.create).not.toHaveBeenCalled();
      expect(notificationService.onNurseInvitation).not.toHaveBeenCalled();
    });

    it.each([
      ['an active assignment', { isActive: true, status: NurseAssignmentStatusEnum.ACCEPTED }, 'This nurse is already assigned to you.'],
      ['a pending invitation', { isActive: false, status: NurseAssignmentStatusEnum.PENDING }, 'This user already has a pending invitation from you.'],
    ])('should refuse when there is already %s (409)', async (_case, state, message) => {
      givenInvitee(nurseUser, { id: randomId(), doctorId: doctorProfile.id, nurseId: nurseUser.id, ...state });

      await expect(
        service.assignNurse(doctorUser as any, { nurseId: nurseUser.id }),
      ).rejects.toThrow(new ConflictException(message));
      expect(prisma.doctorNurseAssignment.updateMany).not.toHaveBeenCalled();
      expect(prisma.doctorNurseAssignment.create).not.toHaveBeenCalled();
      expect(notificationService.onNurseInvitation).not.toHaveBeenCalled();
    });

    it.each([
      ['declined', NurseAssignmentStatusEnum.DECLINED],
      ['removed', NurseAssignmentStatusEnum.ACCEPTED],
    ])('should turn a %s assignment back into a pending invitation', async (_case, status) => {
      const existing = { id: randomId(), doctorId: doctorProfile.id, nurseId: nurseUser.id, isActive: false, status };
      givenInvitee(nurseUser, existing);
      const permissions = [NursePermissionEnum.VIEW_SOAPS];

      await service.assignNurse(doctorUser as any, { nurseId: nurseUser.id, permissions });

      expect(prisma.doctorNurseAssignment.updateMany).toHaveBeenCalledWith({
        where: {
          id: existing.id,
          isActive: false,
          status: { not: NurseAssignmentStatusEnum.PENDING },
        },
        data: {
          permissions,
          status: NurseAssignmentStatusEnum.PENDING,
          isActive: false,
          respondedAt: null,
        },
      });
      expect(prisma.doctorNurseAssignment.create).not.toHaveBeenCalled();
      expect(notificationService.onNurseInvitation).toHaveBeenCalledTimes(1);
    });

    it('should refuse a re-invite that a concurrent invite already made (409)', async () => {
      givenInvitee(nurseUser, {
        id: randomId(),
        isActive: false,
        status: NurseAssignmentStatusEnum.DECLINED,
      });
      prisma.doctorNurseAssignment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.assignNurse(doctorUser as any, { nurseId: nurseUser.id }),
      ).rejects.toThrow(ConflictException);
      expect(notificationService.onNurseInvitation).not.toHaveBeenCalled();
    });

    it('should report a concurrent first invite as 409, not a server error', async () => {
      givenInvitee(nurseUser);
      prisma.doctorNurseAssignment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.assignNurse(doctorUser as any, { nurseId: nurseUser.id }),
      ).rejects.toThrow(new ConflictException('This user already has a pending invitation from you.'));
      expect(notificationService.onNurseInvitation).not.toHaveBeenCalled();
    });

    it('should still return the invitation when the notification fails', async () => {
      const saved = givenInvitee(nurseUser);
      notificationService.onNurseInvitation.mockRejectedValue(new Error('SMTP down'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      try {
        await expect(service.assignNurse(doctorUser as any, { nurseId: nurseUser.id })).resolves.toBe(saved);
        await new Promise(setImmediate);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SMTP down'));
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  // ──────────────── Invitations (invitee side) ────────────────

  describe('getMyInvitations', () => {
    it("should list only the user's pending invitations", async () => {
      const invitee = createMockUser();
      const invitations = [{ id: Math.floor(Math.random() * 1e6) }];
      prisma.doctorNurseAssignment.findMany.mockResolvedValue(invitations);

      await expect(service.getMyInvitations(invitee as any)).resolves.toBe(invitations);
      expect(prisma.doctorNurseAssignment.findMany).toHaveBeenCalledWith({
        where: { nurseId: invitee.id, status: NurseAssignmentStatusEnum.PENDING },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe.each([
    ['acceptInvitation', true],
    ['declineInvitation', false],
  ] as const)('%s', (method, accepting) => {
    let invitee: MockUser;
    let assignmentId: number;
    let answered: any;

    const answer = (user: MockUser = invitee, id = assignmentId) => service[method](user as any, id);

    beforeEach(() => {
      invitee = createMockUser();
      assignmentId = Math.floor(Math.random() * 1e6) + 1;
      answered = { id: assignmentId, nurseId: invitee.id, doctor: { user: { id: doctorUser.id } } };
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue({
        nurseId: invitee.id,
        status: NurseAssignmentStatusEnum.PENDING,
      });
      prisma.user.findUnique.mockImplementation(async () => invitee);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.doctorNurseAssignment.updateMany.mockResolvedValue({ count: 1 });
      prisma.doctorNurseAssignment.findUniqueOrThrow.mockResolvedValue(answered);
    });

    it('should answer only a pending invitation of this user, and tell the doctor', async () => {
      await expect(answer()).resolves.toBe(answered);

      expect(prisma.doctorNurseAssignment.updateMany).toHaveBeenCalledWith({
        where: { id: assignmentId, nurseId: invitee.id, status: NurseAssignmentStatusEnum.PENDING },
        data: accepting
          ? { status: NurseAssignmentStatusEnum.ACCEPTED, isActive: true, respondedAt: expect.any(Date) }
          : { status: NurseAssignmentStatusEnum.DECLINED, respondedAt: expect.any(Date) },
      });
      expect(notificationService.onNurseInvitationAnswered).toHaveBeenCalledWith(
        doctorUser.id,
        assignmentId,
        `${invitee.firstname} ${invitee.lastname}`,
        accepting,
      );
    });

    it.each([
      ['does not exist', null],
      ['belongs to someone else', { nurseId: 'someone-else', status: NurseAssignmentStatusEnum.PENDING }],
    ])('should report an invitation that %s as not found (404)', async (_case, row) => {
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(row);

      await expect(answer()).rejects.toThrow(new NotFoundException('Invitation not found.'));
      expect(prisma.doctorNurseAssignment.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it.each([NurseAssignmentStatusEnum.ACCEPTED, NurseAssignmentStatusEnum.DECLINED])(
      'should refuse an invitation already %s (409)',
      async (status) => {
        prisma.doctorNurseAssignment.findUnique.mockResolvedValue({ nurseId: invitee.id, status });

        await expect(answer()).rejects.toThrow(
          new ConflictException('This invitation has already been answered.'),
        );
        expect(prisma.doctorNurseAssignment.updateMany).not.toHaveBeenCalled();
      },
    );

    it('should refuse when the invitation was answered or cancelled concurrently (409)', async () => {
      prisma.doctorNurseAssignment.updateMany.mockResolvedValue({ count: 0 });

      await expect(answer()).rejects.toThrow(
        new ConflictException('This invitation is no longer pending.'),
      );
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(notificationService.onNurseInvitationAnswered).not.toHaveBeenCalled();
    });
  });

  describe('acceptInvitation — role', () => {
    let assignmentId: number;

    beforeEach(() => {
      assignmentId = Math.floor(Math.random() * 1e6) + 1;
      prisma.doctorNurseAssignment.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.doctorNurseAssignment.findUniqueOrThrow.mockResolvedValue({
        id: assignmentId,
        doctor: { user: { id: doctorUser.id } },
      });
    });

    const given = (invitee: MockUser) => {
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue({
        nurseId: invitee.id,
        status: NurseAssignmentStatusEnum.PENDING,
      });
      prisma.user.findUnique.mockResolvedValue(invitee);
    };

    it.each([
      ['a patient', () => createMockUser()],
      ['a role-less user', () => createMockUser({ role: UserRolesEnum.NONE })],
    ])('should make %s a NURSE, applied on their next request', async (_case, make) => {
      const invitee = make();
      given(invitee);
      const invalidateSpy = jest.spyOn(UserStatusCache, 'invalidate');

      try {
        await service.acceptInvitation(invitee as any, assignmentId);

        expect(prisma.user.updateMany).toHaveBeenCalledWith({
          where: { id: invitee.id, role: invitee.role, isAdmin: false, isSuperAdmin: false },
          data: { role: UserRolesEnum.NURSE },
        });
        expect(prisma.$transaction).toHaveBeenCalled();
        expect(invalidateSpy).toHaveBeenCalledWith(invitee.id);
      } finally {
        invalidateSpy.mockRestore();
      }
    });

    it('should leave an existing nurse as is', async () => {
      given(nurseUser);
      const invalidateSpy = jest.spyOn(UserStatusCache, 'invalidate');

      try {
        await service.acceptInvitation(nurseUser as any, assignmentId);

        expect(prisma.user.updateMany).not.toHaveBeenCalled();
        expect(invalidateSpy).not.toHaveBeenCalled();
      } finally {
        invalidateSpy.mockRestore();
      }
    });

    it.each([
      ['became a doctor', () => createMockDoctorUser()],
      ['became an admin', () => createMockAdminUser()],
    ])('should refuse an invitee who %s since being invited (400)', async (_case, make) => {
      const invitee = make();
      given(invitee);

      await expect(service.acceptInvitation(invitee as any, assignmentId)).rejects.toThrow(
        new BadRequestException('Doctors and admins cannot become nurses.'),
      );
      expect(prisma.doctorNurseAssignment.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['a patient', () => createMockUser()],
      ['a role-less user', () => createMockUser({ role: UserRolesEnum.NONE })],
    ])('should refuse (409) and tell no one when %s has their role changed concurrently', async (_case, make) => {
      const invitee = make();
      given(invitee);
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      const invalidateSpy = jest.spyOn(UserStatusCache, 'invalidate');

      try {
        await expect(service.acceptInvitation(invitee as any, assignmentId)).rejects.toThrow(
          new ConflictException('Your account changed while accepting; please try again.'),
        );
        expect(invalidateSpy).not.toHaveBeenCalled();
        expect(notificationService.onNurseInvitationAnswered).not.toHaveBeenCalled();
      } finally {
        invalidateSpy.mockRestore();
      }
    });

    it('should not change the role when the invitation was cancelled concurrently', async () => {
      const invitee = createMockUser();
      given(invitee);
      prisma.doctorNurseAssignment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.acceptInvitation(invitee as any, assignmentId)).rejects.toThrow(ConflictException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('declineInvitation — role', () => {
    it("should neither activate the assignment nor change the user's role", async () => {
      const invitee = createMockUser();
      const assignmentId = Math.floor(Math.random() * 1e6) + 1;
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue({
        nurseId: invitee.id,
        status: NurseAssignmentStatusEnum.PENDING,
      });
      prisma.doctorNurseAssignment.updateMany.mockResolvedValue({ count: 1 });
      prisma.doctorNurseAssignment.findUniqueOrThrow.mockResolvedValue({
        id: assignmentId,
        doctor: { user: { id: doctorUser.id } },
      });

      await service.declineInvitation(invitee as any, assignmentId);

      expect(prisma.doctorNurseAssignment.updateMany.mock.calls[0][0].data).not.toHaveProperty('isActive');
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
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

    it('should revoke all permissions with an empty list, keeping the assignment active', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue({
        ...assignment,
        permissions: [NursePermissionEnum.VIEW_SOAPS, NursePermissionEnum.VIEW_PATIENTS],
      });
      prisma.doctorNurseAssignment.update.mockResolvedValue({ ...assignment, permissions: [] });

      const result = await service.updatePermissions(doctorUser as any, 1, { permissions: [] });

      expect(result.permissions).toEqual([]);
      expect(prisma.doctorNurseAssignment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 }, data: { permissions: [] } }),
      );
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

    it('should throw BadRequestException when assignment is inactive', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue({
        ...assignment,
        isActive: false,
      });

      await expect(
        service.updatePermissions(doctorUser as any, 1, {
          permissions: [NursePermissionEnum.MANAGE_SCHEDULE],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────── removeAssignment ────────────────

  describe('removeAssignment', () => {
    const assignment = {
      id: 1,
      doctorId: 10,
      nurseId: 'n1',
      isActive: true,
      status: NurseAssignmentStatusEnum.ACCEPTED,
    };

    it('should delete a pending invitation and return it', async () => {
      const invitation = { ...assignment, isActive: false, status: NurseAssignmentStatusEnum.PENDING };
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(invitation);
      prisma.doctorNurseAssignment.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.removeAssignment(doctorUser as any, 1)).resolves.toBe(invitation);
      expect(prisma.doctorNurseAssignment.deleteMany).toHaveBeenCalledWith({
        where: { id: 1, status: NurseAssignmentStatusEnum.PENDING },
      });
      expect(prisma.doctorNurseAssignment.update).not.toHaveBeenCalled();
    });

    it('should deactivate instead when the invitation was accepted concurrently', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue({
        ...assignment,
        isActive: false,
        status: NurseAssignmentStatusEnum.PENDING,
      });
      prisma.doctorNurseAssignment.deleteMany.mockResolvedValue({ count: 0 });
      prisma.doctorNurseAssignment.update.mockResolvedValue({ ...assignment, isActive: false });

      await service.removeAssignment(doctorUser as any, 1);

      expect(prisma.doctorNurseAssignment.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { isActive: false },
        include: expect.any(Object),
      });
    });

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
      expect(prisma.doctorNurseAssignment.deleteMany).not.toHaveBeenCalled();
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
    it("should return a doctor's active assignments and pending invitations", async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      const assignments = [{ id: 1, doctorId: 10 }];
      prisma.doctorNurseAssignment.findMany.mockResolvedValue(assignments);

      const result = await service.getMyAssignments(doctorUser as any);
      expect(result).toEqual(assignments);
      expect(prisma.doctorNurseAssignment.findMany).toHaveBeenCalledWith({
        where: {
          doctorId: doctorProfile.id,
          OR: [{ isActive: true }, { status: NurseAssignmentStatusEnum.PENDING }],
        },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });

    it("should return only a nurse's active assignments (not pending invitations)", async () => {
      const assignments = [{ id: 1, nurseId: nurseUser.id }];
      prisma.doctorNurseAssignment.findMany.mockResolvedValue(assignments);

      const result = await service.getMyAssignments(nurseUser as any);
      expect(result).toEqual(assignments);
      expect(prisma.doctorNurseAssignment.findMany).toHaveBeenCalledWith({
        where: { nurseId: nurseUser.id, isActive: true },
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
