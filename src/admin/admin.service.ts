import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewService } from '../review/review.service';
import { User } from '@prisma/client';
import { AdminUserFilterDto } from './dto/admin-user-filter.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { VerifyDoctorDto } from './dto/verify-doctor.dto';
import { BanUserDto } from './dto/ban-user.dto';
import { NotificationService } from '../notification/notification.service';
import { ConsultationStatusEnum, AppointmentStatusEnum, PaymentStatusEnum } from '@prisma/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewService: ReviewService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
  ) {}

  /* ── B-55  User management ─────────────────────────────── */

  async listUsers(filters: AdminUserFilterDto) {
    const skip = +(filters.skip ?? 0);
    const take = +(filters.take ?? 20);

    const where: Record<string, unknown> = {};

    if (filters.role) {
      where.role = filters.role;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive === 'true';
    }
    if (filters.isAdmin !== undefined) {
      where.isAdmin = filters.isAdmin === 'true';
    }
    if (filters.isBanned !== undefined) {
      where.isBanned = filters.isBanned === 'true';
    }
    if (filters.search) {
      where.OR = [
        { firstname: { contains: filters.search, mode: 'insensitive' } },
        { lastname: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstname: true,
          lastname: true,
          email: true,
          role: true,
          isActive: true,
          isAdmin: true,
          isSuperAdmin: true,
          isPrivate: true,
          isBanned: true,
          banReason: true,
          bannedAt: true,
          bannedBy: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  async updateUser(userId: string, dto: AdminUpdateUserDto, currentUser: User) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!target) {
      throw new NotFoundException('User not found.');
    }

    if (!currentUser.isSuperAdmin && (target.isAdmin || target.isSuperAdmin)) {
      throw new ForbiddenException('Only superadmins can modify admin accounts.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: this.safeAdminUserSelect(),
    });
  }

  async deactivateUser(userId: string, currentUser: User) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!target) {
      throw new NotFoundException('User not found.');
    }
    if (!target.isActive) {
      throw new BadRequestException('User is already deactivated.');
    }

    if (!currentUser.isSuperAdmin && (target.isAdmin || target.isSuperAdmin)) {
      throw new ForbiddenException('Only superadmins can deactivate admin accounts.');
    }

    if (userId === currentUser.id) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
      select: this.safeAdminUserSelect(),
    });
  }

  /* ── A-02  Ban / Unban ──────────────────────────────────── */

  async banUser(userId: string, dto: BanUserDto, admin: User) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!target) {
      throw new NotFoundException('User not found.');
    }
    if (target.isBanned) {
      throw new BadRequestException('User is already banned.');
    }
    if (target.isSuperAdmin) {
      throw new ForbiddenException('Cannot ban a superadmin.');
    }
    if (!admin.isSuperAdmin && (target.isAdmin || target.isSuperAdmin)) {
      throw new ForbiddenException('Only superadmins can ban admin accounts.');
    }
    if (userId === admin.id) {
      throw new ForbiddenException('You cannot ban yourself.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: true,
        banReason: dto.reason,
        bannedAt: new Date(),
        bannedBy: admin.id,
      },
      select: this.safeAdminUserSelect(),
    });
  }

  async unbanUser(userId: string, admin: User) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!target) {
      throw new NotFoundException('User not found.');
    }
    if (!target.isBanned) {
      throw new BadRequestException('User is not banned.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: false,
        banReason: null,
        bannedAt: null,
        bannedBy: null,
      },
      select: this.safeAdminUserSelect(),
    });
  }

  /* ── B-56  Doctor verification ─────────────────────────── */

  async listPendingDoctors() {
    return this.prisma.doctorProfile.findMany({
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
  }

  async getDoctorDocuments(doctorId: number) {
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { id: doctorId },
    });
    if (!doctor) {
      throw new NotFoundException('Doctor not found.');
    }

    return this.prisma.doctorDocument.findMany({
      where: { doctorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async verifyDoctor(doctorId: number, dto: VerifyDoctorDto, admin: User) {
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { id: doctorId },
    });
    if (!doctor) {
      throw new NotFoundException('Doctor not found.');
    }

    if (!dto.approved && !dto.reason) {
      throw new BadRequestException(
        'A reason is required when rejecting a doctor.',
      );
    }

    const updated = await this.prisma.doctorProfile.update({
      where: { id: doctorId },
      data: {
        verified: dto.approved,
        verifiedAt: dto.approved ? new Date() : null,
        verifiedBy: dto.approved ? admin.id : null,
        rejectionReason: dto.approved ? null : dto.reason,
      },
    });

    if (dto.approved) {
      this.notificationService
        .onDoctorVerified(doctor.userId)
        .catch((e) => this.logger.error(`Notification failed: ${e.message}`));
    }

    return updated;
  }

  /* ── B-57  Promote / demote ────────────────────────────── */

  async promoteToAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (user.isAdmin || user.isSuperAdmin) {
      throw new BadRequestException('User is already an admin.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { isAdmin: true },
      select: this.safeAdminUserSelect(),
    });
  }

  async demoteAdmin(userId: string, currentUser: User) {
    if (userId === currentUser.id) {
      throw new ForbiddenException('You cannot demote yourself.');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!target) {
      throw new NotFoundException('User not found.');
    }
    if (!target.isAdmin && !target.isSuperAdmin) {
      throw new BadRequestException('User is not an admin.');
    }
    if (target.isSuperAdmin) {
      throw new ForbiddenException('Cannot demote a superadmin.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { isAdmin: false },
      select: this.safeAdminUserSelect(),
    });
  }

  /* ── B-58  Platform stats ──────────────────────────────── */

  async getPlatformStats() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      totalDoctors,
      totalPatients,
      totalConsultations,
      pendingVerifications,
      activeConsultations,
      bannedUsers,
      totalAppointments,
      newUsersThisMonth,
      revenueResult,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.doctorProfile.count({ where: { verified: true } }),
      this.prisma.patientProfile.count(),
      this.prisma.consultation.count(),
      this.prisma.doctorProfile.count({ where: { verified: false } }),
      this.prisma.consultation.count({
        where: { status: ConsultationStatusEnum.IN_PROGRESS },
      }),
      this.prisma.user.count({ where: { isBanned: true } }),
      this.prisma.appointment.count(),
      this.prisma.user.count({
        where: { createdAt: { gte: monthStart } },
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatusEnum.COMPLETED },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalUsers,
      totalDoctors,
      totalPatients,
      totalConsultations,
      pendingVerifications,
      activeConsultations,
      bannedUsers,
      totalAppointments,
      newUsersThisMonth,
      totalRevenue: revenueResult._sum.amount ?? 0,
    };
  }

  /* ── B-59  Review moderation ───────────────────────────── */

  async removeReview(reviewId: number, admin: User) {
    await this.reviewService.delete(reviewId, admin);
  }

  private safeAdminUserSelect() {
    return {
      id: true,
      firstname: true,
      lastname: true,
      email: true,
      role: true,
      isActive: true,
      isAdmin: true,
      isSuperAdmin: true,
      isPrivate: true,
      isBanned: true,
      banReason: true,
      bannedAt: true,
      bannedBy: true,
      avatar: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }
}
