/**
 * Admin E2E Tests
 *
 * Tests:
 *   GET    /admin/users                — list all users (admin/superadmin)
 *   PATCH  /admin/users/:id            — update user (admin/superadmin)
 *   PATCH  /admin/users/:id/deactivate — deactivate user (admin/superadmin)
 *   GET    /admin/doctors/pending      — list pending verifications
 *   GET    /admin/doctors/:id/documents — get doctor documents
 *   PATCH  /admin/doctors/:id/verify   — verify doctor
 *   PATCH  /admin/users/:id/promote    — promote to admin (SUPERADMIN only)
 *   PATCH  /admin/users/:id/demote     — demote admin (SUPERADMIN only)
 *   DELETE /admin/reviews/:id          — delete review
 *   GET    /admin/stats                — platform statistics
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
import { AdminModule } from '../src/admin/admin.module';
import { NotificationService } from '../src/notification/notification.service';
import { ReviewService } from '../src/review/review.service';
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
  createMockSuperAdminUser,
  MockUser,
} from './helpers/mock-session.helper';
import {
  randomUuid,
  buildDoctorProfile,
  buildUser,
} from './helpers/test-data.factory';
import authConfigs from '../src/configs/auth';
import generalConfigs from '../src/configs/general';

// ── Mock services ────────────────────────────────────────────────────

const mockNotificationService = {
  onDoctorVerified: jest.fn().mockResolvedValue(undefined),
  onNewConsultation: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
};

const mockReviewService = {
  delete: jest.fn().mockResolvedValue(undefined),
};

// ── Test module ──────────────────────────────────────────────────────

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ load: [authConfigs, generalConfigs] }),
    CacheModule,
    UtilsModule,
    AuthModule,
    UserModule,
    AdminModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

// ── Suite ────────────────────────────────────────────────────────────

describe('Admin (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

  const patientUser = createMockUser();
  const doctorUser = createMockDoctorUser();
  const adminUser = createMockAdminUser();
  const superAdminUser = createMockSuperAdminUser();

  const targetUserId = randomUuid();
  const targetUser = buildUser({ id: targetUserId, isActive: true });
  const doctorProfileId = 55;
  const doctorProfile = buildDoctorProfile({
    id: doctorProfileId,
    userId: doctorUser.id,
    verified: false,
  });

  const safeUserSelect = {
    id: targetUserId,
    firstname: targetUser.firstname,
    lastname: targetUser.lastname,
    email: targetUser.email,
    role: targetUser.role,
    isActive: true,
    isAdmin: false,
    isSuperAdmin: false,
    isPrivate: false,
    avatar: null,
    createdAt: targetUser.createdAt,
    updatedAt: targetUser.updatedAt,
  };

  // ── Bootstrap ──────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createMockPrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(NotificationService)
      .useValue(mockNotificationService)
      .overrideProvider(ReviewService)
      .useValue(mockReviewService)
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

  // ─── GET /admin/users ────────────────────────────────────────────

  describe('GET /admin/users', () => {
    it('should list users for admin', async () => {
      sessionUser = adminUser;

      prisma.user.findMany.mockResolvedValue([safeUserSelect]);
      prisma.user.count.mockResolvedValue(1);

      const res = await app.inject({
        method: 'GET',
        url: '/admin/users',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.data).toHaveLength(1);
      expect(body.contents.total).toBe(1);
    });

    it('should list users for superadmin', async () => {
      sessionUser = superAdminUser;

      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      const res = await app.inject({
        method: 'GET',
        url: '/admin/users',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.data).toHaveLength(0);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/admin/users',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when patient tries to access', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/admin/users',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 403 when doctor tries to access', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'GET',
        url: '/admin/users',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should accept pagination parameters', async () => {
      sessionUser = adminUser;

      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      const res = await app.inject({
        method: 'GET',
        url: '/admin/users?skip=10&take=5',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.skip).toBe(10);
      expect(body.contents.take).toBe(5);
    });
  });

  // ─── PATCH /admin/users/:id ──────────────────────────────────────

  describe('PATCH /admin/users/:id', () => {
    it('should update user successfully (admin)', async () => {
      sessionUser = adminUser;

      prisma.user.findUnique.mockResolvedValue(targetUser);
      prisma.user.update.mockResolvedValue({
        ...safeUserSelect,
        firstname: 'UpdatedName',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}`,
        payload: { firstname: 'UpdatedName' },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.firstname).toBe('UpdatedName');
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}`,
        payload: { firstname: 'Test' },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when patient tries to update user', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}`,
        payload: { firstname: 'Test' },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 400 when id is not a UUID', async () => {
      sessionUser = adminUser;

      const res = await app.inject({
        method: 'PATCH',
        url: '/admin/users/not-a-uuid',
        payload: { firstname: 'Test' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /admin/users/:id/deactivate ───────────────────────────

  describe('PATCH /admin/users/:id/deactivate', () => {
    it('should deactivate user successfully (admin)', async () => {
      sessionUser = adminUser;

      prisma.user.findUnique.mockResolvedValue(targetUser);
      prisma.user.update.mockResolvedValue({
        ...safeUserSelect,
        isActive: false,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}/deactivate`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.isActive).toBe(false);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}/deactivate`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when patient tries to deactivate', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}/deactivate`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─── GET /admin/doctors/pending ──────────────────────────────────

  describe('GET /admin/doctors/pending', () => {
    it('should list pending doctors (admin)', async () => {
      sessionUser = adminUser;

      prisma.doctorProfile.findMany.mockResolvedValue([
        {
          ...doctorProfile,
          user: {
            id: doctorUser.id,
            firstname: doctorUser.firstname,
            lastname: doctorUser.lastname,
            email: doctorUser.email,
          },
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/admin/doctors/pending',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(Array.isArray(body.contents)).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/admin/doctors/pending',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when doctor tries to access', async () => {
      sessionUser = doctorUser;

      const res = await app.inject({
        method: 'GET',
        url: '/admin/doctors/pending',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─── GET /admin/doctors/:id/documents ────────────────────────────

  describe('GET /admin/doctors/:id/documents', () => {
    it('should get doctor documents (admin)', async () => {
      sessionUser = adminUser;

      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorDocument.findMany.mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: `/admin/doctors/${doctorProfileId}/documents`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(Array.isArray(body.contents)).toBe(true);
    });

    it('should return 400 when id is not an integer', async () => {
      sessionUser = adminUser;

      const res = await app.inject({
        method: 'GET',
        url: '/admin/doctors/abc/documents',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should return 403 when patient tries to access', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: `/admin/doctors/${doctorProfileId}/documents`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─── PATCH /admin/doctors/:id/verify ─────────────────────────────

  describe('PATCH /admin/doctors/:id/verify', () => {
    it('should verify (approve) a doctor (admin)', async () => {
      sessionUser = adminUser;

      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorProfile.update.mockResolvedValue({
        ...doctorProfile,
        verified: true,
        verifiedAt: new Date(),
        verifiedBy: adminUser.id,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/doctors/${doctorProfileId}/verify`,
        payload: { approved: true },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.verified).toBe(true);
    });

    it('should reject a doctor with reason (admin)', async () => {
      sessionUser = adminUser;

      prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile);
      prisma.doctorProfile.update.mockResolvedValue({
        ...doctorProfile,
        verified: false,
        rejectionReason: 'Incomplete documents',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/doctors/${doctorProfileId}/verify`,
        payload: { approved: false, reason: 'Incomplete documents' },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
    });

    it('should return 400 when missing approved field', async () => {
      sessionUser = adminUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/doctors/${doctorProfileId}/verify`,
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/doctors/${doctorProfileId}/verify`,
        payload: { approved: true },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when patient tries to verify', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/doctors/${doctorProfileId}/verify`,
        payload: { approved: true },
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─── PATCH /admin/users/:id/promote ──────────────────────────────

  describe('PATCH /admin/users/:id/promote', () => {
    it('should promote user to admin (superadmin)', async () => {
      sessionUser = superAdminUser;

      prisma.user.findUnique.mockResolvedValue(targetUser);
      prisma.user.update.mockResolvedValue({
        ...safeUserSelect,
        isAdmin: true,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}/promote`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.isAdmin).toBe(true);
    });

    it('should return 403 when admin (non-super) tries to promote', async () => {
      sessionUser = adminUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}/promote`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}/promote`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when patient tries to promote', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}/promote`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 400 when id is not a UUID', async () => {
      sessionUser = superAdminUser;

      const res = await app.inject({
        method: 'PATCH',
        url: '/admin/users/not-a-uuid/promote',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /admin/users/:id/demote ───────────────────────────────

  describe('PATCH /admin/users/:id/demote', () => {
    it('should demote admin (superadmin)', async () => {
      sessionUser = superAdminUser;

      const adminTarget = {
        ...targetUser,
        isAdmin: true,
        isSuperAdmin: false,
      };
      prisma.user.findUnique.mockResolvedValue(adminTarget);
      prisma.user.update.mockResolvedValue({
        ...safeUserSelect,
        isAdmin: false,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}/demote`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.isAdmin).toBe(false);
    });

    it('should return 403 when admin (non-super) tries to demote', async () => {
      sessionUser = adminUser;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}/demote`,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${targetUserId}/demote`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── DELETE /admin/reviews/:id ───────────────────────────────────

  describe('DELETE /admin/reviews/:id', () => {
    it('should delete review (admin)', async () => {
      sessionUser = adminUser;

      const res = await app.inject({
        method: 'DELETE',
        url: '/admin/reviews/1',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      expect(mockReviewService.delete).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ id: adminUser.id }),
      );
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'DELETE',
        url: '/admin/reviews/1',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when patient tries to delete review', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'DELETE',
        url: '/admin/reviews/1',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should return 400 when id is not an integer', async () => {
      sessionUser = adminUser;

      const res = await app.inject({
        method: 'DELETE',
        url: '/admin/reviews/abc',
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /admin/stats ────────────────────────────────────────────

  describe('GET /admin/stats', () => {
    it('should return platform statistics (admin)', async () => {
      sessionUser = adminUser;

      prisma.user.count.mockResolvedValue(100);
      prisma.doctorProfile.count
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(3);
      (prisma.patientProfile as any).count = jest.fn().mockResolvedValue(75);
      prisma.consultation.count.mockResolvedValue(200);

      const res = await app.inject({
        method: 'GET',
        url: '/admin/stats',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents).toHaveProperty('totalUsers');
      expect(body.contents).toHaveProperty('totalDoctors');
      expect(body.contents).toHaveProperty('totalPatients');
      expect(body.contents).toHaveProperty('totalConsultations');
      expect(body.contents).toHaveProperty('pendingVerifications');
    });

    it('should return 401 when not authenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/admin/stats',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should return 403 when patient tries to access stats', async () => {
      sessionUser = patientUser;

      const res = await app.inject({
        method: 'GET',
        url: '/admin/stats',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });
  });
});
