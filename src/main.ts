import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ExceptionTemplateFilter } from './common/filters/exception-template.filter';
import { ResponseTemplateInterceptor } from './common/interceptors/response-template.interceptor';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setupSwagger } from './configs';
import fastifyCookie from '@fastify/cookie';
import fastifySecureSession from '@fastify/secure-session';
import { createHash } from 'crypto';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.enableCors({ origin: true, credentials: true });

  app.useGlobalFilters(new ExceptionTemplateFilter());
  app.useGlobalInterceptors(new ResponseTemplateInterceptor());

  const configService = app.get(ConfigService);
  const appPort = configService.getOrThrow<number>('general.appPort'),
    appIsInDebugMode = configService.get<boolean>('general.debug');
  // Register cookie & secure session plugins (Fastify)
  await app.register(fastifyCookie);
  await app.register(fastifySecureSession, {
    // Derive a strong 32-byte key from the env secret
    key: createHash('sha256')
      .update(configService.getOrThrow<string>('auth.sessionSecret'))
      .digest(),
    cookieName: configService.get<string>('auth.sessionCookieName') || 'sid',
    cookie: {
      path: '/',
      httpOnly: true,
      secure: false, // set true behind HTTPS
      sameSite: 'lax',
    },
  });
  setupSwagger(app);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidUnknownValues: true,
      transform: true,
      enableDebugMessages: appIsInDebugMode,
    }),
  );
  await app.listen(appPort ?? 8080);
}
bootstrap();
