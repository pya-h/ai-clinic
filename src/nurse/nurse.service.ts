import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserStatusCache } from '../auth/user-status';
import { NotificationService } from '../notification/notification.service';
import {
  AppointmentStatusEnum,
  ConsultationStatusEnum,
  DoctorNurseAssignment,
  NurseAssignmentStatusEnum,
  NursePermissionEnum,
  Prisma,
  User,
  UserRolesEnum,
} from '@prisma/client';
import { AssignNurseDto } from './dto/assign-nurse.dto';
import { UpdatePermissionsDto } from './dto/update-permissions.dto';

/** How long after a decline the same doctor can't invite that user again. */
export const REINVITE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class NurseService {
  private readonly logger = new Logger(NurseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  // ──────────────── Assignment Flow (B-95) ────────────────

  /**
   * Invites a user to the doctor's team. Nothing changes for them (role,
   * access) until they accept; see acceptInvitation.
   */
  async assignNurse(
    doctorUser: User,
    dto: AssignNurseDto,
  ): Promise<DoctorNurseAssignment> {
    const doctorProfile = await this.getDoctorProfile(doctorUser.id);
    if (!doctorProfile.verified) {
      throw new ForbiddenException('Only verified doctors can invite nurses.');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.nurseId },
    });
    if (!targetUser) {
      throw new NotFoundException('User not found.');
    }

    if (targetUser.role === UserRolesEnum.DOCTOR) {
      throw new BadRequestException('Cannot assign a doctor as a nurse.');
    }
    if (targetUser.isAdmin || targetUser.isSuperAdmin) {
      throw new BadRequestException('Cannot assign an admin as a nurse.');
    }

    const existing = await this.prisma.doctorNurseAssignment.findUnique({
      where: {
        doctorId_nurseId: { doctorId: doctorProfile.id, nurseId: dto.nurseId },
      },
    });
    if (existing?.isActive) {
      throw new ConflictException('This nurse is already assigned to you.');
    }
    if (existing?.status === NurseAssignmentStatusEnum.PENDING) {
      throw new ConflictException(
        'This user already has a pending invitation from you.',
      );
    }
    if (
      existing?.status === NurseAssignmentStatusEnum.DECLINED &&
      existing.respondedAt
    ) {
      const invitableFrom = new Date(
        existing.respondedAt.getTime() + REINVITE_COOLDOWN_MS,
      );
      if (invitableFrom.getTime() > Date.now()) {
        throw new ConflictException(
          `This user declined your invitation recently. You can invite them again from ${invitableFrom.toISOString()}.`,
        );
      }
    }

    const invitation = {
      permissions: dto.permissions ?? [NursePermissionEnum.VIEW_PATIENTS],
      status: NurseAssignmentStatusEnum.PENDING,
      isActive: false,
      respondedAt: null,
    };
    // A declined or removed assignment is reused as the new invitation. Both writes
    // are conditional so that a concurrent invite can't send a second one, and a
    // decline in between can't skip the cooldown.
    try {
      if (existing) {
        const { count } = await this.prisma.doctorNurseAssignment.updateMany({
          where: {
            id: existing.id,
            isActive: false,
            status: { not: NurseAssignmentStatusEnum.PENDING },
            respondedAt: existing.respondedAt,
          },
          data: invitation,
        });
        if (count === 0) {
          throw new ConflictException(
            'This user already has a pending invitation from you.',
          );
        }
      } else {
        await this.prisma.doctorNurseAssignment.create({
          data: {
            doctorId: doctorProfile.id,
            nurseId: dto.nurseId,
            ...invitation,
          },
        });
      }
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This user already has a pending invitation from you.',
        );
      }
      throw err;
    }

    const assignment =
      await this.prisma.doctorNurseAssignment.findUniqueOrThrow({
        where: {
          doctorId_nurseId: {
            doctorId: doctorProfile.id,
            nurseId: dto.nurseId,
          },
        },
        include: this.assignmentInclude(),
      });

    this.notificationService
      .onNurseInvitation(
        targetUser.id,
        assignment.id,
        `${doctorUser.firstname} ${doctorUser.lastname}`,
      )
      .catch((e) => this.logger.error(`Notification failed: ${e.message}`));
    this.logger.log(
      `Doctor ${doctorProfile.id} invited user ${dto.nurseId} as a nurse`,
    );
    return assignment;
  }

  /** Pending invitations sent to the current user. */
  async getMyInvitations(user: User): Promise<DoctorNurseAssignment[]> {
    return this.prisma.doctorNurseAssignment.findMany({
      where: { nurseId: user.id, status: NurseAssignmentStatusEnum.PENDING },
      include: this.assignmentInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Puts the assignment in effect; a patient or role-less invitee becomes a NURSE. */
  async acceptInvitation(
    user: User,
    assignmentId: number,
  ): Promise<DoctorNurseAssignment> {
    await this.findPendingInvitation(user, assignmentId);

    const invitee = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true, isAdmin: true, isSuperAdmin: true },
    });
    if (!invitee) {
      throw new NotFoundException('User not found.');
    }
    if (
      invitee.role === UserRolesEnum.DOCTOR ||
      invitee.isAdmin ||
      invitee.isSuperAdmin
    ) {
      throw new BadRequestException('Doctors and admins cannot become nurses.');
    }
    const becomesNurse = invitee.role !== UserRolesEnum.NURSE;

    const accepted = await this.prisma.$transaction(async (tx) => {
      await this.answerInvitation(tx, user, assignmentId, {
        status: NurseAssignmentStatusEnum.ACCEPTED,
        isActive: true,
      });
      if (becomesNurse) {
        // Conditional on the role checked above, so a concurrent admin change isn't overwritten.
        const { count } = await tx.user.updateMany({
          where: {
            id: user.id,
            role: invitee.role,
            isAdmin: false,
            isSuperAdmin: false,
          },
          data: { role: UserRolesEnum.NURSE },
        });
        if (count === 0) {
          throw new ConflictException(
            'Your account changed while accepting; please try again.',
          );
        }
      }
      return tx.doctorNurseAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        include: this.assignmentInclude(),
      });
    });

    if (becomesNurse) {
      UserStatusCache.invalidate(user.id);
      this.logger.log(
        `User ${user.id} became a NURSE by accepting assignment ${assignmentId}`,
      );
    }
    this.notifyDoctorOfAnswer(accepted, user, true);
    return accepted;
  }

  async declineInvitation(
    user: User,
    assignmentId: number,
  ): Promise<DoctorNurseAssignment> {
    await this.findPendingInvitation(user, assignmentId);

    await this.answerInvitation(this.prisma, user, assignmentId, {
      status: NurseAssignmentStatusEnum.DECLINED,
    });
    const declined = await this.prisma.doctorNurseAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: this.assignmentInclude(),
    });

    this.notifyDoctorOfAnswer(declined, user, false);
    return declined;
  }

  async updatePermissions(
    doctorUser: User,
    assignmentId: number,
    dto: UpdatePermissionsDto,
  ): Promise<DoctorNurseAssignment> {
    const doctorProfile = await this.getDoctorProfile(doctorUser.id);

    const assignment = await this.prisma.doctorNurseAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found.');
    }
    if (assignment.doctorId !== doctorProfile.id) {
      throw new ForbiddenException('You do not own this assignment.');
    }
    if (!assignment.isActive) {
      throw new BadRequestException(
        'Cannot update permissions on an inactive assignment.',
      );
    }

    return this.prisma.doctorNurseAssignment.update({
      where: { id: assignmentId },
      data: { permissions: dto.permissions },
      include: this.assignmentInclude(),
    });
  }

  async removeAssignment(
    doctorUser: User,
    assignmentId: number,
  ): Promise<DoctorNurseAssignment> {
    const doctorProfile = await this.getDoctorProfile(doctorUser.id);

    const assignment = await this.prisma.doctorNurseAssignment.findUnique({
      where: { id: assignmentId },
      include: this.assignmentInclude(),
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found.');
    }
    if (assignment.doctorId !== doctorProfile.id) {
      throw new ForbiddenException('You do not own this assignment.');
    }

    // Cancelling an invitation leaves nothing behind. If the invitee accepted in
    // the meantime, nothing is deleted and the assignment is deactivated instead.
    if (assignment.status === NurseAssignmentStatusEnum.PENDING) {
      const { count } = await this.prisma.doctorNurseAssignment.deleteMany({
        where: { id: assignmentId, status: NurseAssignmentStatusEnum.PENDING },
      });
      if (count === 1) return assignment;
    }

    return this.prisma.doctorNurseAssignment.update({
      where: { id: assignmentId },
      data: { isActive: false },
      include: this.assignmentInclude(),
    });
  }

  async getMyAssignments(user: User): Promise<DoctorNurseAssignment[]> {
    if (user.role === UserRolesEnum.DOCTOR) {
      const doctorProfile = await this.getDoctorProfile(user.id);
      return this.prisma.doctorNurseAssignment.findMany({
        where: {
          doctorId: doctorProfile.id,
          OR: [
            { isActive: true },
            { status: NurseAssignmentStatusEnum.PENDING },
          ],
        },
        include: this.assignmentInclude(),
        orderBy: { createdAt: 'desc' },
      });
    }

    if (user.role === UserRolesEnum.NURSE) {
      return this.prisma.doctorNurseAssignment.findMany({
        where: { nurseId: user.id, isActive: true },
        include: this.assignmentInclude(),
        orderBy: { createdAt: 'desc' },
      });
    }

    throw new ForbiddenException(
      'Only doctors and nurses can view assignments.',
    );
  }

  async getAssignment(
    user: User,
    assignmentId: number,
  ): Promise<DoctorNurseAssignment> {
    const assignment = await this.prisma.doctorNurseAssignment.findUnique({
      where: { id: assignmentId },
      include: this.assignmentInclude(),
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found.');
    }

    if (user.isAdmin || user.isSuperAdmin) return assignment;

    if (user.role === UserRolesEnum.DOCTOR) {
      const doctorProfile = await this.getDoctorProfile(user.id);
      if (assignment.doctorId !== doctorProfile.id) {
        throw new ForbiddenException(
          'You do not have access to this assignment.',
        );
      }
      return assignment;
    }

    if (user.role === UserRolesEnum.NURSE) {
      if (assignment.nurseId !== user.id) {
        throw new ForbiddenException(
          'You do not have access to this assignment.',
        );
      }
      return assignment;
    }

    throw new ForbiddenException('You do not have access to this assignment.');
  }

  // ──────────────── Dashboard (N-02) ────────────────

  async getDashboard(user: User) {
    const assignments = await this.prisma.doctorNurseAssignment.findMany({
      where: { nurseId: user.id, isActive: true },
      include: this.assignmentInclude(),
    });

    const doctorIds = assignments.map((a) => a.doctorId);

    const [upcomingAppointments, activeConsultations] = await Promise.all([
      doctorIds.length > 0
        ? this.prisma.appointment.count({
            where: {
              doctorId: { in: doctorIds },
              status: AppointmentStatusEnum.CONFIRMED,
              dateTime: { gte: new Date() },
            },
          })
        : 0,
      doctorIds.length > 0
        ? this.prisma.consultation.count({
            where: {
              doctorId: { in: doctorIds },
              status: ConsultationStatusEnum.IN_PROGRESS,
            },
          })
        : 0,
    ]);

    return {
      assignments,
      stats: {
        upcomingAppointments,
        activeConsultations,
        assignedDoctors: assignments.length,
      },
    };
  }

  // ──────────────── Delegated Access (B-96) ────────────────

  /**
   * Check whether a nurse has a specific permission for a given doctor.
   * Returns the assignment if authorized, null otherwise.
   */
  async getNursePermissionForDoctor(
    nurseUserId: string,
    doctorId: number,
    permission: NursePermissionEnum,
  ): Promise<DoctorNurseAssignment | null> {
    const assignment = await this.prisma.doctorNurseAssignment.findFirst({
      where: {
        nurseId: nurseUserId,
        doctorId,
        isActive: true,
      },
    });

    if (!assignment) return null;
    if (!assignment.permissions.includes(permission)) return null;

    return assignment;
  }

  /**
   * Assert that a nurse has the required permission for a doctor.
   * Throws ForbiddenException if not authorized.
   */
  async assertNursePermission(
    nurseUserId: string,
    doctorId: number,
    permission: NursePermissionEnum,
  ): Promise<void> {
    const assignment = await this.getNursePermissionForDoctor(
      nurseUserId,
      doctorId,
      permission,
    );
    if (!assignment) {
      throw new ForbiddenException(
        'You do not have the required permission for this doctor.',
      );
    }
  }

  /**
   * Get all active doctor IDs that a nurse has the given permission for.
   */
  async getDoctorIdsForNurse(
    nurseUserId: string,
    permission: NursePermissionEnum,
  ): Promise<number[]> {
    const assignments = await this.prisma.doctorNurseAssignment.findMany({
      where: {
        nurseId: nurseUserId,
        isActive: true,
      },
      select: { doctorId: true, permissions: true },
    });

    return assignments
      .filter((a) => a.permissions.includes(permission))
      .map((a) => a.doctorId);
  }

  // ──────────────── Private Helpers ────────────────

  /** Someone else's invitation is reported as missing, so ids can't be probed. */
  private async findPendingInvitation(
    user: User,
    assignmentId: number,
  ): Promise<void> {
    const invitation = await this.prisma.doctorNurseAssignment.findUnique({
      where: { id: assignmentId },
      select: { nurseId: true, status: true },
    });
    if (!invitation || invitation.nurseId !== user.id) {
      throw new NotFoundException('Invitation not found.');
    }
    if (invitation.status !== NurseAssignmentStatusEnum.PENDING) {
      throw new ConflictException('This invitation has already been answered.');
    }
  }

  // Conditional on PENDING, so a concurrent answer or cancellation can't be overwritten.
  private async answerInvitation(
    client: Prisma.TransactionClient,
    user: User,
    assignmentId: number,
    data: Prisma.DoctorNurseAssignmentUpdateManyMutationInput,
  ): Promise<void> {
    const { count } = await client.doctorNurseAssignment.updateMany({
      where: {
        id: assignmentId,
        nurseId: user.id,
        status: NurseAssignmentStatusEnum.PENDING,
      },
      data: { ...data, respondedAt: new Date() },
    });
    if (count === 0) {
      throw new ConflictException('This invitation is no longer pending.');
    }
  }

  private notifyDoctorOfAnswer(
    assignment: DoctorNurseAssignment & { doctor: { user: { id: string } } },
    nurse: User,
    accepted: boolean,
  ): void {
    this.notificationService
      .onNurseInvitationAnswered(
        assignment.doctor.user.id,
        assignment.id,
        `${nurse.firstname} ${nurse.lastname}`,
        accepted,
      )
      .catch((e) => this.logger.error(`Notification failed: ${e.message}`));
  }

  private async getDoctorProfile(userId: string) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Doctor profile not found.');
    }
    return profile;
  }

  private assignmentInclude() {
    return {
      nurse: {
        select: {
          id: true,
          firstname: true,
          lastname: true,
          email: true,
          avatar: true,
        },
      },
      doctor: {
        include: {
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              avatar: true,
            },
          },
        },
      },
    };
  }
}
