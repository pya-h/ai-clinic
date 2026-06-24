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
import fastifyMultipart from '@fastify/multipart';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createHash } from 'crypto';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { rawBody: true },
  );
  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  app.useGlobalFilters(new ExceptionTemplateFilter());
  app.useGlobalInterceptors(new ResponseTemplateInterceptor());

  const configService = app.get(ConfigService);
  const rawPort = configService.get<number>('general.appPort');
  const appPort = Number.isFinite(rawPort) ? rawPort : 8080;
  const appIsInDebugMode = configService.get<boolean>('general.debug');
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
    },
  });

  // Register multipart file upload support
  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });

  setupSwagger(app);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      enableDebugMessages: appIsInDebugMode,
    }),
  );

  // WebSocket adapter for Fastify + Socket.IO
  class FastifyIoAdapter extends IoAdapter {
    createIOServer(port: number, options?: any) {
      return super.createIOServer(port, {
        ...options,
        cors: {
          origin: corsOrigin.split(',').map((o) => o.trim()),
          credentials: true,
        },
        transports: ['websocket', 'polling'],
      });
    }
  }
  app.useWebSocketAdapter(new FastifyIoAdapter(app));

  await app.listen(appPort);
}
bootstrap();
