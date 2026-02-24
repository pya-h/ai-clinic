import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewService } from '../review/review.service';
import { User } from '@prisma/client';
import { AdminUserFilterDto } from './dto/admin-user-filter.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { VerifyDoctorDto } from './dto/verify-doctor.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewService: ReviewService,
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
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  async updateUser(userId: string, dto: AdminUpdateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });
  }

  async deactivateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (!user.isActive) {
      throw new BadRequestException('User is already deactivated.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
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

    return this.prisma.doctorProfile.update({
      where: { id: doctorId },
      data: {
        verified: dto.approved,
        verifiedAt: dto.approved ? new Date() : null,
        verifiedBy: dto.approved ? admin.id : null,
        rejectionReason: dto.approved ? null : dto.reason,
      },
    });
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
    });
  }

  /* ── B-58  Platform stats ──────────────────────────────── */

  async getPlatformStats() {
    const [
      totalUsers,
      totalDoctors,
      totalPatients,
      totalConsultations,
      pendingVerifications,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.doctorProfile.count({ where: { verified: true } }),
      this.prisma.patientProfile.count(),
      this.prisma.consultation.count(),
      this.prisma.doctorProfile.count({ where: { verified: false } }),
    ]);

    return {
      totalUsers,
      totalDoctors,
      totalPatients,
      totalConsultations,
      pendingVerifications,
    };
  }

  /* ── B-59  Review moderation ───────────────────────────── */

  async removeReview(reviewId: number, admin: User) {
    await this.reviewService.delete(reviewId, admin);
  }
}
