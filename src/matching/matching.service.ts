import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewService, AggregateRating } from '../review/review.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import {
  ConsultationStatusEnum,
  DoctorSpecialtiesEnum,
  MatchRequest,
  MatchStatusEnum,
  Prisma,
  TriageLevelEnum,
  User,
  UserRolesEnum,
} from '@prisma/client';

// ────────────── Scoring Weights ──────────────

const WEIGHTS = {
  specialtyMatch: 40,
  rating: 25,
  availability: 20,
  experience: 15,
};

// ────────────── State Machine ──────────────

const ALLOWED_TRANSITIONS: Record<MatchStatusEnum, MatchStatusEnum[]> = {
  SEARCHING: [
    MatchStatusEnum.MATCHED,
    MatchStatusEnum.TIMEOUT,
    MatchStatusEnum.CANCELLED,
  ],
  MATCHED: [
    MatchStatusEnum.ACCEPTED,
    MatchStatusEnum.CONSULTATION_CREATED,
    MatchStatusEnum.SEARCHING,
    MatchStatusEnum.TIMEOUT,
    MatchStatusEnum.CANCELLED,
  ],
  ACCEPTED: [MatchStatusEnum.CONSULTATION_CREATED, MatchStatusEnum.CANCELLED],
  CONSULTATION_CREATED: [],
  TIMEOUT: [MatchStatusEnum.MANUAL_BROWSE],
  MANUAL_BROWSE: [],
  CANCELLED: [],
};

