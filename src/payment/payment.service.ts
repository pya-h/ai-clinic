import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConsultationStatusEnum,
  Payment,
  PaymentStatusEnum,
  User,
} from '@prisma/client';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentFilterDto } from './dto/payment-filter.dto';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(user: User, dto: CreatePaymentDto): Promise<Payment> {
    if (dto.consultationId) {
      const existing = await this.prisma.payment.findUnique({
        where: { consultationId: dto.consultationId },
      });
      if (existing) {
        throw new ConflictException(
          'A payment already exists for this consultation.',
        );
      }

      const consultation = await this.prisma.consultation.findUnique({
        where: { id: dto.consultationId },
      });
      if (!consultation) {
        throw new NotFoundException('Consultation not found.');
      }
      if (consultation.patientId !== user.id) {
        throw new ForbiddenException(
          'You can only create payments for your own consultations.',
        );
      }
      if (consultation.status !== ConsultationStatusEnum.PENDING_PAYMENT) {
        throw new ConflictException(
          'Consultation must be in PENDING_PAYMENT status to create a payment.',
        );
      }
    }

    try {
      return await this.prisma.payment.create({
        data: {
          userId: user.id,
          amount: dto.amount,
          currency: dto.currency ?? 'USD',
          consultationId: dto.consultationId ?? null,
          method: dto.method ?? null,
          status: PaymentStatusEnum.PENDING,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'A payment already exists for this consultation.',
        );
      }
      throw error;
    }
  }

  async getById(id: number, user: User): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException('Payment not found.');
    }

    const isAdmin = user.isAdmin || user.isSuperAdmin;
    if (payment.userId !== user.id && !isAdmin) {
      throw new ForbiddenException('Access denied.');
    }

    return payment;
  }

  async getUserPayments(
    user: User,
    filters: PaymentFilterDto,
  ): Promise<{ data: Payment[]; total: number; skip: number; take: number }> {
    const skip = filters.skip ?? 0;
    const take = filters.take ?? 20;

    const where: Record<string, any> = { userId: user.id };
    if (filters.status) {
      where.status = filters.status;
    }

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  async confirmPayment(id: number, user: User): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException('Payment not found.');
    }

    const isAdmin = user.isAdmin || user.isSuperAdmin;
    if (payment.userId !== user.id && !isAdmin) {
      throw new ForbiddenException('Access denied.');
    }

    if (payment.status !== PaymentStatusEnum.PENDING) {
      throw new ConflictException(
        `Cannot confirm a payment with status ${payment.status}.`,
      );
    }

    this.logger.warn(
      `Stub: confirming payment ${id} without real provider integration.`,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id, status: PaymentStatusEnum.PENDING },
        data: {
          status: PaymentStatusEnum.COMPLETED,
          paidAt: new Date(),
        },
      });
      if (count === 0) {
        throw new ConflictException(
          `Cannot confirm a payment with status ${payment.status}.`,
        );
      }
      const paid = await tx.payment.findUniqueOrThrow({ where: { id } });

      if (payment.consultationId) {
        await tx.consultation.updateMany({
          where: {
            id: payment.consultationId,
            status: ConsultationStatusEnum.PENDING_PAYMENT,
          },
          data: { status: ConsultationStatusEnum.PAYMENT_CONFIRMED },
        });
      }

      return paid;
    });

    return updated;
  }
}
