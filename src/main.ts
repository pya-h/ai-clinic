import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ExceptionTemplateFilter } from './common/filters/exception-template.filter';
import { ResponseTemplateInterceptor } from './common/interceptors/response-template.interceptor';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.enableCors(); // TODO: U may remove this.

  app.useGlobalFilters(new ExceptionTemplateFilter());
  app.useGlobalInterceptors(new ResponseTemplateInterceptor());

  const configService = app.get(ConfigService);
  const appPort = configService.getOrThrow<number>('general.appPort'),
    appIsInDebugMode = configService.get<boolean>('general.debug');

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