export interface ScoredDoctor {
  doctorId: number;
  userId: string;
  firstname: string;
  lastname: string;
  avatar: string | null;
  specialty: DoctorSpecialtiesEnum;
  secondarySpecialties: DoctorSpecialtiesEnum[];
  rating: number | null;
  totalReviews: number;
  availableSlots: number;
  score: number;
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);
  private readonly MATCH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private readonly TOP_N = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewService: ReviewService,
    private readonly schedulingService: SchedulingService,
  ) {}

  // ────────────── State Machine ──────────────

  validateTransition(from: MatchStatusEnum, to: MatchStatusEnum): void {
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      throw new BadRequestException(
        `Cannot transition match from ${from} to ${to}.`,
      );
    }
  }

  // ────────────── Doctor Scoring ──────────────

  async scoreDoctors(criteria: {
    specialty?: DoctorSpecialtiesEnum;
    triageLevel?: TriageLevelEnum;
    excludeDoctorIds?: number[];
  }): Promise<ScoredDoctor[]> {
    const doctors = await this.prisma.doctorProfile.findMany({
      where: {
        verified: true,
        user: { isActive: true },
        ...(criteria.excludeDoctorIds?.length
          ? { id: { notIn: criteria.excludeDoctorIds } }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            avatar: true,
          },
        },
        _count: { select: { consultations: true } },
      },
    });

    if (doctors.length === 0) return [];

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const doctorIds = doctors.map((d) => d.id);

    const [ratingsMap, slotsMap] = await Promise.all([
      this.reviewService
        .getAggregateRatingsForDoctors(doctorIds)
        .catch(() => new Map<number, AggregateRating>()),
      this.schedulingService
        .countAvailableSlotsForDoctors(doctorIds, now, weekFromNow)
        .catch(() => new Map<number, number>()),
    ]);

    const defaultRating: AggregateRating = {
      averageRating: null,
      totalReviews: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };

    const scored = doctors.map((doctor) => {
      let specialtyScore = 0;
      if (criteria.specialty) {
        if (doctor.specialty === criteria.specialty) {
          specialtyScore = 1.0;
        } else if (doctor.secondarySpecialties.includes(criteria.specialty)) {
          specialtyScore = 0.6;
        } else if (doctor.specialty === DoctorSpecialtiesEnum.GENERAL) {
          specialtyScore = 0.3;
        }
      } else {
        specialtyScore = 0.5;
      }

      const ratingData = ratingsMap.get(doctor.id) ?? defaultRating;
      const ratingScore = ratingData.averageRating
        ? ratingData.averageRating / 5
        : 0.5;

      const availableSlotCount = slotsMap.get(doctor.id) ?? 0;
      const maxSlots = 50;
      const availabilityScore = Math.min(availableSlotCount / maxSlots, 1.0);

      const consultationCount = doctor._count.consultations;
      const maxExperience = 200;
      const experienceScore = Math.min(consultationCount / maxExperience, 1.0);

      const totalScore =
        WEIGHTS.specialtyMatch * specialtyScore +
        WEIGHTS.rating * ratingScore +
        WEIGHTS.availability * availabilityScore +
        WEIGHTS.experience * experienceScore;

      return {
        doctorId: doctor.id,
        userId: doctor.user.id,
        firstname: doctor.user.firstname,
        lastname: doctor.user.lastname,
        avatar: doctor.user.avatar,
        specialty: doctor.specialty,
        secondarySpecialties: doctor.secondarySpecialties,
        rating: ratingData.averageRating,
        totalReviews: ratingData.totalReviews,
        availableSlots: availableSlotCount,
        score: Math.round(totalScore * 100) / 100,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, this.TOP_N);
  }

  // ────────────── Match Request Creation ──────────────

  async createMatchRequest(
    user: User,
    soapId?: string,
    manualSpecialty?: DoctorSpecialtiesEnum,
  ): Promise<{ matchRequest: MatchRequest; doctors: ScoredDoctor[] }> {
    if (user.role !== UserRolesEnum.PATIENT) {
      throw new ForbiddenException('Only patients can request a match.');
    }

    let specialty: DoctorSpecialtiesEnum | undefined = manualSpecialty;
    let triageLevel: TriageLevelEnum | undefined;

    if (soapId) {
      const soap = await this.prisma.patientSOAP.findUnique({
        where: { id: soapId },
      });
      if (!soap) throw new NotFoundException('SOAP note not found.');
      if (soap.userId !== user.id) {
        throw new ForbiddenException('This SOAP note does not belong to you.');
      }
      specialty = specialty ?? soap.suggestedSpecialty ?? undefined;
      triageLevel = soap.triageLevel ?? undefined;
    }

    // Atomic check-then-create to prevent duplicate active match requests
    let matchRequest: MatchRequest;
    try {
      matchRequest = await this.prisma.$transaction(async (tx) => {
        const activeRequest = await tx.matchRequest.findFirst({
          where: {
            patientId: user.id,
            status: { in: [MatchStatusEnum.SEARCHING, MatchStatusEnum.MATCHED] },
          },
        });
        if (activeRequest) {
          throw new BadRequestException(
            'You already have an active match request. Cancel it first or wait for it to resolve.',
          );
        }

        return tx.matchRequest.create({
          data: {
            patientId: user.id,
            soapId: soapId ?? null,
            specialty: specialty ?? null,
            triageLevel: triageLevel ?? null,
            status: MatchStatusEnum.SEARCHING,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException(
          'A match request was just created. Please wait for it to resolve.',
        );
      }
      throw error;
    }

    const doctors = await this.scoreDoctors({ specialty, triageLevel });

    this.logger.log(
      `Match request ${matchRequest.id} created by patient ${user.id}, found ${doctors.length} candidates`,
    );

    return { matchRequest, doctors };
  }

  // ────────────── Match a Doctor ──────────────

  async matchDoctor(
    matchRequestId: string,
    doctorId: number,
  ): Promise<MatchRequest> {
    const request = await this.getByIdRaw(matchRequestId);
    this.validateTransition(request.status, MatchStatusEnum.MATCHED);

    const { count } = await this.prisma.matchRequest.updateMany({
      where: { id: matchRequestId, status: request.status },
      data: {
        status: MatchStatusEnum.MATCHED,
        matchedDoctorId: doctorId,
      },
    });
    if (count === 0) {
      throw new ConflictException('Match request status changed concurrently.');
    }
    return this.prisma.matchRequest.findUniqueOrThrow({
      where: { id: matchRequestId },
    });
  }

  // ────────────── Doctor Accept ──────────────

  async acceptMatch(
    matchRequestId: string,
    user: User,
  ): Promise<{ matchRequest: MatchRequest; consultationId: string }> {
    if (user.role !== UserRolesEnum.DOCTOR) {
      throw new ForbiddenException('Only doctors can accept match requests.');
    }

    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.id },
    });
    if (!doctorProfile) {
      throw new NotFoundException('Doctor profile not found.');
    }

    const request = await this.getByIdRaw(matchRequestId);

    if (request.matchedDoctorId !== doctorProfile.id) {
      throw new ForbiddenException(
        'This match request is not assigned to you.',
      );
    }

    const [consultation, updated] = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.matchRequest.findUniqueOrThrow({
        where: { id: matchRequestId },
      });
      this.validateTransition(fresh.status, MatchStatusEnum.CONSULTATION_CREATED);

      const cons = await tx.consultation.create({
        data: {
          patientId: request.patientId,
          doctorId: doctorProfile.id,
          soapId: request.soapId ?? null,
          status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
        },
      });

      const upd = await tx.matchRequest.update({
        where: { id: matchRequestId },
        data: {
          status: MatchStatusEnum.CONSULTATION_CREATED,
          consultationId: cons.id,
          resolvedAt: new Date(),
        },
      });

      return [cons, upd];
    });

    this.logger.log(
      `Match ${matchRequestId} accepted by doctor ${doctorProfile.id}, consultation ${consultation.id} created`,
    );

    return { matchRequest: updated, consultationId: consultation.id };
  }

  // ────────────── Doctor Reject ──────────────

  async rejectMatch(
    matchRequestId: string,
    user: User,
  ): Promise<{ matchRequest: MatchRequest; nextDoctors: ScoredDoctor[] }> {
    if (user.role !== UserRolesEnum.DOCTOR) {
      throw new ForbiddenException('Only doctors can reject match requests.');
    }

    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.id },
    });
    if (!doctorProfile) {
      throw new NotFoundException('Doctor profile not found.');
    }

    const request = await this.getByIdRaw(matchRequestId);

    if (request.matchedDoctorId !== doctorProfile.id) {
      throw new ForbiddenException(
        'This match request is not assigned to you.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.matchRequest.findUniqueOrThrow({
        where: { id: matchRequestId },
      });
      this.validateTransition(fresh.status, MatchStatusEnum.SEARCHING);

      await tx.matchRejection.create({
        data: {
          matchRequestId,
          doctorId: doctorProfile.id,
        },
      });

      return tx.matchRequest.update({
        where: { id: matchRequestId },
        data: {
          status: MatchStatusEnum.SEARCHING,
          matchedDoctorId: null,
        },
      });
    });

    const previouslyRejected = await this.getRejectedDoctorIds(matchRequestId, doctorProfile.id);

    const nextDoctors = await this.scoreDoctors({
      specialty: request.specialty ?? undefined,
      triageLevel: request.triageLevel ?? undefined,
      excludeDoctorIds: previouslyRejected,
    });

    this.logger.log(
      `Match ${matchRequestId} rejected by doctor ${doctorProfile.id}, re-queued with ${nextDoctors.length} candidates`,
    );

    return { matchRequest: updated, nextDoctors };
  }

  // ────────────── Timeout ──────────────

  async timeoutRequest(matchRequestId: string): Promise<MatchRequest> {
    const request = await this.getByIdRaw(matchRequestId);

    if (
      request.status !== MatchStatusEnum.SEARCHING &&
      request.status !== MatchStatusEnum.MATCHED
    ) {
      return request;
    }

    await this.prisma.matchRequest.updateMany({
      where: {
        id: matchRequestId,
        status: { in: [MatchStatusEnum.SEARCHING, MatchStatusEnum.MATCHED] },
      },
      data: {
        status: MatchStatusEnum.TIMEOUT,
        resolvedAt: new Date(),
      },
    });
    return this.prisma.matchRequest.findUniqueOrThrow({
      where: { id: matchRequestId },
    });
  }

  // ────────────── Cancel ──────────────

  async cancelRequest(matchRequestId: string, user: User): Promise<MatchRequest> {
    const request = await this.getByIdRaw(matchRequestId);

    if (request.patientId !== user.id && !user.isAdmin && !user.isSuperAdmin) {
      throw new ForbiddenException('You can only cancel your own match requests.');
    }

    this.validateTransition(request.status, MatchStatusEnum.CANCELLED);

    const { count } = await this.prisma.matchRequest.updateMany({
      where: { id: matchRequestId, status: request.status },
      data: {
        status: MatchStatusEnum.CANCELLED,
        resolvedAt: new Date(),
      },
    });
    if (count === 0) {
      throw new ConflictException('Match request status changed concurrently.');
    }
    return this.prisma.matchRequest.findUniqueOrThrow({
      where: { id: matchRequestId },
    });
  }

  // ────────────── Manual Browse Fallback ──────────────

  async fallbackToManualBrowse(matchRequestId: string, user: User): Promise<MatchRequest> {
    const request = await this.getByIdRaw(matchRequestId);

    if (request.patientId !== user.id && !user.isAdmin && !user.isSuperAdmin) {
      throw new ForbiddenException('You can only modify your own match requests.');
    }

    this.validateTransition(request.status, MatchStatusEnum.MANUAL_BROWSE);

    const { count } = await this.prisma.matchRequest.updateMany({
      where: { id: matchRequestId, status: request.status },
      data: {
        status: MatchStatusEnum.MANUAL_BROWSE,
        resolvedAt: new Date(),
      },
    });
    if (count === 0) {
      throw new ConflictException('Match request status changed concurrently.');
    }
    return this.prisma.matchRequest.findUniqueOrThrow({
      where: { id: matchRequestId },
    });
  }

  // ────────────── Queries ──────────────

  async getStatus(matchRequestId: string, user: User): Promise<MatchRequest> {
    const request = await this.prisma.matchRequest.findUnique({
      where: { id: matchRequestId },
      include: {
        matchedDoctor: {
          include: {
            user: {
              select: { id: true, firstname: true, lastname: true, avatar: true },
            },
          },
        },
        soap: {
          select: { id: true, suggestedSpecialty: true, triageLevel: true },
        },
      },
    });
    if (!request) throw new NotFoundException('Match request not found.');

    if (
      request.patientId !== user.id &&
      !user.isAdmin &&
      !user.isSuperAdmin
    ) {
      const doctorProfile = await this.prisma.doctorProfile.findUnique({
        where: { userId: user.id },
      });
      if (!doctorProfile || request.matchedDoctorId !== doctorProfile.id) {
        throw new ForbiddenException('You do not have access to this match request.');
      }
    }

    // Auto-timeout expired requests that are still in a searching/matched state
    if (
      (request.status === MatchStatusEnum.SEARCHING ||
        request.status === MatchStatusEnum.MATCHED) &&
      this.isExpired(request)
    ) {
      await this.prisma.matchRequest.updateMany({
        where: {
          id: matchRequestId,
          status: { in: [MatchStatusEnum.SEARCHING, MatchStatusEnum.MATCHED] },
        },
        data: {
          status: MatchStatusEnum.TIMEOUT,
          resolvedAt: new Date(),
        },
      });
      return this.prisma.matchRequest.findUniqueOrThrow({
        where: { id: matchRequestId },
        include: {
          matchedDoctor: {
            include: {
              user: {
                select: { id: true, firstname: true, lastname: true, avatar: true },
              },
            },
          },
          soap: {
            select: { id: true, suggestedSpecialty: true, triageLevel: true },
          },
        },
      });
    }

    return request;
  }

  async getActiveForPatient(userId: string): Promise<MatchRequest | null> {
    return this.prisma.matchRequest.findFirst({
      where: {
        patientId: userId,
        status: { in: [MatchStatusEnum.SEARCHING, MatchStatusEnum.MATCHED] },
      },
      include: {
        matchedDoctor: {
          include: {
            user: {
              select: { id: true, firstname: true, lastname: true, avatar: true },
            },
          },
        },
      },
    });
  }

  async getPendingForDoctor(user: User): Promise<MatchRequest[]> {
    if (user.role !== UserRolesEnum.DOCTOR) {
      throw new ForbiddenException('Only doctors can view pending matches.');
    }

    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.id },
    });
    if (!doctorProfile) {
      throw new NotFoundException('Doctor profile not found.');
    }

    return this.prisma.matchRequest.findMany({
      where: {
        matchedDoctorId: doctorProfile.id,
        status: MatchStatusEnum.MATCHED,
      },
      include: {
        patient: {
          select: { id: true, firstname: true, lastname: true, avatar: true },
        },
        soap: {
          select: {
            id: true,
            subjective: true,
            assessment: true,
            suggestedSpecialty: true,
            triageLevel: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  isExpired(request: MatchRequest): boolean {
    const created = request.createdAt instanceof Date
      ? request.createdAt.getTime()
      : new Date(request.createdAt).getTime();
    return Date.now() - created > this.MATCH_TIMEOUT_MS;
  }

  // ────────────── Internal Helpers ──────────────

  private async getByIdRaw(id: string): Promise<MatchRequest> {
    const request = await this.prisma.matchRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException('Match request not found.');
    return request;
  }

  private async getRejectedDoctorIds(
    matchRequestId: string,
    currentRejectorId: number,
  ): Promise<number[]> {
    const rejections = await this.prisma.matchRejection.findMany({
      where: { matchRequestId },
      select: { doctorId: true },
    });
    const ids = rejections.map((r) => r.doctorId);
    if (!ids.includes(currentRejectorId)) {
      ids.push(currentRejectorId);
    }
    return ids;
  }

  async getDoctorUserId(doctorProfileId: number): Promise<string | null> {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { id: doctorProfileId },
      select: { userId: true },
    });
    return profile?.userId ?? null;
  }
}
