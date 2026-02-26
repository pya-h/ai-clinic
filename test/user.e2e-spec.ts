/**
 * User E2E Tests
 *
 * Tests:
 *   GET    /user         — get current user (authed + unauthed)
 *   GET    /user/all     — list users (admin + non-admin)
 *   PATCH  /user/profile — update profile (valid + empty + duplicate email)
 *   GET    /user/:id     — get specific user
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../src/auth/auth.module';
import { UserModule } from '../src/user/user.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { UtilsModule } from '../src/utils/utils.module';
import { ExceptionTemplateFilter } from '../src/common/filters/exception-template.filter';
import { ResponseTemplateInterceptor } from '../src/common/interceptors/response-template.interceptor';
import {
  createMockPrismaService,
  MockPrismaService,
} from './helpers/mock-prisma.helper';
import { UserRolesEnum } from '@prisma/client';
import { ScheduleModule } from '@nestjs/schedule';
import authConfigs from '../src/configs/auth';
import generalConfigs from '../src/configs/general';
import {
  createMockUser,
  createMockAdminUser,
  MockUser,
} from './helpers/mock-session.helper';
import {
  randomEmail,
  randomFirstName,
  randomLastName,
  randomUuid,
} from './helpers/test-data.factory';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ load: [authConfigs, generalConfigs] }),
    CacheModule,
    UtilsModule,
    AuthModule,
    UserModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

describe('User (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};

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

    // Add session simulation hook BEFORE app.init()
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

  // ─── GET /user ───

  describe('GET /user', () => {
    it('should return current user when authenticated', async () => {
      sessionUser = createMockUser();

      const res = await app.inject({
        method: 'GET',
        url: '/user',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.email).toBe(sessionUser.email);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/user',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── GET /user/all ───

  describe('GET /user/all', () => {
    it('should return user list for admin', async () => {
      sessionUser = createMockAdminUser();
      const fName = randomFirstName();
      const lName = randomLastName();
      prisma.user.findMany.mockResolvedValue([
        {
          avatar: null,
          createdAt: new Date(),
          firstname: fName,
          lastname: lName,
          isPrivate: false,
          role: UserRolesEnum.PATIENT,
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/user/all',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.contents)).toBe(true);
    });

    it('should reject non-admin user', async () => {
      sessionUser = createMockUser();

      const res = await app.inject({
        method: 'GET',
        url: '/user/all',
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: '/user/all',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── PATCH /user/profile ───

  describe('PATCH /user/profile', () => {
    it('should update user profile with valid data', async () => {
      sessionUser = createMockUser();
      const updatedName = randomFirstName();
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({
        ...sessionUser,
        firstname: updatedName,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/user/profile',
        payload: { firstname: updatedName },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.firstname).toBe(updatedName);
    });

    it('should reject update with empty body', async () => {
      sessionUser = createMockUser();

      const res = await app.inject({
        method: 'PATCH',
        url: '/user/profile',
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject update with duplicate email', async () => {
      sessionUser = createMockUser();
      const takenEmail = randomEmail();
      prisma.user.findFirst.mockResolvedValue({
        id: randomUuid(),
        email: takenEmail,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/user/profile',
        payload: { email: takenEmail },
      });

      expect(res.statusCode).toBe(HttpStatus.CONFLICT);
    });

    it('should reject update with invalid email format', async () => {
      sessionUser = createMockUser();

      const res = await app.inject({
        method: 'PATCH',
        url: '/user/profile',
        payload: { email: 'not-valid-email' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject unauthenticated profile update', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'PATCH',
        url: '/user/profile',
        payload: { firstname: 'Hacker' },
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should strip unknown fields (whitelist validation)', async () => {
      sessionUser = createMockUser();
      const updatedName = randomFirstName();
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({
        ...sessionUser,
        firstname: updatedName,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/user/profile',
        payload: {
          firstname: updatedName,
          role: 'DOCTOR',
          isAdmin: true,
        },
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      if (prisma.user.update.mock.calls.length > 0) {
        const updateData = prisma.user.update.mock.calls[0][0].data;
        expect(updateData.role).toBeUndefined();
        expect(updateData.isAdmin).toBeUndefined();
      }
    });
  });

  // ─── GET /user/:id ───

  describe('GET /user/:id', () => {
    it('should return own user data when requesting own ID', async () => {
      sessionUser = createMockUser();

      const res = await app.inject({
        method: 'GET',
        url: `/user/${sessionUser.id}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.id).toBe(sessionUser.id);
    });

    it('should return other user data when requesting different ID', async () => {
      sessionUser = createMockUser();
      const otherId = randomUuid();
      const otherEmail = randomEmail();
      const otherFirst = randomFirstName();
      const otherLast = randomLastName();
      prisma.user.findUnique.mockResolvedValue({
        id: otherId,
        email: otherEmail,
        firstname: otherFirst,
        lastname: otherLast,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/user/${otherId}`,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents.email).toBe(otherEmail);
    });

    it('should return 404 for non-existent user', async () => {
      sessionUser = createMockUser();
      prisma.user.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `/user/${randomUuid()}`,
      });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should reject unauthenticated request', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'GET',
        url: `/user/${randomUuid()}`,
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });
});
