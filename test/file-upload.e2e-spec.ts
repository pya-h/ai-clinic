import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { HttpStatus, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import fastifyMultipart from '@fastify/multipart';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheModule } from '../src/cache/cache.module';
import { UtilsModule } from '../src/utils/utils.module';
import { AuthModule } from '../src/auth/auth.module';
import { UserModule } from '../src/user/user.module';
import { FileUploadModule } from '../src/file-upload/file-upload.module';
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
  MockUser,
} from './helpers/mock-session.helper';
import authConfigs from '../src/configs/auth';
import generalConfigs from '../src/configs/general';

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-e2e-'));

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      load: [
        authConfigs,
        generalConfigs,
        () => ({ storage: { type: 'local', localPath: storageDir } }),
      ],
    }),
    CacheModule,
    UtilsModule,
    AuthModule,
    UserModule,
    FileUploadModule,
    ScheduleModule.forRoot(),
  ],
})
class TestAppModule {}

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  randomBytes(32),
]);

function multipartBody(fileName: string, mimeType: string, content: Buffer) {
  const boundary = `----e2e${randomUUID()}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

function writeStoredFile(folder: string, fileName: string, content: Buffer) {
  fs.mkdirSync(path.join(storageDir, folder), { recursive: true });
  fs.writeFileSync(path.join(storageDir, folder, fileName), content);
}

describe('Uploads (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;
  let sessionUser: MockUser | null = null;

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
      new ValidationPipe({ whitelist: true, forbidUnknownValues: true, transform: true }),
    );
    await app.register(fastifyMultipart as any, { limits: { fileSize: 10 * 1024 * 1024 } });

    const instance = app.getHttpAdapter().getInstance();
    instance.addHook('preHandler', (request: any, _reply: any, done: any) => {
      request.session = {
        get: (key: string) => (key === 'user' ? sessionUser : undefined),
        set: (key: string, value: any) => {
          if (key === 'user') sessionUser = value;
        },
        delete: () => {
          sessionUser = null;
        },
      };
      done();
    });

    await app.init();
    await instance.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sessionUser = null;
  });

  // ─── Avatars ───

  describe('GET /uploads/avatars/:fileName', () => {
    it('should serve an avatar uploaded through POST /user/avatar, without auth', async () => {
      const user = createMockUser();
      sessionUser = user;
      prisma.user.update.mockImplementation(async ({ data }: any) => ({ id: user.id, avatar: data.avatar }));
      prisma.user.findUnique.mockResolvedValue(user);

      const upload = await app.inject({
        method: 'POST',
        url: '/user/avatar',
        ...multipartBody('me.html', 'image/png', PNG_BYTES),
      });
      expect(upload.statusCode).toBe(HttpStatus.CREATED);
      const avatarUrl: string = JSON.parse(upload.body).contents.avatar;
      expect(avatarUrl).toMatch(/^\/uploads\/avatars\/[0-9a-f-]{36}\.png$/);

      sessionUser = null;
      const res = await app.inject({ method: 'GET', url: avatarUrl });

      expect(res.statusCode).toBe(HttpStatus.OK);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(res.rawPayload.equals(PNG_BYTES)).toBe(true);
    });

    it('should serve legacy .jpeg names as image/jpeg', async () => {
      const fileName = `${randomUUID()}.jpeg`;
      const content = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(16)]);
      writeStoredFile('avatars', fileName, content);

      const res = await app.inject({ method: 'GET', url: `/uploads/avatars/${fileName}` });

      expect(res.statusCode).toBe(HttpStatus.OK);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.rawPayload.equals(content)).toBe(true);
    });

    it('should return 404 for a missing avatar', async () => {
      const res = await app.inject({ method: 'GET', url: `/uploads/avatars/${randomUUID()}.png` });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should not serve a stored file with an unsupported extension', async () => {
      const fileName = `${randomUUID()}.html`;
      writeStoredFile('avatars', fileName, Buffer.from('<script>alert(1)</script>'));

      const res = await app.inject({ method: 'GET', url: `/uploads/avatars/${fileName}` });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
      expect(res.body).not.toContain('<script>');
    });

    it.each([
      '/uploads/avatars/..%2F..%2Fpackage.json',
      '/uploads/avatars/%2E%2E%2Fsecret.png',
      '/uploads/avatars/../doctor-documents/x.pdf',
    ])('should not escape the avatars folder for %s', async (url) => {
      writeStoredFile('doctor-documents', 'x.pdf', Buffer.from('%PDF-secret'));

      const res = await app.inject({ method: 'GET', url });

      expect([HttpStatus.NOT_FOUND, HttpStatus.UNAUTHORIZED]).toContain(res.statusCode);
      expect(res.body).not.toContain('%PDF-secret');
    });

    it('should return 404 for an unknown upload folder', async () => {
      writeStoredFile('other', 'x.png', PNG_BYTES);

      const res = await app.inject({ method: 'GET', url: '/uploads/other/x.png' });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─── Doctor documents ───

  describe('GET /uploads/doctor-documents/:fileName', () => {
    const owner = createMockDoctorUser();
    let fileName: string;
    let content: Buffer;

    beforeEach(() => {
      fileName = `${randomUUID()}.pdf`;
      content = Buffer.concat([Buffer.from('%PDF-1.4 '), randomBytes(32)]);
      writeStoredFile('doctor-documents', fileName, content);
      prisma.doctorDocument.findFirst.mockImplementation(async ({ where }: any) =>
        where.fileUrl === `/uploads/doctor-documents/${fileName}`
          ? { doctor: { userId: owner.id } }
          : null,
      );
    });

    it.each([
      ['the owning doctor', () => owner],
      ['an admin', () => createMockAdminUser()],
    ])('should serve the document to %s', async (_label, user) => {
      sessionUser = user();

      const res = await app.inject({ method: 'GET', url: `/uploads/doctor-documents/${fileName}` });

      expect(res.statusCode).toBe(HttpStatus.OK);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.rawPayload.equals(content)).toBe(true);
    });

    it('should return 401 without a session', async () => {
      const res = await app.inject({ method: 'GET', url: `/uploads/doctor-documents/${fileName}` });

      expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
      expect(prisma.doctorDocument.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      ['another doctor', () => createMockDoctorUser()],
      ['a patient', () => createMockUser()],
    ])('should return 403 for %s', async (_label, user) => {
      sessionUser = user();

      const res = await app.inject({ method: 'GET', url: `/uploads/doctor-documents/${fileName}` });

      expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
      expect(res.rawPayload.includes(content)).toBe(false);
    });

    it('should return 404 for a stored file with no document record', async () => {
      const orphan = `${randomUUID()}.pdf`;
      writeStoredFile('doctor-documents', orphan, content);
      sessionUser = createMockAdminUser();

      const res = await app.inject({ method: 'GET', url: `/uploads/doctor-documents/${orphan}` });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('should return 404 when the document record exists but the file is gone', async () => {
      fs.rmSync(path.join(storageDir, 'doctor-documents', fileName));
      sessionUser = owner;

      const res = await app.inject({ method: 'GET', url: `/uploads/doctor-documents/${fileName}` });

      expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    });
  });
});
