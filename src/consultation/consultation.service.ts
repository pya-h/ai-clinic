import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Consultation,
  ConsultationStatusEnum,
  NursePermissionEnum,
  Prisma,
  User,
  UserRolesEnum,
} from '@prisma/client';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { DoctorDecisionDto } from './dto/doctor-decision.dto';
import { CompleteConsultationDto } from './dto/complete-consultation.dto';
import { ConsultationFilterDto } from './dto/consultation-filter.dto';
import { NotificationService } from '../notification/notification.service';
import { NurseService } from '../nurse/nurse.service';

/**
 * Allowed state transitions for the consultation state machine.
 *
 * CREATED → PENDING_DOCTOR_REVIEW → DOCTOR_DECIDED → PENDING_PAYMENT →
 * PAYMENT_CONFIRMED → IN_PROGRESS → COMPLETED
 *
 * CANCELLED can be reached from any non-terminal state.
 */
const ALLOWED_TRANSITIONS: Record<
  ConsultationStatusEnum,
  ConsultationStatusEnum[]
> = {
  CREATED: [
    ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
    ConsultationStatusEnum.CANCELLED,
  ],
  PENDING_DOCTOR_REVIEW: [
    ConsultationStatusEnum.DOCTOR_DECIDED,
    ConsultationStatusEnum.CANCELLED,
  ],
  DOCTOR_DECIDED: [
    ConsultationStatusEnum.PENDING_PAYMENT,
    ConsultationStatusEnum.CANCELLED,
  ],
  PENDING_PAYMENT: [
    ConsultationStatusEnum.PAYMENT_CONFIRMED,
    ConsultationStatusEnum.CANCELLED,
  ],
  PAYMENT_CONFIRMED: [
    ConsultationStatusEnum.IN_PROGRESS,
    ConsultationStatusEnum.CANCELLED,
  ],
  IN_PROGRESS: [
    ConsultationStatusEnum.COMPLETED,
    ConsultationStatusEnum.CANCELLED,
  ],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class ConsultationService {
  private readonly logger = new Logger(ConsultationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
    private readonly nurseService: NurseService,
  ) {}

  // ──────────────── State Machine ────────────────

  /**
   * Validate that a status transition is allowed.
   * Throws BadRequestException if the transition is invalid.
   */
  validateTransition(
    from: ConsultationStatusEnum,
    to: ConsultationStatusEnum,
  ): void {
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      throw new BadRequestException(
        `Cannot transition from ${from} to ${to}.`,
      );
    }
  }

  // ──────────────── Creation ────────────────

  /**
   * Patient creates a new consultation.
   * 1. Validate doctor exists and is verified.
   * 2. Optionally validate SOAP exists and belongs to user.
   * 3. Create with status CREATED, then auto-transition to PENDING_DOCTOR_REVIEW.
   */
  async create(
    user: User,
    dto: CreateConsultationDto,
  ): Promise<Consultation> {
    // Only patients can create consultations
    if (user.role !== UserRolesEnum.PATIENT) {
      throw new ForbiddenException('Only patients can create consultations.');
    }

    // Validate doctor exists and is verified
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { id: dto.doctorId },
    });
    if (!doctor || !doctor.verified) {
      throw new NotFoundException('Doctor not found or not verified.');
    }

    // Validate SOAP if provided
    if (dto.soapId) {
      const soap = await this.prisma.patientSOAP.findUnique({
        where: { id: dto.soapId },
      });
      if (!soap) {
        throw new NotFoundException('SOAP note not found.');
      }
      if (soap.userId !== user.id) {
        throw new ForbiddenException('This SOAP note does not belong to you.');
      }
    }

    const consultation = await this.prisma.consultation.create({
      data: {
        patientId: user.id,
        doctorId: dto.doctorId,
        soapId: dto.soapId ?? null,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      },
      include: {
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
        soap: true,
      },
    });

    this.logger.log(
      `Consultation ${consultation.id} created by patient ${user.id} for doctor ${dto.doctorId}`,
    );

    this.notificationService
      .onNewConsultation(consultation.id, doctor.userId)
      .catch((e) => this.logger.error(`Notification failed: ${e.message}`));

    return consultation;
  }

  // ──────────────── Doctor Decision ────────────────

  /**
   * Doctor decides on a consultation (mode + visit method).
   * Transitions PENDING_DOCTOR_REVIEW → DOCTOR_DECIDED.
   */
  async doctorDecide(
    consultationId: string,
    user: User,
    dto: DoctorDecisionDto,
  ): Promise<Consultation> {
    const consultation = await this.getByIdRaw(consultationId);
    await this.assertDoctorOwnership(consultation, user);

    this.validateTransition(
      consultation.status,
      ConsultationStatusEnum.DOCTOR_DECIDED,
    );

    const updated = await this.prisma.consultation.update({
      where: { id: consultationId },
      data: {
        status: ConsultationStatusEnum.DOCTOR_DECIDED,
        doctorDecision: dto.doctorDecision,
        visitMethod: dto.visitMethod ?? null,
      },
      include: this.defaultInclude(),
    });

    this.logger.log(
      `Doctor decided on consultation ${consultationId}: ${dto.doctorDecision}`,
    );

    this.notificationService
      .onDoctorDecision(consultationId, consultation.patientId, true)
      .catch((e) => this.logger.error(`Notification failed: ${e.message}`));

    return updated;
  }

  // ──────────────── Completion ────────────────

  /**
   * Doctor completes a consultation.
   * Transitions IN_PROGRESS → COMPLETED.
   */
  async complete(
    consultationId: string,
    user: User,
    dto: CompleteConsultationDto,
  ): Promise<Consultation> {
    const consultation = await this.getByIdRaw(consultationId);
    await this.assertDoctorOwnership(consultation, user);

    this.validateTransition(
      consultation.status,
      ConsultationStatusEnum.COMPLETED,
    );

    const updated = await this.prisma.consultation.update({
      where: { id: consultationId },
      data: {
        status: ConsultationStatusEnum.COMPLETED,
        notes: dto.notes ?? consultation.notes,
        summary: dto.summary ?? consultation.summary,
        followUpNeeded: dto.followUpNeeded ?? consultation.followUpNeeded,
        completedAt: new Date(),
      },
      include: this.defaultInclude(),
    });

    this.logger.log(`Consultation ${consultationId} completed.`);

    return updated;
  }

  // ──────────────── Cancellation ────────────────

  /**
   * Either patient or doctor (or admin) can cancel.
   * Transitions any non-terminal state → CANCELLED.
   */
  async cancel(
    consultationId: string,
    user: User,
  ): Promise<Consultation> {
    const consultation = await this.getByIdRaw(consultationId);
    await this.assertParticipantOrAdmin(consultation, user);

    this.validateTransition(
      consultation.status,
      ConsultationStatusEnum.CANCELLED,
    );

    const updated = await this.prisma.consultation.update({
      where: { id: consultationId },
      data: { status: ConsultationStatusEnum.CANCELLED },
      include: this.defaultInclude(),
    });

    this.logger.log(
      `Consultation ${consultationId} cancelled by user ${user.id}.`,
    );

    return updated;
  }

  // ──────────────── Queries ────────────────

  /**
   * Get a single consultation with ownership check.
   * Patients see own, doctors see assigned, admins see all.
   */
  async getById(consultationId: string, user: User): Promise<Consultation> {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      include: this.defaultInclude(),
    });
    if (!consultation) {
      throw new NotFoundException('Consultation not found.');
    }

    await this.assertParticipantOrAdmin(consultation, user);

    return consultation;
  }

  /**
   * List consultations based on user role.
   * - PATIENT: own consultations
   * - DOCTOR: consultations assigned to them
   * - Admin: all consultations
   */
  async list(
    user: User,
    filters: ConsultationFilterDto,
  ): Promise<{
    data: Consultation[];
    total: number;
    skip: number;
    take: number;
  }> {
    const skip = +(filters.skip ?? 0);
    const take = +(filters.take ?? 20);

    const where: Prisma.ConsultationWhereInput = {};

    // Status filter
    if (filters.status) {
      where.status = filters.status;
    }

    // Role-based filter
    if (user.isAdmin || user.isSuperAdmin) {
      // Admins see all — no additional filter
    } else if (user.role === UserRolesEnum.PATIENT) {
      where.patientId = user.id;
    } else if (user.role === UserRolesEnum.DOCTOR) {
      const doctorProfile = await this.prisma.doctorProfile.findUnique({
        where: { userId: user.id },
      });
      if (!doctorProfile) {
        throw new NotFoundException('Doctor profile not found.');
      }
      where.doctorId = doctorProfile.id;
    } else if (user.role === UserRolesEnum.NURSE) {
      const doctorIds = await this.nurseService.getDoctorIdsForNurse(
        user.id,
        NursePermissionEnum.VIEW_CONSULTATION_NOTES,
      );
      if (doctorIds.length === 0) {
        return { data: [], total: 0, skip, take };
      }
      where.doctorId = { in: doctorIds };
    } else {
      throw new ForbiddenException(
        'You do not have access to consultations.',
      );
    }

    const [data, total] = await Promise.all([
      this.prisma.consultation.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: this.defaultInclude(),
      }),
      this.prisma.consultation.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  /**
   * Get pending consultations for a specific doctor.
   */
  async getPendingForDoctor(
    user: User,
  ): Promise<Consultation[]> {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.id },
    });
    if (!doctorProfile) {
      throw new NotFoundException('Doctor profile not found.');
    }

    return this.prisma.consultation.findMany({
      where: {
        doctorId: doctorProfile.id,
        status: ConsultationStatusEnum.PENDING_DOCTOR_REVIEW,
      },
      orderBy: { createdAt: 'asc' },
      include: this.defaultInclude(),
    });
  }

  // ──────────────── Ownership Helpers ────────────────

  /**
   * Assert that the user is a participant (patient or doctor) or admin.
   */
  private async assertParticipantOrAdmin(
    consultation: Consultation,
    user: User,
  ): Promise<void> {
    if (user.isAdmin || user.isSuperAdmin) return;

    if (user.role === UserRolesEnum.PATIENT) {
      if (consultation.patientId !== user.id) {
        throw new ForbiddenException(
          'You do not have access to this consultation.',
        );
      }
      return;
    }

    if (user.role === UserRolesEnum.DOCTOR) {
      const doctorProfile = await this.prisma.doctorProfile.findUnique({
        where: { userId: user.id },
      });
      if (!doctorProfile || consultation.doctorId !== doctorProfile.id) {
        throw new ForbiddenException(
          'You do not have access to this consultation.',
        );
      }
      return;
    }

    if (user.role === UserRolesEnum.NURSE) {
      await this.nurseService.assertNursePermission(
        user.id,
        consultation.doctorId,
        NursePermissionEnum.VIEW_CONSULTATION_NOTES,
      );
      return;
    }

    throw new ForbiddenException(
      'You do not have access to this consultation.',
    );
  }

  /**
   * Assert that the user is the assigned doctor for this consultation.
   */
  private async assertDoctorOwnership(
    consultation: Consultation,
    user: User,
  ): Promise<void> {
    if (user.role !== UserRolesEnum.DOCTOR) {
      throw new ForbiddenException('Only doctors can perform this action.');
    }

    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.id },
    });
    if (!doctorProfile || consultation.doctorId !== doctorProfile.id) {
      throw new ForbiddenException(
        'You are not the assigned doctor for this consultation.',
      );
    }
  }

  // ──────────────── Internal Helpers ────────────────

  /**
   * Get raw consultation by ID (no ownership check).
   */
  private async getByIdRaw(consultationId: string): Promise<Consultation> {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
    });
    if (!consultation) {
      throw new NotFoundException('Consultation not found.');
    }
    return consultation;
  }

  /**
   * Default includes for consultation queries.
   */
  private defaultInclude() {
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
      soap: true,
      appointment: true,
    };
  }
}
