import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DoctorNurseAssignment,
  NursePermissionEnum,
  User,
  UserRolesEnum,
} from '@prisma/client';
import { AssignNurseDto } from './dto/assign-nurse.dto';
import { UpdatePermissionsDto } from './dto/update-permissions.dto';

@Injectable()
export class NurseService {
  private readonly logger = new Logger(NurseService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────── Assignment Flow (B-95) ────────────────

  async assignNurse(
    doctorUser: User,
    dto: AssignNurseDto,
  ): Promise<DoctorNurseAssignment> {
    const doctorProfile = await this.getDoctorProfile(doctorUser.id);

    const nurse = await this.prisma.user.findUnique({
      where: { id: dto.nurseId },
    });
    if (!nurse) {
      throw new NotFoundException('Nurse user not found.');
    }
    if (nurse.role !== UserRolesEnum.NURSE) {
      throw new BadRequestException('User is not a nurse.');
    }

    try {
      const assignment = await this.prisma.doctorNurseAssignment.create({
        data: {
          doctorId: doctorProfile.id,
          nurseId: dto.nurseId,
          permissions: dto.permissions ?? [NursePermissionEnum.VIEW_PATIENTS],
          isActive: true,
        },
        include: this.assignmentInclude(),
      });

      this.logger.log(
        `Doctor ${doctorProfile.id} assigned nurse ${dto.nurseId}`,
      );
      return assignment;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'This nurse is already assigned to you.',
        );
      }
      throw error;
    }
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
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found.');
    }
    if (assignment.doctorId !== doctorProfile.id) {
      throw new ForbiddenException('You do not own this assignment.');
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
        where: { doctorId: doctorProfile.id },
        include: this.assignmentInclude(),
        orderBy: { createdAt: 'desc' },
      });
    }

    if (user.role === UserRolesEnum.NURSE) {
      return this.prisma.doctorNurseAssignment.findMany({
        where: { nurseId: user.id },
        include: this.assignmentInclude(),
        orderBy: { createdAt: 'desc' },
      });
    }

    throw new ForbiddenException('Only doctors and nurses can view assignments.');
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
        throw new ForbiddenException('You do not have access to this assignment.');
      }
      return assignment;
    }

    if (user.role === UserRolesEnum.NURSE) {
      if (assignment.nurseId !== user.id) {
        throw new ForbiddenException('You do not have access to this assignment.');
      }
      return assignment;
    }

    throw new ForbiddenException('You do not have access to this assignment.');
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
