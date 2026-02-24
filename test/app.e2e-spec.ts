/**
 * App E2E Tests
 *
 * Tests:
 *   GET / — health check / root route
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExceptionTemplateFilter } from '../src/common/filters/exception-template.filter';
import { ResponseTemplateInterceptor } from '../src/common/interceptors/response-template.interceptor';
import {
  createMockPrismaService,
  MockPrismaService,
} from './helpers/mock-prisma.helper';
import generalConfigs from '../src/configs/general';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ load: [generalConfigs] }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
class TestAppModule {}

describe('App (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: MockPrismaService;

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

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / should return OK', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(res.statusCode).toBe(HttpStatus.OK);
  });
});
