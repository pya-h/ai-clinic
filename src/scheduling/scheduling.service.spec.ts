import { Test, TestingModule } from '@nestjs/testing';
import { SchedulingService } from './scheduling.service';
import { PrismaService } from '../prisma/prisma.service';
import { CalendlyService } from '../calendly/calendly.service';
import { NurseService } from '../nurse/nurse.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/helpers/mock-prisma.helper';
import {
  createMockUser,
  createMockDoctorUser,
  createMockAdminUser,
} from '../../test/helpers/mock-session.helper';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatusEnum } from '@prisma/client';

const mockCalendlyService = {
  scheduleForAppointment: jest.fn().mockResolvedValue(undefined),
  cancelCalendlyEvent: jest.fn().mockResolvedValue(undefined),
  isConfigured: jest.fn().mockReturnValue(false),
};

const mockNurseService = {
  assignNurse: jest.fn(),
  updatePermissions: jest.fn(),
  removeAssignment: jest.fn(),
  getMyAssignments: jest.fn(),
  getAssignment: jest.fn(),
  getNursePermissionForDoctor: jest.fn(),
  assertNursePermission: jest.fn(),
  getDoctorIdsForNurse: jest.fn(),
};

describe('SchedulingService', () => {
  let service: SchedulingService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulingService,
        { provide: PrismaService, useValue: prisma },
        { provide: CalendlyService, useValue: mockCalendlyService },
        { provide: NurseService, useValue: mockNurseService },
      ],
    }).compile();

    service = module.get<SchedulingService>(SchedulingService);
  });

  // ──────────────── getDoctorProfileId ────────────────

  describe('getDoctorProfileId', () => {
    it('should return doctor ID when profile exists', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({ id: 42 });
      const result = await service.getDoctorProfileId('user-id');
      expect(result).toBe(42);
    });

    it('should throw NotFoundException when profile not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);
      await expect(service.getDoctorProfileId('user-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ──────────────── Availability CRUD ────────────────

  describe('setAvailability', () => {
    it('should create an availability slot', async () => {
      const dto = { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' };
      const created = { id: 1, doctorId: 42, ...dto, isActive: true };
      prisma.doctorAvailability.create.mockResolvedValue(created);

      const result = await service.setAvailability(42, dto);
      expect(result).toEqual(created);
      expect(prisma.doctorAvailability.create).toHaveBeenCalledWith({
        data: { doctorId: 42, ...dto, isActive: true },
      });
    });

    it('should throw BadRequestException if startTime >= endTime', async () => {
      const dto = { dayOfWeek: 1, startTime: '17:00', endTime: '09:00' };
      await expect(service.setAvailability(42, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException on duplicate', async () => {
      const dto = { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' };
      prisma.doctorAvailability.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.setAvailability(42, dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('getAvailability', () => {
    it('should return availability sorted by day and time', async () => {
      const items = [
        { id: 1, dayOfWeek: 0, startTime: '08:00' },
        { id: 2, dayOfWeek: 1, startTime: '09:00' },
      ];
      prisma.doctorAvailability.findMany.mockResolvedValue(items);

      const result = await service.getAvailability(42);
      expect(result).toEqual(items);
      expect(prisma.doctorAvailability.findMany).toHaveBeenCalledWith({
        where: { doctorId: 42 },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });
  });

  describe('updateAvailability', () => {
    const existing = {
      id: 1,
      doctorId: 42,
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '17:00',
      isActive: true,
    };

    it('should update an availability slot', async () => {
      prisma.doctorAvailability.findUnique.mockResolvedValue(existing);
      prisma.doctorAvailability.update.mockResolvedValue({
        ...existing,
        endTime: '18:00',
      });

      const result = await service.updateAvailability(1, 42, {
        endTime: '18:00',
      });
      expect(result.endTime).toBe('18:00');
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.doctorAvailability.findUnique.mockResolvedValue(null);
      await expect(
        service.updateAvailability(99, 42, { endTime: '18:00' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if not owner', async () => {
      prisma.doctorAvailability.findUnique.mockResolvedValue({
        ...existing,
        doctorId: 999,
      });
      await expect(
        service.updateAvailability(1, 42, { endTime: '18:00' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if times become invalid', async () => {
      prisma.doctorAvailability.findUnique.mockResolvedValue(existing);
      await expect(
        service.updateAvailability(1, 42, { startTime: '20:00' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteAvailability', () => {
    it('should delete an availability slot', async () => {
      prisma.doctorAvailability.findUnique.mockResolvedValue({
        id: 1,
        doctorId: 42,
      });
      prisma.doctorAvailability.delete.mockResolvedValue(undefined);

      await service.deleteAvailability(1, 42);
      expect(prisma.doctorAvailability.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.doctorAvailability.findUnique.mockResolvedValue(null);
      await expect(service.deleteAvailability(99, 42)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if not owner', async () => {
      prisma.doctorAvailability.findUnique.mockResolvedValue({
        id: 1,
        doctorId: 999,
      });
      await expect(service.deleteAvailability(1, 42)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ──────────────── Slot Durations ────────────────

  describe('setSlotDuration', () => {
    it('should create a slot duration', async () => {
      const dto = { minutes: 30, price: 50 };
      const created = {
        id: 1,
        doctorId: 42,
        ...dto,
        label: null as null,
        isActive: true,
      };
      prisma.slotDuration.create.mockResolvedValue(created);

      const result = await service.setSlotDuration(42, dto);
      expect(result).toEqual(created);
    });

    it('should throw ConflictException on duplicate', async () => {
      prisma.slotDuration.create.mockRejectedValue({ code: 'P2002' });
      await expect(
        service.setSlotDuration(42, { minutes: 30, price: 50 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getSlotDurations', () => {
    it('should return slot durations sorted by minutes', async () => {
      const items = [
        { id: 1, minutes: 15 },
        { id: 2, minutes: 30 },
      ];
      prisma.slotDuration.findMany.mockResolvedValue(items);

      const result = await service.getSlotDurations(42);
      expect(result).toEqual(items);
      expect(prisma.slotDuration.findMany).toHaveBeenCalledWith({
        where: { doctorId: 42 },
        orderBy: { minutes: 'asc' },
      });
    });
  });

  // ──────────────── Exceptions ────────────────

  describe('addException', () => {
    it('should create an exception', async () => {
      const dto = { date: '2026-03-15', isBlocked: true, reason: 'Vacation' };
      const created = {
        id: 1,
        doctorId: 42,
        date: new Date('2026-03-15'),
        isBlocked: true,
        startTime: null as null,
        endTime: null as null,
        reason: 'Vacation',
      };
      prisma.availabilityException.create.mockResolvedValue(created);

      const result = await service.addException(42, dto);
      expect(result).toEqual(created);
    });

    it('should throw ConflictException on duplicate date', async () => {
      prisma.availabilityException.create.mockRejectedValue({ code: 'P2002' });
      await expect(
        service.addException(42, { date: '2026-03-15' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getExceptions', () => {
    it('should return exceptions with date filter', async () => {
      prisma.availabilityException.findMany.mockResolvedValue([]);
      const from = new Date('2026-03-01');
      const to = new Date('2026-03-31');

      await service.getExceptions(42, from, to);
      expect(prisma.availabilityException.findMany).toHaveBeenCalledWith({
        where: { doctorId: 42, date: { gte: from, lte: to } },
        orderBy: { date: 'asc' },
      });
    });

    it('should return all exceptions without date filter', async () => {
      prisma.availabilityException.findMany.mockResolvedValue([]);
      await service.getExceptions(42);
      expect(prisma.availabilityException.findMany).toHaveBeenCalledWith({
        where: { doctorId: 42 },
        orderBy: { date: 'asc' },
      });
    });
  });

  describe('deleteException', () => {
    it('should delete an exception', async () => {
      prisma.availabilityException.findUnique.mockResolvedValue({
        id: 1,
        doctorId: 42,
      });
      prisma.availabilityException.delete.mockResolvedValue(undefined);

      await service.deleteException(1, 42);
      expect(prisma.availabilityException.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.availabilityException.findUnique.mockResolvedValue(null);
      await expect(service.deleteException(99, 42)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if not owner', async () => {
      prisma.availabilityException.findUnique.mockResolvedValue({
        id: 1,
        doctorId: 999,
      });
      await expect(service.deleteException(1, 42)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ──────────────── Available Slots Computation ────────────────

  describe('getAvailableSlots', () => {
    const mockDoctor = { id: 42, verified: true };

    beforeEach(() => {
      prisma.doctorProfile.findUnique.mockResolvedValue(mockDoctor);
      // The dates below are in March 2026; past days have no slots.
      jest.useFakeTimers({
        now: new Date('2026-03-01T00:00:00.000Z'),
        doNotFake: ['nextTick', 'setImmediate'],
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    describe('around today', () => {
      // 2026-03-09 Mon … 2026-03-12 Thu, open 09:00-12:00 every day, hourly slots.
      beforeEach(() => {
        prisma.doctorAvailability.findMany.mockResolvedValue(
          [1, 2, 3, 4].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: '09:00',
            endTime: '12:00',
            isActive: true,
          })),
        );
        prisma.slotDuration.findMany.mockResolvedValue([
          { minutes: 60, isActive: true },
        ]);
        prisma.availabilityException.findMany.mockResolvedValue([]);
        prisma.appointment.findMany.mockResolvedValue([]);
      });

      it('should list no slots for days before today, nor started ones today', async () => {
        jest.setSystemTime(new Date('2026-03-11T10:15:00.000Z'));

        const result = await service.getAvailableSlots(
          42,
          new Date('2026-03-09'),
          new Date('2026-03-12'),
        );

        expect(result.map((s) => `${s.date} ${s.startTime}`)).toEqual([
          '2026-03-11 11:00',
          '2026-03-12 09:00',
          '2026-03-12 10:00',
          '2026-03-12 11:00',
        ]);
      });

      it('should list nothing for a range entirely in the past', async () => {
        jest.setSystemTime(
          new Date(Date.UTC(2026, 2, 13, Math.floor(Math.random() * 24))),
        );

        expect(
          await service.getAvailableSlots(
            42,
            new Date('2026-03-09'),
            new Date('2026-03-12'),
          ),
        ).toEqual([]);
      });
    });

    it('should throw NotFoundException for unverified doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 42,
        verified: false,
      });

      await expect(
        service.getAvailableSlots(
          42,
          new Date('2026-03-10'),
          new Date('2026-03-10'),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return empty when no availability set', async () => {
      prisma.doctorAvailability.findMany.mockResolvedValue([]);

      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );
      expect(result).toEqual([]);
    });

    it('should return empty when no slot durations set', async () => {
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([]);

      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );
      expect(result).toEqual([]);
    });

    it('should generate slots for a single day', async () => {
      // 2026-03-10 is a Tuesday (dayOfWeek = 2)
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 2, startTime: '09:00', endTime: '11:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { minutes: 30, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([]);
      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );

      expect(result).toEqual([
        {
          date: '2026-03-10',
          startTime: '09:00',
          endTime: '09:30',
          durationMinutes: 30,
        },
        {
          date: '2026-03-10',
          startTime: '09:30',
          endTime: '10:00',
          durationMinutes: 30,
        },
        {
          date: '2026-03-10',
          startTime: '10:00',
          endTime: '10:30',
          durationMinutes: 30,
        },
        {
          date: '2026-03-10',
          startTime: '10:30',
          endTime: '11:00',
          durationMinutes: 30,
        },
      ]);
    });

    it('should exclude slots overlapping with existing appointments', async () => {
      // Tuesday
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 2, startTime: '09:00', endTime: '11:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { minutes: 30, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([]);

      // Existing appointment at 09:30-10:00
      prisma.appointment.findMany.mockResolvedValue([
        {
          dateTime: new Date('2026-03-10T09:30:00.000Z'),
          durationMinutes: 30,
          status: AppointmentStatusEnum.CONFIRMED,
        },
      ]);

      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );

      const startTimes = result.map((s) => s.startTime);
      expect(startTimes).toContain('09:00');
      expect(startTimes).not.toContain('09:30');
      expect(startTimes).toContain('10:00');
      expect(startTimes).toContain('10:30');
    });

    it('should skip blocked exception days', async () => {
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { minutes: 60, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([
        {
          date: new Date('2026-03-10'),
          isBlocked: true,
          doctorId: 42,
        },
      ]);
      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );
      expect(result).toEqual([]);
    });

    it('should use partial-day exception override', async () => {
      // Tuesday blocked except 10:00-12:00
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { minutes: 60, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([
        {
          date: new Date('2026-03-10'),
          isBlocked: false,
          startTime: '10:00',
          endTime: '12:00',
          doctorId: 42,
        },
      ]);
      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );

      expect(result).toEqual([
        {
          date: '2026-03-10',
          startTime: '10:00',
          endTime: '11:00',
          durationMinutes: 60,
        },
        {
          date: '2026-03-10',
          startTime: '11:00',
          endTime: '12:00',
          durationMinutes: 60,
        },
      ]);
    });

    it('should generate slots across multiple days', async () => {
      // Mon and Tue
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', isActive: true },
        { dayOfWeek: 2, startTime: '09:00', endTime: '10:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { minutes: 60, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([]);
      prisma.appointment.findMany.mockResolvedValue([]);

      // 2026-03-09 = Monday, 2026-03-10 = Tuesday
      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-09'),
        new Date('2026-03-10'),
      );

      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2026-03-09');
      expect(result[1].date).toBe('2026-03-10');
    });

    it('should filter by duration when specified', async () => {
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 2, startTime: '09:00', endTime: '11:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { minutes: 30, isActive: true },
        { minutes: 60, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([]);
      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-10'),
        new Date('2026-03-10'),
        60, // Only 60-minute slots
      );

      expect(result.every((s) => s.durationMinutes === 60)).toBe(true);
      expect(result).toHaveLength(2); // 09:00-10:00, 10:00-11:00
    });

    it('should subtract appointments booked later on the last day of the range', async () => {
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { minutes: 30, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([]);
      const bookedHour = 9 + Math.floor(Math.random() * 8);
      const booked = `${String(bookedHour).padStart(2, '0')}:00`;
      prisma.appointment.findMany.mockResolvedValue([
        {
          dateTime: new Date(`2026-03-10T${booked}:00.000Z`),
          durationMinutes: 30,
          status: AppointmentStatusEnum.CONFIRMED,
        },
      ]);

      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );

      expect(result).toHaveLength(15);
      expect(result.map((s) => s.startTime)).not.toContain(booked);
      expect(prisma.appointment.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          doctorId: 42,
          dateTime: {
            gte: new Date('2026-03-10T00:00:00.000Z'),
            lt: new Date('2026-03-11T00:00:00.000Z'),
          },
        }),
      });
      expect(prisma.availabilityException.findMany).toHaveBeenCalledWith({
        where: {
          doctorId: 42,
          date: {
            gte: new Date('2026-03-10T00:00:00.000Z'),
            lt: new Date('2026-03-11T00:00:00.000Z'),
          },
        },
      });
    });

    describe('with a mid-day start (e.g. matching passes "now")', () => {
      // A random time on 2026-03-10 (a Tuesday) after midnight UTC.
      const midDay = () => {
        const minutes = 1 + Math.floor(Math.random() * (24 * 60 - 2));
        return new Date(Date.UTC(2026, 2, 10, 0, minutes));
      };

      beforeEach(() => {
        prisma.doctorAvailability.findMany.mockResolvedValue([
          {
            dayOfWeek: 2,
            startTime: '09:00',
            endTime: '17:00',
            isActive: true,
          },
        ]);
        prisma.slotDuration.findMany.mockResolvedValue([
          { minutes: 60, isActive: true },
        ]);
        prisma.appointment.findMany.mockResolvedValue([]);
      });

      it("should still apply that day's blocking exception, stored at midnight", async () => {
        const start = midDay();
        prisma.availabilityException.findMany.mockImplementation(
          async ({ where }: any) =>
            where.date.gte <= new Date('2026-03-10T00:00:00.000Z')
              ? [
                  {
                    date: new Date('2026-03-10'),
                    isBlocked: true,
                    doctorId: 42,
                  },
                ]
              : [],
        );

        expect(await service.getAvailableSlots(42, start, start)).toEqual([]);
      });

      it("should still apply that day's partial override", async () => {
        const start = midDay();
        prisma.availabilityException.findMany.mockImplementation(
          async ({ where }: any) =>
            where.date.gte <= new Date('2026-03-10T00:00:00.000Z')
              ? [
                  {
                    date: new Date('2026-03-10'),
                    isBlocked: false,
                    startTime: '13:00',
                    endTime: '15:00',
                    doctorId: 42,
                  },
                ]
              : [],
        );

        const result = await service.getAvailableSlots(42, start, start);

        expect(result.map((s) => s.startTime)).toEqual(['13:00', '14:00']);
      });
    });

    it('should treat time-bearing bounds as whole UTC days', async () => {
      // 2026-03-10 = Tuesday, 2026-03-11 = Wednesday
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 2, startTime: '09:00', endTime: '10:00', isActive: true },
        { dayOfWeek: 3, startTime: '09:00', endTime: '10:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { minutes: 60, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([]);
      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-10T15:00:00.000Z'),
        new Date('2026-03-11T08:00:00.000Z'),
      );

      expect(result.map((s) => s.date)).toEqual(['2026-03-10', '2026-03-11']);
      expect(prisma.availabilityException.findMany).toHaveBeenCalledWith({
        where: {
          doctorId: 42,
          date: {
            gte: new Date('2026-03-10T00:00:00.000Z'),
            lt: new Date('2026-03-12T00:00:00.000Z'),
          },
        },
      });
    });

    it('should not subtract appointments of the day after the range', async () => {
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 2, startTime: '09:00', endTime: '10:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { minutes: 30, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([]);
      // The real query excludes it; this guards the per-day grouping.
      prisma.appointment.findMany.mockResolvedValue([
        {
          dateTime: new Date('2026-03-11T09:00:00.000Z'),
          durationMinutes: 30,
          status: AppointmentStatusEnum.CONFIRMED,
        },
      ]);

      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );

      expect(result.map((s) => s.startTime)).toEqual(['09:00', '09:30']);
    });

    it('should not include cancelled appointments as blockers', async () => {
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 2, startTime: '09:00', endTime: '10:00', isActive: true },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { minutes: 30, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([]);
      prisma.appointment.findMany.mockResolvedValue([]); // cancelled excluded by query

      const result = await service.getAvailableSlots(
        42,
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );
      expect(result).toHaveLength(2);
    });
  });

  describe('countAvailableSlotsForDoctors', () => {
    const doctorA = Math.floor(Math.random() * 1000) + 1;
    const doctorB = doctorA + 1;

    it('should return an empty map without querying when no doctors are given', async () => {
      const result = await service.countAvailableSlotsForDoctors(
        [],
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );

      expect(result.size).toBe(0);
      expect(prisma.doctorAvailability.findMany).not.toHaveBeenCalled();
    });

    it('should subtract appointments booked later on the last day of the range', async () => {
      // 2026-03-10 = Tuesday
      prisma.doctorAvailability.findMany.mockResolvedValue([
        {
          doctorId: doctorA,
          dayOfWeek: 2,
          startTime: '09:00',
          endTime: '12:00',
          isActive: true,
        },
        {
          doctorId: doctorB,
          dayOfWeek: 2,
          startTime: '09:00',
          endTime: '12:00',
          isActive: true,
        },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { doctorId: doctorA, minutes: 60, isActive: true },
        { doctorId: doctorB, minutes: 60, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([]);
      prisma.appointment.findMany.mockResolvedValue([
        {
          doctorId: doctorA,
          dateTime: new Date('2026-03-10T10:00:00.000Z'),
          durationMinutes: 60,
          status: AppointmentStatusEnum.CONFIRMED,
        },
      ]);

      const result = await service.countAvailableSlotsForDoctors(
        [doctorA, doctorB],
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );

      expect(result.get(doctorA)).toBe(2);
      expect(result.get(doctorB)).toBe(3);
      expect(prisma.appointment.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          doctorId: { in: [doctorA, doctorB] },
          dateTime: {
            gte: new Date('2026-03-10T00:00:00.000Z'),
            lt: new Date('2026-03-11T00:00:00.000Z'),
          },
        }),
      });
    });

    it('should honour a blocked exception on the first day when the range starts mid-day', async () => {
      prisma.doctorAvailability.findMany.mockResolvedValue([
        {
          doctorId: doctorA,
          dayOfWeek: 2,
          startTime: '09:00',
          endTime: '11:00',
          isActive: true,
        },
        {
          doctorId: doctorA,
          dayOfWeek: 3,
          startTime: '09:00',
          endTime: '11:00',
          isActive: true,
        },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([
        { doctorId: doctorA, minutes: 60, isActive: true },
      ]);
      prisma.availabilityException.findMany.mockResolvedValue([
        {
          doctorId: doctorA,
          date: new Date('2026-03-10T00:00:00.000Z'),
          isBlocked: true,
        },
      ]);
      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.countAvailableSlotsForDoctors(
        [doctorA],
        new Date('2026-03-10T13:45:00.000Z'),
        new Date('2026-03-11T13:45:00.000Z'),
      );

      expect(result.get(doctorA)).toBe(2);
      expect(prisma.availabilityException.findMany).toHaveBeenCalledWith({
        where: {
          doctorId: { in: [doctorA] },
          date: {
            gte: new Date('2026-03-10T00:00:00.000Z'),
            lt: new Date('2026-03-12T00:00:00.000Z'),
          },
        },
      });
    });

    it('should not count slots of today that have already started', async () => {
      jest.useFakeTimers({
        now: new Date('2026-03-10T10:15:00.000Z'),
        doNotFake: ['nextTick', 'setImmediate'],
      });
      try {
        prisma.doctorAvailability.findMany.mockResolvedValue([
          {
            doctorId: doctorA,
            dayOfWeek: 2,
            startTime: '09:00',
            endTime: '13:00',
            isActive: true,
          },
        ]);
        prisma.slotDuration.findMany.mockResolvedValue([
          { doctorId: doctorA, minutes: 60, isActive: true },
        ]);
        prisma.availabilityException.findMany.mockResolvedValue([]);
        prisma.appointment.findMany.mockResolvedValue([]);

        const result = await service.countAvailableSlotsForDoctors(
          [doctorA],
          new Date(),
          new Date(),
        );

        // 09:00 and 10:00 already started; 11:00 and 12:00 remain
        expect(result.get(doctorA)).toBe(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should report zero for doctors without availability or durations', async () => {
      prisma.doctorAvailability.findMany.mockResolvedValue([
        {
          doctorId: doctorA,
          dayOfWeek: 2,
          startTime: '09:00',
          endTime: '11:00',
          isActive: true,
        },
      ]);
      prisma.slotDuration.findMany.mockResolvedValue([]);
      prisma.availabilityException.findMany.mockResolvedValue([]);
      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.countAvailableSlotsForDoctors(
        [doctorA, doctorB],
        new Date('2026-03-10'),
        new Date('2026-03-10'),
      );

      expect(result.get(doctorA)).toBe(0);
      expect(result.get(doctorB)).toBe(0);
    });
  });

  // ──────────────── Appointment Booking ────────────────

  describe('bookAppointment', () => {
    const patient = createMockUser();
    const tomorrow10am = new Date();
    tomorrow10am.setUTCDate(tomorrow10am.getUTCDate() + 1);
    tomorrow10am.setUTCHours(10, 0, 0, 0);
    const bookDto = {
      doctorId: 42,
      dateTime: tomorrow10am.toISOString(),
      durationMinutes: 30,
      price: 50,
      method: 'CHAT' as any,
    };

    beforeEach(() => {
      prisma.slotDuration.findFirst.mockResolvedValue({ price: 50 });
      prisma.appointment.findMany.mockResolvedValue([]); // no overlap
      prisma.availabilityException.findFirst.mockResolvedValue(null);
      prisma.doctorAvailability.findMany.mockResolvedValue([
        { startTime: '00:00', endTime: '23:59', isActive: true },
      ]);
    });

    it('should book an appointment', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 42,
        verified: true,
        visitMethods: ['CHAT'],
      });
      const created = {
        id: 1,
        ...bookDto,
        patientId: patient.id,
        status: 'PENDING',
      };
      prisma.appointment.create.mockResolvedValue(created);

      const result = await service.bookAppointment(patient as any, bookDto);
      expect(result).toEqual(created);
      expect(prisma.appointment.create).toHaveBeenCalled();
    });

    it('should throw ForbiddenException if not a patient', async () => {
      const doctor = createMockDoctorUser();
      await expect(
        service.bookAppointment(doctor as any, bookDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if doctor not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.bookAppointment(patient as any, bookDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if doctor not verified', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 42,
        verified: false,
      });
      await expect(
        service.bookAppointment(patient as any, bookDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should validate consultation ownership when consultationId provided', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 42,
        verified: true,
        visitMethods: ['CHAT'],
      });
      prisma.consultation.findUnique.mockResolvedValue({
        id: 'cons-1',
        patientId: 'other-user',
        doctorId: 42,
      });

      await expect(
        service.bookAppointment(patient as any, {
          ...bookDto,
          consultationId: 'cons-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if consultation doctor mismatch', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 42,
        verified: true,
        visitMethods: ['CHAT'],
      });
      prisma.consultation.findUnique.mockResolvedValue({
        id: 'cons-1',
        patientId: patient.id,
        doctorId: 999, // different doctor
      });

      await expect(
        service.bookAppointment(patient as any, {
          ...bookDto,
          consultationId: 'cons-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when doctor does not support method', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 42,
        verified: true,
        visitMethods: ['VOICE_CALL'],
      });

      await expect(
        service.bookAppointment(patient as any, bookDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when slot duration is not configured', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        id: 42,
        verified: true,
        visitMethods: ['CHAT'],
      });
      prisma.slotDuration.findFirst.mockResolvedValue(null);

      await expect(
        service.bookAppointment(patient as any, bookDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────── Get Appointment ────────────────

  describe('getAppointment', () => {
    it('should return appointment for owner', async () => {
      const patient = createMockUser();
      const apt = { id: 1, patientId: patient.id, doctorId: 42 };
      prisma.appointment.findUnique.mockResolvedValue(apt);

      const result = await service.getAppointment(1, patient as any);
      expect(result).toEqual(apt);
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.appointment.findUnique.mockResolvedValue(null);
      const patient = createMockUser();
      await expect(service.getAppointment(99, patient as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for non-owner patient', async () => {
      const patient = createMockUser();
      const apt = { id: 1, patientId: 'other-user', doctorId: 42 };
      prisma.appointment.findUnique.mockResolvedValue(apt);

      await expect(service.getAppointment(1, patient as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow admin access', async () => {
      const admin = createMockAdminUser();
      const apt = { id: 1, patientId: 'some-patient', doctorId: 42 };
      prisma.appointment.findUnique.mockResolvedValue(apt);

      const result = await service.getAppointment(1, admin as any);
      expect(result).toEqual(apt);
    });
  });

  // ──────────────── Get My Appointments ────────────────

  describe('getMyAppointments', () => {
    it('should list patient own appointments', async () => {
      const patient = createMockUser();
      const items = [{ id: 1 }];
      prisma.appointment.findMany.mockResolvedValue(items);
      prisma.appointment.count.mockResolvedValue(1);

      const result = await service.getMyAppointments(patient as any, {});
      expect(result.data).toEqual(items);
      expect(result.total).toBe(1);
    });

    it('should list doctor own appointments', async () => {
      const doctor = createMockDoctorUser();
      prisma.doctorProfile.findUnique.mockResolvedValue({ id: 42 });
      prisma.appointment.findMany.mockResolvedValue([]);
      prisma.appointment.count.mockResolvedValue(0);

      const result = await service.getMyAppointments(doctor as any, {});
      expect(result.data).toEqual([]);
    });

    it('should allow admin to see all', async () => {
      const admin = createMockAdminUser();
      prisma.appointment.findMany.mockResolvedValue([]);
      prisma.appointment.count.mockResolvedValue(0);

      const result = await service.getMyAppointments(admin as any, {});
      expect(result.data).toEqual([]);
    });

    it('should filter by status and date range', async () => {
      const patient = createMockUser();
      prisma.appointment.findMany.mockResolvedValue([]);
      prisma.appointment.count.mockResolvedValue(0);

      await service.getMyAppointments(patient as any, {
        status: AppointmentStatusEnum.PENDING,
        from: '2026-03-01',
        to: '2026-03-31',
      });

      expect(prisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patientId: patient.id,
            status: AppointmentStatusEnum.PENDING,
            dateTime: {
              gte: expect.any(Date),
              lte: expect.any(Date),
            },
          }),
        }),
      );
    });
  });

  // ──────────────── Cancel Appointment ────────────────

  describe('cancelAppointment', () => {
    const patient = createMockUser();

    it('should cancel a pending appointment', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        patientId: patient.id,
        doctorId: 42,
        status: AppointmentStatusEnum.PENDING,
      });
      prisma.appointment.updateMany.mockResolvedValue({ count: 1 });
      prisma.appointment.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        status: AppointmentStatusEnum.CANCELLED,
      });

      const result = await service.cancelAppointment(1, patient as any);
      expect(result.status).toBe(AppointmentStatusEnum.CANCELLED);
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.appointment.findUnique.mockResolvedValue(null);
      await expect(
        service.cancelAppointment(99, patient as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if already cancelled', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        patientId: patient.id,
        doctorId: 42,
        status: AppointmentStatusEnum.CANCELLED,
      });
      await expect(
        service.cancelAppointment(1, patient as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if already completed', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        patientId: patient.id,
        doctorId: 42,
        status: AppointmentStatusEnum.COMPLETED,
      });
      await expect(
        service.cancelAppointment(1, patient as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException for non-owner', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 1,
        patientId: 'other-patient',
        doctorId: 42,
        status: AppointmentStatusEnum.PENDING,
      });
      await expect(
        service.cancelAppointment(1, patient as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ──────────────── Helper Methods ────────────────

  describe('timeToMinutes / minutesToTime', () => {
    it('should convert time string to minutes', () => {
      expect(service.timeToMinutes('00:00')).toBe(0);
      expect(service.timeToMinutes('09:30')).toBe(570);
      expect(service.timeToMinutes('23:59')).toBe(1439);
    });

    it('should convert minutes to time string', () => {
      expect(service.minutesToTime(0)).toBe('00:00');
      expect(service.minutesToTime(570)).toBe('09:30');
      expect(service.minutesToTime(1439)).toBe('23:59');
    });
  });
});
