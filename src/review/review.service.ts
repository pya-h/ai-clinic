import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { ConsultationStatusEnum, DoctorReview, User, UserRolesEnum } from '@prisma/client';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { PaginationOptionsDto } from '../common/dtos/pagination-options.dto';
import { NotificationService } from '../notification/notification.service';

export interface AggregateRating {
  averageRating: number | null;
  totalReviews: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);
  private readonly CACHE_GROUP = 'ratings';
  private readonly CACHE_TTL = 600_000; // 10 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Create a review for a doctor.
   * Rules:
   *  1. Reviewer must be a PATIENT
   *  2. Reviewer must have a COMPLETED consultation with this doctor
   *  3. One review per patient per doctor (unique constraint)
   */
  async create(user: User, dto: CreateReviewDto): Promise<DoctorReview> {
    // 1. Role check
    if (user.role !== UserRolesEnum.PATIENT) {
      throw new ForbiddenException('Only patients can submit reviews.');
    }

    // 2. Doctor must exist and be verified
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { id: dto.doctorId },
    });
    if (!doctor || !doctor.verified) {
      throw new NotFoundException('Doctor not found.');
    }

    // 3. Must have a completed consultation with this doctor
    const completedConsultation = await this.prisma.consultation.findFirst({
      where: {
        patientId: user.id,
        doctorId: dto.doctorId,
        status: ConsultationStatusEnum.COMPLETED,
      },
    });
    if (!completedConsultation) {
      throw new BadRequestException(
        'You must have a completed consultation with this doctor before leaving a review.',
      );
    }

    // 4. Check uniqueness (also enforced at DB level)
    const existing = await this.prisma.doctorReview.findUnique({
      where: {
        reviewerId_doctorId: {
          reviewerId: user.id,
          doctorId: dto.doctorId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'You have already reviewed this doctor. You may update your existing review.',
      );
    }

    const review = await this.prisma.doctorReview.create({
      data: {
        reviewerId: user.id,
        doctorId: dto.doctorId,
        rating: dto.rating,
        title: dto.title,
        overview: dto.overview,
      },
    });

    // Invalidate cached rating for this doctor
    await this.invalidateRatingCache(dto.doctorId);

    this.notificationService
      .onNewReview(doctor.userId, `${user.firstname} ${user.lastname}`)
      .catch((e) => this.logger.error(`Notification failed: ${e.message}`));

    return review;
  }

  /**
   * Update own review.
   */
  async update(
    user: User,
    reviewId: number,
    dto: UpdateReviewDto,
  ): Promise<DoctorReview> {
    const review = await this.prisma.doctorReview.findUnique({
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException('Review not found.');
    }
    if (review.reviewerId !== user.id) {
      throw new ForbiddenException('You can only update your own review.');
    }

    const updated = await this.prisma.doctorReview.update({
      where: { id: reviewId },
      data: { ...dto },
    });

    await this.invalidateRatingCache(review.doctorId);

    return updated;
  }

  /**
   * Delete a review. Owner or admin can delete.
   */
  async delete(reviewId: number, user: User): Promise<void> {
    const review = await this.prisma.doctorReview.findUnique({
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException('Review not found.');
    }
    if (review.reviewerId !== user.id && !user.isAdmin && !user.isSuperAdmin) {
      throw new ForbiddenException(
        'You can only delete your own review.',
      );
    }

    await this.prisma.doctorReview.delete({ where: { id: reviewId } });
    await this.invalidateRatingCache(review.doctorId);
  }

  /**
   * List reviews for a doctor (public, paginated).
   */
  async listByDoctor(
    doctorId: number,
    pagination: PaginationOptionsDto,
  ): Promise<{ data: DoctorReview[]; total: number; skip: number; take: number }> {
    const skip = +(pagination.skip ?? 0);
    const take = +(pagination.take ?? 20);

    const where = { doctorId };

    const [data, total] = await Promise.all([
      this.prisma.doctorReview.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          reviewer: {
            select: { id: true, firstname: true, lastname: true, avatar: true },
          },
        },
      }),
      this.prisma.doctorReview.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  /**
   * List all reviews (admin only, paginated).
   */
  async listAll(
    pagination: PaginationOptionsDto,
  ): Promise<{ data: DoctorReview[]; total: number; skip: number; take: number }> {
    const skip = +(pagination.skip ?? 0);
    const take = +(pagination.take ?? 20);

    const [data, total] = await Promise.all([
      this.prisma.doctorReview.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          reviewer: {
            select: { id: true, firstname: true, lastname: true, avatar: true },
          },
          doctor: {
            select: { id: true, specialty: true, user: { select: { firstname: true, lastname: true } } },
          },
        },
      }),
      this.prisma.doctorReview.count(),
    ]);

    return { data, total, skip, take };
  }

  /**
   * Aggregate rating for a doctor — cached for 10 minutes.
   * Uses Prisma aggregate + groupBy to avoid loading all rows into memory.
   */
  async getAggregateRating(doctorId: number): Promise<AggregateRating> {
    // Check cache first
    const cached = await this.cacheService.get<AggregateRating>(
      this.CACHE_GROUP,
      String(doctorId),
    );
    if (cached) return cached;

    const [agg, groups] = await Promise.all([
      this.prisma.doctorReview.aggregate({
        where: { doctorId },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.doctorReview.groupBy({
        by: ['rating'],
        where: { doctorId },
        _count: { rating: true },
      }),
    ]);

    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0,
    };
    for (const g of groups) {
      if (g.rating >= 1 && g.rating <= 5) {
        distribution[g.rating as 1 | 2 | 3 | 4 | 5] = g._count.rating;
      }
    }

    const totalReviews = agg._count.rating;
    const averageRating = totalReviews > 0
      ? Math.round((agg._avg.rating ?? 0) * 10) / 10
      : null;

    const result: AggregateRating = { averageRating, totalReviews, distribution };

    // Cache the result
    await this.cacheService.set(
      this.CACHE_GROUP,
      String(doctorId),
      result,
      this.CACHE_TTL,
    );

    return result;
  }

  async getAggregateRatingsForDoctors(
    doctorIds: number[],
  ): Promise<Map<number, AggregateRating>> {
    const result = new Map<number, AggregateRating>();
    if (doctorIds.length === 0) return result;

    const uncachedIds: number[] = [];
    for (const id of doctorIds) {
      const cached = await this.cacheService.get<AggregateRating>(
        this.CACHE_GROUP,
        String(id),
      );
      if (cached) {
        result.set(id, cached);
      } else {
        uncachedIds.push(id);
      }
    }

    if (uncachedIds.length === 0) return result;

    const [aggs, groups] = await Promise.all([
      this.prisma.doctorReview.groupBy({
        by: ['doctorId'],
        where: { doctorId: { in: uncachedIds } },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.doctorReview.groupBy({
        by: ['doctorId', 'rating'],
        where: { doctorId: { in: uncachedIds } },
        _count: { rating: true },
      }),
    ]);

    for (const id of uncachedIds) {
      const agg = aggs.find((a) => a.doctorId === id);
      const docGroups = groups.filter((g) => g.doctorId === id);

      const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
        1: 0, 2: 0, 3: 0, 4: 0, 5: 0,
      };
      for (const g of docGroups) {
        if (g.rating >= 1 && g.rating <= 5) {
          distribution[g.rating as 1 | 2 | 3 | 4 | 5] = g._count.rating;
        }
      }

      const totalReviews = agg?._count.rating ?? 0;
      const averageRating =
        totalReviews > 0
          ? Math.round((agg?._avg.rating ?? 0) * 10) / 10
          : null;

      const data: AggregateRating = { averageRating, totalReviews, distribution };
      result.set(id, data);
      this.cacheService
        .set(this.CACHE_GROUP, String(id), data, this.CACHE_TTL)
        .catch(() => {});
    }

    return result;
  }

  /**
   * Invalidate cached rating for a doctor.
   */
  private async invalidateRatingCache(doctorId: number): Promise<void> {
    try {
      await this.cacheService.del(this.CACHE_GROUP, String(doctorId));
    } catch {
      // Cache miss is fine
    }
  }
}
