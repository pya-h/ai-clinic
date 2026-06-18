import { Test, TestingModule } from '@nestjs/testing';
import { ReviewService, AggregateRating } from './review.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { NotificationService } from '../notification/notification.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRolesEnum } from '@prisma/client';
import {
  buildUser,
  buildDoctorUser,
  buildAdminUser,
  randomUuid,
} from '../../test/helpers/test-data.factory';

describe('ReviewService', () => {
  let service: ReviewService;
  let prisma: Record<string, any>;
  let cache: Record<string, jest.Mock>;

  const mockPatientUser = buildUser();

  const mockDoctorUser = buildDoctorUser();

  const mockAdminUser = buildAdminUser();

  const mockDoctorProfile = {
    id: Math.floor(Math.random() * 1000) + 1,
    userId: mockDoctorUser.id,
    verified: true,
  };

  const mockReview = {
    id: Math.floor(Math.random() * 1000) + 1,
    reviewerId: mockPatientUser.id,
    doctorId: mockDoctorProfile.id,
    rating: 4,
    title: 'Great doctor',
    overview: 'Very professional and caring.',
    verified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockConsultation = {
    id: randomUuid(),
    patientId: mockPatientUser.id,
    doctorId: mockDoctorProfile.id,
    status: 'COMPLETED',
  };

  beforeEach(async () => {
    prisma = {
      doctorProfile: {
        findUnique: jest.fn(),
      },
      doctorReview: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
        groupBy: jest.fn(),
      },
      consultation: {
        findFirst: jest.fn(),
      },
    };

    cache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        {
          provide: NotificationService,
          useValue: { onNewReview: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<ReviewService>(ReviewService);
  });

  // ─── create ───

  describe('create', () => {
    it('should create a review successfully', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.consultation.findFirst.mockResolvedValue(mockConsultation);
      prisma.doctorReview.findUnique.mockResolvedValue(null);
      prisma.doctorReview.create.mockResolvedValue(mockReview);

      const result = await service.create(mockPatientUser as any, {
        doctorId: mockDoctorProfile.id,
        rating: 4,
        title: 'Great doctor',
        overview: 'Very professional and caring.',
      });

      expect(result).toEqual(mockReview);
      expect(prisma.doctorReview.create).toHaveBeenCalledWith({
        data: {
          reviewerId: mockPatientUser.id,
          doctorId: mockDoctorProfile.id,
          rating: 4,
          title: 'Great doctor',
          overview: 'Very professional and caring.',
        },
      });
      expect(cache.del).toHaveBeenCalledWith('ratings', String(mockDoctorProfile.id));
    });

    it('should throw ForbiddenException if user is not a PATIENT', async () => {
      await expect(
        service.create(mockDoctorUser as any, {
          doctorId: mockDoctorProfile.id,
          rating: 5,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if doctor does not exist', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.create(mockPatientUser as any, {
          doctorId: 999,
          rating: 5,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if doctor is not verified', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        ...mockDoctorProfile,
        verified: false,
      });

      await expect(
        service.create(mockPatientUser as any, {
          doctorId: mockDoctorProfile.id,
          rating: 5,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if no completed consultation', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.consultation.findFirst.mockResolvedValue(null);

      await expect(
        service.create(mockPatientUser as any, {
          doctorId: mockDoctorProfile.id,
          rating: 5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if review already exists', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctorProfile);
      prisma.consultation.findFirst.mockResolvedValue(mockConsultation);
      prisma.doctorReview.findUnique.mockResolvedValue(mockReview);

      await expect(
        service.create(mockPatientUser as any, {
          doctorId: mockDoctorProfile.id,
          rating: 5,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── update ───

  describe('update', () => {
    it('should update own review', async () => {
      const updated = { ...mockReview, rating: 5 };
      prisma.doctorReview.findUnique.mockResolvedValue(mockReview);
      prisma.doctorReview.update.mockResolvedValue(updated);

      const result = await service.update(mockPatientUser as any, mockReview.id, {
        rating: 5,
      });

      expect(result.rating).toBe(5);
      expect(cache.del).toHaveBeenCalledWith('ratings', String(mockDoctorProfile.id));
    });

    it('should throw NotFoundException if review not found', async () => {
      prisma.doctorReview.findUnique.mockResolvedValue(null);

      await expect(
        service.update(mockPatientUser as any, 999, { rating: 3 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if not the owner', async () => {
      prisma.doctorReview.findUnique.mockResolvedValue({
        ...mockReview,
        reviewerId: randomUuid(),
      });

      await expect(
        service.update(mockPatientUser as any, mockReview.id, { rating: 3 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── delete ───

  describe('delete', () => {
    it('should delete own review', async () => {
      prisma.doctorReview.findUnique.mockResolvedValue(mockReview);
      prisma.doctorReview.delete.mockResolvedValue(mockReview);

      await service.delete(mockReview.id, mockPatientUser as any);

      expect(prisma.doctorReview.delete).toHaveBeenCalledWith({
        where: { id: mockReview.id },
      });
      expect(cache.del).toHaveBeenCalledWith('ratings', String(mockDoctorProfile.id));
    });

    it('should allow admin to delete any review', async () => {
      prisma.doctorReview.findUnique.mockResolvedValue(mockReview);
      prisma.doctorReview.delete.mockResolvedValue(mockReview);

      await service.delete(mockReview.id, mockAdminUser as any);

      expect(prisma.doctorReview.delete).toHaveBeenCalledWith({
        where: { id: mockReview.id },
      });
    });

    it('should throw NotFoundException if review not found', async () => {
      prisma.doctorReview.findUnique.mockResolvedValue(null);

      await expect(
        service.delete(999, mockPatientUser as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if not owner and not admin', async () => {
      prisma.doctorReview.findUnique.mockResolvedValue(mockReview);

      const otherUser = {
        ...mockPatientUser,
        id: randomUuid(),
        isAdmin: false,
      };

      await expect(
        service.delete(mockReview.id, otherUser as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── listByDoctor ───

  describe('listByDoctor', () => {
    it('should return paginated reviews for a doctor', async () => {
      prisma.doctorReview.findMany.mockResolvedValue([mockReview]);
      prisma.doctorReview.count.mockResolvedValue(1);

      const result = await service.listByDoctor(mockDoctorProfile.id, { skip: 0, take: 20 });

      expect(result).toEqual({
        data: [mockReview],
        total: 1,
        skip: 0,
        take: 20,
      });
      expect(prisma.doctorReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { doctorId: mockDoctorProfile.id },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should use default pagination when values are missing', async () => {
      prisma.doctorReview.findMany.mockResolvedValue([]);
      prisma.doctorReview.count.mockResolvedValue(0);

      const result = await service.listByDoctor(mockDoctorProfile.id, {} as any);
      expect(result).toEqual({ data: [], total: 0, skip: 0, take: 20 });
    });
  });

  // ─── getAggregateRating ───

  describe('getAggregateRating', () => {
    it('should return cached rating if available', async () => {
      const cached: AggregateRating = {
        averageRating: 4.2,
        totalReviews: 5,
        distribution: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 2 },
      };
      cache.get.mockResolvedValue(cached);

      const result = await service.getAggregateRating(mockDoctorProfile.id);
      expect(result).toEqual(cached);
      expect(prisma.doctorReview.aggregate).not.toHaveBeenCalled();
    });

    it('should compute and cache rating when not cached', async () => {
      cache.get.mockResolvedValue(null);
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: 4.2 },
        _count: { rating: 5 },
      });
      prisma.doctorReview.groupBy.mockResolvedValue([
        { rating: 3, _count: { rating: 1 } },
        { rating: 4, _count: { rating: 2 } },
        { rating: 5, _count: { rating: 2 } },
      ]);

      const result = await service.getAggregateRating(mockDoctorProfile.id);

      expect(result.averageRating).toBe(4.2);
      expect(result.totalReviews).toBe(5);
      expect(result.distribution).toEqual({
        1: 0,
        2: 0,
        3: 1,
        4: 2,
        5: 2,
      });
      expect(cache.set).toHaveBeenCalledWith(
        'ratings',
        String(mockDoctorProfile.id),
        result,
        600_000,
      );
    });

    it('should return null averageRating when no reviews exist', async () => {
      cache.get.mockResolvedValue(null);
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: null },
        _count: { rating: 0 },
      });
      prisma.doctorReview.groupBy.mockResolvedValue([]);

      const result = await service.getAggregateRating(mockDoctorProfile.id);

      expect(result.averageRating).toBeNull();
      expect(result.totalReviews).toBe(0);
      expect(result.distribution).toEqual({
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      });
    });

    it('should round averageRating to 1 decimal place', async () => {
      cache.get.mockResolvedValue(null);
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: 4.0 },
        _count: { rating: 3 },
      });
      prisma.doctorReview.groupBy.mockResolvedValue([
        { rating: 3, _count: { rating: 1 } },
        { rating: 4, _count: { rating: 1 } },
        { rating: 5, _count: { rating: 1 } },
      ]);

      const result = await service.getAggregateRating(mockDoctorProfile.id);
      expect(result.averageRating).toBe(4); // (5+4+3)/3 = 4.0
    });
  });
});
