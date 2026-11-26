import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatusEnum,
  ConsultationStatusEnum,
  NursePermissionEnum,
  PaymentStatusEnum,
  UserRolesEnum,
} from '@prisma/client';
import { CacheService } from './cache/cache.service';
import { BotpressService } from './ai-agents/botpress.service';
import { DoctorService } from './doctor/doctor.service';
import { AdminService } from './admin/admin.service';
import { PaymentService } from './payment/payment.service';
import { SchedulingService } from './scheduling/scheduling.service';
import { NurseService } from './nurse/nurse.service';
import { SubscribePushDto } from './notification/dto/subscribe-push.dto';
import { UserLoginDto } from './auth/dto/login.dto';
import { IntroduceDoctorDto } from './doctor/dto/introduce-doctor.dto';
import { createMockPrismaService } from '../test/helpers/mock-prisma.helper';

describe('Server audit bugfix regressions', () => {
  describe('DTO validation safety', () => {
    it('rejects SubscribePushDto when keys is omitted', async () => {
      const dto = plainToInstance(SubscribePushDto, {
        endpoint: 'https://push.example.com/sub/1',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'keys')).toBe(true);
    });

    it('does not throw when UserLoginDto receives a non-string email', async () => {
      const dto = plainToInstance(UserLoginDto, {
        email: 12345,
        password: 'Password123!',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'email')).toBe(true);
    });

    it('accepts IntroduceDoctorDto when visitMethods and visitTypes are omitted', async () => {
      const dto = plainToInstance(IntroduceDoctorDto, {
        startedAt: '2020-01-01',
        specialty: 'CARDIOLOGY',
        location: 'Tehran',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('CacheService TTL refresh and mset', () => {
    it('refreshes cacheManager TTL when get(..., updateDeadline=true) hits', async () => {
      const mockStore = {
        get: jest.fn().mockResolvedValue({ token: 'x' }),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn(),
        mset: jest.fn(),
        mdel: jest.fn(),
      };
      const cache = new CacheService(mockStore as any);
      cache.registerDelEvent('bp-ctx', jest.fn().mockResolvedValue(undefined));

      await cache.set('bp-ctx', 'u1', { token: 'x' }, 300_000);
      mockStore.set.mockClear();

      await cache.get('bp-ctx', 'u1', true);
      expect(mockStore.set).toHaveBeenCalledWith(
        'bp-ctx:u1',
        { token: 'x' },
        300_000,
      );
    });

    it('does not register delEvent expiry for mset without a positive ttl', async () => {
      const delCb = jest.fn().mockResolvedValue(undefined);
      const mockStore = {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        mset: jest.fn().mockResolvedValue([]),
        mdel: jest.fn().mockResolvedValue(true),
      };
      const cache = new CacheService(mockStore as any);
      cache.registerDelEvent('grp', delCb);

      await cache.mset('grp', [{ k: 'k1', v: 1 }]);
      await cache.checkFordelEvents();

      expect(delCb).not.toHaveBeenCalled();
    });
  });

  describe('BotpressService listener switching and cleanup', () => {
    it('disconnects the old listener when conversationId was switched before listen()', async () => {
      const oldListener = {
        status: 'connected',
        disconnect: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      };
      const newListener = {
        status: 'connected',
        disconnect: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      };
      const bpClient = {
        listenConversation: jest.fn().mockResolvedValue(newListener),
      };
      const ctx = {
        client: bpClient,
        // simulates startNew() having overwritten conversationId before stream() calls listen()
        conversationId: 'conv-2',
        listener: oldListener,
        listenerConversationId: 'conv-1',
      };
      const cache = {
        registerDelEvent: jest.fn(),
        get: jest.fn().mockResolvedValue(ctx),
        set: jest.fn(),
      };
      const config = {
        get: jest.fn((key: string) =>
          key === 'botpress.webhookId' ? 'wh-1' : 'sse',
        ),
      };
      const service = new BotpressService(
        config as any,
        createMockPrismaService() as any,
        cache as any,
      );

      const res = await service.listen({ id: 'u1' } as any, 'conv-2');
      expect(oldListener.disconnect).toHaveBeenCalledTimes(1);
      expect(bpClient.listenConversation).toHaveBeenCalledWith({
        id: 'conv-2',
      });
      expect(res.listener).toBe(newListener);

      // even if cache-manager already evicted ctx before TTL cron runs, cleanupUserContext still disconnects
      cache.get.mockResolvedValue(undefined);
      await service.cleanupUserContext('u1');
      expect(newListener.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('DoctorService banned doctor exclusion', () => {
    it('returns NotFoundException from findOne when doctor user is banned', async () => {
      const prisma = createMockPrismaService();
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 1,
        verified: true,
        user: {
          id: 'u1',
          firstname: 'Doc',
          lastname: 'Banned',
          avatar: null,
          isActive: true,
          isBanned: true,
        },
      });
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: null },
        _count: { rating: 0 },
      });

      const service = new DoctorService(prisma as any, {} as any);
      await expect(service.findOne(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('AdminService revenue number and boolean filters', () => {
    it('coerces Decimal-like totalRevenue to a JS number and handles isActive=1', async () => {
      const prisma = createMockPrismaService();
      prisma.user.count.mockResolvedValue(1);
      prisma.doctorProfile.count.mockResolvedValue(1);
      (prisma.patientProfile as any).count = jest.fn().mockResolvedValue(1);
      prisma.consultation.count.mockResolvedValue(1);
      prisma.appointment.count.mockResolvedValue(1);
      (prisma.payment as any).aggregate = jest.fn().mockResolvedValue({
        _sum: { amount: { toString: () => '250.50', valueOf: () => 250.5 } },
      });

      const service = new AdminService(prisma as any, {} as any, {} as any);
      const stats = await service.getPlatformStats();
      expect(typeof stats.totalRevenue).toBe('number');
      expect(stats.totalRevenue).toBe(250.5);

      prisma.user.findMany.mockResolvedValue([]);
      await service.listUsers({ isActive: '1', isBanned: 'FALSE' });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, isBanned: false },
        }),
      );
    });
  });

  describe('PaymentService cancelled consultation guard', () => {
    it('throws ConflictException when linked consultation was cancelled', async () => {
      const prisma = createMockPrismaService();
      prisma.payment.findUnique.mockResolvedValue({
        id: 1,
        userId: 'p1',
        status: PaymentStatusEnum.PENDING,
        consultationId: 'c1',
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        status: PaymentStatusEnum.COMPLETED,
      });
      prisma.consultation.updateMany.mockResolvedValue({ count: 0 });
      prisma.consultation.findUnique.mockResolvedValue({
        status: ConsultationStatusEnum.CANCELLED,
      });

      const service = new PaymentService(
        prisma as any,
        {
          onPaymentConfirmed: jest.fn(),
        } as any,
      );
      await expect(
        service.confirmPayment(1, { id: 'p1' } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('SchedulingService overlap and NO_SHOW guards', () => {
    it('rejects overlapping availability windows on the same day', async () => {
      const prisma = createMockPrismaService();
      prisma.doctorAvailability.findMany.mockResolvedValue([
        {
          id: 1,
          doctorId: 10,
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '12:00',
        },
      ]);
      const service = new SchedulingService(
        prisma as any,
        {} as any,
        {} as any,
      );

      await expect(
        service.setAvailability(10, {
          dayOfWeek: 1,
          startTime: '11:00',
          endTime: '14:00',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects cancelling a NO_SHOW appointment', async () => {
      const prisma = createMockPrismaService();
      prisma.appointment.findUnique.mockResolvedValue({
        id: 7,
        patientId: 'p1',
        doctorId: 10,
        status: AppointmentStatusEnum.NO_SHOW,
      });
      const service = new SchedulingService(
        prisma as any,
        {} as any,
        {} as any,
      );

      await expect(
        service.cancelAppointment(7, {
          id: 'p1',
          role: UserRolesEnum.PATIENT,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('NurseService dashboard permission scoping and banned invitees', () => {
    it('scopes dashboard counts to assignments with the corresponding permission', async () => {
      const prisma = createMockPrismaService();
      prisma.doctorNurseAssignment.findMany.mockResolvedValue([
        {
          id: 1,
          doctorId: 10,
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
        },
        {
          id: 2,
          doctorId: 20,
          permissions: [NursePermissionEnum.MANAGE_APPOINTMENTS],
        },
      ]);
      prisma.appointment.count.mockResolvedValue(4);
      prisma.consultation.count.mockResolvedValue(9);

      const service = new NurseService(prisma as any, {} as any);
      const dashboard = await service.getDashboard({ id: 'n1' } as any);

      expect(prisma.appointment.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ doctorId: { in: [20] } }),
        }),
      );
      expect(prisma.consultation.count).not.toHaveBeenCalled();
      expect(dashboard.stats).toEqual({
        upcomingAppointments: 4,
        activeConsultations: 0,
        assignedDoctors: 2,
      });
    });

    it('rejects inviting a banned user as a nurse', async () => {
      const prisma = createMockPrismaService();
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 10,
        verified: true,
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-banned',
        role: UserRolesEnum.PATIENT,
        isAdmin: false,
        isSuperAdmin: false,
        isBanned: true,
        isActive: true,
      });

      const service = new NurseService(prisma as any, {} as any);
      await expect(
        service.assignNurse({ id: 'doc-1' } as any, { nurseId: 'u-banned' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects accepting a match for an unverified doctor', async () => {
      const prisma = createMockPrismaService();
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 10,
        verified: false,
      });
      const { MatchingService } = await import('./matching/matching.service');
      const service = new MatchingService(prisma as any, {} as any, {} as any);

      await expect(
        service.acceptMatch('m1', {
          id: 'doc-1',
          role: UserRolesEnum.DOCTOR,
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
