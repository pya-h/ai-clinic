/**
 * Nurse E2E Tests
 *
 * Tests:
 *   POST   /nurse/assign                    — invite a nurse (verified DOCTOR only)
 *   GET    /nurse/invitations               — invitee's pending invitations
 *   POST   /nurse/invitations/:id/accept    — accept (becomes NURSE)
 *   POST   /nurse/invitations/:id/decline   — decline
 *   PATCH  /nurse/assignment/:id/permissions — update permissions (DOCTOR only)
 *   DELETE /nurse/assignment/:id            — cancel invitation / deactivate assignment (DOCTOR only)
 *   GET    /nurse/assignments               — list assignments (DOCTOR or NURSE)
 *   GET    /nurse/assignment/:id            — get single assignment (DOCTOR or NURSE)
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { UtilsModule } from '../src/utils/utils.module';
import { AuthModule } from '../src/auth/auth.module';
import { UserModule } from '../src/user/user.module';
import { NurseModule } from '../src/nurse/nurse.module';
import { ExceptionTemplateFilter } from '../src/common/filters/exception-template.filter';
import { ResponseTemplateInterceptor } from '../src/common/interceptors/response-template.interceptor';
import {
  createMockPrismaService,
  MockPrismaService,
} from './helpers/mock-prisma.helper';
import {
  createMockUser,
  createMockDoctorUser,
  createMockAdminUser,
  createMockNurseUser,
  MockUser,
} from './helpers/mock-session.helper';
import {
  randomUuid,
  buildDoctorProfile,
} from './helpers/test-data.factory';
import {
  NotificationTypeEnum,
  NurseAssignmentStatusEnum,
  NursePermissionEnum,
} from '@prisma/client';
import authConfigs from '../src/configs/auth';
import generalConfigs from '../src/configs/general';

// ── Test module ──────────────────────────────────────────────────────

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ load: [authConfigs, generalConfigs] }),
    CacheModule,
    UtilsModule,
    AuthModule,
    UserModule,
    NurseModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

// ── Suite ────────────────────────────────────────────────────────────

describe('Nurse (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  const patientUser = createMockUser();
  const doctorUser = createMockDoctorUser();
  const adminUser = createMockAdminUser();
  const nurseUser = createMockNurseUser();

  const doctorProfileId = 42;
  const doctorProfile = buildDoctorProfile({
    id: doctorProfileId,
    userId: doctorUser.id,
    verified: true,
  });

  const assignmentId = 7;

  function buildAssignment(overrides: Record<string, any> = {}) {
    const now = new Date();
    return {
      id: assignmentId,
      doctorId: doctorProfileId,
      nurseId: nurseUser.id,
      permissions: [NursePermissionEnum.VIEW_PATIENTS],
      isActive: true,
      createdAt: now,
      updatedAt: now,
      nurse: {
        id: nurseUser.id,
        firstname: nurseUser.firstname,
        lastname: nurseUser.lastname,
        email: nurseUser.email,
        avatar: null,
      },
      doctor: {
        id: doctorProfileId,
        userId: doctorUser.id,
        user: {
          id: doctorUser.id,
          firstname: doctorUser.firstname,
          lastname: doctorUser.lastname,
          avatar: null,
        },
      },
      ...overrides,
    };
  }

  // ── Bootstrap ──────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalFilters(new ExceptionTemplateFilter());
    app.useGlobalInterceptors(new ResponseTemplateInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidUnknownValues: true,
        transform: true,
      }),
    );

    const instance = app.getHttpAdapter().getInstance();
    instance.addHook('preHandler', (request: any, _reply: any, done: any) => {
      request.session = {
        get: (key: string) => {
          if (key === 'user') return sessionUser;
          return sessionStore[key];
        },
        set: (key: string, value: any) => {
          if (key === 'user') sessionUser = value;
          sessionStore[key] = value;
        },
        delete: () => {
          sessionUser = null;
          sessionStore = {};
        },
      };
      done();
    });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sessionUser = null;
    sessionStore = {};
  });

  // ─── POST /nurse/assign ──────────────────────────────────────────

  describe('POST /nurse/assign', () => {
    it('should create a pending invitation and notify the invitee (doctor)', async () => {
      sessionUser = doctorUser;
      const invitee = createMockUser();
      const pending = buildAssignment({
        nurseId: invitee.id,
        isActive: false,
        status: NurseAssignmentStatusEnum.PENDING,
      });

      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.user.findUnique.mockResolvedValue(invitee);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(null);
      prisma.doctorNurseAssignment.create.mockResolvedValue(pending);
      prisma.doctorNurseAssignment.findUniqueOrThrow.mockResolvedValue(pending);
      prisma.notification.create.mockResolvedValue({ id: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/nurse/assign',
        payload: {
          nurseId: invitee.id,
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
        },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toMatchObject({ nurseId: invitee.id, isActive: false, status: 'PENDING' });
      expect(prisma.doctorNurseAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'PENDING', isActive: false }),
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: invitee.id,
          type: NotificationTypeEnum.NURSE_INVITATION,
          data: { assignmentId },
        }),
      });
    });

    it('should return 403 for an unverified doctor', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue({ ...doctorProfile, verified: false });

      const res = await app.inject({
        method: 'POST',
        url: '/nurse/assign',
        payload: { nurseId: randomUuid() },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
      expect(JSON.parse(res.body).message).toBe('Only verified doctors can invite nurses.');
      expect(prisma.doctorNurseAssignment.create).not.toHaveBeenCalled();
    });

    it('should return 409 when the user already has a pending invitation', async () => {
      sessionUser = doctorUser;
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.user.findUnique.mockResolvedValue(createMockUser());
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(
        buildAssignment({ isActive: false, status: NurseAssignmentStatusEnum.PENDING }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/nurse/assign',
        payload: { nurseId: randomUuid() },
      });

      expect(res.statusCode).toBe(HttpStatus.CONFLICT);
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it.each([
      ['within 7 days of a decline', 1, HttpStatus.CONFLICT],
      ['once 7 days have passed since a decline', -1, HttpStatus.CREATED],
    ])('should answer a re-invite %s with %s', async (_case, sign, status) => {
      sessionUser = doctorUser;
      const week = 7 * 24 * 3600_000;
      const respondedAt = new Date(Date.now() - week + sign * (60_000 + Math.floor(Math.random() * 3 * 24 * 3600_000)));
      const declined = buildAssignment({ isActive: false, status: NurseAssignmentStatusEnum.DECLINED, respondedAt });
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.user.findUnique.mockResolvedValue(createMockUser());
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(declined);
      prisma.doctorNurseAssignment.updateMany.mockResolvedValue({ count: 1 });
      prisma.doctorNurseAssignment.findUniqueOrThrow.mockResolvedValue({ ...declined, status: 'PENDING' });
      prisma.notification.create.mockResolvedValue({ id: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/nurse/assign',
        payload: { nurseId: declined.nurseId },
      });

      expect(res.statusCode).toBe(status);
      if (status === HttpStatus.CONFLICT) {
        expect(JSON.parse(res.body).message).toBe(
          'This user declined your invitation recently. You can invite them again from ' +
            `${new Date(respondedAt.getTime() + week).toISOString()}.`,
        );
        expect(prisma.doctorNurseAssignment.updateMany).not.toHaveBeenCalled();
        expect(prisma.notification.create).not.toHaveBeenCalled();
      } else {
        expect(prisma.doctorNurseAssignment.updateMany).toHaveBeenCalledTimes(1);
      }
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/nurse/assign',
        payload: {
          nurseId: randomUuid(),
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
        },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when patient tries to assign nurse', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'POST',
        url: '/nurse/assign',
        payload: {
          nurseId: randomUuid(),
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
        },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 403 when nurse tries to assign nurse', async () => {
      sessionUser = nurseUser;

      const res = await app.inject({
        method: 'POST',
        url: '/nurse/assign',
        payload: {
          nurseId: randomUuid(),
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
        },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 400 with invalid payload (missing nurseId)', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'POST',
        url: '/nurse/assign',
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should return 400 when nurseId is not a UUID', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'POST',
        url: '/nurse/assign',
        payload: {
          nurseId: 'not-a-uuid',
        },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /nurse/assignment/:id/permissions ─────────────────────

  describe('PATCH /nurse/assignment/:id/permissions', () => {
    it('should update permissions successfully (doctor)', async () => {
      sessionUser = doctorUser;

      const updatedPermissions = [
        NursePermissionEnum.VIEW_PATIENTS,
        NursePermissionEnum.VIEW_SOAPS,
        NursePermissionEnum.MANAGE_APPOINTMENTS,
      ];

      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(
        buildAssignment(),
      );
      prisma.doctorNurseAssignment.update.mockResolvedValue(
        buildAssignment({ permissions: updatedPermissions }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: `/nurse/assignment/${assignmentId}/permissions`,
        payload: { permissions: updatedPermissions },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.permissions).toEqual(updatedPermissions);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: `/nurse/assignment/${assignmentId}/permissions`,
        payload: {
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
        },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when nurse tries to update permissions', async () => {
      sessionUser = nurseUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/nurse/assignment/${assignmentId}/permissions`,
        payload: {
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
        },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should revoke all permissions with an empty array', async () => {
      sessionUser = doctorUser;

      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(
        buildAssignment(),
      );
      prisma.doctorNurseAssignment.update.mockResolvedValue(
        buildAssignment({ permissions: [] }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: `/nurse/assignment/${assignmentId}/permissions`,
        payload: { permissions: [] },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.permissions).toEqual([]);
      expect(body.contents.isActive).toBe(true);
      expect(prisma.doctorNurseAssignment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: assignmentId },
          data: { permissions: [] },
        }),
      );
    });

    it.each([
      ['an unknown permission', { permissions: ['VIEW_EVERYTHING'] }],
      ['a non-array value', { permissions: NursePermissionEnum.VIEW_PATIENTS }],
      ['a missing field', {}],
      ['null', { permissions: null }],
    ])('should return 400 for %s', async (_case, payload) => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/nurse/assignment/${assignmentId}/permissions`,
        payload,
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(prisma.doctorNurseAssignment.update).not.toHaveBeenCalled();
    });

    it('should return 400 when id is not an integer', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'PATCH',
        url: '/nurse/assignment/abc/permissions',
        payload: {
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
        },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── DELETE /nurse/assignment/:id ────────────────────────────────

  describe('DELETE /nurse/assignment/:id', () => {
    it('should cancel (delete) a pending invitation (doctor)', async () => {
      sessionUser = doctorUser;
      const pending = buildAssignment({ isActive: false, status: NurseAssignmentStatusEnum.PENDING });
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(pending);
      prisma.doctorNurseAssignment.deleteMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: 'DELETE',
        url: `/nurse/assignment/${assignmentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      expect(JSON.parse(res.body).contents).toMatchObject({ id: assignmentId, status: 'PENDING' });
      expect(prisma.doctorNurseAssignment.deleteMany).toHaveBeenCalledWith({
        where: { id: assignmentId, status: NurseAssignmentStatusEnum.PENDING },
      });
      expect(prisma.doctorNurseAssignment.update).not.toHaveBeenCalled();
    });

    it('should deactivate assignment successfully (doctor)', async () => {
      sessionUser = doctorUser;

      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(
        buildAssignment(),
      );
      prisma.doctorNurseAssignment.update.mockResolvedValue(
        buildAssignment({ isActive: false }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/nurse/assignment/${assignmentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.isActive).toBe(false);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'DELETE',
        url: `/nurse/assignment/${assignmentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when patient tries to deactivate assignment', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'DELETE',
        url: `/nurse/assignment/${assignmentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 400 when id is not an integer', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'DELETE',
        url: '/nurse/assignment/xyz',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /nurse/assignments ──────────────────────────────────────

  describe('GET /nurse/assignments', () => {
    it('should list assignments for doctor', async () => {
      sessionUser = doctorUser;

      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findMany.mockResolvedValue([
        buildAssignment(),
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/nurse/assignments',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(Array.isArray(body.contents)).toBe(true);
      expect(body.contents).toHaveLength(1);
    });

    it('should list assignments for nurse', async () => {
      sessionUser = nurseUser;

      prisma.doctorNurseAssignment.findMany.mockResolvedValue([
        buildAssignment(),
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/nurse/assignments',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(Array.isArray(body.contents)).toBe(true);
    });

    it('should return empty array when no assignments', async () => {
      sessionUser = nurseUser;

      prisma.doctorNurseAssignment.findMany.mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/nurse/assignments',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toHaveLength(0);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/nurse/assignments',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when patient tries to list assignments', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/nurse/assignments',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─── GET /nurse/assignment/:id ───────────────────────────────────

  describe('GET /nurse/assignment/:id', () => {
    it('should get assignment for doctor', async () => {
      sessionUser = doctorUser;

      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(
        buildAssignment(),
      );
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);

      const res = await app.inject({
        method: 'GET',
        url: `/nurse/assignment/${assignmentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(assignmentId);
    });

    it('should get assignment for nurse', async () => {
      sessionUser = nurseUser;

      prisma.doctorNurseAssignment.findUnique.mockResolvedValue(
        buildAssignment(),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/nurse/assignment/${assignmentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.id).toBe(assignmentId);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: `/nurse/assignment/${assignmentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when patient tries to get assignment', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: `/nurse/assignment/${assignmentId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 400 when id is not an integer', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'GET',
        url: '/nurse/assignment/not-a-number',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /nurse/dashboard ───────────────────────────────────────

  describe('GET /nurse/dashboard', () => {
    it('should return dashboard with assignments and stats for nurse', async () => {
      sessionUser = nurseUser;

      const assignment = buildAssignment();
      prisma.doctorNurseAssignment.findMany.mockResolvedValue([assignment]);
      prisma.appointment.count.mockResolvedValue(3);
      prisma.consultation.count.mockResolvedValue(1);

      const res = await app.inject({
        method: 'GET',
        url: '/nurse/dashboard',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.assignments).toHaveLength(1);
      expect(body.contents.assignments[0].nurseId).toBe(nurseUser.id);
      expect(body.contents.stats).toBeDefined();
      expect(body.contents.stats.upcomingAppointments).toBe(3);
      expect(body.contents.stats.activeConsultations).toBe(1);
      expect(body.contents.stats.assignedDoctors).toBe(1);
    });

    it('should return empty dashboard when nurse has no assignments', async () => {
      sessionUser = nurseUser;

      prisma.doctorNurseAssignment.findMany.mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/nurse/dashboard',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.assignments).toHaveLength(0);
      expect(body.contents.stats.upcomingAppointments).toBe(0);
      expect(body.contents.stats.activeConsultations).toBe(0);
      expect(body.contents.stats.assignedDoctors).toBe(0);
    });

    it('should return 403 when doctor tries to access nurse dashboard', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'GET',
        url: '/nurse/dashboard',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 403 when patient tries to access nurse dashboard', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/nurse/dashboard',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/nurse/dashboard',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── Invitations (invitee side) ────────────────────────────────

  describe('nurse invitations', () => {
    let invitee: MockUser;
    let pending: ReturnType<typeof buildAssignment>;

    beforeEach(() => {
      invitee = createMockUser();
      pending = buildAssignment({
        nurseId: invitee.id,
        isActive: false,
        status: NurseAssignmentStatusEnum.PENDING,
      });
      prisma.notification.create.mockResolvedValue({ id: 1 });
    });

    describe('GET /nurse/invitations', () => {
      it.each([
        ['a patient', () => invitee],
        ['a role-less user', () => ({ ...invitee, role: 'NONE' as any })],
        ['a nurse', () => nurseUser],
      ])("should list %s's pending invitations", async (_case, who) => {
        sessionUser = who();
        prisma.doctorNurseAssignment.findMany.mockResolvedValue([pending]);

        const res = await app.inject({ method: 'GET', url: '/nurse/invitations' });

        expect(res.statusCode).toBe(HttpStatus.OK);
        expect(JSON.parse(res.body).contents).toEqual([
          expect.objectContaining({ id: assignmentId, status: 'PENDING' }),
        ]);
        expect(prisma.doctorNurseAssignment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { nurseId: sessionUser!.id, status: NurseAssignmentStatusEnum.PENDING },
          }),
        );
      });

      it('should return 403 for a doctor', async () => {
        sessionUser = doctorUser;
        expect((await app.inject({ method: 'GET', url: '/nurse/invitations' })).statusCode).toBe(
          HttpStatus.FORBIDDEN,
        );
      });

      it('should return 401 when not authenticated', async () => {
        expect((await app.inject({ method: 'GET', url: '/nurse/invitations' })).statusCode).toBe(
          HttpStatus.UNAUTHORIZED,
        );
      });
    });

    describe.each([
      ['accept', true],
      ['decline', false],
    ])('POST /nurse/invitations/:id/%s', (action, accepting) => {
      const url = (id: number | string = assignmentId) => `/nurse/invitations/${id}/${action}`;

      beforeEach(() => {
        prisma.doctorNurseAssignment.findUnique.mockResolvedValue({
          nurseId: invitee.id,
          status: NurseAssignmentStatusEnum.PENDING,
        });
        prisma.user.findUnique.mockResolvedValue(invitee);
        prisma.user.updateMany.mockResolvedValue({ count: 1 });
        prisma.doctorNurseAssignment.updateMany.mockResolvedValue({ count: 1 });
        prisma.doctorNurseAssignment.findUniqueOrThrow.mockResolvedValue({
          ...pending,
          isActive: accepting,
          status: accepting ? 'ACCEPTED' : 'DECLINED',
        });
      });

      it(`should ${action} the invitation (200) and tell the doctor`, async () => {
        sessionUser = invitee;

        const res = await app.inject({ method: 'POST', url: url() });

        expect(res.statusCode).toBe(HttpStatus.OK);
        expect(JSON.parse(res.body).contents).toMatchObject({
          id: assignmentId,
          isActive: accepting,
          status: accepting ? 'ACCEPTED' : 'DECLINED',
        });
        expect(prisma.notification.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            userId: doctorUser.id,
            type: NotificationTypeEnum.NURSE_INVITATION_ANSWERED,
            data: { assignmentId, accepted: accepting },
          }),
        });
        if (accepting) {
          expect(prisma.user.updateMany).toHaveBeenCalledWith({
            where: { id: invitee.id, role: invitee.role, isAdmin: false, isSuperAdmin: false },
            data: { role: 'NURSE' },
          });
        } else {
          expect(prisma.user.updateMany).not.toHaveBeenCalled();
        }
      });

      it("should return 404 for someone else's invitation", async () => {
        sessionUser = createMockUser();

        const res = await app.inject({ method: 'POST', url: url() });

        expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
        expect(prisma.doctorNurseAssignment.updateMany).not.toHaveBeenCalled();
      });

      it('should return 409 for an invitation already answered', async () => {
        sessionUser = invitee;
        prisma.doctorNurseAssignment.findUnique.mockResolvedValue({
          nurseId: invitee.id,
          status: NurseAssignmentStatusEnum.DECLINED,
        });

        const res = await app.inject({ method: 'POST', url: url() });

        expect(res.statusCode).toBe(HttpStatus.CONFLICT);
        expect(JSON.parse(res.body).message).toBe('This invitation has already been answered.');
      });

      it('should return 403 for a doctor', async () => {
        sessionUser = doctorUser;
        expect((await app.inject({ method: 'POST', url: url() })).statusCode).toBe(HttpStatus.FORBIDDEN);
      });

      it('should return 401 when not authenticated', async () => {
        expect((await app.inject({ method: 'POST', url: url() })).statusCode).toBe(
          HttpStatus.UNAUTHORIZED,
        );
      });

      it('should return 400 when id is not an integer', async () => {
        sessionUser = invitee;
        expect((await app.inject({ method: 'POST', url: url('abc') })).statusCode).toBe(
          HttpStatus.BAD_REQUEST,
        );
      });
    });
  });

  // ─── Role upgrade on accepting ─────────────────────────────────

  describe('role upgrade on accepting an invitation', () => {
    afterEach(() => {
      prisma.user.findFirst.mockReset();
      prisma.user.findUnique.mockReset();
      prisma.user.updateMany.mockReset();
    });

    it('should keep a just-invited patient a patient, and make them a nurse on accepting, without re-login', async () => {
      const patient = createMockUser();
      const db = new Map<string, MockUser>([
        [patient.id, patient],
        [doctorUser.id, doctorUser],
      ]);
      let row: any = null;
      prisma.user.findFirst.mockImplementation(async ({ where }: any) => db.get(where.id) ?? null);
      prisma.user.findUnique.mockImplementation(async ({ where }: any) => db.get(where.id) ?? null);
      prisma.user.updateMany.mockImplementation(async ({ where, data }: any) => {
        const user = db.get(where.id);
        if (!user || user.role !== where.role) return { count: 0 };
        db.set(where.id, { ...user, ...data });
        return { count: 1 };
      });
      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorNurseAssignment.findUnique.mockImplementation(async () => row);
      prisma.doctorNurseAssignment.create.mockImplementation(async ({ data }: any) => {
        row = buildAssignment({ ...data });
        return row;
      });
      prisma.doctorNurseAssignment.updateMany.mockImplementation(async ({ where, data }: any) => {
        if (!row || row.status !== where.status) return { count: 0 };
        row = { ...row, ...data };
        return { count: 1 };
      });
      prisma.doctorNurseAssignment.findUniqueOrThrow.mockImplementation(async () => row);
      prisma.doctorNurseAssignment.findMany.mockResolvedValue([]);
      prisma.notification.create.mockResolvedValue({ id: 1 });

      sessionUser = doctorUser;
      const invite = await app.inject({
        method: 'POST',
        url: '/nurse/assign',
        payload: { nurseId: patient.id, permissions: [NursePermissionEnum.VIEW_PATIENTS] },
      });
      expect(invite.statusCode).toBe(HttpStatus.CREATED);

      sessionUser = patient;
      expect((await app.inject({ method: 'GET', url: '/nurse/dashboard' })).statusCode).toBe(
        HttpStatus.FORBIDDEN,
      );
      expect(db.get(patient.id)!.role).toBe('PATIENT');

      const accept = await app.inject({ method: 'POST', url: `/nurse/invitations/${row.id}/accept` });
      expect(accept.statusCode).toBe(HttpStatus.OK);

      const res = await app.inject({ method: 'GET', url: '/nurse/dashboard' });
      expect(res.statusCode).toBe(HttpStatus.OK);
      expect(sessionUser?.role).toBe('NURSE');
      expect(row).toMatchObject({ status: 'ACCEPTED', isActive: true });
    });
  });
});
