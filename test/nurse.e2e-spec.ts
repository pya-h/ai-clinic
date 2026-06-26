/**
 * Nurse E2E Tests
 *
 * Tests:
 *   POST   /nurse/assign                    — assign nurse to doctor (DOCTOR only)
 *   PATCH  /nurse/assignment/:id/permissions — update permissions (DOCTOR only)
 *   DELETE /nurse/assignment/:id            — deactivate assignment (DOCTOR only)
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
import { NursePermissionEnum } from '@prisma/client';
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
    it('should assign a nurse successfully (doctor)', async () => {
      sessionUser = doctorUser;

      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.user.findUnique.mockResolvedValue({
        ...nurseUser,
        role: 'NURSE',
      });
      prisma.doctorNurseAssignment.create.mockResolvedValue(buildAssignment());

      const res = await app.inject({
        method: 'POST',
        url: '/nurse/assign',
        payload: {
          nurseId: nurseUser.id,
          permissions: [NursePermissionEnum.VIEW_PATIENTS],
        },
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.nurseId).toBe(nurseUser.id);
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

    it('should return 400 when permissions is empty array', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/nurse/assignment/${assignmentId}/permissions`,
        payload: { permissions: [] },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
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
});
