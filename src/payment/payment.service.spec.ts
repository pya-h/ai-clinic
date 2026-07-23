import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatusEnum } from '@prisma/client';
import {
  buildUser,
  buildAdminUser,
  randomUuid,
} from '../../test/helpers/test-data.factory';

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: Record<string, any>;

  const mockUser = buildUser();
  const mockAdminUser = buildAdminUser();

  const mockPayment = {
    id: 1,
    userId: mockUser.id,
    consultationId: null as null,
    amount: 50.0,
    currency: 'USD',
    status: PaymentStatusEnum.PENDING,
    method: null as null,
    gatewayId: null as null,
    gatewayResponse: null as null,
    paidAt: null as null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockConsultation = {
    id: randomUuid(),
    patientId: mockUser.id,
    doctorId: 1,
    status: 'PENDING_PAYMENT',
  };

  beforeEach(async () => {
    prisma = {
      payment: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      consultation: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── create ───

  describe('create', () => {
    it('should create a payment without consultation', async () => {
      prisma.payment.create.mockResolvedValue(mockPayment);

      const result = await service.create(mockUser as any, {
        amount: 50.0,
      });

      expect(result).toEqual(mockPayment);
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockUser.id,
          amount: 50.0,
          currency: 'USD',
          status: PaymentStatusEnum.PENDING,
        }),
      });
    });

    it('should create a payment linked to a consultation', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.consultation.findUnique.mockResolvedValue(mockConsultation);
      prisma.payment.create.mockResolvedValue({
        ...mockPayment,
        consultationId: mockConsultation.id,
      });

      const result = await service.create(mockUser as any, {
        amount: 50.0,
        consultationId: mockConsultation.id,
      });

      expect(result.consultationId).toBe(mockConsultation.id);
    });

    it('should throw ConflictException if payment already exists for consultation', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      await expect(
        service.create(mockUser as any, {
          amount: 50.0,
          consultationId: randomUuid(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if consultation does not exist', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.consultation.findUnique.mockResolvedValue(null);

      await expect(
        service.create(mockUser as any, {
          amount: 50.0,
          consultationId: randomUuid(),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if consultation belongs to another user', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.consultation.findUnique.mockResolvedValue({
        ...mockConsultation,
        patientId: randomUuid(),
      });

      await expect(
        service.create(mockUser as any, {
          amount: 50.0,
          consultationId: mockConsultation.id,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should use provided currency and method', async () => {
      prisma.payment.create.mockResolvedValue({
        ...mockPayment,
        currency: 'EUR',
        method: 'card',
      });

      await service.create(mockUser as any, {
        amount: 50.0,
        currency: 'EUR',
        method: 'card',
      });

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          currency: 'EUR',
          method: 'card',
        }),
      });
    });
  });

  // ─── getById ───

  describe('getById', () => {
    it('should return payment for the owner', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const result = await service.getById(1, mockUser as any);
      expect(result).toEqual(mockPayment);
    });

    it('should allow admin to access any payment', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const result = await service.getById(1, mockAdminUser as any);
      expect(result).toEqual(mockPayment);
    });

    it('should throw NotFoundException if payment not found', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.getById(999, mockUser as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if non-owner non-admin requests', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const otherUser = { ...buildUser(), id: randomUuid() };
      await expect(
        service.getById(1, otherUser as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── getUserPayments ───

  describe('getUserPayments', () => {
    it('should return paginated payments for user', async () => {
      prisma.payment.findMany.mockResolvedValue([mockPayment]);
      prisma.payment.count.mockResolvedValue(1);

      const result = await service.getUserPayments(mockUser as any, {
        skip: 0,
        take: 20,
      });

      expect(result).toEqual({
        data: [mockPayment],
        total: 1,
        skip: 0,
        take: 20,
      });
    });

    it('should use default pagination when values are missing', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.count.mockResolvedValue(0);

      const result = await service.getUserPayments(mockUser as any, {} as any);
      expect(result).toEqual({ data: [], total: 0, skip: 0, take: 20 });
    });

    it('should filter by status', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.count.mockResolvedValue(0);

      await service.getUserPayments(mockUser as any, {
        status: PaymentStatusEnum.COMPLETED,
      });

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: mockUser.id, status: PaymentStatusEnum.COMPLETED },
        }),
      );
    });
  });

  // ─── confirmPayment ───

  describe('confirmPayment', () => {
    it('should confirm a pending payment', async () => {
      const confirmed = {
        ...mockPayment,
        status: PaymentStatusEnum.COMPLETED,
        paidAt: new Date(),
      };
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(confirmed);

      const result = await service.confirmPayment(1, mockUser as any);

      expect(result.status).toBe(PaymentStatusEnum.COMPLETED);
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: PaymentStatusEnum.PENDING },
        data: {
          status: PaymentStatusEnum.COMPLETED,
          paidAt: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException if payment not found', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmPayment(999, mockUser as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if non-owner non-admin confirms', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const otherUser = { ...buildUser(), id: randomUuid() };
      await expect(
        service.confirmPayment(1, otherUser as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException if payment is not PENDING', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatusEnum.COMPLETED,
      });

      await expect(
        service.confirmPayment(1, mockUser as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow admin to confirm any payment', async () => {
      const confirmed = {
        ...mockPayment,
        status: PaymentStatusEnum.COMPLETED,
        paidAt: new Date(),
      };
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(confirmed);

      const result = await service.confirmPayment(1, mockAdminUser as any);
      expect(result.status).toBe(PaymentStatusEnum.COMPLETED);
    });
  });
});
