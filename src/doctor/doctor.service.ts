import {
  ConflictException,
  Injectable,
  MethodNotAllowedException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppointmentStatusEnum,
  ConsultationStatusEnum,
  Prisma,
  User,
  UserRolesEnum,
  DocumentTypeEnum,
} from '@prisma/client';
import { toCapitalCase } from '../common/tools';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { DoctorFilterDto } from './dto/doctor-filter.dto';
import { FileUploadService } from '../file-upload/file-upload.service';
import { MultipartFile } from '@fastify/multipart';

@Injectable()
export class DoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  async hasProfile(userId: string, fromAnyKind: boolean = false) {
    return (
      (await this.prisma.doctorProfile.findUnique({ where: { userId } })) ||
      (fromAnyKind &&
        (await this.prisma.patientProfile.findUnique({ where: { userId } })))
    );
  }

  async createDoctorProfile(
    user: User,
    data: Prisma.DoctorProfileCreateWithoutUserInput,
  ) {
    if (user.role !== UserRolesEnum.DOCTOR) {
      throw new MethodNotAllowedException(
        `${toCapitalCase(user.role || 'Unknown')} user is not allowed to create a doctor profile.`,
      );
    }
    if (await this.hasProfile(user.id, false)) {
      throw new ConflictException(`Doctor already has a profile.`);
    }
    try {
      return await this.prisma.doctorProfile.create({
        data: { ...data, userId: user.id },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Doctor already has a profile.');
      }
      throw error;
    }
  }

  /**
   * Update the doctor profile for the authenticated user.
   */
  async updateProfile(user: User, data: UpdateDoctorProfileDto) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      throw new NotFoundException('Doctor profile not found.');
    }
    return this.prisma.doctorProfile.update({
      where: { userId: user.id },
      data: { ...data },
    });
  }

  /**
   * Public listing of verified doctors with optional filters and pagination.
   */
  async findAll(filters: DoctorFilterDto) {
    const where: Prisma.DoctorProfileWhereInput = { verified: true };

    if (filters.specialty) {
      where.specialty = filters.specialty;
    }

    if (filters.visitMethod) {
      where.visitMethods = { has: filters.visitMethod };
    }

    if (filters.location) {
      where.OR = [
        { location: { contains: filters.location, mode: 'insensitive' } },
        { clinicLocation: { contains: filters.location, mode: 'insensitive' } },
      ];
    }

    if (filters.search) {
      const searchWhere = {
        user: {
          OR: [
            { firstname: { contains: filters.search, mode: 'insensitive' as const } },
            { lastname: { contains: filters.search, mode: 'insensitive' as const } },
          ],
        },
      };
      // Merge with existing OR (location) if present
      if (where.OR) {
        where.AND = [{ OR: where.OR }, searchWhere];
        delete where.OR;
      } else {
        Object.assign(where, searchWhere);
      }
    }

    const skip = filters.skip ? Number(filters.skip) : 0;
    const take = filters.take ? Number(filters.take) : 20;

    const [data, total] = await Promise.all([
      this.prisma.doctorProfile.findMany({
        where,
        skip,
        take,
        include: {
          user: { select: { id: true, firstname: true, lastname: true, avatar: true } },
          _count: { select: { reviewsAbout: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.doctorProfile.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  /**
   * Public single doctor profile by profileId, with aggregate rating.
   */
  async findOne(id: number) {
    const [profile, ratingAgg] = await Promise.all([
      this.prisma.doctorProfile.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, firstname: true, lastname: true, avatar: true } },
        },
      }),
      this.prisma.doctorReview.aggregate({
        where: { doctorId: id },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

    if (!profile || !profile.verified) {
      throw new NotFoundException('Doctor profile not found.');
    }

    return {
      ...profile,
      averageRating: ratingAgg._count.rating > 0
        ? Math.round((ratingAgg._avg.rating ?? 0) * 10) / 10
        : null,
      totalReviews: ratingAgg._count.rating,
    };
  }

  /**
   * Upload a document for the authenticated doctor.
   */
  async uploadDocument(
    user: User,
    file: MultipartFile,
    type: DocumentTypeEnum,
  ) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      throw new NotFoundException('Doctor profile not found.');
    }

    const uploaded = await this.fileUploadService.uploadFile(
      file,
      'doctor-documents',
    );

    return this.prisma.doctorDocument.create({
      data: {
        doctorId: profile.id,
        type,
        fileUrl: uploaded.url,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
      },
    });
  }

  async getMyProfile(user: User) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.id },
      include: {
        user: { select: { id: true, firstname: true, lastname: true, avatar: true, email: true } },
      },
    });
    if (!profile) {
      throw new NotFoundException('Doctor profile not found.');
    }
    return profile;
  }

  async getStats(user: User) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      throw new NotFoundException('Doctor profile not found.');
    }

    const [
      upcomingAppointments,
      activeConsultations,
      pendingMatchRequests,
      totalPatientsSeen,
      completedConsultations,
      totalAppointments,
    ] = await Promise.all([
      this.prisma.appointment.count({
        where: {
          doctorId: profile.id,
          dateTime: { gte: new Date() },
          status: { in: [AppointmentStatusEnum.PENDING, AppointmentStatusEnum.CONFIRMED] },
        },
      }),
      this.prisma.consultation.count({
        where: { doctorId: profile.id, status: ConsultationStatusEnum.IN_PROGRESS },
      }),
      this.prisma.matchRequest.count({
        where: { matchedDoctorId: profile.id, status: 'MATCHED' },
      }),
      this.prisma.consultation.groupBy({
        by: ['patientId'],
        where: { doctorId: profile.id, status: ConsultationStatusEnum.COMPLETED },
      }).then((groups) => groups.length),
      this.prisma.consultation.count({
        where: { doctorId: profile.id, status: ConsultationStatusEnum.COMPLETED },
      }),
      this.prisma.appointment.count({
        where: { doctorId: profile.id },
      }),
    ]);

    return {
      upcomingAppointments,
      activeConsultations,
      pendingMatchRequests,
      totalPatientsSeen,
      completedConsultations,
      totalAppointments,
    };
  }

  /**
   * Get all documents for the authenticated doctor.
   */
  async getDocuments(user: User) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      throw new NotFoundException('Doctor profile not found.');
    }

    return this.prisma.doctorDocument.findMany({
      where: { doctorId: profile.id },
      orderBy: { createdAt: 'desc' },
    });
  }
}
