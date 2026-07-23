import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Appointment,
  AppointmentStatusEnum,
  DoctorAvailability,
  AvailabilityException,
  Prisma,
  SlotDuration,
  User,
  UserRolesEnum,
} from '@prisma/client';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { CreateSlotDurationDto } from './dto/create-slot-duration.dto';
import { CreateExceptionDto } from './dto/create-exception.dto';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import { AppointmentFilterDto } from './dto/appointment-filter.dto';
import { CalendlyService } from '../calendly/calendly.service';
import { NurseService } from '../nurse/nurse.service';
import { NursePermissionEnum } from '@prisma/client';

export interface AvailableSlot {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  durationMinutes: number;
}

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendlyService: CalendlyService,
    private readonly nurseService: NurseService,
  ) {}

  // ──────────────── Doctor ID Lookup ────────────────

  async getDoctorProfileId(userId: string): Promise<number> {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Doctor profile not found.');
    }
    return profile.id;
  }

  async resolveDoctorIdForSchedule(
    user: User,
    targetDoctorId?: number,
  ): Promise<number> {
    if (user.role === UserRolesEnum.DOCTOR) {
      return this.getDoctorProfileId(user.id);
    }
    if (user.role === UserRolesEnum.NURSE) {
      const doctorIds = await this.nurseService.getDoctorIdsForNurse(
        user.id,
        NursePermissionEnum.MANAGE_SCHEDULE,
      );
      if (doctorIds.length === 0) {
        throw new ForbiddenException(
          'You do not have the Manage Schedule permission for any doctor.',
        );
      }
      if (targetDoctorId !== undefined) {
        if (!doctorIds.includes(targetDoctorId)) {
          throw new ForbiddenException(
            'You do not have the Manage Schedule permission for this doctor.',
          );
        }
        return targetDoctorId;
      }
      return doctorIds[0];
    }
    throw new ForbiddenException('Only doctors and nurses can manage schedules.');
  }

  // ──────────────── Availability CRUD ────────────────

  async setAvailability(
    doctorId: number,
    dto: CreateAvailabilityDto,
  ): Promise<DoctorAvailability> {
    if (dto.startTime >= dto.endTime) {
      throw new BadRequestException('startTime must be before endTime.');
    }

    try {
      return await this.prisma.doctorAvailability.create({
        data: {
          doctorId,
          dayOfWeek: dto.dayOfWeek,
          startTime: dto.startTime,
          endTime: dto.endTime,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Availability already exists for this day and start time.',
        );
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Doctor profile not found.');
      }
      throw error;
    }
  }

  async getAvailability(doctorId: number): Promise<DoctorAvailability[]> {
    return this.prisma.doctorAvailability.findMany({
      where: { doctorId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async updateAvailability(
    id: number,
    doctorId: number,
    dto: UpdateAvailabilityDto,
  ): Promise<DoctorAvailability> {
    const existing = await this.prisma.doctorAvailability.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Availability slot not found.');
    }
    if (existing.doctorId !== doctorId) {
      throw new ForbiddenException(
        'You do not own this availability slot.',
      );
    }

    const startTime = dto.startTime ?? existing.startTime;
    const endTime = dto.endTime ?? existing.endTime;
    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime.');
    }

    return this.prisma.doctorAvailability.update({
      where: { id },
      data: {
        ...(dto.dayOfWeek !== undefined && { dayOfWeek: dto.dayOfWeek }),
        ...(dto.startTime !== undefined && { startTime: dto.startTime }),
        ...(dto.endTime !== undefined && { endTime: dto.endTime }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteAvailability(id: number, doctorId: number): Promise<void> {
    const existing = await this.prisma.doctorAvailability.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Availability slot not found.');
    }
    if (existing.doctorId !== doctorId) {
      throw new ForbiddenException(
        'You do not own this availability slot.',
      );
    }

    await this.prisma.doctorAvailability.delete({ where: { id } });
  }

  // ──────────────── Slot Durations ────────────────

  async setSlotDuration(
    doctorId: number,
    dto: CreateSlotDurationDto,
  ): Promise<SlotDuration> {
    try {
      return await this.prisma.slotDuration.create({
        data: {
          doctorId,
          minutes: dto.minutes,
          price: dto.price,
          label: dto.label ?? null,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'A slot duration with this length already exists.',
        );
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Doctor profile not found.');
      }
      throw error;
    }
  }

  async getSlotDurations(doctorId: number): Promise<SlotDuration[]> {
    return this.prisma.slotDuration.findMany({
      where: { doctorId },
      orderBy: { minutes: 'asc' },
    });
  }

  // ──────────────── Exceptions ────────────────

  async addException(
    doctorId: number,
    dto: CreateExceptionDto,
  ): Promise<AvailabilityException> {
    if (dto.isBlocked === false) {
      if (!dto.startTime || !dto.endTime) {
        throw new BadRequestException(
          'Both startTime and endTime are required for partial-day exceptions.',
        );
      }
      if (dto.startTime >= dto.endTime) {
        throw new BadRequestException(
          'startTime must be before endTime for partial-day exceptions.',
        );
      }
    }

    try {
      const normalizedDate = new Date(dto.date);
      normalizedDate.setUTCHours(0, 0, 0, 0);

      return await this.prisma.availabilityException.create({
        data: {
          doctorId,
          date: normalizedDate,
          isBlocked: dto.isBlocked ?? true,
          startTime: dto.startTime ?? null,
          endTime: dto.endTime ?? null,
          reason: dto.reason ?? null,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'An exception already exists for this date.',
        );
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Doctor profile not found.');
      }
      throw error;
    }
  }

  async getExceptions(
    doctorId: number,
    from?: Date,
    to?: Date,
  ): Promise<AvailabilityException[]> {
    const where: any = { doctorId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to) where.date.lte = to;
    }
    return this.prisma.availabilityException.findMany({
      where,
      orderBy: { date: 'asc' },
    });
  }

  async deleteException(id: number, doctorId: number): Promise<void> {
    const existing = await this.prisma.availabilityException.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Exception not found.');
    }
    if (existing.doctorId !== doctorId) {
      throw new ForbiddenException('You do not own this exception.');
    }

    await this.prisma.availabilityException.delete({ where: { id } });
  }

  // ──────────────── Available Slots Computation ────────────────

  async getAvailableSlots(
    doctorId: number,
    startDate: Date,
    endDate: Date,
    durationFilter?: number,
  ): Promise<AvailableSlot[]> {
    // Validate doctor exists
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { id: doctorId },
    });
    if (!doctor || !doctor.verified) {
      throw new NotFoundException('Doctor not found or not verified.');
    }

    // 1. Get doctor's weekly availability (active only)
    const availability = await this.prisma.doctorAvailability.findMany({
      where: { doctorId, isActive: true },
    });
    if (availability.length === 0) {
      return [];
    }

    // Build a lookup: dayOfWeek -> [{ startTime, endTime }]
    const weeklySchedule = new Map<
      number,
      { startTime: string; endTime: string }[]
    >();
    for (const slot of availability) {
      const existing = weeklySchedule.get(slot.dayOfWeek) ?? [];
      existing.push({ startTime: slot.startTime, endTime: slot.endTime });
      weeklySchedule.set(slot.dayOfWeek, existing);
    }

    // 2. Get slot durations (active only)
    let durations = await this.prisma.slotDuration.findMany({
      where: { doctorId, isActive: true },
    });
    if (durations.length === 0) {
      return [];
    }
    if (durationFilter) {
      durations = durations.filter((d) => d.minutes === durationFilter);
      if (durations.length === 0) {
        return [];
      }
    }

    // 3. Get exceptions in date range
    const exceptions = await this.prisma.availabilityException.findMany({
      where: {
        doctorId,
        date: { gte: startDate, lte: endDate },
      },
    });
    const exceptionMap = new Map<string, AvailabilityException>();
    for (const ex of exceptions) {
      exceptionMap.set(this.dateToString(ex.date), ex);
    }

    // 4. Get existing appointments in date range
    const appointments = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        dateTime: { gte: startDate, lte: endDate },
        status: { notIn: [AppointmentStatusEnum.CANCELLED, AppointmentStatusEnum.NO_SHOW] },
      },
    });

    // Build appointment lookup: dateString -> [{ start minutes, end minutes }]
    const appointmentMap = new Map<
      string,
      { startMin: number; endMin: number }[]
    >();
    for (const apt of appointments) {
      const dateStr = this.dateToString(apt.dateTime);
      const startMin =
        apt.dateTime.getUTCHours() * 60 + apt.dateTime.getUTCMinutes();
      const endMin = startMin + apt.durationMinutes;
      const existing = appointmentMap.get(dateStr) ?? [];
      existing.push({ startMin, endMin });
      appointmentMap.set(dateStr, existing);
    }

    // 5. For each day in range, generate available slots
    const slots: AvailableSlot[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const dateStr = this.dateToString(current);
      const dayOfWeek = current.getUTCDay(); // 0 = Sun

      const exception = exceptionMap.get(dateStr);

      if (exception?.isBlocked) {
        // Full day blocked
        current.setUTCDate(current.getUTCDate() + 1);
        continue;
      }

      // Get time windows for this day
      let timeWindows: { startTime: string; endTime: string }[];

      if (exception && !exception.isBlocked && exception.startTime && exception.endTime) {
        // Partial override: use exception's times instead of regular schedule
        timeWindows = [
          { startTime: exception.startTime, endTime: exception.endTime },
        ];
      } else {
        timeWindows = weeklySchedule.get(dayOfWeek) ?? [];
      }

      if (timeWindows.length === 0) {
        current.setUTCDate(current.getUTCDate() + 1);
        continue;
      }

      const dayAppointments = appointmentMap.get(dateStr) ?? [];

      for (const window of timeWindows) {
        const windowStart = this.timeToMinutes(window.startTime);
        const windowEnd = this.timeToMinutes(window.endTime);

        for (const duration of durations) {
          let slotStart = windowStart;

          while (slotStart + duration.minutes <= windowEnd) {
            const slotEnd = slotStart + duration.minutes;

            // Check overlap with existing appointments
            const overlaps = dayAppointments.some(
              (apt) => slotStart < apt.endMin && slotEnd > apt.startMin,
            );

            if (!overlaps) {
              slots.push({
                date: dateStr,
                startTime: this.minutesToTime(slotStart),
                endTime: this.minutesToTime(slotEnd),
                durationMinutes: duration.minutes,
              });
            }

            slotStart += duration.minutes;
          }
        }
      }

      current.setUTCDate(current.getUTCDate() + 1);
    }

    return slots;
  }

  // ──────────────── Appointments ────────────────

  async bookAppointment(
    user: User,
    dto: BookAppointmentDto,
  ): Promise<Appointment> {
    if (user.role !== UserRolesEnum.PATIENT) {
      throw new ForbiddenException('Only patients can book appointments.');
    }

    // Validate doctor exists and is verified
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { id: dto.doctorId },
    });
    if (!doctor || !doctor.verified) {
      throw new NotFoundException('Doctor not found or not verified.');
    }

    if (
      Array.isArray(doctor.visitMethods) &&
      !doctor.visitMethods.includes(dto.method)
    ) {
      throw new BadRequestException(
        'Selected visit method is not available for this doctor.',
      );
    }

    const slotDuration = await this.prisma.slotDuration.findFirst({
      where: {
        doctorId: dto.doctorId,
        minutes: dto.durationMinutes,
        isActive: true,
      },
      select: { price: true },
    });
    if (!slotDuration) {
      throw new BadRequestException(
        'Invalid duration: doctor has no active slot configuration for this duration.',
      );
    }

    // Validate booking is not in the past
    const bookingDateTime = new Date(dto.dateTime);
    if (bookingDateTime < new Date()) {
      throw new BadRequestException('Cannot book an appointment in the past.');
    }

    // Overlap check + create in a serializable transaction to prevent double-booking
    const bookingEndTime = new Date(bookingDateTime.getTime() + dto.durationMinutes * 60000);
    let appointment: Appointment;

    try {
      appointment = await this.prisma.$transaction(async (tx) => {
        const candidates = await tx.appointment.findMany({
          where: {
            doctorId: dto.doctorId,
            status: { notIn: [AppointmentStatusEnum.CANCELLED, AppointmentStatusEnum.NO_SHOW] },
            dateTime: { lt: bookingEndTime },
          },
          select: { dateTime: true, durationMinutes: true },
        });
        const hasOverlap = candidates.some((apt) => {
          const aptEnd = new Date(apt.dateTime.getTime() + apt.durationMinutes * 60000);
          return aptEnd > bookingDateTime;
        });
        if (hasOverlap) {
          throw new ConflictException('This time slot is no longer available.');
        }

        if (dto.consultationId) {
          const consultation = await tx.consultation.findUnique({
            where: { id: dto.consultationId },
          });
          if (!consultation) {
            throw new NotFoundException('Consultation not found.');
          }
          if (consultation.patientId !== user.id) {
            throw new ForbiddenException(
              'This consultation does not belong to you.',
            );
          }
          if (consultation.doctorId !== dto.doctorId) {
            throw new BadRequestException(
              'Consultation doctor does not match the provided doctorId.',
            );
          }
        }

        return tx.appointment.create({
          data: {
            patientId: user.id,
            doctorId: dto.doctorId,
            consultationId: dto.consultationId ?? null,
            dateTime: new Date(dto.dateTime),
            durationMinutes: dto.durationMinutes,
            price: slotDuration.price,
            method: dto.method,
            notes: dto.notes ?? null,
            status: AppointmentStatusEnum.PENDING,
          },
          include: this.appointmentInclude(),
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('This time slot was just booked. Please try another.');
      }
      throw error;
    }

    this.logger.log(
      `Appointment ${appointment.id} booked by patient ${user.id} with doctor ${dto.doctorId}`,
    );

    this.calendlyService.scheduleForAppointment(appointment.id).catch((err) => {
      this.logger.error(`Failed to create Calendly event for appointment ${appointment.id}:`, err);
    });

    return appointment;
  }

  async getAppointment(id: number, user: User): Promise<Appointment> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: this.appointmentInclude(),
    });
    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }

    await this.assertAppointmentAccess(appointment, user);

    return appointment;
  }

  async getMyAppointments(
    user: User,
    filters: AppointmentFilterDto,
  ): Promise<{
    data: Appointment[];
    total: number;
    skip: number;
    take: number;
  }> {
    const skip = +(filters.skip ?? 0);
    const take = +(filters.take ?? 20);

    const where: any = {};

    // Role-based filter
    if (user.isAdmin || user.isSuperAdmin) {
      // Admins see all
    } else if (user.role === UserRolesEnum.PATIENT) {
      where.patientId = user.id;
    } else if (user.role === UserRolesEnum.DOCTOR) {
      const doctorId = await this.getDoctorProfileId(user.id);
      where.doctorId = doctorId;
    } else if (user.role === UserRolesEnum.NURSE) {
      const doctorIds = await this.nurseService.getDoctorIdsForNurse(
        user.id,
        NursePermissionEnum.MANAGE_APPOINTMENTS,
      );
      if (doctorIds.length === 0) {
        return { data: [], total: 0, skip, take };
      }
      where.doctorId = { in: doctorIds };
    } else {
      throw new ForbiddenException('You do not have access to appointments.');
    }

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.from || filters.to) {
      where.dateTime = {};
      if (filters.from) where.dateTime.gte = new Date(filters.from);
      if (filters.to) where.dateTime.lte = new Date(filters.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        skip,
        take,
        orderBy: { dateTime: 'desc' },
        include: this.appointmentInclude(),
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  async cancelAppointment(id: number, user: User): Promise<Appointment> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });
    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }

    await this.assertAppointmentAccess(appointment, user);

    if (
      appointment.status === AppointmentStatusEnum.CANCELLED ||
      appointment.status === AppointmentStatusEnum.COMPLETED
    ) {
      throw new BadRequestException(
        `Cannot cancel an appointment with status ${appointment.status}.`,
      );
    }

    const result = await this.prisma.appointment.updateMany({
      where: {
        id,
        status: { notIn: [AppointmentStatusEnum.CANCELLED, AppointmentStatusEnum.COMPLETED] },
      },
      data: { status: AppointmentStatusEnum.CANCELLED },
    });
    if (result.count === 0) {
      throw new ConflictException(
        'Appointment status changed concurrently. Please retry.',
      );
    }
    const updated = await this.prisma.appointment.findUniqueOrThrow({
      where: { id },
      include: this.appointmentInclude(),
    });

    this.logger.log(`Appointment ${id} cancelled by user ${user.id}.`);

    this.calendlyService.cancelCalendlyEvent(id, 'Cancelled by user.').catch((err) => {
      this.logger.error(`Failed to cancel Calendly event for appointment ${id}:`, err);
    });

    return updated;
  }

  // ──────────────── Private Helpers ────────────────

  private async assertAppointmentAccess(
    appointment: Appointment,
    user: User,
  ): Promise<void> {
    if (user.isAdmin || user.isSuperAdmin) return;

    if (user.role === UserRolesEnum.PATIENT) {
      if (appointment.patientId !== user.id) {
        throw new ForbiddenException('You do not have access to this appointment.');
      }
      return;
    }

    if (user.role === UserRolesEnum.DOCTOR) {
      const doctorId = await this.getDoctorProfileId(user.id);
      if (appointment.doctorId !== doctorId) {
        throw new ForbiddenException('You do not have access to this appointment.');
      }
      return;
    }

    if (user.role === UserRolesEnum.NURSE) {
      await this.nurseService.assertNursePermission(
        user.id,
        appointment.doctorId,
        NursePermissionEnum.MANAGE_APPOINTMENTS,
      );
      return;
    }

    throw new ForbiddenException('You do not have access to this appointment.');
  }

  private appointmentInclude() {
    return {
      doctor: {
        include: {
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              avatar: true,
            },
          },
        },
      },
      patient: {
        select: {
          id: true,
          firstname: true,
          lastname: true,
          avatar: true,
        },
      },
      consultation: true,
    };
  }

  async countAvailableSlotsForDoctors(
    doctorIds: number[],
    startDate: Date,
    endDate: Date,
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    if (doctorIds.length === 0) return result;

    for (const id of doctorIds) result.set(id, 0);

    const [allAvailability, allDurations, allExceptions, allAppointments] =
      await Promise.all([
        this.prisma.doctorAvailability.findMany({
          where: { doctorId: { in: doctorIds }, isActive: true },
        }),
        this.prisma.slotDuration.findMany({
          where: { doctorId: { in: doctorIds }, isActive: true },
        }),
        this.prisma.availabilityException.findMany({
          where: {
            doctorId: { in: doctorIds },
            date: { gte: startDate, lte: endDate },
          },
        }),
        this.prisma.appointment.findMany({
          where: {
            doctorId: { in: doctorIds },
            dateTime: { gte: startDate, lte: endDate },
            status: { notIn: [AppointmentStatusEnum.CANCELLED, AppointmentStatusEnum.NO_SHOW] },
          },
        }),
      ]);

    for (const doctorId of doctorIds) {
      const availability = allAvailability.filter(
        (a) => a.doctorId === doctorId,
      );
      const durations = allDurations.filter((d) => d.doctorId === doctorId);
      if (availability.length === 0 || durations.length === 0) continue;

      const weeklySchedule = new Map<
        number,
        { startTime: string; endTime: string }[]
      >();
      for (const slot of availability) {
        const existing = weeklySchedule.get(slot.dayOfWeek) ?? [];
        existing.push({ startTime: slot.startTime, endTime: slot.endTime });
        weeklySchedule.set(slot.dayOfWeek, existing);
      }

      const exceptionMap = new Map<string, AvailabilityException>();
      for (const ex of allExceptions.filter((e) => e.doctorId === doctorId)) {
        exceptionMap.set(this.dateToString(ex.date), ex);
      }

      const appointmentMap = new Map<
        string,
        { startMin: number; endMin: number }[]
      >();
      for (const apt of allAppointments.filter(
        (a) => a.doctorId === doctorId,
      )) {
        const dateStr = this.dateToString(apt.dateTime);
        const startMin =
          apt.dateTime.getUTCHours() * 60 + apt.dateTime.getUTCMinutes();
        const endMin = startMin + apt.durationMinutes;
        const existing = appointmentMap.get(dateStr) ?? [];
        existing.push({ startMin, endMin });
        appointmentMap.set(dateStr, existing);
      }

      let count = 0;
      const current = new Date(startDate);
      const end = new Date(endDate);

      while (current <= end) {
        const dateStr = this.dateToString(current);
        const dayOfWeek = current.getUTCDay();
        const exception = exceptionMap.get(dateStr);

        if (exception?.isBlocked) {
          current.setUTCDate(current.getUTCDate() + 1);
          continue;
        }

        let timeWindows: { startTime: string; endTime: string }[];
        if (
          exception &&
          !exception.isBlocked &&
          exception.startTime &&
          exception.endTime
        ) {
          timeWindows = [
            { startTime: exception.startTime, endTime: exception.endTime },
          ];
        } else {
          timeWindows = weeklySchedule.get(dayOfWeek) ?? [];
        }

        const dayAppointments = appointmentMap.get(dateStr) ?? [];

        for (const window of timeWindows) {
          const windowStart = this.timeToMinutes(window.startTime);
          const windowEnd = this.timeToMinutes(window.endTime);
          for (const duration of durations) {
            let slotStart = windowStart;
            while (slotStart + duration.minutes <= windowEnd) {
              const slotEnd = slotStart + duration.minutes;
              const overlaps = dayAppointments.some(
                (apt) => slotStart < apt.endMin && slotEnd > apt.startMin,
              );
              if (!overlaps) count++;
              slotStart += duration.minutes;
            }
          }
        }

        current.setUTCDate(current.getUTCDate() + 1);
      }

      result.set(doctorId, count);
    }

    return result;
  }

  /** Convert a Date to "YYYY-MM-DD" string using UTC. */
  private dateToString(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** Convert "HH:mm" to total minutes since midnight. */
  timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  /** Convert total minutes since midnight to "HH:mm". */
  minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60)
      .toString()
      .padStart(2, '0');
    const m = (minutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }
}
