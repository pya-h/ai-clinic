/**
 * Auth E2E Tests
 *
 * Tests:
 *   POST /auth/register — happy + duplicate email + weak password + missing fields
 *   POST /auth/login    — happy + wrong creds + missing fields
 *   POST /auth/logout   — happy + unauthenticated
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
  MockUser,
} from './helpers/mock-session.helper';
import { hash as bcryptHash } from 'bcrypt';

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

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;
  let sessionStore: Record<string, any> = {};
  let hashedPassword: string;

  const TEST_PASSWORD = 'StrongP@ss1';

  const validRegistration = {
    email: 'test@example.com',
    password: TEST_PASSWORD,
    firstname: 'Test',
    lastname: 'User',
    role: UserRolesEnum.PATIENT,
  };

  const loginPayload = {
    email: 'test@example.com',
    password: TEST_PASSWORD,
  };

  beforeAll(async () => {
    // Pre-hash the password with bcrypt (matching UtilsService's saltRounds=12)
    hashedPassword = await bcryptHash(TEST_PASSWORD, 12);

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

  // ─── POST /auth/register ───

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const createdUser = {
        id: 'new-user-uuid',
        email: validRegistration.email,
        firstname: validRegistration.firstname,
        lastname: validRegistration.lastname,
        password: hashedPassword,
        role: UserRolesEnum.PATIENT,
        avatar: null,
        isActive: true,
        isAdmin: false,
        isPrivate: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // emailExists check — no duplicate
      prisma.user.findFirst.mockResolvedValue(null);
      // user.create — return created user
      prisma.user.create.mockResolvedValue({ ...createdUser });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: validRegistration,
      });

      expect(res.statusCode).toBe(HttpStatus.CREATED);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.email).toBe(validRegistration.email);
      // password should be stripped
      expect(body.contents.password).toBeUndefined();
    });

    it('should reject duplicate email', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'existing-uuid',
        email: validRegistration.email,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: validRegistration,
      });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    });

    it('should reject weak password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { ...validRegistration, password: '123' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject missing email', async () => {
      const { email, ...noEmail } = validRegistration;
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: noEmail,
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject missing password', async () => {
      const { password, ...noPassword } = validRegistration;
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: noPassword,
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject invalid email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { ...validRegistration, email: 'not-an-email' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── POST /auth/login ───

  describe('POST /auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      const existingUser = {
        id: 'user-uuid',
        email: loginPayload.email,
        password: hashedPassword,
        firstname: 'Test',
        lastname: 'User',
        role: UserRolesEnum.PATIENT,
        avatar: null,
        isActive: true,
        isAdmin: false,
        isPrivate: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.user.findFirst.mockResolvedValue(existingUser);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: loginPayload,
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
      const body = JSON.parse(res.body);
      expect(body.contents).toBeDefined();
      expect(body.contents.email).toBe(loginPayload.email);
      expect(body.contents.password).toBeUndefined();
    });

    it('should reject wrong password', async () => {
      const existingUser = {
        id: 'user-uuid',
        email: loginPayload.email,
        password: hashedPassword,
        firstname: 'Test',
        lastname: 'User',
        role: UserRolesEnum.PATIENT,
      };
      prisma.user.findFirst.mockResolvedValue(existingUser);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { ...loginPayload, password: 'WrongP@ss1' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject non-existent email', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'nobody@example.com', password: 'SomeP@ss1' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject missing email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { password: 'SomeP@ss1' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject missing password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'test@example.com' },
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should reject empty body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {},
      });

      expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── POST /auth/logout ───

  describe('POST /auth/logout', () => {
    it('should logout successfully when authenticated', async () => {
      sessionUser = createMockUser();

      const res = await app.inject({
        method: 'POST',
        url: '/auth/logout',
      });

      expect(res.statusCode).toBe(HttpStatus.OK);
    });

    it('should reject logout when unauthenticated', async () => {
      sessionUser = null;

      const res = await app.inject({
        method: 'POST',
        url: '/auth/logout',
      });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    });
  });
});
